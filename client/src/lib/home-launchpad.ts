import { differenceInCalendarDays, parseISO, startOfDay } from "date-fns";

export type CompanyPriorityLink = {
  id: number;
  linkType: string;
  projectName: string | null;
  taskId: number | null;
  taskType: string | null;
};

export type CompanyPriority = {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  ownerRole: string | null;
  status: string;
  priorityRank: number | null;
  links?: CompanyPriorityLink[];
};

export type ExceptionSeverity = "critical" | "high" | "medium" | "low";

export type HomeExceptionItem = {
  id: string;
  category: string;
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

export type ExceptionSummary = {
  total: number;
  bySeverity: Record<string, number>;
  byCategory?: Record<string, number>;
};

export type ExceptionResponse = {
  items: HomeExceptionItem[];
  summary: ExceptionSummary;
};

export type HomeExceptionPreviewItem = {
  id: string;
  modelLabel: string;
  title: string;
  detail: string;
  severity: ExceptionSeverity;
  href: string;
};

export type HomePreviewReason = "overdue" | "blocked" | "dueSoon" | "approval" | "next";

export type HomeWorkPreviewItem = {
  itemKey: string;
  title: string;
  projectName: string | null;
  sourceLabel: string;
  priority: string;
  status: string;
  dueAt: string | null;
  createdAt: string | null;
  href: string;
  reason: HomePreviewReason;
};

type HomeWorkCandidate = {
  itemKey: string;
  title: string;
  projectName: string | null;
  sourceLabel: string;
  priority: string;
  status: string;
  dueAt: string | null;
  createdAt: string | null;
};

type AllTaskData = {
  personal?: Array<Record<string, any>>;
  operational?: Array<Record<string, any>>;
  approvals?: {
    engineering?: Array<Record<string, any>>;
    quality?: Array<Record<string, any>>;
  };
  trRegister?: Array<Record<string, any>>;
  deliverables?: Array<Record<string, any>>;
  planTasks?: Array<Record<string, any>>;
  engineeringTasks?: Array<Record<string, any>>;
  qualityTasks?: Array<Record<string, any>>;
} | null;

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  urgent: 0,
  high: 1,
  normal: 2,
  med: 2,
  medium: 2,
  low: 3,
};

const SEVERITY_ORDER: Record<ExceptionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const COMPANY_WIDE_TARGETS = new Set([
  "",
  "all",
  "company",
  "company-wide",
  "companywide",
  "everyone",
]);

const ROLE_ALIASES: Record<string, string[]> = {
  admin: ["admin", "administrator", "superadmin", "coo-admin", "ceo-admin", "cco", "cfo", "exco", "leadership"],
  pm: ["pm", "project-manager", "project-manager-site", "project-manager_site", "project_manager_site", "project-manager-site", "delivery"],
  engineering: ["engineering", "engineer", "engineering-manager", "eng-program-manager", "eng_program_manager"],
  quality: ["quality", "quality-manager", "qm"],
  finance: ["finance", "program-finance-manager", "program_finance_manager", "accountant"],
  procurement: ["procurement", "purchasing", "buyer"],
  pd: ["project-development", "project_developer", "project-developer", "pd"],
};

