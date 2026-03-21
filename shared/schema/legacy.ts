import { pgTable, text, integer, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";

// ===================== LEGACY TYPE STUBS =====================
// The tables below (projects, expenses, revenues, tasks, budgets) have been
// dropped from the database.  These plain interfaces preserve the shapes
// that storage.ts compatibility mappers still return until all callers are
// migrated to canonical types.

export interface Project {
  id: number;
  name: string;
  code: string;
  manager: string;
  site: string;
  status: string;
  stage: string;
  startDate: string;
  completionDate: string;
  budget: string;
  sourceFile: string;
  lastUpdated: Date;
}

export type InsertProject = Omit<Project, "id" | "lastUpdated">;

export interface Expense {
  id: number;
  projectId: number;
  category: string;
  description: string;
  amount: string;
  date: string;
  vendor: string;
  invoiceNumber: string | null;
  status: string;
  sourceSheet: string;
  rowLocator: number | null;
  createdAt: Date;
}

export type InsertExpense = Omit<Expense, "id" | "createdAt">;

export interface Revenue {
  id: number;
  projectId: number;
  type: string;
  amount: string;
  date: string;
  status: string;
  sourceSheet: string;
  rowLocator: number | null;
  createdAt: Date;
}

export type InsertRevenue = Omit<Revenue, "id" | "createdAt">;

export interface Task {
  id: number;
  projectId: number;
  taskName: string;
  startDate: string;
  endDate: string;
  progress: number;
  status: string;
  assignee: string;
  sourceSheet: string;
  rowLocator: number | null;
  createdAt: Date;
}

export type InsertTask = Omit<Task, "id" | "createdAt">;

export interface Budget {
  id: number;
  projectId: number;
  month: string;
  category: string;
  amount: string;
  createdAt: Date;
}

export type InsertBudget = Omit<Budget, "id" | "createdAt">;

// ===================== ACTIVE TABLES =====================

// Upload Metadata Table
export const uploadMetadata = pgTable("upload_metadata", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path"), // Path to stored file on disk
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  recordsProcessed: integer("records_processed").notNull().default(0),
  validationErrors: text("validation_errors"),
  status: text("status").notNull().default('success'),
});

export const insertUploadMetadataSchema = createInsertSchema(uploadMetadata).omit({ id: true, uploadedAt: true } as any);
export type InsertUploadMetadata = z.infer<typeof insertUploadMetadataSchema>;
export type UploadMetadata = typeof uploadMetadata.$inferSelect;

// Refresh tracking
export const refreshLogs = pgTable("refresh_logs", {
  id: serial("id").primaryKey(),
  refreshedAt: timestamp("refreshed_at").notNull().defaultNow(),
  triggeredBy: integer("triggered_by").references(() => users.id),
  status: text("status").notNull().default('success'),
});

export const insertRefreshLogSchema = createInsertSchema(refreshLogs).omit({ id: true, refreshedAt: true } as any);
export type InsertRefreshLog = z.infer<typeof insertRefreshLogSchema>;
export type RefreshLog = typeof refreshLogs.$inferSelect;
