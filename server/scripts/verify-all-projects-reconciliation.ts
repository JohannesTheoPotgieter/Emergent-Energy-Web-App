#!/usr/bin/env tsx
/**
 * verify-all-projects-reconciliation.ts — READ-ONLY finance reconciliation proof.
 *
 * Writes NO finance data and changes NO calculation. It re-uses the canonical
 * read paths to PROVE three things on the live snapshot, for owner review:
 *
 *   1. app == tracker (per project × fiscal period). For every ACTIVE project,
 *      the app's § 3.3 revenue formula ties to the project's pasted tracker
 *      cross-check (Excel col-U) within R1. COS is the shared actuals figure
 *      (the tracker IS the actuals), so GP ties iff revenue ties — the only
 *      divergence axis is the col-U revenue paste. Re-uses
 *      `computeAppVsTrackerStatus` (the same function the reconciliation board
 *      and `financial_reconciliation` are built on) — no new maths.
 *
 *   2. the period lock blocks a write into a locked month. Probes the SAME
 *      guard every finance write path calls (`enforceCosPeriodLock`) with a
 *      non-override role against a currently-locked month and asserts it is
 *      BLOCKED. The probe is read-only — it inspects the lock decision, it
 *      never attempts an actual mutation. The pure lock logic is also exercised
 *      (block / override-without-reason / override-with-reason) so the section
 *      is meaningful even when no month is locked yet.
 *
 *   3. tracker == QuickBooks (company-level, the R2 engine). The persisted
 *      `qb_recon_summary` is re-derived from its own `qb_recon_line` rows via
 *      the engine's pure `summarise()` and asserted to tie within R1 — proving
 *      every Rand of the tracker-vs-QB difference is accounted for by
 *      matched + variance + tracker-only + qb-only (the snapshot is internally
 *      consistent, not corrupt).
 *
 * Output: a pass/fail console report + qa/reports/reconciliation-verification.csv.
 * Exit code is non-zero when any REQUIRED assertion fails, so it doubles as a
 * gate. The pure evaluators are exported + unit-tested
 * (qa/tests/unit/verify-all-projects-reconciliation.test.ts) so the assertions
 * are verified independently of any database.
 *
 * Usage: tsx server/scripts/verify-all-projects-reconciliation.ts [--dry-run]
 *   --dry-run prints the report but does not write the CSV.
 *   npm run verify:finance
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { and, eq, isNull } from "drizzle-orm";

import { db, initializeDatabase } from "../db";
import { projectInfo } from "@shared/schema/projects";
import { fiscalPeriods, fiscalYears, cosPeriodLocks } from "@shared/schema";
import { qbReconLine, qbReconSummary } from "@shared/schema/qb-recon";
import { FinanceLineLevelRepository } from "../repositories/finance-line-level-repository";
import {
  RECON_R1,
  computeAppVsTrackerStatus,
  type ReconStatus,
} from "../services/reconciliation-service";
import { resolvePeriodIdForDate, type FiscalPeriodRow } from "./backfill-fiscal-period";
import {
  decideCosPeriodLockEnforcement,
  enforceCosPeriodLock,
} from "../lib/finance/period-lock";
import {
  summarise,
  QB_RECON_TOLERANCE,
  type ReconLine,
  type ReconLineStatus,
  type ReconStream,
  type ReconSummaryRow,
} from "../services/qb-tracker-reconcile";

const r2 = (n: number): number => Number(n.toFixed(2));

const toNum = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isoDate = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
};

// ===========================================================================
// 1 — App vs Tracker (per project × fiscal period). PURE.
// ===========================================================================

/** Minimal per-line shape the app-vs-tracker check needs (decoupled from the
 *  repository's FinanceLine so the evaluator is unit-testable with fixtures). */
export interface VerifyFinanceLine {
  lineId: number;
  perLineRevenue: number;
  revenueStored: number | null;
  reconDelta: number | null;
  derivationWarning: string | null;
  actualTotal: number;
  perLineGp: number;
}

