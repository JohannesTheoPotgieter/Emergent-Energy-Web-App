/**
 * Centralised Pipedrive → app field mapping registry.
 *
 * Single source of truth for every Pipedrive deal field the sync engine
 * looks at. Each entry declares:
 *   - source         the Pipedrive payload key (or hash for custom fields)
 *   - target         the `opportunities.<column>` (or `null` for purely
 *                    derived/transformed inputs that don't map 1:1)
 *   - owner          'pipedrive' = CRM truth, overwrite on every sync;
 *                    'app'       = app-owned, sync MUST NOT touch;
 *                    'derived'   = computed from another field;
 *                    'enrichment'= populated from a side-call (person, owner
 *                                  email→user_id) that doesn't fit a 1:1 map
 *   - nullsOverwrite when true, a null Pipedrive value overwrites the
 *                    app value (e.g. clearing `signedDate` after a deal
 *                    is reopened). When false, nulls leave the app
 *                    column untouched (used for sparse custom fields).
 *   - transform      optional coercion fn (Pipedrive raw value → DB value)
 *   - notes          free-form, surfaces in the runbook & code review
 *
 * Adding a new Pipedrive field is a one-line entry here — the sync engine
 * picks it up automatically.
 *
 * App-owned fields are listed for negative-assertion: tests check that
 * the sync engine never writes to them.
 */
import type { opportunities } from "@shared/schema/projects";

export type FieldOwner = "pipedrive" | "app" | "derived" | "enrichment";

/** Subset of the opportunities columns that the sync may write. Used as
 *  the typed payload shape returned by `buildCrmOwnedFieldsFromDeal` so
 *  downstream Drizzle update/insert calls don't need any casts. */
export type OpportunityWritablePayload = Partial<typeof opportunities.$inferInsert>;

export interface PipedriveFieldMapping {
  source: string;
  target: keyof typeof opportunities.$inferInsert | null;
  owner: FieldOwner;
  nullsOverwrite: boolean;
  transform?: (raw: unknown, ctx?: PipedriveTransformCtx) => unknown;
  notes?: string;
}

export interface PipedriveTransformCtx {
  /** Resolved Pipedrive `stage_id` → stage name (or null). */
  stageName: string | null;
  /** Resolved labelId → label name lookup. */
  labelMap: Map<string, string>;
}

// ===================== CUSTOM FIELD HASHES =====================

/**
 * Pipedrive custom-field hash IDs. Resolved against the live `/dealFields`
 * API on 2026-04-20. Do NOT change unless the Pipedrive admin re-creates
 * the field — these are stable per Pipedrive workspace.
 */
export const PIPEDRIVE_CUSTOM_FIELD_KEYS = {
  leadLocation: "e3a7ca9b4908d9782ed92ebe556ec504c0cf34f8",
  systemSizeKwp: "9b187266d1c0d4c27b7440f0b190677ad6cada35",
  batterySizeKwh: "9b74781dcf72f283c9d3f774f507564788771510",
} as const;

/** Lead Location option id → SA province name. Pipedrive returns option ids
 *  as a comma-joined string when the field is a `set` type. */
export const LEAD_LOCATION_TO_PROVINCE: Record<string, string> = {
  "65": "Gauteng",          // Joburg
  "66": "Western Cape",     // Cape Town
  "67": "KwaZulu-Natal",    // Durban
  "68": "Eastern Cape",     // Port Elizabeth
  "69": "Eastern Cape",     // East London
  "70": "Free State",       // Bloem
  // 71 = "Other" → leave null
};

// ===================== TRANSFORMS =====================

export function asNumericString(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? String(n) : null;
}

export function resolveProvinceFromLeadLocation(raw: unknown): string | null {
  if (raw == null) return null;
  const first = String(raw).split(",")[0]?.trim();
  if (!first) return null;
  return LEAD_LOCATION_TO_PROVINCE[first] ?? null;
}

export function parsePipedriveDate(s: unknown): Date | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
}

/** Pipedrive returns `won_time` as 'YYYY-MM-DD HH:MM:SS' UTC. The
 *  `signed_date` column is a DATE so we strip the time part. */
export function pipedriveDateOnly(s: unknown): string | null {
  if (typeof s !== "string" || !s) return null;
  return s.split(" ")[0] || null;
}

