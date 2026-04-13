import { and, desc, eq, isNull } from "drizzle-orm";
import {
  budgetBaselines,
  dashboardProjectMetrics,
  derivedProjectKpis,
  normalizedCostLines,
  normalizedRevenueLines,
  programExpense,
  programInflows,
  projectExecutionState,
  projectInfo,
  projectRevenueSummary,
  projectStageInstances,
  stageDefinitions,
} from "@shared/schema";
import { db } from "../db";
import { isRevenueSettled } from "../lib/finance/revenue-ar-status";
import { computeMarginPct } from "../lib/finance/margin";
import { isCanonicalCosRealised, OVERRIDE_REALISED, OVERRIDE_NOT_REALISED } from "../lib/finance/cos-realisation";
// Post-merge sequence — S04/S05 share the index of their replacement
// so legacy stage references still order correctly.
const STAGE_ORDER = new Map([
  ["S01_FIRST_ASSESSMENT", 1],
  ["S02_DESIGN_COST_PROPOSAL", 2],
  ["S03_SIGNATURE_FINANCIAL_CLOSE", 3],
  ["S04_PD_PM_HANDOVER", 3],
  ["S05_FINANCIAL_REVIEW", 2],
  ["S06_CONSTRUCTION", 4],
  ["S07_COMMISSIONING", 5],
  ["S08_OM_HANDOVER", 6],
  ["S09_CLIENT_HANDOVER", 7],
  ["S10_POST_HANDOVER_REVIEW", 8],
]);

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, decimals = 1): number {
  const power = 10 ** decimals;
  return Math.round(value * power) / power;
}

function toPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function safePct(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function isRevenueRealised(line: { status: string | null; paidDate: string | null; inBankDate: string | null }): boolean {
  return isRevenueSettled({ status: line.status, paidDate: line.paidDate, inBankDate: line.inBankDate });
}

function isCosRealisedLine(line: { cosRealised: boolean | null; cosStatusOverride: string | null; invoiceNumber?: string | null }): boolean {
  return isCanonicalCosRealised({
    status: null,
    cosStatusOverride: line.cosStatusOverride,
    cosRealised: line.cosRealised,
    expenseInvoiceNumber: line.invoiceNumber ?? null,
    expenseInvoicedDate: null,
    expensePoNumber: null,
    paymentDate: null,
    today: new Date().toISOString().slice(0, 10),
  });
}

function stageSequenceFor(stageCode: string | null | undefined, explicitSeq?: number | null): number {
  if (explicitSeq && Number.isFinite(explicitSeq)) return explicitSeq;
  return STAGE_ORDER.get(String(stageCode ?? "")) ?? Number.MAX_SAFE_INTEGER;
}

function buildNextMilestoneLabel(stageCode: string | null, nextRequiredAction: string | null): string {
  const action = String(nextRequiredAction ?? "").trim();
  if (action) return action;
  const code = String(stageCode ?? "").trim();
  return code || "—";
}

export interface ProjectHeaderKpis {
  projectId: number;
  contractValue: number;
  inflowsRealisedPct: number;
  cosRealisedPct: number;
  currentMarginPct: number;
  baselineMarginPct: number;
  marginDeltaPct: number;
  nextMilestone: {
    name: string;
    date: string | null;
    allPaid: boolean;
  };
  source: {
    revenue: "normalized_revenue_lines" | "program_inflows";
    cost: "normalized_cost_lines" | "program_expense";
    baseline: "budget_baselines" | "project_execution_state" | "project_revenue_summary" | "none";
  };
  display: {
    contract: string;
    inflowsRealised: string;
    cosRealised: string;
    marginDelta: string;
    nextMilestone: string;
  };
}

export function computeProjectHeaderKpis(input: {
  projectId: number;
  contractValue: number;
  canonicalRevenueRows: Array<{ amountExVat: unknown; status: string | null; paidDate: string | null; inBankDate: string | null }>;
  inflowFallbackRows: Array<{ milestoneAmount: unknown; paymentReceivedDate: string | null; inBank: unknown }>;
  canonicalCostRows: Array<{ amountExVat: unknown; cosRealised: boolean | null; cosStatusOverride: string | null; invoiceNumber?: string | null }>;
  expenseFallbackRows: Array<{ expenseActualTotal: unknown; actualCosTotal: unknown; expenseInvoiceNumber: string | null; expenseInvoicedDate: string | null; cosStatusOverride: string | null; rowType: string | null }>;
  derivedGrossMarginPct: number;
  budgetBaselineMarginPct?: number | null;
  executionBaselineMarginPct?: number | null;
  summaryBaselineMarginPct?: number | null;
  currentStageCode?: string | null;
  executionNextRequiredAction?: string | null;
  stageRows: Array<{ stageCode: string | null; stageStatus: string | null; targetExitDate: string | null; nextRequiredAction: string | null }>;
  stageDefinitions: Array<{ stageCode: string; stageSequence: number }>;
}): ProjectHeaderKpis {
  const contractValue = toNumber(input.contractValue);
  const canonicalRevenueRows = input.canonicalRevenueRows;
  const inflowFallbackRows = input.inflowFallbackRows;
  const canonicalCostRows = input.canonicalCostRows;
  const expenseFallbackRows = input.expenseFallbackRows;
  const stageRows = input.stageRows;
  const stageDefRows = input.stageDefinitions;
  const hasCanonicalRevenue = canonicalRevenueRows.length > 0;
  const revenueRows = hasCanonicalRevenue
    ? canonicalRevenueRows.map((row) => ({ amount: toNumber(row.amountExVat), realised: isRevenueRealised(row) }))
    : inflowFallbackRows.map((row) => ({ amount: toNumber(row.milestoneAmount), realised: !!row.paymentReceivedDate || Number(row.inBank || 0) === 1 }));

  const revenueTotal = revenueRows.reduce((sum, row) => sum + row.amount, 0);
  const revenueRealised = revenueRows.reduce((sum, row) => sum + (row.realised ? row.amount : 0), 0);

  const hasCanonicalCost = canonicalCostRows.length > 0;
  const costRows = hasCanonicalCost
    ? canonicalCostRows.map((row) => ({ amount: toNumber(row.amountExVat), realised: isCosRealisedLine(row) }))
    : expenseFallbackRows
      .filter((row) => String(row.rowType ?? "item").toLowerCase() === "item")
      .map((row) => {
        const baseAmount = toNumber(row.actualCosTotal) || toNumber(row.expenseActualTotal);
        // Use canonical check: invoice number is the hard gate
        const realised = isCanonicalCosRealised({
          status: null,
          cosStatusOverride: row.cosStatusOverride,
          cosRealised: null,
          expenseInvoiceNumber: row.expenseInvoiceNumber,
          expenseInvoicedDate: row.expenseInvoicedDate,
          expensePoNumber: null,
          paymentDate: null,
          today: new Date().toISOString().slice(0, 10),
        });
        return { amount: baseAmount, realised };
      });

  const costTotal = costRows.reduce((sum, row) => sum + row.amount, 0);
  const costRealised = costRows.reduce((sum, row) => sum + (row.realised ? row.amount : 0), 0);

  const inflowsRealisedPct = round(safePct(revenueRealised, revenueTotal));
  const cosRealisedPct = round(safePct(costRealised, costTotal));

  const computedCurrentMarginPct = computeMarginPct(revenueTotal, costTotal, { precision: 1, zeroRevenueValue: 0 }) ?? 0;
  const derivedMarginPct = toPercent(toNumber(input.derivedGrossMarginPct));
  const currentMarginPct = round(revenueTotal > 0 ? computedCurrentMarginPct : derivedMarginPct);

  const budgetBaselinePct = toPercent(toNumber(input.budgetBaselineMarginPct));
  const executionBaselinePct = toPercent(toNumber(input.executionBaselineMarginPct));
  const plannedBaselinePct = toPercent(toNumber(input.summaryBaselineMarginPct));

  let baselineMarginPct = 0;
  let baselineSource: ProjectHeaderKpis["source"]["baseline"] = "none";
  if (input.budgetBaselineMarginPct != null && Number.isFinite(budgetBaselinePct)) {
    baselineMarginPct = budgetBaselinePct;
    baselineSource = "budget_baselines";
  } else if (input.executionBaselineMarginPct != null && Number.isFinite(executionBaselinePct)) {
    baselineMarginPct = executionBaselinePct;
    baselineSource = "project_execution_state";
  } else if (input.summaryBaselineMarginPct != null && Number.isFinite(plannedBaselinePct)) {
    baselineMarginPct = plannedBaselinePct;
    baselineSource = "project_revenue_summary";
  }

  const marginDeltaPct = round(currentMarginPct - baselineMarginPct);

  const stageSeqByCode = new Map(stageDefRows.map((row) => [row.stageCode, row.stageSequence]));
  const currentStageCode = input.currentStageCode ?? null;
  const currentFromExecution = currentStageCode
    ? stageRows.find((row) => row.stageCode === currentStageCode)
    : null;
  const currentInProgress = currentFromExecution
    || stageRows.find((row) => ["IN_PROGRESS", "READY_FOR_REVIEW", "BLOCKED"].includes(String(row.stageStatus ?? "").toUpperCase()));

  let nextMilestoneName = "—";
  let nextMilestoneDate: string | null = null;

  if (currentInProgress && (currentInProgress.nextRequiredAction || currentInProgress.targetExitDate)) {
    nextMilestoneName = buildNextMilestoneLabel(currentInProgress.stageCode, currentInProgress.nextRequiredAction ?? input.executionNextRequiredAction ?? null);
    nextMilestoneDate = currentInProgress.targetExitDate ? String(currentInProgress.targetExitDate) : null;
  } else {
    const currentStageRef = currentInProgress?.stageCode ?? currentStageCode ?? "";
    const currentSeq = stageSequenceFor(currentInProgress?.stageCode ?? currentStageCode, stageSeqByCode.get(currentStageRef) ?? null);
    const earliestFuture = stageRows
      .filter((row) => !["APPROVED", "PROGRESSED"].includes(String(row.stageStatus ?? "").toUpperCase()))
      .filter((row) => !!row.targetExitDate)
      .filter((row) => stageSequenceFor(row.stageCode, stageSeqByCode.get(row.stageCode ?? "") ?? null) > currentSeq)
      .sort((a, b) => {
        const aSeq = stageSequenceFor(a.stageCode, stageSeqByCode.get(a.stageCode ?? "") ?? null);
        const bSeq = stageSequenceFor(b.stageCode, stageSeqByCode.get(b.stageCode ?? "") ?? null);
        if (aSeq !== bSeq) return aSeq - bSeq;
        return String(a.targetExitDate).localeCompare(String(b.targetExitDate));
      })[0];

    if (earliestFuture) {
      nextMilestoneName = buildNextMilestoneLabel(earliestFuture.stageCode, earliestFuture.nextRequiredAction ?? input.executionNextRequiredAction ?? null);
      nextMilestoneDate = earliestFuture.targetExitDate ? String(earliestFuture.targetExitDate) : null;
    }
  }

  return {
    projectId: input.projectId,
    contractValue,
    inflowsRealisedPct,
    cosRealisedPct,
    currentMarginPct,
    baselineMarginPct: round(baselineMarginPct),
    marginDeltaPct,
    nextMilestone: {
      name: nextMilestoneName,
      date: nextMilestoneDate,
      allPaid: false,
    },
    source: {
      revenue: hasCanonicalRevenue ? "normalized_revenue_lines" : "program_inflows",
      cost: hasCanonicalCost ? "normalized_cost_lines" : "program_expense",
      baseline: baselineSource,
    },
    display: {
      contract: `R${(contractValue / 1_000_000).toFixed(1)}M`,
      inflowsRealised: `${inflowsRealisedPct.toFixed(1)}%`,
      cosRealised: `${cosRealisedPct.toFixed(1)}%`,
      marginDelta: `${marginDeltaPct >= 0 ? "+" : ""}${marginDeltaPct.toFixed(1)}%`,
      nextMilestone: nextMilestoneName,
    },
  };
}

export async function getProjectHeaderKpis(projectId: number): Promise<ProjectHeaderKpis> {
  const [projectRows, canonicalRevenueRows, canonicalCostRows, inflowFallbackRows, expenseFallbackRows, derivedRows, baselineRows, executionRows, revenueSummaryRows, stageRows, stageDefRows] = await Promise.all([
    db.select({ contractValue: projectInfo.contractValue }).from(projectInfo).where(and(eq(projectInfo.id, projectId), isNull(projectInfo.deletedAt))).limit(1),
    db.select({ amountExVat: normalizedRevenueLines.amountExVat, status: normalizedRevenueLines.status, paidDate: normalizedRevenueLines.paidDate, inBankDate: normalizedRevenueLines.inBankDate }).from(normalizedRevenueLines).where(and(eq(normalizedRevenueLines.projectId, projectId), isNull(normalizedRevenueLines.effectiveTo))),
    db.select({ amountExVat: normalizedCostLines.amountExVat, cosRealised: normalizedCostLines.cosRealised, cosStatusOverride: normalizedCostLines.cosStatusOverride, invoiceNumber: normalizedCostLines.invoiceNumber }).from(normalizedCostLines).where(and(eq(normalizedCostLines.projectId, projectId), isNull(normalizedCostLines.effectiveTo))),
    db.select({ milestoneAmount: programInflows.milestoneAmount, paymentReceivedDate: programInflows.paymentReceivedDate, inBank: programInflows.inBank }).from(programInflows).where(and(eq(programInflows.projectId, projectId), isNull(programInflows.effectiveTo))),
    db.select({ expenseActualTotal: programExpense.expenseActualTotal, actualCosTotal: programExpense.actualCosTotal, expenseInvoiceNumber: programExpense.expenseInvoiceNumber, expenseInvoicedDate: programExpense.expenseInvoicedDate, cosStatusOverride: programExpense.cosStatusOverride, rowType: programExpense.rowType }).from(programExpense).where(and(eq(programExpense.projectId, projectId), isNull(programExpense.effectiveTo), isNull(programExpense.deletedAt))),
    db.select({ grossMarginPct: derivedProjectKpis.grossMarginPct }).from(derivedProjectKpis).where(and(eq(derivedProjectKpis.projectId, projectId), isNull(derivedProjectKpis.deletedAt))).limit(1),
    db.select({ marginBaseline: budgetBaselines.marginBaseline, approvedDate: budgetBaselines.approvedDate, createdAt: budgetBaselines.createdAt, version: budgetBaselines.version }).from(budgetBaselines).where(eq(budgetBaselines.projectId, projectId)).orderBy(desc(budgetBaselines.approvedDate), desc(budgetBaselines.createdAt), desc(budgetBaselines.version)).limit(1),
    db.select({ marginBaseline: projectExecutionState.marginBaseline, currentStageCode: projectExecutionState.currentStageCode, nextRequiredAction: projectExecutionState.nextRequiredAction }).from(projectExecutionState).where(and(eq(projectExecutionState.projectId, projectId), isNull(projectExecutionState.deletedAt))).limit(1),
    db.select({ plannedMargin: projectRevenueSummary.plannedMargin }).from(projectRevenueSummary).where(and(eq(projectRevenueSummary.projectId, projectId), isNull(projectRevenueSummary.effectiveTo))).orderBy(desc(projectRevenueSummary.capturedAt)).limit(1),
    db.select({ stageCode: projectStageInstances.stageCode, stageStatus: projectStageInstances.stageStatus, targetExitDate: projectStageInstances.targetExitDate, nextRequiredAction: projectStageInstances.nextRequiredAction }).from(projectStageInstances).where(eq(projectStageInstances.projectId, projectId)),
    db.select({ stageCode: stageDefinitions.stageCode, stageSequence: stageDefinitions.stageSequence }).from(stageDefinitions).where(isNull(stageDefinitions.deletedAt)),
  ]);

  return computeProjectHeaderKpis({
    projectId,
    contractValue: toNumber(projectRows[0]?.contractValue),
    canonicalRevenueRows: canonicalRevenueRows as any,
    inflowFallbackRows: inflowFallbackRows as any,
    canonicalCostRows: canonicalCostRows as any,
    expenseFallbackRows: expenseFallbackRows as any,
    derivedGrossMarginPct: toPercent(toNumber(derivedRows[0]?.grossMarginPct)),
    budgetBaselineMarginPct: baselineRows[0]?.marginBaseline as any,
    executionBaselineMarginPct: executionRows[0]?.marginBaseline as any,
    summaryBaselineMarginPct: revenueSummaryRows[0]?.plannedMargin as any,
    currentStageCode: executionRows[0]?.currentStageCode,
    executionNextRequiredAction: executionRows[0]?.nextRequiredAction,
    stageRows: (stageRows as any[]).map((row) => ({ ...row, targetExitDate: row.targetExitDate ? String(row.targetExitDate) : null })),
    stageDefinitions: stageDefRows as any,
  });
}

export async function recomputeHeaderKpiProjectionForActiveProjects(): Promise<{ refreshed: number }> {
  const activeProjects = await db
    .select({ id: projectInfo.id })
    .from(projectInfo)
    .where(isNull(projectInfo.deletedAt));

  let refreshed = 0;
  for (const project of activeProjects) {
    const kpi = await getProjectHeaderKpis(project.id);
    await db
      .insert(dashboardProjectMetrics)
      .values({
        projectId: project.id,
        contractValue: String(kpi.contractValue),
        marginPct: String(kpi.currentMarginPct / 100),
      } as any)
      .onConflictDoUpdate({
        target: dashboardProjectMetrics.projectId,
        set: {
          contractValue: String(kpi.contractValue),
          marginPct: String(kpi.currentMarginPct / 100),
          lastRefreshedAt: new Date(),
        } as any,
      });
    refreshed += 1;
  }

  return { refreshed };
}
