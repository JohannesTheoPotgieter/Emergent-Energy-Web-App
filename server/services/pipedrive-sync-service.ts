/**
 * D1: Pipedrive sync service
 *
 * Read-only sync from Pipedrive CRM into the opportunities table.
 * Pipedrive is the CRM truth — this service reads deals and maps them
 * to local Opportunity records.
 *
 * Prerequisites:
 *   - PIPEDRIVE_API_TOKEN environment variable
 *   - opportunities table (migration 20260351)
 *   - clients table with pipedrive_org_id (migration 20260349)
 *
 * Rate limiting: Pipedrive allows 100 requests per 10 seconds.
 */

import { db } from "../db";
import { eq, isNull, sql as drizzleSql } from "drizzle-orm";
import { opportunities, clients } from "@shared/schema/projects";
import { users } from "@shared/schema/users";
import { resolvePipedriveStageMapping } from "@shared/pipedrive-stage-map";

// ===================== TYPES =====================

interface PipedriveDeal {
  id: number;
  title: string;
  value: number;
  currency: string;
  status: string;           // 'open', 'won', 'lost', 'deleted'
  stage_id: number;
  pipeline_id: number;
  org_id: { value: number; name: string } | null;
  /**
   * Pipedrive v1 returns the deal owner under `user_id`, not `owner_id`
   * (the latter is null on modern responses). Field name corrected
   * 2026-04-20 after `deal_owner_name` came up empty across all 622 active
   * rows — root cause was that the old `owner_id` path never resolved.
   */
  user_id: { id: number; name: string; email: string } | null;
  person_id: { value: number; name: string; email?: Array<{ value: string }>; phone?: Array<{ value: string }> } | null;
  expected_close_date: string | null;
  won_time: string | null;
  lost_time: string | null;
  lost_reason: string | null;
  stage_change_time: string | null;
  probability: number | null;
  weighted_value: number | null;
  activities_count: number | null;
  last_activity_date: string | null;
  next_activity_date: string | null;
  next_activity_subject: string | null;
  label: string | number | null;       // Pipedrive returns label id(s); rendered to text via labelMap
  add_time: string;
  update_time: string;
  // Pipedrive custom fields (hash-keyed). Indexed dynamically via CUSTOM_FIELD_KEYS.
  [customFieldHash: string]: unknown;
}

/**
 * Pipedrive custom-field hash IDs. These were resolved against the live
 * `/dealFields` API on 2026-04-20 — DO NOT change unless the Pipedrive
 * admin re-creates the field. They map to existing opportunity columns
 * (no new schema needed):
 *
 *   Lead Location (set, opt id) → opportunities.province (string)
 *   System Size kWp (double)    → opportunities.estimated_kwp (numeric)
 *   Battery Size kWh (double)   → opportunities.estimated_kwh (numeric)
 */
const CUSTOM_FIELD_KEYS = {
  leadLocation: "e3a7ca9b4908d9782ed92ebe556ec504c0cf34f8",
  systemSizeKwp: "9b187266d1c0d4c27b7440f0b190677ad6cada35",
  batterySizeKwh: "9b74781dcf72f283c9d3f774f507564788771510",
} as const;

/** Lead Location option id → SA province name. */
const LEAD_LOCATION_TO_PROVINCE: Record<string, string> = {
  "65": "Gauteng",          // Joburg
  "66": "Western Cape",     // Cape Town
  "67": "KwaZulu-Natal",    // Durban
  "68": "Eastern Cape",     // Port Elizabeth
  "69": "Eastern Cape",     // East London
  "70": "Free State",       // Bloem
  // 71 = "Other" → leave null
};

function resolveProvinceFromLeadLocation(raw: unknown): string | null {
  if (raw == null) return null;
  // Pipedrive `set` fields come back as a comma-joined option-id string.
  const first = String(raw).split(",")[0]?.trim();
  if (!first) return null;
  return LEAD_LOCATION_TO_PROVINCE[first] ?? null;
}

function asNumericString(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? String(n) : null;
}

