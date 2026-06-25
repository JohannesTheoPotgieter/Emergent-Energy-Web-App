/**
 * Document management schema — the canonical SharePoint-backed document
 * surface: company + project SharePoint roots, the Active Clients folder
 * taxonomy, per-project provisioned folders, managed documents (versions,
 * comments, activity), and per-folder approval requirements.
 *
 * Metadata-only per CLAUDE.md §Microsoft 365 Integration: we never store
 * file bodies — `driveId` + `driveItemId` are the Graph API references
 * used to read/move the actual file.
 *
 * Approvals reuse the existing `approvals` table (collaboration.ts) with
 * `approvalType='managed_document'` / `relatedEntityType='managed_document'`.
 * (The legacy controlled-documents tables were removed — see the
 * drop_controlled_documents migration.)
 */

import {
  pgTable, text, integer, timestamp, pgEnum, serial, boolean, jsonb, index, uniqueIndex, date,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, COMPANY_ROLES } from "./users";
import { projectInfo } from "./projects";
import { LIFECYCLE_DEPARTMENTS } from "./stage-lifecycle";

// =====================================================================
// Document Management (DM) — generic SharePoint browsing + versioning +
// comments + activity.
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

export const projectDocumentDomainEnum = pgEnum("project_document_domain_enum", [
  "engineering",
  "quality",
]);

export const projectDocumentStatusEnum = pgEnum("project_document_status_enum", [
  "draft",
  "submitted_for_review",
  "changes_required",
  "approved",
  "superseded",
  "rejected",
  "archived",
]);

export const projectDocumentReviewStatusEnum = pgEnum("project_document_review_status_enum", [
  "draft",
  "submitted_for_review",
  "changes_required",
  "approved",
  "rejected",
]);

export const projectDocumentSyncConfidenceEnum = pgEnum("project_document_sync_confidence_enum", [
  "high",
  "medium",
  "low",
  "stale",
  "broken",
]);

// =====================================================================
// Company-wide SharePoint roots — e.g. HR, Templates, Policies.
// Per-project document folders are bound via project_discipline_folders
// (browse-and-bind), defined below.
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
   * Browse-and-bind linkage — set when the file lives under a discipline
   * folder bound via project_discipline_folders. Drives discipline-scoped
   * approval requirements. Null for files not under a bound folder. FK is
   * declared lazily (forward reference; the table is defined later).
   */
  disciplineFolderId: integer("discipline_folder_id").references((): AnyPgColumn => projectDisciplineFolders.id, { onDelete: "set null" }),
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
  disciplineFolderIdx: index("managed_documents_discipline_folder_idx").on(t.disciplineFolderId),
}));

export const insertManagedDocumentSchema = createInsertSchema(managedDocuments)
  .omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertManagedDocument = z.infer<typeof insertManagedDocumentSchema>;
export type ManagedDocument = typeof managedDocuments.$inferSelect;

// =====================================================================
// project_document_links — project-facing metadata for SharePoint files.
// =====================================================================

