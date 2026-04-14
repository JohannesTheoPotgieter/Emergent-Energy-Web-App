/**
 * QuickBooks Online (Accounting) integration service.
 *
 * Handles OAuth2 flow, token storage/refresh, and read-only query
 * helpers against the QuickBooks Accounting API v3. Tokens are
 * persisted in the `integrations` table `metadata` jsonb column
 * for the row where `name = 'quickbooks'`.
 */

import { and, eq, isNull } from "drizzle-orm";
import { integrations } from "@shared/schema";
import { db } from "../db";

const QB_INTEGRATION_NAME = "quickbooks";
const QB_AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_SCOPE = "com.intuit.quickbooks.accounting";

export const QB_REDIRECT_URI =
  process.env.QUICKBOOKS_REDIRECT_URI ||
  "https://emergent-energy-dashboard.replit.app/api/quickbooks/callback";

// QuickBooks access tokens last 1 hour. We refresh a bit early.
const ACCESS_TOKEN_EARLY_REFRESH_MS = 5 * 60 * 1000;

export type QuickBooksTokenMetadata = {
  realmId?: string;
  accessToken?: string;
  refreshToken?: string;
  /** ISO string: when the access token expires. */
  tokenExpiry?: string;
  /** ISO string: when the refresh token expires (~100 days). */
  refreshTokenExpiry?: string;
  /** ISO string: when tokens were last updated. */
  updatedAt?: string;
  /** Cached company name from last `getCompanyInfo()` call. */
  companyName?: string;
};

function isSandbox(): boolean {
  const raw = (process.env.QUICKBOOKS_SANDBOX ?? "true").toString().toLowerCase();
  return raw !== "false" && raw !== "0";
}

function getApiBase(realmId: string): string {
  const host = isSandbox()
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  return `${host}/v3/company/${encodeURIComponent(realmId)}`;
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "QuickBooks OAuth credentials missing. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.",
    );
  }
  return { clientId, clientSecret };
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = getClientCredentials();
  const raw = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

// ===================== STORAGE HELPERS =====================

async function loadQuickBooksIntegrationRow() {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.name, QB_INTEGRATION_NAME), isNull(integrations.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadQuickBooksMetadata(): Promise<QuickBooksTokenMetadata> {
  const row = await loadQuickBooksIntegrationRow();
  const metadata = (row?.metadata as QuickBooksTokenMetadata | null) ?? {};
  return metadata ?? {};
}

async function saveQuickBooksMetadata(metadata: QuickBooksTokenMetadata): Promise<void> {
  const row = await loadQuickBooksIntegrationRow();
  if (!row) {
    // Seed row is expected to be created at boot; fall back to insert.
    await db.insert(integrations).values({
      name: QB_INTEGRATION_NAME,
      displayName: "QuickBooks Online",
      description:
        "OAuth2 integration with QuickBooks Online Accounting. Syncs invoices, customers, and financial data for COS tracking and invoice reconciliation.",
      authType: "oauth2",
      ownerProcess: "quickbooks-sync-service",
      fallbackDescription:
        "Financial data can still be managed manually. QuickBooks data will sync on the next successful connection.",
      alertTarget: "COO_ADMIN",
      metadata,
    } as any);
    return;
  }

  await db
    .update(integrations)
    .set({ metadata, updatedAt: new Date() } as any)
    .where(eq(integrations.id, row.id));
}

// ===================== OAUTH HELPERS =====================

export function getAuthorizationUrl(state: string): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: QB_SCOPE,
    redirect_uri: QB_REDIRECT_URI,
    state,
  });
  return `${QB_AUTH_BASE}?${params.toString()}`;
}

type IntuitTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
  token_type?: string;
};

async function postToTokenEndpoint(body: URLSearchParams): Promise<IntuitTokenResponse> {
  const response = await fetch(QB_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: body.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `QuickBooks token endpoint returned ${response.status}: ${text || response.statusText}`,
    );
  }

  try {
    return JSON.parse(text) as IntuitTokenResponse;
  } catch {
    throw new Error(`QuickBooks token endpoint returned invalid JSON: ${text}`);
  }
}

export async function exchangeCodeForTokens(
  code: string,
  realmId: string,
): Promise<QuickBooksTokenMetadata> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: QB_REDIRECT_URI,
  });

  const tokenResponse = await postToTokenEndpoint(body);

  const now = Date.now();
  const metadata: QuickBooksTokenMetadata = {
    realmId,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    tokenExpiry: new Date(now + (tokenResponse.expires_in ?? 3600) * 1000).toISOString(),
    refreshTokenExpiry: tokenResponse.x_refresh_token_expires_in
      ? new Date(now + tokenResponse.x_refresh_token_expires_in * 1000).toISOString()
      : undefined,
    updatedAt: new Date(now).toISOString(),
  };

  await saveQuickBooksMetadata(metadata);
  return metadata;
}

