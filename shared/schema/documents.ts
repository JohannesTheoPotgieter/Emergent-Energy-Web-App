/**
 * Document control — controlled documents living in SharePoint with a
 * Drafts / Approved / History promotion workflow driven from the app.
 *
 * See docs/overhaul/00-inventory.md (document management thread) and the
 * locked approval matrix (CEO approves Costing, COO approves EPC, etc.).
 *
 * Metadata-only per CLAUDE.md §Microsoft 365 Integration: we never store
 * file bodies — `sharepointDriveId` + `sharepointItemId` are the Graph
 * API references used to read/move the actual file.
 *
 * Approval workflow reuses the existing `approvals` table (collaboration.ts)
 * with `approvalType='controlled_document'` and
 * `relatedEntityType='controlled_document'`, `relatedEntityId=controlledDocuments.id`.
 * A document can have multiple `approvals` rows when the type requires
 * more than one approver (e.g. financial close pack = CFO + COO).
 */

import { sql } from "drizzle-orm";
import {
  pgTable, text, integer, timestamp, pgEnum, serial, boolean, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";

// =====================================================================
// Enums
// =====================================================================

/** Controlled-document lifecycle state. */
export const controlledDocumentStateEnum = pgEnum("controlled_document_state_enum", [
  "draft",       // uploaded to Drafts folder, not yet submitted
  "submitted",   // submitted for approval, awaiting approver(s)
  "approved",    // latest approved — exactly one per (project, typeKey) at a time
  "rejected",    // approver rejected; file stays in Drafts with reject reason
  "superseded",  // previously approved; newer approved version exists
  "recalled",    // approver recalled (soft rule — approver can recall anytime)
]);

// =====================================================================
// Taxonomy — controlled_document_types
// =====================================================================

/**
 * Document types under version control (Costing Excel, Design Pack, etc.).
 * Seeded from the locked approval matrix. Super users can edit/add via
 * the Settings rewrite (D5).
 */
export const controlledDocumentTypes = pgTable("controlled_document_types", {
  id: serial("id").primaryKey(),
  /** Stable logical key, e.g. 'costing_excel'. Used in URLs + code. */
  typeKey: text("type_key").notNull().unique(),
  /** Human label, e.g. 'Costing Excel'. */
  displayName: text("display_name").notNull(),
  /** Optional description — shown in the submit dialog. */
  description: text("description"),
  /**
   * Relative path under the project's SharePoint root.
   * Example: 'BD/Cost Proposal/Costing' — the app appends /Drafts, /Approved, /History.
   */
  folderSubPath: text("folder_sub_path").notNull(),
  /**
   * Default approver role keys. Array of role codes from COMPANY_ROLES.
   * Example: ['CEO_ADMIN'] or ['CFO', 'COO_ADMIN'] for multi-approver types.
   * Submitter can override to a different approver at submit time, but the
   * override must still be a user who holds one of these roles (RBAC guard).
   */
  defaultApproverRoles: jsonb("default_approver_roles").$type<string[]>().notNull().default([]),
  /**
   * When true, ALL named approvers must approve independently before the
   * document is considered Approved. When false, ANY single listed approver
   * can approve (e.g. Costing — any CEO user can approve).
   * Default false.
   */
  requiresAllApprovers: boolean("requires_all_approvers").notNull().default(false),
  /**
   * Optional extraction spec (for Costing: which cells hold revenue/CoS).
   * Shape: { sheetName: string, cells: { revenue?: string, cos?: string, ... } }.
   * Null for types that don't need extraction.
   */
  extractSpec: jsonb("extract_spec").$type<{
    sheetName?: string;
    cells?: Record<string, string>;
  } | null>(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  typeKeyIdx: uniqueIndex("controlled_document_types_type_key_idx").on(t.typeKey),
}));

export const insertControlledDocumentTypeSchema = createInsertSchema(controlledDocumentTypes)
  .omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertControlledDocumentType = z.infer<typeof insertControlledDocumentTypeSchema>;
export type ControlledDocumentType = typeof controlledDocumentTypes.$inferSelect;

// =====================================================================
// Per-project tracked documents — controlled_documents
// =====================================================================

/**
 * One row per controlled file in SharePoint for a given project.
 *
 * Invariant: at most one row with state='approved' per (projectId, typeKey).
 * Enforced in the repository layer because SQLite dev fallback doesn't fully
 * support partial unique indexes with WHERE clauses.
 */
export const controlledDocuments = pgTable("controlled_documents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  /** FK to controlled_document_types.typeKey (logical key, not id, for readability). */
  typeKey: text("type_key").notNull().references(() => controlledDocumentTypes.typeKey),
  state: controlledDocumentStateEnum("state").notNull().default("draft"),

  // SharePoint references (Graph API). Never stores file bodies.
  sharepointDriveId: text("sharepoint_drive_id"),
  sharepointItemId: text("sharepoint_item_id"),
  /** Full path as shown to users (e.g. 'Projects/ABC/BD/Cost Proposal/Costing/Drafts/file.xlsx'). */
  sharepointPath: text("sharepoint_path").notNull(),
  fileName: text("file_name").notNull(),
  fileSizeBytes: integer("file_size_bytes"),

  /** Per (project, typeKey) version counter, incremented on each approved version. */
  versionNumber: integer("version_number").notNull().default(0),

  // Submit metadata
  submittedByUserId: integer("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at"),
  submitComment: text("submit_comment"),

  // Supersede chain — when a new version is approved, previous approved row
  // moves to state='superseded' and supersededByDocumentId points to the new row.
  supersededByDocumentId: integer("superseded_by_document_id"),

  // Recall metadata (approver can recall anytime per the soft-rule policy)
  recalledByUserId: integer("recalled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  recalledAt: timestamp("recalled_at"),
  recallReason: text("recall_reason"),

  /**
   * Values extracted from the file (e.g. Costing Excel headline numbers).
   * Shape depends on the type's extractSpec. Null when no extraction configured.
   * Example for Costing: { revenue: 1234567, cos: 987654, marginPct: 19.9 }.
   */
  extractedValues: jsonb("extracted_values"),
  extractedAt: timestamp("extracted_at"),
  extractedError: text("extracted_error"),

  // Soft-delete fields for super-user delete with audit
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: integer("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deleteReason: text("delete_reason"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  projectTypeIdx: index("controlled_documents_project_type_idx").on(t.projectId, t.typeKey),
  stateIdx: index("controlled_documents_state_idx").on(t.state),
  projectTypeStateIdx: index("controlled_documents_project_type_state_idx").on(t.projectId, t.typeKey, t.state),
}));

export const insertControlledDocumentSchema = createInsertSchema(controlledDocuments)
  .omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertControlledDocument = z.infer<typeof insertControlledDocumentSchema>;
export type ControlledDocument = typeof controlledDocuments.$inferSelect;

// =====================================================================
// Project SharePoint root — small extension to allow per-project root
// paths alongside the shared type taxonomy.
//
// Added as a separate table rather than modifying projectSettings so
// migrations stay strictly additive and the doc-control concerns stay
// co-located in this file.
// =====================================================================

export const projectSharepointRoots = pgTable("project_sharepoint_roots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().unique().references(() => projectInfo.id, { onDelete: "cascade" }),
  /** Graph drive id hosting the project folder. */
  driveId: text("drive_id"),
  /** Graph item id of the project root folder. */
  rootItemId: text("root_item_id"),
  /** Display path, e.g. 'Sites/EngineeringSupport/Projects/{ClientName}/{ProjectName}'. */
  rootPath: text("root_path").notNull(),
  configuredByUserId: integer("configured_by_user_id").references(() => users.id, { onDelete: "set null" }),
  configuredAt: timestamp("configured_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectSharepointRootSchema = createInsertSchema(projectSharepointRoots)
  .omit({ id: true, configuredAt: true, updatedAt: true } as any);
export type InsertProjectSharepointRoot = z.infer<typeof insertProjectSharepointRootSchema>;
export type ProjectSharepointRoot = typeof projectSharepointRoots.$inferSelect;

// =====================================================================
// Type-safe enums exported for runtime use
// =====================================================================

export const CONTROLLED_DOCUMENT_STATES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "superseded",
  "recalled",
] as const;
export type ControlledDocumentState = (typeof CONTROLLED_DOCUMENT_STATES)[number];

/** Approval-type discriminator used on approvals.relatedEntityType + approvalType. */
export const CONTROLLED_DOCUMENT_APPROVAL_TYPE = "controlled_document" as const;

// Required to placate drizzle's pgTable type inference when imported-only in other files
export const __controlledDocumentsSql = sql`${controlledDocuments.id}`;
