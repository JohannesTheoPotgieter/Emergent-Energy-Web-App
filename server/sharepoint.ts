import { storage } from "./storage";
import type { SpFile, InsertSpFile, InsertChangeLedger, InsertImportRun } from "@shared/schema";

async function getAccessToken(): Promise<string> {
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
        X_REPLIT_TOKEN: xReplitToken,
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

  return accessToken;
}

async function graphGet(url: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API ${res.status}: ${text}`);
  }
  return res.json();
}

async function graphGetBuffer(url: string): Promise<Buffer> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API download ${res.status}: ${text}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function testConnection(siteId: string, driveId: string): Promise<{ ok: boolean; success: boolean; siteName?: string; driveName?: string; error?: string }> {
  try {
    const site = await graphGet(`https://graph.microsoft.com/v1.0/sites/${siteId}`);
    const drive = await graphGet(`https://graph.microsoft.com/v1.0/drives/${driveId}`);
    return { ok: true, success: true, siteName: site.displayName, driveName: drive.name };
  } catch (err: any) {
    return { ok: false, success: false, error: err.message };
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
  } else if (folderPath) {
    url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${folderPath}:/children?$filter=file ne null`;
  } else {
    url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children?$filter=file ne null`;
  }

  const result = await graphGet(url);
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

  const result = await graphGet(url);
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
  return graphGetBuffer(url);
}

export async function getFileMetadata(driveId: string, itemId: string): Promise<any> {
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}`;
  return graphGet(url);
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
