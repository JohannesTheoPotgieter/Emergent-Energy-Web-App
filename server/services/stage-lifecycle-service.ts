// ============================================================
// STAGE LIFECYCLE SERVICE — Core CRUD + business logic
// ============================================================

import { and, desc, eq, sql, isNull } from "drizzle-orm";
import {
  projectStageInstances,
  projectStageRequirements,
  projectStageEvidence,
  projectStageDecisions,
  projectStageExceptions,
  stageDefinitions,
  stageChecklistTemplates,
  stageGateEvidenceSnapshots,
  projectExecutionState,
  STAGE_CODES,
  type StageCode,
  type StageStatus,
  type InsertProjectStageInstance,
  type InsertProjectStageRequirement,
  type ProjectStageInstance,
  type ProjectStageRequirement,
  type StageGateEvidenceSnapshot,
  type StageGateTransitionType,
  type TrafficLight,
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

// ── B1: Stage Gate Evidence Snapshots — audit trail helpers ──

/**
 * Pure helper: convert a readiness percentage (0..100) to a traffic-light
 * classification. Thresholds match the B1 design:
 *   100       -> green   (all gate requirements met)
 *    80..99   -> amber   (most but not all)
 *     0..79   -> red     (significant gaps)
 */
export function computeTrafficLight(readinessScore: number): TrafficLight {
  if (readinessScore >= 100) return "green";
  if (readinessScore >= 80) return "amber";
  return "red";
}

type RequirementLike = {
  itemCode: string;
  itemName: string;
  department: string;
  status: string;
  blocksGate: boolean;
  evidenceAttached: boolean;
  notes?: string | null;
};

function summarizeRequirements(reqs: ProjectStageRequirement[]): {
  gatesTotal: number;
  gatesPassed: number;
  gatesMissing: number;
  requirementsSnapshot: RequirementLike[];
  missingItems: Array<{ itemCode: string; itemName: string; department: string; reason: string }>;
} {
  const gatesTotal = reqs.length;
  let gatesPassed = 0;
  const missingItems: Array<{ itemCode: string; itemName: string; department: string; reason: string }> = [];
  const requirementsSnapshot: RequirementLike[] = reqs.map((r) => {
    const isComplete = r.status === "COMPLETE";
    if (isComplete) gatesPassed += 1;
    else {
      missingItems.push({
        itemCode: r.itemCode,
        itemName: r.itemName,
        department: r.department,
        reason: r.blocksGate
          ? `Blocker not satisfied (status=${r.status}${r.evidenceAttached ? "" : ", no evidence attached"})`
          : `Optional item not complete (status=${r.status})`,
      });
    }
    return {
      itemCode: r.itemCode,
      itemName: r.itemName,
      department: r.department,
      status: r.status,
      blocksGate: r.blocksGate,
      evidenceAttached: r.evidenceAttached,
      notes: r.notes ?? null,
    };
  });

  return {
    gatesTotal,
    gatesPassed,
    gatesMissing: gatesTotal - gatesPassed,
    requirementsSnapshot,
    missingItems,
  };
}

/**
 * Capture a stage-gate evidence snapshot at the moment of a transition.
 * This NEVER blocks the transition — it is pure observability.
 *
 * Callers should invoke this after updating the stage instance but before
 * returning to the caller, so the transition result and the snapshot are
 * consistent with each other.
 *
 * Swallows all errors and logs them: a transient snapshot failure must
 * never take down a stage transition.
 */
export async function captureStageGateSnapshot(params: {
  projectId: number;
  fromStageCode: string;
  toStageCode: string;
  stageInstanceId: number;
  transitionType: StageGateTransitionType;
  actorUserId: number;
  reason?: string;
  notes?: string;
}): Promise<StageGateEvidenceSnapshot | null> {
  try {
    const reqs = await db
      .select()
      .from(projectStageRequirements)
      .where(eq(projectStageRequirements.stageInstanceId, params.stageInstanceId));

    const summary = summarizeRequirements(reqs);
    const readinessScore = computeReadinessPct(reqs);
    const blockersSatisfied = areGateBlockersSatisfied(reqs);
    const trafficLight = computeTrafficLight(readinessScore);

    // If the caller said "gate_approved" but blockers aren't satisfied,
    // downgrade to "gate_fail_audit" so the history is honest about why
    // the transition still proceeded.
    const effectiveTransitionType: StageGateTransitionType =
      params.transitionType === "gate_approved" && !blockersSatisfied
        ? "gate_fail_audit"
        : params.transitionType;

    const [row] = await db
      .insert(stageGateEvidenceSnapshots)
      .values({
        projectId: params.projectId,
        fromStageCode: params.fromStageCode,
        toStageCode: params.toStageCode,
        transitionType: effectiveTransitionType,
        advancedByUserId: params.actorUserId,
        readinessScore,
        gatesTotal: summary.gatesTotal,
        gatesPassed: summary.gatesPassed,
        gatesMissing: summary.gatesMissing,
        blockersSatisfied,
        trafficLight,
        requirementsSnapshot: summary.requirementsSnapshot as any,
        missingItems: summary.missingItems as any,
        reason: params.reason ?? null,
        notes: params.notes ?? null,
      })
      .returning();

    return row;
  } catch (err) {
    console.error("[StageGateSnapshot] Failed to capture snapshot (transition continues):", err);
    return null;
  }
}

/**
 * Return the evidence-snapshot history for a project in reverse chronological
 * order. Used by the Stage Gate History tab and project-level post-mortem views.
 */
export async function getStageGateHistory(projectId: number, limit = 200): Promise<StageGateEvidenceSnapshot[]> {
  return db
    .select()
    .from(stageGateEvidenceSnapshots)
    .where(eq(stageGateEvidenceSnapshots.projectId, projectId))
    .orderBy(desc(stageGateEvidenceSnapshots.advancedAt))
    .limit(limit);
}

/**
 * Compute the *current* (not historical) readiness of a stage for a project.
 * Reads live from projectStageRequirements. Used by project headers and
 * dashboards to show "Stage Gate Readiness" as a badge before any transition.
 */
export async function computeCurrentStageGateReadiness(projectId: number, stageCode: string): Promise<{
  stageCode: string;
  readinessScore: number;
  trafficLight: TrafficLight;
  gatesTotal: number;
  gatesPassed: number;
  gatesMissing: number;
  blockersSatisfied: boolean;
  missing: Array<{ itemCode: string; itemName: string; department: string; reason: string }>;
} | null> {
  const [instance] = await db
    .select()
    .from(projectStageInstances)
    .where(and(
      eq(projectStageInstances.projectId, projectId),
      eq(projectStageInstances.stageCode, stageCode),
    ));
  if (!instance) return null;

  const reqs = await db
    .select()
    .from(projectStageRequirements)
    .where(eq(projectStageRequirements.stageInstanceId, instance.id));

  const summary = summarizeRequirements(reqs);
  const readinessScore = computeReadinessPct(reqs);
  return {
    stageCode,
    readinessScore,
    trafficLight: computeTrafficLight(readinessScore),
    gatesTotal: summary.gatesTotal,
    gatesPassed: summary.gatesPassed,
    gatesMissing: summary.gatesMissing,
    blockersSatisfied: areGateBlockersSatisfied(reqs),
    missing: summary.missingItems,
  };
}

// ── Initialize ──────────────────────────────────────────────

/**
 * Create all 10 stage instances for a project.
 * Skips any that already exist (idempotent).
 */
// Post-merge (migration 20260413_stage_lifecycle_merge): 8 active stages.
// S04_PD_PM_HANDOVER folded into S03, S05_FINANCIAL_REVIEW folded into S02.
const DEFAULT_STAGE_DEFS = [
  { stageCode: 'S01_FIRST_ASSESSMENT', stageName: 'First Assessment', stageSequence: 1, description: 'Initial site and feasibility assessment', defaultOwnerRole: 'PD', defaultApproverRole: 'COO' },
  { stageCode: 'S02_DESIGN_COST_PROPOSAL', stageName: 'Design & Cost Proposal', stageSequence: 2, description: 'Engineering design, costing, and pre-construction financial review (absorbed from former S05).', defaultOwnerRole: 'ENGINEERING', defaultApproverRole: 'COO' },
  { stageCode: 'S03_SIGNATURE_FINANCIAL_CLOSE', stageName: 'Financial Close', stageSequence: 3, description: 'Contract signature, financial close, and PD-to-PM handover (absorbed from former S04).', defaultOwnerRole: 'PD', defaultApproverRole: 'CFO' },
  { stageCode: 'S06_CONSTRUCTION', stageName: 'Construction', stageSequence: 6, description: 'On-site construction phase', defaultOwnerRole: 'PM', defaultApproverRole: 'COO' },
  { stageCode: 'S07_COMMISSIONING', stageName: 'Commissioning', stageSequence: 7, description: 'System testing and commissioning', defaultOwnerRole: 'ENGINEERING', defaultApproverRole: 'COO' },
  { stageCode: 'S08_OM_HANDOVER', stageName: 'O&M Handover', stageSequence: 8, description: 'Handover to operations and maintenance', defaultOwnerRole: 'PM', defaultApproverRole: 'COO' },
  { stageCode: 'S09_CLIENT_HANDOVER', stageName: 'Client Handover', stageSequence: 9, description: 'Final handover to the client', defaultOwnerRole: 'PM', defaultApproverRole: 'COO' },
  { stageCode: 'S10_POST_HANDOVER_REVIEW', stageName: 'Post-Handover Review', stageSequence: 10, description: 'Post-completion review and lessons learned', defaultOwnerRole: 'PM', defaultApproverRole: 'COO' },
];

async function ensureStageDefinitions() {
  const existing = await db.select().from(stageDefinitions).where(eq(stageDefinitions.isActive, true));
  // Post-merge there are 8 active stages. The check is ">=" so a future
  // addition still triggers re-seed.
  if (existing.length >= DEFAULT_STAGE_DEFS.length) return;
  const existingCodes = new Set(existing.map((e: any) => e.stageCode));
  const toSeed = DEFAULT_STAGE_DEFS.filter(d => !existingCodes.has(d.stageCode));
  if (toSeed.length > 0) {
    await db.insert(stageDefinitions).values(toSeed).onConflictDoNothing();
    console.log(`[Stage Lifecycle] Seeded ${toSeed.length} stage definitions`);
  }
}

export async function initializeProjectStages(projectId: number): Promise<ProjectStageInstance[]> {
  await ensureStageDefinitions();

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

  // Set current_stage_code on project_execution_state
  if (definitions.length > 0) {
    const [execState] = await db
      .select({ currentStageCode: projectExecutionState.currentStageCode })
      .from(projectExecutionState)
      .where(eq(projectExecutionState.projectId, projectId));

    if (execState && !execState.currentStageCode) {
      await db
        .update(projectExecutionState)
        .set({ currentStageCode: definitions[0].stageCode, updatedAt: new Date() })
        .where(eq(projectExecutionState.projectId, projectId));
    } else if (!execState) {
      await db.insert(projectExecutionState).values({
        projectId,
        currentStageCode: definitions[0].stageCode,
      }).onConflictDoNothing();
    }
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
export interface HydrateStageChecklistResult {
  templatesFound: number;
  createdCount: number;
  requirements: ProjectStageRequirement[];
}

export async function hydrateStageChecklist(projectId: number, stageCode: string): Promise<HydrateStageChecklistResult> {
  const [instance] = await db
    .select()
    .from(projectStageInstances)
    .where(and(
      eq(projectStageInstances.projectId, projectId),
      eq(projectStageInstances.stageCode, stageCode),
    ));

  if (!instance) {
    throw new Error(`Cannot hydrate checklist: stage instance does not exist for project ${projectId}, stage ${stageCode}.`);
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

  const templatesFound = templates.length;
  const createdCount = toCreate.length;

  if (createdCount > 0) {
    await db.insert(projectStageRequirements).values(toCreate);
  }

  const requirements = await db
    .select()
    .from(projectStageRequirements)
    .where(eq(projectStageRequirements.stageInstanceId, instance.id))
    .orderBy(projectStageRequirements.department, projectStageRequirements.itemCode);

  return {
    templatesFound,
    createdCount,
    requirements,
  };
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

  // B1 (audit closeout): stage gates NEVER block a transition. We record
  // what evidence was captured at this moment in stage_gate_evidence_snapshots
  // and proceed regardless of blocker state. Post-mortems can query the
  // snapshot history to explain why a project failed six months later.
  //
  // The snapshot write happens after the status update below so that the
  // captured `to_stage_code` is the effective new status.

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

  // B1: capture stage gate evidence snapshot for post-mortem. Non-blocking.
  if (newStatus === 'APPROVED' || newStatus === 'PROGRESSED') {
    const transitionType = isAdmin
      ? 'admin_advance'
      : (newStatus === 'APPROVED' ? 'gate_approved' : 'gate_progressed');
    await captureStageGateSnapshot({
      projectId,
      fromStageCode: stageCode,
      toStageCode: stageCode,    // same stage transitioning status; from/to refer to the stage being closed out
      stageInstanceId: instance.id,
      transitionType,
      actorUserId,
      reason,
    });
  }

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

export async function advanceToStage(params: {
  projectId: number;
  targetStageCode: StageCode;
  actorUserId: number;
  actorRole: string;
  reason?: string;
}): Promise<{ skipped: string[]; currentStage: string }> {
  const { projectId, targetStageCode, actorUserId, reason } = params;
  const targetSeq = STAGE_SEQUENCE[targetStageCode];
  if (!targetSeq) throw new Error(`Unknown stage code: ${targetStageCode}`);

  const instances = await db
    .select()
    .from(projectStageInstances)
    .where(eq(projectStageInstances.projectId, projectId));

  if (instances.length === 0) throw new Error("No stage instances found. Initialize lifecycle first.");

  const skipped: string[] = [];
  const now = new Date();

  for (const inst of instances) {
    const seq = STAGE_SEQUENCE[inst.stageCode as StageCode];
    if (seq === undefined) continue;

    if (seq < targetSeq && inst.stageStatus !== 'PROGRESSED') {
      await db
        .update(projectStageInstances)
        .set({
          stageStatus: 'PROGRESSED',
          startedAt: inst.startedAt || now,
          completedAt: now,
          readinessPct: 100,
          updatedAt: now,
        })
        .where(eq(projectStageInstances.id, inst.id));

      await db.insert(projectStageDecisions).values({
        projectId,
        stageCode: inst.stageCode,
        decisionType: 'STAGE_OVERRIDE',
        decisionSummary: `Stage ${inst.stageCode} bulk-advanced to PROGRESSED (admin skip-to ${targetStageCode})${reason ? ': ' + reason : ''}`,
        decidedByUserId: actorUserId,
        decidedDate: now,
        rationale: reason || 'Admin bulk advance — aligning project with current reality',
      });

      // B1: snapshot evidence BEFORE the instance was marked PROGRESSED so
      // the history reflects what was really captured at the moment of skip.
      // We fetch requirements again to preserve the original state.
      await captureStageGateSnapshot({
        projectId,
        fromStageCode: inst.stageCode,
        toStageCode: targetStageCode,
        stageInstanceId: inst.id,
        transitionType: 'admin_advance',
        actorUserId,
        reason: reason || 'Admin bulk advance — aligning project with current reality',
      });

      skipped.push(inst.stageCode);
    }

    if (seq === targetSeq && inst.stageStatus === 'NOT_STARTED') {
      await db
        .update(projectStageInstances)
        .set({
          stageStatus: 'IN_PROGRESS',
          startedAt: now,
          updatedAt: now,
        })
        .where(eq(projectStageInstances.id, inst.id));

      await db.insert(projectStageDecisions).values({
        projectId,
        stageCode: inst.stageCode,
        decisionType: 'STAGE_OVERRIDE',
        decisionSummary: `Stage ${inst.stageCode} set to IN_PROGRESS (admin advance target)${reason ? ': ' + reason : ''}`,
        decidedByUserId: actorUserId,
        decidedDate: now,
        rationale: reason || 'Admin bulk advance — aligning project with current reality',
      });
    }
  }

  await db
    .update(projectExecutionState)
    .set({
      currentStageCode: targetStageCode,
      updatedAt: now,
    })
    .where(eq(projectExecutionState.projectId, projectId));

  await syncCurrentStage(projectId);

  return { skipped, currentStage: targetStageCode };
}
