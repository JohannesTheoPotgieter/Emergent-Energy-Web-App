// Repository for the Finance / Analysis pages (cashflow & COS).
//
// All snapshot-table reads filter by `effectiveTo IS NULL` to avoid
// double-counting historical snapshots — see the finance-snapshot-queries
// skill in CLAUDE.md.
//
// All db.* calls live here per the route → repository discipline in
// CLAUDE.md. Routes import the named functions below.

import { and, eq, isNull, isNotNull, inArray, gte, lte } from "drizzle-orm";
import { db } from "../db";
import {
  normalizedRevenueLines,
  normalizedCostLines,
  normalizedCostLineActuals,
  paymentTerms,
  counterparties,
  projectPlan,
  cashflowPoints,
  financialIntegrationRules,
  opexBudgetMonthly,
} from "@shared/schema/finance";
import { projectInfo, projectRevenueSummary } from "@shared/schema/projects";
import { diffDays } from "@shared/lib/financeAnalysis";
import { isCanonicalCosRealised } from "../lib/finance/cos-realisation";
import { getFyWindow } from "../lib/fy-window";

const COS_TOLERANCE_RULE_TYPE = "cos_tolerance_band_pct";

export interface OutstandingRevenueRow {
  id: number;
  projectId: number;
  projectName: string;
  customer: string | null;
  amount: number;
  invoiceDate: string | null;
  expectedDate: string | null;
  termsDays: number | null;
  status: string;
  invoiceNumber: string | null;
}

export interface OutstandingCostRow {
  id: number;
  projectId: number;
  projectName: string;
  counterpartyId: number | null;
  counterpartyName: string | null;
  amount: number;
  invoiceDate: string | null;
  expectedDate: string | null;
  termsDays: number | null;
  status: string;
  invoiceNumber: string | null;
}

// Match the enum literal types in shared/schema/finance.ts so Drizzle's
// inArray() inference accepts them without casts.
// 'paid' included: cheque/transfer issued but not yet bank-reconciled
// = real outstanding AR. Excluding it understated outstanding revenue
// by every line in flight between payment-recorded and bank-matched.
// 'in_bank' and 'realised' are settled and correctly excluded.
const REVENUE_OUTSTANDING_STATES: Array<"planned" | "invoiced" | "paid"> = ["planned", "invoiced", "paid"];
const COST_OUTSTANDING_STATES: Array<"planned" | "invoiced" | "approved"> = [
  "planned",
  "invoiced",
  "approved",
];
const COST_INVOICED_OR_PAID: Array<"invoiced" | "approved" | "paid"> = [
  "invoiced",
  "approved",
  "paid",
];

// AR — outstanding revenue lines (anything not yet "paid", "in_bank" or "realised").
export async function listOutstandingRevenueLines(): Promise<OutstandingRevenueRow[]> {
  const projectTermsMap = await loadCustomerTermsByProject();
  type Row = {
    id: number;
    projectId: number;
    projectName: string;
    amount: string | null;
    invoiceDate: string | null;
    expectedDate: string | null;
    adminOverride: string | null;
    status: string;
    invoiceNumber: string | null;
  };
  const rows = (await db
    .select({
      id: normalizedRevenueLines.id,
      projectId: normalizedRevenueLines.projectId,
      projectName: normalizedRevenueLines.projectName,
      amount: normalizedRevenueLines.amountExVat,
      invoiceDate: normalizedRevenueLines.invoiceDate,
      expectedDate: normalizedRevenueLines.expectedPaymentDate,
      adminOverride: normalizedRevenueLines.adminDateOverride,
      status: normalizedRevenueLines.status,
      invoiceNumber: normalizedRevenueLines.invoiceNumber,
    })
    .from(normalizedRevenueLines)
    .where(
      and(
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
        inArray(normalizedRevenueLines.status, REVENUE_OUTSTANDING_STATES),
      ),
    )) as Row[];

  return rows.map((r): OutstandingRevenueRow => ({
    id: r.id,
    projectId: r.projectId,
    projectName: r.projectName,
    customer: null,
    amount: numeric(r.amount),
    invoiceDate: dateToIso(r.invoiceDate),
    expectedDate: dateToIso(r.adminOverride ?? r.expectedDate),
    termsDays: projectTermsMap.get(r.projectId) ?? null,
    status: r.status,
    invoiceNumber: r.invoiceNumber ?? null,
  }));
}

