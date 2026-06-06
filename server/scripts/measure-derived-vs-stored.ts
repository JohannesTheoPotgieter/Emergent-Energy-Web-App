#!/usr/bin/env tsx
/**
 * measure-derived-vs-stored.ts — READ-ONLY exposure / reconciliation analysis.
 * Writes NO data and changes NO behaviour. Quantifies how far the pasted Excel
 * col-U value (revenue_recognition_amount) sits from the owner-canonical revenue
 * formula (AGENT_GUARDRAILS § 3.3).
 *
 * As of the P2.1b cutover the app REPORTS the formula
 * (finance-line-level-repository.ts: perLineRevenue is always (Q/X)×J), and col
 * U is kept only as a cross-check (`revenueStored`). So this report now serves
 * two equivalent purposes: (a) the historical record of what the cutover moved,
 * and (b) the ongoing reconciliation feed — which lines still carry a col-U
 * paste that disagrees with the reported formula.
 *
 * For each LIVE actuals row (effective_to IS NULL), two per-line revenues, both
 * read from the § 3.3.2 single read path:
 *   - DERIVED  — perLineRevenue, the canonical (Q/X)×J formula the app now
 *     reports. No parent synthesis — scope is real actuals rows.
 *   - REPORTED — the PRE-cutover figure: the col-U preference, reconstructed as
 *     `revenueStored ?? perLineRevenue` (the app used to report the pasted col U
 *     when present, else the formula). For a line with no col U, reported ==
 *     derived → no change.
 *
 * `revenue_delta = derived − reported`. For a line with a col-U paste this is
 * `perLineRevenue − revenueStored` (= −reconDelta); for a line without one it is
 * 0. Per-line GP = revenue − actual_total; COS is identical under both scenarios
 * so ΔGP ≡ Δrevenue (the GP columns equal the revenue deltas by construction).
 *
 * Output: count of lines that changed (|Δ| > R1) and the SUM of revenue and GP
 * that changed, broken down by project and fiscal period (the period containing
 * the line's invoice-raised date — the § 3.3 recognition date). Prints a summary
 * table and writes qa/reports/derived-vs-stored-exposure.csv.
 *
 * Same shape as measure-colour-default.ts (read-only exposure for the owner).
 * The pure summarise/format helpers are exported + unit-tested
 * (qa/tests/unit/measure-derived-vs-stored.test.ts) so the maths are verified
 * independently of any database.
 *
 * Usage: tsx server/scripts/measure-derived-vs-stored.ts [--dry-run]
 *   --dry-run prints the summary but does not write the CSV.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { inArray } from "drizzle-orm";

import { db, initializeDatabase } from "../db";
import { fiscalPeriods, fiscalYears, projectInfo } from "@shared/schema";
import {
  loadProvenanceInputs,
  RECON_DELTA_R1,
} from "../lib/finance/provenance";
import { deriveFinanceLinesFromRows } from "../repositories/finance-line-level-repository";
import {
  resolvePeriodIdForDate,
  type FiscalPeriodRow,
} from "./backfill-fiscal-period";

/** One scanned actuals line, reduced to the two revenues + cost being compared.
 *  Pure input to `summariseExposure` — no DB types leak in. */
export interface ExposureLine {
  projectId: number;
  /** Human label for the fiscal period (or month-key / "(unrecognised)"). */
  fiscalPeriod: string;
  /** Stable sort key for the period (start date or "YYYY-MM-01"). */
  fiscalSortKey: string;
  /** Per-line revenue the app reports today (prefers persisted col U). */
  reportedRevenue: number;
  /** Per-line revenue under the strict § 3.3 formula (revenue_derived). */
  derivedRevenue: number;
  /** Per-line COS (actual_total) — identical under both scenarios. */
  cost: number;
}

export interface ExposureBucket {
  projectId: number;
  fiscalPeriod: string;
  sortKey: string;
  linesTotal: number;
  linesChanged: number;
  revenueReported: number;
  revenueDerived: number;
  gpReported: number;
  gpDerived: number;
}

export interface ExposureTotals {
  linesTotal: number;
  linesChanged: number;
  revenueReported: number;
  revenueDerived: number;
  gpReported: number;
  gpDerived: number;
}

const r2 = (n: number): number => Number(n.toFixed(2));

/**
 * Pure aggregation — fold scanned lines into (project × fiscal period) buckets
 * plus a grand total. A line "would change" when |derived − reported| exceeds
 * `threshold` (R1). Delta sums are taken over ALL lines (the true total shift if
 * reporting switched to the formula); the changed-count is the material subset.
 */
