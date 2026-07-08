import { Express, NextFunction, Request, Response } from "express";
import { db } from "./db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { sanitizeFilename, allowedFileFilter } from "./lib/upload-security";
import {
  qcTemplate, qcTemplatePhase, qcTemplateGroup, qcTemplateItem,
  qcTemplateRiskQuestion, qcTemplatePostmortemMetric,
  qcChecklist, qcItemInstance, qcItemEvidence, qcRiskAnswer,
  qcPlanLink, qcWarning, qcWarningEvent,
  qcPostmortem, qcPostmortemMetricValue, qcPostmortemSummary,
  qcAccessChallenge, calendarHoliday,
  users, projectInfo, projectExecutionState,
} from "@shared/schema";
import { requirePermission } from "./permission-middleware";
import { requireRole as requireRoleCanonical } from "./middleware/requireRole";
import { ADMIN_ROLES, COMPANY_ROLES, normalizeRoleForPermissions } from "@shared/schema";
import { validateBody } from "./middleware/validateBody";
import { sendError, ApiError, notFound, badRequest } from "./lib/api-error";
import { logAuditFromReq } from "./audit-logger";
import { recordAudit } from "./api/v2/services/audit-service";
import { canOverride } from "@shared/permissions/authoriser-matrix";
import { evidenceOverrideRecords } from "@shared/schema";
import { buildQcEvidenceOverrideRecord } from "./lib/quality-evidence-override";
import { buildRiskAnswerUpdates } from "./lib/quality-risk-answer";
import { refreshProjectMetricsAsync } from "./services/dashboard-metrics";
import { getAllPMWorkItemsAsProjectPlan } from "./work-items-adapter";
import { getEffectiveUser, jwtAuth, requireAuth } from "./auth-context";
import { getAssignmentsForEntity, getAssignmentsForEntities, setEntityAssignment } from "./services/assignment-service";
import { getQualityHseScope, scopeAllowsProject, scopeAllowsProjectName, scopedProjectIdsArray, scopedProjectNamesArray } from "./services/quality-hse-scope";
import {
  computeQualityRiskSummary,
  evaluateQualityGovernanceItem,
  getQualityHandoverReasons,
  isHandoverQualityBlocked,
  isQualityStatusRequired,
  QUALITY_ITEM_STATUSES,
  isValidQmStatusTransition,
  getApprovalBlockReason,
  evaluateChecklistHandoverReadiness,
  computeQcProgress,
} from "@shared/quality-governance";
import { getProjectLinkedItems } from "./project-linking-service";
import { computePdPmSubmitBlockers, getProjectDevelopmentWorkspace } from "./services/project-development-workspace-service";
import { parseIntParam } from "./lib/req-params";
import { evaluateSafeFormula } from "@shared/lib/safe-formula";
import {
  countEvidencePerItem,
  findChecklistByProjectName,
  findFullHandoverRowForProject,
  findProjectWithExecutionState,
  listActiveWarningsForProject,
  listHandoverRowsForProjects,
  listProjectsWithExecutionState,
  mergeProjectRow as repoMergeProjectRow,
  type MergedProjectRow,
} from "./repositories/quality-repository";

// F30: post-mortem red-flag threshold. Below this the project is flagged as
// requiring a follow-up review. Lives here (vs hard-coded in the handler)
// so changes don't bury the rule deep in logic; full owner-configurable
// version waits on the template-config table.
const POSTMORTEM_RED_FLAG_THRESHOLD = 0.85;

