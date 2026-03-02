import { db } from "../db";
import { normalizedCostLines, normalizedRevenueLines, workItems, projectInfo, type WorkItem } from "@shared/schema";
import type { NormalizedCostLine, NormalizedRevenueLine, NormalizedPlanTask } from "@shared/schema";
import { isNull, eq } from "drizzle-orm";

export function createNameResolver(projectInfoNames: string[]) {
  const piNames = new Set(projectInfoNames);
  const normMap = new Map<string, string>();
  projectInfoNames.forEach(n => {
    normMap.set(n.replace(/_Tracker\d*$/i, "").replace(/[_ ]/g, " ").toLowerCase().trim(), n);
  });

  return function resolve(name: string): string {
    if (piNames.has(name)) return name;
    const variants = [
      name.replace(/ /g, "_") + "_Tracker",
      name + "_Tracker",
      name.replace(/ /g, "_"),
    ];
    for (let i = 0; i < variants.length; i++) {
      if (piNames.has(variants[i])) return variants[i];
    }
    const nk = name.replace(/[_ ]/g, " ").toLowerCase().trim();
    const fm = normMap.get(nk);
    if (fm) return fm;
    const entries = Array.from(normMap.entries());
    for (let i = 0; i < entries.length; i++) {
      const [pn, pi] = entries[i];
      if (pn.endsWith(nk) || nk.endsWith(pn)) return pi;
    }
    return name;
  };
}

export async function fetchAllNormalized() {
  const [costLines, revenueLines, wiRows, piRows] = await Promise.all([
    db.select().from(normalizedCostLines),
    db.select().from(normalizedRevenueLines),
    db.select().from(workItems).where(isNull(workItems.deletedAt)),
    db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
  ]);
  const piNameMap = new Map(piRows.map(p => [p.id, p.projectName]));
  const planTasks: NormalizedPlanTask[] = wiRows.map((wi: WorkItem) => ({
    id: wi.id,
    projectId: wi.projectId,
    projectName: (wi.projectId ? piNameMap.get(wi.projectId) : null) || "",
    taskName: wi.title,
    taskNo: wi.wbsCode,
    phase: wi.type,
    startDate: wi.startDate,
    endDate: wi.endDate,
    durationDays: wi.duration,
    actualStartDate: wi.startDate,
    actualEndDate: wi.endDate,
    actualDurationDays: wi.duration,
    owner: null,
    assigneeUserId: wi.ownerUserId,
    status: wi.status,
    pctComplete: wi.percentComplete,
    expectedPctComplete: null,
    comment: wi.description,
    isMilestone: wi.type === "milestone",
    parentTaskNo: null,
    indentLevel: 0,
    sourceSheet: null,
    sourceRow: null,
    importRunId: 0,
    scheduledDate: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
  }));
  return { costLines, revenueLines, planTasks };
}

export function adaptCostToExpense(cost: NormalizedCostLine, resolvedName: string): any {
  const invoiceDateConfirmed = cost.invoiceDateConfirmed ?? false;
  const paidDateConfirmed = cost.paidDateConfirmed ?? false;
  const invoiceDateFontColor = cost.invoiceDateFontColor ?? null;
  const paymentDateFontColor = cost.paidDateFontColor ?? null;

  const hasInvoice = !!(cost.invoiceNumber);
  const hasInvoiceDate = !!(cost.invoiceDate);
  const hasPO = !!(cost.poNumber);
  const hasPaidDate = !!(cost.paidDate);

  const invoiceDateActual = hasInvoiceDate && (
    invoiceDateConfirmed === true ||
    invoiceDateFontColor === 'black'
  );
  const paidDateActual = hasPaidDate && (
    paidDateConfirmed === true ||
    paymentDateFontColor === 'black'
  );

  let computedState = "Planned";
  if (hasInvoice && hasPaidDate && paidDateActual) computedState = "Paid";
  else if (hasInvoice && hasInvoiceDate && invoiceDateActual) computedState = "Invoiced";
  else if (hasPO || hasInvoice) computedState = "Committed";

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
    computedState,
    invoiceDateConfirmed,
    invoiceDateFontColor,
    paymentDateConfirmed: paidDateConfirmed,
    paymentDateFontColor,
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
    invoiceDateFontColor: rev.invoiceDateFontColor ?? null,
    invoiceDateConfirmed: rev.invoiceDateConfirmed ?? false,
    plannedPaymentDate: rev.expectedPaymentDate,
    paymentReceivedDate: rev.paidDate,
    paidDateFontColor: rev.paidDateFontColor ?? null,
    paidDateConfirmed: rev.paidDateConfirmed ?? false,
    inBankDate: rev.inBankDate,
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
  const legacyProjects = new Set<string>();
  legacyExpenses.forEach((e: any) => {
    legacyProjects.add(e.projectName);
    legacyProjects.add(resolve(e.projectName));
  });
  const merged = [...legacyExpenses];
  for (const cost of normCosts) {
    const rn = resolve(cost.projectName);
    if (legacyProjects.has(rn) || legacyProjects.has(cost.projectName)) continue;
    merged.push(adaptCostToExpense(cost, rn));
  }
  return merged;
}

export function mergeInflowsOnly(
  legacyInflows: any[],
  normRevenue: NormalizedRevenueLine[],
  resolve: (name: string) => string
): any[] {
  const legacyProjects = new Set<string>();
  legacyInflows.forEach((i: any) => {
    legacyProjects.add(i.projectName);
    legacyProjects.add(resolve(i.projectName));
  });
  const merged = [...legacyInflows];
  for (const rev of normRevenue) {
    const rn = resolve(rev.projectName);
    if (legacyProjects.has(rn) || legacyProjects.has(rev.projectName)) continue;
    merged.push(adaptRevenueToInflow(rev, rn));
  }
  return merged;
}

export function mergePlansOnly(
  legacyPlans: any[],
  normPlans: NormalizedPlanTask[],
  resolve: (name: string) => string
): any[] {
  const legacyProjects = new Set<string>();
  legacyPlans.forEach((p: any) => {
    legacyProjects.add(p.projectName);
    legacyProjects.add(resolve(p.projectName));
  });
  const merged = [...legacyPlans];
  for (const plan of normPlans) {
    const rn = resolve(plan.projectName);
    if (legacyProjects.has(rn) || legacyProjects.has(plan.projectName)) continue;
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
