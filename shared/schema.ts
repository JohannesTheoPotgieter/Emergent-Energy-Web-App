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
export const userRoleEnum = pgEnum('user_role', [
  'admin', 'member', 'quality_manager', 'viewer', 'eng_program_manager',
  'COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO',
  'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER',
  'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER',
  'ACCOUNTANT', 'ENGINEER', 'PROJECT_DEVELOPER',
]);

export const smartImportStatusEnum = pgEnum('smart_import_status', ['PREVIEW', 'AWAITING_REVIEW', 'COMMITTED', 'ROLLED_BACK', 'FAILED', 'SUPERSEDED']);
export const importIssueSeverityEnum = pgEnum('import_issue_severity', ['INFO', 'WARNING', 'BLOCKER']);
export const importSectionEnum = pgEnum('import_section', ['PLAN', 'REVENUE', 'EXPENDITURE', 'CASHFLOW', 'GENERAL']);
export const counterpartyTypeEnum = pgEnum('counterparty_type', ['SUPPLIER', 'INSTALLER', 'OTHER']);
export const revenueLineStatusEnum = pgEnum('revenue_line_status', ['PLANNED', 'INVOICED', 'PAID', 'IN_BANK', 'REALISED']);
export const costLineStatusEnum = pgEnum('cost_line_status', ['PLANNED', 'INVOICED', 'APPROVED', 'PAID']);
export const phaseSourceEnum = pgEnum('phase_source', ['EXCEL_IMPORT', 'MANUAL']);

// Users Table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default('member'),
  microsoft_id: text("microsoft_id").unique(),
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
  phaseUpdatedAt: timestamp("phase_updated_at"),
  phaseUpdatedByUserId: integer("phase_updated_by_user_id").references(() => users.id),
  phaseNotes: text("phase_notes"),
  pdHandoverDate: text("pd_handover_date"),
  constructionStartDate: text("construction_start_date"),
  commissioningDate: text("commissioning_date"),
  omHandoverDate: text("om_handover_date"),
  clientHandoverDate: text("client_handover_date"),
  escalationLevel: text("escalation_level"),
  constructionStartActual: text("construction_start_actual"),
  pdHandoverActual: text("pd_handover_actual"),
  commissioningActual: text("commissioning_actual"),
  clientHandoverActual: text("client_handover_actual"),
  ragStatus: text("rag_status"),
  ragUpdatedAt: timestamp("rag_updated_at"),
  isActive: boolean("is_active").notNull().default(true),
  executionEnabled: boolean("execution_enabled").notNull().default(false),
  executionGateStatus: text("execution_gate_status").notNull().default("NOT_ELIGIBLE"),
  executionGateReason: text("execution_gate_reason"),
  signedStatus: text("signed_status").notNull().default("NONE"),
  signedDate: text("signed_date"),
  signedDocumentLink: text("signed_document_link"),
  executionPhase: text("execution_phase"),
  excelTrackerLink: text("excel_tracker_link"),
  canonicalProjectId: integer("canonical_project_id"),
  archivedStatus: text("archived_status").notNull().default("ACTIVE"),
  pmUserId: integer("pm_user_id"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectInfoSchema = createInsertSchema(projectInfo).omit({ id: true, updatedAt: true });
export type InsertProjectInfo = z.infer<typeof insertProjectInfoSchema>;
export type ProjectInfo = typeof projectInfo.$inferSelect;

export const projectPhaseHistory = pgTable("project_phase_history", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  fromPhase: text("from_phase"),
  toPhase: text("to_phase").notNull(),
  changedByUserId: integer("changed_by_user_id").notNull().references(() => users.id),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  reason: text("reason").notNull(),
});

export const insertProjectPhaseHistorySchema = createInsertSchema(projectPhaseHistory).omit({ id: true, changedAt: true });
export type InsertProjectPhaseHistory = z.infer<typeof insertProjectPhaseHistorySchema>;
export type ProjectPhaseHistory = typeof projectPhaseHistory.$inferSelect;

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
  revenueAmount: decimal("revenue_amount", { precision: 15, scale: 2 }),
  actualCosTotal: decimal("actual_cos_total", { precision: 15, scale: 2 }),
  lineStatus: text("line_status"),
  expenseLineHash: text("expense_line_hash"),
  computedState: text("computed_state"),
  computedForecastPaymentDate: text("computed_forecast_payment_date"),
  supplierName: text("supplier_name"),
  isManual: boolean("is_manual").default(false),
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

