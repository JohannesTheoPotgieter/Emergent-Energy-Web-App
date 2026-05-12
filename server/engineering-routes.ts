// Error breakdown: TS7006 implicit-any: 38, TS2345 query/param types: 16, other: 4
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc, asc, sql, inArray, isNull, lt, gt, or, ne } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { sanitizeFilename, allowedFileFilter } from "./lib/upload-security";
import {
  taskComments, taskActivityLog, taskWatchers, taskDeliverables,
  deliverables, deliverableVersions, deliverableFiles, deliverableEvents,
  spFilePointers,
  projectTeamMembers, projectPlan, qcWarning, qcWarningEvent,
  qcItemInstance, qcChecklist, qcTemplateItem, users, projectInfo, projectPhaseHistory, projectExecutionState,
  projectEngApprovals, projectEngStages, projectEngTasks, projectEngDeliverables, engStageTemplates,
  workItems, workItemAssignments, notifications, notificationThrottle,
  msObjects,
  phaseTemplate as phaseTemplateTbl,
  uploadMetadata, refreshLogs, writebackAuditLog, phaseTemplateApplication, appSettings,
  TASK_STATUSES, TASK_WORKSTREAMS, TASK_PRIORITIES, PROJECT_PHASES,
  DELIVERABLE_STATUSES, PROJECT_PHASE_LABELS,
  type ProjectPhase,
} from "@shared/schema";
import { applyTemplate } from "./template-routes";
import { syncProjectSplitTables } from "./lib/project-info-sync";
import { requireAuthority, requirePermission, evaluateAuthorityForRequest } from "./permission-middleware";
import { logAuditFromReq } from "./audit-logger";
import { ApiError, sendError, badRequest, notFound, forbidden, serverError } from "./lib/api-error";
import { listEngineeringWorkItems, getEngineeringWorkItemById, createEngineeringWorkItem, updateEngineeringWorkItem, deleteEngineeringWorkItem, generateDefaultEngineeringWorkItemsForProject, mapToOpsStatus, toCanonicalStatus, type EngTask } from "./work-items-adapter";
import { generateWorkItemReconciliationReport } from "./lib/reconciliation/work-item-reconciliation";
import { assertTaskWorkflowTransition, buildTaskWorkflowContext, buildTaskWorkflowContextsForIds, TaskWorkflowGuardError } from "./lib/task-workflow-guard";
import { isTaskComplete, isTaskCompleteForReporting, isApprovalState } from "@shared/task-status";
import {
  isTicketBlocked,
  normalizeEngineeringTicketStatus,
} from "@shared/engineering-ticket-status";
import { projectEngineeringTicket } from "@shared/lib/engineering-ticket-view";
import { getEffectiveUser, jwtAuth, requireAuth } from "./auth-context";
import { requireAdmin } from "./middleware/requireAdmin";
// Engineering PR 2 — canonical RBAC + body validation imports.
// Replaces local `requireAdminOrEpm` shim + hardcoded role strings.
import { requireRole as requireRoleCanonical } from "./middleware/requireRole";
import { ADMIN_ROLES, normalizeRoleForPermissions } from "@shared/schema";
import { validateBody } from "./middleware/validateBody";
import { z } from "zod";
// Engineering PR 3 — repository extraction (Tier 3). Mirrors Quality #900:
// 5 reused query helpers + 1 spread-null coalesce. Not a full repository
// migration (most db.* calls in this file appear once and don't justify
// a function). See engineering-repository.ts for what was extracted.
import {
  findProjectWithExecutionState,
  findProjectInfoById,
  resolveProjectIdByName,
  findEngineeringWorkItem,
  findDeliverableById,
  findUserName,
  coalesceProjectExecState,
} from "./repositories/engineering-repository";
import { getAssignmentsForEntity, getAssignmentsForEntities, listAssignableDirectory } from "./services/assignment-service";
import { buildMyWorkSourceLinks } from "./lib/my-work-source-links";
import { runCascadesAfterUpdate, validateParentCompletion } from "./services/task-cascade-service";
import { paramStr, parseIntParam } from "./lib/req-params";

const approvalUploadsDir = path.join(process.cwd(), "uploads", "approvals");
if (!fs.existsSync(approvalUploadsDir)) fs.mkdirSync(approvalUploadsDir, { recursive: true });
const approvalUpload = multer({
  storage: multer.diskStorage({
    destination: approvalUploadsDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: allowedFileFilter,
});

type AppUser = { id: number; email: string; name: string; role: string; };

function getUser(req: Request): AppUser {
  return getEffectiveUser(req) as AppUser;
}

function getUserRole(req: Request): string {
  return getEffectiveUser(req)?.role || "";
}

// H8 hotfix — strip server-controlled keys from a spread-style update body.
// Several handlers previously did `db.update(...).set({ ...req.body, ... })`
// which lets a caller assign ANY column (id, projectId, ownerUserId,
// createdBy, importRunId, etc.) by including it in the JSON. This is a
// classic mass-assignment vulnerability.
//
// This helper is a *denylist* — it removes keys that should never come
// from user input. It is intentionally conservative: when in doubt, add
// the key here. Engineering PR 2 will replace every caller with a strict
// Zod allowlist via `validateBody(schema)` — at which point this helper
// becomes unused and can be removed.
export const FORBIDDEN_BODY_KEYS = new Set<string>([
  // Identity / lineage
  "id",
  "createdAt",
  "createdBy",
  "updatedAt",       // handlers set this themselves
  "deletedAt",
  "deletedBy",
  // Cross-entity FKs (routes pass these via params/path, not body)
  "projectId",
  "clientId",
  "ownerUserId",     // set via separate /assignees endpoint
  "uploadedByUserId",
  "cpSignedByUserId",
  // Import-pipeline metadata
  "source",
  "sourceRow",
  "sourceSheet",
  "importRunId",
  "legacyTable",
  "legacyId",
  "externalRef",
  // Workflow flags that must transition via dedicated routes
  "approvedBy",
  "approvedAt",
  "isApproved",
  "completedAt",
  // Sharing / visibility
  "isShared",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- return type
// is intentionally `any`-shaped so existing spread-style update bodies keep
// compiling without per-field assertions. Engineering PR 2 (#909) pairs
// this denylist with `.passthrough()` Zod schemas — Zod validates the
// shape of *known* fields while this helper filters server-only keys
// out of the spread. The original "replace with strict Zod" plan was
// not adopted because the handlers depend on the flexible spread shape
// (50+ fields piped through `createEngineeringWorkItem` / Drizzle inserts).
export function stripServerFields(body: unknown): Record<string, any> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!FORBIDDEN_BODY_KEYS.has(k)) out[k] = v;
  }
  return out;
}

// Trust fix: canonical lowercase to match listEngineeringWorkItems() output.
// The previous UPPERCASE sets silently failed every comparison because
// the work-items adapter returns canonical lowercase since migration
// 20260413_status_casing_normalization.
// Engineering PR 2: use canonical ADMIN_ROLES instead of a local set.
const MICROSOFT_ADMIN_ROLES: ReadonlySet<string> = new Set(ADMIN_ROLES);

// Status flag detection routes through the canonical helpers in
// shared/engineering-ticket-status.ts. The previous local
// implementation uppercased the input but compared against lower-case
// constants, so post-migration tickets never matched and the
// `isBlocked` / `isReviewNeeded` / `isApprovalPending` enrichment flags
// were always false.
function isBlockedStatus(status?: string | null): boolean {
  return isTicketBlocked(status);
}

function isReviewNeededStatus(status?: string | null): boolean {
  return normalizeEngineeringTicketStatus(status) === "provide_feedback";
}

function isApprovalPendingStatus(status?: string | null): boolean {
  const canonical = normalizeEngineeringTicketStatus(status);
  return canonical === "needs_approval" || canonical === "operational_approval";
}

function isDeliverableApprovalPendingStatus(status?: string | null): boolean {
  const canonical = normalizeEngineeringTicketStatus(status);
  if (canonical === "complete" || canonical === "qc_approved") return false;
  // Free-form deliverable statuses can be anything: keep the substring
  // check but normalise once to lower-case so it survives Title-Case input.
  const lower = (status ?? "").trim().toLowerCase();
  if (!lower) return false;
  return ["approval", "review", "submitted", "pending", "awaiting", "qc"].some((token) =>
    lower.includes(token),
  );
}

async function isLocalSyncedSaveFlowEnabled(): Promise<boolean> {
  try {
    const { getRolloutFeatureFlags } = await import("./lib/feature-flags");
    const flags = await getRolloutFeatureFlags();
    return flags.local_synced_save_flow === true;
  } catch {
    return false;
  }
}

function getLocalSyncedPathSettingKey(userId: number): string {
  return `local_synced_path_user_${userId}`;
}

function getSendFlowFallbackSettingKey(userId: number): string {
  return `local_synced_fallback_user_${userId}`;
}

async function getLocalSyncedPathForUser(userId: number): Promise<string | null> {
  const key = getLocalSyncedPathSettingKey(userId);
  const rows = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const path = rows[0]?.value?.trim();
  return path || null;
}

async function getFallbackPreferenceForUser(userId: number): Promise<"download" | "clipboard"> {
  const key = getSendFlowFallbackSettingKey(userId);
  const rows = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const value = (rows[0]?.value || "download").toLowerCase();
  return value === "clipboard" ? "clipboard" : "download";
}

// Engineering PR 2 — replaced the local `requireAdminOrEpm` shim with the
// canonical `requireRole` middleware. The old shim hardcoded 11 role strings
// including 3 stale names (`eng_program_manager` lowercase alias,
// `ENGINEERING_PROGRAM_MANAGER`, `HEAD_OF_DESIGN`) that are NOT in
// COMPANY_ROLES and were dead matches. The canonical roles below cover the
// real EPM-or-admin gate (Engineering Manager replaces the stale EPM role).
const requireAdminOrEpm = requireRoleCanonical([
  ...ADMIN_ROLES,
  "CCO",
  "CFO",
  "PROGRAM_MANAGER",
  "PROGRAM_FINANCE_MANAGER",
  "CONSTRUCTION_MANAGER",
  "ENGINEERING_MANAGER",
  "QUALITY_MANAGER",
]);

function requireEpmChallenge(req: Request, res: Response, next: NextFunction) {
  if ((ADMIN_ROLES as readonly string[]).includes(getUserRole(req))) return next();
  if ((req.session as any)?.epmChallengePassed) return next();
  res.status(403).json({ error: "epm_challenge_required", message: "EPM access code required", code: "EPM_CHALLENGE_REQUIRED" });
}

/** Insert an in-app notification row with throttle deduplication. Silently no-ops on error. */
async function createNotification(recipientUserId: number, eventType: string, title: string, body: string | null, opts: {
  projectName?: string; projectId?: number; linkedTaskId?: number; linkedDeliverableId?: number; linkedWarningId?: number; linkedPlanItemId?: number;
} = {}) {
  try {
    // Throttle: skip if same recipient+event+entity was notified in last 5 minutes
    const entityId = opts.linkedTaskId || opts.linkedDeliverableId || opts.linkedWarningId || 0;
    const entityType = opts.linkedTaskId ? "task" : opts.linkedDeliverableId ? "deliverable" : "other";
    if (entityId) {
      const [recent] = await db.select({ id: notificationThrottle.id })
        .from(notificationThrottle)
        .where(and(
          eq(notificationThrottle.recipientUserId, recipientUserId),
          eq(notificationThrottle.eventType, eventType),
          eq(notificationThrottle.entityType, entityType),
          eq(notificationThrottle.entityId, entityId),
          gt(notificationThrottle.lastSentAt, new Date(Date.now() - 5 * 60_000)),
        ));
      if (recent) return null; // Throttled — skip duplicate
      await db.insert(notificationThrottle).values({ recipientUserId, eventType, entityType, entityId })
        .onConflictDoNothing();
    }

    const [row] = await db.insert(notifications).values({
      recipientUserId,
      eventType,
      title,
      body,
      projectName: opts.projectName ?? null,
      projectId: opts.projectId ?? null,
      linkedTaskId: opts.linkedTaskId ?? null,
      linkedDeliverableId: opts.linkedDeliverableId ?? null,
      linkedWarningId: opts.linkedWarningId ?? null,
      linkedPlanItemId: opts.linkedPlanItemId ?? null,
    }).returning();
    return row;
  } catch (err) {
    console.error("[Notifications] Failed to create notification:", err);
    return null;
  }
}

/**
 * Enrich engineering tasks with resolved assignees, deliverables context,
 * Microsoft items, stage context, and computed flags.
 * Used by both the task list and task detail endpoints.
 */
async function enrichEngineeringTasks(tasks: EngTask[], req: Request): Promise<any[]> {
  if (tasks.length === 0) return [];

  const { buildUserMap, mergeResolvedWithTextNames } = await import("./user-resolver");
  const userMap = await buildUserMap();
  const visibleProjectIds = Array.from(
    new Set(
      tasks
        .map((task) => (typeof task.projectId === "number" ? task.projectId : null))
        .filter((value): value is number => value != null && Number.isInteger(value) && value > 0),
    ),
  );
  const canViewAllMicrosoftContext = MICROSOFT_ADMIN_ROLES.has(getUserRole(req));
  const currentUserId = getUser(req).id;

  let deliverableRows: any[] = [];
  let microsoftRows: any[] = [];
  try {
    [deliverableRows, microsoftRows] = await Promise.all([
      visibleProjectIds.length > 0
        ? db.select({
            id: deliverables.id,
            projectId: deliverables.projectId,
            title: deliverables.title,
            status: deliverables.status,
            updatedAt: deliverables.updatedAt,
          })
          .from(deliverables)
          .where(inArray(deliverables.projectId, visibleProjectIds))
          .orderBy(desc(deliverables.updatedAt))
        : Promise.resolve([]),
      visibleProjectIds.length > 0
        ? db.select({
            id: msObjects.id,
            userId: msObjects.userId,
            linkedProjectId: msObjects.linkedProjectId,
            linkedTaskId: msObjects.linkedTaskId,
            type: msObjects.type,
            subjectOrTitle: msObjects.subjectOrTitle,
            webLink: msObjects.webLink,
            actionRequired: msObjects.actionRequired,
            receivedOrStartDatetime: msObjects.receivedOrStartDatetime,
          })
          .from(msObjects)
          .where(and(
            inArray(msObjects.linkedProjectId, visibleProjectIds),
            ne(msObjects.dismissed, true),
            ...(canViewAllMicrosoftContext ? [] : [eq(msObjects.userId, currentUserId)]),
          ))
          .orderBy(desc(msObjects.receivedOrStartDatetime))
        : Promise.resolve([]),
    ]);
  } catch (enrichErr: any) {
    console.warn("[Engineering] Non-fatal enrichment error (deliverables/microsoft):", enrichErr.message);
  }

  const deliverablesByProject = new Map<number, Array<{
    id: number;
    title: string;
    status: string;
    updatedAt: Date | null;
  }>>();
  for (const row of deliverableRows) {
    const list = deliverablesByProject.get(row.projectId) || [];
    list.push({ id: row.id, title: row.title, status: row.status, updatedAt: row.updatedAt });
    deliverablesByProject.set(row.projectId, list);
  }

  const microsoftByProject = new Map<number, Array<{
    id: number;
    linkedTaskId: number | null;
    type: string;
    title: string | null;
    webLink: string | null;
    actionRequired: boolean;
    receivedOrStartDatetime: Date | null;
  }>>();
  for (const row of microsoftRows) {
    const projectKey = typeof row.linkedProjectId === "number" ? row.linkedProjectId : null;
    if (!projectKey) continue;
    const list = microsoftByProject.get(projectKey) || [];
    list.push({
      id: row.id,
      linkedTaskId: row.linkedTaskId,
      type: row.type,
      title: row.subjectOrTitle,
      webLink: row.webLink,
      actionRequired: row.actionRequired === true,
      receivedOrStartDatetime: row.receivedOrStartDatetime,
    });
    microsoftByProject.set(projectKey, list);
  }

  const allWorkItemIds: number[] = tasks.map((t) => t.workItemId || t.id).filter(Boolean);
  const stageContextMap = new Map<number, string>();
  try {
    const stageLinks = allWorkItemIds.length > 0
      ? await db.select({
          workItemId: projectEngTasks.workItemId,
          stageName: engStageTemplates.name,
        })
        .from(projectEngTasks)
        .innerJoin(projectEngStages, eq(projectEngTasks.projectEngStageId, projectEngStages.id))
        .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
        .where(sql`${projectEngTasks.workItemId} IN (${sql.join(allWorkItemIds.map((id: number) => sql`${id}`), sql`, `)})`)
      : [];
    for (const sl of stageLinks) {
      if (sl.workItemId) stageContextMap.set(sl.workItemId, sl.stageName);
    }
  } catch (stageErr: any) {
    console.warn("[Engineering] Non-fatal stage context error:", stageErr.message);
  }

  return tasks.map((t) => {
    const resolvedAssigneeIds = Array.from(
      new Set([
        ...((t.assigneeUserIds || []).filter((uid: number) => Number.isInteger(uid)) as number[]),
        ...(typeof t.ownerUserId === "number" ? [t.ownerUserId] : []),
      ]),
    );
    const idResolved = resolvedAssigneeIds.map((uid: number) => userMap.get(uid)).filter((u): u is NonNullable<typeof u> => Boolean(u));
    const mergedAssignees = mergeResolvedWithTextNames(idResolved, t.assignees, userMap);
    const projectDeliverables = typeof t.projectId === "number" ? (deliverablesByProject.get(t.projectId) || []) : [];
    const rawMicrosoftItems = typeof t.projectId === "number" ? (microsoftByProject.get(t.projectId) || []) : [];
    const projectLinks = t.projectName
      ? buildMyWorkSourceLinks({ source: "engineering_task", rawId: t.id, projectName: t.projectName })
      : null;
    const deliverableLinks = t.projectName
      ? buildMyWorkSourceLinks({ source: "deliverables", rawId: t.id, projectName: t.projectName })
      : null;
    const relatedMicrosoftItems = rawMicrosoftItems.slice(0, 3).map((item) => {
      const msLinks = buildMyWorkSourceLinks({
        source: "microsoft",
        rawId: item.id,
        projectName: t.projectName || null,
        sourceType: item.type,
        webLink: item.webLink,
      });
      return {
        id: item.id, linkedTaskId: item.linkedTaskId, type: item.type,
        title: item.title, webLink: item.webLink, actionRequired: item.actionRequired,
        receivedOrStartDatetime: item.receivedOrStartDatetime,
        sourceHref: msLinks.sourceHref, sourceContextLabel: msLinks.sourceContextLabel,
        externalHref: msLinks.externalHref,
      };
    });
    const microsoftActionRequiredCount = rawMicrosoftItems.filter((item) => item.actionRequired).length;
    const approvalPendingDeliverableCount = projectDeliverables.filter((item) =>
      isDeliverableApprovalPendingStatus(item.status),
    ).length;

    const ownerName = t.ownerUserId
      ? userMap.get(t.ownerUserId)?.name ?? t.ownerName ?? null
      : t.ownerName ?? null;
    const sourceContextLabel = stageContextMap.has(t.workItemId || t.id)
      ? `Engineering Stage: ${stageContextMap.get(t.workItemId || t.id)}`
      : (projectLinks?.sourceContextLabel || null);

    // Project the row through the canonical engineering-ticket
    // view-model so the status pill, dates, percent complete, owner
    // initials, "Xd overdue" and blocked/review/approval flags match
    // every other consumer surface (Plan tab, Standup, Opportunity
    // drawer, Milestone Tracker, Action Launchpad).
    const view = projectEngineeringTicket({
      id: t.id,
      workItemId: t.workItemId ?? t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      projectId: t.projectId,
      projectName: t.projectName,
      startDate: t.startDate,
      endDate: t.endDate,
      dueDate: t.dueDate ?? t.endDate,
      percentComplete: t.percentComplete,
      expectedPctComplete: t.expectedPctComplete,
      ownerUserId: t.ownerUserId,
      ownerName,
      assigneeUserIds: resolvedAssigneeIds,
      assignees: mergedAssignees.map((user: { name: string }) => user.name),
      resolvedAssignees: mergedAssignees.map((user: { id: number; name: string }) => ({
        id: user.id,
        name: user.name,
      })),
      holdReason: t.holdReason,
      blockedType: t.blockedType,
      blockerReason: t.blockerReason,
      approvalRequired: t.approvalRequired,
      trackingRag: t.trackingRag,
      taskTypeTag: t.taskTypeTag,
      linkedPlanItemId: t.linkedPlanItemId,
      linkedDeliverableId: t.linkedDeliverableId,
      linkedQualityItemInstanceId: t.linkedQualityItemInstanceId,
      externalRef: t.externalRef,
      externalTaskId: t.externalTaskId ?? t.externalRef,
      wbsCode: t.wbsCode ?? t.taskNumber,
      projectLinkedDeliverableCount: projectDeliverables.length,
      projectLinkedDeliverables: projectDeliverables.slice(0, 3).map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
      })),
      approvalPendingDeliverableCount,
      hasMicrosoftContext: rawMicrosoftItems.length > 0,
      microsoftActionRequiredCount,
      relatedMicrosoftItems,
      stageContext: stageContextMap.get(t.workItemId || t.id) || null,
      sourceContextLabel,
      deliverableContextLabel: deliverableLinks?.sourceContextLabel || null,
    });

    return {
      ...t,
      // Canonical view-model fields override the raw row so consumers
      // never see Title-Case status or stale "Not Started" defaults.
      ...view,
      assigneeUserId: resolvedAssigneeIds[0] || null,
      resolvedOwner: t.ownerUserId ? userMap.get(t.ownerUserId) || null : null,
      deliverableContextHref: deliverableLinks?.sourceHref || null,
      projectHref: projectLinks?.projectHref || null,
      sourceHref: projectLinks?.sourceHref || null,
      externalHref: projectLinks?.externalHref || null,
    };
  });
}

