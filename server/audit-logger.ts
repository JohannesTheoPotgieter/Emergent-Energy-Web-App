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
