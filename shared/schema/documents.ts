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
 * @deprecated Replaced by `documentApprovalRequirements` (D6) under the
 * Active Clients taxonomy. New code MUST NOT read or write this table.
 * Kept in the schema for additive-migration safety; it carries no
 * production data (D6 was rebuilt before any controlled docs were filed).
 * Will be dropped in a follow-up destructive migration once D6 ships.
 *
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
 * @deprecated Replaced by `managedDocuments` + the existing `approvals`
 * engine (relatedEntityType='managed_document') under the Active Clients
 * taxonomy (D6). New code MUST NOT read or write this table. Kept in the
 * schema for additive-migration safety; it carries no production data.
 * Will be dropped in a follow-up destructive migration once D6 ships.
 *
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

/**
 * @deprecated Subsumed by `projectFolders` (D6). The project root is now
 * the row in `projectFolders` whose `taxonomyKey` is the project-root
 * taxonomy entry. New code MUST NOT read or write this table. Kept in the
 * schema for additive-migration safety; carries no production data. Will
 * be dropped in a follow-up destructive migration once D6 ships.
 */
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

// =====================================================================
// Document Management (DM) — generic SharePoint browsing + versioning +
// comments + activity. Independent from Controlled Documents above.
//
// Source of truth for file bytes + native versions: SharePoint via Graph.
// Source of truth for DM workflow state (tracked docs, revisions metadata,
// comments, locks, activity): this DB.
//
// Approvals are NOT modelled here — when wired up later we reuse the
// existing `approvals` engine via relatedEntityType='managed_document'.
// =====================================================================

/** Where a managed document lives: per-project tree or a company-wide root. */
export const documentRootScopeEnum = pgEnum("document_root_scope_enum", [
  "project",
  "company",
]);

/** Audit actions recorded against document_activity. No move/delete in this build. */
export const documentActivityActionEnum = pgEnum("document_activity_action_enum", [
  "upload",
  "download",
  "rename",
  "create_folder",
  "view",
  "checkout",
  "checkin",
  "discard_checkout",
  "restore_revision",
  "comment",
]);

/** Managed document lifecycle state (minus approvals). */
export const managedDocumentStateEnum = pgEnum("managed_document_state_enum", [
  "draft",
  "in_review",
  "approved",
  "superseded",
  "archived",
]);

// =====================================================================
// Company-wide SharePoint roots — e.g. HR, Templates, Policies.
// Project roots already exist via projectSharepointRoots above.
// =====================================================================

