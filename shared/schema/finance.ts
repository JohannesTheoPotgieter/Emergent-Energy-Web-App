import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, pgEnum, serial, real, boolean, date, time, jsonb, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users } from "./users";
import { projectInfo } from "./projects";
import { smartImportRuns } from "./imports";
import { workItems } from "./tasks";

// ===================== ENUMS =====================

// C6: All workflow status enums normalized to lowercase_underscore.
// Internal type/category enums (counterparty_type, pattern_type) stay
// UPPER because they're domain abbreviations, not workflow states.
export const counterpartyTypeEnum = pgEnum('counterparty_type', ['SUPPLIER', 'INSTALLER', 'OTHER']);
export const revenueLineStatusEnum = pgEnum('revenue_line_status', ['planned', 'invoiced', 'paid', 'in_bank', 'realised']);
export const costLineStatusEnum = pgEnum('cost_line_status', ['planned', 'invoiced', 'approved', 'paid']);
export const patternTypeEnum = pgEnum('pattern_type', ['PREFIX', 'REGEX', 'TOKEN_SHAPE']);
export const patternMatchOutcomeEnum = pgEnum('pattern_match_outcome', ['auto_applied', 'user_confirmed', 'user_overridden', 'unresolved']);
export const invoiceCaptureStatusEnum = pgEnum('invoice_capture_status', ['captured', 'submitted', 'verified', 'approved', 'rejected']);
export const procurementCategoryEnum = pgEnum('procurement_category', ['material', 'equipment', 'service', 'subcontract', 'other']);
export const procurementStatusEnum = pgEnum('procurement_status', ['requested', 'quoted', 'approved', 'ordered', 'partially_received', 'received', 'invoiced', 'closed']);
export const procurementPaymentStatusEnum = pgEnum('procurement_payment_status', ['not_applicable', 'pending_approval', 'approved', 'scheduled', 'paid', 'on_hold']);
export const trRagStatusEnum = pgEnum("tr_rag_status", ["red", "amber", "green"]);
export const trStatusEnum = pgEnum("tr_status", ["active", "completed"]);
export const trLinkStatusEnum = pgEnum("tr_link_status", ["linked", "task_created", "done"]);
export const trSuggestionDecisionEnum = pgEnum("tr_suggestion_decision", ["suggested", "accepted", "rejected", "suppressed"]);
export const rowSourceEnum = pgEnum("row_source", ["imported", "manual", "imported_edited"]);

// ============================================================================
// PROGRAM EXPENSE / PROGRAM INFLOWS — RETIRED LEGACY TABLES
// ============================================================================
//
// program_expense and program_inflows are physically dropped from the database
// (migrations/20260414_drop_program_expense_and_program_inflows.sql). The
// pgTable definitions are removed.
//
// The TypeScript type names ProgramExpense / InsertProgramExpense /
// ProgramInflows / InsertProgramInflows are preserved as standalone interfaces
// because many files across the repo still use them as method-signature types
// for the PE-shape compatibility view returned by adaptCostToExpense /
// adaptRevenueToInflow. The canonical reads now live in
// server/services/project-cost-line-read-service.ts (cost) and the
// normalized_revenue_lines callers (revenue); both emit rows in the legacy
// PE/PI field shape.
//
// The interfaces below mirror the field shapes the old pgTable-derived types
// produced, so callers compile unchanged. A cosmetic follow-up can rename
// these to `ExpenseLine` / `InflowLine` and update call sites in a single
// mechanical pass — that's optional Wave 4 work.
//
// NEW CODE SHOULD NOT USE THESE TYPES. Use NormalizedCostLine /
// NormalizedRevenueLine from below instead.
// ============================================================================

/**
 * @internal
 * @deprecated PE-shape compatibility view over normalized_cost_lines.
 *
 * TF-26 (audit V3): the underlying `program_expense` table was physically
 * dropped. This interface remains only as a compatibility shape for the
 * legacy adapters (`server/lib/data-merge.ts:mapCostToExpenseInput` and
 * friends). New code must use `NormalizedCostLine`. Do NOT import this
 * type for new features — it will be removed once the last legacy adapter
 * is retired.
 */
export interface ProgramExpense {
  id: number;
  projectName: string;
  rowNumber: number | null;
  rowType: string | null;
  expenseCategory: string | null;
  expenseLineItem: string | null;
  budgetQty: string | null;
  budgetRateUnit: string | null;
  budgetTotal: string | null;
  forecastPaymentDate: string | null;
  budgetCosTotal: string | null;
  expenseQty: string | null;
  expenseRateUnit: string | null;
  expenseActualTotal: string | null;
  expensePoNumber: string | null;
  expenseInvoiceNumber: string | null;
  expenseInvoicedDate: string | null;
  invoiceDateConfirmed: boolean | null;
  invoiceDateFontColor: string | null;
  expensePaymentDate: string | null;
  paymentDateConfirmed: boolean | null;
  paymentDateFontColor: string | null;
  revenueAmount: string | null;
  actualCosTotal: string | null;
  lineStatus: string | null;
  expenseLineHash: string | null;
  computedState: string | null;
  computedForecastPaymentDate: string | null;
  adminDateOverride: string | null;
  adminDateOverrideReason: string | null;
  adminDateOverrideBy: number | null;
  adminDateOverrideAt: Date | null;
  supplierName: string | null;
  isManual: boolean | null;
  subProjectName: string | null;
  cosStatusOverride: string | null;
  cosStatusOverrideBy: number | null;
  cosStatusOverrideAt: Date | null;
  cosStatusOverrideReason: string | null;
  dataSource: string | null;
  projectId: number;
  importRunId: number | null;
  source: "imported" | "manual" | "imported_edited";
  importSnapshot: unknown | null;
  lastEditedBy: number | null;
  lastEditedAt: Date | null;
  createdAt: Date;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  snapshotRunId: number | null;
  deletedAt: Date | null;
}

/**
 * @internal
 * @deprecated PE-shape insert payload (TF-26 — see ProgramExpense above).
 */
export type InsertProgramExpense = Partial<Omit<ProgramExpense, "id" | "createdAt" | "effectiveFrom" | "effectiveTo">> & {
  projectName: string;
  projectId: number;
};

/**
 * @internal
 * @deprecated PI-shape compatibility view over normalized_revenue_lines.
 *
 * TF-26 (audit V3): same status as ProgramExpense above — compatibility
 * shape only, for the legacy adapters. New code must use
 * `NormalizedRevenueLine`.
 */
export interface ProgramInflows {
  id: number;
  projectName: string;
  rowNumber: number | null;
  milestoneNo: string | null;
  milestoneName: string | null;
  milestonePercent: string | null;
  milestoneAmount: string | null;
  plannedPaymentDate: string | null;
  milestoneInvoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  paymentReceivedDate: string | null;
  milestoneNotes: string | null;
  documentsReceived: string | null;
  inBank: number | null;
  inflowLineHash: string | null;
  computedForecastReceiptDate: string | null;
  adminDateOverride: string | null;
  adminDateOverrideReason: string | null;
  adminDateOverrideBy: number | null;
  adminDateOverrideAt: Date | null;
  subProjectName: string | null;
  dataSource: string | null;
  projectId: number;
  importRunId: number | null;
  source: "imported" | "manual" | "imported_edited";
  importSnapshot: unknown | null;
  lastEditedBy: number | null;
  lastEditedAt: Date | null;
  createdAt: Date;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  snapshotRunId: number | null;
}

/**
 * @internal
 * @deprecated PI-shape insert payload (TF-26 — see ProgramInflows above).
 */
