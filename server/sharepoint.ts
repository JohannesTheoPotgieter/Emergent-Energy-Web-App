import { storage } from "./storage";
import type { SpFile, InsertSpFile, InsertChangeLedger, InsertImportRun } from "@shared/schema";
import { getSharePointToken, clearSharePointTokenCache } from "./sharepoint-token";
import { ApiError } from "./lib/api-error";
import { isConnectorMocked, hasMsGraphAppOnlyCreds } from "./lib/connector-mode";

/** @deprecated Use getSharePointToken() from sharepoint-token.ts directly. Re-exported for backward compatibility. */
export const getAccessToken = getSharePointToken;

type SharePointFailureCategory =
  | "missing_token"
  | "expired_token"
  | "missing_scope"
  | "401"
  | "403"
  | "404"
  | "malformed_config"
  | "graph_outage";

type SharePointCheckName = "site" | "drive" | "folder" | "children";

export interface SharePointGraphCheck {
  name: SharePointCheckName;
  endpoint: string;
  ok: boolean;
  httpStatus: number | null;
  graphErrorCode?: string | null;
  graphErrorMessage?: string | null;
}

export interface SharePointTokenDiagnostics {
  exists: boolean;
  tokenType: "delegated" | "app-only" | "unknown";
  tenantId: string | null;
  principalId: string | null;
  servicePrincipalId: string | null;
  appId: string | null;
  expiresAt: string | null;
  expired: boolean | null;
  scopes: string[];
  roles: string[];
  hasRequiredSharePointAccess: boolean;
  missingRequiredAccess: string[];
}

export interface SharePointConnectionDiagnostics {
  token: SharePointTokenDiagnostics;
  config: {
    siteIdLength: number;
    driveIdLength: number;
    folderPath: string | null;
  };
}

export interface SharePointConnectionTestResult {
  ok: boolean;
  success: boolean;
  failureCategory?: SharePointFailureCategory;
  message?: string;
  nextAction?: string;
  siteName?: string;
  driveName?: string;
  folderName?: string;
  siteReachable?: boolean;
  driveReachable?: boolean;
  folderReachable?: boolean;
  fileCount?: number;
  firstFiveTrackerFilenames?: string[];
  checks?: SharePointGraphCheck[];
  diagnostics?: SharePointConnectionDiagnostics;
}

export function normalizeSharePointFolderPath(folderPath?: string | null): string | undefined {
  const normalized = (folderPath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/{2,}/g, "/");
  return normalized || undefined;
}

