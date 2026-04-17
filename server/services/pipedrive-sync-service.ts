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
import { eq, isNull } from "drizzle-orm";
import { opportunities, clients } from "@shared/schema/projects";

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
  owner_id: { id: number; name: string; email: string } | null;
  expected_close_date: string | null;
  won_time: string | null;
  add_time: string;
  update_time: string;
}

interface PipedriveSyncResult {
  dealsProcessed: number;
  dealsCreated: number;
  dealsUpdated: number;
  errors: string[];
}

// ===================== STAGE MAPPING =====================

// Map Pipedrive deal status → opportunity stage
// This is a default mapping; in production, configure via admin UI or env vars
const DEAL_STATUS_TO_STAGE: Record<string, string> = {
  open: "qualification",   // Default for open deals; refined by stage_id mapping
  won: "won",
  lost: "lost",
  deleted: "lost",
};

// ===================== API CLIENT =====================

class PipedriveClient {
  private baseUrl = "https://api.pipedrive.com/v1";
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async getDeals(start = 0, limit = 100): Promise<{ data: PipedriveDeal[] | null; additional_data?: { pagination?: { more_items_in_collection: boolean; next_start: number } } }> {
    const url = `${this.baseUrl}/deals?start=${start}&limit=${limit}&api_token=${this.token}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pipedrive API error: ${response.status} ${response.statusText}`);
    return response.json();
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
    const result = { dealsProcessed: 0, dealsCreated: 0, dealsUpdated: 0, errors: ["PIPEDRIVE_API_TOKEN not configured"] };
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
  const result: PipedriveSyncResult = { dealsProcessed: 0, dealsCreated: 0, dealsUpdated: 0, errors: [] };
  const ownerEmailLower = scope.scope === "owner" ? scope.ownerEmail.trim().toLowerCase() : null;
  if (scope.scope === "owner" && !ownerEmailLower) {
    // Defensive — an empty owner email would otherwise match every deal
    // that Pipedrive returns with a blank owner, which is not what we
    // want. Fail loudly instead.
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

  try {
    const deals = await client.getAllDeals();

    for (const deal of deals) {
      // Owner scope: skip deals that don't belong to the calling PD.
      // Match on lowercased email; Pipedrive returns null owner on
      // orphaned deals which we ignore in this mode.
      if (ownerEmailLower) {
        const dealOwnerEmail = deal.owner_id?.email?.trim().toLowerCase() ?? null;
        if (!dealOwnerEmail || dealOwnerEmail !== ownerEmailLower) {
          continue;
        }
      }

      result.dealsProcessed++;
      try {
        await syncSingleDeal(deal, result);
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
        errorCount: params.result.errors.length,
        scope: params.scope.scope,
        ...(params.scope.scope === "owner" ? { ownerEmail: params.scope.ownerEmail } : {}),
      },
    });
  } catch (err) {
    console.error("[PipedriveSync] Failed to record integration health event:", err);
  }
}

async function syncSingleDeal(deal: PipedriveDeal, result: PipedriveSyncResult) {
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

  const stage = DEAL_STATUS_TO_STAGE[deal.status] ?? "prospect";
  const dealTitle = deal.title || `Deal ${deal.id}`;

  // Fields owned by Pipedrive (CRM truth). Safe to overwrite on every sync.
  // NOTE: `notes` is intentionally NOT in here — it is user-editable app-side
  //   content and must not be clobbered by repeated syncs. See create branch
  //   below for the initial seed value.
  // `source` is always reset to 'pipedrive' here so that the origin flag
  //   stays in sync with the presence of pipedrive_deal_id even if an
  //   admin flipped it manually in the DB.
  const crmOwnedFields = {
    pipedriveDealId: dealIdStr,
    source: "pipedrive" as const,
    clientId,
    stage,
    estimatedValue: deal.value ? String(deal.value) : null,
    expectedCloseDate: deal.expected_close_date ?? null,
    signedDate: deal.won_time ? deal.won_time.split(" ")[0] : null,
    status: deal.status === "open" ? "active" : deal.status === "won" ? "won" : "lost",
    updatedAt: new Date(),
  };

  if (existing) {
    // Preserve user-owned `notes`. Only CRM-owned fields are overwritten.
    await db
      .update(opportunities)
      .set(crmOwnedFields)
      .where(eq(opportunities.id, existing.id));
    result.dealsUpdated++;
  } else {
    // On create, seed notes with the Pipedrive deal title so the record is
    // recognisable. Subsequent syncs will not touch this field again.
    await db.insert(opportunities).values({
      ...crmOwnedFields,
      notes: `Pipedrive: ${dealTitle}`,
    });
    result.dealsCreated++;
  }
}
