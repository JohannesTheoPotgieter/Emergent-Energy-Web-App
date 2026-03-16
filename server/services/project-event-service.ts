import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Request } from "express";
import * as schema from "@shared/schema";
import { db } from "../db";

const users = schema.users;
const projectEvents = (schema as { projectEvents?: any }).projectEvents;

export type ProjectEventType =
  | "project.created"
  | "project.stage_changed"
  | "project.gate_passed"
  | "project.gate_failed"
  | "project.override_granted"
  | "task.created"
  | "task.reassigned"
  | "task.completed"
  | "task.reopened"
  | "milestone.created"
  | "milestone.converted"
  | "milestone.completed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "procurement.item_created"
  | "procurement.po_issued"
  | "procurement.delivery_captured"
  | "procurement.status_changed"
  | "invoice.captured"
  | "invoice.approved"
  | "invoice.payment_status_changed"
  | "evidence.uploaded"
  | "evidence.override_used"
  | "raid.created"
  | "raid.status_changed"
  | "change.created"
  | "change.status_changed"
  | "authority.updated";

export interface CreateProjectEventInput {
  projectId: number;
  eventType: ProjectEventType | string;
  eventTimestamp?: Date;
  actorUserId?: number | null;
  actorRole?: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  summary: string;
  details?: Record<string, unknown>;
  visibility?: Record<string, unknown>;
  idempotencyKey: string;
}

export function actorFromReq(req: Request): { actorUserId: number | null; actorRole: string | null } {
  const user = (req as any).user as any;
  return {
    actorUserId: user?.id ?? null,
    actorRole: user?.role ?? null,
  };
}

export async function createProjectEvent(input: CreateProjectEventInput, tx: any = db) {
  if (!projectEvents) {
    return null;
  }

  const inserted = await tx
    .insert(projectEvents)
    .values({
      projectId: input.projectId,
      eventType: input.eventType,
      eventTimestamp: input.eventTimestamp ?? new Date(),
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      summary: input.summary,
      details: input.details ?? {},
      visibility: input.visibility ?? { scope: "project" },
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({
      target: [projectEvents.projectId, projectEvents.idempotencyKey],
    })
    .returning();

  return inserted[0] ?? null;
}

export async function listProjectEvents(params: {
  projectId: number;
  eventTypes?: string[];
  actorUserId?: number;
  from?: Date;
  to?: Date;
  order?: "asc" | "desc";
  limit?: number;
}) {
  if (!projectEvents) {
    return [];
  }

  const { projectId, eventTypes, actorUserId, from, to, order = "desc", limit = 200 } = params;
  const conditions: any[] = [eq(projectEvents.projectId, projectId)];

  if (eventTypes && eventTypes.length > 0) {
    conditions.push(inArray(projectEvents.eventType, eventTypes));
  }
  if (actorUserId) {
    conditions.push(eq(projectEvents.actorUserId, actorUserId));
  }
  if (from) {
    conditions.push(gte(projectEvents.eventTimestamp, from));
  }
  if (to) {
    conditions.push(lte(projectEvents.eventTimestamp, to));
  }

  const rows = await db
    .select({
      id: projectEvents.id,
      projectId: projectEvents.projectId,
      eventType: projectEvents.eventType,
      eventTimestamp: projectEvents.eventTimestamp,
      actorUserId: projectEvents.actorUserId,
      actorRole: projectEvents.actorRole,
      sourceEntityType: projectEvents.sourceEntityType,
      sourceEntityId: projectEvents.sourceEntityId,
      summary: projectEvents.summary,
      details: projectEvents.details,
      visibility: projectEvents.visibility,
      createdAt: projectEvents.createdAt,
      actorName: users.name,
    })
    .from(projectEvents)
    .leftJoin(users, eq(projectEvents.actorUserId, users.id))
    .where(and(...conditions))
    .orderBy(order === "asc" ? sql`${projectEvents.eventTimestamp} asc` : desc(projectEvents.eventTimestamp))
    .limit(limit);

  return rows;
}