// AP — outstanding cost lines (anything not yet "paid").
export async function listOutstandingCostLines(): Promise<OutstandingCostRow[]> {
  const counterpartyTermsMap = await loadCounterpartyTerms();
  type Row = {
    id: number;
    projectId: number;
    projectName: string;
    counterpartyId: number | null;
    counterpartyName: string | null;
    amount: string | null;
    invoiceDate: string | null;
    forecastDate: string | null;
    adminOverride: string | null;
    status: string;
    invoiceNumber: string | null;
  };
  const rows = (await db
    .select({
      id: normalizedCostLines.id,
      projectId: normalizedCostLines.projectId,
      projectName: normalizedCostLines.projectName,
      counterpartyId: normalizedCostLines.counterpartyId,
      counterpartyName: normalizedCostLines.counterpartyName,
      amount: normalizedCostLines.amountExVat,
      invoiceDate: normalizedCostLines.invoiceDate,
      forecastDate: normalizedCostLines.forecastPaymentDate,
      adminOverride: normalizedCostLines.adminDateOverride,
      status: normalizedCostLines.status,
      invoiceNumber: normalizedCostLines.invoiceNumber,
    })
    .from(normalizedCostLines)
    .where(
      and(
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
        inArray(normalizedCostLines.status, COST_OUTSTANDING_STATES),
      ),
    )) as Row[];

  return rows.map((r): OutstandingCostRow => ({
    id: r.id,
    projectId: r.projectId,
    projectName: r.projectName,
    counterpartyId: r.counterpartyId ?? null,
    counterpartyName: r.counterpartyName ?? null,
    amount: numeric(r.amount),
    invoiceDate: dateToIso(r.invoiceDate),
    expectedDate: dateToIso(r.adminOverride ?? r.forecastDate),
    termsDays: r.counterpartyId != null ? counterpartyTermsMap.get(r.counterpartyId) ?? null : null,
    status: r.status,
    invoiceNumber: r.invoiceNumber ?? null,
  }));
}

// COS Analysis — per-project earned vs invoiced inputs.
// Returns one row per active project with the inputs the route layer
// composes via computeEarnedVsInvoiced().
export interface ProjectCosRow {
  projectId: number;
  projectName: string;
  plannedExpenditure: number;
  pctComplete: number;       // 0..1, weighted by task duration
  invoicedToDate: number;    // sum of cost-line amounts in invoiced/approved/paid states
}

export async function listProjectCosRows(): Promise<ProjectCosRow[]> {
  const projects = (await db
    .select({ id: projectInfo.id, projectName: projectInfo.projectName })
    .from(projectInfo)
    .where(isNull(projectInfo.deletedAt))) as Array<{ id: number; projectName: string }>;

  const planRows = await db
    .select({
      projectId: projectPlan.projectId,
      duration: projectPlan.durationDays,
      pct: projectPlan.actualPctComplete,
    })
    .from(projectPlan);

  const summaries = await db
    .select({
      projectId: projectRevenueSummary.projectId,
      plannedExpenditure: projectRevenueSummary.plannedExpenditure,
    })
    .from(projectRevenueSummary)
    .where(isNull(projectRevenueSummary.effectiveTo));

  // Sum from the child actuals table — each row is one invoiced actual
  // for its parent cost line. Reading parent.amountExVat instead inflated
  // invoicedToDate for split-paid lines (one parent → N actuals): the
  // parent carries the costed total once, while the actuals each carry
  // their per-invoice amount. We want the latter for "actually invoiced
  // to date." Snapshot + soft-delete guarded on both tables to keep this
  // consistent with the rest of the repo.
  const invoicedRows = await db
    .select({
      projectId: normalizedCostLineActuals.projectId,
      amount: normalizedCostLineActuals.actualTotal,
    })
    .from(normalizedCostLineActuals)
    .innerJoin(
      normalizedCostLines,
      eq(normalizedCostLineActuals.costLineId, normalizedCostLines.id),
    )
    .where(
      and(
        isNull(normalizedCostLineActuals.effectiveTo),
        isNull(normalizedCostLineActuals.deletedAt),
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
        isNotNull(normalizedCostLineActuals.invoiceNumber),
      ),
    );

  const planByProject = new Map<number, { dur: number; weighted: number }>();
  for (const p of planRows) {
    if (p.projectId == null) continue;
    const dur = Math.max(0, Number(p.duration ?? 0));
    const pct = clamp01(Number(p.pct ?? 0));
    const acc = planByProject.get(p.projectId) ?? { dur: 0, weighted: 0 };
    acc.dur += dur;
    acc.weighted += dur * pct;
    planByProject.set(p.projectId, acc);
  }

  const summaryByProject = new Map<number, number>();
  for (const s of summaries) {
    summaryByProject.set(s.projectId, numeric(s.plannedExpenditure));
  }

  const invoicedByProject = new Map<number, number>();
  for (const i of invoicedRows) {
    invoicedByProject.set(i.projectId, (invoicedByProject.get(i.projectId) ?? 0) + numeric(i.amount));
  }

  return projects.map((p): ProjectCosRow => {
    const plan = planByProject.get(p.id);
    const pct = plan && plan.dur > 0 ? plan.weighted / plan.dur : 0;
    return {
      projectId: p.id,
      projectName: p.projectName,
      plannedExpenditure: summaryByProject.get(p.id) ?? 0,
      pctComplete: pct,
      invoicedToDate: invoicedByProject.get(p.id) ?? 0,
    };
  });
}

