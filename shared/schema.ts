import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb } from "drizzle-orm/pg-core";
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
  escalationLevel: text("escalation_level"),
  isActive: boolean("is_active").notNull().default(true),
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
  invoiceDateConfirmed: boolean("invoice_date_confirmed").default(false),
  invoiceDateFontColor: text("invoice_date_font_color"),
  expensePaymentDate: text("expense_payment_date"),
  paymentDateConfirmed: boolean("payment_date_confirmed").default(false),
  paymentDateFontColor: text("payment_date_font_color"),
  actualCosTotal: decimal("actual_cos_total", { precision: 15, scale: 2 }),
  lineStatus: text("line_status"),
  expenseLineHash: text("expense_line_hash"),
  computedState: text("computed_state"),
  computedForecastPaymentDate: text("computed_forecast_payment_date"),
  supplierName: text("supplier_name"),
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
  inflowLineHash: text("inflow_line_hash"),
  computedForecastReceiptDate: text("computed_forecast_receipt_date"),
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
  costProposalType: text("cost_proposal_type"),
  costProposalLink: text("cost_proposal_link"),
  costProposalNaReason: text("cost_proposal_na_reason"),
  fundingType: text("funding_type"),
  fundingLink: text("funding_link"),
  fundingNaReason: text("funding_na_reason"),
  epcContractType: text("epc_contract_type"),
  epcContractLink: text("epc_contract_link"),
  epcContractNaReason: text("epc_contract_na_reason"),
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

export const cashflowBalanceHistory = pgTable("cashflow_balance_history", {
  id: serial("id").primaryKey(),
  weekStartDate: text("week_start_date").notNull(),
  previousValue: decimal("previous_value", { precision: 15, scale: 2 }),
  newValue: decimal("new_value", { precision: 15, scale: 2 }).notNull(),
  computedValue: decimal("computed_value", { precision: 15, scale: 2 }),
  delta: decimal("delta", { precision: 15, scale: 2 }),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  changedBy: text("changed_by"),
});

export const insertCashflowBalanceHistorySchema = createInsertSchema(cashflowBalanceHistory).omit({ id: true, changedAt: true });
export type InsertCashflowBalanceHistory = z.infer<typeof insertCashflowBalanceHistorySchema>;
export type CashflowBalanceHistory = typeof cashflowBalanceHistory.$inferSelect;