export type InsertProgramInflows = Partial<Omit<ProgramInflows, "id" | "createdAt" | "effectiveFrom" | "effectiveTo">> & {
  projectName: string;
  projectId: number;
};

// ============================================================================
// EE-QA-024 — canonical aliases for the legacy PE/PI compatibility shapes.
//
// New code should reference `ExpenseLine` / `InflowLine` (and the matching
// `Insert*` types) rather than the historical `ProgramExpense` /
// `ProgramInflows` names. Both are still the same compatibility shape — the
// aliases simply remove the misleading "Program*" prefix from new call sites
// (the underlying tables `program_expense` / `program_inflows` were dropped
// by migration 20260414, see comment block at top of this file).
//
// The 20 existing legacy call sites still reference Program(Expense|Inflows)
// directly. They are tracked for a mechanical rename as a structural
// workstream — see audit/EE-QA-Assessment-2026-05-06.md § EE-QA-024.
// ============================================================================

/** Canonical name for the PE-shape compatibility view. New code must use this. */
export type ExpenseLine = ProgramExpense;
export type InsertExpenseLine = InsertProgramExpense;

/** Canonical name for the PI-shape compatibility view. New code must use this. */
export type InflowLine = ProgramInflows;
export type InsertInflowLine = InsertProgramInflows;

// ===================== PROJECT PLAN =====================

