import { runProjectIdsBackfill } from "./backfills/project-ids-backfill";
import { runPmUserBackfill } from "./backfills/pm-user-backfill";
import { runUserAssignmentBackfill } from "./backfills/user-assignment-backfill";
import { runMsAssignmentCleanup } from "./backfills/ms-assignment-cleanup-backfill";
import { runWorkItemsBackfill } from "./backfills/work-items-backfill";
import { runAssigneeUserIdsBackfill } from "./backfills/assignee-user-ids-backfill";
import { runIntegrityGuard } from "./backfills/integrity-guard";
import { runRoleLensBackfill } from "./backfills/role-lens-backfill";
import { runPermissionActionCollapseBackfill } from "./backfills/permission-action-collapse-backfill";
import { hasBackfillRun, markBackfillComplete } from "./backfills/backfill-registry";

export async function runStartupBackfills(options: {
  startupBackfillEnabled: boolean;
  allowStartupMutations: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { startupBackfillEnabled, allowStartupMutations, log } = options;
  if (!startupBackfillEnabled) return;

  // Permission-model collapse (view|edit). Runs once on its OWN guard key,
  // BEFORE the umbrella startup_backfills_v1 early-return, so deployments that
  // already completed the umbrella backfills still migrate their stored grants.
  if (!(await hasBackfillRun("permission_action_collapse_v1"))) {
    await runPermissionActionCollapseBackfill(log).catch((err: any) =>
      log(`[Backfill] permission action collapse error: ${err?.message || err}`, "Startup:Backfill"),
    );
    await markBackfillComplete("permission_action_collapse_v1").catch(() => {});
  }

  // One-time guard: skip all startup backfills if they've already completed
  if (await hasBackfillRun("startup_backfills_v1")) return;

  await runPmUserBackfill(log).catch((err) => log(`[Backfill] PM user sync error: ${err}`, "Startup:Backfill"));
  await runProjectIdsBackfill().catch((err) => log(`[Backfill] Project IDs error: ${err}`, "Startup:Backfill"));
  await runUserAssignmentBackfill(log).catch((err) => log(`[Backfill] User ID sync error: ${err}`, "Startup:Backfill"));
  await runMsAssignmentCleanup(log).catch((err) => log(`[MS-Filter] Assignment cleanup error: ${err}`, "Startup:Backfill"));
  await runWorkItemsBackfill(startupBackfillEnabled, allowStartupMutations).catch((err: any) =>
    log(`[Backfill] work_items backfill failed: ${err?.message || err}`, "Startup:Backfill"),
  );
  await runAssigneeUserIdsBackfill(log).catch((err: any) =>
    log(`[Backfill] assignee_user_ids sync error: ${err?.message || err}`, "Startup:Backfill"),
  );
  await runIntegrityGuard(log).catch((err: any) =>
    log(`[Backfill] integrity guard error: ${err?.message || err}`, "Startup:Backfill"),
  );

  // Role-based UX upgrade: backfill lens profiles, widgets, contracts, SSEG applications
  await runRoleLensBackfill().catch((err: any) =>
    log(`[Backfill] role lens backfill error: ${err?.message || err}`, "Startup:Backfill"),
  );

  // Mark all startup backfills as complete
  await markBackfillComplete("startup_backfills_v1").catch(() => {});
}
