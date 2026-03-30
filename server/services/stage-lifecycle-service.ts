// ============================================================
// STAGE LIFECYCLE SERVICE — Core CRUD + business logic
// ============================================================

import { and, eq, sql, isNull } from "drizzle-orm";
import {
  projectStageInstances,
  projectStageRequirements,
  projectStageEvidence,
  projectStageDecisions,
  projectStageExceptions,
  stageDefinitions,
  stageChecklistTemplates,
  projectExecutionState,
  STAGE_CODES,
  type StageCode,
  type StageStatus,
  type InsertProjectStageInstance,
  type InsertProjectStageRequirement,
  type ProjectStageInstance,
  type ProjectStageRequirement,
} from "@shared/schema";
import { db } from "../db";
import {
  canTransition,
  computeReadinessPct,
  areGateBlockersSatisfied,
  getUnsatisfiedBlockers,
  generateStatusSentence,
  computeDaysInStage,
  STAGE_SEQUENCE,
} from "../../shared/utils/stage-state-machine";

// ── Initialize ──────────────────────────────────────────────

/**
 * Create all 10 stage instances for a project.
 * Skips any that already exist (idempotent).
 */
export async function initializeProjectStages(projectId: number): Promise<ProjectStageInstance[]> {
  const definitions = await db
    .select()
    .from(stageDefinitions)
    .where(eq(stageDefinitions.isActive, true))
    .orderBy(stageDefinitions.stageSequence);

  const existing = await db
    .select()
    .from(projectStageInstances)
    .where(eq(projectStageInstances.projectId, projectId));

  const existingCodes = new Set(existing.map((e: ProjectStageInstance) => e.stageCode));
  const toCreate: InsertProjectStageInstance[] = [];

  for (const def of definitions) {
    if (!existingCodes.has(def.stageCode)) {
      toCreate.push({
        projectId,
        stageCode: def.stageCode,
        stageStatus: 'NOT_STARTED',
        readinessPct: 0,
      });
    }
  }

  if (toCreate.length > 0) {
    await db.insert(projectStageInstances).values(toCreate);
  }

  // Set current_stage_code on project_execution_state if not set
  const [execState] = await db
    .select({ currentStageCode: projectExecutionState.currentStageCode })
    .from(projectExecutionState)
    .where(eq(projectExecutionState.projectId, projectId));

  if (execState && !execState.currentStageCode && definitions.length > 0) {
    await db
      .update(projectExecutionState)
      .set({ currentStageCode: definitions[0].stageCode, updatedAt: new Date() })
      .where(eq(projectExecutionState.projectId, projectId));
  }

  return db
    .select()
    .from(projectStageInstances)
    .where(eq(projectStageInstances.projectId, projectId))
    .orderBy(projectStageInstances.stageCode);
}

// ── Hydrate Checklist ───────────────────────────────────────

/**
 * Populate requirements from templates for a specific stage.
 * Skips items that already exist (idempotent).
 */
export async function hydrateStageChecklist(projectId: number, stageCode: string): Promise<ProjectStageRequirement[]> {
  const [instance] = await db
    .select()
    .from(projectStageInstances)
    .where(and(
      eq(projectStageInstances.projectId, projectId),
      eq(projectStageInstances.stageCode, stageCode),
    ));

  if (!instance) {
    throw new Error(`Stage instance not found for project ${projectId}, stage ${stageCode}`);
  }

  const templates = await db
    .select()
    .from(stageChecklistTemplates)
    .where(and(
      eq(stageChecklistTemplates.stageCode, stageCode),
      eq(stageChecklistTemplates.isActive, true),
    ))
    .orderBy(stageChecklistTemplates.sortOrder);

  const existing = await db
    .select()
    .from(projectStageRequirements)
    .where(eq(projectStageRequirements.stageInstanceId, instance.id));

  const existingCodes = new Set(existing.map((e: ProjectStageRequirement) => e.itemCode));
  const toCreate: InsertProjectStageRequirement[] = [];

  for (const t of templates) {
    if (!existingCodes.has(t.itemCode)) {
      toCreate.push({
        projectId,
        stageInstanceId: instance.id,
        stageCode,
        department: t.department,
        itemName: t.itemName,
        itemCode: t.itemCode,
        blocksGate: t.blocksGate,
        status: 'NOT_STARTED',
      });
    }
  }

  if (toCreate.length > 0) {
    await db.insert(projectStageRequirements).values(toCreate);
  }

  return db
    .select()
    .from(projectStageRequirements)
    .where(eq(projectStageRequirements.stageInstanceId, instance.id))
    .orderBy(projectStageRequirements.department, projectStageRequirements.itemCode);
}

