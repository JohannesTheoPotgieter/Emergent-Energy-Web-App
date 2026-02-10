import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real } from "drizzle-orm/pg-core";
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

// Project Info Table (parsed from Project Plan sheet fixed cells)
export const projectInfo = pgTable("project_info", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull().unique(),
  sizeKwp: decimal("size_kwp", { precision: 12, scale: 2 }),
  pd: text("pd"),
  pm: text("pm"),
  contractValue: decimal("contract_value", { precision: 15, scale: 2 }),
  phase: text("phase"),
  pdHandoverDate: text("pd_handover_date"),
  constructionStartDate: text("construction_start_date"),
  commissioningDate: text("commissioning_date"),
  omHandoverDate: text("om_handover_date"),
  clientHandoverDate: text("client_handover_date"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectInfoSchema = createInsertSchema(projectInfo).omit({ id: true, updatedAt: true });
export type InsertProjectInfo = z.infer<typeof insertProjectInfoSchema>;
export type ProjectInfo = typeof projectInfo.$inferSelect;

// Program Expense Table (from Expenditure Breakdown sheet - dual table structure)
export const programExpense = pgTable("program_expense", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number"),
  rowType: text("row_type").default("item"), // 'category', 'item', 'subtotal', 'blank'
  expenseCategory: text("expense_category"),
  expenseLineItem: text("expense_line_item"),
  // Budget/Costed side fields
  budgetQty: decimal("budget_qty", { precision: 12, scale: 4 }),
  budgetRateUnit: decimal("budget_rate_unit", { precision: 15, scale: 2 }),
  budgetTotal: decimal("budget_total", { precision: 15, scale: 2 }),
  forecastPaymentDate: text("forecast_payment_date"),
  budgetCosTotal: decimal("budget_cos_total", { precision: 15, scale: 2 }),
  // Actual/Finance side fields
  expenseQty: decimal("expense_qty", { precision: 12, scale: 4 }),
  expenseRateUnit: decimal("expense_rate_unit", { precision: 15, scale: 2 }),
  expenseActualTotal: decimal("expense_actual_total", { precision: 15, scale: 2 }),
  expensePoNumber: text("expense_po_number"),
  expenseInvoiceNumber: text("expense_invoice_number"),
  expenseInvoicedDate: text("expense_invoiced_date"),
  expensePaymentDate: text("expense_payment_date"),
  actualCosTotal: decimal("actual_cos_total", { precision: 15, scale: 2 }),
  // Computed status field
  lineStatus: text("line_status"), // 'Planned', 'Committed', 'Invoiced', 'Paid'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProgramExpenseSchema = createInsertSchema(programExpense).omit({ id: true, createdAt: true });
export type InsertProgramExpense = z.infer<typeof insertProgramExpenseSchema>;
export type ProgramExpense = typeof programExpense.$inferSelect;

// Program Inflows Table (from Revenue Tracking sheet)
export const programInflows = pgTable("program_inflows", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number"),
  milestoneNo: text("milestone_no"),
  milestoneName: text("milestone_name"),
  milestonePercent: decimal("milestone_percent", { precision: 6, scale: 4 }),
  milestoneAmount: decimal("milestone_amount", { precision: 15, scale: 2 }),
  plannedPaymentDate: text("planned_payment_date"),
  milestoneInvoiceNumber: text("milestone_invoice_number"),
  invoiceRaisedDate: text("invoice_raised_date"),
  paymentReceivedDate: text("payment_received_date"),
  milestoneNotes: text("milestone_notes"),
  documentsReceived: text("documents_received"),
  inBank: integer("in_bank").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProgramInflowsSchema = createInsertSchema(programInflows).omit({ id: true, createdAt: true });
export type InsertProgramInflows = z.infer<typeof insertProgramInflowsSchema>;
export type ProgramInflows = typeof programInflows.$inferSelect;

// Revenue Milestone Manual Overrides Table (user edits for invoice/payment fields)
export const revenueMilestoneManual = pgTable("revenue_milestone_manual", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  importedMilestoneId: integer("imported_milestone_id").notNull(),
  invoiceNumber: text("invoice_number"),
  invoiceRaisedDate: text("invoice_raised_date"),
  paymentReceivedDate: text("payment_received_date"),
  inBank: integer("in_bank").default(0),
  requirementsComments: text("requirements_comments"),
  documentsReceived: integer("documents_received").default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRevenueMilestoneManualSchema = createInsertSchema(revenueMilestoneManual).omit({ id: true, updatedAt: true });
export type InsertRevenueMilestoneManual = z.infer<typeof insertRevenueMilestoneManualSchema>;
export type RevenueMilestoneManual = typeof revenueMilestoneManual.$inferSelect;

// Project Revenue Summary Table (top summary block values)
export const projectRevenueSummary = pgTable("project_revenue_summary", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull().unique(),
  plannedRevenue: decimal("planned_revenue", { precision: 15, scale: 2 }),
  plannedExpenditure: decimal("planned_expenditure", { precision: 15, scale: 2 }),
  plannedProfit: decimal("planned_profit", { precision: 15, scale: 2 }),
  plannedMargin: decimal("planned_margin", { precision: 6, scale: 4 }),
  actualRevenue: decimal("actual_revenue", { precision: 15, scale: 2 }),
  actualExpenditure: decimal("actual_expenditure", { precision: 15, scale: 2 }),
  actualProfit: decimal("actual_profit", { precision: 15, scale: 2 }),
  actualMargin: decimal("actual_margin", { precision: 6, scale: 4 }),
  voPmLimit: decimal("vo_pm_limit", { precision: 15, scale: 2 }),
  currentVoTotal: decimal("current_vo_total", { precision: 15, scale: 2 }),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
});

export const insertProjectRevenueSummarySchema = createInsertSchema(projectRevenueSummary).omit({ id: true, capturedAt: true });
export type InsertProjectRevenueSummary = z.infer<typeof insertProjectRevenueSummarySchema>;
export type ProjectRevenueSummary = typeof projectRevenueSummary.$inferSelect;

// Project Notes Table (financial review, timeline review notes)
export const projectNotes = pgTable("project_notes", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull().unique(),
  revenueFinancialReview: text("revenue_financial_review"),
  revenueTimelineReview: text("revenue_timeline_review"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectNotesSchema = createInsertSchema(projectNotes).omit({ id: true, updatedAt: true });
export type InsertProjectNotes = z.infer<typeof insertProjectNotesSchema>;
export type ProjectNotes = typeof projectNotes.$inferSelect;

// Project Plan Table (from Project Plan sheet)
export const projectPlan = pgTable("project_plan", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number"),
  taskNo: text("task_no"),
  highLevelProgramme: text("high_level_programme"),
  actualStart: text("actual_start"),
  durationDays: integer("duration_days"),
  actualEnd: text("actual_end"),
  actualPctComplete: real("actual_pct_complete"),
  expectedPctComplete: real("expected_pct_complete"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProjectPlanSchema = createInsertSchema(projectPlan).omit({ id: true, createdAt: true });
export type InsertProjectPlan = z.infer<typeof insertProjectPlanSchema>;
export type ProjectPlan = typeof projectPlan.$inferSelect;

// Legacy Projects Table (kept for backward compatibility)
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

// Legacy Expenses Table (kept for backward compatibility)
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

// Legacy Revenues Table (kept for backward compatibility)
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

// Legacy Tasks Table (kept for backward compatibility)
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
  filePath: text("file_path"), // Path to stored file on disk
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

// Cashflow Points Table (from Cashflow sheet - weekly time-series)
export const cashflowPoints = pgTable("cashflow_points", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  seriesName: text("series_name").notNull(), // e.g. "Planned Revenue", "ACTUAL CashFlow"
  pointDate: text("point_date").notNull(), // ISO date string for the week/date
  value: decimal("value", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCashflowPointSchema = createInsertSchema(cashflowPoints).omit({ id: true, createdAt: true });
export type InsertCashflowPoint = z.infer<typeof insertCashflowPointSchema>;
export type CashflowPoint = typeof cashflowPoints.$inferSelect;

// Finance Revenue Monthly Table (from Finance - Revenue sheet - monthly pivot)
export const financeRevenueMonthly = pgTable("finance_revenue_monthly", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  category: text("category").notNull(), // e.g. "1. Panels", "2. Inverters"
  monthEndDate: text("month_end_date").notNull(), // ISO date string for month end
  value: decimal("value", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFinanceRevenueMonthlySchema = createInsertSchema(financeRevenueMonthly).omit({ id: true, createdAt: true });
export type InsertFinanceRevenueMonthly = z.infer<typeof insertFinanceRevenueMonthlySchema>;
export type FinanceRevenueMonthly = typeof financeRevenueMonthly.$inferSelect;

// Finance COS Monthly Table (from Finance - COS sheet - monthly pivot)
export const financeCosMonthly = pgTable("finance_cos_monthly", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  category: text("category").notNull(), // COS categories
  monthEndDate: text("month_end_date").notNull(), // ISO date string for month end
  value: decimal("value", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFinanceCosMonthlySchema = createInsertSchema(financeCosMonthly).omit({ id: true, createdAt: true });
export type InsertFinanceCosMonthly = z.infer<typeof insertFinanceCosMonthlySchema>;
export type FinanceCosMonthly = typeof financeCosMonthly.$inferSelect;

// Cashflow Planning Overrides Table (user edits for planned series)
export const cashflowPlanningOverrides = pgTable("cashflow_planning_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  weekStartDate: text("week_start_date").notNull(), // ISO date string (Monday)
  seriesName: text("series_name").notNull(), // "Planned Revenue" or "Planned Expenditure"
  overrideValue: decimal("override_value", { precision: 15, scale: 2 }).notNull(), // New value (absolute override)
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCashflowPlanningOverrideSchema = createInsertSchema(cashflowPlanningOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCashflowPlanningOverride = z.infer<typeof insertCashflowPlanningOverrideSchema>;
export type CashflowPlanningOverride = typeof cashflowPlanningOverrides.$inferSelect;

// Project Plan Overrides Table (user edits for tasks/milestones)
export const projectPlanOverrides = pgTable("project_plan_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number").notNull(), // Links to projectPlan.rowNumber
  fieldName: text("field_name").notNull(), // Field being overridden (e.g., "actualStart", "actualEnd")
  overrideValue: text("override_value"), // New value (stored as text, type-cast on retrieval)
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectPlanOverrideSchema = createInsertSchema(projectPlanOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectPlanOverride = z.infer<typeof insertProjectPlanOverrideSchema>;
export type ProjectPlanOverride = typeof projectPlanOverrides.$inferSelect;

// Revenue Tracking Overrides Table (user edits for revenue milestones)
export const revenueTrackingOverrides = pgTable("revenue_tracking_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number").notNull(), // Links to programInflows.rowNumber
  fieldName: text("field_name").notNull(), // Field being overridden
  overrideValue: text("override_value"), // New value
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRevenueTrackingOverrideSchema = createInsertSchema(revenueTrackingOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRevenueTrackingOverride = z.infer<typeof insertRevenueTrackingOverrideSchema>;
export type RevenueTrackingOverride = typeof revenueTrackingOverrides.$inferSelect;

// Expenditure Breakdown Overrides Table (user edits for expenses)
export const expenditureOverrides = pgTable("expenditure_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number").notNull(), // Links to programExpense.rowNumber
  fieldName: text("field_name").notNull(), // Field being overridden
  overrideValue: text("override_value"), // New value
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertExpenditureOverrideSchema = createInsertSchema(expenditureOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExpenditureOverride = z.infer<typeof insertExpenditureOverrideSchema>;
export type ExpenditureOverride = typeof expenditureOverrides.$inferSelect;

// Finance Revenue Overrides Table (user edits for monthly revenue)
export const financeRevenueOverrides = pgTable("finance_revenue_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  category: text("category").notNull(), // Revenue category
  monthEndDate: text("month_end_date").notNull(), // ISO date string
  overrideValue: decimal("override_value", { precision: 15, scale: 2 }), // New value
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFinanceRevenueOverrideSchema = createInsertSchema(financeRevenueOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinanceRevenueOverride = z.infer<typeof insertFinanceRevenueOverrideSchema>;
export type FinanceRevenueOverride = typeof financeRevenueOverrides.$inferSelect;

// Finance COS Overrides Table (user edits for monthly COS)
export const financeCosOverrides = pgTable("finance_cos_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  category: text("category").notNull(), // COS category
  monthEndDate: text("month_end_date").notNull(), // ISO date string
  overrideValue: decimal("override_value", { precision: 15, scale: 2 }), // New value
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFinanceCosOverrideSchema = createInsertSchema(financeCosOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinanceCosOverride = z.infer<typeof insertFinanceCosOverrideSchema>;
export type FinanceCosOverride = typeof financeCosOverrides.$inferSelect;

// Working Plan Scenario Table - stores named scenarios for project plans
export const workingPlanScenario = pgTable("working_plan_scenario", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  name: text("name").notNull().default("Working Plan"),
  isActive: integer("is_active").notNull().default(1), // 1 = active, 0 = inactive
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWorkingPlanScenarioSchema = createInsertSchema(workingPlanScenario).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkingPlanScenario = z.infer<typeof insertWorkingPlanScenarioSchema>;
export type WorkingPlanScenario = typeof workingPlanScenario.$inferSelect;

// Working Plan Task Override Table - overlays on imported task data
export const workingPlanTaskOverride = pgTable("working_plan_task_override", {
  id: serial("id").primaryKey(),
  scenarioId: integer("scenario_id").notNull().references(() => workingPlanScenario.id, { onDelete: 'cascade' }),
  importedTaskId: integer("imported_task_id").references(() => projectPlan.id), // null for new tasks
  overrideStartDate: text("override_start_date"),
  overrideEndDate: text("override_end_date"),
  overrideDurationDays: integer("override_duration_days"),
  overrideName: text("override_name"),
  overrideTaskNo: text("override_task_no"),
  overrideComment: text("override_comment"),
  deletedFlag: integer("deleted_flag").notNull().default(0), // 1 = soft deleted
  isNewTask: integer("is_new_task").notNull().default(0), // 1 = created in app, not imported
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWorkingPlanTaskOverrideSchema = createInsertSchema(workingPlanTaskOverride).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkingPlanTaskOverride = z.infer<typeof insertWorkingPlanTaskOverrideSchema>;
export type WorkingPlanTaskOverride = typeof workingPlanTaskOverride.$inferSelect;

// Dependency type enum
export const dependencyTypeEnum = pgEnum('dependency_type', ['FS', 'SS', 'FF', 'SF']);

// Project Plan Dependency Table - user-created task dependencies
export const projectPlanDependency = pgTable("project_plan_dependency", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  predecessorTaskId: integer("predecessor_task_id").notNull(), // rowNumber of predecessor
  successorTaskId: integer("successor_task_id").notNull(), // rowNumber of successor
  dependencyType: text("dependency_type").notNull().default("FS"), // FS, SS, FF, SF
  lagDays: integer("lag_days").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProjectPlanDependencySchema = createInsertSchema(projectPlanDependency).omit({ id: true, createdAt: true });
export type InsertProjectPlanDependency = z.infer<typeof insertProjectPlanDependencySchema>;
export type ProjectPlanDependency = typeof projectPlanDependency.$inferSelect;

// Working Plan Dependency Override Table - overlays on dependencies
export const workingPlanDependencyOverride = pgTable("working_plan_dependency_override", {
  id: serial("id").primaryKey(),
  scenarioId: integer("scenario_id").notNull().references(() => workingPlanScenario.id, { onDelete: 'cascade' }),
  importedDependencyId: integer("imported_dependency_id").references(() => projectPlanDependency.id), // null for new deps
  predecessorTaskId: integer("predecessor_task_id").notNull(),
  successorTaskId: integer("successor_task_id").notNull(),
  dependencyType: text("dependency_type").notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
  deletedFlag: integer("deleted_flag").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWorkingPlanDependencyOverrideSchema = createInsertSchema(workingPlanDependencyOverride).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkingPlanDependencyOverride = z.infer<typeof insertWorkingPlanDependencyOverrideSchema>;
export type WorkingPlanDependencyOverride = typeof workingPlanDependencyOverride.$inferSelect;

// Schedule Change Notice Table - governance log for schedule changes
export const scheduleChangeNotice = pgTable("schedule_change_notice", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  summary: text("summary").notNull(),
  oldFinishDate: text("old_finish_date"),
  newFinishDate: text("new_finish_date"),
  changedTasks: text("changed_tasks"), // JSON: [{taskId, field, oldValue, newValue}]
  criticalPathDelta: text("critical_path_delta"), // JSON: {becameCritical: [], noLongerCritical: []}
  userNote: text("user_note"),
  clientNotified: integer("client_notified").notNull().default(0),
  documentationUpdated: integer("documentation_updated").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertScheduleChangeNoticeSchema = createInsertSchema(scheduleChangeNotice).omit({ id: true, createdAt: true });
export type InsertScheduleChangeNotice = z.infer<typeof insertScheduleChangeNoticeSchema>;
export type ScheduleChangeNotice = typeof scheduleChangeNotice.$inferSelect;

// Home Notes Table - persisted notes for the Home/Projects Report page
export const homeNotes = pgTable("home_notes", {
  id: serial("id").primaryKey(),
  reportDate: text("report_date").notNull(), // YYYY-MM-DD
  preparedBy: text("prepared_by"),
  highlightsNotes: text("highlights_notes"), // Key issues / highlights
  constructionNotes: text("construction_notes"), // Construction risks / notes
  financeNotes: text("finance_notes"), // Finance notes / actions
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertHomeNotesSchema = createInsertSchema(homeNotes).omit({ id: true, updatedAt: true });
export type InsertHomeNotes = z.infer<typeof insertHomeNotesSchema>;
export type HomeNotes = typeof homeNotes.$inferSelect;

export const projectEditableFields = pgTable("project_editable_fields", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull().unique(),
  costProposalSigned: text("cost_proposal_signed"),
  fundingSigned: text("funding_signed"),
  epcContractSigned: text("epc_contract_signed"),
  currentVoTotal: decimal("current_vo_total", { precision: 15, scale: 2 }),
  comments: text("comments"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectEditableFieldsSchema = createInsertSchema(projectEditableFields).omit({ id: true, updatedAt: true });
export type InsertProjectEditableFields = z.infer<typeof insertProjectEditableFieldsSchema>;
export type ProjectEditableFields = typeof projectEditableFields.$inferSelect;

export const cashflowWeeklyManual = pgTable("cashflow_weekly_manual", {
  id: serial("id").primaryKey(),
  weekStartDate: text("week_start_date").notNull().unique(),
  openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCashflowWeeklyManualSchema = createInsertSchema(cashflowWeeklyManual).omit({ id: true, updatedAt: true });
export type InsertCashflowWeeklyManual = z.infer<typeof insertCashflowWeeklyManualSchema>;
export type CashflowWeeklyManual = typeof cashflowWeeklyManual.$inferSelect;

export const opexBudgetMonthly = pgTable("opex_budget_monthly", {
  id: serial("id").primaryKey(),
  monthKey: text("month_key").notNull().unique(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOpexBudgetMonthlySchema = createInsertSchema(opexBudgetMonthly).omit({ id: true, updatedAt: true });
export type InsertOpexBudgetMonthly = z.infer<typeof insertOpexBudgetMonthlySchema>;
export type OpexBudgetMonthly = typeof opexBudgetMonthly.$inferSelect;

export const trackerMonthlyManual = pgTable("tracker_monthly_manual", {
  id: serial("id").primaryKey(),
  trackerType: text("tracker_type").notNull(),
  monthKey: text("month_key").notNull(),
  realised: decimal("realised", { precision: 15, scale: 2 }),
  outstanding: decimal("outstanding", { precision: 15, scale: 2 }),
  budget: decimal("budget", { precision: 15, scale: 2 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTrackerMonthlyManualSchema = createInsertSchema(trackerMonthlyManual).omit({ id: true, updatedAt: true });
export type InsertTrackerMonthlyManual = z.infer<typeof insertTrackerMonthlyManualSchema>;
export type TrackerMonthlyManual = typeof trackerMonthlyManual.$inferSelect;
