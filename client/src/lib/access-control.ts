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

export function normalizeRole(role?: string | null): string {
  const normalized = (role || "").trim().toUpperCase();
  const aliases: Record<string, string> = {
    ADMIN: "COO_ADMIN",
    COO: "COO_ADMIN",
    COO_SUPER_ADMIN: "COO_ADMIN",
    CEO: "CEO_ADMIN",
  };
  return aliases[normalized] || normalized;
}

export function isSuperAdmin(userRole?: string | null, companyRole?: string | null): boolean {
  const roles = [normalizeRole(userRole), normalizeRole(companyRole)];
  return roles.includes("COO_ADMIN") || roles.includes("CEO_ADMIN");
}