// ── Stage Transition ────────────────────────────────────────

export interface TransitionParams {
  projectId: number;
  stageCode: string;
  newStatus: StageStatus;
  actorUserId: number;
  actorRole: string;
  reason?: string;
  isOverride?: boolean;
}

/**
 * Transition a stage to a new status.
 * Validates state machine, logs decision, syncs project_execution_state.
 */
export async function transitionStageStatus(params: TransitionParams): Promise<ProjectStageInstance> {
  const { projectId, stageCode, newStatus, actorUserId, actorRole, reason, isOverride } = params;

  const [instance] = await db
    .select()
    .from(projectStageInstances)
    .where(and(
      eq(projectStageInstances.projectId, projectId),
      eq(projectStageInstances.stageCode, stageCode),
    ));

  if (!instance) {
    throw new Error(`Stage instance not found for project ${projectId}, stage ${stageCode}`);
  }

  const currentStatus = instance.stageStatus as StageStatus;
  const isAdmin = isOverride === true;

  if (!canTransition(currentStatus, newStatus, isAdmin)) {
    throw new Error(`Invalid transition from ${currentStatus} to ${newStatus}${isAdmin ? '' : ' (not admin)'}`);
  }

  // If transitioning to APPROVED or PROGRESSED, check gate blockers
  if ((newStatus === 'APPROVED' || newStatus === 'PROGRESSED') && !isAdmin) {
    const requirements = await db
      .select()
      .from(projectStageRequirements)
      .where(eq(projectStageRequirements.stageInstanceId, instance.id));

    if (!areGateBlockersSatisfied(requirements)) {
      const missing = getUnsatisfiedBlockers(requirements as any);
      throw new Error(`Gate blockers not satisfied: ${missing.join(', ')}`);
    }
  }

  const updateData: Record<string, any> = {
    stageStatus: newStatus,
    updatedAt: new Date(),
  };

  if (newStatus === 'IN_PROGRESS' && !instance.startedAt) {
    updateData.startedAt = new Date();
  }
  if (newStatus === 'PROGRESSED' || newStatus === 'APPROVED') {
    updateData.completedAt = new Date();
  }

  await db
    .update(projectStageInstances)
    .set(updateData)
    .where(eq(projectStageInstances.id, instance.id));

  // Log decision
  await db.insert(projectStageDecisions).values({
    projectId,
    stageCode,
    decisionType: isAdmin ? 'STAGE_OVERRIDE' : (newStatus === 'APPROVED' ? 'GATE_PASS' : 'GATE_FAIL'),
    decisionSummary: `Stage ${stageCode} transitioned from ${currentStatus} to ${newStatus}${reason ? ': ' + reason : ''}`,
    decidedByUserId: actorUserId,
    decidedDate: new Date(),
    rationale: reason || null,
  });

  // Sync to project_execution_state
  await syncCurrentStage(projectId);

  const [updated] = await db
    .select()
    .from(projectStageInstances)
    .where(eq(projectStageInstances.id, instance.id));

  return updated;
}

// ── Requirement Updates ─────────────────────────────────────

