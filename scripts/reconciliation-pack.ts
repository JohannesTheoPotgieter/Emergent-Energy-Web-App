#!/usr/bin/env npx tsx
/**
 * Reconciliation Pack CLI Runner
 *
 * Runs all reconciliation checks and outputs:
 *   - JSON report to stdout (pipe to file for CI)
 *   - Human-readable summary to stderr
 *
 * Usage:
 *   npx tsx scripts/reconciliation-pack.ts                    # both outputs
 *   npx tsx scripts/reconciliation-pack.ts --json             # JSON only (stdout)
 *   npx tsx scripts/reconciliation-pack.ts --text             # text only (stdout)
 *   npx tsx scripts/reconciliation-pack.ts --out report.json  # save JSON to file
 *
 * Exit codes:
 *   0 — all checks passed (warnings OK)
 *   1 — one or more HARD_FAIL checks
 *   2 — runner error
 */

import { runReconciliationPack, formatReportText } from "../server/services/reconciliation-pack";

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const textOnly = args.includes("--text");
  const outIndex = args.indexOf("--out");
  const outFile = outIndex >= 0 ? args[outIndex + 1] : null;

  try {
    const report = await runReconciliationPack();

    if (jsonOnly) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else if (textOnly) {
      process.stdout.write(formatReportText(report) + "\n");
    } else {
      // Default: text to stderr, JSON to stdout
      process.stderr.write(formatReportText(report) + "\n");
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    }

    if (outFile) {
      const fs = await import("node:fs");
      fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
      process.stderr.write(`\nJSON report saved to ${outFile}\n`);
    }

    process.exit(report.overall === "PASS" ? 0 : 1);
  } catch (err) {
    console.error("Reconciliation pack runner error:", err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

main();
