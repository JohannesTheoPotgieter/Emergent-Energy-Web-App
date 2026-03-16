import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { msObjects, type PermissionAction, type PermissionEntity } from "@shared/schema";
import { db } from "../db";
import { logAuditFromReq } from "../audit-logger";
import { evaluatePermissionForRequest } from "../permission-middleware";

const MICROSOFT_ROUTE_FALLBACK_ENTITIES: PermissionEntity[] = ["home", "my_work", "collaboration_hub", "teams_chat"];
const MICROSOFT_SYNC_FALLBACK_ENTITIES: PermissionEntity[] = ["my_work", "collaboration_hub", "teams_chat"];

export function getMicrosoftPermissionEntity(type?: string | null): PermissionEntity {
  const normalized = String(type || "").trim().toLowerCase();

  if (normalized === "email" || normalized === "sharepoint_file" || normalized === "sharepoint_folder") {
    return "collaboration_hub";
  }

  if (normalized === "teams" || normalized === "chat" || normalized === "channel") {
    return "teams_chat";
  }

  if (normalized === "event" || normalized === "calendar" || normalized === "meeting") {
    return "my_work";
  }

  return "my_work";
}

async function canAccessMicrosoftEntity(req: Request, entity: PermissionEntity, action: PermissionAction) {
  const evaluation = await evaluatePermissionForRequest(req, entity, action);
  return {
    entity,
    allowed: evaluation.allowed,
    reason: evaluation.reason,
  };
}

async function canAccessAnyMicrosoftEntity(req: Request, entities: PermissionEntity[], action: PermissionAction) {
  for (const entity of entities) {
    const evaluation = await canAccessMicrosoftEntity(req, entity, action);
    if (evaluation.allowed) {
      return evaluation;
    }
  }

  const [fallbackEntity] = entities;
  return {
    entity: fallbackEntity,
    allowed: false,
    reason: "You do not have access to this Microsoft surface",
  };
}

function logMicrosoftPermissionFailure(req: Request, entity: PermissionEntity, action: PermissionAction, details: Record<string, unknown>) {
  logAuditFromReq(req, {
    entityType: "permission",
    entityId: `${entity}:${action}`,
    action: "permission_denied",
    changesJson: {
      entity,
      action,
      route: req.path,
      ...details,
    },
  });
}

export async function filterMicrosoftItemsForRequest<T extends { type?: string | null }>(
  req: Request,
  items: T[],
  action: PermissionAction = "view",
): Promise<T[]> {
  const cache = new Map<string, boolean>();
  const filtered: T[] = [];

  for (const item of items) {
    const entity = getMicrosoftPermissionEntity(item.type);
    if (!cache.has(entity)) {
      const evaluation = await canAccessMicrosoftEntity(req, entity, action);
      cache.set(entity, evaluation.allowed);
    }

    if (cache.get(entity) === true) {
      filtered.push(item);
    }
  }

  return filtered;
}

export function requireMicrosoftSurfaceFromRequest(options?: {
  action?: PermissionAction;
  queryKey?: string;
  bodyKey?: string;
  fallbackEntities?: PermissionEntity[];
}) {
  const action = options?.action || "view";
  const queryKey = options?.queryKey || "type";
  const bodyKey = options?.bodyKey || "type";
  const fallbackEntities = options?.fallbackEntities || MICROSOFT_ROUTE_FALLBACK_ENTITIES;

  return async (req: Request, res: Response, next: NextFunction) => {
    const requestType =
      (typeof req.query?.[queryKey] === "string" ? (req.query[queryKey] as string) : undefined) ||
      (typeof req.body?.[bodyKey] === "string" ? (req.body[bodyKey] as string) : undefined);

    const entities = requestType ? [getMicrosoftPermissionEntity(requestType)] : fallbackEntities;
    const evaluation = await canAccessAnyMicrosoftEntity(req, entities, action);
    if (evaluation.allowed) {
      return next();
    }

    logMicrosoftPermissionFailure(req, evaluation.entity, action, {
      requestType: requestType || null,
      entities,
      reason: evaluation.reason,
    });
    return res.status(403).json({ error: "forbidden", entity: evaluation.entity, action, reason: evaluation.reason });
  };
}

export function requireMicrosoftObjectSurfaceAccess(action: PermissionAction = "view") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const msObjectId = parseInt(String(req.params.id));
    if (Number.isNaN(msObjectId)) {
      return res.status(400).json({ error: "Invalid ms object id" });
    }

    const [item] = await db
      .select({ type: msObjects.type })
      .from(msObjects)
      .where(eq(msObjects.id, msObjectId))
      .limit(1);

    if (!item) {
      return res.status(404).json({ error: "MS object not found" });
    }

    const entity = getMicrosoftPermissionEntity(item.type);
    const evaluation = await canAccessMicrosoftEntity(req, entity, action);
    if (evaluation.allowed) {
      return next();
    }

    logMicrosoftPermissionFailure(req, entity, action, {
      msObjectId,
      objectType: item.type,
      reason: evaluation.reason,
    });
    return res.status(403).json({ error: "forbidden", entity, action, reason: evaluation.reason });
  };
}

export function requireMicrosoftSyncSurfaceAccess() {
  return requireMicrosoftSurfaceFromRequest({
    action: "view",
    fallbackEntities: MICROSOFT_SYNC_FALLBACK_ENTITIES,
  });
}
