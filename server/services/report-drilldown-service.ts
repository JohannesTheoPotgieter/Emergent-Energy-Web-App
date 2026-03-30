import { and, eq, isNull, or } from "drizzle-orm";
import ExcelJS from "exceljs";
import {
  projectInfo,
  projectExecutionState,
  normalizedRevenueLines,
  normalizedCostLines,
  workItems,
  raidItems,
  qcChecklist,
  qcItemInstance,
  qcWarning,
  procurementItems,
  counterparties,
  deliverables,
  projectEngStages,
  projectEngApprovals,
} from "@shared/schema";
import { db } from "../db";

const INACTIVE_STATUSES = ["Cancelled", "Archived", "Complete", "Closed", "Handover Complete", "Completed"];

export type DrillFilters = {
  tab?: string;
  metric?: string;
  projectId?: number;
  status?: string;
  owner?: string;
  dateFrom?: string;
  dateTo?: string;
  category?: string;
  riskPriority?: string;
  supplier?: string;
  approvalState?: string;
};

function inDateRange(value: string | null | undefined, from?: string, to?: string): boolean {
  if (!value) return false;
  const normalized = value.substring(0, 10);
  if (from && normalized < from) return false;
  if (to && normalized > to) return false;
  return true;
}

function isActiveProject(p: any): boolean {
  if (!p?.isActive) return false;
  const phase = (p.phase || "").trim().toLowerCase();
  return !INACTIVE_STATUSES.some(s => s.toLowerCase() === phase);
}

function withCommonProjectFilters<T extends { projectId?: number; projectName?: string }>(rows: T[], filters: DrillFilters): T[] {
  return rows.filter(r => {
    if (filters.projectId && r.projectId !== filters.projectId) return false;
    return true;
  });
}

function computeAggregates(rows: any[]) {
  const numericSums: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        numericSums[key] = (numericSums[key] || 0) + value;
      }
    }
  }
  return {
    rowCount: rows.length,
    sums: numericSums,
  };
}

