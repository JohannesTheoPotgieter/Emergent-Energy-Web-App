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
  projectInfo,
  STAGE_CODES,
  TERMINAL_STAGE_CODES,
  SEQUENTIAL_STAGE_CODES,
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

    // W5: Capture integration freshness at stage gate transition time.
    // Non-blocking — a freshness check failure never blocks a transition.
    let integrationNotes = params.notes ?? null;
    try {
      const { getIntegrationFreshnessReport } = await import("./integration-freshness-service");
      const freshness = await getIntegrationFreshnessReport();
      if (freshness.warnings.length > 0) {
        const prefix = integrationNotes ? `${integrationNotes}\n\n` : "";
        integrationNotes = `${prefix}[Integration freshness at transition: ${freshness.overallHealth}] ${freshness.warnings.join(" | ")}`;
      }
    } catch {
      // Integration freshness check is non-blocking
    }

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
        notes: integrationNotes,
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
// Post-merge (migration 20260413_stage_lifecycle_merge): originally 8 active
// stages. Planning (S04_PLANNING) re-introduced 2026-04-21 as a standalone
// PM-owned stage between Financial Close and Construction, matching the
// canonical phase model in shared/phases.ts. Legacy S04_PD_PM_HANDOVER is
// still folded into S03; S05_FINANCIAL_REVIEW is still folded into S02.
// Canonical 12-phase model (2026-04-24, migration 0030_canonical_lifecycle_phases_v2):
// 10 sequential stages (S01..S04, S06..S10, S9B) ordered by stage_sequence,
// plus 2 terminal branch stages (S_HOLD, S_DONE) which carry no sequence and
// are filtered out of the linear progression.
//
// stage_sequence values 1..10 are dense and contiguous so that lifecycle
// boards can sort by sequence without gaps. The numeric value is purely an
// ordering key — the canonical "position" is owned by displayNumber in
// shared/phases.ts (PHASE_BY_CODE.<CODE>.displayNumber). Note: 3 Months Post
// HO Review (S10) sits at position 9 and Compliance Handover (S9B) at
// position 10 — the swap is intentional and matches shared/phases.ts and
// migration 0030 (which sets the same sequence values in stage_definitions).
const DEFAULT_STAGE_DEFS = [
  { stageCode: 'S01_FIRST_ASSESSMENT',          stageName: 'First Assessment',         stageSequence: 1,  description: 'Initial site and feasibility assessment',                                                                       defaultOwnerRole: 'PD',          defaultApproverRole: 'COO' },
  { stageCode: 'S02_DESIGN_COST_PROPOSAL',      stageName: 'Cost Proposal & Design',   stageSequence: 2,  description: 'Engineering design, costing, and pre-construction financial review (absorbed from former S05).',                defaultOwnerRole: 'ENGINEERING', defaultApproverRole: 'COO' },
  { stageCode: 'S03_SIGNATURE_FINANCIAL_CLOSE', stageName: 'Financial Close',          stageSequence: 3,  description: 'Contract signature, financial close, and PD-to-PM handover (absorbed from former S04).',                       defaultOwnerRole: 'PD',          defaultApproverRole: 'CFO' },
  { stageCode: 'S04_PLANNING',                  stageName: 'Planning',                 stageSequence: 4,  description: 'Detailed design release, procurement kick-off, and construction-readiness planning by the PM team.',           defaultOwnerRole: 'PM',          defaultApproverRole: 'COO' },
  { stageCode: 'S06_CONSTRUCTION',              stageName: 'Construction',             stageSequence: 5,  description: 'On-site construction phase',                                                                                     defaultOwnerRole: 'PM',          defaultApproverRole: 'COO' },
  { stageCode: 'S07_COMMISSIONING',             stageName: 'Commissioning',            stageSequence: 6,  description: 'System testing and commissioning',                                                                               defaultOwnerRole: 'ENGINEERING', defaultApproverRole: 'COO' },
  { stageCode: 'S08_OM_HANDOVER',               stageName: 'O&M Handover',             stageSequence: 7,  description: 'Handover to operations and maintenance',                                                                         defaultOwnerRole: 'PM',          defaultApproverRole: 'COO' },
  { stageCode: 'S09_CLIENT_HANDOVER',           stageName: 'Client Handover',          stageSequence: 8,  description: 'Final handover to the client',                                                                                   defaultOwnerRole: 'PM',          defaultApproverRole: 'COO' },
  { stageCode: 'S10_POST_HANDOVER_REVIEW',      stageName: '3 Months Post HO Review',  stageSequence: 9,  description: '3-months-after-handover review and lessons learned. Sits at position 9 ahead of compliance handover.',          defaultOwnerRole: 'PM',          defaultApproverRole: 'COO' },
  { stageCode: 'S9B_COMPLIANCE_HANDOVER',       stageName: 'Compliance Handover',      stageSequence: 10, description: 'Final regulatory and compliance handover documentation; closes the project lifecycle.',                         defaultOwnerRole: 'PM',          defaultApproverRole: 'COO' },
  { stageCode: 'S_HOLD',                        stageName: 'Hold',                     stageSequence: 0,  description: 'Resumable terminal branch — projects placed on hold preserve their prior phase in project_execution_state.previous_phase.', defaultOwnerRole: 'PM', defaultApproverRole: 'COO' },
  { stageCode: 'S_DONE',                        stageName: 'Done',                     stageSequence: 0,  description: 'Permanent terminal branch — closed, completed, or cancelled projects.',                                         defaultOwnerRole: 'PM',          defaultApproverRole: 'COO' },
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

  // Terminal branch stages (S_HOLD, S_DONE) are NOT pre-created on
  // initialisation — they are inserted on-demand by the placeProjectOnHold/
  // markProjectDone transition handlers below. Filtering by stage_code
  // keeps us decoupled from the row shape returned by drizzle.
  const sequentialDefs = definitions.filter(
    (d: typeof definitions[number]) => !TERMINAL_STAGE_CODES.has(d.stageCode as StageCode),
  );

  for (const def of sequentialDefs) {
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

  // Set current_stage_code on project_execution_state. We must use the
  // first SEQUENTIAL stage (S01_FIRST_ASSESSMENT) — sequentialDefs is
  // ordered by stage_sequence so [0] is the canonical entry point.
  if (sequentialDefs.length > 0) {
    const firstSequentialCode = sequentialDefs[0].stageCode;
    const [execState] = await db
      .select({ currentStageCode: projectExecutionState.currentStageCode })
      .from(projectExecutionState)
      .where(eq(projectExecutionState.projectId, projectId));

    if (execState && !execState.currentStageCode) {
      await db
        .update(projectExecutionState)
        .set({ currentStageCode: firstSequentialCode, updatedAt: new Date() })
        .where(eq(projectExecutionState.projectId, projectId));
    } else if (!execState) {
      await db.insert(projectExecutionState).values({
        projectId,
        currentStageCode: firstSequentialCode,
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

  // §6b: only the current version of each template item seeds new project
  // requirements. Without the isCurrentVersion filter, hydrate would pick
  // up every historical version and duplicate rows after any template edit.
  const templates = await db
    .select()
    .from(stageChecklistTemplates)
    .where(and(
      eq(stageChecklistTemplates.stageCode, stageCode),
      eq(stageChecklistTemplates.isActive, true),
      eq(stageChecklistTemplates.isCurrentVersion, true),
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
        // §6b: pin the template version so a future sync can diff cleanly.
        sourceTemplateId: t.id,
        templateVersionAtHydrate: t.version,
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

// ── §6b: Template-vs-Open-Stages Diff + Sync ────────────────

export interface RequirementAdd {
  itemCode: string;
  itemName: string;
  department: string;
  blocksGate: boolean;
  templateId: number;
  templateVersion: number;
}

export interface RequirementUpdate {
  requirementId: number;
  itemCode: string;
  fromVersion: number | null;
  toVersion: number;
  changes: {
    itemName?: { from: string; to: string };
    department?: { from: string; to: string };
    blocksGate?: { from: boolean; to: boolean };
  };
  templateId: number;
}

export interface RequirementRemove {
  requirementId: number;
  itemCode: string;
  itemName: string;
  department: string;
  currentStatus: string;
}

export interface StageSyncPlan {
  projectId: number;
  stageInstanceId: number;
  stageCode: string;
  stageStatus: string;
  skipped: boolean;
  skipReason?: string;
  toAdd: RequirementAdd[];
  toUpdate: RequirementUpdate[];
  toRemove: RequirementRemove[];
}

/**
 * Compute, per project, what would change on the named stage if the
 * current-version templates were applied. Closed stages are returned
 * with `skipped: true` and an empty plan — their snapshots are sacred
 * (§6). A dry-run-safe function; no writes.
 */
export async function diffTemplateVsOpenStages(stageCode: string): Promise<StageSyncPlan[]> {
  const templates = await db
    .select()
    .from(stageChecklistTemplates)
    .where(and(
      eq(stageChecklistTemplates.stageCode, stageCode),
      eq(stageChecklistTemplates.isActive, true),
      eq(stageChecklistTemplates.isCurrentVersion, true),
    ));

  const templateByItemCode = new Map<string, typeof templates[number]>();
  for (const t of templates) templateByItemCode.set(t.itemCode, t);

  const stages = await db
    .select()
    .from(projectStageInstances)
    .where(eq(projectStageInstances.stageCode, stageCode));

  const plans: StageSyncPlan[] = [];
  for (const stage of stages) {
    const stageStatus = stage.stageStatus?.toLowerCase() ?? '';
    if (CLOSED_STAGE_STATUSES.has(stageStatus)) {
      plans.push({
        projectId: stage.projectId,
        stageInstanceId: stage.id,
        stageCode,
        stageStatus,
        skipped: true,
        skipReason: `Stage is ${stageStatus}; snapshot is immutable.`,
        toAdd: [],
        toUpdate: [],
        toRemove: [],
      });
      continue;
    }

    const existing = await db
      .select()
      .from(projectStageRequirements)
      .where(eq(projectStageRequirements.stageInstanceId, stage.id));

    const existingByItemCode = new Map<string, typeof existing[number]>();
    for (const r of existing) existingByItemCode.set(r.itemCode, r);

    const toAdd: RequirementAdd[] = [];
    const toUpdate: RequirementUpdate[] = [];
    const toRemove: RequirementRemove[] = [];

    for (const t of templates) {
      const match = existingByItemCode.get(t.itemCode);
      if (!match) {
        toAdd.push({
          itemCode: t.itemCode,
          itemName: t.itemName,
          department: t.department,
          blocksGate: t.blocksGate,
          templateId: t.id,
          templateVersion: t.version,
        });
        continue;
      }
      if (match.templateVersionAtHydrate === t.version) continue;
      const changes: RequirementUpdate['changes'] = {};
      if (match.itemName !== t.itemName) changes.itemName = { from: match.itemName, to: t.itemName };
      if (match.department !== t.department) changes.department = { from: match.department, to: t.department };
      if (match.blocksGate !== t.blocksGate) changes.blocksGate = { from: match.blocksGate, to: t.blocksGate };
      if (Object.keys(changes).length === 0 && match.templateVersionAtHydrate === t.version) continue;
      toUpdate.push({
        requirementId: match.id,
        itemCode: match.itemCode,
        fromVersion: match.templateVersionAtHydrate,
        toVersion: t.version,
        changes,
        templateId: t.id,
      });
    }

    for (const r of existing) {
      if (!templateByItemCode.has(r.itemCode)) {
        // Manual/project-specific requirements (no source template) are
        // explicitly protected from template sync removals.
        if (!r.sourceTemplateId) continue;
        toRemove.push({
          requirementId: r.id,
          itemCode: r.itemCode,
          itemName: r.itemName,
          department: r.department,
          currentStatus: r.status,
        });
      }
    }

    plans.push({
      projectId: stage.projectId,
      stageInstanceId: stage.id,
      stageCode,
      stageStatus,
      skipped: false,
      toAdd,
      toUpdate,
      toRemove,
    });
  }

  return plans;
}

export interface ApplyTemplateSyncParams {
  stageCode: string;
  actorUserId: number;
  actorRole: string;
  reason: string;
}

export interface ApplyTemplateSyncResult {
  stageCode: string;
  projectsTouched: number;
  projectsSkipped: number;
  added: number;
  updated: number;
  removed: number;
}

/**
 * Apply the diff computed by diffTemplateVsOpenStages. COO_ADMIN / CEO_ADMIN
 * only. Closed stages are skipped. Each touched project gets a
 * `template_sync` decision row so the audit trail points at who pulled
 * the new template version onto which stages and why.
 *
 * Removals here soft-drop the requirement row (hard delete) because it is
 * no longer in the current template. Projects that need to retain a
 * deprecated requirement must hold it via a project-level template
 * override (already supported by template-governance-routes.ts).
 */
export async function applyTemplateSync(params: ApplyTemplateSyncParams): Promise<ApplyTemplateSyncResult> {
  const { stageCode, actorUserId, actorRole, reason } = params;

  if (!STAGE_REOPEN_ROLES.has(actorRole)) {
    throw new Error(`Only COO_ADMIN or CEO_ADMIN may apply a template sync; actor role=${actorRole}.`);
  }
  if (!reason || reason.trim().length < 10) {
    throw new Error(`Template sync requires a reason of at least 10 characters.`);
  }

  const plans = await diffTemplateVsOpenStages(stageCode);

  let projectsTouched = 0;
  let projectsSkipped = 0;
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const plan of plans) {
    if (plan.skipped) { projectsSkipped += 1; continue; }
    const hasChanges = plan.toAdd.length + plan.toUpdate.length + plan.toRemove.length > 0;
    if (!hasChanges) continue;

    for (const add of plan.toAdd) {
      await db.insert(projectStageRequirements).values({
        projectId: plan.projectId,
        stageInstanceId: plan.stageInstanceId,
        stageCode: plan.stageCode,
        department: add.department,
        itemName: add.itemName,
        itemCode: add.itemCode,
        blocksGate: add.blocksGate,
        status: 'not_started',
        sourceTemplateId: add.templateId,
        templateVersionAtHydrate: add.templateVersion,
      });
      added += 1;
    }

    for (const upd of plan.toUpdate) {
      const patch: Record<string, any> = {
        templateVersionAtHydrate: upd.toVersion,
        sourceTemplateId: upd.templateId,
        updatedAt: new Date(),
      };
      if (upd.changes.itemName) patch.itemName = upd.changes.itemName.to;
      if (upd.changes.department) patch.department = upd.changes.department.to;
      if (upd.changes.blocksGate !== undefined) patch.blocksGate = upd.changes.blocksGate.to;
      await db.update(projectStageRequirements).set(patch).where(eq(projectStageRequirements.id, upd.requirementId));
      updated += 1;
    }

    for (const rm of plan.toRemove) {
      await db.delete(projectStageRequirements).where(eq(projectStageRequirements.id, rm.requirementId));
      removed += 1;
    }

    await db.insert(projectStageDecisions).values({
      projectId: plan.projectId,
      stageCode: plan.stageCode,
      decisionType: 'template_sync',
      decisionSummary: `Template sync applied to stage ${plan.stageCode}: +${plan.toAdd.length} / ~${plan.toUpdate.length} / -${plan.toRemove.length}`,
      decidedByUserId: actorUserId,
      decidedDate: new Date(),
      rationale: reason.trim(),
    });

    // Requirement set changed — recompute readiness.
    const refreshed = await db
      .select()
      .from(projectStageRequirements)
      .where(eq(projectStageRequirements.stageInstanceId, plan.stageInstanceId));
    const readiness = computeReadinessPct(refreshed);
    await db
      .update(projectStageInstances)
      .set({ readinessPct: readiness, updatedAt: new Date() })
      .where(eq(projectStageInstances.id, plan.stageInstanceId));
    await syncCurrentStage(plan.projectId);

    projectsTouched += 1;
  }

  return { stageCode, projectsTouched, projectsSkipped, added, updated, removed };
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

  if (newStatus === 'in_progress' && !instance.startedAt) {
    updateData.startedAt = new Date();
  }
  if (newStatus === 'progressed' || newStatus === 'approved') {
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
    decisionType: isAdmin ? 'stage_override' : (newStatus === 'approved' ? 'gate_pass' : 'gate_fail'),
    decisionSummary: `Stage ${stageCode} transitioned from ${currentStatus} to ${newStatus}${reason ? ': ' + reason : ''}`,
    decidedByUserId: actorUserId,
    decidedDate: new Date(),
    rationale: reason || null,
  });

  // B1: capture stage gate evidence snapshot for post-mortem. Non-blocking.
  if (newStatus === 'approved' || newStatus === 'progressed') {
    const transitionType = isAdmin
      ? 'admin_advance'
      : (newStatus === 'approved' ? 'gate_approved' : 'gate_progressed');
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

// §6: once a stage has been closed (gate decision recorded + snapshot taken),
// its requirements become audit records. Editing them silently would change
// the historical readinessPct without leaving a trail — see
// captureStageGateSnapshot. Only COO_ADMIN / CEO_ADMIN may reopen, and they
// must provide a justification which is persisted to project_stage_decisions.
export const CLOSED_STAGE_STATUSES = new Set<string>([
  'approved',
  'progressed',
  'exception_approved',
]);

export const STAGE_REOPEN_ROLES = new Set<string>([
  'COO_ADMIN',
  'CEO_ADMIN',
]);

export interface UpdateRequirementParams {
  requirementId: number;
  status: string;
  actorUserId: number;
  actorRole?: string;
  evidenceUrl?: string;
  notes?: string;
  reopenReason?: string;
}

/**
 * Update a requirement status and recalculate readiness.
 */
export async function updateRequirementStatus(params: UpdateRequirementParams) {
  const { requirementId, status, actorUserId, actorRole, evidenceUrl, notes, reopenReason } = params;

  const [req] = await db
    .select()
    .from(projectStageRequirements)
    .where(eq(projectStageRequirements.id, requirementId));

  if (!req) {
    throw new Error(`Requirement ${requirementId} not found`);
  }

  // §6 immutability guard: block edits on requirements whose parent stage
  // has already closed, unless an authorised role supplies a reopen reason.
  const [parentStage] = await db
    .select()
    .from(projectStageInstances)
    .where(eq(projectStageInstances.id, req.stageInstanceId));

  const parentStatus = parentStage?.stageStatus?.toLowerCase() ?? '';
  if (parentStage && CLOSED_STAGE_STATUSES.has(parentStatus)) {
    if (!actorRole || !STAGE_REOPEN_ROLES.has(actorRole)) {
      throw new Error(
        `Stage ${parentStage.stageCode} is closed (${parentStatus}); only COO_ADMIN or CEO_ADMIN may modify its requirements.`,
      );
    }
    if (!reopenReason || reopenReason.trim().length < 10) {
      throw new Error(
        `Reopening a closed stage requires a reopenReason of at least 10 characters.`,
      );
    }
    await db.insert(projectStageDecisions).values({
      projectId: req.projectId,
      stageCode: req.stageCode,
      decisionType: 'stage_reopen',
      decisionSummary: `Requirement ${req.itemCode} modified on closed stage ${parentStage.stageCode} (status=${parentStatus})`,
      decidedByUserId: actorUserId,
      decidedDate: new Date(),
      rationale: reopenReason.trim(),
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// TERMINAL BRANCH TRANSITIONS — Hold / Resume / Done
// ─────────────────────────────────────────────────────────────────────────────
// These handlers move a project into one of the two terminal "branch" phases
// (S_HOLD, S_DONE) and back. They were added 2026-04-24 alongside migration
// 0030_canonical_lifecycle_phases_v2.sql which introduced the terminal codes
// and the project_execution_state.previous_phase column.
//
// Contract:
//   - placeProjectOnHold: captures the outgoing sequential stage code on
//     project_execution_state.previous_phase, ensures an S_HOLD stage
//     instance exists, sets project_status='hold', and records a
//     STAGE_OVERRIDE decision for the audit trail.
//   - resumeProjectFromHold: reads previous_phase, restores it as the
//     current stage, sets project_status='active', clears previous_phase,
//     and records the resume in the decisions table. Throws if the project
//     is not currently on S_HOLD or if there is no previous_phase recorded.
//   - markProjectDone: ensures an S_DONE stage instance exists, sets
//     project_status='closed', and records the closure decision. Done is
//     permanent — there is no resume from S_DONE.
//
// All three are intentionally additive: they do not delete the prior
// sequential stage instances, so the historical audit trail (gate
// evaluations, evidence, decisions) is preserved across the round-trip.

interface TerminalTransitionParams {
  projectId: number;
  actorUserId: number;
  reason?: string;
}

async function ensureTerminalStageInstance(
  projectId: number,
  stageCode: 'S_HOLD' | 'S_DONE',
  now: Date,
): Promise<ProjectStageInstance> {
  const [existing] = await db
    .select()
    .from(projectStageInstances)
    .where(
      and(
        eq(projectStageInstances.projectId, projectId),
        eq(projectStageInstances.stageCode, stageCode),
      ),
    );

  if (existing) {
    const [updated] = await db
      .update(projectStageInstances)
      .set({
        stageStatus: 'IN_PROGRESS',
        startedAt: existing.startedAt ?? now,
        updatedAt: now,
      })
      .where(eq(projectStageInstances.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(projectStageInstances)
    .values({
      projectId,
      stageCode,
      stageStatus: 'IN_PROGRESS',
      readinessPct: 0,
      startedAt: now,
    })
    .returning();
  return created;
}

export async function placeProjectOnHold(params: TerminalTransitionParams): Promise<{
  previousPhase: StageCode | null;
  stageInstanceId: number;
}> {
  const { projectId, actorUserId, reason } = params;
  const now = new Date();

  // Read current sequential stage so we can preserve it for resume.
  const [execState] = await db
    .select({
      currentStageCode: projectExecutionState.currentStageCode,
      previousPhase: projectExecutionState.previousPhase,
    })
    .from(projectExecutionState)
    .where(eq(projectExecutionState.projectId, projectId));

  const outgoing = execState?.currentStageCode as StageCode | null | undefined;
  // Only preserve the outgoing stage when it is a real sequential phase —
  // never overwrite previous_phase with another terminal code.
  const previousToPersist =
    outgoing && !TERMINAL_STAGE_CODES.has(outgoing) ? outgoing : execState?.previousPhase ?? null;

  const holdInstance = await ensureTerminalStageInstance(projectId, 'S_HOLD', now);

  // Defensive upsert: a brand-new project may not have an exec state row
  // yet (initialiseStages is not always run before a manual hold). A
  // plain UPDATE would silently no-op and leave the project_status flip
  // hanging without a current_stage_code, so use ON CONFLICT to either
  // insert the row or update it in a single statement.
  await db
    .insert(projectExecutionState)
    .values({
      projectId,
      currentStageCode: 'S_HOLD',
      previousPhase: previousToPersist ?? null,
    })
    .onConflictDoUpdate({
      target: projectExecutionState.projectId,
      set: {
        currentStageCode: 'S_HOLD',
        previousPhase: previousToPersist ?? null,
        updatedAt: now,
      },
    });

  await db
    .update(projectInfo)
    .set({ projectStatus: 'hold', updatedAt: now })
    .where(eq(projectInfo.id, projectId));

  await db.insert(projectStageDecisions).values({
    projectId,
    stageCode: 'S_HOLD',
    decisionType: 'STAGE_OVERRIDE',
    decisionSummary: `Project placed on hold${
      previousToPersist ? ` (preserved phase ${previousToPersist} for resume)` : ''
    }${reason ? ': ' + reason : ''}`,
    decidedByUserId: actorUserId,
    decidedDate: now,
    rationale: reason ?? 'Placed on hold via terminal-branch transition',
  });

  return {
    previousPhase: (previousToPersist ?? null) as StageCode | null,
    stageInstanceId: holdInstance.id,
  };
}

export async function resumeProjectFromHold(params: TerminalTransitionParams): Promise<{
  resumedTo: StageCode;
}> {
  const { projectId, actorUserId, reason } = params;
  const now = new Date();

  const [execState] = await db
    .select({
      currentStageCode: projectExecutionState.currentStageCode,
      previousPhase: projectExecutionState.previousPhase,
    })
    .from(projectExecutionState)
    .where(eq(projectExecutionState.projectId, projectId));

  if (!execState) {
    throw new Error(`Cannot resume: project ${projectId} has no execution state`);
  }
  if (execState.currentStageCode !== 'S_HOLD') {
    throw new Error(
      `Cannot resume: project ${projectId} is not on S_HOLD (current=${execState.currentStageCode ?? 'null'})`,
    );
  }
  const target = execState.previousPhase as StageCode | null;
  if (!target) {
    throw new Error(
      `Cannot resume: project ${projectId} has no previous_phase recorded — use advanceToStage to pick a stage explicitly`,
    );
  }
  if (TERMINAL_STAGE_CODES.has(target)) {
    throw new Error(
      `Cannot resume: previous_phase is itself a terminal code (${target}). Use advanceToStage instead.`,
    );
  }
  // Defence-in-depth: previous_phase is written straight into
  // current_stage_code below. If a legacy backfill or a manual SQL edit
  // ever leaves a non-canonical label here (e.g. "Construction" from a
  // pre-task-#81 export), refuse rather than corrupt the lifecycle row.
  // Migration 0030_canonical_lifecycle_phases_v2.sql step 7a guarantees
  // canonical codes for held projects, but this guard keeps the contract
  // safe against future regressions.
  if (!(SEQUENTIAL_STAGE_CODES as readonly string[]).includes(target)) {
    throw new Error(
      `Cannot resume: previous_phase '${target}' is not a canonical sequential stage code — use advanceToStage to pick a stage explicitly`,
    );
  }

  // Close out the S_HOLD instance so the audit trail shows it as ended.
  await db
    .update(projectStageInstances)
    .set({
      stageStatus: 'PROGRESSED',
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(projectStageInstances.projectId, projectId),
        eq(projectStageInstances.stageCode, 'S_HOLD'),
      ),
    );

  await db
    .update(projectExecutionState)
    .set({
      currentStageCode: target,
      previousPhase: null,
      updatedAt: now,
    })
    .where(eq(projectExecutionState.projectId, projectId));

  await db
    .update(projectInfo)
    .set({ projectStatus: 'active', updatedAt: now })
    .where(eq(projectInfo.id, projectId));

  await db.insert(projectStageDecisions).values({
    projectId,
    stageCode: 'S_HOLD',
    decisionType: 'STAGE_OVERRIDE',
    decisionSummary: `Project resumed from hold to ${target}${reason ? ': ' + reason : ''}`,
    decidedByUserId: actorUserId,
    decidedDate: now,
    rationale: reason ?? 'Resumed from terminal Hold branch',
  });

  return { resumedTo: target };
}

export async function markProjectDone(params: TerminalTransitionParams): Promise<{
  stageInstanceId: number;
}> {
  const { projectId, actorUserId, reason } = params;
  const now = new Date();

  const doneInstance = await ensureTerminalStageInstance(projectId, 'S_DONE', now);

  // Defensive upsert (same rationale as placeProjectOnHold): cover the
  // edge case where a project is closed before initialiseStages has
  // ever run, so a plain UPDATE would silently no-op.
  await db
    .insert(projectExecutionState)
    .values({
      projectId,
      currentStageCode: 'S_DONE',
    })
    .onConflictDoUpdate({
      target: projectExecutionState.projectId,
      set: {
        currentStageCode: 'S_DONE',
        // previous_phase intentionally preserved as observability data —
        // S_DONE is permanent so there is no resume that would consume it.
        updatedAt: now,
      },
    });

  await db
    .update(projectInfo)
    .set({ projectStatus: 'closed', updatedAt: now })
    .where(eq(projectInfo.id, projectId));

  await db.insert(projectStageDecisions).values({
    projectId,
    stageCode: 'S_DONE',
    decisionType: 'STAGE_OVERRIDE',
    decisionSummary: `Project marked Done (terminal closure)${reason ? ': ' + reason : ''}`,
    decidedByUserId: actorUserId,
    decidedDate: now,
    rationale: reason ?? 'Closed via terminal Done branch',
  });

  return { stageInstanceId: doneInstance.id };
}