function normalizeText(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function normalizePriority(value?: string | null) {
  const normalized = normalizeText(value);
  if (normalized === "p1" || normalized === "urgent") return "critical";
  if (normalized === "p2") return "high";
  if (normalized === "p4") return "low";
  return normalized || "normal";
}

function normalizeStatus(value?: string | null) {
  const normalized = normalizeText(value);
  if (["done", "complete", "completed", "closed", "cancelled", "canceled", "resolved", "approved"].includes(normalized)) return "complete";
  if (["blocked", "on-hold", "hold", "waiting"].includes(normalized)) return "blocked";
  if (["review", "in-review", "qa-review", "needs-review"].includes(normalized)) return "review";
  if (["in-progress", "active", "pending"].includes(normalized)) return "in-progress";
  return normalized || "todo";
}

function isClosedStatus(status?: string | null) {
  return normalizeStatus(status) === "complete";
}

function getRoleTokens(role?: string | null) {
  const normalized = normalizeText(role);
  if (!normalized) return [];

  const direct = new Set([normalized]);
  for (const [alias, values] of Object.entries(ROLE_ALIASES)) {
    if (alias === normalized || values.includes(normalized)) {
      direct.add(alias);
      values.forEach((value) => direct.add(value));
    }
  }

  return Array.from(direct);
}

function matchesPriorityRole(ownerRole?: string | null, userRole?: string | null) {
  const target = normalizeText(ownerRole);
  if (COMPANY_WIDE_TARGETS.has(target)) return true;

  const targetTokens = getRoleTokens(ownerRole);
  const userTokens = new Set(getRoleTokens(userRole));
  if (targetTokens.length === 0) return true;

  return targetTokens.some((token) => userTokens.has(token));
}

function matchesPriorityDepartment(department?: string | null, userDepartment?: string | null) {
  const target = normalizeText(department);
  if (COMPANY_WIDE_TARGETS.has(target)) return true;

  const userDept = normalizeText(userDepartment);
  if (!userDept) return false;

  return target === userDept;
}

export function getPriorityDestination(priority: CompanyPriority) {
  const firstLink = priority.links?.[0];
  if (!firstLink) return "/company-priorities";
  if (firstLink.linkType === "project" && firstLink.projectName) {
    return `/project/${encodeURIComponent(firstLink.projectName)}`;
  }
  if (firstLink.linkType === "task" && firstLink.taskType === "operational" && firstLink.taskId) {
    return `/my-work/tasks?itemKey=${encodeURIComponent(`op-${firstLink.taskId}`)}`;
  }
  return "/company-priorities";
}

export function selectHomeCompanyPriorities(
  priorities: CompanyPriority[],
  options: { userRole?: string | null; userDepartment?: string | null; limit?: number } = {},
) {
  const { userRole, userDepartment, limit = 5 } = options;

  return priorities
    .filter((priority) => !["closed", "complete"].includes(normalizeText(priority.status)))
    .filter((priority) => matchesPriorityRole(priority.ownerRole, userRole) && matchesPriorityDepartment(priority.department, userDepartment))
    .sort((left, right) => (left.priorityRank ?? Number.MAX_SAFE_INTEGER) - (right.priorityRank ?? Number.MAX_SAFE_INTEGER))
    .slice(0, limit);
}

function mapExceptionModelLabel(item: HomeExceptionItem) {
  if (item.owner.toLowerCase().includes("unassigned") && ["critical", "high"].includes(item.severity)) {
    return "Unassigned critical work";
  }

  switch (item.category) {
    case "overdue_tasks":
      return "Overdue task";
    case "blocked_tasks":
      return "Blocked task";
    case "pending_approvals":
      return "Late approval";
    case "stage_gate_blockers":
      return "Stage-gate failure";
    case "margin_cost_risk":
    case "invoice_payment_exceptions":
    case "commercial_record_gaps":
    case "overdue_procurement_actions":
      return "Financial exposure";
    case "missing_evidence":
      return item.sourceType === "deliverable" ? "Missing deliverable" : "Quality blocker";
    case "high_risk_raid_changes":
      return "Financial exposure";
    default:
      return "Overdue task";
  }
}

function getExceptionHref(item: HomeExceptionItem) {
  switch (item.sourceType) {
    case "work_item":
      return `/my-work/tasks?itemKey=${encodeURIComponent(`plan-${item.sourceId}`)}`;
    case "deliverable":
      return `/my-work/tasks?itemKey=${encodeURIComponent(`del-${item.sourceId}`)}`;
    case "approval":
      return "/my-work/approvals";
    default:
      return "/my-work/tasks";
  }
}

export function selectHomeExceptionPreview(
  exceptionResponse?: ExceptionResponse | null,
  limit = 3,
): { summary: ExceptionSummary; items: HomeExceptionPreviewItem[] } {
  const summary = exceptionResponse?.summary ?? { total: 0, bySeverity: {} };
  const items = (exceptionResponse?.items || [])
    .slice()
    .sort((left, right) => {
      const severityDifference = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
      if (severityDifference !== 0) return severityDifference;
      return (left.dueDate || "9999-12-31").localeCompare(right.dueDate || "9999-12-31");
    })
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      modelLabel: mapExceptionModelLabel(item),
      title: item.title,
      detail: `${item.project} • ${item.reason}`,
      severity: item.severity,
      href: getExceptionHref(item),
    }));

  return { summary, items };
}

