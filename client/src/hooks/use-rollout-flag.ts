import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRolloutFeatureFlags } from '@/lib/feature-flags';
import type { RolloutFeatureFlagKey } from '@shared/feature-flags';

export function useRolloutFlag(flagKey: RolloutFeatureFlagKey) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['rollout-feature-flags'],
    queryFn: fetchRolloutFeatureFlags,
    staleTime: 60_000,
  });

  const enabled = useMemo(
    () => data.find((flag) => flag.key === flagKey)?.value === true,
    [data, flagKey],
  );

  return { enabled, isLoading };
}
