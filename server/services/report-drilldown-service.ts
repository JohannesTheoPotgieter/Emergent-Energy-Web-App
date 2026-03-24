import { and, eq, isNull, or } from "drizzle-orm";
import ExcelJS from "exceljs";
import {
  projectInfo,
  projectExecutionState,
  normalizedRevenueLines,
  normalizedCostLines,
  workItems,
  raidItems,
  qcWarning,
  procurementItems,
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
  const [projectRows, revenueRows, costRows, taskRows, raidRows, warningRows, procurementRows] = await Promise.all([
    db.select().from(projectInfo).leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id)),
    db.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo)),
    db.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo)),
    db.select().from(workItems).where(and(isNull(workItems.deletedAt), or(eq(workItems.workstream, "PM"), isNull(workItems.workstream)))),
    db.select().from(raidItems),
    db.select().from(qcWarning),
    db.select().from(procurementItems),
  ]);

  const activeProjects = projectRows.map(r => ({ ...r.project_info, ...(r.project_execution_state || {}), id: r.project_info.id })).filter(isActiveProject);
  const activeProjectIds = new Set(activeProjects.map(p => p.id));

  let rows: any[] = [];
  let sourceTables: string[] = [];

  if (filters.tab === "financial" || ["totalRevenue", "totalCost", "blendedGpMarginPct"].includes(filters.metric || "")) {
    if (filters.metric === "totalRevenue") {
      rows = revenueRows.filter(r => activeProjectIds.has(r.projectId)).map(r => ({
        projectId: r.projectId,
        category: r.category,
        amountExVat: Number(r.amountExVat || 0),
        invoiceDate: r.invoiceDate,
        paidDate: r.paidDate,
        status: r.status,
      }));
      sourceTables = ["normalized_revenue_lines"];
    } else {
      rows = costRows.filter(r => activeProjectIds.has(r.projectId)).map(r => ({
        projectId: r.projectId,
        category: r.costCategory,
        supplier: r.counterpartyName,
        amountExVat: Number(r.amountExVat || 0),
        cosStatus: r.cosStatus,
        invoiceDate: r.invoiceDate,
        paidDate: r.paidDate,
      }));
      sourceTables = ["normalized_cost_lines"];
    }
  } else if (filters.tab === "tasks" || ["overdueTasks", "tasksCompletedThisMonth"].includes(filters.metric || "")) {
    rows = taskRows.filter(t => activeProjectIds.has(t.projectId)).map(t => ({
      projectId: t.projectId,
      owner: t.ownerName,
      status: t.status,
      taskName: t.taskName,
      startDate: t.startDate,
      endDate: t.endDate,
      completedAt: t.completedAt ? new Date(t.completedAt).toISOString().substring(0, 10) : null,
      isMilestone: t.isMilestone,
    }));
    sourceTables = ["work_items"];
  } else if (filters.tab === "raid" || filters.metric === "projectsAtRisk") {
    rows = raidRows.filter(r => activeProjectIds.has(r.projectId)).map(r => ({
      projectId: r.projectId,
      type: r.type,
      title: r.title,
      priority: r.priority,
      owner: r.owner,
      status: r.status,
      dueDate: r.dueDate,
    }));
    sourceTables = ["raid_items"];
  } else if (filters.tab === "quality") {
    rows = warningRows.filter(w => activeProjectIds.has(w.projectId)).map(w => ({
      projectId: w.projectId,
      warningType: w.warningType,
      status: w.status,
      message: w.message,
      createdAt: w.createdAt ? new Date(w.createdAt).toISOString().substring(0, 10) : null,
    }));
    sourceTables = ["qc_warning"];
  } else {
    rows = procurementRows.filter(p => activeProjectIds.has(p.projectId)).map(p => ({
      projectId: p.projectId,
      category: p.category,
      title: p.title,
      supplier: p.supplier,
      status: p.status,
      expectedCost: Number(p.expectedCost || 0),
      actualCost: Number(p.actualCost || 0),
      approvalState: p.approvalState,
    }));
    sourceTables = ["procurement_items"];
  }

  rows = withCommonProjectFilters(rows, filters).filter(r => {
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
    const all = await db.select().from(workItems).where(and(isNull(workItems.deletedAt), eq(workItems.workstream, "ENG")));
    rows = all.map(t => ({ projectId: t.projectId, owner: t.ownerName, status: t.status, taskName: t.taskName, startDate: t.startDate, endDate: t.endDate }));
    sourceTables = ["work_items"];
  } else if (filters.tab === "deliverables") {
    const all = await db.select().from(deliverables);
    rows = all.map(d => ({ projectId: d.projectId, title: d.title, type: d.deliverableType, status: d.status, updatedAt: d.updatedAt?.toISOString().substring(0, 10) || null }));
    sourceTables = ["deliverables"];
  } else if (filters.tab === "stages") {
    const all = await db.select().from(projectEngStages);
    rows = all.map(s => ({ projectId: s.projectId, stageTemplateId: s.stageTemplateId, status: s.status, startedAt: s.startedAt?.toISOString().substring(0, 10) || null, completedAt: s.completedAt?.toISOString().substring(0, 10) || null }));
    sourceTables = ["project_eng_stages"];
  } else {
    const all = await db.select().from(projectEngApprovals);
    rows = all.map(a => ({ projectEngStageId: a.projectEngStageId, status: a.status, approvalState: a.status, approverRole: a.approverRole, updatedAt: a.updatedAt?.toISOString().substring(0, 10) || null }));
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
    rows = costs.map(c => ({ projectId: c.projectId, category: c.costCategory, supplier: c.counterpartyName, amountExVat: Number(c.amountExVat || 0), cosStatus: c.cosStatus, invoiceDate: c.invoiceDate, paidDate: c.paidDate }));
    sourceTables = ["normalized_cost_lines"];
  } else if (filters.tab === "quality") {
    rows = warnings.map(w => ({ projectId: w.projectId, warningType: w.warningType, status: w.status, message: w.message, createdAt: w.createdAt?.toISOString().substring(0, 10) || null }));
    sourceTables = ["qc_warning"];
  } else {
    rows = plans.map(p => ({ projectId: p.projectId, owner: p.ownerName, taskName: p.taskName, status: p.status, startDate: p.startDate, endDate: p.endDate, workstream: p.workstream }));
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
