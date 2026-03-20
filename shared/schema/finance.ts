import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users } from "./users";
import { projectInfo } from "./projects";
import { smartImportRuns } from "./imports";

// ===================== ENUMS =====================

export const counterpartyTypeEnum = pgEnum('counterparty_type', ['SUPPLIER', 'INSTALLER', 'OTHER']);
export const revenueLineStatusEnum = pgEnum('revenue_line_status', ['PLANNED', 'INVOICED', 'PAID', 'IN_BANK', 'REALISED']);
export const costLineStatusEnum = pgEnum('cost_line_status', ['PLANNED', 'INVOICED', 'APPROVED', 'PAID']);
export const dependencyTypeEnum = pgEnum('dependency_type', ['FS', 'SS', 'FF', 'SF']);
export const patternTypeEnum = pgEnum('pattern_type', ['PREFIX', 'REGEX', 'TOKEN_SHAPE']);
export const patternMatchOutcomeEnum = pgEnum('pattern_match_outcome', ['AUTO_APPLIED', 'USER_CONFIRMED', 'USER_OVERRIDDEN', 'UNRESOLVED']);
export const invoiceCaptureStatusEnum = pgEnum('invoice_capture_status', ['captured', 'submitted', 'verified', 'approved', 'rejected']);
export const procurementCategoryEnum = pgEnum('procurement_category', ['material', 'equipment', 'service', 'subcontract', 'other']);
export const procurementStatusEnum = pgEnum('procurement_status', ['requested', 'quoted', 'approved', 'ordered', 'partially_received', 'received', 'invoiced', 'closed']);
export const procurementPaymentStatusEnum = pgEnum('procurement_payment_status', ['not_applicable', 'pending_approval', 'approved', 'scheduled', 'paid', 'on_hold']);
export const trRagStatusEnum = pgEnum("tr_rag_status", ["Red", "Amber", "Green"]);
export const trStatusEnum = pgEnum("tr_status", ["Active", "Completed"]);
export const trLinkStatusEnum = pgEnum("tr_link_status", ["Linked", "TaskCreated", "Done"]);
export const trSuggestionDecisionEnum = pgEnum("tr_suggestion_decision", ["Suggested", "Accepted", "Rejected", "Suppressed"]);

// ===================== PROGRAM EXPENSE =====================