export const companySharepointRoots = pgTable("company_sharepoint_roots", {
  id: serial("id").primaryKey(),
  /** Stable logical key used in URLs + config, e.g. 'hr' | 'templates'. */
  kind: text("kind").notNull().unique(),
  displayName: text("display_name").notNull(),
  driveId: text("drive_id"),
  rootItemId: text("root_item_id"),
  rootPath: text("root_path").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySharepointRootSchema = createInsertSchema(companySharepointRoots)
  .omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertCompanySharepointRoot = z.infer<typeof insertCompanySharepointRootSchema>;
export type CompanySharepointRoot = typeof companySharepointRoots.$inferSelect;

// =====================================================================
// managed_documents — one row per SharePoint file we're tracking for
// versioning / comments / activity. Uniquely identified by (driveId, driveItemId).
// =====================================================================

export const managedDocuments = pgTable("managed_documents", {
  id: serial("id").primaryKey(),
  rootScope: documentRootScopeEnum("root_scope").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  companyRootId: integer("company_root_id").references(() => companySharepointRoots.id, { onDelete: "cascade" }),
  /**
   * Active Clients taxonomy linkage — set when the file lives inside a
   * provisioned taxonomy folder. Null means the file sits in an untracked
   * path (legacy folders, manually-created subfolders, etc.). Discipline /
   * stage / approval requirements are derived from the parent folder's
   * taxonomy row when set.
   */
  parentFolderId: integer("parent_folder_id"),
  driveId: text("drive_id").notNull(),
  driveItemId: text("drive_item_id").notNull(),
  name: text("name").notNull(),
  /** Full path shown to users (e.g. 'Projects/ABC/Engineering/file.pdf'). */
  path: text("path").notNull(),
  /** Set after the first revision row is inserted. */
  currentRevisionId: integer("current_revision_id"),
  /** Document owner (defaults to uploader; editable by COO/CEO admin). */
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  state: managedDocumentStateEnum("state").notNull().default("draft"),
  createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (t) => ({
  driveItemIdx: uniqueIndex("managed_documents_drive_item_idx").on(t.driveId, t.driveItemId),
  projectIdx: index("managed_documents_project_idx").on(t.projectId),
  companyRootIdx: index("managed_documents_company_root_idx").on(t.companyRootId),
  ownerIdx: index("managed_documents_owner_idx").on(t.ownerUserId),
  parentFolderIdx: index("managed_documents_parent_folder_idx").on(t.parentFolderId),
}));

export const insertManagedDocumentSchema = createInsertSchema(managedDocuments)
  .omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertManagedDocument = z.infer<typeof insertManagedDocumentSchema>;
export type ManagedDocument = typeof managedDocuments.$inferSelect;

// =====================================================================
// document_revisions — per-doc version history (mirrors Graph version id).
// =====================================================================

export const documentRevisions = pgTable("document_revisions", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => managedDocuments.id, { onDelete: "cascade" }),
  /** Monotonic per-doc counter (1..N). */
  revisionNumber: integer("revision_number").notNull(),
  /** Graph drive item version id (e.g. '1.0', '2.0', or a driveItem version GUID). */
  sharepointVersionId: text("sharepoint_version_id"),
  sizeBytes: integer("size_bytes"),
  contentHash: text("content_hash"),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  notes: text("notes"),
  isCurrent: boolean("is_current").notNull().default(false),
  /** Set true when a controlled-approval finalises (not in this build — reserved). */
  isControlled: boolean("is_controlled").notNull().default(false),
}, (t) => ({
  docRevIdx: uniqueIndex("document_revisions_doc_rev_idx").on(t.documentId, t.revisionNumber),
  currentIdx: index("document_revisions_current_idx").on(t.documentId, t.isCurrent),
}));

export const insertDocumentRevisionSchema = createInsertSchema(documentRevisions)
  .omit({ id: true, uploadedAt: true } as any);
export type InsertDocumentRevision = z.infer<typeof insertDocumentRevisionSchema>;
export type DocumentRevision = typeof documentRevisions.$inferSelect;

// =====================================================================
// document_locks — mirrors Graph checkout state. PK == documentId.
// =====================================================================

export const documentLocks = pgTable("document_locks", {
  documentId: integer("document_id").primaryKey().references(() => managedDocuments.id, { onDelete: "cascade" }),
  lockedByUserId: integer("locked_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lockedAt: timestamp("locked_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  clientAgent: text("client_agent"),
});

export const insertDocumentLockSchema = createInsertSchema(documentLocks)
  .omit({ lockedAt: true } as any);
export type InsertDocumentLock = z.infer<typeof insertDocumentLockSchema>;
export type DocumentLock = typeof documentLocks.$inferSelect;

// =====================================================================
// document_comments + document_comment_mentions
// =====================================================================

export const documentComments = pgTable("document_comments", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => managedDocuments.id, { onDelete: "cascade" }),
  /** Optional: comment pinned to a specific revision. Null = doc-level. */
  revisionId: integer("revision_id").references(() => documentRevisions.id, { onDelete: "set null" }),
  /** Optional: thread parent for replies. */
  parentCommentId: integer("parent_comment_id"),
  authorUserId: integer("author_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  editedAt: timestamp("edited_at"),
  deletedAt: timestamp("deleted_at"),
}, (t) => ({
  docIdx: index("document_comments_doc_idx").on(t.documentId, t.createdAt),
  parentIdx: index("document_comments_parent_idx").on(t.parentCommentId),
}));

export const insertDocumentCommentSchema = createInsertSchema(documentComments)
  .omit({ id: true, createdAt: true } as any);
export type InsertDocumentComment = z.infer<typeof insertDocumentCommentSchema>;
export type DocumentComment = typeof documentComments.$inferSelect;

export const documentCommentMentions = pgTable("document_comment_mentions", {
  commentId: integer("comment_id").notNull().references(() => documentComments.id, { onDelete: "cascade" }),
  mentionedUserId: integer("mentioned_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: uniqueIndex("document_comment_mentions_pk").on(t.commentId, t.mentionedUserId),
  userIdx: index("document_comment_mentions_user_idx").on(t.mentionedUserId),
}));

export type DocumentCommentMention = typeof documentCommentMentions.$inferSelect;

// =====================================================================
// document_activity — full audit log for DM actions.
// =====================================================================

export const documentActivity = pgTable("document_activity", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  /** Snapshot of role code at time of action (e.g. 'COO_ADMIN'). */
  actorRole: text("actor_role"),
  rootScope: documentRootScopeEnum("root_scope").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "set null" }),
  companyRootId: integer("company_root_id").references(() => companySharepointRoots.id, { onDelete: "set null" }),
  documentId: integer("document_id").references(() => managedDocuments.id, { onDelete: "set null" }),
  revisionId: integer("revision_id").references(() => documentRevisions.id, { onDelete: "set null" }),
  driveId: text("drive_id").notNull(),
  itemId: text("item_id"),
  itemPath: text("item_path"),
  itemName: text("item_name"),
  action: documentActivityActionEnum("action").notNull(),
  sizeBytes: integer("size_bytes"),
  requestId: text("request_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("document_activity_project_idx").on(t.projectId, t.createdAt),
  documentIdx: index("document_activity_document_idx").on(t.documentId, t.createdAt),
  userIdx: index("document_activity_user_idx").on(t.userId, t.createdAt),
  actionIdx: index("document_activity_action_idx").on(t.action, t.createdAt),
}));