export async function getPmDrilldownRows(filters: DrillFilters) {
  const [projectRows, revenueRows, costRows, taskRows, raidRows, warningRows, checklistRows, qcItemRows, procurementRows, counterpartiesRows] = await Promise.all([
    db.select().from(projectInfo).leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id)),
    db.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo)),
    db.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo)),
    db.select().from(workItems).where(and(isNull(workItems.deletedAt), or(eq(workItems.workstream, "PM"), isNull(workItems.workstream)))),
    db.select().from(raidItems),
    db.select().from(qcWarning),
    db.select().from(qcChecklist),
    db.select().from(qcItemInstance),
    db.select().from(procurementItems),
    db.select().from(counterparties),
  ]);

  const activeProjects = projectRows.map((r: any) => ({ ...r.project_info, ...(r.project_execution_state || {}), id: r.project_info.id })).filter(isActiveProject);
  const activeProjectIds = new Set(activeProjects.map((p: any) => p.id));

  let rows: any[] = [];
  let sourceTables: string[] = [];

  if (filters.tab === "financial" || ["totalRevenue", "totalCost", "blendedGpMarginPct", "revenue", "cost", "revenueBridge", "costBridge", "gpBridge"].includes(filters.metric || "")) {
    if (["totalRevenue", "revenue", "revenueBridge"].includes(filters.metric || "")) {
      rows = revenueRows.filter((r: any) => activeProjectIds.has(r.projectId)).map((r: any) => ({
        source: "normalized_revenue_lines",
        projectId: r.projectId,
        projectName: r.projectName,
        category: r.category,
        amountExVat: Number(r.amountExVat || 0),
        vat: Number(r.vat || 0),
        invoiceNumber: r.invoiceNumber,
        description: r.description,
        invoiceDate: r.invoiceDate,
        inBankDate: r.inBankDate,
        paidDate: r.paidDate,
        status: r.status,
      }));
      sourceTables = ["normalized_revenue_lines"];
    } else {
      rows = costRows.filter((r: any) => activeProjectIds.has(r.projectId)).map((r: any) => ({
        source: "normalized_cost_lines",
        projectId: r.projectId,
        projectName: r.projectName,
        category: r.costCategory,
        supplier: r.counterpartyName,
        amountExVat: Number(r.amountExVat || 0),
        poNumber: r.poNumber,
        invoiceNumber: r.invoiceNumber,
        cosStatus: r.cosStatus,
        invoiceDate: r.invoiceDate,
        paidDate: r.paidDate,
        forecastPaymentDate: r.forecastPaymentDate,
      }));
      sourceTables = ["normalized_cost_lines"];
    }
  } else if (filters.tab === "tasks" || ["overdueTasks", "tasksCompletedThisMonth"].includes(filters.metric || "")) {
    rows = taskRows.filter((t: any) => activeProjectIds.has(t.projectId)).map((t: any) => ({
      source: "work_items",
      projectId: t.projectId,
      owner: t.ownerName,
      status: t.status,
      taskName: t.title || t.taskName,
      phase: t.phase,
      startDate: t.startDate,
      endDate: t.endDate,
      completedAt: t.completedAt ? new Date(t.completedAt).toISOString().substring(0, 10) : null,
      isMilestone: t.isMilestone,
      agingDays: t.endDate ? Math.max(0, Math.floor((Date.now() - new Date(`${t.endDate}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24))) : 0,
      sourceRow: t.sourceRow,
      sourceFileName: t.sourceFileName,
    }));
    sourceTables = ["work_items"];
  } else if (filters.tab === "raid" || filters.metric === "projectsAtRisk") {
    rows = raidRows.filter((r: any) => activeProjectIds.has(r.projectId)).map((r: any) => ({
      source: "raid_items",
      projectId: r.projectId,
      type: r.type,
      title: r.title,
      mitigation: r.mitigationResponse,
      priority: r.priority,
      owner: r.owner,
      status: r.status,
      dueDate: r.dueDate,
      ageDays: r.createdAt ? Math.floor((Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0,
    }));
    sourceTables = ["raid_items"];
  } else if (filters.tab === "quality") {
    const checklistMapped = checklistRows
      .filter((c: any) => activeProjectIds.has(c.projectId))
      .map((c: any) => ({
        source: "qc_checklist",
        recordType: "checklist",
        projectId: c.projectId,
        projectName: c.projectName,
        checklistId: c.id,
        checklistStatus: c.status,
        createdAt: c.createdAt ? new Date(c.createdAt).toISOString().substring(0, 10) : null,
      }));
    const qcItemsMapped = qcItemRows.map((i: any) => ({
      source: "qc_item_instance",
      recordType: "item",
      checklistId: i.checklistId,
      templateItemId: i.templateItemId,
      isApplicable: i.isApplicable,
      approved: i.approved,
      approvalStatus: i.approved ? "approved" : "open",
      startDate: i.startDate,
      endDate: i.endDate,
    }));
    const checklistById: Map<number, any> = new Map(checklistRows.map((c: any) => [c.id, c]));
    const itemRowsWithProject = qcItemsMapped
      .map((i: any) => ({ ...i, projectId: checklistById.get(i.checklistId)?.projectId, projectName: checklistById.get(i.checklistId)?.projectName }))
      .filter((i: any) => i.projectId && activeProjectIds.has(i.projectId));
    const warningMapped = warningRows.filter((w: any) => activeProjectIds.has(w.projectId)).map((w: any) => ({
      source: "qc_warning",
      recordType: "warning",
      projectId: w.projectId,
      projectName: w.projectName,
      warningType: w.warningType,
      status: w.status,
      title: w.title,
      message: w.description,
      severity: w.severity,
      createdAt: w.createdAt ? new Date(w.createdAt).toISOString().substring(0, 10) : null,
    }));
    rows = [...checklistMapped, ...itemRowsWithProject, ...warningMapped];
    sourceTables = ["qc_checklist", "qc_item_instance", "qc_warning"];
  } else {
    const supplierMap = new Map(counterpartiesRows.map((c: any) => [c.id, c.nameCanonical || c.nameDisplay || `Supplier ${c.id}`]));
    rows = procurementRows.filter((p: any) => activeProjectIds.has(p.projectId)).map((p: any) => ({
      source: "procurement_items",
      projectId: p.projectId,
      category: p.category,
      title: p.title,
      supplier: p.supplierId ? supplierMap.get(p.supplierId) : null,
      status: p.status,
      expectedCost: Number(p.expectedCost || 0),
      actualCost: Number(p.actualCost || 0),
      paymentStatus: p.paymentStatus,
      approvalState: p.approvalState,
    }));
    sourceTables = ["procurement_items"];
  }

  rows = withCommonProjectFilters(rows, filters).filter(r => {
    if (filters.metric === "overdueTasks") {
      const endDate = r.endDate;
      if (!endDate) return false;
      if (["done", "complete", "completed"].includes(String(r.status || "").toLowerCase())) return false;
      return endDate < new Date().toISOString().substring(0, 10);
    }
    if (filters.metric === "projectsAtRisk" && !["critical", "high"].includes(String(r.priority || "").toLowerCase())) return false;
    if (filters.status && String(r.status || r.cosStatus || "").toLowerCase() !== filters.status.toLowerCase()) return false;
    if (filters.owner && String(r.owner || "").toLowerCase() !== filters.owner.toLowerCase()) return false;
    if (filters.category && String(r.category || "").toLowerCase() !== filters.category.toLowerCase()) return false;
    if (filters.riskPriority && String(r.priority || "").toLowerCase() !== filters.riskPriority.toLowerCase()) return false;
    if (filters.supplier && String(r.supplier || "").toLowerCase() !== filters.supplier.toLowerCase()) return false;
    if (filters.approvalState && String(r.approvalState || "").toLowerCase() !== filters.approvalState.toLowerCase()) return false;
    const dateValue = r.date || r.invoiceDate || r.paidDate || r.endDate || r.createdAt || r.completedAt;
    if ((filters.dateFrom || filters.dateTo) && !inDateRange(dateValue, filters.dateFrom, filters.dateTo)) return false;
    return true;
  });

  return { rows, sourceTables, aggregates: computeAggregates(rows) };
}

export async function getEngineeringDrilldownRows(filters: DrillFilters) {
  let rows: any[] = [];
  let sourceTables: string[] = [];

  if (filters.tab === "tasks" || ["totalEngineeringTasks", "openBlockers"].includes(filters.metric || "")) {
    const [allTasks, projectRows] = await Promise.all([
      db.select().from(workItems).where(and(isNull(workItems.deletedAt), eq(workItems.workstream, "ENG"))),
      db.select().from(projectInfo).leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id)),
    ]);
    const projectMap: Map<number, any> = new Map(projectRows.map((r: any) => [r.project_info.id, r.project_info.projectName]));
    rows = allTasks.map((t: any) => ({
      source: "work_items",
      rowId: t.id,
      projectId: t.projectId,
      projectName: projectMap.get(t.projectId) || "",
      owner: t.ownerName,
      status: t.status,
      taskName: t.title || t.taskName,
      blockerReason: t.blockerReason || t.holdReason,
      priority: t.priority,
      startDate: t.startDate,
      endDate: t.endDate,
      completedAt: t.completedAt ? t.completedAt.toISOString().substring(0, 10) : null,
      agingDays: t.endDate ? Math.max(0, Math.floor((Date.now() - new Date(`${t.endDate}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24))) : 0,
      sourceRow: t.sourceRow,
      sourceSheet: t.sourceSheet,
    }));
    sourceTables = ["work_items"];
  } else if (filters.tab === "deliverables") {
    const all = await db.select().from(deliverables);
    rows = all.map((d: any) => ({
      source: "deliverables",
      rowId: d.id,
      projectId: d.projectId,
      projectName: d.projectName,
      title: d.title,
      type: d.deliverableType,
      status: d.status,
      currentVersion: d.currentVersion,
      ownerUserId: d.ownerUserId,
      reviewerUserId: d.reviewerUserId,
      createdAt: d.createdAt?.toISOString().substring(0, 10) || null,
      updatedAt: d.updatedAt?.toISOString().substring(0, 10) || null,
    }));
    sourceTables = ["deliverables"];
  } else if (filters.tab === "stages") {
    const [allStages, projectRows] = await Promise.all([
      db.select().from(projectEngStages),
      db.select().from(projectInfo).leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id)),
    ]);
    const projectMap = new Map(projectRows.map((r: any) => [r.project_info.id, r.project_info.projectName]));
    rows = allStages.map((s: any) => ({
      source: "project_eng_stages",
      rowId: s.id,
      projectId: s.projectId,
      projectName: projectMap.get(s.projectId) || "",
      stageTemplateId: s.stageTemplateId,
      status: s.status,
      overrideReason: s.overrideReason,
      startedAt: s.startedAt?.toISOString().substring(0, 10) || null,
      completedAt: s.completedAt?.toISOString().substring(0, 10) || null,
      createdAt: s.createdAt?.toISOString().substring(0, 10) || null,
    }));
    sourceTables = ["project_eng_stages"];
  } else {
    const [allApprovals, allStages, allProjects] = await Promise.all([
      db.select().from(projectEngApprovals),
      db.select().from(projectEngStages),
      db.select().from(projectInfo),
    ]);
    const stageMap = new Map(allStages.map((s: any) => [s.id, s]));
    const projectMap = new Map(allProjects.map((p: any) => [p.id, p.projectName]));
    rows = allApprovals.map((a: any) => {
      const stage: any = stageMap.get(a.projectEngStageId);
      return {
        source: "project_eng_approvals",
        rowId: a.id,
        projectEngStageId: a.projectEngStageId,
        projectId: stage?.projectId,
        projectName: stage ? projectMap.get(stage.projectId) || "" : "",
        status: a.status,
        approvalState: a.status,
        approverRole: a.approverRole,
        approverUserId: a.approverUserId,
        comments: a.comments,
        createdAt: a.createdAt?.toISOString().substring(0, 10) || null,
        updatedAt: a.updatedAt?.toISOString().substring(0, 10) || null,
      };
    });
    sourceTables = ["project_eng_approvals"];
  }

  rows = withCommonProjectFilters(rows, filters).filter(r => {
    if (filters.status && String(r.status || "").toLowerCase() !== filters.status.toLowerCase()) return false;
    if (filters.owner && String(r.owner || "").toLowerCase() !== filters.owner.toLowerCase()) return false;
    if (filters.approvalState && String(r.approvalState || "").toLowerCase() !== filters.approvalState.toLowerCase()) return false;
    const dateValue = r.updatedAt || r.endDate || r.completedAt || r.startedAt;
    if ((filters.dateFrom || filters.dateTo) && !inDateRange(dateValue, filters.dateFrom, filters.dateTo)) return false;
    return true;
  });

  return { rows, sourceTables, aggregates: computeAggregates(rows) };
}

