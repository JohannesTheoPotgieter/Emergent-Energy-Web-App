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
export const auditSourceEnum = pgEnum('audit_source', ['UI', 'IMPORT', 'SETTINGS', 'DOCS', 'SYSTEM']);
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
  projectId: integer("project_id").references(() => projectInfo.id),
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
}, (table) => ({
  uniqueThrottle: unique("notification_throttle_recipient_event_entity").on(table.recipientUserId, table.eventType, table.entityType, table.entityId),
}));
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

// ===================== AUDIT EVENTS =====================

export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  actorRole: text("actor_role").notNull(),
  userId: integer("user_id"),
  userName: text("user_name"),
  source: auditSourceEnum("source").notNull().default('UI'),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  action: text("action").notNull(),
  changesJson: jsonb("changes_json"),
  projectName: text("project_name"),
  projectId: integer("project_id").references(() => projectInfo.id),
  correlationId: text("correlation_id"),
  ipAddress: text("ip_address"),
  requestPath: text("request_path"),
  requestMethod: text("request_method"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertAuditEventSchema = createInsertSchema(auditEvents).omit({ id: true, createdAt: true } as any);
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEvents.$inferSelect;

// ===================== EE INFO (Knowledge Base) =====================

export const eeInfoNodes = pgTable("ee_info_nodes", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  contentMarkdown: text("content_markdown"),
  status: text("status").notNull().default("stub"),
  category: text("category").notNull().default("unknown"),
  nodeType: text("node_type").notNull().default("content"),
  departmentSlug: text("department_slug"),
  lifecycleStages: jsonb("lifecycle_stages").$type<string[]>().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  sopData: jsonb("sop_data").$type<{
    purpose?: string;
    triggers?: string[];
    inputs?: string[];
    outputs?: string[];
    raci?: { role: string; responsible?: boolean; accountable?: boolean; consulted?: boolean; informed?: boolean }[];
    tools?: { name: string; url?: string; type?: string }[];
    templates?: { name: string; slug?: string; url?: string }[];
    reviewCadence?: string;
  }>(),
  parentNodeId: text("parent_node_id"),
  externalUrl: text("external_url"),
  tags: jsonb("tags").$type<string[]>().default([]),
  flowEnabled: boolean("flow_enabled").default(false),
  flowLane: text("flow_lane"),
  flowStepCode: text("flow_step_code"),
  nextSlugs: jsonb("next_slugs").$type<string[]>().default([]),
  prevSlugs: jsonb("prev_slugs").$type<string[]>().default([]),
  gateConditions: jsonb("gate_conditions").$type<string[]>().default([]),
  blockingConditions: jsonb("blocking_conditions").$type<string[]>().default([]),
  responsibleRole: text("responsible_role"),
  escalationRole: text("escalation_role"),
  primaryInstruction: text("primary_instruction"),
  stageCode: text("stage_code"),
  definitionOfDone: text("definition_of_done"),
  ownerRoleId: text("owner_role_id"),
  approverRoleId: text("approver_role_id"),
  requiredLinks: jsonb("required_links").$type<{ label: string; url: string; type?: string }[]>(),
  exampleArtifacts: jsonb("example_artifacts").$type<{ label: string; url: string }[]>(),
  exampleNotes: text("example_notes"),
  commonPitfalls: jsonb("common_pitfalls").$type<string[]>(),
  nextNodeId: text("next_node_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
});
export type EeInfoNode = typeof eeInfoNodes.$inferSelect;

export const eeInfoEdges = pgTable("ee_info_edges", {
  id: text("id").primaryKey(),
  fromNodeId: text("from_node_id").notNull().references(() => eeInfoNodes.id, { onDelete: "cascade" }),
  toNodeId: text("to_node_id").notNull().references(() => eeInfoNodes.id, { onDelete: "cascade" }),
  edgeType: text("edge_type").notNull().default("link"),
});
export type EeInfoEdge = typeof eeInfoEdges.$inferSelect;

export const eeInfoAssets = pgTable("ee_info_assets", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").references(() => eeInfoNodes.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  storagePath: text("storage_path").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  uploadedBy: text("uploaded_by"),
});
export type EeInfoAsset = typeof eeInfoAssets.$inferSelect;