const qmApprovalUploadsDir = path.join(process.cwd(), "uploads", "qm-approvals");
if (!fs.existsSync(qmApprovalUploadsDir)) fs.mkdirSync(qmApprovalUploadsDir, { recursive: true });
const qmApprovalUpload = multer({
  storage: multer.diskStorage({
    destination: qmApprovalUploadsDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: allowedFileFilter,
});

type AppUser = { id: number; email: string; name: string; role: string; };
type ProjectInfoRow = MergedProjectRow;
type QcChecklistRow = typeof qcChecklist.$inferSelect;
type QcItemInstanceRow = typeof qcItemInstance.$inferSelect;
type QcTemplateItemRow = typeof qcTemplateItem.$inferSelect;
type QcTemplateRiskQuestionRow = typeof qcTemplateRiskQuestion.$inferSelect;
type QcTemplateGroupRow = typeof qcTemplateGroup.$inferSelect;
type QcTemplatePhaseRow = typeof qcTemplatePhase.$inferSelect;
type QcItemEvidenceRow = typeof qcItemEvidence.$inferSelect;
type QcRiskAnswerRow = typeof schema.qcRiskAnswer.$inferSelect;
type QcWarningRow = typeof qcWarning.$inferSelect;
type QcPlanLinkRow = typeof schema.qcPlanLink.$inferSelect;

// M3: leftJoin row merge — delegates to the repository so the defensive
// null-handling lives in one place. See server/repositories/quality-repository.ts.
const mergeProjectRow = repoMergeProjectRow;

function getUser(req: Request): AppUser {
  return getEffectiveUser(req) as AppUser;
}

function getUserRole(req: Request): string {
  return getEffectiveUser(req)?.role || "";
}

function isAdminRole(role: string): boolean {
  const normalized = normalizeRoleForPermissions(role);
  return normalized != null && (ADMIN_ROLES as readonly string[]).includes(normalized);
}

function normalizeProjectName(projectName: string | null | undefined): string {
  return (projectName ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}


async function resolveProjectIdForItemInstance(itemInstanceId: number): Promise<number | null> {
  const rows = await db.execute(sql`
    SELECT c.project_id
    FROM qc_item_instance i
    JOIN qc_checklist c ON c.id = i.checklist_id
    WHERE i.id = ${itemInstanceId}
    LIMIT 1
  `);
  const value = rows.rows?.[0]?.project_id;
  return typeof value === "number" ? value : null;
}

type QualityDb = NodePgDatabase<typeof schema>;

/**
 * Backfill any item-instances / risk-answers that the checklist's template
 * gained after the checklist was created. Idempotent — inserts only the
 * missing rows. Task 0.6: this used to run as a side effect inside the
 * checklist GET (a read that wrote). It now lives here and runs from the
 * create/sync POST path only, so a `quality:view` GET performs no writes.
 */
async function backfillMissingChecklistRows(
  tx: QualityDb,
  checklistId: number,
  templateId: number,
): Promise<{ itemsAdded: number; riskAnswersAdded: number }> {
  const tplPhases = await tx
    .select({ id: qcTemplatePhase.id })
    .from(qcTemplatePhase)
    .where(eq(qcTemplatePhase.templateId, templateId));
  const tplPhaseIds = tplPhases.map((p: { id: number }) => p.id);
  const tplGroups = tplPhaseIds.length
    ? await tx.select({ id: qcTemplateGroup.id }).from(qcTemplateGroup).where(inArray(qcTemplateGroup.templatePhaseId, tplPhaseIds))
    : [];
  const tplGroupIds = tplGroups.map((g: { id: number }) => g.id);
  const tplItems = tplGroupIds.length
    ? await tx.select({ id: qcTemplateItem.id }).from(qcTemplateItem).where(inArray(qcTemplateItem.templateGroupId, tplGroupIds))
    : [];

  const existingItems = await tx
    .select({ templateItemId: qcItemInstance.templateItemId })
    .from(qcItemInstance)
    .where(eq(qcItemInstance.checklistId, checklistId));
  const existingItemIds = new Set(existingItems.map((i: { templateItemId: number }) => i.templateItemId));
  const missingTplItems = tplItems.filter((ti: { id: number }) => !existingItemIds.has(ti.id));
  if (missingTplItems.length > 0) {
    await tx.insert(qcItemInstance).values(
      missingTplItems.map((ti: { id: number }) => ({ checklistId, templateItemId: ti.id })),
    );
  }

  const tplRiskQs = tplPhaseIds.length
    ? await tx.select({ id: qcTemplateRiskQuestion.id }).from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.templatePhaseId, tplPhaseIds))
    : [];
  const existingRisks = await tx
    .select({ templateRiskQuestionId: qcRiskAnswer.templateRiskQuestionId })
    .from(qcRiskAnswer)
    .where(eq(qcRiskAnswer.checklistId, checklistId));
  const existingRiskIds = new Set(existingRisks.map((r: { templateRiskQuestionId: number }) => r.templateRiskQuestionId));
  const missingRiskQs = tplRiskQs.filter((rq: { id: number }) => !existingRiskIds.has(rq.id));
  if (missingRiskQs.length > 0) {
    await tx.insert(qcRiskAnswer).values(
      missingRiskQs.map((rq: { id: number }) => ({ checklistId, templateRiskQuestionId: rq.id })),
    );
  }

  return { itemsAdded: missingTplItems.length, riskAnswersAdded: missingRiskQs.length };
}

const requireAdminOrEpm = requireRoleCanonical([
  "COO_ADMIN",
  "CEO_ADMIN",
  "ENGINEERING_MANAGER",
]);

// Kept for the access-challenge POST endpoint only — that endpoint is, by
// design, QM-or-admin-only because it's the gate that QM users go through.
// Routes that act on quality items no longer use this gate (per registry).
const requireAdminOrQm = requireRoleCanonical([
  "COO_ADMIN",
  "CEO_ADMIN",
  "QUALITY_MANAGER",
]);

/**
 * Gate that QUALITY_MANAGER users must have passed the access-code challenge
 * (`/api/quality/access/verify`) before performing mutating quality actions.
 *
 * Admins (COO/CEO) bypass — they're already trusted at a higher level. Any
 * non-QM role passes straight through (the registry's `requirePermission`
 * gate runs separately and decides whether they're allowed at all).
 *
 * Front-end already polls `/api/quality/access/status` and shows the
 * challenge modal when `needsChallenge` is true. A direct API call that
 * bypasses the UI gets back `{ error: "qm_challenge_required" }`.
 */
function requireQmChallengePassed(req: Request, res: Response, next: NextFunction) {
  // R10: if no access code is configured, the challenge feature is OFF.
  // Without this guard a QM could never satisfy the gate (the verify endpoint
  // 503s when QM_ACCESS_CODE is unset), permanently locking QMs out of every
  // quality mutation. Feature-off ⇒ pass through.
  if (!process.env.QM_ACCESS_CODE) return next();
  const role = normalizeRoleForPermissions(getEffectiveUser(req)?.role || "");
  if (role && (ADMIN_ROLES as readonly string[]).includes(role)) return next();
  if (role !== "QUALITY_MANAGER") return next();
  const challenged = !!(req.session as any)?.qmChallengePassed;
  if (challenged) return next();
  return res.status(403).json({
    error: "qm_challenge_required",
    code: "QM_CHALLENGE_REQUIRED",
    message: "Quality Manager access code required before this action.",
  });
}

/**
 * Resolve the project_id for the project-name URL param, filtering
 * soft-deleted projects. Returns null if no live project matches.
 */
async function resolveProjectIdByName(projectName: string): Promise<number | null> {
  const [row] = await db
    .select({ id: projectInfo.id })
    .from(projectInfo)
    .where(and(
      sql`LOWER(TRIM(${projectInfo.projectName})) = LOWER(TRIM(${projectName}))`,
      isNull(projectInfo.deletedAt),
    ))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Assert that `itemInstanceId` belongs to the project named in the URL AND
 * that the caller's quality/HSE scope includes that project. Sends a 403/404
 * and returns false on any mismatch; returns true when both checks pass.
 */
async function assertItemBelongsToProject(
  req: Request,
  res: Response,
  itemInstanceId: number,
  urlProjectName: string,
): Promise<boolean> {
  const itemProjectId = await resolveProjectIdForItemInstance(itemInstanceId);
  if (itemProjectId == null) {
    res.status(404).json({ error: "item_not_found" });
    return false;
  }
  const urlProjectId = await resolveProjectIdByName(urlProjectName);
  if (urlProjectId == null) {
    res.status(404).json({ error: "project_not_found" });
    return false;
  }
  if (urlProjectId !== itemProjectId) {
    res.status(403).json({
      error: "project_scope_mismatch",
      message: "Item does not belong to the project named in the URL.",
    });
    return false;
  }
  // R1: scoped roles only act on quality items for assigned projects.
  const scope = await getQualityHseScope(req);
  if (!scopeAllowsProject(scope, urlProjectId)) {
    res.status(404).json({ error: "item_not_found" });
    return false;
  }
  return true;
}

/**
 * Convenience: assert the caller's scope includes the URL :projectName. Used
 * by per-project endpoints that don't go through a specific item id.
 */
async function assertProjectAccessByName(
  req: Request,
  res: Response,
  urlProjectName: string,
): Promise<boolean> {
  const scope = await getQualityHseScope(req);
  if (!scopeAllowsProjectName(scope, urlProjectName)) {
    res.status(404).json({ error: "project_not_found" });
    return false;
  }
  return true;
}

/**
 * Constant-time string compare for access-code verification. Returns false
 * if either side is empty or the lengths differ (which would short-circuit
 * timingSafeEqual to a non-constant path).
 */
function safeCompareCode(input: string, expected: string): boolean {
  if (!input || !expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Plan v3 § T3-4: the original notifications feature was removed but the
// QM dashboard still needs to know "what would we have alerted about?"
// This shim records the intended notification to audit_events under a
// SYSTEM source so a future notification system can replay, and so an
// auditor can answer "did the warning engine notify the right person?"
// Returns null because no real notification is dispatched today.
async function createQmNotification(
  recipientUserId: number,
  eventType: string,
  title: string,
  body: string | null,
  opts: { projectName?: string; linkedTaskId?: number } = {},
) {
  try {
    await recordAudit({
      actorRole: "SYSTEM",
      userId: recipientUserId,
      entityType: "qm_notification",
      entityId: String(recipientUserId),
      action: `NOTIFY_${eventType.toUpperCase()}`,
      projectName: opts.projectName,
      changesJson: { title, body, linkedTaskId: opts.linkedTaskId ?? null },
    });
  } catch {
    // Don't fail the calling flow if audit insertion fails — this shim is
    // observability, not correctness-critical.
  }
  return null;
}

/**
 * F29: count business days inclusive between two YYYY-MM-DD strings,
 * skipping Saturdays, Sundays, and holidays. Uses UTC throughout so the
 * result doesn't shift when the server's local timezone moves around
 * (e.g. SAST vs UTC at the day boundary).
 */
function businessDaysBetween(startStr: string, endStr: string, holidays: string[]): number {
  if (typeof startStr !== "string" || typeof endStr !== "string") return 0;
  // Pin to start-of-day UTC so .getUTCDay() etc. don't pick up local-time offsets.
  const start = new Date(`${startStr.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${endStr.slice(0, 10)}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const holSet = new Set(holidays);
  let count = 0;
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    const day = cur.getUTCDay();
    const dateStr = cur.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !holSet.has(dateStr)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

function uniqueNumberList(values: Array<number | null | undefined>): number[] {
  const result = new Set<number>();
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result.add(value);
    }
  }
  return Array.from(result);
}

// `fetchProjectHandoverRows` moved to server/repositories/quality-repository.ts
// (`listHandoverRowsForProjects`). Import + call there.

function normalizeHandoverRow(row: any) {
  if (!row) return null;
  const deliverables =
    typeof row.deliverables === "string"
      ? (() => {
          try {
            return JSON.parse(row.deliverables);
          } catch {
            return {};
          }
        })()
      : (row.deliverables || {});

  return {
    ...row,
    deliverables,
  };
}

async function loadProjectQualityGovernanceContext(projectName: string, userId: number) {
  const rawRows = await db.select().from(projectInfo)
    .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
    .where(eq(projectInfo.projectName, projectName));
  // Prompt 0.8 + M3: see mergeProjectRow helper — defends against both null
  // execution-state rows AND a future schema where project_info itself may
  // be on the right-hand side of a leftJoin.
  const projectRows = rawRows.map(mergeProjectRow).filter((p: ProjectInfoRow | null): p is ProjectInfoRow => p != null);
  const [project] = projectRows;
  const checklistRows: QcChecklistRow[] = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, projectName));
  const [checklist] = checklistRows;
  const warnings = await db.select().from(qcWarning)
    .where(and(eq(qcWarning.projectName, projectName), sql`${qcWarning.status} != 'resolved'`))
    .orderBy(desc(qcWarning.createdAt));

  if (!project || !checklist) {
    return {
      project: project || null,
      checklist: checklist || null,
      warnings,
      phaseSummaries: [] as any[],
      governanceItems: [] as any[],
      riskAnswers: [] as any[],
      riskSummary: computeQualityRiskSummary({ items: [], warnings }),
      handover: {
        status: "DRAFT",
        rejectionReason: null,
        qualityStatus: null,
        qualityRequired: false,
        readinessStatus: null,
        executionEnabled: project?.executionEnabled ?? false,
        executionGateStatus: project?.executionGateStatus ?? "NOT_ELIGIBLE",
        blockers: [] as string[],
        blocked: false,
      },
      relevantMicrosoftItems: [] as any[],
      focusItems: [] as any[],
    };
  }

  const itemInstances: QcItemInstanceRow[] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));

  const templateItemIds = uniqueNumberList(itemInstances.map((item) => item.templateItemId));
  const templateItems: QcTemplateItemRow[] = templateItemIds.length > 0
    ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
    : [];
  const templateItemMap = new Map<number, QcTemplateItemRow>(templateItems.map((item) => [item.id, item]));

  const groupIds = uniqueNumberList(templateItems.map((item) => item.templateGroupId));
  const groups: QcTemplateGroupRow[] = groupIds.length > 0
    ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, groupIds))
    : [];
  const groupMap = new Map<number, QcTemplateGroupRow>(groups.map((group) => [group.id, group]));

  const phaseIds = uniqueNumberList(groups.map((group) => group.templatePhaseId));
  const phases: QcTemplatePhaseRow[] = phaseIds.length > 0
    ? await db.select().from(qcTemplatePhase).where(inArray(qcTemplatePhase.id, phaseIds))
    : [];
  const phaseMap = new Map<number, QcTemplatePhaseRow>(phases.map((phase) => [phase.id, phase]));

  const evidence: QcItemEvidenceRow[] = itemInstances.length > 0
    ? await db.select().from(qcItemEvidence).where(and(inArray(qcItemEvidence.itemInstanceId, itemInstances.map((item) => item.id)), isNull(qcItemEvidence.deletedAt)))
    : [];
  const riskAnswers = await db.select().from(qcRiskAnswer).where(eq(qcRiskAnswer.checklistId, checklist.id));
  const templateRiskQuestionIds = uniqueNumberList(riskAnswers.map((answer: QcRiskAnswerRow) => answer.templateRiskQuestionId));
  const riskQuestions: QcTemplateRiskQuestionRow[] = templateRiskQuestionIds.length > 0
    ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.id, templateRiskQuestionIds))
    : [];
  const riskQuestionMap = new Map<number, QcTemplateRiskQuestionRow>(riskQuestions.map((question) => [question.id, question]));
  const evidenceCountMap = new Map<number, number>();
  for (const item of evidence) {
    evidenceCountMap.set(item.itemInstanceId, (evidenceCountMap.get(item.itemInstanceId) || 0) + 1);
  }

  const assigneeUserIds = [...new Set(
    itemInstances
      .map((item) => item.assigneeUserId)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  )];
  const assigneeRows = assigneeUserIds.length > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, assigneeUserIds))
    : [];
  const assigneeMap = new Map(assigneeRows.map((row: any) => [row.id, row.name]));

  const governanceItems = itemInstances.map((instance) => {
    const templateItem = templateItemMap.get(instance.templateItemId);
    const group = templateItem ? groupMap.get(templateItem.templateGroupId) : null;
    const phase = group ? phaseMap.get(group.templatePhaseId) : null;
    const evidenceCount = evidenceCountMap.get(instance.id) || 0;
    const evaluation = evaluateQualityGovernanceItem({
      qmStatus: instance.qmStatus,
      approved: instance.approved,
      isApplicable: instance.isApplicable,
      endDate: instance.endDate,
      scheduledDate: instance.scheduledDate,
      approvalComment: instance.approvalComment,
      isEvidenceRequired: templateItem?.isEvidenceRequired ?? false,
      evidenceCount,
    });

    return {
      ...instance,
      itemName: templateItem?.itemName || "Unknown",
      isEvidenceRequired: templateItem?.isEvidenceRequired ?? false,
      defaultSeverity: templateItem?.defaultSeverity || "Medium",
      groupId: group?.id || null,
      groupName: group?.groupName || "Unknown",
      phaseId: phase?.id || null,
      phaseName: phase?.phaseName || "Unknown",
      evidenceCount,
      assigneeName: instance.assigneeUserId ? (assigneeMap.get(instance.assigneeUserId) || null) : null,
      ...evaluation,
    };
  });

  const phaseSummaries = phases.map((phase) => {
    const phaseItems = governanceItems.filter((item) => item.phaseId === phase.id);
    const progress = computeQcProgress(phaseItems);
    return {
      phaseId: phase.id,
      phaseKey: phase.phaseKey,
      phaseName: phase.phaseName,
      totalItems: phaseItems.length,
      applicableItems: progress.totalApplicable,
      approvedItems: progress.totalApproved,
      progressPercent: progress.progressPercent,
    };
  });

  const handoverRow = await findFullHandoverRowForProject(project.id);
  const handover = normalizeHandoverRow(handoverRow) || { deliverables: {} };

  const workspace = await getProjectDevelopmentWorkspace({
    projectId: project.id,
    projectName: project.projectName,
    canonicalProjectId: project.canonicalProjectId,
    clientId: project.clientId,
    phase: project.phase,
    executionGateStatus: project.executionGateStatus,
    executionEnabled: project.executionEnabled,
    handover,
  });

  const handoverBlockers = computePdPmSubmitBlockers({
    project,
    handover,
    workspace,
  });

  const handoverSummaryInput = {
    blockers: handoverBlockers,
    engineeringStatus: handover.engineering_status,
    qualityRequired: workspace.downstream.quality.qualityRequired,
    qualityStatus: workspace.downstream.quality.qualityStatus || handover.quality_status || null,
    handoverStatus: handover.status || "DRAFT",
    rejectionReason: handover.rejection_reason || null,
    executionEnabled: project.executionEnabled,
    executionGateStatus: project.executionGateStatus,
  };

  const relevantMicrosoftItems = (await getProjectLinkedItems(project.id, userId))
    .filter((item: any) => Boolean(item?.qualityContext?.itemInstanceId));

  const enrichedRiskAnswers = riskAnswers.map((answer: QcRiskAnswerRow) => {
    const question = riskQuestionMap.get(answer.templateRiskQuestionId);
    return {
      responseType: question?.responseType ?? "yesno",
      triggersWarning: question?.triggersWarning ?? false,
      triggerCondition: question?.triggerCondition ?? null,
      triggerSeverity: question?.triggerSeverity ?? null,
      answerYesno: answer.answerYesno,
      answerText: answer.answerText,
      answerNumber: answer.answerNumber,
    };
  });

  const riskSummary = computeQualityRiskSummary({
    items: governanceItems,
    riskAnswers: enrichedRiskAnswers,
    warnings,
    handover: handoverSummaryInput,
    linkedMicrosoftCount: relevantMicrosoftItems.length,
  });

  const focusItems = [...governanceItems]
    .filter((item) =>
      item.overdue ||
      item.evidenceMissing ||
      item.resubmissionNeeded ||
      item.approvalState === "pending_review",
    )
    .sort((left, right) => {
      const leftRank =
        (left.resubmissionNeeded ? 400 : 0) +
        (left.overdue ? 300 : 0) +
        (left.evidenceMissing ? 200 : 0) +
        (left.approvalState === "pending_review" ? 100 : 0) +
        Number(left.daysOverdue || 0);
      const rightRank =
        (right.resubmissionNeeded ? 400 : 0) +
        (right.overdue ? 300 : 0) +
        (right.evidenceMissing ? 200 : 0) +
        (right.approvalState === "pending_review" ? 100 : 0) +
        Number(right.daysOverdue || 0);
      return rightRank - leftRank;
    })
    .slice(0, 8);

  return {
    project,
    checklist,
    warnings,
    phaseSummaries,
    governanceItems,
    riskAnswers: enrichedRiskAnswers,
    riskSummary,
    handover: {
      status: handover.status || "DRAFT",
      rejectionReason: handover.rejection_reason || null,
      qualityStatus: handoverSummaryInput.qualityStatus,
      qualityRequired: handoverSummaryInput.qualityRequired,
      readinessStatus: workspace.readiness.readinessStatus || handover.handoverReadinessStatus || handover.handover_readiness_status || null,
      executionEnabled: project.executionEnabled,
      executionGateStatus: project.executionGateStatus,
      blockers: getQualityHandoverReasons(handoverSummaryInput),
      blocked: isHandoverQualityBlocked(handoverSummaryInput),
    },
    relevantMicrosoftItems,
    focusItems,
  };
}

// ============================================================================
// M4 — Zod body schemas for every mutating endpoint. Each is `.strict()` so
// unknown keys are rejected (forces typos to surface in dev instead of being
// silently ignored). Keep these grouped here for discoverability.
// ============================================================================

const accessVerifySchema = z.object({
  code: z.string().min(1, "code required"),
}).strict();

const updateItemSchema = z.object({
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  isApplicable: z.boolean().optional(),
  notApplicableReason: z.string().nullable().optional(),
  approvalComment: z.string().nullable().optional(),
  allowedWorkingDays: z.number().int().min(0).max(365).optional(),
  qmStatus: z.string().optional(),
  assigneeUserId: z.union([z.number().int(), z.string(), z.null()]).optional(),
  assigneeType: z.string().nullable().optional(),
  assigneeId: z.union([z.number().int(), z.string(), z.null()]).optional(),
  override_reason: z.string().optional(),
}).strict();

const approveItemSchema = z.object({
  approved: z.boolean(),
  comment: z.string().nullable().optional(),
  override_reason: z.string().optional(),
}).strict();

const addEvidenceSchema = z.object({
  evidenceUrl: z.string().trim().min(1, "evidenceUrl required").max(2048),
  evidenceNote: z.string().nullable().optional(),
}).strict();

// send-for-approval is multipart/form-data, so multer parses the file and
// the body fields come through as strings. Coerce + validate.
const sendForApprovalSchema = z.object({
  approverUserId: z.coerce.number().int().positive(),
  note: z.string().optional(),
}).passthrough(); // multer's req.body may have other multipart fields

const createItemSchema = z.object({
  itemName: z.string().trim().min(1, "itemName required").max(255),
  groupId: z.number().int().positive().optional(),
}).strict();

const riskAnswerSchema = z.object({
  // Task 1.4: either target an existing answer row by id, OR upsert by
  // (checklistId, templateRiskQuestionId) so a question that has no seeded
  // answer row can still be answered from the UI.
  riskAnswerId: z.number().int().positive().optional(),
  checklistId: z.number().int().positive().optional(),
  templateRiskQuestionId: z.number().int().positive().optional(),
  answerYesno: z.boolean().nullable().optional(),
  answerText: z.string().nullable().optional(),
  answerNumber: z.number().nullable().optional(),
  answerValue: z.enum(["yes", "no"]).optional(),
  notes: z.string().nullable().optional(),
}).strict().refine(
  (data) => data.riskAnswerId != null || (data.checklistId != null && data.templateRiskQuestionId != null),
  { message: "Provide riskAnswerId, or both checklistId and templateRiskQuestionId" },
);

const warningEventSchema = z.object({
  note: z.string().nullable().optional(),
}).strict();

const planLinkSchema = z.object({
  planItemId: z.union([z.number().int(), z.string()]),
  itemInstanceId: z.number().int().positive().nullable().optional(),
  phaseId: z.number().int().positive().nullable().optional(),
  linkType: z.string().optional(),
}).strict().refine(
  (data) => data.itemInstanceId != null || data.phaseId != null,
  { message: "Either phaseId or itemInstanceId is required" },
);

const postmortemSchema = z.object({
  metricInputs: z.array(z.object({
    templateMetricId: z.number().int().positive(),
    inputValueNumber: z.number().nullable().optional(),
    inputValueChoice: z.string().nullable().optional(),
  })).default([]),
}).strict();

const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  name: z.string().trim().min(1).max(255),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
}).strict();

const updateRoleSchema = z.object({
  role: z.enum(COMPANY_ROLES),
}).strict();

const bulkCreateChecklistsSchema = z.object({
  projectNames: z.array(z.string().trim().min(1)).min(1).max(500),
}).strict();

const recalculateWarningsSchema = z.object({}).strict();

export function registerQualityRoutes(app: Express) {

  app.use("/api/quality", jwtAuth);
  app.use("/api/engineering", jwtAuth);

  // ========== QM ACCESS CHALLENGE ==========

  app.post("/api/quality/access/verify", requireAuth, requireAdminOrQm, validateBody(accessVerifySchema), async (req, res) => {
    try {
      const { code } = req.body;
      const userId = getUser(req).id;
      const role = getUser(req).role;
      const expectedCode = process.env.QM_ACCESS_CODE;

      if (!expectedCode) {
        return res.status(503).json({ error: "QM_ACCESS_CODE not configured. Contact admin." });
      }

      // Lockout is keyed on userId only — keying on (userId, role) would let
      // an attacker with multiple lens roles get N×5 attempts.
      let [challenge] = await db.select().from(qcAccessChallenge)
        .where(eq(qcAccessChallenge.userId, userId));

      if (!challenge) {
        [challenge] = await db.insert(qcAccessChallenge).values({
          userId, role, failedAttemptsCount: 0,
        }).returning();
      }

      if (challenge.lockedUntil && new Date(challenge.lockedUntil) > new Date()) {
        const remaining = Math.ceil((new Date(challenge.lockedUntil).getTime() - Date.now()) / 60000);
        return res.status(429).json({ error: `Account locked. Try again in ${remaining} minutes.`, locked: true });
      }

      if (safeCompareCode(String(code), expectedCode)) {
        await db.update(qcAccessChallenge)
          .set({ lastSuccessAt: new Date(), failedAttemptsCount: 0, lockedUntil: null, updatedAt: new Date() })
          .where(eq(qcAccessChallenge.id, challenge.id));
        (req.session as any).qmChallengePassed = true;
        return res.json({ success: true });
      }

      const newCount = (challenge.failedAttemptsCount || 0) + 1;
      const updates: any = { failedAttemptsCount: newCount, updatedAt: new Date() };
      if (newCount >= 5) {
        updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await db.update(qcAccessChallenge).set(updates).where(eq(qcAccessChallenge.id, challenge.id));

      if (newCount >= 5) {
        return res.status(429).json({ error: "Too many failed attempts. Locked for 15 minutes.", locked: true });
      }
      return res.status(401).json({ error: "Invalid access code", attemptsRemaining: 5 - newCount });
    } catch (err) {
      sendError(res, err);
    }
  });

  // H5 follow-up: per-user session probe. `requireAuth` is sufficient because
  // the response is scoped to the caller's own session — `challenged` /
  // `needsChallenge` / `role` are all values the caller already knows. The
  // `hasCode` boolean reveals whether QM_ACCESS_CODE is configured, but the
  // UI needs that to gracefully degrade if the gate is disabled.
  app.get("/api/quality/access/status", requireAuth, async (req, res) => {
    try {
      const hasCode = !!process.env.QM_ACCESS_CODE;
      const challenged = !!(req.session as any)?.qmChallengePassed;
      const userRole = getUserRole(req);
      const needsChallenge = (normalizeRoleForPermissions(userRole) === "QUALITY_MANAGER") && !challenged;
      res.json({ hasCode, challenged, needsChallenge, role: userRole });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== EPM ACCESS CHALLENGE ==========

  app.post("/api/engineering/access/verify", requireAuth, requireAdminOrEpm, validateBody(accessVerifySchema), async (req, res) => {
    try {
      const { code } = req.body;
      const userId = getUser(req).id;
      const role = "eng_program_manager";
      const expectedCode = process.env.EPM_ACCESS_CODE;

      if (!expectedCode) {
        return res.status(503).json({ error: "EPM_ACCESS_CODE not configured. Contact admin." });
      }

      // Lockout keyed on userId only (see QM endpoint comment).
      let [challenge] = await db.select().from(qcAccessChallenge)
        .where(and(eq(qcAccessChallenge.userId, userId), eq(qcAccessChallenge.role, role)));

      if (!challenge) {
        [challenge] = await db.insert(qcAccessChallenge).values({
          userId, role, failedAttemptsCount: 0,
        }).returning();
      }

      if (challenge.lockedUntil && new Date(challenge.lockedUntil) > new Date()) {
        const remaining = Math.ceil((new Date(challenge.lockedUntil).getTime() - Date.now()) / 60000);
        return res.status(429).json({ error: `Account locked. Try again in ${remaining} minutes.`, locked: true });
      }

      if (safeCompareCode(String(code), expectedCode)) {
        await db.update(qcAccessChallenge)
          .set({ lastSuccessAt: new Date(), failedAttemptsCount: 0, lockedUntil: null, updatedAt: new Date() })
          .where(eq(qcAccessChallenge.id, challenge.id));
        (req.session as any).epmChallengePassed = true;
        return res.json({ success: true });
      }

      const newCount = (challenge.failedAttemptsCount || 0) + 1;
      const updates: any = { failedAttemptsCount: newCount, updatedAt: new Date() };
      if (newCount >= 5) {
        updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await db.update(qcAccessChallenge).set(updates).where(eq(qcAccessChallenge.id, challenge.id));

      if (newCount >= 5) {
        return res.status(429).json({ error: "Too many failed attempts. Locked for 15 minutes.", locked: true });
      }
      return res.status(401).json({ error: "Invalid access code", attemptsRemaining: 5 - newCount });
    } catch (err) {
      sendError(res, err);
    }
  });

  // H5 follow-up: same per-user scoping as /api/quality/access/status above.
  app.get("/api/engineering/access/status", requireAuth, async (req, res) => {
    try {
      const hasCode = !!process.env.EPM_ACCESS_CODE;
      const challenged = !!(req.session as any)?.epmChallengePassed;
      const userRole = getUserRole(req);
      const needsChallenge = (normalizeRoleForPermissions(userRole) === "ENGINEERING_MANAGER") && !challenged;
      res.json({ hasCode, challenged, needsChallenge, role: userRole });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== TEMPLATES (admin read) ==========

  app.get("/api/quality/templates", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const templates = await db.select().from(qcTemplate);
      res.json(templates);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/quality/templates/:templateId", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const tid = parseIntParam(req.params.templateId);
      const [tmpl] = await db.select().from(qcTemplate).where(eq(qcTemplate.id, tid));
      if (!tmpl) return res.status(404).json({ error: "Template not found" });

      const phases = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, tid));
      const phaseIds = phases.map((p: QcTemplatePhaseRow) => p.id);

      const groups = phaseIds.length ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.templatePhaseId, phaseIds)) : [];
      const groupIds = groups.map((g: QcTemplateGroupRow) => g.id);
      const items = groupIds.length ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.templateGroupId, groupIds)) : [];
      const riskQuestions = phaseIds.length ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.templatePhaseId, phaseIds)) : [];
      const metrics = await db.select().from(qcTemplatePostmortemMetric);

      res.json({ template: tmpl, phases, groups, items, riskQuestions, metrics });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== PROJECT CHECKLIST ==========

  app.get("/api/quality/project/:projectName/checklist", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const requestedProjectName = decodeURIComponent(String(req.params.projectName));
      // R1: scoped roles only see their assigned projects' checklists.
      if (!(await assertProjectAccessByName(req, res, requestedProjectName))) return;
      // F16: filter soft-deleted projects out of the lookup so we don't
      // accidentally surface (or create against) a project that's been
      // removed from the company workspace.
      const [project] = await db
        .select({ id: projectInfo.id, projectName: projectInfo.projectName })
        .from(projectInfo)
        .where(and(
          sql`LOWER(TRIM(${projectInfo.projectName})) = LOWER(TRIM(${requestedProjectName}))`,
          isNull(projectInfo.deletedAt),
        ))
        .limit(1);
      const projectId = project?.id ?? null;
      const canonicalProjectName = project?.projectName ?? requestedProjectName;
      const normalizedProjectName = normalizeProjectName(canonicalProjectName);

      const matchingChecklists = projectId
        ? await db.select().from(qcChecklist).where(eq(qcChecklist.projectId, projectId))
        : await db.select().from(qcChecklist)
            .where(sql`LOWER(TRIM(${qcChecklist.projectName})) = ${normalizedProjectName}`);
      let checklist = matchingChecklists
        .sort((left: any, right: any) => right.id - left.id)[0];

      // F7: GET no longer auto-creates. If the project has no checklist
      // yet, return an empty payload — the front end shows a "Create
      // Checklist" button that POSTs to /api/quality/project/:projectName/checklist
      // (gated by quality.create).
      if (!checklist) {
        return res.json({
          checklist: null,
          phases: [],
          groups: [],
          templateItems: [],
          itemInstances: [],
          riskQuestions: [],
          riskAnswers: [],
          evidence: [],
        });
      }

      // Task 0.6: this GET is read-only. Backfill of item-instances /
      // risk-answers that a template gained after checklist creation now runs
      // in the create/sync POST path (backfillMissingChecklistRows), so a
      // `quality:view` GET performs no inserts.
      const itemInstances = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));
      const riskAnswers = await db.select().from(qcRiskAnswer).where(eq(qcRiskAnswer.checklistId, checklist.id));

      const itemIds = itemInstances.map((i: any) => i.id);
      const evidence = itemIds.length ? await db.select().from(qcItemEvidence).where(and(inArray(qcItemEvidence.itemInstanceId, itemIds), isNull(qcItemEvidence.deletedAt))) : [];
      const assignmentMap = await getAssignmentsForEntities("quality_item", itemIds, "ASSIGNEE");

      const templateId = checklist.templateId;
      const phases = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, templateId));
      const phaseIds = phases.map((p: QcTemplatePhaseRow) => p.id);
      const groups = phaseIds.length ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.templatePhaseId, phaseIds)) : [];
      const groupIds = groups.map((g: QcTemplateGroupRow) => g.id);
      const templateItems = groupIds.length ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.templateGroupId, groupIds)) : [];
      const riskQuestions = phaseIds.length ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.templatePhaseId, phaseIds)) : [];

      res.json({
        created: false,
        checklist,
        phases,
        groups,
        templateItems,
        itemInstances: itemInstances.map((item: QcItemInstanceRow) => {
          const assignments = assignmentMap.get(item.id) || [];
          const primaryAssignment = assignments[0] || null;
          return {
            ...item,
            assignments,
            primaryAssignment,
            assigneeDisplayLabel: primaryAssignment?.displayLabel || null,
            assigneeDisplayType: primaryAssignment?.assigneeType || null,
          };
        }),
        riskQuestions,
        riskAnswers,
        evidence,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // F7: Explicit checklist creation. Replaces the side-effect-on-GET
  // behaviour. Gated by `quality.create` so non-creators (PMS, PD, etc.)
  // can't accidentally bring a checklist into existence by opening the
  // Quality page. Idempotent — returns the existing checklist if one is
  // already there.
  app.post(
    "/api/quality/project/:projectName/checklist",
    requireAuth,
    requireQmChallengePassed,
    requirePermission("quality", "edit"),
    async (req, res) => {
      try {
        const requestedProjectName = decodeURIComponent(String(req.params.projectName));
        // R1: scoped roles only create checklists for their assigned projects.
        if (!(await assertProjectAccessByName(req, res, requestedProjectName))) return;
        const [project] = await db
          .select({ id: projectInfo.id, projectName: projectInfo.projectName })
          .from(projectInfo)
          .where(and(
            sql`LOWER(TRIM(${projectInfo.projectName})) = LOWER(TRIM(${requestedProjectName}))`,
            isNull(projectInfo.deletedAt),
          ))
          .limit(1);
        if (!project) return res.status(404).json({ error: "Project not found" });

        // R9: lock + check-existing + insert all run inside one transaction
        // guarded by a per-project advisory lock, so two concurrent
        // "create checklist" clicks can't both pass the existence check and
        // insert duplicate checklists. The lock auto-releases at tx end.
        const outcome = await db.transaction(async (tx: NodePgDatabase<typeof schema>) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`qc_checklist:${project.id}`}))`);

          const existing = await tx.select().from(qcChecklist).where(eq(qcChecklist.projectId, project.id));
          if (existing.length > 0) {
            const checklist = existing.sort((l: any, r: any) => r.id - l.id)[0];
            // Task 0.6: sync-on-open. An existing checklist may predate template
            // items/risk-questions added later. Backfill the missing rows here
            // (inside the tx + advisory lock) instead of on GET, so opening the
            // Quality page never writes but "Start / open" heals a stale checklist.
            if (checklist.templateId) {
              await backfillMissingChecklistRows(tx, checklist.id, checklist.templateId);
            }
            return { created: false as const, checklist };
          }

          const [activeTemplate] = await tx.select().from(qcTemplate).where(eq(qcTemplate.isActive, true));
          if (!activeTemplate) {
            return { created: false as const, checklist: null, noTemplate: true as const };
          }

          const [checklist] = await tx.insert(qcChecklist).values({
            projectId: project.id,
            projectName: project.projectName,
            templateId: activeTemplate.id,
            status: "active",
          }).returning();

          const phases = await tx.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, activeTemplate.id));
          const phaseIds = phases.map((p: QcTemplatePhaseRow) => p.id);
          const groups = phaseIds.length
            ? await tx.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.templatePhaseId, phaseIds))
            : [];
          const groupIds = groups.map((g: QcTemplateGroupRow) => g.id);
          const templateItems = groupIds.length
            ? await tx.select().from(qcTemplateItem).where(inArray(qcTemplateItem.templateGroupId, groupIds))
            : [];
          if (templateItems.length) {
            await tx.insert(qcItemInstance).values(
              templateItems.map((ti: QcTemplateItemRow) => ({ checklistId: checklist.id, templateItemId: ti.id })),
            );
          }
          const riskQuestions = phaseIds.length
            ? await tx.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.templatePhaseId, phaseIds))
            : [];
          if (riskQuestions.length) {
            await tx.insert(qcRiskAnswer).values(
              riskQuestions.map((rq: QcTemplateRiskQuestionRow) => ({ checklistId: checklist.id, templateRiskQuestionId: rq.id })),
            );
          }
          return { created: true as const, checklist, templateId: activeTemplate.id };
        });

        if ("noTemplate" in outcome && outcome.noTemplate) {
          return res.status(409).json({
            error: "no_active_template",
            message: "No active quality template is configured. Contact admin.",
          });
        }

        if (!outcome.created) {
          return res.status(200).json({ created: false, checklist: outcome.checklist });
        }

        logAuditFromReq(req, {
          entityType: "quality_checklist",
          entityId: String(outcome.checklist.id),
          action: "create",
          projectName: project.projectName,
          changesJson: { description: "Quality checklist created", templateId: outcome.templateId },
        });

        res.status(201).json({ created: true, checklist: outcome.checklist });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // Hard-delete a project's quality process so the PM can restart from scratch.
  // Removes evidence, plan links, warnings, post-mortem, then the checklist
  // (which cascades to item instances + risk answers). Atomic via transaction.
  app.delete(
    "/api/quality/project/:projectName/checklist",
    requireAuth,
    requireQmChallengePassed,
    requirePermission("quality", "edit"),
    async (req, res) => {
      try {
        // Guard against a malformed `%XX` in the param (would otherwise 500).
        const rawProjectName = String(req.params.projectName);
        let requestedProjectName: string;
        try {
          requestedProjectName = decodeURIComponent(rawProjectName);
        } catch {
          requestedProjectName = rawProjectName;
        }

        // Resolve the live (non-deleted) project_info row. Determinism comes
        // from the partial unique index on (project_name) WHERE deleted_at IS NULL.
        const [project] = await db
          .select({ id: projectInfo.id, projectName: projectInfo.projectName })
          .from(projectInfo)
          .where(and(
            sql`LOWER(TRIM(${projectInfo.projectName})) = LOWER(TRIM(${requestedProjectName}))`,
            isNull(projectInfo.deletedAt),
          ))
          .limit(1);
        const projectId = project?.id ?? null;
        const canonicalProjectName = project?.projectName ?? requestedProjectName;
        const normalizedProjectName = normalizeProjectName(canonicalProjectName);

        // qc_checklist.project_id is NOT NULL → no live project means no checklist.
        if (projectId === null) {
          return res.status(404).json({ error: "No quality checklist found for this project" });
        }
        const checklistScope = eq(qcChecklist.projectId, projectId);

        // Dependent tables have nullable project_id; include legacy NULL-projectId
        // name matches so un-backfilled rows are cleaned up too. The NULL guard
        // prevents reaching into rows owned by another project_info row.
        const planLinkScope = sql`(${qcPlanLink.projectId} = ${projectId} OR (${qcPlanLink.projectId} IS NULL AND LOWER(TRIM(${qcPlanLink.projectName})) = ${normalizedProjectName}))`;
        const warningScope = sql`(${qcWarning.projectId} = ${projectId} OR (${qcWarning.projectId} IS NULL AND LOWER(TRIM(${qcWarning.projectName})) = ${normalizedProjectName}))`;
        const postmortemScope = sql`(${qcPostmortem.projectId} = ${projectId} OR (${qcPostmortem.projectId} IS NULL AND LOWER(TRIM(${qcPostmortem.projectName})) = ${normalizedProjectName}))`;

        // Discover + delete inside the same transaction so concurrent inserts
        // between a read and a delete can't slip through. `null` → 404.
        const result = await db.transaction(async (tx: NodePgDatabase<typeof schema>) => {
          const matchingChecklists = await tx
            .select({ id: qcChecklist.id })
            .from(qcChecklist)
            .where(checklistScope);

          if (matchingChecklists.length === 0) {
            return null;
          }

          const checklistIds: number[] = (matchingChecklists as Array<{ id: number }>).map((c) => c.id);

          const itemInstanceRows = await tx
            .select({ id: qcItemInstance.id })
            .from(qcItemInstance)
            .where(inArray(qcItemInstance.checklistId, checklistIds));
          const itemInstanceIds: number[] = (itemInstanceRows as Array<{ id: number }>).map((i) => i.id);

          // Snapshot cascade-child IDs before deleting the parents so audit
          // counts include rows wiped by FK CASCADE (warning_event,
          // risk_answer, postmortem_summary, postmortem_metric_value).
          const warningRowsToDelete = await tx
            .select({ id: qcWarning.id })
            .from(qcWarning)
            .where(warningScope);
          const warningIds: number[] = (warningRowsToDelete as Array<{ id: number }>).map((w) => w.id);

          const postmortemRowsToDelete = await tx
            .select({ id: qcPostmortem.id })
            .from(qcPostmortem)
            .where(postmortemScope);
          const postmortemIds: number[] = (postmortemRowsToDelete as Array<{ id: number }>).map((p) => p.id);

          // Use Drizzle's `inArray` helper for the count predicates: passing a
          // JS array straight into `sql\`= ANY(${ids})\`` interpolates as a
          // row constructor, which Postgres rejects with "op ANY/ALL requires
          // array on right side". `inArray` produces a parameterised IN list.
          const countWhere = async (
            table: typeof qcRiskAnswer | typeof qcWarningEvent | typeof qcPostmortemSummary | typeof qcPostmortemMetricValue,
            whereExpr: ReturnType<typeof inArray>,
          ): Promise<number> => {
            const rows = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(table)
              .where(whereExpr);
            return Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
          };

          const riskAnswerCount = checklistIds.length > 0
            ? await countWhere(qcRiskAnswer, inArray(qcRiskAnswer.checklistId, checklistIds))
            : 0;
          const warningEventCount = warningIds.length > 0
            ? await countWhere(qcWarningEvent, inArray(qcWarningEvent.warningId, warningIds))
            : 0;
          const postmortemSummaryCount = postmortemIds.length > 0
            ? await countWhere(qcPostmortemSummary, inArray(qcPostmortemSummary.postmortemId, postmortemIds))
            : 0;
          const postmortemMetricValueCount = postmortemIds.length > 0
            ? await countWhere(qcPostmortemMetricValue, inArray(qcPostmortemMetricValue.postmortemId, postmortemIds))
            : 0;

          let evidenceCount = 0;
          if (itemInstanceIds.length > 0) {
            const deletedEvidence = await tx
              .delete(qcItemEvidence)
              .where(inArray(qcItemEvidence.itemInstanceId, itemInstanceIds))
              .returning({ id: qcItemEvidence.id });
            evidenceCount = deletedEvidence.length;
          }

          const deletedPlanLinks = await tx
            .delete(qcPlanLink)
            .where(planLinkScope)
            .returning({ id: qcPlanLink.id });

          const deletedWarnings = await tx
            .delete(qcWarning)
            .where(warningScope)
            .returning({ id: qcWarning.id });

          const deletedPostmortems = await tx
            .delete(qcPostmortem)
            .where(postmortemScope)
            .returning({ id: qcPostmortem.id });

          const deletedChecklists = await tx
            .delete(qcChecklist)
            .where(inArray(qcChecklist.id, checklistIds))
            .returning({ id: qcChecklist.id });

          return {
            checklistIds,
            counts: {
              checklists: deletedChecklists.length,
              itemInstances: itemInstanceIds.length,
              riskAnswers: riskAnswerCount,
              evidence: evidenceCount,
              planLinks: deletedPlanLinks.length,
              warnings: deletedWarnings.length,
              warningEvents: warningEventCount,
              postmortems: deletedPostmortems.length,
              postmortemSummaries: postmortemSummaryCount,
              postmortemMetricValues: postmortemMetricValueCount,
            },
          };
        });

        if (!result) {
          return res.status(404).json({ error: "No quality checklist found for this project" });
        }

        logAuditFromReq(req, {
          entityType: "quality_checklist",
          // entityId carries the primary checklist id (audit_log.entity_id is
          // a single string column). The full list of deleted ids is kept in
          // changesJson.checklistIds so multi-checklist legacy cases stay
          // fully auditable.
          entityId: String(result.checklistIds[0]),
          action: "delete",
          projectName: canonicalProjectName,
          changesJson: {
            description: "Quality process deleted (full restart)",
            checklistIds: result.checklistIds,
            counts: result.counts,
          },
        });

        res.json({ success: true, counts: result.counts });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // ========== CHECKLIST ITEM OPERATIONS ==========

  app.post("/api/quality/project/:projectName/item/:itemInstanceId", requireAuth, requireQmChallengePassed, requirePermission('pd_quality', 'edit'), validateBody(updateItemSchema), async (req, res) => {
    try {
      const itemId = parseIntParam(req.params.itemInstanceId);
      const urlProjectName = decodeURIComponent(String(req.params.projectName));

      // F17: assert :projectName matches the item's actual project.
      const ok = await assertItemBelongsToProject(req, res, itemId, urlProjectName);
      if (!ok) return;

      const {
        startDate,
        endDate,
        isApplicable,
        notApplicableReason,
        approvalComment,
        allowedWorkingDays,
        qmStatus,
        assigneeUserId,
        assigneeType,
        assigneeId,
      } = req.body;

      if (qmStatus !== undefined && !(QUALITY_ITEM_STATUSES as readonly string[]).includes(qmStatus)) {
        return res.status(400).json({ error: "invalid_input", message: `qmStatus must be one of: ${QUALITY_ITEM_STATUSES.join(', ')}` });
      }

      if (allowedWorkingDays !== undefined && (typeof allowedWorkingDays !== 'number' || allowedWorkingDays < 0)) {
        return res.status(400).json({ error: "invalid_input", message: "allowedWorkingDays must be a non-negative number" });
      }

      const [existing] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.id, itemId));

      if (qmStatus !== undefined && existing) {
        const currentStatus = existing.qmStatus ?? "not_started";
        if (qmStatus !== currentStatus && !isValidQmStatusTransition(currentStatus, qmStatus)) {
          return res.status(400).json({ error: "invalid_transition", message: `Cannot transition from '${currentStatus}' to '${qmStatus}'` });
        }
      }

      // Plan v3 § D.G — softening: COO/CEO with override_reason can also
      // act on review/fail-to-pass transitions; without override, only
      // QM Manager / admin per the original gate.
      const qcOverrideReason = typeof req.body?.override_reason === "string"
        ? req.body.override_reason.trim()
        : "";
      const qcOverrideAllowed = qcOverrideReason.length > 0 && canOverride(getUserRole(req) ?? "", "quality");

      if (qmStatus === "pass") {
        if (existing && (existing.qmStatus === "review" || existing.qmStatus === "fail")) {
          const role = getUserRole(req);
          const normalizedRole = normalizeRoleForPermissions(role);
          const isQmManager = isAdminRole(role) || normalizedRole === "QUALITY_MANAGER";
          if (!isQmManager && !qcOverrideAllowed) {
            return res.status(403).json({
              error: "forbidden",
              message: "Only QM Manager can move items from Review or Failed back to Pass",
              hint: "Pass override_reason as a COO/CEO to override.",
            });
          }
        }
      }

      const updates: any = { lastUpdatedAt: new Date() };
      if (startDate !== undefined) updates.startDate = startDate;
      if (endDate !== undefined) updates.endDate = endDate;
      if (allowedWorkingDays !== undefined) updates.allowedWorkingDays = allowedWorkingDays;
      if (isApplicable !== undefined) {
        updates.isApplicable = isApplicable;
      }
      if (notApplicableReason !== undefined) updates.notApplicableReason = notApplicableReason;
      if (approvalComment !== undefined) updates.approvalComment = approvalComment;

      if (qmStatus !== undefined) {
        updates.qmStatus = qmStatus;
        if (qmStatus === "pass") {
          // Evidence-required gate: prevent pass when required evidence is missing.
          // Plan v3 § D.G softening: COO/CEO with override_reason can pass without
          // evidence; the override is captured in evidence_override_records and
          // emits a canonical audit row.
          if (existing) {
            const [tmpl] = await db.select().from(qcTemplateItem).where(eq(qcTemplateItem.id, existing.templateItemId));
            if (tmpl?.isEvidenceRequired) {
              const evidenceRows = await db.select().from(qcItemEvidence).where(
                and(eq(qcItemEvidence.itemInstanceId, itemId), isNull(qcItemEvidence.deletedAt))
              );
              const blockReason = getApprovalBlockReason({
                isApplicable: existing.isApplicable,
                isEvidenceRequired: true,
                evidenceCount: evidenceRows.length,
              });
              if (blockReason) {
                if (!qcOverrideAllowed) {
                  return res.status(400).json({
                    error: "evidence_required",
                    message: blockReason,
                    hint: "Pass override_reason as a COO/CEO to record an evidence-required override (audited).",
                  });
                }
                const overrideUser = getUser(req);
                // Task 0.1: qc_item_instance has NO project_id column — the
                // previous `(existing as any).projectId` was always null, so
                // this insert never ran. Resolve the project id through the
                // checklist FK instead.
                const projectIdForOverride = await resolveProjectIdForItemInstance(itemId);
                if (projectIdForOverride != null) {
                  await db.insert(evidenceOverrideRecords).values(
                    buildQcEvidenceOverrideRecord({
                      projectId: projectIdForOverride,
                      itemInstanceId: itemId,
                      completionType: "qc_item_pass",
                      evidenceCount: evidenceRows.length,
                      reason: qcOverrideReason,
                      authorizedByUserId: overrideUser.id,
                      authorizedByName: overrideUser.name ?? null,
                      authorizedByRole: getUserRole(req) ?? null,
                    }),
                  );
                }
                await recordAudit({
                  actorRole: getUserRole(req) ?? "UNKNOWN",
                  userId: overrideUser.id,
                  entityType: "qc_item_instance",
                  entityId: String(itemId),
                  action: "OVERRIDE_EVIDENCE_REQUIRED",
                  changesJson: { override_applied: true, reason: qcOverrideReason, evidenceCount: evidenceRows.length },
                });
              }
            }
          }
          updates.approved = true;
          updates.isApplicable = true;
          updates.approvedByUserId = getUser(req).id;
          updates.approvedAt = new Date();
        } else if (qmStatus === "na") {
          updates.isApplicable = false;
          updates.approved = false;
          updates.approvedByUserId = null;
          updates.approvedAt = null;
        } else {
          updates.isApplicable = true;
          updates.approved = false;
          updates.approvedByUserId = null;
          updates.approvedAt = null;
        }
      }

      if (startDate && endDate) {
        const holidays = await db.select().from(calendarHoliday);
        updates.workingDays = businessDaysBetween(startDate, endDate, holidays.map((h: any) => h.date));
      }

      const [updated] = await db.update(qcItemInstance).set(updates).where(eq(qcItemInstance.id, itemId)).returning();
      const requestedAssigneeType = assigneeType ?? (assigneeUserId !== undefined && assigneeUserId !== null ? "internal_user" : assigneeUserId === null ? null : undefined);
      const requestedAssigneeId = assigneeId ?? (assigneeUserId !== undefined && assigneeUserId !== null ? parseInt(String(assigneeUserId), 10) : null);

      if (requestedAssigneeType !== undefined || assigneeUserId === null) {
        await setEntityAssignment(req, {
          entityType: "quality_item",
          entityId: itemId,
          assignmentRole: "ASSIGNEE",
          assigneeType: requestedAssigneeType ?? null,
          assigneeId: requestedAssigneeId,
          mode: requestedAssigneeType ? "replace" : "clear",
        });
      }

      const assignments = await getAssignmentsForEntity("quality_item", itemId, "ASSIGNEE");
      const pName = decodeURIComponent(String(req.params.projectName));
      recalculateWarnings(pName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));

      // Refresh dashboard metrics for this project
      db.select({ id: projectInfo.id }).from(projectInfo).where(eq(projectInfo.projectName, pName)).limit(1)
        .then(([row]: any) => { if (row) refreshProjectMetricsAsync(row.id); })
        .catch((err: any) => console.warn("[Quality] Dashboard metrics refresh failed:", err?.message || err));

      logAuditFromReq(req, {
        entityType: "quality_checklist",
        entityId: String(itemId),
        action: "update",
        projectName: pName,
        changesJson: {
          description: "Quality checklist item updated",
          qmStatus,
          assigneeType: requestedAssigneeType ?? null,
          assigneeId: requestedAssigneeId,
        },
      });
      res.json({ ...updated, assignments, primaryAssignment: assignments[0] || null });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/approve", requireAuth, requireQmChallengePassed, requirePermission('quality', 'edit'), validateBody(approveItemSchema), async (req, res) => {
    try {
      const itemId = parseIntParam(req.params.itemInstanceId);
      const { approved, comment } = req.body;
      const urlProjectName = decodeURIComponent(String(req.params.projectName));

      // F17: assert :projectName matches the item's actual project.
      const ok = await assertItemBelongsToProject(req, res, itemId, urlProjectName);
      if (!ok) return;

      const [existing] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.id, itemId));

      // Plan v3 § D.G — softening: COO/CEO with override_reason may
      // bypass the QM-Manager-only and evidence-required guards on the
      // dedicated approve endpoint as well.
      const approveOverrideReason = typeof req.body?.override_reason === "string"
        ? req.body.override_reason.trim()
        : "";
      const approveOverrideAllowed = approveOverrideReason.length > 0 && canOverride(getUserRole(req) ?? "", "quality");
      if (approved) {
        if (existing && (existing.qmStatus === "review" || existing.qmStatus === "fail")) {
          const role = getUserRole(req);
          const normalizedRole = normalizeRoleForPermissions(role);
          const isQmManager = isAdminRole(role) || normalizedRole === "QUALITY_MANAGER";
          if (!isQmManager && !approveOverrideAllowed) {
            return res.status(403).json({
              error: "forbidden",
              message: "Only Quality Manager or Admin can approve items in Review or Failed status",
              hint: "Pass override_reason as a COO/CEO to override.",
            });
          }
        }

        // Evidence-required gate: prevent approval when required evidence is missing.
        if (existing) {
          const [tmpl] = await db.select().from(qcTemplateItem).where(eq(qcTemplateItem.id, existing.templateItemId));
          if (tmpl?.isEvidenceRequired) {
            const evidenceRows = await db.select().from(qcItemEvidence).where(
              and(eq(qcItemEvidence.itemInstanceId, itemId), isNull(qcItemEvidence.deletedAt))
            );
            const blockReason = getApprovalBlockReason({
              isApplicable: existing.isApplicable,
              isEvidenceRequired: true,
              evidenceCount: evidenceRows.length,
            });
            if (blockReason) {
              if (!approveOverrideAllowed) {
                return res.status(400).json({
                  error: "evidence_required",
                  message: blockReason,
                  hint: "Pass override_reason as a COO/CEO to record an evidence-required override (audited).",
                });
              }
              const overrideUser = getUser(req);
              // Task 0.1: resolve project id via the checklist FK — the item
              // instance has no project_id column of its own.
              const projectIdForOverride = await resolveProjectIdForItemInstance(itemId);
              if (projectIdForOverride != null) {
                await db.insert(evidenceOverrideRecords).values(
                  buildQcEvidenceOverrideRecord({
                    projectId: projectIdForOverride,
                    itemInstanceId: itemId,
                    completionType: "qc_item_approve",
                    evidenceCount: evidenceRows.length,
                    reason: approveOverrideReason,
                    authorizedByUserId: overrideUser.id,
                    authorizedByName: overrideUser.name ?? null,
                    authorizedByRole: getUserRole(req) ?? null,
                  }),
                );
              }
              await recordAudit({
                actorRole: getUserRole(req) ?? "UNKNOWN",
                userId: overrideUser.id,
                entityType: "qc_item_instance",
                entityId: String(itemId),
                action: "OVERRIDE_EVIDENCE_REQUIRED",
                changesJson: { override_applied: true, reason: approveOverrideReason, evidenceCount: evidenceRows.length },
              });
            }
          }
        }
      }

      const updates: any = {
        approved: !!approved,
        lastUpdatedAt: new Date(),
      };
      if (approved) {
        updates.approvedByUserId = getUser(req).id;
        updates.approvedAt = new Date();
        updates.qmStatus = "pass";
        if (comment) updates.approvalComment = comment;
      } else {
        updates.approvedByUserId = null;
        updates.approvedAt = null;
        if (existing?.qmStatus === "review") {
          updates.qmStatus = "fail";
        }
        updates.approvalComment = comment?.trim() ? comment.trim() : null;
      }

      const [updated] = await db.update(qcItemInstance).set(updates).where(eq(qcItemInstance.id, itemId)).returning();
      const pName = decodeURIComponent(String(req.params.projectName));
      recalculateWarnings(pName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));

      // Refresh dashboard metrics for this project
      db.select({ id: projectInfo.id }).from(projectInfo).where(eq(projectInfo.projectName, pName)).limit(1)
        .then(([row]: any) => { if (row) refreshProjectMetricsAsync(row.id); })
        .catch((err: any) => console.warn("[Quality] Dashboard metrics refresh failed:", err?.message || err));

      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: approved ? "approve" : "update", projectName: pName, changesJson: { description: approved ? "Quality item approved" : "Quality item approval revoked" } });
      res.json(updated);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/evidence", requireAuth, requirePermission("quality", "edit"), validateBody(addEvidenceSchema), async (req, res) => {
    try {
      const itemId = parseIntParam(req.params.itemInstanceId);
      const { evidenceUrl, evidenceNote } = req.body;
      const urlProjectName = decodeURIComponent(String(req.params.projectName));

      // F17: assert :projectName matches the item's actual project — prevents
      // mis-scoped audit rows when a client posts an item ID from project B
      // under a URL that names project A.
      const ok = await assertItemBelongsToProject(req, res, itemId, urlProjectName);
      if (!ok) return;

      const projectId = await resolveProjectIdForItemInstance(itemId);
      if (!projectId) return res.status(400).json({ error: "project_context_missing", message: "Cannot attach evidence without project linkage" });

      const [evidence] = await db.insert(qcItemEvidence).values({
        projectId,
        itemInstanceId: itemId, evidenceUrl, evidenceNote,
      }).returning();
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "update", projectName: urlProjectName, changesJson: { description: "Evidence added", evidenceUrl } });
      res.json(evidence);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/evidence/upload", requireAuth, requirePermission("quality", "edit"), qmApprovalUpload.single("file"), async (req, res) => {
    try {
      const itemId = parseIntParam(req.params.itemInstanceId);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const note = req.body.note || "";
      const urlProjectName = decodeURIComponent(String(req.params.projectName));

      // F17: same scope check as the JSON evidence-add endpoint.
      const ok = await assertItemBelongsToProject(req, res, itemId, urlProjectName);
      if (!ok) return;

      const evidenceUrl = `/uploads/qm-approvals/${file.filename}`;
      const projectId = await resolveProjectIdForItemInstance(itemId);
      if (!projectId) return res.status(400).json({ error: "project_context_missing", message: "Cannot attach evidence without project linkage" });

      const [evidence] = await db.insert(qcItemEvidence).values({
        projectId,
        itemInstanceId: itemId,
        evidenceUrl,
        evidenceNote: note || file.originalname,
      }).returning();
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "update", projectName: decodeURIComponent(String(req.params.projectName)), changesJson: { description: "Evidence file uploaded", fileName: file.originalname } });
      res.json(evidence);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/quality/sp-browse", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const { browseFolders, isSharePointConfigured } = await import("./sharepoint");
      if (!isSharePointConfigured()) {
        return res.status(400).json({ error: "SharePoint not configured" });
      }
      const { storage } = await import("./storage");
      const settings = await storage.getSpSettings();
      if (!settings?.driveId) return res.status(400).json({ error: "SharePoint drive not configured" });

      const folderId = req.query.folderId as string | undefined;
      const items = await browseFolders(settings.driveId, folderId || undefined);
      res.json({ driveId: settings.driveId, items });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/quality/sp-file-link", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const { isSharePointConfigured } = await import("./sharepoint");
      if (!isSharePointConfigured()) return res.status(400).json({ error: "SharePoint not configured" });

      const { storage } = await import("./storage");
      const settings = await storage.getSpSettings();
      if (!settings?.driveId) return res.status(400).json({ error: "SharePoint drive not configured" });

      const itemId = req.query.itemId as string;
      if (!itemId) return res.status(400).json({ error: "itemId required" });

      const { getFileMetadata } = await import("./sharepoint");
      const meta = await getFileMetadata(settings.driveId, itemId);
      const webUrl = meta.webUrl || meta["@microsoft.graph.downloadUrl"] || "";
      res.json({ name: meta.name, webUrl, size: meta.size });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/quality/project/:projectName/item/:itemInstanceId/send-for-approval", requireAuth, requirePermission("pd_quality", "edit"), qmApprovalUpload.single("file"), validateBody(sendForApprovalSchema), async (req, res) => {
    try {
      const itemId = parseIntParam(req.params.itemInstanceId);
      const projectName = decodeURIComponent(String(req.params.projectName));
      const approverUserId = req.body.approverUserId as number;

      // F17: assert :projectName matches the item's actual project.
      const ok = await assertItemBelongsToProject(req, res, itemId, projectName);
      if (!ok) return;

      const [existing] = await db.select().from(qcItemInstance).where(eq(qcItemInstance.id, itemId));
      if (!existing) return res.status(404).json({ error: "Quality item not found" });

      const note = req.body.note || "";
      const file = req.file;

      const [updated] = await db.update(qcItemInstance).set({
        qmStatus: "review",
        approvalComment: note.trim() || null,
      }).where(eq(qcItemInstance.id, itemId)).returning();

      if (file) {
        const evidenceUrl = `/uploads/qm-approvals/${file.filename}`;
      const projectId = await resolveProjectIdForItemInstance(itemId);
      if (!projectId) return res.status(400).json({ error: "project_context_missing", message: "Cannot attach evidence without project linkage" });

        await db.insert(qcItemEvidence).values({
          projectId,
        itemInstanceId: itemId,
          evidenceUrl,
          evidenceNote: `Submitted for approval: ${file.originalname}`,
        });
      }

      await createQmNotification(approverUserId, "quality.submitted_for_approval",
        `QM Approval needed: ${projectName}`,
        `A quality item has been submitted for your approval${file ? ` with attachment: ${file.originalname}` : ""}`,
        { projectName }
      );

      recalculateWarnings(projectName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));


      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "update", projectName, changesJson: { description: "Sent for approval", approverUserId } });
      res.json({
        ...updated,
        uploadedFile: file ? { filename: file.filename, originalName: file.originalname, size: file.size } : null,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Deleting an evidence file is the inverse of uploading one (which uses
  // quality:edit) — gate it symmetrically so a QM/Construction Mgr who can
  // attach evidence can also remove a wrong one. quality:delete (COO/CEO) was
  // a mismatch: the client shows the trash button to every quality:edit role.
  app.delete("/api/quality/evidence/:evidenceId", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const evidenceId = parseIntParam(req.params.evidenceId);

      // F22: look up project context BEFORE deletion so the audit row carries
      // the project name. Without this, "which project lost this evidence?"
      // can't be answered after the fact.
      const [evidence] = await db
        .select({ projectId: qcItemEvidence.projectId, itemInstanceId: qcItemEvidence.itemInstanceId })
        .from(qcItemEvidence)
        .where(eq(qcItemEvidence.id, evidenceId));
      let projectName: string | null = null;
      if (evidence?.projectId) {
        const [project] = await db
          .select({ name: projectInfo.projectName })
          .from(projectInfo)
          .where(eq(projectInfo.id, evidence.projectId));
        projectName = project?.name ?? null;
      }

      await db.update(qcItemEvidence).set({ deletedAt: new Date(), deletedBy: getUser(req).id }).where(eq(qcItemEvidence.id, evidenceId)).returning();
      logAuditFromReq(req, {
        entityType: "quality_checklist",
        entityId: String(evidenceId),
        action: "delete",
        projectName: projectName ?? undefined,
        changesJson: {
          description: "Evidence deleted",
          projectId: evidence?.projectId ?? null,
          itemInstanceId: evidence?.itemInstanceId ?? null,
        },
      });
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== QC ITEM CREATE/DELETE ==========

  app.post("/api/quality/project/:projectName/items", requireAuth, requireQmChallengePassed, requirePermission('pd_quality', 'edit'), validateBody(createItemSchema), async (req, res) => {
    try {
      const pName = decodeURIComponent(String(req.params.projectName));
      const { itemName, groupId } = req.body;

      const checklist = await findChecklistByProjectName(pName);
      if (!checklist) return res.status(404).json({ error: "No checklist found for this project" });

      let templateItemId: number;
      if (groupId) {
        const [templateItem] = await db.insert(qcTemplateItem).values({
          templateGroupId: groupId,
          itemName,
          sortOrder: 999,
          isEvidenceRequired: false,
          defaultSeverity: "Medium",
        }).returning();
        templateItemId = templateItem.id;
      } else {
        const [groups] = await db.select().from(qcTemplateGroup).limit(1);
        if (!groups) return res.status(400).json({ error: "No template groups exist" });
        const [templateItem] = await db.insert(qcTemplateItem).values({
          templateGroupId: groups.id,
          itemName,
          sortOrder: 999,
          isEvidenceRequired: false,
          defaultSeverity: "Medium",
        }).returning();
        templateItemId = templateItem.id;
      }

      const [item] = await db.insert(qcItemInstance).values({
        checklistId: checklist.id,
        templateItemId,
        isApplicable: true,
        qmStatus: "not_started",
      }).returning();


      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(item.id), action: "create", projectName: pName, changesJson: { description: "Quality item created", itemName } });
      res.json(item);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/api/quality/project/:projectName/item/:itemInstanceId", requireAuth, requireQmChallengePassed, requirePermission('pd_quality', 'edit'), async (req, res) => {
    try {
      const pName = decodeURIComponent(String(req.params.projectName));
      const itemId = parseIntParam(req.params.itemInstanceId);

      const checklist = await findChecklistByProjectName(pName);
      if (!checklist) return res.status(404).json({ error: "No checklist found for this project" });

      const [instance] = await db.select().from(qcItemInstance).where(
        and(eq(qcItemInstance.id, itemId), eq(qcItemInstance.checklistId, checklist.id))
      );
      if (!instance) return res.status(404).json({ error: "Item not found in this project's checklist" });

      await db.transaction(async (tx: any) => {
        await tx.delete(qcItemEvidence).where(eq(qcItemEvidence.itemInstanceId, itemId));
        await tx.delete(qcPlanLink).where(eq(qcPlanLink.itemInstanceId, itemId));
        await tx.delete(qcItemInstance).where(eq(qcItemInstance.id, itemId));
      });

      recalculateWarnings(pName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));


      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(itemId), action: "delete", projectName: pName, changesJson: { description: "Quality item deleted" } });
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== RISK ANSWERS ==========

  app.post("/api/quality/project/:projectName/risk-answer", requireAuth, requirePermission("quality", "edit"), validateBody(riskAnswerSchema), async (req, res) => {
    try {
      const {
        riskAnswerId,
        checklistId,
        templateRiskQuestionId,
        answerNumber,
      } = req.body;
      const pName = decodeURIComponent(String(req.params.projectName));

      // F21: confirm the risk answer's checklist belongs to the project named
      // in the URL — otherwise a quality.edit holder could flip risk answers
      // for any project they don't work on.
      const urlProjectId = await resolveProjectIdByName(pName);

      // Resolve the target answer-row id. Either it was passed directly
      // (riskAnswerId) or we upsert by (checklistId, templateRiskQuestionId)
      // for a question with no seeded answer row (Task 1.4).
      let targetRiskAnswerId: number;
      if (riskAnswerId != null) {
        const [answer] = await db
          .select({ checklistId: qcRiskAnswer.checklistId })
          .from(qcRiskAnswer)
          .where(eq(qcRiskAnswer.id, riskAnswerId));
        if (!answer) return res.status(404).json({ error: "risk_answer_not_found" });
        const [checklist] = await db
          .select({ projectId: qcChecklist.projectId })
          .from(qcChecklist)
          .where(eq(qcChecklist.id, answer.checklistId));
        if (!checklist || !urlProjectId || checklist.projectId !== urlProjectId) {
          return res.status(403).json({
            error: "project_scope_mismatch",
            message: "Risk answer does not belong to the project named in the URL.",
          });
        }
        targetRiskAnswerId = riskAnswerId;
      } else {
        const [checklist] = await db
          .select({ projectId: qcChecklist.projectId, templateId: qcChecklist.templateId })
          .from(qcChecklist)
          .where(eq(qcChecklist.id, checklistId));
        if (!checklist || !urlProjectId || checklist.projectId !== urlProjectId) {
          return res.status(403).json({
            error: "project_scope_mismatch",
            message: "Checklist does not belong to the project named in the URL.",
          });
        }
        // Defence: the risk question must belong to the checklist's template.
        const [rq] = await db
          .select({ id: qcTemplateRiskQuestion.id })
          .from(qcTemplateRiskQuestion)
          .innerJoin(qcTemplatePhase, eq(qcTemplateRiskQuestion.templatePhaseId, qcTemplatePhase.id))
          .where(and(
            eq(qcTemplateRiskQuestion.id, templateRiskQuestionId),
            eq(qcTemplatePhase.templateId, checklist.templateId),
          ));
        if (!rq) return res.status(400).json({ error: "risk_question_not_in_template" });

        // Find-or-create inside a tx + advisory lock keyed on the natural
        // pair so two concurrent first-answers can't insert duplicate rows.
        targetRiskAnswerId = await db.transaction(async (tx: QualityDb) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`qc_risk_answer:${checklistId}:${templateRiskQuestionId}`}))`);
          const [existingAns] = await tx
            .select({ id: qcRiskAnswer.id })
            .from(qcRiskAnswer)
            .where(and(
              eq(qcRiskAnswer.checklistId, checklistId),
              eq(qcRiskAnswer.templateRiskQuestionId, templateRiskQuestionId),
            ));
          if (existingAns) return existingAns.id;
          const [inserted] = await tx
            .insert(qcRiskAnswer)
            .values({ checklistId, templateRiskQuestionId })
            .returning({ id: qcRiskAnswer.id });
          return inserted.id;
        });
      }

      const answerUpdates = buildRiskAnswerUpdates(req.body);
      const updates: any = { lastUpdatedBy: getUser(req).id, lastUpdatedAt: new Date(), ...answerUpdates };

      const [updated] = await db.update(qcRiskAnswer).set(updates).where(eq(qcRiskAnswer.id, targetRiskAnswerId)).returning();
      recalculateWarnings(pName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));


      logAuditFromReq(req, {
        entityType: "qc_risk_answer",
        entityId: String(targetRiskAnswerId),
        action: "update",
        projectName: pName,
        changesJson: {
          description: "Risk answer updated",
          answerYesno: answerUpdates.answerYesno,
          answerText: answerUpdates.answerText,
          answerNumber,
        },
      });
      res.json(updated);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== WARNINGS ==========

  app.get("/api/quality/project/:projectName/warnings", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      if (!(await assertProjectAccessByName(req, res, projectName))) return;
      const warnings = await db.select().from(qcWarning)
        .where(eq(qcWarning.projectName, projectName))
        .orderBy(desc(qcWarning.createdAt));
      res.json(warnings);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/quality/warnings", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const statusFilter = req.query.status as string;
      // R1: trim the cross-project warnings list to the caller's scope.
      const scope = await getQualityHseScope(req);
      const scopedNames = scopedProjectNamesArray(scope);
      let storedWarnings: any[];
      if (statusFilter) {
        storedWarnings = await db.select().from(qcWarning)
          .where(eq(qcWarning.status, statusFilter))
          .orderBy(desc(qcWarning.createdAt));
      } else {
        storedWarnings = await db.select().from(qcWarning).orderBy(desc(qcWarning.createdAt));
      }
      if (scopedNames !== null) {
        const allowed = new Set(scopedNames.map((n) => normalizeProjectName(n)));
        storedWarnings = storedWarnings.filter((w: any) => allowed.has(normalizeProjectName(w.projectName)));
      }

      const warnings = storedWarnings.filter((w: any) => w.warningType !== "task_complete_unapproved");

      const allPlanLinks = await db.select().from(qcPlanLink);
      if (allPlanLinks.length) {
        const allItems = await db.select().from(qcItemInstance);
        const projectsWithLinks = [...new Set(allPlanLinks.map((l: any) => l.projectName))];
        const allWiTasks = await getAllPMWorkItemsAsProjectPlan();
        const allPlanTasks = allWiTasks.filter((t: any) => projectsWithLinks.includes(t.projectName));
        const templateItemIds = uniqueNumberList(allItems.map((item: QcItemInstanceRow) => item.templateItemId));
        const templateItems = templateItemIds.length
          ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
          : [];

        for (const link of allPlanLinks) {
          if (!link.itemInstanceId) continue;
          const item = allItems.find((i: any) => i.id === link.itemInstanceId);
          if (!item || !item.isApplicable || item.approved) continue;
          const task = allPlanTasks.find((t: any) => t.id === link.planItemId);
          if (task && (task.actualPctComplete ?? 0) >= 1) {
            const tmpl = templateItems.find((t: any) => t.id === item.templateItemId);
            warnings.push({
              id: -(link.id),
              projectName: link.projectName,
              severity: "High",
              warningType: "task_complete_unapproved",
              title: `Task done — QC not checked: ${tmpl?.itemName || 'Unknown item'}`,
              description: `Task "${task.taskNo || task.highLevelProgramme}" is 100% complete but linked quality item "${tmpl?.itemName}" has not been approved`,
              relatedPlanItemId: task.id,
              relatedItemInstanceId: item.id,
              status: "open",
              createdAt: new Date().toISOString(),
            });
          }
        }
      }

      res.json(warnings);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/quality/warning/:warningId/acknowledge", requireAuth, requirePermission("quality", "edit"), validateBody(warningEventSchema), async (req, res) => {
    try {
      const warningId = parseIntParam(req.params.warningId);
      const { note } = req.body;
      await db.update(qcWarning).set({ status: "in_progress", updatedAt: new Date() }).where(eq(qcWarning.id, warningId));
      await db.insert(qcWarningEvent).values({
        warningId, eventType: "acknowledged", note, actorUserId: getUser(req).id,
      });

      const [warning] = await db.select().from(qcWarning).where(eq(qcWarning.id, warningId));

      logAuditFromReq(req, { entityType: "qc_warning", entityId: String(warningId), action: "update", projectName: warning?.projectName, changesJson: { description: "QC warning acknowledged", warningType: warning?.warningType } });
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/quality/warning/:warningId/resolve", requireAuth, requirePermission("quality", "edit"), validateBody(warningEventSchema), async (req, res) => {
    try {
      const warningId = parseIntParam(req.params.warningId);
      const { note } = req.body;
      await db.update(qcWarning).set({ status: "resolved", updatedAt: new Date() }).where(eq(qcWarning.id, warningId));
      await db.insert(qcWarningEvent).values({
        warningId, eventType: "resolved", note, actorUserId: getUser(req).id,
      });

      logAuditFromReq(req, { entityType: "qc_warning", entityId: String(warningId), action: "update", changesJson: { description: "QC warning resolved" } });
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== PLAN LINKS ==========

  app.get("/api/quality/project/:projectName/plan-links", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      if (!(await assertProjectAccessByName(req, res, projectName))) return;
      const links = await db.select().from(qcPlanLink).where(eq(qcPlanLink.projectName, projectName));
      res.json(links);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/quality/project/:projectName/plan-link", requireAuth, requirePermission("quality", "edit"), validateBody(planLinkSchema), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      const { planItemId, itemInstanceId, phaseId, linkType } = req.body;

      // F17: if the link references a specific quality item, confirm that
      // item belongs to the project named in the URL.
      if (itemInstanceId) {
        const ok = await assertItemBelongsToProject(req, res, itemInstanceId, projectName);
        if (!ok) return;
      } else {
        // Phase-only links — still confirm the URL project exists.
        const urlProjectId = await resolveProjectIdByName(projectName);
        if (!urlProjectId) return res.status(404).json({ error: "project_not_found" });
      }

      const [link] = await db.insert(qcPlanLink).values({
        projectName, planItemId, itemInstanceId: itemInstanceId || null, phaseId: phaseId || null, linkType: linkType || "phase_task",
      }).returning();
      recalculateWarnings(projectName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(link.id), action: "create", projectName, changesJson: { description: "Plan link created", planItemId } });
      res.json(link);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Unlinking a plan task is the inverse of linking one (which uses
  // quality:edit) — gate it symmetrically. quality:delete (COO/CEO) left
  // QM/Construction Mgr able to add a link but not remove it.
  app.delete("/api/quality/plan-link/:linkId", requireAuth, requirePermission("quality", "edit"), async (req, res) => {
    try {
      const [deletedLink] = await db.select().from(qcPlanLink).where(eq(qcPlanLink.id, parseIntParam(req.params.linkId)));
      // R1: scoped roles only delete links for their assigned projects.
      if (deletedLink && !(await assertProjectAccessByName(req, res, deletedLink.projectName))) return;
      await db.delete(qcPlanLink).where(eq(qcPlanLink.id, parseIntParam(req.params.linkId)));
      if (deletedLink) recalculateWarnings(deletedLink.projectName).catch((err) => console.error("[Quality] Warning recalculation failed:", err?.message || err));
      logAuditFromReq(req, { entityType: "quality_checklist", entityId: String(req.params.linkId), action: "delete", projectName: deletedLink?.projectName, changesJson: { description: "Plan link deleted" } });
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== QUALITY SUMMARY (for dashboard) ==========

  app.get("/api/quality/project/:projectName/summary", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      if (!(await assertProjectAccessByName(req, res, projectName))) return;
      const [projectRow] = await db.select().from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
        .where(eq(projectInfo.projectName, projectName));
      // BUG-01 follow-up + M3: defensive merge via mergeProjectRow.
      const project = projectRow ? mergeProjectRow(projectRow) ?? undefined : undefined;
      const checklist = await findChecklistByProjectName(projectName);
      if (!checklist) {
        return res.json({
          hasChecklist: false,
          phases: [],
          governance: {
            overdueCount: 0,
            resubmissionCount: 0,
            evidenceGapCount: 0,
            pendingReviewCount: 0,
            unansweredRiskCount: 0,
            triggeredRiskCount: 0,
            blockedHandover: false,
            handoverBlockingItemCount: 0,
            criticalContributorItemCount: 0,
            actionableForApprovalCount: 0,
            riskLevel: "low",
            riskScore: 0,
            },
        });
      }

      const itemInstances = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));
      const riskAnswers = await db.select().from(qcRiskAnswer).where(eq(qcRiskAnswer.checklistId, checklist.id));
      const riskQuestionIds = uniqueNumberList(riskAnswers.map((answer: QcRiskAnswerRow) => answer.templateRiskQuestionId));
      const riskQuestions: QcTemplateRiskQuestionRow[] = riskQuestionIds.length > 0
        ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.id, riskQuestionIds))
        : [];
      const riskQuestionMap = new Map<number, QcTemplateRiskQuestionRow>(riskQuestions.map((question) => [question.id, question]));
      const templateItemIds = uniqueNumberList(itemInstances.map((item: QcItemInstanceRow) => item.templateItemId));
      const templateItems: QcTemplateItemRow[] = templateItemIds.length > 0
        ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
        : [];
      const templateItemMap = new Map<number, QcTemplateItemRow>(templateItems.map((item) => [item.id, item]));
      const groupIds = uniqueNumberList(templateItems.map((item) => item.templateGroupId));
      const groups: QcTemplateGroupRow[] = groupIds.length > 0
        ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, groupIds))
        : [];
      const groupMap = new Map<number, QcTemplateGroupRow>(groups.map((group) => [group.id, group]));
      const phases: QcTemplatePhaseRow[] = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, checklist.templateId));
      const evidenceRows: QcItemEvidenceRow[] = itemInstances.length > 0
        ? await db.select().from(qcItemEvidence).where(and(inArray(qcItemEvidence.itemInstanceId, itemInstances.map((item: QcItemInstanceRow) => item.id)), isNull(qcItemEvidence.deletedAt)))
        : [];
      const evidenceCountMap = new Map<number, number>();
      for (const evidence of evidenceRows) {
        evidenceCountMap.set(evidence.itemInstanceId, (evidenceCountMap.get(evidence.itemInstanceId) || 0) + 1);
      }
      const warnings = await db.select().from(qcWarning)
        .where(and(eq(qcWarning.projectName, projectName), sql`${qcWarning.status} != 'resolved'`));

      const phaseSummaries = phases.map((phase) => {
        const phaseGroups = groups.filter((group) => group.templatePhaseId === phase.id);
        const phaseGroupIds = phaseGroups.map((group) => group.id);
        const phaseTemplateItems = templateItems.filter((item: any) => phaseGroupIds.includes(item.templateGroupId));
        const phaseItemIds = phaseTemplateItems.map((item: any) => item.id);
        const phaseInstances = itemInstances.filter((item: any) => phaseItemIds.includes(item.templateItemId));
        const progress = computeQcProgress(phaseInstances);

        return {
          phaseId: phase.id,
          phaseKey: phase.phaseKey,
          phaseName: phase.phaseName,
          totalItems: phaseInstances.length,
          applicableItems: progress.totalApplicable,
          approvedItems: progress.totalApproved,
          progressPercent: progress.progressPercent,
        };
      });

      const handoverRows = project ? await listHandoverRowsForProjects([project.id]) : [];
      const handover = handoverRows[0];
      const riskSummary = computeQualityRiskSummary({
        items: itemInstances.map((item: QcItemInstanceRow) => ({
          qmStatus: item.qmStatus,
          approved: item.approved,
          isApplicable: item.isApplicable,
          endDate: item.endDate,
          scheduledDate: item.scheduledDate,
          approvalComment: item.approvalComment,
          isEvidenceRequired: templateItemMap.get(item.templateItemId)?.isEvidenceRequired ?? false,
          evidenceCount: evidenceCountMap.get(item.id) || 0,
        })),
        riskAnswers: riskAnswers.map((answer: QcRiskAnswerRow) => {
          const question = riskQuestionMap.get(answer.templateRiskQuestionId);
          return {
            responseType: question?.responseType ?? "yesno",
            triggersWarning: question?.triggersWarning ?? false,
            triggerCondition: question?.triggerCondition ?? null,
            triggerSeverity: question?.triggerSeverity ?? null,
            answerYesno: answer.answerYesno,
            answerText: answer.answerText,
            answerNumber: answer.answerNumber,
          };
        }),
        warnings,
        handover: {
          engineeringStatus: handover?.engineering_status || null,
          qualityRequired: isQualityStatusRequired(handover?.engineering_status || null),
          qualityStatus: handover?.quality_status || null,
          handoverStatus: handover?.status || null,
          rejectionReason: handover?.rejection_reason || null,
          executionEnabled: project?.executionEnabled ?? false,
          executionGateStatus: project?.executionGateStatus ?? "NOT_ELIGIBLE",
        },
      });

      res.json({
        hasChecklist: true,
        checklistId: checklist.id,
        status: checklist.status,
        phases: phaseSummaries,
        totalWarnings: warnings.length,
        highWarnings: warnings.filter((warning: any) => warning.severity === "High").length,
        openWarnings: warnings.filter((warning: any) => warning.status === "open").length,
        governance: {
          overdueCount: riskSummary.exposures.overdueCount,
          resubmissionCount: riskSummary.exposures.resubmissionCount,
          evidenceGapCount: riskSummary.exposures.evidenceGapCount,
          pendingReviewCount: riskSummary.exposures.pendingReviewCount,
          unansweredRiskCount: riskSummary.exposures.unansweredRiskCount,
          triggeredRiskCount: riskSummary.exposures.triggeredRiskCount,
          blockedHandover: riskSummary.exposures.blockedHandover,
          handoverBlockingItemCount: riskSummary.exposures.handoverBlockingItemCount,
          criticalContributorItemCount: riskSummary.exposures.criticalContributorItemCount,
          actionableForApprovalCount: riskSummary.exposures.actionableForApprovalCount,
          riskLevel: riskSummary.level,
          riskScore: riskSummary.score,
          handoverBlockers: getQualityHandoverReasons({
            engineeringStatus: handover?.engineering_status || null,
            qualityRequired: isQualityStatusRequired(handover?.engineering_status || null),
            qualityStatus: handover?.quality_status || null,
            handoverStatus: handover?.status || null,
            rejectionReason: handover?.rejection_reason || null,
            executionEnabled: project?.executionEnabled ?? false,
            executionGateStatus: project?.executionGateStatus ?? "NOT_ELIGIBLE",
          }),
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/quality/project/:projectName/workspace", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      if (!(await assertProjectAccessByName(req, res, projectName))) return;
      const userId = getUser(req).id;
      const context = await loadProjectQualityGovernanceContext(projectName, userId);

      res.json({
        projectId: context.project?.id || null,
        projectName,
        hasChecklist: !!context.checklist,
        checklistId: context.checklist?.id || null,
        counts: {
          overdue: context.riskSummary.exposures.overdueCount,
          resubmissionNeeded: context.riskSummary.exposures.resubmissionCount,
          evidenceRequired: context.riskSummary.exposures.evidenceGapCount,
          pendingReview: context.riskSummary.exposures.pendingReviewCount,
          unansweredRisk: context.riskSummary.exposures.unansweredRiskCount,
          triggeredRisk: context.riskSummary.exposures.triggeredRiskCount,
          openWarnings: context.riskSummary.exposures.openWarningCount,
          blockedHandover: context.riskSummary.exposures.blockedHandover,
          linkedMicrosoftItems: context.riskSummary.exposures.linkedMicrosoftCount,
        },
        risk: {
          level: context.riskSummary.level,
          score: context.riskSummary.score,
          summary: context.riskSummary.summary,
        },
        handover: context.handover,
        focusItems: context.focusItems.map((item: any) => ({
          id: item.id,
          itemName: item.itemName,
          phaseName: item.phaseName,
          groupName: item.groupName,
          qmStatus: item.qmStatus,
          approved: item.approved,
          approvalState: item.approvalState,
          resubmissionNeeded: item.resubmissionNeeded,
          overdue: item.overdue,
          daysOverdue: item.daysOverdue,
          evidenceRequired: item.isEvidenceRequired,
          evidenceMissing: item.evidenceMissing,
          evidenceCount: item.evidenceCount,
          endDate: item.endDate,
          assigneeName: item.assigneeName,
          approvalComment: item.approvalComment,
        })),
        relevantMicrosoftItems: context.relevantMicrosoftItems.map((item: any) => ({
          id: item.id,
          type: item.type,
          subjectOrTitle: item.subjectOrTitle,
          senderOrOrganizer: item.senderOrOrganizer,
          receivedOrStartDatetime: item.receivedOrStartDatetime,
          webLink: item.webLink,
          actionRequired: item.actionRequired,
          linkedTaskId: item.linkedTaskId,
          taskContext: item.taskContext,
          qualityContext: item.qualityContext,
        })),
        checklistReadiness: evaluateChecklistHandoverReadiness({
          items: context.governanceItems.map((item: any) => ({
            qmStatus: item.qmStatus,
            approved: item.approved,
            isApplicable: item.isApplicable,
            endDate: item.endDate,
            scheduledDate: item.scheduledDate,
            approvalComment: item.approvalComment,
            isEvidenceRequired: item.isEvidenceRequired,
            evidenceCount: item.evidenceCount,
          })),
          itemNames: context.governanceItems.map((item: any) => item.itemName),
          warnings: context.warnings,
          riskAnswers: context.riskAnswers,
        }),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== ALL ITEMS (flat list for bottom-up view) ==========

  app.get("/api/quality/all-items", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectFilter = req.query.project as string | undefined;
      const phaseFilter = req.query.phase as string | undefined;
      // R1: scoped roles see only items on their assigned projects.
      const scope = await getQualityHseScope(req);
      const scopedNames = scopedProjectNamesArray(scope);
      if (scopedNames !== null && scopedNames.length === 0) return res.json([]);
      if (projectFilter && !scopeAllowsProjectName(scope, projectFilter)) return res.json([]);
      const statusFilter = req.query.status as string | undefined;

      const allInstances = await db.select().from(qcItemInstance);
      const allChecklists = await db.select().from(qcChecklist);

      const checklistMap = new Map<number, QcChecklistRow>(allChecklists.map((cl: any) => [cl.id, cl]));

      let filtered = allInstances;
      if (projectFilter) {
        const matchingChecklistIds = allChecklists
          .filter((cl: any) => cl.projectName === projectFilter)
          .map((cl: any) => cl.id);
        filtered = filtered.filter((i: any) => matchingChecklistIds.includes(i.checklistId));
      }
      if (statusFilter) {
        filtered = filtered.filter((i: any) => i.qmStatus === statusFilter);
      }

      if (filtered.length === 0) {
        return res.json([]);
      }

      const templateItemIds = uniqueNumberList(filtered.map((i: any) => i.templateItemId));
      const templateItems: QcTemplateItemRow[] = templateItemIds.length
        ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
        : [];
      const templateItemMap = new Map<number, QcTemplateItemRow>(templateItems.map(ti => [ti.id, ti]));

      const groupIds = uniqueNumberList(templateItems.map(ti => ti.templateGroupId));
      const groups: QcTemplateGroupRow[] = groupIds.length
        ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, groupIds))
        : [];
      const groupMap = new Map<number, QcTemplateGroupRow>(groups.map(g => [g.id, g]));

      const phaseIds = uniqueNumberList(groups.map(g => g.templatePhaseId));
      const phases: QcTemplatePhaseRow[] = phaseIds.length
        ? await db.select().from(qcTemplatePhase).where(inArray(qcTemplatePhase.id, phaseIds))
        : [];
      const phaseMap = new Map<number, QcTemplatePhaseRow>(phases.map(p => [p.id, p]));

      const itemInstanceIds = filtered.map((i: any) => i.id);
      const allEvidence: QcItemEvidenceRow[] = itemInstanceIds.length
        ? await db.select().from(qcItemEvidence).where(and(inArray(qcItemEvidence.itemInstanceId, itemInstanceIds), isNull(qcItemEvidence.deletedAt)))
        : [];
      const evidenceCountMap = new Map<number, number>();
      for (const ev of allEvidence) {
        evidenceCountMap.set(ev.itemInstanceId, (evidenceCountMap.get(ev.itemInstanceId) || 0) + 1);
      }

      const assigneeUserIds = uniqueNumberList(filtered.map((i: any) => i.assigneeUserId));
      let userMap = new Map<number, string>();
      if (assigneeUserIds.length) {
        const assignees = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, assigneeUserIds));
        userMap = new Map(assignees.map((u: any) => [u.id, u.name]));
      }

      let items = filtered.map((inst: any) => {
        const checklist = checklistMap.get(inst.checklistId);
        const templateItem = templateItemMap.get(inst.templateItemId);
        const group = templateItem ? groupMap.get(templateItem.templateGroupId) : undefined;
        const phase = group ? phaseMap.get(group.templatePhaseId) : undefined;
        const evidenceCount = evidenceCountMap.get(inst.id) || 0;
        const evaluation = evaluateQualityGovernanceItem({
          qmStatus: inst.qmStatus,
          approved: inst.approved,
          isApplicable: inst.isApplicable,
          endDate: inst.endDate,
          scheduledDate: inst.scheduledDate,
          approvalComment: inst.approvalComment,
          isEvidenceRequired: templateItem?.isEvidenceRequired ?? false,
          evidenceCount,
        });

        return {
          id: inst.id,
          itemName: templateItem?.itemName || "Unknown",
          description: templateItem?.defaultSeverity || null,
          projectName: checklist?.projectName || "Unknown",
          phaseName: phase?.phaseName || "Unknown",
          groupName: group?.groupName || "Unknown",
          qmStatus: inst.qmStatus,
          assigneeName: inst.assigneeUserId ? (userMap.get(inst.assigneeUserId) || null) : null,
          startDate: inst.startDate,
          endDate: inst.endDate,
          evidenceCount,
          evidenceRequired: templateItem?.isEvidenceRequired ?? false,
          evidenceMissing: evaluation.evidenceMissing,
          overdue: evaluation.overdue,
          daysOverdue: evaluation.daysOverdue,
          approvalState: evaluation.approvalState,
          resubmissionNeeded: evaluation.resubmissionNeeded,
          approved: inst.approved,
          approvedAt: inst.approvedAt,
          approvalComment: inst.approvalComment,
        };
      });

      if (phaseFilter) {
        items = items.filter((i: any) => i.phaseName === phaseFilter);
      }
      if (scopedNames !== null) {
        const allowed = new Set(scopedNames.map((n) => normalizeProjectName(n)));
        items = items.filter((i: any) => allowed.has(normalizeProjectName(i.projectName)));
      }

      res.json(items);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== CHECKLISTS LIST ==========

  app.get("/api/quality/checklists", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      // R1: scoped roles only see their assigned projects' checklists.
      const scope = await getQualityHseScope(req);
      const scopedIdsForChecklists = scopedProjectIdsArray(scope);
      const scopedNamesForChecklists = scopedProjectNamesArray(scope);
      if (scopedIdsForChecklists !== null && scopedIdsForChecklists.length === 0) return res.json([]);
      const allChecklistsRaw = await db.select().from(qcChecklist);
      const allChecklists = allChecklistsRaw.filter((c: typeof allChecklistsRaw[number]) => c.projectId != null || c.projectName != null);
      const allProjectRows = await db.select().from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id));
      // Prompt 0.8: safe spread for null leftJoin rows (see loadProjectQualityGovernanceContext).
      const allProjects: ProjectInfoRow[] = allProjectRows.map(mergeProjectRow).filter((p: ProjectInfoRow | null): p is ProjectInfoRow => p != null);
      const projectMap = new Map<number, ProjectInfoRow>(allProjects.map((project: any) => [project.id, project]));
      const projectNameMap = new Map<string, ProjectInfoRow>();
      for (const project of allProjects) {
        if (project?.projectName) {
          projectNameMap.set(normalizeProjectName(project.projectName), project);
        }
      }
      const checklistByProject = new Map<string, QcChecklistRow>();
      for (const checklist of allChecklists) {
        const linkedProject = checklist.projectId
          ? projectMap.get(checklist.projectId)
          : projectNameMap.get(normalizeProjectName(checklist.projectName));
        const canonicalProjectId = linkedProject?.id ?? checklist.projectId ?? null;
        const canonicalProjectName = linkedProject?.projectName || checklist.projectName;
        const key = canonicalProjectId
          ? `id:${canonicalProjectId}`
          : `name:${normalizeProjectName(canonicalProjectName)}`;
        const existing = checklistByProject.get(key);
        if (!existing || checklist.id > existing.id) {
          checklistByProject.set(key, checklist);
        }
      }
      const dedupedChecklists = [...checklistByProject.values()];

      const linkedProjectIds = uniqueNumberList(
        dedupedChecklists.map((checklist) => {
          if (checklist.projectId) return checklist.projectId;
          const linkedProject = projectNameMap.get(normalizeProjectName(checklist.projectName));
          return linkedProject?.id ?? null;
        }),
      );
      const handoverRows: any[] = await listHandoverRowsForProjects(linkedProjectIds);
      const handoverMap = new Map(handoverRows.map((row: any) => [Number(row.project_id), row]));

      const allWarnings = await db.select().from(qcWarning).where(sql`${qcWarning.status} != 'resolved'`);
      const warningsByProject: Record<string, number> = {};
      for (const w of allWarnings) {
        if (w.warningType === "task_complete_unapproved") continue;
        const key = normalizeProjectName(w.projectName);
        warningsByProject[key] = (warningsByProject[key] || 0) + 1;
      }

      const allPlanLinks = await db.select().from(qcPlanLink);
      const allItems = await db.select().from(qcItemInstance);
      const allRiskAnswers = await db.select().from(qcRiskAnswer);
      const riskQuestionIds = uniqueNumberList(allRiskAnswers.map((answer: any) => answer.templateRiskQuestionId));
      const riskQuestions: QcTemplateRiskQuestionRow[] = riskQuestionIds.length > 0
        ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.id, riskQuestionIds))
        : [];
      const riskQuestionMap = new Map<number, QcTemplateRiskQuestionRow>(riskQuestions.map((question) => [question.id, question]));

      try {
        const projectsWithLinks = [...new Set(allPlanLinks.map((l: any) => l.projectName))];
        const allWiTasksQ = await getAllPMWorkItemsAsProjectPlan();
        const allPlanTasks = projectsWithLinks.length
          ? allWiTasksQ.filter((t: any) => projectsWithLinks.includes(t.projectName))
          : [];

        for (const link of allPlanLinks) {
          if (!link.itemInstanceId) continue;
          const item = allItems.find((i: any) => i.id === link.itemInstanceId);
          if (!item || !item.isApplicable || item.approved) continue;
          const task = allPlanTasks.find((t: any) => t.id === link.planItemId);
          if (task && (task.actualPctComplete ?? 0) >= 1) {
            const key = normalizeProjectName(link.projectName);
            warningsByProject[key] = (warningsByProject[key] || 0) + 1;
          }
        }
      } catch (err: unknown) {
        console.warn("[Quality] checklist warning synthesis failed; base checklist response will continue", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const templateItemIds = uniqueNumberList(allItems.map((i: any) => i.templateItemId));
      const templateItems: QcTemplateItemRow[] = templateItemIds.length
        ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
        : [];
      const templateItemMap = new Map<number, QcTemplateItemRow>(templateItems.map((item) => [item.id, item]));
      const groupIds = uniqueNumberList(templateItems.map(t => t.templateGroupId));
      const groups: QcTemplateGroupRow[] = groupIds.length
        ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.id, groupIds))
        : [];
      const groupMap = new Map<number, QcTemplateGroupRow>(groups.map((group) => [group.id, group]));
      const evidenceRows: QcItemEvidenceRow[] = allItems.length > 0
        ? await db.select().from(qcItemEvidence).where(and(inArray(qcItemEvidence.itemInstanceId, allItems.map((item: QcItemInstanceRow) => item.id)), isNull(qcItemEvidence.deletedAt)))
        : [];
      const evidenceCountMap = new Map<number, number>();
      for (const evidence of evidenceRows) {
        evidenceCountMap.set(evidence.itemInstanceId, (evidenceCountMap.get(evidence.itemInstanceId) || 0) + 1);
      }

      // M5: batch phases query across all distinct templateIds instead of
      // querying once per checklist. Each checklist below indexes into
      // phasesByTemplate by its own templateId.
      const distinctTemplateIds = uniqueNumberList(dedupedChecklists.map((cl) => cl.templateId));
      const allPhasesForChecklists: QcTemplatePhaseRow[] = distinctTemplateIds.length
        ? await db.select().from(qcTemplatePhase).where(inArray(qcTemplatePhase.templateId, distinctTemplateIds))
        : [];
      const phasesByTemplate = new Map<number, QcTemplatePhaseRow[]>();
      for (const phase of allPhasesForChecklists) {
        const list = phasesByTemplate.get(phase.templateId) ?? [];
        list.push(phase);
        phasesByTemplate.set(phase.templateId, list);
      }

      const result = dedupedChecklists.map((cl) => {
        const phases = phasesByTemplate.get(cl.templateId) ?? [];
        const clItems = allItems.filter((i: any) => i.checklistId === cl.id);
        const clRiskAnswers = allRiskAnswers.filter((answer: any) => answer.checklistId === cl.id);
        const linkedProject = cl.projectId
          ? projectMap.get(cl.projectId)
          : projectNameMap.get(normalizeProjectName(cl.projectName));
        const resolvedProjectName = linkedProject?.projectName || cl.projectName;
        const handover = linkedProject?.id ? handoverMap.get(linkedProject.id) : undefined;

        const phaseData = phases.map((phase: any) => {
          const phaseGroups = groups.filter(g => g.templatePhaseId === phase.id);
          const phaseGroupIds = phaseGroups.map(g => g.id);
          const phaseTemplateItems = templateItems.filter(ti => phaseGroupIds.includes(ti.templateGroupId));
          const phaseItemIds = phaseTemplateItems.map(ti => ti.id);
          const phaseInstances = clItems.filter((ii: any) => phaseItemIds.includes(ii.templateItemId));
          const progress = computeQcProgress(phaseInstances);
          const applicable = phaseInstances.filter((i: any) => i.isApplicable !== false);
          const failed = applicable.filter((i: any) => i.qmStatus === "fail");
          const inReview = applicable.filter((i: any) => i.qmStatus === "review");

          return {
            phaseId: phase.id,
            phaseName: phase.phaseName,
            total: progress.totalApplicable,
            completed: progress.totalApproved,
            failed: failed.length,
            inReview: inReview.length,
          };
        });

        const governanceItems = clItems.map((item: any) => {
          const templateItem = templateItemMap.get(item.templateItemId);
          const group = templateItem ? groupMap.get(templateItem.templateGroupId) : null;
          const evidenceCount = evidenceCountMap.get(item.id) || 0;
          return {
            qmStatus: item.qmStatus,
            approved: item.approved,
            isApplicable: item.isApplicable,
            endDate: item.endDate,
            scheduledDate: item.scheduledDate,
            approvalComment: item.approvalComment,
            isEvidenceRequired: templateItem?.isEvidenceRequired ?? false,
            evidenceCount,
            groupName: group?.groupName || null,
          };
        });
        const hasLoggedActivity = governanceItems.some((item: any) => (
          item.qmStatus !== "not_started" ||
          item.approved ||
          Boolean(item.endDate) ||
          Boolean(item.scheduledDate) ||
          Boolean(item.approvalComment) ||
          item.evidenceCount > 0
        ));

        const storedProjectWarnings = allWarnings.filter((warning: any) => normalizeProjectName(warning.projectName) === normalizeProjectName(resolvedProjectName));
        const syntheticWarningCount = Math.max(0, (warningsByProject[normalizeProjectName(resolvedProjectName)] || 0) - storedProjectWarnings.length);
        const warningInputs = [
          ...storedProjectWarnings,
          ...Array.from({ length: syntheticWarningCount }, () => ({ severity: "High", status: "open" })),
        ];
        const handoverInput = {
          engineeringStatus: handover?.engineering_status || null,
          qualityRequired: isQualityStatusRequired(handover?.engineering_status || null),
          qualityStatus: handover?.quality_status || null,
          handoverStatus: handover?.status || null,
          rejectionReason: handover?.rejection_reason || null,
          executionEnabled: linkedProject?.executionEnabled ?? false,
          executionGateStatus: linkedProject?.executionGateStatus ?? "NOT_ELIGIBLE",
        };
        const riskSummary = computeQualityRiskSummary({
          items: governanceItems,
          riskAnswers: clRiskAnswers.map((answer: any) => {
            const question = riskQuestionMap.get(answer.templateRiskQuestionId);
            return {
              responseType: question?.responseType ?? "yesno",
              triggersWarning: question?.triggersWarning ?? false,
              triggerCondition: question?.triggerCondition ?? null,
              triggerSeverity: question?.triggerSeverity ?? null,
              answerYesno: answer.answerYesno,
              answerText: answer.answerText,
              answerNumber: answer.answerNumber,
            };
          }),
          warnings: warningInputs,
          handover: handoverInput,
        });

        return {
          id: cl.id,
          projectId: linkedProject?.id ?? cl.projectId ?? null,
          projectName: resolvedProjectName,
          phase: linkedProject?.executionPhase || linkedProject?.phase || null,
          templateId: cl.templateId,
          status: cl.status,
          createdAt: cl.createdAt,
          updatedAt: (cl as any).updatedAt,
          phases: phaseData,
          checklistItemCount: clItems.length,
          hasLoggedActivity,
          warningCount: warningsByProject[normalizeProjectName(resolvedProjectName)] || 0,
          overdueCount: riskSummary.exposures.overdueCount,
          resubmissionCount: riskSummary.exposures.resubmissionCount,
          evidenceGapCount: riskSummary.exposures.evidenceGapCount,
          pendingReviewCount: riskSummary.exposures.pendingReviewCount,
          blockedHandover: riskSummary.exposures.blockedHandover,
          qualityRiskScore: riskSummary.score,
          qualityRiskLevel: riskSummary.level,
        };
      });

      // R1: filter the response set to projects the caller's scope sees.
      const finalResult = scopedNamesForChecklists === null
        ? result
        : (() => {
            const allowed = new Set(scopedNamesForChecklists.map((n) => normalizeProjectName(n)));
            const allowedIds = new Set(scopedIdsForChecklists ?? []);
            return result.filter((r: any) =>
              (r.projectId != null && allowedIds.has(r.projectId)) ||
              allowed.has(normalizeProjectName(r.projectName ?? "")),
            );
          })();
      res.json(finalResult);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== GLOBAL QUALITY DASHBOARD ==========

  app.get("/api/quality/dashboard", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      // R1: pre-filter checklists by the caller's quality/HSE scope. Scoped
      // users only see aggregates for projects they're assigned to; oversight
      // roles (QM, HSE, COO, etc.) see the full company-wide rollup.
      const dashboardScope = await getQualityHseScope(req);
      const dashboardScopedIds = scopedProjectIdsArray(dashboardScope);
      const dashboardScopedNames = scopedProjectNamesArray(dashboardScope);
      if (dashboardScopedIds !== null && dashboardScopedIds.length === 0) {
        return res.json({
          totalChecklists: 0, pendingApprovals: 0, openWarnings: 0, totalWarnings: 0,
          projectsAtRisk: [], overdueActions: 0, resubmissionNeeded: 0, evidenceRequired: 0,
          blockedHandovers: 0, atRiskProjects: 0, topRiskProjects: [], outstandingPostmortems: [],
        });
      }
      const allChecklistsRawUnfiltered = await db.select().from(qcChecklist);
      const allowedNamesNorm = dashboardScopedNames === null ? null : new Set(dashboardScopedNames.map((n) => normalizeProjectName(n)));
      const allowedIds = dashboardScopedIds === null ? null : new Set(dashboardScopedIds);
      const allChecklistsRaw = allowedIds === null
        ? allChecklistsRawUnfiltered
        : allChecklistsRawUnfiltered.filter((c: any) =>
            (c.projectId != null && allowedIds.has(c.projectId)) ||
            (c.projectName != null && allowedNamesNorm!.has(normalizeProjectName(c.projectName))),
          );
      const allChecklists = allChecklistsRaw.filter((c: typeof allChecklistsRaw[number]) => c.projectId != null || c.projectName != null);
      const allWarningsRaw = await db.select().from(qcWarning).where(sql`${qcWarning.status} != 'resolved'`);
      const allWarnings = allowedNamesNorm === null
        ? allWarningsRaw
        : allWarningsRaw.filter((w: any) => allowedNamesNorm.has(normalizeProjectName(w.projectName)));
      const allItems = await db.select().from(qcItemInstance);
      const allRiskAnswers = await db.select().from(qcRiskAnswer);
      const riskQuestionIds = uniqueNumberList(allRiskAnswers.map((answer: any) => answer.templateRiskQuestionId));
      const riskQuestions: QcTemplateRiskQuestionRow[] = riskQuestionIds.length > 0
        ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.id, riskQuestionIds))
        : [];
      const riskQuestionMap = new Map<number, QcTemplateRiskQuestionRow>(riskQuestions.map((question) => [question.id, question]));
      const projectIds = uniqueNumberList(allChecklists.map((checklist: any) => checklist.projectId));
      const allProjectRows = projectIds.length > 0
        ? await db.select().from(projectInfo)
            .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
            .where(inArray(projectInfo.id, projectIds))
        : [];
      // Prompt 0.8: safe spread for null leftJoin rows (see loadProjectQualityGovernanceContext).
      const allProjects: ProjectInfoRow[] = allProjectRows.map(mergeProjectRow).filter((p: ProjectInfoRow | null): p is ProjectInfoRow => p != null);
      const projectMap = new Map<number, ProjectInfoRow>(allProjects.map((project: any) => [project.id, project]));
      const projectNameMap = new Map<string, ProjectInfoRow>();
      for (const project of allProjects) {
        if (project?.projectName) {
          projectNameMap.set(normalizeProjectName(project.projectName), project);
        }
      }

      const checklistByProject = new Map<string, QcChecklistRow>();
      for (const checklist of allChecklists) {
        const linkedProject = checklist.projectId
          ? projectMap.get(checklist.projectId)
          : projectNameMap.get(normalizeProjectName(checklist.projectName));
        const canonicalProjectId = linkedProject?.id ?? checklist.projectId ?? null;
        const canonicalProjectName = linkedProject?.projectName || checklist.projectName;
        const key = canonicalProjectId
          ? `id:${canonicalProjectId}`
          : `name:${normalizeProjectName(canonicalProjectName)}`;
        const existing = checklistByProject.get(key);
        if (!existing || checklist.id > existing.id) {
          checklistByProject.set(key, checklist);
        }
      }
      const dedupedChecklists = [...checklistByProject.values()];
      const dedupedProjectIds = uniqueNumberList(
        dedupedChecklists.map((checklist: any) => {
          if (checklist.projectId) return checklist.projectId;
          const linkedProject = projectNameMap.get(normalizeProjectName(checklist.projectName));
          return linkedProject?.id ?? null;
        }),
      );

      const handoverRows: any[] = await listHandoverRowsForProjects(dedupedProjectIds);
      const handoverMap = new Map(handoverRows.map((row: any) => [Number(row.project_id), row]));

      const templateItemIds = uniqueNumberList(allItems.map((item: QcItemInstanceRow) => item.templateItemId));
      const templateItems: QcTemplateItemRow[] = templateItemIds.length > 0
        ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, templateItemIds))
        : [];
      const templateItemMap = new Map<number, QcTemplateItemRow>(templateItems.map((item: QcTemplateItemRow) => [item.id, item]));

      const evidenceRows: QcItemEvidenceRow[] = allItems.length > 0
        ? await db.select().from(qcItemEvidence).where(and(inArray(qcItemEvidence.itemInstanceId, allItems.map((item: QcItemInstanceRow) => item.id)), isNull(qcItemEvidence.deletedAt)))
        : [];
      const evidenceCountMap = new Map<number, number>();
      for (const evidence of evidenceRows) {
        evidenceCountMap.set(evidence.itemInstanceId, (evidenceCountMap.get(evidence.itemInstanceId) || 0) + 1);
      }

      // R1: limit pendingApprovals to items whose checklist is in scope.
      const allowedChecklistIds = new Set(allChecklists.map((c: any) => c.id));
      const pendingApprovals = allItems.filter((i: any) => i.isApplicable && !i.approved && allowedChecklistIds.has(i.checklistId));
      const projectWarningCounts: Record<string, { high: number; total: number; }> = {};
      for (const w of allWarnings) {
        if (!projectWarningCounts[w.projectName]) projectWarningCounts[w.projectName] = { high: 0, total: 0 };
        projectWarningCounts[w.projectName].total++;
        if (w.severity === "High") projectWarningCounts[w.projectName].high++;
      }

      const projectSummaries = dedupedChecklists.map((checklist: any) => {
        const projectItems = allItems.filter((item: any) => item.checklistId === checklist.id);
        const project = projectMap.get(checklist.projectId);
        const handover = handoverMap.get(checklist.projectId);
        const warningInputs = allWarnings.filter((warning: any) => warning.projectName === checklist.projectName);
        const projectRiskAnswers = allRiskAnswers.filter((answer: any) => answer.checklistId === checklist.id);

        const riskSummary = computeQualityRiskSummary({
          items: projectItems.map((item: any) => ({
            qmStatus: item.qmStatus,
            approved: item.approved,
            isApplicable: item.isApplicable,
            endDate: item.endDate,
            scheduledDate: item.scheduledDate,
            approvalComment: item.approvalComment,
            isEvidenceRequired: templateItemMap.get(item.templateItemId)?.isEvidenceRequired ?? false,
            evidenceCount: evidenceCountMap.get(item.id) || 0,
          })),
          riskAnswers: projectRiskAnswers.map((answer: any) => {
            const question = riskQuestionMap.get(answer.templateRiskQuestionId);
            return {
              responseType: question?.responseType ?? "yesno",
              triggersWarning: question?.triggersWarning ?? false,
              triggerCondition: question?.triggerCondition ?? null,
              triggerSeverity: question?.triggerSeverity ?? null,
              answerYesno: answer.answerYesno,
              answerText: answer.answerText,
              answerNumber: answer.answerNumber,
            };
          }),
          warnings: warningInputs,
          handover: {
            engineeringStatus: handover?.engineering_status || null,
            qualityRequired: isQualityStatusRequired(handover?.engineering_status || null),
            qualityStatus: handover?.quality_status || null,
            handoverStatus: handover?.status || null,
            rejectionReason: handover?.rejection_reason || null,
            executionEnabled: project?.executionEnabled ?? false,
            executionGateStatus: project?.executionGateStatus ?? "NOT_ELIGIBLE",
          },
        });

        return {
          projectName: project?.projectName || checklist.projectName,
          warningCount: warningInputs.length,
          ...riskSummary,
        };
      });

      const projectsAtRisk = projectSummaries
        .filter((project: any) => project.level === "high" || project.level === "critical")
        .map((project: any) => ({
          projectName: project.projectName,
          high: project.exposures.highWarningCount,
          total: project.warningCount,
          riskLevel: project.level,
          riskScore: project.score,
          blockedHandover: project.exposures.blockedHandover,
          overdueCount: project.exposures.overdueCount,
          resubmissionCount: project.exposures.resubmissionCount,
          evidenceGapCount: project.exposures.evidenceGapCount,
        }))
        .sort((left: any, right: any) => right.riskScore - left.riskScore);

      const postmortems = await db.select().from(qcPostmortem);
      const checklistProjects = dedupedChecklists.map((c: any) => {
        const linkedProject = c.projectId
          ? projectMap.get(c.projectId)
          : projectNameMap.get(normalizeProjectName(c.projectName));
        return linkedProject?.projectName || c.projectName;
      });
      const postmortemProjects = postmortems.filter((p: any) => p.completedAt).map((p: any) => p.projectName);
      const outstandingPostmortems = checklistProjects.filter((p: any) => !postmortemProjects.includes(p));

      res.json({
        totalChecklists: dedupedChecklists.length,
        pendingApprovals: pendingApprovals.length,
        openWarnings: allWarnings.filter((w: any) => w.status === "open").length,
        totalWarnings: allWarnings.length,
        projectsAtRisk,
        overdueActions: projectSummaries.reduce((sum: any, project: any) => sum + project.exposures.overdueCount, 0),
        resubmissionNeeded: projectSummaries.reduce((sum: any, project: any) => sum + project.exposures.resubmissionCount, 0),
        evidenceRequired: projectSummaries.reduce((sum: any, project: any) => sum + project.exposures.evidenceGapCount, 0),
        blockedHandovers: projectSummaries.filter((project: any) => project.exposures.blockedHandover).length,
        atRiskProjects: projectsAtRisk.length,
        topRiskProjects: projectsAtRisk.slice(0, 5),
        outstandingPostmortems,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== WARNING ENGINE ==========

  app.post("/api/quality/project/:projectName/recalculate-warnings", requireAuth, requirePermission("quality", "edit"), validateBody(recalculateWarningsSchema), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      if (!(await assertProjectAccessByName(req, res, projectName))) return;
      const count = await recalculateWarnings(projectName);
      logAuditFromReq(req, { entityType: "qc_warning", entityId: "0", action: "create", projectName, changesJson: { description: "Warnings recalculated", warningsGenerated: count } });
      res.json({ success: true, warningsGenerated: count });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== POST-MORTEM ==========

  app.get("/api/quality/postmortem/:projectName", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      if (!(await assertProjectAccessByName(req, res, projectName))) return;
      const [pm] = await db.select().from(qcPostmortem).where(eq(qcPostmortem.projectName, projectName));
      if (!pm) return res.json({ postmortem: null, metricValues: [], summary: null });

      const metricValues = await db.select().from(qcPostmortemMetricValue).where(eq(qcPostmortemMetricValue.postmortemId, pm.id));
      const [summary] = await db.select().from(qcPostmortemSummary).where(eq(qcPostmortemSummary.postmortemId, pm.id));
      const metrics = await db.select().from(qcTemplatePostmortemMetric);

      res.json({ postmortem: pm, metricValues, summary, metrics });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/quality/postmortem/:projectName", requireAuth, requirePermission("quality", "edit"), validateBody(postmortemSchema), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      if (!(await assertProjectAccessByName(req, res, projectName))) return;
      const { metricInputs } = req.body;
      const userId = getUser(req).id;

      // Read metrics outside the transaction — they're template data, no
      // mutation, safe to read up-front.
      const metrics = await db.select().from(qcTemplatePostmortemMetric);

      // F25: wrap the full replace (delete metrics → delete summary →
      // insert metrics → insert summary → mark postmortem complete) in a
      // single transaction. A network blip mid-flow no longer leaves the
      // post-mortem half-saved.
      const result = await db.transaction(async (tx: NodePgDatabase<typeof schema>) => {
        let [pm] = await tx.select().from(qcPostmortem).where(eq(qcPostmortem.projectName, projectName));
        if (!pm) {
          [pm] = await tx.insert(qcPostmortem).values({ projectName }).returning();
        }

        await tx.delete(qcPostmortemMetricValue).where(eq(qcPostmortemMetricValue.postmortemId, pm.id));
        await tx.delete(qcPostmortemSummary).where(eq(qcPostmortemSummary.postmortemId, pm.id));

        const values: any[] = [];
        for (const input of metricInputs) {
          const metric = metrics.find((m: any) => m.id === input.templateMetricId);
          if (!metric) continue;

          let score: number | null = null;
          const rule = metric.scoringRuleJson as any;
          if (rule) {
            if (metric.inputType === "choice" && rule.choices && input.inputValueChoice) {
              score = rule.choices[input.inputValueChoice] ?? null;
            } else if (metric.inputType === "count" && typeof rule.formula === "string" && input.inputValueNumber != null) {
              const val = Number(input.inputValueNumber);
              const raw = evaluateSafeFormula(rule.formula, { count: val, days: val });
              score = raw == null ? null : Math.max(0, Math.min(1, raw));
            }
          }

          values.push({
            postmortemId: pm.id,
            templateMetricId: input.templateMetricId,
            inputValueNumber: input.inputValueNumber ?? null,
            inputValueChoice: input.inputValueChoice ?? null,
            score,
          });
        }

        if (values.length) {
          await tx.insert(qcPostmortemMetricValue).values(values);
        }

        const contractorMetrics = values.filter(v => {
          const m = metrics.find((mm: any) => mm.id === v.templateMetricId);
          return m?.metricGroup === "contractor_quality" && v.score != null;
        });
        const engineeringMetrics = values.filter(v => {
          const m = metrics.find((mm: any) => mm.id === v.templateMetricId);
          return m?.metricGroup === "engineering_quality" && v.score != null;
        });

        const contractorScore = contractorMetrics.length
          ? contractorMetrics.reduce((a, b) => a + (b.score || 0), 0) / contractorMetrics.length
          : null;
        const engineeringScore = engineeringMetrics.length
          ? engineeringMetrics.reduce((a, b) => a + (b.score || 0), 0) / engineeringMetrics.length
          : null;

        const redFlag = (contractorScore != null && contractorScore < POSTMORTEM_RED_FLAG_THRESHOLD) || (engineeringScore != null && engineeringScore < POSTMORTEM_RED_FLAG_THRESHOLD);

        await tx.insert(qcPostmortemSummary).values({
          postmortemId: pm.id,
          contractorQualityScore: contractorScore,
          engineeringQualityScore: engineeringScore,
          redFlag,
        });

        await tx.update(qcPostmortem).set({
          completedAt: new Date(),
          completedByUserId: userId,
        }).where(eq(qcPostmortem.id, pm.id));

        return { pmId: pm.id, contractorScore, engineeringScore, redFlag };
      });

      logAuditFromReq(req, { entityType: "quality_template", entityId: String(result.pmId), action: "create", projectName, changesJson: { description: "Post-mortem completed", contractorScore: result.contractorScore, engineeringScore: result.engineeringScore, redFlag: result.redFlag } });
      res.json({ success: true, contractorScore: result.contractorScore, engineeringScore: result.engineeringScore, redFlag: result.redFlag });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== HOLIDAYS ==========

  app.get("/api/quality/holidays", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const holidays = await db.select().from(calendarHoliday);
      res.json(holidays);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/quality/holidays", requireAuth, requireRoleCanonical(["COO_ADMIN", "CEO_ADMIN"]), validateBody(holidaySchema), async (req, res) => {
    try {
      const { date, name, countryCode } = req.body;
      const [h] = await db.insert(calendarHoliday).values({ date, name, countryCode: countryCode || "ZA" }).returning();
      logAuditFromReq(req, { entityType: "quality_template", entityId: String(h.id), action: "create", changesJson: { description: "Holiday created", date, name } });
      res.json(h);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/api/quality/holidays/:id", requireAuth, requireRoleCanonical(["COO_ADMIN", "CEO_ADMIN"]), async (req, res) => {
    try {
      await db.delete(calendarHoliday).where(eq(calendarHoliday.id, parseIntParam(req.params.id)));
      logAuditFromReq(req, { entityType: "quality_template", entityId: String(req.params.id), action: "delete", changesJson: { description: "Holiday deleted" } });
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== PLAN WARNINGS FOR TASK VIEW ==========

  app.get("/api/quality/plan-warnings/:projectName", requireAuth, requirePermission("quality", "view"), async (req, res) => {
    try {
      const projectName = decodeURIComponent(String(req.params.projectName));
      if (!(await assertProjectAccessByName(req, res, projectName))) return;
      const warnings = await db.select().from(qcWarning)
        .where(and(
          eq(qcWarning.projectName, projectName),
          sql`${qcWarning.status} != 'resolved'`,
          sql`${qcWarning.relatedPlanItemId} IS NOT NULL`
        ));

      const byPlanItem: Record<number, typeof warnings> = {};
      for (const w of warnings) {
        if (w.relatedPlanItemId) {
          if (!byPlanItem[w.relatedPlanItemId]) byPlanItem[w.relatedPlanItemId] = [];
          byPlanItem[w.relatedPlanItemId].push(w);
        }
      }
      res.json(byPlanItem);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ========== QM USER MANAGEMENT ==========

  app.get("/api/quality/users", requireAuth, requireRoleCanonical(["COO_ADMIN", "CEO_ADMIN"]), async (req, res) => {
    try {
      const { users } = await import("@shared/schema");
      const allUsers = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role }).from(users);
      res.json(allUsers);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch("/api/quality/users/:userId/role", requireAuth, requireRoleCanonical(["COO_ADMIN", "CEO_ADMIN"]), validateBody(updateRoleSchema), async (req, res) => {
    try {
      const userId = parseIntParam(req.params.userId);
      const { role: newRole } = req.body;
      const { users } = await import("@shared/schema");
      const [updated] = await db.update(users).set({ role: newRole }).where(eq(users.id, userId)).returning();
      logAuditFromReq(req, { entityType: "quality_template", entityId: String(userId), action: "update", changesJson: { description: "User role updated", newRole, userName: updated.name } });
      res.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/quality/admin/bulk-create-checklists", requireAuth, requireRoleCanonical(["COO_ADMIN", "CEO_ADMIN"]), validateBody(bulkCreateChecklistsSchema), async (req, res) => {
    try {
      const { projectNames } = req.body;
      const [activeTemplate] = await db.select().from(qcTemplate).where(eq(qcTemplate.isActive, true));
      if (!activeTemplate) {
        return res.status(400).json({ error: "No active quality template found" });
      }

      const phases = await db.select().from(qcTemplatePhase).where(eq(qcTemplatePhase.templateId, activeTemplate.id));
      const phaseIds = phases.map((p: QcTemplatePhaseRow) => p.id);
      const groups = phaseIds.length ? await db.select().from(qcTemplateGroup).where(inArray(qcTemplateGroup.templatePhaseId, phaseIds)) : [];
      const groupIds = groups.map((g: QcTemplateGroupRow) => g.id);
      const templateItems = groupIds.length ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.templateGroupId, groupIds)) : [];
      const riskQuestions = phaseIds.length ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.templatePhaseId, phaseIds)) : [];

      // M7: batch project + existing-checklist lookups up-front instead of
      // running 2 queries per project in a loop.
      const requestedNames: string[] = (projectNames as string[]).map((n) => String(n ?? "").trim()).filter((n) => n.length > 0);
      const normalizedRequestedNames: string[] = requestedNames.map((n) => n.toLowerCase());

      type MatchedProject = { id: number; projectName: string };
      const matchedProjects: MatchedProject[] = normalizedRequestedNames.length
        ? await db
            .select({ id: projectInfo.id, projectName: projectInfo.projectName })
            .from(projectInfo)
            .where(sql`LOWER(TRIM(${projectInfo.projectName})) IN (${sql.join(normalizedRequestedNames.map((n: string) => sql`${n}`), sql`, `)})`)
        : [];
      const projectByNormalizedName = new Map<string, MatchedProject>();
      for (const p of matchedProjects) {
        projectByNormalizedName.set(p.projectName.trim().toLowerCase(), p);
      }

      const matchedProjectIds: number[] = matchedProjects.map((p: MatchedProject) => p.id);
      const existingChecklists = matchedProjectIds.length
        ? await db.select().from(qcChecklist).where(inArray(qcChecklist.projectId, matchedProjectIds))
        : [];
      const projectIdsWithChecklist = new Set<number>(
        existingChecklists.map((cl: QcChecklistRow) => cl.projectId).filter((id: number | null): id is number => id != null),
      );

      const results: { project: string; status: string }[] = [];
      const checklistsToCreate: Array<{ project: { id: number; projectName: string }; requestedName: string }> = [];

      for (const requestedProjectName of requestedNames) {
        const project = projectByNormalizedName.get(requestedProjectName.toLowerCase());
        if (!project) {
          results.push({ project: requestedProjectName, status: "project not found" });
          continue;
        }
        if (projectIdsWithChecklist.has(project.id)) {
          results.push({ project: project.projectName, status: "already exists" });
          continue;
        }
        checklistsToCreate.push({ project, requestedName: requestedProjectName });
      }

      // Batch-insert all new checklists, then batch the per-checklist
      // item-instance + risk-answer inserts.
      if (checklistsToCreate.length > 0) {
        const insertedChecklists: QcChecklistRow[] = await db.insert(qcChecklist).values(
          checklistsToCreate.map(({ project }) => ({
            projectId: project.id,
            projectName: project.projectName,
            templateId: activeTemplate.id,
            status: "active",
          })),
        ).returning();

        const itemInstancesToInsert = insertedChecklists.flatMap((cl: QcChecklistRow) =>
          templateItems.map((ti: QcTemplateItemRow) => ({ checklistId: cl.id, templateItemId: ti.id })),
        );
        if (itemInstancesToInsert.length) {
          await db.insert(qcItemInstance).values(itemInstancesToInsert);
        }

        const riskAnswersToInsert = insertedChecklists.flatMap((cl: QcChecklistRow) =>
          riskQuestions.map((rq: QcTemplateRiskQuestionRow) => ({ checklistId: cl.id, templateRiskQuestionId: rq.id })),
        );
        if (riskAnswersToInsert.length) {
          await db.insert(qcRiskAnswer).values(riskAnswersToInsert);
        }

        for (const cl of insertedChecklists) {
          results.push({ project: cl.projectName ?? "(unnamed)", status: "created" });
        }
      }

      logAuditFromReq(req, { entityType: "quality_template", entityId: "0", action: "create", changesJson: { description: "Bulk checklists created", count: results.filter(r => r.status === "created").length } });
      res.json({ success: true, results });
    } catch (err) {
      sendError(res, err);
    }
  });
}

// ========== WARNING ENGINE (recalculate) ==========

export async function recalculateWarnings(projectName: string): Promise<number> {
  const [checklist] = await db.select().from(qcChecklist).where(eq(qcChecklist.projectName, projectName));
  if (!checklist) return 0;

  // Plan v3 § T3 — warnings are now stamped with an ownerUserId so the QM
  // dashboard can show who needs to act. Default routing: project PM if
  // available, otherwise null. Type-specific routing (HSE → HSE_MANAGER,
  // etc.) can layer on top in a future pass.
  const [project] = await db
    .select({ id: schema.projectInfo.id, pmUserId: schema.projectInfo.pmUserId })
    .from(schema.projectInfo)
    .where(eq(schema.projectInfo.projectName, projectName))
    .limit(1);
  const defaultOwnerUserId = project?.pmUserId ?? null;

  const items = await db.select().from(qcItemInstance).where(eq(qcItemInstance.checklistId, checklist.id));
  const templateItems = items.length
    ? await db.select().from(qcTemplateItem).where(inArray(qcTemplateItem.id, items.map((i: any) => i.templateItemId)))
    : [];
  const riskAnswers = await db.select().from(qcRiskAnswer).where(eq(qcRiskAnswer.checklistId, checklist.id));
  const riskQuestions = riskAnswers.length
    ? await db.select().from(qcTemplateRiskQuestion).where(inArray(qcTemplateRiskQuestion.id, riskAnswers.map((r: any) => r.templateRiskQuestionId)))
    : [];
  const planLinks = await db.select().from(qcPlanLink).where(eq(qcPlanLink.projectName, projectName));

  // F14: the delete-then-insert sequence used to run outside a transaction,
  // so two concurrent recomputes on the same project could leave duplicates
  // or wipe each other's work. Capture-resolved + delete + insert now run
  // inside one transaction guarded by a per-project advisory lock, so
  // concurrent callers serialize cleanly.
  //
  // The advisory lock is `pg_advisory_xact_lock(hashtext(projectName))`,
  // released automatically at transaction end.

  const newWarnings: any[] = [];
  const today = new Date().toISOString().split('T')[0];

  // M6: batch the evidence count check across all candidate items in a single
  // query instead of one per approved+evidence-required item.
  const evidenceCheckCandidateIds = items
    .filter((item: QcItemInstanceRow) => {
      if (!item.isApplicable || !item.approved) return false;
      const tmpl = templateItems.find((t: any) => t.id === item.templateItemId);
      return Boolean(tmpl?.isEvidenceRequired);
    })
    .map((i: QcItemInstanceRow) => i.id);

  const evidenceCountByItem = new Map<number, number>();
  if (evidenceCheckCandidateIds.length > 0) {
    const evidenceRowsForCheck = await db
      .select({ itemInstanceId: qcItemEvidence.itemInstanceId })
      .from(qcItemEvidence)
      .where(and(
        inArray(qcItemEvidence.itemInstanceId, evidenceCheckCandidateIds),
        isNull(qcItemEvidence.deletedAt),
      ));
    for (const row of evidenceRowsForCheck) {
      evidenceCountByItem.set(row.itemInstanceId, (evidenceCountByItem.get(row.itemInstanceId) ?? 0) + 1);
    }
  }

  for (const item of items) {
    if (!item.isApplicable) continue;
    const tmpl = templateItems.find((t: any) => t.id === item.templateItemId);

    if (item.endDate && item.endDate < today && !item.approved) {
      newWarnings.push({
        projectName, severity: "High", warningType: "overdue",
        title: `Overdue: ${tmpl?.itemName || 'Unknown item'}`,
        description: `Item was due ${item.endDate} but has not been approved`,
        relatedItemInstanceId: item.id,
        ownerUserId: defaultOwnerUserId,
      });
    }

    if (item.startDate && item.endDate && item.endDate < item.startDate) {
      newWarnings.push({
        projectName, severity: "High", warningType: "invalid_dates",
        title: `Invalid dates: ${tmpl?.itemName || 'Unknown item'}`,
        description: `End date (${item.endDate}) is before start date (${item.startDate})`,
        relatedItemInstanceId: item.id,
        ownerUserId: defaultOwnerUserId,
      });
    }

    if (item.approved && tmpl?.isEvidenceRequired) {
      const evidenceCount = evidenceCountByItem.get(item.id) ?? 0;
      if (evidenceCount === 0) {
        newWarnings.push({
          projectName, severity: "High", warningType: "missing_evidence",
          title: `Missing evidence: ${tmpl.itemName}`,
          description: `Item is approved but required evidence has not been uploaded`,
          relatedItemInstanceId: item.id,
          ownerUserId: defaultOwnerUserId,
        });
      }
    }
  }

  for (const answer of riskAnswers) {
    const question = riskQuestions.find((q: any) => q.id === answer.templateRiskQuestionId);
    if (!question || !question.triggersWarning) continue;

    let triggered = false;
    if (question.triggerCondition === "yes" && answer.answerYesno === true) triggered = true;
    if (question.triggerCondition === "no" && answer.answerYesno === false) triggered = true;

    if (triggered) {
      newWarnings.push({
        projectName, severity: question.triggerSeverity || "Medium", warningType: "risk_trigger",
        title: `Risk: ${question.questionText.substring(0, 80)}`,
        description: question.questionText,
        ownerUserId: defaultOwnerUserId,
      });
    }
  }

  if (planLinks.length) {
    const allWiTasksForProject = await getAllPMWorkItemsAsProjectPlan();
    const planTasks = allWiTasksForProject.filter((t: any) => t.projectName === projectName);

    for (const link of planLinks) {
      const task = planTasks.find(t => t.id === link.planItemId);
      if (!task) continue;

      const linkedItem = link.itemInstanceId ? items.find((i: any) => i.id === link.itemInstanceId) : null;
      if (linkedItem && !linkedItem.approved && linkedItem.isApplicable) {
        const taskPct = task.actualPctComplete ?? 0;
        const tmpl = templateItems.find((t: any) => t.id === linkedItem.templateItemId);

        if (taskPct >= 1) {
          newWarnings.push({
            projectName, severity: "High", warningType: "task_complete_unapproved",
            title: `Task done — QC not checked: ${tmpl?.itemName || 'Unknown item'}`,
            description: `Task "${task.taskNo || task.highLevelProgramme}" is 100% complete but linked quality item "${tmpl?.itemName}" has not been approved`,
            relatedPlanItemId: task.id,
            relatedItemInstanceId: linkedItem.id,
            ownerUserId: (task as any).assigneeUserId ?? defaultOwnerUserId,
          });
        } else if (task.actualEnd) {
          const taskEndDate = new Date(task.actualEnd);
          const daysUntil = Math.floor((taskEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (daysUntil <= 7 && daysUntil >= 0) {
            newWarnings.push({
              projectName, severity: "High", warningType: "phase_incomplete",
              title: `Incomplete QC near milestone: ${task.taskNo || task.highLevelProgramme}`,
              description: `Linked checklist item "${tmpl?.itemName}" is not approved, but milestone is due in ${daysUntil} days`,
              relatedPlanItemId: task.id,
              relatedItemInstanceId: linkedItem.id,
              ownerUserId: (task as any).assigneeUserId ?? defaultOwnerUserId,
            });
          }
        }
      }
    }
  }

  const resolvedCount = await db.transaction(async (tx: NodePgDatabase<typeof schema>) => {
    // Advisory lock: serialize concurrent recomputes on the same project.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${projectName}))`);

    const resolvedRows = await tx
      .select({ id: qcWarning.id, warningType: qcWarning.warningType })
      .from(qcWarning)
      .where(and(
        eq(qcWarning.projectName, projectName),
        sql`${qcWarning.status} = 'open'`,
      ));

    await tx.delete(qcWarning).where(and(
      eq(qcWarning.projectName, projectName),
      sql`${qcWarning.status} = 'open'`,
    ));

    if (newWarnings.length) {
      await tx.insert(qcWarning).values(newWarnings);
    }

    return resolvedRows.length;
  });

  // Single canonical audit row per recompute — captures the delta even
  // when recalculate is fired-and-forgot from a mutation handler.
  if (resolvedCount > 0 || newWarnings.length > 0) {
    await recordAudit({
      actorRole: "SYSTEM",
      entityType: "qc_warning_recalc",
      entityId: projectName,
      action: "RECALCULATE_WARNINGS",
      projectName,
      changesJson: {
        autoResolvedCount: resolvedCount,
        createdCount: newWarnings.length,
        createdTypes: Array.from(new Set(newWarnings.map((w) => w.warningType))),
      },
    });
  }

  return newWarnings.length;
}