export interface AppTrackerCheck {
  /** Σ perLineRevenue (app, all lines). */
  appRevenue: number;
  /** Σ revenueStored (tracker col-U, comparable lines only). */
  trackerRevenue: number;
  /** app − tracker over comparable lines (signed). */
  revenueDelta: number;
  /** Σ |reconDelta| — accumulated paste-vs-formula drift. */
  absDelta: number;
  /** Σ actualTotal — app COS = tracker COS (the actuals ARE the tracker). */
  appCos: number;
  /** Σ perLineGp (app). GP ties iff revenue ties (COS shared). */
  appGp: number;
  /** Lines carrying a col-U cross-check (the comparable set). */
  comparableLines: number;
  status: ReconStatus;
  /** PASS = app ties tracker within R1 (status green). amber/red ⇒ fail. */
  pass: boolean;
  /** unlinked = no allocation to derive against — reported, not a tie failure. */
  warn: boolean;
}

/**
 * PURE: app-vs-tracker tie for one project × period. Wraps the canonical
 * `computeAppVsTrackerStatus` (revenue col-U cross-check) and adds the COS / GP
 * context. Tie ⇔ status "green" (accumulated drift ≤ R1, no structural fault).
 */
export function evaluateAppVsTracker(
  lines: readonly VerifyFinanceLine[],
): AppTrackerCheck {
  const recon = computeAppVsTrackerStatus(
    lines.map((l) => ({
      lineId: l.lineId,
      perLineRevenue: l.perLineRevenue,
      revenueStored: l.revenueStored,
      reconDelta: l.reconDelta,
      derivationWarning: l.derivationWarning,
    })),
  );
  const appCos = r2(lines.reduce((s, l) => s + l.actualTotal, 0));
  const appGp = r2(lines.reduce((s, l) => s + l.perLineGp, 0));
  const comparableLines = lines.filter((l) => l.reconDelta != null).length;
  return {
    appRevenue: recon.appTotal,
    trackerRevenue: recon.trackerTotal,
    revenueDelta: recon.appVsTrackerDelta,
    absDelta: recon.accumulatedAbsDelta,
    appCos,
    appGp,
    comparableLines,
    status: recon.status,
    // green = ties within R1. amber (drift) / red (structural) = fail. unlinked
    // = allocation missing (data readiness) → reported as a warning, not a fail.
    pass: recon.status === "green",
    warn: recon.status === "unlinked",
  };
}

// ===========================================================================
// 2 — Period-lock probe. PURE logic + a read-only live probe in main().
// ===========================================================================

export interface LockLogicProof {
  /** A non-override role is blocked from a locked month. */
  nonOverrideBlocked: boolean;
  /** An override role WITHOUT a reason is still blocked. */
  overrideNoReasonBlocked: boolean;
  /** An override role WITH a reason proceeds (and is audited). */
  overrideWithReasonProceeds: boolean;
  pass: boolean;
}

/**
 * PURE: exercise the period-lock decision in all three states against a
 * synthetic locked month, so the guarantee "a locked month blocks a write" is
 * proven even when the live DB currently has no locked period.
 */
export function proveLockLogic(lockedMonth = "2099-01-01"): LockLogicProof {
  const nonOverride = decideCosPeriodLockEnforcement({
    lockedPeriods: [lockedMonth],
    canOverride: false,
    hasOverrideReason: false,
  });
  const overrideNoReason = decideCosPeriodLockEnforcement({
    lockedPeriods: [lockedMonth],
    canOverride: true,
    hasOverrideReason: false,
  });
  const overrideWithReason = decideCosPeriodLockEnforcement({
    lockedPeriods: [lockedMonth],
    canOverride: true,
    hasOverrideReason: true,
  });
  const nonOverrideBlocked = nonOverride.blocked === true;
  const overrideNoReasonBlocked = overrideNoReason.blocked === true;
  const overrideWithReasonProceeds = overrideWithReason.blocked === false;
  return {
    nonOverrideBlocked,
    overrideNoReasonBlocked,
    overrideWithReasonProceeds,
    pass: nonOverrideBlocked && overrideNoReasonBlocked && overrideWithReasonProceeds,
  };
}

