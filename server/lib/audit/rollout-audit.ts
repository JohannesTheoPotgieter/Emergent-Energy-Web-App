import type { Request } from "express";
import { logAuditFromReq } from "../../audit-logger";

export const ROLLOUT_AUDIT_ACTIONS = [
  "suggestion_presented",
  "suggestion_accepted",
  "suggestion_overridden",
  "override_reason_captured",
  "action_started",
  "action_succeeded",
  "action_failed",
] as const;

export type RolloutAuditAction = (typeof ROLLOUT_AUDIT_ACTIONS)[number];

interface BaseRolloutAuditPayload {
  req: Request;
  entityType: string;
  entityId?: string | number;
  projectName?: string;
  suggestion?: unknown;
  finalValue?: unknown;
  reason?: string;
  details?: Record<string, unknown>;
}

export function logRolloutAction(
  action: RolloutAuditAction,
  { req, entityType, entityId, projectName, suggestion, finalValue, reason, details }: BaseRolloutAuditPayload,
): void {
  logAuditFromReq(req, {
    source: "UI",
    entityType,
    entityId: entityId != null ? String(entityId) : undefined,
    action,
    projectName,
    changesJson: {
      ...details,
      suggestion: suggestion ?? null,
      finalValue: finalValue ?? null,
      overrideReason: reason ?? null,
    },
  });
}

export function logSuggestionPresented(payload: BaseRolloutAuditPayload): void {
  logRolloutAction("suggestion_presented", payload);
}

export function logSuggestionAccepted(payload: BaseRolloutAuditPayload): void {
  logRolloutAction("suggestion_accepted", payload);
}

export function logSuggestionOverridden(payload: BaseRolloutAuditPayload): void {
  logRolloutAction("suggestion_overridden", payload);
}

export function logOverrideReasonCaptured(payload: BaseRolloutAuditPayload & { reason: string }): void {
  logRolloutAction("override_reason_captured", payload);
}

export function logActionStarted(payload: BaseRolloutAuditPayload): void {
  logRolloutAction("action_started", payload);
}

export function logActionSucceeded(payload: BaseRolloutAuditPayload): void {
  logRolloutAction("action_succeeded", payload);
}

export function logActionFailed(payload: BaseRolloutAuditPayload): void {
  logRolloutAction("action_failed", payload);
}
