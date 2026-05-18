import { auditEvents, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../../../db";

/**
 * Canonical audit-events writer used across both controller-layer and
 * service-layer code. Controllers typically pass `actorRole` directly (sourced
 * from `req.user`); services that only have a `userId` may omit it and the
 * helper will look up the role from the `users` table. If the user can't be
 * found, the row is still written with `actorRole = "UNKNOWN"` rather than
 * dropping the audit event — visibility beats false negatives.
 */
export async function recordAudit(input: {
  /** Required when known (controllers); optional in services where only userId is on hand. */
  actorRole?: string;
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
  let actorRole = input.actorRole;
  let userName = input.userName;
  if (!actorRole && typeof input.userId === "number") {
    const row = await db
      .select({ role: users.role, name: users.name })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (row[0]) {
      actorRole = row[0].role ?? undefined;
      userName = userName ?? row[0].name ?? undefined;
    }
  }
  await db.insert(auditEvents).values({
    actorRole: actorRole ?? "UNKNOWN",
    userId: input.userId,
    userName,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changesJson: (input.changesJson ?? null) as typeof auditEvents.$inferInsert.changesJson,
    projectName: input.projectName,
    requestPath: input.requestPath,
    requestMethod: input.requestMethod,
  });
}
