/**
 * SharePoint document service.
 *
 * Wraps every Graph call the /documents browser makes. Reads use the
 * app-only Replit-Outlook-connector token (existing pattern). Writes
 * MUST use the calling user's delegated SSO token so SharePoint's own
 * permission model is respected — `requireDelegatedToken` throws a
 * 412 ApiError when a write is attempted by a user who hasn't completed
 * MS SSO.
 *
 * Mock mode: when `isConnectorMocked("ms-graph")` is true, all calls
 * route through ms-graph-fixtures. The mock stores mutate so the UI
 * feels alive on a fresh clone.
 */

import { isConnectorMocked } from "../lib/connector-mode";
import { getSharePointToken } from "../sharepoint-token";
import { getSsoTokenForUser } from "../ms-account-service";
import { ApiError, badRequest, conflict, notFound } from "../lib/api-error";
import {
  mockListChildren,
  mockGetItem,
  mockDownloadBuffer,
  mockListVersions,
  mockUploadSmall,
  mockCreateFolder,
  mockRenameItem,
  mockCheckout,
  mockCheckin,
  mockDiscardCheckout,
  mockRestoreVersion,
} from "../mocks/ms-graph-fixtures";

// ------------------------------------------------------------------
// Shared types
// ------------------------------------------------------------------

export interface GraphItem {
  id: string;
  name: string;
  path: string; // full path under the drive
  isFolder: boolean;
  size?: number;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { displayName?: string; email?: string };
  webUrl?: string;
  eTag?: string;
  /** Graph's checkedOutBy user info if this file is checked out in SP. */
  checkedOutBy?: { displayName?: string; email?: string } | null;
}

export interface GraphVersion {
  id: string;
  sizeBytes?: number;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { displayName?: string; email?: string };
}

// ------------------------------------------------------------------
// Token helpers
// ------------------------------------------------------------------

async function appOnlyToken(): Promise<string> {
  return getSharePointToken();
}

async function requireDelegatedToken(userId: number): Promise<string> {
  const token = await getSsoTokenForUser(userId);
  if (!token) {
    throw new ApiError(
      412,
      "DELEGATED_TOKEN_REQUIRED",
      "Microsoft sign-in required to make this change.",
      undefined,
      "Sign in with your Microsoft account from the top-right menu and retry.",
    );
  }
  return token;
}

// ------------------------------------------------------------------
// Graph error mapping
// ------------------------------------------------------------------

async function graphFetch(
  url: string,
  init: RequestInit,
  context: string,
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.ok) return res;

  // Never leak the Graph response body to the caller.
  if (res.status === 401) {
    throw new ApiError(
      401,
      "SHAREPOINT_TOKEN_UNAUTHORIZED",
      `Microsoft rejected the SharePoint token for ${context}.`,
      undefined,
      "Reconnect Microsoft sign-in or the Microsoft connector, then retry.",
    );
  }
  if (res.status === 403) {
    throw new ApiError(
      403,
      "SHAREPOINT_ACCESS_DENIED",
      `SharePoint denied access to ${context}.`,
      undefined,
      "Grant the connected Microsoft account and signed-in user access to the SharePoint site/library, and ensure Graph Sites/Files permissions have admin consent.",
    );
  }
  if (res.status === 404) {
    throw notFound("SharePoint item");
  }
  if (res.status === 409) {
    throw conflict(`A SharePoint conflict blocked the ${context} request.`);
  }
  if (res.status === 413) {
    throw badRequest("File is too large for direct upload — use chunked upload.");
  }
  if (res.status === 423) {
    throw new ApiError(
      423,
      "LOCKED",
      "This file is checked out in SharePoint.",
    );
  }
  if (res.status === 429) {
    const retry = res.headers.get("Retry-After") ?? "";
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "SharePoint is rate-limiting us.",
      retry ? { retryAfter: retry } : undefined,
    );
  }
  throw new ApiError(502, "GRAPH_ERROR", "SharePoint is unavailable right now.");
}

async function graphGetJson<T>(url: string, token: string, context: string): Promise<T> {
  const res = await graphFetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }, context);
  return (await res.json()) as T;
}

// ------------------------------------------------------------------
// Path helpers
// ------------------------------------------------------------------