export const cosStatusOverrides = pgTable("cos_status_overrides", {
  id: serial("id").primaryKey(),
  expenseId: integer("expense_id").notNull(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number").notNull(),
  originalStatus: text("original_status").notNull(),
  overrideStatus: text("override_status").notNull(),
  reason: text("reason").notNull(),
  overriddenBy: text("overridden_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCosStatusOverrideSchema = createInsertSchema(cosStatusOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCosStatusOverride = z.infer<typeof insertCosStatusOverrideSchema>;
export type CosStatusOverride = typeof cosStatusOverrides.$inferSelect;

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
  latestUpdate: text("latest_update"),
  latestUpdateAt: timestamp("latest_update_at"),
  latestUpdateBy: text("latest_update_by"),
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

export const availablePaymentOverrides = pgTable("available_payment_overrides", {
  id: serial("id").primaryKey(),
  weekStartDate: text("week_start_date").notNull().unique(),
  overrideValue: decimal("override_value", { precision: 15, scale: 2 }).notNull(),
  reason: text("reason"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const insertAvailablePaymentOverrideSchema = createInsertSchema(availablePaymentOverrides).omit({ id: true, updatedAt: true });
export type InsertAvailablePaymentOverride = z.infer<typeof insertAvailablePaymentOverrideSchema>;
export type AvailablePaymentOverride = typeof availablePaymentOverrides.$inferSelect;

export const availablePaymentHistory = pgTable("available_payment_history", {
  id: serial("id").primaryKey(),
  weekStartDate: text("week_start_date").notNull(),
  previousValue: decimal("previous_value", { precision: 15, scale: 2 }),
  newValue: decimal("new_value", { precision: 15, scale: 2 }).notNull(),
  computedValue: decimal("computed_value", { precision: 15, scale: 2 }),
  reason: text("reason"),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  changedBy: text("changed_by"),
});

export const insertAvailablePaymentHistorySchema = createInsertSchema(availablePaymentHistory).omit({ id: true, changedAt: true });
export type InsertAvailablePaymentHistory = z.infer<typeof insertAvailablePaymentHistorySchema>;
export type AvailablePaymentHistory = typeof availablePaymentHistory.$inferSelect;

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

export const TASK_STATUSES = [
  "TO DO", "IN PROGRESS", "HOLD", "PROJECTS ASSISTANCE",
  "NEEDS APPROVAL", "QC APPROVED", "PROVIDE FEEDBACK",
  "OPERATIONAL APPROVAL", "COMPLETE"
] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const TASK_WORKSTREAMS = [
  "PD", "Engineering", "Quality", "PM", "Procurement",
  "Construction", "Commissioning", "Handover"
] as const;
export type TaskWorkstream = typeof TASK_WORKSTREAMS[number];

export const TASK_PRIORITIES = ["Low", "Med", "High", "Urgent"] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];

export const LIFECYCLE_PHASES = [
  "First Assessment",
  "Cost Proposal",
  "Financial Close",
  "Planning",
  "Construction",
  "QA",
  "Handover",
  "Compliance Handover",
  "Commercial Close Out",
  "DLP",
  "Internal",
  "Hold",
  "Closed",
  "TBC",
] as const;
export type LifecyclePhase = typeof LIFECYCLE_PHASES[number];

export const PROJECT_PHASES = [
  ...LIFECYCLE_PHASES,
  "P0_FIRST_ASSESSMENT",
  "P1_COST_PROPOSAL_DESIGN",
  "P2_PD_PM_HANDOVER",
  "P3_DETAILED_DESIGN_PROC_RELEASE",
  "P4_CONSTRUCTION_INSTALLATION",
  "P5_COMMISSIONING_TESTING",
  "P6_HANDOVER_CLIENT_MATRIARCH",
  "P7_CLOSEOUT_POSTMORTEM",
] as const;
export type ProjectPhase = typeof PROJECT_PHASES[number];

export const PROJECT_PHASE_LABELS: Record<string, string> = {
  "First Assessment": "First Assessment",
  "Cost Proposal": "Cost Proposal",
  "Financial Close": "Financial Close",
  "Planning": "Planning",
  "Construction": "Construction",
  "QA": "QA",
  "Handover": "Handover",
  "Compliance Handover": "Compliance Handover",
  "Commercial Close Out": "Commercial Close Out",
  "DLP": "DLP",
  "Internal": "Internal",
  "Hold": "Hold",
  "Closed": "Closed",
  "TBC": "TBC",
  P0_FIRST_ASSESSMENT: "First Assessment",
  P1_COST_PROPOSAL_DESIGN: "Cost Proposal",
  P2_PD_PM_HANDOVER: "Planning",
  P3_DETAILED_DESIGN_PROC_RELEASE: "Planning",
  P4_CONSTRUCTION_INSTALLATION: "Construction",
  P5_COMMISSIONING_TESTING: "QA",
  P6_HANDOVER_CLIENT_MATRIARCH: "Handover",
  P7_CLOSEOUT_POSTMORTEM: "Commercial Close Out",
};

export const LEGACY_TO_LIFECYCLE: Record<string, LifecyclePhase> = {
  P0_FIRST_ASSESSMENT: "First Assessment",
  P1_COST_PROPOSAL_DESIGN: "Cost Proposal",
  P2_PD_PM_HANDOVER: "Planning",
  P3_DETAILED_DESIGN_PROC_RELEASE: "Planning",
  P4_CONSTRUCTION_INSTALLATION: "Construction",
  P5_COMMISSIONING_TESTING: "QA",
  P6_HANDOVER_CLIENT_MATRIARCH: "Handover",
  P7_CLOSEOUT_POSTMORTEM: "Commercial Close Out",
};

export const PHASE_TEXT_TO_ENUM: Record<string, ProjectPhase> = {
  "first assessment": "First Assessment",
  "cost proposal": "Cost Proposal",
  "cost proposal/design": "Cost Proposal",
  "design": "Cost Proposal",
  "pd": "Cost Proposal",
  "planning & design": "Planning",
  "planning": "Planning",
  "development": "Planning",
  "pd handover": "Planning",
  "pd -> pm handover": "Planning",
  "handover pd": "Planning",
  "detailed design": "Planning",
  "procurement": "Planning",
  "procurement release": "Planning",
  "construction": "Construction",
  "installation": "Construction",
  "construction / installation": "Construction",
  "commissioning": "QA",
  "testing": "QA",
  "commissioning & testing": "QA",
  "qa": "QA",
  "handover": "Handover",
  "client handover": "Handover",
  "o&m": "Handover",
  "compliance handover": "Compliance Handover",
  "complete": "Commercial Close Out",
  "completed": "Commercial Close Out",
  "close-out": "Commercial Close Out",
  "closeout": "Commercial Close Out",
  "commercial close out": "Commercial Close Out",
  "post-mortem": "Commercial Close Out",
  "internal": "Internal",
  "hold": "Hold",
  "closed": "Closed",
  "tbc": "TBC",
  "financial close": "Financial Close",
  "dlp": "DLP",
};

export const PHASE_TO_ENG_STAGES: Record<string, string[]> = {
  "First Assessment": ["First Assessment"],
  "Cost Proposal": ["Cost Proposal"],
  "Financial Close": ["Cost Proposal"],
  "Planning": ["IFC Planning"],
  "Construction": ["IFC Planning", "Construction Support"],
  "QA": ["Handover Pack"],
  "Handover": ["Handover Pack"],
  "Compliance Handover": ["Handover Pack"],
};

// ===================== PROJECT DEVELOPMENT =====================

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  name: text("name").notNull(),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

export const pdTicketStatusEnum = pgEnum('pd_ticket_status', ['Draft', 'In Progress', 'On Hold', 'Completed', 'Cancelled']);
export const pdRequestTypeEnum = pgEnum('pd_request_type', [
  'Cost Proposal', 'IFC Planning', 'Site Assessment', 'Feasibility Study',
  'Grid Application', 'Design Review', 'Battery Assessment', 'Full EPC',
]);
export const pdFundingTypeEnum = pgEnum('pd_funding_type', ['PPA', 'Cash', 'Lease', 'Hybrid', 'Other']);
export const pdProvinceEnum = pgEnum('pd_province', [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
]);

export const pdTickets = pgTable("pd_tickets", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id),
  clientNameSnapshot: text("client_name_snapshot"),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectSiteName: text("project_site_name").notNull(),
  dueDate: text("due_date"),
  requestType: text("request_type").notNull(),
  priority: text("priority").notNull().default("Medium"),
  status: text("status").notNull().default("Draft"),
  numberOfReworks: integer("number_of_reworks").notNull().default(0),
  projectDeveloperUserId: integer("project_developer_user_id").references(() => users.id),
  designerUserId: integer("designer_user_id").references(() => users.id),
  fundingType: text("funding_type"),
  sizeKwp: decimal("size_kwp", { precision: 12, scale: 2 }),
  province: text("province"),
  gpsCoordinates: text("gps_coordinates"),
  billsOrTariffData: boolean("bills_or_tariff_data").default(false),
  meteringDataAvailable: boolean("metering_data_available").default(false),
  siteInspectionForm: boolean("site_inspection_form").default(false),
  siteInspectionLink: text("site_inspection_link"),
  workingSchedule: text("working_schedule"),
  batteriesNeeded: boolean("batteries_needed").default(false),
  batterySize: decimal("battery_size", { precision: 12, scale: 2 }),
  dieselGenIntegration: boolean("diesel_gen_integration").default(false),
  roofReplacementNeeded: boolean("roof_replacement_needed").default(false),
  hseDiscussed: boolean("hse_discussed").default(false),
  comments: text("comments"),
  clickUpSynced: boolean("clickup_synced").default(false),
  tasksSpawnedAt: timestamp("tasks_spawned_at"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertPdTicketSchema = createInsertSchema(pdTickets).omit({ id: true, createdAt: true, updatedAt: true, tasksSpawnedAt: true });
export type InsertPdTicket = z.infer<typeof insertPdTicketSchema>;
export type PdTicket = typeof pdTickets.$inferSelect;

export const PD_REQUEST_TYPE_TASK_TEMPLATES: Record<string, { title: string; priority: string }[]> = {
  "Cost Proposal": [
    { title: "Prepare Cost Proposal Document", priority: "High" },
    { title: "Review Site Technical Data", priority: "Medium" },
    { title: "Financial Model & Pricing", priority: "High" },
    { title: "Client Presentation Pack", priority: "Medium" },
  ],
  "IFC Planning": [
    { title: "IFC Design Package", priority: "High" },
    { title: "Structural Assessment", priority: "High" },
    { title: "Electrical Single Line Diagram", priority: "High" },
    { title: "Cable Schedule & Layout", priority: "Medium" },
    { title: "Construction Timeline", priority: "Medium" },
  ],
  "Site Assessment": [
    { title: "Site Visit & Survey", priority: "High" },
    { title: "Roof Assessment Report", priority: "High" },
    { title: "Electrical Infrastructure Review", priority: "Medium" },
    { title: "HSE Risk Assessment", priority: "Medium" },
  ],
  "Feasibility Study": [
    { title: "Solar Resource Assessment", priority: "High" },
    { title: "Energy Yield Analysis", priority: "High" },
    { title: "Feasibility Report", priority: "High" },
    { title: "Financial Viability Summary", priority: "Medium" },
  ],
  "Grid Application": [
    { title: "Grid Connection Application", priority: "High" },
    { title: "Utility Liaison & Documentation", priority: "High" },
    { title: "Grid Compliance Check", priority: "Medium" },
  ],
  "Design Review": [
    { title: "Review Existing Design", priority: "High" },
    { title: "Design Revision Notes", priority: "Medium" },
    { title: "Updated Design Package", priority: "High" },
  ],
  "Battery Assessment": [
    { title: "Battery Sizing & Selection", priority: "High" },
    { title: "Integration Design", priority: "High" },
    { title: "Battery Cost Analysis", priority: "Medium" },
  ],
  "Full EPC": [
    { title: "Full EPC Design Package", priority: "High" },
    { title: "Procurement Schedule", priority: "High" },
    { title: "Construction Plan", priority: "High" },
    { title: "QA/QC Plan", priority: "Medium" },
    { title: "Commissioning Checklist", priority: "Medium" },
    { title: "Handover Documentation", priority: "Medium" },
  ],
};

export const operationalTasks = pgTable("operational_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  importedTaskId: integer("imported_task_id"),
  taskNumber: text("task_number"),
  parentTaskId: integer("parent_task_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("TO DO"),
  priority: text("priority").notNull().default("Med"),
  phase: text("phase"),
  primaryWorkstream: text("primary_workstream"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  requesterUserId: integer("requester_user_id").references(() => users.id),
  approverUserId: integer("approver_user_id").references(() => users.id),
  holdReason: text("hold_reason"),
  blockedType: text("blocked_type"),
  approvalRequired: boolean("approval_required").notNull().default(false),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  durationDays: integer("duration_days"),
  actualStartDate: text("actual_start_date"),
  actualEndDate: text("actual_end_date"),
  actualDurationDays: integer("actual_duration_days"),
  completedAt: timestamp("completed_at"),
  percentComplete: integer("percent_complete").notNull().default(0),
  expectedPercentComplete: integer("expected_percent_complete"),
  comment: text("comment"),
  assignees: text("assignees").array(),
  watchers: text("watchers").array(),
  tags: text("tags").array(),
  blockerReason: text("blocker_reason"),
  plannedHours: real("planned_hours"),
  actualHours: real("actual_hours"),
  escalationLevel: text("escalation_level"),
  sortOrder: integer("sort_order").notNull().default(0),
  isBaseline: boolean("is_baseline").notNull().default(false),
  linkedPlanItemId: integer("linked_plan_item_id"),
  linkedDeliverableId: integer("linked_deliverable_id"),
  linkedQualityItemInstanceId: integer("linked_quality_item_instance_id"),
  externalSource: text("external_source"),
  externalTaskId: text("external_task_id"),
  externalSubtaskIds: text("external_subtask_ids"),
  externalSubtaskUrls: text("external_subtask_urls"),
  trackingRag: text("tracking_rag"),
  summaryText: text("summary_text"),
  importedCommentCount: integer("imported_comment_count"),
  taskTypeTag: text("task_type_tag"),
  domain: text("domain").notNull().default("BOTH"),
  pdTicketId: integer("pd_ticket_id").references(() => pdTickets.id),
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

export const taskDeliverables = pgTable("task_deliverables", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => operationalTasks.id, { onDelete: 'cascade' }),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  fileSize: integer("file_size"),
  note: text("note"),
  sentByUserId: integer("sent_by_user_id").notNull().references(() => users.id),
  recipientUserId: integer("recipient_user_id").notNull().references(() => users.id),
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskDeliverableSchema = createInsertSchema(taskDeliverables).omit({ id: true, createdAt: true, acknowledged: true, acknowledgedAt: true });
export type InsertTaskDeliverable = z.infer<typeof insertTaskDeliverableSchema>;
export type TaskDeliverable = typeof taskDeliverables.$inferSelect;

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

export const mytoolTaskBucketEnum = pgEnum('mytool_task_bucket', ['project', 'company_ops', 'personal']);

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
  bucket: mytoolTaskBucketEnum("bucket").default('personal'),
  projectName: text("project_name"),
  department: text("department"),
  tag: text("tag"),
  sourceEmailId: text("source_email_id"),
  sourceEmailSubject: text("source_email_subject"),
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

export const priorityLinks = pgTable("priority_links", {
  id: serial("id").primaryKey(),
  priorityId: integer("priority_id").notNull().references(() => mytoolCompanyPriorities.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull(),
  projectName: text("project_name"),
  taskId: integer("task_id"),
  taskType: text("task_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPriorityLinkSchema = createInsertSchema(priorityLinks).omit({ id: true, createdAt: true });
export type InsertPriorityLink = z.infer<typeof insertPriorityLinkSchema>;
export type PriorityLink = typeof priorityLinks.$inferSelect;

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

export const meetingActionItemStatusEnum = pgEnum('meeting_action_item_status', ['pending', 'converted', 'dismissed']);

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

export const insertMeetingSummarySchema = createInsertSchema(meetingSummaries).omit({ id: true, createdAt: true });
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

export const insertMeetingActionItemSchema = createInsertSchema(meetingActionItems).omit({ id: true, createdAt: true });
export type InsertMeetingActionItem = z.infer<typeof insertMeetingActionItemSchema>;
export type MeetingActionItem = typeof meetingActionItems.$inferSelect;

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

// ==================== SharePoint Import System ====================

export const importTriggerTypeEnum = pgEnum('import_trigger_type', ['schedule', 'manual', 'webhook']);
export const importRunStatusEnum = pgEnum('import_run_status', ['running', 'success', 'partial', 'fail']);
export const changeEventTypeEnum = pgEnum('change_event_type', ['created', 'modified', 'deleted', 'renamed']);
export const importStatusEnum = pgEnum('import_status_type', ['pending', 'imported', 'failed', 'skipped']);

export const spSettings = pgTable("sp_settings", {
  id: serial("id").primaryKey(),
  siteId: text("site_id").notNull(),
  driveId: text("drive_id").notNull(),
  folderItemId: text("folder_item_id"),
  folderPath: text("folder_path"),
  intervalMinutes: integer("interval_minutes").notNull().default(30),
  enabled: boolean("enabled").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id),
});

export const insertSpSettingsSchema = createInsertSchema(spSettings).omit({ id: true, updatedAt: true });
export type InsertSpSettings = z.infer<typeof insertSpSettingsSchema>;
export type SpSettings = typeof spSettings.$inferSelect;

export const spFiles = pgTable("sp_files", {
  id: serial("id").primaryKey(),
  siteId: text("site_id").notNull(),
  driveId: text("drive_id").notNull(),
  itemId: text("item_id").notNull(),
  path: text("path"),
  fileName: text("file_name").notNull(),
  lastSeenEtag: text("last_seen_etag"),
  lastSeenCtag: text("last_seen_ctag"),
  spLastModifiedAt: timestamp("sp_last_modified_at"),
  spLastModifiedByName: text("sp_last_modified_by_name"),
  spLastModifiedByEmail: text("sp_last_modified_by_email"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSpFileSchema = createInsertSchema(spFiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpFile = z.infer<typeof insertSpFileSchema>;
export type SpFile = typeof spFiles.$inferSelect;

export const importRuns = pgTable("import_runs", {
  id: serial("id").primaryKey(),
  triggerType: importTriggerTypeEnum("trigger_type").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: importRunStatusEnum("status").notNull().default('running'),
  deltaTokenUsed: text("delta_token_used"),
  triggeredBy: text("triggered_by").notNull().default('system'),
  summaryJson: jsonb("summary_json"),
});

export const insertImportRunSchema = createInsertSchema(importRuns).omit({ id: true, startedAt: true });
export type InsertImportRun = z.infer<typeof insertImportRunSchema>;
export type ImportRun = typeof importRuns.$inferSelect;

export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  fileId: integer("file_id").notNull().references(() => spFiles.id),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  sourceEtag: text("source_etag"),
  contentHash: text("content_hash").notNull(),
  rowCountTotal: integer("row_count_total"),
  parserVersion: text("parser_version").notNull().default('1.0'),
  storageRef: text("storage_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSnapshotSchema = createInsertSchema(snapshots).omit({ id: true, importedAt: true, createdAt: true });
export type InsertSnapshot = z.infer<typeof insertSnapshotSchema>;
export type Snapshot = typeof snapshots.$inferSelect;

export const changeLedger = pgTable("change_ledger", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => importRuns.id),
  fileId: integer("file_id").notNull().references(() => spFiles.id),
  eventType: changeEventTypeEnum("event_type").notNull(),
  oldEtag: text("old_etag"),
  newEtag: text("new_etag"),
  spModifiedAt: timestamp("sp_modified_at"),
  spModifiedByName: text("sp_modified_by_name"),
  spModifiedByEmail: text("sp_modified_by_email"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  importStatus: importStatusEnum("import_status").notNull().default('pending'),
  snapshotId: integer("snapshot_id").references(() => snapshots.id),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
});

export const insertChangeLedgerSchema = createInsertSchema(changeLedger).omit({ id: true, detectedAt: true });
export type InsertChangeLedger = z.infer<typeof insertChangeLedgerSchema>;
export type ChangeLedger = typeof changeLedger.$inferSelect;

export const snapshotMetrics = pgTable("snapshot_metrics", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id").notNull().references(() => snapshots.id),
  tableName: text("table_name").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  checksum: text("checksum"),
  minDate: text("min_date"),
  maxDate: text("max_date"),
  totalsJson: jsonb("totals_json"),
});

export const insertSnapshotMetricSchema = createInsertSchema(snapshotMetrics).omit({ id: true });
export type InsertSnapshotMetric = z.infer<typeof insertSnapshotMetricSchema>;
export type SnapshotMetric = typeof snapshotMetrics.$inferSelect;

// ===================== QUALITY MODULE TABLES =====================

export const qcTemplate = pgTable("qc_template", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcTemplateSchema = createInsertSchema(qcTemplate).omit({ id: true, createdAt: true });
export type InsertQcTemplate = z.infer<typeof insertQcTemplateSchema>;
export type QcTemplate = typeof qcTemplate.$inferSelect;

export const qcTemplatePhase = pgTable("qc_template_phase", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => qcTemplate.id, { onDelete: 'cascade' }),
  phaseKey: text("phase_key").notNull(),
  phaseName: text("phase_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
export const insertQcTemplatePhaseSchema = createInsertSchema(qcTemplatePhase).omit({ id: true });
export type InsertQcTemplatePhase = z.infer<typeof insertQcTemplatePhaseSchema>;
export type QcTemplatePhase = typeof qcTemplatePhase.$inferSelect;

export const qcTemplateGroup = pgTable("qc_template_group", {
  id: serial("id").primaryKey(),
  templatePhaseId: integer("template_phase_id").notNull().references(() => qcTemplatePhase.id, { onDelete: 'cascade' }),
  groupName: text("group_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
export const insertQcTemplateGroupSchema = createInsertSchema(qcTemplateGroup).omit({ id: true });
export type InsertQcTemplateGroup = z.infer<typeof insertQcTemplateGroupSchema>;
export type QcTemplateGroup = typeof qcTemplateGroup.$inferSelect;

export const qcTemplateItem = pgTable("qc_template_item", {
  id: serial("id").primaryKey(),
  templateGroupId: integer("template_group_id").notNull().references(() => qcTemplateGroup.id, { onDelete: 'cascade' }),
  itemName: text("item_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isEvidenceRequired: boolean("is_evidence_required").notNull().default(false),
  defaultSeverity: text("default_severity").notNull().default("Medium"),
});
export const insertQcTemplateItemSchema = createInsertSchema(qcTemplateItem).omit({ id: true });
export type InsertQcTemplateItem = z.infer<typeof insertQcTemplateItemSchema>;
export type QcTemplateItem = typeof qcTemplateItem.$inferSelect;

export const qcTemplateRiskQuestion = pgTable("qc_template_risk_question", {
  id: serial("id").primaryKey(),
  templatePhaseId: integer("template_phase_id").notNull().references(() => qcTemplatePhase.id, { onDelete: 'cascade' }),
  questionText: text("question_text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  responseType: text("response_type").notNull().default("yesno"),
  triggersWarning: boolean("triggers_warning").notNull().default(false),
  triggerCondition: text("trigger_condition").default("yes"),
  triggerSeverity: text("trigger_severity").default("Medium"),
});
export const insertQcTemplateRiskQuestionSchema = createInsertSchema(qcTemplateRiskQuestion).omit({ id: true });
export type InsertQcTemplateRiskQuestion = z.infer<typeof insertQcTemplateRiskQuestionSchema>;
export type QcTemplateRiskQuestion = typeof qcTemplateRiskQuestion.$inferSelect;

export const qcTemplatePostmortemMetric = pgTable("qc_template_postmortem_metric", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  inputType: text("input_type").notNull().default("count"),
  scoringRuleJson: jsonb("scoring_rule_json"),
  metricGroup: text("metric_group").notNull().default("contractor_quality"),
});
export const insertQcTemplatePostmortemMetricSchema = createInsertSchema(qcTemplatePostmortemMetric).omit({ id: true });
export type InsertQcTemplatePostmortemMetric = z.infer<typeof insertQcTemplatePostmortemMetricSchema>;
export type QcTemplatePostmortemMetric = typeof qcTemplatePostmortemMetric.$inferSelect;

export const qcChecklist = pgTable("qc_checklist", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  templateId: integer("template_id").notNull().references(() => qcTemplate.id),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcChecklistSchema = createInsertSchema(qcChecklist).omit({ id: true, createdAt: true });
export type InsertQcChecklist = z.infer<typeof insertQcChecklistSchema>;
export type QcChecklist = typeof qcChecklist.$inferSelect;

export const qcItemInstance = pgTable("qc_item_instance", {
  id: serial("id").primaryKey(),
  checklistId: integer("checklist_id").notNull().references(() => qcChecklist.id, { onDelete: 'cascade' }),
  templateItemId: integer("template_item_id").notNull().references(() => qcTemplateItem.id),
  isApplicable: boolean("is_applicable").notNull().default(true),
  startDate: text("start_date"),
  endDate: text("end_date"),
  approved: boolean("approved").notNull().default(false),
  approvedByUserId: integer("approved_by_user_id"),
  approvedAt: timestamp("approved_at"),
  approvalComment: text("approval_comment"),
  notApplicableReason: text("not_applicable_reason"),
  workingDays: integer("working_days"),
  allowedWorkingDays: integer("allowed_working_days"),
  qmStatus: text("qm_status").notNull().default("not_started"),
  lastUpdatedAt: timestamp("last_updated_at").notNull().defaultNow(),
});
export const insertQcItemInstanceSchema = createInsertSchema(qcItemInstance).omit({ id: true, lastUpdatedAt: true });
export type InsertQcItemInstance = z.infer<typeof insertQcItemInstanceSchema>;
export type QcItemInstance = typeof qcItemInstance.$inferSelect;

export const qcItemEvidence = pgTable("qc_item_evidence", {
  id: serial("id").primaryKey(),
  itemInstanceId: integer("item_instance_id").notNull().references(() => qcItemInstance.id, { onDelete: 'cascade' }),
  evidenceUrl: text("evidence_url").notNull(),
  evidenceNote: text("evidence_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcItemEvidenceSchema = createInsertSchema(qcItemEvidence).omit({ id: true, createdAt: true });
export type InsertQcItemEvidence = z.infer<typeof insertQcItemEvidenceSchema>;
export type QcItemEvidence = typeof qcItemEvidence.$inferSelect;

export const qcRiskAnswer = pgTable("qc_risk_answer", {
  id: serial("id").primaryKey(),
  checklistId: integer("checklist_id").notNull().references(() => qcChecklist.id, { onDelete: 'cascade' }),
  templateRiskQuestionId: integer("template_risk_question_id").notNull().references(() => qcTemplateRiskQuestion.id),
  answerYesno: boolean("answer_yesno"),
  answerText: text("answer_text"),
  answerNumber: real("answer_number"),
  lastUpdatedBy: integer("last_updated_by"),
  lastUpdatedAt: timestamp("last_updated_at").notNull().defaultNow(),
});
export const insertQcRiskAnswerSchema = createInsertSchema(qcRiskAnswer).omit({ id: true, lastUpdatedAt: true });
export type InsertQcRiskAnswer = z.infer<typeof insertQcRiskAnswerSchema>;
export type QcRiskAnswer = typeof qcRiskAnswer.$inferSelect;

export const qcPlanLink = pgTable("qc_plan_link", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  planItemId: integer("plan_item_id").notNull(),
  itemInstanceId: integer("item_instance_id"),
  phaseId: integer("phase_id"),
  linkType: text("link_type").notNull().default("phase_task"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcPlanLinkSchema = createInsertSchema(qcPlanLink).omit({ id: true, createdAt: true });
export type InsertQcPlanLink = z.infer<typeof insertQcPlanLinkSchema>;
export type QcPlanLink = typeof qcPlanLink.$inferSelect;

export const qcWarning = pgTable("qc_warning", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  severity: text("severity").notNull().default("Medium"),
  warningType: text("warning_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  relatedPlanItemId: integer("related_plan_item_id"),
  relatedItemInstanceId: integer("related_item_instance_id"),
  status: text("status").notNull().default("open"),
  ownerUserId: integer("owner_user_id"),
  dueDate: text("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertQcWarningSchema = createInsertSchema(qcWarning).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQcWarning = z.infer<typeof insertQcWarningSchema>;
export type QcWarning = typeof qcWarning.$inferSelect;

export const qcWarningEvent = pgTable("qc_warning_event", {
  id: serial("id").primaryKey(),
  warningId: integer("warning_id").notNull().references(() => qcWarning.id, { onDelete: 'cascade' }),
  eventType: text("event_type").notNull(),
  note: text("note"),
  actorUserId: integer("actor_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcWarningEventSchema = createInsertSchema(qcWarningEvent).omit({ id: true, createdAt: true });
export type InsertQcWarningEvent = z.infer<typeof insertQcWarningEventSchema>;
export type QcWarningEvent = typeof qcWarningEvent.$inferSelect;

export const qcPostmortem = pgTable("qc_postmortem", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  completedAt: timestamp("completed_at"),
  completedByUserId: integer("completed_by_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertQcPostmortemSchema = createInsertSchema(qcPostmortem).omit({ id: true, createdAt: true });
export type InsertQcPostmortem = z.infer<typeof insertQcPostmortemSchema>;
export type QcPostmortem = typeof qcPostmortem.$inferSelect;

export const qcPostmortemMetricValue = pgTable("qc_postmortem_metric_value", {
  id: serial("id").primaryKey(),
  postmortemId: integer("postmortem_id").notNull().references(() => qcPostmortem.id, { onDelete: 'cascade' }),
  templateMetricId: integer("template_metric_id").notNull().references(() => qcTemplatePostmortemMetric.id),
  inputValueNumber: real("input_value_number"),
  inputValueChoice: text("input_value_choice"),
  score: real("score"),
});
export const insertQcPostmortemMetricValueSchema = createInsertSchema(qcPostmortemMetricValue).omit({ id: true });
export type InsertQcPostmortemMetricValue = z.infer<typeof insertQcPostmortemMetricValueSchema>;
export type QcPostmortemMetricValue = typeof qcPostmortemMetricValue.$inferSelect;

export const qcPostmortemSummary = pgTable("qc_postmortem_summary", {
  id: serial("id").primaryKey(),
  postmortemId: integer("postmortem_id").notNull().references(() => qcPostmortem.id, { onDelete: 'cascade' }),
  contractorQualityScore: real("contractor_quality_score"),
  engineeringQualityScore: real("engineering_quality_score"),
  redFlag: boolean("red_flag").notNull().default(false),
});
export const insertQcPostmortemSummarySchema = createInsertSchema(qcPostmortemSummary).omit({ id: true });
export type InsertQcPostmortemSummary = z.infer<typeof insertQcPostmortemSummarySchema>;
export type QcPostmortemSummary = typeof qcPostmortemSummary.$inferSelect;

export const qcAccessChallenge = pgTable("qc_access_challenge", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(),
  lastSuccessAt: timestamp("last_success_at"),
  failedAttemptsCount: integer("failed_attempts_count").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertQcAccessChallengeSchema = createInsertSchema(qcAccessChallenge).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQcAccessChallenge = z.infer<typeof insertQcAccessChallengeSchema>;
export type QcAccessChallenge = typeof qcAccessChallenge.$inferSelect;

export const calendarHoliday = pgTable("calendar_holiday", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  name: text("name").notNull(),
  countryCode: text("country_code").notNull().default("ZA"),
});

// ===================== PROJECT TEAM MEMBERSHIP =====================

export const projectTeamMembers = pgTable("project_team_members", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  roleOnProject: text("role_on_project").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectTeamMemberSchema = createInsertSchema(projectTeamMembers).omit({ id: true, createdAt: true });
export type InsertProjectTeamMember = z.infer<typeof insertProjectTeamMemberSchema>;
export type ProjectTeamMember = typeof projectTeamMembers.$inferSelect;

// ===================== PHASE TEMPLATES (Lifecycle Governance) =====================

export const TEMPLATE_ITEM_TYPES = ["TASK", "DELIVERABLE", "QUALITY_LINK", "VIEW_SHORTCUT"] as const;
export type TemplateItemType = typeof TEMPLATE_ITEM_TYPES[number];

export const TEMPLATE_WORKSTREAMS = [
  "PD", "Engineering", "Quality", "PM", "Procurement",
  "Construction", "Commissioning", "Handover", "Finance", "OandM"
] as const;
export type TemplateWorkstream = typeof TEMPLATE_WORKSTREAMS[number];

export const TEMPLATE_LINK_TARGET_TYPES = ["NONE", "PLAN", "DELIVERABLE", "QUALITY"] as const;
export type TemplateLinkTargetType = typeof TEMPLATE_LINK_TARGET_TYPES[number];

export const phaseTemplate = pgTable("phase_template", {
  id: serial("id").primaryKey(),
  phase: text("phase").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(false),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertPhaseTemplateSchema = createInsertSchema(phaseTemplate).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPhaseTemplate = z.infer<typeof insertPhaseTemplateSchema>;
export type PhaseTemplate = typeof phaseTemplate.$inferSelect;

export const phaseTemplateItem = pgTable("phase_template_item", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => phaseTemplate.id, { onDelete: "cascade" }),
  itemKey: text("item_key").notNull(),
  itemType: text("item_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  primaryWorkstream: text("primary_workstream"),
  defaultStatus: text("default_status"),
  defaultPriority: text("default_priority"),
  offsetDaysFromPhaseStart: integer("offset_days_from_phase_start"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  approverRole: text("approver_role"),
  linkTargetType: text("link_target_type").notNull().default("NONE"),
  linkTargetKey: text("link_target_key"),
  deliverableTypeKey: text("deliverable_type_key"),
  requiresQcApproval: boolean("requires_qc_approval").notNull().default(false),
  requiresOperationalApproval: boolean("requires_operational_approval").notNull().default(false),
  qualityItemKey: text("quality_item_key"),
  evidenceRequired: boolean("evidence_required").notNull().default(false),
  viewKey: text("view_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  isDeleted: boolean("is_deleted").notNull().default(false),
});
export const insertPhaseTemplateItemSchema = createInsertSchema(phaseTemplateItem).omit({ id: true });
export type InsertPhaseTemplateItem = z.infer<typeof insertPhaseTemplateItemSchema>;
export type PhaseTemplateItem = typeof phaseTemplateItem.$inferSelect;

export const phaseTemplateItemHistory = pgTable("phase_template_item_history", {
  id: serial("id").primaryKey(),
  templateItemId: integer("template_item_id").notNull().references(() => phaseTemplateItem.id, { onDelete: "cascade" }),
  changedByUserId: integer("changed_by_user_id").references(() => users.id),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  changeJson: jsonb("change_json"),
});
export const insertPhaseTemplateItemHistorySchema = createInsertSchema(phaseTemplateItemHistory).omit({ id: true, changedAt: true });
export type InsertPhaseTemplateItemHistory = z.infer<typeof insertPhaseTemplateItemHistorySchema>;
export type PhaseTemplateItemHistory = typeof phaseTemplateItemHistory.$inferSelect;

export const phaseTemplateApplication = pgTable("phase_template_application", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  phase: text("phase").notNull(),
  templateId: integer("template_id").notNull().references(() => phaseTemplate.id),
  templateVersion: integer("template_version").notNull(),
  appliedByUserId: integer("applied_by_user_id").references(() => users.id),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
  applicationKey: text("application_key").notNull().unique(),
  resultSummaryJson: jsonb("result_summary_json"),
});
export const insertPhaseTemplateApplicationSchema = createInsertSchema(phaseTemplateApplication).omit({ id: true, appliedAt: true });
export type InsertPhaseTemplateApplication = z.infer<typeof insertPhaseTemplateApplicationSchema>;
export type PhaseTemplateApplication = typeof phaseTemplateApplication.$inferSelect;

// ===================== ENGINEERING DELIVERABLES =====================

export const DELIVERABLE_STATUSES = [
  "TO DO", "IN PROGRESS", "NEEDS APPROVAL", "PROVIDE FEEDBACK",
  "QC APPROVED", "OPERATIONAL APPROVAL", "COMPLETE"
] as const;
export type DeliverableStatus = typeof DELIVERABLE_STATUSES[number];

export const deliverables = pgTable("deliverables", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  deliverableType: text("deliverable_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  phase: text("phase"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  reviewerUserId: integer("reviewer_user_id").references(() => users.id),
  qcReviewerUserId: integer("qc_reviewer_user_id").references(() => users.id),
  status: text("status").notNull().default("TO DO"),
  currentVersion: integer("current_version").notNull().default(1),
  sharepointFolderSiteId: text("sharepoint_folder_site_id"),
  sharepointFolderDriveId: text("sharepoint_folder_drive_id"),
  sharepointFolderItemId: text("sharepoint_folder_item_id"),
  linkedPlanItemId: integer("linked_plan_item_id"),
  linkedQualityItemInstanceId: integer("linked_quality_item_instance_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertDeliverableSchema = createInsertSchema(deliverables).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDeliverable = z.infer<typeof insertDeliverableSchema>;
export type Deliverable = typeof deliverables.$inferSelect;

export const deliverableVersions = pgTable("deliverable_versions", {
  id: serial("id").primaryKey(),
  deliverableId: integer("deliverable_id").notNull().references(() => deliverables.id, { onDelete: 'cascade' }),
  versionNumber: integer("version_number").notNull(),
  changeReason: text("change_reason"),
  impactJson: jsonb("impact_json"),
  status: text("status").notNull().default("IN PROGRESS"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertDeliverableVersionSchema = createInsertSchema(deliverableVersions).omit({ id: true, createdAt: true });
export type InsertDeliverableVersion = z.infer<typeof insertDeliverableVersionSchema>;
export type DeliverableVersion = typeof deliverableVersions.$inferSelect;

export const deliverableFiles = pgTable("deliverable_files", {
  id: serial("id").primaryKey(),
  deliverableId: integer("deliverable_id").notNull().references(() => deliverables.id, { onDelete: 'cascade' }),
  versionId: integer("version_id").references(() => deliverableVersions.id, { onDelete: 'cascade' }),
  siteId: text("site_id"),
  driveId: text("drive_id"),
  fileItemId: text("file_item_id"),
  fileName: text("file_name").notNull(),
  webUrl: text("web_url"),
  isApproved: boolean("is_approved").notNull().default(false),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});
export const insertDeliverableFileSchema = createInsertSchema(deliverableFiles).omit({ id: true, uploadedAt: true });
export type InsertDeliverableFile = z.infer<typeof insertDeliverableFileSchema>;
export type DeliverableFile = typeof deliverableFiles.$inferSelect;

export const deliverableEvents = pgTable("deliverable_events", {
  id: serial("id").primaryKey(),
  deliverableId: integer("deliverable_id").notNull().references(() => deliverables.id, { onDelete: 'cascade' }),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  feedbackText: text("feedback_text"),
  actorUserId: integer("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertDeliverableEventSchema = createInsertSchema(deliverableEvents).omit({ id: true, createdAt: true });
export type InsertDeliverableEvent = z.infer<typeof insertDeliverableEventSchema>;
export type DeliverableEvent = typeof deliverableEvents.$inferSelect;

// ===================== ENHANCED WARNING ENGINE =====================

export const WARNING_TYPES = [
  "overdue_task", "missing_approval", "missing_evidence", "orphan_task",
  "milestone_risk", "invalid_dates", "deliverable_version_risk",
  "folder_mismatch", "risk_trigger", "review_stuck", "task_complete_unapproved"
] as const;
export type WarningType = typeof WARNING_TYPES[number];

export const WARNING_SEVERITIES = ["HIGH", "MED", "LOW"] as const;
export type WarningSeverity = typeof WARNING_SEVERITIES[number];

export const WARNING_STATUSES = ["open", "in_progress", "resolved", "accepted_risk"] as const;
export type WarningStatus = typeof WARNING_STATUSES[number];

// ===================== NOTIFICATIONS ENGINE =====================

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  recipientUserId: integer("recipient_user_id").notNull().references(() => users.id),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  projectName: text("project_name"),
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
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export const notificationThrottle = pgTable("notification_throttle", {
  id: serial("id").primaryKey(),
  recipientUserId: integer("recipient_user_id").notNull().references(() => users.id),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  lastSentAt: timestamp("last_sent_at").notNull().defaultNow(),
});
export const insertNotificationThrottleSchema = createInsertSchema(notificationThrottle).omit({ id: true });
export type InsertNotificationThrottle = z.infer<typeof insertNotificationThrottleSchema>;
export type NotificationThrottle = typeof notificationThrottle.$inferSelect;

// ===================== SHAREPOINT FILE POINTERS =====================

export const spFilePointers = pgTable("sp_file_pointers", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  siteId: text("site_id").notNull(),
  driveId: text("drive_id").notNull(),
  folderItemId: text("folder_item_id"),
  fileItemId: text("file_item_id").notNull(),
  fileName: text("file_name").notNull(),
  webUrl: text("web_url"),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});
export const insertSpFilePointerSchema = createInsertSchema(spFilePointers).omit({ id: true, uploadedAt: true });
export type InsertSpFilePointer = z.infer<typeof insertSpFilePointerSchema>;
export type SpFilePointer = typeof spFilePointers.$inferSelect;

// ===================== TASK WATCHER JUNCTION =====================

export const taskWatchers = pgTable("task_watchers", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => operationalTasks.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertTaskWatcherSchema = createInsertSchema(taskWatchers).omit({ id: true, createdAt: true });
export type InsertTaskWatcher = z.infer<typeof insertTaskWatcherSchema>;
export type TaskWatcher = typeof taskWatchers.$inferSelect;

// ===================== EMAIL TRIAGE RULES =====================

export const triageRuleTypeEnum = pgEnum('triage_rule_type', ['keyword', 'sender', 'domain']);

export const triageRules = pgTable("triage_rules", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  ruleType: triageRuleTypeEnum("rule_type").notNull(),
  value: text("value").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertTriageRuleSchema = createInsertSchema(triageRules).omit({ id: true, createdAt: true });
export type InsertTriageRule = z.infer<typeof insertTriageRuleSchema>;
export type TriageRule = typeof triageRules.$inferSelect;

export const TASK_BUCKETS = ['project', 'company_ops', 'personal'] as const;
export type TaskBucket = typeof TASK_BUCKETS[number];
export const TASK_BUCKET_LABELS: Record<TaskBucket, string> = {
  project: "Project",
  company_ops: "Company Ops",
  personal: "Personal",
};

// ===================== COMPANY ROLES (Part A) =====================

export const COMPANY_ROLES = [
  'COO_ADMIN',
  'CEO_ADMIN',
  'CCO',
  'CFO',
  'PROGRAM_MANAGER',
  'PROGRAM_FINANCE_MANAGER',
  'CONSTRUCTION_MANAGER',
  'QUALITY_MANAGER',
  'ENGINEERING_MANAGER',
  'KEY_ACCOUNTS_MANAGER',
  'ACCOUNTANT',
  'ENGINEER',
  'PROJECT_MANAGER_SITE',
  'PROJECT_DEVELOPER',
] as const;
export type CompanyRole = typeof COMPANY_ROLES[number];

export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  COO_ADMIN: "COO",
  CEO_ADMIN: "CEO",
  CCO: "CCO",
  CFO: "CFO",
  PROGRAM_MANAGER: "Program Manager",
  PROGRAM_FINANCE_MANAGER: "Program Finance Manager",
  CONSTRUCTION_MANAGER: "Construction Manager",
  QUALITY_MANAGER: "Quality Manager",
  ENGINEERING_MANAGER: "Engineering Manager",
  KEY_ACCOUNTS_MANAGER: "Key Accounts Manager",
  ACCOUNTANT: "Accountant",
  ENGINEER: "Engineer",
  PROJECT_MANAGER_SITE: "Project Manager",
  PROJECT_DEVELOPER: "Project Developer",
};

export const ADMIN_ROLES: CompanyRole[] = ['COO_ADMIN', 'CEO_ADMIN'];

export const roleCredentials = pgTable("role_credentials", {
  id: serial("id").primaryKey(),
  role: text("role").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  lastPasswordPlain: text("last_password_plain"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertRoleCredentialSchema = createInsertSchema(roleCredentials).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRoleCredential = z.infer<typeof insertRoleCredentialSchema>;
export type RoleCredential = typeof roleCredentials.$inferSelect;

// ===================== APP SETTINGS (Part A) =====================

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type AppSetting = typeof appSettings.$inferSelect;

// ===================== COMPANY LIFECYCLE PHASES (Part C) =====================

export const COMPANY_LIFECYCLE_PHASES = [
  'FIRST_ASSESSMENT',
  'COST_PROPOSAL_DESIGN',
  'PD_PM_HANDOVER',
  'EXECUTION',
  'AFTER_SALES',
] as const;
export type CompanyLifecyclePhase = typeof COMPANY_LIFECYCLE_PHASES[number];

export const COMPANY_LIFECYCLE_PHASE_LABELS: Record<CompanyLifecyclePhase, string> = {
  FIRST_ASSESSMENT: "First Assessment",
  COST_PROPOSAL_DESIGN: "Cost Proposal & Design",
  PD_PM_HANDOVER: "PD → PM Handover",
  EXECUTION: "Execution",
  AFTER_SALES: "After Sales",
};

export const companyLifecyclePhaseEnum = pgEnum('company_lifecycle_phase', [
  'FIRST_ASSESSMENT',
  'COST_PROPOSAL_DESIGN',
  'PD_PM_HANDOVER',
  'EXECUTION',
  'AFTER_SALES',
]);

export const companyProjects = pgTable("company_projects", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull().unique(),
  projectKey: text("project_key"),
  lifecyclePhase: companyLifecyclePhaseEnum("lifecycle_phase").notNull().default('FIRST_ASSESSMENT'),
  phaseStartDate: text("phase_start_date"),
  phaseDueDate: text("phase_due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertCompanyProjectSchema = createInsertSchema(companyProjects).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyProject = z.infer<typeof insertCompanyProjectSchema>;
export type CompanyProject = typeof companyProjects.$inferSelect;

// ===================== ENGINEERING TASKS (Part E) =====================

export const engTaskStatusEnum = pgEnum('eng_task_status', ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'ON_HOLD']);

export const engineeringTasks = pgTable("engineering_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name"),
  title: text("title").notNull(),
  description: text("description"),
  lifecyclePhaseTag: companyLifecyclePhaseEnum("lifecycle_phase_tag").notNull().default('EXECUTION'),
  status: engTaskStatusEnum("status").notNull().default('NOT_STARTED'),
  requiresQcApproval: boolean("requires_qc_approval").notNull().default(false),
  requiresOpsApproval: boolean("requires_ops_approval").notNull().default(false),
  qcApprovedAt: timestamp("qc_approved_at"),
  qcApprovedByRole: text("qc_approved_by_role"),
  opsApprovedAt: timestamp("ops_approved_at"),
  opsApprovedByRole: text("ops_approved_by_role"),
  softDeletedAt: timestamp("soft_deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertEngineeringTaskSchema = createInsertSchema(engineeringTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEngineeringTask = z.infer<typeof insertEngineeringTaskSchema>;
export type EngineeringTask = typeof engineeringTasks.$inferSelect;

// ===================== ENGINEERING TASK ATTACHMENTS (Part F) =====================

export const engineeringTaskAttachments = pgTable("engineering_task_attachments", {
  id: serial("id").primaryKey(),
  engineeringTaskId: integer("engineering_task_id").notNull().references(() => engineeringTasks.id, { onDelete: 'cascade' }),
  displayName: text("display_name").notNull(),
  browserPathString: text("browser_path_string"),
  localFileName: text("local_file_name").notNull(),
  localFileSize: integer("local_file_size"),
  localLastModified: timestamp("local_last_modified"),
  computedFullPathReference: text("computed_full_path_reference"),
  notes: text("notes"),
  uploadedByRole: text("uploaded_by_role").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  softDeletedAt: timestamp("soft_deleted_at"),
});
export const insertEngTaskAttachmentSchema = createInsertSchema(engineeringTaskAttachments).omit({ id: true, uploadedAt: true });
export type InsertEngTaskAttachment = z.infer<typeof insertEngTaskAttachmentSchema>;
export type EngTaskAttachment = typeof engineeringTaskAttachments.$inferSelect;

// ===================== ENGINEERING TEMPLATES (Part E placeholder) =====================

export const engineeringTemplates = pgTable("engineering_templates", {
  id: serial("id").primaryKey(),
  lifecyclePhase: companyLifecyclePhaseEnum("lifecycle_phase").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const engineeringTemplateItems = pgTable("engineering_template_items", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => engineeringTemplates.id, { onDelete: 'cascade' }),
  title: text("title").notNull(),
  description: text("description"),
  requiresQcApproval: boolean("requires_qc_approval").notNull().default(false),
  requiresOpsApproval: boolean("requires_ops_approval").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ===================== ENGINEERING STAGE TEMPLATES (Part E2) =====================

export const engStageStatusEnum = pgEnum('eng_stage_status', ['not_started', 'in_progress', 'blocked', 'ready_for_review', 'complete']);
export const engTaskInstanceStatusEnum = pgEnum('eng_task_instance_status', ['pending', 'in_progress', 'complete', 'skipped']);
export const engApprovalStatusEnum = pgEnum('eng_approval_status', ['pending', 'approved', 'rejected']);

export const engStageTemplates = pgTable("eng_stage_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  purpose: text("purpose"),
  inputs: text("inputs").array(),
  raciResponsible: text("raci_responsible"),
  raciAccountable: text("raci_accountable"),
  raciConsulted: text("raci_consulted"),
  raciInformed: text("raci_informed"),
  failureModes: text("failure_modes").array(),
  stageGateRules: jsonb("stage_gate_rules"),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertEngStageTemplateSchema = createInsertSchema(engStageTemplates).omit({ id: true, createdAt: true });
export type InsertEngStageTemplate = z.infer<typeof insertEngStageTemplateSchema>;
export type EngStageTemplate = typeof engStageTemplates.$inferSelect;

export const engTaskTemplates = pgTable("eng_task_templates", {
  id: serial("id").primaryKey(),
  stageTemplateId: integer("stage_template_id").notNull().references(() => engStageTemplates.id, { onDelete: 'cascade' }),
  title: text("title").notNull(),
  description: text("description"),
  isRequired: boolean("is_required").notNull().default(true),
  sequence: integer("sequence").notNull().default(0),
  defaultOwnerRole: text("default_owner_role"),
});
export const insertEngTaskTemplateSchema = createInsertSchema(engTaskTemplates).omit({ id: true });
export type InsertEngTaskTemplate = z.infer<typeof insertEngTaskTemplateSchema>;
export type EngTaskTemplate = typeof engTaskTemplates.$inferSelect;

export const engDeliverableTemplates = pgTable("eng_deliverable_templates", {
  id: serial("id").primaryKey(),
  stageTemplateId: integer("stage_template_id").notNull().references(() => engStageTemplates.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  description: text("description"),
  isRequired: boolean("is_required").notNull().default(true),
  allowedFileTypes: text("allowed_file_types").array(),
  requiredCount: integer("required_count").notNull().default(1),
});
export const insertEngDeliverableTemplateSchema = createInsertSchema(engDeliverableTemplates).omit({ id: true });
export type InsertEngDeliverableTemplate = z.infer<typeof insertEngDeliverableTemplateSchema>;
export type EngDeliverableTemplate = typeof engDeliverableTemplates.$inferSelect;

export const projectEngStages = pgTable("project_eng_stages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  stageTemplateId: integer("stage_template_id").notNull().references(() => engStageTemplates.id),
  status: engStageStatusEnum("status").notNull().default('not_started'),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  overrideReason: text("override_reason"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectEngStageSchema = createInsertSchema(projectEngStages).omit({ id: true, createdAt: true });
export type InsertProjectEngStage = z.infer<typeof insertProjectEngStageSchema>;
export type ProjectEngStage = typeof projectEngStages.$inferSelect;

export const projectEngTasks = pgTable("project_eng_tasks", {
  id: serial("id").primaryKey(),
  projectEngStageId: integer("project_eng_stage_id").notNull().references(() => projectEngStages.id, { onDelete: 'cascade' }),
  taskTemplateId: integer("task_template_id").notNull().references(() => engTaskTemplates.id),
  status: engTaskInstanceStatusEnum("status").notNull().default('pending'),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  notes: text("notes"),
  dueDate: text("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => users.id),
  hasDeliverable: boolean("has_deliverable").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectEngTaskSchema = createInsertSchema(projectEngTasks).omit({ id: true, createdAt: true });
export type InsertProjectEngTask = z.infer<typeof insertProjectEngTaskSchema>;
export type ProjectEngTask = typeof projectEngTasks.$inferSelect;

export const projectEngDeliverables = pgTable("project_eng_deliverables", {
  id: serial("id").primaryKey(),
  projectEngStageId: integer("project_eng_stage_id").notNull().references(() => projectEngStages.id, { onDelete: 'cascade' }),
  deliverableTemplateId: integer("deliverable_template_id").references(() => engDeliverableTemplates.id),
  projectEngTaskId: integer("project_eng_task_id").references(() => projectEngTasks.id, { onDelete: 'set null' }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  storageRef: text("storage_ref").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  versionTag: text("version_tag"),
  notes: text("notes"),
  sharepointFolderPath: text("sharepoint_folder_path"),
  approvalStatus: text("approval_status").default("pending"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
});
export const insertProjectEngDeliverableSchema = createInsertSchema(projectEngDeliverables).omit({ id: true, uploadedAt: true });
export type InsertProjectEngDeliverable = z.infer<typeof insertProjectEngDeliverableSchema>;
export type ProjectEngDeliverable = typeof projectEngDeliverables.$inferSelect;

export const projectEngApprovals = pgTable("project_eng_approvals", {
  id: serial("id").primaryKey(),
  projectEngStageId: integer("project_eng_stage_id").notNull().references(() => projectEngStages.id, { onDelete: 'cascade' }),
  approverRole: text("approver_role").notNull(),
  approverUserId: integer("approver_user_id").references(() => users.id),
  status: engApprovalStatusEnum("status").notNull().default('pending'),
  comments: text("comments"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertProjectEngApprovalSchema = createInsertSchema(projectEngApprovals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectEngApproval = z.infer<typeof insertProjectEngApprovalSchema>;
export type ProjectEngApproval = typeof projectEngApprovals.$inferSelect;

// ===================== GLOBAL AUDIT LOG (Part K) =====================

export const auditSourceEnum = pgEnum('audit_source', ['UI', 'IMPORT', 'SETTINGS', 'DOCS', 'SYSTEM']);

export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  actorRole: text("actor_role").notNull(),
  source: auditSourceEnum("source").notNull().default('UI'),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  action: text("action").notNull(),
  changesJson: jsonb("changes_json"),
  projectName: text("project_name"),
  correlationId: text("correlation_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertAuditEventSchema = createInsertSchema(auditEvents).omit({ id: true, createdAt: true });
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEvents.$inferSelect;

// ===================== IMPORT DIFF EVENTS (Part G) =====================

export const importDiffEvents = pgTable("import_diff_events", {
  id: serial("id").primaryKey(),
  importRunId: integer("import_run_id").notNull().references(() => importRuns.id),
  entityKey: text("entity_key").notNull(),
  fieldName: text("field_name").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type ImportDiffEvent = typeof importDiffEvents.$inferSelect;

// ===================== UNIFIED ROLE PERMISSIONS =====================

export const APP_SECTIONS = [
  'EXCO',
  'PROJECT_MANAGEMENT',
  'ENGINEERING',
  'QUALITY',
  'ADMIN',
  'MY_TOOL',
  'FINANCE',
  'PROJECTS',
  'OPERATIONS',
  'GOVERNANCE',
  'COCKPIT',
  'MONEY',
  'DELIVERY',
] as const;
export type AppSection = typeof APP_SECTIONS[number];

export const APP_SECTION_LABELS: Record<AppSection, string> = {
  EXCO: "Executive (Lifecycle, Priorities)",
  PROJECT_MANAGEMENT: "Project Management",
  ENGINEERING: "Engineering Dashboard & Tasks",
  QUALITY: "Quality Management",
  ADMIN: "Admin (Settings, Templates, Import)",
  MY_TOOL: "My Tool (Daily Planner)",
  FINANCE: "Finance (Cashflow, COS, Budgets)",
  PROJECTS: "Projects (Summary, Lifecycle, Reviews)",
  OPERATIONS: "Operations (Finance, Engineering, Procurement)",
  GOVERNANCE: "Governance (Quality, Audit, Priorities)",
  COCKPIT: "Cockpit (Execution Board, My Tool)",
  MONEY: "Money (Cashflow, COS, Procurement)",
  DELIVERY: "Delivery (Engineering, Tasks, Pipeline)",
};

export const UX_REDESIGN_ENABLED = true;

export type PermissionEntity = 'projects' | 'financials' | 'quality' | 'engineering' | 'procurement' | 'admin' | 'governance'
  | 'cos' | 'cashflow' | 'smart_import' | 'tr_register' | 'pm_dashboard'
  | 'eng_stages' | 'eng_tasks' | 'lifecycle' | 'my_tool' | 'create_project'
  | 'weekly_reviews' | 'ee_info'
  | 'execution_board' | 'leaderboard' | 'feedback' | 'approvals' | 'activity_log'
  | 'company_priorities' | 'meetings' | 'phase_templates' | 'invoice_patterns'
  | 'portfolios' | 'notifications' | 'subcontractors' | 'cos_control' | 'cashflow_forecast' | 'home'
  | 'pd_overview' | 'pd_plan' | 'pd_finance' | 'pd_engineering' | 'pd_quality' | 'pd_history'
  | 'pd_revenue' | 'pd_expenditure' | 'pd_cos_tracker' | 'pd_cashflow' | 'pd_subcontractors'
  | 'pd_eng_tasks' | 'pd_eng_stages' | 'pd_gantt' | 'pd_key_dates'
  | 'pd_tickets' | 'pd_dashboard' | 'pd_clients'
  | 'triage_inbox' | 'unclassified_tasks' | 'eng_sync' | 'eng_inbox'
  | 'portfolio_detail' | 'project_normalized' | 'admin_roles' | 'revenue'
  | 'ee_info_lifecycle' | 'ee_info_departments' | 'ee_info_processes' | 'ee_info_templates'
  | 'teams_chat' | 'financial_integration' | 'pd_collaboration' | 'operational_tasks' | 'gamification';
export type PermissionAction = 'view' | 'edit' | 'approve' | 'override' | 'delete';

export interface EntityPermissionRule {
  entity: PermissionEntity;
  view_roles: string[];
  edit_roles: string[];
  approve_roles: string[];
  override_roles: string[];
  delete_roles: string[];
}

export const ENTITY_PERMISSION_DEFAULTS: EntityPermissionRule[] = [
  {
    entity: 'projects',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'financials',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'cos',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'cashflow',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'quality',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'engineering',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'eng_stages',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'QUALITY_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'eng_tasks',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
  },
  {
    entity: 'procurement',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'admin',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'governance',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'weekly_reviews',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'smart_import',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'tr_register',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pm_dashboard',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'lifecycle',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'ENGINEERING_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'create_project',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'my_tool',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ee_info',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_overview',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_plan',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_finance',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_engineering',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_quality',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER'],
  },
  {
    entity: 'pd_history',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_revenue',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_expenditure',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_cos_tracker',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_cashflow',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_subcontractors',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_eng_tasks',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
  },
  {
    entity: 'pd_eng_stages',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'QUALITY_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_gantt',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_key_dates',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'execution_board',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'leaderboard',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'feedback',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'approvals',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'activity_log',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'company_priorities',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'meetings',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'phase_templates',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'invoice_patterns',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'portfolios',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'notifications',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'subcontractors',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'cos_control',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'cashflow_forecast',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'home',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_tickets',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_dashboard',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_clients',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'triage_inbox',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'unclassified_tasks',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'eng_sync',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'eng_inbox',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'ENGINEERING_MANAGER', 'CONSTRUCTION_MANAGER', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER', 'PROGRAM_MANAGER', 'ENGINEER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'ENGINEERING_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'portfolio_detail',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'project_normalized',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'admin_roles',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'revenue',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ee_info_lifecycle',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ee_info_departments',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ee_info_processes',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'ee_info_templates',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT', 'ENGINEER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'teams_chat',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER'],
  },
  {
    entity: 'financial_integration',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_FINANCE_MANAGER', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER', 'PROJECT_MANAGER_SITE'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'pd_collaboration',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'operational_tasks',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN', 'PROGRAM_MANAGER', 'CONSTRUCTION_MANAGER'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
  {
    entity: 'gamification',
    view_roles: ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER', 'KEY_ACCOUNTS_MANAGER', 'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER', 'ENGINEER', 'ACCOUNTANT'],
    edit_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    approve_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    override_roles: ['COO_ADMIN', 'CEO_ADMIN'],
    delete_roles: ['COO_ADMIN', 'CEO_ADMIN'],
  },
];

export function checkPermission(role: string, entity: PermissionEntity, action: PermissionAction): boolean {
  const rule = ENTITY_PERMISSION_DEFAULTS.find(r => r.entity === entity);
  if (!rule) return false;
  const actionKey = `${action}_roles` as keyof EntityPermissionRule;
  const allowedRoles = rule[actionKey] as string[];
  return allowedRoles.includes(role);
}

export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  role: text("role").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  sections: text("sections").array().notNull().default([]),
  canManageUsers: boolean("can_manage_users").notNull().default(false),
  canManageRoles: boolean("can_manage_roles").notNull().default(false),
  canEditData: boolean("can_edit_data").notNull().default(true),
  entityPermissions: jsonb("entity_permissions"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;

export const mergeAuditLog = pgTable("merge_audit_log", {
  id: serial("id").primaryKey(),
  primaryProjectId: integer("primary_project_id").notNull(),
  secondaryProjectId: integer("secondary_project_id").notNull(),
  primaryProjectName: text("primary_project_name").notNull(),
  secondaryProjectName: text("secondary_project_name").notNull(),
  mergedByUserId: integer("merged_by_user_id").references(() => users.id),
  mergedByRole: text("merged_by_role"),
  reason: text("reason"),
  conflictsJson: text("conflicts_json"),
  movedTaskCount: integer("moved_task_count").notNull().default(0),
  movedPlanCount: integer("moved_plan_count").notNull().default(0),
  mergedAt: timestamp("merged_at").notNull().defaultNow(),
});
export type MergeAuditLog = typeof mergeAuditLog.$inferSelect;

export const executionGateLog = pgTable("execution_gate_log", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  reason: text("reason"),
  changedByUserId: integer("changed_by_user_id").references(() => users.id),
  changedByRole: text("changed_by_role"),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});
export type ExecutionGateLog = typeof executionGateLog.$inferSelect;

export const smartImportRuns = pgTable("smart_import_runs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  sourceFileName: text("source_file_name").notNull(),
  sourceFileHash: text("source_file_hash"),
  status: smartImportStatusEnum("status").notNull().default('PREVIEW'),
  templateProfileId: integer("template_profile_id"),
  summaryJson: jsonb("summary_json"),
  committedAt: timestamp("committed_at"),
  committedBy: integer("committed_by").references(() => users.id),
});
export const insertSmartImportRunSchema = createInsertSchema(smartImportRuns).omit({ id: true, uploadedAt: true });
export type InsertSmartImportRun = z.infer<typeof insertSmartImportRunSchema>;
export type SmartImportRun = typeof smartImportRuns.$inferSelect;

export const importIssues = pgTable("import_issues", {
  id: serial("id").primaryKey(),
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
  severity: importIssueSeverityEnum("severity").notNull(),
  section: importSectionEnum("section").notNull(),
  message: text("message").notNull(),
  suggestedAction: text("suggested_action"),
  issueType: text("issue_type"),
  issueFingerprint: text("issue_fingerprint"),
  resolved: boolean("resolved").notNull().default(false),
  resolution: text("resolution"),
  resolutionNote: text("resolution_note"),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  autoResolved: boolean("auto_resolved").notNull().default(false),
  matchedRuleId: integer("matched_rule_id"),
  overrideData: jsonb("override_data"),
  payloadJson: jsonb("payload_json"),
});
export const insertImportIssueSchema = createInsertSchema(importIssues).omit({ id: true });
export type InsertImportIssue = z.infer<typeof insertImportIssueSchema>;
export type ImportIssue = typeof importIssues.$inferSelect;

export const issueResolutionRules = pgTable("issue_resolution_rules", {
  id: serial("id").primaryKey(),
  projectName: text("project_name"),
  issueType: text("issue_type").notNull(),
  fingerprint: text("fingerprint").notNull(),
  section: importSectionEnum("section").notNull(),
  resolution: text("resolution").notNull(),
  resolutionNote: text("resolution_note"),
  overrideData: jsonb("override_data"),
  applyAlways: boolean("apply_always").notNull().default(false),
  timesApplied: integer("times_applied").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastAppliedAt: timestamp("last_applied_at"),
  active: boolean("active").notNull().default(true),
});
export const insertIssueResolutionRuleSchema = createInsertSchema(issueResolutionRules).omit({ id: true, createdAt: true });
export type InsertIssueResolutionRule = z.infer<typeof insertIssueResolutionRuleSchema>;
export type IssueResolutionRule = typeof issueResolutionRules.$inferSelect;

export const templateProfiles = pgTable("template_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  signatureJson: jsonb("signature_json"),
  isDefault: boolean("is_default").notNull().default(false),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertTemplateProfileSchema = createInsertSchema(templateProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTemplateProfile = z.infer<typeof insertTemplateProfileSchema>;
export type TemplateProfile = typeof templateProfiles.$inferSelect;

export const mappingRules = pgTable("mapping_rules", {
  id: serial("id").primaryKey(),
  templateProfileId: integer("template_profile_id").notNull().references(() => templateProfiles.id),
  section: importSectionEnum("section").notNull(),
  sourceHeader: text("source_header").notNull(),
  canonicalField: text("canonical_field").notNull(),
  confidenceWeight: real("confidence_weight").notNull().default(1.0),
  examplesJson: jsonb("examples_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertMappingRuleSchema = createInsertSchema(mappingRules).omit({ id: true, createdAt: true });
export type InsertMappingRule = z.infer<typeof insertMappingRuleSchema>;
export type MappingRule = typeof mappingRules.$inferSelect;

export const normalizedPlanTasks = pgTable("normalized_plan_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  taskName: text("task_name").notNull(),
  taskNo: text("task_no"),
  phase: text("phase"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  durationDays: integer("duration_days"),
  actualStartDate: text("actual_start_date"),
  actualEndDate: text("actual_end_date"),
  actualDurationDays: integer("actual_duration_days"),
  owner: text("owner"),
  status: text("status"),
  pctComplete: real("pct_complete"),
  comment: text("comment"),
  sourceSheet: text("source_sheet"),
  sourceRow: integer("source_row"),
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
});
export const insertNormalizedPlanTaskSchema = createInsertSchema(normalizedPlanTasks).omit({ id: true });
export type InsertNormalizedPlanTask = z.infer<typeof insertNormalizedPlanTaskSchema>;
export type NormalizedPlanTask = typeof normalizedPlanTasks.$inferSelect;

export const normalizedRevenueLines = pgTable("normalized_revenue_lines", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  description: text("description"),
  milestoneName: text("milestone_name"),
  amountExVat: text("amount_ex_vat"),
  vat: text("vat"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  invoiceDateFontColor: text("invoice_date_font_color"),
  invoiceDateConfirmed: boolean("invoice_date_confirmed"),
  expectedPaymentDate: text("expected_payment_date"),
  paidDate: text("paid_date"),
  paidDateFontColor: text("paid_date_font_color"),
  paidDateConfirmed: boolean("paid_date_confirmed"),
  inBankDate: text("in_bank_date"),
  status: revenueLineStatusEnum("status").notNull().default('PLANNED'),
  sourceSheet: text("source_sheet"),
  sourceRow: integer("source_row"),
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
  turnaroundDays: integer("turnaround_days"),
});
export const insertNormalizedRevenueLineSchema = createInsertSchema(normalizedRevenueLines).omit({ id: true });
export type InsertNormalizedRevenueLine = z.infer<typeof insertNormalizedRevenueLineSchema>;
export type NormalizedRevenueLine = typeof normalizedRevenueLines.$inferSelect;

export const counterparties = pgTable("counterparties", {
  id: serial("id").primaryKey(),
  nameCanonical: text("name_canonical").notNull(),
  nameAliases: jsonb("name_aliases").notNull().default([]),
  typeDefault: counterpartyTypeEnum("type_default").notNull().default('OTHER'),
  isCore: boolean("is_core").notNull().default(false),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at"),
});
export const insertCounterpartySchema = createInsertSchema(counterparties).omit({ id: true, createdAt: true });
export type InsertCounterparty = z.infer<typeof insertCounterpartySchema>;
export type Counterparty = typeof counterparties.$inferSelect;

export const normalizedCostLines = pgTable("normalized_cost_lines", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  costCategory: text("cost_category"),
  counterpartyId: integer("counterparty_id").references(() => counterparties.id),
  counterpartyName: text("counterparty_name"),
  counterpartyType: counterpartyTypeEnum("counterparty_type"),
  description: text("description"),
  amountExVat: text("amount_ex_vat"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  invoiceDateFontColor: text("invoice_date_font_color"),
  invoiceDateConfirmed: boolean("invoice_date_confirmed"),
  approvedDate: text("approved_date"),
  paidDate: text("paid_date"),
  paidDateFontColor: text("paid_date_font_color"),
  paidDateConfirmed: boolean("paid_date_confirmed"),
  poNumber: text("po_number"),
  cosRealised: boolean("cos_realised"),
  cashflowConfirmed: boolean("cashflow_confirmed"),
  status: costLineStatusEnum("cost_line_status").notNull().default('PLANNED'),
  sourceSheet: text("source_sheet"),
  sourceRow: integer("source_row"),
  importRunId: integer("import_run_id").references(() => smartImportRuns.id),
  turnaroundDays: integer("turnaround_days"),
  patternRuleId: integer("pattern_rule_id"),
  patternClassifiedAt: timestamp("pattern_classified_at"),
  patternInferredType: text("pattern_inferred_type"),
});
export const insertNormalizedCostLineSchema = createInsertSchema(normalizedCostLines).omit({ id: true });
export type InsertNormalizedCostLine = z.infer<typeof insertNormalizedCostLineSchema>;
export type NormalizedCostLine = typeof normalizedCostLines.$inferSelect;

export const normalizedExecutionPhases = pgTable("normalized_execution_phases", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  phaseName: text("phase_name").notNull(),
  phaseDate: text("phase_date"),
  source: phaseSourceEnum("source").notNull().default('EXCEL_IMPORT'),
  importRunId: integer("import_run_id").references(() => smartImportRuns.id),
});
export const insertNormalizedExecutionPhaseSchema = createInsertSchema(normalizedExecutionPhases).omit({ id: true });
export type InsertNormalizedExecutionPhase = z.infer<typeof insertNormalizedExecutionPhaseSchema>;
export type NormalizedExecutionPhase = typeof normalizedExecutionPhases.$inferSelect;

// ===================== SHAREPOINT PROPOSALS PIPELINE =====================

export const INTAKE_REQUEST_TYPES = [
  "First Assessment",
  "Cost Proposal",
  "Site Visit Report",
  "Meter Installation",
  "Data Analysis Request",
  "Sizing Rational Request",
] as const;
export type IntakeRequestType = typeof INTAKE_REQUEST_TYPES[number];

export const INTAKE_STATUSES = [
  "NOT STARTED", "IN PROGRESS", "COMPLETED", "ON HOLD", "CANCELLED",
] as const;

export const FIELD_OWNERSHIP = ["SP_OWNED", "APP_OWNED", "SHARED"] as const;
export type FieldOwnership = typeof FIELD_OWNERSHIP[number];

export const spListConfig = pgTable("sp_list_config", {
  id: serial("id").primaryKey(),
  siteId: text("site_id").notNull(),
  listId: text("list_id").notNull(),
  siteName: text("site_name"),
  listName: text("list_name"),
  siteUrl: text("site_url"),
  columnMappingJson: jsonb("column_mapping_json"),
  fieldOwnershipJson: jsonb("field_ownership_json"),
  lastPulledAt: timestamp("last_pulled_at"),
  lastPushedAt: timestamp("last_pushed_at"),
  lastDeltaToken: text("last_delta_token"),
  syncViewFilter: text("sync_view_filter").default("IN PROGRESS"),
  configuredByRole: text("configured_by_role"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertSpListConfigSchema = createInsertSchema(spListConfig).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpListConfig = z.infer<typeof insertSpListConfigSchema>;
export type SpListConfig = typeof spListConfig.$inferSelect;

export const intakeRequests = pgTable("intake_requests", {
  id: serial("id").primaryKey(),
  spItemId: text("sp_item_id").notNull().unique(),
  projectId: integer("project_id").references(() => projectInfo.id),
  clientKey: text("client_key").notNull(),
  clientName: text("client_name").notNull(),
  requestType: text("request_type"),
  status: text("status"),
  priority: text("priority"),
  dueDate: text("due_date"),
  daysInProgress: integer("days_in_progress"),
  projectDeveloper: text("project_developer"),
  designer: text("designer"),
  sizeKwp: text("size_kwp"),
  province: text("province"),
  gpsCoordinates: text("gps_coordinates"),
  fundingType: text("funding_type"),
  billsTariffData: text("bills_tariff_data"),
  meteringData: text("metering_data"),
  siteInspectionForm: text("site_inspection_form"),
  comments: text("comments"),
  workingSchedule: text("working_schedule"),
  batteriesNeeded: text("batteries_needed"),
  batterySize: text("battery_size"),
  dieselGenNeeded: text("diesel_gen_needed"),
  roofReplacementNeeded: text("roof_replacement_needed"),
  hseDiscussed: text("hse_discussed"),
  numberOfReworks: integer("number_of_reworks"),
  clickUpSynced: text("clickup_synced"),
  itemType: text("item_type"),
  spPath: text("sp_path"),
  spEtag: text("sp_etag"),
  spRawJson: jsonb("sp_raw_json"),
  appNotes: text("app_notes"),
  appInternalBlockers: text("app_internal_blockers"),
  cpSigned: boolean("cp_signed").notNull().default(false),
  cpSignedDate: text("cp_signed_date"),
  cpSignedBy: text("cp_signed_by"),
  cpEvidenceType: text("cp_evidence_type"),
  cpEvidenceRef: text("cp_evidence_ref"),
  pmCreated: boolean("pm_created").notNull().default(false),
  tasksGenerated: boolean("tasks_generated").notNull().default(false),
  lastPulledAt: timestamp("last_pulled_at"),
  lastPushedAt: timestamp("last_pushed_at"),
  lastPulledHash: text("last_pulled_hash"),
  lastAppEditAt: timestamp("last_app_edit_at"),
  syncConflict: boolean("sync_conflict").notNull().default(false),
  conflictFieldsJson: jsonb("conflict_fields_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertIntakeRequestSchema = createInsertSchema(intakeRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntakeRequest = z.infer<typeof insertIntakeRequestSchema>;
export type IntakeRequest = typeof intakeRequests.$inferSelect;

export const intakeTaskTemplates = pgTable("intake_task_templates", {
  id: serial("id").primaryKey(),
  requestType: text("request_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dodItems: jsonb("dod_items"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertIntakeTaskTemplateSchema = createInsertSchema(intakeTaskTemplates).omit({ id: true, createdAt: true });
export type InsertIntakeTaskTemplate = z.infer<typeof insertIntakeTaskTemplateSchema>;
export type IntakeTaskTemplate = typeof intakeTaskTemplates.$inferSelect;

export const intakeTasks = pgTable("intake_tasks", {
  id: serial("id").primaryKey(),
  intakeRequestId: integer("intake_request_id").notNull().references(() => intakeRequests.id, { onDelete: 'cascade' }),
  templateItemId: integer("template_item_id").references(() => intakeTaskTemplates.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("NOT_STARTED"),
  dodItems: jsonb("dod_items"),
  dodCompletedJson: jsonb("dod_completed_json"),
  assignedTo: text("assigned_to"),
  dueDate: text("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: text("completed_by"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertIntakeTaskSchema = createInsertSchema(intakeTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntakeTask = z.infer<typeof insertIntakeTaskSchema>;
export type IntakeTask = typeof intakeTasks.$inferSelect;

export const syncAuditLog = pgTable("sync_audit_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  actorRole: text("actor_role").notNull(),
  direction: text("direction").notNull(),
  summary: jsonb("summary"),
  errorsJson: jsonb("errors_json"),
  conflictsJson: jsonb("conflicts_json"),
  itemCount: integer("item_count").notNull().default(0),
  newProjectsCount: integer("new_projects_count").notNull().default(0),
  newRequestsCount: integer("new_requests_count").notNull().default(0),
  updatedRequestsCount: integer("updated_requests_count").notNull().default(0),
  conflictsCount: integer("conflicts_count").notNull().default(0),
  errorsCount: integer("errors_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertSyncAuditLogSchema = createInsertSchema(syncAuditLog).omit({ id: true, createdAt: true });
export type InsertSyncAuditLog = z.infer<typeof insertSyncAuditLogSchema>;
export type SyncAuditLog = typeof syncAuditLog.$inferSelect;

export const SP_OWNED_FIELDS = [
  "clientName", "dueDate", "requestType", "projectDeveloper", "designer",
  "fundingType", "sizeKwp", "province", "workingSchedule", "gpsCoordinates",
  "billsTariffData", "meteringData", "siteInspectionForm",
  "batteriesNeeded", "batterySize", "dieselGenNeeded", "roofReplacementNeeded",
  "hseDiscussed", "numberOfReworks", "daysInProgress",
] as const;

export const APP_OWNED_FIELDS = [
  "appNotes", "appInternalBlockers", "cpSigned", "cpSignedDate", "cpSignedBy",
  "cpEvidenceType", "cpEvidenceRef", "pmCreated", "tasksGenerated",
] as const;

export const SHARED_FIELDS = ["status", "comments", "priority"] as const;

export const mockSpItems = pgTable("mock_sp_items", {
  id: serial("id").primaryKey(),
  mockItemId: text("mock_item_id").notNull().unique(),
  fields: jsonb("fields").notNull(),
  etag: text("etag"),
  createdDateTime: text("created_date_time"),
  lastModifiedDateTime: text("last_modified_date_time"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type MockSpItem = typeof mockSpItems.$inferSelect;

// ===================== INVOICE PATTERN CLASSIFICATION =====================

export const patternTypeEnum = pgEnum('pattern_type', ['PREFIX', 'REGEX', 'TOKEN_SHAPE']);
export const patternMatchOutcomeEnum = pgEnum('pattern_match_outcome', ['AUTO_APPLIED', 'USER_CONFIRMED', 'USER_OVERRIDDEN', 'UNRESOLVED']);

export const invoicePatternRules = pgTable("invoice_pattern_rules", {
  id: serial("id").primaryKey(),
  patternType: patternTypeEnum("pattern_type").notNull(),
  patternValue: text("pattern_value").notNull(),
  normalizedExample: text("normalized_example"),
  counterpartyId: integer("counterparty_id").references(() => counterparties.id),
  counterpartyName: text("counterparty_name"),
  inferredType: counterpartyTypeEnum("inferred_type").notNull(),
  confidenceWeight: integer("confidence_weight").notNull().default(50),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastConfirmedAt: timestamp("last_confirmed_at"),
  timesMatched: integer("times_matched").notNull().default(0),
  timesConfirmed: integer("times_confirmed").notNull().default(0),
  timesOverridden: integer("times_overridden").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});
export const insertInvoicePatternRuleSchema = createInsertSchema(invoicePatternRules).omit({ id: true, createdAt: true, timesMatched: true, timesConfirmed: true, timesOverridden: true });
export type InsertInvoicePatternRule = z.infer<typeof insertInvoicePatternRuleSchema>;
export type InvoicePatternRule = typeof invoicePatternRules.$inferSelect;

export const invoicePatternMatches = pgTable("invoice_pattern_matches", {
  id: serial("id").primaryKey(),
  importRunId: integer("import_run_id").references(() => smartImportRuns.id),
  projectId: integer("project_id").references(() => projectInfo.id),
  invoiceNumberRaw: text("invoice_number_raw"),
  invoiceNumberNorm: text("invoice_number_norm"),
  matchedRuleId: integer("matched_rule_id").references(() => invoicePatternRules.id),
  inferredType: counterpartyTypeEnum("inferred_type").notNull().default('OTHER'),
  inferredCounterpartyId: integer("inferred_counterparty_id").references(() => counterparties.id),
  confidenceScore: integer("confidence_score").notNull().default(0),
  outcome: patternMatchOutcomeEnum("outcome").notNull().default('UNRESOLVED'),
  sourceRow: integer("source_row"),
  overrideReason: text("override_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertInvoicePatternMatchSchema = createInsertSchema(invoicePatternMatches).omit({ id: true, createdAt: true });
export type InsertInvoicePatternMatch = z.infer<typeof insertInvoicePatternMatchSchema>;
export type InvoicePatternMatch = typeof invoicePatternMatches.$inferSelect;

// ===================== IMMUTABLE AUDIT SYSTEM =====================

export const changeSetSourceEnum = pgEnum('change_set_source', ['IMPORT', 'MANUAL_EDIT', 'OVERRIDE', 'CONFLICT_RESOLUTION', 'PATTERN_LEARNING', 'COUNTERPARTY_UPDATE', 'SYSTEM']);

export const changeSets = pgTable("change_sets", {
  id: serial("id").primaryKey(),
  actorRole: text("actor_role"),
  actorUserId: integer("actor_user_id"),
  source: changeSetSourceEnum("source").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  projectId: integer("project_id"),
  projectName: text("project_name"),
  importRunId: integer("import_run_id"),
  smartImportRunId: integer("smart_import_run_id"),
  action: text("action").notNull(),
  summary: text("summary"),
  overrideCategory: text("override_category"),
  overrideComment: text("override_comment"),
  correlationId: text("correlation_id"),
  fileMetadata: jsonb("file_metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertChangeSetSchema = createInsertSchema(changeSets).omit({ id: true, createdAt: true });
export type InsertChangeSet = z.infer<typeof insertChangeSetSchema>;
export type ChangeSet = typeof changeSets.$inferSelect;

export const fieldChanges = pgTable("field_changes", {
  id: serial("id").primaryKey(),
  changeSetId: integer("change_set_id").notNull().references(() => changeSets.id),
  fieldName: text("field_name").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  dataType: text("data_type").default("text"),
});
export const insertFieldChangeSchema = createInsertSchema(fieldChanges).omit({ id: true });
export type InsertFieldChange = z.infer<typeof insertFieldChangeSchema>;
export type FieldChange = typeof fieldChanges.$inferSelect;

// Override governance categories
export const OVERRIDE_CATEGORIES = [
  'DATA_CORRECTION',
  'BUSINESS_DECISION',
  'TIMING_ADJUSTMENT',
  'SCOPE_CHANGE',
  'RECONCILIATION',
  'SYSTEM_ERROR_FIX',
  'OTHER',
] as const;
export type OverrideCategory = typeof OVERRIDE_CATEGORIES[number];

export const weeklyReviews = pgTable("weekly_reviews", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  weekStarting: date("week_starting").notNull(),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  status: text("status").notNull().default("draft"),
  stepSchedule: jsonb("step_schedule"),
  stepBudget: jsonb("step_budget"),
  stepRisks: jsonb("step_risks"),
  stepQuality: jsonb("step_quality"),
  stepActions: jsonb("step_actions"),
  stepSummary: jsonb("step_summary"),
  snapshotMetrics: jsonb("snapshot_metrics"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});
export const insertWeeklyReviewSchema = createInsertSchema(weeklyReviews).omit({ id: true, createdAt: true });
export type InsertWeeklyReview = z.infer<typeof insertWeeklyReviewSchema>;
export type WeeklyReview = typeof weeklyReviews.$inferSelect;

export const WEEKLY_REVIEW_STEPS = [
  'schedule',
  'budget',
  'risks',
  'quality',
  'actions',
  'summary',
] as const;
export type WeeklyReviewStep = typeof WEEKLY_REVIEW_STEPS[number];

export const trRagStatusEnum = pgEnum("tr_rag_status", ["Red", "Amber", "Green"]);
export const trStatusEnum = pgEnum("tr_status", ["Active", "Completed"]);
export const trLinkStatusEnum = pgEnum("tr_link_status", ["Linked", "TaskCreated", "Done"]);
export const trSuggestionDecisionEnum = pgEnum("tr_suggestion_decision", ["Suggested", "Accepted", "Rejected", "Suppressed"]);

export const trItems = pgTable("tr_items", {
  id: serial("id").primaryKey(),
  trId: text("tr_id").notNull().unique(),
  department: text("department").notNull(),
  actionDescription: text("action_description").notNull(),
  ragStatus: trRagStatusEnum("rag_status").notNull().default("Green"),
  owners: text("owners").array().notNull().default([]),
  support: text("support").array().notNull().default([]),
  dateRaised: timestamp("date_raised"),
  dueDate: timestamp("due_date"),
  status: trStatusEnum("status").notNull().default("Active"),
  dateCompleted: timestamp("date_completed"),
  outcomeComments: text("outcome_comments"),
  supportingInfo: text("supporting_info"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const insertTrItemSchema = createInsertSchema(trItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrItem = z.infer<typeof insertTrItemSchema>;
export type TrItem = typeof trItems.$inferSelect;

export const trItemProjectLinks = pgTable("tr_item_project_links", {
  id: serial("id").primaryKey(),
  trItemId: integer("tr_item_id").notNull().references(() => trItems.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  autoCreatedPmTaskId: integer("auto_created_pm_task_id"),
  linkStatus: trLinkStatusEnum("link_status").notNull().default("Linked"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const insertTrItemProjectLinkSchema = createInsertSchema(trItemProjectLinks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrItemProjectLink = z.infer<typeof insertTrItemProjectLinkSchema>;
export type TrItemProjectLink = typeof trItemProjectLinks.$inferSelect;

export const trItemSuggestionDecisions = pgTable("tr_item_suggestion_decisions", {
  id: serial("id").primaryKey(),
  trItemId: integer("tr_item_id").notNull().references(() => trItems.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  decision: trSuggestionDecisionEnum("decision").notNull().default("Suggested"),
  score: integer("score").notNull().default(0),
  rationale: text("rationale"),
  decidedAt: timestamp("decided_at"),
  decidedBy: text("decided_by"),
});

export const insertTrSuggestionDecisionSchema = createInsertSchema(trItemSuggestionDecisions).omit({ id: true });
export type InsertTrSuggestionDecision = z.infer<typeof insertTrSuggestionDecisionSchema>;
export type TrSuggestionDecision = typeof trItemSuggestionDecisions.$inferSelect;

export const derivedProjectKpis = pgTable("derived_project_kpis", {
  id: serial("id").primaryKey(),
  projectKey: text("project_key").notNull().unique(),
  projectName: text("project_name").notNull(),
  phase: text("phase"),
  sizeKwp: decimal("size_kwp", { precision: 12, scale: 2 }),
  contractValue: decimal("contract_value", { precision: 15, scale: 2 }),
  ragStatus: text("rag_status"),
  pm: text("pm"),
  pd: text("pd"),
  isActive: boolean("is_active").notNull().default(true),
  totalPlannedRevenue: decimal("total_planned_revenue", { precision: 15, scale: 2 }),
  totalActualRevenue: decimal("total_actual_revenue", { precision: 15, scale: 2 }),
  revenueRealised: decimal("revenue_realised", { precision: 15, scale: 2 }),
  revenueOutstanding: decimal("revenue_outstanding", { precision: 15, scale: 2 }),
  totalPlannedExpenses: decimal("total_planned_expenses", { precision: 15, scale: 2 }),
  totalActualExpenses: decimal("total_actual_expenses", { precision: 15, scale: 2 }),
  cosRealised: decimal("cos_realised", { precision: 15, scale: 2 }),
  expensesOutstanding: decimal("expenses_outstanding", { precision: 15, scale: 2 }),
  grossProfit: decimal("gross_profit", { precision: 15, scale: 2 }),
  grossMarginPct: decimal("gross_margin_pct", { precision: 8, scale: 4 }),
  avgActualPctComplete: decimal("avg_actual_pct_complete", { precision: 8, scale: 4 }),
  avgExpectedPctComplete: decimal("avg_expected_pct_complete", { precision: 8, scale: 4 }),
  scheduleDelta: decimal("schedule_delta", { precision: 8, scale: 4 }),
  taskCount: integer("task_count").notNull().default(0),
  expenseLineCount: integer("expense_line_count").notNull().default(0),
  revenueLineCount: integer("revenue_line_count").notNull().default(0),
  needsReview: boolean("needs_review").notNull().default(false),
  needsReviewReason: text("needs_review_reason"),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
});
export type DerivedProjectKpi = typeof derivedProjectKpis.$inferSelect;

export const derivedPortfolioKpis = pgTable("derived_portfolio_kpis", {
  id: serial("id").primaryKey(),
  snapshotKey: text("snapshot_key").notNull().unique().default('current'),
  totalProgramBudget: decimal("total_program_budget", { precision: 15, scale: 2 }),
  actualSpendPaid: decimal("actual_spend_paid", { precision: 15, scale: 2 }),
  revenueRealised: decimal("revenue_realised", { precision: 15, scale: 2 }),
  activeProjectsCount: integer("active_projects_count").notNull().default(0),
  activeCapacityMw: decimal("active_capacity_mw", { precision: 12, scale: 2 }),
  onScheduleRate: decimal("on_schedule_rate", { precision: 8, scale: 4 }),
  behindPlanCount: integer("behind_plan_count").notNull().default(0),
  onHoldCount: integer("on_hold_count").notNull().default(0),
  closedCount: integer("closed_count").notNull().default(0),
  grossProfit: decimal("gross_profit", { precision: 15, scale: 2 }),
  grossProfitPct: decimal("gross_profit_pct", { precision: 8, scale: 4 }),
  revenueOutstanding: decimal("revenue_outstanding", { precision: 15, scale: 2 }),
  expensesOutstanding: decimal("expenses_outstanding", { precision: 15, scale: 2 }),
  phaseDistributionJson: jsonb("phase_distribution_json"),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
});
export type DerivedPortfolioKpi = typeof derivedPortfolioKpis.$inferSelect;

export const derivedRagSummary = pgTable("derived_rag_summary", {
  id: serial("id").primaryKey(),
  ragStatus: text("rag_status").notNull(),
  projectCount: integer("project_count").notNull().default(0),
  totalKwp: decimal("total_kwp", { precision: 15, scale: 2 }),
  totalContractValue: decimal("total_contract_value", { precision: 15, scale: 2 }),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
});
export type DerivedRagSummary = typeof derivedRagSummary.$inferSelect;

export const feedbackTicketTypeEnum = pgEnum('feedback_ticket_type', ['bug', 'feature']);
export const feedbackTicketStatusEnum = pgEnum('feedback_ticket_status', ['open', 'in_progress', 'resolved', 'closed']);
export const feedbackTicketPriorityEnum = pgEnum('feedback_ticket_priority', ['low', 'medium', 'high', 'critical']);

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

export const insertFeedbackTicketSchema = createInsertSchema(feedbackTickets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFeedbackTicket = z.infer<typeof insertFeedbackTicketSchema>;
export type FeedbackTicket = typeof feedbackTickets.$inferSelect;

export const eeInfoNodeStatusEnum = pgEnum('ee_info_node_status', ['stub', 'draft', 'published']);
export const eeInfoNodeCategoryEnum = pgEnum('ee_info_node_category', ['role', 'process', 'tool', 'template', 'other', 'unknown']);
export const eeInfoEdgeTypeEnum = pgEnum('ee_info_edge_type', ['link', 'embed', 'reference']);

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

export const insertEeInfoNodeDetailsSchema = createInsertSchema(eeInfoNodeDetails).omit({ id: true });
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

export const insertEeInfoNodeEditorSchema = createInsertSchema(eeInfoNodeEditors).omit({ id: true, createdAt: true });
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

export const insertEeInfoNodeMetricSchema = createInsertSchema(eeInfoNodeMetrics).omit({ id: true, createdAt: true });
export type InsertEeInfoNodeMetric = z.infer<typeof insertEeInfoNodeMetricSchema>;
export type EeInfoNodeMetric = typeof eeInfoNodeMetrics.$inferSelect;

export const DEFAULT_ROLE_PERMISSIONS: InsertRolePermission[] = [
  { role: "COO_ADMIN", label: "COO", description: "Full executive access, settings, user management", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "MONEY", "PROJECT_DEVELOPMENT", "DELIVERY", "GOVERNANCE", "INFORMATION", "ADMIN"], canManageUsers: true, canManageRoles: true, canEditData: true, isSystem: true },
  { role: "CEO_ADMIN", label: "CEO", description: "Full executive access, strategic oversight", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "MONEY", "PROJECT_DEVELOPMENT", "DELIVERY", "GOVERNANCE", "INFORMATION", "ADMIN"], canManageUsers: true, canManageRoles: true, canEditData: true, isSystem: true },
  { role: "CCO", label: "CCO", description: "Commercial operations, project oversight", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "MONEY", "PROJECT_DEVELOPMENT", "DELIVERY", "GOVERNANCE", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "CFO", label: "CFO", description: "Financial oversight, cashflow, budgets", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "MONEY", "GOVERNANCE", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "PROGRAM_MANAGER", label: "Program Manager", description: "Project management, engineering dashboard", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "MONEY", "DELIVERY", "GOVERNANCE", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "PROGRAM_FINANCE_MANAGER", label: "Program Finance Manager", description: "Project finance, cost tracking", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "MONEY", "DELIVERY", "GOVERNANCE", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "CONSTRUCTION_MANAGER", label: "Construction Manager", description: "Construction oversight, site management", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "DELIVERY", "GOVERNANCE", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "QUALITY_MANAGER", label: "Quality Manager", description: "Quality checklists, post-mortems, inspections", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "GOVERNANCE", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "ENGINEERING_MANAGER", label: "Engineering Manager", description: "Engineering tasks, deliverables, approvals", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "DELIVERY", "GOVERNANCE", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "KEY_ACCOUNTS_MANAGER", label: "Key Accounts Manager", description: "Client relations, account management", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "PROJECT_MANAGER_SITE", label: "Project Manager", description: "Site project manager — view-only access to assigned projects, dates, financials, quality, engineering", sections: ["COLLABORATION", "PROJECTS", "MONEY", "DELIVERY", "GOVERNANCE"], canManageUsers: false, canManageRoles: false, canEditData: false, isSystem: true },
  { role: "PROJECT_DEVELOPER", label: "Project Developer", description: "Project developer — manages project development, cost proposals, and client relations", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "MONEY", "PROJECT_DEVELOPMENT", "DELIVERY", "GOVERNANCE", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "ENGINEER", label: "Engineer", description: "Engineering team member — engineering tasks, deliverables, stage checklists", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "DELIVERY", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
  { role: "ACCOUNTANT", label: "Accountant", description: "Finance team — cashflow, COS tracking, invoice management", sections: ["COCKPIT", "COLLABORATION", "PROJECTS", "MONEY", "INFORMATION"], canManageUsers: false, canManageRoles: false, canEditData: true, isSystem: true },
];

// ===================== PORTFOLIO MANAGEMENT =====================

export const portfolioStatusEnum = pgEnum('portfolio_status', ['Active', 'On Hold', 'Completed', 'Archived']);

export const portfolios = pgTable("portfolios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  clientName: text("client_name"),
  status: text("status").notNull().default("Active"),
  description: text("description"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertPortfolioSchema = createInsertSchema(portfolios).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;
export type Portfolio = typeof portfolios.$inferSelect;

export const portfolioRolloutPlans = pgTable("portfolio_rollout_plans", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolios.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertPortfolioRolloutPlanSchema = createInsertSchema(portfolioRolloutPlans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPortfolioRolloutPlan = z.infer<typeof insertPortfolioRolloutPlanSchema>;
export type PortfolioRolloutPlan = typeof portfolioRolloutPlans.$inferSelect;

export const portfolioRolloutPhases = pgTable("portfolio_rollout_phases", {
  id: serial("id").primaryKey(),
  rolloutPlanId: integer("rollout_plan_id").notNull().references(() => portfolioRolloutPlans.id, { onDelete: 'cascade' }),
  phaseName: text("phase_name").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  targetKwp: decimal("target_kwp", { precision: 12, scale: 2 }),
  targetRevenue: decimal("target_revenue", { precision: 15, scale: 2 }),
  sortOrder: integer("sort_order").notNull().default(0),
});
export const insertPortfolioRolloutPhaseSchema = createInsertSchema(portfolioRolloutPhases).omit({ id: true });
export type InsertPortfolioRolloutPhase = z.infer<typeof insertPortfolioRolloutPhaseSchema>;
export type PortfolioRolloutPhase = typeof portfolioRolloutPhases.$inferSelect;

export const projectPortfolioAssignments = pgTable("project_portfolio_assignments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id).unique(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolios.id, { onDelete: 'cascade' }),
  assignedBy: integer("assigned_by").references(() => users.id),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  movedBy: integer("moved_by").references(() => users.id),
  movedAt: timestamp("moved_at"),
});
export const insertProjectPortfolioAssignmentSchema = createInsertSchema(projectPortfolioAssignments).omit({ id: true, assignedAt: true });
export type InsertProjectPortfolioAssignment = z.infer<typeof insertProjectPortfolioAssignmentSchema>;
export type ProjectPortfolioAssignment = typeof projectPortfolioAssignments.$inferSelect;

// ===================== GAMIFICATION (Part N) =====================

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

export const insertTeamsChatGroupSchema = createInsertSchema(teamsChatGroups).omit({ id: true, createdAt: true, updatedAt: true });
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

export const insertTeamsChatMemberSchema = createInsertSchema(teamsChatMembers).omit({ id: true, addedAt: true });
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

export const insertTeamsChatMessageSchema = createInsertSchema(teamsChatMessages).omit({ id: true, createdAt: true });
export type InsertTeamsChatMessage = z.infer<typeof insertTeamsChatMessageSchema>;
export type TeamsChatMessage = typeof teamsChatMessages.$inferSelect;

export const financialEditRequests = pgTable("financial_edit_requests", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => users.id),
  editType: text("edit_type").notNull(),
  editTarget: text("edit_target").notNull(),
  editPayload: text("edit_payload").notNull(),
  editSummary: text("edit_summary").notNull(),
  isCriticalPath: boolean("is_critical_path").notNull().default(false),
  affectsRevenue: boolean("affects_revenue").notNull().default(false),
  affectsExpenditure: boolean("affects_expenditure").notNull().default(false),
  affectsQuality: boolean("affects_quality").notNull().default(false),
  status: text("status").notNull().default("pending"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewComment: text("review_comment"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFinancialEditRequestSchema = createInsertSchema(financialEditRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinancialEditRequest = z.infer<typeof insertFinancialEditRequestSchema>;
export type FinancialEditRequest = typeof financialEditRequests.$inferSelect;

export const financialIntegrationRules = pgTable("financial_integration_rules", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  ruleType: text("rule_type").notNull(),
  ruleConfig: text("rule_config").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFinancialIntegrationRuleSchema = createInsertSchema(financialIntegrationRules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinancialIntegrationRule = z.infer<typeof insertFinancialIntegrationRuleSchema>;
export type FinancialIntegrationRule = typeof financialIntegrationRules.$inferSelect;

export const dashboardWidgetConfig = pgTable("dashboard_widget_config", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  widgetOrder: jsonb("widget_order").notNull().$type<string[]>(),
  hiddenWidgets: jsonb("hidden_widgets").notNull().$type<string[]>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDashboardWidgetConfigSchema = createInsertSchema(dashboardWidgetConfig).omit({ id: true, updatedAt: true });
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

export const pmActionTypeEnum = pgEnum('pm_action_type', [
  'site_visit', 'generate_po', 'link_invoice', 'raise_variation',
  'log_delay', 'log_risk', 'upload_photo', 'update_progress', 'escalate'
]);

export const pmActionStatusEnum = pgEnum('pm_action_status', [
  'pending', 'approved', 'rejected', 'completed'
]);

export const pmSafetyStatusEnum = pgEnum('pm_safety_status', ['clear', 'issue_open']);

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

export const insertPmSiteVisitSchema = createInsertSchema(pmSiteVisits).omit({ id: true, createdAt: true, updatedAt: true });
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

export const insertPmOnTheGoActionSchema = createInsertSchema(pmOnTheGoActions).omit({ id: true, createdAt: true, updatedAt: true });
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
});

export const insertPmComplianceTrackingSchema = createInsertSchema(pmComplianceTracking).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPmComplianceTracking = z.infer<typeof insertPmComplianceTrackingSchema>;
export type PmComplianceTracking = typeof pmComplianceTracking.$inferSelect;

export const pmModePreferences = pgTable("pm_mode_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  preferredMode: text("preferred_mode").default("full_detail"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPmModePreferenceSchema = createInsertSchema(pmModePreferences).omit({ id: true, updatedAt: true });
export type InsertPmModePreference = z.infer<typeof insertPmModePreferenceSchema>;
export type PmModePreference = typeof pmModePreferences.$inferSelect;
