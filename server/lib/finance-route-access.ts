import type { NextFunction, Request, Response } from "express";
import type { PermissionAction, PermissionEntity } from "@shared/schema";
import { logAuditFromReq } from "../audit-logger";
import { evaluatePermissionForRequest } from "../permission-middleware";

export function getTrackerPermissionEntity(trackerType?: string | null): PermissionEntity | null {
  const normalized = String(trackerType || "").trim().toUpperCase();
  if (normalized === "REV") return "revenue_tracker";
  if (normalized === "COS") return "cos";
  return null;
}

function logTrackerPermissionFailure(req: Request, entity: PermissionEntity, action: PermissionAction, trackerType: string, reason: string) {
  logAuditFromReq(req, {
    entityType: "permission",
    entityId: `${entity}:${action}`,
    action: "permission_denied",
    changesJson: {
      trackerType,
      entity,
      action,
      reason,
      route: req.path,
    },
  });
}

export function requireTrackerPermission(action: PermissionAction) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const trackerType = (req.body?.trackerType as string | undefined) || (req.params.type as string | undefined);
    const entity = getTrackerPermissionEntity(trackerType);
    if (!entity) {
      return res.status(400).json({ error: "invalid_tracker_type", message: "Type must be REV or COS" });
    }

    const evaluation = await evaluatePermissionForRequest(req, entity, action);
    if (evaluation.allowed) {
      return next();
    }

    logTrackerPermissionFailure(req, entity, action, String(trackerType || ""), evaluation.reason);
    return res.status(403).json({ error: "forbidden", entity, action, reason: evaluation.reason });
  };
}
