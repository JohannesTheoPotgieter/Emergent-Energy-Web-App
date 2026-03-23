export const FEATURE_FLAG_KEYS = [
  "role_aware_ux",
  "contextual_ms_surfaces",
  "ms_create_action",
  "local_synced_save_flow",
  "cleaned_admin_visibility",
  "promoted_core_clients_read",
  "promoted_core_projects_read",
  "promoted_core_portfolios_read",
  "promoted_core_portfolio_assignments_read",
  "promoted_core_project_detail_read",
  "promoted_core_work_item_summary_read",
  "promoted_core_clients_dual_write",
  "promoted_core_project_master_dual_write",
  "imports_source_update_governance_preview",

  "promoted_project_management_read",
  "promoted_project_development_read",
  "promoted_documentation_read",
  "promoted_finance_read",
  "imports_governance_enforcement_preview",
  "promoted_engineering_read",
  "promoted_quality_read",
  "task_management_hub",
  "standup_system",
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
    defaultValue: true,
  },
  {
    key: "promoted_core_projects_read",
    label: "Promoted core projects read",
    description: "Controls additive read-only adoption of project master reads from core.projects with comparison support.",
    defaultValue: true,
  },
  {
    key: "promoted_core_portfolios_read",
    label: "Promoted core portfolios read",
    description: "Controls additive read-only adoption of portfolio summary reads from core.portfolios with comparison support.",
    defaultValue: true,
  },
  {
    key: "promoted_core_portfolio_assignments_read",
    label: "Promoted core portfolio assignments read",
    description: "Controls additive read-only adoption of project-portfolio assignment reads from core.project_portfolio_assignments.",
    defaultValue: true,
  },
  {
    key: "promoted_core_project_detail_read",
    label: "Promoted core project detail read",
    description: "Controls additive promoted-read expansion for project identity/client/phase/rag master sections with legacy fallback.",
    defaultValue: true,
  },
  {
    key: "promoted_core_work_item_summary_read",
    label: "Promoted core work-item summary diagnostics",
    description: "Controls read-only diagnostics comparing public.work_items vs core.work_items summary metrics by project.",
    defaultValue: false,
  },
  {
    key: "promoted_core_clients_dual_write",
    label: "Promoted core clients dual-write",
    description: "Controls optional mirrored writes from public.clients into core.clients while keeping legacy as primary.",
    defaultValue: true,
  },
  {
    key: "promoted_core_project_master_dual_write",
    label: "Promoted core project master dual-write",
    description: "Controls optional mirrored writes from public.project_info master metadata into core.projects while keeping legacy as primary.",
    defaultValue: true,
  },
  {
    key: "imports_source_update_governance_preview",
    label: "Imports source-update governance preview",
    description: "Controls non-blocking preview hooks for imports source update requests/acknowledgements/conflict readiness reporting.",
    defaultValue: false,
  },

  {
    key: "promoted_project_management_read",
    label: "Promoted project management read",
    description: "Controls compatibility-backed promoted reads for project_management schema while legacy PM routes remain primary.",
    defaultValue: false,
  },
  {
    key: "promoted_project_development_read",
    label: "Promoted project development read",
    description: "Controls compatibility-backed promoted reads for PD intake/tickets while legacy sync paths remain primary.",
    defaultValue: false,
  },
  {
    key: "promoted_documentation_read",
    label: "Promoted documentation lifecycle read",
    description: "Controls promoted documentation lifecycle reads with legacy deliverable fallback.",
    defaultValue: false,
  },
  {
    key: "promoted_finance_read",
    label: "Promoted finance read",
    description: "Controls promoted finance reporting reads with duplicate/collision diagnostics.",
    defaultValue: false,
  },
  {
    key: "imports_governance_enforcement_preview",
    label: "Imports governance enforcement preview",
    description: "Controls bounded imports governance enforcement preview checks; blocking behavior remains disabled by default.",
    defaultValue: false,
  },
  {
    key: "promoted_engineering_read",
    label: "Promoted engineering read",
    description: "Controls compatibility-backed promoted engineering metadata reads while core.work_items remains shared execution engine.",
    defaultValue: false,
  },
  {
    key: "promoted_quality_read",
    label: "Promoted quality read",
    description: "Controls compatibility-backed promoted quality reads while legacy QC endpoints remain default.",
    defaultValue: false,
  },
  {
    key: "task_management_hub",
    label: "Task management hub",
    description: "Controls visibility of the unified task management hub with board, list, calendar, and metrics views.",
    defaultValue: false,
  },
  {
    key: "standup_system",
    label: "Standup system",
    description: "Controls the bi-daily standup system with async submissions, team views, and analytics.",
    defaultValue: true,
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
