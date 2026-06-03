/**
 * FYE Tracking ↔ Excel reconciliation CLI.
 *
 * Recomputes the FYE Tracking tab from the raw imported tracker lines (the
 * same code path the UI uses) and diffs the headline figures against the
 * "FY26 Project Tracking (EE - from trackers)" workbook baseline.
 *
 * Run against a database that holds the snapshot you are reconciling:
 *
 *   DATABASE_URL=postgres://… npx tsx qa/reconcile-fye-vs-excel.ts [fy] [asAtISO]
 *
 * Defaults: fy=2026, asAt=2026-06-03. Exits 0 if every figure is within
 * tolerance ("within rounding"), 1 otherwise. The figures move with the data —
 * this recomputes from the lines, it does not read a cached total.
 */

import { buildFyeTracking } from "../server/lib/finance/fye-tracking/service";
import { extractReconMetrics, FY26_EXCEL_BASELINE } from "../server/lib/finance/fye-tracking/recon";

const fy = Number.parseInt(process.argv[2] ?? "2026", 10) || 2026;
const asAt = process.argv[3] ?? "2026-06-03";

const rand = (n: number) => `R${Math.round(n).toLocaleString()}`;
function line(label: string, actual: number, expected: number): boolean {
  const tol = Math.max(1, Math.abs(expected) * 0.0005);
  const delta = actual - expected;
  const ok = Math.abs(delta) <= tol;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label.padEnd(26)} got ${rand(actual).padStart(16)}  exp ${rand(expected).padStart(16)}  Δ ${rand(delta).padStart(12)}`,
  );
  return ok;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("✖ DATABASE_URL is not set. Point this at the DB holding the snapshot to reconcile.");
    process.exit(2);
  }
  const result = await buildFyeTracking(fy, {}, new Date(`${asAt}T12:00:00Z`));
  const m = extractReconMetrics(result, `${fy}-05`);
  const base = FY26_EXCEL_BASELINE;
  let ok = true;

  console.log(`\nFYE Tracking reconciliation — FY${String(fy).slice(-2)} as at ${asAt}`);
  console.log(`Last import: ${result.asAt.sourceFileName ?? "(unknown)"}  committed ${result.asAt.committedAt ?? "—"}\n`);

  console.log("State totals (FY, after exclusions):");
  for (const s of ["realised", "committed", "planned", "unrealised", "budget"] as const) {
    ok = line(`${s} revenue`, m.states[s].revenue, base.states[s].revenue) && ok;
    ok = line(`${s} cos`, m.states[s].cos, base.states[s].cos) && ok;
  }

  console.log("\nYTD Realised (through last closed month):");
  ok = line("revenue", m.ytdRealised.revenue, base.ytdRealised.revenue) && ok;
  ok = line("cos", m.ytdRealised.cos, base.ytdRealised.cos) && ok;
  ok = line("gp", m.ytdRealised.gp, base.ytdRealised.gp) && ok;
  console.log(
    `    margin: got ${((m.ytdRealised.marginPct ?? 0) * 100).toFixed(1)}%  exp ${(base.ytdRealised.marginPct * 100).toFixed(1)}%`,
  );

  console.log(`\n${fy}-05 Realised:`);
  ok = line("revenue", m.monthRealised.revenue, base.mayRealised.revenue) && ok;
  ok = line("cos", m.monthRealised.cos, base.mayRealised.cos) && ok;

  console.log("\nStructure:");
  const countOk = m.projectCount === base.projectCount;
  ok = countOk && ok;
  console.log(`  ${countOk ? "✓" : "✗"} project count            got ${m.projectCount}  exp ${base.projectCount}`);
  const dedupOk = m.supersparDespatchDuplicateCount === 0 && m.supersparLiveCount >= 1;
  ok = dedupOk && ok;
  console.log(`  ${dedupOk ? "✓" : "✗"} Superspar de-dup         live=${m.supersparLiveCount} despatchDup=${m.supersparDespatchDuplicateCount}`);
  console.log(`  • excluded trackers (${m.excluded.length}): ${m.excluded.join(", ") || "—"}`);
  console.log(`  • amber COS-no-revenue (${m.amberProjects.length}): ${m.amberProjects.join(", ") || "—"}`);
  console.log(`  • non-standard template (${m.nonStandardProjects.length}): ${m.nonStandardProjects.join(", ") || "—"}`);

  console.log(`\n${ok ? "✓ RECONCILED — all figures within rounding." : "✗ DELTAS FOUND — see ✗ rows above."}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("Reconciliation failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
