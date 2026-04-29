// Repository for the Finance / Analysis pages (cashflow & COS).
//
// All snapshot-table reads filter by `effectiveTo IS NULL` to avoid
// double-counting historical snapshots — see the finance-snapshot-queries
// skill in CLAUDE.md.
//
// All db.* calls live here per the route → repository discipline in
// CLAUDE.md. Routes import the named functions below.

import { and, eq, isNull, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  normalizedRevenueLines,
  normalizedCostLines,
  paymentTerms,
  counterparties,
  projectPlan,
  cashflowPoints,
  financialIntegrationRules,
} from "@shared/schema/finance";
import { projectInfo, projectRevenueSummary } from "@shared/schema/projects";

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
const REVENUE_OUTSTANDING_STATES: Array<"planned" | "invoiced"> = ["planned", "invoiced"];
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

  const invoicedRows = await db
    .select({
      projectId: normalizedCostLines.projectId,
      amount: normalizedCostLines.amountExVat,
    })
    .from(normalizedCostLines)
    .where(
      and(
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
        inArray(normalizedCostLines.status, COST_INVOICED_OR_PAID),
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
  cutoff.setUTCMonth(cutoff.getUTCMonth() - monthsBack);
  cutoff.setUTCDate(1);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select({
      counterpartyId: normalizedCostLines.counterpartyId,
      counterpartyName: normalizedCostLines.counterpartyName,
      invoiceDate: normalizedCostLines.invoiceDate,
      amount: normalizedCostLines.amountExVat,
    })
    .from(normalizedCostLines)
    .where(
      and(
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
        inArray(normalizedCostLines.status, COST_INVOICED_OR_PAID),
        sql`${normalizedCostLines.invoiceDate} IS NOT NULL`,
        sql`${normalizedCostLines.invoiceDate} >= ${cutoffIso}`,
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
  const dayOfWeek = today.getUTCDay() || 7; // Sunday = 7
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - (dayOfWeek - 1));
  monday.setUTCHours(0, 0, 0, 0);
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
          sql`${normalizedRevenueLines.paidDate} IS NOT NULL`,
          sql`${normalizedRevenueLines.invoiceDate} IS NOT NULL`,
          sql`${normalizedRevenueLines.paidDate} >= ${cutoffIso}`,
        ),
      ),
    db
      .select({ paidDate: normalizedCostLines.paidDate, invoiceDate: normalizedCostLines.invoiceDate })
      .from(normalizedCostLines)
      .where(
        and(
          isNull(normalizedCostLines.effectiveTo),
          isNull(normalizedCostLines.deletedAt),
          sql`${normalizedCostLines.paidDate} IS NOT NULL`,
          sql`${normalizedCostLines.invoiceDate} IS NOT NULL`,
          sql`${normalizedCostLines.paidDate} >= ${cutoffIso}`,
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
    const days = Math.max(0, Math.round((paid.getTime() - invoice.getTime()) / 86_400_000));
    const dayOfWeek = paid.getUTCDay() || 7;
    const wkStart = new Date(paid);
    wkStart.setUTCDate(paid.getUTCDate() - (dayOfWeek - 1));
    wkStart.setUTCHours(0, 0, 0, 0);
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
        sql`${cashflowPoints.pointDate} >= ${fromIso}`,
        sql`${cashflowPoints.pointDate} <= ${toIso}`,
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
  const existing = (await db
    .select({ id: financialIntegrationRules.id })
    .from(financialIntegrationRules)
    .where(
      and(
        eq(financialIntegrationRules.projectId, projectId),
        eq(financialIntegrationRules.ruleType, COS_TOLERANCE_RULE_TYPE),
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

// Re-export `eq` so route file callers don't need both imports.
export { eq };
