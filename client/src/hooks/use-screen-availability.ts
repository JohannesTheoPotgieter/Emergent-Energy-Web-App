import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

interface ScreenSetting {
  screenId: string;
  isEnabled: boolean;
}

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
    isDegraded: isError,
    isLoading,
    error,
    refetch,
  };
}
