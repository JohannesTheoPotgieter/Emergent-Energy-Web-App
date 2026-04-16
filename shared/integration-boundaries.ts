/**
 * Integration boundary rules — the single source of truth for which
 * external system masters which data fields and how stale data should
 * be treated across the app.
 *
 * These rules are consumed by:
 *   - Sync services (to know which fields to overwrite vs preserve)
 *   - Handover flows (to surface stale integration data as warnings)
 *   - Stage gate evidence (to include integration freshness in snapshots)
 *   - Reporting surfaces (to flag stale reconciliation data)
 *   - The integration health dashboard (to derive per-connector freshness)
 *
 * Boundary contract:
 *   Pipedrive  → CRM truth       (deal stage, value, dates, client)
 *   SharePoint → Document truth   (proposals pipeline, intake metadata)
 *   App DB     → Execution truth  (COS realisation, handover, stage gates)
 *   QuickBooks → Reconciliation   (read-only bills/invoices for matching)
 */

// ===================== FIELD OWNERSHIP =====================

/**
 * Who masters a given field. Used by route guards and sync services
 * to decide whether to overwrite, warn, or block on field mutations.
 */
export type FieldOwner = "pipedrive" | "sharepoint" | "quickbooks" | "app";

export type FieldMutability =
  | "crm_overwrite"     // Overwritten every sync (e.g. deal value)
  | "seeded_once"       // Written at creation, preserved after (e.g. notes)
  | "app_owned"         // App is sole writer
  | "shared"            // Bidirectional with conflict detection
  | "read_only_mirror"  // Read from external, never written by app
  | "reconciliation"    // Read from external for matching, app decides action
  | "deprecated";       // Retained for schema stability, not maintained

export interface FieldBoundary {
  field: string;
  owner: FieldOwner;
  mutability: FieldMutability;
  /** What happens when the source is stale */
  staleBehavior: "warn" | "block" | "ignore";
}

// ===================== PIPEDRIVE BOUNDARIES =====================

export const PIPEDRIVE_FIELD_BOUNDARIES: FieldBoundary[] = [
  { field: "pipedriveDealId",  owner: "pipedrive", mutability: "crm_overwrite",    staleBehavior: "ignore" },
  { field: "source",           owner: "pipedrive", mutability: "crm_overwrite",    staleBehavior: "ignore" },
  { field: "clientId",         owner: "pipedrive", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "stage",            owner: "pipedrive", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "status",           owner: "pipedrive", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "estimatedValue",   owner: "pipedrive", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "expectedCloseDate",owner: "pipedrive", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "signedDate",       owner: "pipedrive", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "notes",            owner: "app",       mutability: "seeded_once",      staleBehavior: "ignore" },
  { field: "commercialRisks",  owner: "app",       mutability: "app_owned",        staleBehavior: "ignore" },
  { field: "fundingType",      owner: "app",       mutability: "app_owned",        staleBehavior: "ignore" },
  { field: "contractType",     owner: "app",       mutability: "app_owned",        staleBehavior: "ignore" },
  { field: "siteId",           owner: "app",       mutability: "app_owned",        staleBehavior: "ignore" },
  { field: "estimatedKwp",     owner: "app",       mutability: "app_owned",        staleBehavior: "ignore" },
  { field: "handoverReadiness",owner: "app",       mutability: "deprecated",       staleBehavior: "ignore" },
  { field: "dealOwnerUserId",  owner: "pipedrive", mutability: "deprecated",       staleBehavior: "ignore" },
  { field: "estimatedKwh",     owner: "pipedrive", mutability: "deprecated",       staleBehavior: "ignore" },
];

/** Fields overwritten on every Pipedrive sync — PATCH warns when editing these on synced rows. */
export const PIPEDRIVE_CRM_OWNED_FIELDS = PIPEDRIVE_FIELD_BOUNDARIES
  .filter(b => b.mutability === "crm_overwrite")
  .map(b => b.field);

// ===================== SHAREPOINT BOUNDARIES =====================