export const eeInfoVersions = pgTable("ee_info_versions", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull().references(() => eeInfoNodes.id, { onDelete: "cascade" }),
  contentMarkdown: text("content_markdown"),
  changedBy: text("changed_by"),
  changedAt: timestamp("changed_at").defaultNow(),
  changeNote: text("change_note"),
});
export type EeInfoVersion = typeof eeInfoVersions.$inferSelect;

export const eeInfoSettings = pgTable("ee_info_settings", {
  id: serial("id").primaryKey(),
  seedImportCompleted: boolean("seed_import_completed").default(false),
  seedImportHash: text("seed_import_hash"),
  seedImportedAt: timestamp("seed_imported_at"),
  seedImportedBy: text("seed_imported_by"),
});
export type EeInfoSettings = typeof eeInfoSettings.$inferSelect;

export const eeInfoNodeDetails = pgTable("ee_info_node_details", {
  id: serial("id").primaryKey(),
  nodeId: text("node_id").notNull().unique().references(() => eeInfoNodes.id, { onDelete: "cascade" }),
  purpose: text("purpose"),
  inputs: text("inputs"),
  steps: text("steps"),
  outputs: text("outputs"),
  raci: jsonb("raci").$type<{ role: string; responsible?: boolean; accountable?: boolean; consulted?: boolean; informed?: boolean }[]>(),
  toolsDocs: jsonb("tools_docs").$type<{ name: string; url?: string; type?: string }[]>(),
  risksFailureModes: text("risks_failure_modes"),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: text("updated_by"),
});
export const insertEeInfoNodeDetailsSchema = createInsertSchema(eeInfoNodeDetails).omit({ id: true } as any);
export type InsertEeInfoNodeDetails = z.infer<typeof insertEeInfoNodeDetailsSchema>;
export type EeInfoNodeDetails = typeof eeInfoNodeDetails.$inferSelect;