export interface UpdateRequirementParams {
  requirementId: number;
  status: string;
  actorUserId: number;
  evidenceUrl?: string;
  notes?: string;
}

/**
 * Update a requirement status and recalculate readiness.
 */
export async function updateRequirementStatus(params: UpdateRequirementParams) {
  const { requirementId, status, actorUserId, evidenceUrl, notes } = params;

  const [req] = await db
    .select()
    .from(projectStageRequirements)
    .where(eq(projectStageRequirements.id, requirementId));

  if (!req) {
    throw new Error(`Requirement ${requirementId} not found`);
  }

  const updateData: Record<string, any> = {
    status,
    updatedAt: new Date(),
  };

  if (evidenceUrl !== undefined) {
    updateData.evidenceUrl = evidenceUrl;
    updateData.evidenceAttached = true;
  }
  if (notes !== undefined) {
    updateData.notes = notes;
  }
  if (status === 'COMPLETE') {
    updateData.completedByUserId = actorUserId;
    updateData.completedDate = new Date();
  }

  await db
    .update(projectStageRequirements)
    .set(updateData)
    .where(eq(projectStageRequirements.id, requirementId));

  // Recalculate readiness
  const allReqs = await db
    .select()
    .from(projectStageRequirements)
    .where(eq(projectStageRequirements.stageInstanceId, req.stageInstanceId));

  const readiness = computeReadinessPct(allReqs);

  await db
    .update(projectStageInstances)
    .set({ readinessPct: readiness, updatedAt: new Date() })
    .where(eq(projectStageInstances.id, req.stageInstanceId));

  // Sync to project_execution_state
  await syncCurrentStage(req.projectId);

  const [updated] = await db
    .select()
    .from(projectStageRequirements)
    .where(eq(projectStageRequirements.id, requirementId));

  return { requirement: updated, readinessPct: readiness };
}

// ── Dashboard Data ──────────────────────────────────────────

export interface StageDashboardPayload {
  stages: (ProjectStageInstance & { daysInStage: number })[];
  currentStage: (ProjectStageInstance & { daysInStage: number }) | null;
  requirements: ProjectStageRequirement[];
  openExceptionCount: number;
  openDependencyCount: number;
  statusSentence: string;
}

/**
 * Get full stage dashboard data for a project.
 */
export async function getProjectStageDashboard(projectId: number): Promise<StageDashboardPayload> {
  const stages = await db
    .select()
    .from(projectStageInstances)
    .where(eq(projectStageInstances.projectId, projectId))
    .orderBy(projectStageInstances.stageCode);

  // Find current stage from project_execution_state
  const [execState] = await db
    .select({ currentStageCode: projectExecutionState.currentStageCode })
    .from(projectExecutionState)
    .where(eq(projectExecutionState.projectId, projectId));

  const currentStageCode = execState?.currentStageCode;
  const currentStage = stages.find((s: ProjectStageInstance) => s.stageCode === currentStageCode) || stages[0] || null;

  // Add daysInStage to each stage
  const stagesWithDays = stages.map((s: ProjectStageInstance) => ({
    ...s,
    daysInStage: computeDaysInStage(s.startedAt),
  }));

  const currentWithDays = currentStage
    ? { ...currentStage, daysInStage: computeDaysInStage(currentStage.startedAt) }
    : null;

  // Get requirements for current stage
  let requirements: ProjectStageRequirement[] = [];
  if (currentStage) {
    requirements = await db
      .select()
      .from(projectStageRequirements)
      .where(eq(projectStageRequirements.stageInstanceId, currentStage.id));
  }

  // Count open exceptions
  const [excCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectStageExceptions)
    .where(and(
      eq(projectStageExceptions.projectId, projectId),
      eq(projectStageExceptions.status, 'REQUESTED'),
    ));

  // Count open dependencies
  const { projectStageDependencies } = await import("@shared/schema");
  const [depCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectStageDependencies)
    .where(and(
      eq(projectStageDependencies.projectId, projectId),
      eq(projectStageDependencies.status, 'WAITING'),
    ));

  const unsatisfiedBlockers = currentStage
    ? getUnsatisfiedBlockers(requirements as any)
    : [];

  const statusSentence = currentWithDays
    ? generateStatusSentence({
        stageStatus: currentWithDays.stageStatus,
        readinessPct: currentWithDays.readinessPct,
        waitingOnDepartment: currentWithDays.waitingOnDepartment,
        waitingOnUserName: null,
        unsatisfiedBlockers,
        openExceptionCount: excCount?.count ?? 0,
      })
    : 'No stages initialized.';

  return {
    stages: stagesWithDays,
    currentStage: currentWithDays,
    requirements,
    openExceptionCount: excCount?.count ?? 0,
    openDependencyCount: depCount?.count ?? 0,
    statusSentence,
  };
}

