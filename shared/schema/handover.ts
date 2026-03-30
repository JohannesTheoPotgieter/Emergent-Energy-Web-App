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
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  packType: text("pack_type").notNull(),            // 'pd_to_pm', 'practical_completion', 'client_handover', 'matriarch_handover', 'sseg_closeout'
  checklistStatus: text("checklist_status").default("not_started"), // 'not_started', 'in_progress', 'complete', 'submitted', 'accepted', 'rejected'
  documentCompletenessPct: integer("document_completeness_pct").default(0),
  openSnagsCount: integer("open_snags_count").default(0),
  finalReviewerUserId: integer("final_reviewer_user_id").references(() => users.id),
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
  completedByUserId: integer("completed_by_user_id").references(() => users.id),
  completedDate: timestamp("completed_date"),
  notes: text("notes"),
  // Stage lifecycle extensions (Prompt 1)
  department: text("department"),
  blocksGate: boolean("blocks_gate").default(false),
  stageCode: text("stage_code"),
});

export const insertHandoverChecklistItemSchema = createInsertSchema(handoverChecklistItems).omit({ id: true } as any);
export type InsertHandoverChecklistItem = z.infer<typeof insertHandoverChecklistItemSchema>;
export type HandoverChecklistItem = typeof handoverChecklistItems.$inferSelect;

// ===================== SSEG ITEMS =====================

export const ssegItems = pgTable("sseg_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
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
  addedByUserId: integer("added_by_user_id").references(() => users.id),
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
});

export const insertHandoverStakeholderSchema = createInsertSchema(handoverStakeholders).omit({ id: true, createdAt: true } as any);
export type InsertHandoverStakeholder = z.infer<typeof insertHandoverStakeholderSchema>;
export type HandoverStakeholder = typeof handoverStakeholders.$inferSelect;
