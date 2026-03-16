import {
  AUTHORITY_ACTIONS,
  AUTHORITY_SCOPES,
  ENTITY_PERMISSION_DEFAULTS,
  type AuthorityAction,
  type AuthorityScope,
  type PermissionAction,
  type PermissionEntity,
  type RolePermission,
} from "./schema";

export interface PermissionEvaluationResult {
  allowed: boolean;
  reason: string;
  source: "db_override" | "default" | "none";
}

export interface AuthorityDelegationRule {
  fromRole?: string;
  toRole?: string;
  actions?: AuthorityAction[];
  scope?: AuthorityScope;
  enabled?: boolean;
}

export interface ApprovalThresholdRule {
  entity?: string;
  field?: string;
  minAmount?: number;
  maxAmount?: number;
  approvalsRequired?: number;
}

export interface FieldRestrictionRule {
  field: string;
  allowView?: boolean;
  allowEdit?: boolean;
  roles?: string[];
}

export interface AssignmentRule {
  fromDepartment?: string;
  toDepartment?: string;
  allowCrossDepartment?: boolean;
}

export interface AuthorityRule {
  action: AuthorityAction;
  enabled: boolean;
  scope: AuthorityScope;
  fieldRestrictions?: FieldRestrictionRule[];
  approvalThresholds?: ApprovalThresholdRule[];
  delegatedAuthority?: AuthorityDelegationRule[];
  assignmentRules?: AssignmentRule[];
}

export interface AuthorityModel {
  templateKey?: string;
  rules?: Record<string, Partial<AuthorityRule>>;
  userOverrides?: Record<string, Partial<AuthorityRule>>;
}

export interface AuthorityEvaluationResult {
  allowed: boolean;
  action: AuthorityAction;
  scope: AuthorityScope;
  reason: string;
  source: "authority_model" | "legacy_fallback" | "none";
  constraints: {
    fieldRestrictions: FieldRestrictionRule[];
    approvalThresholds: ApprovalThresholdRule[];
    delegatedAuthority: AuthorityDelegationRule[];
    assignmentRules: AssignmentRule[];
  };
}

const LEGACY_ACTION_MAP: Partial<Record<AuthorityAction, PermissionAction>> = {
  view: "view",
  create: "create",
  edit: "edit",
  delete: "delete",
  approve: "approve",
};

const STRICTER_ACTIONS: AuthorityAction[] = ["delete", "approve", "manage_settings"];

const DEFAULT_SCOPE_BY_ACTION: Record<AuthorityAction, AuthorityScope> = {
  view: "assigned_projects",
  create: "assigned_projects",
  edit: "assigned_projects",
  delete: "all_projects",
  approve: "all_projects",
  assign: "department",
  reassign: "department",
  close_complete: "assigned_projects",
  export: "all_projects",
  manage_settings: "company_admin",
};

function normalizeAuthorityRule(action: AuthorityAction, rule?: Partial<AuthorityRule> | null): AuthorityRule {
  return {
    action,
    enabled: Boolean(rule?.enabled),
    scope: AUTHORITY_SCOPES.includes((rule?.scope || "") as AuthorityScope)
      ? (rule!.scope as AuthorityScope)
      : DEFAULT_SCOPE_BY_ACTION[action],
    fieldRestrictions: Array.isArray(rule?.fieldRestrictions) ? rule!.fieldRestrictions as FieldRestrictionRule[] : [],
    approvalThresholds: Array.isArray(rule?.approvalThresholds) ? rule!.approvalThresholds as ApprovalThresholdRule[] : [],
    delegatedAuthority: Array.isArray(rule?.delegatedAuthority) ? rule!.delegatedAuthority as AuthorityDelegationRule[] : [],
    assignmentRules: Array.isArray(rule?.assignmentRules) ? rule!.assignmentRules as AssignmentRule[] : [],
  };
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

function resolveLegacyEnabled(params: {
  role: string;
  action: AuthorityAction;
  entity: PermissionEntity;
  roleRecord?: Pick<RolePermission, "entityPermissions"> | null;
}) {
  const legacy = LEGACY_ACTION_MAP[params.action];
  if (!legacy) return false;
  return evaluatePermissionForRole({
    role: params.role,
    entity: params.entity,
    action: legacy,
    roleRecord: params.roleRecord,
  }).allowed;
}

export function evaluateAuthorityForRole(params: {
  role: string;
  entity: PermissionEntity;
  action: AuthorityAction;
  roleRecord?: Pick<RolePermission, "entityPermissions" | "authorityModel"> | null;
  userOverride?: Partial<AuthorityModel> | null;
}): AuthorityEvaluationResult {
  const { role, entity, action, roleRecord, userOverride } = params;
  const authorityModel = (roleRecord?.authorityModel || null) as AuthorityModel | null;
  const ruleKey = `${entity}.${action}`;

  const roleRule = authorityModel?.rules?.[ruleKey] || authorityModel?.rules?.[`*.${action}`] || null;
  const userRule = userOverride?.userOverrides?.[ruleKey] || userOverride?.userOverrides?.[`*.${action}`] || null;

  if (roleRule || userRule) {
    const merged = normalizeAuthorityRule(action, {
      ...(roleRule || {}),
      ...(userRule || {}),
    });

    return {
      allowed: merged.enabled,
      action,
      scope: merged.scope,
      reason: merged.enabled
        ? `Allowed by authority model rule (${ruleKey}).`
        : `Blocked by authority model rule (${ruleKey}).`,
      source: "authority_model",
      constraints: {
        fieldRestrictions: merged.fieldRestrictions || [],
        approvalThresholds: merged.approvalThresholds || [],
        delegatedAuthority: merged.delegatedAuthority || [],
        assignmentRules: merged.assignmentRules || [],
      },
    };
  }

  const legacyAllowed = resolveLegacyEnabled({ role, action, entity, roleRecord });
  const fallbackAllowed = STRICTER_ACTIONS.includes(action) ? false : legacyAllowed;

  return {
    allowed: fallbackAllowed,
    action,
    scope: DEFAULT_SCOPE_BY_ACTION[action],
    reason: fallbackAllowed
      ? `Allowed via migration-safe legacy fallback (${action}).`
      : `No authority rule configured for ${ruleKey}; denied by migration-safe default.`,
    source: fallbackAllowed ? "legacy_fallback" : "none",
    constraints: {
      fieldRestrictions: [],
      approvalThresholds: [],
      delegatedAuthority: [],
      assignmentRules: [],
    },
  };
}

export function buildDefaultAuthorityTemplate(role: string, entity: PermissionEntity): Record<string, AuthorityRule> {
  const template: Record<string, AuthorityRule> = {};
  for (const action of AUTHORITY_ACTIONS) {
    template[`${entity}.${action}`] = normalizeAuthorityRule(action, {
      enabled: resolveLegacyEnabled({ role, action, entity }),
      scope: DEFAULT_SCOPE_BY_ACTION[action],
    });
  }
  return template;
}
