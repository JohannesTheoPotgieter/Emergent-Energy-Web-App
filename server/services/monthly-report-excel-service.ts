/**
 * Monthly Report Excel Generation Service
 * Uses exceljs to generate multi-sheet branded workbooks.
 */

import ExcelJS from "exceljs";
import type { Response } from "express";
import { getMonthLabel } from "./pm-monthly-report-service";

const EE_GREEN_ARGB = "FF1A5C3A";
const WHITE_ARGB = "FFFFFFFF";
const RED_ARGB = "FFDC3545";
const AMBER_ARGB = "FFFFC107";
const GREEN_ARGB = "FF28A745";

function ragFill(rag: string | null): ExcelJS.Fill | undefined {
  const upper = (rag || "").toUpperCase();
  if (upper === "RED") return { type: "pattern", pattern: "solid", fgColor: { argb: RED_ARGB } };
  if (upper === "AMBER") return { type: "pattern", pattern: "solid", fgColor: { argb: AMBER_ARGB } };
  if (upper === "GREEN") return { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_ARGB } };
  return undefined;
}

function styleHeaderRow(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: WHITE_ARGB } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EE_GREEN_ARGB } };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 22;
}

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Array<{ header: string; key: string; width?: number }>, rows: any[]) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  for (const row of rows) sheet.addRow(row);
  styleHeaderRow(sheet);
  return sheet;
}

