import { db } from "./db";
import { msAccounts } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const CONFIGURED_TENANT_ID = process.env.AZURE_TENANT_ID || "";

export async function ensureMsAccount(
  userId: number,
  msProfile: { id: string; displayName: string; mail: string; userPrincipalName: string },
  tenantId?: string
): Promise<{ id: number; isNew: boolean }> {
  const effectiveTenant = tenantId || CONFIGURED_TENANT_ID;

  if (CONFIGURED_TENANT_ID && effectiveTenant && effectiveTenant !== CONFIGURED_TENANT_ID) {
    throw new Error(`Tenant mismatch: expected ${CONFIGURED_TENANT_ID}, got ${effectiveTenant}`);
  }

  const existing = await db
    .select()
    .from(msAccounts)
    .where(eq(msAccounts.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(msAccounts)
      .set({
        msUserId: msProfile.id,
        email: msProfile.mail || msProfile.userPrincipalName,
        displayName: msProfile.displayName,
        tenantId: effectiveTenant,
        status: "active",
      })
      .where(eq(msAccounts.id, existing[0].id));

    return { id: existing[0].id, isNew: false };
  }

  const [inserted] = await db
    .insert(msAccounts)
    .values({
      userId,
      tenantId: effectiveTenant,
      msUserId: msProfile.id,
      email: msProfile.mail || msProfile.userPrincipalName,
      displayName: msProfile.displayName,
      status: "active",
    })
    .returning({ id: msAccounts.id });

  return { id: inserted.id, isNew: true };
}

export async function getMsAccountForUser(
  userId: number
): Promise<typeof msAccounts.$inferSelect | null> {
  const rows = await db
    .select()
    .from(msAccounts)
    .where(eq(msAccounts.userId, userId))
    .limit(1);

  return rows.length > 0 ? rows[0] : null;
}
