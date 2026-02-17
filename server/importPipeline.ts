import crypto from "crypto";
import { storage } from "./storage";
import { downloadFileContent, detectChanges, downloadSingleFile, getFileMetadata } from "./sharepoint";
import type { ChangeLedger, InsertSnapshot, InsertSnapshotMetric, InsertChangeLedger, InsertSpFile } from "@shared/schema";
import ExcelJS from "exceljs";

const PARSER_VERSION = "1.0";

function computeHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function computeSheetChecksum(rows: any[]): string {
  const content = JSON.stringify(rows);
  return crypto.createHash("md5").update(content).digest("hex");
}

function extractDates(rows: any[]): { min: string | null; max: string | null } {
  const datePattern = /^\d{4}-\d{2}-\d{2}/;
  let min: string | null = null;
  let max: string | null = null;

  for (const row of rows) {
    for (const val of Object.values(row)) {
      if (typeof val === "string" && datePattern.test(val)) {
        const d = val.substring(0, 10);
        if (!min || d < min) min = d;
        if (!max || d > max) max = d;
      }
      if (val instanceof Date && !isNaN(val.getTime())) {
        const d = val.toISOString().substring(0, 10);
        if (!min || d < min) min = d;
        if (!max || d > max) max = d;
      }
    }
  }

  return { min, max };
}

async function parseExcelSheets(buffer: Buffer): Promise<Map<string, any[]>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets = new Map<string, any[]>();

  for (const worksheet of workbook.worksheets) {
    const rows: any[] = [];
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];

    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber - 1] = cell.text?.toString() || `Col${colNumber}`;
    });

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const rowData: Record<string, any> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber - 1] || `Col${colNumber}`;
        if (cell.value instanceof Date) {
          rowData[header] = cell.value;
        } else {
          rowData[header] = cell.text?.toString() || cell.value;
        }
      });
      if (Object.values(rowData).some(v => v !== null && v !== undefined && v !== "")) {
        rows.push(rowData);
      }
    });

    if (rows.length > 0) {
      sheets.set(worksheet.name, rows);
    }
  }

  return sheets;
}

export async function processLedgerEntry(entry: ChangeLedger): Promise<void> {
  const file = await storage.getSpFile(entry.fileId);
  if (!file) {
    await storage.updateChangeLedgerEntry(entry.id, {
      importStatus: "failed",
      errorCode: "FILE_NOT_FOUND",
      errorMessage: "File record not found in sp_files",
    });
    return;
  }

  try {
    const buffer = await downloadFileContent(file.driveId, file.itemId);
    const contentHash = computeHash(buffer);

    const existingSnapshot = await storage.getLatestSnapshotForFile(file.id);
    if (existingSnapshot && existingSnapshot.contentHash === contentHash) {
      await storage.updateChangeLedgerEntry(entry.id, {
        importStatus: "skipped",
        errorMessage: "Content hash unchanged from last snapshot",
      });
      return;
    }

    const sheets = await parseExcelSheets(buffer);

    let totalRows = 0;
    const sheetEntries = Array.from(sheets.entries());
    for (const [, rows] of sheetEntries) {
      totalRows += rows.length;
    }

    const snapshotData: InsertSnapshot = {
      fileId: file.id,
      sourceEtag: entry.newEtag || file.lastSeenEtag,
      contentHash,
      rowCountTotal: totalRows,
      parserVersion: PARSER_VERSION,
      storageRef: null,
    };

    const snapshot = await storage.createSnapshot(snapshotData);

    const metrics: InsertSnapshotMetric[] = [];
    for (const [sheetName, rows] of sheetEntries) {
      const checksum = computeSheetChecksum(rows);
      const dates = extractDates(rows);

      let totals: Record<string, number> = {};
      for (const row of rows) {
        for (const [key, val] of Object.entries(row)) {
          const num = parseFloat(val as string);
          if (!isNaN(num) && typeof val !== "boolean") {
            totals[key] = (totals[key] || 0) + num;
          }
        }
      }

      metrics.push({
        snapshotId: snapshot.id,
        tableName: sheetName,
        rowCount: rows.length,
        checksum,
        minDate: dates.min,
        maxDate: dates.max,
        totalsJson: Object.keys(totals).length > 0 ? totals : null,
      });
    }

    if (metrics.length > 0) {
      await storage.createManySnapshotMetrics(metrics);
    }

    await storage.updateChangeLedgerEntry(entry.id, {
      importStatus: "imported",
      snapshotId: snapshot.id,
    });

  } catch (err: any) {
    await storage.updateChangeLedgerEntry(entry.id, {
      importStatus: "failed",
      errorCode: "IMPORT_ERROR",
      errorMessage: err.message?.substring(0, 500) || "Unknown error",
    });
  }
}

