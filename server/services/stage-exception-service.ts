// ============================================================
// STAGE EXCEPTION SERVICE — Exception/bypass workflow
// ============================================================
//
// TODO (status-casing alignment) — PRE-EXISTING bug, surfaced by D.5:
// this service writes UPPERCASE status values ('REQUESTED', 'APPROVED',
// 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'CLOSED') while
// shared/schema/stage-lifecycle.ts EXCEPTION_STATUSES (line 145) is
// canonically LOWERCASE per the C6 migration 20260413_status_casing.
// The column default on `project_stage_exceptions.status` is also
// lowercase ('requested'), so existing rows are mixed.
//
// D.5 (β) propagates this mismatch into project_stage_exception_history.
// Resolving it cleanly needs a separate PR with: (1) service edit to
// emit lowercase, (2) data migration to normalise existing rows, and
// (3) UI / consumer alignment check. Documented as known tech debt
// rather than fixed in-place here.

import { and, eq, sql } from "drizzle-orm";
import {
  projectStageExceptions,
  projectStageExceptionHistory,
  projectStageDecisions,
  projectStageInstances,
  type InsertProjectStageException,
  type ProjectStageException,
} from "@shared/schema";
import { db } from "../db";
import { recordAudit } from "../api/v2/services/audit-service";

// ── Create ──────────────────────────────────────────────────

export interface CreateExceptionParams {
  projectId: number;
  stageCode: string;
  requirementCode?: string;
  reasonText: string;
  riskLevel: string;
  mitigationText?: string;
  ownerUserId: number;
  closeoutDueDate?: string;
  downstreamBlockingStage?: string;
}

export async function createException(params: CreateExceptionParams): Promise<ProjectStageException> {
  return db.transaction(async (tx: typeof db) => {
    const [exception] = await tx.insert(projectStageExceptions).values({
      projectId: params.projectId,
      stageCode: params.stageCode,
      requirementCode: params.requirementCode || null,
      reasonText: params.reasonText,
      riskLevel: params.riskLevel,
      mitigationText: params.mitigationText || null,
      ownerUserId: params.ownerUserId,
      status: 'REQUESTED',
      closeoutDueDate: params.closeoutDueDate || null,
      downstreamBlockingStage: params.downstreamBlockingStage || null,
    }).returning();

    // Plan v3 § 2.3 / D.5 (β): seed the transition history with the
    // initial REQUESTED state so post-hoc reviews can replay every flip.
    await tx.insert(projectStageExceptionHistory).values({
      exceptionId: exception.id,
      fromStatus: null,
      toStatus: 'REQUESTED',
      changedByUserId: params.ownerUserId,
      reason: params.reasonText,
    });

    return exception;
  });
}

// ── Approve ─────────────────────────────────────────────────

export async function approveException(
  exceptionId: number,
  approverUserId: number,
  conditions?: string,
): Promise<ProjectStageException> {
  const [existing] = await db
    .select()
    .from(projectStageExceptions)
    .where(eq(projectStageExceptions.id, exceptionId));

  if (!existing) throw new Error(`Exception ${exceptionId} not found`);
  if (existing.status !== 'REQUESTED' && existing.status !== 'RE_OPENED') {
    throw new Error(`Cannot approve exception in status ${existing.status}`);
  }

  const newStatus = conditions ? 'APPROVED_WITH_CONDITIONS' : 'APPROVED';

  return db.transaction(async (tx: typeof db) => {
    await tx
      .update(projectStageExceptions)
      .set({
        status: newStatus,
        approverUserId,
        conditionsText: conditions || null,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projectStageExceptions.id, exceptionId));

    // Stage-level decision row (existing canonical for stage gates).
    await tx.insert(projectStageDecisions).values({
      projectId: existing.projectId,
      stageCode: existing.stageCode,
      decisionType: 'EXCEPTION_GRANTED',
      decisionSummary: `Exception approved for ${existing.requirementCode || 'stage requirement'}${conditions ? ' with conditions' : ''}`,
      decidedByUserId: approverUserId,
      decidedDate: new Date(),
      rationale: conditions || existing.reasonText,
      relatedExceptionId: exceptionId,
    });

    // Per-exception transition history (Plan v3 § 2.3 / D.5).
    await tx.insert(projectStageExceptionHistory).values({
      exceptionId,
      fromStatus: existing.status,
      toStatus: newStatus,
      changedByUserId: approverUserId,
      reason: conditions || null,
    });

    await recordAudit({
      userId: approverUserId,
      entityType: "stage_exception",
      entityId: String(exceptionId),
      action: "APPROVE_EXCEPTION",
      changesJson: {
        projectId: existing.projectId,
        stageCode: existing.stageCode,
        fromStatus: existing.status,
        toStatus: newStatus,
        conditions: conditions ?? null,
      },
    });

    const [updated] = await tx
      .select()
      .from(projectStageExceptions)
      .where(eq(projectStageExceptions.id, exceptionId));

    return updated;
  });
}

