// C3: HSE module schema — incidents and corrective actions

import { pgTable, text, integer, timestamp, serial, date, boolean } from "drizzle-orm/pg-core";
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

export const insertHseIncidentSchema = createInsertSchema(hseIncidents).omit({ id: true, createdAt: true, updatedAt: true });
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

export const insertCorrectiveActionSchema = createInsertSchema(correctiveActions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCorrectiveAction = z.infer<typeof insertCorrectiveActionSchema>;
export type CorrectiveAction = typeof correctiveActions.$inferSelect;

// ===================== B7: SAFETY FILE ITEMS =====================
// OHSA Section 7 + Construction Regulations 7 require every principal
// contractor to maintain a Safety File on site for every active project.
// This table tracks the individual Safety File items (documents,
// registers, certificates) per project.
//
// Permission model (mirrors B3 HSE incidents):
//   - Any authenticated user can CREATE an item (site workers, PMs,
//     Engineering, Construction all need to be able to log items as
//     they encounter them).
//   - Any authenticated user can EDIT descriptive fields (due date,
//     SharePoint link, notes, upload timestamp, etc.).
//   - Only HSE-approving roles (HSE_MANAGER, COO_ADMIN, CEO_ADMIN) can
//     change the `compliance_status` field — the final sign-off lives
//     with HSE.
//
// Auto-seed: when a PD->PM handover is accepted, the seed helper
// inserts the OHSA-required items listed in DEFAULT_SAFETY_FILE_SEED
// below with due_date = acceptedAt + 7 days (per the SOP).

export const SAFETY_FILE_COMPLIANCE_STATUSES = [
  "pending",     // Item is required but nothing uploaded yet
  "submitted",   // Document uploaded / attached, waiting for HSE review
  "approved",    // HSE reviewed and approved
  "rejected",    // HSE reviewed and rejected — submitter must fix
  "expired",     // Document was approved but has lapsed (insurance, medicals)
  "not_applicable", // HSE marked this item as not required for this project
] as const;
export type SafetyFileComplianceStatus = typeof SAFETY_FILE_COMPLIANCE_STATUSES[number];

export const safetyFileItems = pgTable("safety_file_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  itemCode: text("item_code").notNull(),                // machine-readable code (e.g. 'letter_of_good_standing')
  itemName: text("item_name").notNull(),                // human-readable label shown in the UI
  category: text("category").notNull().default("other"), // 'statutory','registers','appointments','method_statements','emergency','other'
  required: boolean("required").notNull().default(true),
  dueDate: date("due_date"),
  uploadedAt: timestamp("uploaded_at"),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  sharepointRef: text("sharepoint_ref"),                // URL to the document
  complianceStatus: text("compliance_status").notNull().default("pending"),
  approvedAt: timestamp("approved_at"),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectedReason: text("rejected_reason"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertSafetyFileItemSchema = createInsertSchema(safetyFileItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSafetyFileItem = z.infer<typeof insertSafetyFileItemSchema>;
export type SafetyFileItem = typeof safetyFileItems.$inferSelect;

/**
 * Canonical OHSA-compliant default Safety File items that are auto-seeded
 * when a PD->PM handover is accepted. Keep this list focused: 12 items
 * covers the statutory minimum without overwhelming the HSE team. Anyone
 * can add more items via POST /api/projects/:projectId/safety-file/items
 * for project-specific hazards or customer contractual extras.
 */
export const DEFAULT_SAFETY_FILE_SEED: Array<{
  itemCode: string;
  itemName: string;
  category: string;
}> = [
  // ── Statutory documents (COID, insurance, agreements) ────────────────
  { itemCode: "letter_of_good_standing",   itemName: "Letter of Good Standing (COID)",              category: "statutory" },
  { itemCode: "public_liability_insurance", itemName: "Public Liability Insurance Certificate",       category: "statutory" },
  { itemCode: "section_37_agreement",      itemName: "Section 37(2) Mandatory Agreement",            category: "statutory" },

  // ── Core HSE plans and assessments ───────────────────────────────────
  { itemCode: "health_safety_plan",        itemName: "Construction Health & Safety Plan",            category: "statutory" },
  { itemCode: "baseline_risk_assessment",  itemName: "Baseline Risk Assessment",                     category: "statutory" },
  { itemCode: "method_statements",         itemName: "Safe Work Method Statements (high-risk tasks)", category: "method_statements" },

  // ── Formal appointments (Construction Regulations 8) ─────────────────
  { itemCode: "cr_appointments",           itemName: "Construction Regulations Appointment Letters",  category: "appointments" },

  // ── On-site registers ────────────────────────────────────────────────
  { itemCode: "site_induction_register",   itemName: "Site Induction Register",                      category: "registers" },
  { itemCode: "ppe_register",              itemName: "PPE Issue Register",                           category: "registers" },
  { itemCode: "medical_certificates",      itemName: "Worker Medical Fitness Certificates",          category: "registers" },
  { itemCode: "incident_register",         itemName: "Section 24 Incident Register",                 category: "registers" },

  // ── Emergency preparedness ───────────────────────────────────────────
  { itemCode: "emergency_plan",            itemName: "Emergency Preparedness Plan",                  category: "emergency" },
];
