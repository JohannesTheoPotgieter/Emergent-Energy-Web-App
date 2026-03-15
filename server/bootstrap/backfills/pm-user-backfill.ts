import { backfillPmUserIds } from "../backfill";

export async function runPmUserBackfill(
  log: (message: string, source?: string) => void,
) {
  await backfillPmUserIds(log);
}
