import { db } from "../db";
import { normalizedCostLines, normalizedRevenueLines, normalizedPlanTasks } from "@shared/schema";
import type { NormalizedCostLine, NormalizedRevenueLine, NormalizedPlanTask } from "@shared/schema";

export function createNameResolver(projectInfoNames: string[]) {
  const piNames = new Set(projectInfoNames);
  const normMap = new Map<string, string>();
  for (const n of piNames) {
    normMap.set(n.replace(/_Tracker\d*$/i, "").replace(/[_ ]/g, " ").toLowerCase().trim(), n);
  }

  return function resolve(name: string): string {
    if (piNames.has(name)) return name;
    for (const v of [
      name.replace(/ /g, "_") + "_Tracker",
      name + "_Tracker",
      name.replace(/ /g, "_"),
    ]) {
      if (piNames.has(v)) return v;
    }
    const nk = name.replace(/[_ ]/g, " ").toLowerCase().trim();
    const fm = normMap.get(nk);
    if (fm) return fm;
    for (const [pn, pi] of normMap) {
      if (pn.endsWith(nk) || nk.endsWith(pn)) return pi;
    }
    return name;
  };
}

export async function fetchAllNormalized() {
  const [costLines, revenueLines, planTasks] = await Promise.all([
    db.select().from(normalizedCostLines),
    db.select().from(normalizedRevenueLines),
    db.select().from(normalizedPlanTasks),
  ]);
  return { costLines, revenueLines, planTasks };
}

export function adaptCostToExpense(cost: NormalizedCostLine, resolvedName: string): any {
  return {
    id: cost.id + 900000,
    projectName: resolvedName,
    rowType: "item",
    expenseCategory: cost.costCategory || "General",
    expenseLineItem: cost.description,
    expenseInvoiceNumber: cost.invoiceNumber,
    expenseInvoicedDate: cost.invoiceDate,
    expensePaymentDate: cost.paidDate,
    expenseActualTotal: cost.amountExVat,
    expensePoNumber: cost.poNumber,
    budgetTotal: null,
    actualCosTotal: cost.amountExVat,
    forecastPaymentDate: null,
    computedForecastPaymentDate: null,
    computedState: cost.paidDate ? "Paid" : cost.invoiceNumber ? "Invoiced" : cost.poNumber ? "Committed" : "Planned",
    invoiceDateConfirmed: !!cost.invoiceDate,
    paymentDateConfirmed: !!cost.paidDate,
    supplierName: cost.counterpartyName,
    _isNormalized: true,
  };
}

export function adaptRevenueToInflow(rev: NormalizedRevenueLine, resolvedName: string): any {
  return {
    id: rev.id + 900000,
    projectName: resolvedName,
    milestoneName: rev.milestoneName || rev.description,
    milestoneAmount: rev.amountExVat,
    milestoneInvoiceNumber: rev.invoiceNumber,
    invoiceRaisedDate: rev.invoiceDate,
    plannedPaymentDate: rev.expectedPaymentDate,
    paymentReceivedDate: rev.paidDate,
    effectiveDate: rev.paidDate || rev.inBankDate || rev.expectedPaymentDate || rev.invoiceDate,
    _isNormalized: true,
  };
}

export function adaptPlanToProjectPlan(plan: NormalizedPlanTask, resolvedName: string): any {
  return {
    id: plan.id + 900000,
    projectName: resolvedName,
    highLevelProgramme: plan.taskName,
    taskNo: null,
    actualStart: plan.actualStartDate || plan.startDate,
    actualEnd: plan.actualEndDate || plan.endDate,
    percentComplete: plan.pctComplete,
    actualPctComplete: plan.pctComplete,
    expectedProgress: null,
    expectedPctComplete: null,
    owner: plan.owner,
    _isNormalized: true,
  };
}

export interface MergedData {
  expenses: any[];
  inflows: any[];
  plans: any[];
}