export async function runFullImport(
  triggerType: "manual" | "schedule",
  triggeredBy: string = "system"
): Promise<{ runId: number; summary: any }> {
  const settings = await storage.getSpSettings();
  if (!settings) {
    throw new Error("SharePoint settings not configured");
  }

  const run = await storage.createImportRun({
    triggerType,
    status: "running",
    triggeredBy,
    summaryJson: null,
  });

  try {
    const changes = await detectChanges(
      settings.siteId,
      settings.driveId,
      settings.folderItemId || undefined,
      settings.folderPath || undefined,
      run.id
    );

    const pending = await storage.getPendingLedgerEntries();
    const pendingForRun = pending.filter(e => e.runId === run.id);

    let imported = 0, failed = 0, skipped = 0;

    for (const entry of pendingForRun) {
      await processLedgerEntry(entry);
      const updated = await storage.getChangeLedgerEntry(entry.id);
      if (updated?.importStatus === "imported") imported++;
      else if (updated?.importStatus === "failed") failed++;
      else if (updated?.importStatus === "skipped") skipped++;
    }

    const summary = {
      ...changes,
      imported,
      failed,
      skipped,
      totalPending: pendingForRun.length,
    };

    const status = failed > 0 ? (imported > 0 ? "partial" : "fail") : "success";

    await storage.updateImportRun(run.id, {
      status: status as any,
      finishedAt: new Date(),
      summaryJson: summary,
    });

    await storage.upsertSpSettings({
      ...settings,
      lastRunAt: new Date(),
    });

    return { runId: run.id, summary };
  } catch (err: any) {
    await storage.updateImportRun(run.id, {
      status: "fail",
      finishedAt: new Date(),
      summaryJson: { error: err.message },
    });
    throw err;
  }
}

export async function retryFailedImports(triggeredBy: string = "system"): Promise<{ runId: number; summary: any }> {
  const failedEntries = await storage.getFailedLedgerEntries();
  if (failedEntries.length === 0) {
    throw new Error("No failed imports to retry");
  }

  const run = await storage.createImportRun({
    triggerType: "manual",
    status: "running",
    triggeredBy,
    summaryJson: null,
  });

  let imported = 0, failed = 0, skipped = 0;

  for (const entry of failedEntries) {
    await storage.updateChangeLedgerEntry(entry.id, {
      importStatus: "pending",
      errorCode: null,
      errorMessage: null,
      runId: run.id,
    });

    await processLedgerEntry(entry);
    const updated = await storage.getChangeLedgerEntry(entry.id);
    if (updated?.importStatus === "imported") imported++;
    else if (updated?.importStatus === "failed") failed++;
    else if (updated?.importStatus === "skipped") skipped++;
  }

  const summary = { retried: failedEntries.length, imported, failed, skipped };
  const status = failed > 0 ? (imported > 0 ? "partial" : "fail") : "success";

  await storage.updateImportRun(run.id, {
    status: status as any,
    finishedAt: new Date(),
    summaryJson: summary,
  });

  return { runId: run.id, summary };
}