// ===========================================================================
// 3 — Company-level tracker vs QuickBooks (R2). PURE.
// ===========================================================================

export interface CompanyPeriodCheck {
  periodKey: string;
  stream: ReconStream;
  trackerTotal: number;
  qbTotal: number;
  matched: number;
  variance: number;
  trackerOnly: number;
  qbOnly: number;
  /** tracker − qb (the difference the composition must account for). */
  difference: number;
  /** Largest stored-vs-recomputed field gap (0 ⇒ snapshot perfectly consistent). */
  worstFieldGap: number;
  /** PASS = stored summary ties to a re-summarise of its own lines within R1. */
  pass: boolean;
}

const keyOf = (periodKey: string, stream: string): string => `${periodKey}|${stream}`;

/**
 * PURE: tie the persisted month summary to a re-`summarise()` of the persisted
 * lines. Equal (within tolerance) ⇒ the snapshot reconciles: matched + variance
 * + tracker-only + qb-only account for the whole tracker-vs-QB difference.
 */
export function reconcileCompanySnapshot(
  storedSummaries: readonly ReconSummaryRow[],
  recomputedFromLines: readonly ReconSummaryRow[],
  tolerance: number = QB_RECON_TOLERANCE,
): { rows: CompanyPeriodCheck[]; allPass: boolean } {
  const recomputedByKey = new Map<string, ReconSummaryRow>();
  for (const r of recomputedFromLines) recomputedByKey.set(keyOf(r.periodKey, r.stream), r);
  const storedByKey = new Map<string, ReconSummaryRow>();
  for (const s of storedSummaries) storedByKey.set(keyOf(s.periodKey, s.stream), s);

  const allKeys = new Set<string>([...storedByKey.keys(), ...recomputedByKey.keys()]);
  const rows: CompanyPeriodCheck[] = [];
  for (const k of allKeys) {
    const stored = storedByKey.get(k);
    const recomputed = recomputedByKey.get(k);
    const base = stored ?? recomputed!;
    const gaps = [
      Math.abs((stored?.trackerTotal ?? 0) - (recomputed?.trackerTotal ?? 0)),
      Math.abs((stored?.qbTotal ?? 0) - (recomputed?.qbTotal ?? 0)),
      Math.abs((stored?.matchedTotal ?? 0) - (recomputed?.matchedTotal ?? 0)),
      Math.abs((stored?.varianceTotal ?? 0) - (recomputed?.varianceTotal ?? 0)),
      Math.abs((stored?.trackerOnlyTotal ?? 0) - (recomputed?.trackerOnlyTotal ?? 0)),
      Math.abs((stored?.qbOnlyTotal ?? 0) - (recomputed?.qbOnlyTotal ?? 0)),
    ];
    const worstFieldGap = r2(Math.max(...gaps));
    // A key present on only one side is an inconsistency (gap = the side's total).
    const present = stored != null && recomputed != null;
    rows.push({
      periodKey: base.periodKey,
      stream: base.stream,
      trackerTotal: r2(base.trackerTotal),
      qbTotal: r2(base.qbTotal),
      matched: r2(base.matchedTotal),
      variance: r2(base.varianceTotal),
      trackerOnly: r2(base.trackerOnlyTotal),
      qbOnly: r2(base.qbOnlyTotal),
      difference: r2(base.trackerTotal - base.qbTotal),
      worstFieldGap,
      pass: present && worstFieldGap <= tolerance,
    });
  }
  rows.sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.stream.localeCompare(b.stream));
  return { rows, allPass: rows.every((r) => r.pass) };
}

// ===========================================================================
// CSV
// ===========================================================================

const csvEsc = (v: string | number | boolean): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export interface ProjectPeriodRow extends AppTrackerCheck {
  projectId: number;
  projectName: string;
  fiscalPeriodLabel: string;
}