export function summariseExposure(
  lines: readonly ExposureLine[],
  threshold: number = RECON_DELTA_R1,
): { buckets: ExposureBucket[]; totals: ExposureTotals } {
  const byKey = new Map<string, ExposureBucket>();
  const totals: ExposureTotals = {
    linesTotal: 0,
    linesChanged: 0,
    revenueReported: 0,
    revenueDerived: 0,
    gpReported: 0,
    gpDerived: 0,
  };

  for (const l of lines) {
    const changed = Math.abs(l.derivedRevenue - l.reportedRevenue) > threshold;
    const gpReported = l.reportedRevenue - l.cost;
    const gpDerived = l.derivedRevenue - l.cost;

    const key = `${l.projectId}::${l.fiscalPeriod}`;
    const b =
      byKey.get(key) ??
      {
        projectId: l.projectId,
        fiscalPeriod: l.fiscalPeriod,
        sortKey: l.fiscalSortKey,
        linesTotal: 0,
        linesChanged: 0,
        revenueReported: 0,
        revenueDerived: 0,
        gpReported: 0,
        gpDerived: 0,
      };
    b.linesTotal += 1;
    if (changed) b.linesChanged += 1;
    b.revenueReported += l.reportedRevenue;
    b.revenueDerived += l.derivedRevenue;
    b.gpReported += gpReported;
    b.gpDerived += gpDerived;
    byKey.set(key, b);

    totals.linesTotal += 1;
    if (changed) totals.linesChanged += 1;
    totals.revenueReported += l.reportedRevenue;
    totals.revenueDerived += l.derivedRevenue;
    totals.gpReported += gpReported;
    totals.gpDerived += gpDerived;
  }

  const buckets = [...byKey.values()].sort(
    (a, b) => a.projectId - b.projectId || a.sortKey.localeCompare(b.sortKey),
  );
  return { buckets, totals };
}