export const projectDocumentLinks = pgTable("project_document_links", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  managedDocumentId: integer("managed_document_id").references(() => managedDocuments.id, { onDelete: "set null" }),
  domain: projectDocumentDomainEnum("domain").notNull(),
  documentType: text("document_type").notNull(),
  discipline: text("discipline"),
  revision: text("revision"),
  status: projectDocumentStatusEnum("status").notNull().default("draft"),
  reviewStatus: projectDocumentReviewStatusEnum("review_status").notNull().default("draft"),
  currentRevision: boolean("current_revision").notNull().default(true),
  superseded: boolean("superseded").notNull().default(false),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  dueDate: date("due_date"),
  preparedByUserId: integer("prepared_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  requiresPrengSignoff: boolean("requires_preng_signoff").notNull().default(false),
  prengSignedOffByUserId: integer("preng_signed_off_by_user_id").references(() => users.id, { onDelete: "set null" }),
  prengSignedOffAt: timestamp("preng_signed_off_at"),
  closeOutEvidenceRequired: boolean("close_out_evidence_required").notNull().default(false),
  closeOutEvidenceLinked: boolean("close_out_evidence_linked").notNull().default(false),
  sharepointDriveId: text("sharepoint_drive_id"),
  sharepointItemId: text("sharepoint_item_id"),
  sharepointWebUrl: text("sharepoint_web_url"),
  sharepointFolderPath: text("sharepoint_folder_path"),
  fileName: text("file_name"),
  lastSyncedAt: timestamp("last_synced_at"),
  syncConfidence: projectDocumentSyncConfidenceEnum("sync_confidence").notNull().default("high"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (t) => ({
  projectDomainIdx: index("project_document_links_project_domain_idx").on(t.projectId, t.domain),
  managedDocumentIdx: index("project_document_links_managed_document_idx").on(t.managedDocumentId),
  sharepointItemIdx: index("project_document_links_sharepoint_item_idx").on(t.sharepointDriveId, t.sharepointItemId),
  statusIdx: index("project_document_links_status_idx").on(t.status, t.reviewStatus),
}));

export const insertProjectDocumentLinkSchema = createInsertSchema(projectDocumentLinks)
  .omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectDocumentLink = z.infer<typeof insertProjectDocumentLinkSchema>;
export type ProjectDocumentLink = typeof projectDocumentLinks.$inferSelect;

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
// Discipline guard for document_approval_requirements (below) and the
// browse-and-bind discipline folder surface (project_discipline_folders).
//
// PHASE 5 DECOMMISSION: the legacy Active Clients `folder_taxonomy` +
// `project_folders` tables and the manual SharePoint folder-provisioning
// path were removed. Browse-and-bind discipline folders
// (`project_discipline_folders`) are now the sole project document surface.
// =====================================================================

/** Runtime guard for discipline codes (LIFECYCLE_DEPARTMENTS). */
const disciplineEnum = z.enum(LIFECYCLE_DEPARTMENTS);

// =====================================================================
// project_discipline_folders — browse-and-bind instance rows. One stable
// row per (projectId, discipline): instead of generating a folder tree from
// folder_taxonomy, the user browses SharePoint and binds an EXISTING folder
// per discipline. The DM machinery (managed documents, revisions, comments,
// approvals, task links) then operates on whatever lives under that folder.
//
// Rebinding UPDATES the same row (the pair is unique), so downstream
// references stay valid; "unbind" is a soft delete (deletedAt) for the same
// reason. SharePoint refs (driveId/itemId/webUrl) are Graph pointers only —
// no file bytes, per CLAUDE.md §5A.
// =====================================================================

export const projectDisciplineFolders = pgTable("project_discipline_folders", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  /** LIFECYCLE_DEPARTMENTS code this binding is for, e.g. ENGINEERING / CONSTRUCTION. */
  discipline: text("discipline").notNull(),
  // SharePoint folder the user browsed to and bound for this discipline.
  driveId: text("drive_id"),
  itemId: text("item_id"),
  sharepointPath: text("sharepoint_path"),
  /** Browser-openable SharePoint URL (Graph driveItem.webUrl). */
  webUrl: text("web_url"),
  // Binding audit
  boundByUserId: integer("bound_by_user_id").references(() => users.id, { onDelete: "set null" }),
  boundAt: timestamp("bound_at"),
  // Reconciliation — last time we verified the folder still exists on Graph.
  lastVerifiedAt: timestamp("last_verified_at"),
  verifyError: text("verify_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  /** Soft unbind — the row persists so downstream references stay valid across rebinds. */
  deletedAt: timestamp("deleted_at"),
}, (t) => ({
  projectDisciplineUq: uniqueIndex("project_discipline_folders_project_discipline_uq").on(t.projectId, t.discipline),
  projectIdx: index("project_discipline_folders_project_idx").on(t.projectId),
}));

export const insertProjectDisciplineFolderSchema = createInsertSchema(projectDisciplineFolders)
  .omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectDisciplineFolder = z.infer<typeof insertProjectDisciplineFolderSchema>;
export type ProjectDisciplineFolder = typeof projectDisciplineFolders.$inferSelect;

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
  /**
   * Legacy taxonomy basis — retained for historical rows only. The
   * `folder_taxonomy` table (and its FK) were removed in the Phase 5
   * decommission, so this is now a plain, un-referenced text column.
   * Live requirements target a `discipline` (browse-and-bind); rows that
   * carry only a taxonomyKey are dormant. A row has EITHER taxonomyKey OR
   * discipline (enforced in the repository).
   */
  taxonomyKey: text("taxonomy_key"),
  /** Browse-and-bind basis: LIFECYCLE_DEPARTMENTS code this rule targets. */
  discipline: text("discipline"),
  /**
   * Optional case-insensitive regex on the path UNDER the bound discipline
   * folder (e.g. '^IFC'). Null = applies anywhere in the bound folder.
   */
  subfolderPattern: text("subfolder_pattern"),
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
  disciplineIdx: index("doc_approval_req_discipline_idx").on(t.discipline),
  activeIdx: index("doc_approval_req_active_idx").on(t.active),
}));

/** Runtime guard for the approverRoles[] JSONB array. */
const approverRoleEnum = z.enum(COMPANY_ROLES);

/** Optional regex string — empty/null allowed, otherwise must compile. */
const fileNameRegexSchema = z
  .string()
  .max(512)
  .nullish()
  .refine(
    (v) => {
      if (v == null || v === "") return true;
      try {
        new RegExp(v, "i");
        return true;
      } catch {
        return false;
      }
    },
    { message: "fileNamePattern must be a valid case-insensitive regex." },
  );

export const insertDocumentApprovalRequirementSchema = z.object({
  // A row targets EITHER a taxonomyKey (legacy) OR a discipline (browse-and-bind);
  // the repository enforces that exactly one basis is present.
  taxonomyKey: z.string().min(1).max(128).nullish(),
  discipline: disciplineEnum.nullish(),
  subfolderPattern: fileNameRegexSchema,
  fileNamePattern: fileNameRegexSchema,
  displayName: z.string().min(1).max(256),
  description: z.string().max(2048).nullable().optional(),
  approverRoles: z.array(approverRoleEnum).min(1, {
    message: "At least one approver role is required.",
  }),
  requiresAllApprovers: z.boolean().default(false),
  extractSpec: z
    .object({
      sheetName: z.string().optional(),
      cells: z.record(z.string(), z.string()).optional(),
    })
    .nullable()
    .optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(99999).default(0),
});
export type InsertDocumentApprovalRequirement = z.infer<typeof insertDocumentApprovalRequirementSchema>;
export type DocumentApprovalRequirement = typeof documentApprovalRequirements.$inferSelect;

// =====================================================================
// Type-safe constants
// =====================================================================

/** Permission key for users authorised to provision SharePoint folders. */
export const PROVISION_DOCUMENTS_PERMISSION = "provision_documents" as const;
