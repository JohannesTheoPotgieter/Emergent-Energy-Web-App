import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const projectStatusEnum = pgEnum('project_status', ['Planning', 'Active', 'Completed', 'On Hold']);
export const projectStageEnum = pgEnum('project_stage', ['Development', 'Construction', 'Operations']);
export const expenseStatusEnum = pgEnum('expense_status', ['Paid', 'Pending', 'Forecast']);
export const expenseCategoryEnum = pgEnum('expense_category', ['Procurement', 'Construction', 'Legal', 'Development', 'Grid Connection', 'Operational']);
export const revenueTypeEnum = pgEnum('revenue_type', ['PPA', 'Merchant', 'LGC', 'Capacity']);
export const revenueStatusEnum = pgEnum('revenue_status', ['Realised', 'Forecast']);
export const taskStatusEnum = pgEnum('task_status', ['Not Started', 'In Progress', 'Complete', 'Delayed']);
export const budgetCategoryEnum = pgEnum('budget_category', ['REV', 'COS', 'OPS']);
export const userRoleEnum = pgEnum('user_role', ['admin', 'member']);

// Users Table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull().default('member'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Projects Table
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  manager: text("manager").notNull(),
  site: text("site").notNull(),
  status: projectStatusEnum("status").notNull().default('Planning'),
  stage: projectStageEnum("stage").notNull().default('Development'),
  startDate: text("start_date").notNull(),
  completionDate: text("completion_date").notNull(),
  budget: decimal("budget", { precision: 15, scale: 2 }).notNull(),
  sourceFile: text("source_file").notNull(),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, lastUpdated: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// Expenses Table
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  category: expenseCategoryEnum("category").notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  date: text("date").notNull(),
  vendor: text("vendor").notNull(),
  invoiceNumber: text("invoice_number"),
  status: expenseStatusEnum("status").notNull().default('Forecast'),
  sourceSheet: text("source_sheet").notNull().default('Expenditure Breakdown'),
  rowLocator: integer("row_locator"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, createdAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

// Revenues Table
export const revenues = pgTable("revenues", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: revenueTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  date: text("date").notNull(),
  status: revenueStatusEnum("status").notNull().default('Forecast'),
  sourceSheet: text("source_sheet").notNull().default('Revenue Tracking'),
  rowLocator: integer("row_locator"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRevenueSchema = createInsertSchema(revenues).omit({ id: true, createdAt: true });
export type InsertRevenue = z.infer<typeof insertRevenueSchema>;
export type Revenue = typeof revenues.$inferSelect;

// Tasks Table
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  taskName: text("task_name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  progress: integer("progress").notNull().default(0),
  status: taskStatusEnum("status").notNull().default('Not Started'),
  assignee: text("assignee").notNull(),
  sourceSheet: text("source_sheet").notNull().default('Project Plan'),
  rowLocator: integer("row_locator"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// Budgets Table (Admin manual entry)
export const budgets = pgTable("budgets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  month: text("month").notNull(),
  category: budgetCategoryEnum("category").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBudgetSchema = createInsertSchema(budgets).omit({ id: true, createdAt: true });
export type InsertBudget = z.infer<typeof insertBudgetSchema>;
export type Budget = typeof budgets.$inferSelect;

// Upload Metadata Table
export const uploadMetadata = pgTable("upload_metadata", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  recordsProcessed: integer("records_processed").notNull().default(0),
  validationErrors: text("validation_errors"),
  status: text("status").notNull().default('success'),
});

export const insertUploadMetadataSchema = createInsertSchema(uploadMetadata).omit({ id: true, uploadedAt: true });
export type InsertUploadMetadata = z.infer<typeof insertUploadMetadataSchema>;
export type UploadMetadata = typeof uploadMetadata.$inferSelect;

// Refresh tracking
export const refreshLogs = pgTable("refresh_logs", {
  id: serial("id").primaryKey(),
  refreshedAt: timestamp("refreshed_at").notNull().defaultNow(),
  triggeredBy: integer("triggered_by").references(() => users.id),
  status: text("status").notNull().default('success'),
});

export const insertRefreshLogSchema = createInsertSchema(refreshLogs).omit({ id: true, refreshedAt: true });
export type InsertRefreshLog = z.infer<typeof insertRefreshLogSchema>;
export type RefreshLog = typeof refreshLogs.$inferSelect;