function encodeGraphDrivePath(folderPath: string): string {
  return folderPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

interface ParsedGraphError {
  code?: string;
  message?: string;
  requestId?: string;
  clientRequestId?: string;
  date?: string;
}

function parseGraphError(text: string): ParsedGraphError {
  try {
    const parsed = JSON.parse(text);
    const graphError = parsed?.error ?? parsed;
    const inner = graphError?.innerError ?? graphError?.innererror ?? {};
    return {
      code: typeof graphError?.code === "string" ? graphError.code : undefined,
      message: typeof graphError?.message === "string" ? graphError.message : undefined,
      requestId: typeof inner?.["request-id"] === "string" ? inner["request-id"] : undefined,
      clientRequestId: typeof inner?.["client-request-id"] === "string" ? inner["client-request-id"] : undefined,
      date: typeof inner?.date === "string" ? inner.date : undefined,
    };
  } catch {
    return text ? { message: text.slice(0, 500) } : {};
  }
}

function graphErrorDetails(text: string): Record<string, string> | undefined {
  const parsed = parseGraphError(text);
  const details: Record<string, string> = {};
  if (parsed.code) details.graphCode = parsed.code;
  if (parsed.message) details.graphMessage = parsed.message;
  if (parsed.requestId) details.requestId = parsed.requestId;
  if (parsed.clientRequestId) details.clientRequestId = parsed.clientRequestId;
  if (parsed.date) details.date = parsed.date;
  return Object.keys(details).length > 0 ? details : undefined;
}

function graphApiError(status: number, text: string, context: string): ApiError {
  const details = graphErrorDetails(text);
  if (status === 401) {
    // The cached token is what produced the 401 — drop it so the very
    // next call goes back to the Replit connector for a fresh one.
    // Skipping this leaves a dead token in the cache for ~50 min.
    clearSharePointTokenCache();
    return new ApiError(
      401,
      "SHAREPOINT_TOKEN_UNAUTHORIZED",
      `Microsoft rejected the SharePoint token for ${context}.`,
      details,
      "Reconnect the Microsoft connector, then retry.",
    );
  }
  if (status === 403) {
    return new ApiError(
      403,
      "SHAREPOINT_ACCESS_DENIED",
      `SharePoint denied access to ${context}.`,
      details,
      "Grant the connected Microsoft account access to the SharePoint site/library and ensure Graph Sites/Files permissions have admin consent.",
    );
  }
  if (status === 404) {
    return new ApiError(
      404,
      "SHAREPOINT_RESOURCE_NOT_FOUND",
      `SharePoint could not find ${context}.`,
      details,
      "Check the SharePoint Site ID, Drive ID, folder item ID, and folder path.",
    );
  }
  return new ApiError(
    502,
    "SHAREPOINT_GRAPH_ERROR",
    `Microsoft Graph failed while trying to ${context}.`,
    details,
    "Retry shortly. If it continues, check Microsoft Graph health and the SharePoint configuration.",
  );
}

function failureCategoryFromError(err: unknown): SharePointFailureCategory {
  if (err instanceof ApiError) {
    if (err.code === "SHAREPOINT_TOKEN_UNAUTHORIZED") return "401";
    if (err.code === "SHAREPOINT_ACCESS_DENIED") return "403";
    if (err.code === "SHAREPOINT_RESOURCE_NOT_FOUND") return "404";
  }
  return "graph_outage";
}

function decodeBase64UrlJson(part: string): Record<string, any> | null {
  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

const READ_SCOPE_ALIASES = new Set([
  "Files.Read.All",
  "Files.ReadWrite.All",
  "Sites.Read.All",
  "Sites.ReadWrite.All",
]);

function decodeTokenDiagnostics(token: string | null): SharePointTokenDiagnostics {
  if (!token) {
    return {
      exists: false,
      tokenType: "unknown",
      tenantId: null,
      principalId: null,
      servicePrincipalId: null,
      appId: null,
      expiresAt: null,
      expired: null,
      scopes: [],
      roles: [],
      hasRequiredSharePointAccess: false,
      missingRequiredAccess: ["Files.Read.All or Sites.Read.All"],
    };
  }

  const payload = decodeBase64UrlJson(token.split(".")[1] ?? "");
  const scopes = typeof payload?.scp === "string"
    ? payload.scp.split(/\s+/).filter(Boolean).sort()
    : [];
  const roles = Array.isArray(payload?.roles)
    ? payload.roles.filter((role: unknown): role is string => typeof role === "string").sort()
    : [];
  const expiresAt = typeof payload?.exp === "number"
    ? new Date(payload.exp * 1000).toISOString()
    : null;
  const expired = typeof payload?.exp === "number"
    ? payload.exp * 1000 <= Date.now()
    : null;
  const hasRequiredSharePointAccess = [...scopes, ...roles].some((permission) => READ_SCOPE_ALIASES.has(permission));

  return {
    exists: true,
    tokenType: roles.length > 0 ? "app-only" : scopes.length > 0 ? "delegated" : "unknown",
    tenantId: typeof payload?.tid === "string" ? payload.tid : null,
    principalId: typeof payload?.oid === "string" ? payload.oid : typeof payload?.sub === "string" ? payload.sub : null,
    servicePrincipalId: typeof payload?.idtyp === "string" && payload.idtyp === "app" && typeof payload?.oid === "string" ? payload.oid : null,
    appId: typeof payload?.appid === "string" ? payload.appid : typeof payload?.azp === "string" ? payload.azp : null,
    expiresAt,
    expired,
    scopes,
    roles,
    hasRequiredSharePointAccess,
    missingRequiredAccess: hasRequiredSharePointAccess ? [] : ["Files.Read.All or Sites.Read.All"],
  };
}

function buildDiagnostics(
  token: string | null,
  siteId: string,
  driveId: string,
  folderPath?: string | null,
): SharePointConnectionDiagnostics {
  return {
    token: decodeTokenDiagnostics(token),
    config: {
      siteIdLength: siteId.length,
      driveIdLength: driveId.length,
      folderPath: normalizeSharePointFolderPath(folderPath) ?? null,
    },
  };
}

function logConnectionDiagnostic(result: SharePointConnectionTestResult): void {
  if (process.env.NODE_ENV === "test") return;
  const payload = {
    ok: result.ok,
    failureCategory: result.failureCategory ?? null,
    message: result.message ?? null,
    checks: result.checks ?? [],
    diagnostics: result.diagnostics ?? null,
    fileCount: result.fileCount ?? null,
    firstFiveTrackerFilenames: result.firstFiveTrackerFilenames ?? [],
  };
  const logger = result.ok ? console.info : console.warn;
  logger("[SharePoint health check]", payload);
}

interface GraphJsonResult {
  data?: any;
  check: SharePointGraphCheck;
  error?: ApiError;
}

async function graphGetJsonWithCheck(
  token: string,
  endpoint: string,
  name: SharePointCheckName,
  context: string,
): Promise<GraphJsonResult> {
  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    const parsedError = parseGraphError(text);
    const error = graphApiError(res.status, text, context);
    return {
      check: {
        name,
        endpoint,
        ok: false,
        httpStatus: res.status,
        graphErrorCode: parsedError.code ?? null,
        graphErrorMessage: parsedError.message ?? null,
      },
      error,
    };
  }

  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  return {
    data,
    check: {
      name,
      endpoint,
      ok: true,
      httpStatus: res.status,
      graphErrorCode: null,
      graphErrorMessage: null,
    },
  };
}

async function graphGet(url: string, context = "read SharePoint data"): Promise<any> {
  const token = await getSharePointToken();
  const result = await graphGetJsonWithCheck(token, url, "children", context);
  if (result.error) throw result.error;
  return result.data;
}

async function graphGetBuffer(url: string, context = "download SharePoint file"): Promise<Buffer> {
  const token = await getSharePointToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw graphApiError(res.status, text, context);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function testConnection(
  siteId: string,
  driveId: string,
  folderItemId?: string,
  folderPath?: string,
): Promise<SharePointConnectionTestResult> {
  if (isConnectorMocked("ms-graph")) {
    return {
      ok: true,
      success: true,
      siteName: "Mock SharePoint Site",
      driveName: "Mock Documents Library",
      folderReachable: true,
      siteReachable: true,
      driveReachable: true,
      fileCount: 0,
      firstFiveTrackerFilenames: [],
      checks: [],
      diagnostics: buildDiagnostics(null, siteId, driveId, folderPath),
    };
  }
  const normalizedFolderPath = normalizeSharePointFolderPath(folderPath);
  const normalizedSiteId = siteId.trim();
  const normalizedDriveId = driveId.trim();
  if (!normalizedSiteId || !normalizedDriveId) {
    const result: SharePointConnectionTestResult = {
      ok: false,
      success: false,
      failureCategory: "malformed_config",
      message: "SharePoint Site ID and Drive ID are required.",
      nextAction: "Paste the verified SharePoint Site ID and Drive ID, then test again.",
      diagnostics: buildDiagnostics(null, normalizedSiteId, normalizedDriveId, normalizedFolderPath),
    };
    logConnectionDiagnostic(result);
    return result;
  }

  let token: string | null = null;
  try {
    token = await getSharePointToken();
  } catch (err: unknown) {
    const result: SharePointConnectionTestResult = {
      ok: false,
      success: false,
      failureCategory: "missing_token",
      message: err instanceof Error ? err.message : "SharePoint token is missing.",
      nextAction: "Reconnect the Microsoft SharePoint connector, or reconnect Microsoft sign-in with SharePoint file/site scopes.",
      diagnostics: buildDiagnostics(null, normalizedSiteId, normalizedDriveId, normalizedFolderPath),
    };
    logConnectionDiagnostic(result);
    return result;
  }

  const diagnostics = buildDiagnostics(token, normalizedSiteId, normalizedDriveId, normalizedFolderPath);
  if (diagnostics.token.expired) {
    const result: SharePointConnectionTestResult = {
      ok: false,
      success: false,
      failureCategory: "expired_token",
      message: "The SharePoint Graph token is expired.",
      nextAction: "Reconnect Microsoft sign-in or the SharePoint connector so the app receives a fresh token.",
      diagnostics,
      checks: [],
    };
    logConnectionDiagnostic(result);
    return result;
  }
  if (!diagnostics.token.hasRequiredSharePointAccess) {
    const result: SharePointConnectionTestResult = {
      ok: false,
      success: false,
      failureCategory: "missing_scope",
      message: "The Microsoft token is missing SharePoint Graph permission: Files.Read.All or Sites.Read.All.",
      nextAction: "In Microsoft Entra, grant/admin-consent Files.Read.All or Sites.Read.All for the Microsoft app/connector, then reconnect Microsoft.",
      diagnostics,
      checks: [],
    };
    logConnectionDiagnostic(result);
    return result;
  }

  const checks: SharePointGraphCheck[] = [];
  const siteEndpoint = `https://graph.microsoft.com/v1.0/sites/${normalizedSiteId}`;
  const siteResult = await graphGetJsonWithCheck(token, siteEndpoint, "site", "get SharePoint site");
  checks.push(siteResult.check);
  if (siteResult.error) {
    const result: SharePointConnectionTestResult = {
      ok: false,
      success: false,
      failureCategory: failureCategoryFromError(siteResult.error),
      message: siteResult.error.message,
      nextAction: siteResult.error.nextAction,
      siteReachable: false,
      driveReachable: false,
      folderReachable: false,
      checks,
      diagnostics,
    };
    logConnectionDiagnostic(result);
    return result;
  }

  const driveEndpoint = `https://graph.microsoft.com/v1.0/drives/${normalizedDriveId}`;
  const driveResult = await graphGetJsonWithCheck(token, driveEndpoint, "drive", "get SharePoint drive");
  checks.push(driveResult.check);
  if (driveResult.error) {
    const result: SharePointConnectionTestResult = {
      ok: false,
      success: false,
      failureCategory: failureCategoryFromError(driveResult.error),
      message: driveResult.error.message,
      nextAction: driveResult.error.nextAction,
      siteReachable: true,
      driveReachable: false,
      folderReachable: false,
      siteName: siteResult.data?.displayName,
      checks,
      diagnostics,
    };
    logConnectionDiagnostic(result);
    return result;
  }

  let folderEndpoint: string;
  let childrenEndpoint: string;
  if (normalizedFolderPath) {
    const encodedPath = encodeGraphDrivePath(normalizedFolderPath);
    folderEndpoint = `https://graph.microsoft.com/v1.0/drives/${normalizedDriveId}/root:/${encodedPath}`;
    childrenEndpoint = `https://graph.microsoft.com/v1.0/drives/${normalizedDriveId}/root:/${encodedPath}:/children`;
  } else if (folderItemId) {
    const itemId = folderItemId.trim();
    folderEndpoint = `https://graph.microsoft.com/v1.0/drives/${normalizedDriveId}/items/${itemId}`;
    childrenEndpoint = `https://graph.microsoft.com/v1.0/drives/${normalizedDriveId}/items/${itemId}/children`;
  } else {
    folderEndpoint = `https://graph.microsoft.com/v1.0/drives/${normalizedDriveId}/root`;
    childrenEndpoint = `https://graph.microsoft.com/v1.0/drives/${normalizedDriveId}/root/children`;
  }

  const folderResult = await graphGetJsonWithCheck(token, folderEndpoint, "folder", "get SharePoint folder");
  checks.push(folderResult.check);
  if (folderResult.error) {
    const result: SharePointConnectionTestResult = {
      ok: false,
      success: false,
      failureCategory: failureCategoryFromError(folderResult.error),
      message: folderResult.error.message,
      nextAction: folderResult.error.nextAction,
      siteReachable: true,
      driveReachable: true,
      folderReachable: false,
      siteName: siteResult.data?.displayName,
      driveName: driveResult.data?.name,
      checks,
      diagnostics,
    };
    logConnectionDiagnostic(result);
    return result;
  }

  const childrenResult = await graphGetJsonWithCheck(token, childrenEndpoint, "children", "list folder children");
  checks.push(childrenResult.check);
  if (childrenResult.error) {
    const result: SharePointConnectionTestResult = {
      ok: false,
      success: false,
      failureCategory: failureCategoryFromError(childrenResult.error),
      message: childrenResult.error.message,
      nextAction: childrenResult.error.nextAction,
      siteReachable: true,
      driveReachable: true,
      folderReachable: true,
      siteName: siteResult.data?.displayName,
      driveName: driveResult.data?.name,
      folderName: folderResult.data?.name,
      checks,
      diagnostics,
    };
    logConnectionDiagnostic(result);
    return result;
  }

  const trackerFiles = ((childrenResult.data?.value ?? []) as any[])
    .filter((item) => item?.file && isTrackerWorkbookName(item.name))
    .map((item) => String(item.name));
  const result: SharePointConnectionTestResult = {
    ok: true,
    success: true,
    siteName: siteResult.data?.displayName,
    driveName: driveResult.data?.name,
    folderName: folderResult.data?.name,
    siteReachable: true,
    driveReachable: true,
    folderReachable: true,
    fileCount: trackerFiles.length,
    firstFiveTrackerFilenames: trackerFiles.slice(0, 5),
    checks,
    diagnostics,
  };
  logConnectionDiagnostic(result);
  return result;
}

function isTrackerWorkbookName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const base = name.split(/[\\/]/).pop() ?? name;
  // Exclude Excel lock/temp files ("~$Foo.xlsx") and OneDrive/Dropbox
  // "conflicted copy" duplicates so an older/duplicate revision in the folder
  // can't be imported and double-count a project (IMPORTER_AUDIT M2).
  if (base.startsWith("~$")) return false;
  if (/conflicted copy/i.test(base)) return false;
  return /\.(xlsx|xlsm|xls)$/i.test(base);
}

export async function assertSharePointConnectionHealthyForEnable(
  siteId: string,
  driveId: string,
  folderItemId?: string | null,
  folderPath?: string | null,
): Promise<SharePointConnectionTestResult> {
  const result = await testConnection(siteId, driveId, folderItemId ?? undefined, folderPath ?? undefined);
  if (!result.ok) {
    throw new ApiError(
      409,
      result.failureCategory ?? "SHAREPOINT_HEALTH_CHECK_FAILED",
      result.message ?? "SharePoint Test Connection must pass before scheduled import can be enabled.",
      result.failureCategory ? { failureCategory: result.failureCategory } : undefined,
      result.nextAction ?? "Run Test Connection successfully, then enable scheduled import.",
    );
  }
  return result;
}

export async function listFolderChildren(
  driveId: string,
  folderItemId?: string,
  folderPath?: string
): Promise<any[]> {
  if (isConnectorMocked("ms-graph")) {
    // No mock tracker workbooks in the fixture set today — return an
    // empty list so the scheduler completes a clean tick without
    // attempting to hit Graph. Add a fixture file here if QA needs to
    // exercise the import flow end-to-end in dev.
    return [];
  }
  let url: string;
  if (folderItemId) {
    url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderItemId}/children?$filter=file ne null`;
  } else {
    const normalizedFolderPath = normalizeSharePointFolderPath(folderPath);
    if (normalizedFolderPath) {
      url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeGraphDrivePath(normalizedFolderPath)}:/children?$filter=file ne null`;
    } else {
      url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children?$filter=file ne null`;
    }
  }

  const result = await graphGet(url, "list folder children");
  return (result.value || []).filter((item: any) =>
    item.name?.endsWith('.xlsx') || item.name?.endsWith('.xlsm') || item.name?.endsWith('.xls')
  );
}

export async function browseFolders(
  driveId: string,
  folderId?: string
): Promise<{ id: string; name: string; path: string; childCount: number; isFolder: boolean }[]> {
  if (isConnectorMocked("ms-graph")) {
    return [
      { id: "mock-folder-trackers", name: "Active Trackers", path: "/Active Trackers", childCount: 0, isFolder: true },
      { id: "mock-folder-archive", name: "Archive", path: "/Archive", childCount: 0, isFolder: true },
    ];
  }
  let url: string;
  if (folderId) {
    url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children`;
  } else {
    url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
  }

  const result = await graphGet(url, "browse SharePoint folders");
  return (result.value || []).map((item: any) => ({
    id: item.id,
    name: item.name,
    path: item.parentReference?.path
      ? item.parentReference.path.replace(/\/drives\/[^/]+\/root:?/, "") + "/" + item.name
      : "/" + item.name,
    childCount: item.folder?.childCount ?? 0,
    isFolder: !!item.folder,
  }));
}