export function mergeNormalizedData(
  legacyExpenses: any[],
  legacyInflows: any[],
  legacyPlans: any[],
  normCosts: NormalizedCostLine[],
  normRevenue: NormalizedRevenueLine[],
  normPlans: NormalizedPlanTask[],
  resolve: (name: string) => string
): MergedData {
  const legacyExpProjects = new Set(legacyExpenses.map((e: any) => e.projectName));
  const legacyInflowProjects = new Set(legacyInflows.map((i: any) => i.projectName));
  const legacyPlanProjects = new Set(legacyPlans.map((p: any) => p.projectName));

  const mergedExpenses = [...legacyExpenses];
  for (const cost of normCosts) {
    const rn = resolve(cost.projectName);
    if (legacyExpProjects.has(rn)) continue;
    mergedExpenses.push(adaptCostToExpense(cost, rn));
  }

  const mergedInflows = [...legacyInflows];
  for (const rev of normRevenue) {
    const rn = resolve(rev.projectName);
    if (legacyInflowProjects.has(rn)) continue;
    mergedInflows.push(adaptRevenueToInflow(rev, rn));
  }

  const mergedPlans = [...legacyPlans];
  for (const plan of normPlans) {
    const rn = resolve(plan.projectName);
    if (legacyPlanProjects.has(rn)) continue;
    mergedPlans.push(adaptPlanToProjectPlan(plan, rn));
  }

  return { expenses: mergedExpenses, inflows: mergedInflows, plans: mergedPlans };
}

export function mergeExpensesOnly(
  legacyExpenses: any[],
  normCosts: NormalizedCostLine[],
  resolve: (name: string) => string
): any[] {
  const legacyProjects = new Set(legacyExpenses.map((e: any) => e.projectName));
  const merged = [...legacyExpenses];
  for (const cost of normCosts) {
    const rn = resolve(cost.projectName);
    if (legacyProjects.has(rn)) continue;
    merged.push(adaptCostToExpense(cost, rn));
  }
  return merged;
}

export function mergeInflowsOnly(
  legacyInflows: any[],
  normRevenue: NormalizedRevenueLine[],
  resolve: (name: string) => string
): any[] {
  const legacyProjects = new Set(legacyInflows.map((i: any) => i.projectName));
  const merged = [...legacyInflows];
  for (const rev of normRevenue) {
    const rn = resolve(rev.projectName);
    if (legacyProjects.has(rn)) continue;
    merged.push(adaptRevenueToInflow(rev, rn));
  }
  return merged;
}

export function mergePlansOnly(
  legacyPlans: any[],
  normPlans: NormalizedPlanTask[],
  resolve: (name: string) => string
): any[] {
  const legacyProjects = new Set(legacyPlans.map((p: any) => p.projectName));
  const merged = [...legacyPlans];
  for (const plan of normPlans) {
    const rn = resolve(plan.projectName);
    if (legacyProjects.has(rn)) continue;
    merged.push(adaptPlanToProjectPlan(plan, rn));
  }
  return merged;
}

export function mergeForProject(
  projectName: string,
  legacyExpenses: any[],
  legacyInflows: any[],
  legacyPlans: any[],
  normCosts: NormalizedCostLine[],
  normRevenue: NormalizedRevenueLine[],
  normPlans: NormalizedPlanTask[],
  resolve: (name: string) => string
): MergedData {
  const cleanName = projectName.replace(/_Tracker\d*$/i, "").replace(/[_ ]/g, " ").toLowerCase().trim();

  const projectCosts = normCosts.filter(c => {
    const rn = resolve(c.projectName);
    return rn === projectName || c.projectName === projectName;
  });
  const projectRevenue = normRevenue.filter(r => {
    const rn = resolve(r.projectName);
    return rn === projectName || r.projectName === projectName;
  });
  const projectPlans = normPlans.filter(p => {
    const rn = resolve(p.projectName);
    return rn === projectName || p.projectName === projectName;
  });

  const hasLegacyExpenses = legacyExpenses.length > 0;
  const hasLegacyInflows = legacyInflows.length > 0;
  const hasLegacyPlans = legacyPlans.length > 0;

  return {
    expenses: hasLegacyExpenses ? legacyExpenses : [
      ...legacyExpenses,
      ...projectCosts.map(c => adaptCostToExpense(c, projectName)),
    ],
    inflows: hasLegacyInflows ? legacyInflows : [
      ...legacyInflows,
      ...projectRevenue.map(r => adaptRevenueToInflow(r, projectName)),
    ],
    plans: hasLegacyPlans ? legacyPlans : [
      ...legacyPlans,
      ...projectPlans.map(p => adaptPlanToProjectPlan(p, projectName)),
    ],
  };
}
