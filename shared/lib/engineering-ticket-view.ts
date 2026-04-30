/**
 * Canonical engineering-ticket view-model.
 * Read by every surface that renders engineering tickets.
 */
import {
  normalizeEngineeringTicketStatus,
  getEngineeringTicketStatusLabel,
  getEngineeringTicketStatusBadgeClass,
  isTicketBlocked,
  isTicketInApproval,
  isTicketDoneForReporting,
  isTicketActive,
  type EngineeringTicketStatus,
} from "../engineering-ticket-status";

export interface EngineeringTicketViewInput {
  id: number;
  workItemId?: number | null;
  title: string;
  description?: string | null;
  status: string | null | undefined;
  priority?: string | null;
  projectId?: number | null;
  projectName?: string | null;

  // Dates
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  dueDate?: string | Date | null;

  // Progress
  percentComplete?: number | null;
  expectedPctComplete?: number | null;

  // Ownership
  ownerUserId?: number | null;
  ownerName?: string | null;
  assigneeUserIds?: number[] | null;
  assignees?: string[] | null;
  resolvedAssignees?: Array<{ id: number; name: string }> | null;

  // Plan / approval / hold context
  holdReason?: string | null;
  blockedType?: string | null;
  blockerReason?: string | null;
  approvalRequired?: boolean | null;
  trackingRag?: string | null;
  taskTypeTag?: string | null;
  linkedPlanItemId?: number | null;
  linkedDeliverableId?: number | null;
  linkedQualityItemInstanceId?: number | null;

  // Engineering metadata
  externalRef?: string | null;
  externalTaskId?: string | null;
  wbsCode?: string | null;
  tags?: string[] | string | null;

  completedAt?: string | Date | null;
  qcReviewedAt?: string | Date | null;

  // Project-level rollups (set by enricher)
  projectLinkedDeliverableCount?: number | null;
  projectLinkedDeliverables?: Array<{ id: number; title: string; status: string }> | null;
  approvalPendingDeliverableCount?: number | null;
  hasMicrosoftContext?: boolean | null;
  microsoftActionRequiredCount?: number | null;
  relatedMicrosoftItems?: unknown[] | null;
  stageContext?: string | null;
  sourceContextLabel?: string | null;
  deliverableContextLabel?: string | null;
}

export interface EngineeringTicketView {
  id: number;
  workItemId: number;
  title: string;
  description: string | null;

  /** Canonical lower_snake wire value. Always normalized. */
  status: EngineeringTicketStatus;
  /** Title-Case label for human display. */
  statusLabel: string;
  /** Tailwind classes for the status pill. */
  statusBadgeClass: string;
  /** Semantic colour token (slate / amber / sky / emerald / rose / violet). */
  statusColour: StatusColour;

  priority: string | null;
  projectId: number | null;
  projectName: string | null;

  startDate: string | null;
  endDate: string | null;
  dueDate: string | null;
  /** Working-days span between start and end, null when unknown. */
  durationDays: number | null;
  /** "Today" / "Tomorrow" / "Xd overdue" / formatted future date. */
  dueLabel: string;
  /** "overdue" / "today" / "tomorrow" / "soon" / "future" / "none". */
  dueUrgency: DueLabelUrgency;
  completedAt: string | null;
  qcReviewedAt: string | null;

  percentComplete: number;
  expectedPctComplete: number | null;

  ownerUserId: number | null;
  ownerName: string | null;
  ownerInitials: string | null;
  assigneeUserIds: number[];
  assignees: string[];
  resolvedAssignees: Array<{ id: number; name: string }>;

  holdReason: string | null;
  blockedType: string | null;
  blockerReason: string | null;
  approvalRequired: boolean;
  trackingRag: string | null;
  taskTypeTag: string | null;
  linkedPlanItemId: number | null;
  linkedDeliverableId: number | null;
  linkedQualityItemInstanceId: number | null;

  externalRef: string | null;
  externalTaskId: string | null;
  wbsCode: string | null;
  tags: string[];