function pathFromParentRef(parent: { path?: string } | undefined, name: string): string {
  // Graph returns parentReference.path as "/drives/{driveId}/root:/Engineering"
  // Strip the drive prefix; present the tail to users.
  const raw = parent?.path ?? "";
  const afterRoot = raw.includes("root:") ? raw.split("root:")[1] ?? "" : raw;
  const cleaned = afterRoot.replace(/^\/+/, "");
  return cleaned ? `${cleaned}/${name}` : name;
}

function mapGraphItem(item: any): GraphItem {
  return {
    id: String(item.id),
    name: String(item.name ?? ""),
    path: pathFromParentRef(item.parentReference, String(item.name ?? "")),
    isFolder: !!item.folder,
    size: typeof item.size === "number" ? item.size : undefined,
    lastModifiedDateTime: item.lastModifiedDateTime,
    lastModifiedBy: item.lastModifiedBy?.user
      ? {
          displayName: item.lastModifiedBy.user.displayName,
          email: item.lastModifiedBy.user.email,
        }
      : undefined,
    webUrl: item.webUrl,
    eTag: item.eTag,
    checkedOutBy: item.publication?.checkedOutBy?.user
      ? {
          displayName: item.publication.checkedOutBy.user.displayName,
          email: item.publication.checkedOutBy.user.email,
        }
      : null,
  };
}

// ------------------------------------------------------------------
// Read operations
// ------------------------------------------------------------------

export async function listChildren(
  driveId: string,
  parentItemId: string | null,
): Promise<GraphItem[]> {
  if (isConnectorMocked("ms-graph")) {
    return mockListChildren(driveId, parentItemId);
  }
  const token = await appOnlyToken();
  const url = parentItemId
    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentItemId}/children`
    : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
  const data = await graphGetJson<{ value?: any[] }>(url, token, "listChildren");
  return (data.value ?? []).map(mapGraphItem);
}

export async function getItem(
  driveId: string,
  itemId: string,
): Promise<GraphItem | null> {
  if (isConnectorMocked("ms-graph")) {
    return mockGetItem(driveId, itemId);
  }
  const token = await appOnlyToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}`;
  try {
    const data = await graphGetJson<any>(url, token, "getItem");
    return mapGraphItem(data);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) return null;
    throw err;
  }
}

export async function downloadBuffer(
  driveId: string,
  itemId: string,
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  if (isConnectorMocked("ms-graph")) {
    return mockDownloadBuffer(driveId, itemId);
  }
  const token = await appOnlyToken();
  const meta = await getItem(driveId, itemId);
  if (!meta) throw notFound("SharePoint item");
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
  const res = await graphFetch(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    "download",
  );
  const arrayBuf = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuf),
    fileName: meta.name,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function listVersions(
  driveId: string,
  itemId: string,
): Promise<GraphVersion[]> {
  if (isConnectorMocked("ms-graph")) {
    return mockListVersions(driveId, itemId);
  }
  const token = await appOnlyToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/versions`;
  const data = await graphGetJson<{ value?: any[] }>(url, token, "listVersions");
  return (data.value ?? []).map((v: any) => ({
    id: String(v.id),
    sizeBytes: typeof v.size === "number" ? v.size : undefined,
    lastModifiedDateTime: v.lastModifiedDateTime,
    lastModifiedBy: v.lastModifiedBy?.user
      ? {
          displayName: v.lastModifiedBy.user.displayName,
          email: v.lastModifiedBy.user.email,
        }
      : undefined,
  }));
}

// ------------------------------------------------------------------
// Write operations (delegated token required)
// ------------------------------------------------------------------

export interface SmallUploadInput {
  driveId: string;
  parentItemId: string | null;
  fileName: string;
  body: Buffer;
  userId: number;
}

/**
 * Simple PUT upload. Enforces a 4 MiB limit — callers above that size
 * should use `createUploadSession` (Phase 2 work; stubbed via 501 for now
 * since callers just pipe bytes straight to the returned uploadUrl).
 */
export async function simpleUpload(input: SmallUploadInput): Promise<GraphItem> {
  if (input.body.length > 4 * 1024 * 1024) {
    throw badRequest("File exceeds the 4 MiB simple-upload limit. Use a chunked upload session.");
  }
  if (isConnectorMocked("ms-graph")) {
    return mockUploadSmall(input);
  }
  const token = await requireDelegatedToken(input.userId);
  const encodedName = encodeURIComponent(input.fileName);
  const url = input.parentItemId
    ? `https://graph.microsoft.com/v1.0/drives/${input.driveId}/items/${input.parentItemId}:/${encodedName}:/content`
    : `https://graph.microsoft.com/v1.0/drives/${input.driveId}/root:/${encodedName}:/content`;
  const res = await graphFetch(
    url,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: input.body as unknown as BodyInit,
    },
    "upload",
  );
  const data = await res.json();
  return mapGraphItem(data);
}

