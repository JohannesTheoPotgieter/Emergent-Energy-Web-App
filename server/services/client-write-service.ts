/**
 * Client Write Service — Centralized write authority for clients.
 *
 * WRITE AUTHORITY MODEL:
 *   Legacy table (public.clients) remains the primary write target.
 *   Every write is immediately synced to core.clients via bridge writer.
 *
 * This domain already has 100% bridge coverage (3/3 write paths).
 * This service formalizes the pattern for new code.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { clients } from "../../shared/schema";
import { syncClient, bridgeCatch } from "../bridge/bridge-writer";

type DbOrTx = typeof db;

/**
 * Create a new client and sync to core.clients.
 */
export async function createClient(
  fields: {
    name: string;
    clientId: string;
    createdBy?: number | null;
    updatedBy?: number | null;
    legalEntityName?: string | null;
    tradingName?: string | null;
    clientType?: string | null;
    primaryContactName?: string | null;
    primaryContactEmail?: string | null;
    primaryContactPhone?: string | null;
  },
  txOrDb: DbOrTx = db,
): Promise<any> {
  const [created] = await (txOrDb as any).insert(clients).values(fields).returning();
  syncClient({
    id: created.id,
    name: created.name,
    clientId: created.clientId,
    createdBy: fields.createdBy ?? null,
    updatedBy: fields.updatedBy ?? null,
    legalEntityName: fields.legalEntityName ?? null,
    tradingName: fields.tradingName ?? null,
    clientType: fields.clientType ?? null,
    primaryContactName: fields.primaryContactName ?? null,
    primaryContactEmail: fields.primaryContactEmail ?? null,
    primaryContactPhone: fields.primaryContactPhone ?? null,
  }).catch(bridgeCatch);
  return created;
}

/**
 * Update a client by ID and sync to core.clients.
 */
export async function updateClient(
  id: number,
  fields: Record<string, any>,
  txOrDb: DbOrTx = db,
): Promise<any> {
  const [updated] = await (txOrDb as any)
    .update(clients)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(clients.id, id))
    .returning();
  if (updated) {
    syncClient({
      id: updated.id,
      name: updated.name,
      clientId: updated.clientId,
      updatedBy: fields.updatedBy ?? null,
    }).catch(bridgeCatch);
  }
  return updated;
}
