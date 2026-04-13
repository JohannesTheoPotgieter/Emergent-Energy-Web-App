// ============================================================
// COLLABORATION WORKFLOW SCHEMA — Acceptance, Commitments,
//   Evidence Requests, Queries, Client Updates
// ============================================================

import { pgTable, text, integer, boolean, timestamp, serial, date, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";

// ===================== CONSTANTS =====================

export const ACCEPTANCE_OUTCOMES = [
  'accepted',
  'accepted_with_reservations',
  'rejected',
] as const;
export type AcceptanceOutcome = typeof ACCEPTANCE_OUTCOMES[number];

export const RESERVATION_STATUSES = ['open', 'closed', 'overdue'] as const;
export type ReservationStatus = typeof RESERVATION_STATUSES[number];

export const COMMITMENT_STATUSES = ['open', 'delivered', 'overdue', 'cancelled'] as const;
export type CommitmentStatus = typeof COMMITMENT_STATUSES[number];

export const EVIDENCE_REQUEST_STATUSES = ['requested', 'uploaded', 'overdue', 'waived'] as const;
export type EvidenceRequestStatus = typeof EVIDENCE_REQUEST_STATUSES[number];

export const QUERY_TYPES = ['technical', 'commercial', 'compliance', 'quality', 'design'] as const;
export type QueryType = typeof QUERY_TYPES[number];

export const QUERY_PRIORITIES = ['normal', 'urgent'] as const;
export type QueryPriority = typeof QUERY_PRIORITIES[number];

export const QUERY_STATUSES = ['open', 'in_progress', 'answered', 'closed'] as const;
export type QueryStatus = typeof QUERY_STATUSES[number];

export const CLIENT_UPDATE_STATUSES = ['draft', 'pending_review', 'approved', 'sent', 'overdue'] as const;
export type ClientUpdateStatus = typeof CLIENT_UPDATE_STATUSES[number];

export const DECISION_CATEGORY_TYPES = [
  'scope', 'tariff', 'metering', 'commercial', 'technical', 'contract', 'design', 'procurement',
] as const;
export type DecisionCategoryType = typeof DECISION_CATEGORY_TYPES[number];

// Routing map: query type → default department
export const QUERY_ROUTING: Record<string, string> = {
  technical: 'ENGINEERING',
  commercial: 'PD',
  compliance: 'COMPLIANCE',
  quality: 'QUALITY',
  design: 'ENGINEERING',
};

// Handover stages that require acceptance workflow.
// Post-merge: PD-PM handover lives inside S03 Financial Close; the
// acceptance workflow now triggers off the merged S03 stage.
export const ACCEPTANCE_STAGE_CODES = [
  'S03_SIGNATURE_FINANCIAL_CLOSE',
  'S08_OM_HANDOVER',
  'S09_CLIENT_HANDOVER',
  'S10_POST_HANDOVER_REVIEW',
] as const;

// ===================== STAGE ACCEPTANCES =====================
// Formal acceptance for handover stages (4, 8, 9, 10)

export const stageAcceptances = pgTable("stage_acceptances", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCode: text("stage_code").notNull(),
  outcome: text("outcome").notNull(), // accepted / accepted_with_reservations / rejected
  decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decidedDate: timestamp("decided_date").notNull().defaultNow(),
  rejectionReason: text("rejection_reason"),
  adminOverride: boolean("admin_override").notNull().default(false),
  adminOverrideReason: text("admin_override_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("sa_project_id_idx").on(table.projectId),
  stageCodeIdx: index("sa_stage_code_idx").on(table.stageCode),
}));

export const insertStageAcceptanceSchema = createInsertSchema(stageAcceptances).omit({ id: true, createdAt: true } as any);
export type InsertStageAcceptance = z.infer<typeof insertStageAcceptanceSchema>;
export type StageAcceptance = typeof stageAcceptances.$inferSelect;

// ===================== ACCEPTANCE RESERVATIONS =====================
// Open items tracked from "accepted with reservations"