export async function createSnapshotFromUpload(
  fileBuffer: Buffer,
  fileName: string,
  triggeredBy: string = "admin"
): Promise<{ snapshotId: number | null; status: string }> {
  try {
    const contentHash = computeHash(fileBuffer);
    const sheets = await parseExcelSheets(fileBuffer);

    let totalRows = 0;
    const sheetEntries = Array.from(sheets.entries());
    for (const [, rows] of sheetEntries) {
      totalRows += rows.length;
    }

    const snapshotData: InsertSnapshot = {
      fileId: 0,
      sourceEtag: null,
      contentHash,
      rowCountTotal: totalRows,
      parserVersion: PARSER_VERSION,
      storageRef: `upload:${fileName}`,
    };

    const snapshot = await storage.createSnapshot(snapshotData);

    const metrics: InsertSnapshotMetric[] = [];
    for (const [sheetName, rows] of sheetEntries) {
      const checksum = computeSheetChecksum(rows);
      const dates = extractDates(rows);

      let totals: Record<string, number> = {};
      for (const row of rows) {
        for (const [key, val] of Object.entries(row)) {
          const num = parseFloat(val as string);
          if (!isNaN(num) && typeof val !== "boolean") {
            totals[key] = (totals[key] || 0) + num;
          }
        }
      }

      metrics.push({
        snapshotId: snapshot.id,
        tableName: sheetName,
        rowCount: rows.length,
        checksum,
        minDate: dates.min,
        maxDate: dates.max,
        totalsJson: Object.keys(totals).length > 0 ? totals : null,
      });
    }

    if (metrics.length > 0) {
      await storage.createManySnapshotMetrics(metrics);
    }

    return { snapshotId: snapshot.id, status: "created" };
  } catch (err: any) {
    console.error("[Snapshot] Failed to create snapshot from upload:", err.message);
    return { snapshotId: null, status: "failed" };
  }
}

export async function importSingleFile(
  driveId: string,
  siteId: string,
  itemId: string,
  triggeredBy: string = "admin"
): Promise<{ runId: number; summary: any }> {
  const meta = await getFileMetadata(driveId, itemId);
  const fileName = meta.name;

  const existing = await storage.getSpFileByItemId(siteId, driveId, itemId);
  const oldEtag = existing?.lastSeenEtag || null;
  const eventType = existing ? "modified" : "created";

  const run = await storage.createImportRun({
    triggerType: "manual",
    status: "running",
    triggeredBy,
    summaryJson: null,
  });

  const fileData: InsertSpFile = {
    siteId,
    driveId,
    itemId,
    path: meta.parentReference?.path || null,
    fileName,
    lastSeenEtag: meta.eTag || null,
    lastSeenCtag: meta.cTag || null,
    spLastModifiedAt: meta.lastModifiedDateTime ? new Date(meta.lastModifiedDateTime) : null,
    spLastModifiedByName: meta.lastModifiedBy?.user?.displayName || null,
    spLastModifiedByEmail: meta.lastModifiedBy?.user?.email || null,
    isActive: true,
  };
  const spFile = await storage.upsertSpFile(fileData);

  const ledgerEntry: InsertChangeLedger = {
    runId: run.id,
    fileId: spFile.id,
    eventType,
    oldEtag,
    newEtag: meta.eTag || null,
    spModifiedAt: meta.lastModifiedDateTime ? new Date(meta.lastModifiedDateTime) : null,
    spModifiedByName: meta.lastModifiedBy?.user?.displayName || null,
    spModifiedByEmail: meta.lastModifiedBy?.user?.email || null,
    importStatus: "pending",
    snapshotId: null,
    errorCode: null,
    errorMessage: null,
  };
  const entry = await storage.createChangeLedgerEntry(ledgerEntry);

  await processLedgerEntry(entry);
  const updated = await storage.getChangeLedgerEntry(entry.id);

  const summary = {
    fileName,
    importStatus: updated?.importStatus || "unknown",
    snapshotId: updated?.snapshotId || null,
  };

  const status = updated?.importStatus === "imported" ? "success" : updated?.importStatus === "failed" ? "fail" : "success";
  await storage.updateImportRun(run.id, {
    status: status as any,
    finishedAt: new Date(),
    summaryJson: summary,
  });

  return { runId: run.id, summary };
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

export function startScheduler(): void {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(async () => {
    if (isRunning) return;

    try {
      const settings = await storage.getSpSettings();
      if (!settings || !settings.enabled) return;

      const interval = settings.intervalMinutes * 60 * 1000;
      const lastRun = settings.lastRunAt ? new Date(settings.lastRunAt).getTime() : 0;
      if (Date.now() - lastRun < interval) return;

      isRunning = true;
      console.log("[SharePoint] Scheduled import starting...");
      const result = await runFullImport("schedule", "system");
      console.log("[SharePoint] Scheduled import complete:", JSON.stringify(result.summary));
    } catch (err: any) {
      console.error("[SharePoint] Scheduled import error:", err.message);
    } finally {
      isRunning = false;
    }
  }, 60 * 1000);
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
