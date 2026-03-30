// ============================================================
// STAGE EXCEPTION SERVICE — Exception/bypass workflow
// ============================================================

import { and, eq, sql } from "drizzle-orm";
import {
  projectStageExceptions,
  projectStageDecisions,
  projectStageInstances,
  type InsertProjectStageException,
  type ProjectStageException,
} from "@shared/schema";
import { db } from "../db";

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
  const [exception] = await db.insert(projectStageExceptions).values({
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

  return exception;
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

  await db
    .update(projectStageExceptions)
    .set({
      status: newStatus,
      approverUserId,
      conditionsText: conditions || null,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectStageExceptions.id, exceptionId));

  // Log decision
  await db.insert(projectStageDecisions).values({
    projectId: existing.projectId,
    stageCode: existing.stageCode,
    decisionType: 'EXCEPTION_GRANTED',
    decisionSummary: `Exception approved for ${existing.requirementCode || 'stage requirement'}${conditions ? ' with conditions' : ''}`,
    decidedByUserId: approverUserId,
    decidedDate: new Date(),
    rationale: conditions || existing.reasonText,
    relatedExceptionId: exceptionId,
  });

  const [updated] = await db
    .select()
    .from(projectStageExceptions)
    .where(eq(projectStageExceptions.id, exceptionId));

  return updated;
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

  await db
    .update(projectStageExceptions)
    .set({
      status: 'REJECTED',
      approverUserId,
      conditionsText: reason,
      updatedAt: new Date(),
    })
    .where(eq(projectStageExceptions.id, exceptionId));

  // Log decision
  await db.insert(projectStageDecisions).values({
    projectId: existing.projectId,
    stageCode: existing.stageCode,
    decisionType: 'EXCEPTION_DENIED',
    decisionSummary: `Exception rejected for ${existing.requirementCode || 'stage requirement'}: ${reason}`,
    decidedByUserId: approverUserId,
    decidedDate: new Date(),
    rationale: reason,
    relatedExceptionId: exceptionId,
  });

  const [updated] = await db
    .select()
    .from(projectStageExceptions)
    .where(eq(projectStageExceptions.id, exceptionId));

  return updated;
}

// ── Close ───────────────────────────────────────────────────

export async function closeException(
  exceptionId: number,
  actorUserId: number,
): Promise<ProjectStageException> {
  await db
    .update(projectStageExceptions)
    .set({
      status: 'CLOSED',
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectStageExceptions.id, exceptionId));

  const [updated] = await db
    .select()
    .from(projectStageExceptions)
    .where(eq(projectStageExceptions.id, exceptionId));

  return updated;
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