export const opexBudgetMonthly = pgTable("opex_budget_monthly", {
  id: serial("id").primaryKey(),
  monthKey: text("month_key").notNull().unique(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOpexBudgetMonthlySchema = createInsertSchema(opexBudgetMonthly).omit({ id: true, updatedAt: true });
export type InsertOpexBudgetMonthly = z.infer<typeof insertOpexBudgetMonthlySchema>;
export type OpexBudgetMonthly = typeof opexBudgetMonthly.$inferSelect;

export const opexWeeklyManual = pgTable("opex_weekly_manual", {
  id: serial("id").primaryKey(),
  weekStartDate: text("week_start_date").notNull().unique(),
  opexAmount: decimal("opex_amount", { precision: 15, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOpexWeeklyManualSchema = createInsertSchema(opexWeeklyManual).omit({ id: true, updatedAt: true });
export type InsertOpexWeeklyManual = z.infer<typeof insertOpexWeeklyManualSchema>;
export type OpexWeeklyManual = typeof opexWeeklyManual.$inferSelect;

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

export const planningOverrides = pgTable("planning_overrides", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  fieldName: text("field_name").notNull(),
  value: text("value"),
  effectiveFrom: text("effective_from"),
  effectiveTo: text("effective_to"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPlanningOverrideSchema = createInsertSchema(planningOverrides).omit({ id: true, createdAt: true });
export type InsertPlanningOverride = z.infer<typeof insertPlanningOverrideSchema>;
export type PlanningOverride = typeof planningOverrides.$inferSelect;

export const paymentTerms = pgTable("payment_terms", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityName: text("entity_name").notNull(),
  termsDays: integer("terms_days").notNull(),
  scenario: text("scenario").notNull().default("base"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPaymentTermsSchema = createInsertSchema(paymentTerms).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPaymentTerms = z.infer<typeof insertPaymentTermsSchema>;
export type PaymentTerms = typeof paymentTerms.$inferSelect;

export const lineItemOverrides = pgTable("line_item_overrides", {
  id: serial("id").primaryKey(),
  lineType: text("line_type").notNull(),
  lineId: integer("line_id").notNull(),
  overrideForecastDate: text("override_forecast_date"),
  overrideTermsDays: integer("override_terms_days"),
  overrideAmount: decimal("override_amount", { precision: 15, scale: 2 }),
  overrideReason: text("override_reason").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLineItemOverrideSchema = createInsertSchema(lineItemOverrides).omit({ id: true, createdAt: true });
export type InsertLineItemOverride = z.infer<typeof insertLineItemOverrideSchema>;
export type LineItemOverride = typeof lineItemOverrides.$inferSelect;

export const resourceCapacity = pgTable("resource_capacity", {
  id: serial("id").primaryKey(),
  resourceType: text("resource_type").notNull(),
  resourceName: text("resource_name").notNull(),
  weekStart: text("week_start").notNull(),
  capacityValue: decimal("capacity_value", { precision: 12, scale: 2 }),
  capacityUnit: text("capacity_unit"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const insertResourceCapacitySchema = createInsertSchema(resourceCapacity).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertResourceCapacity = z.infer<typeof insertResourceCapacitySchema>;
export type ResourceCapacity = typeof resourceCapacity.$inferSelect;

export const scenarios = pgTable("scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: integer("created_by").references(() => users.id),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertScenarioSchema = createInsertSchema(scenarios).omit({ id: true, createdAt: true });
export type InsertScenario = z.infer<typeof insertScenarioSchema>;
export type Scenario = typeof scenarios.$inferSelect;

export const dateOverrides = pgTable("date_overrides", {
  id: serial("id").primaryKey(),
  scenarioId: integer("scenario_id").notNull().references(() => scenarios.id, { onDelete: 'cascade' }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  fieldName: text("field_name").notNull(),
  originalDate: text("original_date"),
  overrideDate: text("override_date").notNull(),
  reason: text("reason").notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDateOverrideSchema = createInsertSchema(dateOverrides).omit({ id: true, createdAt: true });
export type InsertDateOverride = z.infer<typeof insertDateOverrideSchema>;
export type DateOverride = typeof dateOverrides.$inferSelect;

export const operationalTasks = pgTable("operational_tasks", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  importedTaskId: integer("imported_task_id"),
  taskNumber: text("task_number"),
  parentTaskId: integer("parent_task_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("Not Started"),
  priority: text("priority").notNull().default("Normal"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  durationDays: integer("duration_days"),
  actualStartDate: text("actual_start_date"),
  actualEndDate: text("actual_end_date"),
  actualDurationDays: integer("actual_duration_days"),
  percentComplete: integer("percent_complete").notNull().default(0),
  expectedPercentComplete: integer("expected_percent_complete"),
  comment: text("comment"),
  assignees: text("assignees").array(),
  tags: text("tags").array(),
  blockerReason: text("blocker_reason"),
  plannedHours: real("planned_hours"),
  actualHours: real("actual_hours"),
  escalationLevel: text("escalation_level"),
  sortOrder: integer("sort_order").notNull().default(0),
  isBaseline: boolean("is_baseline").notNull().default(false),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOperationalTaskSchema = createInsertSchema(operationalTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOperationalTask = z.infer<typeof insertOperationalTaskSchema>;
export type OperationalTask = typeof operationalTasks.$inferSelect;

export const taskComments = pgTable("task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => operationalTasks.id, { onDelete: 'cascade' }),
  authorId: integer("author_id").references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskCommentSchema = createInsertSchema(taskComments).omit({ id: true, createdAt: true });
export type InsertTaskComment = z.infer<typeof insertTaskCommentSchema>;
export type TaskComment = typeof taskComments.$inferSelect;

export const taskChecklists = pgTable("task_checklists", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => operationalTasks.id, { onDelete: 'cascade' }),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskChecklistSchema = createInsertSchema(taskChecklists).omit({ id: true, createdAt: true });
export type InsertTaskChecklist = z.infer<typeof insertTaskChecklistSchema>;
export type TaskChecklist = typeof taskChecklists.$inferSelect;

export const taskChecklistItems = pgTable("task_checklist_items", {
  id: serial("id").primaryKey(),
  checklistId: integer("checklist_id").notNull().references(() => taskChecklists.id, { onDelete: 'cascade' }),
  content: text("content").notNull(),
  isDone: boolean("is_done").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskChecklistItemSchema = createInsertSchema(taskChecklistItems).omit({ id: true, createdAt: true });
export type InsertTaskChecklistItem = z.infer<typeof insertTaskChecklistItemSchema>;
export type TaskChecklistItem = typeof taskChecklistItems.$inferSelect;

export const taskAttachments = pgTable("task_attachments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => operationalTasks.id, { onDelete: 'cascade' }),
  filename: text("filename").notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskAttachmentSchema = createInsertSchema(taskAttachments).omit({ id: true, createdAt: true });
export type InsertTaskAttachment = z.infer<typeof insertTaskAttachmentSchema>;
export type TaskAttachment = typeof taskAttachments.$inferSelect;

export const taskActivityLog = pgTable("task_activity_log", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => operationalTasks.id, { onDelete: 'cascade' }),
  actorId: integer("actor_id").references(() => users.id),
  actionType: text("action_type").notNull(),
  fieldName: text("field_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskActivityLogSchema = createInsertSchema(taskActivityLog).omit({ id: true, createdAt: true });
export type InsertTaskActivityLog = z.infer<typeof insertTaskActivityLogSchema>;
export type TaskActivityLog = typeof taskActivityLog.$inferSelect;

export const writebackMappings = pgTable("writeback_mappings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  projectName: text("project_name"),
  workbookPath: text("workbook_path").notNull(),
  sheetName: text("sheet_name").notNull(),
  cellAddress: text("cell_address").notNull(),
  sourceField: text("source_field").notNull(),
  entityType: text("entity_type").notNull(),
  dataTransform: text("data_transform"),
  validationRule: text("validation_rule"),
  allowedRoles: text("allowed_roles").array(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWritebackMappingSchema = createInsertSchema(writebackMappings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWritebackMapping = z.infer<typeof insertWritebackMappingSchema>;
export type WritebackMapping = typeof writebackMappings.$inferSelect;

export const writebackAuditLog = pgTable("writeback_audit_log", {
  id: serial("id").primaryKey(),
  mappingId: integer("mapping_id").references(() => writebackMappings.id),
  workbookPath: text("workbook_path").notNull(),
  sheetName: text("sheet_name").notNull(),
  cellAddress: text("cell_address").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value").notNull(),
  status: text("status").notNull().default("applied"),
  projectId: text("project_id"),
  actorId: integer("actor_id").references(() => users.id),
  errorMessage: text("error_message"),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
  rolledBackAt: timestamp("rolled_back_at"),
});

export const insertWritebackAuditLogSchema = createInsertSchema(writebackAuditLog).omit({ id: true, appliedAt: true });
export type InsertWritebackAuditLog = z.infer<typeof insertWritebackAuditLogSchema>;
export type WritebackAuditLog = typeof writebackAuditLog.$inferSelect;

export const milestoneTaskLinks = pgTable("milestone_task_links", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  milestoneRowNumber: integer("milestone_row_number").notNull(),
  taskId: integer("task_id").notNull(),
  dateOverride: text("date_override"),
  dateOverrideReason: text("date_override_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMilestoneTaskLinkSchema = createInsertSchema(milestoneTaskLinks).omit({ id: true, createdAt: true });
export type InsertMilestoneTaskLink = z.infer<typeof insertMilestoneTaskLinkSchema>;
export type MilestoneTaskLink = typeof milestoneTaskLinks.$inferSelect;

export const expenseTaskLinks = pgTable("expense_task_links", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  expenseId: integer("expense_id").notNull(),
  taskId: integer("task_id").notNull(),
  dateOverride: text("date_override"),
  dateOverrideReason: text("date_override_reason"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertExpenseTaskLinkSchema = createInsertSchema(expenseTaskLinks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExpenseTaskLink = z.infer<typeof insertExpenseTaskLinkSchema>;
export type ExpenseTaskLink = typeof expenseTaskLinks.$inferSelect;

export const keyDateMappings = pgTable("key_date_mappings", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  keyDateName: text("key_date_name").notNull(),
  sourceTaskId: integer("source_task_id"),
  sourceTaskCode: text("source_task_code"),
  sourceTaskNameMatch: text("source_task_name_match"),
  dateField: text("date_field").notNull().default("dueDate"),
  precedenceRule: text("precedence_rule").notNull().default("actual_over_planned"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertKeyDateMappingSchema = createInsertSchema(keyDateMappings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKeyDateMapping = z.infer<typeof insertKeyDateMappingSchema>;
export type KeyDateMapping = typeof keyDateMappings.$inferSelect;

export const mytoolTaskStatusEnum = pgEnum('mytool_task_status', ['inbox', 'planned', 'in_progress', 'blocked', 'waiting', 'done', 'cancelled']);
export const mytoolTaskPriorityEnum = pgEnum('mytool_task_priority', ['low', 'normal', 'high', 'critical']);
export const mytoolPriorityHorizonEnum = pgEnum('mytool_priority_horizon', ['today', 'week', 'month', 'quarter']);
export const mytoolPrioritySeverityEnum = pgEnum('mytool_priority_severity', ['normal', 'important', 'critical']);
export const mytoolPriorityStatusEnum = pgEnum('mytool_priority_status', ['active', 'monitoring', 'closed', 'not_started', 'in_progress', 'complete']);

export const mytoolRecurrenceFrequencyEnum = pgEnum('mytool_recurrence_frequency', ['daily', 'weekly', 'monthly']);

export const mytoolTasks = pgTable("mytool_tasks", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  status: mytoolTaskStatusEnum("status").notNull().default('inbox'),
  priority: mytoolTaskPriorityEnum("priority").notNull().default('normal'),
  plannedForDate: text("planned_for_date"),
  dueAt: timestamp("due_at"),
  startDate: text("start_date"),
  notes: text("notes"),
  projectName: text("project_name"),
  department: text("department"),
  tag: text("tag"),
  blockedReason: text("blocked_reason"),
  nextStep: text("next_step"),
  definitionOfDone: text("definition_of_done"),
  completionNote: text("completion_note"),
  pinnedToday: boolean("pinned_today").notNull().default(false),
  pinnedWeek: boolean("pinned_week").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurrenceFrequency: mytoolRecurrenceFrequencyEnum("recurrence_frequency"),
  recurrenceInterval: integer("recurrence_interval").default(1),
  recurrenceDaysOfWeek: text("recurrence_days_of_week"),
  recurrenceEndDate: text("recurrence_end_date"),
  recurrenceParentId: integer("recurrence_parent_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertMytoolTaskSchema = createInsertSchema(mytoolTasks).omit({ id: true, createdAt: true, updatedAt: true, completedAt: true });
export type InsertMytoolTask = z.infer<typeof insertMytoolTaskSchema>;
export type MytoolTask = typeof mytoolTasks.$inferSelect;

export const mytoolTimeblocks = pgTable("mytool_timeblocks", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  label: text("label").notNull(),
  linkedTaskId: integer("linked_task_id").references(() => mytoolTasks.id),
  outlookEventId: text("outlook_event_id"),
  outlookCalendarId: text("outlook_calendar_id"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMytoolTimeblockSchema = createInsertSchema(mytoolTimeblocks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMytoolTimeblock = z.infer<typeof insertMytoolTimeblockSchema>;
export type MytoolTimeblock = typeof mytoolTimeblocks.$inferSelect;

export const mytoolDailyReviews = pgTable("mytool_daily_reviews", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  topOutcomes: text("top_outcomes"),
  whatMoved: text("what_moved"),
  blocked: text("blocked"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMytoolDailyReviewSchema = createInsertSchema(mytoolDailyReviews).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMytoolDailyReview = z.infer<typeof insertMytoolDailyReviewSchema>;
export type MytoolDailyReview = typeof mytoolDailyReviews.$inferSelect;

export const mytoolCompanyPriorities = pgTable("mytool_company_priorities", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  department: text("department"),
  horizon: mytoolPriorityHorizonEnum("horizon").notNull().default('week'),
  ownerRole: text("owner_role"),
  linkedProjectName: text("linked_project_name"),
  severity: mytoolPrioritySeverityEnum("severity").notNull().default('normal'),
  status: mytoolPriorityStatusEnum("status").notNull().default('active'),
  priorityRank: integer("priority_rank"),
  assignedTo: text("assigned_to"),
  nextAction: text("next_action"),
  support: text("support").array(),
  definitionOfDone: text("definition_of_done"),
  dueDate: text("due_date"),
  linkedTaskId: integer("linked_task_id"),
  linkedTaskType: text("linked_task_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMytoolCompanyPrioritySchema = createInsertSchema(mytoolCompanyPriorities).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMytoolCompanyPriority = z.infer<typeof insertMytoolCompanyPrioritySchema>;
export type MytoolCompanyPriority = typeof mytoolCompanyPriorities.$inferSelect;

export const mytoolUserPreferences = pgTable("mytool_user_preferences", {
  ownerUserId: integer("owner_user_id").primaryKey().references(() => users.id),
  todayLayout: text("today_layout"),
  defaultView: text("default_view").notNull().default('today'),
  workdayStartTime: text("workday_start_time").notNull().default('08:00'),
  workdayEndTime: text("workday_end_time").notNull().default('17:00'),
  showCompanyPriorities: boolean("show_company_priorities").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMytoolUserPreferencesSchema = createInsertSchema(mytoolUserPreferences).omit({ updatedAt: true });
export type InsertMytoolUserPreferences = z.infer<typeof insertMytoolUserPreferencesSchema>;
export type MytoolUserPreferences = typeof mytoolUserPreferences.$inferSelect;

export const mytoolEmailLinks = pgTable("mytool_email_links", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  sender: text("sender"),
  emailDate: text("email_date"),
  snippet: text("snippet"),
  outlookMessageId: text("outlook_message_id"),
  webLink: text("web_link"),
  linkedTaskId: integer("linked_task_id").references(() => mytoolTasks.id, { onDelete: "cascade" }),
  linkedOperationalTaskId: integer("linked_operational_task_id").references(() => operationalTasks.id, { onDelete: "cascade" }),
  linkedPriorityId: integer("linked_priority_id").references(() => mytoolCompanyPriorities.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMytoolEmailLinkSchema = createInsertSchema(mytoolEmailLinks).omit({ id: true, createdAt: true });
export type InsertMytoolEmailLink = z.infer<typeof insertMytoolEmailLinkSchema>;
export type MytoolEmailLink = typeof mytoolEmailLinks.$inferSelect;

export const mytoolDodTemplates = pgTable("mytool_dod_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  department: text("department"),
  content: text("content").notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMytoolDodTemplateSchema = createInsertSchema(mytoolDodTemplates).omit({ id: true, createdAt: true });
export type InsertMytoolDodTemplate = z.infer<typeof insertMytoolDodTemplateSchema>;
export type MytoolDodTemplate = typeof mytoolDodTemplates.$inferSelect;

export const mytoolSettings = pgTable("mytool_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  allowedRoles: text("allowed_roles").notNull().default('admin'),
  defaultPriorityHorizon: text("default_priority_horizon").notNull().default('week'),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected']);

export const errorLogs = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  route: text("route"),
  action: text("action"),
  correlationId: text("correlation_id").notNull(),
  errorMessage: text("error_message").notNull(),
  errorStack: text("error_stack"),
  payloadShape: text("payload_shape"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertErrorLogSchema = createInsertSchema(errorLogs).omit({ id: true, createdAt: true });
export type InsertErrorLog = z.infer<typeof insertErrorLogSchema>;
export type ErrorLog = typeof errorLogs.$inferSelect;

export const outlookAccounts = pgTable("outlook_accounts", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  tenantId: text("tenant_id"),
  outlookUserId: text("outlook_user_id"),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiryUtc: timestamp("token_expiry_utc"),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at"),
  deltaCursor: text("delta_cursor"),
  calendarId: text("calendar_id"),
});

export const insertOutlookAccountSchema = createInsertSchema(outlookAccounts).omit({ connectedAt: true });
export type InsertOutlookAccount = z.infer<typeof insertOutlookAccountSchema>;
export type OutlookAccount = typeof outlookAccounts.$inferSelect;

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
});

export const insertApprovalSchema = createInsertSchema(approvals).omit({ id: true, requestedAt: true, decidedAt: true });
export type InsertApproval = z.infer<typeof insertApprovalSchema>;
export type Approval = typeof approvals.$inferSelect;

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

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({ id: true, createdAt: true });
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;