const CSV_HEADER =
  "scope,project_id,project_name,period,stream,status,result," +
  "app_revenue,tracker_revenue,revenue_delta,abs_delta,app_cos,app_gp,comparable_lines," +
  "qb_tracker_total,qb_total,qb_matched,qb_variance,qb_tracker_only,qb_qb_only,qb_difference,qb_worst_gap,note";

/** Pure CSV serialiser — one wide sheet covering all three verification scopes. */
export function formatVerificationCsv(
  projectRows: readonly ProjectPeriodRow[],
  companyRows: readonly CompanyPeriodCheck[],
  lock: { live: "blocked" | "no_locked_period" | "not_blocked"; logic: LockLogicProof; probedPeriod: string | null },
): string {
  const out: string[] = [CSV_HEADER];
  const blank = "";

  for (const r of projectRows) {
    const result = r.pass ? "PASS" : r.warn ? "WARN" : "FAIL";
    out.push(
      [
        "project_period",
        r.projectId,
        csvEsc(r.projectName),
        csvEsc(r.fiscalPeriodLabel),
        blank,
        r.status,
        result,
        r.appRevenue.toFixed(2),
        r.trackerRevenue.toFixed(2),
        r.revenueDelta.toFixed(2),
        r.absDelta.toFixed(2),
        r.appCos.toFixed(2),
        r.appGp.toFixed(2),
        r.comparableLines,
        blank, blank, blank, blank, blank, blank, blank, blank,
        csvEsc("app vs tracker (col-U revenue; COS shared, so GP ties iff revenue ties)"),
      ].join(","),
    );
  }

  for (const c of companyRows) {
    out.push(
      [
        "company_period",
        blank,
        blank,
        csvEsc(c.periodKey),
        c.stream,
        blank,
        c.pass ? "PASS" : "FAIL",
        blank, blank, blank, blank, blank, blank, blank,
        c.trackerTotal.toFixed(2),
        c.qbTotal.toFixed(2),
        c.matched.toFixed(2),
        c.variance.toFixed(2),
        c.trackerOnly.toFixed(2),
        c.qbOnly.toFixed(2),
        c.difference.toFixed(2),
        c.worstFieldGap.toFixed(2),
        csvEsc("tracker vs QuickBooks (R2): stored summary re-tied to its own lines"),
      ].join(","),
    );
  }

  const lockResult = lock.live === "blocked" || lock.live === "no_locked_period" ? "PASS" : "FAIL";
  out.push(
    [
      "period_lock",
      blank, blank,
      csvEsc(lock.probedPeriod ?? "(none locked)"),
      blank, blank,
      lock.logic.pass && lockResult === "PASS" ? "PASS" : "FAIL",
      blank, blank, blank, blank, blank, blank, blank,
      blank, blank, blank, blank, blank, blank, blank, blank,
      csvEsc(
        `live=${lock.live}; logic(nonOverrideBlocked=${lock.logic.nonOverrideBlocked}, ` +
          `overrideNoReasonBlocked=${lock.logic.overrideNoReasonBlocked}, ` +
          `overrideWithReasonProceeds=${lock.logic.overrideWithReasonProceeds})`,
      ),
    ].join(","),
  );

  return out.join("\n") + "\n";
}