export const eeInfoNodeEditors = pgTable("ee_info_node_editors", {
  id: serial("id").primaryKey(),
  nodeId: text("node_id").notNull().references(() => eeInfoNodes.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  canEdit: boolean("can_edit").notNull().default(true),
  canManageChildren: boolean("can_manage_children").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertEeInfoNodeEditorSchema = createInsertSchema(eeInfoNodeEditors).omit({ id: true, createdAt: true } as any);
export type InsertEeInfoNodeEditor = z.infer<typeof insertEeInfoNodeEditorSchema>;
export type EeInfoNodeEditor = typeof eeInfoNodeEditors.$inferSelect;

export const eeInfoNodeMetrics = pgTable("ee_info_node_metrics", {
  id: serial("id").primaryKey(),
  nodeId: text("node_id").notNull().references(() => eeInfoNodes.id, { onDelete: "cascade" }),
  metricKey: text("metric_key").notNull(),
  metricQueryType: text("metric_query_type").notNull().default("project_count"),
  config: jsonb("config").$type<Record<string, any>>(),
  displayFormat: text("display_format").notNull().default("number"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertEeInfoNodeMetricSchema = createInsertSchema(eeInfoNodeMetrics).omit({ id: true, createdAt: true } as any);
export type InsertEeInfoNodeMetric = z.infer<typeof insertEeInfoNodeMetricSchema>;
export type EeInfoNodeMetric = typeof eeInfoNodeMetrics.$inferSelect;

// ===================== GAMIFICATION =====================

export const userBadges = pgTable("user_badges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  badgeKey: text("badge_key").notNull(),
  awardedAt: timestamp("awarded_at").notNull().defaultNow(),
  meta: jsonb("meta"),
});
export type UserBadge = typeof userBadges.$inferSelect;

export const userPoints = pgTable("user_points", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  points: integer("points").notNull().default(0),
  category: text("category").notNull(),
  description: text("description"),
  awardedAt: timestamp("awarded_at").notNull().defaultNow(),
});
export type UserPoint = typeof userPoints.$inferSelect;

export const BADGE_DEFINITIONS: Record<string, { name: string; description: string; icon: string; threshold: number; category: string }> = {
  first_login: { name: "Welcome Aboard", description: "Logged into the platform", icon: "🚀", threshold: 1, category: "onboarding" },
  task_completer_10: { name: "Task Tackler", description: "Completed 10 tasks", icon: "✅", threshold: 10, category: "tasks" },
  task_completer_50: { name: "Task Machine", description: "Completed 50 tasks", icon: "⚡", threshold: 50, category: "tasks" },
  task_completer_100: { name: "Task Legend", description: "Completed 100 tasks", icon: "🏆", threshold: 100, category: "tasks" },
  approver_5: { name: "Gatekeeper", description: "Approved 5 items", icon: "🛡️", threshold: 5, category: "approvals" },
  approver_25: { name: "Chief Approver", description: "Approved 25 items", icon: "👑", threshold: 25, category: "approvals" },
  reviewer_3: { name: "Weekly Warrior", description: "Completed 3 weekly reviews", icon: "📋", threshold: 3, category: "reviews" },
  reviewer_10: { name: "Review Champion", description: "Completed 10 weekly reviews", icon: "🏅", threshold: 10, category: "reviews" },
  data_quality_5: { name: "Data Steward", description: "Resolved 5 data quality issues", icon: "🔍", threshold: 5, category: "data" },
  data_quality_20: { name: "Data Guardian", description: "Resolved 20 data quality issues", icon: "🛡️", threshold: 20, category: "data" },
  importer_3: { name: "Import Pro", description: "Completed 3 successful imports", icon: "📥", threshold: 3, category: "imports" },
  importer_10: { name: "Import Master", description: "Completed 10 successful imports", icon: "📊", threshold: 10, category: "imports" },
  collaborator_10: { name: "Team Player", description: "Made 10 project updates", icon: "🤝", threshold: 10, category: "collaboration" },
  collaborator_50: { name: "Collaboration King", description: "Made 50 project updates", icon: "👥", threshold: 50, category: "collaboration" },
  streak_7: { name: "On Fire", description: "7-day activity streak", icon: "🔥", threshold: 7, category: "streaks" },
  streak_30: { name: "Unstoppable", description: "30-day activity streak", icon: "💎", threshold: 30, category: "streaks" },
  quality_champion_5: { name: "Quality First", description: "Approved 5 quality checklist items", icon: "✨", threshold: 5, category: "quality" },
  eng_milestone_3: { name: "Engineering Star", description: "Completed 3 engineering stages", icon: "⭐", threshold: 3, category: "engineering" },
  eng_task_owner_3: { name: "Engineer Rising", description: "Assigned to 3 engineering tasks", icon: "🔧", threshold: 3, category: "engineering" },
  eng_task_owner_10: { name: "Engineering Ace", description: "Assigned to 10 engineering tasks", icon: "🛠️", threshold: 10, category: "engineering" },
  ops_contributor_3: { name: "Ops Starter", description: "Assigned to 3 operational tasks", icon: "📌", threshold: 3, category: "tasks" },
  ops_contributor_10: { name: "Ops Veteran", description: "Assigned to 10 operational tasks", icon: "🎯", threshold: 10, category: "tasks" },
  deliverable_pro_5: { name: "Deliverable Pro", description: "Uploaded 5 deliverables", icon: "📎", threshold: 5, category: "engineering" },
  penalty_overdue_repeat: { name: "Deadline Dodger", description: "5+ overdue tasks — time to catch up!", icon: "⏰", threshold: 5, category: "penalties" },
  penalty_overdue_chronic: { name: "Chronic Overdue", description: "10+ overdue tasks — needs urgent attention", icon: "🚨", threshold: 10, category: "penalties" },
  penalty_quality_concern: { name: "Quality Concern", description: "5+ quality failures recorded", icon: "⚠️", threshold: 5, category: "penalties" },
  penalty_eng_task_slipping: { name: "Engineering Slip", description: "3+ overdue engineering tasks", icon: "🔩", threshold: 3, category: "penalties" },
  penalty_eng_task_overdue: { name: "Engineering Bottleneck", description: "5+ overdue engineering tasks — blocking progress", icon: "🛑", threshold: 5, category: "penalties" },
  penalty_inbox_pileup: { name: "Inbox Pileup", description: "10+ unread notifications older than 3 days", icon: "📬", threshold: 10, category: "penalties" },
  penalty_inbox_neglect: { name: "Inbox Neglect", description: "20+ unread notifications — stay informed!", icon: "🙈", threshold: 20, category: "penalties" },
  penalty_qm_slipping: { name: "QM Slipping", description: "3+ overdue quality tasks on your projects", icon: "📉", threshold: 3, category: "penalties" },
  penalty_qm_overdue: { name: "QM Bottleneck", description: "5+ overdue quality tasks — quality at risk", icon: "🔴", threshold: 5, category: "penalties" },
  clean_record: { name: "Clean Record", description: "No penalties — zero overdue, behind, or quality issues", icon: "🌟", threshold: 0, category: "excellence" },
};

// ===================== TEAMS CHAT =====================

export const teamsChatGroups = pgTable("teams_chat_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  groupType: text("group_type").notNull().default("department"),
  department: text("department"),
  projectName: text("project_name"),
  projectId: integer("project_id").references(() => projectInfo.id),
  teamsChatId: text("teams_chat_id"),
  description: text("description"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertTeamsChatGroupSchema = createInsertSchema(teamsChatGroups).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertTeamsChatGroup = z.infer<typeof insertTeamsChatGroupSchema>;
export type TeamsChatGroup = typeof teamsChatGroups.$inferSelect;

export const teamsChatMembers = pgTable("teams_chat_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => teamsChatGroups.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  addedBy: integer("added_by").references(() => users.id),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});
export const insertTeamsChatMemberSchema = createInsertSchema(teamsChatMembers).omit({ id: true, addedAt: true } as any);
export type InsertTeamsChatMember = z.infer<typeof insertTeamsChatMemberSchema>;
export type TeamsChatMember = typeof teamsChatMembers.$inferSelect;

export const teamsChatMessages = pgTable("teams_chat_messages", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => teamsChatGroups.id, { onDelete: "cascade" }),
  senderUserId: integer("sender_user_id").references(() => users.id),
  senderName: text("sender_name"),
  content: text("content").notNull(),
  teamsMessageId: text("teams_message_id"),
  isFromTeams: boolean("is_from_teams").notNull().default(false),
  fileName: text("file_name"),
  filePath: text("file_path"),
  fileSize: integer("file_size"),
  fileType: text("file_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertTeamsChatMessageSchema = createInsertSchema(teamsChatMessages).omit({ id: true, createdAt: true } as any);
export type InsertTeamsChatMessage = z.infer<typeof insertTeamsChatMessageSchema>;
export type TeamsChatMessage = typeof teamsChatMessages.$inferSelect;

// ===================== DASHBOARD CONFIG =====================

export const dashboardWidgetConfig = pgTable("dashboard_widget_config", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  widgetOrder: jsonb("widget_order").notNull().$type<string[]>(),
  hiddenWidgets: jsonb("hidden_widgets").notNull().$type<string[]>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertDashboardWidgetConfigSchema = createInsertSchema(dashboardWidgetConfig).omit({ id: true, updatedAt: true } as any);
export type InsertDashboardWidgetConfig = z.infer<typeof insertDashboardWidgetConfigSchema>;
export type DashboardWidgetConfig = typeof dashboardWidgetConfig.$inferSelect;

export const DEFAULT_WIDGET_ORDER = [
  "quick_actions",
  "my_projects",
  "company_priorities",
  "action_banner",
  "portfolio_health",
  "financial_headline",
  "alerts",
  "priority_queue",
  "stat_cards",
  "schedule_risk",
  "quality_overview",
  "engineering_queue",
  "data_health",
  "my_tasks",
  "pending_approvals",
  "notifications",
] as const;

export const WIDGET_DEFINITIONS: Record<string, { label: string; description: string; roles?: string[] }> = {
  quick_actions: { label: "Quick Actions", description: "Fast shortcuts to your most-used pages" },
  my_projects: { label: "My Projects", description: "Projects assigned to you with status and progress", roles: ["CEO_ADMIN", "COO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "CONSTRUCTION_MANAGER", "PROJECT_MANAGER_SITE", "PROJECT_DEVELOPER"] },
  company_priorities: { label: "Company Priorities", description: "Organisation-wide priority items" },
  action_banner: { label: "Attention Banner", description: "Alert bar for overdue tasks and pending approvals" },
  portfolio_health: { label: "Portfolio Health", description: "Portfolio delivery KPIs and project status overview", roles: ["CEO_ADMIN", "COO_ADMIN", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER"] },
  financial_headline: { label: "Financial Headline", description: "Revenue, margin, and cash position summary", roles: ["CEO_ADMIN", "COO_ADMIN", "CFO", "PROGRAM_FINANCE_MANAGER"] },
  alerts: { label: "Alerts", description: "Risk flags, stale imports, budget overruns, and blockers" },
  priority_queue: { label: "Priority Queue", description: "Your most urgent action items sorted by urgency" },
  stat_cards: { label: "Statistics Cards", description: "Quick summary of notifications, tasks, approvals" },
  schedule_risk: { label: "Schedule Risk", description: "Projects behind plan with slippage details", roles: ["CEO_ADMIN", "COO_ADMIN", "PROGRAM_MANAGER", "CONSTRUCTION_MANAGER", "PROJECT_MANAGER_SITE"] },
  quality_overview: { label: "Quality Overview", description: "QA gate status and quality warnings summary", roles: ["COO_ADMIN", "QUALITY_MANAGER", "CONSTRUCTION_MANAGER"] },
  engineering_queue: { label: "Engineering Queue", description: "Your engineering tasks and pending reviews", roles: ["ENGINEER", "ENGINEERING_MANAGER"] },
  data_health: { label: "Data Health", description: "Import staleness and data integrity warnings across projects", roles: ["COO_ADMIN", "CEO_ADMIN"] },
  my_tasks: { label: "My Tasks", description: "List of tasks assigned to you", roles: ["CEO_ADMIN", "COO_ADMIN", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "CONSTRUCTION_MANAGER", "ENGINEERING_MANAGER", "ENGINEER", "PROJECT_MANAGER_SITE", "QUALITY_MANAGER"] },
  pending_approvals: { label: "Pending Approvals", description: "Approvals waiting for your action", roles: ["CEO_ADMIN", "COO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "CONSTRUCTION_MANAGER", "ENGINEERING_MANAGER", "QUALITY_MANAGER"] },
  notifications: { label: "Notifications", description: "Recent and action-required notifications" },
};

export const ROLE_QUICK_ACTIONS: Record<string, Array<{ label: string; path: string; icon: string }>> = {
  CEO_ADMIN: [
    { label: "Portfolio Overview", path: "/dashboard", icon: "BarChart3" },
    { label: "Cashflow", path: "/cashflow", icon: "Wallet" },
    { label: "Approvals", path: "/admin/approvals", icon: "ClipboardCheck" },
    { label: "Lifecycle Board", path: "/lifecycle-board", icon: "Layers" },
  ],
  COO_ADMIN: [
    { label: "Lifecycle Board", path: "/lifecycle-board", icon: "Layers" },
    { label: "Smart Import", path: "/smart-import", icon: "FileSpreadsheet" },
    { label: "Admin Settings", path: "/admin/settings", icon: "Settings" },
    { label: "Approvals", path: "/admin/approvals", icon: "ClipboardCheck" },
    { label: "Activity Log", path: "/admin/activity-log", icon: "Activity" },
  ],
  CFO: [
    { label: "Cashflow", path: "/cashflow", icon: "Wallet" },
    { label: "COS Tracker", path: "/cos", icon: "TrendingUp" },
    { label: "Approvals", path: "/admin/approvals", icon: "ClipboardCheck" },
    { label: "Invoice Patterns", path: "/invoice-patterns", icon: "FileSpreadsheet" },
  ],
  PROGRAM_MANAGER: [
    { label: "Execution Board", path: "/dashboard", icon: "Gauge" },
    { label: "Smart Import", path: "/smart-import", icon: "FileSpreadsheet" },
    { label: "TR Register", path: "/tr-register", icon: "ClipboardList" },
    { label: "Portfolios", path: "/portfolios", icon: "FolderOpen" },
  ],
  PROGRAM_FINANCE_MANAGER: [
    { label: "COS Tracker", path: "/cos", icon: "TrendingUp" },
    { label: "Cashflow", path: "/cashflow", icon: "Wallet" },
    { label: "Invoice Patterns", path: "/invoice-patterns", icon: "FileSpreadsheet" },
    { label: "Smart Import", path: "/smart-import", icon: "FileSpreadsheet" },
  ],
  CONSTRUCTION_MANAGER: [
    { label: "Engineering Tasks", path: "/engineering/tasks", icon: "ListTodo" },
    { label: "Quality Dashboard", path: "/quality", icon: "ShieldCheck" },
    { label: "Projects", path: "/projects", icon: "FolderKanban" },
    { label: "TR Register", path: "/tr-register", icon: "ClipboardList" },
  ],
  QUALITY_MANAGER: [
    { label: "Quality Dashboard", path: "/quality", icon: "ShieldCheck" },
    { label: "Projects", path: "/projects", icon: "FolderKanban" },
    { label: "Engineering", path: "/engineering", icon: "HardHat" },
  ],
  ENGINEERING_MANAGER: [
    { label: "Engineering", path: "/engineering", icon: "HardHat" },
    { label: "Task Board", path: "/engineering/tasks", icon: "ListTodo" },
    { label: "Engineering Inbox", path: "/engineering/inbox", icon: "Inbox" },
    { label: "Quality", path: "/quality", icon: "ShieldCheck" },
  ],
  ENGINEER: [
    { label: "Task Board", path: "/engineering/tasks", icon: "ListTodo" },
    { label: "Engineering Inbox", path: "/engineering/inbox", icon: "Inbox" },
    { label: "Projects", path: "/projects", icon: "FolderKanban" },
  ],
  PROJECT_MANAGER_SITE: [
    { label: "PM Dashboard", path: "/pm-dashboard", icon: "Briefcase" },
    { label: "Projects", path: "/projects", icon: "FolderKanban" },
    { label: "COS Tracker", path: "/cos", icon: "TrendingUp" },
    { label: "Engineering Tasks", path: "/engineering/tasks", icon: "ListTodo" },
  ],
  PROJECT_DEVELOPER: [
    { label: "PD Dashboard", path: "/pd", icon: "FileEdit" },
    { label: "PD Tickets", path: "/pd/tickets", icon: "ClipboardList" },
    { label: "Projects", path: "/projects", icon: "FolderKanban" },
    { label: "Cashflow", path: "/cashflow", icon: "Wallet" },
  ],
  CCO: [
    { label: "Portfolio Overview", path: "/dashboard", icon: "BarChart3" },
    { label: "Projects", path: "/projects", icon: "FolderKanban" },
    { label: "Cashflow", path: "/cashflow", icon: "Wallet" },
  ],
  ACCOUNTANT: [
    { label: "Cashflow", path: "/cashflow", icon: "Wallet" },
    { label: "COS Tracker", path: "/cos", icon: "TrendingUp" },
    { label: "Projects", path: "/projects", icon: "FolderKanban" },
  ],
  KEY_ACCOUNTS_MANAGER: [
    { label: "Projects", path: "/projects", icon: "FolderKanban" },
    { label: "Portfolios", path: "/portfolios", icon: "FolderOpen" },
  ],
};

export function getWidgetsForRole(role: string): string[] {
  return Object.keys(WIDGET_DEFINITIONS).filter(id => {
    const def = WIDGET_DEFINITIONS[id];
    if (!def.roles) return true;
    return def.roles.includes(role);
  });
}

// ===================== PM ON-THE-GO =====================

export const pmSiteVisits = pgTable("pm_site_visits", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id").notNull(),
  visitDate: date("visit_date").notNull(),
  notes: text("notes"),
  weatherConditions: text("weather_conditions"),
  safetyStatus: pmSafetyStatusEnum("safety_status").default("clear"),
  photoIds: jsonb("photo_ids").default([]),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: text("updated_by"),
  source: text("source").default("on_the_go"),
});
export const insertPmSiteVisitSchema = createInsertSchema(pmSiteVisits).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertPmSiteVisit = z.infer<typeof insertPmSiteVisitSchema>;
export type PmSiteVisit = typeof pmSiteVisits.$inferSelect;

export const pmOnTheGoActions = pgTable("pm_on_the_go_actions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id").notNull(),
  actionType: pmActionTypeEnum("action_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  severity: text("severity"),
  amount: decimal("amount", { precision: 15, scale: 2 }),
  status: pmActionStatusEnum("status").default("pending"),
  relatedEntityId: integer("related_entity_id"),
  relatedEntityType: text("related_entity_type"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: text("updated_by"),
  source: text("source").default("on_the_go"),
});
export const insertPmOnTheGoActionSchema = createInsertSchema(pmOnTheGoActions).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertPmOnTheGoAction = z.infer<typeof insertPmOnTheGoActionSchema>;
export type PmOnTheGoAction = typeof pmOnTheGoActions.$inferSelect;

export const pmComplianceTracking = pgTable("pm_compliance_tracking", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id").notNull(),
  weekStartDate: date("week_start_date").notNull(),
  dailyDiaryDone: jsonb("daily_diary_done").default([]),
  weeklyProgressDone: boolean("weekly_progress_done").default(false),
  weeklyRiskDone: boolean("weekly_risk_done").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  uniqueProjectUserWeek: unique("pm_compliance_tracking_unique").on(table.projectId, table.userId, table.weekStartDate),
}));
export type PmComplianceTracking = typeof pmComplianceTracking.$inferSelect;

export const pmModePreferences = pgTable("pm_mode_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  preferredMode: text("preferred_mode").default("full_detail"),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertPmModePreferenceSchema = createInsertSchema(pmModePreferences).omit({ id: true, updatedAt: true } as any);
export type InsertPmModePreference = z.infer<typeof insertPmModePreferenceSchema>;
export type PmModePreference = typeof pmModePreferences.$inferSelect;

// ===================== MS INTEGRATION =====================

export const msAccounts = pgTable("ms_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  msUserId: text("ms_user_id").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  ssoAccessToken: text("sso_access_token"),
  ssoTokenExpiresAt: timestamp("sso_token_expires_at"),
  connectedAt: timestamp("connected_at").defaultNow(),
  status: msAccountStatusEnum("status").default("active"),
});
export const insertMsAccountSchema = createInsertSchema(msAccounts).omit({ id: true, connectedAt: true } as any);
export type InsertMsAccount = z.infer<typeof insertMsAccountSchema>;
export type MsAccount = typeof msAccounts.$inferSelect;

export const msObjects = pgTable("ms_objects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: msObjectTypeEnum("type").notNull(),
  msId: text("ms_id").notNull(),
  subjectOrTitle: text("subject_or_title"),
  preview: text("preview"),
  webLink: text("web_link"),
  senderOrOrganizer: text("sender_or_organizer"),
  receivedOrStartDatetime: timestamp("received_or_start_datetime"),
  endDatetime: timestamp("end_datetime"),
  lastSyncedAt: timestamp("last_synced_at").defaultNow(),
  actionRequired: boolean("action_required").default(false),
  isRead: boolean("is_read").default(true),
  importance: text("importance"),
  linkedProjectId: integer("linked_project_id"),
  linkedTaskId: integer("linked_task_id"),
  metadata: jsonb("metadata"),
  dismissed: boolean("dismissed").default(false),
});
export const insertMsObjectSchema = createInsertSchema(msObjects).omit({ id: true, lastSyncedAt: true } as any);
export type InsertMsObject = z.infer<typeof insertMsObjectSchema>;
export type MsObject = typeof msObjects.$inferSelect;

export const projectLinks = pgTable("project_links", {
  id: serial("id").primaryKey(),
  msObjectId: integer("ms_object_id").notNull(),
  projectId: integer("project_id").notNull(),
  linkedByUserId: integer("linked_by_user_id").notNull(),
  linkedAt: timestamp("linked_at").defaultNow(),
  note: text("note"),
});
export const insertProjectLinkSchema = createInsertSchema(projectLinks).omit({ id: true, linkedAt: true } as any);
export type InsertProjectLink = z.infer<typeof insertProjectLinkSchema>;
export type ProjectLink = typeof projectLinks.$inferSelect;

// ===================== COMMUNICATION TIMELINE =====================

export const projectCommunicationTimelineEvents = pgTable("project_communication_timeline_events", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  msObjectId: integer("ms_object_id"),
  eventType: text("event_type").notNull(),
  eventTitle: text("event_title").notNull(),
  eventDetail: text("event_detail"),
  relatedTaskId: integer("related_task_id"),
  actorUserId: integer("actor_user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectCommunicationTimelineEventSchema = createInsertSchema(projectCommunicationTimelineEvents).omit({ id: true, createdAt: true } as any);
export type InsertProjectCommunicationTimelineEvent = z.infer<typeof insertProjectCommunicationTimelineEventSchema>;
export type ProjectCommunicationTimelineEvent = typeof projectCommunicationTimelineEvents.$inferSelect;

export const communicationFollowUps = pgTable("communication_follow_ups", {
  id: serial("id").primaryKey(),
  msObjectId: integer("ms_object_id").notNull(),
  projectId: integer("project_id"),
  taskId: integer("task_id").notNull(),
  taskType: text("task_type").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  dueAt: timestamp("due_at"),
  reminderAt: timestamp("reminder_at"),
  reminderSentAt: timestamp("reminder_sent_at"),
  status: communicationFollowUpStatusEnum("status").notNull().default('pending'),
  createdBy: integer("created_by").notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertCommunicationFollowUpSchema = createInsertSchema(communicationFollowUps).omit({ id: true, createdAt: true } as any);
export type InsertCommunicationFollowUp = z.infer<typeof insertCommunicationFollowUpSchema>;
export type CommunicationFollowUp = typeof communicationFollowUps.$inferSelect;

// ===================== STANDUPS =====================

export const standupSchedules = pgTable("standup_schedules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  teamLabel: text("team_label"),
  projectId: integer("project_id").references(() => projectInfo.id),
  cadence: standupCadenceEnum("cadence").notNull().default("EVERY_2_DAYS"),
  cadenceDays: integer("cadence_days").notNull().default(2),
  anchorDate: text("anchor_date").notNull(),
  deadlineTime: text("deadline_time").default("10:00"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertStandupScheduleSchema = createInsertSchema(standupSchedules).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertStandupSchedule = z.infer<typeof insertStandupScheduleSchema>;
export type StandupSchedule = typeof standupSchedules.$inferSelect;

export const standupParticipants = pgTable("standup_participants", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull().references(() => standupSchedules.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  isRequired: boolean("is_required").notNull().default(true),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});
export const insertStandupParticipantSchema = createInsertSchema(standupParticipants).omit({ id: true, addedAt: true } as any);
export type InsertStandupParticipant = z.infer<typeof insertStandupParticipantSchema>;
export type StandupParticipant = typeof standupParticipants.$inferSelect;

export const standupEntries = pgTable("standup_entries", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull().references(() => standupSchedules.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  standupDate: text("standup_date").notNull(),
  whatIDid: text("what_i_did"),
  whatImDoing: text("what_im_doing"),
  blockers: text("blockers"),
  mood: standupMoodEnum("mood"),
  isLate: boolean("is_late").notNull().default(false),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertStandupEntrySchema = createInsertSchema(standupEntries).omit({ id: true, submittedAt: true, updatedAt: true } as any);
export type InsertStandupEntry = z.infer<typeof insertStandupEntrySchema>;
export type StandupEntry = typeof standupEntries.$inferSelect;

// ===================== DOMAIN EVENTS ARCHITECTURE (Prompt 13) =====================

export const eventProcessingStatusEnum = pgEnum('event_processing_status', ['success', 'failed', 'skipped']);

export const domainEvents = pgTable("domain_events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: integer("aggregate_id").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id),
  triggeredBy: integer("triggered_by").references(() => users.id),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
});
export type DomainEvent = typeof domainEvents.$inferSelect;
export type InsertDomainEvent = typeof domainEvents.$inferInsert;

export const eventSubscriptions = pgTable("event_subscriptions", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  handlerName: text("handler_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type EventSubscription = typeof eventSubscriptions.$inferSelect;

export const eventProcessingLog = pgTable("event_processing_log", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => domainEvents.id),
  handlerName: text("handler_name").notNull(),
  status: eventProcessingStatusEnum("status").notNull(),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
  durationMs: integer("duration_ms"),
});
export type EventProcessingLog = typeof eventProcessingLog.$inferSelect;