export const SHAREPOINT_FIELD_BOUNDARIES: FieldBoundary[] = [
  { field: "clientName",           owner: "sharepoint", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "projectDeveloper",     owner: "sharepoint", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "designer",            owner: "sharepoint", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "sizeKwp",             owner: "sharepoint", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "province",            owner: "sharepoint", mutability: "crm_overwrite",    staleBehavior: "warn" },
  { field: "status",              owner: "sharepoint", mutability: "shared",           staleBehavior: "warn" },
  { field: "priority",            owner: "sharepoint", mutability: "shared",           staleBehavior: "warn" },
  { field: "dueDate",             owner: "sharepoint", mutability: "shared",           staleBehavior: "warn" },
  { field: "comments",            owner: "sharepoint", mutability: "shared",           staleBehavior: "warn" },
  { field: "cpSigned",            owner: "app",        mutability: "app_owned",        staleBehavior: "ignore" },
  { field: "pmCreated",           owner: "app",        mutability: "app_owned",        staleBehavior: "ignore" },
  { field: "tasksGenerated",      owner: "app",        mutability: "app_owned",        staleBehavior: "ignore" },
  { field: "appNotes",            owner: "app",        mutability: "app_owned",        staleBehavior: "ignore" },
  { field: "appInternalBlockers", owner: "app",        mutability: "app_owned",        staleBehavior: "ignore" },
];

// ===================== QUICKBOOKS BOUNDARIES =====================

export const QUICKBOOKS_FIELD_BOUNDARIES: FieldBoundary[] = [
  { field: "bills",              owner: "quickbooks", mutability: "read_only_mirror",  staleBehavior: "warn" },
  { field: "invoices",           owner: "quickbooks", mutability: "read_only_mirror",  staleBehavior: "warn" },
  { field: "customers",          owner: "quickbooks", mutability: "read_only_mirror",  staleBehavior: "warn" },
  { field: "vendors",            owner: "quickbooks", mutability: "read_only_mirror",  staleBehavior: "warn" },
  { field: "linkConfirmation",   owner: "app",        mutability: "reconciliation",    staleBehavior: "warn" },
  { field: "cosRealisation",     owner: "app",        mutability: "app_owned",         staleBehavior: "ignore" },
  { field: "revenueRecognition", owner: "app",        mutability: "app_owned",         staleBehavior: "ignore" },
];

// ===================== FRESHNESS THRESHOLDS =====================

/**
 * Per-integration freshness thresholds. These determine when data
 * is considered "stale" and should be flagged in decision surfaces.
 *
 * Values are in milliseconds.
 */
export const INTEGRATION_FRESHNESS_THRESHOLDS = {
  /** Pipedrive: 25 hours — one grace hour for nightly sync. */
  pipedrive: 25 * 60 * 60 * 1000,
  /** SharePoint: 24 hours — daily pull expected. */
  sharepoint: 24 * 60 * 60 * 1000,
  /** QuickBooks: 2 hours — tight window for reconciliation accuracy. */
  quickbooks: 2 * 60 * 60 * 1000,
  /** Microsoft 365 (email/calendar/Teams): 1 hour — 15min sync + grace. */
  microsoft_365: 60 * 60 * 1000,
} as const;

export type IntegrationName = keyof typeof INTEGRATION_FRESHNESS_THRESHOLDS;

// ===================== BOUNDARY CHECK HELPERS =====================

export interface IntegrationFreshnessStatus {
  name: IntegrationName;
  displayName: string;
  lastSuccessAt: string | null;
  ageMs: number | null;
  staleAfterMs: number;
  isStale: boolean;
  isFailing: boolean;
  health: "healthy" | "stale" | "failing" | "unknown";
  warning: string | null;
}

/**
 * Compute the freshness status for a single integration given its
 * last successful sync timestamp.
 */
export function computeFreshnessStatus(
  name: IntegrationName,
  displayName: string,
  lastSuccessAt: Date | null,
  isFailing: boolean,
  now: Date = new Date(),
): IntegrationFreshnessStatus {
  const staleAfterMs = INTEGRATION_FRESHNESS_THRESHOLDS[name];

  if (!lastSuccessAt) {
    return {
      name,
      displayName,
      lastSuccessAt: null,
      ageMs: null,
      staleAfterMs,
      isStale: true,
      isFailing,
      health: isFailing ? "failing" : "unknown",
      warning: `${displayName} has never synced — data may be missing.`,
    };
  }

  const ageMs = now.getTime() - lastSuccessAt.getTime();
  const isStale = ageMs > staleAfterMs;

  let health: IntegrationFreshnessStatus["health"];
  if (isFailing) health = "failing";
  else if (isStale) health = "stale";
  else health = "healthy";

  let warning: string | null = null;
  if (isFailing) {
    warning = `${displayName} sync is failing — data may be outdated.`;
  } else if (isStale) {
    const hoursAgo = Math.round(ageMs / (60 * 60 * 1000));
    warning = `${displayName} last synced ${hoursAgo}h ago (threshold: ${Math.round(staleAfterMs / (60 * 60 * 1000))}h) — data may be stale.`;
  }

  return {
    name,
    displayName,
    lastSuccessAt: lastSuccessAt.toISOString(),
    ageMs,
    staleAfterMs,
    isStale,
    isFailing,
    health,
    warning,
  };
}