  // Derived display flags — single source for the metrics counters.
  isComplete: boolean;
  isActive: boolean;
  isBlocked: boolean;
  isReviewNeeded: boolean;
  isApprovalPending: boolean;
  isUnassigned: boolean;
  isOverdue: boolean;

  // Project rollups
  projectLinkedDeliverableCount: number;
  projectLinkedDeliverables: Array<{ id: number; title: string; status: string }>;
  approvalPendingDeliverableCount: number;
  hasMicrosoftContext: boolean;
  microsoftActionRequiredCount: number;
  relatedMicrosoftItems: unknown[];
  stageContext: string | null;
  sourceContextLabel: string | null;
  deliverableContextLabel: string | null;
}

const REVIEW_STATUSES = new Set<EngineeringTicketStatus>(["provide_feedback"]);

export type DueLabelUrgency = "overdue" | "today" | "tomorrow" | "soon" | "future" | "none";

export type StatusColour = "slate" | "sky" | "amber" | "emerald" | "rose" | "violet";

const STATUS_COLOUR: Record<EngineeringTicketStatus, StatusColour> = {
  to_do: "slate",
  not_started: "slate",
  in_progress: "sky",
  hold: "rose",
  needs_approval: "violet",
  provide_feedback: "amber",
  operational_approval: "violet",
  qc_approved: "emerald",
  projects_assistance: "amber",
  complete: "emerald",
};

function getStatusColour(status: EngineeringTicketStatus): StatusColour {
  return STATUS_COLOUR[status] ?? "slate";
}

function normaliseTags(input: string[] | string | null | undefined): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((t) => String(t).trim()).filter(Boolean);
  return String(input)
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export const CANONICAL_TICKET_TAGS = {
  OVERDUE: "Overdue",
  UNASSIGNED: "Unassigned",
  BLOCKED: "Blocked",
  REVIEW: "Review",
  APPROVAL: "Approval",
  DELIVERABLES: "Deliverables",
  MICROSOFT_LINKED: "Microsoft Linked",
  QC_REVIEW_PENDING: "QC Review Pending",
} as const;

function deriveCanonicalTags(args: {
  inputTags: string[] | string | null | undefined;
  isOverdue: boolean;
  isUnassigned: boolean;
  isBlocked: boolean;
  isReviewNeeded: boolean;
  isApprovalPending: boolean;
  hasMicrosoftContext: boolean;
  projectLinkedDeliverableCount: number;
  qcReviewPending: boolean;
}): string[] {
  const tags = new Set(normaliseTags(args.inputTags));
  if (args.isOverdue) tags.add(CANONICAL_TICKET_TAGS.OVERDUE);
  if (args.isUnassigned) tags.add(CANONICAL_TICKET_TAGS.UNASSIGNED);
  if (args.isBlocked) tags.add(CANONICAL_TICKET_TAGS.BLOCKED);
  if (args.isReviewNeeded) tags.add(CANONICAL_TICKET_TAGS.REVIEW);
  if (args.isApprovalPending) tags.add(CANONICAL_TICKET_TAGS.APPROVAL);
  if (args.projectLinkedDeliverableCount > 0) tags.add(CANONICAL_TICKET_TAGS.DELIVERABLES);
  if (args.hasMicrosoftContext) tags.add(CANONICAL_TICKET_TAGS.MICROSOFT_LINKED);
  if (args.qcReviewPending) tags.add(CANONICAL_TICKET_TAGS.QC_REVIEW_PENDING);
  return Array.from(tags);
}