/** Render a CSV of label option ids → joined CSV of label names. */
export function renderLabels(raw: unknown, ctx?: PipedriveTransformCtx): string | null {
  if (raw == null || !ctx) return null;
  return String(raw)
    .split(",")
    .map(id => ctx.labelMap.get(id.trim()) ?? id.trim())
    .filter(Boolean)
    .join(", ") || null;
}

/** Coerce `pipedrive_org_id` consistently to text — the column is text and
 *  every existing row uses the string form. The same coercion is used on
 *  client lookup AND client insert to remove any chance of an int↔text
 *  mismatch. */
export function coerceOrgIdToText(raw: number | string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  return String(raw).trim() || null;
}

// ===================== REGISTRY =====================

/**
 * The mapping registry. Order is documentation; runtime behaviour is the
 * same regardless of position. CRM-owned entries drive the UPDATE/INSERT
 * payload; app-owned entries are negative assertions surfaced in tests.
 */
export const PIPEDRIVE_FIELD_REGISTRY: PipedriveFieldMapping[] = [
  // --- Identity ---
  { source: "id",                  target: "pipedriveDealId",    owner: "pipedrive", nullsOverwrite: false,
    transform: (v) => (v == null ? null : String(v)),
    notes: "Stable Pipedrive deal id, used as upsert key." },
  { source: "_constant_source",    target: "source",             owner: "pipedrive", nullsOverwrite: false,
    transform: () => "pipedrive",
    notes: "Stamped on every synced row to identify CRM-managed opportunities." },

  // --- Core deal facts (CRM-owned, overwrite every sync) ---
  { source: "title",               target: "dealName",           owner: "pipedrive", nullsOverwrite: false,
    transform: (v) => (typeof v === "string" && v.trim()) || null },
  { source: "value",               target: "estimatedValue",     owner: "pipedrive", nullsOverwrite: true,
    transform: (v) => (v == null || v === "" ? null : String(v)) },
  { source: "currency",            target: "currency",           owner: "pipedrive", nullsOverwrite: false,
    transform: (v) => (typeof v === "string" && v) || "ZAR" },
  { source: "_derived_stage",      target: "stage",              owner: "derived",   nullsOverwrite: true,
    notes: "Derived via resolvePipedriveStageMapping(stage_id, status)." },
  { source: "_derived_status",     target: "status",             owner: "derived",   nullsOverwrite: true,
    notes: "Derived via resolvePipedriveStageMapping(stage_id, status)." },
  { source: "expected_close_date", target: "expectedCloseDate",  owner: "pipedrive", nullsOverwrite: true },
  { source: "won_time",            target: "signedDate",         owner: "pipedrive", nullsOverwrite: true,
    transform: pipedriveDateOnly },
  { source: "probability",         target: "probability",        owner: "pipedrive", nullsOverwrite: true,
    transform: (v) => (v == null ? null : String(v)) },
  { source: "weighted_value",      target: "weightedValue",      owner: "pipedrive", nullsOverwrite: true,
    transform: (v) => (v == null ? null : String(v)) },
  { source: "lost_reason",         target: "lostReason",         owner: "pipedrive", nullsOverwrite: true },
  { source: "lost_time",           target: "lostTime",           owner: "pipedrive", nullsOverwrite: true,
    transform: parsePipedriveDate },

  // --- Pipedrive timestamps ---
  { source: "update_time",         target: "pipedriveUpdatedAt", owner: "pipedrive", nullsOverwrite: false,
    transform: parsePipedriveDate },
  { source: "stage_change_time",   target: "pipedriveStageChangedAt", owner: "pipedrive", nullsOverwrite: false,
    transform: parsePipedriveDate },

  // --- Activity ---
  { source: "activities_count",    target: "activitiesCount",    owner: "pipedrive", nullsOverwrite: false,
    transform: (v) => (typeof v === "number" ? v : Number(v) || 0) },
  { source: "last_activity_date",  target: "lastActivityDate",   owner: "pipedrive", nullsOverwrite: true },
  { source: "next_activity_date",  target: "nextActivityDate",   owner: "pipedrive", nullsOverwrite: true },
  { source: "next_activity_subject", target: "nextActivitySubject", owner: "pipedrive", nullsOverwrite: true },
  { source: "label",               target: "labels",             owner: "pipedrive", nullsOverwrite: true,
    transform: renderLabels },

  // --- Person snapshot (filled by enrichment phase) ---
  { source: "_enrich_person_name",  target: "personName",  owner: "enrichment", nullsOverwrite: false },
  { source: "_enrich_person_email", target: "personEmail", owner: "enrichment", nullsOverwrite: false },
  { source: "_enrich_person_phone", target: "personPhone", owner: "enrichment", nullsOverwrite: false },

  // --- Owner enrichment ---
  { source: "_enrich_owner_user_id", target: "dealOwnerUserId", owner: "enrichment", nullsOverwrite: false,
    notes: "Email-matched local users.id for the Pipedrive deal owner; null when no match." },
  { source: "_enrich_owner_name",    target: "dealOwnerName",   owner: "enrichment", nullsOverwrite: false,
    notes: "Snapshot of Pipedrive owner display name." },

  // --- Custom fields (sparse — nulls do NOT overwrite) ---
  { source: PIPEDRIVE_CUSTOM_FIELD_KEYS.leadLocation,  target: "province",     owner: "pipedrive", nullsOverwrite: false,
    transform: resolveProvinceFromLeadLocation,
    notes: "Pipedrive 'Lead Location' set field → SA province." },
  { source: PIPEDRIVE_CUSTOM_FIELD_KEYS.systemSizeKwp, target: "estimatedKwp", owner: "pipedrive", nullsOverwrite: false,
    transform: asNumericString },
  { source: PIPEDRIVE_CUSTOM_FIELD_KEYS.batterySizeKwh, target: "estimatedKwh", owner: "pipedrive", nullsOverwrite: false,
    transform: asNumericString },

  // --- App-owned (NEVER touched by sync — listed for negative assertion) ---
  { source: "_app_notes",            target: "notes",            owner: "app", nullsOverwrite: false,
    notes: "User-written notes; sync may seed on INSERT only, never overwrite on UPDATE." },
  { source: "_app_commercial_risks", target: "commercialRisks",  owner: "app", nullsOverwrite: false },
  { source: "_app_funding_type",     target: "fundingType",      owner: "app", nullsOverwrite: false },
  { source: "_app_contract_type",    target: "contractType",     owner: "app", nullsOverwrite: false },
  { source: "_app_site_id",          target: "siteId",           owner: "app", nullsOverwrite: false },
  { source: "_app_handover_readiness", target: "handoverReadiness", owner: "app", nullsOverwrite: false },
];

