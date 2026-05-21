import type { ProjectImportLineage } from "@shared/api-types/project-v2";
import { summarizeImportLineage } from "@/lib/project-detail-navigation";

export type CommandTone = "success" | "warning" | "danger" | "neutral" | "restricted";

export interface FinanceStrictRow {
  key: "planned" | "committed" | "invoiced" | "paid-received" | "realised" | "outstanding" | "at-risk";
  label: string;
  value: string;
  sourceAuthority: string;
  editable: boolean;
  formula: string;
  tone: CommandTone;
}

export interface SourceAuthorityBadge {
  key: "excel" | "app" | "quickbooks" | "sharepoint" | "pipedrive";
  label: string;
  detail: string;
  sourceAuthority: string;
  readOnly: boolean;
  tone: CommandTone;
}

export interface WorkflowException {
  key:
    | "missing-import"
    | "handover-blocked"
    | "pending-quality-approvals"
    | "overdue-plan-tasks"
    | "overdue-engineering-tasks"
    | "overdue-supplier-costs";
  label: string;
  count: number;
  tone: "warning" | "danger";
}

function formatWholeZar(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return `R ${Number(value).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`.replace(/[\u00A0\u202F]/g, " ");
}

function restrictedRows(): FinanceStrictRow[] {
  const base = buildFinanceStrictRows({
    canViewFinance: true,
    plannedRevenue: 0,
    committedCost: 0,
    invoicedRevenue: 0,
    paidReceived: 0,
    realisedRevenuePct: 0,
    realisedCosPct: 0,
    outstandingRevenue: 0,
    atRiskCount: 0,
  });
  return base.map((row) => ({
    ...row,
    value: "Restricted",
    tone: "restricted",
  }));
}

export function buildFinanceStrictRows({
  canViewFinance,
  plannedRevenue,
  committedCost,
  invoicedRevenue,
  paidReceived,
  realisedRevenuePct,
  realisedCosPct,
  outstandingRevenue,
  atRiskCount,
}: {
  canViewFinance: boolean;
  plannedRevenue: number;
  committedCost: number;
  invoicedRevenue: number;
  paidReceived: number;
  realisedRevenuePct: number;
  realisedCosPct: number;
  outstandingRevenue: number;
  atRiskCount: number;
}): FinanceStrictRow[] {
  if (!canViewFinance) return restrictedRows();

  return [
    {
      key: "planned",
      label: "Planned",
      value: formatWholeZar(plannedRevenue),
      sourceAuthority: "Excel/App contract summary",
      editable: false,
      formula: "Endpoint value supplied to Project Detail; Excel tracker remains authoritative where imported.",
      tone: "neutral",
    },
    {
      key: "committed",
      label: "Committed",
      value: formatWholeZar(committedCost),
      sourceAuthority: "PO/App procurement",
      editable: false,
      formula: "Endpoint value supplied to Project Detail; purchase commitments are controlled by procurement/PO workflows.",
      tone: "neutral",
    },
    {
      key: "invoiced",
      label: "Invoiced",
      value: formatWholeZar(invoicedRevenue),
      sourceAuthority: "Invoice tracker",
      editable: false,
      formula: "Endpoint value supplied to Project Detail; invoices without POs remain control exceptions.",
      tone: "neutral",
    },
    {
      key: "paid-received",
      label: "Paid / received",
      value: formatWholeZar(paidReceived),
      sourceAuthority: "Receipt/payment date",
      editable: false,
      formula: "Endpoint value supplied to Project Detail; receipt date drives revenue realisation where defined.",
      tone: "success",
    },
    {
      key: "realised",
      label: "Realised",
      value: `${Math.round(realisedRevenuePct)}% revenue / ${Math.round(realisedCosPct)}% COS`,
      sourceAuthority: "Finance endpoint rules",
      editable: false,
      formula: "Endpoint percentages supplied to Project Detail; COS realised only from invoice actuals.",
      tone: "neutral",
    },
    {
      key: "outstanding",
      label: "Outstanding",
      value: formatWholeZar(outstandingRevenue),
      sourceAuthority: "Finance endpoint aggregate",
      editable: false,
      formula: "Endpoint value supplied to Project Detail; no client-side repayment schedule is invented here.",
      tone: outstandingRevenue > 0 ? "warning" : "success",
    },
    {
      key: "at-risk",
      label: "At risk",
      value: String(Math.max(0, atRiskCount)),
      sourceAuthority: "Exception counters",
      editable: false,
      formula: "Pending finance edits, Microsoft linkage actions, overdue supplier costs, and reconciliation signals.",
      tone: atRiskCount > 0 ? "danger" : "success",
    },
  ];
}

