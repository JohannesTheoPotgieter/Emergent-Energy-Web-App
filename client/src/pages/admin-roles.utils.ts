export type RoleSummary = {
  role: string;
  label: string;
  description: string | null;
  sections: string[];
  entityPermissions: Record<string, Record<string, boolean>> | null;
  authorityModel?: { rules?: Record<string, { enabled?: boolean; scope?: string }> } | null;
  authoritySummary?: Array<{
    entity: string;
    actions: Array<{
      action: string;
      allowed: boolean;
      scope: string;
      reason?: string;
      source?: string;
    }>;
  }> | null;
  canManageUsers: boolean;
  canManageRoles: boolean;
  canEditData: boolean;
  isSystem: boolean;
  userCount?: number;
  configuredResources?: number;
  protected?: boolean;
};

export type UserSummary = { id: number; name: string; email: string; role: string; department?: string | null };

export type AdminRolesViewState = "loading" | "error" | "empty" | "ready";

export function resolveSelectedRole(currentRole: string, roles: RoleSummary[]): string {
  if (!roles.length) return "";
  if (currentRole && roles.some((role) => role.role === currentRole)) return currentRole;
  return roles[0]?.role || "";
}

export function resolveAdminRolesViewState(params: {
  isLoading: boolean;
  hasError: boolean;
  roleCount: number;
  canManageRoles: boolean;
}): AdminRolesViewState {
  if (params.isLoading) return "loading";
  if (params.hasError) return "error";
  if (params.roleCount === 0) return "empty";
  return "ready";
}

export function canManageRoleActions(hasPermissionFlag: boolean, requestOk: boolean): boolean {
  if (!requestOk) return false;
  return hasPermissionFlag;
}

export type AuthorityCategory = {
  label: string;
  items: string[];
};

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function buildRoleAuthorityCategories(role: RoleSummary | undefined | null): AuthorityCategory[] {
  if (!role) return [];

  const authoritySummary = role.authoritySummary || [];
  const allowedRows = authoritySummary.flatMap((row) =>
    row.actions
      .filter((action) => action.allowed)
      .map((action) => ({ entity: row.entity, ...action })),
  );

  const financialKeywords = ["finance", "cashflow", "procurement", "revenue", "cost", "budget", "money"];
  const moduleAccess = uniqueSorted(role.sections || []);
  const authorityItems = uniqueSorted(allowedRows
    .filter((row) => ["view", "edit", "delete", "approve"].includes(row.action))
    .map((row) => `${row.entity}.${row.action}`));
  const projectScope = uniqueSorted(allowedRows
    .filter((row) => ["view", "create", "edit", "approve"].includes(row.action))
    .map((row) => row.scope));
  const departmentScope = uniqueSorted(allowedRows
    .filter((row) => row.scope === "department")
    .map((row) => row.entity));
  const assignmentRights = uniqueSorted(allowedRows
    .filter((row) => row.action === "assign" || row.action === "reassign")
    .map((row) => `${row.entity}.${row.action}`));
  const approvalRights = uniqueSorted(allowedRows
    .filter((row) => row.action === "approve")
    .map((row) => row.entity));
  const financialAuthority = uniqueSorted(allowedRows
    .filter((row) => financialKeywords.some((keyword) => row.entity.toLowerCase().includes(keyword)))
    .map((row) => `${row.entity}.${row.action}`));
  const adminActions = uniqueSorted([
    ...(role.canManageUsers ? ["manage_users"] : []),
    ...(role.canManageRoles ? ["manage_roles"] : []),
    ...allowedRows.filter((row) => row.action === "manage_settings").map((row) => `${row.entity}.${row.action}`),
  ]);

  return [
    { label: "Module access", items: moduleAccess },
    { label: "View / edit / delete / approve", items: authorityItems },
    { label: "Project scope", items: projectScope },
    { label: "Department scope", items: departmentScope },
    { label: "Assignment rights", items: assignmentRights },
    { label: "Approval rights", items: approvalRights },
    { label: "Financial authority", items: financialAuthority },
    { label: "Admin-only actions", items: adminActions },
  ];
}
