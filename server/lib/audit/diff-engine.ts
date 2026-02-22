import { db } from "../../db";
import { changeSets, fieldChanges, type InsertChangeSet, type InsertFieldChange } from "@shared/schema";

export function normalizeValue(val: any): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export function computeFieldDiffs(
  oldRecord: Record<string, any>,
  newRecord: Record<string, any>,
  fieldsToTrack?: string[]
): Array<{ fieldName: string; oldValue: string | null; newValue: string | null; dataType: string }> {
  const diffs: Array<{ fieldName: string; oldValue: string | null; newValue: string | null; dataType: string }> = [];
  const fields = fieldsToTrack || Array.from(new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]));

  for (const field of fields) {
    if (field === "id" || field === "createdAt" || field === "updatedAt") continue;
    const oldVal = normalizeValue(oldRecord[field]);
    const newVal = normalizeValue(newRecord[field]);
    if (oldVal !== newVal) {
      diffs.push({
        fieldName: field,
        oldValue: oldVal,
        newValue: newVal,
        dataType: typeof newRecord[field] === "number" ? "number" : typeof newRecord[field] === "boolean" ? "boolean" : "text",
      });
    }
  }
  return diffs;
}

export async function createChangeSet(
  data: InsertChangeSet,
  fields?: Array<{ fieldName: string; oldValue: string | null; newValue: string | null; dataType?: string }>
): Promise<number> {
  const [cs] = await db.insert(changeSets).values(data).returning({ id: changeSets.id });

  if (fields && fields.length > 0) {
    const fieldRows: InsertFieldChange[] = fields.map(f => ({
      changeSetId: cs.id,
      fieldName: f.fieldName,
      oldValue: f.oldValue,
      newValue: f.newValue,
      dataType: f.dataType || "text",
    }));
    await db.insert(fieldChanges).values(fieldRows);
  }

  return cs.id;
}

export async function recordOverride(opts: {
  actorRole?: string;
  actorUserId?: number;
  entityType: string;
  entityId: string;
  projectName?: string;
  projectId?: number;
  action: string;
  summary?: string;
  overrideCategory: string;
  overrideComment: string;
  oldRecord: Record<string, any>;
  newRecord: Record<string, any>;
  fieldsToTrack?: string[];
}): Promise<number> {
  const diffs = computeFieldDiffs(opts.oldRecord, opts.newRecord, opts.fieldsToTrack);

  return createChangeSet({
    actorRole: opts.actorRole || null,
    actorUserId: opts.actorUserId || null,
    source: "OVERRIDE",
    entityType: opts.entityType,
    entityId: opts.entityId,
    projectId: opts.projectId || null,
    projectName: opts.projectName || null,
    action: opts.action,
    summary: opts.summary || `Override: ${diffs.length} field(s) changed`,
    overrideCategory: opts.overrideCategory,
    overrideComment: opts.overrideComment,
    correlationId: null,
    fileMetadata: null,
    importRunId: null,
    smartImportRunId: null,
  }, diffs);
}

export async function recordImportChange(opts: {
  actorRole?: string;
  actorUserId?: number;
  smartImportRunId?: number;
  importRunId?: number;
  entityType: string;
  entityId: string;
  projectName?: string;
  projectId?: number;
  action: string;
  summary?: string;
  fileMetadata?: any;
  fields?: Array<{ fieldName: string; oldValue: string | null; newValue: string | null; dataType?: string }>;
}): Promise<number> {
  return createChangeSet({
    actorRole: opts.actorRole || null,
    actorUserId: opts.actorUserId || null,
    source: "IMPORT",
    entityType: opts.entityType,
    entityId: opts.entityId,
    projectId: opts.projectId || null,
    projectName: opts.projectName || null,
    importRunId: opts.importRunId || null,
    smartImportRunId: opts.smartImportRunId || null,
    action: opts.action,
    summary: opts.summary || null,
    overrideCategory: null,
    overrideComment: null,
    correlationId: null,
    fileMetadata: opts.fileMetadata || null,
  }, opts.fields);
}

export async function recordManualEdit(opts: {
  actorRole?: string;
  actorUserId?: number;
  entityType: string;
  entityId: string;
  projectName?: string;
  projectId?: number;
  action: string;
  summary?: string;
  oldRecord: Record<string, any>;
  newRecord: Record<string, any>;
  fieldsToTrack?: string[];
}): Promise<number> {
  const diffs = computeFieldDiffs(opts.oldRecord, opts.newRecord, opts.fieldsToTrack);
  if (diffs.length === 0) return -1;

  return createChangeSet({
    actorRole: opts.actorRole || null,
    actorUserId: opts.actorUserId || null,
    source: "MANUAL_EDIT",
    entityType: opts.entityType,
    entityId: opts.entityId,
    projectId: opts.projectId || null,
    projectName: opts.projectName || null,
    action: opts.action,
    summary: opts.summary || `Manual edit: ${diffs.length} field(s) changed`,
    overrideCategory: null,
    overrideComment: null,
    correlationId: null,
    fileMetadata: null,
    importRunId: null,
    smartImportRunId: null,
  }, diffs);
}

export async function recordSystemEvent(opts: {
  source: "PATTERN_LEARNING" | "COUNTERPARTY_UPDATE" | "CONFLICT_RESOLUTION" | "SYSTEM";
  entityType: string;
  entityId: string;
  projectName?: string;
  projectId?: number;
  action: string;
  summary?: string;
  correlationId?: string;
  fields?: Array<{ fieldName: string; oldValue: string | null; newValue: string | null; dataType?: string }>;
}): Promise<number> {
  return createChangeSet({
    actorRole: null,
    actorUserId: null,
    source: opts.source,
    entityType: opts.entityType,
    entityId: opts.entityId,
    projectId: opts.projectId || null,
    projectName: opts.projectName || null,
    action: opts.action,
    summary: opts.summary || null,
    overrideCategory: null,
    overrideComment: null,
    correlationId: opts.correlationId || null,
    fileMetadata: null,
    importRunId: null,
    smartImportRunId: null,
  }, opts.fields);
}
