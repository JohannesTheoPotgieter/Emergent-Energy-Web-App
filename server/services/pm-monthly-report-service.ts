/**
 * PM Monthly Report — Data Generation Service
 *
 * Generates the full data payload for the PM Monthly Management Report.
 * All financial calculations match dashboard-metrics.ts and report-routes.ts exactly.
 */

import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  projectInfo,
  projectExecutionState,
  clients,
  normalizedRevenueLines,
  normalizedCostLines,
  dashboardProjectMetrics,
  dashboardProgramMetrics,
  workItems,
  raidItems,
  qcChecklist,
  qcItemInstance,
  qcWarning,
  procurementItems,
  counterparties,
  financeRevenueMonthly,
  cashflowPoints,
  users,
  smartImportRuns,
} from "@shared/schema";
import { desc } from "drizzle-orm";

const INACTIVE_STATUSES = ["Cancelled", "Archived", "Complete", "Closed", "Handover Complete", "Completed"];
const COMPLETED_STATUSES = ["COMPLETE", "COMPLETED", "DONE"];
const CANCELLED_STATUSES = ["CANCELLED", "CANCELED"];

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isDateStrInMonth(dateStr: string | null | undefined, monthStartStr: string, monthEndStr: string): boolean {
  if (!dateStr) return false;
  try {
    const normalized = dateStr.substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
    return normalized >= monthStartStr && normalized <= monthEndStr;
  } catch {
    return false;
  }
}

function isTimestampInMonth(ts: Date | string | null | undefined, monthStart: Date, monthEnd: Date): boolean {
  if (!ts) return false;
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d >= monthStart && d <= monthEnd;
}

export function parseMonth(monthStr: string): { monthStart: Date; monthEnd: Date; monthStartStr: string; monthEndStr: string } | null {
  const match = monthStr.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1]);
  const month = parseInt(match[2]);
  if (month < 1 || month > 12) return null;

  const lastDay = new Date(year, month, 0).getDate();
  const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const sast = "+02:00";
  const monthStart = new Date(`${monthStartStr}T00:00:00${sast}`);
  const monthEnd = new Date(`${monthEndStr}T23:59:59.999${sast}`);
  return { monthStart, monthEnd, monthStartStr, monthEndStr };
}

export function getMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
}