// ===================== APPLY HELPERS =====================

/** Set of column names the sync may write. Used by the diff/idempotency
 *  step to ignore any column the registry hasn't claimed for Pipedrive. */
export const PIPEDRIVE_WRITABLE_COLUMNS: ReadonlySet<string> = new Set(
  PIPEDRIVE_FIELD_REGISTRY
    .filter(m => m.owner !== "app" && m.target != null)
    .map(m => String(m.target)),
);

/** Set of columns the sync MUST NOT write under any circumstance. */
export const PIPEDRIVE_APP_OWNED_COLUMNS: ReadonlySet<string> = new Set(
  PIPEDRIVE_FIELD_REGISTRY
    .filter(m => m.owner === "app" && m.target != null)
    .map(m => String(m.target)),
);

/**
 * Build the CRM-owned `SET` payload for an UPDATE/INSERT from a Pipedrive
 * deal payload + enrichment side-data. Returns only fields the sync owns
 * — `notes` and other app-owned columns are deliberately absent.
 *
 * The returned object's keys are exactly the `opportunities` column names
 * the sync writes; callers spread it into the drizzle update/insert.
 */
export function buildCrmOwnedFieldsFromDeal(
  deal: Record<string, unknown>,
  ctx: {
    stageName: string | null;
    labelMap: Map<string, string>;
    appStage: string;
    appStatus: string;
    enrichment: {
      ownerUserId: number | null;
      ownerName: string | null;
      personName: string | null;
      personEmail: string | null;
      personPhone: string | null;
    };
    clientId: number | null;
  },
): OpportunityWritablePayload {
  const out: Record<string, unknown> = {};
  const transformCtx: PipedriveTransformCtx = { stageName: ctx.stageName, labelMap: ctx.labelMap };

  for (const m of PIPEDRIVE_FIELD_REGISTRY) {
    if (m.owner === "app" || m.target == null) continue;

    let raw: unknown;
    switch (m.source) {
      case "_derived_stage":         raw = ctx.appStage; break;
      case "_derived_status":        raw = ctx.appStatus; break;
      case "_constant_source":       raw = "pipedrive"; break;
      case "_enrich_owner_user_id":  raw = ctx.enrichment.ownerUserId; break;
      case "_enrich_owner_name":     raw = ctx.enrichment.ownerName; break;
      case "_enrich_person_name":    raw = ctx.enrichment.personName; break;
      case "_enrich_person_email":   raw = ctx.enrichment.personEmail; break;
      case "_enrich_person_phone":   raw = ctx.enrichment.personPhone; break;
      default:                       raw = deal[m.source];
    }

    const value = m.transform ? m.transform(raw, transformCtx) : raw;
    if (value === null || value === undefined) {
      if (m.nullsOverwrite) {
        out[String(m.target)] = null;
      }
      // else: leave column alone — do not include in payload
      continue;
    }
    out[String(m.target)] = value;
  }

  // clientId is owned by the sync but resolved out-of-band against the
  // clients table — slot it in here so callers don't have to remember.
  out.clientId = ctx.clientId;

  return out as OpportunityWritablePayload;
}

