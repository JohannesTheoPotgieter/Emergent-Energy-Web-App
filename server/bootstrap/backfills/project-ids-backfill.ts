import { backfillProjectIds } from "../../lib/backfill-project-ids";

export async function runProjectIdsBackfill() {
  await backfillProjectIds();
}
