import { pgTable, serial, integer, text, boolean, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { projectInfo } from "./projects";
import { users } from "./users";

// ===================== COMMISSIONING SOURCE =====================

export const commissioningSources = pgTable("commissioning_sources", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  sourceType: text("source_type").notNull().default("sharepoint"),
  driveId: text("drive_id"),
  itemId: text("item_id"),
  filePath: text("file_path"),
  workbookUrl: text("workbook_url"),
  folderUrl: text("folder_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdBy: integer("created_by").references(() => users.id),
}, (table) => ({
  uniqueProject: unique().on(table.projectId),
}));

export const insertCommissioningSourceSchema = createInsertSchema(commissioningSources).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertCommissioningSource = z.infer<typeof insertCommissioningSourceSchema>;
export type CommissioningSource = typeof commissioningSources.$inferSelect;

// ===================== COMMISSIONING SNAPSHOT =====================

/** Parsed section from a commissioning workbook */
export interface CommissioningSection {
  sectionKey: string;
  sectionName: string;
  items: CommissioningSectionItem[];
  rawStatus?: string;
  displayStatus?: "complete" | "in_progress" | "not_started" | "blocked" | "unknown";
  approvedBy?: string;
  approvalDate?: string;
  commentSummary?: string;
  sourceLink?: string;
  blockerNote?: string;
}

export interface CommissioningSectionItem {
  description: string;
  status?: string;
  approvedBy?: string;
  date?: string;
  comments?: string;
}

/** Dashboard payload shape returned by the API */
export interface CommissioningDashboardPayload {
  projectId: number;
  projectName: string;
  source: CommissioningSource | null;
  snapshot: CommissioningSnapshot | null;
  sections: CommissioningSection[];
  overallStatus: "complete" | "in_progress" | "not_started" | "blocked" | "unknown";
  completionPercent: number;
  blockers: string[];
  ssegStatus: {
    application?: string;
    pti?: string;
    commissioningApproval?: string;
    nersaRegistration?: string;
  };
  syncState: {
    lastRefreshed: string | null;
    parseStatus: string | null;
    parseMessage: string | null;
    isStale: boolean;
  };
}

export const commissioningSnapshots = pgTable("commissioning_snapshots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  sourceId: integer("source_id").references(() => commissioningSources.id),
  sourceEtag: text("source_etag"),
  sourceCtag: text("source_ctag"),
  sourceModifiedAt: timestamp("source_modified_at"),
  parseStatus: text("parse_status").notNull().default("pending"),
  parseMessage: text("parse_message"),
  parsedSections: jsonb("parsed_sections").notNull().default([]),
  parsedAt: timestamp("parsed_at").notNull().defaultNow(),
  isLatest: boolean("is_latest").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCommissioningSnapshotSchema = createInsertSchema(commissioningSnapshots).omit({ id: true, createdAt: true } as any);
export type InsertCommissioningSnapshot = z.infer<typeof insertCommissioningSnapshotSchema>;
export type CommissioningSnapshot = typeof commissioningSnapshots.$inferSelect;
