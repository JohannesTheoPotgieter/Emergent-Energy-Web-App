// C3: HSE module schema — incidents and corrective actions

import { pgTable, text, integer, timestamp, serial, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo, sites } from "./projects";

// ===================== HSE INCIDENTS =====================

export const hseIncidents = pgTable("hse_incidents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  siteId: integer("site_id").references(() => sites.id),
  incidentDate: date("incident_date").notNull(),
  incidentType: text("incident_type").notNull(),    // 'near_miss', 'first_aid', 'medical', 'lost_time', 'fatality', 'environmental', 'property_damage'
  severity: text("severity").notNull(),             // 'low', 'medium', 'high', 'critical'
  description: text("description").notNull(),
  reportedByUserId: integer("reported_by_user_id").references(() => users.id, { onDelete: "set null" }),
  location: text("location"),
  rootCause: text("root_cause"),
  immediateActions: text("immediate_actions"),
  status: text("status").default("open"),           // 'open', 'investigating', 'corrective_action', 'closed'
  evidenceLink: text("evidence_link"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertHseIncidentSchema = createInsertSchema(hseIncidents).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertHseIncident = z.infer<typeof insertHseIncidentSchema>;
export type HseIncident = typeof hseIncidents.$inferSelect;

// ===================== CORRECTIVE ACTIONS =====================

export const correctiveActions = pgTable("corrective_actions", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type").notNull(),        // 'hse_incident', 'ncr', 'snag', 'audit', 'inspection'
  sourceId: integer("source_id").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  assignedToUserId: integer("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  dueDate: date("due_date"),
  status: text("status").default("open"),           // 'open', 'in_progress', 'completed', 'verified', 'overdue'
  completionDate: date("completion_date"),
  evidenceLink: text("evidence_link"),
  verifiedByUserId: integer("verified_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertCorrectiveActionSchema = createInsertSchema(correctiveActions).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertCorrectiveAction = z.infer<typeof insertCorrectiveActionSchema>;
export type CorrectiveAction = typeof correctiveActions.$inferSelect;
