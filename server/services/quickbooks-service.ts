/**
 * QuickBooks Online (Accounting) integration service.
 *
 * Handles OAuth2 flow, token storage/refresh, and read-only query
 * helpers against the QuickBooks Accounting API v3. Tokens are
 * persisted in the `integrations` table `metadata` jsonb column
 * for the row where `name = 'quickbooks'`.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { integrations, integrationRunEvents } from '@shared/schema';
import { db } from '../db';
import {
  deriveIntegrationHealth,
  recordIntegrationRun,
  type IntegrationHealthTile,
} from './integration-health-service';
import { isConnectorMocked } from '../lib/connector-mode';
import * as qbMocks from '../mocks/quickbooks-fixtures';

export const QB_INTEGRATION_NAME = 'quickbooks';

/**
 * How long a successful QB sync stays "fresh" before the status endpoint
 * surfaces a stale warning. The integration-health-service has its own
 * 25h healthy window for the global dashboard; here we use a tighter 2h
 * window because QB data feeds the live reconciliation UI and users need
 * to know when they're looking at a cached answer.
 */
export const QB_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const QB_AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_SCOPE = 'com.intuit.quickbooks.accounting';

export const QB_REDIRECT_URI =
  process.env.QUICKBOOKS_REDIRECT_URI ||
  'https://emergent-energy-dashboard.replit.app/api/quickbooks/callback';

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

function getApiBase(realmId: string): string {
  return `https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realmId)}`;
}

function maskMiddle(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;

  // Diagnostic: verify env vars are loaded (shows first/last 4 chars only)
  console.log(
    `[QuickBooks] QUICKBOOKS_CLIENT_ID: ${clientId ? `"${maskMiddle(clientId)}" (length=${clientId.length})` : 'UNDEFINED/EMPTY'}`,
  );
  console.log(
    `[QuickBooks] QUICKBOOKS_CLIENT_SECRET: ${clientSecret ? `"${maskMiddle(clientSecret)}" (length=${clientSecret.length})` : 'UNDEFINED/EMPTY'}`,
  );

  if (!clientId || !clientSecret) {
    throw new Error(
      'QuickBooks OAuth credentials missing. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.',
    );
  }
  return { clientId, clientSecret };
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = getClientCredentials();
  const raw = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
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
      displayName: 'QuickBooks Online',
      description:
        'OAuth2 integration with QuickBooks Online Accounting. Syncs invoices, customers, and financial data for COS tracking and invoice reconciliation.',
      authType: 'oauth2',
      ownerProcess: 'quickbooks-sync-service',
      fallbackDescription:
        'Financial data can still be managed manually. QuickBooks data will sync on the next successful connection.',
      alertTarget: 'COO_ADMIN',
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
    response_type: 'code',
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
  const authHeader = basicAuthHeader();

  // Diagnostic: log token request details (mask the Base64 payload)
  const b64Part = authHeader.replace('Basic ', '');
  console.log(`[QuickBooks] Token endpoint: ${QB_TOKEN_ENDPOINT}`);
  console.log(
    `[QuickBooks] Authorization header: Basic ${b64Part.slice(0, 6)}...${b64Part.slice(-6)} (base64 length=${b64Part.length})`,
  );
  console.log(`[QuickBooks] Token body params: ${[...body.keys()].join(', ')}`);

  const response = await fetch(QB_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: authHeader,
    },
    body: body.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    // Diagnostic: include credential shape in error so it surfaces in the UI
    const { clientId, clientSecret } = getClientCredentials();
    const diag = [
      `status=${response.status}`,
      `response=${text || response.statusText}`,
      `clientId=${maskMiddle(clientId)}(len=${clientId.length})`,
      `secret=${maskMiddle(clientSecret)}(len=${clientSecret.length})`,
    ].join(' | ');
    console.error(`[QuickBooks] Token exchange failed: ${diag}`);
    throw new Error(
      `QuickBooks token endpoint returned ${response.status}: ${text || response.statusText}. Diagnostics: clientId=${maskMiddle(clientId)}(len=${clientId.length}), secret=${maskMiddle(clientSecret)}(len=${clientSecret.length})`,
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
  const startedAt = new Date();
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
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
    await recordQbRun({
      runType: 'oauth:exchange_code',
      startedAt,
      ok: true,
      metadata: { realmId },
    });
    return metadata;
  } catch (err) {
    const { code, detail } = classifyQbError(err);
    await recordQbRun({
      runType: 'oauth:exchange_code',
      startedAt,
      ok: false,
      errorCode: code,
      errorDetail: detail,
    });
    throw err;
  }
}