export async function getProgrammeDrilldownRows(filters: DrillFilters) {
  const [costs, plans, warnings] = await Promise.all([
    db.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo)),
    db.select().from(workItems).where(isNull(workItems.deletedAt)),
    db.select().from(qcWarning),
  ]);

  let rows: any[];
  let sourceTables: string[];

  if (filters.tab === "cost") {
    rows = costs.map((c: any) => ({ projectId: c.projectId, category: c.costCategory, supplier: c.counterpartyName, amountExVat: Number(c.amountExVat || 0), cosStatus: c.cosStatus, invoiceDate: c.invoiceDate, paidDate: c.paidDate }));
    sourceTables = ["normalized_cost_lines"];
  } else if (filters.tab === "quality") {
    rows = warnings.map((w: any) => ({ projectId: w.projectId, warningType: w.warningType, status: w.status, message: w.message, createdAt: w.createdAt?.toISOString().substring(0, 10) || null }));
    sourceTables = ["qc_warning"];
  } else {
    rows = plans.map((p: any) => ({ projectId: p.projectId, owner: p.ownerName, taskName: p.taskName, status: p.status, startDate: p.startDate, endDate: p.endDate, workstream: p.workstream }));
    sourceTables = ["work_items"];
  }

  rows = withCommonProjectFilters(rows, filters);
  return { rows, sourceTables, aggregates: computeAggregates(rows) };
}

export async function writeDrilldownExcel(res: any, filename: string, payload: { rows: any[]; aggregates: any; appliedFilters: Record<string, any>; sourceTables: string[] }) {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("Summary");
  summary.addRow(["Generated At", new Date().toISOString()]);
  summary.addRow(["Source Tables", payload.sourceTables.join(", ")]);
  summary.addRow(["Row Count", payload.aggregates.rowCount]);
  summary.addRow([]);
  summary.addRow(["Applied Filters", JSON.stringify(payload.appliedFilters)]);

  const details = workbook.addWorksheet("Detail Rows");
  const cols = Object.keys(payload.rows[0] || {});
  details.columns = cols.map(c => ({ header: c, key: c, width: 24 }));
  for (const row of payload.rows) details.addRow(row);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  await workbook.xlsx.write(res);
  res.end();
}
