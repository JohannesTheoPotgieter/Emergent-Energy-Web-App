/**
 * Shared SharePoint access-token utility. Caches the resolved token for its
 * lifetime (minus a 60 s buffer) so sharepoint.ts and sharepoint-list.ts
 * don't independently fetch tokens.
 *
 * Two token sources, in priority order:
 *
 *   1. App-only (client-credentials) — PREFERRED. When SHAREPOINT_TENANT_ID
 *      / SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET are all set, the app
 *      acquires its own Microsoft Graph token via MSAL client credentials
 *      (scope https://graph.microsoft.com/.default). The required Graph
 *      *Application* permissions (Sites.Read.All / Files.Read.All — plus the
 *      *.ReadWrite.All variants if app-only writes are ever wired) are
 *      admin-consented on an Azure app the tenant owns, so SharePoint access
 *      no longer depends on the Replit connector's consented scopes. This is
 *      the fix for the "missing_scope" Test Connection failure.
 *
 *   2. Replit connector (delegated) — historical default / fallback, used
 *      when the app-only vars are absent. Tries the dedicated `sharepoint`
 *      connector first, then `outlook` (which must have Sites/Files scopes
 *      granted at consent time, or Graph returns 401/403 on `/drives/...`).
 *
 * Outlook/Teams (server/outlook.ts) use their own connector token and are
 * unaffected. Document *writes* use a per-user delegated SSO token
 * (server/ms-account-service.ts) and are also unaffected.
 */

import { ConfidentialClientApplication } from "@azure/msal-node";
import { ApiError } from "./lib/api-error";

let cachedToken: string | null = null;
let cachedExpiresAt: number = 0;

const CONNECTOR_CANDIDATES = ["sharepoint", "outlook"] as const;

/**
 * A coded "SharePoint isn't set up" failure. Surfaced as a 503 with a stable
 * machine code so the client (SharePointErrorAlert) can render a "connect
 * SharePoint" call-to-action instead of an opaque 500.
 */
function sharePointUnavailable(message: string): ApiError {
  return new ApiError(
    503,
    "SHAREPOINT_UNAVAILABLE",
    message,
    undefined,
    "Connect SharePoint under Settings → Document Management, or set the SharePoint app-only credentials.",
  );
}
const GRAPH_DEFAULT_SCOPE = "https://graph.microsoft.com/.default";

type ResolvedToken = { accessToken: string; expiresAt: string | undefined };

// ──────────────────────────────────────────────────────────────────────────
// 1. App-only (client-credentials) token — tenant-owned Azure app
// ──────────────────────────────────────────────────────────────────────────

interface SharePointAppConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function getSharePointAppConfig(): SharePointAppConfig | null {
  const tenantId = process.env.SHAREPOINT_TENANT_ID?.trim();
  const clientId = process.env.SHAREPOINT_CLIENT_ID?.trim();
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

/**
 * Which token source getSharePointToken() will use given the current env.
 * Exposed for tests and diagnostics — does not perform any network call.
 */
export function getSharePointTokenStrategy(): "app-only" | "connector" {
  return getSharePointAppConfig() ? "app-only" : "connector";
}

// MSAL client is cached and only rebuilt if the configured app changes.
let appClient: ConfidentialClientApplication | null = null;
let appClientKey: string | null = null;

function getAppClient(config: SharePointAppConfig): ConfidentialClientApplication {
  const key = `${config.tenantId}:${config.clientId}`;
  if (!appClient || appClientKey !== key) {
    appClient = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        clientSecret: config.clientSecret,
      },
    });
    appClientKey = key;
  }
  return appClient;
}

async function acquireAppOnlyToken(config: SharePointAppConfig): Promise<ResolvedToken> {
  const result = await getAppClient(config).acquireTokenByClientCredential({
    scopes: [GRAPH_DEFAULT_SCOPE],
  });
  if (!result?.accessToken) {
    throw sharePointUnavailable(
      "SharePoint app-only token request returned no access token — verify " +
        "SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET / SHAREPOINT_TENANT_ID.",
    );
  }
  return {
    accessToken: result.accessToken,
    expiresAt: result.expiresOn ? result.expiresOn.toISOString() : undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Replit connector (delegated) token — historical fallback
// ──────────────────────────────────────────────────────────────────────────

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
): Promise<ResolvedToken | null> {
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

async function acquireConnectorToken(): Promise<ResolvedToken> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw sharePointUnavailable("SharePoint not available — connector not configured.");
  }

  let resolved: ResolvedToken | null = null;
  for (const candidate of CONNECTOR_CANDIDATES) {
    resolved = await fetchConnectorToken(hostname, xReplitToken, candidate);
    if (resolved) break;
  }

  if (!resolved) {
    throw sharePointUnavailable(
      "SharePoint not connected — configure the 'sharepoint' Replit connector (preferred), " +
        "grant the 'outlook' connector Sites.Read.All + Files.ReadWrite.All scopes, " +
        "or set SHAREPOINT_TENANT_ID / SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET for app-only access.",
    );
  }
  return resolved;
}

// ──────────────────────────────────────────────────────────────────────────
// Public
// ──────────────────────────────────────────────────────────────────────────

/**
 * Returns a valid Microsoft Graph access token for SharePoint, preferring a
 * tenant-owned app-only token and falling back to the Replit connector.
 * Re-uses a cached value while it is still valid.
 */
export async function getSharePointToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedExpiresAt) {
    return cachedToken;
  }

  const appConfig = getSharePointAppConfig();
  const resolved = appConfig
    ? await acquireAppOnlyToken(appConfig)
    : await acquireConnectorToken();

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
