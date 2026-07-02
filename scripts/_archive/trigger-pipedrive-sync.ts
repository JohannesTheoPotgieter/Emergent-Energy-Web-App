import { initializeDatabase } from "../server/db.js";
import { syncPipedriveDeals } from "../server/services/pipedrive-sync-service.js";
(async () => {
  await initializeDatabase();
  const r = await syncPipedriveDeals({ scope: "all" });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})();
