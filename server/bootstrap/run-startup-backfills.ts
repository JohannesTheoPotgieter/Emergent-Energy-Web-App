import { runProjectIdsBackfill } from "./backfills/project-ids-backfill";
import { runPmUserBackfill } from "./backfills/pm-user-backfill";
import { runUserAssignmentBackfill } from "./backfills/user-assignment-backfill";
import { runMsAssignmentCleanup } from "./backfills/ms-assignment-cleanup-backfill";
import { runWorkItemsBackfill } from "./backfills/work-items-backfill";
import { runAssigneeUserIdsBackfill } from "./backfills/assignee-user-ids-backfill";

export async function runStartupBackfills(options: {
  startupBackfillEnabled: boolean;
  runtimeSchemaRepairEnabled: boolean;
  allowStartupMutations: boolean;
  log: (message: string, source?: string) => void;
}) {
  const { startupBackfillEnabled, runtimeSchemaRepairEnabled, allowStartupMutations, log } = options;
  if (!startupBackfillEnabled) return;

  await runPmUserBackfill(log, runtimeSchemaRepairEnabled).catch((err) => log(`[Backfill] PM user sync error: ${err}`, "Startup:Backfill"));
  await runProjectIdsBackfill().catch((err) => log(`[Backfill] Project IDs error: ${err}`, "Startup:Backfill"));
  await runUserAssignmentBackfill(log).catch((err) => log(`[Backfill] User ID sync error: ${err}`, "Startup:Backfill"));
  await runMsAssignmentCleanup(log).catch((err) => log(`[MS-Filter] Assignment cleanup error: ${err}`, "Startup:Backfill"));
  await runWorkItemsBackfill(startupBackfillEnabled, allowStartupMutations).catch((err: any) =>
    log(`[Backfill] work_items backfill failed: ${err?.message || err}`, "Startup:Backfill"),
  );
  await runAssigneeUserIdsBackfill(log).catch((err: any) =>
    log(`[Backfill] assignee_user_ids sync error: ${err?.message || err}`, "Startup:Backfill"),
  );
}