export const programExpense = pgTable("program_expense", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number"),
  rowType: text("row_type").default("item"),
  expenseCategory: text("expense_category"),
  expenseLineItem: text("expense_line_item"),
  budgetQty: decimal("budget_qty", { precision: 12, scale: 4 }),
  budgetRateUnit: decimal("budget_rate_unit", { precision: 15, scale: 2 }),
  budgetTotal: decimal("budget_total", { precision: 15, scale: 2 }),
  forecastPaymentDate: text("forecast_payment_date"),
  budgetCosTotal: decimal("budget_cos_total", { precision: 15, scale: 2 }),
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
  subProjectName: text("sub_project_name"),
  dataSource: text("data_source").default("SMART_IMPORT"),
  projectId: integer("project_id").references(() => projectInfo.id),
  importRunId: integer("import_run_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProgramExpenseSchema = createInsertSchema(programExpense).omit({ id: true, createdAt: true } as any);
export type InsertProgramExpense = z.infer<typeof insertProgramExpenseSchema>;
export type ProgramExpense = typeof programExpense.$inferSelect;

// ===================== PROGRAM INFLOWS =====================

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
  subProjectName: text("sub_project_name"),
  dataSource: text("data_source").default("SMART_IMPORT"),
  projectId: integer("project_id").references(() => projectInfo.id),
  importRunId: integer("import_run_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProgramInflowsSchema = createInsertSchema(programInflows).omit({ id: true, createdAt: true } as any);
export type InsertProgramInflows = z.infer<typeof insertProgramInflowsSchema>;
export type ProgramInflows = typeof programInflows.$inferSelect;

// ===================== REVENUE MILESTONE MANUAL =====================

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
export const insertRevenueMilestoneManualSchema = createInsertSchema(revenueMilestoneManual).omit({ id: true, updatedAt: true } as any);
export type InsertRevenueMilestoneManual = z.infer<typeof insertRevenueMilestoneManualSchema>;
export type RevenueMilestoneManual = typeof revenueMilestoneManual.$inferSelect;

// ===================== PROJECT PLAN =====================

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
export const insertProjectPlanSchema = createInsertSchema(projectPlan).omit({ id: true, createdAt: true } as any);
export type InsertProjectPlan = z.infer<typeof insertProjectPlanSchema>;
export type ProjectPlan = typeof projectPlan.$inferSelect;

// ===================== CASHFLOW =====================

export const cashflowPoints = pgTable("cashflow_points", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  seriesName: text("series_name").notNull(),
  pointDate: text("point_date").notNull(),
  value: decimal("value", { precision: 15, scale: 2 }),
  projectId: integer("project_id").references(() => projectInfo.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertCashflowPointSchema = createInsertSchema(cashflowPoints).omit({ id: true, createdAt: true } as any);
export type InsertCashflowPoint = z.infer<typeof insertCashflowPointSchema>;
export type CashflowPoint = typeof cashflowPoints.$inferSelect;

export const financeRevenueMonthly = pgTable("finance_revenue_monthly", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  category: text("category").notNull(),
  monthEndDate: text("month_end_date").notNull(),
  value: decimal("value", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertFinanceRevenueMonthlySchema = createInsertSchema(financeRevenueMonthly).omit({ id: true, createdAt: true } as any);
export type InsertFinanceRevenueMonthly = z.infer<typeof insertFinanceRevenueMonthlySchema>;
export type FinanceRevenueMonthly = typeof financeRevenueMonthly.$inferSelect;

export const financeCosMonthly = pgTable("finance_cos_monthly", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  category: text("category").notNull(),
  monthEndDate: text("month_end_date").notNull(),
  value: decimal("value", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertFinanceCosMonthlySchema = createInsertSchema(financeCosMonthly).omit({ id: true, createdAt: true } as any);
export type InsertFinanceCosMonthly = z.infer<typeof insertFinanceCosMonthlySchema>;
export type FinanceCosMonthly = typeof financeCosMonthly.$inferSelect;

// ===================== OVERRIDE TABLES =====================

export const cashflowPlanningOverrides = pgTable("cashflow_planning_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  weekStartDate: text("week_start_date").notNull(),
  seriesName: text("series_name").notNull(),
  overrideValue: decimal("override_value", { precision: 15, scale: 2 }).notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertCashflowPlanningOverrideSchema = createInsertSchema(cashflowPlanningOverrides).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertCashflowPlanningOverride = z.infer<typeof insertCashflowPlanningOverrideSchema>;
export type CashflowPlanningOverride = typeof cashflowPlanningOverrides.$inferSelect;

export const projectPlanOverrides = pgTable("project_plan_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number").notNull(),
  fieldName: text("field_name").notNull(),
  overrideValue: text("override_value"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertProjectPlanOverrideSchema = createInsertSchema(projectPlanOverrides).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProjectPlanOverride = z.infer<typeof insertProjectPlanOverrideSchema>;
export type ProjectPlanOverride = typeof projectPlanOverrides.$inferSelect;

export const revenueTrackingOverrides = pgTable("revenue_tracking_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number").notNull(),
  fieldName: text("field_name").notNull(),
  overrideValue: text("override_value"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertRevenueTrackingOverrideSchema = createInsertSchema(revenueTrackingOverrides).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertRevenueTrackingOverride = z.infer<typeof insertRevenueTrackingOverrideSchema>;
export type RevenueTrackingOverride = typeof revenueTrackingOverrides.$inferSelect;

export const expenditureOverrides = pgTable("expenditure_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  rowNumber: integer("row_number").notNull(),
  fieldName: text("field_name").notNull(),
  overrideValue: text("override_value"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertExpenditureOverrideSchema = createInsertSchema(expenditureOverrides).omit({ id: true, createdAt: true, updatedAt: true } as any);
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
export const insertCosStatusOverrideSchema = createInsertSchema(cosStatusOverrides).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertCosStatusOverride = z.infer<typeof insertCosStatusOverrideSchema>;
export type CosStatusOverride = typeof cosStatusOverrides.$inferSelect;

export const financeRevenueOverrides = pgTable("finance_revenue_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  category: text("category").notNull(),
  monthEndDate: text("month_end_date").notNull(),
  overrideValue: decimal("override_value", { precision: 15, scale: 2 }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertFinanceRevenueOverrideSchema = createInsertSchema(financeRevenueOverrides).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertFinanceRevenueOverride = z.infer<typeof insertFinanceRevenueOverrideSchema>;
export type FinanceRevenueOverride = typeof financeRevenueOverrides.$inferSelect;

export const financeCosOverrides = pgTable("finance_cos_overrides", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  category: text("category").notNull(),
  monthEndDate: text("month_end_date").notNull(),
  overrideValue: decimal("override_value", { precision: 15, scale: 2 }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertFinanceCosOverrideSchema = createInsertSchema(financeCosOverrides).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertFinanceCosOverride = z.infer<typeof insertFinanceCosOverrideSchema>;
export type FinanceCosOverride = typeof financeCosOverrides.$inferSelect;

// ===================== WORKING PLAN =====================

export const workingPlanScenario = pgTable("working_plan_scenario", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  name: text("name").notNull().default("Working Plan"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertWorkingPlanScenarioSchema = createInsertSchema(workingPlanScenario).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertWorkingPlanScenario = z.infer<typeof insertWorkingPlanScenarioSchema>;
export type WorkingPlanScenario = typeof workingPlanScenario.$inferSelect;

export const workingPlanTaskOverride = pgTable("working_plan_task_override", {
  id: serial("id").primaryKey(),
  scenarioId: integer("scenario_id").notNull().references(() => workingPlanScenario.id, { onDelete: 'cascade' }),
  importedTaskId: integer("imported_task_id").references(() => projectPlan.id),
  overrideStartDate: text("override_start_date"),
  overrideEndDate: text("override_end_date"),
  overrideDurationDays: integer("override_duration_days"),
  overrideName: text("override_name"),
  overrideTaskNo: text("override_task_no"),
  overrideComment: text("override_comment"),
  deletedFlag: integer("deleted_flag").notNull().default(0),
  isNewTask: integer("is_new_task").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertWorkingPlanTaskOverrideSchema = createInsertSchema(workingPlanTaskOverride).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertWorkingPlanTaskOverride = z.infer<typeof insertWorkingPlanTaskOverrideSchema>;
export type WorkingPlanTaskOverride = typeof workingPlanTaskOverride.$inferSelect;

export const projectPlanDependency = pgTable("project_plan_dependency", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  predecessorTaskId: integer("predecessor_task_id").notNull(),
  successorTaskId: integer("successor_task_id").notNull(),
  dependencyType: text("dependency_type").notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectPlanDependencySchema = createInsertSchema(projectPlanDependency).omit({ id: true, createdAt: true } as any);
export type InsertProjectPlanDependency = z.infer<typeof insertProjectPlanDependencySchema>;
export type ProjectPlanDependency = typeof projectPlanDependency.$inferSelect;

export const workingPlanDependencyOverride = pgTable("working_plan_dependency_override", {
  id: serial("id").primaryKey(),
  scenarioId: integer("scenario_id").notNull().references(() => workingPlanScenario.id, { onDelete: 'cascade' }),
  importedDependencyId: integer("imported_dependency_id").references(() => projectPlanDependency.id),
  predecessorTaskId: integer("predecessor_task_id").notNull(),
  successorTaskId: integer("successor_task_id").notNull(),
  dependencyType: text("dependency_type").notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
  deletedFlag: integer("deleted_flag").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertWorkingPlanDependencyOverrideSchema = createInsertSchema(workingPlanDependencyOverride).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertWorkingPlanDependencyOverride = z.infer<typeof insertWorkingPlanDependencyOverrideSchema>;
export type WorkingPlanDependencyOverride = typeof workingPlanDependencyOverride.$inferSelect;

export const scheduleChangeNotice = pgTable("schedule_change_notice", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  summary: text("summary").notNull(),
  oldFinishDate: text("old_finish_date"),
  newFinishDate: text("new_finish_date"),
  changedTasks: text("changed_tasks"),
  criticalPathDelta: text("critical_path_delta"),
  userNote: text("user_note"),
  clientNotified: integer("client_notified").notNull().default(0),
  documentationUpdated: integer("documentation_updated").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertScheduleChangeNoticeSchema = createInsertSchema(scheduleChangeNotice).omit({ id: true, createdAt: true } as any);
export type InsertScheduleChangeNotice = z.infer<typeof insertScheduleChangeNoticeSchema>;
export type ScheduleChangeNotice = typeof scheduleChangeNotice.$inferSelect;

// ===================== CASHFLOW & OPEX MANUAL =====================

export const cashflowWeeklyManual = pgTable("cashflow_weekly_manual", {
  id: serial("id").primaryKey(),
  weekStartDate: text("week_start_date").notNull().unique(),
  openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertCashflowWeeklyManualSchema = createInsertSchema(cashflowWeeklyManual).omit({ id: true, updatedAt: true } as any);
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
export const insertCashflowBalanceHistorySchema = createInsertSchema(cashflowBalanceHistory).omit({ id: true, changedAt: true } as any);
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
export const insertAvailablePaymentOverrideSchema = createInsertSchema(availablePaymentOverrides).omit({ id: true, updatedAt: true } as any);
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
export const insertAvailablePaymentHistorySchema = createInsertSchema(availablePaymentHistory).omit({ id: true, changedAt: true } as any);
export type InsertAvailablePaymentHistory = z.infer<typeof insertAvailablePaymentHistorySchema>;
export type AvailablePaymentHistory = typeof availablePaymentHistory.$inferSelect;

export const opexBudgetMonthly = pgTable("opex_budget_monthly", {
  id: serial("id").primaryKey(),
  monthKey: text("month_key").notNull().unique(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertOpexBudgetMonthlySchema = createInsertSchema(opexBudgetMonthly).omit({ id: true, updatedAt: true } as any);
export type InsertOpexBudgetMonthly = z.infer<typeof insertOpexBudgetMonthlySchema>;
export type OpexBudgetMonthly = typeof opexBudgetMonthly.$inferSelect;

export const opexWeeklyManual = pgTable("opex_weekly_manual", {
  id: serial("id").primaryKey(),
  weekStartDate: text("week_start_date").notNull().unique(),
  opexAmount: decimal("opex_amount", { precision: 15, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertOpexWeeklyManualSchema = createInsertSchema(opexWeeklyManual).omit({ id: true, updatedAt: true } as any);
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
export const insertTrackerMonthlyManualSchema = createInsertSchema(trackerMonthlyManual).omit({ id: true, updatedAt: true } as any);
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
export const insertPlanningOverrideSchema = createInsertSchema(planningOverrides).omit({ id: true, createdAt: true } as any);
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
export const insertPaymentTermsSchema = createInsertSchema(paymentTerms).omit({ id: true, createdAt: true, updatedAt: true } as any);
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
export const insertLineItemOverrideSchema = createInsertSchema(lineItemOverrides).omit({ id: true, createdAt: true } as any);
export type InsertLineItemOverride = z.infer<typeof insertLineItemOverrideSchema>;
export type LineItemOverride = typeof lineItemOverrides.$inferSelect;

// ===================== COUNTERPARTIES =====================

export const counterparties = pgTable("counterparties", {
  id: serial("id").primaryKey(),
  nameCanonical: text("name_canonical").notNull(),
  nameAliases: jsonb("name_aliases").notNull().default([]),
  typeDefault: counterpartyTypeEnum("type_default").notNull().default('OTHER'),
  isCore: boolean("is_core").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  roleTags: text("role_tags").array().notNull().default([]),
  vatNumber: text("vat_number"),
  registrationNumber: text("registration_number"),
  address: text("address"),
  contactPerson: text("contact_person"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  bankBranchCode: text("bank_branch_code"),
  paymentTerms: text("payment_terms"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at"),
});
export const insertCounterpartySchema = createInsertSchema(counterparties).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertCounterparty = z.infer<typeof insertCounterpartySchema>;
export type Counterparty = typeof counterparties.$inferSelect;

export const counterpartyContacts = pgTable("counterparty_contacts", {
  id: serial("id").primaryKey(),
  counterpartyId: integer("counterparty_id").notNull().references(() => counterparties.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  roleTags: text("role_tags").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertCounterpartyContactSchema = createInsertSchema(counterpartyContacts).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertCounterpartyContact = z.infer<typeof insertCounterpartyContactSchema>;
export type CounterpartyContact = typeof counterpartyContacts.$inferSelect;

// ===================== NORMALIZED LINES =====================

export const normalizedRevenueLines = pgTable("normalized_revenue_lines", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
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
  subProjectName: text("sub_project_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertNormalizedRevenueLineSchema = createInsertSchema(normalizedRevenueLines).omit({ id: true, createdAt: true } as any);
export type InsertNormalizedRevenueLine = z.infer<typeof insertNormalizedRevenueLineSchema>;
export type NormalizedRevenueLine = typeof normalizedRevenueLines.$inferSelect;

export const normalizedCostLines = pgTable("normalized_cost_lines", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
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
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
  turnaroundDays: integer("turnaround_days"),
  patternRuleId: integer("pattern_rule_id"),
  patternClassifiedAt: timestamp("pattern_classified_at"),
  patternInferredType: text("pattern_inferred_type"),
  noRevenueLinked: boolean("no_revenue_linked").default(false),
  budgetQty: text("budget_qty"),
  budgetRate: text("budget_rate"),
  budgetTotal: text("budget_total"),
  budgetCos: text("budget_cos"),
  revenueRecognitionAmount: text("revenue_recognition_amount"),
  forecastPaymentDate: text("forecast_payment_date"),
  subProjectName: text("sub_project_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertNormalizedCostLineSchema = createInsertSchema(normalizedCostLines).omit({ id: true, createdAt: true } as any);
export type InsertNormalizedCostLine = z.infer<typeof insertNormalizedCostLineSchema>;
export type NormalizedCostLine = typeof normalizedCostLines.$inferSelect;

// ===================== INVOICE PATTERNS =====================

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
export const insertInvoicePatternRuleSchema = createInsertSchema(invoicePatternRules).omit({ id: true, createdAt: true, timesMatched: true, timesConfirmed: true, timesOverridden: true } as any);
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
export const insertInvoicePatternMatchSchema = createInsertSchema(invoicePatternMatches).omit({ id: true, createdAt: true } as any);
export type InsertInvoicePatternMatch = z.infer<typeof insertInvoicePatternMatchSchema>;
export type InvoicePatternMatch = typeof invoicePatternMatches.$inferSelect;

// ===================== OVERRIDE GOVERNANCE =====================

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

// ===================== WEEKLY REVIEWS =====================

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
export const insertWeeklyReviewSchema = createInsertSchema(weeklyReviews).omit({ id: true, createdAt: true } as any);
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

// ===================== TR ITEMS =====================

export const trItems = pgTable("tr_items", {
  id: serial("id").primaryKey(),
  trId: text("tr_id").notNull().unique(),
  department: text("department").notNull(),
  actionDescription: text("action_description").notNull(),
  ragStatus: trRagStatusEnum("rag_status").notNull().default("Green"),
  owners: text("owners").array().notNull().default([]),
  ownerUserIds: integer("owner_user_ids").array(),
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
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
});
export const insertTrItemSchema = createInsertSchema(trItems).omit({ id: true, createdAt: true, updatedAt: true } as any);
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
export const insertTrItemProjectLinkSchema = createInsertSchema(trItemProjectLinks).omit({ id: true, createdAt: true, updatedAt: true } as any);
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
export const insertTrSuggestionDecisionSchema = createInsertSchema(trItemSuggestionDecisions).omit({ id: true } as any);
export type InsertTrSuggestionDecision = z.infer<typeof insertTrSuggestionDecisionSchema>;
export type TrSuggestionDecision = typeof trItemSuggestionDecisions.$inferSelect;

// ===================== TASK LINKS & WRITEBACK =====================

export const milestoneTaskLinks = pgTable("milestone_task_links", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  milestoneRowNumber: integer("milestone_row_number").notNull(),
  taskId: integer("task_id").notNull(),
  dateOverride: text("date_override"),
  dateOverrideReason: text("date_override_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertMilestoneTaskLinkSchema = createInsertSchema(milestoneTaskLinks).omit({ id: true, createdAt: true } as any);
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
export const insertExpenseTaskLinkSchema = createInsertSchema(expenseTaskLinks).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertExpenseTaskLink = z.infer<typeof insertExpenseTaskLinkSchema>;
export type ExpenseTaskLink = typeof expenseTaskLinks.$inferSelect;

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
export const insertWritebackMappingSchema = createInsertSchema(writebackMappings).omit({ id: true, createdAt: true, updatedAt: true } as any);
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
export const insertWritebackAuditLogSchema = createInsertSchema(writebackAuditLog).omit({ id: true, appliedAt: true } as any);
export type InsertWritebackAuditLog = z.infer<typeof insertWritebackAuditLogSchema>;
export type WritebackAuditLog = typeof writebackAuditLog.$inferSelect;

// ===================== FINANCIAL EDIT REQUESTS & RULES =====================

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
export const insertFinancialEditRequestSchema = createInsertSchema(financialEditRequests).omit({ id: true, createdAt: true, updatedAt: true } as any);
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
export const insertFinancialIntegrationRuleSchema = createInsertSchema(financialIntegrationRules).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertFinancialIntegrationRule = z.infer<typeof insertFinancialIntegrationRuleSchema>;
export type FinancialIntegrationRule = typeof financialIntegrationRules.$inferSelect;

// ===================== INVOICE CAPTURES & PROCUREMENT =====================

export const invoiceCaptures = pgTable("invoice_captures", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  supplierId: integer("supplier_id").references(() => counterparties.id),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  amount: real("amount"),
  vatAmount: real("vat_amount"),
  linkedPoId: integer("linked_po_id"),
  linkedProcurementItemId: integer("linked_procurement_item_id"),
  status: invoiceCaptureStatusEnum("status").notNull().default('captured'),
  capturedByUserId: integer("captured_by_user_id").references(() => users.id),
  documentPath: text("document_path"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertInvoiceCaptureSchema = createInsertSchema(invoiceCaptures).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertInvoiceCapture = z.infer<typeof insertInvoiceCaptureSchema>;
export type InvoiceCapture = typeof invoiceCaptures.$inferSelect;

export const procurementItems = pgTable("procurement_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id),
  title: text("title").notNull(),
  description: text("description"),
  category: procurementCategoryEnum("category").notNull().default('other'),
  quantity: real("quantity"),
  unit: text("unit"),
  expectedCost: real("expected_cost"),
  actualCost: real("actual_cost"),
  supplierId: integer("supplier_id").references(() => counterparties.id),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  status: procurementStatusEnum("status").notNull().default('requested'),
  requiredDate: text("required_date"),
  poId: integer("po_id"),
  invoiceRef: text("invoice_ref"),
  linkedInvoiceCaptureId: integer("linked_invoice_capture_id").references(() => invoiceCaptures.id),
  budgetLine: text("budget_line"),
  linkedDeliverableId: integer("linked_deliverable_id"),
  linkedMilestone: text("linked_milestone"),
  progressPercent: real("progress_percent"),
  receiptRef: text("receipt_ref"),
  paymentStatus: procurementPaymentStatusEnum("payment_status").notNull().default('not_applicable'),
  linkedTaskId: integer("linked_task_id"),
  approvalId: integer("approval_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertProcurementItemSchema = createInsertSchema(procurementItems).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertProcurementItem = z.infer<typeof insertProcurementItemSchema>;
export type ProcurementItem = typeof procurementItems.$inferSelect;

// ===================== FYE TABLES =====================

export const fyeBudgets = pgTable("fye_budgets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id),
  projectName: text("project_name").notNull(),
  fye: text("fye").notNull(),
  monthKey: text("month_key").notNull(),
  budgetType: text("budget_type").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull().default("0"),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertFyeBudgetSchema = createInsertSchema(fyeBudgets).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertFyeBudget = z.infer<typeof insertFyeBudgetSchema>;
export type FyeBudget = typeof fyeBudgets.$inferSelect;

export const forecastPipeline = pgTable("forecast_pipeline", {
  id: serial("id").primaryKey(),
  fyeYear: integer("fye_year").notNull().default(2026),
  projectName: text("project_name").notNull(),
  projectDeveloper: text("project_developer"),
  location: text("location"),
  sizeKwp: decimal("size_kwp", { precision: 12, scale: 2 }),
  dealProbabilityPct: integer("deal_probability_pct").notNull().default(75),
  forecastSignatureDate: text("forecast_signature_date"),
  solarRevenue: decimal("solar_revenue", { precision: 15, scale: 2 }).default("0"),
  bessRevenue: decimal("bess_revenue", { precision: 15, scale: 2 }).default("0"),
  forecastGpPct: decimal("forecast_gp_pct", { precision: 6, scale: 4 }),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertForecastPipelineSchema = createInsertSchema(forecastPipeline).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertForecastPipeline = z.infer<typeof insertForecastPipelineSchema>;
export type ForecastPipeline = typeof forecastPipeline.$inferSelect;

export const lostDeals = pgTable("lost_deals", {
  id: serial("id").primaryKey(),
  fyeYear: integer("fye_year").notNull().default(2026),
  dealName: text("deal_name").notNull(),
  dealValue: decimal("deal_value", { precision: 15, scale: 2 }),
  businessDeveloper: text("business_developer"),
  lostReason: text("lost_reason"),
  lostDate: text("lost_date"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertLostDealSchema = createInsertSchema(lostDeals).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertLostDeal = z.infer<typeof insertLostDealSchema>;
export type LostDeal = typeof lostDeals.$inferSelect;

export const fyeKpiCounters = pgTable("fye_kpi_counters", {
  id: serial("id").primaryKey(),
  fyeYear: integer("fye_year").notNull().unique(),
  broughtIn: integer("brought_in").notNull().default(0),
  signed: integer("signed").notNull().default(0),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertFyeKpiCounterSchema = createInsertSchema(fyeKpiCounters).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertFyeKpiCounter = z.infer<typeof insertFyeKpiCounterSchema>;
export type FyeKpiCounter = typeof fyeKpiCounters.$inferSelect;

export const fyeReportSnapshots = pgTable("fye_report_snapshots", {
  id: serial("id").primaryKey(),
  fyeYear: integer("fye_year").notNull(),
  snapshotMonth: integer("snapshot_month").notNull(),
  snapshotDate: text("snapshot_date").notNull(),
  snapshotLabel: text("snapshot_label").notNull(),
  status: text("status").notNull().default("draft"),
  snapshotData: text("snapshot_data").notNull(),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  submittedBy: integer("submitted_by").references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
});
export type FyeReportSnapshot = typeof fyeReportSnapshots.$inferSelect;