// Per-counterparty COS trend — monthly invoiced totals over the trailing N months.
export interface CounterpartyMonthlyTotal {
  counterpartyId: number | null;
  counterpartyName: string;
  monthKey: string; // YYYY-MM
  amount: number;
}

export async function listCounterpartyMonthlyCos(monthsBack: number): Promise<CounterpartyMonthlyTotal[]> {
  const cutoff = new Date();
  // Set day-of-month to 1 BEFORE subtracting months to avoid month-end overflow
  // (e.g. Mar 31 - 1 month → Apr 3, not Mar 1, if order is reversed).
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - monthsBack);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  // Bucket invoiced amounts by counterparty+month using child actuals
  // (per-invoice grain) and JOIN to parent only for counterparty
  // metadata. Reading parent.amountExVat + parent.invoiceDate double-
  // counted split-paid lines as one big bucket for the parent's date,
  // even when the underlying invoices fell across multiple months.
  const rows = await db
    .select({
      counterpartyId: normalizedCostLines.counterpartyId,
      counterpartyName: normalizedCostLines.counterpartyName,
      invoiceDate: normalizedCostLineActuals.invoiceDate,
      amount: normalizedCostLineActuals.actualTotal,
    })
    .from(normalizedCostLineActuals)
    .innerJoin(
      normalizedCostLines,
      eq(normalizedCostLineActuals.costLineId, normalizedCostLines.id),
    )
    .where(
      and(
        isNull(normalizedCostLineActuals.effectiveTo),
        isNull(normalizedCostLineActuals.deletedAt),
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
        isNotNull(normalizedCostLineActuals.invoiceNumber),
        isNotNull(normalizedCostLineActuals.invoiceDate),
        gte(normalizedCostLineActuals.invoiceDate, cutoffIso),
      ),
    );

  const map = new Map<string, CounterpartyMonthlyTotal>();
  for (const r of rows) {
    const monthKey = dateToIso(r.invoiceDate)?.slice(0, 7);
    if (!monthKey) continue;
    const name = r.counterpartyName ?? "Unknown";
    const key = `${r.counterpartyId ?? "none"}|${monthKey}`;
    const acc = map.get(key) ?? {
      counterpartyId: r.counterpartyId ?? null,
      counterpartyName: name,
      monthKey,
      amount: 0,
    };
    acc.amount += numeric(r.amount);
    map.set(key, acc);
  }
  return Array.from(map.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

// DSO / DPO — for each of the last `weeks` ISO weeks, compute the average
// days between invoiceDate and paidDate for revenue (DSO) and cost (DPO)
// lines that were paid in that week.
export interface DsoDpoPoint {
  weekStart: string; // YYYY-MM-DD (Monday)
  dso: number | null;
  dpo: number | null;
  dsoCount: number;
  dpoCount: number;
}

export async function computeDsoDpoTrend(weeks: number): Promise<DsoDpoPoint[]> {
  const today = new Date();
  // Anchor "this week's Monday" to SAST so the cutoff doesn't slip a
  // day when the server is UTC and the operator just rolled into a
  // new week on their SAST calendar.
  const monday = sastWeekStart(today);
  const cutoff = new Date(monday);
  cutoff.setUTCDate(monday.getUTCDate() - weeks * 7);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const [paidRev, paidCost] = await Promise.all([
    db
      .select({ paidDate: normalizedRevenueLines.paidDate, invoiceDate: normalizedRevenueLines.invoiceDate })
      .from(normalizedRevenueLines)
      .where(
        and(
          isNull(normalizedRevenueLines.effectiveTo),
          isNull(normalizedRevenueLines.deletedAt),
          isNotNull(normalizedRevenueLines.paidDate),
          isNotNull(normalizedRevenueLines.invoiceDate),
          gte(normalizedRevenueLines.paidDate, cutoffIso),
        ),
      ),
    db
      .select({ paidDate: normalizedCostLines.paidDate, invoiceDate: normalizedCostLines.invoiceDate })
      .from(normalizedCostLines)
      .where(
        and(
          isNull(normalizedCostLines.effectiveTo),
          isNull(normalizedCostLines.deletedAt),
          isNotNull(normalizedCostLines.paidDate),
          isNotNull(normalizedCostLines.invoiceDate),
          gte(normalizedCostLines.paidDate, cutoffIso),
        ),
      ),
  ]);

  type PaidRow = { paidDate: string | null; invoiceDate: string | null };
  const dsoBuckets = bucketByWeek(paidRev as PaidRow[], monday, weeks);
  const dpoBuckets = bucketByWeek(paidCost as PaidRow[], monday, weeks);

  const out: DsoDpoPoint[] = [];
  for (let i = 0; i < weeks; i += 1) {
    const wkStart = new Date(monday);
    wkStart.setUTCDate(monday.getUTCDate() - (weeks - 1 - i) * 7);
    const key = wkStart.toISOString().slice(0, 10);
    const dsoStats = dsoBuckets.get(key) ?? { sum: 0, count: 0 };
    const dpoStats = dpoBuckets.get(key) ?? { sum: 0, count: 0 };
    out.push({
      weekStart: key,
      dso: dsoStats.count > 0 ? Math.round(dsoStats.sum / dsoStats.count) : null,
      dpo: dpoStats.count > 0 ? Math.round(dpoStats.sum / dpoStats.count) : null,
      dsoCount: dsoStats.count,
      dpoCount: dpoStats.count,
    });
  }
  return out;
}

function bucketByWeek(
  rows: Array<{ paidDate: string | Date | null; invoiceDate: string | Date | null }>,
  thisMonday: Date,
  weeks: number,
): Map<string, { sum: number; count: number }> {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const paid = parseDate(r.paidDate);
    const invoice = parseDate(r.invoiceDate);
    if (!paid || !invoice) continue;
    // diffDays strips time-of-day, so a paid_date stored as a full datetime
    // (e.g. "2026-04-01T14:30:00Z") doesn't drift by ±1 day vs an invoice_date
    // stored as a date-only string ("2026-03-01").
    const days = Math.max(0, diffDays(paid, invoice));
    const wkStart = sastWeekStart(paid);
    const offsetWeeks = Math.round((thisMonday.getTime() - wkStart.getTime()) / (7 * 86_400_000));
    if (offsetWeeks < 0 || offsetWeeks >= weeks) continue;
    const key = wkStart.toISOString().slice(0, 10);
    const acc = buckets.get(key) ?? { sum: 0, count: 0 };
    acc.sum += days;
    acc.count += 1;
    buckets.set(key, acc);
  }
  return buckets;
}

