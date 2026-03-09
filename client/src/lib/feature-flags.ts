import { queryClient } from "./queryClient";
import type { RolloutFeatureFlagKey } from "@shared/feature-flags";

export interface RolloutFeatureFlagState {
  key: RolloutFeatureFlagKey;
  label: string;
  description: string;
  defaultValue: boolean;
  value: boolean;
}

export async function fetchRolloutFeatureFlags(): Promise<RolloutFeatureFlagState[]> {
  const response = await fetch("/api/feature-flags/rollout", { credentials: "include" });
  if (!response.ok) {
    throw new Error("Failed to fetch rollout feature flags");
  }
  const payload = await response.json();
  return Array.isArray(payload?.flags) ? payload.flags : [];
}

export async function getRolloutFeatureFlagValue(key: RolloutFeatureFlagKey): Promise<boolean> {
  const flags = await queryClient.fetchQuery({
    queryKey: ["rollout-feature-flags"],
    queryFn: fetchRolloutFeatureFlags,
    staleTime: 60_000,
  });

  return flags.find((flag) => flag.key === key)?.value ?? false;
}