export const projectPlan = pgTable("project_plan", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number"),
  taskNo: text("task_no"),
  highLevelProgramme: text("high_level_programme"),
  actualStart: date("actual_start"),
  durationDays: integer("duration_days"),
  actualEnd: date("actual_end"),
  actualPctComplete: real("actual_pct_complete"),
  expectedPctComplete: real("expected_pct_complete"),
  source: rowSourceEnum("source").notNull().default("imported"),
  importSnapshot: jsonb("import_snapshot"),
  lastEditedBy: integer("last_edited_by").references(() => users.id, { onDelete: "set null" }),
  lastEditedAt: timestamp("last_edited_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertProjectPlanSchema = createInsertSchema(projectPlan).omit({ id: true, createdAt: true } as any);
export type InsertProjectPlan = z.infer<typeof insertProjectPlanSchema>;
export type ProjectPlan = typeof projectPlan.$inferSelect;

// ===================== CASHFLOW =====================

export const cashflowPoints = pgTable("cashflow_points", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  seriesName: text("series_name").notNull(),
  pointDate: date("point_date").notNull(),
  value: decimal("value", { precision: 15, scale: 2 }),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  source: rowSourceEnum("source").notNull().default("imported"),
  importSnapshot: jsonb("import_snapshot"),
  lastEditedBy: integer("last_edited_by").references(() => users.id, { onDelete: "set null" }),
  lastEditedAt: timestamp("last_edited_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Temporal columns (Prompt 9)
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" }),
});
export const insertCashflowPointSchema = createInsertSchema(cashflowPoints).omit({ id: true, createdAt: true, effectiveFrom: true, effectiveTo: true } as any);
export type InsertCashflowPoint = z.infer<typeof insertCashflowPointSchema>;
export type CashflowPoint = typeof cashflowPoints.$inferSelect;

export const financeRevenueMonthly = pgTable("finance_revenue_monthly", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  monthEndDate: date("month_end_date").notNull(),
  value: decimal("value", { precision: 15, scale: 2 }),
  source: rowSourceEnum("source").notNull().default("imported"),
  importSnapshot: jsonb("import_snapshot"),
  lastEditedBy: integer("last_edited_by").references(() => users.id, { onDelete: "set null" }),
  lastEditedAt: timestamp("last_edited_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Temporal columns (Prompt 9)
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" }),
});
export const insertFinanceRevenueMonthlySchema = createInsertSchema(financeRevenueMonthly).omit({ id: true, createdAt: true, effectiveFrom: true, effectiveTo: true } as any);
export type InsertFinanceRevenueMonthly = z.infer<typeof insertFinanceRevenueMonthlySchema>;
export type FinanceRevenueMonthly = typeof financeRevenueMonthly.$inferSelect;

export const financeCosMonthly = pgTable("finance_cos_monthly", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  monthEndDate: date("month_end_date").notNull(),
  value: decimal("value", { precision: 15, scale: 2 }),
  source: rowSourceEnum("source").notNull().default("imported"),
  importSnapshot: jsonb("import_snapshot"),
  lastEditedBy: integer("last_edited_by").references(() => users.id, { onDelete: "set null" }),
  lastEditedAt: timestamp("last_edited_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Temporal columns (Prompt 9)
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" }),
}, (table) => ({
  projectMonthIdx: index("finance_cos_monthly_project_month_idx").on(table.projectId, table.monthEndDate),
}));
export const insertFinanceCosMonthlySchema = createInsertSchema(financeCosMonthly).omit({ id: true, createdAt: true, effectiveFrom: true, effectiveTo: true } as any);
export type InsertFinanceCosMonthly = z.infer<typeof insertFinanceCosMonthlySchema>;
export type FinanceCosMonthly = typeof financeCosMonthly.$inferSelect;

// ===================== WORKING PLAN =====================

export const workingPlanScenario = pgTable("working_plan_scenario", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Working Plan"),
  isActive: boolean("is_active").notNull().default(true), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertWorkingPlanScenarioSchema = createInsertSchema(workingPlanScenario).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertWorkingPlanScenario = z.infer<typeof insertWorkingPlanScenarioSchema>;
export type WorkingPlanScenario = typeof workingPlanScenario.$inferSelect;

export const projectPlanDependency = pgTable("project_plan_dependency", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  predecessorTaskId: integer("predecessor_task_id").notNull().references(() => projectPlan.id, { onDelete: "cascade" }),
  successorTaskId: integer("successor_task_id").notNull().references(() => projectPlan.id, { onDelete: "cascade" }),
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
  predecessorTaskId: integer("predecessor_task_id").notNull().references(() => projectPlan.id, { onDelete: "cascade" }),
  successorTaskId: integer("successor_task_id").notNull().references(() => projectPlan.id, { onDelete: "cascade" }),
  dependencyType: text("dependency_type").notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
  deletedFlag: boolean("deleted_flag").notNull().default(false), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertWorkingPlanDependencyOverrideSchema = createInsertSchema(workingPlanDependencyOverride).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertWorkingPlanDependencyOverride = z.infer<typeof insertWorkingPlanDependencyOverrideSchema>;
export type WorkingPlanDependencyOverride = typeof workingPlanDependencyOverride.$inferSelect;

export const scheduleChangeNotice = pgTable("schedule_change_notice", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  oldFinishDate: date("old_finish_date"),
  newFinishDate: date("new_finish_date"),
  changedTasks: text("changed_tasks"),
  criticalPathDelta: text("critical_path_delta"),
  userNote: text("user_note"),
  clientNotified: boolean("client_notified").notNull().default(false),
  documentationUpdated: boolean("documentation_updated").notNull().default(false),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertScheduleChangeNoticeSchema = createInsertSchema(scheduleChangeNotice).omit({ id: true, createdAt: true } as any);
export type InsertScheduleChangeNotice = z.infer<typeof insertScheduleChangeNoticeSchema>;
export type ScheduleChangeNotice = typeof scheduleChangeNotice.$inferSelect;

// ===================== CASHFLOW & OPEX MANUAL =====================

export const cashflowWeeklyManual = pgTable("cashflow_weekly_manual", {
  id: serial("id").primaryKey(),
  weekStartDate: date("week_start_date").notNull().unique(),
  openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertCashflowWeeklyManualSchema = createInsertSchema(cashflowWeeklyManual).omit({ id: true, updatedAt: true } as any);
export type InsertCashflowWeeklyManual = z.infer<typeof insertCashflowWeeklyManualSchema>;
export type CashflowWeeklyManual = typeof cashflowWeeklyManual.$inferSelect;

export const cashflowBalanceHistory = pgTable("cashflow_balance_history", {
  id: serial("id").primaryKey(),
  weekStartDate: date("week_start_date").notNull(),
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
  weekStartDate: date("week_start_date").notNull().unique(),
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
  weekStartDate: date("week_start_date").notNull(),
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
  weekStartDate: date("week_start_date").notNull().unique(),
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

// ===================== COUNTERPARTIES =====================

export const counterparties = pgTable("counterparties", {
  id: serial("id").primaryKey(),
  nameCanonical: text("name_canonical").notNull(),
  nameAliases: jsonb("name_aliases").notNull().default([]),
  typeDefault: counterpartyTypeEnum("type_default").notNull().default('OTHER'),
  isCore: boolean("is_core").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
  roleTags: text("role_tags").array().notNull().default([]),
  vatNumber: text("vat_number"),
  registrationNumber: text("registration_number"),
  address: text("address"),
  contactPerson: text("contact_person"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  bankName: text("bank_name"),
  // stored encrypted at rest; decrypt only in server/lib/field-encryption.ts
  bankAccountNumber: text("bank_account_number"),
  // stored encrypted at rest; decrypt only in server/lib/field-encryption.ts
  bankBranchCode: text("bank_branch_code"),
  paymentTerms: text("payment_terms"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
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
  isActive: boolean("is_active").notNull().default(true), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertCounterpartyContactSchema = createInsertSchema(counterpartyContacts).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertCounterpartyContact = z.infer<typeof insertCounterpartyContactSchema>;
export type CounterpartyContact = typeof counterpartyContacts.$inferSelect;

// ===================== NORMALIZED LINES =====================

export const normalizedRevenueLines = pgTable("normalized_revenue_lines", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  description: text("description"),
  milestoneName: text("milestone_name"),
  milestoneNo: text("milestone_no"),
  milestonePercent: decimal("milestone_percent", { precision: 6, scale: 4 }),
  amountExVat: decimal("amount_ex_vat", { precision: 15, scale: 2 }),
  vat: decimal("vat", { precision: 15, scale: 2 }),
  /** Legacy TEXT column preserved for 30-day rollback window. Remove after cleanup PR. */
  amountExVatLegacy: text("amount_ex_vat_legacy"),
  vatLegacy: text("vat_legacy"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  invoiceDateFontColor: text("invoice_date_font_color"),
  invoiceDateConfirmed: boolean("invoice_date_confirmed"),
  expectedPaymentDate: date("expected_payment_date"),
  paidDate: date("paid_date"),
  paidDateFontColor: text("paid_date_font_color"),
  paidDateConfirmed: boolean("paid_date_confirmed"),
  inBankDate: date("in_bank_date"),
  status: revenueLineStatusEnum("status").notNull().default('planned'),
  sourceSheet: text("source_sheet"),
  sourceRow: integer("source_row"),
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
  turnaroundDays: integer("turnaround_days"),
  adminDateOverride: date("admin_date_override"),
  adminDateOverrideReason: text("admin_date_override_reason"),
  adminDateOverrideBy: integer("admin_date_override_by").references(() => users.id, { onDelete: "set null" }),
  adminDateOverrideAt: timestamp("admin_date_override_at"),
  subProjectName: text("sub_project_name"),
  // Tracker col R — Milestone Notes & Comments. Previously dropped
  // by the importer (synonym `requirements` mapped to nothing).
  milestoneNotes: text("milestone_notes"),
  // Per-cell font/fill colour from the source workbook. Keyed by canonical
  // field name, e.g. { invoice_date: { font: "#FF0000", fill: "#FFFF00" } }.
  // The legacy `*_font_color` text columns are kept for backward compat.
  cellFormat: jsonb("cell_format"),
  // Stable hash-based row identity. Computed deterministically from the
  // row's identity columns so the same logical row keeps the same hash
  // across re-imports, even when its serial id changes. Lookups go through
  // (project_id, row_hash) which has a partial index for active rows only.
  rowHash: text("row_hash"),
  // Snapshot of the row exactly as it was written by the most recent
  // import. Used as the "common ancestor" in 3-way merge against (a) the
  // current DB state and (b) the new file row, to distinguish a manual
  // edit from an import update.
  importSnapshot: jsonb("import_snapshot"),
  // Per-field manual-override audit. Keyed by canonical field name with
  // metadata about who edited what when, e.g.:
  //   { "milestone_notes": { "value": "...", "editedBy": 7, "editedAt": "..." } }
  // The 3-way merge consults this map to decide whether to surface a
  // conflict, accept the file value, or preserve the manual edit.
  manualOverrides: jsonb("manual_overrides"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Soft-delete column (column already present in DB; mirroring it here
  // so Drizzle queries can reference normalizedRevenueLines.deletedAt).
  deletedAt: timestamp("deleted_at"),
  // Temporal columns (Prompt 9)
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" }),
}, (table) => ({
  // Partial index — only active rows participate in stable-ID lookups.
  rowHashActiveIdx: index("normalized_revenue_lines_row_hash_active_idx")
    .on(table.projectId, table.rowHash)
    .where(sql`${table.effectiveTo} IS NULL`),
}));
export const insertNormalizedRevenueLineSchema = createInsertSchema(normalizedRevenueLines).omit({ id: true, createdAt: true, updatedAt: true, effectiveFrom: true, effectiveTo: true, amountExVatLegacy: true, vatLegacy: true, deletedAt: true } as any);
export type InsertNormalizedRevenueLine = z.infer<typeof insertNormalizedRevenueLineSchema>;
export type NormalizedRevenueLine = typeof normalizedRevenueLines.$inferSelect;

// ===================== CATEGORY REVENUE ALLOCATIONS =====================

// Canonical lowercase values matching the live DB enum created by
// migrations/20260411_create_category_revenue_allocations.sql and hardened
// by migrations/20260413_status_casing_normalization.sql. Do NOT change the
// casing here without a paired ALTER TYPE migration — the normalizer in
// server/lib/import/utils.ts (normalizeAllocationConfidence) is the one
// authoritative path that maps incoming UPPERCASE / mixed-case values to
// these canonical literals at write time.
export const allocationConfidenceEnum = pgEnum('allocation_confidence', ['direct', 'header_error_positional', 'provisional', 'manual']);

export const categoryRevenueAllocations = pgTable("category_revenue_allocations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  projectName: text("project_name").notNull(),
  categoryNumber: text("category_number").notNull(),
  categoryName: text("category_name").notNull(),
  categoryKey: text("category_key").notNull(),
  categorySortOrder: integer("category_sort_order").notNull(),
  revenueAllocation: decimal("revenue_allocation", { precision: 15, scale: 2 }),
  allocationConfidence: allocationConfidenceEnum("allocation_confidence").notNull().default('provisional'),
  budgetTotal: decimal("budget_total", { precision: 15, scale: 2 }),
  budgetCos: decimal("budget_cos", { precision: 15, scale: 2 }),
  importRunId: integer("import_run_id").references(() => smartImportRuns.id),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" }),
  sourceSheet: text("source_sheet"),
  sourceRow: integer("source_row"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertCategoryRevenueAllocationSchema = createInsertSchema(categoryRevenueAllocations).omit({ id: true, createdAt: true, updatedAt: true, effectiveFrom: true, effectiveTo: true } as any);
export type InsertCategoryRevenueAllocation = z.infer<typeof insertCategoryRevenueAllocationSchema>;
export type CategoryRevenueAllocation = typeof categoryRevenueAllocations.$inferSelect;

// ===================== NORMALIZED COST LINES =====================

export const normalizedCostLines = pgTable("normalized_cost_lines", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  costCategory: text("cost_category"),
  counterpartyId: integer("counterparty_id").references(() => counterparties.id),
  counterpartyName: text("counterparty_name"),
  counterpartyType: counterpartyTypeEnum("counterparty_type"),
  description: text("description"),
  amountExVat: decimal("amount_ex_vat", { precision: 15, scale: 2 }),
  /** Legacy TEXT column preserved for 30-day rollback window. Remove after cleanup PR. */
  amountExVatLegacy: text("amount_ex_vat_legacy"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  invoiceDateFontColor: text("invoice_date_font_color"),
  invoiceDateConfirmed: boolean("invoice_date_confirmed"),
  approvedDate: date("approved_date"),
  paidDate: date("paid_date"),
  paidDateFontColor: text("paid_date_font_color"),
  paidDateConfirmed: boolean("paid_date_confirmed"),
  poNumber: text("po_number"),
  cosRealised: boolean("cos_realised"),
  cashflowConfirmed: boolean("cashflow_confirmed"),
  status: costLineStatusEnum("cost_line_status").notNull().default('planned'),
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
  forecastPaymentDate: date("forecast_payment_date"),
  adminDateOverride: date("admin_date_override"),
  adminDateOverrideReason: text("admin_date_override_reason"),
  adminDateOverrideBy: integer("admin_date_override_by").references(() => users.id, { onDelete: "set null" }),
  adminDateOverrideAt: timestamp("admin_date_override_at"),
  subProjectName: text("sub_project_name"),
  cosStatusOverride: text("cos_status_override"),
  cosStatusOverrideBy: integer("cos_status_override_by").references(() => users.id, { onDelete: "set null" }),
  cosStatusOverrideAt: timestamp("cos_status_override_at"),
  cosStatusOverrideReason: text("cos_status_override_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Soft-delete column (column already present in DB; mirroring it here
  // so Drizzle queries can reference normalizedCostLines.deletedAt).
  deletedAt: timestamp("deleted_at"),
  // Temporal columns (Prompt 9)
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" }),
  // Client-generated idempotency key for manual expense creation.
  // Prevents duplicate rows from double-clicks, browser resends, and network retries.
  // NULL for imported rows (no dedup needed — imports use soft-close + re-insert).
  idempotencyKey: text("idempotency_key"),
  // Category-level fields for revenue release formula (S02).
  // categoryKey: canonical numbered category key (e.g. "1. Panels") for grouping/sorting.
  // categoryAllocationId: FK to the category_revenue_allocations row for direct formula lookup.
  categoryKey: text("category_key"),
  categoryAllocationId: integer("category_allocation_id").references(() => categoryRevenueAllocations.id),
  // Tracker Expenditure Breakdown — actual-side QTY and Rate (cols O, P).
  // Previously collapsed onto budgetQty/budgetRate, dropping the actual values.
  actualQty: text("actual_qty"),
  actualRate: text("actual_rate"),
  // Tracker col AA — free-text Comments per cost line.
  comments: text("comments"),
  // Tracker col V — CHECK column. Stored as raw text because the source
  // is a formula; non-zero / non-empty signals a validation flag.
  checkFlag: text("check_flag"),
  // Tracker col Z — Saving / Overrun stored from the workbook (vs derived)
  // so the imported value is preserved verbatim for audit.
  savingOverrun: decimal("saving_overrun", { precision: 15, scale: 2 }),
  // Tracker cols AB/AC, AE — header/sidebar values that apply to the line.
  // TF-5 (audit V3, owner-confirmed 2026-05-26): `amount_ex_vat` already
  // holds the ZAR-equivalent figure. `usdExchangeRate` and `pricePerWatt`
  // are stored as METADATA ONLY — surfaced by the tracker replica view
  // for context; NOT multiplied into any finance aggregate. If the
  // tracker convention ever changes ("raw USD in amount_ex_vat"), every
  // aggregator under server/repositories/finance-* and
  // server/services/canonical-dashboard-kpi-service.ts MUST be updated
  // to apply the rate. Do not silently flip the meaning.
  usdExchangeRate: decimal("usd_exchange_rate", { precision: 10, scale: 4 }),
  pricePerWatt: decimal("price_per_watt", { precision: 12, scale: 6 }),
  // Per-cell font/fill colour. See cellFormat note on normalizedRevenueLines.
  cellFormat: jsonb("cell_format"),
  // Stable-ID + 3-way-merge support. See identical fields on
  // normalizedRevenueLines for documentation of intent and shape.
  rowHash: text("row_hash"),
  importSnapshot: jsonb("import_snapshot"),
  manualOverrides: jsonb("manual_overrides"),
}, (table) => ({
  rowHashActiveIdx: index("normalized_cost_lines_row_hash_active_idx")
    .on(table.projectId, table.rowHash)
    .where(sql`${table.effectiveTo} IS NULL`),
}));
export const insertNormalizedCostLineSchema = createInsertSchema(normalizedCostLines).omit({ id: true, createdAt: true, updatedAt: true, effectiveFrom: true, effectiveTo: true, amountExVatLegacy: true, deletedAt: true } as any);
export type InsertNormalizedCostLine = z.infer<typeof insertNormalizedCostLineSchema>;
export type NormalizedCostLine = typeof normalizedCostLines.$inferSelect;

// ===================== COST LINE ACTUALS (1:N CHILD) =====================

// One row per actual entry on the right-hand side of the Tracker's
// Expenditure Breakdown sheet. The Tracker pairs costed items with
// their actual invoices; when a single costed line is settled across
// multiple invoice batches, the actual side has more rows than the
// costed side, and the previous schema lost everything past the first.
export const normalizedCostLineActuals = pgTable("normalized_cost_line_actuals", {
  id: serial("id").primaryKey(),
  costLineId: integer("cost_line_id").notNull().references(() => normalizedCostLines.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  // Position of the actual entry within its parent costed line.
  actualNo: integer("actual_no").notNull(),
  description: text("description"),
  qty: text("qty"),
  rate: text("rate"),
  actualTotal: decimal("actual_total", { precision: 15, scale: 2 }),
  poNumber: text("po_number"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  revenueRecognitionAmount: decimal("revenue_recognition_amount", { precision: 15, scale: 2 }),
  financePaymentDate: date("finance_payment_date"),
  comments: text("comments"),
  checkFlag: text("check_flag"),
  savingOverrun: decimal("saving_overrun", { precision: 15, scale: 2 }),
  cellFormat: jsonb("cell_format"),
  // Stable-ID + 3-way-merge support. See identical fields on
  // normalizedRevenueLines for documentation of intent and shape.
  rowHash: text("row_hash"),
  importSnapshot: jsonb("import_snapshot"),
  manualOverrides: jsonb("manual_overrides"),
  sourceSheet: text("source_sheet"),
  sourceRow: integer("source_row"),
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  // Temporal columns — same model as parent normalizedCostLines.
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" }),
}, (table) => ({
  costLineIdIdx: index("normalized_cost_line_actuals_cost_line_id_idx").on(table.costLineId),
  projectIdIdx: index("normalized_cost_line_actuals_project_id_idx").on(table.projectId),
  effectiveToIdx: index("normalized_cost_line_actuals_effective_to_idx").on(table.effectiveTo),
  rowHashActiveIdx: index("normalized_cost_line_actuals_row_hash_active_idx")
    .on(table.costLineId, table.rowHash)
    .where(sql`${table.effectiveTo} IS NULL`),
}));
export const insertNormalizedCostLineActualSchema = createInsertSchema(normalizedCostLineActuals).omit({ id: true, createdAt: true, updatedAt: true, effectiveFrom: true, effectiveTo: true, deletedAt: true } as any);
export type InsertNormalizedCostLineActual = z.infer<typeof insertNormalizedCostLineActualSchema>;
export type NormalizedCostLineActual = typeof normalizedCostLineActuals.$inferSelect;

// ===================== TRACKER REVENUE SUMMARY =====================

// Captures the high-level totals at the top of the Tracker's Revenue
// Tracking sheet (rows 4–7): Planned Revenue / Expenditure / Profit /
// Margin, each with COSTED and ACTUAL columns. One row per import.
export const trackerRevenueSummary = pgTable("tracker_revenue_summary", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
  plannedRevenueCosted: decimal("planned_revenue_costed", { precision: 15, scale: 2 }),
  plannedRevenueActual: decimal("planned_revenue_actual", { precision: 15, scale: 2 }),
  plannedExpenditureCosted: decimal("planned_expenditure_costed", { precision: 15, scale: 2 }),
  plannedExpenditureActual: decimal("planned_expenditure_actual", { precision: 15, scale: 2 }),
  plannedProfitCosted: decimal("planned_profit_costed", { precision: 15, scale: 2 }),
  plannedProfitActual: decimal("planned_profit_actual", { precision: 15, scale: 2 }),
  plannedMarginCosted: decimal("planned_margin_costed", { precision: 8, scale: 6 }),
  plannedMarginActual: decimal("planned_margin_actual", { precision: 8, scale: 6 }),
  cellFormat: jsonb("cell_format"),
  sourceSheet: text("source_sheet"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" }),
}, (table) => ({
  projectIdIdx: index("tracker_revenue_summary_project_id_idx").on(table.projectId),
  effectiveToIdx: index("tracker_revenue_summary_effective_to_idx").on(table.effectiveTo),
}));
export const insertTrackerRevenueSummarySchema = createInsertSchema(trackerRevenueSummary).omit({ id: true, createdAt: true, updatedAt: true, effectiveFrom: true, effectiveTo: true } as any);
export type InsertTrackerRevenueSummary = z.infer<typeof insertTrackerRevenueSummarySchema>;
export type TrackerRevenueSummary = typeof trackerRevenueSummary.$inferSelect;

// ===================== TRACKER PROJECT METADATA =====================

// Captures the top-of-sheet metadata block on the Project Plan tab
// (rows 1–7): baseline / forecasted completion dates, project start
// date, and duration metrics. One row per import.
export const trackerProjectMetadata = pgTable("tracker_project_metadata", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  importRunId: integer("import_run_id").notNull().references(() => smartImportRuns.id),
  baselineCompletionDate: date("baseline_completion_date"),
  forecastedCompletionDate: date("forecasted_completion_date"),
  projectStartDate: date("project_start_date"),
  durationMonthsFromSiteEstab: decimal("duration_months_from_site_estab", { precision: 8, scale: 4 }),
  durationMonthsToCapacityTest: decimal("duration_months_to_capacity_test", { precision: 8, scale: 4 }),
  cellFormat: jsonb("cell_format"),
  sourceSheet: text("source_sheet"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  snapshotRunId: integer("snapshot_run_id").references(() => smartImportRuns.id, { onDelete: "set null" }),
}, (table) => ({
  projectIdIdx: index("tracker_project_metadata_project_id_idx").on(table.projectId),
  effectiveToIdx: index("tracker_project_metadata_effective_to_idx").on(table.effectiveTo),
}));
export const insertTrackerProjectMetadataSchema = createInsertSchema(trackerProjectMetadata).omit({ id: true, createdAt: true, updatedAt: true, effectiveFrom: true, effectiveTo: true } as any);
export type InsertTrackerProjectMetadata = z.infer<typeof insertTrackerProjectMetadataSchema>;
export type TrackerProjectMetadata = typeof trackerProjectMetadata.$inferSelect;

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
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastConfirmedAt: timestamp("last_confirmed_at"),
  timesMatched: integer("times_matched").notNull().default(0),
  timesConfirmed: integer("times_confirmed").notNull().default(0),
  timesOverridden: integer("times_overridden").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
});
export const insertInvoicePatternRuleSchema = createInsertSchema(invoicePatternRules).omit({ id: true, createdAt: true, timesMatched: true, timesConfirmed: true, timesOverridden: true } as any);
export type InsertInvoicePatternRule = z.infer<typeof insertInvoicePatternRuleSchema>;
export type InvoicePatternRule = typeof invoicePatternRules.$inferSelect;

export const invoicePatternMatches = pgTable("invoice_pattern_matches", {
  id: serial("id").primaryKey(),
  importRunId: integer("import_run_id").references(() => smartImportRuns.id),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  invoiceNumberRaw: text("invoice_number_raw"),
  invoiceNumberNorm: text("invoice_number_norm"),
  matchedRuleId: integer("matched_rule_id").references(() => invoicePatternRules.id),
  inferredType: counterpartyTypeEnum("inferred_type").notNull().default('OTHER'),
  inferredCounterpartyId: integer("inferred_counterparty_id").references(() => counterparties.id),
  confidenceScore: integer("confidence_score").notNull().default(0),
  outcome: patternMatchOutcomeEnum("outcome").notNull().default('unresolved'),
  sourceRow: integer("source_row"),
  overrideReason: text("override_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertInvoicePatternMatchSchema = createInsertSchema(invoicePatternMatches).omit({ id: true, createdAt: true } as any);
export type InsertInvoicePatternMatch = z.infer<typeof insertInvoicePatternMatchSchema>;
export type InvoicePatternMatch = typeof invoicePatternMatches.$inferSelect;

// ===================== INVOICE DESCRIPTION PATTERNS =====================

/**
 * Per-counterparty memo / description fingerprint.
 *
 * Companion to `invoice_pattern_rules` (which fingerprints the invoice
 * NUMBER) — this table stores the canonical token set extracted from a
 * counterparty's bills' descriptions / QuickBooks PrivateNote / app
 * cost-line description. When a future QuickBooks bill arrives with a
 * memo whose token set has Jaccard similarity ≥ 0.6 against any active
 * row for the cost line's counterparty, the matcher boosts the candidate
 * by +12 confidence and surfaces "learned pattern" in the reasons list.
 *
 * Patterns are seeded one at a time from approved QB ↔ app links — never
 * silently. Each new fingerprint is emitted as a `description_pattern_create`
 * cascade proposal that the reviewer Accepts before the row is written.
 *
 * Counter semantics:
 *   - timesMatched   : the matcher used this rule to boost a candidate
 *   - timesConfirmed : the boosted candidate was approved (auto-increment)
 *   - timesOverridden: the boosted candidate was rejected (decay signal)
 *
 * The matcher decays a rule's effective weight when timesOverridden / total
 * ≥ 0.3 — see `server/services/quickbooks-invoice-match-service.ts`.
 */
export const invoiceDescriptionPatterns = pgTable("invoice_description_patterns", {
  id: serial("id").primaryKey(),
  counterpartyId: integer("counterparty_id").notNull().references(() => counterparties.id, { onDelete: "cascade" }),
  /** Snapshot of the counterparty name at pattern-write time (audit). */
  counterpartyName: text("counterparty_name"),
  /** Sorted, lower-cased, stop-word-filtered token list. JSONB array of strings. */
  tokenSet: jsonb("token_set").notNull(),
  /** Original memo / description used to seed the pattern (audit + UI display). */
  normalizedExample: text("normalized_example"),
  /** 0–100 baseline weight; learner may decay this via override ratio. */
  confidenceWeight: integer("confidence_weight").notNull().default(50),
  timesMatched: integer("times_matched").notNull().default(0),
  timesConfirmed: integer("times_confirmed").notNull().default(0),
  timesOverridden: integer("times_overridden").notNull().default(0),
  lastConfirmedAt: timestamp("last_confirmed_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  counterpartyIdx: index("invoice_description_patterns_counterparty_idx").on(table.counterpartyId),
  activeIdx: index("invoice_description_patterns_active_idx")
    .on(table.counterpartyId, table.isActive)
    .where(sql`${table.deletedAt} IS NULL`),
}));
export const insertInvoiceDescriptionPatternSchema = createInsertSchema(invoiceDescriptionPatterns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  timesMatched: true,
  timesConfirmed: true,
  timesOverridden: true,
} as any);
export type InsertInvoiceDescriptionPattern = z.infer<typeof insertInvoiceDescriptionPatternSchema>;
export type InvoiceDescriptionPattern = typeof invoiceDescriptionPatterns.$inferSelect;

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
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  weekStarting: date("week_starting").notNull(),
  reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }),
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
  ragStatus: trRagStatusEnum("rag_status").notNull().default("green"),
  owners: text("owners").array().notNull().default([]),
  ownerUserIds: integer("owner_user_ids").array(),
  support: text("support").array().notNull().default([]),
  dateRaised: timestamp("date_raised"),
  dueDate: timestamp("due_date"),
  status: trStatusEnum("status").notNull().default("active"),
  dateCompleted: timestamp("date_completed"),
  outcomeComments: text("outcome_comments"),
  supportingInfo: text("supporting_info"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
  scheduledDate: date("scheduled_date"),
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
  autoCreatedPmTaskId: integer("auto_created_pm_task_id").references(() => projectPlan.id, { onDelete: "set null" }),
  linkStatus: trLinkStatusEnum("link_status").notNull().default("linked"),
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
  decision: trSuggestionDecisionEnum("decision").notNull().default("suggested"),
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
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  milestoneRowNumber: integer("milestone_row_number").notNull(),
  taskId: integer("task_id").notNull().references(() => projectPlan.id, { onDelete: "cascade" }),
  dateOverride: date("date_override"),
  dateOverrideReason: text("date_override_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertMilestoneTaskLinkSchema = createInsertSchema(milestoneTaskLinks).omit({ id: true, createdAt: true } as any);
export type InsertMilestoneTaskLink = z.infer<typeof insertMilestoneTaskLinkSchema>;
export type MilestoneTaskLink = typeof milestoneTaskLinks.$inferSelect;

export const expenseTaskLinks = pgTable("expense_task_links", {
  id: serial("id").primaryKey(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  /**
   * @deprecated Vestigial legacy FK column. Originally referenced
   * program_expense.id. The program_expense table was dropped in
   * migrations/20260414_drop_program_expense_and_program_inflows.sql, and
   * the CASCADE clause swept this column's pointers away at the same
   * time. The column itself is retained as a vestigial INTEGER until a
   * future cleanup removes it from the table. New links should use
   * canonicalExpenseId (FK to normalized_cost_lines) below.
   */
  expenseId: integer("expense_id").notNull(),
  taskId: integer("task_id").notNull().references(() => projectPlan.id, { onDelete: "cascade" }),
  dateOverride: date("date_override"),
  dateOverrideReason: text("date_override_reason"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Canonical FK columns (S03) — point to canonical tables instead of legacy.
  // During migration, both old (expenseId/taskId) and new columns coexist.
  canonicalExpenseId: integer("canonical_expense_id").references(() => normalizedCostLines.id),
  canonicalTaskId: integer("canonical_task_id").references(() => workItems.id),
});
export const insertExpenseTaskLinkSchema = createInsertSchema(expenseTaskLinks).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertExpenseTaskLink = z.infer<typeof insertExpenseTaskLinkSchema>;
export type ExpenseTaskLink = typeof expenseTaskLinks.$inferSelect;

export const writebackMappings = pgTable("writeback_mappings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name"),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  workbookPath: text("workbook_path").notNull(),
  sheetName: text("sheet_name").notNull(),
  cellAddress: text("cell_address").notNull(),
  sourceField: text("source_field").notNull(),
  entityType: text("entity_type").notNull(),
  dataTransform: text("data_transform"),
  validationRule: text("validation_rule"),
  allowedRoles: text("allowed_roles").array(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
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
  actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
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
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  editType: text("edit_type").notNull(),
  editTarget: text("edit_target").notNull(),
  editPayload: text("edit_payload").notNull(),
  editSummary: text("edit_summary").notNull(),
  isCriticalPath: boolean("is_critical_path").notNull().default(false),
  affectsRevenue: boolean("affects_revenue").notNull().default(false),
  affectsExpenditure: boolean("affects_expenditure").notNull().default(false),
  affectsQuality: boolean("affects_quality").notNull().default(false),
  status: text("status").notNull().default("pending"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
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
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  ruleType: text("rule_type").notNull(),
  ruleConfig: text("rule_config").notNull(),
  isActive: boolean("is_active").notNull().default(true), // TODO: migrate to deletedAt pattern
  deletedAt: timestamp("deleted_at"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertFinancialIntegrationRuleSchema = createInsertSchema(financialIntegrationRules).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertFinancialIntegrationRule = z.infer<typeof insertFinancialIntegrationRuleSchema>;
export type FinancialIntegrationRule = typeof financialIntegrationRules.$inferSelect;

// ===================== INVOICE CAPTURES & PROCUREMENT =====================

export const invoiceCaptures = pgTable("invoice_captures", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").references(() => counterparties.id),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  // C4 (audit closeout): converted from real() to decimal(15,2) for exact ZAR storage.
  // Migration: 20260412_financial_columns_to_numeric.sql
  amount: decimal("amount", { precision: 15, scale: 2 }),
  vatAmount: decimal("vat_amount", { precision: 15, scale: 2 }),
  linkedPoId: integer("linked_po_id"),  // FK added via migration to purchase_orders
  linkedProcurementItemId: integer("linked_procurement_item_id"),  // FK to procurement_items managed via migration
  status: invoiceCaptureStatusEnum("status").notNull().default('captured'),
  capturedByUserId: integer("captured_by_user_id").references(() => users.id, { onDelete: "set null" }),
  documentPath: text("document_path"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // EPC workflow additions
  qbSyncStatus: text("qb_sync_status").default("not_synced"),
  documentDriveId: text("document_drive_id"),
  documentItemId: text("document_item_id"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});
export const insertInvoiceCaptureSchema = createInsertSchema(invoiceCaptures).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true, deletedBy: true } as any);
export type InsertInvoiceCapture = z.infer<typeof insertInvoiceCaptureSchema>;
export type InvoiceCapture = typeof invoiceCaptures.$inferSelect;

export const procurementItems = pgTable("procurement_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  category: procurementCategoryEnum("category").notNull().default('other'),
  // C4 (audit closeout): quantities and costs converted from real() to decimal()
  // for exact storage (no float rounding errors). Migration:
  // 20260412_financial_columns_to_numeric.sql
  quantity: decimal("quantity", { precision: 15, scale: 3 }),
  unit: text("unit"),
  expectedCost: decimal("expected_cost", { precision: 15, scale: 2 }),
  actualCost: decimal("actual_cost", { precision: 15, scale: 2 }),
  supplierId: integer("supplier_id").references(() => counterparties.id),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  status: procurementStatusEnum("status").notNull().default('requested'),
  requiredDate: date("required_date"),
  poId: integer("po_id"),
  invoiceRef: text("invoice_ref"),
  linkedInvoiceCaptureId: integer("linked_invoice_capture_id"),  // FK to invoice_captures managed via migration
  budgetLine: text("budget_line"),
  linkedDeliverableId: integer("linked_deliverable_id"),
  linkedMilestone: text("linked_milestone"),
  progressPercent: real("progress_percent"),
  receiptRef: text("receipt_ref"),
  paymentStatus: procurementPaymentStatusEnum("payment_status").notNull().default('not_applicable'),
  linkedTaskId: integer("linked_task_id").references(() => projectPlan.id, { onDelete: "set null" }),
  approvalId: integer("approval_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // C2: Procurement standalone module enrichment
  requisitionStatus: text("requisition_status").default("none"),          // 'none', 'requested', 'approved', 'rfq_sent', 'quoted', 'po_issued'
  rfqSentDate: date("rfq_sent_date"),
  quoteReceivedDate: date("quote_received_date"),
  quoteAmount: decimal("quote_amount", { precision: 15, scale: 2 }),
  boqReference: text("boq_reference"),
  deliveryExpectedDate: date("delivery_expected_date"),
  deliveryActualDate: date("delivery_actual_date"),
  deliveryStatus: text("delivery_status").default("not_ordered"),         // 'not_ordered', 'ordered', 'shipped', 'delivered', 'partial'
  isLongLead: boolean("is_long_lead").default(false),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
});
export const insertProcurementItemSchema = createInsertSchema(procurementItems).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true, deletedBy: true } as any);
export type InsertProcurementItem = z.infer<typeof insertProcurementItemSchema>;
export type ProcurementItem = typeof procurementItems.$inferSelect;

// ===================== FYE TABLES =====================

export const fyeBudgets = pgTable("fye_budgets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  fye: text("fye").notNull(),
  monthKey: text("month_key").notNull(),
  budgetType: text("budget_type").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull().default("0"),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertFyeBudgetSchema = createInsertSchema(fyeBudgets).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertFyeBudget = z.infer<typeof insertFyeBudgetSchema>;
export type FyeBudget = typeof fyeBudgets.$inferSelect;

export const fiscalYears = pgTable("fiscal_years", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type FiscalYear = typeof fiscalYears.$inferSelect;

export const fiscalPeriods = pgTable("fiscal_periods", {
  id: serial("id").primaryKey(),
  fiscalYearId: integer("fiscal_year_id").notNull().references(() => fiscalYears.id, { onDelete: "cascade" }),
  periodName: text("period_name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  fiscalYearSortIdx: index("fiscal_periods_fiscal_year_sort_idx").on(table.fiscalYearId, table.sortOrder),
}));
export type FiscalPeriod = typeof fiscalPeriods.$inferSelect;

export const forecastPipeline = pgTable("forecast_pipeline", {
  id: serial("id").primaryKey(),
  fyeYear: integer("fye_year").notNull().default(2026),
  /** @deprecated Use projectId FK instead. Kept for backward compatibility. */
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  projectDeveloper: text("project_developer"),
  location: text("location"),
  sizeKwp: decimal("size_kwp", { precision: 12, scale: 2 }),
  dealProbabilityPct: integer("deal_probability_pct").notNull().default(75),
  forecastSignatureDate: date("forecast_signature_date"),
  solarRevenue: decimal("solar_revenue", { precision: 15, scale: 2 }).default("0"),
  bessRevenue: decimal("bess_revenue", { precision: 15, scale: 2 }).default("0"),
  forecastGpPct: decimal("forecast_gp_pct", { precision: 6, scale: 4 }),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
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
  lostDate: date("lost_date"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
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
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
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
  snapshotDate: date("snapshot_date").notNull(),
  snapshotLabel: text("snapshot_label").notNull(),
  status: text("status").notNull().default("draft"),
  snapshotData: text("snapshot_data").notNull(),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  submittedBy: integer("submitted_by").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at"),
  approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
});
export type FyeReportSnapshot = typeof fyeReportSnapshots.$inferSelect;

// ===================== BUDGET BASELINES (B5) =====================

export const budgetBaselines = pgTable("budget_baselines", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  revenueBaseline: decimal("revenue_baseline", { precision: 15, scale: 2 }),
  cosBaseline: decimal("cos_baseline", { precision: 15, scale: 2 }),
  marginBaseline: decimal("margin_baseline", { precision: 15, scale: 2 }),
  contingency: decimal("contingency", { precision: 15, scale: 2 }),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedDate: timestamp("approved_date"),
  changeLocked: boolean("change_locked").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  projectVersionUnique: unique("budget_baselines_project_version_unique").on(table.projectId, table.version),
}));

export const insertBudgetBaselineSchema = createInsertSchema(budgetBaselines).omit({ id: true, createdAt: true } as any);
export type InsertBudgetBaseline = z.infer<typeof insertBudgetBaselineSchema>;
export type BudgetBaseline = typeof budgetBaselines.$inferSelect;

// ===================== EPC WORKFLOW: ENUMS =====================

export const poStatusEnum = pgEnum('po_status', ['draft', 'submitted', 'in_review', 'requires_info', 'blocked', 'approved', 'cancelled']);
export const paymentRequestStatusEnum = pgEnum('payment_request_status', ['new', 'in_review', 'loaded_for_payment', 'proof_attached', 'complete', 'requires_info', 'blocked']);
export const paymentBatchStatusEnum = pgEnum('payment_batch_status', ['preparing', 'submitted', 'approved', 'released', 'confirmed']);
export const poReviewDecisionEnum = pgEnum('po_review_decision', ['pending', 'approved', 'requires_info', 'blocked']);

// ===================== EPC WORKFLOW: PURCHASE ORDERS (Drizzle def wrapping existing table) =====================

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poRef: text("po_ref").notNull().unique(),
  poNumber: integer("po_number").notNull(),
  projectName: text("project_name").notNull(),
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  // Canonical supplier identity. Nullable for backward compatibility with
  // historical POs created before the FK was introduced; new flows MUST
  // populate it and validate the counterparty has payment terms set.
  counterpartyId: integer("counterparty_id").references(() => counterparties.id, { onDelete: "set null" }),
  supplierName: text("supplier_name").notNull(),
  supplierVat: text("supplier_vat"),
  supplierAddress: text("supplier_address"),
  supplierContact: text("supplier_contact"),
  lineItems: jsonb("line_items").notNull().default([]),
  subtotal: decimal("subtotal", { precision: 15, scale: 2 }).notNull().default("0"),
  vatAmount: decimal("vat_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 15, scale: 2 }).notNull().default("0"),
  paymentTerms: text("payment_terms"),
  deliveryDate: text("delivery_date"),
  deliveryAddress: text("delivery_address"),
  siteContact: text("site_contact"),
  comments: text("comments"),
  projectManager: text("project_manager"),
  status: text("status").notNull().default("draft"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  pdfData: text("pdf_data"),  // BYTEA in DB, handled as Buffer in routes
  // Client-generated idempotency key to prevent duplicate POs from
  // double-clicks, browser resends, and network retries.
  idempotencyKey: text("idempotency_key"),
}, (table) => ({
  projectIdx: index("idx_po_project").on(table.projectName),
  statusIdx: index("idx_po_status").on(table.status),
}));
export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

// ===================== EPC WORKFLOW: PO REVIEW ASSIGNMENTS =====================

export const poReviewAssignments = pgTable("po_review_assignments", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  reviewerUserId: integer("reviewer_user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  reviewerRole: text("reviewer_role").notNull(),
  decision: poReviewDecisionEnum("decision").notNull().default("pending"),
  decidedAt: timestamp("decided_at"),
  notes: text("notes"),
  // B2 (audit closeout): manual delegation columns. When a reviewer cannot
  // respond, either they themselves or an admin can reassign the approval
  // via POST /api/po/:poId/delegate. The original assignment row is marked
  // by setting delegatedToUserId to the new reviewer's user_id (the self-FK
  // chain lets us reconstruct the full delegation history for audit). An
  // active assignment is one where decision='pending' AND delegatedToUserId
  // IS NULL.
  delegatedToUserId: integer("delegated_to_user_id").references(() => users.id, { onDelete: "set null" }),
  delegatedAt: timestamp("delegated_at"),
  delegationReason: text("delegation_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  poIdx: index("idx_po_review_po_id").on(table.purchaseOrderId),
  reviewerIdx: index("idx_po_review_reviewer").on(table.reviewerUserId),
}));
export const insertPoReviewAssignmentSchema = createInsertSchema(poReviewAssignments).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertPoReviewAssignment = z.infer<typeof insertPoReviewAssignmentSchema>;
export type PoReviewAssignment = typeof poReviewAssignments.$inferSelect;

// ===================== EPC WORKFLOW: PAYMENT REQUESTS =====================

export const paymentRequests = pgTable("payment_requests", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrders.id),
  invoiceCaptureId: integer("invoice_capture_id").references(() => invoiceCaptures.id),
  counterpartyId: integer("counterparty_id").references(() => counterparties.id),
  procurementItemId: integer("procurement_item_id").references(() => procurementItems.id),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  dueDate: date("due_date"),
  status: paymentRequestStatusEnum("status").notNull().default("new"),
  submittedByUserId: integer("submitted_by_user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  cutoffDate: date("cutoff_date"),
  evidenceEvaluationId: integer("evidence_evaluation_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("idx_payment_req_project").on(table.projectId),
  statusIdx: index("idx_payment_req_status").on(table.status),
  cutoffIdx: index("idx_payment_req_cutoff").on(table.cutoffDate),
}));
export const insertPaymentRequestSchema = createInsertSchema(paymentRequests).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertPaymentRequest = z.infer<typeof insertPaymentRequestSchema>;
export type PaymentRequest = typeof paymentRequests.$inferSelect;

// ===================== EPC WORKFLOW: PAYMENT BATCHES =====================

export const paymentBatches = pgTable("payment_batches", {
  id: serial("id").primaryKey(),
  batchNumber: text("batch_number").notNull().unique(),
  cutoffDate: date("cutoff_date").notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  itemCount: integer("item_count").notNull().default(0),
  status: paymentBatchStatusEnum("status").notNull().default("preparing"),
  preparedByUserId: integer("prepared_by_user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  releasedByUserId: integer("released_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvalId: integer("approval_id"),
  approvedAt: timestamp("approved_at"),
  releasedAt: timestamp("released_at"),
  confirmedAt: timestamp("confirmed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("idx_payment_batch_status").on(table.status),
  cutoffIdx: index("idx_payment_batch_cutoff").on(table.cutoffDate),
}));
export const insertPaymentBatchSchema = createInsertSchema(paymentBatches).omit({ id: true, createdAt: true, updatedAt: true } as any);
export type InsertPaymentBatch = z.infer<typeof insertPaymentBatchSchema>;
export type PaymentBatch = typeof paymentBatches.$inferSelect;

// ===================== EPC WORKFLOW: PAYMENT BATCH ITEMS =====================

export const paymentBatchItems = pgTable("payment_batch_items", {
  id: serial("id").primaryKey(),
  paymentBatchId: integer("payment_batch_id").notNull().references(() => paymentBatches.id, { onDelete: "cascade" }),
  paymentRequestId: integer("payment_request_id").notNull().references(() => paymentRequests.id),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  batchIdx: index("idx_batch_item_batch").on(table.paymentBatchId),
  requestIdx: index("idx_batch_item_request").on(table.paymentRequestId),
}));
export type PaymentBatchItem = typeof paymentBatchItems.$inferSelect;

// ===================== EPC WORKFLOW: PROOF OF PAYMENT =====================

export const proofOfPayment = pgTable("proof_of_payment", {
  id: serial("id").primaryKey(),
  paymentRequestId: integer("payment_request_id").references(() => paymentRequests.id),
  paymentBatchId: integer("payment_batch_id").references(() => paymentBatches.id),
  bankReference: text("bank_reference"),
  documentDriveId: text("document_drive_id"),
  documentItemId: text("document_item_id"),
  documentUrl: text("document_url"),
  uploadedByUserId: integer("uploaded_by_user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  requestIdx: index("idx_pop_request").on(table.paymentRequestId),
  batchIdx: index("idx_pop_batch").on(table.paymentBatchId),
}));
export const insertProofOfPaymentSchema = createInsertSchema(proofOfPayment).omit({ id: true, createdAt: true } as any);
export type InsertProofOfPayment = z.infer<typeof insertProofOfPaymentSchema>;
export type ProofOfPayment = typeof proofOfPayment.$inferSelect;

// ===================== COS PERIOD LOCKS (B5 audit closeout) =====================
//
// One row per month that has been locked for COS edits. The presence of a
// row (with unlocked_at IS NULL) means "this month is locked — only COO or
// CFO can modify cost-line data dated in this month". Unlock is logged by
// setting unlocked_at, unlocked_by_user_id and unlock_reason — the row is
// never deleted so the audit trail survives re-lock cycles.
//
// Lock lifecycle:
//   1. Auto-lock: the scheduled job in server/bootstrap/cos-period-lock-
//      scheduler.ts runs daily and inserts a row with auto_locked=true on
//      the 3rd business day of the following month.
//   2. Manual lock: POST /api/cos-periods/:yyyy-mm/lock inserts a row with
//      auto_locked=false.
//   3. Unlock: POST /api/cos-periods/:yyyy-mm/unlock sets unlocked_at,
//      unlocked_by_user_id and unlock_reason. The lock check treats this
//      as "unlocked".
//   4. Re-lock: another POST /lock (or the next daily job) creates a new
//      row for the same period_month.

export const cosPeriodLocks = pgTable("cos_period_locks", {
  id: serial("id").primaryKey(),
  periodMonth: date("period_month").notNull(),      // First-of-month (e.g. 2026-03-01)
  lockedAt: timestamp("locked_at").notNull().defaultNow(),
  lockedByUserId: integer("locked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  autoLocked: boolean("auto_locked").notNull().default(false),
  // Unlock fields — soft-delete. When unlocked_at is set, this row is
  // considered "no longer active".
  unlockedAt: timestamp("unlocked_at"),
  unlockedByUserId: integer("unlocked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  unlockReason: text("unlock_reason"),
  notes: text("notes"),
}, (table) => ({
  periodIdx: index("idx_cos_period_locks_period").on(table.periodMonth),
  // Partial index for the hot "is this period currently locked?" query.
  activeLockIdx: index("idx_cos_period_locks_active")
    .on(table.periodMonth)
    .where(sql`${table.unlockedAt} IS NULL`),
}));

export const insertCosPeriodLockSchema = createInsertSchema(cosPeriodLocks).omit({ id: true, lockedAt: true } as any);
export type InsertCosPeriodLock = z.infer<typeof insertCosPeriodLockSchema>;
export type CosPeriodLock = typeof cosPeriodLocks.$inferSelect;
