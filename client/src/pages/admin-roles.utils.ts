export type RoleSummary = {
  role: string;
  label: string;
  description: string | null;
  sections: string[];
  entityPermissions: Record<string, Record<string, boolean>> | null;
  authorityModel?: { rules?: Record<string, { enabled?: boolean; scope?: string }> } | null;
  canManageUsers: boolean;
  canManageRoles: boolean;
  canEditData: boolean;
  isSystem: boolean;
  userCount?: number;
  configuredResources?: number;
  protected?: boolean;
};

export type UserSummary = { id: number; name: string; email: string; role: string };

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
