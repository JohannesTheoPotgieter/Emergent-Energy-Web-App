// C4: Handover packs schema — client handover, PC, Matriarch, SSEG closeout

import { pgTable, text, integer, boolean, timestamp, serial, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo, projectPdPmHandover } from "./projects";
import { counterparties } from "./finance";

// ===================== HANDOVER PACKS =====================

export const handoverPacks = pgTable("handover_packs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  packType: text("pack_type").notNull(),            // 'pd_to_pm', 'practical_completion', 'client_handover', 'matriarch_handover', 'sseg_closeout'
  checklistStatus: text("checklist_status").default("not_started"), // 'not_started', 'in_progress', 'complete', 'submitted', 'accepted', 'rejected'
  documentCompletenessPct: integer("document_completeness_pct").default(0),
  openSnagsCount: integer("open_snags_count").default(0),
  finalReviewerUserId: integer("final_reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
  clientSubmissionDate: date("client_submission_date"),
  clientAcceptanceDate: date("client_acceptance_date"),
  matriarchAcceptanceDate: date("matriarch_acceptance_date"),
  notes: text("notes"),
  status: text("status").default("draft"),          // 'draft', 'in_progress', 'submitted', 'accepted', 'rejected'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertHandoverPackSchema = createInsertSchema(handoverPacks).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertHandoverPack = z.infer<typeof insertHandoverPackSchema>;
export type HandoverPack = typeof handoverPacks.$inferSelect;

// ===================== HANDOVER CHECKLIST ITEMS =====================

export const handoverChecklistItems = pgTable("handover_checklist_items", {
  id: serial("id").primaryKey(),
  handoverPackId: integer("handover_pack_id").notNull().references(() => handoverPacks.id),
  itemName: text("item_name").notNull(),
  category: text("category"),                       // 'document', 'inspection', 'approval', 'training', 'asset_transfer'
  required: boolean("required").default(true),
  status: text("status").default("pending"),        // 'pending', 'complete', 'not_applicable', 'waived'
  evidenceLink: text("evidence_link"),
  completedByUserId: integer("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedDate: timestamp("completed_date"),
  notes: text("notes"),
});

export const insertHandoverChecklistItemSchema = createInsertSchema(handoverChecklistItems).omit({ id: true } as any);
export type InsertHandoverChecklistItem = z.infer<typeof insertHandoverChecklistItemSchema>;
export type HandoverChecklistItem = typeof handoverChecklistItems.$inferSelect;

// ===================== SSEG ITEMS =====================

export const ssegItems = pgTable("sseg_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(),            // 'application', 'approval', 'inspection', 'certificate', 'connection'
  authority: text("authority"),
  referenceNumber: text("reference_number"),
  submittedDate: date("submitted_date"),
  expectedDate: date("expected_date"),
  actualDate: date("actual_date"),
  status: text("status").default("pending"),        // 'pending', 'submitted', 'approved', 'rejected', 'complete'
  notes: text("notes"),
  // Commissioning gate flags (Prompt 7)
  techsitterConfirmed: boolean("techsitter_confirmed").default(false),
  meteringConfirmed: boolean("metering_confirmed").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertSsegItemSchema = createInsertSchema(ssegItems).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertSsegItem = z.infer<typeof insertSsegItemSchema>;
export type SsegItem = typeof ssegItems.$inferSelect;

// ===================== LESSONS LEARNT =====================

export const lessonsLearnt = pgTable("lessons_learnt", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  tags: jsonb("tags").default([]),
  projectType: text("project_type"),
  technologyTags: jsonb("technology_tags").default([]),
  addedByUserId: integer("added_by_user_id").references(() => users.id, { onDelete: "set null" }),
  addedByName: text("added_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertLessonsLearntSchema = createInsertSchema(lessonsLearnt).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertLessonsLearnt = z.infer<typeof insertLessonsLearntSchema>;
export type LessonsLearnt = typeof lessonsLearnt.$inferSelect;

// ===================== HANDOVER STAKEHOLDERS =====================

export const handoverStakeholders = pgTable("handover_stakeholders", {
  id: serial("id").primaryKey(),
  handoverId: integer("handover_id").notNull().references(() => projectPdPmHandover.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  company: text("company"),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  counterpartyId: integer("counterparty_id").references(() => counterparties.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});

export const insertHandoverStakeholderSchema = createInsertSchema(handoverStakeholders).omit({ id: true, createdAt: true, deletedAt: true, deletedBy: true } as any);
export type InsertHandoverStakeholder = z.infer<typeof insertHandoverStakeholderSchema>;
export type HandoverStakeholder = typeof handoverStakeholders.$inferSelect;

// ===================== B8: O&M HANDOVER TRACKER =====================
//
// One row per project tracking the O&M handover lifecycle from
// "scheduled" through "completed". The readiness checklist mirrors the
// canonical 7-item list from stage8DataSchema so the front-end stays
// in sync with the existing Stage 8 workspace.
//
// Scope (per user direction): "just build out the functionality to
// track a successful handover and a dashboard close to handover to
// track progress." Explicitly NOT in scope for this table:
//   - asset register (separate, future)
//   - Matriarch external integration
//   - warranty matrix (a separate enrichment)
//   - monitoring credential vault
//
// Permission model:
//   - Any authenticated user can create / upsert / update fields
//   - Only COO_ADMIN, CEO_ADMIN, PROGRAM_MANAGER, CONSTRUCTION_MANAGER
//     can mark the handover COMPLETE (see POST /api/om-handovers/:id/
//     mark-complete). This mirrors "ceremonial sign-off" gating seen
//     in other closeout steps.

export const OM_HANDOVER_STATUSES = [
  "not_scheduled",
  "scheduled",
  "in_progress",
  "completed",
  "on_hold",
] as const;
export type OmHandoverStatus = typeof OM_HANDOVER_STATUSES[number];

export const omHandovers = pgTable("om_handovers", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("not_scheduled"),

  // Lifecycle dates
  plannedHandoverDate: date("planned_handover_date"),
  actualHandoverDate: date("actual_handover_date"),

  // Readiness checklist — matches stage8DataSchema (source of truth for
  // the commissioning→O&M handover field list). Boolean columns (not
  // jsonb) so the "close to handover" dashboard can compute completeness
  // with a single SELECT and so we can index specific items for reports.
  asBuiltsUploaded: boolean("as_builts_uploaded").notNull().default(false),
  warrantiesUploaded: boolean("warranties_uploaded").notNull().default(false),
  omManualUploaded: boolean("om_manual_uploaded").notNull().default(false),
  serialNumbersUploaded: boolean("serial_numbers_uploaded").notNull().default(false),
  targetsConfirmed: boolean("targets_confirmed").notNull().default(false),
  monitoringAccessConfirmed: boolean("monitoring_access_confirmed").notNull().default(false),
  trainingComplete: boolean("training_complete").notNull().default(false),

  // Ceremonial hand-off fields
  handedOverByUserId: integer("handed_over_by_user_id").references(() => users.id, { onDelete: "set null" }),
  acceptedByUserId: integer("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at"),
  handoverPackLink: text("handover_pack_link"),
  notes: text("notes"),

  // Mark-complete audit columns (set by mark-complete endpoint)
  markedCompleteByUserId: integer("marked_complete_by_user_id").references(() => users.id, { onDelete: "set null" }),
  markedCompleteByRole: text("marked_complete_by_role"),
  markedCompleteAt: timestamp("marked_complete_at"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertOmHandoverSchema = createInsertSchema(omHandovers).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertOmHandover = z.infer<typeof insertOmHandoverSchema>;
export type OmHandover = typeof omHandovers.$inferSelect;

/**
 * The canonical readiness checklist keys and their human-readable labels.
 * Mirrors stage8DataSchema exactly so the O&M handover module and the
 * Stage 8 workspace surface the same items.
 */
export const OM_HANDOVER_CHECKLIST: Array<{ key: keyof OmHandover; label: string }> = [
  { key: "asBuiltsUploaded",           label: "As-built drawings uploaded" },
  { key: "warrantiesUploaded",         label: "Warranties uploaded" },
  { key: "omManualUploaded",           label: "O&M manual uploaded" },
  { key: "serialNumbersUploaded",      label: "Serial numbers uploaded" },
  { key: "targetsConfirmed",           label: "Performance targets confirmed" },
  { key: "monitoringAccessConfirmed",  label: "Monitoring access confirmed" },
  { key: "trainingComplete",           label: "Training complete" },
];