export async function generatePmReportData(month: string) {
  const parsed = parseMonth(month);
  if (!parsed) throw new Error("Invalid month format. Use YYYY-MM.");

  const { monthStart, monthEnd, monthStartStr, monthEndStr } = parsed;
  const startTs = Date.now();

  // Fetch all base data in parallel
  const [
    allProjectRows,
    allRevLines,
    allCostLines,
    allMetrics,
    programMetricsRows,
    allWorkItemRows,
    allRaidRows,
    allQcChecklists,
    allQcWarnings,
    allProcurement,
    allClients,
    revenueMonthly,
    cashflowPts,
    allUsers,
    lastImportRows,
  ] = await Promise.all([
    db.select().from(projectInfo).leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id)),
    db.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo)),
    db.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo)),
    db.select().from(dashboardProjectMetrics),
    db.select().from(dashboardProgramMetrics).limit(1),
    db.select().from(workItems).where(isNull(workItems.deletedAt)),
    db.select().from(raidItems),
    db.select().from(qcChecklist),
    db.select().from(qcWarning),
    db.select().from(procurementItems),
    db.select().from(clients),
    db.select().from(financeRevenueMonthly),
    db.select().from(cashflowPoints).where(isNull(cashflowPoints.effectiveTo)),
    db.select({ id: users.id, name: users.name }).from(users),
    db.select({ committedAt: smartImportRuns.committedAt }).from(smartImportRuns)
      .where(eq(smartImportRuns.status, "COMMITTED"))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1),
  ]);

  // Build lookup maps
  const projectMap = new Map(allProjectRows.map(r => [r.project_info.id, { ...r.project_info, ...(r.project_execution_state || {}), id: r.project_info.id }]));
  const clientMap = new Map(allClients.map(c => [c.id, c]));
  const userMap = new Map(allUsers.map(u => [u.id, u.name]));
  const metricsMap = new Map(allMetrics.map(m => [m.projectId, m]));

  // Determine active projects
  const activeProjects = [...projectMap.values()].filter(p => {
    if (!p.isActive) return false;
    const phase = (p.phase || "").trim();
    return !INACTIVE_STATUSES.some(s => s.toLowerCase() === phase.toLowerCase());
  });
  const activeProjectIds = new Set(activeProjects.map(p => p.id));

  // ===== SECTION 1: KPIs =====
  const kpis = {
    activeProjects: activeProjects.length,
    totalContractValue: activeProjects.reduce((sum, p) => sum + toNum(p.contractValue), 0),
    constructionStarts: [...projectMap.values()].filter(p => isDateStrInMonth(p.constructionStartActual, monthStartStr, monthEndStr)).length,
    commissionings: [...projectMap.values()].filter(p => isDateStrInMonth(p.commissioningActual, monthStartStr, monthEndStr)).length,
    pdPmHandovers: [...projectMap.values()].filter(p => isDateStrInMonth(p.pdHandoverActual, monthStartStr, monthEndStr)).length,
    clientHandovers: [...projectMap.values()].filter(p => isDateStrInMonth(p.clientHandoverDate, monthStartStr, monthEndStr)).length,
    totalRevenue: 0,
    totalCost: 0,
    blendedGpMarginPct: 0,
    projectsAtRisk: 0,
    avgHealthScore: 0,
  };

  // Financial KPIs from revenue/cost lines for active projects
  const activeRevLines = allRevLines.filter(r => activeProjectIds.has(r.projectId));
  const activeCostLines = allCostLines.filter(r => activeProjectIds.has(r.projectId));

  kpis.totalRevenue = activeRevLines.reduce((sum, r) => sum + toNum(r.amountExVat), 0);
  kpis.totalCost = activeCostLines.reduce((sum, r) => sum + toNum(r.amountExVat), 0);
  kpis.blendedGpMarginPct = kpis.totalRevenue > 0 ? ((kpis.totalRevenue - kpis.totalCost) / kpis.totalRevenue) * 100 : 0;
  kpis.projectsAtRisk = activeProjects.filter(p => (p.ragStatus || "").toUpperCase() === "RED").length;

  const healthScores = activeProjects.map(p => toNum(metricsMap.get(p.id)?.healthScore)).filter(h => h > 0);
  kpis.avgHealthScore = healthScores.length > 0 ? healthScores.reduce((a, b) => a + b, 0) / healthScores.length : 0;

  // ===== SECTION 2: Financial Summary =====
  // Revenue per project
  const revByProject = new Map<number, typeof allRevLines>();
  for (const r of allRevLines) {
    if (!revByProject.has(r.projectId)) revByProject.set(r.projectId, []);
    revByProject.get(r.projectId)!.push(r);
  }

  const revenueSummary = activeProjects.map(p => {
    const lines = revByProject.get(p.id) || [];
    const totalInvoiced = lines.filter(r => r.invoiceDate).reduce((s, r) => s + toNum(r.amountExVat), 0);
    const totalReceived = lines.filter(r => r.paidDate || r.inBankDate).reduce((s, r) => s + toNum(r.amountExVat), 0);
    const invoicedThisMonth = lines.filter(r => isDateStrInMonth(r.invoiceDate, monthStartStr, monthEndStr)).reduce((s, r) => s + toNum(r.amountExVat), 0);
    const receivedThisMonth = lines.filter(r => isDateStrInMonth(r.paidDate, monthStartStr, monthEndStr)).reduce((s, r) => s + toNum(r.amountExVat), 0);
    return {
      projectId: p.id,
      projectName: p.projectName,
      contractValue: toNum(p.contractValue),
      totalInvoiced,
      totalReceived,
      outstanding: totalInvoiced - totalReceived,
      invoicedThisMonth,
      receivedThisMonth,
    };
  });

  // Cost per project
  const costByProject = new Map<number, typeof allCostLines>();
  for (const c of allCostLines) {
    if (!costByProject.has(c.projectId)) costByProject.set(c.projectId, []);
    costByProject.get(c.projectId)!.push(c);
  }

  const costSummary = activeProjects.map(p => {
    const lines = costByProject.get(p.id) || [];
    const budgetTotal = lines.reduce((s, c) => s + toNum(c.budgetTotal), 0);
    const actualCost = lines.reduce((s, c) => s + toNum(c.amountExVat), 0);
    const cosRealised = lines.filter(c => c.invoiceDateConfirmed && c.invoiceNumber).reduce((s, c) => s + toNum(c.amountExVat), 0);
    const paid = lines.filter(c => c.paidDateConfirmed).reduce((s, c) => s + toNum(c.amountExVat), 0);
    const committed = lines.filter(c => c.poNumber && !(c.invoiceDateConfirmed && c.invoiceNumber)).reduce((s, c) => s + toNum(c.amountExVat), 0);
    const costsThisMonth = lines.filter(c => isDateStrInMonth(c.invoiceDate, monthStartStr, monthEndStr)).reduce((s, c) => s + toNum(c.amountExVat), 0);
    return {
      projectId: p.id,
      projectName: p.projectName,
      budgetTotal,
      actualCost,
      cosRealised,
      committed,
      paid,
      variance: budgetTotal - actualCost,
      costsThisMonth,
    };
  });

  // Gross Profit per project
  const revMap = new Map(revenueSummary.map(r => [r.projectId, r]));
  const costMap = new Map(costSummary.map(c => [c.projectId, c]));

  const grossProfit = activeProjects.map(p => {
    const rev = revMap.get(p.id);
    const cost = costMap.get(p.id);
    const revenue = rev?.totalInvoiced || 0;
    const totalCost = cost?.actualCost || 0;
    const gp = revenue - totalCost;
    const gpMarginPct = revenue > 0 ? (gp / revenue) * 100 : 0;
    const contractValue = toNum(p.contractValue);
    const marginVsContract = contractValue > 0 ? (gp / contractValue) * 100 : 0;
    return {
      projectId: p.id,
      projectName: p.projectName,
      revenue,
      cost: totalCost,
      grossProfit: gp,
      gpMarginPct,
      contractValue,
      marginVsContract,
    };
  });

  // Revenue trend (last 12 months)
  const revenueTrend = revenueMonthly.map(r => ({
    projectName: r.projectName,
    projectId: r.projectId,
    category: r.category,
    monthEndDate: r.monthEndDate,
    value: toNum(r.value),
  }));

  // Cashflow
  const cashflowTrend = cashflowPts.map(c => ({
    projectName: c.projectName,
    projectId: c.projectId,
    seriesName: c.seriesName,
    pointDate: c.pointDate,
    value: toNum(c.value),
  }));

  // ===== SECTION 3: Project Status =====
  const projectStatus = activeProjects.map(p => {
    const m = metricsMap.get(p.id);
    const client = p.clientId ? clientMap.get(p.clientId) : null;
    return {
      projectId: p.id,
      projectName: p.projectName,
      clientName: client?.name || null,
      sizeKwp: toNum(p.sizeKwp),
      phase: p.phase || null,
      ragStatus: p.ragStatus || null,
      ragComment: p.ragComment || null,
      pm: p.pm || null,
      pd: p.pd || null,
      constructionStartPlanned: p.constructionStartDate || null,
      constructionStartActual: p.constructionStartActual || null,
      commissioningPlanned: p.commissioningDate || null,
      commissioningActual: p.commissioningActual || null,
      healthScore: toNum(m?.healthScore),
      taskProgressPct: m && m.taskCount > 0 ? (m.tasksCompleted / m.taskCount) * 100 : 0,
      qcProgressPct: toNum(m?.qcProgressPct) * 100,
    };
  });

  // ===== SECTION 4: Tasks =====
  // Include all workstreams except ENG (engineering has its own report)
  const pmWorkItems = allWorkItemRows.filter(w => activeProjectIds.has(w.projectId) && w.workstream !== "ENG");

  const programmeTaskMetrics = {
    tasksCompletedThisMonth: pmWorkItems.filter(w => {
      if (!w.completedAt) return false;
      return isTimestampInMonth(w.completedAt, monthStart, monthEnd);
    }).length,
    overdueTasks: pmWorkItems.filter(w => {
      const status = (w.status || "").toUpperCase();
      return w.endDate && w.endDate < monthEndStr && !COMPLETED_STATUSES.includes(status) && !CANCELLED_STATUSES.includes(status);
    }).length,
    milestonesAchieved: pmWorkItems.filter(w => w.isMilestone && w.completedAt && isTimestampInMonth(w.completedAt, monthStart, monthEnd)).length,
    totalActiveTasks: pmWorkItems.filter(w => {
      const status = (w.status || "").toUpperCase();
      return !COMPLETED_STATUSES.includes(status) && !CANCELLED_STATUSES.includes(status);
    }).length,
  };

  // Per-project task breakdown
  const tasksByProject = new Map<number, typeof pmWorkItems>();
  for (const w of pmWorkItems) {
    if (!tasksByProject.has(w.projectId)) tasksByProject.set(w.projectId, []);
    tasksByProject.get(w.projectId)!.push(w);
  }

  const perProjectTasks = activeProjects.map(p => {
    const tasks = tasksByProject.get(p.id) || [];
    const total = tasks.length;
    const completed = tasks.filter(t => COMPLETED_STATUSES.includes((t.status || "").toUpperCase())).length;
    const inProgress = tasks.filter(t => (t.status || "").toUpperCase() === "IN PROGRESS").length;
    const overdue = tasks.filter(t => {
      const status = (t.status || "").toUpperCase();
      return t.endDate && t.endDate < monthEndStr && !COMPLETED_STATUSES.includes(status) && !CANCELLED_STATUSES.includes(status);
    }).length;
    return {
      projectId: p.id,
      projectName: p.projectName,
      totalTasks: total,
      completed,
      inProgress,
      overdue,
      completionPct: total > 0 ? (completed / total) * 100 : 0,
    };
  });

  // Resource utilisation
  const resourceMap = new Map<string, { resource: string; assignedTasks: number; completed: number; projects: Set<string> }>();
  for (const t of pmWorkItems) {
    const name = t.ownerName || "Unassigned";
    if (!resourceMap.has(name)) resourceMap.set(name, { resource: name, assignedTasks: 0, completed: 0, projects: new Set() });
    const r = resourceMap.get(name)!;
    r.assignedTasks++;
    if (COMPLETED_STATUSES.includes((t.status || "").toUpperCase())) r.completed++;
    const proj = projectMap.get(t.projectId);
    if (proj) r.projects.add(proj.projectName);
  }

  const resourceUtilisation = [...resourceMap.values()].map(r => ({
    resource: r.resource,
    assignedTasks: r.assignedTasks,
    completed: r.completed,
    projectCount: r.projects.size,
  }));

  // ===== SECTION 5: RAID =====
  const openRaid = allRaidRows.filter(r => r.status === "open");
  const raidWithDetails = openRaid.map(r => {
    const proj = projectMap.get(r.projectId);
    return {
      projectId: r.projectId,
      projectName: proj?.projectName || "",
      type: r.type,
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      ownerName: r.ownerUserId ? (userMap.get(r.ownerUserId) || null) : null,
      dueDate: r.dueDate,
      mitigation: r.mitigationResponse,
    };
  }).sort((a, b) => {
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4);
  });

  // Open QC warnings as quality risks
  const openQcWarnings = allQcWarnings.filter(w => w.status === "open").map(w => ({
    projectId: w.projectId,
    projectName: w.projectName,
    type: "quality_warning" as const,
    title: w.title,
    description: w.description,
    severity: w.severity,
    status: w.status,
  }));

  const raidSummary = {
    items: raidWithDetails,
    qcWarnings: openQcWarnings,
    newThisMonth: allRaidRows.filter(r => isTimestampInMonth(r.createdAt, monthStart, monthEnd)).length,
    closedThisMonth: allRaidRows.filter(r => r.closedAt && isTimestampInMonth(r.closedAt, monthStart, monthEnd)).length,
    overdueItems: openRaid.filter(r => r.dueDate && r.dueDate < monthEndStr).length,
  };

  // ===== SECTION 6: Quality =====
  // QC checklists with instances
  const checklistIds = allQcChecklists.map(c => c.id);
  const allInstances = checklistIds.length > 0
    ? await db.select().from(qcItemInstance).where(inArray(qcItemInstance.checklistId, checklistIds))
    : [];

  const instancesByChecklist = new Map<number, typeof allInstances>();
  for (const inst of allInstances) {
    if (!instancesByChecklist.has(inst.checklistId)) instancesByChecklist.set(inst.checklistId, []);
    instancesByChecklist.get(inst.checklistId)!.push(inst);
  }

  const qcProgress = allQcChecklists.filter(c => activeProjectIds.has(c.projectId)).map(c => {
    const instances = instancesByChecklist.get(c.id) || [];
    const applicable = instances.filter(i => i.isApplicable).length;
    const approved = instances.filter(i => i.isApplicable && i.approved).length;
    const proj = projectMap.get(c.projectId);
    const warnings = allQcWarnings.filter(w => w.projectId === c.projectId && w.status === "open").length;
    return {
      projectId: c.projectId,
      projectName: proj?.projectName || c.projectName,
      checklistStatus: c.status,
      itemsApplicable: applicable,
      itemsApproved: approved,
      progressPct: applicable > 0 ? (approved / applicable) * 100 : 0,
      openWarnings: warnings,
    };
  });

  // ===== SECTION 7: Procurement =====
  const activeProcurement = allProcurement.filter(p => activeProjectIds.has(p.projectId));
  const supplierIds = [...new Set(activeProcurement.map(p => p.supplierId).filter((id): id is number => id != null))];
  const relevantCounterparties = supplierIds.length > 0
    ? await db.select().from(counterparties).where(inArray(counterparties.id, supplierIds))
    : [];
  const counterpartyMap = new Map(relevantCounterparties.map(c => [c.id, c]));

  const procurement = activeProcurement.map(p => {
    const proj = projectMap.get(p.projectId);
    const supplier = p.supplierId ? counterpartyMap.get(p.supplierId) : null;
    return {
      projectId: p.projectId,
      projectName: proj?.projectName || "",
      title: p.title,
      category: p.category,
      expectedCost: p.expectedCost,
      actualCost: p.actualCost,
      supplierName: supplier?.nameCanonical || null,
      status: p.status,
      paymentStatus: p.paymentStatus,
    };
  });

  const duration = Date.now() - startTs;
  console.log(`[PM Monthly Report] Data generation for ${month} took ${duration}ms`);

  const STALENESS_THRESHOLD_DAYS = 7;
  const lastImportAt = lastImportRows[0]?.committedAt || null;
  const daysSinceImport = lastImportAt ? Math.floor((Date.now() - new Date(lastImportAt).getTime()) / (1000 * 60 * 60 * 24)) : -1;

  return {
    meta: {
      month,
      monthLabel: getMonthLabel(month),
      generatedAt: new Date().toISOString(),
      activeProjectCount: activeProjects.length,
      stalenessThresholdDays: STALENESS_THRESHOLD_DAYS,
      lastImportAt: lastImportAt ? new Date(lastImportAt).toISOString() : null,
      daysSinceImport,
      isStale: daysSinceImport < 0 || daysSinceImport > STALENESS_THRESHOLD_DAYS,
    },
    kpis,
    financials: {
      revenueSummary,
      costSummary,
      grossProfit,
      revenueTrend,
      cashflowTrend,
    },
    projectStatus,
    tasks: {
      programmeMetrics: programmeTaskMetrics,
      perProject: perProjectTasks,
      resourceUtilisation,
    },
    raidItems: raidSummary,
    quality: {
      qcProgress,
    },
    procurement,
  };
}