export async function refreshAccessToken(): Promise<QuickBooksTokenMetadata> {
  const existing = await loadQuickBooksMetadata();
  if (!existing.refreshToken) {
    throw new Error("QuickBooks is not connected: no refresh token stored.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: existing.refreshToken,
  });

  const tokenResponse = await postToTokenEndpoint(body);

  const now = Date.now();
  const metadata: QuickBooksTokenMetadata = {
    ...existing,
    accessToken: tokenResponse.access_token,
    // Intuit rotates refresh tokens periodically; fall back to the existing one when absent.
    refreshToken: tokenResponse.refresh_token || existing.refreshToken,
    tokenExpiry: new Date(now + (tokenResponse.expires_in ?? 3600) * 1000).toISOString(),
    refreshTokenExpiry: tokenResponse.x_refresh_token_expires_in
      ? new Date(now + tokenResponse.x_refresh_token_expires_in * 1000).toISOString()
      : existing.refreshTokenExpiry,
    updatedAt: new Date(now).toISOString(),
  };

  await saveQuickBooksMetadata(metadata);
  return metadata;
}

export async function getValidAccessToken(): Promise<{ accessToken: string; realmId: string }> {
  const metadata = await loadQuickBooksMetadata();

  if (!metadata.accessToken || !metadata.refreshToken || !metadata.realmId) {
    throw new Error("QuickBooks is not connected.");
  }

  const expiresAt = metadata.tokenExpiry ? Date.parse(metadata.tokenExpiry) : 0;
  const isExpired = !expiresAt || expiresAt - Date.now() < ACCESS_TOKEN_EARLY_REFRESH_MS;

  if (isExpired) {
    const refreshed = await refreshAccessToken();
    if (!refreshed.accessToken || !refreshed.realmId) {
      throw new Error("QuickBooks refresh did not return a usable access token.");
    }
    return { accessToken: refreshed.accessToken, realmId: refreshed.realmId };
  }

  return { accessToken: metadata.accessToken, realmId: metadata.realmId };
}

export async function disconnectQuickBooks(): Promise<void> {
  await saveQuickBooksMetadata({});
}

// ===================== API HELPERS =====================

async function qbGet<T = any>(path: string): Promise<T> {
  const { accessToken, realmId } = await getValidAccessToken();
  const url = `${getApiBase(realmId)}${path}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `QuickBooks API ${path} returned ${response.status}: ${text || response.statusText}`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`QuickBooks API ${path} returned invalid JSON`);
  }
}

export async function queryQuickBooks<T = any>(
  _entity: string,
  query: string,
): Promise<T> {
  // QuickBooks v3 query endpoint: /query?query=...
  const path = `/query?query=${encodeURIComponent(query)}&minorversion=70`;
  return qbGet<T>(path);
}

export async function getCompanyInfo(): Promise<any> {
  const { realmId } = await getValidAccessToken();
  const info = await qbGet<any>(`/companyinfo/${encodeURIComponent(realmId)}?minorversion=70`);

  // Cache the company name for the status endpoint.
  try {
    const companyName = info?.CompanyInfo?.CompanyName;
    if (companyName) {
      const existing = await loadQuickBooksMetadata();
      if (existing.companyName !== companyName) {
        await saveQuickBooksMetadata({ ...existing, companyName });
      }
    }
  } catch {
    // non-fatal
  }

  return info;
}

function buildDateClause(field: string, startDate?: string, endDate?: string): string {
  const clauses: string[] = [];
  if (startDate) clauses.push(`${field} >= '${startDate}'`);
  if (endDate) clauses.push(`${field} <= '${endDate}'`);
  return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
}

export async function getInvoices(startDate?: string, endDate?: string): Promise<any> {
  const where = buildDateClause("TxnDate", startDate, endDate);
  const query = `SELECT * FROM Invoice${where} ORDERBY TxnDate DESC MAXRESULTS 500`;
  return queryQuickBooks("Invoice", query);
}

export async function getCustomers(): Promise<any> {
  const query = `SELECT * FROM Customer WHERE Active = true MAXRESULTS 1000`;
  return queryQuickBooks("Customer", query);
}

export async function getVendors(): Promise<any> {
  const query = `SELECT * FROM Vendor WHERE Active = true MAXRESULTS 1000`;
  return queryQuickBooks("Vendor", query);
}

export async function getBills(startDate?: string, endDate?: string): Promise<any> {
  const where = buildDateClause("TxnDate", startDate, endDate);
  const query = `SELECT * FROM Bill${where} ORDERBY TxnDate DESC MAXRESULTS 500`;
  return queryQuickBooks("Bill", query);
}

export async function getProfitAndLossReport(startDate: string, endDate: string): Promise<any> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    minorversion: "70",
  });
  return qbGet<any>(`/reports/ProfitAndLoss?${params.toString()}`);
}

export async function getQuickBooksConnectionStatus(): Promise<{
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  tokenExpiry: string | null;
  refreshTokenExpiry: string | null;
  sandbox: boolean;
}> {
  const metadata = await loadQuickBooksMetadata();
  const connected = Boolean(metadata.accessToken && metadata.refreshToken && metadata.realmId);
  return {
    connected,
    realmId: metadata.realmId ?? null,
    companyName: metadata.companyName ?? null,
    tokenExpiry: metadata.tokenExpiry ?? null,
    refreshTokenExpiry: metadata.refreshTokenExpiry ?? null,
    sandbox: isSandbox(),
  };
}