// Forecast vs actual — weekly cashflow series from snapshot table.
export interface CashflowSeriesPoint {
  pointDate: string;
  series: string;
  value: number;
}

export async function listCashflowPointsForRange(fromIso: string, toIso: string): Promise<CashflowSeriesPoint[]> {
  type Row = { pointDate: string | null; series: string; value: string | null };
  const rows = (await db
    .select({
      pointDate: cashflowPoints.pointDate,
      series: cashflowPoints.seriesName,
      value: cashflowPoints.value,
    })
    .from(cashflowPoints)
    .where(
      and(
        isNull(cashflowPoints.effectiveTo),
        gte(cashflowPoints.pointDate, fromIso),
        lte(cashflowPoints.pointDate, toIso),
      ),
    )) as Row[];

  return rows.map((r): CashflowSeriesPoint => ({
    pointDate: dateToIso(r.pointDate) ?? "",
    series: r.series,
    value: numeric(r.value),
  }));
}

// Helpers — shared across the analytical paths.

async function loadCounterpartyTerms(): Promise<Map<number, number>> {
  const rows = await db
    .select({ id: counterparties.id, terms: counterparties.paymentTerms })
    .from(counterparties)
    .where(isNull(counterparties.deletedAt));

  const map = new Map<number, number>();
  for (const r of rows) {
    const days = parsePaymentTerms(r.terms);
    if (days != null) map.set(r.id, days);
  }
  return map;
}

