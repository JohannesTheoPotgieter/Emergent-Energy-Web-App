/**
 * Shared SharePoint / Outlook-connector access-token utility.
 * Caches the token for its lifetime (minus 60 s buffer) so that
 * sharepoint.ts and sharepoint-list.ts don't independently fetch tokens.
 */

let cachedToken: string | null = null;
let cachedExpiresAt: number = 0;

/**
 * Returns a valid access token from the Replit Outlook connector,
 * re-using a cached value when it is still valid.
 */
export async function getSharePointToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedExpiresAt) {
    return cachedToken;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error("SharePoint not available - connector not configured.");
  }

  const res = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=outlook",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    },
  );

  const data = await res.json();
  const conn = data.items?.[0];
  const accessToken =
    conn?.settings?.access_token ||
    conn?.settings?.oauth?.credentials?.access_token;

  if (!accessToken) {
    throw new Error("SharePoint not connected - please set up the Outlook connector.");
  }

  // Cache for the token's lifetime minus a 60-second buffer.
  const expiresAt = conn?.settings?.expires_at;
  if (expiresAt) {
    cachedExpiresAt = new Date(expiresAt).getTime() - 60_000;
  } else {
    // Default: cache for 50 minutes if no expiry info available.
    cachedExpiresAt = Date.now() + 50 * 60 * 1000;
  }
  cachedToken = accessToken;

  return accessToken;
}

/** Clear the cached token (e.g. on auth error). */
export function clearSharePointTokenCache(): void {
  cachedToken = null;
  cachedExpiresAt = 0;
}
