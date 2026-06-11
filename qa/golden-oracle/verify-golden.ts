/**
 * verify:golden — READ-ONLY prod diff for the golden fixture (CLI wrapper).
 *
 * The verification logic lives in server/lib/golden-verification.ts so the
 * weekly finance integrity guard can run the EXACT same checks in-process
 * (single source of truth). This wrapper renders the CSV + console summary and
 * is the entry point for `npm run verify:golden`.
 *
 * STRICTLY READ-ONLY. The core only SELECTs against the `claude_views.*`
 * snapshot-dated views and imports no app importer / finance-derivation code.
 *
 * Run:  npm run verify:golden
 * Env:  CLAUDE_RO_DATABASE_URL (preferred) or DATABASE_URL — a read-only role.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runGoldenVerification, formatGoldenCsv } from "../../server/lib/golden-verification";

const OUT_CSV = join(process.cwd(), "qa/reports/golden-vs-prod.csv");

async function main() {
  const result = await runGoldenVerification();
  if (result.skipped) {
    console.error(`verify:golden — skipped: ${result.skipReason}`);
    process.exit(1);
  }

  mkdirSync(join(process.cwd(), "qa/reports"), { recursive: true });
  writeFileSync(OUT_CSV, formatGoldenCsv(result.rows));

  console.log(`✓ wrote ${OUT_CSV}  (${result.rows.length} diff rows)`);
  console.log(result.summaryLines.join("\n"));
  console.log(
    `\nGolden drift: ${result.driftCount} ` +
      `(mismatch=${result.counts.mismatch} orphFix=${result.counts.orphanFix} ` +
      `orphProd=${result.counts.orphanProd} missing=${result.counts.missing})`,
  );
}

main().catch((e) => {
  console.error("verify:golden failed:", e);
  process.exit(1);
});