// ===========================================================================
// main — wiring (read-only DB access)
// ===========================================================================

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    `verify:finance — READ-ONLY reconciliation proof (R1 = R${RECON_R1})${dryRun ? " · DRY RUN (no CSV)" : ""}\n`,
  );

  await initializeDatabase();

  // ---- Fiscal calendar (labels + period bucketing) ----
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
      : ((await db.select({ id: fiscalYears.id, name: fiscalYears.name }).from(fiscalYears)) as Array<{
          id: number;
          name: string;
        }>);
  const yearNameById = new Map(yearRows.map((y) => [y.id, y.name]));
  const periodLabelById = new Map<number, string>();
  for (const p of periodRows) {
    periodLabelById.set(p.id, `${yearNameById.get(p.fiscalYearId) ?? "FY?"} · ${p.periodName}`);
  }

  // ---- 1) app == tracker (per active project × period) ----
  const projects = (await db
    .select({ id: projectInfo.id, projectName: projectInfo.projectName })
    .from(projectInfo)
    .where(isNull(projectInfo.deletedAt))) as Array<{ id: number; projectName: string | null }>;

  const repo = new FinanceLineLevelRepository(db);
  const projectRows: ProjectPeriodRow[] = [];
  for (const proj of projects) {
    const lines = await repo.getProjectFinanceLines(proj.id);
    const byPeriod = new Map<number, VerifyFinanceLine[]>();
    for (const l of lines) {
      const periodId = resolvePeriodIdForDate(l.invoiceRaisedDate, periodRows);
      if (periodId == null) continue; // no recognition date / calendar → not period-bucketed
      const arr = byPeriod.get(periodId) ?? [];
      arr.push({
        lineId: l.lineId,
        perLineRevenue: l.perLineRevenue,
        revenueStored: l.revenueStored,
        reconDelta: l.reconDelta,
        derivationWarning: l.derivationWarning,
        actualTotal: l.actualTotal,
        perLineGp: l.perLineGp,
      });
      byPeriod.set(periodId, arr);
    }
    for (const [periodId, periodLines] of byPeriod) {
      const check = evaluateAppVsTracker(periodLines);
      projectRows.push({
        ...check,
        projectId: proj.id,
        projectName: proj.projectName ?? `project ${proj.id}`,
        fiscalPeriodLabel: periodLabelById.get(periodId) ?? `period ${periodId}`,
      });
    }
  }
  projectRows.sort(
    (a, b) => a.projectId - b.projectId || a.fiscalPeriodLabel.localeCompare(b.fiscalPeriodLabel),
  );

  // ---- 2) period lock blocks a write into a locked month ----
  const logic = proveLockLogic();
  const activeLocks = (await db
    .select({ periodMonth: cosPeriodLocks.periodMonth })
    .from(cosPeriodLocks)
    .where(isNull(cosPeriodLocks.unlockedAt))) as Array<{ periodMonth: unknown }>;
  const lockedMonths = activeLocks
    .map((r) => isoDate(r.periodMonth))
    .filter((d): d is string => d != null)
    .sort();
  const probedPeriod = lockedMonths.length > 0 ? lockedMonths[lockedMonths.length - 1] : null;
  let live: "blocked" | "no_locked_period" | "not_blocked";
  if (probedPeriod == null) {
    live = "no_locked_period";
  } else {
    // Probe the SAME guard finance write paths call. "PM" is not an override
    // role, so a locked month must block. Read-only — inspects the decision.
    const enforcement = await enforceCosPeriodLock({ effectiveDates: [probedPeriod], role: "PM" });
    live = enforcement.blocked ? "blocked" : "not_blocked";
  }

  // ---- 3) tracker == QuickBooks (company-level R2) ----
  const lineRows = (await db
    .select()
    .from(qbReconLine)
    .where(isNull(qbReconLine.effectiveTo))) as Array<typeof qbReconLine.$inferSelect>;
  const reconLines: ReconLine[] = lineRows.map((r) => ({
    stream: r.stream as ReconStream,
    invoiceNoRaw: r.invoiceNoRaw ?? "",
    invoiceNoNorm: r.invoiceNoNorm,
    trackerAmountExVat: r.trackerAmountExVat != null ? toNum(r.trackerAmountExVat) : null,
    qbAmountExVat: r.qbAmountExVat != null ? toNum(r.qbAmountExVat) : null,
    delta: r.delta != null ? toNum(r.delta) : null,
    status: r.status as ReconLineStatus,
    trackerDate: isoDate(r.trackerDate),
    qbDate: isoDate(r.qbDate),
    fiscalPeriodId: r.fiscalPeriodId,
    timingFlag: r.timingFlag,
  }));
  const recomputed = summarise(reconLines, "month");
  const summaryRows = (await db
    .select()
    .from(qbReconSummary)
    .where(and(eq(qbReconSummary.periodGrain, "month"), isNull(qbReconSummary.effectiveTo)))) as Array<
    typeof qbReconSummary.$inferSelect
  >;
  const storedSummaries: ReconSummaryRow[] = summaryRows.map((r) => ({
    grain: "month",
    periodKey: r.periodKey,
    fiscalPeriodId: r.fiscalPeriodId,
    stream: r.stream as ReconStream,
    trackerTotal: toNum(r.trackerTotal),
    qbTotal: toNum(r.qbTotal),
    matchedTotal: toNum(r.matchedTotal),
    varianceTotal: toNum(r.varianceTotal),
    trackerOnlyTotal: toNum(r.trackerOnlyTotal),
    qbOnlyTotal: toNum(r.qbOnlyTotal),
  }));
  const company = reconcileCompanySnapshot(storedSummaries, recomputed);

  // ---- Report ----
  const projPass = projectRows.filter((r) => r.pass).length;
  const projWarn = projectRows.filter((r) => r.warn).length;
  const projFail = projectRows.filter((r) => !r.pass && !r.warn).length;
  const lockPass = (live === "blocked" || live === "no_locked_period") && logic.pass;

  console.log("1) app == tracker (per project × fiscal period)");
  console.log("   ────────────────────────────────────────────");
  console.log(`   project×period checks : ${projectRows.length}`);
  console.log(`   PASS (ties ≤ R1)      : ${projPass}`);
  console.log(`   WARN (unlinked)       : ${projWarn}`);
  console.log(`   FAIL (drift/structural): ${projFail}`);
  for (const r of projectRows.filter((x) => !x.pass && !x.warn)) {
    console.log(
      `     ✗ [${r.status}] ${r.projectName} · ${r.fiscalPeriodLabel}: revΔ=R${r.revenueDelta.toFixed(2)} |Δ|=R${r.absDelta.toFixed(2)}`,
    );
  }

  console.log("\n2) period lock blocks a write into a locked month");
  console.log("   ────────────────────────────────────────────");
  console.log(
    `   live probe            : ${live}${probedPeriod ? ` (${probedPeriod}, role PM)` : ""}`,
  );
  console.log(
    `   lock logic            : nonOverride=${logic.nonOverrideBlocked ? "blocked" : "OPEN"}, ` +
      `override-no-reason=${logic.overrideNoReasonBlocked ? "blocked" : "OPEN"}, ` +
      `override+reason=${logic.overrideWithReasonProceeds ? "proceeds" : "BLOCKED"}`,
  );
  console.log(`   result                : ${lockPass ? "PASS" : "FAIL"}`);

  console.log("\n3) tracker == QuickBooks (company-level, R2 engine)");
  console.log("   ────────────────────────────────────────────");
  console.log(`   month×stream summaries: ${company.rows.length}`);
  console.log(`   reconciles (≤ R${QB_RECON_TOLERANCE})    : ${company.rows.filter((r) => r.pass).length}`);
  for (const c of company.rows.filter((r) => !r.pass)) {
    console.log(
      `     ✗ ${c.periodKey} ${c.stream}: tracker=R${c.trackerTotal.toFixed(2)} qb=R${c.qbTotal.toFixed(2)} worstGap=R${c.worstFieldGap.toFixed(2)}`,
    );
  }

  const overallPass = projFail === 0 && lockPass && company.allPass;
  console.log(`\nOVERALL: ${overallPass ? "PASS ✓" : "FAIL ✗"}\n`);

  if (!dryRun) {
    const reportDir = path.join(process.cwd(), "qa", "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const csvPath = path.join(reportDir, "reconciliation-verification.csv");
    fs.writeFileSync(
      csvPath,
      formatVerificationCsv(projectRows, company.rows, { live, logic, probedPeriod }),
      "utf8",
    );
    console.log(`Wrote ${csvPath}`);
  }

  return overallPass ? 0 : 1;
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("[verify:finance] FAILED:", err);
      process.exit(1);
    });
}
