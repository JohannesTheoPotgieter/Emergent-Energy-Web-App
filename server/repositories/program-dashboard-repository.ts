// Repository for GET /api/program-dashboard.
//
// All db.* calls and aggregation logic live here so the route handler
// contains only param parsing, RBAC, the repository call, trust-header
// set, and response serialisation — per the route → repository discipline
// in CLAUDE.md.
//
// Every snapshot-table read carries an explicit effectiveTo IS NULL guard
// (see the finance-snapshot-queries skill in CLAUDE.md).

import { format } from "date-fns";
import { and, eq, isNull, sql } from "drizzle-orm";
import { toCanonicalEngineeringStageStatus } from "@shared/status-logic";
import { computeMarginPct } from "../lib/finance/margin";
import { storage } from "../storage";
import { db } from "../db";
import {
  normalizedCostLines,
  normalizedRevenueLines,
  smartImportRuns,
  workItems,
  cashflowPoints,
  financeRevenueMonthly,
  financeCosMonthly,
  projectExecutionState,
  type NormalizedCostLine,
  type NormalizedRevenueLine,
  type SmartImportRun,
  type WorkItem,
  type CashflowPoint,
  type FinanceRevenueMonthly,
  type FinanceCosMonthly,
} from "@shared/schema";
import { getAllPMWorkItemsAsProjectPlan } from "../work-items-adapter";
import { computeProjectProgress } from "../lib/kpi-formulas";
import { isDateBlack } from "../lib/calculations/stateClassifier";
import { isCosRealised as isCosRealisedShared } from "../lib/calculations/financeUtils";
import { isRevenueSettled } from "../lib/finance/revenue-ar-status";
import { resolveProjectScope } from "../services/project-access-service";

/** Loosely-shaped row from a dynamic source (raw SQL / adapter / storage). */
type DynRow = Record<string, unknown>;

/**
 * Normalize a `db.execute()` result to its row array. Shape differs by
 * driver: node-postgres returns `{ rows: [...] }`, others return an array.
 */
/** Coerce an unknown jsonb/column value to `string | null`. */
function asStr(v: unknown): string | null {
  return v == null ? null : typeof v === "string" ? v : String(v);
}

/** Coerce an unknown jsonb/column value to `number | null`. */
function asNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function execRows(r: unknown): DynRow[] {
  if (Array.isArray(r)) return r as DynRow[];
  if (r && typeof r === "object" && "rows" in r) {
    const rows = (r as { rows: unknown }).rows;
    return Array.isArray(rows) ? (rows as DynRow[]) : [];
  }
  return [];
}

/**
 * Accumulator row built per project while aggregating. Carries the public
 * dashboard fields plus `_`-prefixed scratch counters that are stripped
 * before the row is returned to the client.
 */
interface ProjectAccumulatorRow {
  projectId: number;
  projectName: string;
  portfolio: string | null;
  pm: string | null;
  pd: string | null;
  executionPhase: string | null;
  rag: string;
  ragUpdatedAt: string | null;
  actualProgressPct: number;
  expectedProgressPct: number;
  scheduleVariancePct: number;
  plannedRevenueFy: number;
  receivedInflowFy: number;
  openInflowFy: number;
  plannedExpenditureFy: number;
  paidExpenditureFy: number;
  openExpenditureFy: number;
  grossMarginPctFy: number | null;
  engineeringStatus: string;
  qualityStatus: string;
  importFreshness: string;
  importAgeDays: number | null;
  criticalActionCount: number;
  _taskWeight: number;
  _taskActual: number;
  _taskExpected: number;
  _expCount: number;
  _engOpen: number;
  _qualityOpen: number;
  _qualityHigh: number;
  _approvalsPending: number;
  _inflowRisk: number;
  _outflowRisk: number;
  __hasFyItem?: boolean;
}

// Chart-dataset accumulator bucket shapes. Each carries a string period key
// plus numeric metric fields.
interface MonthlyForecastBucket {
  periodKey: string;
  period: string;
  plannedRevenue: number;
  plannedCos: number;
  grossProfit: number;
}
interface WeeklyCashflowBucket {
  periodKey: string;
  period: string;
  plannedRevenue: number;
  plannedExpenditure: number;
  plannedCashflow: number;
  actualCashflow: number;
  forecastRevenue: number;
  forecastExpenditure: number;
}
interface PhaseSummaryBucket {
  phase: string;
  projectCount: number;
  contractValue: number;
  openInflow: number;
  openExpenditure: number;
  averageProgress: number;
  _progressSum: number;
}
interface PmSummaryBucket {
  owner: string;
  projectCount: number;
  contractValue: number;
  behindPlanCount: number;
  onScheduleRate: number;
  openInflow: number;
  openExpenditure: number;
  averageProgress: number;
  _onScheduleCount: number;
  _progressSum: number;
}
interface MilestonePipelineBucket {
  periodKey: string;
  period: string;
  pdHandovers: number;
  siteEstablishment: number;
  commissioning: number;
  omHandover: number;
  clientHandover: number;
}

/**
 * Add `delta` to a numeric field of `obj` selected by a dynamic key.
 * Centralises the one place the dashboard needs string-keyed numeric
 * accumulation so callers stay `any`-free.
 */
function addToNumericField<T extends object>(obj: T, key: string, delta: number): void {
  const rec = obj as Record<string, unknown>;
  const cur = typeof rec[key] === "number" ? (rec[key] as number) : 0;
  rec[key] = cur + delta;
}

// ─── Public interfaces ─────────────────────────────────────────────────────

export interface ProgramDashboardFilters {
  search?: string;
  portfolio?: string;
  pm?: string;
  pd?: string;
  executionPhase?: string;
  rag?: string;
  exceptionOnly?: boolean;
  behindPlanOnly?: boolean;
  inflowRiskOnly?: boolean;
  outflowRiskOnly?: boolean;
  engineeringBlockersOnly?: boolean;
  qualityIssuesOnly?: boolean;
  pendingApprovalsOnly?: boolean;
  staleImportsOnly?: boolean;
}

/** Test-only: in-memory inputs to bypass all DB and service calls. */
export interface ProgramDashboardInputs {
  allProjectInfo: DynRow[];
  revenueRows: NormalizedRevenueLine[];
  costRows: NormalizedCostLine[];
  importRuns: SmartImportRun[];
  engRows: WorkItem[];
  approvalsRows: DynRow[];
  canonicalPlanTasks: DynRow[];
  qualityRows: DynRow[];
  usersRows: DynRow[];
  cashflowPointRows: CashflowPoint[];
  financeRevenueRows: FinanceRevenueMonthly[];
  financeCosRows: FinanceCosMonthly[];
}

export interface ProgramDashboardOptions {
  user: { id: number; role: string; name: string };
  filters: ProgramDashboardFilters;
  /** Test-only: pin the reference "now". */
  now?: Date;
  /** Test-only: in-memory inputs to bypass DB. When provided, full project scope is assumed. */
  inputs?: ProgramDashboardInputs;
}

