import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users } from "./users";
import { projectInfo } from "./projects";
import { counterparties } from "./finance";

// ===================== ENUMS =====================

export const meetingActionItemStatusEnum = pgEnum('meeting_action_item_status', ['pending', 'converted', 'dismissed']);
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected']);
export const eeInfoNodeStatusEnum = pgEnum('ee_info_node_status', ['stub', 'draft', 'published']);
export const eeInfoNodeCategoryEnum = pgEnum('ee_info_node_category', ['role', 'process', 'tool', 'template', 'other', 'unknown']);
export const eeInfoEdgeTypeEnum = pgEnum('ee_info_edge_type', ['link', 'embed', 'reference']);
export const pmActionTypeEnum = pgEnum('pm_action_type', [
  'site_visit', 'generate_po', 'link_invoice', 'raise_variation',
  'log_delay', 'log_risk', 'upload_photo', 'update_progress', 'escalate'
]);
export const pmActionStatusEnum = pgEnum('pm_action_status', [
  'pending', 'approved', 'rejected', 'completed'
]);
export const pmSafetyStatusEnum = pgEnum('pm_safety_status', ['clear', 'issue_open']);
export const msObjectTypeEnum = pgEnum('ms_object_type', ['email', 'event', 'teams', 'sharepoint_file']);
export const msAccountStatusEnum = pgEnum('ms_account_status', ['active', 'disconnected', 'expired']);
export const communicationFollowUpStatusEnum = pgEnum('communication_follow_up_status', ['pending', 'completed', 'dismissed']);
export const standupCadenceEnum = pgEnum('standup_cadence', ['DAILY', 'EVERY_2_DAYS', 'EVERY_3_DAYS', 'WEEKLY']);
export const standupMoodEnum = pgEnum('standup_mood', ['great', 'good', 'okay', 'struggling', 'blocked']);

// ===================== NOTIFICATIONS =====================

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  recipientUserId: integer("recipient_user_id").notNull().references(() => users.id),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  projectName: text("project_name"),
  linkedTaskId: integer("linked_task_id"),
  linkedDeliverableId: integer("linked_deliverable_id"),
  linkedWarningId: integer("linked_warning_id"),
  linkedPlanItemId: integer("linked_plan_item_id"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  requiresConfirmation: boolean("requires_confirmation").notNull().default(false),
  confirmedByUserId: integer("confirmed_by_user_id"),
  confirmedAt: timestamp("confirmed_at"),
  changeDetails: text("change_details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true } as any);
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export const notificationThrottle = pgTable("notification_throttle", {
  id: serial("id").primaryKey(),
  recipientUserId: integer("recipient_user_id").notNull().references(() => users.id),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  lastSentAt: timestamp("last_sent_at").notNull().defaultNow(),
});
export const insertNotificationThrottleSchema = createInsertSchema(notificationThrottle).omit({ id: true } as any);
export type InsertNotificationThrottle = z.infer<typeof insertNotificationThrottleSchema>;
export type NotificationThrottle = typeof notificationThrottle.$inferSelect;

// ===================== MEETINGS =====================

export const meetingSummaries = pgTable("meeting_summaries", {
  id: serial("id").primaryKey(),
  externalMeetingId: text("external_meeting_id"),
  title: text("title").notNull(),
  startTime: timestamp("start_time"),
  endTime: timestamp("end_time"),
  participants: text("participants").array(),
  summary: text("summary"),
  reportUrl: text("report_url"),
  source: text("source").notNull().default("read_ai"),
  rawPayload: text("raw_payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertMeetingSummarySchema = createInsertSchema(meetingSummaries).omit({ id: true, createdAt: true } as any);
export type InsertMeetingSummary = z.infer<typeof insertMeetingSummarySchema>;
export type MeetingSummary = typeof meetingSummaries.$inferSelect;

export const meetingActionItems = pgTable("meeting_action_items", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => meetingSummaries.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  owner: text("owner"),
  dueDate: text("due_date"),
  status: meetingActionItemStatusEnum("status").notNull().default("pending"),
  convertedToType: text("converted_to_type"),
  convertedToId: integer("converted_to_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertMeetingActionItemSchema = createInsertSchema(meetingActionItems).omit({ id: true, createdAt: true } as any);
export type InsertMeetingActionItem = z.infer<typeof insertMeetingActionItemSchema>;
export type MeetingActionItem = typeof meetingActionItems.$inferSelect;

// ===================== APPROVALS =====================

export const approvals = pgTable("approvals", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: approvalStatusEnum("status").notNull().default('pending'),
  requestedBy: integer("requested_by").notNull().references(() => users.id),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  decidedBy: integer("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at"),
  decisionNote: text("decision_note"),
  token: text("token"),
  expiresAt: timestamp("expires_at"),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: integer("related_entity_id"),
  assignedApprover: integer("assigned_approver").references(() => users.id),
  dueDate: timestamp("due_date"),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  approvalCategory: text("approval_category"),
});
export const insertApprovalSchema = createInsertSchema(approvals).omit({ id: true, requestedAt: true, decidedAt: true } as any);
export type InsertApproval = z.infer<typeof insertApprovalSchema>;
export type Approval = typeof approvals.$inferSelect;

// ===================== SUPPORT & FEEDBACK =====================

export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  summary: text("summary").notNull(),
  stepsToReproduce: text("steps_to_reproduce").notNull(),
  currentRoute: text("current_route"),
  userAgent: text("user_agent"),
  correlationId: text("correlation_id").notNull(),
  status: text("status").notNull().default('open'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({ id: true, createdAt: true } as any);
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;

export const feedbackTickets = pgTable("feedback_tickets", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("bug"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  submittedBy: integer("submitted_by").notNull(),
  submittedByName: text("submitted_by_name").notNull(),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertFeedbackTicketSchema = createInsertSchema(feedbackTickets).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertFeedbackTicket = z.infer<typeof insertFeedbackTicketSchema>;
export type FeedbackTicket = typeof feedbackTickets.$inferSelect;

// ===================== ENTITY ASSIGNMENTS =====================

export const entityAssignments = pgTable("entity_assignments", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id),
  assignmentRole: text("assignment_role").notNull().default("ASSIGNEE"),
  assigneeType: text("assignee_type").notNull(),
  assigneeId: integer("assignee_id").notNull(),
  displayLabelSnapshot: text("display_label_snapshot").notNull(),
  active: boolean("active").notNull().default(true),
  assignedByUserId: integer("assigned_by_user_id").references(() => users.id),
  clearedByUserId: integer("cleared_by_user_id").references(() => users.id),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  clearedAt: timestamp("cleared_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertEntityAssignmentSchema = createInsertSchema(entityAssignments).omit({ id: true, assignedAt: true, clearedAt: true, createdAt: true, updatedAt: true } as any);
export type InsertEntityAssignment = z.infer<typeof insertEntityAssignmentSchema>;
export type EntityAssignment = typeof entityAssignments.$inferSelect;
