import { and, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { approvals, deliverables, invoiceCaptures, procurementItems, projectInfo, qcWarning, raidItems, users, workItems } from "@shared/schema";

export type ExceptionSeverity = "critical" | "high" | "medium" | "low";
export type ExceptionCategory =
  | "overdue_tasks"
  | "blocked_tasks"
  | "stage_gate_blockers"
  | "missing_evidence"
  | "pending_approvals"
  | "overdue_procurement_actions"
  | "commercial_record_gaps"
  | "invoice_payment_exceptions"
  | "high_risk_raid_changes"
  | "schedule_slippage"
  | "margin_cost_risk";

export type ExceptionItem = {
  id: string;
  category: ExceptionCategory;
  severity: ExceptionSeverity;
  title: string;
  owner: string;
  dueDate: string | null;
  project: string;
  sourceLink: string;
  sourceType: string;
  sourceId: number;
  reason: string;
};

export type RoleCluster = "coo" | "program_manager" | "project_manager" | "engineering" | "quality" | "finance" | "construction" | "other";

export function normalizeRoleCluster(role?: string | null): RoleCluster {
  const value = (role || "").toLowerCase();
  if (value.includes("coo") || value.includes("ceo") || value.includes("admin")) return "coo";
  if (value.includes("program_manager") || value.includes("program manager")) return "program_manager";
  if (value.includes("project_manager") || value.includes("project manager")) return "project_manager";
  if (value.includes("engineering") || value === "engineer" || value.includes("eng_")) return "engineering";
  if (value.includes("quality")) return "quality";
  if (value.includes("finance") || value.includes("cfo") || value.includes("accountant")) return "finance";
  if (value.includes("construction") || value.includes("site")) return "construction";
  return "other";
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysOverdue(value?: string | null): number {
  const due = parseDate(value);
  if (!due) return 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - due.getTime()) / 86_400_000);
}

export function computeSeverity(params: { category: ExceptionCategory; dueDate?: string | null; priority?: string | null; status?: string | null; deltaPercent?: number | null }): ExceptionSeverity {
  const overdueDays = daysOverdue(params.dueDate);
  const priority = (params.priority || "").toLowerCase();
  const status = (params.status || "").toLowerCase();
  if (params.category === "high_risk_raid_changes" && (priority === "critical" || priority === "high" || status === "blocked")) return "critical";
  if (params.category === "margin_cost_risk" && (params.deltaPercent || 0) >= 0.1) return "critical";
  if (overdueDays >= 14) return "critical";
  if (overdueDays >= 7 || priority === "high") return "high";
  if (overdueDays > 0 || priority === "medium") return "medium";
  return "low";
}

function shouldIncludeByRole(cluster: RoleCluster, category: ExceptionCategory): boolean {
  const roleMap: Record<RoleCluster, ExceptionCategory[]> = {
    coo: ["overdue_tasks", "blocked_tasks", "stage_gate_blockers", "pending_approvals", "overdue_procurement_actions", "commercial_record_gaps", "invoice_payment_exceptions", "high_risk_raid_changes", "schedule_slippage", "margin_cost_risk", "missing_evidence"],
    program_manager: ["overdue_tasks", "blocked_tasks", "stage_gate_blockers", "pending_approvals", "overdue_procurement_actions", "high_risk_raid_changes", "schedule_slippage", "margin_cost_risk", "missing_evidence"],
    project_manager: ["overdue_tasks", "blocked_tasks", "stage_gate_blockers", "pending_approvals", "overdue_procurement_actions", "schedule_slippage", "missing_evidence", "high_risk_raid_changes"],
    engineering: ["blocked_tasks", "overdue_tasks", "missing_evidence", "pending_approvals", "schedule_slippage", "high_risk_raid_changes"],
    quality: ["missing_evidence", "pending_approvals", "stage_gate_blockers", "overdue_tasks", "high_risk_raid_changes"],
    finance: ["pending_approvals", "overdue_procurement_actions", "commercial_record_gaps", "invoice_payment_exceptions", "margin_cost_risk", "high_risk_raid_changes"],
    construction: ["overdue_tasks", "blocked_tasks", "missing_evidence", "overdue_procurement_actions", "schedule_slippage", "pending_approvals"],
    other: ["overdue_tasks", "blocked_tasks", "pending_approvals"],
  };
  return roleMap[cluster].includes(category);
}