// ── Sync ────────────────────────────────────────────────────

/**
 * Sync the current stage info from project_stage_instances
 * back to project_execution_state for fast reads.
 */
export async function syncCurrentStage(projectId: number): Promise<void> {
  const [execState] = await db
    .select()
    .from(projectExecutionState)
    .where(eq(projectExecutionState.projectId, projectId));

  if (!execState) return;

  const currentCode = execState.currentStageCode;
  if (!currentCode) return;

  const [instance] = await db
    .select()
    .from(projectStageInstances)
    .where(and(
      eq(projectStageInstances.projectId, projectId),
      eq(projectStageInstances.stageCode, currentCode),
    ));

  if (!instance) return;

  await db
    .update(projectExecutionState)
    .set({
      gateStatus: instance.stageStatus,
      gateReadinessPct: instance.readinessPct,
      stageOwnerUserId: instance.stageOwnerUserId,
      stageApproverUserId: instance.approverUserId,
      waitingOnDepartment: instance.waitingOnDepartment,
      waitingOnUserId: instance.waitingOnUserId,
      nextRequiredAction: instance.nextRequiredAction,
      updatedAt: new Date(),
    })
    .where(eq(projectExecutionState.projectId, projectId));
}

// ── Evidence ────────────────────────────────────────────────

export async function addEvidence(params: {
  projectId: number;
  stageCode: string;
  title: string;
  fileUrl: string;
  evidenceType?: string;
  uploadedByUserId: number;
  notes?: string;
}) {
  const [instance] = await db
    .select()
    .from(projectStageInstances)
    .where(and(
      eq(projectStageInstances.projectId, params.projectId),
      eq(projectStageInstances.stageCode, params.stageCode),
    ));

  if (!instance) throw new Error(`Stage instance not found`);

  const [evidence] = await db.insert(projectStageEvidence).values({
    projectId: params.projectId,
    stageInstanceId: instance.id,
    stageCode: params.stageCode,
    title: params.title,
    fileUrl: params.fileUrl,
    evidenceType: params.evidenceType || 'document',
    uploadedByUserId: params.uploadedByUserId,
    notes: params.notes,
  }).returning();

  return evidence;
}

export async function getStageEvidence(projectId: number, stageCode: string) {
  const [instance] = await db
    .select()
    .from(projectStageInstances)
    .where(and(
      eq(projectStageInstances.projectId, projectId),
      eq(projectStageInstances.stageCode, stageCode),
    ));

  if (!instance) return [];

  return db
    .select()
    .from(projectStageEvidence)
    .where(eq(projectStageEvidence.stageInstanceId, instance.id))
    .orderBy(projectStageEvidence.uploadedAt);
}

// ── Decisions ───────────────────────────────────────────────

export async function getStageDecisions(projectId: number) {
  return db
    .select()
    .from(projectStageDecisions)
    .where(eq(projectStageDecisions.projectId, projectId))
    .orderBy(projectStageDecisions.decidedDate);
}
