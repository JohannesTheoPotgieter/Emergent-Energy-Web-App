/**
 * Shared SharePoint / Outlook-connector access-token utility.
 * Caches the token for its lifetime (minus 60 s buffer) so that
 * sharepoint.ts and sharepoint-list.ts don't independently fetch tokens.
 *
 * Connector resolution order:
 *   1. `sharepoint` — used if a dedicated SharePoint connector is set up
 *      on Replit (preferred: scopes Sites.Read.All / Files.ReadWrite.All
 *      cleanly separated from mail scopes).
 *   2. `outlook`    — historical default. The Outlook connector must have
 *      Sites / Files scopes granted at consent time; otherwise Graph
 *      returns 401/403 on every `/drives/...` call.
 */

let cachedToken: string | null = null;
let cachedExpiresAt: number = 0;

const CONNECTOR_CANDIDATES = ["sharepoint", "outlook"] as const;

interface ReplitConnection {
  settings?: {
    access_token?: string;
    expires_at?: string;
    oauth?: { credentials?: { access_token?: string } };
  };
}

async function fetchConnectorToken(
  hostname: string,
  xReplitToken: string,
  connectorName: string,
): Promise<{ accessToken: string; expiresAt: string | undefined } | null> {
  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=${connectorName}`,
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: ReplitConnection[] };
  const conn = data.items?.[0];
  const accessToken =
    conn?.settings?.access_token ||
    conn?.settings?.oauth?.credentials?.access_token;
  if (!accessToken) return null;
  return { accessToken, expiresAt: conn?.settings?.expires_at };
}

/**
 * Returns a valid access token from the Replit SharePoint or Outlook
 * connector, re-using a cached value when it is still valid.
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

  let resolved: { accessToken: string; expiresAt: string | undefined } | null = null;
  for (const candidate of CONNECTOR_CANDIDATES) {
    resolved = await fetchConnectorToken(hostname, xReplitToken, candidate);
    if (resolved) break;
  }

  if (!resolved) {
    throw new Error(
      "SharePoint not connected - configure the 'sharepoint' Replit connector (preferred) " +
        "or grant the 'outlook' connector Sites.Read.All + Files.ReadWrite.All scopes.",
    );
  }

  // Cache for the token's lifetime minus a 60-second buffer.
  if (resolved.expiresAt) {
    cachedExpiresAt = new Date(resolved.expiresAt).getTime() - 60_000;
  } else {
    // Default: cache for 50 minutes if no expiry info available.
    cachedExpiresAt = Date.now() + 50 * 60 * 1000;
  }
  cachedToken = resolved.accessToken;

  return resolved.accessToken;
}

/** Clear the cached token (e.g. on auth error). */
export function clearSharePointTokenCache(): void {
  cachedToken = null;
  cachedExpiresAt = 0;
}
