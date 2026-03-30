// ============================================================
// STAGE DEPENDENCY SERVICE — Cross-department waiting-on
// ============================================================

import { and, eq, sql } from "drizzle-orm";
import {
  projectStageDependencies,
  type InsertProjectStageDependency,
  type ProjectStageDependency,
} from "@shared/schema";
import { db } from "../db";

// ── Create ──────────────────────────────────────────────────

export interface CreateDependencyParams {
  projectId: number;
  stageCode: string;
  fromDepartment: string;
  fromUserId?: number;
  toDepartment: string;
  toUserId?: number;
  description: string;
  dueDate?: string;
}

export async function createDependency(params: CreateDependencyParams): Promise<ProjectStageDependency> {
  const [dep] = await db.insert(projectStageDependencies).values({
    projectId: params.projectId,
    stageCode: params.stageCode,
    fromDepartment: params.fromDepartment,
    fromUserId: params.fromUserId || null,
    toDepartment: params.toDepartment,
    toUserId: params.toUserId || null,
    description: params.description,
    dueDate: params.dueDate || null,
    status: 'WAITING',
  }).returning();

  return dep;
}

// ── Resolve ─────────────────────────────────────────────────

export async function resolveDependency(
  depId: number,
  actorUserId: number,
): Promise<ProjectStageDependency> {
  await db
    .update(projectStageDependencies)
    .set({
      status: 'RESOLVED',
      resolvedAt: new Date(),
    })
    .where(eq(projectStageDependencies.id, depId));

  const [updated] = await db
    .select()
    .from(projectStageDependencies)
    .where(eq(projectStageDependencies.id, depId));

  return updated;
}

// ── Escalate ────────────────────────────────────────────────

export async function escalateDependency(
  depId: number,
  actorUserId: number,
  reason?: string,
): Promise<ProjectStageDependency> {
  await db
    .update(projectStageDependencies)
    .set({
      status: 'ESCALATED',
      escalated: true,
      escalationReason: reason || null,
    })
    .where(eq(projectStageDependencies.id, depId));

  const [updated] = await db
    .select()
    .from(projectStageDependencies)
    .where(eq(projectStageDependencies.id, depId));

  return updated;
}

// ── Queries ─────────────────────────────────────────────────

export async function getProjectDependencies(
  projectId: number,
  stageCode?: string,
): Promise<ProjectStageDependency[]> {
  const conditions = [eq(projectStageDependencies.projectId, projectId)];
  if (stageCode) {
    conditions.push(eq(projectStageDependencies.stageCode, stageCode));
  }

  return db
    .select()
    .from(projectStageDependencies)
    .where(and(...conditions))
    .orderBy(projectStageDependencies.createdAt);
}

export async function getOpenDependencyCount(projectId: number): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectStageDependencies)
    .where(and(
      eq(projectStageDependencies.projectId, projectId),
      eq(projectStageDependencies.status, 'WAITING'),
    ));
  return result?.count ?? 0;
}
