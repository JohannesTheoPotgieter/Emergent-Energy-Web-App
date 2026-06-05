/**
 * Import runs (read) repository — Smart Import v2 visibility.
 *
 * Read-only helpers over `smart_import_runs` that power the per-project
 * import-status card and the portfolio "imports needing attention" list.
 * Writes still live in the import pipeline / commit services; this repo only
 * surfaces state for the UI.
 *
 * Conventions (CLAUDE.md): route handlers read run state through here rather
 * than touching `smart_import_runs` directly.
 */

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { smartImportRuns, type SmartImportRun } from "@shared/schema";

/** Statuses that mean "a human still needs to look at this". */
export const ATTENTION_STATUSES = ["awaiting_review", "failed"] as const;

/** The most recent run for a project, any status (null if never imported). */
export async function getLatestRunForProject(projectId: number): Promise<SmartImportRun | null> {
  const [row] = await db
    .select()
    .from(smartImportRuns)
    .where(eq(smartImportRuns.projectId, projectId))
    .orderBy(desc(smartImportRuns.uploadedAt))
    .limit(1);
  return row ?? null;
}

/** The most recent committed run for a project (the "last good import"). */
export async function getLatestCommittedRunForProject(
  projectId: number,
): Promise<SmartImportRun | null> {
  const [row] = await db
    .select()
    .from(smartImportRuns)
    .where(eq(smartImportRuns.projectId, projectId))
    .orderBy(desc(smartImportRuns.committedAt))
    .limit(1);
  return row && row.status === "committed" ? row : null;
}

/** Runs that need a human — parked for review or failed — newest first. */
export async function listRunsNeedingAttention(limit = 50): Promise<SmartImportRun[]> {
  return db
    .select()
    .from(smartImportRuns)
    .where(inArray(smartImportRuns.status, [...ATTENTION_STATUSES]))
    .orderBy(desc(smartImportRuns.uploadedAt))
    .limit(limit);
}
