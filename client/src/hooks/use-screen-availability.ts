import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

interface ScreenSetting {
  screenId: string;
  isEnabled: boolean;
}

async function fetchScreenSettings(): Promise<ScreenSetting[]> {
  try {
    // Public endpoint (auth-only) — drives the client 404 gate for every user.
    // The admin-only /api/admin/screen-settings carries audit metadata; this
    // endpoint exposes only screenId + isEnabled so non-admins still see
    // disabled screens 404.
    const res = await fetch("/api/screen-settings", { credentials: "include" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export function useScreenAvailability() {
  const { data = [] } = useQuery<ScreenSetting[]>({
    queryKey: ["admin-screen-settings"],
    queryFn: fetchScreenSettings,
    staleTime: 5 * 60_000,
    // Fail silently — the endpoint is auth-only (no role check), so the only
    // failure modes are transient network errors. On error we return an empty
    // set, which means every screen is treated as enabled. That's the correct
    // soft-fail for a UX-layer gate: the server-side route still enforces the
    // canonical RBAC for the actual data the screen would render.
    retry: false,
  });

  const disabledScreenIds = useMemo(() => {
    const s = new Set<string>();
    for (const setting of data) {
      if (!setting.isEnabled) s.add(setting.screenId);
    }
    return s;
  }, [data]);

  return {
    isScreenEnabled: (id: string) => !disabledScreenIds.has(id),
    disabledScreenIds,
  };
}
