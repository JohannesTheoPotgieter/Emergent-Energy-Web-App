// =============================================================================
// access-control.ts — frontend role helpers (Task #101)
// =============================================================================
//
// CANONICAL FRONTEND GATE (use this in new code):
//
//   import { PermissionGate } from "@/components/PermissionGate";
//   <PermissionGate entity="financials" action="edit">…</PermissionGate>
//
//   // or as a hook
//   import { usePermission } from "@/hooks/use-permissions";
//   const canEdit = usePermission("financials", "edit");
//
// PermissionGate / usePermission ride on the SAME evaluator the server uses
// (entity × action) so a UI element shown is also a request that will succeed.
//
// The helpers in THIS file (normalizeRole / isSuperAdmin / role-equality
// checks) are kept ONLY for the legacy call sites that gate by raw role name
// (badges, role-aware copy, role landing pages). Do not extend them.
// New permission decisions belong on PermissionGate.
//
// =============================================================================

import { normalizeRoleForPermissions, ADMIN_ROLES } from "@shared/schema";

// Re-export the canonical normalizer under the legacy name so existing callers
// don't need to be updated.
export { normalizeRoleForPermissions as normalizeRole };

export function isSuperAdmin(userRole?: string | null, companyRole?: string | null): boolean {
  const roles = [normalizeRoleForPermissions(userRole), normalizeRoleForPermissions(companyRole)];
  return roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));
}
