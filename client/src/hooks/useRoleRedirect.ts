import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { normalizeRoleForPermissions } from "@shared/schema";
import { ROLE_LANDING_PATHS } from "@shared/navigation/role-landing-paths";

const FALLBACK_PATH = "/dashboard";

export function useRoleRedirect(): string {
  const { user } = useAuth();

  return useMemo(() => {
    const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
    const effectiveRole = normalizeRoleForPermissions(user?.role || companyRole);

    if (!effectiveRole) {
      return FALLBACK_PATH;
    }

    return ROLE_LANDING_PATHS[effectiveRole as keyof typeof ROLE_LANDING_PATHS] ?? FALLBACK_PATH;
  }, [user?.role]);
}