export function buildExceptionLink(sourceType: string, sourceId: number, project?: string) {
  const projectHref = project ? `/project/${encodeURIComponent(project)}` : null;
  const projectExecutionHref = (section: string, subTab?: string) => {
    if (!projectHref) return null;
    const params = new URLSearchParams({ mode: "execution", section });
    if (subTab) params.set("subTab", subTab);
    return `${projectHref}?${params.toString()}`;
  };

  if (sourceType === "work_item") {
    return projectExecutionHref("delivery", "task-grid") || `/my-work/tasks?itemKey=${encodeURIComponent(`plan-${sourceId}`)}`;
  }
  if (sourceType === "approval") {
    return projectExecutionHref("collaboration", "approvals") || `/my-work/tasks?itemKey=${encodeURIComponent(`approval-gen-${sourceId}`)}`;
  }
  if (sourceType === "procurement") return `/subcontractor-dashboard?itemId=${sourceId}`;
  if (sourceType === "raid") return `/project/${encodeURIComponent(project || "")}?tab=raid`;
  if (sourceType === "quality_warning") return projectExecutionHref("quality", "quality") || "/quality";
  if (sourceType === "deliverable") return projectExecutionHref("collaboration", "approvals") || `/my-work/tasks?itemKey=${encodeURIComponent(`del-${sourceId}`)}`;
  if (sourceType === "project_gate") return `/project/${encodeURIComponent(project || "")}`;
  return "/exceptions";
}

export function filterResolved(items: ExceptionItem[]): ExceptionItem[] {
  return items.filter((item) => !item.reason.toLowerCase().includes("resolved"));
}

