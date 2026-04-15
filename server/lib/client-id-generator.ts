/**
 * Race-safe generator for canonical `EE-Cxxxx` client ids.
 *
 * Background
 * ----------
 * Two independent code paths used to generate client ids:
 *
 *   - `server/pd-routes.ts`           (/api/pd/clients POST)
 *   - `server/routes/clients-extracted-routes.ts` (/api/clients POST)
 *
 * Both used a read-then-insert pattern (`SELECT MAX/COUNT` then `INSERT`),
 * which is racy under concurrent inserts: two admins clicking "create
 * client" at the same time could both observe the same `max_num` and
 * then collide on the `clients.client_id` unique constraint, with only
 * one winning. The loser saw a generic 500.
 *
 * Fix
 * ---
 * This helper wraps a transaction around a Postgres session-level
 * advisory lock (`pg_advisory_xact_lock`) so the MAX-then-INSERT
 * sequence is serialized across all connections. The lock is released
 * automatically when the transaction commits or rolls back — no
 * application-level cleanup needed.
 *
 * The lock key is a stable integer chosen at design time. It is
 * scoped per-database, so two deployments against different databases
 * do not interfere with each other.
 *
 * NOTE: this is deliberately NOT a dedicated Postgres sequence because
 * the `EE-C` namespace has historically been generated from `MAX()` of
 * the existing rows, including backfilled imports, and the sequence
 * would lose sync with those. A follow-up migration can introduce a
 * dedicated sequence once the existing data has been audited.
 *
 * The advisory-lock key is a random 32-bit integer that has no meaning
 * beyond "this is the lock for client-id generation". Changing it
 * breaks serialization between old and new code so do not change it
 * lightly.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { clients } from "@shared/schema";

const CLIENT_ID_ADVISORY_LOCK_KEY = 0x4344_5047; // "CDPG" ≈ client-id pd gen
const CLIENT_ID_PREFIX = "EE-C";
const CLIENT_ID_PAD_WIDTH = 4;

export interface GeneratedClient {
  id: number;
  clientId: string;
  name: string;
}

/**
 * Generate the next client id AND insert the row in one atomic step.
 *
 * The caller passes the row shape it wants to insert except for
 * `clientId` — this function stamps that itself so the MAX read and
 * the INSERT happen inside the same advisory-locked transaction and
 * cannot interleave with any other client-create path that uses this
 * helper.
 */
export async function insertClientWithGeneratedId(
  values: Omit<typeof clients.$inferInsert, "clientId"> & { clientId?: string },
): Promise<GeneratedClient> {
  return db.transaction(async (tx) => {
    // Acquire the advisory lock for this transaction. Any other
    // transaction that calls pg_advisory_xact_lock with the same key
    // will wait here until we commit.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CLIENT_ID_ADVISORY_LOCK_KEY})`);

    // Read the current max sequence number inside the same
    // transaction. Because the advisory lock is held, no other
    // generator call can be running at this moment.
    const clientIdForInsert = values.clientId ?? (await nextClientIdInTx(tx));

    const [created] = await tx
      .insert(clients)
      .values({ ...values, clientId: clientIdForInsert })
      .returning({
        id: clients.id,
        clientId: clients.clientId,
        name: clients.name,
      });

    return created as GeneratedClient;
  });
}

/**
 * Internal: compute the next `EE-Cxxxx` id inside a transaction. Not
 * exported because callers outside this file must not skip the lock.
 *
 * Uses `SUBSTRING(client_id FROM 5)::INTEGER` on rows matching the
 * `EE-C%` prefix so imported or Pipedrive-generated ids (`PD-<orgId>`)
 * do not pollute the sequence space.
 */
async function nextClientIdInTx(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<string> {
  const result = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(CAST(SUBSTRING(client_id FROM 5) AS INTEGER)),
      0
    ) AS max_num
    FROM clients
    WHERE client_id LIKE ${`${CLIENT_ID_PREFIX}%`}
      AND client_id ~ ${`^${CLIENT_ID_PREFIX}[0-9]+$`}
  `)) as unknown as { rows?: Array<{ max_num: string | number | null }> };

  const maxNum = Number(result.rows?.[0]?.max_num ?? 0);
  const next = (Number.isFinite(maxNum) ? maxNum : 0) + 1;
  return `${CLIENT_ID_PREFIX}${String(next).padStart(CLIENT_ID_PAD_WIDTH, "0")}`;
}

/** Exported for tests that want to pin the prefix and pad width. */
export const CLIENT_ID_CONSTANTS = {
  prefix: CLIENT_ID_PREFIX,
  padWidth: CLIENT_ID_PAD_WIDTH,
  advisoryLockKey: CLIENT_ID_ADVISORY_LOCK_KEY,
} as const;
