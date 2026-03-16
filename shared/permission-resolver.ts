import { ENTITY_PERMISSION_DEFAULTS, type PermissionAction, type PermissionEntity, type RolePermission } from "./schema";

export interface PermissionEvaluationResult {
  allowed: boolean;
  reason: string;
  source: "db_override" | "default" | "none";
}

export function evaluatePermissionForRole(params: {
  role: string;
  entity: PermissionEntity;
  action: PermissionAction;
  roleRecord?: Pick<RolePermission, "entityPermissions"> | null;
}): PermissionEvaluationResult {
  const { role, entity, action, roleRecord } = params;

  const entityPermissions = (roleRecord?.entityPermissions || null) as Record<string, Record<string, boolean>> | null;
  const dbValue = entityPermissions?.[entity]?.[action];

  if (typeof dbValue === "boolean") {
    return {
      allowed: dbValue,
      reason: dbValue
        ? `Allowed by explicit role override (${entity}.${action}).`
        : `Blocked by explicit role override (${entity}.${action}).`,
      source: "db_override",
    };
  }

  const defaultRule = ENTITY_PERMISSION_DEFAULTS.find((rule) => rule.entity === entity);
  if (!defaultRule) {
    return { allowed: false, reason: `No default rule for ${entity}.`, source: "none" };
  }

  const actionKey = `${action}_roles` as keyof typeof defaultRule;
  const allowedRoles = defaultRule[actionKey] as string[];
  const allowed = allowedRoles.includes(role);

  return {
    allowed,
    reason: allowed
      ? `Allowed by default rule for ${entity}.${action}.`
      : `Role ${role} is not in default allow-list for ${entity}.${action}.`,
    source: "default",
  };
}
