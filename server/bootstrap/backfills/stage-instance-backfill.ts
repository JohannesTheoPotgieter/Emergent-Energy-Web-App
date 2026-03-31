/**
 * Stage Instance Backfill — ensures every project has stage instances,
 * and marks historical projects' prior stages as PROGRESSED.
 *
 * Historical projects should NOT be forced through gates they've already
 * passed. This backfill reads executionPhase/phase from project_execution_state,
 * maps it to a StageCode, and marks all prior stages as completed.
 *
 * For Hold/Internal/Gone projects, looks up project_phase_history to find
 * the last real stage the project was in before being parked.
 *
 * Idempotent: only touches projects with zero existing stage instances.
 */

import { db, getDbMode } from "../../db";
import { eq, sql, and, inArray, desc } from "drizzle-orm";
import {
  projectStageInstances,
  stageDefinitions,
  projectExecutionState,
  projectPhaseHistory,
  STAGE_CODES,
  type StageCode,
} from "@shared/schema";
import {
  resolveStageFromPhase,
  isFullyCompletedPhase,
  isSpecialPhase,
  stagesBefore,
  SPECIAL_PHASES,
} from "../../../shared/utils/phase-to-stage-map";

export async function runStageInstanceBackfill(
  log: (message: string, source?: string) => void,
): Promise<void> {
  if (getDbMode() !== "postgres") return;

  const SRC = "Startup:StageInstanceBackfill";

  try {
    // Find projects that have execution state but NO stage instances
    const projectsWithoutStages = await db.execute(sql.raw(`
      SELECT pes.project_id, pes.execution_phase, pes.phase, pes.current_stage_code
      FROM project_execution_state pes
      LEFT JOIN project_stage_instances psi ON psi.project_id = pes.project_id
      WHERE psi.id IS NULL
        AND pes.is_active = true
      GROUP BY pes.project_id, pes.execution_phase, pes.phase, pes.current_stage_code
    `));

    const rows = (projectsWithoutStages as any).rows ?? [];
    if (rows.length === 0) {
      return; // Nothing to backfill
    }

    log(`Found ${rows.length} projects without stage instances — backfilling`, SRC);

    // Load stage definitions once
    const definitions = await db
      .select()
      .from(stageDefinitions)
      .where(eq(stageDefinitions.isActive, true))
      .orderBy(stageDefinitions.stageSequence);

    if (definitions.length === 0) {
      log("No stage definitions found — skipping backfill", SRC);
      return;
    }

    // Lowercase special phases for comparison
    const specialPhasesLower = SPECIAL_PHASES.map(p => p.toLowerCase());

    let created = 0;
    let historicalMarked = 0;

    for (const row of rows) {
      const projectId = row.project_id as number;
      const existingStageCode = row.current_stage_code as string | null;
      const phaseStr = (row.execution_phase || row.phase || "") as string;

      // Determine the target stage code
      let mappedStage: StageCode;
      let isCompleted: boolean;

      if (existingStageCode && STAGE_CODES.includes(existingStageCode as StageCode)) {
        // current_stage_code already set — use it directly (but still create instances)
        mappedStage = existingStageCode as StageCode;
        isCompleted = isFullyCompletedPhase(phaseStr);
      } else if (isSpecialPhase(phaseStr)) {
        // Hold/Internal/Gone — look up phase history for the last real phase
        mappedStage = await resolveFromPhaseHistory(projectId, specialPhasesLower);
        isCompleted = false;
      } else {
        // Normal mapping from phase string
        mappedStage = resolveStageFromPhase(phaseStr);
        isCompleted = isFullyCompletedPhase(phaseStr);
      }

      // Create all 10 stage instances
      const now = new Date();
      const toInsert = definitions.map((def: any) => ({
        projectId,
        stageCode: def.stageCode,
        stageStatus: "NOT_STARTED" as const,
        readinessPct: 0,
        createdAt: now,
        updatedAt: now,
      }));

      await db.insert(projectStageInstances).values(toInsert).onConflictDoNothing();
      created++;

      // Mark prior stages as PROGRESSED
      const priorStages = isCompleted
        ? [...STAGE_CODES] as string[]  // All stages completed
        : stagesBefore(mappedStage) as string[];

      if (priorStages.length > 0) {
        await db
          .update(projectStageInstances)
          .set({
            stageStatus: "PROGRESSED",
            readinessPct: 100,
            completedAt: now,
            updatedAt: now,
          })
          .where(and(
            eq(projectStageInstances.projectId, projectId),
            inArray(projectStageInstances.stageCode, priorStages),
          ));
        historicalMarked++;
      }

      // Set current stage to IN_PROGRESS (unless fully completed)
      if (!isCompleted) {
        await db
          .update(projectStageInstances)
          .set({
            stageStatus: "IN_PROGRESS",
            startedAt: now,
            updatedAt: now,
          })
          .where(and(
            eq(projectStageInstances.projectId, projectId),
            eq(projectStageInstances.stageCode, mappedStage),
          ));
      }

      // Update project_execution_state with current stage code
      await db
        .update(projectExecutionState)
        .set({
          currentStageCode: isCompleted ? "S10_POST_HANDOVER_REVIEW" : mappedStage,
          gateStatus: isCompleted ? "PROGRESSED" : "IN_PROGRESS",
          gateReadinessPct: isCompleted ? 100 : 0,
          updatedAt: now,
        })
        .where(eq(projectExecutionState.projectId, projectId));
    }

    if (created > 0) {
      log(`Backfilled stage instances for ${created} projects (${historicalMarked} with historical stages marked PROGRESSED)`, SRC);
    }
  } catch (err: unknown) {
    log(`Stage instance backfill error: ${(err instanceof Error ? err.message : String(err))}`, SRC);
  }
}

/**
 * For Hold/Internal/Gone projects, look up project_phase_history to find
 * the last non-special phase the project was in. Falls back to S01.
 */
async function resolveFromPhaseHistory(
  projectId: number,
  specialPhasesLower: string[],
): Promise<StageCode> {
  try {
    const history = await db
      .select({ fromPhase: projectPhaseHistory.fromPhase })
      .from(projectPhaseHistory)
      .where(eq(projectPhaseHistory.projectId, projectId))
      .orderBy(desc(projectPhaseHistory.changedAt))
      .limit(10);

    // Find the most recent fromPhase that isn't itself a special phase
    for (const row of history) {
      const from = row.fromPhase;
      if (from && !specialPhasesLower.includes(from.trim().toLowerCase())) {
        return resolveStageFromPhase(from);
      }
    }
  } catch {
    // Phase history table may not have data — fall through to default
  }

  return "S01_FIRST_ASSESSMENT";
}
