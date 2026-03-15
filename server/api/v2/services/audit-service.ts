import { auditEvents } from "@shared/schema";
import { db } from "../../../db";

export async function recordAudit(input: {
  actorRole: string;
  userId?: number;
  userName?: string;
  entityType: string;
  entityId?: string;
  action: string;
  changesJson?: unknown;
  projectName?: string;
  requestPath?: string;
  requestMethod?: string;
}) {
  await db.insert(auditEvents).values({
    actorRole: input.actorRole,
    userId: input.userId,
    userName: input.userName,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changesJson: (input.changesJson ?? null) as any,
    projectName: input.projectName,
    requestPath: input.requestPath,
    requestMethod: input.requestMethod,
  });
}
