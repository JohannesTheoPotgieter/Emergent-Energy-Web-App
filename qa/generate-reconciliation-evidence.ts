import fs from "fs";
import path from "path";
import { initializeDatabase } from "../server/db";
import { generateWorkItemReconciliationReport } from "../server/lib/reconciliation/work-item-reconciliation";

async function main() {
  await initializeDatabase();

  const [all, engineering] = await Promise.all([
    generateWorkItemReconciliationReport(),
    generateWorkItemReconciliationReport("ENG"),
  ]);

  const status = [all.status, engineering.status].includes("fail")
    ? "fail"
    : [all.status, engineering.status].includes("warning")
      ? "warning"
      : "pass";

  const report = {
    generated_at: new Date().toISOString(),
    status,
    all_work_items: all,
    engineering,
  };

  const outDir = path.join(process.cwd(), "qa", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "reconciliation-status.json");
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Reconciliation evidence written to ${outFile}`);
  console.log(`Overall reconciliation status: ${status}`);

  process.exit(status === "fail" ? 1 : 0);
}

main().catch((error) => {
  console.error("Failed to generate reconciliation evidence", error);
  process.exit(1);
});
