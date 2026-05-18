import { storage } from "./storage";
import type { SpFile, InsertSpFile, InsertChangeLedger, InsertImportRun } from "@shared/schema";
import { getSharePointToken } from "./sharepoint-token";
import { ApiError } from "./lib/api-error";

/** @deprecated Use getSharePointToken() from sharepoint-token.ts directly. Re-exported for backward compatibility. */
export const getAccessToken = getSharePointToken;

export function normalizeSharePointFolderPath(folderPath?: string | null): string | undefined {
  const normalized = (folderPath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/{2,}/g, "/");
  return normalized || undefined;
}

function graphErrorDetails(text: string): Record<string, string> | undefined {
  try {
    const parsed = JSON.parse(text);
    const graphError = parsed?.error ?? parsed;
    const inner = graphError?.innerError ?? graphError?.innererror ?? {};
    const details: Record<string, string> = {};
    if (typeof graphError?.code === "string") details.graphCode = graphError.code;
    if (typeof inner?.["request-id"] === "string") details.requestId = inner["request-id"];
    if (typeof inner?.["client-request-id"] === "string") details.clientRequestId = inner["client-request-id"];
    if (typeof inner?.date === "string") details.date = inner.date;
    return Object.keys(details).length > 0 ? details : undefined;
  } catch {
    return undefined;
  }
}

function graphApiError(status: number, text: string, context: string): ApiError {
  const details = graphErrorDetails(text);
  if (status === 401) {
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

async function graphGet(url: string, context = "read SharePoint data"): Promise<any> {
  const token = await getSharePointToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw graphApiError(res.status, text, context);
  }
  return res.json();
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
): Promise<{ ok: boolean; success: boolean; siteName?: string; driveName?: string; message?: string; nextAction?: string }> {
  try {
    const site = await graphGet(`https://graph.microsoft.com/v1.0/sites/${siteId}`, "get SharePoint site");
    const drive = await graphGet(`https://graph.microsoft.com/v1.0/drives/${driveId}`, "get SharePoint drive");
    if (folderItemId || normalizeSharePointFolderPath(folderPath)) {
      await listFolderChildren(driveId, folderItemId, folderPath);
    }
    return { ok: true, success: true, siteName: site.displayName, driveName: drive.name };
  } catch (err: unknown) {
    return {
      ok: false,
      success: false,
      message: (err instanceof Error ? err.message : String(err)),
      nextAction: err instanceof ApiError ? err.nextAction : undefined,
    };
  }
}

export async function listFolderChildren(
  driveId: string,
  folderItemId?: string,
  folderPath?: string
): Promise<any[]> {
  let url: string;
  if (folderItemId) {
    url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderItemId}/children?$filter=file ne null`;
  } else {
    const normalizedFolderPath = normalizeSharePointFolderPath(folderPath);
    if (normalizedFolderPath) {
      url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${normalizedFolderPath}:/children?$filter=file ne null`;
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
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
  return graphGetBuffer(url, "download SharePoint file content");
}

export async function getFileMetadata(driveId: string, itemId: string): Promise<any> {
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
  return !!process.env.REPLIT_CONNECTORS_HOSTNAME;
}