// ===========================================================================
// Engineering PR 2 — Zod schemas for every previously-unvalidated mutating
// endpoint (audit list A). Schemas are grouped by surface: local-config,
// project-team, tasks, deliverables, file-pointers, warnings, lifecycle.
// `.strict()` is used where the body shape is fully known. The five
// `mixed-with-stripServerFields` handlers (task PATCH, deliverable INSERT/
// PATCH, deliverableFiles INSERT, qcWarning PATCH) use `.passthrough()`
// so the existing denylist helper still filters server-only keys; the
// schema only validates known fields.
// ===========================================================================

const localSyncedSaveConfigSchema = z.object({
  mappedPath: z.string().min(1).max(1000).optional().nullable(),
  fallbackPreference: z.enum(["download", "clipboard"]).optional(),
}).strict();

const projectTeamCreateSchema = z.object({
  projectName: z.string().min(1).max(500),
  userId: z.number().int().positive(),
  roleOnProject: z.string().min(1).max(100),
}).strict();

const engTaskCreateSchema = z.object({
  projectId: z.number().int().positive().nullable().optional(),
  projectName: z.string().nullable().optional(),
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  phase: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  ownerUserId: z.number().int().nullable().optional(),
  assignees: z.array(z.union([z.string(), z.number()])).optional(),
  plannedHours: z.union([z.string(), z.number()]).nullable().optional(),
  taskCategory: z.string().nullable().optional(),
  bucket: z.string().nullable().optional(),
}).passthrough(); // allow additional fields the adapter pipes through

// Task PATCH still goes through `stripServerFields(req.body)` in the
// handler. The schema validates the known editable shape but stays
// `.passthrough()` so the denylist remains effective.
const engTaskUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  percentComplete: z.union([z.string(), z.number()]).nullable().optional(),
  comment: z.string().nullable().optional(),
  holdReason: z.string().nullable().optional(),
  blockedType: z.string().nullable().optional(),
  blockerReason: z.string().nullable().optional(),
  trackingRag: z.string().nullable().optional(),
  taskTypeTag: z.string().nullable().optional(),
  linkedPlanItemId: z.number().int().nullable().optional(),
  linkedDeliverableId: z.number().int().nullable().optional(),
  linkedQualityItemInstanceId: z.number().int().nullable().optional(),
  plannedHours: z.union([z.string(), z.number()]).nullable().optional(),
  projectId: z.number().int().nullable().optional(), // stripped by stripServerFields anyway
  projectName: z.string().nullable().optional(),
}).passthrough();

const engTaskSendForApprovalSchema = z.object({
  note: z.string().max(5000).optional(),
  localSave: z.union([z.boolean(), z.string()]).optional(),
  projectSuggestion: z.string().optional(),
  projectFinal: z.string().optional(),
  projectOverrideReason: z.string().optional(),
  routeSuggestion: z.string().optional(),
  routeFinal: z.string().optional(),
  routeOverrideReason: z.string().optional(),
}).passthrough(); // multipart — multer also adds req.file

const engTaskSendDeliverableSchema = z.object({
  recipientUserId: z.union([z.number().int(), z.string()]).optional(),
  recipientSuggestion: z.string().optional(),
  recipientFinal: z.string().optional(),
  recipientOverrideReason: z.string().optional(),
  linkedProjectSuggestion: z.string().optional(),
  linkedProjectFinal: z.string().optional(),
  linkedProjectOverrideReason: z.string().optional(),
  note: z.string().max(5000).optional(),
  localSave: z.union([z.boolean(), z.string()]).optional(),
}).passthrough(); // multipart

const engTaskBulkUpdateSchema = z.object({
  taskIds: z.array(z.number().int().positive()).min(1).max(200),
  updates: z.object({
    status: z.string().optional(),
    holdReason: z.string().nullable().optional(),
    blockedType: z.string().nullable().optional(),
    priority: z.string().optional(),
    ownerUserId: z.number().int().nullable().optional(),
  }).passthrough(),
}).strict();

const engTaskLinkSchema = z.object({
  linkedPlanItemId: z.number().int().nullable().optional(),
  linkedDeliverableId: z.number().int().nullable().optional(),
  linkedQualityItemInstanceId: z.number().int().nullable().optional(),
}).strict();

const engTaskWatcherAddSchema = z.object({
  userId: z.number().int().positive(),
}).strict();

const engTaskCommentSchema = z.object({
  body: z.string().min(1).max(10000),
}).strict();

const engTaskSubtaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  phase: z.string().nullable().optional(),
  ownerUserId: z.number().int().nullable().optional(),
}).strict();

// Deliverable INSERT / PATCH still use stripServerFields. .passthrough()
// keeps the existing flexible shape working.
const deliverableCreateSchema = z.object({
  projectId: z.number().int().positive(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  milestoneType: z.string().nullable().optional(),
  plannedDate: z.string().nullable().optional(),
}).passthrough();

const deliverableUpdateSchema = z.object({
  status: z.string().optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  plannedDate: z.string().nullable().optional(),
  actualDate: z.string().nullable().optional(),
}).passthrough();

const deliverableFeedbackSchema = z.object({
  feedbackText: z.string().min(1).max(10000),
}).strict();

const deliverableReviseSchema = z.object({
  changeReason: z.string().min(1).max(2000),
  impactJson: z.unknown().optional(),
}).strict();

const deliverableFileCreateSchema = z.object({
  fileName: z.string().min(1).max(500).optional(),
  fileUrl: z.string().max(2048).optional().nullable(),
  fileSize: z.union([z.number(), z.string()]).optional(),
  contentType: z.string().max(255).optional().nullable(),
}).passthrough(); // stripServerFields applies; keep extra-fields flexibility

const filePointerCreateSchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.union([z.number().int(), z.string()]),
  spSiteId: z.string().nullable().optional(),
  spDriveId: z.string().nullable().optional(),
  spFileItemId: z.string().nullable().optional(),
  fileName: z.string().max(500).optional(),
  label: z.string().nullable().optional(),
  siteId: z.string().nullable().optional(),
  driveId: z.string().nullable().optional(),
  fileItemId: z.string().nullable().optional(),
  webUrl: z.string().max(2048).nullable().optional(),
}).passthrough();

const warningScanSchema = z.object({
  projectName: z.string().min(1).max(500),
}).strict();

const warningUpdateSchema = z.object({
  status: z.string().optional(),
  note: z.string().nullable().optional(),
}).passthrough(); // stripServerFields applies

const warningAcknowledgeSchema = z.object({
  reason: z.string().max(2000).optional().nullable(),
}).strict();

const markCpSignedSchema = z.object({
  evidenceType: z.string().min(1).max(100),
  emailSubject: z.string().max(1000).optional().nullable(),
  emailDate: z.string().nullable().optional(),
  fileId: z.union([z.number().int(), z.string()]).optional().nullable(),
}).strict();

const phaseChangeSchema = z.object({
  toPhase: z.string().min(1).max(100),
  reason: z.string().max(2000).optional(),
  overrideSequence: z.boolean().optional(),
}).strict();

const emptyBodySchema = z.object({}).strict();