// ── Reject ──────────────────────────────────────────────────

export async function rejectException(
  exceptionId: number,
  approverUserId: number,
  reason: string,
): Promise<ProjectStageException> {
  const [existing] = await db
    .select()
    .from(projectStageExceptions)
    .where(eq(projectStageExceptions.id, exceptionId));

  if (!existing) throw new Error(`Exception ${exceptionId} not found`);

  return db.transaction(async (tx: typeof db) => {
    await tx
      .update(projectStageExceptions)
      .set({
        status: 'REJECTED',
        approverUserId,
        conditionsText: reason,
        updatedAt: new Date(),
      })
      .where(eq(projectStageExceptions.id, exceptionId));

    // Stage-level decision row (existing canonical for stage gates).
    await tx.insert(projectStageDecisions).values({
      projectId: existing.projectId,
      stageCode: existing.stageCode,
      decisionType: 'EXCEPTION_DENIED',
      decisionSummary: `Exception rejected for ${existing.requirementCode || 'stage requirement'}: ${reason}`,
      decidedByUserId: approverUserId,
      decidedDate: new Date(),
      rationale: reason,
      relatedExceptionId: exceptionId,
    });

    // Per-exception transition history (Plan v3 § 2.3 / D.5).
    await tx.insert(projectStageExceptionHistory).values({
      exceptionId,
      fromStatus: existing.status,
      toStatus: 'REJECTED',
      changedByUserId: approverUserId,
      reason,
    });

    await recordAudit({
      userId: approverUserId,
      entityType: "stage_exception",
      entityId: String(exceptionId),
      action: "REJECT_EXCEPTION",
      changesJson: {
        projectId: existing.projectId,
        stageCode: existing.stageCode,
        fromStatus: existing.status,
        toStatus: "REJECTED",
        reason,
      },
    });

    const [updated] = await tx
      .select()
      .from(projectStageExceptions)
      .where(eq(projectStageExceptions.id, exceptionId));

    return updated;
  });
}

// ── Close ───────────────────────────────────────────────────

export async function closeException(
  exceptionId: number,
  actorUserId: number,
): Promise<ProjectStageException> {
  const [existing] = await db
    .select()
    .from(projectStageExceptions)
    .where(eq(projectStageExceptions.id, exceptionId));
  if (!existing) throw new Error(`Exception ${exceptionId} not found`);

  return db.transaction(async (tx: typeof db) => {
    await tx
      .update(projectStageExceptions)
      .set({
        status: 'CLOSED',
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projectStageExceptions.id, exceptionId));

    // Per-exception transition history (Plan v3 § 2.3 / D.5).
    // closeException doesn't write to project_stage_decisions; this is
    // now the canonical record of the close event.
    await tx.insert(projectStageExceptionHistory).values({
      exceptionId,
      fromStatus: existing.status,
      toStatus: 'CLOSED',
      changedByUserId: actorUserId,
    });

    const [updated] = await tx
      .select()
      .from(projectStageExceptions)
      .where(eq(projectStageExceptions.id, exceptionId));

    return updated;
  });
}

// ── Queries ─────────────────────────────────────────────────

export async function getProjectExceptions(
  projectId: number,
  stageCode?: string,
): Promise<ProjectStageException[]> {
  const conditions = [eq(projectStageExceptions.projectId, projectId)];
  if (stageCode) {
    conditions.push(eq(projectStageExceptions.stageCode, stageCode));
  }

  return db
    .select()
    .from(projectStageExceptions)
    .where(and(...conditions))
    .orderBy(projectStageExceptions.createdAt);
}

export async function getOpenExceptionCount(projectId: number): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectStageExceptions)
    .where(and(
      eq(projectStageExceptions.projectId, projectId),
      eq(projectStageExceptions.status, 'REQUESTED'),
    ));
  return result?.count ?? 0;
}
