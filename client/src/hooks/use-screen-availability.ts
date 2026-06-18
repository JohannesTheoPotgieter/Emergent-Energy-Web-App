import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

interface ScreenSetting {
  screenId: string;
  isEnabled: boolean;
}

/**
 * Bootstrap allow-list — the admin control surfaces that stay reachable even
 * when nothing has been signed off yet (e.g. a fresh production database whose
 * screen-settings table is empty).
 *
 * Screen visibility is fail-safe: a screen is HIDDEN and unreachable until it is
 * explicitly signed off (an `isEnabled = true` row). Without this carve-out the
 * default-hidden gate would also 404 the very pages an admin uses to sign
 * screens off — permanently locking everyone out of their own app. These pages
 * are still protected by RBAC (admin_roles) and the finance-only role
 * allow-list, so only admins can actually reach them.
 *
 * IDs match `PageRegistryEntry.id` in client/src/config/page-registry.ts.
 */
const ALWAYS_AVAILABLE_SCREEN_IDS = new Set<string>([
  "settingsHome", // /settings            — settings hub
  "adminRoles", // /admin/roles         — Roles & Permissions
  "adminFunctionality", // /admin/functionality — Functionality Control (sign-off)
]);

async function fetchScreenSettings(): Promise<ScreenSetting[]> {
  const res = await fetch("/api/screen-settings", { credentials: "include" });
  if (!res.ok) throw new Error(`Screen availability unavailable (${res.status})`);
  return res.json();
}

export function useScreenAvailability() {
  const { data = [], isError, isLoading, error, refetch } = useQuery<ScreenSetting[]>({
    queryKey: ["admin-screen-settings"],
    queryFn: fetchScreenSettings,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Screens explicitly signed off (isEnabled = true). Fail-safe model: a screen
  // is visible ONLY if it has been signed off here (or is a bootstrap control
  // surface). Anything without an enabled row stays hidden + unreachable.
  const enabledScreenIds = useMemo(() => {
    const s = new Set<string>();
    for (const setting of data) {
      if (setting.isEnabled) s.add(setting.screenId);
    }
    return s;
  }, [data]);

  // Screens explicitly turned OFF (isEnabled = false). Kept for the roles admin
  // panel, which greys out permission entities for screens an admin disabled.
  const disabledScreenIds = useMemo(() => {
    const s = new Set<string>();
    for (const setting of data) {
      if (!setting.isEnabled) s.add(setting.screenId);
    }
    return s;
  }, [data]);

  return {
    // Fail-safe: hidden unless explicitly signed off (or a bootstrap surface).
    isScreenEnabled: (id: string) =>
      ALWAYS_AVAILABLE_SCREEN_IDS.has(id) || enabledScreenIds.has(id),
    enabledScreenIds,
    disabledScreenIds,
    isDegraded: isError,
    isLoading,
    error,
    refetch,
  };
}
