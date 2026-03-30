import { pgTable, text, integer, timestamp, serial, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo } from "./projects";

// ===================== TEMPLATE OVERRIDES =====================
// Project-level or org-wide overrides of system/admin template defaults.
// Each override stores the customized template content as JSONB,
// linked back to the source template for audit and reset capability.

export const TEMPLATE_TYPES = ['stage_checklist', 'eng_stage', 'qc', 'intake'] as const;
export type TemplateType = typeof TEMPLATE_TYPES[number];

export const templateOverrides = pgTable("template_overrides", {
  id: serial("id").primaryKey(),
  templateType: text("template_type").notNull(),               // 'stage_checklist' | 'eng_stage' | 'qc' | 'intake'
  sourceTemplateId: integer("source_template_id").notNull(),   // FK to original template (not enforced — polymorphic)
  projectId: integer("project_id").references(() => projectInfo.id), // NULL = org-wide override
  overrideData: jsonb("override_data").notNull(),              // customized template content
  overrideReason: text("override_reason").notNull(),
  overriddenBy: integer("overridden_by").references(() => users.id),
  overriddenAt: timestamp("overridden_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTemplateOverrideSchema = createInsertSchema(templateOverrides).omit({
  id: true, createdAt: true, updatedAt: true, overriddenAt: true, deletedAt: true, deletedBy: true,
} as any);
export type InsertTemplateOverride = z.infer<typeof insertTemplateOverrideSchema>;
export type TemplateOverride = typeof templateOverrides.$inferSelect;
