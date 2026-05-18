import { pgTable, serial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";

export const PENDING_APPROVAL_STATUSES = ["pending", "approved", "rejected", "failed"] as const;
export type PendingApprovalStatus = (typeof PENDING_APPROVAL_STATUSES)[number];

export const PENDING_APPROVAL_KINDS = [
  "pipedrive_opportunity_create",
  "pipedrive_client_create",
  "sharepoint_intake_request_create",
  "sharepoint_project_shell_create",
  "cos_period_lock_create",
  "ee_info_update_seed",
] as const;
export type PendingApprovalKind = (typeof PENDING_APPROVAL_KINDS)[number];

export const pendingApprovals = pgTable("pending_approvals", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  targetTable: text("target_table").notNull(),
  summary: text("summary").notNull(),
  payload: jsonb("payload").notNull(),
  sourceLabel: text("source_label").notNull(),
  sourceRef: text("source_ref"),
  status: text("status").notNull().default("pending"),
  decidedAt: timestamp("decided_at"),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectionReason: text("rejection_reason"),
  appliedRecordId: text("applied_record_id"),
  applyError: text("apply_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPendingApprovalSchema = createInsertSchema(pendingApprovals).omit({
  id: true,
  status: true,
  decidedAt: true,
  decidedByUserId: true,
  rejectionReason: true,
  appliedRecordId: true,
  applyError: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPendingApproval = z.infer<typeof insertPendingApprovalSchema>;
export type PendingApproval = typeof pendingApprovals.$inferSelect;

/**
 * Transition history for `pending_approvals` — Plan v3 § 2.3 / D.5 (β).
 *
 * Pending-approval rows are high-blast-radius (they trigger material
 * changes when applied). The parent carries `decidedAt / decidedByUserId`
 * for the latest decision; this table captures every transition so a
 * row that was approved → reopened → rejected has full traceability.
 */
export const pendingApprovalHistory = pgTable("pending_approval_history", {
  id: serial("id").primaryKey(),
  pendingApprovalId: integer("pending_approval_id").notNull().references(() => pendingApprovals.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  changedByUserId: integer("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  changedByRole: text("changed_by_role"),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  reason: text("reason"),
  detailsJson: jsonb("details_json"),
}, (table) => ({
  pendingApprovalIdIdx: index("pah_pending_approval_id_idx").on(table.pendingApprovalId),
}));

export const insertPendingApprovalHistorySchema = createInsertSchema(pendingApprovalHistory).omit({ id: true, changedAt: true });
export type InsertPendingApprovalHistory = z.infer<typeof insertPendingApprovalHistorySchema>;
export type PendingApprovalHistory = typeof pendingApprovalHistory.$inferSelect;