export function registerEngineeringRoutes(app: Express) {

  app.use("/api/eng", jwtAuth);
  app.use("/api/deliverables", jwtAuth);
  app.use("/api/project-team", jwtAuth);
  app.use("/api/home", jwtAuth);
  app.use("/api/dashboard", jwtAuth);
  app.get("/api/eng/local-synced-save/config", requireAuth, async (req, res) => {
    try {
      const user = getUser(req);
      const [enabled, mappedPath, fallbackPreference] = await Promise.all([
        isLocalSyncedSaveFlowEnabled(),
        getLocalSyncedPathForUser(user.id),
        getFallbackPreferenceForUser(user.id),
      ]);

      res.json({ enabled, mappedPath, fallbackPreference });
    } catch (err: any) {
      sendError(res, serverError("Failed to load local synced save config"));
    }
  });

  app.put("/api/eng/local-synced-save/config", requireAuth, requirePermission("engineering", "edit"), validateBody(localSyncedSaveConfigSchema), async (req, res) => {
    try {
      const user = getUser(req);
      const mappedPath = typeof req.body?.mappedPath === "string" ? req.body.mappedPath.trim() : "";
      const fallbackPreference = req.body?.fallbackPreference === "clipboard" ? "clipboard" : "download";

      await db.insert(appSettings).values({
        key: getLocalSyncedPathSettingKey(user.id),
        value: mappedPath,
        updatedBy: user.name,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: mappedPath, updatedBy: user.name, updatedAt: new Date() },
      });

      await db.insert(appSettings).values({
        key: getSendFlowFallbackSettingKey(user.id),
        value: fallbackPreference,
        updatedBy: user.name,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: fallbackPreference, updatedBy: user.name, updatedAt: new Date() },
      });

      logAuditFromReq(req, {
        entityType: "local_synced_save_config",
        entityId: String(user.id),
        action: "update",
        changesJson: { mappedPath, fallbackPreference },
      });

      res.json({ ok: true, mappedPath, fallbackPreference });
    } catch (err: any) {
      sendError(res, serverError("Failed to save local synced save config"));
    }
  });

  // ========== PROJECT TEAM MEMBERSHIP ==========

  app.get("/api/project-team/:projectName", requireAuth, requirePermission("engineering", "view"), async (req, res) => {
    try {
      const members = await db.select({
        id: projectTeamMembers.id,
        projectName: projectTeamMembers.projectName,
        userId: projectTeamMembers.userId,
        roleOnProject: projectTeamMembers.roleOnProject,
        createdAt: projectTeamMembers.createdAt,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
      })
      .from(projectTeamMembers)
      .leftJoin(users, eq(projectTeamMembers.userId, users.id))
      .where(eq(projectTeamMembers.projectName, paramStr(req.params.projectName)));
      res.json(members);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/project-team", requireAuth, requireAdminOrEpm, validateBody(projectTeamCreateSchema), async (req, res) => {
    try {
      const { projectName, userId, roleOnProject } = req.body;
      const [member] = await db.insert(projectTeamMembers).values({ projectName, userId, roleOnProject }).returning();
      logAuditFromReq(req, { entityType: "project_team", entityId: String(member.id), action: "create", projectName, changesJson: { description: "Team member added", userId, roleOnProject } });
      res.json(member);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.delete("/api/project-team/:id", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return sendError(res, badRequest("Invalid ID"));
      await db.delete(projectTeamMembers).where(eq(projectTeamMembers.id, id));
      logAuditFromReq(req, { entityType: "project_team", entityId: paramStr(req.params.id), action: "delete", changesJson: { description: "Team member removed" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/team-members", requireAuth, requirePermission("engineering", "view"), async (_req, res) => {
    try {
      const assignable = await listAssignableDirectory();
      const allUsers = assignable
        .filter((entry) => entry.assigneeType === "internal_user")
        .map((entry) => ({
          id: entry.assigneeId,
          name: entry.displayLabel,
          email: entry.secondaryLabel,
          role: entry.roleTags[0] || "",
        }));
      res.json(allUsers);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/pm-assignable-users", requireAuth, requirePermission("engineering", "view"), async (_req, res) => {
    try {
      const assignable = await listAssignableDirectory();
      const allUsers = assignable
        .filter((entry) => entry.assigneeType === "internal_user")
        .map((entry) => ({
          id: entry.assigneeId,
          name: entry.displayLabel,
          email: entry.secondaryLabel || "",
          role: entry.roleTags[0] || "",
        }));
      res.json(allUsers);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng/backfill-assignees", requireAuth, requireAdminOrEpm, async (_req, res) => {
    try {
      const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
      const engItems = await db.select().from(workItems)
        .where(and(eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)));

      const nameMap: Record<string, { id: number; name: string }> = {};
      for (const u of allUsers) {
        nameMap[u.name.toLowerCase()] = { id: u.id, name: u.name };
        const first = u.name.split(/\s+/)[0].toLowerCase();
        if (!nameMap[first]) nameMap[first] = { id: u.id, name: u.name };
      }

      // Engineering PR 3: batch the per-row updates + inserts. Old code
      // ran N×2 round-trips (one db.update + one db.insert per matched
      // work_item). Now: group matches by user id, then run one
      // UPDATE per user (covers all that user's work items) + one
      // bulk INSERT for the assignments. Round-trips collapse to
      // 2×distinctUsers regardless of N.
      const matchesByUserId = new Map<number, number[]>(); // userId -> [workItemIds]
      for (const wi of engItems) {
        if (wi.ownerUserId || !wi.ownerName) continue;
        const lower = wi.ownerName.toLowerCase();
        const first = lower.split(/\s+/)[0];
        const match = nameMap[lower] || nameMap[first];
        if (!match) continue;
        const list = matchesByUserId.get(match.id) ?? [];
        list.push(wi.id);
        matchesByUserId.set(match.id, list);
      }

      let updated = 0;
      let assignmentsCreated = 0;
      const updatedAt = new Date();
      for (const [userId, workItemIds] of matchesByUserId.entries()) {
        await db.update(workItems)
          .set({ ownerUserId: userId, updatedAt })
          .where(inArray(workItems.id, workItemIds));
        await db.insert(workItemAssignments).values(
          workItemIds.map((wid) => ({
            workItemId: wid,
            userId,
            role: "OWNER" as any,
          })),
        ).onConflictDoNothing();
        updated += workItemIds.length;
        assignmentsCreated += workItemIds.length;
      }

      res.json({ message: `Backfill complete: ${updated} work items updated, ${assignmentsCreated} assignments created` });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== ENHANCED TASK OPERATIONS ==========

  app.get("/api/eng/tasks", requireAuth, requirePermission("eng_tasks", "view"), async (req, res) => {
    try {
      const { projectName, status, phase, ownerUserId, projectId } = req.query;
      const tasks = await listEngineeringWorkItems({
        projectName: projectName as string | undefined,
        status: status as string | undefined,
        phase: phase as string | undefined,
        ownerUserId: ownerUserId ? parseInt(ownerUserId as string) : undefined,
        projectId: projectId ? parseInt(projectId as string) : undefined,
      });

      const enriched = await enrichEngineeringTasks(tasks, req);
      res.json(enriched);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng/tasks", requireAuth, requirePermission("eng_tasks", "create"), validateBody(engTaskCreateSchema), async (req, res) => {
    try {
      const data = req.body || {};
      const rawProjectId = data?.projectId;
      const parsedProjectId = Number(rawProjectId);
      const requestedProjectId = Number.isInteger(parsedProjectId) && parsedProjectId > 0 ? parsedProjectId : null;
      // Prompt 0.9: canonical lowercase_snake default post-migration 20260413.
      if (!TASK_STATUSES.includes(data.status)) {
        data.status = "to_do";
      }

      // Primary path: projectId from client. Fallback: projectName for backwards compatibility.
      let resolvedProjectId: number | null = requestedProjectId;
      if (resolvedProjectId) {
        const [projectById] = await db.select({ id: projectInfo.id }).from(projectInfo)
          .where(eq(projectInfo.id, resolvedProjectId)).limit(1);
        if (!projectById) {
          console.warn("[Engineering] task create validation failed: invalid projectId", { projectId: data.projectId, userId: getUser(req).id });
          return sendError(res, badRequest("Selected project could not be resolved. Please re-select the project."));
        }
      } else if (typeof data.projectName === "string" && data.projectName.trim()) {
        const projectName = data.projectName.trim();
        const [project] = await db.select({ id: projectInfo.id }).from(projectInfo)
          .where(or(
            eq(projectInfo.projectName, projectName),
            sql`REPLACE(REGEXP_REPLACE(${projectInfo.projectName}, '_Tracker.*$', ''), '_', ' ') = ${projectName}`,
          ))
          .limit(1);
        if (project) resolvedProjectId = project.id;
      }

      if (!resolvedProjectId) {
        console.warn("[Engineering] task create validation failed: unresolved project selection", {
          projectId: data.projectId ?? null,
          projectName: data.projectName ?? null,
          userId: getUser(req).id,
        });
        return sendError(res, badRequest("Selected project could not be resolved. Please re-select the project."));
      }

      if (data.ownerUserId !== undefined && data.ownerUserId !== null && data.ownerUserId !== "") {
        const ownerUserId = Number(data.ownerUserId);
        if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
          return sendError(res, badRequest("Selected assignee is invalid. Please re-select the assignee."));
        }
        const [ownerExists] = await db.select({ id: users.id }).from(users).where(eq(users.id, ownerUserId)).limit(1);
        if (!ownerExists) {
          console.warn("[Engineering] task create validation failed: invalid ownerUserId", { ownerUserId, userId: getUser(req).id });
          return sendError(res, badRequest("Selected assignee is invalid. Please re-select the assignee."));
        }
        data.ownerUserId = ownerUserId;
      }

      if (data.assignees?.length > 0) {
        const { resolveNameToUserId } = await import("./user-resolver");
        const resolvedIds: number[] = [];
        for (const name of data.assignees) {
          const uid = await resolveNameToUserId(name);
          if (uid) resolvedIds.push(uid);
        }
        data.assigneeUserIds = resolvedIds.length > 0 ? resolvedIds : null;
        if (!data.ownerUserId && resolvedIds.length > 0) {
          data.ownerUserId = resolvedIds[0];
        }
      }

      const task = await createEngineeringWorkItem({
        projectId: resolvedProjectId,
        title: data.title,
        description: data.description || null,
        status: data.status || "to_do",
        priority: data.priority || null,
        phase: data.phase || null,
        startDate: data.startDate || null,
        dueDate: data.dueDate || null,
        ownerUserId: data.ownerUserId || null,
        createdBy: getUser(req).id,
        plannedHours: data.plannedHours ? parseFloat(data.plannedHours) : null,
      });

      if (task.ownerUserId && task.ownerUserId !== getUser(req).id) {
        await createNotification(task.ownerUserId, "task.assigned", `Task assigned: ${task.title}`, `You've been assigned task "${task.title}"`, {
          linkedTaskId: task.id,
        });
      }

      let createdPayload: any = {
        id: task.id,
        workItemId: task.id,
        title: task.title,
        description: task.description,
        status: "to_do",
        priority: task.priority || "Med",
        phase: task.phase,
        startDate: task.startDate,
        dueDate: task.endDate,
        ownerUserId: task.ownerUserId,
        assigneeUserIds: task.ownerUserId ? [task.ownerUserId] : [],
        projectId: task.projectId,
      };
      try {
        const mappedItems = await listEngineeringWorkItems({ projectId: task.projectId || undefined });
        const mapped = mappedItems.find((row) => row.workItemId === task.id);
        if (mapped) createdPayload = mapped;
      } catch (mapErr: any) {
        console.warn("[Engineering] task create post-map failed; returning fallback payload", { taskId: task.id, error: mapErr?.message || String(mapErr) });
      }

      res.json(createdPayload);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/eng/tasks/:id", requireAuth, requirePermission("eng_tasks", "edit"), validateBody(engTaskUpdateSchema), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const [existing] = await db.select().from(workItems).where(and(eq(workItems.id, id), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)));
      if (!existing) return sendError(res, notFound("Task"));

      // Prompt 0.9 follow-up: the inline kanban-card buttons in
      // EngineeringTasksPage still POST legacy UPPER CASE status values
      // like "COMPLETE" / "HOLD" / "IN PROGRESS". Normalize the incoming
      // status ONCE here so every downstream guard (completion, hold,
      // workflow transitions, completedAt stamping) compares against the
      // canonical lowercase form and nothing is silently skipped.
      const rawStatus: string | undefined = req.body?.status;
      const canonicalStatus = rawStatus ? toCanonicalStatus(rawStatus) : undefined;
      // H8: strip server-controlled keys to prevent mass-assignment.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = { ...stripServerFields(req.body), status: canonicalStatus, updatedAt: new Date() };

      if (canonicalStatus && !(TASK_STATUSES as readonly string[]).includes(canonicalStatus)) {
        return sendError(res, badRequest(`Invalid status. Must be one of: ${TASK_STATUSES.join(", ")}`));
      }

      if (canonicalStatus) {
        try {
          const context = await buildTaskWorkflowContext(id, existing.status as string);
          assertTaskWorkflowTransition(context, canonicalStatus, "status_update");
        } catch (err: any) {
          if (err instanceof TaskWorkflowGuardError) {
            return sendError(res, new ApiError(err.statusCode, "WORKFLOW_ERROR", err.message));
          }
          throw err;
        }
      }

      // Validate parent completion: can't mark complete if children are still open
      if (canonicalStatus === "complete") {
        const blockMsg = await validateParentCompletion(id);
        if (blockMsg) {
          return sendError(res, badRequest(blockMsg));
        }
      }

      if (canonicalStatus === "hold" && !updates.holdReason) {
        return sendError(res, badRequest("Hold reason required when setting status to hold"));
      }
      if (canonicalStatus === "hold") {
        const bt = updates.blockedType;
        if (!bt || !["Internal", "External"].includes(bt)) {
          return sendError(res, badRequest("Blocked type (Internal or External) required when setting status to hold"));
        }
      }

      // Resolve projectName → projectId when frontend sends a project link
      let resolvedProjectId: number | null | undefined = updates.projectId;
      if (updates.projectName !== undefined) {
        if (updates.projectName === null || updates.projectName === "") {
          resolvedProjectId = null;
        } else {
          const [proj] = await db.select({ id: projectInfo.id }).from(projectInfo)
            .where(eq(projectInfo.projectName, updates.projectName));
          if (proj) {
            resolvedProjectId = proj.id;
          }
        }
      }

      const updated = await updateEngineeringWorkItem(id, {
        title: updates.title,
        description: updates.description,
        status: canonicalStatus,
        priority: updates.priority,
        phase: updates.phase,
        startDate: updates.startDate,
        dueDate: updates.dueDate,
        percentComplete: updates.percentComplete !== undefined ? updates.percentComplete / 100 : undefined,
        ownerUserId: updates.ownerUserId,
        projectId: resolvedProjectId,
        holdReason: updates.holdReason,
        blockedType: updates.blockedType,
        completedAt: canonicalStatus === "complete" ? new Date() : undefined,
        linkedPlanItemId: updates.linkedPlanItemId,
        linkedDeliverableId: updates.linkedDeliverableId,
        linkedQualityItemInstanceId: updates.linkedQualityItemInstanceId,
        trackingRag: updates.trackingRag,
        taskTypeTag: updates.taskTypeTag,
        blockerReason: updates.blockerReason,
        plannedHours: updates.plannedHours !== undefined ? parseFloat(updates.plannedHours) || null : undefined,
      });
      if (!updated) return sendError(res, notFound("Task"));

      if (updates.status && updates.status !== "") {
        if (updated.ownerUserId) {
          await createNotification(updated.ownerUserId, "task.status_changed",
            `Task status: ${updated.title}`, `Status changed to "${updates.status}"`,
            { linkedTaskId: id });
        }
      }

      // Run cascades (dates rollup to parent, status propagation)
      try {
        await runCascadesAfterUpdate(id, {
          status: updates.status,
          startDate: updates.startDate,
          dueDate: updates.dueDate,
        });
      } catch (cascadeErr: any) {
        console.warn("[Engineering] Non-fatal cascade error:", cascadeErr.message);
      }

      const mappedItems = await listEngineeringWorkItems({ projectId: updated.projectId || undefined });
      const mapped = mappedItems.find((row) => row.workItemId === updated.id);
      const payload = mapped ? mapped : { id: updated.id, workItemId: updated.id };
      res.json(payload);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // Permission: submitting for approval requires edit on eng_tasks.
  app.post("/api/eng/tasks/:id/send-for-approval", requireAuth, requirePermission("eng_tasks", "edit"), approvalUpload.single("file"), validateBody(engTaskSendForApprovalSchema), async (req, res) => {
    const id = parseIntParam(req.params.id);
    const user = getUser(req);
    const note = req.body.note || "";
    const file = req.file;
    let localSave: any = null;
    if (typeof req.body?.localSave === "string") {
      try { localSave = JSON.parse(req.body.localSave); } catch { localSave = null; }
    } else if (req.body?.localSave && typeof req.body.localSave === "object") {
      localSave = req.body.localSave;
    }

    const projectSuggestion = req.body?.projectSuggestion || null;
    const projectFinal = req.body?.projectFinal || null;
    const projectOverrideReason = typeof req.body?.projectOverrideReason === "string" ? req.body.projectOverrideReason.trim() : "";
    const routeSuggestion = req.body?.routeSuggestion || null;
    const routeFinal = req.body?.routeFinal || null;
    const routeOverrideReason = typeof req.body?.routeOverrideReason === "string" ? req.body.routeOverrideReason.trim() : "";

    try {
      const existing = await getEngineeringWorkItemById(id);
      if (!existing) return sendError(res, notFound("Task"));

      try {
        const context = await buildTaskWorkflowContext(id, existing.status);
        assertTaskWorkflowTransition(context, "NEEDS APPROVAL", "send_for_approval");
      } catch (err: any) {
        if (err instanceof TaskWorkflowGuardError) {
          return sendError(res, new ApiError(err.statusCode, "WORKFLOW_ERROR", err.message));
        }
        throw err;
      }

      logAuditFromReq(req, {
        entityType: "approval_send_flow",
        entityId: String(id),
        action: "send_flow_opened",
        projectName: existing.projectName || undefined,
      });

      logAuditFromReq(req, {
        entityType: "approval_send_flow",
        entityId: String(id),
        action: "suggestions_presented",
        projectName: existing.projectName || undefined,
        changesJson: { projectSuggestion, routeSuggestion },
      });

      const suggestionChecks = [
        { field: "project", suggestion: projectSuggestion, final: projectFinal, reason: projectOverrideReason },
        { field: "route", suggestion: routeSuggestion, final: routeFinal, reason: routeOverrideReason },
      ];

      for (const check of suggestionChecks) {
        if (check.suggestion && check.final && check.suggestion !== check.final) {
          if (!check.reason) {
            return sendError(res, badRequest(`${check.field} override reason is required`));
          }
          logAuditFromReq(req, {
            entityType: "approval_send_flow",
            entityId: String(id),
            action: "suggestion_overridden",
            projectName: existing.projectName || undefined,
            changesJson: { field: check.field, suggestion: check.suggestion, finalValue: check.final, reason: check.reason },
          });
          logAuditFromReq(req, {
            entityType: "approval_send_flow",
            entityId: String(id),
            action: "override_reason_captured",
            projectName: existing.projectName || undefined,
            changesJson: { field: check.field, reason: check.reason },
          });
        } else if (check.suggestion) {
          logAuditFromReq(req, {
            entityType: "approval_send_flow",
            entityId: String(id),
            action: "suggestion_accepted",
            projectName: existing.projectName || undefined,
            changesJson: { field: check.field, suggestion: check.suggestion, finalValue: check.final || check.suggestion },
          });
        }
      }

      logAuditFromReq(req, {
        entityType: "approval_send_flow",
        entityId: String(id),
        action: "canonical_save_attempted",
        projectName: existing.projectName || undefined,
      });

      const updated = await updateEngineeringWorkItem(id, { status: "needs_approval" });
      if (!updated) return sendError(res, notFound("Task"));

      await db.insert(taskActivityLog).values({
        workItemId: id,
        actorId: user.id,
        actionType: "field_changed",
        fieldName: "status",
        oldValue: existing.status,
        newValue: "needs_approval",
      });

      if (note.trim()) {
        const fileInfo = file ? ` [Attachment: ${file.originalname}]` : "";
        await db.insert(taskComments).values({
          workItemId: id,
          authorId: user.id,
          body: `[Sent for Approval] ${note.trim()}${fileInfo}`,
        });
      } else if (file) {
        await db.insert(taskComments).values({
          workItemId: id,
          authorId: user.id,
          body: `[Sent for Approval] Attachment: ${file.originalname}`,
        });
      }

      logAuditFromReq(req, {
        entityType: "approval_send_flow",
        entityId: String(id),
        action: "canonical_save_succeeded",
        projectName: existing.projectName || undefined,
      });

      if (updated.ownerUserId && updated.ownerUserId !== user.id) {
        await createNotification(updated.ownerUserId, "deliverable.submitted_for_approval",
          `Approval needed: ${updated.title}`,
          `Task "${updated.title}" has been sent for approval${file ? ` with attachment: ${file.originalname}` : ""}`,
          { projectName: existing.projectName ?? undefined, linkedTaskId: id }
        );
      }

      const localFlowEnabled = await isLocalSyncedSaveFlowEnabled();
      const mappedPath = await getLocalSyncedPathForUser(user.id);
      let localResult: any = {
        attempted: false,
        saved: false,
        mode: "not_requested",
        mappedPath: mappedPath || null,
        fallbackUsed: false,
      };

      if (localFlowEnabled) {
        localResult.attempted = true;
        logAuditFromReq(req, {
          entityType: "approval_send_flow",
          entityId: String(id),
          action: "local_save_attempted",
          projectName: existing.projectName || undefined,
          changesJson: { mappedPath: mappedPath || null },
        });

        if (!mappedPath) {
          localResult.mode = "missing_mapping";
          localResult.error = "No mapped local synced path configured for this user.";
          localResult.fallbackUsed = true;
          logAuditFromReq(req, {
            entityType: "approval_send_flow",
            entityId: String(id),
            action: "local_save_failed",
            projectName: existing.projectName || undefined,
            changesJson: { reason: "missing_mapping" },
          });
          logAuditFromReq(req, {
            entityType: "approval_send_flow",
            entityId: String(id),
            action: "fallback_used",
            projectName: existing.projectName || undefined,
            changesJson: { fallbackType: "manual_download" },
          });
        } else if (!localSave?.supported) {
          localResult.mode = "runtime_not_supported";
          localResult.error = "Browser/runtime cannot write to local synced path directly.";
          localResult.fallbackUsed = true;
          logAuditFromReq(req, {
            entityType: "approval_send_flow",
            entityId: String(id),
            action: "local_save_failed",
            projectName: existing.projectName || undefined,
            changesJson: { reason: "runtime_not_supported" },
          });
          logAuditFromReq(req, {
            entityType: "approval_send_flow",
            entityId: String(id),
            action: "fallback_used",
            projectName: existing.projectName || undefined,
            changesJson: { fallbackType: "manual_download" },
          });
        } else if (localSave?.status === "succeeded") {
          localResult.saved = true;
          localResult.mode = "runtime_supported";
          logAuditFromReq(req, {
            entityType: "approval_send_flow",
            entityId: String(id),
            action: "local_save_succeeded",
            projectName: existing.projectName || undefined,
            changesJson: { targetPath: localSave?.targetPath || mappedPath },
          });
        } else {
          localResult.mode = "runtime_supported";
          localResult.error = localSave?.error || "Local save was not completed.";
          localResult.fallbackUsed = true;
          logAuditFromReq(req, {
            entityType: "approval_send_flow",
            entityId: String(id),
            action: "local_save_failed",
            projectName: existing.projectName || undefined,
            changesJson: { reason: localSave?.error || "unknown" },
          });
          logAuditFromReq(req, {
            entityType: "approval_send_flow",
            entityId: String(id),
            action: "fallback_used",
            projectName: existing.projectName || undefined,
            changesJson: { fallbackType: "manual_download" },
          });
        }
      }

      logAuditFromReq(req, {
        entityType: "approval_send_flow",
        entityId: String(id),
        action: "send_completed",
        projectName: existing.projectName || undefined,
        changesJson: { canonicalSaved: true, localSaved: localResult.saved },
      });

      const mappedTask = await getEngineeringWorkItemById(id);
      res.json({
        ...(mappedTask || { id, title: updated.title, status: mapToOpsStatus(updated.status) }),
        uploadedFile: file ? { filename: file.filename, originalName: file.originalname, size: file.size } : null,
        sendResult: {
          canonicalSystemRecord: { saved: true },
          localSyncedPath: localResult,
        },
      });
    } catch (err: any) {
      logAuditFromReq(req, {
        entityType: "approval_send_flow",
        entityId: String(id),
        action: "canonical_save_failed",
        changesJson: { error: err?.message || "unknown" },
      });
      logAuditFromReq(req, {
        entityType: "approval_send_flow",
        entityId: String(id),
        action: "send_failed",
        changesJson: { error: err?.message || "unknown" },
      });
      console.error("[Eng] Send for approval error:", err);
      sendError(res, err);
    }
  });

  // Permission: sending a deliverable requires edit on eng_tasks.
  app.post("/api/eng/tasks/:id/send-deliverable", requireAuth, requirePermission("eng_tasks", "edit"), approvalUpload.single("file"), validateBody(engTaskSendDeliverableSchema), async (req, res) => {
    const id = parseIntParam(req.params.id);
    const user = getUser(req);

    try {
      const existing = await getEngineeringWorkItemById(id);
      if (!existing) return sendError(res, notFound("Task"));

      const recipientUserId = parseInt(req.body.recipientUserId);
      if (!recipientUserId || isNaN(recipientUserId)) return sendError(res, badRequest("A valid recipient is required"));

      const recipientSuggestion = req.body?.recipientSuggestion || null;
      const recipientFinal = req.body?.recipientFinal || String(recipientUserId);
      const recipientOverrideReason = typeof req.body?.recipientOverrideReason === "string" ? req.body.recipientOverrideReason.trim() : "";
      const linkedProjectSuggestion = req.body?.linkedProjectSuggestion || null;
      const linkedProjectFinal = req.body?.linkedProjectFinal || existing.projectName || null;
      const linkedProjectOverrideReason = typeof req.body?.linkedProjectOverrideReason === "string" ? req.body.linkedProjectOverrideReason.trim() : "";

      logAuditFromReq(req, {
        entityType: "deliverable_send_flow",
        entityId: String(id),
        action: "send_flow_opened",
        projectName: existing.projectName || undefined,
      });

      logAuditFromReq(req, {
        entityType: "deliverable_send_flow",
        entityId: String(id),
        action: "suggestions_presented",
        projectName: existing.projectName || undefined,
        changesJson: { recipientSuggestion, linkedProjectSuggestion },
      });

      const overrideChecks = [
        { field: "recipient", suggestion: recipientSuggestion, final: recipientFinal, reason: recipientOverrideReason },
        { field: "linked_project", suggestion: linkedProjectSuggestion, final: linkedProjectFinal, reason: linkedProjectOverrideReason },
      ];

      for (const check of overrideChecks) {
        if (check.suggestion && check.final && check.suggestion !== check.final) {
          if (!check.reason) {
            return sendError(res, badRequest(`${check.field} override reason is required`));
          }
          logAuditFromReq(req, {
            entityType: "deliverable_send_flow",
            entityId: String(id),
            action: "suggestion_overridden",
            projectName: existing.projectName || undefined,
            changesJson: { field: check.field, suggestion: check.suggestion, finalValue: check.final, reason: check.reason },
          });
          logAuditFromReq(req, {
            entityType: "deliverable_send_flow",
            entityId: String(id),
            action: "override_reason_captured",
            projectName: existing.projectName || undefined,
            changesJson: { field: check.field, reason: check.reason },
          });
        } else if (check.suggestion) {
          logAuditFromReq(req, {
            entityType: "deliverable_send_flow",
            entityId: String(id),
            action: "suggestion_accepted",
            projectName: existing.projectName || undefined,
            changesJson: { field: check.field, suggestion: check.suggestion, finalValue: check.final || check.suggestion },
          });
        }
      }

      const file = req.file;
      if (!file) return sendError(res, badRequest("A file attachment is required"));
      const note = req.body.note || "";
      let localSave: any = null;
    if (typeof req.body?.localSave === "string") {
      try { localSave = JSON.parse(req.body.localSave); } catch { localSave = null; }
    } else if (req.body?.localSave && typeof req.body.localSave === "object") {
      localSave = req.body.localSave;
    }

      logAuditFromReq(req, {
        entityType: "deliverable_send_flow",
        entityId: String(id),
        action: "canonical_save_attempted",
        projectName: existing.projectName || undefined,
      });

      const [deliverable] = await db.insert(taskDeliverables).values({
        workItemId: id,
        filename: file.filename,
        originalName: file.originalname,
        fileSize: file.size,
        note: note.trim() || null,
        sentByUserId: user.id,
        recipientUserId,
      }).returning();

      const fileInfo = note.trim() ? ` — ${note.trim()}` : "";
      await db.insert(taskComments).values({
        workItemId: id,
        authorId: user.id,
        body: `[Deliverable Sent] ${file.originalname} → ${(await db.select({ name: users.name }).from(users).where(eq(users.id, recipientUserId)))[0]?.name || "recipient"}${fileInfo}`,
      });

      await db.insert(taskActivityLog).values({
        workItemId: id,
        actorId: user.id,
        actionType: "deliverable_sent",
        fieldName: "deliverable",
        newValue: file.originalname,
      });

      logAuditFromReq(req, {
        entityType: "deliverable_send_flow",
        entityId: String(id),
        action: "canonical_save_succeeded",
        projectName: existing.projectName || undefined,
        changesJson: { deliverableId: deliverable.id },
      });

      await createNotification(recipientUserId, "deliverable.sent_for_acknowledgment",
        `Deliverable received: ${existing.title}`,
        `"${file.originalname}" has been sent to you for acknowledgment on task "${existing.title}"${note.trim() ? ` — ${note.trim()}` : ""}`,
        { projectName: existing.projectName ?? undefined, linkedTaskId: id }
      );

      const localFlowEnabled = await isLocalSyncedSaveFlowEnabled();
      const mappedPath = await getLocalSyncedPathForUser(user.id);
      const fallbackPreference = await getFallbackPreferenceForUser(user.id);
      let localResult: any = {
        attempted: false,
        saved: false,
        mode: "not_requested",
        mappedPath: mappedPath || null,
        fallbackUsed: false,
        fallbackPreference,
      };

      if (localFlowEnabled) {
        localResult.attempted = true;
        logAuditFromReq(req, {
          entityType: "deliverable_send_flow",
          entityId: String(id),
          action: "local_save_attempted",
          projectName: existing.projectName || undefined,
          changesJson: { mappedPath: mappedPath || null, fallbackPreference },
        });

        if (!mappedPath) {
          localResult.mode = "missing_mapping";
          localResult.error = "No mapped local synced path configured for this user.";
          localResult.fallbackUsed = true;
          logAuditFromReq(req, {
            entityType: "deliverable_send_flow",
            entityId: String(id),
            action: "local_save_failed",
            projectName: existing.projectName || undefined,
            changesJson: { reason: "missing_mapping" },
          });
          logAuditFromReq(req, {
            entityType: "deliverable_send_flow",
            entityId: String(id),
            action: "fallback_used",
            projectName: existing.projectName || undefined,
            changesJson: { fallbackType: fallbackPreference },
          });
        } else if (!localSave?.supported) {
          localResult.mode = "runtime_not_supported";
          localResult.error = "Browser/runtime cannot write to local synced path directly.";
          localResult.fallbackUsed = true;
          logAuditFromReq(req, {
            entityType: "deliverable_send_flow",
            entityId: String(id),
            action: "local_save_failed",
            projectName: existing.projectName || undefined,
            changesJson: { reason: "runtime_not_supported" },
          });
          logAuditFromReq(req, {
            entityType: "deliverable_send_flow",
            entityId: String(id),
            action: "fallback_used",
            projectName: existing.projectName || undefined,
            changesJson: { fallbackType: fallbackPreference },
          });
        } else if (localSave?.status === "succeeded") {
          localResult.saved = true;
          localResult.mode = "runtime_supported";
          logAuditFromReq(req, {
            entityType: "deliverable_send_flow",
            entityId: String(id),
            action: "local_save_succeeded",
            projectName: existing.projectName || undefined,
            changesJson: { targetPath: localSave?.targetPath || mappedPath },
          });
        } else {
          localResult.mode = "runtime_supported";
          localResult.error = localSave?.error || "Local save was not completed.";
          localResult.fallbackUsed = true;
          logAuditFromReq(req, {
            entityType: "deliverable_send_flow",
            entityId: String(id),
            action: "local_save_failed",
            projectName: existing.projectName || undefined,
            changesJson: { reason: localSave?.error || "unknown" },
          });
          logAuditFromReq(req, {
            entityType: "deliverable_send_flow",
            entityId: String(id),
            action: "fallback_used",
            projectName: existing.projectName || undefined,
            changesJson: { fallbackType: fallbackPreference },
          });
        }
      }

      logAuditFromReq(req, {
        entityType: "deliverable_send_flow",
        entityId: String(id),
        action: "send_completed",
        projectName: existing.projectName || undefined,
        changesJson: { canonicalSaved: true, localSaved: localResult.saved, deliverableId: deliverable.id },
      });

      res.json({
        ...deliverable,
        sendResult: {
          canonicalSystemRecord: { saved: true },
          localSyncedPath: localResult,
        },
      });
    } catch (err: any) {
      logAuditFromReq(req, {
        entityType: "deliverable_send_flow",
        entityId: String(id),
        action: "canonical_save_failed",
        changesJson: { error: err?.message || "unknown" },
      });
      logAuditFromReq(req, {
        entityType: "deliverable_send_flow",
        entityId: String(id),
        action: "send_failed",
        changesJson: { error: err?.message || "unknown" },
      });
      console.error("[Eng] Send deliverable error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/tasks/:id/deliverables", requireAuth, requirePermission("eng_tasks", "view"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const deliverables = await db.select({
        id: taskDeliverables.id,
        taskId: taskDeliverables.workItemId,
        filename: taskDeliverables.filename,
        originalName: taskDeliverables.originalName,
        fileSize: taskDeliverables.fileSize,
        note: taskDeliverables.note,
        sentByUserId: taskDeliverables.sentByUserId,
        senderName: users.name,
        recipientUserId: taskDeliverables.recipientUserId,
        acknowledged: taskDeliverables.acknowledged,
        acknowledgedAt: taskDeliverables.acknowledgedAt,
        createdAt: taskDeliverables.createdAt,
      })
        .from(taskDeliverables)
        .leftJoin(users, eq(users.id, taskDeliverables.sentByUserId))
        .where(eq(taskDeliverables.workItemId, id))
        .orderBy(desc(taskDeliverables.createdAt));

      const recipientIds = [...new Set(deliverables.map((d: any) => d.recipientUserId))];
      let recipientMap: Record<number, string> = {};
      if (recipientIds.length > 0) {
        const recipients = await db.select({ id: users.id, name: users.name }).from(users)
          .where(sql`${users.id} IN ${recipientIds}`);
        recipientMap = Object.fromEntries(recipients.map((r: any) => [r.id, r.name]));
      }

      res.json(deliverables.map((d: any) => ({
        ...d,
        recipientName: recipientMap[d.recipientUserId] || `User #${d.recipientUserId}`,
      })));
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/eng/deliverables/:id/acknowledge", requireAuth, requirePermission("deliverables", "edit"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const [deliverable] = await db.select().from(taskDeliverables).where(eq(taskDeliverables.id, id));
      if (!deliverable) return sendError(res, notFound("Deliverable"));

      const user = getUser(req);
      if (deliverable.recipientUserId !== user.id) {
        return sendError(res, forbidden("Only the recipient can acknowledge this deliverable"));
      }

      const [updated] = await db.update(taskDeliverables).set({
        acknowledged: true,
        acknowledgedAt: new Date(),
      }).where(eq(taskDeliverables.id, id)).returning();

      await db.insert(taskComments).values({
        workItemId: deliverable.taskId,
        authorId: user.id,
        body: `[Acknowledged] Deliverable "${deliverable.originalName}" received and acknowledged`,
      });

      await db.insert(taskActivityLog).values({
        workItemId: deliverable.taskId,
        actorId: user.id,
        actionType: "deliverable_acknowledged",
        fieldName: "deliverable",
        newValue: deliverable.originalName,
      });

      await createNotification(deliverable.sentByUserId, "deliverable.acknowledged",
        `Deliverable acknowledged: ${deliverable.originalName}`,
        `Your deliverable "${deliverable.originalName}" has been acknowledged by ${user.name}`,
        { linkedTaskId: deliverable.taskId }
      );

      res.json(updated);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/deliverables/:id/download", requireAuth, requirePermission("deliverables", "view"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const [deliverable] = await db.select().from(taskDeliverables).where(eq(taskDeliverables.id, id));
      if (!deliverable) return sendError(res, notFound("Deliverable"));

      const filePath = path.join(approvalUploadsDir, deliverable.filename);
      if (!fs.existsSync(filePath)) return sendError(res, notFound("File"));

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(deliverable.originalName || 'file')}"`);
      res.sendFile(filePath);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.delete("/api/eng/tasks/:id", requireAuth, requirePermission('eng_tasks', 'delete'), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const [existing] = await db.select().from(workItems).where(and(eq(workItems.id, id), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)));
      if (!existing) return sendError(res, notFound("Task"));

      const deleted = await deleteEngineeringWorkItem(id);
      if (!deleted) return sendError(res, notFound("Task"));

      res.json({ success: true, message: `Task "${existing.title}" deleted` });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng/tasks/bulk-update", requireAuth, requireAdminOrEpm, validateBody(engTaskBulkUpdateSchema), async (req, res) => {
    try {
      const { taskIds, updates } = req.body;
      if (!Array.isArray(taskIds) || taskIds.length === 0) {
        return sendError(res, badRequest("taskIds array required"));
      }
      // Prompt 0.9 follow-up: normalize incoming bulk status once so the
      // HOLD / COMPLETE guards below compare against the canonical form.
      const canonicalBulkStatus: string | undefined = updates.status
        ? toCanonicalStatus(updates.status)
        : undefined;

      if (canonicalBulkStatus === "hold" && !updates.holdReason) {
        return sendError(res, badRequest("Hold reason required when setting status to hold"));
      }
      if (canonicalBulkStatus === "hold" && !updates.blockedType) {
        return sendError(res, badRequest("Blocked type (Internal or External) required when setting status to hold"));
      }
      // Engineering PR 3: batched validation. Replaces per-id
      // getEngineeringWorkItemById + buildTaskWorkflowContext (each of which
      // was an N×O(allEngineeringItems) + N×2 DB queries) with two queries
      // total across all taskIds.
      if (canonicalBulkStatus) {
        const contexts = await buildTaskWorkflowContextsForIds(taskIds);
        for (const taskId of taskIds) {
          const context = contexts.get(taskId);
          if (!context) continue;
          try {
            assertTaskWorkflowTransition(context, canonicalBulkStatus, "bulk_status_update");
          } catch (err: any) {
            if (err instanceof TaskWorkflowGuardError) {
              return sendError(res, new ApiError(err.statusCode, "WORKFLOW_ERROR", err.message, { taskId: String(taskId) }));
            }
            throw err;
          }
        }
      }

      // All validations passed — apply updates atomically.
      // Engineering PR 3: single batched UPDATE + single batched INSERT,
      // replacing the per-taskId loop with N×2 round-trips inside the
      // transaction.
      const setData: any = { updatedAt: new Date() };
      if (canonicalBulkStatus) setData.status = canonicalBulkStatus;
      if (updates.holdReason !== undefined) setData.holdReason = updates.holdReason;
      if (updates.blockedType !== undefined) setData.blockedType = updates.blockedType;
      if (updates.priority !== undefined) setData.priority = updates.priority;
      if (updates.ownerUserId !== undefined) setData.ownerUserId = updates.ownerUserId;
      if (canonicalBulkStatus === "complete") setData.completedAt = new Date();

      const actorId = getUser(req).id;
      const updatesJson = JSON.stringify(updates);

      const updatedTaskIds: number[] = await db.transaction(async (tx: any) => {
        const updatedRows = await tx.update(workItems)
          .set(setData)
          .where(and(inArray(workItems.id, taskIds), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)))
          .returning({ id: workItems.id });

        const ids = updatedRows.map((r: { id: number }) => r.id);
        if (ids.length > 0) {
          await tx.insert(taskActivityLog).values(
            ids.map((wid: number) => ({
              workItemId: wid,
              actorId,
              actionType: "bulk_updated",
              newValue: updatesJson,
            })),
          );
        }
        return ids;
      });

      // Engineering PR 3: single enriched-list fetch outside the transaction,
      // replacing per-id getEngineeringWorkItemById calls (each doing an
      // O(allEngineeringItems) scan).
      const updatedTasks = updatedTaskIds.length > 0
        ? await listEngineeringWorkItems({ ids: updatedTaskIds })
        : [];

      res.json({ updated: updatedTasks.length, tasks: updatedTasks });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng/tasks/:id/link", requireAuth, requirePermission("eng_tasks", "edit"), validateBody(engTaskLinkSchema), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const { linkedPlanItemId, linkedDeliverableId, linkedQualityItemInstanceId } = req.body;

      const updated = await updateEngineeringWorkItem(id, {
        linkedPlanItemId: linkedPlanItemId !== undefined ? linkedPlanItemId : undefined,
        linkedDeliverableId: linkedDeliverableId !== undefined ? linkedDeliverableId : undefined,
        linkedQualityItemInstanceId: linkedQualityItemInstanceId !== undefined ? linkedQualityItemInstanceId : undefined,
      });
      if (!updated) return sendError(res, notFound("Task"));

      await db.insert(taskActivityLog).values({
        workItemId: id, actorId: getUser(req).id,
        actionType: "linked", newValue: JSON.stringify(req.body),
      });

      const mapped = await getEngineeringWorkItemById(id);
      res.json(mapped || { id: updated.id, workItemId: updated.id });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/tasks/:id/watchers", requireAuth, requirePermission("eng_tasks", "view"), async (req, res) => {
    try {
      const watchers = await db.select({
        id: taskWatchers.id, userId: taskWatchers.userId,
        userName: users.name, userEmail: users.email,
      })
      .from(taskWatchers)
      .leftJoin(users, eq(taskWatchers.userId, users.id))
      .where(eq(taskWatchers.workItemId, parseIntParam(req.params.id)));
      res.json(watchers);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng/tasks/:id/watchers", requireAuth, requirePermission("eng_tasks", "edit"), validateBody(engTaskWatcherAddSchema), async (req, res) => {
    try {
      const taskId = parseIntParam(req.params.id);
      const userId = parseInt(req.body.userId);
      if (isNaN(taskId) || isNaN(userId)) {
        return sendError(res, badRequest("Valid taskId and userId are required"));
      }

      // Verify task exists
      const [task] = await db.select({ id: workItems.id }).from(workItems)
        .where(and(eq(workItems.id, taskId), eq(workItems.workstream, "ENG"), isNull(workItems.deletedAt)));
      if (!task) return sendError(res, notFound("Task"));

      // Prevent duplicate watchers
      const [existing] = await db.select({ id: taskWatchers.id }).from(taskWatchers)
        .where(and(eq(taskWatchers.workItemId, taskId), eq(taskWatchers.userId, userId)));
      if (existing) return res.json(existing);

      const [watcher] = await db.insert(taskWatchers).values({
        workItemId: taskId,
        userId,
      }).returning();

      // Log watcher addition to activity
      await db.insert(taskActivityLog).values({
        workItemId: taskId,
        actorId: getUser(req).id,
        actionType: "watcher_added",
        fieldName: "watchers",
        newValue: String(userId),
      });

      res.json(watcher);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.delete("/api/eng/tasks/:taskId/watchers/:userId", requireAuth, requirePermission("eng_tasks", "edit"), async (req, res) => {
    try {
      const taskId = parseIntParam(req.params.taskId);
      const userId = parseIntParam(req.params.userId);
      if (isNaN(taskId) || isNaN(userId)) {
        return sendError(res, badRequest("Valid taskId and userId are required"));
      }

      await db.delete(taskWatchers).where(
        and(eq(taskWatchers.workItemId, taskId),
            eq(taskWatchers.userId, userId))
      );

      // Log watcher removal to activity
      await db.insert(taskActivityLog).values({
        workItemId: taskId,
        actorId: getUser(req).id,
        actionType: "watcher_removed",
        fieldName: "watchers",
        oldValue: String(userId),
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== TASK DETAIL ENDPOINTS ==========

  app.get("/api/eng/tasks/:id", requireAuth, requirePermission("eng_tasks", "view"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const task = await getEngineeringWorkItemById(id);
      if (!task) return sendError(res, notFound("Task"));
      const [enriched] = await enrichEngineeringTasks([task], req);
      res.json(enriched);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/tasks/:id/comments", requireAuth, requirePermission("eng_tasks", "view"), async (req, res) => {
    try {
      const comments = await db.select({
        id: taskComments.id,
        taskId: taskComments.workItemId,
        authorId: taskComments.authorId,
        body: taskComments.body,
        createdAt: taskComments.createdAt,
        authorName: users.name,
      })
      .from(taskComments)
      .leftJoin(users, eq(taskComments.authorId, users.id))
      .where(eq(taskComments.workItemId, parseIntParam(req.params.id)))
      .orderBy(asc(taskComments.createdAt));
      res.json(comments);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng/tasks/:id/comments", requireAuth, requirePermission("eng_tasks", "edit"), validateBody(engTaskCommentSchema), async (req, res) => {
    try {
      const taskId = parseIntParam(req.params.id);
      const { body } = req.body;
      if (!body || !body.trim()) {
        return sendError(res, badRequest("Comment body is required"));
      }
      const [comment] = await db.insert(taskComments).values({
        workItemId: taskId,
        authorId: getUser(req).id,
        body: body.trim(),
      }).returning();

      await db.insert(taskActivityLog).values({
        workItemId: taskId,
        actorId: getUser(req).id,
        actionType: "comment_added",
        newValue: body.trim(),
      });

      // Notify task owner about new comment
      const [commentTask] = await db.select({ ownerUserId: workItems.ownerUserId, title: workItems.title, projectName: workItems.subProjectName })
        .from(workItems).where(eq(workItems.id, taskId));
      if (commentTask?.ownerUserId && commentTask.ownerUserId !== getUser(req).id) {
        createNotification(commentTask.ownerUserId, "task.comment_added", `New comment on: ${commentTask.title}`,
          `${getUser(req).name || "Someone"} commented on "${commentTask.title}"`,
          { linkedTaskId: taskId, projectName: commentTask.projectName ?? undefined });
      }

      res.json(comment);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/tasks/:id/activity", requireAuth, requirePermission("eng_tasks", "view"), async (req, res) => {
    try {
      const activity = await db.select({
        id: taskActivityLog.id,
        taskId: taskActivityLog.workItemId,
        actorId: taskActivityLog.actorId,
        actionType: taskActivityLog.actionType,
        fieldName: taskActivityLog.fieldName,
        oldValue: taskActivityLog.oldValue,
        newValue: taskActivityLog.newValue,
        createdAt: taskActivityLog.createdAt,
        actorName: users.name,
      })
      .from(taskActivityLog)
      .leftJoin(users, eq(taskActivityLog.actorId, users.id))
      .where(eq(taskActivityLog.workItemId, parseIntParam(req.params.id)))
      .orderBy(desc(taskActivityLog.createdAt));
      res.json(activity);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/tasks/:id/subtasks", requireAuth, requirePermission("eng_tasks", "view"), async (req, res) => {
    try {
      const parentId = parseIntParam(req.params.id);
      const allItems = await listEngineeringWorkItems({});
      const subtasks = allItems.filter((item) => item.parentTaskId === parentId);
      res.json(subtasks);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng/tasks/:id/subtasks", requireAuth, requirePermission("eng_tasks", "create"), validateBody(engTaskSubtaskSchema), async (req, res) => {
    try {
      const parentId = parseIntParam(req.params.id);
      const parent = await getEngineeringWorkItemById(parentId);
      if (!parent) return sendError(res, notFound("Parent task"));

      const data = req.body;
      if (!data.title) {
        return sendError(res, badRequest("Subtask title is required"));
      }

      const subtaskWorkItem = await createEngineeringWorkItem({
        title: data.title,
        description: data.description || null,
        status: data.status || "to_do",
        priority: data.priority || "Med",
        projectId: parent.projectId || null,
        phase: data.phase || parent.phase || null,
        ownerUserId: data.ownerUserId || null,
        createdBy: getUser(req).id,
      });

      // Set parentId on the newly created work item and inherit parent dates
      await db.update(workItems)
        .set({
          parentId: parentId,
          startDate: parent.startDate || null,
          endDate: parent.dueDate || parent.endDate || null,
        })
        .where(eq(workItems.id, subtaskWorkItem.id));

      await db.insert(taskActivityLog).values({
        workItemId: parentId,
        actorId: getUser(req).id,
        actionType: "subtask_created",
        newValue: data.title,
      });

      const mapped = await getEngineeringWorkItemById(subtaskWorkItem.id);
      res.json(mapped || { id: subtaskWorkItem.id, title: data.title, status: "to_do" });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== DELIVERABLES ==========

  app.get("/api/deliverables", requireAuth, requirePermission("deliverables", "view"), async (req, res) => {
    try {
      const { projectName, status, phase } = req.query;
      const conditions: any[] = [];
      if (projectName) conditions.push(eq(deliverables.projectName, projectName as string));
      if (status) conditions.push(eq(deliverables.status, status as string));
      if (phase) conditions.push(eq(deliverables.phase, phase as string));

      const result = conditions.length > 0
        ? await db.select().from(deliverables).where(and(...conditions)).orderBy(desc(deliverables.updatedAt))
        : await db.select().from(deliverables).orderBy(desc(deliverables.updatedAt));
      const assignmentMap = await getAssignmentsForEntities("deliverable", result.map((d: any) => d.id));
      res.json(result.map((deliverable: any) => ({
        ...deliverable,
        assignments: assignmentMap.get(deliverable.id) || [],
        primaryAssignment: (assignmentMap.get(deliverable.id) || [])[0] || null,
      })));
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/deliverables/:id", requireAuth, requirePermission("deliverables", "view"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const [del] = await db.select().from(deliverables).where(eq(deliverables.id, id));
      if (!del) return sendError(res, notFound("Deliverable"));

      const versions = await db.select().from(deliverableVersions)
        .where(eq(deliverableVersions.deliverableId, id))
        .orderBy(desc(deliverableVersions.versionNumber));

      const files = await db.select().from(deliverableFiles)
        .where(eq(deliverableFiles.deliverableId, id))
        .orderBy(desc(deliverableFiles.uploadedAt));

      const events = await db.select().from(deliverableEvents)
        .where(eq(deliverableEvents.deliverableId, id))
        .orderBy(desc(deliverableEvents.createdAt));

      const assignments = await getAssignmentsForEntity("deliverable", id);
      res.json({
        ...del,
        versions,
        files,
        events,
        assignments,
        primaryAssignment: assignments[0] || null,
      });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/deliverables", requireAuth, requirePermission("deliverables", "create"), validateBody(deliverableCreateSchema), async (req, res) => {
    try {
      const data = req.body;
      const projectId = Number(data.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return sendError(res, badRequest("projectId is required"));
      }
      // H8: strip server-controlled keys to prevent mass-assignment.
      const [del] = await db.insert(deliverables).values({
        ...stripServerFields(data),
        projectId,
        status: "to_do",
        currentVersion: 1,
      }).returning();

      await db.insert(deliverableVersions).values({
        deliverableId: del.id,
        versionNumber: 1,
        status: "to_do",
        createdByUserId: getUser(req).id,
      });

      await db.insert(deliverableEvents).values({
        deliverableId: del.id,
        eventType: "created",
        toStatus: "to_do",
        actorUserId: getUser(req).id,
      });

      logAuditFromReq(req, { entityType: "deliverable", entityId: String(del.id), action: "create", projectName: data.projectName, changesJson: { description: "Deliverable created", title: del.title } });
      res.json(del);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/deliverables/:id", requireAuth, requirePermission("deliverables", "edit"), validateBody(deliverableUpdateSchema), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const [existing] = await db.select().from(deliverables).where(eq(deliverables.id, id));
      if (!existing) return sendError(res, notFound("Deliverable"));

      // Prompt 0.9 follow-up: normalize incoming deliverable status — same
      // migration 20260413 applies to deliverables (DELIVERABLE_STATUSES is
      // canonical lowercase). Legacy UPPER CASE payloads from older UI
      // paths must map to the canonical form before guards run.
      const rawDeliverableStatus: string | undefined = req.body?.status;
      const canonicalDeliverableStatus = rawDeliverableStatus ? toCanonicalStatus(rawDeliverableStatus) : undefined;

      const approvalStatuses = new Set(["complete", "qc_approved", "operational_approval", "provide_feedback"]);
      const authority = canonicalDeliverableStatus && approvalStatuses.has(canonicalDeliverableStatus)
        ? await evaluateAuthorityForRequest(req, "deliverables", "approve")
        : await evaluateAuthorityForRequest(req, "deliverables", "edit");

      if (!authority.allowed) {
        // Engineering PR 2: use canonical sendError envelope.
        return sendError(res, forbidden(authority.reason ?? "Forbidden"));
      }

      // H8: strip server-controlled keys to prevent mass-assignment.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = { ...stripServerFields(req.body), status: canonicalDeliverableStatus, updatedAt: new Date() };
      const [updated] = await db.update(deliverables).set(updates).where(eq(deliverables.id, id)).returning();

      if (canonicalDeliverableStatus && canonicalDeliverableStatus !== existing.status) {
        await db.insert(deliverableEvents).values({
          deliverableId: id,
          eventType: "status_changed",
          fromStatus: existing.status,
          toStatus: canonicalDeliverableStatus,
          actorUserId: getUser(req).id,
        });

        if (canonicalDeliverableStatus === "needs_approval" && updated.reviewerUserId) {
          await createNotification(updated.reviewerUserId, "deliverable.submitted_for_approval",
            `Review needed: ${updated.title}`, `Deliverable "${updated.title}" v${updated.currentVersion} needs review`,
            { projectName: updated.projectName, linkedDeliverableId: id });
        }
        if (canonicalDeliverableStatus === "qc_approved" && updated.ownerUserId) {
          await createNotification(updated.ownerUserId, "deliverable.qc_approved",
            `QC Approved: ${updated.title}`, `Deliverable "${updated.title}" has been QC approved`,
            { projectName: updated.projectName, linkedDeliverableId: id });
        }
      }


      logAuditFromReq(req, { entityType: "deliverable", entityId: String(id), action: "update", projectName: updated.projectName, changesJson: { description: "Deliverable updated", status: updates.status, title: updated.title } });
      res.json(updated);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/deliverables/:id/feedback", requireAuth, requireAuthority("deliverables", "approve"), validateBody(deliverableFeedbackSchema), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const { feedbackText } = req.body;

      const [updated] = await db.update(deliverables)
        .set({ status: "provide_feedback", updatedAt: new Date() })
        .where(eq(deliverables.id, id)).returning();

      await db.insert(deliverableEvents).values({
        deliverableId: id,
        eventType: "feedback_provided",
        fromStatus: "needs_approval",
        toStatus: "provide_feedback",
        feedbackText,
        actorUserId: getUser(req).id,
      });

      if (updated?.ownerUserId) {
        await createNotification(updated.ownerUserId, "deliverable.feedback_requested",
          `Feedback on: ${updated.title}`, feedbackText,
          { projectName: updated.projectName, linkedDeliverableId: id });
      }

      logAuditFromReq(req, { entityType: "deliverable", entityId: String(id), action: "update", projectName: updated?.projectName, changesJson: { description: "Feedback provided", feedbackText } });
      res.json(updated);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/deliverables/:id/revise", requireAuth, requirePermission("deliverables", "edit"), validateBody(deliverableReviseSchema), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      const { changeReason, impactJson } = req.body;

      const [existing] = await db.select().from(deliverables).where(eq(deliverables.id, id));
      if (!existing) return sendError(res, notFound("Deliverable"));

      const newVersion = existing.currentVersion + 1;

      const [version] = await db.insert(deliverableVersions).values({
        deliverableId: id,
        versionNumber: newVersion,
        changeReason: changeReason || null,
        impactJson: impactJson || null,
        status: "in_progress",
        createdByUserId: getUser(req).id,
      }).returning();

      const [updated] = await db.update(deliverables)
        .set({ currentVersion: newVersion, status: "in_progress", updatedAt: new Date() })
        .where(eq(deliverables.id, id)).returning();

      await db.insert(deliverableEvents).values({
        deliverableId: id,
        eventType: "revised",
        fromStatus: existing.status,
        toStatus: "in_progress",
        feedbackText: changeReason,
        actorUserId: getUser(req).id,
      });

      logAuditFromReq(req, { entityType: "deliverable", entityId: String(id), action: "update", projectName: updated.projectName, changesJson: { description: "Deliverable revised", newVersion, changeReason } });
      res.json({ deliverable: updated, version });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/deliverables/:id/files", requireAuth, requirePermission("deliverables", "edit"), validateBody(deliverableFileCreateSchema), async (req, res) => {
    try {
      // H8: strip server-controlled keys to prevent mass-assignment.
      const [file] = await db.insert(deliverableFiles).values({
        ...stripServerFields(req.body),
        deliverableId: parseIntParam(req.params.id),
        uploadedByUserId: getUser(req).id,
      }).returning();
      logAuditFromReq(req, { entityType: "deliverable", entityId: paramStr(req.params.id), action: "update", changesJson: { description: "File attached to deliverable", fileName: file.fileName } });
      res.json(file);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/deliverables/files/:fileId/approve", requireAuth, requireAuthority("deliverables", "approve"), async (req, res) => {
    try {
      const fileId = parseIntParam(req.params.fileId);
      if (isNaN(fileId)) return sendError(res, badRequest("Invalid file ID"));
      const [file] = await db.update(deliverableFiles)
        .set({ isApproved: true })
        .where(eq(deliverableFiles.id, fileId))
        .returning();
      logAuditFromReq(req, { entityType: "deliverable", entityId: paramStr(req.params.fileId), action: "approve", changesJson: { description: "Deliverable file approved" } });
      res.json(file);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== SHAREPOINT FILE POINTERS ==========

  app.get("/api/eng/file-pointers/:entityType/:entityId", requireAuth, requirePermission("engineering", "view"), async (req, res) => {
    try {
      const result = await db.select().from(spFilePointers)
        .where(and(
          eq(spFilePointers.entityType, paramStr(req.params.entityType)),
          eq(spFilePointers.entityId, parseIntParam(req.params.entityId))
        ))
        .orderBy(desc(spFilePointers.uploadedAt));
      res.json(result);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng/file-pointers", requireAuth, requirePermission("engineering", "edit"), validateBody(filePointerCreateSchema), async (req, res) => {
    try {
      const { entityType, entityId, spSiteId, spDriveId, spFileItemId, fileName, label, siteId, driveId, fileItemId, webUrl } = req.body;
      const [pointer] = await db.insert(spFilePointers).values({
        entityType,
        entityId,
        siteId: siteId || spSiteId,
        driveId: driveId || spDriveId,
        fileItemId: fileItemId || spFileItemId,
        fileName,
        webUrl: webUrl || null,
        uploadedByUserId: getUser(req).id,
      }).returning();
      logAuditFromReq(req, { entityType: "file_pointer", entityId: String(pointer.id), action: "create", changesJson: { description: "File pointer created", fileName, entityType } });
      res.json(pointer);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.delete("/api/eng/file-pointers/:id", requireAuth, requirePermission("engineering", "delete"), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return sendError(res, badRequest("Invalid ID"));
      await db.delete(spFilePointers).where(eq(spFilePointers.id, id));
      logAuditFromReq(req, { entityType: "file_pointer", entityId: paramStr(req.params.id), action: "delete", changesJson: { description: "File pointer deleted" } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== WARNING ENGINE - ENHANCED RULES ==========

  app.post("/api/eng/warnings/scan", requireAuth, requireAdminOrEpm, validateBody(warningScanSchema), async (req, res) => {
    try {
      const { projectName } = req.body;
      const newWarnings: any[] = [];
      const today = new Date().toISOString().split('T')[0];

      const canonicalTasks = await listEngineeringWorkItems(
        projectName ? { projectName } : {}
      );
      // Trust fix: use canonical lowercase for status comparison.
      // listEngineeringWorkItems returns canonical lowercase via
      // toCanonicalStatus(). The previous UPPERCASE comparisons silently
      // matched zero tasks, making warnings never fire.
      const allTasks = canonicalTasks.filter((t) => !isTaskComplete(t.status));

      for (const task of allTasks) {
        if (task.dueDate && task.dueDate < today && !isTaskComplete(task.status)) {
          const isHighPhase = task.phase === "Commissioning" || task.phase === "Handover";
          newWarnings.push({
            projectName: task.projectName,
            severity: isHighPhase ? "HIGH" : "MED",
            warningType: "overdue_task",
            title: `Overdue task: ${task.title}`,
            description: `Due ${task.dueDate}, status: ${task.status}`,
            relatedPlanItemId: task.linkedPlanItemId,
          });
        }

        if (task.startDate && task.dueDate && task.dueDate < task.startDate) {
          newWarnings.push({
            projectName: task.projectName,
            severity: "HIGH",
            warningType: "invalid_dates",
            title: `Invalid dates: ${task.title}`,
            description: `End date ${task.dueDate} is before start date ${task.startDate}`,
          });
        }

        if (!task.linkedPlanItemId && !task.linkedDeliverableId && !task.linkedQualityItemInstanceId) {
          const createdMore24h = task.createdAt && (Date.now() - new Date(task.createdAt).getTime()) > 24 * 60 * 60 * 1000;
          if (createdMore24h) {
            newWarnings.push({
              projectName: task.projectName,
              severity: "MED",
              warningType: "orphan_task",
              title: `Orphan task: ${task.title}`,
              description: `Task not linked to any plan item, deliverable, or quality checklist item`,
            });
          }
        }

        if (task.status === "needs_approval" && task.updatedAt) {
          const daysSinceUpdate = (Date.now() - new Date(task.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceUpdate > 2) {
            newWarnings.push({
              projectName: task.projectName,
              severity: "MED",
              warningType: "review_stuck",
              title: `Review stuck: ${task.title}`,
              description: `In needs_approval for ${Math.floor(daysSinceUpdate)} days`,
            });
          }
        }
      }

      // Legacy deliverables table still uses the original status values
      // (these are NOT normalized through the adapter, so keep original
      // casing for the direct DB query).
      const delConditions: any[] = [ne(deliverables.status, "complete")];
      if (projectName) delConditions.push(eq(deliverables.projectName, projectName));
      const allDeliverables = await db.select().from(deliverables).where(and(...delConditions));

      // Engineering PR 3: batch the approved-files check across all
      // qc_approved/complete deliverables. Old code ran one
      // `db.select().from(deliverableFiles)` per matching deliverable.
      // Now: single `inArray` over the candidate ids, group counts in JS.
      const candidateDeliverableIds = allDeliverables
        .filter((del: any) => del.status === "qc_approved" || del.status === "complete")
        .map((del: any) => del.id as number);
      const approvedFilesByDeliverableId = new Map<number, number>();
      if (candidateDeliverableIds.length > 0) {
        const approvedRows = await db
          .select({ deliverableId: deliverableFiles.deliverableId })
          .from(deliverableFiles)
          .where(and(
            inArray(deliverableFiles.deliverableId, candidateDeliverableIds),
            eq(deliverableFiles.isApproved, true),
          ));
        for (const row of approvedRows) {
          approvedFilesByDeliverableId.set(
            row.deliverableId,
            (approvedFilesByDeliverableId.get(row.deliverableId) ?? 0) + 1,
          );
        }
      }
      for (const del of allDeliverables) {
        if (del.status === "qc_approved" || del.status === "complete") {
          const approvedCount = approvedFilesByDeliverableId.get(del.id) ?? 0;
          if (approvedCount === 0) {
            newWarnings.push({
              projectName: del.projectName,
              severity: "HIGH",
              warningType: "missing_evidence",
              title: `Missing approved files: ${del.title}`,
              description: `Deliverable is ${del.status} but has no approved file pointers`,
            });
          }
        }
      }

      // Trust fix: scan project eng deliverables for IFC-missing condition.
      // If a stage template requires IFC issuance (requireIfcIssuance rule)
      // but all deliverables are only approved_for_review, that's a warning.
      try {
        const allStages = await db.select({
          id: projectEngStages.id,
          projectId: projectEngStages.projectId,
          status: projectEngStages.status,
          stageGateRules: engStageTemplates.stageGateRules,
          templateName: engStageTemplates.name,
        })
          .from(projectEngStages)
          .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
          .where(ne(projectEngStages.status, "complete"));

        // Engineering PR 3: batch the IFC scan. Old code ran two queries
        // per matching stage (deliverables + projectInfo). Now: filter to
        // candidate stages with the rule flag set, then run one
        // `inArray` for deliverables grouped by stage id, and one
        // `inArray` for project names by project id.
        const candidateStages = allStages.filter((stage: any) => {
          const rules = (stage.stageGateRules as any) || {};
          return !!rules.requireIfcIssuance;
        });
        const candidateStageIds: number[] = candidateStages.map((s: any) => s.id as number);
        const stageProjectIds: number[] = Array.from(
          new Set(
            candidateStages
              .map((s: any) => s.projectId as number | null)
              .filter((v: number | null): v is number => v != null),
          ),
        );

        const deliverablesByStageId = new Map<number, Array<{ releasedFor: string | null; approvalStatus: string | null }>>();
        if (candidateStageIds.length > 0) {
          const allStageDeliverables = await db.select({
            projectEngStageId: projectEngDeliverables.projectEngStageId,
            releasedFor: projectEngDeliverables.releasedFor,
            approvalStatus: projectEngDeliverables.approvalStatus,
          })
            .from(projectEngDeliverables)
            .where(inArray(projectEngDeliverables.projectEngStageId, candidateStageIds));
          for (const d of allStageDeliverables) {
            const list = deliverablesByStageId.get(d.projectEngStageId) ?? [];
            list.push({ releasedFor: d.releasedFor, approvalStatus: d.approvalStatus });
            deliverablesByStageId.set(d.projectEngStageId, list);
          }
        }

        const projectNameById = new Map<number, string>();
        if (stageProjectIds.length > 0) {
          const projectRows = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName })
            .from(projectInfo)
            .where(inArray(projectInfo.id, stageProjectIds));
          for (const p of projectRows) projectNameById.set(p.id, p.projectName);
        }

        for (const stage of candidateStages) {
          const stageDeliverables = deliverablesByStageId.get(stage.id) ?? [];
          const hasIfc = stageDeliverables.some((d) =>
            d.releasedFor === "issued_for_construction" || d.releasedFor === "as_built"
          );
          const hasApprovedOnly = stageDeliverables.some((d) =>
            d.approvalStatus === "approved" && d.releasedFor !== "issued_for_construction" && d.releasedFor !== "as_built"
          );

          if (!hasIfc && hasApprovedOnly) {
            newWarnings.push({
              projectName: projectNameById.get(stage.projectId) || `project_id:${stage.projectId}`,
              severity: "HIGH",
              warningType: "missing_approval",
              title: `IFC not issued: ${stage.templateName}`,
              description: `Stage "${stage.templateName}" requires IFC issuance but all deliverables are only QC-approved, not issued for construction`,
            });
          }
        }
      } catch (ifcScanErr: any) {
        console.warn("[Engineering] IFC warning scan error (non-fatal):", ifcScanErr.message);
      }

      if (newWarnings.length > 0) {
        await db.insert(qcWarning).values(newWarnings);
      }

      res.json({ scanned: allTasks.length + allDeliverables.length, warningsCreated: newWarnings.length, warnings: newWarnings });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/warnings", requireAuth, requirePermission("engineering", "view"), async (req, res) => {
    try {
      const { projectName, severity, status, warningType } = req.query;
      const conditions: any[] = [];
      if (projectName) conditions.push(eq(qcWarning.projectName, projectName as string));
      if (severity) conditions.push(eq(qcWarning.severity, severity as string));
      if (status) conditions.push(eq(qcWarning.status, status as string));
      if (warningType) conditions.push(eq(qcWarning.warningType, warningType as string));

      const result = conditions.length > 0
        ? await db.select().from(qcWarning).where(and(...conditions)).orderBy(desc(qcWarning.createdAt))
        : await db.select().from(qcWarning).orderBy(desc(qcWarning.createdAt));
      res.json(result);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.patch("/api/eng/warnings/:id", requireAuth, requirePermission("engineering", "edit"), validateBody(warningUpdateSchema), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      if (isNaN(id)) return sendError(res, badRequest("Invalid ID"));
      // H8: strip server-controlled keys to prevent mass-assignment.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = { ...stripServerFields(req.body), updatedAt: new Date() };
      const [updated] = await db.update(qcWarning).set(updates).where(eq(qcWarning.id, id)).returning();
      logAuditFromReq(req, { entityType: "qc_warning", entityId: String(id), action: "update", changesJson: { description: "Warning updated", status: req.body.status } });

      if (req.body.status) {
        await db.insert(qcWarningEvent).values({
          warningId: id,
          eventType: `status_changed_to_${req.body.status}`,
          note: req.body.note || null,
          actorUserId: getUser(req).id,
        });
      }

      res.json(updated);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/eng/warnings/:id/acknowledge", requireAuth, requirePermission("engineering", "edit"), validateBody(warningAcknowledgeSchema), async (req, res) => {
    try {
      const id = parseIntParam(req.params.id);
      await db.insert(qcWarningEvent).values({
        warningId: id,
        eventType: "acknowledged",
        note: req.body.reason || "Acknowledged - proceeding anyway",
        actorUserId: getUser(req).id,
      });
      logAuditFromReq(req, { entityType: "qc_warning", entityId: String(id), action: "update", changesJson: { description: "Warning acknowledged", reason: req.body.reason } });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== ENGINEERING OVERVIEW DASHBOARD ==========

  app.get("/api/eng/dashboard/overview", requireAuth, requirePermission("eng_tasks", "view"), async (req, res) => {
    try {
      const role = normalizeRoleForPermissions(getUserRole(req)) ?? "";
      // Engineering PR 2: canonical role names only. `eng_program_manager`
      // lowercase alias was unreachable (not in COMPANY_ROLES). The
      // ENGINEERING_MANAGER replaces the stale EPM role.
      const managerRoles = [
        ...ADMIN_ROLES,
        "CCO",
        "PROGRAM_MANAGER",
        "ENGINEERING_MANAGER",
        "CONSTRUCTION_MANAGER",
      ];
      const isManager = (managerRoles as readonly string[]).includes(role);
      const userName = getUser(req).name || "";
      const userFirstName = userName.split(/\s+/)[0];
      let assigneeFilter: string | undefined;
      if (isManager) {
        assigneeFilter = req.query.assignee as string | undefined;
      } else {
        assigneeFilter = userFirstName || undefined;
      }
      const todayStr = new Date().toISOString().split('T')[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const sevenDaysOut = new Date();
      sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
      const weekEndStr = sevenDaysOut.toISOString().split('T')[0];

      // Engineering PR 3: collapsed two leftJoin queries (one of which fed
      // a no-op loop that admitted "we need the projectId but it's not in
      // the select") into a single canonical query that includes
      // projectId, projectName, and phase.
      const [rawCanonicalTasks, projectIdPhaseRows] = await Promise.all([
        listEngineeringWorkItems({}),
        db.select({
          id: projectInfo.id,
          projectName: projectInfo.projectName,
          phase: projectExecutionState.phase,
        })
          .from(projectInfo)
          .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id)),
      ]);

      // Resolve assignee names from assigneeUserIds for standup filtering/workload
      const { buildUserMap } = await import("./user-resolver");
      const userMap = await buildUserMap();
      const rawTasks: EngTask[] = rawCanonicalTasks.map((t) => {
        const assigneeNames = (t.assigneeUserIds || [])
          .map((uid) => userMap.get(uid)?.name)
          .filter((name): name is string => Boolean(name));
        return { ...t, assignees: assigneeNames.length > 0 ? assigneeNames : null };
      });

      const allTasks: EngTask[] = assigneeFilter
        ? rawTasks.filter((t) => {
            if (!t.assignees || !Array.isArray(t.assignees)) return false;
            const filterLower = assigneeFilter!.toLowerCase();
            return t.assignees.some((a) => a && a.toLowerCase().startsWith(filterLower));
          })
        : rawTasks;

      const phaseByProjectId = new Map<number, string>();
      const projectNameById = new Map<number, string>();
      for (const row of projectIdPhaseRows) {
        if (row.phase) phaseByProjectId.set(row.id, row.phase);
        if (row.projectName) projectNameById.set(row.id, row.projectName);
      }

      /** Canonical phase lookup by projectId. Falls back to P0_FIRST_ASSESSMENT
       *  only when the project has no execution state row at all. */
      function lookupPhaseById(pid: number | null | undefined): string {
        if (pid && phaseByProjectId.has(pid)) return phaseByProjectId.get(pid)!;
        return "P0_FIRST_ASSESSMENT";
      }

      // Trust fix: canonical lowercase status comparison — must match
      // the output of listEngineeringWorkItems() / toCanonicalStatus().
      const openStatuses = new Set(["to_do", "in_progress", "needs_approval", "provide_feedback", "projects_assistance", "not_started"]);

      const recentlyCompleted = allTasks.filter((t) =>
        isTaskComplete(t.status) && t.completedAt &&
        new Date(t.completedAt).toISOString().split('T')[0] >= yesterdayStr
      );

      const blockers = allTasks.filter((t) =>
        t.status === "hold" || (!isTaskComplete(t.status) && t.dueDate && t.dueDate < todayStr)
      );

      const holdItems = blockers.filter((t) => t.status === "hold");
      const overdueItems = blockers.filter((t) => t.status !== "hold" && t.dueDate && t.dueDate < todayStr);

      const upcomingThisWeek = allTasks.filter((t) =>
        openStatuses.has(t.status) && t.dueDate && t.dueDate >= todayStr && t.dueDate <= weekEndStr
      ).sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));

      const inProgress = allTasks.filter((t) => t.status === "in_progress");
      const needsApproval = allTasks.filter((t) => t.status === "needs_approval" || t.status === "provide_feedback");

      const assigneeMap = new Map<string, { active: number; overdue: number; hold: number; dueThisWeek: number }>();
      for (const t of allTasks) {
        if (isTaskComplete(t.status)) continue;
        const names = t.assignees && Array.isArray(t.assignees) ? t.assignees.filter(Boolean) : [];
        if (names.length === 0) names.push("Unassigned");
        for (const name of names) {
          if (!assigneeMap.has(name)) assigneeMap.set(name, { active: 0, overdue: 0, hold: 0, dueThisWeek: 0 });
          const w = assigneeMap.get(name)!;
          w.active++;
          if (t.dueDate && t.dueDate < todayStr) w.overdue++;
          if (t.status === "hold") w.hold++;
          if (t.dueDate && t.dueDate >= todayStr && t.dueDate <= weekEndStr) w.dueThisWeek++;
        }
      }
      const workload = Array.from(assigneeMap.entries()).map(([name, w]) => ({ name, ...w }))
        .sort((a, b) => b.overdue - a.overdue || b.active - a.active);

      // Group tasks by projectId (canonical) rather than projectName (heuristic).
      // Tasks with no projectId go to the "Unassigned" bucket (projectId=0).
      const projectTaskMap = new Map<number, { projectName: string; tasks: typeof allTasks }>();
      for (const t of allTasks) {
        const pid = t.projectId || 0;
        if (!projectTaskMap.has(pid)) {
          projectTaskMap.set(pid, {
            projectName: t.projectName || (pid === 0 ? "Unassigned" : `Project #${pid}`),
            tasks: [],
          });
        }
        projectTaskMap.get(pid)!.tasks.push(t);
      }

      // Legacy compat: also build name-keyed map for the response shape
      const projectMap = new Map<string, typeof allTasks>();
      for (const [, { projectName, tasks }] of projectTaskMap) {
        projectMap.set(projectName, tasks);
      }

      const projectHealth = Array.from(projectTaskMap.entries()).map(([projectId, { projectName, tasks }]) => {
        // Canonical phase lookup by projectId — no fuzzy name matching.
        const phase = lookupPhaseById(projectId);
        const total = tasks.length;
        const completed = tasks.filter((t) => isTaskComplete(t.status)).length;
        const active = tasks.filter((t) => openStatuses.has(t.status)).length;
        const hold = tasks.filter((t) => t.status === "hold").length;
        const overdue = tasks.filter((t) => !isTaskComplete(t.status) && t.dueDate && t.dueDate < todayStr).length;
        const dueThisWeek = tasks.filter(t => openStatuses.has(t.status) && t.dueDate && t.dueDate >= todayStr && t.dueDate <= weekEndStr).length;
        const completion = total > 0 ? Math.round((completed / total) * 100) : 0;

        let rag: "GREEN" | "AMBER" | "RED" = "GREEN";
        if (overdue > 0 || hold > 2) rag = "RED";
        else if (hold > 0 || dueThisWeek > 3) rag = "AMBER";

        return {
          projectName,
          displayName: projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
          phase,
          phaseLabel: PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase,
          total, completed, active, hold, overdue, dueThisWeek, completion, rag,
        };
      }).sort((a, b) => {
        const ragOrder = { RED: 0, AMBER: 1, GREEN: 2 };
        return (ragOrder[a.rag] - ragOrder[b.rag]) || (b.overdue - a.overdue);
      });

      // Status pipeline: use canonical status directly (already normalized
      // by listEngineeringWorkItems). Display labels applied by client.
      const statusPipeline: Record<string, number> = {};
      for (const t of allTasks) {
        const canonical = toCanonicalStatus(t.status);
        statusPipeline[canonical] = (statusPipeline[canonical] || 0) + 1;
      }

      const mapTask = (t: typeof allTasks[0]) => {
        const view = projectEngineeringTicket({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          endDate: t.dueDate,
          ownerName: Array.isArray(t.assignees) && t.assignees.length > 0 ? t.assignees[0] : null,
          assignees: t.assignees ?? null,
          trackingRag: t.trackingRag ?? null,
          projectId: t.projectId ?? null,
          projectName: t.projectName ?? null,
          holdReason: t.holdReason ?? null,
          blockerReason: t.blockerReason ?? null,
          completedAt: t.completedAt ?? null,
          taskTypeTag: t.taskTypeTag ?? null,
        });
        return {
          id: t.id,
          title: t.title,
          status: view.status,
          statusLabel: view.statusLabel,
          statusBadgeClass: view.statusBadgeClass,
          statusColour: view.statusColour,
          priority: t.priority,
          dueDate: t.dueDate,
          dueLabel: view.dueLabel,
          dueUrgency: view.dueUrgency,
          assignees: t.assignees,
          ownerInitials: view.ownerInitials,
          tags: view.tags,
          trackingRag: t.trackingRag,
          projectName: t.projectName,
          holdReason: t.holdReason,
          blockerReason: t.blockerReason,
          completedAt: t.completedAt,
          taskTypeTag: t.taskTypeTag,
          isOverdue: view.isOverdue,
          isComplete: view.isComplete,
          isBlocked: view.isBlocked,
        };
      };

      // Collect IDs of tasks already shown in a named section
      const shownIds = new Set<number>();
      for (const t of overdueItems) shownIds.add(t.id);
      for (const t of holdItems) shownIds.add(t.id);
      for (const t of upcomingThisWeek) shownIds.add(t.id);
      for (const t of needsApproval) shownIds.add(t.id);
      for (const t of inProgress) shownIds.add(t.id);
      for (const t of recentlyCompleted) shownIds.add(t.id);

      // Catch-all: active tasks not covered by any section above
      const otherActive = allTasks.filter(t => openStatuses.has(t.status) && !shownIds.has(t.id));

      // Metric: totalProjects — count of distinct projects that have eng tasks,
      // excluding the "Unassigned" bucket which is not a real project.
      const realProjectCount = [...projectMap.keys()].filter(k => k !== "Unassigned").length;

      res.json({
        date: todayStr,
        summary: {
          totalProjects: realProjectCount,
          totalTasks: allTasks.length,
          activeTasks: allTasks.filter(t => openStatuses.has(t.status)).length,
          completedTasks: allTasks.filter((t) => isTaskComplete(t.status)).length,
          overdueTasks: overdueItems.length,
          holdTasks: holdItems.length,
          recentlyCompletedCount: recentlyCompleted.length,
          upcomingThisWeekCount: upcomingThisWeek.length,
          needsApprovalCount: needsApproval.length,
        },
        recentlyCompleted: recentlyCompleted.map(mapTask),
        blockers: {
          hold: holdItems.map(mapTask),
          overdue: overdueItems.map(mapTask),
        },
        upcomingThisWeek: upcomingThisWeek.map(mapTask),
        needsApproval: needsApproval.map(mapTask),
        inProgressHighlights: inProgress.map(mapTask),
        otherActive: otherActive.map(mapTask),
        workload,
        projectHealth,
        statusPipeline,
        // Trust metadata: tells the client which sections are provisional
        // so the UI can render appropriate caveats.
        _trustMetadata: {
          workload: { provisional: true, reason: "Name-based grouping — two people with the same first name will merge" },
          projectHealthRag: { provisional: true, reason: "Automated thresholds (>0 overdue = RED) — may not reflect actual project risk" },
          recentlyCompleted: { provisional: true, reason: "completedAt may be null for legacy tasks that were marked complete before timestamp tracking" },
          warningEngine: { provisional: true, reason: "Warning scan is backend-only; no UI surfaces warnings to users yet" },
        },
      });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== ENGINEERING DASHBOARD DATA ==========

  app.get("/api/eng/dashboard/projects", requireAuth, requireAdminOrEpm, async (req, res) => {
    try {
      const [allTasks, allProjectInfoRows] = await Promise.all([
        listEngineeringWorkItems({}),
        db.select({ projectName: projectInfo.projectName, phase: projectExecutionState.phase })
          .from(projectInfo)
          .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id)),
      ]);

      const normalizeKey = (n: string) => n.replace(/_Tracker.*$/i, "").replace(/_/g, " ").toLowerCase().trim();

      const phaseByNorm = new Map<string, string>();
      for (const pi of allProjectInfoRows) {
        if (pi.phase) {
          phaseByNorm.set(normalizeKey(pi.projectName), pi.phase);
        }
      }

      function lookupPhase(taskProjectName: string): string {
        const norm = normalizeKey(taskProjectName);
        if (phaseByNorm.has(norm)) return phaseByNorm.get(norm)!;
        const baseName = norm.replace(/\s*(phase\s*\d+|expansion|rev\d+|\+.*$)/gi, "").trim();
        if (baseName && phaseByNorm.has(baseName)) return phaseByNorm.get(baseName)!;
        for (const [key, phase] of phaseByNorm) {
          if (key.startsWith(baseName) || baseName.startsWith(key)) return phase;
        }
        return "P0_FIRST_ASSESSMENT";
      }

      const projectMap = new Map<string, { projectName: string; phase: string }>();

      for (const t of allTasks) {
        const key = t.projectName || "Unassigned";
        if (!projectMap.has(key)) {
          projectMap.set(key, { projectName: key, phase: lookupPhase(key) });
        }
      }

      const result = Array.from(projectMap.values()).map(p => ({
        projectName: p.projectName,
        displayName: p.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
        phase: p.phase,
        phaseLabel: PROJECT_PHASE_LABELS[p.phase as ProjectPhase] || p.phase,
      }));

      res.json({ projects: result });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== USERS LIST (for assignment dropdowns) ==========

  // permission-skip: assignment-dropdown directory consumed by
  // CreateTaskFromSourceDialog and similar UI from non-engineering tabs
  // (e.g., CFO opening a source dialog needs to see assignees). Tier 2
  // audit found that `engineering:view` blocks CFO / CONSTRUCTION_MANAGER /
  // ACCOUNTANT / HSE_MANAGER from these dropdowns. The directory itself
  // (id/name/role) is broadly accessible by design.
  app.get("/api/eng/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await db.select({
        id: users.id, name: users.name, email: users.email, role: users.role,
      }).from(users).orderBy(asc(users.name));
      res.json(allUsers);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== ADMIN AUDIT LOG (global activity across all tasks) ==========

  app.get("/api/eng/unified-audit", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { category, search, limit: qLimit, offset: qOffset } = req.query;
      const pageLimit = Math.min(parseInt(qLimit as string) || 100, 500);
      const pageOffset = parseInt(qOffset as string) || 0;
      const searchTerm = (search as string || "").trim().toLowerCase();

      const catFilter = (!category || category === "all") ? null : (category as string);
      const searchFilter = searchTerm ? `%${searchTerm}%` : null;

      // H1 hotfix: each fragment is a parameterised `sql` tagged template so
      // any future contributor that adds an interpolated value lands on the
      // safe path (Drizzle binds the parameter); previously these were raw
      // strings concatenated with `sql.raw(...)` which would have happily
      // inlined any caller-controlled string into the SQL.
      const unionParts: ReturnType<typeof sql>[] = [];

      if (!catFilter || catFilter === "task_changes") {
        unionParts.push(sql`
          SELECT
            'task_' || tal.id::text AS id,
            'task_changes' AS category,
            tal.action_type AS action_type,
            CASE
              WHEN tal.action_type = 'field_changed' AND tal.field_name IS NOT NULL
                THEN 'Changed ' || tal.field_name
              WHEN tal.action_type = 'created' THEN 'Task created'
              ELSE 'Task ' || replace(tal.action_type, '_', ' ')
            END AS summary,
            CASE
              WHEN tal.action_type = 'field_changed'
                THEN coalesce(tal.old_value, '—') || ' → ' || coalesce(tal.new_value, '—')
              WHEN tal.action_type = 'created'
                THEN coalesce(tal.new_value, wi.title)
              ELSE wi.title
            END AS detail,
            u.name AS actor_name,
            coalesce(pi.project_name, '') AS project_name,
            tal.created_at AS timestamp
          FROM task_activity_log tal
          LEFT JOIN users u ON tal.actor_id = u.id
          LEFT JOIN work_items wi ON tal.task_id = wi.id
          LEFT JOIN project_info pi ON wi.project_id = pi.id
        `);
      }

      if (!catFilter || catFilter === "phase_changes") {
        unionParts.push(sql`
          SELECT
            'phase_' || pph.id::text AS id,
            'phase_changes' AS category,
            'phase_changed' AS action_type,
            'Phase: ' || coalesce(pph.from_phase, 'None') || ' → ' || pph.to_phase AS summary,
            pph.reason AS detail,
            u.name AS actor_name,
            replace(replace(pi.project_name, '_Tracker', ''), '_', ' ') AS project_name,
            pph.changed_at AS timestamp
          FROM project_phase_history pph
          LEFT JOIN users u ON pph.changed_by_user_id = u.id
          LEFT JOIN project_info pi ON pph.project_id = pi.id
        `);
      }

      if (!catFilter || catFilter === "data_imports") {
        unionParts.push(sql`
          SELECT
            'upload_' || um.id::text AS id,
            'data_imports' AS category,
            CASE WHEN um.status = 'success' THEN 'import_success' ELSE 'import_failed' END AS action_type,
            'Data import: ' || um.file_name AS summary,
            um.records_processed::text || ' records processed' ||
              CASE WHEN um.validation_errors IS NOT NULL THEN ' — ' || um.validation_errors ELSE '' END AS detail,
            u.name AS actor_name,
            NULL AS project_name,
            um.uploaded_at AS timestamp
          FROM upload_metadata um
          LEFT JOIN users u ON um.uploaded_by = u.id
        `);
        unionParts.push(sql`
          SELECT
            'refresh_' || rl.id::text AS id,
            'data_imports' AS category,
            'data_refresh' AS action_type,
            'Data refresh triggered' AS summary,
            'Status: ' || rl.status AS detail,
            u.name AS actor_name,
            NULL AS project_name,
            rl.refreshed_at AS timestamp
          FROM refresh_logs rl
          LEFT JOIN users u ON rl.triggered_by = u.id
        `);
      }

      if (!catFilter || catFilter === "writebacks") {
        unionParts.push(sql`
          SELECT
            'wb_' || wal.id::text AS id,
            'writebacks' AS category,
            CASE
              WHEN wal.status = 'applied' THEN 'writeback_applied'
              WHEN wal.status = 'rolled_back' THEN 'writeback_rolled_back'
              ELSE 'writeback_error'
            END AS action_type,
            'Writeback: ' || wal.sheet_name || '!' || wal.cell_address AS summary,
            coalesce(wal.previous_value, '—') || ' → ' || wal.new_value ||
              CASE WHEN wal.error_message IS NOT NULL THEN ' (Error: ' || wal.error_message || ')' ELSE '' END AS detail,
            u.name AS actor_name,
            wal.project_id AS project_name,
            wal.applied_at AS timestamp
          FROM writeback_audit_log wal
          LEFT JOIN users u ON wal.actor_id = u.id
        `);
      }

      if (!catFilter || catFilter === "template_applications") {
        unionParts.push(sql`
          SELECT
            'tpl_' || pta.id::text AS id,
            'template_applications' AS category,
            'template_applied' AS action_type,
            'Template applied: ' || coalesce(pt.name, 'Unknown') || ' v' || pta.template_version::text AS summary,
            'Phase: ' || pta.phase AS detail,
            u.name AS actor_name,
            replace(replace(pi.project_name, '_Tracker', ''), '_', ' ') AS project_name,
            pta.applied_at AS timestamp
          FROM phase_template_application pta
          LEFT JOIN users u ON pta.applied_by_user_id = u.id
          LEFT JOIN project_info pi ON pta.project_id = pi.id
          LEFT JOIN phase_template pt ON pta.template_id = pt.id
        `);
      }

      if (unionParts.length === 0) {
        return res.json({ entries: [], total: 0, categoryCounts: {} });
      }

      // H1 hotfix: drop `sql.raw(unionQuery)` — embed the joined SQL directly
      // so the whole statement remains a single parameterised Drizzle tagged
      // template. `sql.join` is the canonical way to concatenate SQL fragments.
      const unionQuery = sql.join(unionParts, sql` UNION ALL `);

      let countResult;
      let dataResult;

      if (searchFilter) {
        const countSql = sql`SELECT category, count(*)::int AS cnt FROM (${unionQuery}) unified WHERE lower(summary) LIKE ${searchFilter} OR lower(detail) LIKE ${searchFilter} OR lower(actor_name) LIKE ${searchFilter} OR lower(project_name) LIKE ${searchFilter} GROUP BY category`;
        countResult = await db.execute(countSql);

        const dataSql = sql`SELECT * FROM (${unionQuery}) unified WHERE lower(summary) LIKE ${searchFilter} OR lower(detail) LIKE ${searchFilter} OR lower(actor_name) LIKE ${searchFilter} OR lower(project_name) LIKE ${searchFilter} ORDER BY timestamp DESC NULLS LAST LIMIT ${pageLimit} OFFSET ${pageOffset}`;
        dataResult = await db.execute(dataSql);
      } else {
        countResult = await db.execute(sql`SELECT category, count(*)::int AS cnt FROM (${unionQuery}) unified GROUP BY category`);
        dataResult = await db.execute(sql`SELECT * FROM (${unionQuery}) unified ORDER BY timestamp DESC NULLS LAST LIMIT ${pageLimit} OFFSET ${pageOffset}`);
      }

      const categoryCounts: Record<string, number> = {};
      let total = 0;
      for (const row of countResult.rows as any[]) {
        categoryCounts[row.category] = row.cnt;
        total += row.cnt;
      }

      const entries = (dataResult.rows as any[]).map((r: any) => ({
        id: r.id,
        category: r.category,
        actionType: r.action_type,
        summary: r.summary,
        detail: r.detail,
        actorName: r.actor_name,
        projectName: r.project_name,
        timestamp: r.timestamp,
      }));

      res.json({ entries, total, categoryCounts });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/audit-log", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { projectName, actorId, actionType, dateFrom, dateTo, limit: qLimit, offset: qOffset } = req.query;
      const pageLimit = Math.min(parseInt(qLimit as string) || 100, 500);
      const pageOffset = parseInt(qOffset as string) || 0;

      const conditions: any[] = [];
      if (projectName) {
        conditions.push(sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND pi.project_name = ${projectName as string})`);
      }
      if (actorId) {
        conditions.push(eq(taskActivityLog.actorId, parseInt(actorId as string)));
      }
      if (actionType) {
        conditions.push(eq(taskActivityLog.actionType, actionType as string));
      }
      if (dateFrom) {
        conditions.push(gt(taskActivityLog.createdAt, new Date(dateFrom as string)));
      }
      if (dateTo) {
        conditions.push(lt(taskActivityLog.createdAt, new Date(dateTo as string)));
      }

      const baseQuery = db.select({
        id: taskActivityLog.id,
        taskId: taskActivityLog.workItemId,
        actionType: taskActivityLog.actionType,
        fieldName: taskActivityLog.fieldName,
        oldValue: taskActivityLog.oldValue,
        newValue: taskActivityLog.newValue,
        createdAt: taskActivityLog.createdAt,
        actorName: users.name,
        actorEmail: users.email,
        taskTitle: workItems.title,
        projectName: projectInfo.projectName,
      })
      .from(taskActivityLog)
      .leftJoin(users, eq(taskActivityLog.actorId, users.id))
      .leftJoin(workItems, eq(taskActivityLog.workItemId, workItems.id))
      .leftJoin(projectInfo, eq(workItems.projectId, projectInfo.id));

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(taskActivityLog)
        .leftJoin(workItems, eq(taskActivityLog.workItemId, workItems.id))
        .leftJoin(projectInfo, eq(workItems.projectId, projectInfo.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const rows = await baseQuery
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(taskActivityLog.createdAt))
        .limit(pageLimit)
        .offset(pageOffset);

      const allActions = await db.selectDistinct({ actionType: taskActivityLog.actionType })
        .from(taskActivityLog);
      const allProjects = await db.selectDistinct({ projectName: projectInfo.projectName })
        .from(taskActivityLog)
        .leftJoin(workItems, eq(taskActivityLog.workItemId, workItems.id))
        .leftJoin(projectInfo, eq(workItems.projectId, projectInfo.id))
        .where(sql`${projectInfo.projectName} IS NOT NULL`);
      const allActors = await db.select({ id: users.id, name: users.name })
        .from(users)
        .orderBy(asc(users.name));

      res.json({
        entries: rows,
        total: Number(countResult[0]?.count || 0),
        limit: pageLimit,
        offset: pageOffset,
        filters: {
          actionTypes: allActions.map((a: any) => a.actionType),
          projectNames: allProjects.map((p: any) => p.projectName).filter(Boolean),
          actors: allActors,
        },
      });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/audit-log/stats", requireAuth, requireAdmin, async (req, res) => {
    try {
      const totalResult = await db.select({ count: sql<number>`count(*)` }).from(taskActivityLog);
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayResult = await db.select({ count: sql<number>`count(*)` })
        .from(taskActivityLog)
        .where(gt(taskActivityLog.createdAt, todayStart));

      const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
      const weekResult = await db.select({ count: sql<number>`count(*)` })
        .from(taskActivityLog)
        .where(gt(taskActivityLog.createdAt, weekStart));

      const byAction = await db.select({
        actionType: taskActivityLog.actionType,
        count: sql<number>`count(*)`,
      }).from(taskActivityLog).groupBy(taskActivityLog.actionType);

      const topActors = await db.select({
        actorId: taskActivityLog.actorId,
        actorName: users.name,
        count: sql<number>`count(*)`,
      })
      .from(taskActivityLog)
      .leftJoin(users, eq(taskActivityLog.actorId, users.id))
      .groupBy(taskActivityLog.actorId, users.name)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

      res.json({
        total: Number(totalResult[0]?.count || 0),
        today: Number(todayResult[0]?.count || 0),
        thisWeek: Number(weekResult[0]?.count || 0),
        byAction,
        topActors,
      });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/eng/audit-log/phase-history", requireAuth, requireAdmin, async (req, res) => {
    try {
      const history = await db.select({
        id: projectPhaseHistory.id,
        projectId: projectPhaseHistory.projectId,
        fromPhase: projectPhaseHistory.fromPhase,
        toPhase: projectPhaseHistory.toPhase,
        reason: projectPhaseHistory.reason,
        changedAt: projectPhaseHistory.changedAt,
        changedByName: users.name,
        projectName: projectInfo.projectName,
      })
      .from(projectPhaseHistory)
      .leftJoin(users, eq(projectPhaseHistory.changedByUserId, users.id))
      .leftJoin(projectInfo, eq(projectPhaseHistory.projectId, projectInfo.id))
      .orderBy(desc(projectPhaseHistory.changedAt));
      res.json(history);
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== CP SIGNED GATE ==========

  const PM_DEFAULT_TASK_PACK = [
    { title: "Contract Administration Setup", priority: "High", phase: "P2_PD_PM_HANDOVER" },
    { title: "Project Kick-off Meeting", priority: "High", phase: "P2_PD_PM_HANDOVER" },
    { title: "Resource Allocation Plan", priority: "Med", phase: "P2_PD_PM_HANDOVER" },
    { title: "Schedule Baseline", priority: "High", phase: "P2_PD_PM_HANDOVER" },
    { title: "Risk Register Initialization", priority: "Med", phase: "P2_PD_PM_HANDOVER" },
    { title: "Communication Plan", priority: "Med", phase: "P2_PD_PM_HANDOVER" },
  ];

  const ENG_POST_CP_TASK_PACK = [
    { title: "Detailed Design Initiation", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
    { title: "Equipment Procurement List", priority: "High", phase: "P3_DETAILED_DESIGN_PROC_RELEASE" },
    { title: "Installation Methodology", priority: "Med", phase: "P4_CONSTRUCTION_INSTALLATION" },
    { title: "Testing & Commissioning Plan", priority: "Med", phase: "P5_COMMISSIONING_TESTING" },
  ];

  app.post("/api/projects/:projectId/mark-cp-signed", jwtAuth, requireAuth, requireAdmin, validateBody(markCpSignedSchema), async (req, res) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      const user = getUser(req);
      const { evidenceType, emailSubject, emailDate, fileId } = req.body;

      const [project] = await db.select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        cpSigned: projectExecutionState.cpSigned,
        cpSignedDate: projectExecutionState.cpSignedDate,
        pmTaskPackCreated: projectExecutionState.pmTaskPackCreated,
        engPostCpTaskPackCreated: projectExecutionState.engPostCpTaskPackCreated,
      }).from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        .where(eq(projectInfo.id, projectId));
      if (!project) return sendError(res, notFound("Project"));

      // Idempotency: already signed
      if (project.cpSigned) {
        return res.json({
          success: true,
          alreadySigned: true,
          cpSignedDate: project.cpSignedDate,
          message: "CP already marked as signed. No duplicates created.",
        });
      }

      // Validate evidence
      if (!evidenceType || !["file_upload", "email_reference"].includes(evidenceType)) {
        return sendError(res, badRequest("evidenceType must be 'file_upload' or 'email_reference'"));
      }
      if (evidenceType === "email_reference" && !emailSubject) {
        return sendError(res, badRequest("emailSubject required for email_reference evidence"));
      }

      const evidenceRef = evidenceType === "file_upload"
        ? (fileId ? String(fileId) : null)
        : JSON.stringify({ emailSubject, emailDate: emailDate || new Date().toISOString().split("T")[0] });

      // Mark CP signed
      const cpSignedFields = {
        cpSigned: true,
        cpSignedDate: new Date().toISOString().split("T")[0],
        cpSignedByUserId: user.id,
        cpEvidenceType: evidenceType,
        cpEvidenceRef: evidenceRef,
        updatedAt: new Date(),
      };
      await db.update(projectInfo).set(cpSignedFields).where(eq(projectInfo.id, projectId));
      await syncProjectSplitTables(projectId, cpSignedFields);

      // Engineering PR 3: bulk-insert both task packs in one round-trip.
      // Old code called `createEngineeringWorkItem` N times (10 INSERTs
      // total). Now: filter packs by idempotency flags, build a single
      // values array, one INSERT. Latent bug fix: `phase` was silently
      // dropped by `createEngineeringWorkItem` because the helper omitted
      // it from the `createWorkItem` payload; the bulk path writes phase
      // directly so new task-pack rows now carry phase as intended.
      let pmTasksCreated = 0;
      let engTasksCreated = 0;

      const rowsToInsert: Array<{
        projectId: number;
        title: string;
        status: string;
        priority: string;
        phase: string;
        workstream: "ENG";
        type: string;
        source: "UI";
        createdBy: number;
      }> = [];

      if (!project.pmTaskPackCreated) {
        for (const t of PM_DEFAULT_TASK_PACK) {
          rowsToInsert.push({
            projectId,
            title: `[PM] ${t.title}`,
            status: "to_do",
            priority: t.priority,
            phase: t.phase,
            workstream: "ENG",
            type: "task",
            source: "UI",
            createdBy: user.id,
          });
        }
        pmTasksCreated = PM_DEFAULT_TASK_PACK.length;
      }

      if (!project.engPostCpTaskPackCreated) {
        for (const t of ENG_POST_CP_TASK_PACK) {
          rowsToInsert.push({
            projectId,
            title: `[Eng Post-CP] ${t.title}`,
            status: "to_do",
            priority: t.priority,
            phase: t.phase,
            workstream: "ENG",
            type: "task",
            source: "UI",
            createdBy: user.id,
          });
        }
        engTasksCreated = ENG_POST_CP_TASK_PACK.length;
      }

      if (rowsToInsert.length > 0) {
        await db.insert(workItems).values(rowsToInsert);
      }

      if (!project.pmTaskPackCreated) {
        await db.update(projectInfo).set({ pmTaskPackCreated: true }).where(eq(projectInfo.id, projectId));
        await syncProjectSplitTables(projectId, { pmTaskPackCreated: true });
      }
      if (!project.engPostCpTaskPackCreated) {
        await db.update(projectInfo).set({ engPostCpTaskPackCreated: true }).where(eq(projectInfo.id, projectId));
        await syncProjectSplitTables(projectId, { engPostCpTaskPackCreated: true });
      }

      logAuditFromReq(req, {
        entityType: "cp_signed_gate",
        entityId: String(projectId),
        action: "cp_signed",
        projectName: project.projectName,
        changesJson: { evidenceType, pmTasksCreated, engTasksCreated },
      });

      res.json({
        success: true,
        alreadySigned: false,
        cpSignedDate: new Date().toISOString().split("T")[0],
        pmTasksCreated,
        engTasksCreated,
        totalTasksCreated: pmTasksCreated + engTasksCreated,
      });
    } catch (err: any) {
      console.error("[Engineering] CP Signed Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/projects/:projectId/cp-status", jwtAuth, requireAuth, async (req, res) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      const [project] = await db.select({
        cpSigned: projectExecutionState.cpSigned,
        cpSignedDate: projectExecutionState.cpSignedDate,
        cpSignedByUserId: projectExecutionState.cpSignedByUserId,
        cpEvidenceType: projectExecutionState.cpEvidenceType,
        cpEvidenceRef: projectExecutionState.cpEvidenceRef,
        pmTaskPackCreated: projectExecutionState.pmTaskPackCreated,
        engPostCpTaskPackCreated: projectExecutionState.engPostCpTaskPackCreated,
      }).from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        .where(eq(projectInfo.id, projectId));

      if (!project) return sendError(res, notFound("Project"));

      let signedByName: string | null = null;
      if (project.cpSignedByUserId) {
        signedByName = await findUserName(project.cpSignedByUserId);
      }

      // Engineering PR 3: coalesce so leftJoin nulls on the execution-state
      // side become safe defaults (cpSigned: false, etc.) before spreading.
      res.json({
        ...coalesceProjectExecState(project),
        cpSignedByName: signedByName,
      });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== PROJECT PHASE MANAGEMENT ==========

  app.patch("/api/projects/:projectId/phase", jwtAuth, requireAuth, requirePermission("lifecycle", "edit"), validateBody(phaseChangeSchema), async (req, res) => {
    try {
      const user = getUser(req);
      if (user.role !== "COO_ADMIN" && user.role !== "CEO_ADMIN") {
        return sendError(res, forbidden("Only admins can change project phases"));
      }

      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return sendError(res, badRequest("Invalid project ID"));

      const { toPhase, reason, overrideSequence } = req.body;
      if (!toPhase || !reason || typeof reason !== "string" || reason.trim().length === 0) {
        return sendError(res, badRequest("toPhase and reason are required"));
      }
      if (!PROJECT_PHASES.includes(toPhase as any)) {
        return sendError(res, badRequest("Invalid phase value", { validPhases: PROJECT_PHASES.join(", ") }));
      }

      // `phase` lives on `projectExecutionState`, not `projectInfo`.
      const project = await findProjectWithExecutionState(projectId);
      if (!project) return sendError(res, notFound("Project"));

      const fromPhase = project.phase ?? null;

      if (fromPhase === toPhase) {
        return sendError(res, badRequest("Project is already in this phase"));
      }

      const fromIdx = PROJECT_PHASES.indexOf(fromPhase as any);
      const toIdx = PROJECT_PHASES.indexOf(toPhase as any);
      if (fromIdx >= 0 && toIdx >= 0 && Math.abs(toIdx - fromIdx) > 1 && !overrideSequence) {
        return sendError(res, badRequest(`Phase can only move one step at a time (${PROJECT_PHASE_LABELS[fromPhase as ProjectPhase] || fromPhase} → next). Set overrideSequence=true to skip.`));
      }

      let tasksCreated = 0;
      let templateApplied = false;
      let templateResult: any = null;

      await db.transaction(async (tx: any) => {
        const phaseFields = {
          phase: toPhase,
          phaseUpdatedAt: new Date(),
          phaseUpdatedByUserId: user.id,
          phaseNotes: reason.trim(),
          updatedAt: new Date(),
        };
        await tx.update(projectInfo)
          .set(phaseFields)
          .where(eq(projectInfo.id, projectId));
        await syncProjectSplitTables(projectId, phaseFields, tx);

        await tx.insert(projectPhaseHistory).values({
          projectId,
          fromPhase: fromPhase || null,
          toPhase,
          changedByUserId: user.id,
          reason: reason.trim(),
        });
      });

      try {
        const [activeTemplate] = await db.select().from(phaseTemplateTbl)
          .where(and(eq(phaseTemplateTbl.phase, toPhase), eq(phaseTemplateTbl.isActive, true)));

        if (activeTemplate) {
          templateResult = await applyTemplate(projectId, toPhase, activeTemplate.id, activeTemplate.version, user.id);
          templateApplied = true;
          tasksCreated = templateResult.tasksCreated || 0;
        }
      } catch (err: any) {
        console.warn("[Phase] Template apply error (non-fatal):", err.message);
      }

      if (!templateApplied) {
        const fromP1OrBefore = !fromPhase || PROJECT_PHASES.indexOf(fromPhase as any) <= 1;
        const toP2OrBeyond = PROJECT_PHASES.indexOf(toPhase as any) >= 2;

        if (fromP1OrBefore && toP2OrBeyond) {
          const generated = await generateDefaultEngineeringWorkItemsForProject(projectId, user.id);
          tasksCreated = generated.length;

          if (tasksCreated > 0) {
            await db.insert(taskActivityLog).values({
              workItemId: 0,
              actorId: user.id,
              actionType: "auto_generated",
              newValue: `${tasksCreated} engineering work items auto-created for project ${projectId} on phase transition to ${PROJECT_PHASE_LABELS[toPhase as ProjectPhase]}`,
            });
          }
        }
      }

      // D4: Evaluate stage gate in "warn" mode — log result but don't block
      let gateEvaluation: any = null;
      try {
        const { evaluateStageGate } = await import("./services/lifecycle-stage-gate-service");
        gateEvaluation = await evaluateStageGate({
          projectId,
          targetStage: toPhase,
          actorUserId: user.id,
          actorRole: user.role,
        });
        // B8: Create gate approval when there are missing items
        if (gateEvaluation && !gateEvaluation.allowed && gateEvaluation.missingItems?.length > 0) {
          try {
            const { createGateApproval } = await import("./services/approval-service");
            await createGateApproval({
              projectId,
              gateName: gateEvaluation.gateName,
              requestedByUserId: user.id,
              approverUserId: user.id,
            });
          } catch (approvalErr: any) {
            console.warn("[Phase] Gate approval creation failed (non-blocking):", approvalErr.message);
          }
        }
      } catch (gateErr: any) {
        console.warn("[Phase] Stage gate evaluation error (non-blocking):", gateErr.message);
      }

      const updated = await findProjectInfoById(projectId);
      res.json({
        project: updated,
        phaseLabel: PROJECT_PHASE_LABELS[toPhase as ProjectPhase] || toPhase,
        tasksCreated,
        templateApplied,
        templateResult,
        gateEvaluation: gateEvaluation ? {
          allowed: gateEvaluation.allowed,
          gateName: gateEvaluation.gateName,
          missingItems: gateEvaluation.missingItems,
        } : null,
      });
    } catch (err: any) {
      console.error("[Phase] Error:", err.message);
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/projects/:projectId/phase-history", jwtAuth, requireAuth, requirePermission("lifecycle", "view"), async (req, res) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return sendError(res, badRequest("Invalid project ID"));

      const project = await findProjectInfoById(projectId);
      if (!project) return sendError(res, notFound("Project"));

      const history = await db.select({
        id: projectPhaseHistory.id,
        fromPhase: projectPhaseHistory.fromPhase,
        toPhase: projectPhaseHistory.toPhase,
        changedAt: projectPhaseHistory.changedAt,
        reason: projectPhaseHistory.reason,
        changedByUserId: projectPhaseHistory.changedByUserId,
        changedByName: users.name,
      })
        .from(projectPhaseHistory)
        .leftJoin(users, eq(projectPhaseHistory.changedByUserId, users.id))
        .where(eq(projectPhaseHistory.projectId, projectId))
        .orderBy(desc(projectPhaseHistory.changedAt));

      res.json({ history, phaseLabels: PROJECT_PHASE_LABELS });
    } catch (err: any) {
      console.error("[Phase] History error:", err.message);
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  // ========== PROJECT ENGINEERING TASKS (for project detail page) ==========

  app.get("/api/projects/:projectId/eng-tasks", jwtAuth, requireAuth, requirePermission("eng_tasks", "view"), async (req, res) => {
    try {
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return sendError(res, badRequest("Invalid project ID"));

      // `phase` lives on `projectExecutionState`, not `projectInfo`.
      const project = await findProjectWithExecutionState(projectId);
      if (!project) return sendError(res, notFound("Project"));

      const cleanName = project.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
      const tasks = await listEngineeringWorkItems({ projectId });

      res.json({
        projectName: cleanName,
        phase: project.phase ?? null,
        tasks,
      });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.post("/api/projects/:projectId/generate-eng-tasks", jwtAuth, requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = getUser(req);
      const projectId = parseIntParam(req.params.projectId);
      if (isNaN(projectId)) return sendError(res, badRequest("Invalid project ID"));

      const project = await findProjectInfoById(projectId);
      if (!project) return sendError(res, notFound("Project"));

      const existing = await listEngineeringWorkItems({ projectId });
      if (existing.length > 0) {
        return sendError(res, badRequest("Engineering tasks already exist for this project"));
      }

      const created = await generateDefaultEngineeringWorkItemsForProject(projectId, user.id);
      const tasks = await listEngineeringWorkItems({ projectId });

      res.json({ tasksCreated: created.length, tasks });
    } catch (err: any) {
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/admin/reconciliation/work-items/engineering", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const report = await generateWorkItemReconciliationReport("ENG");
      res.json(report);
    } catch (err: any) {
      console.error("[Reconciliation] engineering error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/admin/reconciliation/work-items/projects", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const report = await generateWorkItemReconciliationReport();
      res.json(report);
    } catch (err: any) {
      console.error("[Reconciliation] projects error:", err);
      sendError(res, err);
    }
  });

  app.get("/api/admin/reconciliation/work-items/summary", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const [allWorkItems, engineeringWorkItems] = await Promise.all([
        generateWorkItemReconciliationReport(),
        generateWorkItemReconciliationReport("ENG"),
      ]);
      res.json({
        generated_at: new Date().toISOString(),
        status: [allWorkItems.status, engineeringWorkItems.status].includes("fail")
          ? "fail"
          : [allWorkItems.status, engineeringWorkItems.status].includes("warning")
            ? "warning"
            : "pass",
        explanation: [allWorkItems.explanation, engineeringWorkItems.explanation].filter(Boolean).join(" | "),
        all_work_items: {
          status: allWorkItems.status,
          explanation: allWorkItems.explanation,
          ...allWorkItems.totals,
        },
        engineering: {
          status: engineeringWorkItems.status,
          explanation: engineeringWorkItems.explanation,
          ...engineeringWorkItems.totals,
        },
      });
    } catch (err: any) {
      console.error("[Reconciliation] summary error:", err);
      sendError(res, err);
    }
  });

  // ========== CONSTANTS ==========

  app.get("/api/eng/constants", requireAuth, (req, res) => {
    res.json({
      taskStatuses: TASK_STATUSES,
      taskWorkstreams: TASK_WORKSTREAMS,
      taskPriorities: TASK_PRIORITIES,
      projectPhases: PROJECT_PHASES,
      projectPhaseLabels: PROJECT_PHASE_LABELS,
      deliverableStatuses: DELIVERABLE_STATUSES,
    });
  });

  app.get("/api/home/action-hub", requireAuth, async (req, res) => {
    try {
      const currentUser = getUser(req);
      const userId = currentUser.id;
      const userRole = currentUser.role || "";
      const userName = currentUser.name || "";
      const isAdmin = ["COO_ADMIN", "CEO_ADMIN"].includes(userRole);

      const APPROVAL_ROLE_MAP: Record<string, string[]> = {
        QA_REVIEW: ["QUALITY_MANAGER"],
        TECHNICAL_SIGNOFF: ["ENGINEERING_MANAGER", "COO_ADMIN", "CEO_ADMIN"],
        "Engineering Manager": ["ENGINEERING_MANAGER"],
        "Quality Manager": ["QUALITY_MANAGER"],
        "COO": ["COO_ADMIN"],
      };

      const [
        myTasks,
        engApprovals,
        qcItems,
        deliverableItems,
        projectsAtRisk,
      ] = await Promise.all([
        db.select({
          id: workItems.id,
          title: workItems.title,
          status: workItems.status,
          priority: workItems.priority,
          dueDate: workItems.endDate,
          percentComplete: workItems.percentComplete,
        })
          .from(workItems)
          .where(and(
            eq(workItems.workstream, "ENG"),
            eq(workItems.ownerUserId, userId),
            isNull(workItems.deletedAt),
            sql`${workItems.status} NOT IN ('Complete', 'Done')`,
          ))
          .orderBy(asc(sql`CASE WHEN ${workItems.endDate} IS NOT NULL AND ${workItems.endDate} != '' AND ${workItems.endDate}::date < CURRENT_DATE THEN 0 ELSE 1 END`), asc(workItems.endDate))
          .limit(10),

        db.select({
          id: projectEngApprovals.id,
          status: projectEngApprovals.status,
          approverRole: projectEngApprovals.approverRole,
          approverUserId: projectEngApprovals.approverUserId,
          createdAt: projectEngApprovals.createdAt,
          stageName: engStageTemplates.name,
          projectName: projectInfo.projectName,
          projectId: projectInfo.id,
        })
          .from(projectEngApprovals)
          .innerJoin(projectEngStages, eq(projectEngApprovals.projectEngStageId, projectEngStages.id))
          .innerJoin(engStageTemplates, eq(projectEngStages.stageTemplateId, engStageTemplates.id))
          .innerJoin(projectInfo, eq(projectEngStages.projectId, projectInfo.id))
          .where(eq(projectEngApprovals.status, "pending")),

        db.select({
          id: qcItemInstance.id,
          qmStatus: qcItemInstance.qmStatus,
          itemName: qcTemplateItem.itemName,
          projectName: qcChecklist.projectName,
          projectId: qcChecklist.projectId,
          lastUpdatedAt: qcItemInstance.lastUpdatedAt,
        })
          .from(qcItemInstance)
          .innerJoin(qcChecklist, eq(qcItemInstance.checklistId, qcChecklist.id))
          .innerJoin(qcTemplateItem, eq(qcItemInstance.templateItemId, qcTemplateItem.id))
          .where(and(eq(qcItemInstance.qmStatus, "review"), eq(qcItemInstance.approved, false))),

        db.select({
          id: deliverables.id,
          title: deliverables.title,
          status: deliverables.status,
          projectName: deliverables.projectName,
          projectId: deliverables.projectId,
          deliverableType: deliverables.deliverableType,
          ownerUserId: deliverables.ownerUserId,
          reviewerUserId: deliverables.reviewerUserId,
          updatedAt: deliverables.updatedAt,
        })
          .from(deliverables)
          .where(and(
            sql`${deliverables.status} IN ('NEEDS APPROVAL', 'QC APPROVED', 'OPERATIONAL APPROVAL')`,
            isAdmin ? undefined : or(
              eq(deliverables.reviewerUserId, userId),
              eq(deliverables.ownerUserId, userId),
            ),
          ))
          .limit(20),

        db.execute(sql`
          SELECT pi.project_name, pi.pm, pi.id as project_id, pi.phase,
            pi.commissioning_date, pi.size_kwp
          FROM project_info pi
          WHERE pi.archived_status = 'ACTIVE'
            AND pi.pm_user_id IS NOT NULL
            AND (pi.pm_user_id = ${userId} OR ${isAdmin})
          ORDER BY pi.project_name
          LIMIT 50
        `),
      ]);

      const pendingTaskDeliverables = await db.select({
        id: taskDeliverables.id,
        taskId: taskDeliverables.workItemId,
        originalName: taskDeliverables.originalName,
        note: taskDeliverables.note,
        sentByUserId: taskDeliverables.sentByUserId,
        recipientUserId: taskDeliverables.recipientUserId,
        createdAt: taskDeliverables.createdAt,
        taskTitle: workItems.title,
        projectName: projectInfo.projectName,
        senderName: sql<string>`(SELECT name FROM users WHERE id = ${taskDeliverables.sentByUserId})`,
      })
        .from(taskDeliverables)
        .innerJoin(workItems, eq(taskDeliverables.workItemId, workItems.id))
        .leftJoin(projectInfo, eq(workItems.projectId, projectInfo.id))
        .where(and(
          eq(taskDeliverables.acknowledged, false),
          isAdmin
            ? undefined
            : or(
                eq(taskDeliverables.recipientUserId, userId),
                eq(taskDeliverables.sentByUserId, userId),
              ),
        ))
        .orderBy(desc(taskDeliverables.createdAt))
        .limit(20);

      const myPendingTaskDeliverables = pendingTaskDeliverables.filter((d: any) =>
        d.recipientUserId === userId
      );

      const myEngApprovals = engApprovals.filter((a: any) => {
        if (a.approverRole === "QA_REVIEW" || a.approverRole === "Quality Manager") {
          // Engineering PR 2: canonical role only. `quality_manager`
          // lowercase alias is not in COMPANY_ROLES.
          return normalizeRoleForPermissions(userRole) === "QUALITY_MANAGER";
        }
        if (isAdmin) return true;
        if (a.approverUserId && a.approverUserId === userId) return true;
        if (a.approverRole) {
          const allowed = APPROVAL_ROLE_MAP[a.approverRole];
          if (allowed && allowed.includes(userRole)) return true;
        }
        return false;
      });

      // Engineering PR 2: canonical role only.
      const myQcItems = normalizeRoleForPermissions(userRole) === "QUALITY_MANAGER" ? qcItems : [];

      const myDeliverables = deliverableItems;

      const pendingApprovals = [
        ...myEngApprovals.map((a: any) => ({
          id: `eng-${a.id}`,
          type: "engineering" as const,
          title: `${a.stageName} — ${a.approverRole}`,
          projectName: a.projectName,
          projectId: a.projectId,
          createdAt: a.createdAt,
        })),
        ...myQcItems.map((q: any) => ({
          id: `qc-${q.id}`,
          type: "quality" as const,
          title: q.itemName,
          projectName: q.projectName,
          projectId: q.projectId,
          createdAt: q.lastUpdatedAt,
        })),
        ...myDeliverables.map((d: any) => ({
          id: `del-${d.id}`,
          type: "deliverable" as const,
          title: `${d.title} (${d.deliverableType || 'Document'})`,
          projectName: d.projectName,
          projectId: d.projectId,
          createdAt: d.updatedAt,
        })),
        ...myPendingTaskDeliverables.map((d: any) => ({
          id: `td-${d.id}`,
          type: "task_deliverable" as const,
          title: `${d.originalName} — from ${d.senderName || 'Unknown'}`,
          projectName: d.projectName,
          projectId: null,
          createdAt: d.createdAt,
          taskId: d.taskId,
          taskTitle: d.taskTitle,
        })),
      ];

      const overdueTasks = myTasks.filter((t: { dueDate: string | null }) =>
        t.dueDate && t.dueDate !== '' && new Date(t.dueDate) < new Date()
      );

      res.json({
        unreadCount: 0,
        actionRequired: [],
        recentNotifications: [],
        myTasks: myTasks,
        overdueTaskCount: overdueTasks.length,
        pendingApprovals: pendingApprovals.slice(0, 10),
        approvalCounts: {
          engineering: myEngApprovals.length,
          quality: myQcItems.length,
          deliverable: myDeliverables.length,
          taskDeliverable: myPendingTaskDeliverables.length,
          total: pendingApprovals.length,
        },
        projectsAtRisk: (projectsAtRisk.rows as any[]).slice(0, 8),
        userRole,
        isAdmin,
      });
    } catch (err: any) {
      console.error("Home action hub error:", err);
      console.error("[Engineering] Error:", err);
      sendError(res, err);
    }
  });

}
