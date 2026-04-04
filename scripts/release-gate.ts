#!/usr/bin/env npx tsx
/**
 * Release Gate — Pre-cutover validation that produces a GO / NO-GO verdict.
 *
 * Wraps the reconciliation pack with:
 *   1. Pre-flight connectivity check (fails fast if DB unreachable)
 *   2. Timestamped JSON + text report saved to disk
 *   3. Clear GO / NO-GO terminal output for operators
 *   4. Top broken entities summary for triage
 *
 * Usage:
 *   npx tsx scripts/release-gate.ts                         # interactive
 *   npx tsx scripts/release-gate.ts --ci                    # CI mode (no color, files only)
 *   npx tsx scripts/release-gate.ts --out-dir ./reports     # custom output directory
 *
 * Exit codes:
 *   0 — GO   (all HARD_FAIL checks pass; warnings tolerated)
 *   1 — NO-GO (one or more HARD_FAIL checks failed)
 *   2 — ERROR (runner or connectivity failure)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runReconciliationPack, formatReportText } from "../server/services/reconciliation-pack";
import type { ReconciliationPackReport, ReconciliationCheck } from "../server/services/reconciliation-pack";
import { sql } from "drizzle-orm";
import { db, initializeDatabase } from "../server/db";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const ciMode = args.includes("--ci");
const outDirIdx = args.indexOf("--out-dir");
const outDir = outDirIdx >= 0 ? args[outDirIdx + 1] : "./reports";

// ---------------------------------------------------------------------------
// Pre-flight: DB connectivity
// ---------------------------------------------------------------------------
async function checkDbConnectivity(): Promise<boolean> {
  try {
    await db.execute(sql.raw("SELECT 1 AS ok"));
    return true;
  } catch (err) {
    console.error(
      "PRE-FLIGHT FAILED: Cannot reach database.",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Top broken entities extractor
// ---------------------------------------------------------------------------
function extractTopBrokenEntities(report: ReconciliationPackReport): string[] {
  const lines: string[] = [];
  const failures = report.checks.filter(c => c.status === "FAIL");

  for (const c of failures) {
    const entry = `[${c.domain}] ${c.name}: delta=${c.delta} — ${c.detail}`;
    lines.push(entry);
    if (c.sampleIds?.length) {
      lines.push(`  sample IDs: ${c.sampleIds.join(", ")}`);
    }
  }

  // Also include top warnings by absolute delta
  const warnings = report.checks
    .filter(c => c.status === "WARN" && Math.abs(c.delta) > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10);

  if (warnings.length > 0) {
    lines.push("");
    lines.push("Top warnings by impact:");
    for (const w of warnings) {
      lines.push(`  [${w.domain}] ${w.name}: delta=${w.delta} — ${w.detail}`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Report file writer
// ---------------------------------------------------------------------------
function writeReports(
  report: ReconciliationPackReport,
  topBroken: string[],
  dir: string,
): { jsonPath: string; textPath: string; summaryPath: string } {
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const jsonPath = path.join(dir, `reconciliation-${ts}.json`);
  const textPath = path.join(dir, `reconciliation-${ts}.txt`);
  const summaryPath = path.join(dir, `release-gate-${ts}.summary.txt`);

  // Full JSON
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Full human-readable
  fs.writeFileSync(textPath, formatReportText(report));

  // Release-gate summary (short, suitable for stakeholders)
  const summaryLines = [
    "=" .repeat(60),
    `  RELEASE GATE VERDICT: ${report.overall === "PASS" ? "GO" : "NO-GO"}`,
    "=".repeat(60),
    "",
    `Timestamp:      ${report.timestamp}`,
    `Environment:    ${report.environment}`,
    `Pack version:   ${report.version}`,
    "",
    `Total checks:   ${report.checks.length}`,
    `Hard failures:  ${report.hardFailCount}`,
    `Warnings:       ${report.warningCount}`,
    `Skipped:        ${report.checks.filter(c => c.status === "SKIP").length}`,
    "",
    "--- DOMAIN STATUS ---",
    ...report.domainSummaries.map(
      ds => `  ${ds.domain.padEnd(15)} ${ds.status.padEnd(4)}  (${ds.passed}/${ds.totalChecks} pass${ds.failed > 0 ? `, ${ds.failed} FAIL` : ""}${ds.warned > 0 ? `, ${ds.warned} warn` : ""})`,
    ),
    "",
  ];

  if (topBroken.length > 0) {
    summaryLines.push("--- TOP BROKEN ENTITIES ---");
    summaryLines.push(...topBroken);
    summaryLines.push("");
  }

  // Section: what an operator must do next
  if (report.overall === "PASS") {
    summaryLines.push("--- NEXT STEPS ---");
    summaryLines.push("  All HARD_FAIL checks passed. Safe to proceed with cutover.");
    if (report.warningCount > 0) {
      summaryLines.push(`  ${report.warningCount} warning(s) present — review before proceeding but do not block.`);
    }
    summaryLines.push(`  Full report: ${textPath}`);
    summaryLines.push(`  JSON report: ${jsonPath}`);
  } else {
    summaryLines.push("--- REQUIRED ACTIONS ---");
    const failedChecks = report.checks.filter(c => c.status === "FAIL");
    for (const c of failedChecks) {
      summaryLines.push(`  FIX: ${c.name} (${c.domain}/${c.category})`);
      summaryLines.push(`       ${c.detail}`);
    }
    summaryLines.push("");
    summaryLines.push("  Re-run after fixes: npx tsx scripts/release-gate.ts");
    summaryLines.push(`  Full report: ${textPath}`);
  }

  summaryLines.push("");
  summaryLines.push("=".repeat(60));

  fs.writeFileSync(summaryPath, summaryLines.join("\n"));

  return { jsonPath, textPath, summaryPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const startMs = Date.now();

  // Step 0: Initialize database connection
  console.error("Release gate: initializing database...");
  try {
    await initializeDatabase();
  } catch (err) {
    console.error("Database initialization failed:", err instanceof Error ? err.message : String(err));
    console.error(
      "\nRelease gate cannot proceed without database access.\n" +
      "Ensure DATABASE_URL is set and the database is reachable.\n" +
      "See docs/cutover-runbook.md for setup instructions.",
    );
    process.exit(2);
  }

  // Step 1: Pre-flight
  console.error("Release gate: checking database connectivity...");
  const dbOk = await checkDbConnectivity();
  if (!dbOk) {
    console.error(
      "\nRelease gate cannot proceed without database access.\n" +
      "Ensure DATABASE_URL is set and the database is reachable.\n" +
      "See docs/cutover-runbook.md for setup instructions.",
    );
    process.exit(2);
  }
  console.error("Release gate: database OK. Running reconciliation pack...\n");

  // Step 2: Run reconciliation pack
  let report: ReconciliationPackReport;
  try {
    report = await runReconciliationPack();
  } catch (err) {
    console.error("Reconciliation pack error:", err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);

  // Step 3: Extract top broken entities
  const topBroken = extractTopBrokenEntities(report);

  // Step 4: Write reports to disk
  const paths = writeReports(report, topBroken, outDir);

  // Step 5: Terminal output
  const verdict = report.overall === "PASS" ? "GO" : "NO-GO";

  if (ciMode) {
    // CI mode: JSON to stdout only
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    // Interactive: summary to stderr
    console.error(formatReportText(report));
    console.error("");
  }

  console.error(`\n${"=".repeat(60)}`);
  console.error(`  RELEASE GATE VERDICT: ${verdict}  (${elapsedSec}s)`);
  console.error(`  Hard failures: ${report.hardFailCount}  |  Warnings: ${report.warningCount}  |  Checks: ${report.checks.length}`);
  console.error(`${"=".repeat(60)}`);
  console.error(`  JSON:    ${paths.jsonPath}`);
  console.error(`  Text:    ${paths.textPath}`);
  console.error(`  Summary: ${paths.summaryPath}`);
  console.error(`${"=".repeat(60)}\n`);

  process.exit(report.overall === "PASS" ? 0 : 1);
}

main();