export async function refreshAccessToken(): Promise<QuickBooksTokenMetadata> {
  const startedAt = new Date();
  const existing = await loadQuickBooksMetadata();
  if (!existing.refreshToken) {
    const err = new Error('QuickBooks is not connected: no refresh token stored.');
    await recordQbRun({
      runType: 'oauth:refresh',
      startedAt,
      ok: false,
      errorCode: 'not_connected',
      errorDetail: err.message,
    });
    throw err;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
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
    await recordQbRun({
      runType: 'oauth:refresh',
      startedAt,
      ok: true,
    });
    return metadata;
  } catch (err) {
    const { code, detail } = classifyQbError(err);
    await recordQbRun({
      runType: 'oauth:refresh',
      startedAt,
      ok: false,
      errorCode: code,
      errorDetail: detail,
    });
    throw err;
  }
}

export async function getValidAccessToken(): Promise<{ accessToken: string; realmId: string }> {
  if (isConnectorMocked('quickbooks')) return qbMocks.mockQuickBooksAccessToken();
  const metadata = await loadQuickBooksMetadata();

  if (!metadata.accessToken || !metadata.refreshToken || !metadata.realmId) {
    throw new Error('QuickBooks is not connected.');
  }

  const expiresAt = metadata.tokenExpiry ? Date.parse(metadata.tokenExpiry) : 0;
  const isExpired = !expiresAt || expiresAt - Date.now() < ACCESS_TOKEN_EARLY_REFRESH_MS;

  if (isExpired) {
    const refreshed = await refreshAccessToken();
    if (!refreshed.accessToken || !refreshed.realmId) {
      throw new Error('QuickBooks refresh did not return a usable access token.');
    }
    return { accessToken: refreshed.accessToken, realmId: refreshed.realmId };
  }

  return { accessToken: metadata.accessToken, realmId: metadata.realmId };
}

export async function disconnectQuickBooks(): Promise<void> {
  const startedAt = new Date();
  await saveQuickBooksMetadata({});
  await recordQbRun({
    runType: 'oauth:disconnect',
    startedAt,
    ok: true,
    metadata: { reason: 'manual_disconnect' },
  });
}

// ===================== API HELPERS =====================

/**
 * Classify an outbound-call error into an `errorCode` for the integration
 * run event. Kept intentionally coarse so the dashboard can group them.
 */
function classifyQbError(err: unknown): { code: string; detail: string } {
  const detail = err instanceof Error ? err.message : String(err);
  if (/not connected/i.test(detail)) return { code: 'not_connected', detail };
  // Intuit returns "invalid_grant" / "Incorrect or invalid refresh token"
  // when the stored refresh token has been revoked or expired. The user
  // must re-authorise the QuickBooks connection; the scheduler should not
  // keep retrying.
  if (/invalid_grant|invalid refresh token/i.test(detail))
    return { code: 'needs_reconnect', detail };
  if (/401|unauthorized/i.test(detail)) return { code: 'auth_expired', detail };
  if (/403|forbidden/i.test(detail)) return { code: 'forbidden', detail };
  if (/429|rate ?limit/i.test(detail)) return { code: 'rate_limited', detail };
  if (/5\d\d|server error|timeout|ECONN|fetch failed/i.test(detail))
    return { code: 'upstream_error', detail };
  return { code: 'unknown', detail };
}

/**
 * Returns true if the given error indicates the stored QuickBooks refresh
 * token is no longer accepted by Intuit (revoked, expired, or rotated by a
 * concurrent OAuth flow). The connection must be re-authorised by a user
 * before any further QuickBooks API calls will succeed.
 */
export function isQbReconnectRequiredError(err: unknown): boolean {
  return classifyQbError(err).code === 'needs_reconnect';
}

/**
 * Internal helper — records a run event against the `quickbooks`
 * integration. Wrapped in try/catch so a run-log failure never takes down
 * the outbound QB call.
 */