function parseDueDate(value?: string | null) {
  if (!value) return null;
  try {
    return parseISO(value);
  } catch {
    return null;
  }
}

function isOverdue(value?: string | null) {
  const due = parseDueDate(value);
  if (!due) return false;
  return differenceInCalendarDays(due, startOfDay(new Date())) < 0;
}

function isDueSoon(value?: string | null) {
  const due = parseDueDate(value);
  if (!due) return false;
  const diff = differenceInCalendarDays(due, startOfDay(new Date()));
  return diff >= 0 && diff <= 3;
}

function candidateComparator(left: HomeWorkCandidate, right: HomeWorkCandidate) {
  const priorityDifference =
    (PRIORITY_ORDER[normalizePriority(left.priority)] ?? 2) -
    (PRIORITY_ORDER[normalizePriority(right.priority)] ?? 2);
  if (priorityDifference !== 0) return priorityDifference;

  const dueDifference = (left.dueAt || "9999-12-31").localeCompare(right.dueAt || "9999-12-31");
  if (dueDifference !== 0) return dueDifference;

  return (right.createdAt || "").localeCompare(left.createdAt || "");
}

function pushUnique(target: HomeWorkCandidate[], candidate: HomeWorkCandidate, seen: Set<string>) {
  if (!candidate.title || seen.has(candidate.itemKey)) return;
  seen.add(candidate.itemKey);
  target.push(candidate);
}

function buildHomeCandidates(allTaskData?: AllTaskData) {
  const candidates: HomeWorkCandidate[] = [];
  const seen = new Set<string>();
  const data = allTaskData || {};

  for (const item of data.personal || []) {
    pushUnique(candidates, {
      itemKey: `personal-${item.id}`,
      title: item.title || `Task #${item.id}`,
      projectName: item.projectName || item.project_name || null,
      sourceLabel: "Personal",
      priority: item.priority || "normal",
      status: item.status || "todo",
      dueAt: item.dueAt || item.due_at || null,
      createdAt: item.createdAt || item.created_at || null,
    }, seen);
  }

  for (const item of data.operational || []) {
    pushUnique(candidates, {
      itemKey: `op-${item.id}`,
      title: item.title || `Task #${item.id}`,
      projectName: item.projectName || item.project_name || null,
      sourceLabel: "Project",
      priority: item.priority || "normal",
      status: item.status || "todo",
      dueAt: item.dueDate || item.due_date || null,
      createdAt: item.createdAt || item.created_at || null,
    }, seen);
  }

  for (const item of data.planTasks || []) {
    pushUnique(candidates, {
      itemKey: `plan-${item.id}`,
      title: item.title || `Plan item #${item.id}`,
      projectName: item.projectName || item.project_name || null,
      sourceLabel: "Project Plan",
      priority: item.priority || "normal",
      status: item.status || "todo",
      dueAt: item.endDate || item.end_date || item.scheduledDate || null,
      createdAt: item.createdAt || item.created_at || null,
    }, seen);
  }

  for (const item of data.engineeringTasks || []) {
    pushUnique(candidates, {
      itemKey: `eng-${item.id}`,
      title: item.title || `Engineering item #${item.id}`,
      projectName: item.projectName || null,
      sourceLabel: "Engineering",
      priority: item.priority || "normal",
      status: item.status || "todo",
      dueAt: item.scheduledDate || null,
      createdAt: item.createdAt || null,
    }, seen);
  }

  for (const item of data.qualityTasks || []) {
    pushUnique(candidates, {
      itemKey: `qc-${item.id}`,
      title: item.title || `Quality item #${item.id}`,
      projectName: item.projectName || null,
      sourceLabel: "Quality",
      priority: item.priority || "normal",
      status: item.status || "todo",
      dueAt: item.endDate || item.scheduledDate || null,
      createdAt: item.createdAt || null,
    }, seen);
  }

  for (const item of data.trRegister || []) {
    pushUnique(candidates, {
      itemKey: `tr-${item.id}`,
      title: item.actionDescription || `Action #${item.id}`,
      projectName: null,
      sourceLabel: "Action Item",
      priority: item.ragStatus === "Red" ? "critical" : item.ragStatus === "Amber" ? "high" : "normal",
      status: item.status || "todo",
      dueAt: item.dueDate || item.due_date || null,
      createdAt: item.createdAt || item.created_at || null,
    }, seen);
  }

  for (const item of data.deliverables || []) {
    pushUnique(candidates, {
      itemKey: `del-${item.id}`,
      title: item.title || `Deliverable #${item.id}`,
      projectName: item.projectName || item.project_name || null,
      sourceLabel: "Deliverable",
      priority: item.priority || "normal",
      status: item.status || "todo",
      dueAt: item.scheduledDate || item.scheduled_date || null,
      createdAt: item.updatedAt || item.updated_at || item.createdAt || item.created_at || null,
    }, seen);
  }

  for (const item of data.approvals?.engineering || []) {
    pushUnique(candidates, {
      itemKey: `approval-eng-${item.id}`,
      title: item.title || `Approval #${item.id}`,
      projectName: item.projectName || null,
      sourceLabel: "Approval",
      priority: "high",
      status: item.status || "review",
      dueAt: item.dueDate || null,
      createdAt: item.createdAt || null,
    }, seen);
  }

  for (const item of data.approvals?.quality || []) {
    pushUnique(candidates, {
      itemKey: `approval-qc-${item.id}`,
      title: item.title || `Approval #${item.id}`,
      projectName: item.projectName || null,
      sourceLabel: "Quality Approval",
      priority: "high",
      status: item.status || "review",
      dueAt: item.dueDate || null,
      createdAt: item.createdAt || null,
    }, seen);
  }

  return candidates.filter((candidate) => !isClosedStatus(candidate.status));
}