async function loadCustomerTermsByProject(): Promise<Map<number, number>> {
  // payment_terms uses entity_type / entity_name; customer terms aren't joined
  // to projects directly, so we leave this as a no-op map for now and surface
  // a per-project default term in the UI. Future enrichment: project_info
  // → client_id → counterparty terms.
  const rows = await db
    .select({ entityType: paymentTerms.entityType, entityName: paymentTerms.entityName, terms: paymentTerms.termsDays })
    .from(paymentTerms);

  const projects = (await db
    .select({ id: projectInfo.id, name: projectInfo.projectName })
    .from(projectInfo)
    .where(isNull(projectInfo.deletedAt))) as Array<{ id: number; name: string }>;

  const projectByName = new Map<string, number>(
    projects.map((p): [string, number] => [p.name.toLowerCase(), p.id]),
  );
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.entityType !== "project" || !r.entityName) continue;
    const id = projectByName.get(r.entityName.toLowerCase());
    if (id != null && Number.isFinite(Number(r.terms))) map.set(id, Number(r.terms));
  }
  return map;
}

function parsePaymentTerms(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function numeric(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00.000Z` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// SAST-anchored Monday-of-week for weekly bucketing. Using
// d.getUTCDay() directly shifted the row into the previous ISO week
// for any paid_date stored as a full datetime after 22:00 SAST (post-
// midnight UTC). Returns a UTC Date stamped at the Monday's SAST
// midnight expressed as UTC midnight so `toISOString().slice(0,10)`
// yields the operator's bucket label ("YYYY-MM-DD"). Caller MUST NOT
// re-apply .setUTCHours(0,0,0,0) — it's already done.
function sastWeekStart(d: Date): Date {
  const shifted = new Date(d.getTime() + 120 * 60 * 1000);
  const dow = shifted.getUTCDay() || 7; // ISO: Sunday => 7
  shifted.setUTCDate(shifted.getUTCDate() - (dow - 1));
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted;
}

function dateToIso(value: unknown): string | null {
  const d = parseDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

// COS tolerance band per project — stored in financial_integration_rules
// with rule_type = 'cos_tolerance_band_pct'.

export async function loadCosToleranceBandsByProject(): Promise<Map<number, number>> {
  const rows = (await db
    .select({
      projectId: financialIntegrationRules.projectId,
      ruleConfig: financialIntegrationRules.ruleConfig,
    })
    .from(financialIntegrationRules)
    .where(
      and(
        eq(financialIntegrationRules.ruleType, COS_TOLERANCE_RULE_TYPE),
        eq(financialIntegrationRules.isActive, true),
        // Without this, soft-deleted bands silently stayed in force —
        // upsertCosToleranceBand below resets deletedAt:null on update,
        // so a "deleted" band could resurrect on next save.
        isNull(financialIntegrationRules.deletedAt),
      ),
    )) as Array<{ projectId: number | null; ruleConfig: string }>;

  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.projectId == null) continue;
    try {
      const parsed = JSON.parse(r.ruleConfig);
      if (typeof parsed?.bandPct === "number" && Number.isFinite(parsed.bandPct)) {
        map.set(r.projectId, parsed.bandPct);
      }
    } catch {
      // Skip malformed entries — defaults are applied by the route.
    }
  }
  return map;
}

// Returns null when the project does not exist or is soft-deleted.
export async function loadProjectName(projectId: number): Promise<string | null> {
  const rows = (await db
    .select({ name: projectInfo.projectName })
    .from(projectInfo)
    .where(and(eq(projectInfo.id, projectId), isNull(projectInfo.deletedAt)))
    .limit(1)) as Array<{ name: string }>;
  return rows[0]?.name ?? null;
}

export async function upsertCosToleranceBand(
  projectId: number,
  bandPct: number,
  userId: number,
  projectName: string,
): Promise<void> {
  // Look up only ACTIVE rows. Without the deletedAt filter, a previous
  // delete would resurrect on the next save (the UPDATE branch below
  // would re-activate it) instead of inserting a clean new row, which
  // surprises operators and loses the history of the delete event.
  const existing = (await db
    .select({ id: financialIntegrationRules.id })
    .from(financialIntegrationRules)
    .where(
      and(
        eq(financialIntegrationRules.projectId, projectId),
        eq(financialIntegrationRules.ruleType, COS_TOLERANCE_RULE_TYPE),
        isNull(financialIntegrationRules.deletedAt),
      ),
    )
    .limit(1)) as Array<{ id: number }>;

  const ruleConfig = JSON.stringify({ bandPct });

  if (existing[0]) {
    await db
      .update(financialIntegrationRules)
      .set({ ruleConfig, updatedAt: new Date(), isActive: true, deletedAt: null })
      .where(eq(financialIntegrationRules.id, existing[0].id));
  } else {
    await db.insert(financialIntegrationRules).values({
      projectId,
      projectName,
      ruleType: COS_TOLERANCE_RULE_TYPE,
      ruleConfig,
      createdByUserId: userId,
      isActive: true,
    });
  }
}

// ─── Dashboard Financial Summary ─────────────────────────────────────
//
// Powers GET /api/dashboard/financial-summary. Three tiles —
// Revenue & COS read canonical Excel-mastered lines; OpEx reads the
// app-mastered opex_budget_monthly table (no actual ledger, so
// actual = forecast = plan for the OpEx tile).
//
// Plan / actual / forecast reflect the selected period; trend is a
// fixed 6-month window ending today regardless of period, matching
// the FinancialSummaryTiles component's sparkline.

export type FinancialSummaryPeriod =
  | "ytd" | "current_fy" | "this_month" | "last_month" | "custom";

export interface FinancialSummaryTile {
  key: "revenue" | "cos" | "opex";
  label: string;
  plan: number;
  actual: number;
  forecast: number;
  trend: Array<{ month: string; value: number }>;
}

export interface FinancialSummaryResult {
  period: FinancialSummaryPeriod;
  from: string;
  to: string;
  metrics: FinancialSummaryTile[];
}

export interface FinancialSummaryOptions {
  period: FinancialSummaryPeriod;
  /** Required when period === "custom". ISO date "YYYY-MM-DD". */
  from?: string;
  /** Required when period === "custom". ISO date "YYYY-MM-DD". */
  to?: string;
  /** Test-only: pin the reference "now". */
  now?: Date;
  /** Test-only: in-memory inputs to bypass the DB. */
  inputs?: {
    revenueLines: any[];
    costLines: any[];
    opexBudget: Array<{ monthKey: string; amount: string | number | null }>;
  };
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfMonthIso(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function endOfMonthIso(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function resolvePeriodWindow(opts: FinancialSummaryOptions): { from: string; to: string } {
  const now = opts.now ?? new Date();
  const todayIso = now.toISOString().slice(0, 10);
  switch (opts.period) {
    case "current_fy": {
      const fy = getFyWindow({ date: now });
      return { from: fy.fyStartIso, to: fy.fyEndIso };
    }
    case "ytd": {
      const fy = getFyWindow({ date: now });
      return { from: fy.fyStartIso, to: todayIso };
    }
    case "this_month": {
      return { from: startOfMonthIso(now), to: endOfMonthIso(now) };
    }
    case "last_month": {
      const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      return { from: startOfMonthIso(prev), to: endOfMonthIso(prev) };
    }
    case "custom": {
      if (!opts.from || !opts.to) {
        const err = new Error("custom period requires from and to ISO dates");
        (err as any).status = 400;
        throw err;
      }
      return { from: opts.from, to: opts.to };
    }
  }
}

function trailing6Months(now: Date): Array<{ key: string; label: string; from: string; to: string }> {
  const out: Array<{ key: string; label: string; from: string; to: string }> = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({
      key: monthKey(d.toISOString().slice(0, 10)),
      label: SHORT_MONTHS[d.getUTCMonth()],
      from: startOfMonthIso(d),
      to: endOfMonthIso(d),
    });
  }
  return out;
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.length >= 10 ? trimmed.slice(0, 10) : null;
}

function inWindow(iso: string | null, from: string, to: string): boolean {
  return iso != null && iso >= from && iso <= to;
}

export async function getFinancialSummary(
  opts: FinancialSummaryOptions,
): Promise<FinancialSummaryResult> {
  const { from, to } = resolvePeriodWindow(opts);
  const now = opts.now ?? new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const trailing = trailing6Months(now);

  // Read canonical-current revenue + cost lines and the OpEx budget.
  // The two finance tables enforce the standard `effective_to IS NULL`
  // + `deleted_at IS NULL` guard required for snapshot aggregates.
  const [revRows, costRows, opexRows] = opts.inputs
    ? [opts.inputs.revenueLines, opts.inputs.costLines, opts.inputs.opexBudget]
    : await Promise.all([
        db
          .select({
            amount: normalizedRevenueLines.amountExVat,
            expectedDate: normalizedRevenueLines.expectedPaymentDate,
            adminOverride: normalizedRevenueLines.adminDateOverride,
            paidDate: normalizedRevenueLines.paidDate,
          })
          .from(normalizedRevenueLines)
          .where(and(
            isNull(normalizedRevenueLines.effectiveTo),
            isNull(normalizedRevenueLines.deletedAt),
          )),
        db
          .select({
            amount: normalizedCostLines.amountExVat,
            budgetTotal: normalizedCostLines.budgetTotal,
            invoiceDate: normalizedCostLines.invoiceDate,
            invoiceNumber: normalizedCostLines.invoiceNumber,
            poNumber: normalizedCostLines.poNumber,
            forecastDate: normalizedCostLines.forecastPaymentDate,
            adminOverride: normalizedCostLines.adminDateOverride,
            paidDate: normalizedCostLines.paidDate,
            status: normalizedCostLines.status,
            cosStatusOverride: normalizedCostLines.cosStatusOverride,
            cosRealised: normalizedCostLines.cosRealised,
            invoiceDateFontColor: normalizedCostLines.invoiceDateFontColor,
            invoiceDateConfirmed: normalizedCostLines.invoiceDateConfirmed,
          })
          .from(normalizedCostLines)
          .where(and(
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
          )),
        db
          .select({ monthKey: opexBudgetMonthly.monthKey, amount: opexBudgetMonthly.amount })
          .from(opexBudgetMonthly),
      ]);

  // ── Revenue tile ─────────────────────────────────────────────────
  // plan      = expected (or admin-overridden) payment date in window
  // actual    = paid date in window
  // forecast  = paid-to-date in window + unpaid lines whose expected
  //             date falls in window (best estimate of period inflow)
  // trend     = paid amount per month, last 6 months
  let revPlan = 0, revActual = 0, revForecastUnpaid = 0;
  const revTrend = new Map<string, number>(trailing.map((m) => [m.key, 0]));
  for (const r of revRows) {
    const amount = num(r.amount);
    const paidIso = isoOrNull(r.paidDate);
    const expectedIso = isoOrNull((r as any).adminOverride ?? r.expectedDate);

    if (inWindow(expectedIso, from, to)) revPlan += amount;
    if (paidIso != null && inWindow(paidIso, from, to)) revActual += amount;
    if (paidIso == null && inWindow(expectedIso, from, to)) revForecastUnpaid += amount;

    if (paidIso != null) {
      const k = monthKey(paidIso);
      if (revTrend.has(k)) revTrend.set(k, (revTrend.get(k) ?? 0) + amount);
    }
  }
  const revenueTile: FinancialSummaryTile = {
    key: "revenue",
    label: "Revenue",
    plan: Math.round(revPlan),
    actual: Math.round(revActual),
    forecast: Math.round(revActual + revForecastUnpaid),
    trend: trailing.map((m) => ({ month: m.label, value: Math.round(revTrend.get(m.key) ?? 0) })),
  };

  // ── COS tile ─────────────────────────────────────────────────────
  // plan      = SUM(budgetTotal) where forecast/invoice date in window
  // actual    = SUM(amountExVat) for lines that pass isCanonicalCosRealised()
  //             AND whose invoice date (the realisation gate) is in window
  // forecast  = actual + unrealised lines whose forecast date is in window
  // trend     = realised amount per month (by invoice date), last 6 months
  let cosPlan = 0, cosActual = 0, cosForecastUnrealised = 0;
  const cosTrend = new Map<string, number>(trailing.map((m) => [m.key, 0]));
  for (const c of costRows) {
    const amount = num(c.amount);
    const budget = num(c.budgetTotal);
    const invoiceIso = isoOrNull(c.invoiceDate);
    const forecastIso = isoOrNull((c as any).adminOverride ?? c.forecastDate);
    const planDateIso = forecastIso ?? invoiceIso; // best-known cost date for plan window

    if (inWindow(planDateIso, from, to)) cosPlan += budget;

    const realised = isCanonicalCosRealised({
      status: (c.status as any) ?? null,
      cosStatusOverride: (c.cosStatusOverride as any) ?? null,
      cosRealised: (c.cosRealised as any) ?? null,
      expenseInvoiceNumber: (c.invoiceNumber as any) ?? null,
      expenseInvoicedDate: invoiceIso,
      expensePoNumber: (c.poNumber as any) ?? null,
      paymentDate: isoOrNull(c.paidDate),
      today: todayIso,
      amountExVat: c.amount as any,
      invoiceDateFontColor: (c.invoiceDateFontColor as any) ?? null,
      invoiceDateConfirmed: (c.invoiceDateConfirmed as any) ?? null,
    });

    if (realised) {
      if (inWindow(invoiceIso, from, to)) cosActual += amount;
      if (invoiceIso != null) {
        const k = monthKey(invoiceIso);
        if (cosTrend.has(k)) cosTrend.set(k, (cosTrend.get(k) ?? 0) + amount);
      }
    } else if (inWindow(forecastIso, from, to)) {
      cosForecastUnrealised += amount;
    }
  }
  const cosTile: FinancialSummaryTile = {
    key: "cos",
    label: "Cost of Sales",
    plan: Math.round(cosPlan),
    actual: Math.round(cosActual),
    forecast: Math.round(cosActual + cosForecastUnrealised),
    trend: trailing.map((m) => ({ month: m.label, value: Math.round(cosTrend.get(m.key) ?? 0) })),
  };

  // ── OpEx tile ────────────────────────────────────────────────────
  // App-mastered: opex_budget_monthly carries plan only. No actual
  // ledger exists for OpEx, so actual = forecast = plan and the trend
  // shows monthly budget.
  const opexByMonth = new Map<string, number>();
  for (const o of opexRows) {
    if (!o.monthKey) continue;
    opexByMonth.set(o.monthKey, num(o.amount));
  }
  let opexPlan = 0;
  const fromMonth = monthKey(from);
  const toMonth = monthKey(to);
  for (const [mk, amt] of opexByMonth) {
    if (mk >= fromMonth && mk <= toMonth) opexPlan += amt;
  }
  const opexTile: FinancialSummaryTile = {
    key: "opex",
    label: "Operating Expenditure",
    plan: Math.round(opexPlan),
    actual: Math.round(opexPlan),
    forecast: Math.round(opexPlan),
    trend: trailing.map((m) => ({ month: m.label, value: Math.round(opexByMonth.get(m.key) ?? 0) })),
  };

  return {
    period: opts.period,
    from,
    to,
    metrics: [revenueTile, cosTile, opexTile],
  };
}

// Re-export `eq` so route file callers don't need both imports.
export { eq };