export async function downloadSingleFile(driveId: string, itemId: string): Promise<{ buffer: Buffer; fileName: string; etag: string; ctag: string }> {
  const meta = await getFileMetadata(driveId, itemId);
  const buffer = await downloadFileContent(driveId, itemId);
  return {
    buffer,
    fileName: meta.name,
    etag: meta.eTag || "",
    ctag: meta.cTag || "",
  };
}

export async function downloadFileContent(driveId: string, itemId: string): Promise<Buffer> {
  if (isConnectorMocked("ms-graph")) {
    // Defensive: callers only reach this after listFolderChildren returned
    // an item id, which in mock mode is empty (see above). Return an empty
    // buffer rather than throwing so an accidentally-wired call doesn't
    // surface as a hard failure in a dev session.
    return Buffer.alloc(0);
  }
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
  return graphGetBuffer(url, "download SharePoint file content");
}

export async function getFileMetadata(driveId: string, itemId: string): Promise<any> {
  if (isConnectorMocked("ms-graph")) {
    return {
      id: itemId,
      name: "mock-file.xlsx",
      eTag: "mock-etag",
      cTag: "mock-ctag",
      size: 0,
      lastModifiedDateTime: new Date().toISOString(),
    };
  }
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}`;
  return graphGet(url, "get SharePoint file metadata");
}

export async function detectChanges(
  siteId: string,
  driveId: string,
  folderItemId?: string,
  folderPath?: string,
  runId?: number
): Promise<{ created: number; modified: number; deleted: number; ledgerEntries: number }> {
  if (isConnectorMocked("ms-graph")) {
    return { created: 0, modified: 0, deleted: 0, ledgerEntries: 0 };
  }
  const children = await listFolderChildren(driveId, folderItemId, folderPath);

  let created = 0, modified = 0, deleted = 0, ledgerEntries = 0;
  const seenItemIds = new Set<string>();

  for (const item of children) {
    seenItemIds.add(item.id);
    const existing = await storage.getSpFileByItemId(siteId, driveId, item.id);

    const fileData: InsertSpFile = {
      siteId,
      driveId,
      itemId: item.id,
      path: item.parentReference?.path || null,
      fileName: item.name,
      lastSeenEtag: item.eTag || null,
      lastSeenCtag: item.cTag || null,
      spLastModifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
      spLastModifiedByName: item.lastModifiedBy?.user?.displayName || null,
      spLastModifiedByEmail: item.lastModifiedBy?.user?.email || null,
      isActive: true,
    };

    const spFile = await storage.upsertSpFile(fileData);

    if (!existing) {
      created++;
      if (runId) {
        const entry: InsertChangeLedger = {
          runId,
          fileId: spFile.id,
          eventType: 'created',
          oldEtag: null,
          newEtag: item.eTag || null,
          spModifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
          spModifiedByName: item.lastModifiedBy?.user?.displayName || null,
          spModifiedByEmail: item.lastModifiedBy?.user?.email || null,
          importStatus: 'pending',
          snapshotId: null,
          errorCode: null,
          errorMessage: null,
        };
        await storage.createChangeLedgerEntry(entry);
        ledgerEntries++;
      }
    } else if (existing.lastSeenEtag !== item.eTag || existing.lastSeenCtag !== item.cTag) {
      modified++;
      if (runId) {
        const entry: InsertChangeLedger = {
          runId,
          fileId: spFile.id,
          eventType: 'modified',
          oldEtag: existing.lastSeenEtag || null,
          newEtag: item.eTag || null,
          spModifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
          spModifiedByName: item.lastModifiedBy?.user?.displayName || null,
          spModifiedByEmail: item.lastModifiedBy?.user?.email || null,
          importStatus: 'pending',
          snapshotId: null,
          errorCode: null,
          errorMessage: null,
        };
        await storage.createChangeLedgerEntry(entry);
        ledgerEntries++;
      }
    }
  }

  const allFiles = await storage.getAllSpFiles();
  for (const file of allFiles) {
    if (file.siteId === siteId && file.driveId === driveId && file.isActive && !seenItemIds.has(file.itemId)) {
      deleted++;
      await storage.deactivateSpFile(file.id);
      if (runId) {
        const entry: InsertChangeLedger = {
          runId,
          fileId: file.id,
          eventType: 'deleted',
          oldEtag: file.lastSeenEtag || null,
          newEtag: null,
          spModifiedAt: new Date(),
          spModifiedByName: null,
          spModifiedByEmail: null,
          importStatus: 'skipped',
          snapshotId: null,
          errorCode: null,
          errorMessage: null,
        };
        await storage.createChangeLedgerEntry(entry);
        ledgerEntries++;
      }
    }
  }

  return { created, modified, deleted, ledgerEntries };
}

export function isSharePointConfigured(): boolean {
  // Configured when EITHER a tenant-owned app-only app reg is set (preferred)
  // OR the Replit connector is available.
  return hasMsGraphAppOnlyCreds() || !!process.env.REPLIT_CONNECTORS_HOSTNAME;
}