async function recordQbRun(params: {
  runType: string;
  startedAt: Date;
  ok: boolean;
  errorCode?: string | null;
  errorDetail?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await recordIntegrationRun({
      name: QB_INTEGRATION_NAME,
      runType: params.runType,
      startedAt: params.startedAt,
      finishedAt: new Date(),
      status: params.ok ? 'success' : 'failure',
      errorCode: params.errorCode ?? null,
      errorDetail: params.errorDetail ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    console.warn('[QuickBooks] recordIntegrationRun failed:', err);
  }
}

async function qbGet<T = any>(path: string): Promise<T> {
  const startedAt = new Date();
  try {
    const { accessToken, realmId } = await getValidAccessToken();
    const url = `${getApiBase(realmId)}${path}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    const text = await response.text();
    if (!response.ok) {
      const err = new Error(
        `QuickBooks API ${path} returned ${response.status}: ${text || response.statusText}`,
      );
      const { code, detail } = classifyQbError(err);
      await recordQbRun({
        runType: `qbGet:${path.split('?')[0]}`,
        startedAt,
        ok: false,
        errorCode: code,
        errorDetail: detail,
        metadata: { path, httpStatus: response.status },
      });
      throw err;
    }

    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      const err = new Error(`QuickBooks API ${path} returned invalid JSON`);
      await recordQbRun({
        runType: `qbGet:${path.split('?')[0]}`,
        startedAt,
        ok: false,
        errorCode: 'invalid_json',
        errorDetail: err.message,
        metadata: { path },
      });
      throw err;
    }

    await recordQbRun({
      runType: `qbGet:${path.split('?')[0]}`,
      startedAt,
      ok: true,
      metadata: { path },
    });
    return parsed;
  } catch (err) {
    // Only log here if we haven't already logged above (e.g. token-refresh
    // failure before the HTTP call even fired).
    if (
      err instanceof Error &&
      !/returned \d{3}:/.test(err.message) &&
      !/returned invalid JSON/.test(err.message)
    ) {
      const { code, detail } = classifyQbError(err);
      await recordQbRun({
        runType: `qbGet:${path.split('?')[0]}`,
        startedAt,
        ok: false,
        errorCode: code,
        errorDetail: detail,
        metadata: { path },
      });
    }
    throw err;
  }
}

export async function queryQuickBooks<T = any>(_entity: string, query: string): Promise<T> {
  if (isConnectorMocked('quickbooks')) {
    // Best-effort query routing for local dev. The UI only uses a handful
    // of entity types; anything else returns an empty QueryResponse.
    const e = _entity.toLowerCase();
    if (e === 'invoice') return qbMocks.mockInvoices() as unknown as T;
    if (e === 'bill') return qbMocks.mockBills() as unknown as T;
    if (e === 'customer') return qbMocks.mockCustomers() as unknown as T;
    if (e === 'vendor') return qbMocks.mockVendors() as unknown as T;
    return { QueryResponse: {} } as unknown as T;
  }
  // QuickBooks v3 query endpoint: /query?query=...
  const path = `/query?query=${encodeURIComponent(query)}&minorversion=70`;
  return qbGet<T>(path);
}

export async function getCompanyInfo(): Promise<any> {
  if (isConnectorMocked('quickbooks')) return qbMocks.mockCompanyInfo();
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
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

export async function getInvoices(startDate?: string, endDate?: string): Promise<any> {
  if (isConnectorMocked('quickbooks')) return qbMocks.mockInvoices(startDate, endDate);
  const where = buildDateClause('TxnDate', startDate, endDate);
  const maxResults = 500;
  let startPosition = 1;
  const allInvoices: any[] = [];

  while (true) {
    const query = `SELECT * FROM Invoice${where} ORDERBY TxnDate DESC STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const page = await queryQuickBooks<any>('Invoice', query);
    const invoices = page?.QueryResponse?.Invoice ?? [];
    allInvoices.push(...invoices);
    if (invoices.length < maxResults) break;
    startPosition += maxResults;
  }

  return {
    QueryResponse: {
      ...(allInvoices.length > 0 ? { Invoice: allInvoices } : {}),
      startPosition: 1,
      maxResults: allInvoices.length,
    },
    time: new Date().toISOString(),
  };
}

export async function getCustomers(): Promise<any> {
  if (isConnectorMocked('quickbooks')) return qbMocks.mockCustomers();
  const query = `SELECT * FROM Customer WHERE Active = true MAXRESULTS 1000`;
  return queryQuickBooks('Customer', query);
}

export async function getVendors(): Promise<any> {
  if (isConnectorMocked('quickbooks')) return qbMocks.mockVendors();
  const query = `SELECT * FROM Vendor WHERE Active = true MAXRESULTS 1000`;
  return queryQuickBooks('Vendor', query);
}

/**
 * Fetch a single Bill by its QuickBooks Id. Used by the allocation endpoint
 * to re-derive VAT/amount/vendor on the server rather than trusting the
 * client-supplied snapshot. Returns the raw Bill object or null if missing.
 */
export async function getBillById(id: string): Promise<any | null> {
  if (isConnectorMocked('quickbooks')) return qbMocks.mockBillById(id);
  if (!id) return null;
  // QB QL is not SQL-safe for arbitrary IDs. Reject anything outside the
  // documented Id alphabet so we can never smuggle a WHERE clause.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Invalid QuickBooks Bill Id format');
  }
  const query = `SELECT * FROM Bill WHERE Id = '${id}'`;
  const resp = await queryQuickBooks<any>('Bill', query);
  const bills = resp?.QueryResponse?.Bill;
  if (Array.isArray(bills) && bills.length > 0) return bills[0];
  return null;
}

export async function getBills(startDate?: string, endDate?: string): Promise<any> {
  if (isConnectorMocked('quickbooks')) return qbMocks.mockBills(startDate, endDate);
  const where = buildDateClause('TxnDate', startDate, endDate);
  const maxResults = 500;
  let startPosition = 1;
  const allBills: any[] = [];

  while (true) {
    const query = `SELECT * FROM Bill${where} ORDERBY TxnDate DESC STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const page = await queryQuickBooks<any>('Bill', query);
    const bills = page?.QueryResponse?.Bill ?? [];
    allBills.push(...bills);
    if (bills.length < maxResults) break;
    startPosition += maxResults;
  }

  return {
    QueryResponse: {
      ...(allBills.length > 0 ? { Bill: allBills } : {}),
      startPosition: 1,
      maxResults: allBills.length,
    },
    time: new Date().toISOString(),
  };
}

export async function getProfitAndLossReport(startDate: string, endDate: string): Promise<any> {
  if (isConnectorMocked('quickbooks')) return qbMocks.mockProfitAndLossReport(startDate, endDate);
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    minorversion: '70',
  });
  return qbGet<any>(`/reports/ProfitAndLoss?${params.toString()}`);
}

export async function getMonthlyPnLReport(startDate: string, endDate: string): Promise<any> {
  if (isConnectorMocked('quickbooks')) return qbMocks.mockMonthlyPnLReport(startDate, endDate);
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    summarize_column_by: 'Month',
    minorversion: '70',
  });
  return qbGet<any>(`/reports/ProfitAndLoss?${params.toString()}`);
}

/**
 * Walk a QuickBooks ProfitAndLoss report (with summarize_column_by=Month)
 * and return a Map<YYYY-MM, amount> for the first Data row whose account id
 * or name matches the predicate. Amounts are returned as positive numbers
 * (QBO reports income as positive credits already).
 *
 * Used by the Revenue Tracker to read account 1000000 "Sales" — which is
 * the canonical revenue-recognition source per finance (ex-VAT P&L credits,
 * including journal entries — not Invoice.TotalAmt which is VAT-inclusive
 * A/R and may post to liability accounts like deferred revenue).
 *
 * Defensive: returns an empty Map on any structural mismatch.
 */
export interface MonthlyPnLAccountDetail {
  accountId: string | null;
  accountName: string | null;
  monthKey: string;
  amount: number;
}

export function extractMonthlyAccountDetailsFromPnL(
  report: any,
  matchAccount: (account: { id: string | null; name: string | null }) => boolean,
): MonthlyPnLAccountDetail[] {
  const out: MonthlyPnLAccountDetail[] = [];
  try {
    const cols: any[] = report?.Columns?.Column ?? [];
    const monthByCol = new Map<number, string>();
    cols.forEach((col, idx) => {
      const meta: any[] = col?.MetaData ?? [];
      const startDate = meta.find((m: any) => m?.Name === 'StartDate')?.Value;
      const dm = String(startDate || '').match(/^(\d{4})-(\d{2})/);
      if (dm) monthByCol.set(idx, `${dm[1]}-${dm[2]}`);
    });
    if (monthByCol.size === 0) return out;

    const readCells = (
      account: { id: string | null; name: string | null },
      cellsArr: any[],
    ): void => {
      monthByCol.forEach((monthKey, idx) => {
        const cell = cellsArr[idx];
        const v = cell?.value;
        const n = v === undefined || v === null || v === '' ? 0 : Number(v);
        if (Number.isFinite(n) && n !== 0) {
          out.push({ accountId: account.id, accountName: account.name, monthKey, amount: n });
        }
      });
    };

    const visit = (row: any): void => {
      if (!row) return;
      if (row.type === 'Section' || row.Header || row.Summary) {
        const headerCell = row?.Header?.ColData?.[0] ?? {};
        const account = {
          id: headerCell?.id ? String(headerCell.id) : null,
          name: headerCell?.value ? String(headerCell.value) : null,
        };
        if ((account.id || account.name) && matchAccount(account)) {
          const sumCells: any[] = row?.Summary?.ColData ?? [];
          if (sumCells.length) readCells(account, sumCells);
        }
      }
      if (row.type === 'Data' && Array.isArray(row.ColData)) {
        const accCell = row.ColData[0] ?? {};
        const account = {
          id: accCell?.id ? String(accCell.id) : null,
          name: accCell?.value ? String(accCell.value) : null,
        };
        if (matchAccount(account)) readCells(account, row.ColData);
      }
      const children: any[] = row?.Rows?.Row ?? [];
      for (const child of children) visit(child);
    };

    const top: any[] = report?.Rows?.Row ?? [];
    for (const row of top) visit(row);
  } catch {
    // Defensive - return whatever we've parsed.
  }
  return out;
}

export function extractMonthlyAccountTotalsFromPnL(
  report: any,
  matchAccount: (account: { id: string | null; name: string | null }) => boolean,
): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const cols: any[] = report?.Columns?.Column ?? [];
    // Build column-index → YYYY-MM. Account col is index 0; Total col is last.
    const monthByCol = new Map<number, string>();
    cols.forEach((col, idx) => {
      const meta: any[] = col?.MetaData ?? [];
      const startDate = meta.find((m: any) => m?.Name === 'StartDate')?.Value;
      const dm = String(startDate || '').match(/^(\d{4})-(\d{2})/);
      if (dm) monthByCol.set(idx, `${dm[1]}-${dm[2]}`);
    });
    if (monthByCol.size === 0) return out;

    const readCells = (cellsArr: any[]): void => {
      monthByCol.forEach((monthKey, idx) => {
        const cell = cellsArr[idx];
        const v = cell?.value;
        const n = v === undefined || v === null || v === '' ? 0 : Number(v);
        if (Number.isFinite(n) && n !== 0) {
          out.set(monthKey, (out.get(monthKey) ?? 0) + n);
        }
      });
    };

    const visit = (row: any): boolean => {
      if (!row) return false;
      // Section row — check Header.ColData[0] for account match (handles
      // QB accounts that have sub-accounts and therefore appear as a
      // Section with a Summary row totalling the parent account).
      if (row.type === 'Section' || row.Header || row.Summary) {
        const headerCell = row?.Header?.ColData?.[0] ?? {};
        const account = {
          id: headerCell?.id ? String(headerCell.id) : null,
          name: headerCell?.value ? String(headerCell.value) : null,
        };
        if ((account.id || account.name) && matchAccount(account)) {
          const sumCells: any[] = row?.Summary?.ColData ?? [];
          if (sumCells.length) {
            readCells(sumCells);
          }
        }
      }
      // Data row at the leaf — check the account.
      if (row.type === 'Data' && Array.isArray(row.ColData)) {
        const accCell = row.ColData[0] ?? {};
        const account = {
          id: accCell?.id ? String(accCell.id) : null,
          name: accCell?.value ? String(accCell.value) : null,
        };
        if (matchAccount(account)) {
          readCells(row.ColData);
        }
      }
      // Recurse into nested sections.
      const children: any[] = row?.Rows?.Row ?? [];
      for (const child of children) {
        visit(child);
      }
      return false;
    };

    const top: any[] = report?.Rows?.Row ?? [];
    for (const row of top) {
      visit(row);
    }
  } catch {
    // Defensive — return whatever we've parsed.
  }
  return out;
}

export interface QuickBooksConnectionStatus {
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  tokenExpiry: string | null;
  refreshTokenExpiry: string | null;
  /** Derived health tile — 'healthy' | 'stale' | 'failing' | 'unknown'. */
  health: IntegrationHealthTile['health'];
  /** ISO of the most recent successful QB run event. */
  lastSuccessfulSyncAt: string | null;
  /** ISO of the most recent failed QB run event. */
  lastFailedSyncAt: string | null;
  /** Short code on the most recent failure. Null when no failure. */
  lastFailureCode: string | null;
  /** Free-form detail on the most recent failure. */
  lastFailureReason: string | null;
  /** True when no successful run has happened within QB_STALE_AFTER_MS. */
  isStale: boolean;
  /** ms since the last successful sync. Null when never synced. */
  ageMs: number | null;
  /** Window (ms) after which we flag data as stale. Exposed for the UI. */
  staleAfterMs: number;
}

/**
 * Load the most recent success / most recent failure / most recent run
 * from `integration_run_events` for the QB integration row. Used by the
 * status endpoint to render the health summary card.
 */
async function loadQuickBooksRunHealth(): Promise<{
  lastRunAt: Date | null;
  lastRunStatus: 'success' | 'failure' | 'partial' | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureCode: string | null;
  lastFailureDetail: string | null;
}> {
  const row = await loadQuickBooksIntegrationRow();
  if (!row) {
    return {
      lastRunAt: null,
      lastRunStatus: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureCode: null,
      lastFailureDetail: null,
    };
  }

  const [lastRun] = await db
    .select()
    .from(integrationRunEvents)
    .where(eq(integrationRunEvents.integrationId, row.id))
    .orderBy(desc(integrationRunEvents.startedAt))
    .limit(1);

  const [lastSuccess] = await db
    .select()
    .from(integrationRunEvents)
    .where(
      and(
        eq(integrationRunEvents.integrationId, row.id),
        eq(integrationRunEvents.status, 'success'),
      ),
    )
    .orderBy(desc(integrationRunEvents.startedAt))
    .limit(1);

  const [lastFailure] = await db
    .select()
    .from(integrationRunEvents)
    .where(
      and(
        eq(integrationRunEvents.integrationId, row.id),
        eq(integrationRunEvents.status, 'failure'),
      ),
    )
    .orderBy(desc(integrationRunEvents.startedAt))
    .limit(1);

  return {
    lastRunAt: lastRun?.startedAt ?? null,
    lastRunStatus: (lastRun?.status as 'success' | 'failure' | 'partial' | undefined) ?? null,
    lastSuccessAt: lastSuccess?.startedAt ?? null,
    lastFailureAt: lastFailure?.startedAt ?? null,
    lastFailureCode: lastFailure?.errorCode ?? null,
    lastFailureDetail: lastFailure?.errorDetail ?? null,
  };
}

export async function getQuickBooksConnectionStatus(): Promise<QuickBooksConnectionStatus> {
  if (isConnectorMocked('quickbooks'))
    return qbMocks.mockQuickBooksConnectionStatus() as unknown as QuickBooksConnectionStatus;
  const metadata = await loadQuickBooksMetadata();
  const connected = Boolean(metadata.accessToken && metadata.refreshToken && metadata.realmId);

  const run = await loadQuickBooksRunHealth();
  const now = new Date();
  const health = deriveIntegrationHealth({
    lastSuccessAt: run.lastSuccessAt,
    lastRunAt: run.lastRunAt,
    lastRunStatus: run.lastRunStatus,
    now,
  });

  const ageMs = run.lastSuccessAt ? now.getTime() - run.lastSuccessAt.getTime() : null;
  const isStale = ageMs === null ? connected : ageMs > QB_STALE_AFTER_MS;

  return {
    connected,
    realmId: metadata.realmId ?? null,
    companyName: metadata.companyName ?? null,
    tokenExpiry: metadata.tokenExpiry ?? null,
    refreshTokenExpiry: metadata.refreshTokenExpiry ?? null,
    health,
    lastSuccessfulSyncAt: run.lastSuccessAt ? run.lastSuccessAt.toISOString() : null,
    lastFailedSyncAt: run.lastFailureAt ? run.lastFailureAt.toISOString() : null,
    lastFailureCode: run.lastFailureCode,
    lastFailureReason: run.lastFailureDetail,
    isStale,
    ageMs,
    staleAfterMs: QB_STALE_AFTER_MS,
  };
}
