/**
 * Gate Evaluation Backfill — one-time backfill that evaluates stage gates
 * for all active projects based on their current stage.
 *
 * Problem: gate definitions were seeded via migrations, but existing projects
 * that had already progressed past certain stages never had their gates
 * evaluated. This means project_gate_evaluations is empty for historical
 * projects, and gate_status in project_execution_state is just a generic
 * "IN_PROGRESS" / "PROGRESSED" placeholder rather than a real pass/fail result.
 *
 * Fix: for each active project, evaluate the gate guarding its current stage.
 * This populates project_gate_evaluations and updates gate_status accordingly.
 *
 * One-time: uses backfill registry so it never runs again.
 */

import { db } from "../../db";
import { sql, eq } from "drizzle-orm";
import { projectExecutionState } from "@shared/schema";
import { evaluateStageGate } from "../../services/lifecycle-stage-gate-service";
import { hasBackfillRun, markBackfillComplete } from "./backfill-registry";

const BACKFILL_KEY = "gate_evaluation_backfill_v1";

export async function runGateEvaluationBackfill(
  log: (message: string, source?: string) => void,
): Promise<void> {
  const SRC = "Startup:GateEvaluationBackfill";

  try {
    if (await hasBackfillRun(BACKFILL_KEY)) return;

    // Find all active projects with a phase set (i.e. they're in a real stage)
    const result = await db.execute(sql`
      SELECT pes.project_id, pes.phase, pes.current_stage_code
      FROM project_execution_state pes
      WHERE pes.is_active = true
        AND COALESCE(pes.archived_status, 'ACTIVE') = 'ACTIVE'
        AND pes.phase IS NOT NULL
        AND pes.phase != ''
    `);

    const projects = (result as any).rows ?? [];
    if (projects.length === 0) {
      await markBackfillComplete(BACKFILL_KEY, { projectsEvaluated: 0, reason: "no_active_projects" });
      return;
    }

    log(`Evaluating gates for ${projects.length} active projects`, SRC);

    let evaluated = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of projects) {
      const projectId = row.project_id as number;
      const phase = (row.phase || "") as string;

      if (!phase.trim()) {
        skipped++;
        continue;
      }

      try {
        // Evaluate the gate guarding the project's current stage.
        // This looks up stage_gate_definitions where target_stage matches
        // the project's current phase, evaluates all requirements, and
        // records the result in project_gate_evaluations.
        const evaluation = await evaluateStageGate({
          projectId,
          targetStage: phase.trim(),
          actorUserId: null,
          actorRole: "system:backfill",
        });

        // Update gate_status based on the evaluation result
        const gateStatus = evaluation.allowed ? "IN_PROGRESS" : "BLOCKED";
        await db
          .update(projectExecutionState)
          .set({
            gateStatus,
            gateReadinessPct: evaluation.allowed ? 100 : Math.max(0, 100 - evaluation.missingItems.length * 20),
            updatedAt: new Date(),
          })
          .where(eq(projectExecutionState.projectId, projectId));

        evaluated++;
        if (evaluation.allowed) {
          passed++;
        } else {
          failed++;
        }
      } catch (err: unknown) {
        errors++;
        // Log but don't fail the entire backfill for one project
        log(
          `Gate evaluation failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
          SRC,
        );
      }
    }

    await markBackfillComplete(BACKFILL_KEY, {
      projectsScanned: projects.length,
      projectsEvaluated: evaluated,
      passed,
      failed,
      skipped,
      errors,
    });

    log(
      `Gate evaluation backfill complete: ${evaluated} evaluated (${passed} passed, ${failed} blocked), ${skipped} skipped, ${errors} errors`,
      SRC,
    );
  } catch (err: unknown) {
    log(
      `Gate evaluation backfill error: ${err instanceof Error ? err.message : String(err)}`,
      SRC,
    );
  }
}
