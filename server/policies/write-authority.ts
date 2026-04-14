/**
 * Write Authority Policy — Controls which tables may be written to and how.
 *
 * All write operations flow through centralized write services.
 * This module documents and enforces the write authority model.
 */

// ---------------------------------------------------------------------------
// Write authority registry
// ---------------------------------------------------------------------------

export type WriteTarget =
  | "normalized_cost_lines"
  | "normalized_revenue_lines"
  | "project_info"
  | "finance.cost_lines"
  | "finance.revenue_lines";

export type WriteAuthority = "write_service" | "bridge_only" | "blocked";

interface WriteAuthorityRule {
  target: WriteTarget;
  authority: WriteAuthority;
  writeService: string;
  description: string;
}

/**
 * The authoritative registry of which modules own writes to which tables.
 */
export const WRITE_AUTHORITY_REGISTRY: WriteAuthorityRule[] = [
  {
    target: "normalized_cost_lines",
    authority: "write_service",
    writeService: "server/services/finance-line-write-service.ts",
    description: "All cost line CRUD goes through finance-line-write-service",
  },
  {
    target: "normalized_revenue_lines",
    authority: "write_service",
    writeService: "server/services/finance-line-write-service.ts",
    description: "All revenue line CRUD goes through finance-line-write-service",
  },
  {
    target: "finance.cost_lines",
    authority: "bridge_only",
    writeService: "server/bridge/bridge-writer.ts",
    description: "Promoted cost_lines are written ONLY by bridge sync, never directly",
  },
  {
    target: "finance.revenue_lines",
    authority: "bridge_only",
    writeService: "server/bridge/bridge-writer.ts",
    description: "Promoted revenue_lines are written ONLY by bridge sync, never directly",
  },
  {
    target: "project_info",
    authority: "write_service",
    writeService: "server/storage.ts",
    description: "Project CRUD goes through storage layer with bridge sync",
  },
];

// ---------------------------------------------------------------------------
// Legacy-only fields (no bridge sync needed)
// ---------------------------------------------------------------------------

/**
 * Fields that exist ONLY in the legacy normalized tables, not in promoted schema.
 * Updates to these fields do NOT trigger a bridge sync.
 */
export const LEGACY_ONLY_COST_FIELDS = [
  "patternRuleId",
  "patternClassifiedAt",
  "patternInferredType",
  "adminDateOverride",
  "adminDateOverrideReason",
  "adminDateOverrideBy",
  "adminDateOverrideAt",
  "counterpartyId",
  "counterpartyType",
] as const;

export const LEGACY_ONLY_REVENUE_FIELDS = [
  "adminDateOverride",
  "adminDateOverrideReason",
  "adminDateOverrideBy",
  "adminDateOverrideAt",
] as const;

/**
 * Check if a field update requires bridge sync.
 */
export function requiresBridgeSync(
  table: "cost" | "revenue",
  fieldName: string,
): boolean {
  const legacyOnly = table === "cost"
    ? LEGACY_ONLY_COST_FIELDS
    : LEGACY_ONLY_REVENUE_FIELDS;
  return !(legacyOnly as readonly string[]).includes(fieldName);
}

// ---------------------------------------------------------------------------
// Blocked write paths
// ---------------------------------------------------------------------------

/**
 * Tables that are permanently blocked from direct writes.
 * Empty by default. Populate with a superseded table name if you need to
 * block direct writes at runtime while an in-flight cutover is in progress.
 */
export const BLOCKED_WRITE_TARGETS: readonly string[] = [] as const;

/**
 * Check if a write target is blocked.
 */
export function isWriteBlocked(tableName: string): boolean {
  return (BLOCKED_WRITE_TARGETS as readonly string[]).includes(tableName);
}
