export type Phase1ADomain = "project_reads" | "lifecycle_gates" | "approvals" | "finance" | "deliverables" | "party_contacts";

export interface Phase1AFlagSet {
  migration_bridge_project_read_v1: boolean;
  migration_bridge_lifecycle_read_v1: boolean;
  migration_bridge_approvals_dual_read_v1: boolean;
  migration_bridge_finance_read_v1: boolean;
  migration_bridge_deliverables_read_v1: boolean;
  migration_bridge_party_read_v1: boolean;
}

export function isPhase1AEndpointEnabled(compareMode: boolean, flags: { migration_bridge_project_read_v1: boolean }): boolean {
  return compareMode || Boolean(flags.migration_bridge_project_read_v1);
}

export function isPhase1ADomainEnabled(domain: Phase1ADomain, compareMode: boolean, flags: Phase1AFlagSet): boolean {
  if (compareMode) return true;
  if (domain === "project_reads") return flags.migration_bridge_project_read_v1;
  if (domain === "lifecycle_gates") return flags.migration_bridge_lifecycle_read_v1;
  if (domain === "approvals") return flags.migration_bridge_approvals_dual_read_v1;
  if (domain === "finance") return flags.migration_bridge_finance_read_v1;
  if (domain === "deliverables") return flags.migration_bridge_deliverables_read_v1;
  return flags.migration_bridge_party_read_v1;
}
