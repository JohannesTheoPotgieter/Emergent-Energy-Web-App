/**
 * Connector mock-mode gate (Phase 7)
 *
 * Decides at runtime whether an integration service should serve fixture
 * data or hit the real third-party API. The rule is intentionally simple
 * and strictly NODE_ENV-gated so the fallback can never leak to prod.
 *
 * Decision order per integration:
 *
 *   1. NODE_ENV === "production"     → NEVER mock. Real path only.
 *   2. USE_MOCK_CONNECTORS = "false"  → NEVER mock. Forces the real path
 *                                       to surface so developers can debug
 *                                       live-connector failures.
 *   3. USE_MOCK_CONNECTORS = "true"   → ALWAYS mock. Both for call sites
 *                                       that have creds configured and
 *                                       for call sites that don't.
 *   4. Real creds are configured     → Real path. (Normal dev-with-creds.)
 *   5. Real creds are absent         → Mock path. (Default fresh-clone.)
 *
 * Per-integration probes (below) read the specific env var each integration
 * requires, so a developer with real MS Graph creds but no QuickBooks token
 * gets live MS Graph AND mocked QuickBooks.
 */

export type ConnectorName = "ms-graph" | "quickbooks" | "pipedrive";

function globalOverride(): "force-mock" | "force-real" | null {
  if (process.env.NODE_ENV === "production") return "force-real";
  const flag = process.env.USE_MOCK_CONNECTORS;
  if (flag === "true") return "force-mock";
  if (flag === "false") return "force-real";
  return null;
}

/**
 * App-only (client-credentials) Graph creds for SharePoint. When a
 * tenant-owned Azure app reg is configured via SHAREPOINT_TENANT_ID /
 * SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET, the app acquires its own
 * Microsoft Graph token (scopes consented on an app the tenant controls)
 * instead of depending on the Replit connector's consented scopes. This is
 * the preferred SharePoint auth path — see server/sharepoint-token.ts and
 * docs/microsoft-integrations.md. Presence of all three is an explicit
 * opt-in; deployments without them keep the connector behaviour unchanged.
 */
export function hasMsGraphAppOnlyCreds(): boolean {
  return !!(
    process.env.SHAREPOINT_TENANT_ID?.trim() &&
    process.env.SHAREPOINT_CLIENT_ID?.trim() &&
    process.env.SHAREPOINT_CLIENT_SECRET?.trim()
  );
}

function hasMsGraphConnector(): boolean {
  // Replit Connectors infra is the historical auth layer for MS Graph;
  // a missing hostname means nothing can fetch a connector token.
  return !!(process.env.REPLIT_CONNECTORS_HOSTNAME && process.env.REPLIT_CONNECTORS_HOSTNAME.trim());
}

function hasMsGraphCreds(): boolean {
  // MS Graph is "live" when EITHER a tenant-owned app-only app reg is
  // configured (preferred) OR the Replit connector is available.
  return hasMsGraphAppOnlyCreds() || hasMsGraphConnector();
}

function hasQuickBooksCreds(): boolean {
  return !!(
    process.env.QUICKBOOKS_CLIENT_ID &&
    process.env.QUICKBOOKS_CLIENT_ID.trim() &&
    process.env.QUICKBOOKS_CLIENT_SECRET &&
    process.env.QUICKBOOKS_CLIENT_SECRET.trim()
  );
}

function hasPipedriveCreds(): boolean {
  return !!(process.env.PIPEDRIVE_API_TOKEN && process.env.PIPEDRIVE_API_TOKEN.trim());
}

function hasCreds(name: ConnectorName): boolean {
  switch (name) {
    case "ms-graph":
      return hasMsGraphCreds();
    case "quickbooks":
      return hasQuickBooksCreds();
    case "pipedrive":
      return hasPipedriveCreds();
  }
}

/**
 * Returns true when the named integration should serve fixture data.
 * Callers in each service file gate their real API calls on this.
 */
export function isConnectorMocked(name: ConnectorName): boolean {
  const override = globalOverride();
  if (override === "force-real") return false;
  if (override === "force-mock") return true;
  return !hasCreds(name);
}

/**
 * Convenience: lock a single log line per-process per-connector so we don't
 * spam startup with repeated "connector X is mocked" messages.
 */
const loggedOnce = new Set<string>();
export function logConnectorModeOnce(name: ConnectorName): void {
  if (loggedOnce.has(name)) return;
  loggedOnce.add(name);
  const mocked = isConnectorMocked(name);
  // eslint-disable-next-line no-console -- one-shot startup signal
  console.log(
    `[connector-mode] ${name}: ${mocked ? "MOCK (fixture data)" : "LIVE (real API)"}`,
  );
}