// ===================== ERROR CLASSIFICATION =====================

export type SyncErrorClass =
  | "missing_org"
  | "missing_field"
  | "schema_mismatch"
  | "type_coercion"
  | "api_error"
  | "client_resolve"
  | "unknown";

export interface StructuredSyncError {
  dealId: number | null;
  dealTitle: string | null;
  class: SyncErrorClass;
  message: string;
  retryable: boolean;
}

/**
 * Best-effort classification of an error thrown from `syncSingleDeal` or
 * the wrapping API call. Keeps the admin UI free of raw SQL/JSON dumps.
 */
export function classifySyncError(err: unknown): { class: SyncErrorClass; retryable: boolean; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  // Postgres "column does not exist" / "relation does not exist" — the
  // Drizzle-generated SELECT bumped into a missing column. This means
  // dev/prod migration parity is broken; report it loudly so the
  // operator runs db:push.
  if (lower.includes("column") && lower.includes("does not exist")) {
    return { class: "schema_mismatch", retryable: false, message: extractPgErrorLine(raw) };
  }
  if (lower.includes("relation") && lower.includes("does not exist")) {
    return { class: "schema_mismatch", retryable: false, message: extractPgErrorLine(raw) };
  }
  if (lower.includes("invalid input syntax") || lower.includes("invalid text representation")) {
    return { class: "type_coercion", retryable: false, message: extractPgErrorLine(raw) };
  }
  if (lower.includes("missing org") || lower.includes("org_id")) {
    return { class: "missing_org", retryable: false, message: raw };
  }
  if (lower.includes("pipedrive api error") || lower.includes("fetch failed") || lower.includes("etimedout") || lower.includes("econnreset")) {
    return { class: "api_error", retryable: true, message: raw };
  }
  if (lower.includes("client") && (lower.includes("unique") || lower.includes("duplicate"))) {
    return { class: "client_resolve", retryable: true, message: extractPgErrorLine(raw) };
  }
  return { class: "unknown", retryable: false, message: raw };
}

/** Pull the most informative line out of a Postgres / Drizzle error. The
 *  full "Failed query: select ... from clients ..." dumps are useless to
 *  admins and crowd out the actual error text. */
function extractPgErrorLine(raw: string): string {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  // Prefer the line that names the actual problem.
  const signal = lines.find(l => /does not exist|invalid input syntax|violates|duplicate key|syntax error/i.test(l));
  const pick = signal
    ?? lines.find(l => !/^Failed query:/i.test(l) && !/^params:/i.test(l))
    ?? lines[0]
    ?? raw;
  // Strip a leading "error:" prefix that Postgres/node-pg sometimes adds.
  const cleaned = pick.replace(/^error:\s*/i, "").trim();
  return cleaned.length > 240 ? `${cleaned.slice(0, 240)}…` : cleaned;
}