export async function getExceptionDashboard(params: { userId: number; role?: string | null; projectId?: number | null }) {
  const { db } = await import("../db");
  const cluster = normalizeRoleCluster(params.role);

  const scopedProjects = await db
    .select({ id: projectInfo.id, projectName: projectInfo.projectName, pmUserId: projectInfo.pmUserId })
    .from(projectInfo)
    .where(eq(projectInfo.isActive, true));

  const projectIdsByRole = (() => {
    if (["coo", "program_manager", "finance"].includes(cluster)) return scopedProjects.map((p) => p.id);
    if (["project_manager", "construction"].includes(cluster)) return scopedProjects.filter((p) => p.pmUserId === params.userId).map((p) => p.id);
    return scopedProjects.map((p) => p.id);
  })();

  const finalProjectIds = params.projectId ? projectIdsByRole.filter((id) => id === params.projectId) : projectIdsByRole;
  if (!finalProjectIds.length) return { roleCluster: cluster, items: [] as ExceptionItem[] };

  const projectNameById = new Map<number, string>(scopedProjects.map((p) => [p.id, p.projectName]));
  const userRows = await db.select({ id: users.id, name: users.name }).from(users);
  const userNameById = new Map<number, string>(userRows.map((u) => [u.id, u.name || `User #${u.id}`]));

  const openWorkItems = await db.select().from(workItems).where(and(inArray(workItems.projectId, finalProjectIds), isNull(workItems.deletedAt), notInArray(workItems.status, ["Done", "Closed", "Completed"])));
  const pendingApprovals = await db.select().from(approvals).where(and(eq(approvals.status, "pending"), inArray(approvals.projectId, finalProjectIds)));
  const procurement = await db.select().from(procurementItems).where(inArray(procurementItems.projectId, finalProjectIds));
  const invoices = await db.select().from(invoiceCaptures).where(inArray(invoiceCaptures.projectId, finalProjectIds));
  const raids = await db.select().from(raidItems).where(and(inArray(raidItems.projectId, finalProjectIds), eq(raidItems.status, "open")));
  const warnings = await db.select().from(qcWarning).where(and(inArray(qcWarning.projectName, Array.from(new Set(finalProjectIds.map((id) => projectNameById.get(id) || "")))), ne(qcWarning.status, "resolved")));
  const gates = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName, executionGateStatus: projectInfo.executionGateStatus, executionGateReason: projectInfo.executionGateReason, executionEnabled: projectInfo.executionEnabled }).from(projectInfo).where(inArray(projectInfo.id, finalProjectIds));
  const deliverableRows = await db.select().from(deliverables).where(inArray(deliverables.projectId, finalProjectIds));

  const items: ExceptionItem[] = [];

  for (const task of openWorkItems) {
    if (!task.projectId) continue;
    const category: ExceptionCategory | null = (task.status || "").toLowerCase().includes("blocked") ? "blocked_tasks" : daysOverdue(task.endDate) > 0 ? "overdue_tasks" : null;
    if (!category || !shouldIncludeByRole(cluster, category)) continue;
    items.push({
      id: `work-${task.id}`,
      category,
      severity: computeSeverity({ category, dueDate: task.endDate, priority: task.priority, status: task.status }),
      title: task.title,
      owner: userNameById.get(task.ownerUserId || -1) || task.ownerName || "Unassigned",
      dueDate: task.endDate,
      project: projectNameById.get(task.projectId) || "Unknown Project",
      sourceLink: buildExceptionLink("work_item", task.id, projectNameById.get(task.projectId) || undefined),
      sourceType: "work_item",
      sourceId: task.id,
      reason: category === "blocked_tasks" ? "Task is blocked and requires intervention" : "Task due date has passed",
    });
  }

  for (const gate of gates) {
    if (gate.executionEnabled && gate.executionGateStatus !== "GO") {
      const category: ExceptionCategory = "stage_gate_blockers";
      if (!shouldIncludeByRole(cluster, category)) continue;
      items.push({
        id: `gate-${gate.id}`,
        category,
        severity: "high",
        title: `${gate.projectName} execution gate blocked`,
        owner: "Program Office",
        dueDate: null,
        project: gate.projectName,
        sourceLink: buildExceptionLink("project_gate", gate.id, gate.projectName),
        sourceType: "project_gate",
        sourceId: gate.id,
        reason: gate.executionGateReason || "Stage gate is not approved",
      });
    }
  }

  for (const approval of pendingApprovals) {
    if (!shouldIncludeByRole(cluster, "pending_approvals")) continue;
    items.push({
      id: `approval-${approval.id}`,
      category: "pending_approvals",
      severity: computeSeverity({ category: "pending_approvals", dueDate: approval.dueDate ? approval.dueDate.toISOString() : null }),
      title: approval.title,
      owner: userNameById.get(approval.assignedApprover || -1) || "Unassigned approver",
      dueDate: approval.dueDate ? approval.dueDate.toISOString().slice(0, 10) : null,
      project: projectNameById.get(approval.projectId || -1) || "Shared",
      sourceLink: buildExceptionLink("approval", approval.id, projectNameById.get(approval.projectId || -1) || undefined),
      sourceType: "approval",
      sourceId: approval.id,
      reason: "Approval waiting for decision",
    });
  }

  for (const row of procurement) {
    const overdue = daysOverdue(row.requiredDate) > 0;
    const unlinkedCommercial = !row.poId || !row.invoiceRef;
    if (overdue && shouldIncludeByRole(cluster, "overdue_procurement_actions")) {
      items.push({ id: `proc-overdue-${row.id}`, category: "overdue_procurement_actions", severity: computeSeverity({ category: "overdue_procurement_actions", dueDate: row.requiredDate }), title: row.title, owner: userNameById.get(row.ownerUserId || -1) || "Unassigned", dueDate: row.requiredDate, project: projectNameById.get(row.projectId) || "Unknown", sourceLink: buildExceptionLink("procurement", row.id), sourceType: "procurement", sourceId: row.id, reason: "Procurement action date has passed" });
    }
    if (unlinkedCommercial && shouldIncludeByRole(cluster, "commercial_record_gaps")) {
      items.push({ id: `proc-commercial-${row.id}`, category: "commercial_record_gaps", severity: "medium", title: row.title, owner: userNameById.get(row.ownerUserId || -1) || "Unassigned", dueDate: row.requiredDate, project: projectNameById.get(row.projectId) || "Unknown", sourceLink: buildExceptionLink("procurement", row.id), sourceType: "procurement", sourceId: row.id, reason: "PO or invoice reference is missing" });
    }
  }

  for (const invoice of invoices) {
    if (!shouldIncludeByRole(cluster, "invoice_payment_exceptions")) continue;
    if (invoice.status !== "approved" || !invoice.linkedProcurementItemId || !invoice.invoiceNumber) {
      items.push({ id: `invoice-${invoice.id}`, category: "invoice_payment_exceptions", severity: computeSeverity({ category: "invoice_payment_exceptions", status: invoice.status }), title: `Invoice ${invoice.invoiceNumber || `#${invoice.id}`}`, owner: userNameById.get(invoice.capturedByUserId || -1) || "Finance queue", dueDate: invoice.invoiceDate, project: projectNameById.get(invoice.projectId) || "Unknown", sourceLink: buildExceptionLink("approval", invoice.id, projectNameById.get(invoice.projectId) || undefined), sourceType: "invoice", sourceId: invoice.id, reason: "Invoice missing commercial linkage or approval" });
    }
  }

  for (const raid of raids) {
    if (!shouldIncludeByRole(cluster, "high_risk_raid_changes")) continue;
    if (raid.priority === "high" || raid.priority === "critical") {
      items.push({ id: `raid-${raid.id}`, category: "high_risk_raid_changes", severity: computeSeverity({ category: "high_risk_raid_changes", dueDate: raid.dueDate, priority: raid.priority, status: raid.status }), title: raid.title, owner: userNameById.get(raid.ownerUserId || -1) || "Unassigned", dueDate: raid.dueDate, project: projectNameById.get(raid.projectId) || "Unknown", sourceLink: buildExceptionLink("raid", raid.id, projectNameById.get(raid.projectId) || ""), sourceType: "raid", sourceId: raid.id, reason: "High-priority RAID item is open" });
    }
  }

  for (const warning of warnings) {
    if (!shouldIncludeByRole(cluster, "missing_evidence")) continue;
    if ((warning.warningType || "").includes("missing_evidence")) {
      items.push({ id: `qcw-${warning.id}`, category: "missing_evidence", severity: computeSeverity({ category: "missing_evidence", dueDate: warning.dueDate, priority: warning.severity }), title: warning.title, owner: userNameById.get(warning.ownerUserId || -1) || "Quality team", dueDate: warning.dueDate, project: warning.projectName, sourceLink: buildExceptionLink("quality_warning", warning.id, warning.projectName || undefined), sourceType: "quality_warning", sourceId: warning.id, reason: warning.description || "Evidence missing for quality record" });
    }
  }

  for (const d of deliverableRows) {
    if (!shouldIncludeByRole(cluster, "missing_evidence")) continue;
    const state = (d.status || "").toLowerCase();
    if ((state.includes("review") || state.includes("submitted")) && !d.currentVersion) {
      items.push({ id: `deliverable-${d.id}`, category: "missing_evidence", severity: "high", title: d.title, owner: userNameById.get(d.ownerUserId || -1) || "Unassigned", dueDate: d.scheduledDate, project: d.projectName, sourceLink: buildExceptionLink("deliverable", d.id, d.projectName), sourceType: "deliverable", sourceId: d.id, reason: "Deliverable in review without version evidence" });
    }
  }

  const deduped = new Map(items.map((item) => [item.id, item]));
  const clean = filterResolved(Array.from(deduped.values())).sort((a, b) => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    return rank[a.severity] - rank[b.severity];
  });

  return {
    roleCluster: cluster,
    items: clean,
    taxonomy: [
      "overdue_tasks", "blocked_tasks", "stage_gate_blockers", "missing_evidence", "pending_approvals", "overdue_procurement_actions", "commercial_record_gaps", "invoice_payment_exceptions", "high_risk_raid_changes", "schedule_slippage", "margin_cost_risk",
    ] as ExceptionCategory[],
  };
}

export function summarizeExceptions(items: ExceptionItem[]) {
  const bySeverity = items.reduce((acc, item) => {
    acc[item.severity] = (acc[item.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const byCategory = items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return { total: items.length, bySeverity, byCategory };
}
