export function normalizeRole(role?: string | null): string {
  return (role || "").trim().toUpperCase();
}

export function isSuperAdmin(userRole?: string | null, companyRole?: string | null): boolean {
  const roles = [normalizeRole(userRole), normalizeRole(companyRole)];
  return roles.includes("ADMIN") || roles.includes("COO_ADMIN") || roles.includes("CEO_ADMIN");
}