export function buildSourceAuthorityBadges({
  importLineage,
  canViewFinance,
  canViewQuality,
  canViewDocuments,
  financeDriftStatus,
}: {
  importLineage?: ProjectImportLineage | null;
  canViewFinance: boolean;
  canViewQuality: boolean;
  canViewDocuments: boolean;
  financeDriftStatus?: string | null;
}): SourceAuthorityBadge[] {
  const lineage = summarizeImportLineage(importLineage);
  const excelTone: CommandTone = lineage.tone === "success" ? "success" : lineage.tone === "danger" ? "danger" : "warning";
  return [
    {
      key: "excel",
      label: "Excel",
      detail: canViewFinance ? lineage.detail : "Restricted",
      sourceAuthority: "Imported trackers",
      readOnly: true,
      tone: canViewFinance ? excelTone : "restricted",
    },
    {
      key: "app",
      label: "App",
      detail: "Editable workflow state, tasks, decisions, and approved overrides",
      sourceAuthority: "Emergent Energy app",
      readOnly: false,
      tone: "neutral",
    },
    {
      key: "quickbooks",
      label: "QuickBooks",
      detail: canViewFinance ? financeDriftStatus || "Reconciliation state unavailable" : "Restricted",
      sourceAuthority: "Accounting reconciliation",
      readOnly: true,
      tone: !canViewFinance ? "restricted" : financeDriftStatus && financeDriftStatus !== "reconciled" ? "warning" : "neutral",
    },
    {
      key: "sharepoint",
      label: "SharePoint",
      detail: canViewDocuments || canViewQuality ? "Document source of truth" : "Restricted",
      sourceAuthority: "Document control",
      readOnly: true,
      tone: canViewDocuments || canViewQuality ? "neutral" : "restricted",
    },
    {
      key: "pipedrive",
      label: "Pipedrive",
      detail: "Opportunity pipeline source",
      sourceAuthority: "CRM",
      readOnly: true,
      tone: "neutral",
    },
  ];
}

export function buildWorkflowExceptions({
  overduePlanTasks,
  overdueEngineeringTasks,
  pendingQualityApprovals,
  overdueSupplierCosts,
  missingImport,
  handoverBlocked,
}: {
  overduePlanTasks: number;
  overdueEngineeringTasks: number;
  pendingQualityApprovals: number;
  overdueSupplierCosts: number;
  missingImport: boolean;
  handoverBlocked: boolean;
}): WorkflowException[] {
  const items: WorkflowException[] = [];
  if (missingImport) {
    items.push({ key: "missing-import", label: "Missing tracker import", count: 1, tone: "warning" });
  }
  if (handoverBlocked) {
    items.push({ key: "handover-blocked", label: "Handover blocked", count: 1, tone: "danger" });
  }
  if (pendingQualityApprovals > 0) {
    items.push({ key: "pending-quality-approvals", label: "Pending quality approvals", count: pendingQualityApprovals, tone: "warning" });
  }
  if (overduePlanTasks > 0) {
    items.push({ key: "overdue-plan-tasks", label: "Overdue plan tasks", count: overduePlanTasks, tone: "warning" });
  }
  if (overdueEngineeringTasks > 0) {
    items.push({ key: "overdue-engineering-tasks", label: "Overdue engineering tasks", count: overdueEngineeringTasks, tone: "warning" });
  }
  if (overdueSupplierCosts > 0) {
    items.push({ key: "overdue-supplier-costs", label: "Overdue supplier costs", count: overdueSupplierCosts, tone: "warning" });
  }
  return items;
}
