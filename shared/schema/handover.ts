// C4: Handover packs schema — client handover, PC, Matriarch, SSEG closeout

import { pgTable, text, integer, boolean, timestamp, serial, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";

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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertSsegItemSchema = createInsertSchema(ssegItems).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertSsegItem = z.infer<typeof insertSsegItemSchema>;
export type SsegItem = typeof ssegItems.$inferSelect;
