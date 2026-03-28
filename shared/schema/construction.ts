// C1: Construction module schema — site activities, snags, inspections, contractor assignments

import { pgTable, text, integer, decimal, timestamp, serial, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo, sites } from "./projects";

// ===================== SITE ACTIVITIES =====================

export const siteActivities = pgTable("site_activities", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  siteId: integer("site_id").references(() => sites.id),
  activityDate: date("activity_date").notNull(),
  activityType: text("activity_type").notNull(),    // 'daily_log', 'inspection', 'toolbox_talk', 'incident', 'material_receipt', 'permit'
  title: text("title").notNull(),
  description: text("description"),
  reportedByUserId: integer("reported_by_user_id").references(() => users.id),
  status: text("status").default("open"),           // 'open', 'closed', 'flagged'
  weather: text("weather"),
  crewCount: integer("crew_count"),
  photos: text("photos"),                           // JSON array of SharePoint links
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertSiteActivitySchema = createInsertSchema(siteActivities).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertSiteActivity = z.infer<typeof insertSiteActivitySchema>;
export type SiteActivity = typeof siteActivities.$inferSelect;

// ===================== SNAGS =====================

export const snags = pgTable("snags", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  siteId: integer("site_id").references(() => sites.id),
  title: text("title").notNull(),
  description: text("description"),
  severity: text("severity").default("minor"),      // 'critical', 'major', 'minor', 'observation'
  location: text("location"),
  reportedByUserId: integer("reported_by_user_id").references(() => users.id),
  assignedToUserId: integer("assigned_to_user_id").references(() => users.id),
  dueDate: date("due_date"),
  status: text("status").default("open"),           // 'open', 'in_progress', 'resolved', 'verified', 'closed'
  resolution: text("resolution"),
  evidenceLink: text("evidence_link"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertSnagSchema = createInsertSchema(snags).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertSnag = z.infer<typeof insertSnagSchema>;
export type Snag = typeof snags.$inferSelect;

// ===================== SITE INSPECTIONS =====================

export const siteInspections = pgTable("site_inspections", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  siteId: integer("site_id").references(() => sites.id),
  inspectionType: text("inspection_type").notNull(), // 'hold_point', 'witness_point', 'routine', 'final', 'joint_tenant'
  inspectorUserId: integer("inspector_user_id").references(() => users.id),
  inspectionDate: date("inspection_date"),
  result: text("result"),                           // 'pass', 'fail', 'conditional', 'pending'
  notes: text("notes"),
  evidenceLink: text("evidence_link"),
  linkedSnagIds: text("linked_snag_ids"),           // JSON array of snag IDs
  status: text("status").default("scheduled"),      // 'scheduled', 'in_progress', 'completed', 'cancelled'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertSiteInspectionSchema = createInsertSchema(siteInspections).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertSiteInspection = z.infer<typeof insertSiteInspectionSchema>;
export type SiteInspection = typeof siteInspections.$inferSelect;

// ===================== CONTRACTOR ASSIGNMENTS =====================

export const contractorAssignments = pgTable("contractor_assignments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  counterpartyId: integer("counterparty_id"),       // References counterparties(id) - left as integer to avoid circular import
  scope: text("scope"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  performanceRating: integer("performance_rating"), // 1-5
  notes: text("notes"),
  status: text("status").default("active"),         // 'active', 'completed', 'terminated'
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertContractorAssignmentSchema = createInsertSchema(contractorAssignments).omit({ id: true, createdAt: true } as any);
export type InsertContractorAssignment = z.infer<typeof insertContractorAssignmentSchema>;
export type ContractorAssignment = typeof contractorAssignments.$inferSelect;