function withReason(candidate: HomeWorkCandidate, reason: HomePreviewReason): HomeWorkPreviewItem {
  return {
    ...candidate,
    href: `/my-work/tasks?itemKey=${encodeURIComponent(candidate.itemKey)}`,
    reason,
  };
}

export function buildMyWorkPreviewItems(allTaskData?: AllTaskData, limit = 5) {
  const candidates = buildHomeCandidates(allTaskData);

  const overdue = candidates.filter((candidate) => isOverdue(candidate.dueAt)).sort(candidateComparator);
  const blocked = candidates.filter((candidate) => normalizeStatus(candidate.status) === "blocked" && !isOverdue(candidate.dueAt)).sort(candidateComparator);
  const dueSoon = candidates.filter((candidate) => isDueSoon(candidate.dueAt) && !isOverdue(candidate.dueAt) && normalizeStatus(candidate.status) !== "blocked").sort(candidateComparator);
  const approvals = candidates.filter((candidate) => candidate.itemKey.startsWith("approval-")).sort(candidateComparator);

  const selected: HomeWorkPreviewItem[] = [];
  const selectedKeys = new Set<string>();
  const take = (items: HomeWorkCandidate[], reason: HomePreviewReason, maxCount: number) => {
    for (const item of items) {
      if (selected.length >= limit || maxCount <= 0) return;
      if (selectedKeys.has(item.itemKey)) continue;
      selected.push(withReason(item, reason));
      selectedKeys.add(item.itemKey);
      maxCount -= 1;
    }
  };

  take(overdue, "overdue", 2);
  take(blocked, "blocked", 1);
  take(dueSoon, "dueSoon", 1);
  take(approvals, "approval", 1);

  const fallback = [
    ...overdue,
    ...blocked,
    ...dueSoon,
    ...approvals,
    ...candidates.sort(candidateComparator),
  ];

  for (const item of fallback) {
    if (selected.length >= limit) break;
    if (selectedKeys.has(item.itemKey)) continue;
    const reason: HomePreviewReason =
      item.itemKey.startsWith("approval-")
        ? "approval"
        : normalizeStatus(item.status) === "blocked"
          ? "blocked"
          : isOverdue(item.dueAt)
            ? "overdue"
            : isDueSoon(item.dueAt)
              ? "dueSoon"
              : "next";
    selected.push(withReason(item, reason));
    selectedKeys.add(item.itemKey);
  }

  if (approvals.length > 0 && !selected.some((item) => item.reason === "approval")) {
    const approval = approvals[0];
    if (approval) {
      const replacement = withReason(approval, "approval");
      if (selected.length >= limit) {
        selected[selected.length - 1] = replacement;
      } else {
        selected.push(replacement);
      }
    }
  }

  return selected.slice(0, limit);
}