interface PipedrivePerson {
  id: number;
  name: string;
  email?: Array<{ value: string; primary?: boolean }>;
  phone?: Array<{ value: string; primary?: boolean }>;
}

interface PipedriveDealField {
  key: string;
  name: string;
  options?: Array<{ id: number; label: string }>;
}

interface PipedriveStage {
  id: number;
  name: string;
  pipeline_id: number;
  active_flag: boolean;
}

interface PipedriveSyncResult {
  dealsProcessed: number;
  dealsCreated: number;
  dealsUpdated: number;
  errors: string[];
  skipped: number;
}

// ===================== API CLIENT =====================

class PipedriveClient {
  private baseUrl = "https://api.pipedrive.com/v1";
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async apiGet(path: string): Promise<unknown> {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${path}${sep}api_token=${this.token}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pipedrive API error: ${response.status} ${response.statusText}`);
    return response.json();
  }

  async getStages(): Promise<PipedriveStage[]> {
    const result = await this.apiGet("/stages") as { data: PipedriveStage[] | null };
    return result.data ?? [];
  }

  async getPerson(personId: number): Promise<PipedrivePerson | null> {
    try {
      const result = await this.apiGet(`/persons/${personId}`) as { data: PipedrivePerson | null };
      return result.data ?? null;
    } catch {
      return null;
    }
  }

  async getDealFields(): Promise<PipedriveDealField[]> {
    try {
      const result = await this.apiGet(`/dealFields`) as { data: PipedriveDealField[] | null };
      return result.data ?? [];
    } catch {
      return [];
    }
  }

  async getDeals(start = 0, limit = 100): Promise<{ data: PipedriveDeal[] | null; additional_data?: { pagination?: { more_items_in_collection: boolean; next_start: number } } }> {
    return this.apiGet(`/deals?start=${start}&limit=${limit}`) as Promise<{ data: PipedriveDeal[] | null; additional_data?: { pagination?: { more_items_in_collection: boolean; next_start: number } } }>;
  }

  async getAllDeals(): Promise<PipedriveDeal[]> {
    const allDeals: PipedriveDeal[] = [];
    let start = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await this.getDeals(start);
      if (result.data) {
        allDeals.push(...result.data);
      }
      hasMore = result.additional_data?.pagination?.more_items_in_collection ?? false;
      start = result.additional_data?.pagination?.next_start ?? 0;

      // Rate limit: brief pause between pages
      if (hasMore) await new Promise(r => setTimeout(r, 150));
    }

    return allDeals;
  }
}

// ===================== SYNC ENGINE =====================

/**
 * Scope parameter for a Pipedrive pull.
 *
 *   - `{ scope: "all" }` — pulls every deal. Intended for the COO / CEO /
 *     CCO "Pull all" admin flow.
 *   - `{ scope: "owner", ownerEmail }` — only syncs deals whose Pipedrive
 *     `owner_id.email` matches the supplied address (case-insensitive).
 *     Intended for the Project Developer "Pull my deals" flow so each PD
 *     can refresh their own pipeline without touching anyone else's.
 *
 * Both scopes share the same upsert-by-`pipedrive_deal_id` path, so
 * running the same scope twice (or a PD pull followed by a COO pull)
 * will never create duplicates — matching existing opportunities are
 * updated in place.
 */
export type PipedrivePullScope =
  | { scope: "all" }
  | { scope: "owner"; ownerEmail: string };

export async function syncPipedriveDeals(
  scope: PipedrivePullScope = { scope: "all" },
): Promise<PipedriveSyncResult> {
  const startedAt = new Date();
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    const result = { dealsProcessed: 0, dealsCreated: 0, dealsUpdated: 0, errors: ["PIPEDRIVE_API_TOKEN not configured"], skipped: 0 };
    await safeRecordRun({
      startedAt,
      status: "failure",
      errorCode: "missing_token",
      errorDetail: "PIPEDRIVE_API_TOKEN not configured",
      result,
      scope,
    });
    return result;
  }

  const client = new PipedriveClient(token);
  const result: PipedriveSyncResult = { dealsProcessed: 0, dealsCreated: 0, dealsUpdated: 0, errors: [], skipped: 0 };
  const ownerEmailLower = scope.scope === "owner" ? scope.ownerEmail.trim().toLowerCase() : null;
  if (scope.scope === "owner" && !ownerEmailLower) {
    const msg = "Owner-scoped Pipedrive pull requires a non-empty email.";
    result.errors.push(msg);
    await safeRecordRun({
      startedAt,
      status: "failure",
      errorCode: "missing_owner_email",
      errorDetail: msg,
      result,
      scope,
    });
    return result;
  }

  // Fetch stage definitions once so we can resolve stage_id → stage name
  // for every deal without an extra API call per deal.
  let stageIdToName = new Map<number, string>();
  try {
    const stages = await client.getStages();
    for (const s of stages) {
      stageIdToName.set(s.id, s.name);
    }
  } catch (err) {
    // Non-fatal: log warning, fall back to unknown-stage default mapping
    console.warn("[PipedriveSync] Could not fetch stage definitions — stage names unavailable:", err);
  }

  // Resolve `label` ids → human labels via /dealFields (one fetch per sync).
  // Pipedrive's `label` field on a deal is a comma-separated list of option ids.
  let labelIdToName = new Map<string, string>();
  try {
    const fields = await client.getDealFields();
    const labelField = fields.find((f) => f.key === "label");
    if (labelField?.options) {
      for (const opt of labelField.options) {
        labelIdToName.set(String(opt.id), opt.label);
      }
    }
  } catch (err) {
    console.warn("[PipedriveSync] Could not fetch dealFields for label mapping:", err);
  }

  // Build users-by-email map once (no per-deal query). Used to resolve
  // Pipedrive owner email → local user id for `deal_owner_user_id`.
  const userByEmail = new Map<string, number>();
  try {
    const userRows = await db.select({ id: users.id, email: users.email }).from(users);
    for (const u of userRows) {
      if (u.email) userByEmail.set(u.email.trim().toLowerCase(), u.id);
    }
  } catch (err) {
    console.warn("[PipedriveSync] Could not load users for owner mapping:", err);
  }

  try {
    const deals = await client.getAllDeals();

    for (const deal of deals) {
      // Owner scope: skip deals that don't belong to the calling PD.
      if (ownerEmailLower) {
        const dealOwnerEmail = deal.user_id?.email?.trim().toLowerCase() ?? null;
        if (!dealOwnerEmail || dealOwnerEmail !== ownerEmailLower) {
          continue;
        }
      }

      // Resolve the Pipedrive stage name and derive the app-side mapping.
      const stageName = stageIdToName.get(deal.stage_id) ?? null;
      const mapping = resolvePipedriveStageMapping(stageName, deal.status);

      // "Dormant Opportunities" and any other skipSync stages are never imported.
      if (mapping.skipSync) {
        result.skipped++;
        continue;
      }

      // Future-signature rule: only import deals whose expected close date is
      // strictly after today (compared at midnight, in the local server tz).
      // Deals with no expected_close_date or a past date are skipped.
      {
        const raw = deal.expected_close_date;
        if (!raw) {
          result.skipped++;
          continue;
        }
        const closeDate = new Date(raw);
        if (Number.isNaN(closeDate.getTime())) {
          result.skipped++;
          continue;
        }
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        if (closeDate.getTime() <= todayMidnight.getTime()) {
          result.skipped++;
          continue;
        }
      }

      result.dealsProcessed++;
      try {
        // Render label ids → comma-separated names (Pipedrive returns id list as csv string).
        const labelText = deal.label != null
          ? String(deal.label).split(",").map((id) => labelIdToName.get(id.trim()) ?? id.trim()).filter(Boolean).join(", ") || null
          : null;
        // Owner: prefer email-matched local user; always snapshot the name.
        const ownerEmailLower2 = deal.user_id?.email?.trim().toLowerCase() ?? null;
        const ownerUserId = ownerEmailLower2 ? (userByEmail.get(ownerEmailLower2) ?? null) : null;
        const ownerName = deal.user_id?.name ?? null;
        // Optional: fetch person details if linked. One extra HTTP per deal,
        // only when person_id is present.
        let person: PipedrivePerson | null = null;
        if (deal.person_id?.value) {
          person = await client.getPerson(deal.person_id.value);
        }
        await syncSingleDeal(deal, mapping.appStage, mapping.appStatus, result, {
          labelText, ownerUserId, ownerName, person,
        });
      } catch (err) {
        result.errors.push(`Deal ${deal.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const status: "success" | "failure" | "partial" =
    result.errors.length === 0
      ? "success"
      : result.dealsProcessed > 0
        ? "partial"
        : "failure";

  await safeRecordRun({
    startedAt,
    status,
    errorCode: result.errors.length > 0 ? "deal_sync_errors" : null,
    errorDetail: result.errors.length > 0 ? result.errors.slice(0, 5).join(" | ") : null,
    result,
    scope,
  });

  return result;
}

/**
 * C1: log every Pipedrive sync to the integration health registry.
 * Wrapped in its own try/catch so a logging failure never blocks the
 * sync itself.
 */
async function safeRecordRun(params: {
  startedAt: Date;
  status: "success" | "failure" | "partial";
  errorCode: string | null;
  errorDetail: string | null;
  result: PipedriveSyncResult;
  scope: PipedrivePullScope;
}): Promise<void> {
  try {
    const { recordIntegrationRun } = await import("./integration-health-service");
    await recordIntegrationRun({
      name: "pipedrive",
      runType: params.scope.scope === "owner" ? "sync_owner_deals" : "sync_all_deals",
      startedAt: params.startedAt,
      finishedAt: new Date(),
      status: params.status,
      recordsProcessed: params.result.dealsProcessed,
      errorCode: params.errorCode,
      errorDetail: params.errorDetail,
      metadata: {
        dealsCreated: params.result.dealsCreated,
        dealsUpdated: params.result.dealsUpdated,
        dealsSkipped: params.result.skipped,
        errorCount: params.result.errors.length,
        scope: params.scope.scope,
        ...(params.scope.scope === "owner" ? { ownerEmail: params.scope.ownerEmail } : {}),
      },
    });
  } catch (err) {
    console.error("[PipedriveSync] Failed to record integration health event:", err);
  }
}

interface SyncEnrichment {
  labelText: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  person: PipedrivePerson | null;
}

function pickPrimary(arr: Array<{ value: string; primary?: boolean }> | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  return (arr.find((x) => x.primary)?.value ?? arr[0]?.value) ?? null;
}

function parsePipedriveDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
}

async function syncSingleDeal(
  deal: PipedriveDeal,
  appStage: string,
  appStatus: string,
  result: PipedriveSyncResult,
  enrichment: SyncEnrichment,
) {
  const dealIdStr = String(deal.id);

  // Find existing opportunity by pipedrive_deal_id
  const [existing] = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.pipedriveDealId, dealIdStr));

  // Try to match client by pipedrive_org_id, auto-create if not found
  let clientId: number | null = null;
  if (deal.org_id) {
    const orgIdStr = String(deal.org_id.value);
    const [matchedClient] = await db
      .select()
      .from(clients)
      .where(eq(clients.pipedriveOrgId, orgIdStr));
    if (matchedClient) {
      clientId = matchedClient.id;
    } else {
      // Auto-create client from Pipedrive organization
      const orgName = deal.org_id.name || `Pipedrive Org ${deal.org_id.value}`;
      const clientIdCode = `PD-${orgIdStr}`;
      try {
        const [newClient] = await db.insert(clients).values({
          clientId: clientIdCode,
          name: orgName,
          pipedriveOrgId: orgIdStr,
          status: "prospect",
        }).returning();
        clientId = newClient.id;
      } catch {
        // Client with this clientId may already exist (race condition) — try to find it
        const [retryClient] = await db.select().from(clients)
          .where(eq(clients.pipedriveOrgId, orgIdStr));
        if (retryClient) clientId = retryClient.id;
      }
    }
  }

  const dealTitle = deal.title || `Deal ${deal.id}`;

  // Fields owned by Pipedrive (CRM truth). Safe to overwrite on every sync.
  // `notes` is intentionally excluded — user-editable app-side content.
  // `source` is always 'pipedrive' here to stay consistent with pipedrive_deal_id.
  // `stage` and `status` come from the resolved MAIN_EE_PIPELINE_STAGE_MAP so
  // that stage names (not just deal.status) drive the app-side representation.
  // The enrichment block (added 2026-04-20) populates the new columns from
  // migration 20260420_opportunity_merge_pipedrive_enrich.sql.
  const crmOwnedFields = {
    pipedriveDealId: dealIdStr,
    source: "pipedrive" as const,
    clientId,
    stage: appStage,
    estimatedValue: deal.value ? String(deal.value) : null,
    expectedCloseDate: deal.expected_close_date ?? null,
    signedDate: deal.won_time ? deal.won_time.split(" ")[0] : null,
    status: appStatus,
    // --- enrichment (always written, may be null) ---
    dealName: dealTitle,
    dealOwnerUserId: enrichment.ownerUserId,
    dealOwnerName: enrichment.ownerName,
    currency: deal.currency || "ZAR",
    pipedriveUpdatedAt: parsePipedriveDate(deal.update_time),
    pipedriveStageChangedAt: parsePipedriveDate(deal.stage_change_time),
    probability: deal.probability != null ? String(deal.probability) : null,
    weightedValue: deal.weighted_value != null ? String(deal.weighted_value) : null,
    lostReason: deal.lost_reason ?? null,
    lostTime: parsePipedriveDate(deal.lost_time),
    personName: enrichment.person?.name ?? deal.person_id?.name ?? null,
    personEmail: enrichment.person ? pickPrimary(enrichment.person.email) : null,
    personPhone: enrichment.person ? pickPrimary(enrichment.person.phone) : null,
    activitiesCount: deal.activities_count ?? 0,
    lastActivityDate: deal.last_activity_date ?? null,
    nextActivityDate: deal.next_activity_date ?? null,
    nextActivitySubject: deal.next_activity_subject ?? null,
    labels: enrichment.labelText,
    updatedAt: new Date(),
  };

  // Custom fields are admin-defined in Pipedrive and frequently blank. We
  // treat them as "Pipedrive-wins-when-present, app-keeps-when-blank" to
  // avoid silently nulling user-entered values on every sync (architect
  // review 2026-04-20). On INSERT they are seeded; on UPDATE they only
  // overwrite when Pipedrive provides a concrete mapped value.
  const customFieldOverrides: Partial<typeof opportunities.$inferInsert> = {};
  const provinceFromCrm = resolveProvinceFromLeadLocation(deal[CUSTOM_FIELD_KEYS.leadLocation]);
  if (provinceFromCrm) customFieldOverrides.province = provinceFromCrm;
  const kwpFromCrm = asNumericString(deal[CUSTOM_FIELD_KEYS.systemSizeKwp]);
  if (kwpFromCrm) customFieldOverrides.estimatedKwp = kwpFromCrm;
  const kwhFromCrm = asNumericString(deal[CUSTOM_FIELD_KEYS.batterySizeKwh]);
  if (kwhFromCrm) customFieldOverrides.estimatedKwh = kwhFromCrm;

  if (existing) {
    // Preserve user-owned `notes`. Only CRM-owned fields are overwritten;
    // custom fields are merged conditionally to avoid clobbering with null.
    await db
      .update(opportunities)
      .set({ ...crmOwnedFields, ...customFieldOverrides })
      .where(eq(opportunities.id, existing.id));
    result.dealsUpdated++;
  } else {
    // On create, seed notes with the Pipedrive deal title so the record is
    // recognisable. `deal_name` is the canonical column going forward; the
    // notes string is kept only for back-compat with old reads.
    await db.insert(opportunities).values({
      ...crmOwnedFields,
      ...customFieldOverrides,
      notes: `Pipedrive: ${dealTitle}`,
    });
    result.dealsCreated++;
  }
}