export const insertDocumentActivitySchema = createInsertSchema(documentActivity)
  .omit({ id: true, createdAt: true } as any);
export type InsertDocumentActivity = z.infer<typeof insertDocumentActivitySchema>;
export type DocumentActivity = typeof documentActivity.$inferSelect;

// =====================================================================
// Type-safe enum exports for runtime use
// =====================================================================

export const DOCUMENT_ROOT_SCOPES = ["project", "company"] as const;
export type DocumentRootScope = (typeof DOCUMENT_ROOT_SCOPES)[number];

export const DOCUMENT_ACTIVITY_ACTIONS = [
  "upload",
  "download",
  "rename",
  "create_folder",
  "view",
  "checkout",
  "checkin",
  "discard_checkout",
  "restore_revision",
  "comment",
] as const;
export type DocumentActivityAction = (typeof DOCUMENT_ACTIVITY_ACTIONS)[number];

export const MANAGED_DOCUMENT_STATES = [
  "draft",
  "in_review",
  "approved",
  "superseded",
  "archived",
] as const;
export type ManagedDocumentState = (typeof MANAGED_DOCUMENT_STATES)[number];

/** Approval handoff constant — used when the approvals integration lands in a later phase. */
export const MANAGED_DOCUMENT_APPROVAL_TYPE = "managed_document" as const;

// =====================================================================
// Active Clients folder taxonomy (D6) — replaces the controlled-document
// type registry above.
//
// Source of truth for the canonical SharePoint folder tree under
// `01 - Clients/01 - active projects (1)/{Project}/`. Two lifecycle modes
// coexist:
//   - pre_construction: PRE_First Assessment, PRE_Cost Proposal, PM
//   - full_lifecycle:   01_Financial Close … 14_Contractor Shared Folder
//
// A project keeps its pre-construction folders even after the full-lifecycle
// tree is provisioned. Provisioning is fully manual — COO (or any user with
// the `provision_documents` permission) triggers it from the admin console.
//
// Discipline mapping per top-level folder is editable by admin so the app
// can drive per-discipline panels (Engineering, HSE, Quality, …) without
// code changes when the operating model evolves.
// =====================================================================

export const folderLifecycleModeEnum = pgEnum("folder_lifecycle_mode_enum", [
  "pre_construction",
  "full_lifecycle",
  "both",
]);

export const folderTaxonomy = pgTable("folder_taxonomy", {
  id: serial("id").primaryKey(),
  /** Stable logical key, e.g. '07_construction', 'pre_cost_proposal/cp_costing'. */
  internalKey: text("internal_key").notNull().unique(),
  /** Folder name as it appears in SharePoint, e.g. '07_Construction'. */
  displayName: text("display_name").notNull(),
  /** Parent taxonomy key, null for top-level folders. */
  parentKey: text("parent_key"),
  /** Which template tree this folder belongs to. */
  lifecycleMode: folderLifecycleModeEnum("lifecycle_mode").notNull(),
  /**
   * Owning stage code (FK to stage_definitions.stageCode). Null for
   * cross-stage folders like 06_HSE, 13_Project Photos.
   */
  stageCode: text("stage_code"),
  /**
   * LIFECYCLE_DEPARTMENTS codes that own this folder (multi-discipline
   * supported — e.g. Construction is owned by ENGINEERING + CONSTRUCTION
   * + QUALITY). Drives which department pages surface this folder.
   */
  disciplines: jsonb("disciplines").$type<string[]>().notNull().default([]),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  internalKeyIdx: uniqueIndex("folder_taxonomy_internal_key_idx").on(t.internalKey),
  parentIdx: index("folder_taxonomy_parent_idx").on(t.parentKey),
  lifecycleIdx: index("folder_taxonomy_lifecycle_idx").on(t.lifecycleMode),
}));

