import { db } from "./db";
import { msAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { decrypt, encrypt, isEncryptedPayload } from "./utils/encryption";

const CONFIGURED_TENANT_ID = process.env.AZURE_TENANT_ID || "";

export async function ensureMsAccount(
  userId: number,
  msProfile: { id: string; displayName: string; mail: string; userPrincipalName: string },
  tenantId?: string,
  ssoToken?: { accessToken: string; expiresOn: Date | null },
  tokenCache?: string | null
): Promise<{ id: number; isNew: boolean }> {
  const effectiveTenant = tenantId || CONFIGURED_TENANT_ID;

  if (CONFIGURED_TENANT_ID && effectiveTenant && effectiveTenant !== CONFIGURED_TENANT_ID) {
    const isProduction = process.env.NODE_ENV === "production" || !!process.env.REPLIT_DOMAINS;
    if (isProduction) {
      throw new Error(`Tenant mismatch: expected ${CONFIGURED_TENANT_ID}, got ${effectiveTenant}. Sign-in rejected.`);
    }
    console.warn(`[MS Account] Tenant mismatch in development: expected ${CONFIGURED_TENANT_ID}, got ${effectiveTenant}. Allowing for dev purposes.`);
  }

  const tokenFields: Record<string, any> = {};
  if (ssoToken?.accessToken) {
    tokenFields.ssoAccessToken = encrypt(ssoToken.accessToken);
    tokenFields.ssoTokenExpiresAt = ssoToken.expiresOn || new Date(Date.now() + 3600_000);
  }
  if (tokenCache) {
    tokenFields.refreshTokenEncrypted = encrypt(tokenCache);
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
        ...tokenFields,
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
      ...tokenFields,
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

export async function getSsoTokenForUser(userId: number): Promise<string | null> {
  const account = await getMsAccountForUser(userId);
  if (!account?.ssoAccessToken) return null;

  const accessToken = isEncryptedPayload(account.ssoAccessToken)
    ? decrypt(account.ssoAccessToken)
    : account.ssoAccessToken;

  if (account.ssoTokenExpiresAt && account.ssoTokenExpiresAt.getTime() < Date.now() + 60_000) {
    const refreshed = await tryRefreshToken(account);
    if (refreshed) return refreshed;
    return null;
  }

  return accessToken;
}

async function tryRefreshToken(account: typeof msAccounts.$inferSelect): Promise<string | null> {
  const serializedCache = account.refreshTokenEncrypted
    ? (isEncryptedPayload(account.refreshTokenEncrypted)
      ? decrypt(account.refreshTokenEncrypted)
      : account.refreshTokenEncrypted)
    : null;
  if (!serializedCache) {
    console.log(`[MS Token] No cached token data for user ${account.userId}, cannot refresh`);
    return null;
  }

  try {
    const { refreshTokenSilent } = await import("./microsoft-auth");
    const result = await refreshTokenSilent(serializedCache, account.msUserId);
    if (!result) return null;

    await db
      .update(msAccounts)
      .set({
        ssoAccessToken: encrypt(result.accessToken),
        ssoTokenExpiresAt: result.expiresOn || new Date(Date.now() + 3600_000),
        refreshTokenEncrypted: encrypt(result.tokenCache),
      })
      .where(eq(msAccounts.id, account.id));

    console.log(`[MS Token] Successfully refreshed token for user ${account.userId}`);
    return result.accessToken;
  } catch (err: any) {
    console.error(`[MS Token] Refresh failed for user ${account.userId}:`, err.message);
    return null;
  }
}