export interface ProgramDashboardResult {
  meta: { fyStart: string; fyEnd: string };
  kpis: {
    activeDashboardProjects: number;
    averageActualProgressPct: number;
    averageExpectedProgressPct: number;
    projectsBehindPlan: number;
    plannedRevenueFy: number;
    receivedInflowFy: number;
    openInflowFy: number;
    plannedExpenditureFy: number;
    paidExpenditureFy: number;
    openExpenditureFy: number;
    grossProfitFy: number;
    grossMarginPctFy: number | null;
    openEngineeringBlockers: number;
    openQualityWarnings: number;
    pendingApprovals: number;
    staleImports: number;
    cosPlannedMonth: number;
    cosRealisedMonth: number;
    currentMonth: string;
    // Excel Program Dashboard parity additions
    onScheduleRate: number;
    contractCompleteness: number;
    revenueOutstandingThisMonth: number;
    cosOutstandingThisMonth: number;
    projectInflowsThisWeek: number;
    projectOutflowsThisWeek: number;
  };
  actionCenter: {
    projectsBehindPlan: DynRow[];
    inflowAtRisk: DynRow[];
    expenditureAtRisk: DynRow[];
    engineeringBottlenecks: DynRow[];
    qualityIssues: DynRow[];
    pendingApprovalsDecisions: DynRow[];
  };
  projects: DynRow[];
  charts: {
    supportedChartTypes: string[];
    presets: DynRow[];
    datasets: DynRow[];
  };
  options: {
    portfolios: string[];
    pms: string[];
    pds: string[];
    executionPhases: string[];
    rags: string[];
  };
  nullCount: number;
}

// ─── Main repository function ──────────────────────────────────────────────

