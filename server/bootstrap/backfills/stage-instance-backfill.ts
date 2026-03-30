/**
 * Stage Instance Backfill — ensures every project has stage instances,
 * and marks historical projects' prior stages as PROGRESSED.
 *
 * Historical projects should NOT be forced through gates they've already
 * passed. This backfill reads executionPhase from project_execution_state,
 * maps it to a StageCode, and marks all prior stages as completed.
 *
 * Idempotent: only touches projects with zero existing stage instances.
 */

import { db, getDbMode } from "../../db";
import { eq, sql, and, inArray } from "drizzle-orm";
import {
  projectStageInstances,
  stageDefinitions,
  projectExecutionState,
  STAGE_CODES,
  type StageCode,
} from "@shared/schema";
import {
  PHASE_TO_STAGE,
  FULLY_COMPLETED_PHASES,
  stagesBefore,
} from "../../../shared/utils/phase-to-stage-map";
import type { LifecyclePhase } from "@shared/schema";

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

    let created = 0;
    let historicalMarked = 0;

    for (const row of rows) {
      const projectId = row.project_id as number;

      // Skip if current_stage_code already set (already initialized through normal flow)
      if (row.current_stage_code) continue;

      // Determine current stage from executionPhase or phase
      const phaseStr = (row.execution_phase || row.phase || "") as string;
      const mappedStage = PHASE_TO_STAGE[phaseStr as LifecyclePhase] ?? "S01_FIRST_ASSESSMENT";
      const isFullyCompleted = FULLY_COMPLETED_PHASES.includes(phaseStr as LifecyclePhase);

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
      const priorStages = isFullyCompleted
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
      if (!isFullyCompleted) {
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
          currentStageCode: isFullyCompleted ? "S10_POST_HANDOVER_REVIEW" : mappedStage,
          gateStatus: isFullyCompleted ? "PROGRESSED" : "IN_PROGRESS",
          gateReadinessPct: isFullyCompleted ? 100 : 0,
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
