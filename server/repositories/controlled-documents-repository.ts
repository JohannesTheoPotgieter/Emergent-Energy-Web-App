/**
 * Controlled documents repository (D3.2).
 *
 * Read-path first. Mutations (submit, approve, reject, recall) land in
 * D3.3 — they reuse the existing public.approvals table via
 * approvalType='controlled_document', so this repository only holds the
 * reads plus a small summarisation helper.
 *
 * Conventions (CLAUDE.md):
 * - All DB access for controlled-documents endpoints goes through this
 *   repo — no direct db.select() / db.insert() in routes.
 * - No raw SQL unless guarded with parameterised sql`` template.
 * - No pg-specific cast syntax (::) — keep SQLite dev fallback alive.
 */

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  controlledDocuments,
  controlledDocumentTypes,
  projectSharepointRoots,
  type ControlledDocument,
  type ControlledDocumentType,
  type ControlledDocumentState,
  type ProjectSharepointRoot,
} from "@shared/schema/documents";

// ---- Shapes returned to route handlers -----------------------------------

/** One row in the per-project "documents summary" view. */
export interface ProjectDocumentSummary {
  type: ControlledDocumentType;
  /** Latest approved row, or null if never approved yet. */
  approved: ControlledDocument | null;
  /** Number of drafts + submitted rows awaiting action. */
  pendingCount: number;
  /** Number of historical approved rows (superseded). */
  historyCount: number;
}

/** Full per-type detail for drill-in. */
export interface ProjectDocumentDetail {
  type: ControlledDocumentType;
  approved: ControlledDocument | null;
  /** Draft rows — user has uploaded but not yet submitted. */
  drafts: ControlledDocument[];
  /** Submitted rows — awaiting approver action. */
  submitted: ControlledDocument[];
  /** Rejected rows — still in Drafts folder with a rejection reason. */
  rejected: ControlledDocument[];
  /** Superseded + recalled rows ordered newest first. */
  history: ControlledDocument[];
}

// ---- Types catalogue -----------------------------------------------------

export async function listActiveDocumentTypes(): Promise<ControlledDocumentType[]> {
  return db
    .select()
    .from(controlledDocumentTypes)
    .where(eq(controlledDocumentTypes.active, true))
    .orderBy(asc(controlledDocumentTypes.sortOrder), asc(controlledDocumentTypes.displayName));
}

export async function getDocumentType(typeKey: string): Promise<ControlledDocumentType | null> {
  const rows = await db
    .select()
    .from(controlledDocumentTypes)
    .where(eq(controlledDocumentTypes.typeKey, typeKey))
    .limit(1);
  return rows[0] ?? null;
}

// ---- Per-project reads ---------------------------------------------------

/**
 * Returns a grouped-by-type summary for the given project. The front end
 * uses this to render the Documents strip on project cards and on the
 * CEO / COO home screens.
 *
 * Excludes soft-deleted rows (deletedAt IS NULL) everywhere.
 */
export async function getProjectDocumentSummary(projectId: number): Promise<ProjectDocumentSummary[]> {
  const types = await listActiveDocumentTypes();

  // Pull all non-deleted document rows for this project in a single query.
  const rows = await db
    .select()
    .from(controlledDocuments)
    .where(and(
      eq(controlledDocuments.projectId, projectId),
      isNull(controlledDocuments.deletedAt),
    ));

  // Group rows in memory — list is small (~13 types * a few per type).
  const byType = new Map<string, ControlledDocument[]>();
  for (const row of rows) {
    const list = byType.get(row.typeKey) ?? [];
    list.push(row);
    byType.set(row.typeKey, list);
  }

  return types.map((type) => {
    const list = byType.get(type.typeKey) ?? [];
    const approved = list.find((r) => r.state === "approved") ?? null;
    const pendingCount = list.filter((r) => r.state === "draft" || r.state === "submitted").length;
    const historyCount = list.filter((r) => r.state === "superseded" || r.state === "recalled").length;
    return { type, approved, pendingCount, historyCount };
  });
}

/**
 * Full per-type detail for drill-in. Returns {} shapes with empty arrays
 * rather than nulls for the list fields, so callers can map without null
 * checks on each list.
 */
export async function getProjectDocumentDetail(
  projectId: number,
  typeKey: string,
): Promise<ProjectDocumentDetail | null> {
  const type = await getDocumentType(typeKey);
  if (!type) return null;

  const rows: ControlledDocument[] = await db
    .select()
    .from(controlledDocuments)
    .where(and(
      eq(controlledDocuments.projectId, projectId),
      eq(controlledDocuments.typeKey, typeKey),
      isNull(controlledDocuments.deletedAt),
    ))
    .orderBy(desc(controlledDocuments.updatedAt));

  const approved = rows.find((r) => r.state === "approved") ?? null;
  const drafts = rows.filter((r) => r.state === "draft");
  const submitted = rows.filter((r) => r.state === "submitted");
  const rejected = rows.filter((r) => r.state === "rejected");
  const history = rows.filter((r) => r.state === "superseded" || r.state === "recalled");

  return { type, approved, drafts, submitted, rejected, history };
}

/** Used by the CEO home to auto-extract Costing headline numbers. */
export async function getApprovedDocument(
  projectId: number,
  typeKey: string,
): Promise<ControlledDocument | null> {
  const rows = await db
    .select()
    .from(controlledDocuments)
    .where(and(
      eq(controlledDocuments.projectId, projectId),
      eq(controlledDocuments.typeKey, typeKey),
      eq(controlledDocuments.state, "approved" as ControlledDocumentState),
      isNull(controlledDocuments.deletedAt),
    ))
    .limit(1);
  return rows[0] ?? null;
}

// ---- SharePoint root config ---------------------------------------------

export async function getProjectSharepointRoot(projectId: number): Promise<ProjectSharepointRoot | null> {
  const rows = await db
    .select()
    .from(projectSharepointRoots)
    .where(eq(projectSharepointRoots.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Assert that the project has a configured SharePoint root before any
 * mutation that would need to touch real folders. Returns the root for
 * convenience; throws a semantic error the route can convert to 409.
 */
export async function requireProjectSharepointRoot(projectId: number): Promise<ProjectSharepointRoot> {
  const root = await getProjectSharepointRoot(projectId);
  if (!root) {
    throw new Error(
      `Project ${projectId} has no SharePoint root configured. ` +
      `A super user must set one in Settings before documents can be tracked.`,
    );
  }
  return root;
}

// ---- Counters for home screens ------------------------------------------

/** Total pending submissions awaiting ANY approver — used on the COO home tile. */
export async function countPendingSubmissionsAcrossPortfolio(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(controlledDocuments)
    .where(and(
      eq(controlledDocuments.state, "submitted" as ControlledDocumentState),
      isNull(controlledDocuments.deletedAt),
    ));
  return Number(result[0]?.count ?? 0);
}