export async function generateReportExcel(reportType: string, data: any, month: string, res: Response) {
  const workbook = new ExcelJS.Workbook();
  const monthLabel = getMonthLabel(month);

  if (reportType === "pm") {
    generatePmExcel(workbook, data, monthLabel);
  } else {
    generateEngineeringExcel(workbook, data, monthLabel);
  }

  const filename = reportType === "pm"
    ? `PM_Monthly_Report_${month}.xlsx`
    : `Engineering_Monthly_Report_${month}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

function generatePmExcel(workbook: ExcelJS.Workbook, data: any, monthLabel: string) {
  const kpis = data.kpis || {};

  // Summary KPIs sheet
  const summarySheet = workbook.addWorksheet("Summary KPIs");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 30 },
    { header: "Value", key: "value", width: 25 },
  ];
  const kpiRows = [
    { metric: "Report Month", value: monthLabel },
    { metric: "Active Projects", value: kpis.activeProjects ?? 0 },
    { metric: "Total Contract Value", value: kpis.totalContractValue ?? 0 },
    { metric: "Construction Starts", value: kpis.constructionStarts ?? 0 },
    { metric: "Commissionings", value: kpis.commissionings ?? 0 },
    { metric: "Total Revenue", value: kpis.totalRevenue ?? 0 },
    { metric: "Total Cost", value: kpis.totalCost ?? 0 },
    { metric: "Blended GP Margin %", value: kpis.blendedGpMarginPct ? `${kpis.blendedGpMarginPct.toFixed(1)}%` : "0%" },
    { metric: "Projects at Risk", value: kpis.projectsAtRisk ?? 0 },
    { metric: "Avg Health Score", value: kpis.avgHealthScore ? kpis.avgHealthScore.toFixed(1) : "0" },
  ];
  for (const row of kpiRows) summarySheet.addRow(row);
  styleHeaderRow(summarySheet);

  // Revenue sheet
  addSheet(workbook, "Revenue", [
    { header: "Project", key: "projectName", width: 30 },
    { header: "Contract Value", key: "contractValue", width: 18 },
    { header: "Total Invoiced", key: "totalInvoiced", width: 18 },
    { header: "Total Received", key: "totalReceived", width: 18 },
    { header: "Outstanding", key: "outstanding", width: 18 },
    { header: "Invoiced This Month", key: "invoicedThisMonth", width: 20 },
    { header: "Received This Month", key: "receivedThisMonth", width: 20 },
  ], data.financials?.revenueSummary || []);

  // Costs sheet
  addSheet(workbook, "Costs", [
    { header: "Project", key: "projectName", width: 30 },
    { header: "Budget Total", key: "budgetTotal", width: 18 },
    { header: "Actual Cost", key: "actualCost", width: 18 },
    { header: "COS Realised", key: "cosRealised", width: 18 },
    { header: "Committed", key: "committed", width: 18 },
    { header: "Paid", key: "paid", width: 18 },
    { header: "Variance", key: "variance", width: 18 },
    { header: "Costs This Month", key: "costsThisMonth", width: 18 },
  ], data.financials?.costSummary || []);

  // Gross Profit sheet
  addSheet(workbook, "Gross Profit", [
    { header: "Project", key: "projectName", width: 30 },
    { header: "Revenue", key: "revenue", width: 18 },
    { header: "Cost", key: "cost", width: 18 },
    { header: "Gross Profit", key: "grossProfit", width: 18 },
    { header: "GP Margin %", key: "gpMarginPct", width: 14 },
    { header: "Contract Value", key: "contractValue", width: 18 },
    { header: "Margin vs Contract %", key: "marginVsContract", width: 20 },
  ], data.financials?.grossProfit || []);

  // Project Status sheet
  const psSheet = addSheet(workbook, "Project Status", [
    { header: "Project", key: "projectName", width: 30 },
    { header: "Client", key: "clientName", width: 20 },
    { header: "Size kWp", key: "sizeKwp", width: 12 },
    { header: "Phase", key: "phase", width: 18 },
    { header: "RAG", key: "ragStatus", width: 10 },
    { header: "PM", key: "pm", width: 18 },
    { header: "PD", key: "pd", width: 18 },
    { header: "Health Score", key: "healthScore", width: 14 },
    { header: "Task Progress %", key: "taskProgressPct", width: 16 },
    { header: "QC Progress %", key: "qcProgressPct", width: 14 },
  ], data.projectStatus || []);

  // Apply RAG colors
  const statusRows = data.projectStatus || [];
  for (let i = 0; i < statusRows.length; i++) {
    const fill = ragFill(statusRows[i].ragStatus);
    if (fill) {
      psSheet.getRow(i + 2).getCell(5).fill = fill;
      psSheet.getRow(i + 2).getCell(5).font = { color: { argb: WHITE_ARGB }, bold: true };
    }
  }

  // Tasks sheet
  addSheet(workbook, "Tasks", [
    { header: "Project", key: "projectName", width: 30 },
    { header: "Total Tasks", key: "totalTasks", width: 12 },
    { header: "Completed", key: "completed", width: 12 },
    { header: "In Progress", key: "inProgress", width: 14 },
    { header: "Overdue", key: "overdue", width: 12 },
    { header: "Completion %", key: "completionPct", width: 14 },
  ], data.tasks?.perProject || []);

  // Resources sheet
  addSheet(workbook, "Resource Allocation", [
    { header: "Resource", key: "resource", width: 25 },
    { header: "Assigned Tasks", key: "assignedTasks", width: 14 },
    { header: "Completed", key: "completed", width: 12 },
    { header: "Projects", key: "projectCount", width: 12 },
  ], data.tasks?.resourceUtilisation || []);

  // RAID sheet
  addSheet(workbook, "RAID", [
    { header: "Project", key: "projectName", width: 25 },
    { header: "Type", key: "type", width: 14 },
    { header: "Title", key: "title", width: 35 },
    { header: "Priority", key: "priority", width: 12 },
    { header: "Status", key: "status", width: 12 },
    { header: "Owner", key: "ownerName", width: 18 },
    { header: "Due Date", key: "dueDate", width: 14 },
    { header: "Mitigation", key: "mitigation", width: 35 },
  ], data.raidItems?.items || []);

  // Quality sheet
  addSheet(workbook, "Quality", [
    { header: "Project", key: "projectName", width: 30 },
    { header: "Checklist Status", key: "checklistStatus", width: 16 },
    { header: "Items Applicable", key: "itemsApplicable", width: 16 },
    { header: "Items Approved", key: "itemsApproved", width: 14 },
    { header: "Progress %", key: "progressPct", width: 12 },
    { header: "Open Warnings", key: "openWarnings", width: 16 },
  ], data.quality?.qcProgress || []);

  // Procurement sheet
  addSheet(workbook, "Procurement", [
    { header: "Project", key: "projectName", width: 25 },
    { header: "Item", key: "title", width: 30 },
    { header: "Category", key: "category", width: 14 },
    { header: "Expected Cost", key: "expectedCost", width: 16 },
    { header: "Actual Cost", key: "actualCost", width: 16 },
    { header: "Supplier", key: "supplierName", width: 20 },
    { header: "Status", key: "status", width: 14 },
    { header: "Payment Status", key: "paymentStatus", width: 16 },
  ], data.procurement || []);
}

function generateEngineeringExcel(workbook: ExcelJS.Workbook, data: any, monthLabel: string) {
  const kpis = data.kpis || {};

  // Summary KPIs
  const summarySheet = workbook.addWorksheet("Summary KPIs");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 30 },
    { header: "Value", key: "value", width: 25 },
  ];
  const kpiRows = [
    { metric: "Report Month", value: monthLabel },
    { metric: "Total Engineering Tasks", value: kpis.totalEngineeringTasks ?? 0 },
    { metric: "Tasks Completed This Month", value: kpis.tasksCompletedThisMonth ?? 0 },
    { metric: "Completion Rate %", value: kpis.completionRate ? `${kpis.completionRate.toFixed(1)}%` : "0%" },
    { metric: "Deliverables Submitted", value: kpis.deliverablesSubmitted ?? 0 },
    { metric: "Deliverables Approved", value: kpis.deliverablesApproved ?? 0 },
    { metric: "Open Blockers", value: kpis.openBlockers ?? 0 },
  ];
  for (const row of kpiRows) summarySheet.addRow(row);
  styleHeaderRow(summarySheet);

  // Tasks sheet
  addSheet(workbook, "Tasks", [
    { header: "Project", key: "projectName", width: 30 },
    { header: "Total Tasks", key: "totalTasks", width: 12 },
    { header: "Completed", key: "completed", width: 12 },
    { header: "In Progress", key: "inProgress", width: 14 },
    { header: "Not Started", key: "notStarted", width: 14 },
    { header: "Overdue", key: "overdue", width: 12 },
    { header: "Completion %", key: "completionPct", width: 14 },
  ], data.tasks?.perProject || []);

  // Deliverables sheet
  addSheet(workbook, "Deliverables", [
    { header: "Project", key: "projectName", width: 25 },
    { header: "Deliverable", key: "title", width: 30 },
    { header: "Type", key: "type", width: 16 },
    { header: "Status", key: "status", width: 16 },
    { header: "Version", key: "currentVersion", width: 10 },
    { header: "Owner", key: "ownerName", width: 18 },
    { header: "Reviewer", key: "reviewerName", width: 18 },
  ], data.deliverables?.register || []);

  // Stages sheet
  addSheet(workbook, "Stages", [
    { header: "Project", key: "projectName", width: 30 },
    { header: "Stage", key: "stageName", width: 25 },
    { header: "Status", key: "status", width: 16 },
    { header: "Started", key: "startedAt", width: 20 },
    { header: "Completed", key: "completedAt", width: 20 },
  ], data.stageGates || []);

  // Resources sheet
  addSheet(workbook, "Resources", [
    { header: "Engineer", key: "resource", width: 25 },
    { header: "Assigned Tasks", key: "assignedTasks", width: 14 },
    { header: "Completed This Month", key: "completedThisMonth", width: 22 },
    { header: "Overdue", key: "overdue", width: 12 },
    { header: "Projects", key: "projectCount", width: 12 },
  ], data.resources || []);

  // Approvals sheet
  addSheet(workbook, "Approvals", [
    { header: "Project", key: "projectName", width: 25 },
    { header: "Approval Type", key: "approvalType", width: 20 },
    { header: "Status", key: "status", width: 14 },
    { header: "Approver", key: "approverName", width: 20 },
    { header: "Date", key: "date", width: 20 },
  ], data.approvals || []);
}
