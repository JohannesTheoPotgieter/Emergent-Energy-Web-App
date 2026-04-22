import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

interface ScreenSetting {
  screenId: string;
  isEnabled: boolean;
}

async function fetchScreenSettings(): Promise<ScreenSetting[]> {
  try {
    const res = await fetch("/api/admin/screen-settings", { credentials: "include" });
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
    // Fail silently — non-admins will get a 403 and see all screens as enabled
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