export function toIsoDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().split("T")[0];
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.includes("T") ? trimmed.split("T")[0] : trimmed;
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function diffDays(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const a = new Date(`${startIso}T00:00:00.000Z`).getTime();
  const b = new Date(`${endIso}T00:00:00.000Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function deriveDueLabel(dueIso: string | null, isComplete: boolean): {
  label: string;
  urgency: DueLabelUrgency;
} {
  if (!dueIso) return { label: "", urgency: "none" };
  const today = todayIso();
  const diff = diffDays(today, dueIso);
  if (diff === null) return { label: "", urgency: "none" };
  if (isComplete && diff < 0) return { label: "", urgency: "none" };
  if (diff < -1) return { label: `${Math.abs(diff)}d late`, urgency: "overdue" };
  if (diff === -1) return { label: "Yesterday", urgency: "overdue" };
  if (diff === 0) return { label: "Today", urgency: "today" };
  if (diff === 1) return { label: "Tomorrow", urgency: "tomorrow" };
  if (diff <= 7) return { label: `${diff}d`, urgency: "soon" };
  const formatted = new Date(`${dueIso}T00:00:00.000Z`).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
  });
  return { label: formatted, urgency: "future" };
}

export function getOwnerInitials(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Project a raw work_items row (already joined with owner / project name)
 * into the canonical engineering-ticket view-model. Pure function — no
 * I/O — so it can be called from server endpoints, the opportunity
 * drawer projection, and unit tests with the same result.
 */
export function projectEngineeringTicket(input: EngineeringTicketViewInput): EngineeringTicketView {
  const status = normalizeEngineeringTicketStatus(input.status);
  const startDate = toIsoDate(input.startDate);
  const endDate = toIsoDate(input.endDate ?? input.dueDate);
  const dueDate = toIsoDate(input.dueDate ?? input.endDate);

  const ownerName = input.ownerName?.trim() || null;
  const assigneeUserIds = Array.from(
    new Set(
      [
        ...((input.assigneeUserIds ?? []).filter((id): id is number => Number.isInteger(id))),
        ...(typeof input.ownerUserId === "number" ? [input.ownerUserId] : []),
      ],
    ),
  );
  const assigneeNames = (input.assignees ?? []).filter((value): value is string => Boolean(value));
  const resolvedAssignees = (input.resolvedAssignees ?? []).filter((entry) => entry && entry.name);

  const holdReason = input.holdReason?.trim() || null;
  const blockedType = input.blockedType?.trim() || null;
  const blockerReason = input.blockerReason?.trim() || null;

  const isComplete = isTicketDoneForReporting(status);
  const isActive = isTicketActive(status);
  const isBlocked = isTicketBlocked(status) || !!holdReason || !!blockedType;
  const isApprovalPending = isTicketInApproval(status);
  const isReviewNeeded = REVIEW_STATUSES.has(status);
  const isUnassigned =
    !ownerName && assigneeUserIds.length === 0 && assigneeNames.length === 0;
  const isOverdue = !isComplete && !!dueDate && dueDate < todayIso();
  const dueLabelInfo = deriveDueLabel(dueDate, isComplete);
  const qcReviewedAt = toIsoDate(input.qcReviewedAt);
  const qcReviewPending = !isComplete && !qcReviewedAt && REVIEW_STATUSES.has(status);

  const microsoftActionRequiredCount = input.microsoftActionRequiredCount ?? 0;
  const projectLinkedDeliverables = input.projectLinkedDeliverables ?? [];
  const projectLinkedDeliverableCount =
    input.projectLinkedDeliverableCount ?? projectLinkedDeliverables.length;
  const hasMicrosoftContext =
    input.hasMicrosoftContext === true ||
    microsoftActionRequiredCount > 0 ||
    (input.relatedMicrosoftItems?.length ?? 0) > 0;

  return {
    id: input.id,
    workItemId: input.workItemId ?? input.id,
    title: input.title ?? "",
    description: input.description ?? null,
    status,
    statusLabel: getEngineeringTicketStatusLabel(status),
    statusBadgeClass: getEngineeringTicketStatusBadgeClass(status),
    statusColour: getStatusColour(status),
    priority: input.priority ?? null,
    projectId: input.projectId ?? null,
    projectName: input.projectName ?? null,
    startDate,
    endDate,
    dueDate,
    durationDays: diffDays(startDate, endDate),
    dueLabel: dueLabelInfo.label,
    dueUrgency: dueLabelInfo.urgency,
    completedAt: toIsoDate(input.completedAt),
    qcReviewedAt,
    percentComplete: typeof input.percentComplete === "number" ? input.percentComplete : 0,
    expectedPctComplete: input.expectedPctComplete ?? null,
    ownerUserId: input.ownerUserId ?? null,
    ownerName,
    ownerInitials: getOwnerInitials(ownerName),
    assigneeUserIds,
    assignees: assigneeNames,
    resolvedAssignees,
    holdReason,
    blockedType,
    blockerReason,
    approvalRequired: input.approvalRequired === true,
    trackingRag: input.trackingRag ?? null,
    taskTypeTag: input.taskTypeTag ?? null,
    linkedPlanItemId: input.linkedPlanItemId ?? null,
    linkedDeliverableId: input.linkedDeliverableId ?? null,
    linkedQualityItemInstanceId: input.linkedQualityItemInstanceId ?? null,
    externalRef: input.externalRef ?? input.externalTaskId ?? null,
    externalTaskId: input.externalTaskId ?? input.externalRef ?? null,
    wbsCode: input.wbsCode ?? null,
    tags: deriveCanonicalTags({
      inputTags: input.tags,
      isOverdue,
      isUnassigned,
      isBlocked,
      isReviewNeeded,
      isApprovalPending,
      hasMicrosoftContext,
      projectLinkedDeliverableCount,
      qcReviewPending,
    }),
    isComplete,
    isActive,
    isBlocked,
    isReviewNeeded,
    isApprovalPending,
    isUnassigned,
    isOverdue,
    projectLinkedDeliverableCount,
    projectLinkedDeliverables,
    approvalPendingDeliverableCount: input.approvalPendingDeliverableCount ?? 0,
    hasMicrosoftContext,
    microsoftActionRequiredCount,
    relatedMicrosoftItems: input.relatedMicrosoftItems ?? [],
    stageContext: input.stageContext ?? null,
    sourceContextLabel: input.sourceContextLabel ?? null,
    deliverableContextLabel: input.deliverableContextLabel ?? null,
  };
}

// ── Metrics derivation (single source of consumer-surface counters) ──

export interface EngineeringTicketMetrics<T> {
  openTasks: T[];
  overdueTasks: T[];
  needsApprovalTasks: T[];
  holdTasks: T[];
  unassignedTasks: T[];
  blockedTasks: T[];
  reviewNeededTasks: T[];
  approvalPendingTasks: T[];
  projectLinkedDeliverableTasks: T[];
  microsoftLinkedTasks: T[];
  microsoftActionTasks: T[];
  done24hTasks: T[];
  dueThisWeekTasks: T[];
  qcReviewPendingTasks: T[];
}

export interface MetricsAccessor<T> {
  status: (row: T) => string | null | undefined;
  ownerUserId?: (row: T) => number | null | undefined;
  ownerName?: (row: T) => string | null | undefined;
  assigneeUserIds?: (row: T) => number[] | null | undefined;
  assignees?: (row: T) => string[] | null | undefined;
  dueDate?: (row: T) => string | Date | null | undefined;
  completedAt?: (row: T) => string | Date | null | undefined;
  holdReason?: (row: T) => string | null | undefined;
  blockedType?: (row: T) => string | null | undefined;
  isBlocked?: (row: T) => boolean | undefined;
  isReviewNeeded?: (row: T) => boolean | undefined;
  isApprovalPending?: (row: T) => boolean | undefined;
  isUnassigned?: (row: T) => boolean | undefined;
  hasMicrosoftContext?: (row: T) => boolean | undefined;
  microsoftActionRequiredCount?: (row: T) => number | null | undefined;
  projectLinkedDeliverableCount?: (row: T) => number | null | undefined;
}

export function deriveEngineeringTicketMetrics<T>(
  rows: T[],
  accessor: MetricsAccessor<T>,
): EngineeringTicketMetrics<T> {
  const today = todayIso();

  const openTasks: T[] = [];
  const overdueTasks: T[] = [];
  const needsApprovalTasks: T[] = [];
  const holdTasks: T[] = [];
  const unassignedTasks: T[] = [];
  const blockedTasks: T[] = [];
  const reviewNeededTasks: T[] = [];
  const approvalPendingTasks: T[] = [];
  const projectLinkedDeliverableTasks: T[] = [];
  const microsoftLinkedTasks: T[] = [];
  const microsoftActionTasks: T[] = [];
  const done24hTasks: T[] = [];
  const dueThisWeekTasks: T[] = [];
  const qcReviewPendingTasks: T[] = [];

  const sevenDaysOut = (() => {
    const d = new Date(`${today}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().split("T")[0];
  })();
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;

  for (const row of rows) {
    const status = normalizeEngineeringTicketStatus(accessor.status(row));
    const isComplete = isTicketDoneForReporting(status);
    if (status === "qc_approved") qcReviewPendingTasks.push(row);

    if (isComplete) {
      const completedRaw = accessor.completedAt?.(row);
      if (completedRaw) {
        const ts =
          completedRaw instanceof Date
            ? completedRaw.getTime()
            : new Date(String(completedRaw)).getTime();
        if (!Number.isNaN(ts) && ts >= cutoff24h) done24hTasks.push(row);
      }
      continue;
    }
    openTasks.push(row);

    const due = toIsoDate(accessor.dueDate ? accessor.dueDate(row) : null);
    if (due) {
      if (due < today) overdueTasks.push(row);
      else if (due <= sevenDaysOut) dueThisWeekTasks.push(row);
    }

    const holdReason = accessor.holdReason?.(row) ?? null;
    const blockedType = accessor.blockedType?.(row) ?? null;
    const blocked =
      accessor.isBlocked?.(row) === true ||
      isTicketBlocked(status) ||
      !!holdReason ||
      !!blockedType;
    if (status === "hold") holdTasks.push(row);
    if (blocked) blockedTasks.push(row);

    if (accessor.isReviewNeeded?.(row) === true || REVIEW_STATUSES.has(status)) {
      reviewNeededTasks.push(row);
    }

    const approval = accessor.isApprovalPending?.(row) === true || isTicketInApproval(status);
    if (approval) {
      approvalPendingTasks.push(row);
      needsApprovalTasks.push(row);
    }

    let unassigned = accessor.isUnassigned?.(row);
    if (unassigned === undefined) {
      const ownerUserId = accessor.ownerUserId?.(row) ?? null;
      const ownerName = accessor.ownerName?.(row) ?? null;
      const assigneeIds = accessor.assigneeUserIds?.(row) ?? [];
      const assigneeNames = accessor.assignees?.(row) ?? [];
      unassigned =
        !ownerUserId &&
        !ownerName &&
        (assigneeIds?.length ?? 0) === 0 &&
        (assigneeNames?.length ?? 0) === 0;
    }
    if (unassigned) unassignedTasks.push(row);

    const deliverableCount = accessor.projectLinkedDeliverableCount?.(row) ?? 0;
    if (deliverableCount > 0) projectLinkedDeliverableTasks.push(row);

    const msActionCount = accessor.microsoftActionRequiredCount?.(row) ?? 0;
    const hasMsContext = accessor.hasMicrosoftContext?.(row) === true || msActionCount > 0;
    if (hasMsContext) microsoftLinkedTasks.push(row);
    if (msActionCount > 0) microsoftActionTasks.push(row);
  }

  return {
    openTasks,
    overdueTasks,
    needsApprovalTasks,
    holdTasks,
    unassignedTasks,
    blockedTasks,
    reviewNeededTasks,
    approvalPendingTasks,
    projectLinkedDeliverableTasks,
    microsoftLinkedTasks,
    microsoftActionTasks,
    done24hTasks,
    dueThisWeekTasks,
    qcReviewPendingTasks,
  };
}
