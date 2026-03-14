export const FEATURE_FLAG_KEYS = [
  "role_aware_ux",
  "contextual_ms_surfaces",
  "ms_create_action",
  "local_synced_save_flow",
  "cleaned_admin_visibility",
  "promoted_core_clients_read",
] as const;

export type RolloutFeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export interface FeatureFlagDefinition {
  key: RolloutFeatureFlagKey;
  label: string;
  description: string;
  defaultValue: boolean;
}

export const ROLLOUT_FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    key: "role_aware_ux",
    label: "Role-aware UX",
    description: "Controls role-aware landing and UX enhancements for phased rollout.",
    defaultValue: false,
  },
  {
    key: "contextual_ms_surfaces",
    label: "Contextual Microsoft surfaces",
    description: "Controls contextual Microsoft surfaces in core workflows.",
    defaultValue: false,
  },
  {
    key: "ms_create_action",
    label: "Microsoft create actions",
    description: "Controls action entry-points that create Microsoft artifacts.",
    defaultValue: false,
  },
  {
    key: "local_synced_save_flow",
    label: "Local + synced save flow",
    description: "Controls rollout of local-first save with background sync.",
    defaultValue: false,
  },
  {
    key: "cleaned_admin_visibility",
    label: "Cleaned admin visibility",
    description: "Controls progressive visibility cleanup in admin/settings areas.",
    defaultValue: false,
  },

  {
    key: "promoted_core_clients_read",
    label: "Promoted core clients read",
    description: "Controls additive read-only adoption of clients from core.clients with comparison support.",
    defaultValue: false,
  },
];

export const ROLLOUT_FEATURE_FLAG_MAP: Record<RolloutFeatureFlagKey, FeatureFlagDefinition> =
  ROLLOUT_FEATURE_FLAGS.reduce((acc, flag) => {
    acc[flag.key] = flag;
    return acc;
  }, {} as Record<RolloutFeatureFlagKey, FeatureFlagDefinition>);

export function isRolloutFeatureFlagKey(value: string): value is RolloutFeatureFlagKey {
  return FEATURE_FLAG_KEYS.includes(value as RolloutFeatureFlagKey);
}