export interface CreateFolderInput {
  driveId: string;
  parentItemId: string | null;
  name: string;
  userId: number;
}

export async function createFolder(input: CreateFolderInput): Promise<GraphItem> {
  if (isConnectorMocked("ms-graph")) {
    return mockCreateFolder(input);
  }
  const token = await requireDelegatedToken(input.userId);
  const url = input.parentItemId
    ? `https://graph.microsoft.com/v1.0/drives/${input.driveId}/items/${input.parentItemId}/children`
    : `https://graph.microsoft.com/v1.0/drives/${input.driveId}/root/children`;
  const res = await graphFetch(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    },
    "createFolder",
  );
  const data = await res.json();
  return mapGraphItem(data);
}

export interface RenameInput {
  driveId: string;
  itemId: string;
  newName: string;
  userId: number;
}

export async function renameItem(input: RenameInput): Promise<GraphItem> {
  if (isConnectorMocked("ms-graph")) {
    return mockRenameItem(input);
  }
  const token = await requireDelegatedToken(input.userId);
  const url = `https://graph.microsoft.com/v1.0/drives/${input.driveId}/items/${input.itemId}`;
  const res = await graphFetch(
    url,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: input.newName }),
    },
    "rename",
  );
  const data = await res.json();
  return mapGraphItem(data);
}

/**
 * Move + delete are intentionally NOT implemented in this build. Route
 * handlers should not call these — see the rollout plan phase 4.
 */
export async function moveItem(_input: {
  driveId: string;
  itemId: string;
  targetParentItemId: string;
  userId: number;
}): Promise<GraphItem> {
  throw new ApiError(
    501,
    "NOT_IMPLEMENTED",
    "Moving files is not enabled in this build.",
  );
}

export async function deleteItem(_input: {
  driveId: string;
  itemId: string;
  userId: number;
}): Promise<void> {
  throw new ApiError(
    501,
    "NOT_IMPLEMENTED",
    "Deleting files is not enabled in this build.",
  );
}

// ------------------------------------------------------------------
// Check-in / check-out
// ------------------------------------------------------------------

export async function checkout(driveId: string, itemId: string, userId: number): Promise<void> {
  if (isConnectorMocked("ms-graph")) {
    return mockCheckout(driveId, itemId);
  }
  const token = await requireDelegatedToken(userId);
  await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/checkout`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    "checkout",
  );
}

export async function checkin(
  driveId: string,
  itemId: string,
  userId: number,
  comment?: string,
): Promise<void> {
  if (isConnectorMocked("ms-graph")) {
    return mockCheckin(driveId, itemId, comment);
  }
  const token = await requireDelegatedToken(userId);
  await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/checkin`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment: comment ?? "" }),
    },
    "checkin",
  );
}

export async function discardCheckout(
  driveId: string,
  itemId: string,
  userId: number,
): Promise<void> {
  if (isConnectorMocked("ms-graph")) {
    return mockDiscardCheckout(driveId, itemId);
  }
  const token = await requireDelegatedToken(userId);
  await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/discardCheckout`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    "discardCheckout",
  );
}

export async function restoreVersion(
  driveId: string,
  itemId: string,
  versionId: string,
  userId: number,
): Promise<void> {
  if (isConnectorMocked("ms-graph")) {
    return mockRestoreVersion(driveId, itemId, versionId);
  }
  const token = await requireDelegatedToken(userId);
  await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/versions/${versionId}/restoreVersion`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    "restoreVersion",
  );
}
