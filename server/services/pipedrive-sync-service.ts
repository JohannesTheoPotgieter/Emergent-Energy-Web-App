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

export async function syncPipedriveDeals(): Promise<PipedriveSyncResult> {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    return { dealsProcessed: 0, dealsCreated: 0, dealsUpdated: 0, errors: ["PIPEDRIVE_API_TOKEN not configured"] };
  }

  const client = new PipedriveClient(token);
  const result: PipedriveSyncResult = { dealsProcessed: 0, dealsCreated: 0, dealsUpdated: 0, errors: [] };

  try {
    const deals = await client.getAllDeals();

    for (const deal of deals) {
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

  return result;
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
  const opportunityData = {
    pipedriveDealId: dealIdStr,
    clientId,
    stage,
    estimatedValue: deal.value ? String(deal.value) : null,
    expectedCloseDate: deal.expected_close_date ?? null,
    signedDate: deal.won_time ? deal.won_time.split(" ")[0] : null,
    status: deal.status === "open" ? "active" : deal.status === "won" ? "won" : "lost",
    notes: `Pipedrive: ${dealTitle}`,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(opportunities)
      .set(opportunityData)
      .where(eq(opportunities.id, existing.id));
    result.dealsUpdated++;
  } else {
    await db.insert(opportunities).values(opportunityData);
    result.dealsCreated++;
  }
}