const csvEsc = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Pure CSV serialiser for the exposure report. */
export function formatExposureCsv(
  buckets: readonly ExposureBucket[],
  totals: ExposureTotals,
  projectName: ReadonlyMap<number, string>,
): string {
  const out: string[] = [
    "project_id,project_name,fiscal_period,lines_total,lines_changed," +
      "revenue_reported,revenue_derived,revenue_delta,gp_reported,gp_derived,gp_delta",
  ];
  for (const r of buckets) {
    out.push(
      [
        r.projectId,
        csvEsc(projectName.get(r.projectId) ?? ""),
        csvEsc(r.fiscalPeriod),
        r.linesTotal,
        r.linesChanged,
        r2(r.revenueReported).toFixed(2),
        r2(r.revenueDerived).toFixed(2),
        r2(r.revenueDerived - r.revenueReported).toFixed(2),
        r2(r.gpReported).toFixed(2),
        r2(r.gpDerived).toFixed(2),
        r2(r.gpDerived - r.gpReported).toFixed(2),
      ].join(","),
    );
  }
  out.push(
    [
      "TOTAL",
      "",
      "all",
      totals.linesTotal,
      totals.linesChanged,
      r2(totals.revenueReported).toFixed(2),
      r2(totals.revenueDerived).toFixed(2),
      r2(totals.revenueDerived - totals.revenueReported).toFixed(2),
      r2(totals.gpReported).toFixed(2),
      r2(totals.gpDerived).toFixed(2),
      r2(totals.gpDerived - totals.gpReported).toFixed(2),
    ].join(","),
  );
  return out.join("\n") + "\n";
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    `Measure derived-vs-stored exposure — READ ONLY${dryRun ? " · DRY RUN (no CSV)" : ""}\n`,
  );

  await initializeDatabase();

  // Live, snapshot-guarded inputs for every project (null = all projects).
  const { actualsRows, parentRows, allocationRows } = await loadProvenanceInputs(db, null);

  // Single read path (§ 3.3.2). Each line now carries BOTH the canonical
  // formula it reports (perLineRevenue) AND the pasted col-U cross-check
  // (revenueStored), so we read both from one place — no separate derivation.
  const reportedLines = deriveFinanceLinesFromRows(actualsRows, parentRows, allocationRows);
  const reportedById = new Map(reportedLines.map((l) => [l.lineId, l]));

  // Fiscal calendar (optional). When seeded, the line's invoice-raised date maps
  // to exactly one period; otherwise we fall back to the YYYY-MM month key.
  const periodRows = (await db
    .select({
      id: fiscalPeriods.id,
      fiscalYearId: fiscalPeriods.fiscalYearId,
      periodName: fiscalPeriods.periodName,
      startDate: fiscalPeriods.startDate,
      endDate: fiscalPeriods.endDate,
    })
    .from(fiscalPeriods)) as Array<FiscalPeriodRow & { fiscalYearId: number; periodName: string }>;
  const yearRows =
    periodRows.length === 0
      ? []
      : ((await db
          .select({ id: fiscalYears.id, name: fiscalYears.name })
          .from(fiscalYears)) as Array<{ id: number; name: string }>);
  const yearNameById = new Map(yearRows.map((y) => [y.id, y.name]));
  const periodLabelById = new Map<number, { label: string; sortKey: string }>();
  for (const p of periodRows) {
    const yearName = yearNameById.get(p.fiscalYearId) ?? `FY?`;
    periodLabelById.set(p.id, { label: `${yearName} · ${p.periodName}`, sortKey: p.startDate });
  }

  const resolveFiscalPeriod = (
    invoiceRaisedDate: string | null,
    recognitionMonth: string | null,
  ): { label: string; sortKey: string } => {
    if (invoiceRaisedDate && periodRows.length > 0) {
      const pid = resolvePeriodIdForDate(invoiceRaisedDate, periodRows);
      const hit = pid != null ? periodLabelById.get(pid) : null;
      if (hit) return hit;
    }
    if (recognitionMonth) return { label: recognitionMonth, sortKey: `${recognitionMonth}-01` };
    return { label: "(unrecognised)", sortKey: "9999-99" };
  };

  // Build the pure exposure-line list. derived = the formula the app now
  // reports (perLineRevenue); reported = the PRE-cutover col-U-preferring figure
  // (revenueStored when present, else the formula). The delta is what the
  // cutover moved — and equivalently the col-U-vs-formula reconciliation gap.
  const lines: ExposureLine[] = [];
  for (const a of actualsRows) {
    const line = reportedById.get(a.id);
    if (!line) continue; // window/derivation excluded the row (shouldn't happen — no window)
    const fp = resolveFiscalPeriod(line.invoiceRaisedDate, line.recognitionMonth);
    lines.push({
      projectId: a.projectId,
      fiscalPeriod: fp.label,
      fiscalSortKey: fp.sortKey,
      reportedRevenue: line.revenueStored ?? line.perLineRevenue,
      derivedRevenue: line.perLineRevenue,
      cost: line.actualTotal,
    });
  }

  const { buckets, totals } = summariseExposure(lines);

  // Project names.
  const projectIds = [...new Set(actualsRows.map((a) => a.projectId))];
  const projRows =
    projectIds.length === 0
      ? []
      : ((await db
          .select({ id: projectInfo.id, projectName: projectInfo.projectName })
          .from(projectInfo)
          .where(inArray(projectInfo.id, projectIds))) as Array<{ id: number; projectName: string | null }>);
  const projectName = new Map(projRows.map((p) => [p.id, p.projectName ?? `project ${p.id}`]));

  // ---- Summary table ----
  console.log("Derived-vs-stored exposure (read-only)");
  console.log("──────────────────────────────────────");
  console.log(`Live actuals lines scanned        : ${totals.linesTotal}`);
  console.log(`Lines that WOULD change (|Δ| > R${RECON_DELTA_R1}): ${totals.linesChanged}`);
  console.log(`Revenue reported (prefers col U)  : R ${r2(totals.revenueReported).toFixed(2)}`);
  console.log(`Revenue derived (§ 3.3 formula)   : R ${r2(totals.revenueDerived).toFixed(2)}`);
  console.log(`Revenue Δ (derived − reported)    : R ${r2(totals.revenueDerived - totals.revenueReported).toFixed(2)}`);
  console.log(`GP Δ (derived − reported)         : R ${r2(totals.gpDerived - totals.gpReported).toFixed(2)}\n`);
  console.log("By project × fiscal period:");
  console.log("project_id  fiscal_period          changed/total  revenue_Δ      gp_Δ           project");
  for (const r of buckets) {
    console.log(
      `${String(r.projectId).padStart(10)}  ${r.fiscalPeriod.padEnd(21)}  ` +
        `${String(`${r.linesChanged}/${r.linesTotal}`).padStart(13)}  ` +
        `${r2(r.revenueDerived - r.revenueReported).toFixed(2).padStart(13)}  ` +
        `${r2(r.gpDerived - r.gpReported).toFixed(2).padStart(13)}  ` +
        `${projectName.get(r.projectId) ?? ""}`,
    );
  }

  if (dryRun) {
    console.log("\nDry run — CSV not written.");
    return;
  }

  // ---- CSV ----
  const reportDir = path.join(process.cwd(), "qa", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const csvPath = path.join(reportDir, "derived-vs-stored-exposure.csv");
  fs.writeFileSync(csvPath, formatExposureCsv(buckets, totals, projectName), "utf8");
  console.log(`\nWrote ${csvPath}`);
}

const isDirectRun =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
