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
