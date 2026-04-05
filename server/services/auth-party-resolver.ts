/**
 * Auth Party Resolver — Post-Migration
 *
 * Enriches authenticated user objects with core.user_accounts and core.parties data.
 * Called after Passport or JWT authentication resolves the user from the legacy users table.
 *
 * This is a bridge: auth still reads credentials from public.users, but identity
 * enrichment comes from promoted schema (core.user_accounts → core.parties).
 *
 * Exit condition: When auth is fully migrated to read from core.user_accounts
 * as the primary identity source.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface EnrichedUser {
  id: number;
  username: string;
  email: string;
  name: string;
  role: string;
  department?: string | null;
  // Promoted schema enrichment
  partyId?: number | null;
  userAccountId?: number | null;
  userAccountStatus?: string | null;
  partyName?: string | null;
}

/**
 * Resolves promoted schema identity for an authenticated user.
 * Non-blocking — returns null enrichment if promoted schema is unavailable.
 */
export async function resolveUserPartyIdentity(userId: number): Promise<{
  partyId: number | null;
  userAccountId: number | null;
  userAccountStatus: string | null;
  partyName: string | null;
} | null> {
  try {
    const result = await db.execute(sql`
      SELECT
        ua.id AS user_account_id,
        ua.party_id,
        ua.status AS user_account_status,
        p.name_canonical AS party_name
      FROM core.user_accounts ua
      JOIN core.parties p ON p.id = ua.party_id
      WHERE ua.legacy_user_id = ${userId}
      LIMIT 1
    `);

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as {
      user_account_id: number;
      party_id: number;
      user_account_status: string;
      party_name: string;
    };

    return {
      partyId: row.party_id,
      userAccountId: row.user_account_id,
      userAccountStatus: row.user_account_status,
      partyName: row.party_name,
    };
  } catch {
    // Promoted schema may not be available — fail silently
    return null;
  }
}

/**
 * Enriches a user object with promoted schema identity.
 * Call after successful authentication.
 */
export async function enrichUserWithParty(user: { id: number; username?: string; email?: string; name?: string; role?: string }): Promise<EnrichedUser> {
  const identity = await resolveUserPartyIdentity(user.id);

  return {
    id: user.id,
    username: user.username || "",
    email: user.email || "",
    name: user.name || "",
    role: user.role || "member",
    partyId: identity?.partyId ?? null,
    userAccountId: identity?.userAccountId ?? null,
    userAccountStatus: identity?.userAccountStatus ?? null,
    partyName: identity?.partyName ?? null,
  };
}