export const acceptanceReservations = pgTable("acceptance_reservations", {
  id: serial("id").primaryKey(),
  acceptanceId: integer("acceptance_id").notNull().references(() => stageAcceptances.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCode: text("stage_code").notNull(),
  description: text("description").notNull(),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  deadline: date("deadline"),
  status: text("status").notNull().default("open"), // open / closed / overdue
  closedDate: timestamp("closed_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("ar_project_id_idx").on(table.projectId),
  acceptanceIdIdx: index("ar_acceptance_id_idx").on(table.acceptanceId),
  statusIdx: index("ar_status_idx").on(table.status),
}));

export const insertAcceptanceReservationSchema = createInsertSchema(acceptanceReservations).omit({ id: true, createdAt: true } as any);
export type InsertAcceptanceReservation = z.infer<typeof insertAcceptanceReservationSchema>;
export type AcceptanceReservation = typeof acceptanceReservations.$inferSelect;

// ===================== CLIENT COMMITMENTS =====================
// @deprecated 2026-03-31 — Use projectClientCommitments from stage-collaboration.ts instead.
// Data migrated via 20260331_consolidate_client_tables.sql.
// This table will be dropped after 90 days of zero reads/writes.
// DO NOT add new reads or writes to this table.

export const clientCommitments = pgTable("client_commitments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCodeCreated: text("stage_code_created").notNull(),
  commitmentText: text("commitment_text").notNull(),
  committedByUserId: integer("committed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  committedDate: timestamp("committed_date").notNull().defaultNow(),
  deliveryStageCode: text("delivery_stage_code"),
  status: text("status").notNull().default("open"), // open / delivered / overdue / cancelled
  deliveredDate: timestamp("delivered_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("cc_project_id_idx").on(table.projectId),
  statusIdx: index("cc_status_idx").on(table.status),
}));

export const insertClientCommitmentSchema = createInsertSchema(clientCommitments).omit({ id: true, createdAt: true } as any);
export type InsertClientCommitment = z.infer<typeof insertClientCommitmentSchema>;
export type ClientCommitment = typeof clientCommitments.$inferSelect;

// ===================== EVIDENCE REQUESTS =====================
// Formal evidence requests between teams

export const evidenceRequests = pgTable("evidence_requests", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  stageCode: text("stage_code").notNull(),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  requestedFromDepartment: text("requested_from_department").notNull(),
  requestedFromUserId: integer("requested_from_user_id").references(() => users.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  dueDate: date("due_date"),
  status: text("status").notNull().default("requested"), // requested / uploaded / overdue / waived
  evidenceUrl: text("evidence_url"),
  fulfilledDate: timestamp("fulfilled_date"),
  linkedDependencyId: integer("linked_dependency_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("er_project_id_idx").on(table.projectId),
  statusIdx: index("er_status_idx").on(table.status),
  stageCodeIdx: index("er_stage_code_idx").on(table.stageCode),
}));

export const insertEvidenceRequestSchema = createInsertSchema(evidenceRequests).omit({ id: true, createdAt: true } as any);
export type InsertEvidenceRequest = z.infer<typeof insertEvidenceRequestSchema>;
export type EvidenceRequest = typeof evidenceRequests.$inferSelect;

// ===================== CLIENT UPDATES =====================
// @deprecated 2026-03-31 — Use projectClientUpdates from stage-collaboration.ts instead.
// Data migrated via 20260331_consolidate_client_tables.sql.
// This table will be dropped after 90 days of zero reads/writes.
// DO NOT add new reads or writes to this table.

export const clientUpdates = pgTable("client_updates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  updateNumber: integer("update_number").notNull().default(1),
  lastClientUpdateDate: timestamp("last_client_update_date"),
  nextClientUpdateDueDate: timestamp("next_client_update_due_date"),
  clientUpdateStatus: text("client_update_status").notNull().default("draft"), // draft / pending_review / approved / sent / overdue
  progressSummaryText: text("progress_summary_text"),
  completedThisPeriodText: text("completed_this_period_text"),
  next7DaysText: text("next_7_days_text"),
  blockersText: text("blockers_text"),
  clientActionsRequiredText: text("client_actions_required_text"),
  attachmentUrls: jsonb("attachment_urls").default([]),
  clientUpdateSentBy: integer("client_update_sent_by").references(() => users.id, { onDelete: "set null" }),
  reviewerUserId: integer("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
  sentDate: timestamp("sent_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("cu_project_id_idx").on(table.projectId),
  statusIdx: index("cu_status_idx").on(table.clientUpdateStatus),
}));

export const insertClientUpdateSchema = createInsertSchema(clientUpdates).omit({ id: true, createdAt: true } as any);
export type InsertClientUpdate = z.infer<typeof insertClientUpdateSchema>;
export type ClientUpdate = typeof clientUpdates.$inferSelect;