export async function getProgramDashboardData(
  opts: ProgramDashboardOptions,
): Promise<ProgramDashboardResult> {
  const now = opts.now ?? new Date();
  const fyStartYear = (now.getMonth() + 1) >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = `${fyStartYear}-09-01`;
  const fyEnd = `${fyStartYear + 1}-08-31`;
  const today = now.toISOString().slice(0, 10);

  // ── Fetch raw data (or use test fixtures) ────────────────────────────────
  const [
    allProjectInfo,
    revenueRows,
    costRows,
    importRuns,
    engRows,
    approvalRows,
    canonicalPlanTasks,
    qualityRows,
    /* usersRows (index 8) intentionally skipped — not consumed here */ ,
    cashflowPointRows,
    financeRevenueRows,
    financeCosRows,
  ] = opts.inputs
    ? [
        opts.inputs.allProjectInfo,
        opts.inputs.revenueRows,
        opts.inputs.costRows,
        opts.inputs.importRuns,
        opts.inputs.engRows,
        opts.inputs.approvalsRows,
        opts.inputs.canonicalPlanTasks,
        opts.inputs.qualityRows,
        opts.inputs.usersRows,
        opts.inputs.cashflowPointRows,
        opts.inputs.financeRevenueRows,
        opts.inputs.financeCosRows,
      ]
    : await Promise.all([
        storage.getAllProjectInfo(),
        // Guard: skips historical snapshots where effectiveTo IS NOT NULL (normalized_revenue_lines)
        db.select().from(normalizedRevenueLines).where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))),
        // Guard: skips historical snapshots where effectiveTo IS NOT NULL (normalized_cost_lines)
        db.select().from(normalizedCostLines).where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))),
        db.select().from(smartImportRuns).where(eq(smartImportRuns.status, 'committed')),
        db.select().from(workItems).where(and(eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt))),
        db.execute(sql`SELECT id, project_id, status, title, due_date, assigned_approver FROM approvals`).catch(() => ({ rows: [] })).then(execRows),
        getAllPMWorkItemsAsProjectPlan(),
        db.execute(sql`SELECT id, project_id, project_name, severity, status, title, owner_user_id, due_date FROM qc_warning`).catch(() => ({ rows: [] })).then(execRows),
        db.execute(sql`SELECT id, name FROM users`).then(execRows),
        // Guard: skips historical snapshots where effectiveTo IS NOT NULL (cashflow_points)
        db.select().from(cashflowPoints).where(isNull(cashflowPoints.effectiveTo)),
        // Guard: skips historical snapshots where effectiveTo IS NOT NULL (finance_revenue_monthly)
        db.select().from(financeRevenueMonthly).where(isNull(financeRevenueMonthly.effectiveTo)),
        // Guard: skips historical snapshots where effectiveTo IS NOT NULL (finance_cos_monthly)
        db.select().from(financeCosMonthly).where(isNull(financeCosMonthly.effectiveTo)),
      ]);

  // Fetch contract-signed state for all projects (used for Excel-parity contractCompleteness KPI).
  // cpSigned (cost proposal) and signedStatus (EPC contract) live on projectExecutionState.
  const execStateRows: Array<{ projectId: number; cpSigned: boolean; signedStatus: string }> = opts.inputs
    ? []
    : await db
        .select({ projectId: projectExecutionState.projectId, cpSigned: projectExecutionState.cpSigned, signedStatus: projectExecutionState.signedStatus })
        .from(projectExecutionState)
        .then((rows: Array<{ projectId: number; cpSigned: boolean; signedStatus: string }>) =>
          rows.map((r) => ({ projectId: r.projectId, cpSigned: r.cpSigned ?? false, signedStatus: r.signedStatus ?? 'NONE' })));
  const execStateByProjectId = new Map<number, { cpSigned: boolean; signedStatus: string }>();
  for (const r of execStateRows) {
    execStateByProjectId.set(r.projectId, { cpSigned: r.cpSigned, signedStatus: r.signedStatus });
  }

  // manualOverrides overlay — empty by design (overlay removed in 2026-03-30 migration)
  const revOverrides: Array<{ projectName: string; rowNumber: string; overrideValue: string }> = [];
  const cosOverrides: Array<{ projectName: string; rowNumber: string; overrideStatus: string }> = [];

  const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  const toNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const isBlack = (fontColor: string | null | undefined, confirmed?: boolean | null) => isDateBlack(confirmed ?? null, fontColor);
  const isInFy = (d: string | null | undefined) => !!(d && /^\d{4}-\d{2}-\d{2}/.test(d) && d >= fyStart && d <= fyEnd);

  const inBankOverrideSet = new Set(
    revOverrides.filter((o) => o.overrideValue === "1").map((o) => `${o.projectName}::${o.rowNumber}`)
  );
  const cosOverrideByKey = new Map<string, string>();
  for (const co of cosOverrides) {
    cosOverrideByKey.set(`${co.projectName}::${co.rowNumber}`, co.overrideStatus);
  }

  // RLS: scope project data to user's accessible projects
  const dashScope = opts.inputs
    ? { kind: "full_oversight" as const }
    : await resolveProjectScope(opts.user.id, opts.user.role, opts.user.name);

  const scopedIds =
    dashScope.kind === "full_oversight" ? null : dashScope.projectIds;
  const scopedProjectInfo = scopedIds
    ? allProjectInfo.filter((p) => scopedIds.has(Number(p.id)))
    : allProjectInfo;

  const projectById = new Map<number, DynRow>();
  const projectByName = new Map<string, DynRow>();
  for (const p of scopedProjectInfo) {
    if (p.id) projectById.set(Number(p.id), p);
    projectByName.set(String(p.projectName || '').toLowerCase(), p);
  }

  const planRows = canonicalPlanTasks;

  const rowsByProject = new Map<number, ProjectAccumulatorRow>();
  const ensureRow = (proj: DynRow): ProjectAccumulatorRow => {
    const projId = Number(proj.id);
    let row = rowsByProject.get(projId);
    if (!row) {
      row = {
        projectId: projId,
        projectName: String(proj.projectName ?? ''),
        portfolio: (proj.portfolio as string) || null,
        pm: (proj.pm as string) || null,
        pd: (proj.pd as string) || null,
        executionPhase: (proj.executionPhase as string) || (proj.phase as string) || null,
        rag: (proj.ragStatus as string) || 'UNKNOWN',
        ragUpdatedAt: (proj.ragUpdatedAt as string) || null,
        actualProgressPct: 0, expectedProgressPct: 0, scheduleVariancePct: 0,
        plannedRevenueFy: 0, receivedInflowFy: 0, openInflowFy: 0,
        plannedExpenditureFy: 0, paidExpenditureFy: 0, openExpenditureFy: 0, grossMarginPctFy: null,
        engineeringStatus: 'On Track', qualityStatus: 'On Track', importFreshness: 'Critical', importAgeDays: null,
        criticalActionCount: 0,
        _taskWeight: 0, _taskActual: 0, _taskExpected: 0, _expCount: 0,
        _engOpen: 0, _qualityOpen: 0, _qualityHigh: 0, _approvalsPending: 0,
        _inflowRisk: 0, _outflowRisk: 0,
      };
      rowsByProject.set(projId, row);
    }
    return row;
  };

  const committedProjectIds = new Set<number>();
  const committedProjectNames = new Set<string>();
  const latestImportByProject = new Map<number, string>();
  for (const r of importRuns) {
    if (r.projectId) committedProjectIds.add(r.projectId);
    committedProjectNames.add((r.projectName || '').toLowerCase());
    const proj = r.projectId ? projectById.get(r.projectId) : projectByName.get((r.projectName || '').toLowerCase());
    if (!proj) continue;
    const stamp = r.committedAt || r.uploadedAt || null;
    if (!stamp) continue;
    const s = new Date(stamp).toISOString();
    const projId = Number(proj.id);
    const prev = latestImportByProject.get(projId);
    if (!prev || s > prev) latestImportByProject.set(projId, s);
  }

  // Group plan tasks by project for leaf-task identification
  const planTasksByProjectId = new Map<number, DynRow[]>();
  for (const t of planRows) {
    const proj = t.projectId ? projectById.get(Number(t.projectId)) : projectByName.get(String(t.projectName || '').toLowerCase());
    if (!proj) continue;
    const row = ensureRow(proj);
    const projId = Number(proj.id);
    const wiStart = (String(t.actualStart || t.startDate || '')).slice(0,10);
    const wiEnd = (String(t.actualEnd || t.endDate || '')).slice(0,10);
    if (wiStart && wiEnd && wiStart <= fyEnd && wiEnd >= fyStart) row.__hasFyItem = true;
    if (!planTasksByProjectId.has(projId)) planTasksByProjectId.set(projId, []);
    planTasksByProjectId.get(projId)!.push(t);
  }

  // Per-project Actual % / Expected % via the canonical formula in
  // server/lib/kpi-formulas.ts. The Plan tab pill values, this dashboard,
  // and the All Projects table all funnel through the same helper so the
  // same project row reports the same numbers everywhere.
  for (const [projId, tasks] of planTasksByProjectId) {
    const row = rowsByProject.get(projId);
    if (!row) continue;

    const progress = computeProjectProgress(
      tasks.map((t) => ({
        taskNo: asStr(t.taskNo),
        rowNumber: asNum(t.rowNumber),
        parentRowNumber: asNum(t.parentRowNumber),
        indentLevel: asNum(t.indentLevel),
        durationDays: asNum(t.durationDays),
        actualPctComplete: asNum(t.actualPctComplete),
        expectedPctComplete: asNum(t.expectedPctComplete),
        startDate: asStr(t.startDate),
        endDate: asStr(t.endDate),
        actualStartDate: asStr(t.actualStart),
        actualEndDate: asStr(t.actualEnd),
      })),
      today,
    );
    row._taskActual = progress.actualPct;
    row._taskExpected = progress.expectedPct;
    row._taskWeight = progress.leafCount > 0 ? 1 : 0;
    row._expCount = progress.leafCount > 0 ? 1 : 0;
  }

  for (const r of revenueRows) {
    const proj = r.projectId ? projectById.get(r.projectId) : projectByName.get((r.projectName || '').toLowerCase());
    if (!proj) continue;
    const dateKey = (r.expectedPaymentDate || r.invoiceDate || r.paidDate || '').slice(0,10);
    if (!isInFy(dateKey)) continue;
    const row = ensureRow(proj); row.__hasFyItem = true;
    const amt = toNum(r.amountExVat);
    row.plannedRevenueFy += amt;
    const overrideInBank = inBankOverrideSet.has(`${r.projectName}::${r.sourceRow}`);
    const received = overrideInBank || isRevenueSettled({
      paidDate: r.paidDate,
      paidDateConfirmed: r.paidDateConfirmed,
      paidDateFontColor: r.paidDateFontColor,
      inBankDate: r.inBankDate,
      manualInBank: overrideInBank ? 1 : null,
    });
    if (received) row.receivedInflowFy += amt;
    if (!received && dateKey && dateKey < today) row._inflowRisk += amt;
  }

  const currentMonthKey = today.slice(0, 7);
  let cosPlannedMonth = 0;
  let cosRealisedMonth = 0;

  for (const c of costRows) {
    const proj = c.projectId ? projectById.get(c.projectId) : projectByName.get((c.projectName || '').toLowerCase());
    if (!proj) continue;
    const dateKey = (c.approvedDate || c.invoiceDate || c.paidDate || '').slice(0,10);
    if (!isInFy(dateKey)) continue;
    const row = ensureRow(proj); row.__hasFyItem = true;
    const amt = toNum(c.amountExVat);
    row.plannedExpenditureFy += amt;
    const paid = hasText(c.invoiceNumber) && hasText(c.paidDate) && isBlack(c.paidDateFontColor, c.paidDateConfirmed);
    if (paid) row.paidExpenditureFy += amt;
    if (!paid && dateKey && dateKey < today) row._outflowRisk += amt;

    if (dateKey && dateKey.slice(0, 7) === currentMonthKey) {
      cosPlannedMonth += amt;
      const cosOverrideStatus = cosOverrideByKey.get(`${c.projectName}::${c.sourceRow}`);
      const isRealised = isCosRealisedShared({
        expenseInvoiceNumber: c.invoiceNumber,
        expenseInvoicedDate: c.invoiceDate,
        expensePoNumber: c.poNumber,
        invoiceDateConfirmed: c.invoiceDateConfirmed,
        invoiceDateFontColor: c.invoiceDateFontColor,
        _cosOverrideStatus: cosOverrideStatus ?? null,
        cosStatusOverride: c.cosStatusOverride ?? null,
        cosRealised: c.cosRealised ?? null,
      });
      if (isRealised) cosRealisedMonth += amt;
    }
  }

  for (const e of engRows) {
    const proj = e.projectId ? projectById.get(e.projectId) : projectByName.get((e.projectName || '').toLowerCase());
    if (!proj) continue;
    const row = ensureRow(proj);
    if (toCanonicalEngineeringStageStatus(e.status) !== 'complete' && !e.softDeletedAt) row._engOpen += 1;
  }

  for (const q of qualityRows) {
    const proj = q.project_id ? projectById.get(Number(q.project_id))
      : q.project_name ? projectByName.get(String(q.project_name).toLowerCase()) : null;
    if (!proj) continue;
    const row = ensureRow(proj);
    if (String(q.status || '').toLowerCase() === 'open') {
      row._qualityOpen += 1;
      if (String(q.severity || '').toLowerCase() === 'high') row._qualityHigh += 1;
    }
  }

  for (const a of approvalRows) {
    const proj = a.project_id ? projectById.get(Number(a.project_id)) : null;
    if (!proj) continue;
    const row = ensureRow(proj);
    if (String(a.status || '').toLowerCase() === 'pending') row._approvalsPending += 1;
  }

  let projects = Array.from(rowsByProject.values()).filter((row) => {
    const info = projectById.get(row.projectId);
    if (!info) return false;
    const isActive = info.archivedStatus === 'ACTIVE' && info.isActive !== false;
    const hasImport = committedProjectIds.has(row.projectId) || committedProjectNames.has((row.projectName || '').toLowerCase());
    return isActive && hasImport && !!row.__hasFyItem;
  });

  projects.forEach((row) => {
    row.actualProgressPct = row._taskWeight > 0 ? row._taskActual / row._taskWeight : 0;
    row.expectedProgressPct = (row._expCount || row._taskWeight) > 0 ? row._taskExpected / (row._expCount || row._taskWeight) : 0;
    row.scheduleVariancePct = row.actualProgressPct - row.expectedProgressPct;
    if (row.rag === 'UNKNOWN') {
      const delta = row.scheduleVariancePct;
      row.rag = delta >= -5 ? 'Green' : delta >= -15 ? 'Amber' : 'Red';
    }
    row.openInflowFy = row.plannedRevenueFy - row.receivedInflowFy;
    row.openExpenditureFy = row.plannedExpenditureFy - row.paidExpenditureFy;
    row.grossMarginPctFy = computeMarginPct(row.plannedRevenueFy, row.plannedExpenditureFy, { precision: 1 });
    row.engineeringStatus = row._engOpen >= 5 ? 'Blocked' : row._engOpen > 0 ? 'At Risk' : 'On Track';
    row.qualityStatus = row._qualityHigh >= 2 ? 'Blocked' : row._qualityOpen >= 3 || row._qualityHigh >= 1 ? 'At Risk' : 'On Track';
    const latest = latestImportByProject.get(row.projectId);
    if (latest) {
      const age = Math.floor((Date.now() - new Date(latest).getTime()) / 86400000);
      row.importAgeDays = age;
      row.importFreshness = age >= 14 ? 'Critical' : age >= 7 ? 'Warning' : 'Fresh';
    }
    const behind = row.actualProgressPct < row.expectedProgressPct - 5 ? 1 : 0;
    row.criticalActionCount = behind + (row._inflowRisk > 0 ? 1 : 0) + (row._outflowRisk > 0 ? 1 : 0) + (row._engOpen > 0 ? 1 : 0) + (row._qualityOpen > 0 ? 1 : 0) + (row._approvalsPending > 0 ? 1 : 0);
  });

  // Apply query-param filters
  const f = opts.filters;
  const includes = (a: unknown, v: string | undefined) => !v || String(a || '').toLowerCase() === v.toLowerCase();
  projects = projects.filter((p) => {
    if (f.search && !String(p.projectName || '').toLowerCase().includes(f.search.toLowerCase())) return false;
    if (!includes(p.portfolio, f.portfolio)) return false;
    if (!includes(p.pm, f.pm)) return false;
    if (!includes(p.pd, f.pd)) return false;
    if (!includes(p.executionPhase, f.executionPhase)) return false;
    if (!includes(p.rag, f.rag)) return false;
    if (f.exceptionOnly && p.criticalActionCount === 0) return false;
    if (f.behindPlanOnly && !(p.actualProgressPct < p.expectedProgressPct - 5)) return false;
    if (f.inflowRiskOnly && !(p._inflowRisk > 0)) return false;
    if (f.outflowRiskOnly && !(p._outflowRisk > 0)) return false;
    if (f.engineeringBlockersOnly && !(p._engOpen > 0)) return false;
    if (f.qualityIssuesOnly && !(p._qualityOpen > 0)) return false;
    if (f.pendingApprovalsOnly && !(p._approvalsPending > 0)) return false;
    if (f.staleImportsOnly && p.importFreshness === 'Fresh') return false;
    return true;
  });

  const visibleProjectNames = new Set(projects.map((p) => String(p.projectName || '').toLowerCase()));
  const visibleProjectIds = new Set(projects.map((p) => Number(p.projectId)).filter((id) => Number.isFinite(id)));
  const visibleProjectInfo = scopedProjectInfo.filter((info) => visibleProjectIds.has(Number(info.id)));

  // ── Excel Program Dashboard parity KPIs ─────────────────────────────────

  // On Schedule Rate (C3): % of visible projects where actual >= expected - 5%
  const onScheduleCount = projects.filter((p) => p.actualProgressPct >= p.expectedProgressPct - 5).length;
  const onScheduleRate = projects.length > 0 ? (onScheduleCount / projects.length) * 100 : 0;

  // Contract Completeness (E3): % with CP signed AND EPC contract signed.
  // cpSigned (boolean) = cost proposal; signedStatus = 'SIGNED' = EPC contract.
  // allProjectInfo already contains these from the left-join with project_execution_state.
  // For visible projects only, use execStateByProjectId (more reliable than merged allProjectInfo).
  const visibleWithBothSigned = [...visibleProjectIds].filter((id) => {
    // Prefer the dedicated execStateByProjectId lookup; fall back to allProjectInfo merge.
    const es = execStateByProjectId.get(id);
    if (es) return es.cpSigned && es.signedStatus === 'SIGNED';
    const info = projectById.get(id);
    return info && info.cpSigned && info.signedStatus === 'SIGNED';
  }).length;
  const contractCompleteness = visibleProjectIds.size > 0
    ? (visibleWithBothSigned / visibleProjectIds.size) * 100
    : 0;

  // Revenue Outstanding this Month (F9): invoiced this month, not yet received.
  let revenueOutstandingThisMonth = 0;
  for (const r of revenueRows) {
    if (!visibleProjectNames.has(String(r.projectName || '').toLowerCase())) continue;
    const invoiceDateKey = (r.invoiceDate || '').slice(0, 10);
    if (!invoiceDateKey || invoiceDateKey.slice(0, 7) !== currentMonthKey) continue;
    const amt = toNum(r.amountExVat);
    const overrideInBank = inBankOverrideSet.has(`${r.projectName}::${r.sourceRow}`);
    const received = overrideInBank || isRevenueSettled({
      paidDate: r.paidDate,
      paidDateConfirmed: r.paidDateConfirmed,
      paidDateFontColor: r.paidDateFontColor,
      inBankDate: r.inBankDate,
      manualInBank: overrideInBank ? 1 : null,
    });
    if (!received) revenueOutstandingThisMonth += amt;
  }

  // COS Outstanding this Month (G9): planned COS this month minus realised COS this month.
  const cosOutstandingThisMonth = cosPlannedMonth - cosRealisedMonth;

  // Project Inflows/Outflows this Week (D9, E9): from cashflow_points for current week.
  // Week start = Monday of the current week.
  const currentDay = new Date(`${today}T00:00:00`);
  const dow = currentDay.getDay();
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(currentDay);
  weekStart.setDate(weekStart.getDate() + daysToMonday);
  const currentWeekKey = weekStart.toISOString().slice(0, 10);

  let projectInflowsThisWeek = 0;
  let projectOutflowsThisWeek = 0;
  for (const cp of cashflowPointRows) {
    if (!visibleProjectNames.has(String(cp.projectName || '').toLowerCase())) continue;
    const pointKey = (cp.pointDate || '').slice(0, 10);
    if (pointKey !== currentWeekKey) continue;
    const seriesLower = String(cp.seriesName || '').toLowerCase();
    const val = toNum(cp.value);
    if (seriesLower.includes('inflow') || seriesLower.includes('planned revenue') || seriesLower === 'actual + planned revenue') {
      projectInflowsThisWeek += val;
    } else if (seriesLower.includes('outflow') || seriesLower.includes('planned expenditure') || seriesLower === 'actual + planned expenditure') {
      projectOutflowsThisWeek += val;
    }
  }

  const monthLabel = (monthKey: string) => {
    try { return format(new Date(`${monthKey}-01T00:00:00`), "MMM yyyy"); } catch { return monthKey; }
  };
  const weekLabel = (dateKey: string) => {
    try { return format(new Date(`${dateKey}T00:00:00`), "dd MMM"); } catch { return dateKey; }
  };
  const toDateKey = (value: unknown) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : null;
  };
  const toMonthKey = (value: unknown) => {
    const dateKey = toDateKey(value);
    return dateKey ? dateKey.slice(0, 7) : null;
  };
  const toWeekStartKey = (value: unknown) => {
    const dateKey = toDateKey(value);
    if (!dateKey) return null;
    const date = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date.toISOString().slice(0, 10);
  };
  const ensureBucket = <T>(map: Map<string, T>, key: string, factory: () => T): T => {
    let v = map.get(key);
    if (v === undefined) { v = factory(); map.set(key, v); }
    return v;
  };

  // ── Chart datasets ───────────────────────────────────────────────────────
  const chartDatasets = (() => {
    const monthlyForecastMap = new Map<string, MonthlyForecastBucket>();
    for (const row of financeRevenueRows) {
      if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
      const monthKey = toMonthKey(row.monthEndDate);
      if (!monthKey || monthKey < fyStart.slice(0, 7) || monthKey > fyEnd.slice(0, 7)) continue;
      const bucket = ensureBucket(monthlyForecastMap, monthKey, () => ({
        periodKey: monthKey, period: monthLabel(monthKey),
        plannedRevenue: 0, plannedCos: 0, grossProfit: 0,
      }));
      bucket.plannedRevenue += toNum(row.value);
    }
    for (const row of financeCosRows) {
      if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
      const monthKey = toMonthKey(row.monthEndDate);
      if (!monthKey || monthKey < fyStart.slice(0, 7) || monthKey > fyEnd.slice(0, 7)) continue;
      const bucket = ensureBucket(monthlyForecastMap, monthKey, () => ({
        periodKey: monthKey, period: monthLabel(monthKey),
        plannedRevenue: 0, plannedCos: 0, grossProfit: 0,
      }));
      bucket.plannedCos += toNum(row.value);
    }
    if (monthlyForecastMap.size === 0) {
      for (const row of revenueRows) {
        if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
        const monthKey = toMonthKey(row.expectedPaymentDate || row.invoiceDate || row.paidDate);
        if (!monthKey || monthKey < fyStart.slice(0, 7) || monthKey > fyEnd.slice(0, 7)) continue;
        const bucket = ensureBucket(monthlyForecastMap, monthKey, () => ({
          periodKey: monthKey, period: monthLabel(monthKey),
          plannedRevenue: 0, plannedCos: 0, grossProfit: 0,
        }));
        bucket.plannedRevenue += toNum(row.amountExVat);
      }
      for (const row of costRows) {
        if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
        const monthKey = toMonthKey(row.approvedDate || row.invoiceDate || row.paidDate);
        if (!monthKey || monthKey < fyStart.slice(0, 7) || monthKey > fyEnd.slice(0, 7)) continue;
        const bucket = ensureBucket(monthlyForecastMap, monthKey, () => ({
          periodKey: monthKey, period: monthLabel(monthKey),
          plannedRevenue: 0, plannedCos: 0, grossProfit: 0,
        }));
        bucket.plannedCos += toNum(row.amountExVat);
      }
    }
    const monthlyForecastRows = Array.from(monthlyForecastMap.values())
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
      .map((row) => ({ ...row, grossProfit: row.plannedRevenue - row.plannedCos }));

    const weeklyCashflowMap = new Map<string, WeeklyCashflowBucket>();
    const cashflowMetricMap: Record<string, string> = {
      "planned revenue": "plannedRevenue",
      "planned expenditure": "plannedExpenditure",
      "planned cashflow": "plannedCashflow",
      "actual cashflow": "actualCashflow",
      "actual + planned revenue": "forecastRevenue",
      "actual + planned expenditure": "forecastExpenditure",
    };
    for (const row of cashflowPointRows) {
      if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
      const pointKey = toDateKey(row.pointDate);
      if (!pointKey || pointKey < fyStart || pointKey > fyEnd) continue;
      const bucket = ensureBucket(weeklyCashflowMap, pointKey, () => ({
        periodKey: pointKey, period: weekLabel(pointKey),
        plannedRevenue: 0, plannedExpenditure: 0, plannedCashflow: 0,
        actualCashflow: 0, forecastRevenue: 0, forecastExpenditure: 0,
      }));
      const metricKey = cashflowMetricMap[String(row.seriesName || '').toLowerCase()];
      if (metricKey) addToNumericField(bucket, metricKey, toNum(row.value));
    }
    if (weeklyCashflowMap.size === 0) {
      for (const row of revenueRows) {
        if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
        const plannedWeekKey = toWeekStartKey(row.expectedPaymentDate || row.invoiceDate || row.paidDate);
        if (plannedWeekKey && plannedWeekKey >= fyStart && plannedWeekKey <= fyEnd) {
          const bucket = ensureBucket(weeklyCashflowMap, plannedWeekKey, () => ({
            periodKey: plannedWeekKey, period: weekLabel(plannedWeekKey),
            plannedRevenue: 0, plannedExpenditure: 0, plannedCashflow: 0,
            actualCashflow: 0, forecastRevenue: 0, forecastExpenditure: 0,
          }));
          bucket.plannedRevenue += toNum(row.amountExVat);
          if (isRevenueSettled({ paidDate: row.paidDate, paidDateConfirmed: row.paidDateConfirmed, paidDateFontColor: row.paidDateFontColor, inBankDate: row.inBankDate })) {
            bucket.actualCashflow += toNum(row.amountExVat);
          }
        }
      }
      for (const row of costRows) {
        if (!visibleProjectNames.has(String(row.projectName || '').toLowerCase())) continue;
        const plannedWeekKey = toWeekStartKey(row.approvedDate || row.invoiceDate || row.paidDate);
        if (plannedWeekKey && plannedWeekKey >= fyStart && plannedWeekKey <= fyEnd) {
          const bucket = ensureBucket(weeklyCashflowMap, plannedWeekKey, () => ({
            periodKey: plannedWeekKey, period: weekLabel(plannedWeekKey),
            plannedRevenue: 0, plannedExpenditure: 0, plannedCashflow: 0,
            actualCashflow: 0, forecastRevenue: 0, forecastExpenditure: 0,
          }));
          bucket.plannedExpenditure += toNum(row.amountExVat);
          // NCL has no in_bank_date column; the prior `(row as any).inBankDate`
          // resolved to undefined at runtime, so it is correctly omitted here.
          if (isRevenueSettled({ paidDate: row.paidDate, paidDateConfirmed: row.paidDateConfirmed, paidDateFontColor: row.paidDateFontColor })) {
            bucket.actualCashflow -= toNum(row.amountExVat);
          }
        }
      }
    }
    const weeklyCashflowRows = Array.from(weeklyCashflowMap.values())
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
      .map((row) => ({
        ...row,
        plannedCashflow: row.plannedCashflow || (row.plannedRevenue - row.plannedExpenditure),
        forecastRevenue: row.forecastRevenue || row.plannedRevenue,
        forecastExpenditure: row.forecastExpenditure || row.plannedExpenditure,
      }));

    const phaseSummaryMap = new Map<string, PhaseSummaryBucket>();
    for (const project of projects) {
      const key = String(project.executionPhase || project.rag || 'Unspecified');
      const bucket = ensureBucket(phaseSummaryMap, key, () => ({
        phase: key, projectCount: 0, contractValue: 0, openInflow: 0,
        openExpenditure: 0, averageProgress: 0, _progressSum: 0,
      }));
      const info = projectById.get(Number(project.projectId));
      bucket.projectCount += 1;
      bucket.contractValue += toNum(info?.contractValue);
      bucket.openInflow += toNum(project.openInflowFy);
      bucket.openExpenditure += toNum(project.openExpenditureFy);
      bucket._progressSum += toNum(project.actualProgressPct);
    }
    const phaseSummaryRows = Array.from(phaseSummaryMap.values())
      .sort((a, b) => b.projectCount - a.projectCount)
      .map((row) => ({
        phase: row.phase, projectCount: row.projectCount, contractValue: row.contractValue,
        openInflow: row.openInflow, openExpenditure: row.openExpenditure,
        averageProgress: row.projectCount ? row._progressSum / row.projectCount : 0,
      }));

    // Build a lookup: pm → project dates for commissioning/client handover/pd→site avg.
    // Uses visibleProjectInfo for the most up-to-date planned dates.
    const pmDateAccumulators = new Map<string, {
      commissioningThisMonth: number;
      clientHandoverThisMonth: number;
      _pdToSiteDaysSum: number;
      _pdToSiteCount: number;
    }>();
    for (const info of visibleProjectInfo) {
      const pmKey = String(info.pm || 'Unassigned');
      if (!pmDateAccumulators.has(pmKey)) {
        pmDateAccumulators.set(pmKey, { commissioningThisMonth: 0, clientHandoverThisMonth: 0, _pdToSiteDaysSum: 0, _pdToSiteCount: 0 });
      }
      const acc = pmDateAccumulators.get(pmKey)!;
      // Commissioning due this month: use actual if present, else planned
      const commDate = toDateKey(info.commissioningActual || info.commissioningDate);
      if (commDate && commDate.slice(0, 7) === currentMonthKey) acc.commissioningThisMonth += 1;
      // Client handover due this month
      const chDate = toDateKey(info.clientHandoverActual || info.clientHandoverDate);
      if (chDate && chDate.slice(0, 7) === currentMonthKey) acc.clientHandoverThisMonth += 1;
      // PD Handover → Site Establishment avg days (Excel E12 formula)
      const pdDate = toDateKey(info.pdHandoverActual || info.pdHandoverDate);
      const siteDate = toDateKey(info.constructionStartActual || info.constructionStartDate);
      if (pdDate && siteDate && siteDate >= pdDate) {
        const diffDays = Math.round((new Date(`${siteDate}T00:00:00`).getTime() - new Date(`${pdDate}T00:00:00`).getTime()) / 86400000);
        acc._pdToSiteDaysSum += diffDays;
        acc._pdToSiteCount += 1;
      }
    }

    const pmSummaryMap = new Map<string, PmSummaryBucket>();
    for (const project of projects) {
      const key = String(project.pm || 'Unassigned');
      const bucket = ensureBucket(pmSummaryMap, key, () => ({
        owner: key, projectCount: 0, contractValue: 0, behindPlanCount: 0,
        onScheduleRate: 0, openInflow: 0, openExpenditure: 0, averageProgress: 0,
        _onScheduleCount: 0, _progressSum: 0,
      }));
      const info = projectById.get(Number(project.projectId));
      bucket.projectCount += 1;
      bucket.contractValue += toNum(info?.contractValue);
      bucket.behindPlanCount += project.actualProgressPct < project.expectedProgressPct - 5 ? 1 : 0;
      bucket._onScheduleCount += project.actualProgressPct >= project.expectedProgressPct - 5 ? 1 : 0;
      bucket.openInflow += toNum(project.openInflowFy);
      bucket.openExpenditure += toNum(project.openExpenditureFy);
      bucket._progressSum += toNum(project.actualProgressPct);
    }
    const pmSummaryRows = Array.from(pmSummaryMap.values())
      .sort((a, b) => b.contractValue - a.contractValue)
      .map((row) => {
        const dateAcc = pmDateAccumulators.get(row.owner);
        return {
          owner: row.owner, projectCount: row.projectCount, contractValue: row.contractValue,
          behindPlanCount: row.behindPlanCount,
          onScheduleRate: row.projectCount ? (row._onScheduleCount / row.projectCount) * 100 : 0,
          openInflow: row.openInflow, openExpenditure: row.openExpenditure,
          averageProgress: row.projectCount ? row._progressSum / row.projectCount : 0,
          // Excel Program Dashboard PM table parity (columns C12, D12, E12)
          commissioningThisMonth: dateAcc?.commissioningThisMonth ?? 0,
          clientHandoverThisMonth: dateAcc?.clientHandoverThisMonth ?? 0,
          avgPdToSiteDays: dateAcc && dateAcc._pdToSiteCount > 0
            ? Math.round(dateAcc._pdToSiteDaysSum / dateAcc._pdToSiteCount)
            : null,
        };
      });

    const milestonePipelineMap = new Map<string, MilestonePipelineBucket>();
    const milestoneFields = [
      { key: "pdHandovers", label: "PD Handover", planned: "pdHandoverDate", actual: "pdHandoverActual" },
      { key: "siteEstablishment", label: "Site Establishment", planned: "constructionStartDate", actual: "constructionStartActual" },
      { key: "commissioning", label: "Commissioning", planned: "commissioningDate", actual: "commissioningActual" },
      { key: "omHandover", label: "O&M Handover", planned: "omHandoverDate", actual: null },
      { key: "clientHandover", label: "Client Handover", planned: "clientHandoverDate", actual: "clientHandoverActual" },
    ];
    for (const info of visibleProjectInfo) {
      for (const field of milestoneFields) {
        const milestoneDate = toDateKey(
          field.actual ? info[field.actual] || info[field.planned] : info[field.planned],
        );
        if (!milestoneDate || milestoneDate < fyStart || milestoneDate > fyEnd) continue;
        const monthKey = milestoneDate.slice(0, 7);
        const bucket = ensureBucket(milestonePipelineMap, monthKey, () => ({
          periodKey: monthKey, period: monthLabel(monthKey),
          pdHandovers: 0, siteEstablishment: 0, commissioning: 0, omHandover: 0, clientHandover: 0,
        }));
        addToNumericField(bucket, field.key, 1);
      }
    }
    const milestonePipelineRows = Array.from(milestonePipelineMap.values())
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey));

    const nextTenDays = new Date(`${today}T00:00:00`);
    nextTenDays.setDate(nextTenDays.getDate() + 10);
    const constructionWindowRows = milestoneFields.map((field) => {
      let next10DaysCount = 0;
      let overdueCount = 0;
      let completedCount = 0;
      for (const info of visibleProjectInfo) {
        const plannedDate = toDateKey(info[field.planned]);
        const actualDate = field.actual ? toDateKey(info[field.actual]) : null;
        const effectiveDate = actualDate || plannedDate;
        if (actualDate) completedCount += 1;
        if (plannedDate && !actualDate && plannedDate < today) overdueCount += 1;
        if (effectiveDate) {
          const date = new Date(`${effectiveDate}T00:00:00`);
          if (!Number.isNaN(date.getTime()) && date >= new Date(`${today}T00:00:00`) && date <= nextTenDays) {
            next10DaysCount += 1;
          }
        }
      }
      return { milestone: field.label, next10Days: next10DaysCount, overdue: overdueCount, completed: completedCount };
    });

    const datasets = [
      {
        id: "monthlyForecast",
        label: "2026 Forecast",
        description: "Monthly revenue, COS, and GP from imported finance pivots with tracker fallback.",
        dimensionKey: "period", dimensionLabel: "Month",
        defaultChartType: "line", allowedChartTypes: ["line", "area", "bar", "composed"],
        metrics: [
          { key: "plannedRevenue", label: "Revenue", format: "currency", color: "#0f766e" },
          { key: "plannedCos", label: "COS", format: "currency", color: "#ea580c" },
          { key: "grossProfit", label: "GP", format: "currency", color: "#1d4ed8" },
        ],
        rows: monthlyForecastRows,
      },
      {
        id: "weeklyCashflow",
        label: "Cashflow Current & Forecast",
        description: "Weekly cashflow built from imported cashflow sheet series with finance-line fallback.",
        dimensionKey: "period", dimensionLabel: "Week",
        defaultChartType: "line", allowedChartTypes: ["line", "area", "bar", "composed"],
        metrics: [
          { key: "actualCashflow", label: "Actual Cashflow", format: "currency", color: "#047857" },
          { key: "plannedCashflow", label: "Planned Cashflow", format: "currency", color: "#2563eb" },
          { key: "plannedRevenue", label: "Planned Revenue", format: "currency", color: "#14b8a6" },
          { key: "plannedExpenditure", label: "Planned Expenditure", format: "currency", color: "#f97316" },
        ],
        rows: weeklyCashflowRows,
      },
      {
        id: "phaseSummary",
        label: "Count of Project Name by Phase",
        description: "Visible project population grouped by execution phase.",
        dimensionKey: "phase", dimensionLabel: "Phase",
        defaultChartType: "bar", allowedChartTypes: ["bar", "line", "area", "composed"],
        metrics: [
          { key: "projectCount", label: "Projects", format: "number", color: "#2563eb" },
          { key: "contractValue", label: "Contract Value", format: "currency", color: "#0f766e" },
          { key: "averageProgress", label: "Avg Progress", format: "percent", color: "#7c3aed" },
        ],
        rows: phaseSummaryRows,
      },
      {
        id: "pmSummary",
        label: "PM Delivery Breakdown",
        description: "Operational PM view: active projects, on-schedule rate, commissioning & handover due this month, and avg PD→Site days (Excel Program Dashboard PM table).",
        dimensionKey: "owner", dimensionLabel: "PM",
        defaultChartType: "bar", allowedChartTypes: ["bar", "line", "area", "composed"],
        metrics: [
          { key: "projectCount", label: "Active Projects", format: "number", color: "#2563eb" },
          { key: "onScheduleRate", label: "On Schedule Rate", format: "percent", color: "#0f766e" },
          { key: "behindPlanCount", label: "Slipping Projects", format: "number", color: "#dc2626" },
          { key: "commissioningThisMonth", label: "Commissioning This Month", format: "number", color: "#f97316" },
          { key: "clientHandoverThisMonth", label: "Handover This Month", format: "number", color: "#7c3aed" },
          { key: "avgPdToSiteDays", label: "Avg PD→Site Days", format: "number", color: "#0891b2" },
          { key: "contractValue", label: "Contract Value", format: "currency", color: "#475569" },
        ],
        rows: pmSummaryRows,
      },
      {
        id: "milestonePipeline",
        label: "Portfolio Timeline",
        description: "Month-by-month milestone pipeline from imported project dates.",
        dimensionKey: "period", dimensionLabel: "Month",
        defaultChartType: "bar", allowedChartTypes: ["bar", "area", "line", "composed"],
        metrics: [
          { key: "pdHandovers", label: "PD Handover", format: "number", color: "#0f766e" },
          { key: "siteEstablishment", label: "Site Establishment", format: "number", color: "#2563eb" },
          { key: "commissioning", label: "Commissioning", format: "number", color: "#f97316" },
          { key: "omHandover", label: "O&M Handover", format: "number", color: "#7c3aed" },
          { key: "clientHandover", label: "Client Handover", format: "number", color: "#dc2626" },
        ],
        rows: milestonePipelineRows,
      },
      {
        id: "constructionWindow",
        label: "Construction Window",
        description: "Upcoming, overdue, and completed milestones from the current execution population.",
        dimensionKey: "milestone", dimensionLabel: "Milestone",
        defaultChartType: "bar", allowedChartTypes: ["bar", "line", "area", "composed"],
        metrics: [
          { key: "next10Days", label: "Next 10 Days", format: "number", color: "#2563eb" },
          { key: "overdue", label: "Overdue", format: "number", color: "#dc2626" },
          { key: "completed", label: "Completed", format: "number", color: "#0f766e" },
        ],
        rows: constructionWindowRows,
      },
    ];

    const presets = [
      { id: "forecast-2026", title: "2026 Forecast", description: "Workbook-style forecast view built from imported monthly finance data.", datasetId: "monthlyForecast", chartType: "line", metricKeys: ["plannedRevenue", "plannedCos", "grossProfit"] },
      { id: "cashflow-current-forecast", title: "Cashflow Current & Forecast", description: "Weekly actual vs planned cashflow from the imported cashflow model.", datasetId: "weeklyCashflow", chartType: "line", metricKeys: ["actualCashflow", "plannedCashflow"] },
      { id: "count-by-phase", title: "Count of Project Name by Phase", description: "Execution phase distribution for the visible project set.", datasetId: "phaseSummary", chartType: "bar", metricKeys: ["projectCount"] },
      { id: "portfolio-timeline", title: "Portfolio Gantt Chart", description: "Milestone pipeline across the portfolio using imported project dates.", datasetId: "milestonePipeline", chartType: "bar", metricKeys: ["pdHandovers", "siteEstablishment", "commissioning", "omHandover", "clientHandover"], stacked: true },
      { id: "construction-window", title: "Construction", description: "Upcoming and overdue execution milestones over the next ten days.", datasetId: "constructionWindow", chartType: "bar", metricKeys: ["next10Days", "overdue", "completed"] },
      { id: "pm-delivery", title: "PM Delivery Breakdown", description: "Operational PM performance from the same filtered project population.", datasetId: "pmSummary", chartType: "bar", metricKeys: ["onScheduleRate", "behindPlanCount"] },
    ];

    return { supportedChartTypes: ["line", "area", "bar", "composed"], presets, datasets };
  })();

  const sum = (field: keyof ProjectAccumulatorRow) =>
    projects.reduce((a, p) => a + toNum(p[field]), 0);
  const avg = (field: keyof ProjectAccumulatorRow) =>
    projects.length ? sum(field) / projects.length : 0;

  // Action-center items carry the project row plus issue annotations.
  type ActionItem = ProjectAccumulatorRow & {
    issueTitle?: string;
    severity?: string;
    owner?: string | null;
    dueDate?: string | null;
  };
  const actionRows = (items: ActionItem[]): DynRow[] => items.map((x) => ({
    projectId: x.projectId,
    project: x.projectName,
    issueTitle: x.issueTitle,
    severity: x.severity,
    owner: x.owner || null,
    dueDate: x.dueDate || null,
    links: {
      project: `/project/${encodeURIComponent(x.projectName)}`,
      plan: `/project/${encodeURIComponent(x.projectName)}?tab=plan`,
      revenue: `/project/${encodeURIComponent(x.projectName)}?tab=revenue-tracking`,
      expenditure: `/project/${encodeURIComponent(x.projectName)}?tab=expenditure`,
    },
  }));

  const fmtR = (v: number) => `R${Math.round(v).toLocaleString()}`;

  const behind = actionRows(projects.filter((p) => p.actualProgressPct < p.expectedProgressPct - 5).map((p) => ({
    ...p, issueTitle: `Actual ${Number(p.actualProgressPct).toFixed(1)}% vs Expected ${Number(p.expectedProgressPct).toFixed(1)}%`,
    severity: (p.expectedProgressPct - p.actualProgressPct) > 15 ? 'Critical' : 'High', owner: p.pm,
  })));
  const inflow = actionRows(projects.filter((p) => p._inflowRisk > 0).map((p) => {
    const openPct = p.plannedRevenueFy > 0 ? Math.round((p.openInflowFy / p.plannedRevenueFy) * 100) : 0;
    return { ...p, issueTitle: `${fmtR(p.openInflowFy)} open of ${fmtR(p.plannedRevenueFy)} planned (${openPct}% outstanding)`, severity: openPct > 60 ? 'Critical' : 'High', owner: p.pm };
  }));
  const outflow = actionRows(projects.filter((p) => p._outflowRisk > 0).map((p) => {
    const openPct = p.plannedExpenditureFy > 0 ? Math.round((p.openExpenditureFy / p.plannedExpenditureFy) * 100) : 0;
    return { ...p, issueTitle: `${fmtR(p.openExpenditureFy)} open of ${fmtR(p.plannedExpenditureFy)} planned (${openPct}% outstanding)`, severity: openPct > 60 ? 'Critical' : 'High', owner: p.pm };
  }));
  const eng = actionRows(projects.filter((p) => p._engOpen > 0).map((p) => ({
    ...p, issueTitle: `${p._engOpen} open engineering blocker${p._engOpen !== 1 ? 's' : ''}`,
    severity: p._engOpen >= 5 ? 'Critical' : 'High', owner: p.pm,
  })));
  const qual = actionRows(projects.filter((p) => p._qualityOpen > 0).map((p) => ({
    ...p, issueTitle: `${p._qualityOpen} open quality issue${p._qualityOpen !== 1 ? 's' : ''}${p._qualityHigh > 0 ? ` (${p._qualityHigh} high)` : ''}`,
    severity: p._qualityHigh >= 2 ? 'Critical' : p._qualityHigh >= 1 ? 'High' : 'Medium', owner: p.pm,
  })));
  const pending = actionRows(projects.filter((p) => p._approvalsPending > 0).map((p) => ({
    ...p, issueTitle: `${p._approvalsPending} pending approval${p._approvalsPending !== 1 ? 's' : ''}`,
    severity: p._approvalsPending >= 3 ? 'Critical' : 'High', owner: p.pm,
  })));

  // Suspicious NULLs: invoice reference present but amount is null (silently coerced to 0).
  let nullCount = 0;
  for (const r of revenueRows) {
    const rawAmt = r.amountExVat;
    const hasAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(parseFloat(String(rawAmt)));
    if (!hasAmt && !!(r.invoiceNumber && String(r.invoiceNumber).trim())) nullCount += 1;
  }
  for (const r of costRows) {
    const rawAmt = r.amountExVat;
    const hasAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(parseFloat(String(rawAmt)));
    if (!hasAmt && !!(r.invoiceNumber && String(r.invoiceNumber).trim())) nullCount += 1;
  }

  return {
    meta: { fyStart, fyEnd },
    kpis: {
      activeDashboardProjects: projects.length,
      averageActualProgressPct: avg('actualProgressPct'),
      averageExpectedProgressPct: avg('expectedProgressPct'),
      projectsBehindPlan: projects.filter((p) => p.actualProgressPct < p.expectedProgressPct - 5).length,
      plannedRevenueFy: sum('plannedRevenueFy'),
      receivedInflowFy: sum('receivedInflowFy'),
      openInflowFy: sum('openInflowFy'),
      plannedExpenditureFy: sum('plannedExpenditureFy'),
      paidExpenditureFy: sum('paidExpenditureFy'),
      openExpenditureFy: sum('openExpenditureFy'),
      grossProfitFy: sum('plannedRevenueFy') - sum('plannedExpenditureFy'),
      grossMarginPctFy: computeMarginPct(sum('plannedRevenueFy'), sum('plannedExpenditureFy'), { precision: 1 }),
      openEngineeringBlockers: sum('_engOpen'),
      openQualityWarnings: sum('_qualityOpen'),
      pendingApprovals: sum('_approvalsPending'),
      staleImports: projects.filter((p) => p.importFreshness !== 'Fresh').length,
      cosPlannedMonth,
      cosRealisedMonth,
      currentMonth: currentMonthKey,
      onScheduleRate,
      contractCompleteness,
      revenueOutstandingThisMonth,
      cosOutstandingThisMonth,
      projectInflowsThisWeek,
      projectOutflowsThisWeek,
    },
    actionCenter: {
      projectsBehindPlan: behind,
      inflowAtRisk: inflow,
      expenditureAtRisk: outflow,
      engineeringBottlenecks: eng,
      qualityIssues: qual,
      pendingApprovalsDecisions: pending,
    },
    // Strip the `_`/`__`-prefixed scratch counters before returning the
    // public project rows (explicit projection avoids unused-binding noise
    // from a discard-destructure).
    projects: projects.map((p) => {
      const publicRow: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p)) {
        if (!k.startsWith("_")) publicRow[k] = v;
      }
      return publicRow;
    }),
    charts: chartDatasets,
    options: {
      portfolios: Array.from(new Set(projects.map((p) => p.portfolio).filter(Boolean))).sort() as string[],
      pms: Array.from(new Set(projects.map((p) => p.pm).filter(Boolean))).sort() as string[],
      pds: Array.from(new Set(projects.map((p) => p.pd).filter(Boolean))).sort() as string[],
      executionPhases: Array.from(new Set(projects.map((p) => p.executionPhase).filter(Boolean))).sort() as string[],
      rags: Array.from(new Set(projects.map((p) => p.rag).filter(Boolean))).sort() as string[],
    },
    nullCount,
  };
}
