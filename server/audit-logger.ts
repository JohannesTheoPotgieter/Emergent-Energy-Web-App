import { db } from "./db";
import { auditEvents } from "@shared/schema";
import type { Request } from "express";

export interface AuditLogParams {
  userId?: number;
  userName?: string;
  actorRole?: string;
  entityType: string;
  entityId?: string;
  action: string;
  changesJson?: Record<string, any>;
  projectName?: string;
  source?: "UI" | "IMPORT" | "SETTINGS" | "DOCS" | "SYSTEM";
  req?: Request;
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    const user = params.req?.user as any;
    await db.insert(auditEvents).values({
      actorRole: params.actorRole || user?.role || user?.companyRole || "unknown",
      userId: params.userId || user?.id || null,
      userName: params.userName || user?.name || user?.username || null,
      source: params.source || "UI",
      entityType: params.entityType,
      entityId: params.entityId ? String(params.entityId) : null,
      action: params.action,
      changesJson: params.changesJson || null,
      projectName: params.projectName || null,
      ipAddress: params.req ? (params.req.headers["x-forwarded-for"] as string || params.req.socket?.remoteAddress || null) : null,
      requestPath: params.req?.originalUrl || null,
      requestMethod: params.req?.method || null,
    });
  } catch (err) {
    console.warn("[Audit] Failed to log:", (err as Error).message);
  }
}

export function logAuditFromReq(req: Request, params: Omit<AuditLogParams, "req">): void {
  logAudit({ ...params, req }).catch(() => {});
}

export function logStatusChange(req: Request, entityType: string, entityId: string | number, oldStatus: string, newStatus: string, projectName?: string): void {
  logAuditFromReq(req, {
    entityType,
    entityId: String(entityId),
    action: "status_change",
    projectName,
    changesJson: { old_status: oldStatus, new_status: newStatus },
  });
}

export function logReassignment(req: Request, entityType: string, entityId: string | number, oldAssignee: string | number | null, newAssignee: string | number | null, projectName?: string): void {
  logAuditFromReq(req, {
    entityType,
    entityId: String(entityId),
    action: "reassignment",
    projectName,
    changesJson: { old_assignee: oldAssignee, new_assignee: newAssignee },
  });
}

export function logTypeChange(req: Request, entityType: string, entityId: string | number, oldType: string, newType: string, projectName?: string): void {
  logAuditFromReq(req, {
    entityType,
    entityId: String(entityId),
    action: "type_change",
    projectName,
    changesJson: { old_type: oldType, new_type: newType },
  });
}

export function logImportAction(req: Request, action: string, importRunId: number, details: Record<string, any>): void {
  logAuditFromReq(req, {
    entityType: "smart_import_run",
    entityId: String(importRunId),
    action,
    source: "IMPORT",
    changesJson: details,
  });
}

export function logAdminRecovery(req: Request, entityType: string, entityId: string | number, action: string, changes: Record<string, any>, projectName?: string): void {
  logAuditFromReq(req, {
    entityType,
    entityId: String(entityId),
    action: `admin_recovery_${action}`,
    projectName,
    changesJson: changes,
  });
}