export const insertFolderTaxonomySchema = createInsertSchema(folderTaxonomy)
  .omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertFolderTaxonomy = z.infer<typeof insertFolderTaxonomySchema>;
export type FolderTaxonomy = typeof folderTaxonomy.$inferSelect;

// =====================================================================
// project_folders — instance rows. One row per (projectId, taxonomyKey)
// once provisioned. Holds the Graph driveId/itemId so the app can deep-
// link into SharePoint.
// =====================================================================

export const projectFolders = pgTable("project_folders", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  taxonomyKey: text("taxonomy_key").notNull().references(() => folderTaxonomy.internalKey),
  // SharePoint references — populated after a successful Graph create.
  driveId: text("drive_id"),
  itemId: text("item_id"),
  sharepointPath: text("sharepoint_path"),
  // Provisioning audit
  provisionedAt: timestamp("provisioned_at"),
  provisionedByUserId: integer("provisioned_by_user_id").references(() => users.id, { onDelete: "set null" }),
  // Reconciliation — last time we verified the folder still exists on Graph.
  lastVerifiedAt: timestamp("last_verified_at"),
  verifyError: text("verify_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  projectTaxonomyUq: uniqueIndex("project_folders_project_taxonomy_uq").on(t.projectId, t.taxonomyKey),
  projectIdx: index("project_folders_project_idx").on(t.projectId),
  taxonomyIdx: index("project_folders_taxonomy_idx").on(t.taxonomyKey),
}));

export const insertProjectFolderSchema = createInsertSchema(projectFolders)
  .omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectFolder = z.infer<typeof insertProjectFolderSchema>;
export type ProjectFolder = typeof projectFolders.$inferSelect;

// =====================================================================
// document_approval_requirements — admin-editable list of files/folders
// that need formal approval (replaces controlled_document_types).
//
// A requirement attaches to a taxonomy folder and optionally narrows by
// filename pattern (regex). When a file matching the requirement lands in
// the folder, the existing `approvals` engine is invoked with
// relatedEntityType='managed_document'.
// =====================================================================

export const documentApprovalRequirements = pgTable("document_approval_requirements", {
  id: serial("id").primaryKey(),
  /** Folder this requirement targets. */
  taxonomyKey: text("taxonomy_key").notNull().references(() => folderTaxonomy.internalKey),
  /**
   * Optional case-insensitive regex narrowing. Null means every file in
   * the folder requires this approval. Example: '^costing.*\\.xlsx$'.
   */
  fileNamePattern: text("file_name_pattern"),
  /** Human label, e.g. 'Costing Excel', 'EPC Contract — Signed'. */
  displayName: text("display_name").notNull(),
  description: text("description"),
  /**
   * Approver roles (COMPANY_ROLES codes). At submit time the submitter
   * picks an approver who holds one of these roles.
   */
  approverRoles: jsonb("approver_roles").$type<string[]>().notNull().default([]),
  /**
   * When true, ALL listed approvers must sign off independently (e.g.
   * financial close pack = CFO + COO). When false, ANY single one suffices.
   */
  requiresAllApprovers: boolean("requires_all_approvers").notNull().default(false),
  /**
   * Optional headline-numbers extraction spec for preview chips on the
   * project page. Shape: { sheetName: string, cells: { revenue: 'B12', ... } }.
   * Null when no extraction configured.
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
  taxonomyIdx: index("doc_approval_req_taxonomy_idx").on(t.taxonomyKey),
  activeIdx: index("doc_approval_req_active_idx").on(t.active),
}));

export const insertDocumentApprovalRequirementSchema = createInsertSchema(documentApprovalRequirements)
  .omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertDocumentApprovalRequirement = z.infer<typeof insertDocumentApprovalRequirementSchema>;
export type DocumentApprovalRequirement = typeof documentApprovalRequirements.$inferSelect;

// =====================================================================
// Type-safe enum exports
// =====================================================================

export const FOLDER_LIFECYCLE_MODES = [
  "pre_construction",
  "full_lifecycle",
  "both",
] as const;
export type FolderLifecycleMode = (typeof FOLDER_LIFECYCLE_MODES)[number];

/** Permission key for users authorised to provision SharePoint folders. */
export const PROVISION_DOCUMENTS_PERMISSION = "provision_documents" as const;
