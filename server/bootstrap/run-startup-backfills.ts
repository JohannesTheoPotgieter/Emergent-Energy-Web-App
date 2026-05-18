import { runProjectIdsBackfill } from "./backfills/project-ids-backfill";
import { runPmUserBackfill } from "./backfills/pm-user-backfill";
import { runUserAssignmentBackfill } from "./backfills/user-assignment-backfill";
import { runMsAssignmentCleanup } from "./backfills/ms-assignment-cleanup-backfill";
import { runWorkItemsBackfill } from "./backfills/work-items-backfill";
import { runAssigneeUserIdsBackfill } from "./backfills/assignee-user-ids-backfill";
import { runIntegrityGuard } from "./backfills/integrity-guard";
import { runRoleLensBackfill } from "./backfills/role-lens-backfill";
import { hasBackfillRun, markBackfillComplete } from "./backfills/backfill-registry";

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runStartupBackfills(options: {
  startupBackfillEnabled: boolean;
  allowStartupMutations: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { startupBackfillEnabled, allowStartupMutations, log } = options;
  if (!startupBackfillEnabled) return;

  // One-time guard: skip all startup backfills if they've already completed
  if (await hasBackfillRun("startup_backfills_v1")) return;

  await runPmUserBackfill(log).catch((err) => log(`[Backfill] PM user sync error: ${err}`, "Startup:Backfill"));
  await runProjectIdsBackfill().catch((err) => log(`[Backfill] Project IDs error: ${err}`, "Startup:Backfill"));
  await runUserAssignmentBackfill(log).catch((err) => log(`[Backfill] User ID sync error: ${err}`, "Startup:Backfill"));
  await runMsAssignmentCleanup(log).catch((err) => log(`[MS-Filter] Assignment cleanup error: ${err}`, "Startup:Backfill"));
  await runWorkItemsBackfill(startupBackfillEnabled, allowStartupMutations).catch((err: unknown) =>
    log(`[Backfill] work_items backfill failed: ${errMessage(err)}`, "Startup:Backfill"),
  );
  await runAssigneeUserIdsBackfill(log).catch((err: unknown) =>
    log(`[Backfill] assignee_user_ids sync error: ${errMessage(err)}`, "Startup:Backfill"),
  );
  await runIntegrityGuard(log).catch((err: unknown) =>
    log(`[Backfill] integrity guard error: ${errMessage(err)}`, "Startup:Backfill"),
  );

  // Role-based UX upgrade: backfill lens profiles, widgets, contracts, SSEG applications
  await runRoleLensBackfill().catch((err: unknown) =>
    log(`[Backfill] role lens backfill error: ${errMessage(err)}`, "Startup:Backfill"),
  );

  // Mark all startup backfills as complete
  await markBackfillComplete("startup_backfills_v1").catch(() => {});
}
