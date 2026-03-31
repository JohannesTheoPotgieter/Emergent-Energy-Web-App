// ============================================================
// STAGE COLLABORATION SCHEMA — Cross-department collaboration tables
// ============================================================
// Tables: project_client_commitments, project_client_updates,
//   project_queries, project_stage_financial_close_tracks
// ============================================================

import { pgTable, text, integer, boolean, timestamp, serial, date, jsonb, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";
import { projectStageInstances } from "./stage-lifecycle";

// ===================== CONSTANTS =====================

export const FINANCIAL_CLOSE_TRACK_CODES = ['COST_PROPOSAL', 'EPC', 'FUNDING_CONTRACT', 'OM'] as const;
export type FinancialCloseTrackCode = typeof FINANCIAL_CLOSE_TRACK_CODES[number];

// ===================== PROJECT CLIENT COMMITMENTS =====================
// @deprecated 2026-03-31: Replaced by client_commitments in collaboration-workflow.ts.
// Data migrated via 20260331_consolidate_client_tables.sql. Drop after 90 days of zero usage.

export const projectClientCommitments = pgTable("project_client_commitments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCodeCreated: text("stage_code_created"),
  commitmentText: text("commitment_text").notNull(),
  committedByUserId: integer("committed_by_user_id").references(() => users.id),
  committedDate: timestamp("committed_date").notNull().defaultNow(),
  deliveryStageCode: text("delivery_stage_code"),
  status: text("status").notNull().default("OPEN"),
  deliveredDate: timestamp("delivered_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  migratedFromLegacy: boolean("migrated_from_legacy").notNull().default(false),
}, (table) => ({
  projectIdIdx: index("pcc_project_id_idx").on(table.projectId),
  statusIdx: index("pcc_status_idx").on(table.status),
}));

export const insertProjectClientCommitmentSchema = createInsertSchema(projectClientCommitments).omit({ id: true, createdAt: true } as any);
export type InsertProjectClientCommitment = z.infer<typeof insertProjectClientCommitmentSchema>;
export type ProjectClientCommitment = typeof projectClientCommitments.$inferSelect;

// ===================== PROJECT CLIENT UPDATES =====================
// @deprecated 2026-03-31: Replaced by client_updates in collaboration-workflow.ts.
// Data migrated via 20260331_consolidate_client_tables.sql. Drop after 90 days of zero usage.

export const projectClientUpdates = pgTable("project_client_updates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  updateNumber: integer("update_number").notNull(),
  dueDate: date("due_date"),
  status: text("status").notNull().default("DRAFT"),
  progressSummaryText: text("progress_summary_text"),
  completedThisPeriodText: text("completed_this_period_text"),
  next7DaysText: text("next_7_days_text"),
  blockersText: text("blockers_text"),
  clientActionsRequiredText: text("client_actions_required_text"),
  attachmentUrls: jsonb("attachment_urls").default([]),
  sentByUserId: integer("sent_by_user_id").references(() => users.id),
  reviewerUserId: integer("reviewer_user_id").references(() => users.id),
  sentDate: timestamp("sent_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  migratedFromLegacy: boolean("migrated_from_legacy").notNull().default(false),
}, (table) => ({
  projectUpdateUnique: unique("pcu_project_update_uq").on(table.projectId, table.updateNumber),
  projectIdIdx: index("pcu_project_id_idx").on(table.projectId),
  statusIdx: index("pcu_status_idx").on(table.status),
}));

export const insertProjectClientUpdateSchema = createInsertSchema(projectClientUpdates).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectClientUpdate = z.infer<typeof insertProjectClientUpdateSchema>;
export type ProjectClientUpdate = typeof projectClientUpdates.$inferSelect;

// ===================== PROJECT QUERIES =====================
// Structured query routing — defined paths for technical, commercial, compliance questions

export const projectQueries = pgTable("project_queries", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCode: text("stage_code"),
  queryType: text("query_type").notNull(),
  raisedByUserId: integer("raised_by_user_id").references(() => users.id),
  raisedByDepartment: text("raised_by_department"),
  assignedToUserId: integer("assigned_to_user_id").references(() => users.id),
  assignedToDepartment: text("assigned_to_department"),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("NORMAL"),
  status: text("status").notNull().default("OPEN"),
  responseText: text("response_text"),
  respondedByUserId: integer("responded_by_user_id").references(() => users.id),
  respondedDate: timestamp("responded_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("pq_project_id_idx").on(table.projectId),
  statusIdx: index("pq_status_idx").on(table.status),
  assignedToIdx: index("pq_assigned_to_idx").on(table.assignedToUserId),
}));

export const insertProjectQuerySchema = createInsertSchema(projectQueries).omit({ id: true, createdAt: true } as any);
export type InsertProjectQuery = z.infer<typeof insertProjectQuerySchema>;
export type ProjectQuery = typeof projectQueries.$inferSelect;

// ===================== PROJECT STAGE FINANCIAL CLOSE TRACKS =====================
// Financial close deliverable tracks — 4 configurable tracks per project

export const projectStageFinancialCloseTracks = pgTable("project_stage_financial_close_tracks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageInstanceId: integer("stage_instance_id").references(() => projectStageInstances.id, { onDelete: "cascade" }),
  trackCode: text("track_code").notNull(),
  trackLabel: text("track_label").notNull(),
  isRequired: boolean("is_required").notNull().default(true),
  signed: boolean("signed").notNull().default(false),
  signedDate: date("signed_date"),
  documentUrl: text("document_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectTrackUnique: unique("psfct_project_track_uq").on(table.projectId, table.trackCode),
  projectIdIdx: index("psfct_project_id_idx").on(table.projectId),
  stageInstanceIdx: index("psfct_stage_instance_idx").on(table.stageInstanceId),
}));

export const insertProjectStageFinancialCloseTrackSchema = createInsertSchema(projectStageFinancialCloseTracks).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectStageFinancialCloseTrack = z.infer<typeof insertProjectStageFinancialCloseTrackSchema>;
export type ProjectStageFinancialCloseTrack = typeof projectStageFinancialCloseTracks.$inferSelect;
