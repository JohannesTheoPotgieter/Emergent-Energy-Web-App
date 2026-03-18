import { db } from "./db";
import { permissionAuditLog } from "@shared/schema";
import type { Request } from "express";
import { getEffectiveUser } from "./auth-context";

export type PermissionAuditEventType =
  | "role_created"
  | "role_updated"
  | "role_deleted"
  | "role_cloned"
  | "role_archived"
  | "user_role_changed"
  | "user_override_added"
  | "user_override_removed"
  | "user_override_updated"
  | "user_created"
  | "user_deleted"
  | "user_password_reset";

export interface PermissionAuditParams {
  eventType: PermissionAuditEventType;
  targetRole?: string;
  targetUserId?: number;
  changeDetail: Record<string, any>;
}

export async function logPermissionAudit(req: Request, params: PermissionAuditParams): Promise<void> {
  try {
    const user = getEffectiveUser(req);
    await db.insert(permissionAuditLog).values({
      eventType: params.eventType,
      targetRole: params.targetRole || null,
      targetUserId: params.targetUserId || null,
      changedByUserId: user?.id || null,
      changedByRole: user?.role || null,
      changeDetail: params.changeDetail,
    });
  } catch (err) {
    console.warn("[PermissionAudit] Failed to log:", (err as Error).message);
  }
}
