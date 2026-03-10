import { db, getDbMode } from "./db";
import { safeLegacyQuery, safeLegacyWrite } from "./legacy-table-guard";
import { UsersRepository } from "./repositories/users-repository";
import { eq, desc, and, or, gte, lte, isNotNull, isNull, sql, inArray, count, not, ilike } from "drizzle-orm";
import {
  users, projects, expenses, revenues, tasks, budgets, uploadMetadata, refreshLogs,
  projectInfo, normalizedCostLines, normalizedRevenueLines, workItems,
  cashflowPoints, financeRevenueMonthly, financeCosMonthly,
  cashflowPlanningOverrides, projectPlanOverrides, revenueTrackingOverrides,
  expenditureOverrides, financeRevenueOverrides, financeCosOverrides,
  workingPlanScenario, workingPlanTaskOverride, projectPlanDependency,
  workingPlanDependencyOverride, scheduleChangeNotice,
  projectRevenueSummary, homeNotes,
  projectEditableFields, cashflowWeeklyManual, cashflowBalanceHistory, opexBudgetMonthly, trackerMonthlyManual,
  scenarios, dateOverrides,
  operationalTasks, taskComments, taskChecklists, taskChecklistItems, taskAttachments, taskActivityLog, writebackMappings, writebackAuditLog,
  type Scenario, type InsertScenario,
  type DateOverride, type InsertDateOverride,
  type User, type InsertUser,
  type Project, type InsertProject,
  type Expense, type InsertExpense,
  type Revenue, type InsertRevenue,
  type Task, type InsertTask,
  type Budget, type InsertBudget,
  type UploadMetadata, type InsertUploadMetadata,
  type RefreshLog, type InsertRefreshLog,
  type ProjectInfo, type InsertProjectInfo,
  type ProgramExpense, type InsertProgramExpense,
  type ProgramInflows, type InsertProgramInflows,
  type ProjectPlan, type InsertProjectPlan,
  type CashflowPoint, type InsertCashflowPoint,
  type FinanceRevenueMonthly, type InsertFinanceRevenueMonthly,
  type FinanceCosMonthly, type InsertFinanceCosMonthly,
  type CashflowPlanningOverride, type InsertCashflowPlanningOverride,
  type ProjectPlanOverride, type InsertProjectPlanOverride,
  type RevenueTrackingOverride, type InsertRevenueTrackingOverride,
  type ExpenditureOverride, type InsertExpenditureOverride,
  type FinanceRevenueOverride, type InsertFinanceRevenueOverride,
  type FinanceCosOverride, type InsertFinanceCosOverride,
  type WorkingPlanScenario, type InsertWorkingPlanScenario,
  type WorkingPlanTaskOverride, type InsertWorkingPlanTaskOverride,
  type ProjectPlanDependency, type InsertProjectPlanDependency,
  type WorkingPlanDependencyOverride, type InsertWorkingPlanDependencyOverride,
  type ScheduleChangeNotice, type InsertScheduleChangeNotice,
  type ProjectRevenueSummary, type InsertProjectRevenueSummary,
  type HomeNotes, type InsertHomeNotes,
  type ProjectEditableFields, type InsertProjectEditableFields,
  type CashflowWeeklyManual, type InsertCashflowWeeklyManual,
  type CashflowBalanceHistory, type InsertCashflowBalanceHistory,
  type OpexBudgetMonthly, type InsertOpexBudgetMonthly,
  opexWeeklyManual,
  type OpexWeeklyManual, type InsertOpexWeeklyManual,
  availablePaymentOverrides, availablePaymentHistory,
  type AvailablePaymentOverride, type InsertAvailablePaymentOverride,
  type AvailablePaymentHistory, type InsertAvailablePaymentHistory,
  type TrackerMonthlyManual, type InsertTrackerMonthlyManual,
  type OperationalTask, type InsertOperationalTask,
  type TaskComment, type InsertTaskComment,
  type TaskChecklist, type InsertTaskChecklist,
  type TaskChecklistItem, type InsertTaskChecklistItem,
  type TaskAttachment, type InsertTaskAttachment,
  type TaskActivityLog, type InsertTaskActivityLog,
  type WritebackMapping, type InsertWritebackMapping,
  type WritebackAuditLog, type InsertWritebackAuditLog,
  milestoneTaskLinks,
  expenseTaskLinks,
  type ExpenseTaskLink, type InsertExpenseTaskLink,
  type MilestoneTaskLink, type InsertMilestoneTaskLink,
  keyDateMappings,
  type KeyDateMapping, type InsertKeyDateMapping,
  mytoolTasks, mytoolTimeblocks, mytoolDailyReviews, mytoolCompanyPriorities, mytoolUserPreferences, mytoolSettings,
  mytoolEmailLinks, mytoolDodTemplates,
  errorLogs, supportTickets,
  type MytoolTask, type InsertMytoolTask, type MytoolTimeblock, type InsertMytoolTimeblock,
  type MytoolDailyReview, type InsertMytoolDailyReview, type MytoolCompanyPriority, type InsertMytoolCompanyPriority,
  type MytoolUserPreferences, type InsertMytoolUserPreferences,
  type MytoolEmailLink, type InsertMytoolEmailLink,
  type MytoolDodTemplate, type InsertMytoolDodTemplate,
  type ErrorLog, type InsertErrorLog, type SupportTicket, type InsertSupportTicket,
  spSettings, spFiles, importRuns, changeLedger, snapshots, snapshotMetrics,
  type SpSettings, type InsertSpSettings,
  type SpFile, type InsertSpFile,
  type ImportRun, type InsertImportRun,
  type ChangeLedger, type InsertChangeLedger,
  type Snapshot, type InsertSnapshot,
  type SnapshotMetric, type InsertSnapshotMetric,
} from "@shared/schema";

export interface IStorage {
  // Transaction support
  transaction<T>(callback: (txStorage: IStorage) => Promise<T>): Promise<T>;
  
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Projects (legacy)
  getAllProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  getProjectByCode(code: string): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<boolean>;
  
  // Expenses (legacy)
  getAllExpenses(): Promise<Expense[]>;
  getExpensesByProject(projectId: number): Promise<Expense[]>;
  createExpense(expense: InsertExpense): Promise<Expense>;
  createManyExpenses(expenses: InsertExpense[]): Promise<Expense[]>;
  deleteExpensesByProject(projectId: number): Promise<void>;
  
  // Revenues (legacy)
  getAllRevenues(): Promise<Revenue[]>;
  getRevenuesByProject(projectId: number): Promise<Revenue[]>;
  createRevenue(revenue: InsertRevenue): Promise<Revenue>;
  createManyRevenues(revenues: InsertRevenue[]): Promise<Revenue[]>;
  deleteRevenuesByProject(projectId: number): Promise<void>;
  
  // Tasks (legacy)
  getAllTasks(): Promise<Task[]>;
  getTasksByProject(projectId: number): Promise<Task[]>;
  createTask(task: InsertTask): Promise<Task>;
  createManyTasks(tasks: InsertTask[]): Promise<Task[]>;
  deleteTasksByProject(projectId: number): Promise<void>;
  
  // Budgets
  getAllBudgets(): Promise<Budget[]>;
  getBudgetsByProject(projectId: number): Promise<Budget[]>;
  createBudget(budget: InsertBudget): Promise<Budget>;
  deleteBudget(id: number): Promise<boolean>;
  
  // Upload Metadata
  getAllUploads(): Promise<UploadMetadata[]>;
  createUpload(upload: InsertUploadMetadata): Promise<UploadMetadata>;
  
  // Refresh Logs
  getLatestRefresh(): Promise<RefreshLog | undefined>;
  createRefreshLog(log: InsertRefreshLog): Promise<RefreshLog>;

  // Project Info (new)
  getProjectInfo(projectName: string): Promise<ProjectInfo | undefined>;
  getProjectInfoById(id: number): Promise<ProjectInfo | undefined>;
  getAllProjectInfo(): Promise<ProjectInfo[]>;
  upsertProjectInfo(info: InsertProjectInfo): Promise<ProjectInfo>;
  updateProjectInfoById(id: number, fields: Partial<InsertProjectInfo>): Promise<ProjectInfo | undefined>;
  deleteProjectInfo(projectName: string): Promise<void>;
  markProjectsActive(activeNames: string[]): Promise<void>;
  getProjectCounts(): Promise<{ active: number; historical: number; total: number }>;

  // Program Expense (new)
  getAllProgramExpenses(): Promise<ProgramExpense[]>;
  getProgramExpensesByProject(projectName: string): Promise<ProgramExpense[]>;
  createManyProgramExpenses(expenses: InsertProgramExpense[]): Promise<ProgramExpense[]>;
  deleteProgramExpensesByProject(projectName: string): Promise<void>;
  updateProgramExpenseFields(id: number, fields: Record<string, any>): Promise<ProgramExpense | undefined>;

  // Program Inflows (new)
  getAllProgramInflows(): Promise<ProgramInflows[]>;
  getProgramInflowsByProject(projectName: string): Promise<ProgramInflows[]>;
  createManyProgramInflows(inflows: InsertProgramInflows[]): Promise<ProgramInflows[]>;
  deleteProgramInflowsByProject(projectName: string): Promise<void>;

  // Project Plan (new)
  getAllProjectPlans(): Promise<ProjectPlan[]>;
  getProjectPlansByProject(projectName: string): Promise<ProjectPlan[]>;
  createManyProjectPlans(plans: InsertProjectPlan[]): Promise<ProjectPlan[]>;
  deleteProjectPlansByProject(projectName: string): Promise<void>;

  // Cashflow Points (new)
  getAllCashflowPoints(): Promise<CashflowPoint[]>;
  getCashflowPointsByProject(projectName: string): Promise<CashflowPoint[]>;
  createManyCashflowPoints(points: InsertCashflowPoint[]): Promise<CashflowPoint[]>;
  deleteCashflowPointsByProject(projectName: string): Promise<void>;

  // Finance Revenue Monthly (new)
  getAllFinanceRevenueMonthly(): Promise<FinanceRevenueMonthly[]>;
  getFinanceRevenueMonthlyByProject(projectName: string): Promise<FinanceRevenueMonthly[]>;
  createManyFinanceRevenueMonthly(data: InsertFinanceRevenueMonthly[]): Promise<FinanceRevenueMonthly[]>;
  deleteFinanceRevenueMonthlyByProject(projectName: string): Promise<void>;

  // Finance COS Monthly (new)
  getAllFinanceCosMonthly(): Promise<FinanceCosMonthly[]>;
  getFinanceCosMonthlyByProject(projectName: string): Promise<FinanceCosMonthly[]>;
  createManyFinanceCosMonthly(data: InsertFinanceCosMonthly[]): Promise<FinanceCosMonthly[]>;
  deleteFinanceCosMonthlyByProject(projectName: string): Promise<void>;

  // Cashflow Planning Overrides (user edits)
  getAllPlanningOverrides(): Promise<CashflowPlanningOverride[]>;
  getPlanningOverridesByProject(projectName: string): Promise<CashflowPlanningOverride[]>;
  upsertPlanningOverride(override: InsertCashflowPlanningOverride): Promise<CashflowPlanningOverride>;
  upsertManyPlanningOverrides(overrides: InsertCashflowPlanningOverride[]): Promise<CashflowPlanningOverride[]>;
  deletePlanningOverridesByProject(projectName: string): Promise<void>;

  // Project Plan Overrides (user edits for tasks/milestones)
  getProjectPlanOverridesByProject(projectName: string): Promise<ProjectPlanOverride[]>;
  getAllProjectPlanOverrides(): Promise<ProjectPlanOverride[]>;
  upsertProjectPlanOverride(override: InsertProjectPlanOverride): Promise<ProjectPlanOverride>;
  upsertManyProjectPlanOverrides(overrides: InsertProjectPlanOverride[]): Promise<ProjectPlanOverride[]>;
  deleteProjectPlanOverridesByProject(projectName: string): Promise<void>;

  // Revenue Tracking Overrides (user edits for revenue milestones)
  getRevenueTrackingOverridesByProject(projectName: string): Promise<RevenueTrackingOverride[]>;
  upsertRevenueTrackingOverride(override: InsertRevenueTrackingOverride): Promise<RevenueTrackingOverride>;
  upsertManyRevenueTrackingOverrides(overrides: InsertRevenueTrackingOverride[]): Promise<RevenueTrackingOverride[]>;
  deleteRevenueTrackingOverridesByProject(projectName: string): Promise<void>;

  // Expenditure Overrides (user edits for expenses)
  getExpenditureOverridesByProject(projectName: string): Promise<ExpenditureOverride[]>;
  getAllExpenditureOverrides(): Promise<ExpenditureOverride[]>;
  upsertExpenditureOverride(override: InsertExpenditureOverride): Promise<ExpenditureOverride>;
  upsertManyExpenditureOverrides(overrides: InsertExpenditureOverride[]): Promise<ExpenditureOverride[]>;
  deleteExpenditureOverridesByProject(projectName: string): Promise<void>;

  // Finance Revenue Overrides (user edits for monthly revenue)
  getFinanceRevenueOverridesByProject(projectName: string): Promise<FinanceRevenueOverride[]>;
  upsertFinanceRevenueOverride(override: InsertFinanceRevenueOverride): Promise<FinanceRevenueOverride>;
  upsertManyFinanceRevenueOverrides(overrides: InsertFinanceRevenueOverride[]): Promise<FinanceRevenueOverride[]>;
  deleteFinanceRevenueOverridesByProject(projectName: string): Promise<void>;

  // Finance COS Overrides (user edits for monthly COS)
  getFinanceCosOverridesByProject(projectName: string): Promise<FinanceCosOverride[]>;
  upsertFinanceCosOverride(override: InsertFinanceCosOverride): Promise<FinanceCosOverride>;
  upsertManyFinanceCosOverrides(overrides: InsertFinanceCosOverride[]): Promise<FinanceCosOverride[]>;
  deleteFinanceCosOverridesByProject(projectName: string): Promise<void>;

  // Working Plan Scenarios
  getActiveScenario(projectName: string): Promise<WorkingPlanScenario | undefined>;
  getOrCreateActiveScenario(projectName: string): Promise<WorkingPlanScenario>;
  resetScenario(scenarioId: number): Promise<void>;

  // Working Plan Task Overrides
  getTaskOverridesByScenario(scenarioId: number): Promise<WorkingPlanTaskOverride[]>;
  createTaskOverride(override: InsertWorkingPlanTaskOverride): Promise<WorkingPlanTaskOverride>;
  updateTaskOverride(id: number, data: Partial<InsertWorkingPlanTaskOverride>): Promise<WorkingPlanTaskOverride | undefined>;
  softDeleteTaskOverride(id: number): Promise<void>;

  // Project Plan Dependencies
  getDependenciesByProject(projectName: string): Promise<ProjectPlanDependency[]>;
  createDependency(dep: InsertProjectPlanDependency): Promise<ProjectPlanDependency>;
  deleteDependency(id: number): Promise<void>;
  deleteDependenciesByProject(projectName: string): Promise<void>;

  // Working Plan Dependency Overrides
  getDependencyOverridesByScenario(scenarioId: number): Promise<WorkingPlanDependencyOverride[]>;
  createDependencyOverride(override: InsertWorkingPlanDependencyOverride): Promise<WorkingPlanDependencyOverride>;
  softDeleteDependencyOverride(id: number): Promise<void>;

  // Schedule Change Notices
  getChangeNoticesByProject(projectName: string): Promise<ScheduleChangeNotice[]>;
  createChangeNotice(notice: InsertScheduleChangeNotice): Promise<ScheduleChangeNotice>;
  updateChangeNotice(id: number, data: Partial<InsertScheduleChangeNotice>): Promise<ScheduleChangeNotice | undefined>;

  // Project Revenue Summary
  getAllProjectRevenueSummaries(): Promise<ProjectRevenueSummary[]>;
  getProjectRevenueSummary(projectName: string): Promise<ProjectRevenueSummary | undefined>;

  // Milestone Task Links
  getMilestoneTaskLinks(projectName: string): Promise<MilestoneTaskLink[]>;
  getAllMilestoneTaskLinks(): Promise<MilestoneTaskLink[]>;
  upsertMilestoneTaskLink(projectName: string, milestoneRowNumber: number, taskId: number): Promise<MilestoneTaskLink>;
  deleteMilestoneTaskLink(projectName: string, milestoneRowNumber: number): Promise<void>;
  updateMilestoneDateOverride(projectName: string, milestoneRowNumber: number, dateOverride: string | null, reason: string | null): Promise<void>;

  // Expense Task Links
  getExpenseTaskLinks(projectName: string): Promise<ExpenseTaskLink[]>;
  getAllExpenseTaskLinks(): Promise<ExpenseTaskLink[]>;
  upsertExpenseTaskLink(projectName: string, expenseId: number, taskId: number, createdBy?: number): Promise<ExpenseTaskLink>;
  deleteExpenseTaskLink(projectName: string, expenseId: number): Promise<void>;
  updateExpenseTaskLinkDateOverride(projectName: string, expenseId: number, dateOverride: string | null, reason: string | null): Promise<void>;

  // Manual Expense Rows
  createManualExpense(data: InsertProgramExpense): Promise<ProgramExpense>;

  // Home Notes
  getHomeNotes(): Promise<HomeNotes | undefined>;
  saveHomeNotes(notes: InsertHomeNotes): Promise<HomeNotes>;

  // Project Editable Fields
  getProjectEditableFields(projectName: string): Promise<ProjectEditableFields | undefined>;
  getAllProjectEditableFields(): Promise<ProjectEditableFields[]>;
  upsertProjectEditableFields(data: InsertProjectEditableFields): Promise<ProjectEditableFields>;

  // Cashflow Weekly Manual (opening balance)
  getAllCashflowWeeklyManual(): Promise<CashflowWeeklyManual[]>;
  upsertCashflowWeeklyManual(weekStartDate: string, openingBalance: string): Promise<CashflowWeeklyManual>;

  deleteCashflowWeeklyManual(weekStartDate: string): Promise<void>;
  deleteAllCashflowWeeklyManualAfter(weekStartDate: string): Promise<string[]>;

  // Cashflow Balance History
  getBalanceHistory(weekStartDate: string): Promise<CashflowBalanceHistory[]>;
  getAllBalanceHistory(): Promise<CashflowBalanceHistory[]>;
  addBalanceHistory(entry: InsertCashflowBalanceHistory): Promise<CashflowBalanceHistory>;

  // OPEX Budget Monthly
  getAllOpexBudgetMonthly(): Promise<OpexBudgetMonthly[]>;
  upsertOpexBudgetMonthly(monthKey: string, amount: string): Promise<OpexBudgetMonthly>;

  // OPEX Weekly Manual
  getAllOpexWeeklyManual(): Promise<OpexWeeklyManual[]>;
  upsertOpexWeeklyManual(weekStartDate: string, opexAmount: string): Promise<OpexWeeklyManual>;
  deleteOpexWeeklyManual(weekStartDate: string): Promise<void>;

  // Available Payment Overrides
  getAllAvailablePaymentOverrides(): Promise<AvailablePaymentOverride[]>;
  upsertAvailablePaymentOverride(weekStartDate: string, overrideValue: string, reason: string | null, updatedBy: string | null): Promise<AvailablePaymentOverride>;
  deleteAvailablePaymentOverride(weekStartDate: string): Promise<void>;
  getAvailablePaymentHistory(weekStartDate: string): Promise<AvailablePaymentHistory[]>;
  addAvailablePaymentHistory(entry: InsertAvailablePaymentHistory): Promise<AvailablePaymentHistory>;

  // Tracker Monthly Manual (REV/COS)
  getTrackerMonthlyManual(trackerType: string): Promise<TrackerMonthlyManual[]>;
  upsertTrackerMonthlyManual(data: InsertTrackerMonthlyManual): Promise<TrackerMonthlyManual>;

  // Scenarios
  getAllScenarios(): Promise<Scenario[]>;
  getScenario(id: number): Promise<Scenario | undefined>;
  createScenario(scenario: InsertScenario): Promise<Scenario>;
  deleteScenario(id: number): Promise<void>;
  duplicateScenario(id: number, newName: string): Promise<Scenario>;

  // Date Overrides
  getDateOverridesByScenario(scenarioId: number): Promise<DateOverride[]>;
  createDateOverride(override: InsertDateOverride): Promise<DateOverride>;
  deleteDateOverride(id: number): Promise<void>;
  clearDateOverrides(scenarioId: number): Promise<void>;

  // Operational Tasks
  getAllOperationalTasks(): Promise<OperationalTask[]>;
  getOperationalTasksByProject(projectName: string): Promise<OperationalTask[]>;
  getOperationalTask(id: number): Promise<OperationalTask | undefined>;
  createOperationalTask(data: InsertOperationalTask): Promise<OperationalTask>;
  updateOperationalTask(id: number, data: Partial<InsertOperationalTask>): Promise<OperationalTask>;
  deleteOperationalTask(id: number): Promise<void>;

  // Task Comments
  getTaskComments(taskId: number): Promise<TaskComment[]>;
  createTaskComment(data: InsertTaskComment): Promise<TaskComment>;
  deleteTaskComment(id: number): Promise<void>;

  // Task Checklists
  getTaskChecklists(taskId: number): Promise<TaskChecklist[]>;
  createTaskChecklist(data: InsertTaskChecklist): Promise<TaskChecklist>;
  deleteTaskChecklist(id: number): Promise<void>;

  // Task Checklist Items
  getChecklistItems(checklistId: number): Promise<TaskChecklistItem[]>;
  createChecklistItem(data: InsertTaskChecklistItem): Promise<TaskChecklistItem>;
  updateChecklistItem(id: number, data: Partial<InsertTaskChecklistItem>): Promise<TaskChecklistItem>;
  deleteChecklistItem(id: number): Promise<void>;

  // Task Attachments
  getTaskAttachments(taskId: number): Promise<TaskAttachment[]>;
  createTaskAttachment(data: InsertTaskAttachment): Promise<TaskAttachment>;
  deleteTaskAttachment(id: number): Promise<void>;

  // Task Activity Log
  getTaskActivityLog(taskId: number): Promise<TaskActivityLog[]>;
  createTaskActivityLog(data: InsertTaskActivityLog): Promise<TaskActivityLog>;

  // Writeback Mappings
  getAllWritebackMappings(): Promise<WritebackMapping[]>;
  getWritebackMapping(id: number): Promise<WritebackMapping | undefined>;
  createWritebackMapping(data: InsertWritebackMapping): Promise<WritebackMapping>;
  updateWritebackMapping(id: number, data: Partial<InsertWritebackMapping>): Promise<WritebackMapping>;
  deleteWritebackMapping(id: number): Promise<void>;

  // Writeback Audit Log
  getWritebackAuditLogs(mappingId?: number): Promise<WritebackAuditLog[]>;
  createWritebackAuditLog(data: InsertWritebackAuditLog): Promise<WritebackAuditLog>;
  updateWritebackAuditLog(id: number, data: Partial<InsertWritebackAuditLog>): Promise<WritebackAuditLog>;

  // Admin Operations
  clearAllData(): Promise<{ tablesCleared: string[]; filesDeleted: number }>;

  // My Tool - Tasks
  getMytoolTasks(ownerUserId: number): Promise<MytoolTask[]>;
  getMytoolTasksByDate(ownerUserId: number, date: string): Promise<MytoolTask[]>;
  getMytoolTask(id: number): Promise<MytoolTask | undefined>;
  createMytoolTask(data: InsertMytoolTask): Promise<MytoolTask>;
  updateMytoolTask(id: number, data: Partial<InsertMytoolTask>): Promise<MytoolTask>;
  deleteMytoolTask(id: number): Promise<void>;

  // My Tool - Timeblocks
  getMytoolTimeblocks(ownerUserId: number, date: string): Promise<MytoolTimeblock[]>;
  createMytoolTimeblock(data: InsertMytoolTimeblock): Promise<MytoolTimeblock>;
  updateMytoolTimeblock(id: number, data: Partial<InsertMytoolTimeblock>): Promise<MytoolTimeblock>;
  deleteMytoolTimeblock(id: number): Promise<void>;

  // My Tool - Daily Reviews
  getMytoolDailyReview(ownerUserId: number, date: string): Promise<MytoolDailyReview | undefined>;
  upsertMytoolDailyReview(data: InsertMytoolDailyReview): Promise<MytoolDailyReview>;

  // My Tool - Company Priorities
  getMytoolCompanyPriorities(horizon?: string): Promise<MytoolCompanyPriority[]>;
  createMytoolCompanyPriority(data: InsertMytoolCompanyPriority): Promise<MytoolCompanyPriority>;
  updateMytoolCompanyPriority(id: number, data: Partial<InsertMytoolCompanyPriority>): Promise<MytoolCompanyPriority>;
  deleteMytoolCompanyPriority(id: number): Promise<void>;

  // My Tool - Email Links
  getEmailLinksByTask(taskId: number): Promise<MytoolEmailLink[]>;
  getEmailLinksByOperationalTask(taskId: number): Promise<MytoolEmailLink[]>;
  getEmailLinksByPriority(priorityId: number): Promise<MytoolEmailLink[]>;
  createEmailLink(data: InsertMytoolEmailLink): Promise<MytoolEmailLink>;
  deleteEmailLink(id: number): Promise<void>;

  // My Tool - DoD Templates
  getMytoolDodTemplates(): Promise<MytoolDodTemplate[]>;
  createMytoolDodTemplate(data: InsertMytoolDodTemplate): Promise<MytoolDodTemplate>;
  deleteMytoolDodTemplate(id: number): Promise<void>;

  // My Tool - User Preferences
  getMytoolUserPreferences(ownerUserId: number): Promise<MytoolUserPreferences | undefined>;
  upsertMytoolUserPreferences(data: InsertMytoolUserPreferences): Promise<MytoolUserPreferences>;

  // My Tool - Settings
  getMytoolSettings(): Promise<any>;
  updateMytoolSettings(data: any): Promise<any>;

  // Error Logs
  createErrorLog(log: InsertErrorLog): Promise<ErrorLog>;

  // Support Tickets
  createSupportTicket(ticket: InsertSupportTicket): Promise<SupportTicket>;
  getSupportTickets(): Promise<SupportTicket[]>;

  // SharePoint Settings
  getSpSettings(): Promise<SpSettings | undefined>;
  upsertSpSettings(data: InsertSpSettings): Promise<SpSettings>;

  // SharePoint Files
  getAllSpFiles(): Promise<SpFile[]>;
  getSpFile(id: number): Promise<SpFile | undefined>;
  getSpFileByItemId(siteId: string, driveId: string, itemId: string): Promise<SpFile | undefined>;
  upsertSpFile(data: InsertSpFile): Promise<SpFile>;
  deactivateSpFile(id: number): Promise<void>;

  // Import Runs
  getAllImportRuns(): Promise<ImportRun[]>;
  getImportRun(id: number): Promise<ImportRun | undefined>;
  createImportRun(data: InsertImportRun): Promise<ImportRun>;
  updateImportRun(id: number, data: Partial<ImportRun>): Promise<ImportRun>;

  // Change Ledger
  getAllChangeLedger(filters?: { runId?: number; fileId?: number; eventType?: string; importStatus?: string }): Promise<ChangeLedger[]>;
  getChangeLedgerEntry(id: number): Promise<ChangeLedger | undefined>;
  createChangeLedgerEntry(data: InsertChangeLedger): Promise<ChangeLedger>;
  updateChangeLedgerEntry(id: number, data: Partial<ChangeLedger>): Promise<ChangeLedger>;
  getPendingLedgerEntries(): Promise<ChangeLedger[]>;
  getFailedLedgerEntries(): Promise<ChangeLedger[]>;

  // Snapshots
  getAllSnapshots(fileId?: number): Promise<Snapshot[]>;
  getSnapshot(id: number): Promise<Snapshot | undefined>;
  getLatestSnapshotForFile(fileId: number): Promise<Snapshot | undefined>;
  createSnapshot(data: InsertSnapshot): Promise<Snapshot>;

  // Snapshot Metrics
  getSnapshotMetrics(snapshotId: number): Promise<SnapshotMetric[]>;
  createSnapshotMetric(data: InsertSnapshotMetric): Promise<SnapshotMetric>;
  createManySnapshotMetrics(data: InsertSnapshotMetric[]): Promise<SnapshotMetric[]>;

}

export class DatabaseStorage implements IStorage {
  private _dbInstance?: typeof db;
  private readonly usersRepository: UsersRepository;
  
  // Getter that always returns the current db (handles dynamic switching)
  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }
  
  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
    this.usersRepository = new UsersRepository(this.dbInstance);
  }
  
  // Transaction support
  // Note: SQLite with better-sqlite3 uses synchronous transactions which can't return promises
  // For SQLite, we execute operations directly (they're atomic per statement)
  // For Postgres, we use proper async transactions
  async transaction<T>(callback: (txStorage: IStorage) => Promise<T>): Promise<T> {
    const mode = getDbMode();
    
    if (mode === 'sqlite') {
      // SQLite: just execute the callback directly
      // Individual statements are already atomic in SQLite
      return await callback(this);
    }
    
    // Postgres: use proper async transaction
    return await this.dbInstance.transaction(async (tx: any) => {
      const txStorage = new DatabaseStorage(tx as typeof db);
      return await callback(txStorage);
    });
  }
  
  // Users
  async getUser(id: number): Promise<User | undefined> {
    return this.usersRepository.getById(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return this.usersRepository.getByEmail(email);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return this.usersRepository.getByUsername(username);
  }

  async createUser(user: InsertUser): Promise<User> {
    return this.usersRepository.create(user);
  }

  // Projects (legacy)
  async getAllProjects(): Promise<Project[]> {
    return this.dbInstance.select().from(projects).orderBy(desc(projects.lastUpdated));
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [project] = await this.dbInstance.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async getProjectByCode(code: string): Promise<Project | undefined> {
    const [project] = await this.dbInstance.select().from(projects).where(eq(projects.code, code));
    return project;
  }

  async createProject(project: InsertProject): Promise<Project> {
    // Explicitly provide timestamp for SQLite compatibility
    const [created] = await this.dbInstance.insert(projects).values({
      ...project,
      lastUpdated: new Date(),
    }).returning();
    return created;
  }

  async updateProject(id: number, project: Partial<InsertProject>): Promise<Project | undefined> {
    const [updated] = await this.dbInstance
      .update(projects)
      .set({ ...project, lastUpdated: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updated;
  }

  async deleteProject(id: number): Promise<boolean> {
    const result = await this.dbInstance.delete(projects).where(eq(projects.id, id)).returning();
    return result.length > 0;
  }

  // Expenses (legacy)
  async getAllExpenses(): Promise<Expense[]> {
    return this.dbInstance.select().from(expenses).orderBy(desc(expenses.date));
  }

  async getExpensesByProject(projectId: number): Promise<Expense[]> {
    return this.dbInstance.select().from(expenses).where(eq(expenses.projectId, projectId)).orderBy(desc(expenses.date));
  }

  async createExpense(expense: InsertExpense): Promise<Expense> {
    // Explicitly provide timestamp for SQLite compatibility
    const [created] = await this.dbInstance.insert(expenses).values({
      ...expense,
      createdAt: new Date(),
    }).returning();
    return created;
  }

  async createManyExpenses(expenseList: InsertExpense[]): Promise<Expense[]> {
    if (expenseList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = expenseList.map(e => ({ ...e, createdAt: now }));
    return this.dbInstance.insert(expenses).values(withTimestamps).returning();
  }

  async deleteExpensesByProject(projectId: number): Promise<void> {
    await this.dbInstance.delete(expenses).where(eq(expenses.projectId, projectId));
  }

  // Revenues (legacy)
  async getAllRevenues(): Promise<Revenue[]> {
    return this.dbInstance.select().from(revenues).orderBy(desc(revenues.date));
  }

  async getRevenuesByProject(projectId: number): Promise<Revenue[]> {
    return this.dbInstance.select().from(revenues).where(eq(revenues.projectId, projectId)).orderBy(desc(revenues.date));
  }

  async createRevenue(revenue: InsertRevenue): Promise<Revenue> {
    // Explicitly provide timestamp for SQLite compatibility
    const [created] = await this.dbInstance.insert(revenues).values({
      ...revenue,
      createdAt: new Date(),
    }).returning();
    return created;
  }

  async createManyRevenues(revenueList: InsertRevenue[]): Promise<Revenue[]> {
    if (revenueList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = revenueList.map(r => ({ ...r, createdAt: now }));
    return this.dbInstance.insert(revenues).values(withTimestamps).returning();
  }

  async deleteRevenuesByProject(projectId: number): Promise<void> {
    await this.dbInstance.delete(revenues).where(eq(revenues.projectId, projectId));
  }

  // Tasks (legacy)
  async getAllTasks(): Promise<Task[]> {
    return safeLegacyQuery(() => this.dbInstance.select().from(tasks).orderBy(desc(tasks.createdAt)), []);
  }

  async getTasksByProject(projectId: number): Promise<Task[]> {
    return safeLegacyQuery(() => this.dbInstance.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(desc(tasks.createdAt)), []);
  }

  async createTask(task: InsertTask): Promise<Task> {
    const [created] = await this.dbInstance.insert(tasks).values({
      ...task,
      createdAt: new Date(),
    }).returning();
    return created;
  }

  async createManyTasks(taskList: InsertTask[]): Promise<Task[]> {
    if (taskList.length === 0) return [];
    const now = new Date();
    const withTimestamps = taskList.map(t => ({ ...t, createdAt: now }));
    return this.dbInstance.insert(tasks).values(withTimestamps).returning();
  }

  async deleteTasksByProject(projectId: number): Promise<void> {
    await this.dbInstance.delete(tasks).where(eq(tasks.projectId, projectId));
  }

  // Budgets
  async getAllBudgets(): Promise<Budget[]> {
    return this.dbInstance.select().from(budgets).orderBy(desc(budgets.createdAt));
  }

  async getBudgetsByProject(projectId: number): Promise<Budget[]> {
    return this.dbInstance.select().from(budgets).where(eq(budgets.projectId, projectId)).orderBy(desc(budgets.createdAt));
  }

  async createBudget(budget: InsertBudget): Promise<Budget> {
    // Explicitly provide timestamp for SQLite compatibility
    const [created] = await this.dbInstance.insert(budgets).values({
      ...budget,
      createdAt: new Date(),
    }).returning();
    return created;
  }

  async deleteBudget(id: number): Promise<boolean> {
    const result = await this.dbInstance.delete(budgets).where(eq(budgets.id, id)).returning();
    return result.length > 0;
  }

  // Upload Metadata
  async getAllUploads(): Promise<UploadMetadata[]> {
    return this.dbInstance.select().from(uploadMetadata).orderBy(desc(uploadMetadata.uploadedAt));
  }

  async createUpload(upload: InsertUploadMetadata): Promise<UploadMetadata> {
    // Explicitly provide timestamp for SQLite compatibility (doesn't have now() function)
    const [created] = await this.dbInstance.insert(uploadMetadata).values({
      ...upload,
      uploadedAt: new Date(),
    }).returning();
    return created;
  }

  // Refresh Logs
  async getLatestRefresh(): Promise<RefreshLog | undefined> {
    const [latest] = await this.dbInstance.select().from(refreshLogs).orderBy(desc(refreshLogs.refreshedAt)).limit(1);
    return latest;
  }

  async createRefreshLog(log: InsertRefreshLog): Promise<RefreshLog> {
    // Explicitly provide timestamp for SQLite compatibility (doesn't have now() function)
    const [created] = await this.dbInstance.insert(refreshLogs).values({
      ...log,
      refreshedAt: new Date(),
    }).returning();
    return created;
  }

  // Project Info (new)
  async getProjectInfo(projectName: string): Promise<ProjectInfo | undefined> {
    const [info] = await this.dbInstance.select().from(projectInfo).where(eq(projectInfo.projectName, projectName));
    return info;
  }

  async getProjectInfoById(id: number): Promise<ProjectInfo | undefined> {
    const [info] = await this.dbInstance.select().from(projectInfo).where(eq(projectInfo.id, id));
    return info;
  }

  async updateProjectInfoById(id: number, fields: Partial<InsertProjectInfo>): Promise<ProjectInfo | undefined> {
    const [updated] = await this.dbInstance
      .update(projectInfo)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(projectInfo.id, id))
      .returning();
    return updated;
  }

  async getAllProjectInfo(): Promise<ProjectInfo[]> {
    return this.dbInstance.select().from(projectInfo).orderBy(desc(projectInfo.updatedAt));
  }

  async upsertProjectInfo(info: InsertProjectInfo): Promise<ProjectInfo> {
    const existing = await this.getProjectInfo(info.projectName);
    if (existing) {
      const { executionEnabled, ...updateFields } = info as any;
      const [updated] = await this.dbInstance
        .update(projectInfo)
        .set({ ...updateFields, updatedAt: new Date() })
        .where(eq(projectInfo.projectName, info.projectName))
        .returning();
      return updated;
    }
    const [created] = await this.dbInstance.insert(projectInfo).values({
      ...info,
      executionEnabled: false,
      updatedAt: new Date(),
    }).returning();
    return created;
  }

  async deleteProjectInfo(projectName: string): Promise<void> {
    await this.dbInstance.delete(projectInfo).where(eq(projectInfo.projectName, projectName));
  }

  async markProjectsActive(activeNames: string[]): Promise<void> {
    if (activeNames.length === 0) return;
    await this.dbInstance
      .update(projectInfo)
      .set({ isActive: true, updatedAt: new Date() })
      .where(inArray(projectInfo.projectName, activeNames));
    await this.dbInstance
      .update(projectInfo)
      .set({ isActive: false })
      .where(not(inArray(projectInfo.projectName, activeNames)));
  }

  async getProjectCounts(): Promise<{ active: number; historical: number; total: number }> {
    const [activeResult] = await this.dbInstance
      .select({ count: count() })
      .from(projectInfo)
      .where(eq(projectInfo.isActive, true));
    const [totalResult] = await this.dbInstance
      .select({ count: count() })
      .from(projectInfo);
    const active = activeResult?.count || 0;
    const total = totalResult?.count || 0;
    return { active, historical: total - active, total };
  }

  async getAllProgramExpenses(): Promise<any[]> {
    const { adaptCostToExpense, createNameResolver } = await import("./lib/data-merge");
    const [costLines, piRows] = await Promise.all([
      this.dbInstance.select().from(normalizedCostLines),
      this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo),
    ]);
    const resolve = createNameResolver(piRows.map((r: any) => r.projectName));
    return costLines.map(c => adaptCostToExpense(c, resolve(c.projectName)));
  }

  async getProgramExpensesByProject(projectName: string): Promise<any[]> {
    const { adaptCostToExpense } = await import("./lib/data-merge");
    const costLines = await this.dbInstance.select().from(normalizedCostLines)
      .where(eq(normalizedCostLines.projectName, projectName));
    return costLines.map(c => adaptCostToExpense(c, projectName));
  }

  async createManyProgramExpenses(expenseList: InsertProgramExpense[]): Promise<ProgramExpense[]> {
    if (expenseList.length === 0) return [];
    const mapped = expenseList.map(e => ({
      projectName: e.projectName,
      costCategory: e.expenseCategory || null,
      description: e.expenseLineItem || null,
      amountExVat: e.expenseActualTotal?.toString() || null,
      invoiceNumber: e.expenseInvoiceNumber || null,
      invoiceDate: e.expenseInvoicedDate || null,
      invoiceDateConfirmed: e.invoiceDateConfirmed ?? null,
      invoiceDateFontColor: e.invoiceDateFontColor || null,
      paidDate: e.expensePaymentDate || null,
      paidDateConfirmed: e.paymentDateConfirmed ?? null,
      paidDateFontColor: e.paymentDateFontColor || null,
      poNumber: e.expensePoNumber || null,
      counterpartyName: e.supplierName || null,
      sourceRow: e.rowNumber || null,
    }));
    const results = await this.dbInstance.insert(normalizedCostLines).values(mapped).returning();
    const { adaptCostToExpense } = await import("./lib/data-merge");
    return results.map(r => adaptCostToExpense(r, r.projectName)) as any;
  }

  async deleteProgramExpensesByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(normalizedCostLines).where(eq(normalizedCostLines.projectName, projectName));
  }

  async updateProgramExpenseFields(id: number, fields: Record<string, any>): Promise<ProgramExpense | undefined> {
    const mappedFields: Record<string, any> = {};
    const fieldMap: Record<string, string> = {
      expenseCategory: 'costCategory',
      expenseLineItem: 'description',
      expenseActualTotal: 'amountExVat',
      expenseInvoiceNumber: 'invoiceNumber',
      expenseInvoicedDate: 'invoiceDate',
      expensePaymentDate: 'paidDate',
      expensePoNumber: 'poNumber',
      supplierName: 'counterpartyName',
      invoiceDateConfirmed: 'invoiceDateConfirmed',
      invoiceDateFontColor: 'invoiceDateFontColor',
      paymentDateConfirmed: 'paidDateConfirmed',
      paymentDateFontColor: 'paidDateFontColor',
      noRevenueLinked: 'noRevenueLinked',
    };
    const validDbColumns = new Set(Object.values(fieldMap));
    for (const [key, value] of Object.entries(fields)) {
      const mapped = fieldMap[key] || key;
      if (validDbColumns.has(mapped) || Object.keys(normalizedCostLines).includes(mapped)) {
        mappedFields[mapped] = value;
      }
    }
    if (Object.keys(mappedFields).length === 0) {
      return undefined;
    }
    const canonicalId = id >= 900000 ? id - 900000 : id;
    const result = await this.dbInstance
      .update(normalizedCostLines)
      .set(mappedFields)
      .where(eq(normalizedCostLines.id, canonicalId))
      .returning();
    if (!result[0]) return undefined;
    const { adaptCostToExpense } = await import("./lib/data-merge");
    return adaptCostToExpense(result[0], result[0].projectName) as any;
  }

  async getAllProgramInflows(): Promise<any[]> {
    const { adaptRevenueToInflow, createNameResolver } = await import("./lib/data-merge");
    const [revLines, piRows] = await Promise.all([
      this.dbInstance.select().from(normalizedRevenueLines),
      this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo),
    ]);
    const resolve = createNameResolver(piRows.map((r: any) => r.projectName));
    return revLines.map(r => adaptRevenueToInflow(r, resolve(r.projectName)));
  }

  async getProgramInflowsByProject(projectName: string): Promise<any[]> {
    const { adaptRevenueToInflow } = await import("./lib/data-merge");
    const revLines = await this.dbInstance.select().from(normalizedRevenueLines)
      .where(eq(normalizedRevenueLines.projectName, projectName));
    return revLines.map(r => adaptRevenueToInflow(r, projectName));
  }

  async createManyProgramInflows(inflowList: InsertProgramInflows[]): Promise<ProgramInflows[]> {
    if (inflowList.length === 0) return [];
    const mapped = inflowList.map(i => ({
      projectName: i.projectName,
      milestoneName: i.milestoneName || null,
      description: i.milestoneName || null,
      amountExVat: i.milestoneAmount?.toString() || null,
      invoiceNumber: i.milestoneInvoiceNumber || null,
      invoiceDate: i.invoiceRaisedDate || null,
      expectedPaymentDate: i.plannedPaymentDate || null,
      paidDate: i.paymentReceivedDate || null,
      sourceRow: i.rowNumber || null,
      importRunId: 0,
    }));
    const results = await this.dbInstance.insert(normalizedRevenueLines).values(mapped).returning();
    const { adaptRevenueToInflow } = await import("./lib/data-merge");
    return results.map(r => adaptRevenueToInflow(r, r.projectName)) as any;
  }

  async deleteProgramInflowsByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(normalizedRevenueLines).where(eq(normalizedRevenueLines.projectName, projectName));
  }

  // Project Plan — reads from work_items (PM workstream, SMART_IMPORT source)
  private mapWorkItemToProjectPlan(wi: any, pName: string): ProjectPlan {
    return {
      id: wi.id,
      projectName: pName,
      rowNumber: wi.sourceRow || wi.id,
      taskNo: wi.wbsCode || null,
      highLevelProgramme: wi.title,
      actualStart: wi.startDate || null,
      durationDays: wi.duration || null,
      actualEnd: wi.endDate || null,
      actualPctComplete: wi.percentComplete != null ? wi.percentComplete : null,
      expectedPctComplete: wi.expectedPctComplete || null,
      createdAt: wi.createdAt,
    } as ProjectPlan;
  }

  async getAllProjectPlans(): Promise<ProjectPlan[]> {
    const [rows, piRows] = await Promise.all([
      this.dbInstance.select().from(workItems)
        .where(and(
          eq(workItems.workstream, "PM"),
          eq(workItems.source, "SMART_IMPORT"),
          isNull(workItems.deletedAt),
        ))
        .orderBy(desc(workItems.createdAt)),
      this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
    ]);
    const piNameMap = new Map(piRows.map((p: any) => [p.id, p.projectName]));
    return rows.map((wi: any) => this.mapWorkItemToProjectPlan(wi, (wi.projectId ? piNameMap.get(wi.projectId) : null) || ""));
  }

  async getProjectPlansByProject(projectName: string): Promise<ProjectPlan[]> {
    const piRow = await this.dbInstance.select({ id: projectInfo.id }).from(projectInfo)
      .where(eq(projectInfo.projectName, projectName)).limit(1);
    if (piRow.length === 0) return [];
    const rows = await this.dbInstance.select().from(workItems)
      .where(and(
        eq(workItems.projectId, piRow[0].id),
        eq(workItems.workstream, "PM"),
        eq(workItems.source, "SMART_IMPORT"),
        isNull(workItems.deletedAt),
      ));
    return rows.map((wi: any) => this.mapWorkItemToProjectPlan(wi, projectName));
  }

  async createManyProjectPlans(planList: InsertProjectPlan[]): Promise<ProjectPlan[]> {
    if (planList.length === 0) return [];
    const projectNames = Array.from(new Set(planList.map(p => p.projectName)));
    const piRows = await this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo).where(inArray(projectInfo.projectName, projectNames));
    const piMap = new Map(piRows.map(p => [p.projectName, p.id]));
    const now = new Date();
    const wiValues = planList.map(p => ({
      projectId: piMap.get(p.projectName) || null,
      workstream: 'PM' as const,
      source: 'SMART_IMPORT' as const,
      title: p.highLevelProgramme || `Task ${p.rowNumber || 0}`,
      wbsCode: p.taskNo || null,
      startDate: p.actualStart || null,
      endDate: p.actualEnd || null,
      duration: p.durationDays || null,
      percentComplete: p.actualPctComplete || null,
      expectedPctComplete: p.expectedPctComplete || null,
      sourceRow: p.rowNumber || null,
      status: 'Not Started',
      createdAt: now,
      updatedAt: now,
    }));
    const results = await this.dbInstance.insert(workItems).values(wiValues).returning();
    return results.map((wi: any) => this.mapWorkItemToProjectPlan(wi, planList[0]?.projectName || ""));
  }

  async deleteProjectPlansByProject(projectName: string): Promise<void> {
    const scenarioIds = await this.dbInstance
      .select({ id: workingPlanScenario.id })
      .from(workingPlanScenario)
      .where(eq(workingPlanScenario.projectName, projectName));
    if (scenarioIds.length > 0) {
      const sIds = scenarioIds.map(s => s.id);
      await this.dbInstance.update(workingPlanTaskOverride)
        .set({ importedTaskId: null })
        .where(inArray(workingPlanTaskOverride.scenarioId, sIds));
      await this.dbInstance.update(workingPlanDependencyOverride)
        .set({ importedDependencyId: null })
        .where(inArray(workingPlanDependencyOverride.scenarioId, sIds));
    }
    await this.dbInstance.delete(projectPlanDependency).where(eq(projectPlanDependency.projectName, projectName));
    const piRow = await this.dbInstance.select({ id: projectInfo.id }).from(projectInfo)
      .where(eq(projectInfo.projectName, projectName)).limit(1);
    if (piRow.length > 0) {
      await this.dbInstance.update(workItems)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(workItems.projectId, piRow[0].id),
          eq(workItems.workstream, "PM"),
          eq(workItems.source, "SMART_IMPORT"),
          isNull(workItems.deletedAt),
        ));
    }
  }

  // Cashflow Points (new)
  async getAllCashflowPoints(): Promise<CashflowPoint[]> {
    return this.dbInstance.select().from(cashflowPoints).orderBy(desc(cashflowPoints.createdAt));
  }

  async getCashflowPointsByProject(projectName: string): Promise<CashflowPoint[]> {
    return this.dbInstance.select().from(cashflowPoints).where(eq(cashflowPoints.projectName, projectName));
  }

  async createManyCashflowPoints(pointList: InsertCashflowPoint[]): Promise<CashflowPoint[]> {
    if (pointList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = pointList.map(p => ({ ...p, createdAt: now }));
    
    // Batch inserts to avoid SQLite variable limit (max ~999 variables, each row has ~6 fields)
    const batchSize = 100;
    const results: CashflowPoint[] = [];
    for (let i = 0; i < withTimestamps.length; i += batchSize) {
      const batch = withTimestamps.slice(i, i + batchSize);
      const batchResults = await this.dbInstance.insert(cashflowPoints).values(batch).returning();
      results.push(...batchResults);
    }
    return results;
  }

  async deleteCashflowPointsByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(cashflowPoints).where(eq(cashflowPoints.projectName, projectName));
  }

  // Finance Revenue Monthly (new)
  async getAllFinanceRevenueMonthly(): Promise<FinanceRevenueMonthly[]> {
    return this.dbInstance.select().from(financeRevenueMonthly).orderBy(desc(financeRevenueMonthly.createdAt));
  }

  async getFinanceRevenueMonthlyByProject(projectName: string): Promise<FinanceRevenueMonthly[]> {
    return this.dbInstance.select().from(financeRevenueMonthly).where(eq(financeRevenueMonthly.projectName, projectName));
  }

  async createManyFinanceRevenueMonthly(dataList: InsertFinanceRevenueMonthly[]): Promise<FinanceRevenueMonthly[]> {
    if (dataList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = dataList.map(d => ({ ...d, createdAt: now }));
    
    // Batch inserts to avoid SQLite variable limit
    const batchSize = 100;
    const results: FinanceRevenueMonthly[] = [];
    for (let i = 0; i < withTimestamps.length; i += batchSize) {
      const batch = withTimestamps.slice(i, i + batchSize);
      const batchResults = await this.dbInstance.insert(financeRevenueMonthly).values(batch).returning();
      results.push(...batchResults);
    }
    return results;
  }

  async deleteFinanceRevenueMonthlyByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(financeRevenueMonthly).where(eq(financeRevenueMonthly.projectName, projectName));
  }

  // Finance COS Monthly (new)
  async getAllFinanceCosMonthly(): Promise<FinanceCosMonthly[]> {
    return this.dbInstance.select().from(financeCosMonthly).orderBy(desc(financeCosMonthly.createdAt));
  }

  async getFinanceCosMonthlyByProject(projectName: string): Promise<FinanceCosMonthly[]> {
    return this.dbInstance.select().from(financeCosMonthly).where(eq(financeCosMonthly.projectName, projectName));
  }

  async createManyFinanceCosMonthly(dataList: InsertFinanceCosMonthly[]): Promise<FinanceCosMonthly[]> {
    if (dataList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = dataList.map(d => ({ ...d, createdAt: now }));
    
    // Batch inserts to avoid SQLite variable limit
    const batchSize = 100;
    const results: FinanceCosMonthly[] = [];
    for (let i = 0; i < withTimestamps.length; i += batchSize) {
      const batch = withTimestamps.slice(i, i + batchSize);
      const batchResults = await this.dbInstance.insert(financeCosMonthly).values(batch).returning();
      results.push(...batchResults);
    }
    return results;
  }

  async deleteFinanceCosMonthlyByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(financeCosMonthly).where(eq(financeCosMonthly.projectName, projectName));
  }

  // Cashflow Planning Overrides (user edits)
  async getAllPlanningOverrides(): Promise<CashflowPlanningOverride[]> {
    return this.dbInstance.select().from(cashflowPlanningOverrides).orderBy(desc(cashflowPlanningOverrides.updatedAt));
  }

  async getPlanningOverridesByProject(projectName: string): Promise<CashflowPlanningOverride[]> {
    return this.dbInstance.select()
      .from(cashflowPlanningOverrides)
      .where(eq(cashflowPlanningOverrides.projectName, projectName))
      .orderBy(cashflowPlanningOverrides.weekStartDate);
  }

  async upsertPlanningOverride(override: InsertCashflowPlanningOverride): Promise<CashflowPlanningOverride> {
    const now = new Date();
    const withTimestamps = { ...override, createdAt: now, updatedAt: now };
    
    // Check if override already exists
    const existing = await this.dbInstance.select()
      .from(cashflowPlanningOverrides)
      .where(and(
        eq(cashflowPlanningOverrides.projectName, override.projectName),
        eq(cashflowPlanningOverrides.weekStartDate, override.weekStartDate),
        eq(cashflowPlanningOverrides.seriesName, override.seriesName)
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update existing
      const updated = await this.dbInstance
        .update(cashflowPlanningOverrides)
        .set({ overrideValue: override.overrideValue, updatedAt: now })
        .where(eq(cashflowPlanningOverrides.id, existing[0].id))
        .returning();
      return updated[0];
    } else {
      // Insert new
      const inserted = await this.dbInstance
        .insert(cashflowPlanningOverrides)
        .values(withTimestamps)
        .returning();
      return inserted[0];
    }
  }

  async upsertManyPlanningOverrides(overrides: InsertCashflowPlanningOverride[]): Promise<CashflowPlanningOverride[]> {
    if (overrides.length === 0) return [];
    
    // Process one at a time to ensure upsert logic
    const results: CashflowPlanningOverride[] = [];
    for (const override of overrides) {
      const result = await this.upsertPlanningOverride(override);
      results.push(result);
    }
    return results;
  }

  async deletePlanningOverridesByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(cashflowPlanningOverrides).where(eq(cashflowPlanningOverrides.projectName, projectName));
  }

  // Project Plan Overrides (user edits for tasks/milestones)
  async getProjectPlanOverridesByProject(projectName: string): Promise<ProjectPlanOverride[]> {
    return this.dbInstance.select()
      .from(projectPlanOverrides)
      .where(eq(projectPlanOverrides.projectName, projectName))
      .orderBy(projectPlanOverrides.rowNumber);
  }

  async getAllProjectPlanOverrides(): Promise<ProjectPlanOverride[]> {
    return this.dbInstance.select()
      .from(projectPlanOverrides)
      .orderBy(projectPlanOverrides.projectName, projectPlanOverrides.rowNumber);
  }

  async upsertProjectPlanOverride(override: InsertProjectPlanOverride): Promise<ProjectPlanOverride> {
    const now = new Date();
    const withTimestamps = { ...override, createdAt: now, updatedAt: now };
    
    const existing = await this.dbInstance.select()
      .from(projectPlanOverrides)
      .where(and(
        eq(projectPlanOverrides.projectName, override.projectName),
        eq(projectPlanOverrides.rowNumber, override.rowNumber),
        eq(projectPlanOverrides.fieldName, override.fieldName)
      ))
      .limit(1);

    if (existing.length > 0) {
      const updated = await this.dbInstance
        .update(projectPlanOverrides)
        .set({ overrideValue: override.overrideValue, updatedAt: now })
        .where(eq(projectPlanOverrides.id, existing[0].id))
        .returning();
      return updated[0];
    } else {
      const inserted = await this.dbInstance
        .insert(projectPlanOverrides)
        .values(withTimestamps)
        .returning();
      return inserted[0];
    }
  }

  async upsertManyProjectPlanOverrides(overrides: InsertProjectPlanOverride[]): Promise<ProjectPlanOverride[]> {
    if (overrides.length === 0) return [];
    const results: ProjectPlanOverride[] = [];
    for (const override of overrides) {
      const result = await this.upsertProjectPlanOverride(override);
      results.push(result);
    }
    return results;
  }

  async deleteProjectPlanOverridesByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(projectPlanOverrides).where(eq(projectPlanOverrides.projectName, projectName));
  }

  // Revenue Tracking Overrides (user edits for revenue milestones)
  async getRevenueTrackingOverridesByProject(projectName: string): Promise<RevenueTrackingOverride[]> {
    return this.dbInstance.select()
      .from(revenueTrackingOverrides)
      .where(eq(revenueTrackingOverrides.projectName, projectName))
      .orderBy(revenueTrackingOverrides.rowNumber);
  }

  async upsertRevenueTrackingOverride(override: InsertRevenueTrackingOverride): Promise<RevenueTrackingOverride> {
    const now = new Date();
    const withTimestamps = { ...override, createdAt: now, updatedAt: now };
    
    const existing = await this.dbInstance.select()
      .from(revenueTrackingOverrides)
      .where(and(
        eq(revenueTrackingOverrides.projectName, override.projectName),
        eq(revenueTrackingOverrides.rowNumber, override.rowNumber),
        eq(revenueTrackingOverrides.fieldName, override.fieldName)
      ))
      .limit(1);

    if (existing.length > 0) {
      const updated = await this.dbInstance
        .update(revenueTrackingOverrides)
        .set({ overrideValue: override.overrideValue, updatedAt: now })
        .where(eq(revenueTrackingOverrides.id, existing[0].id))
        .returning();
      return updated[0];
    } else {
      const inserted = await this.dbInstance
        .insert(revenueTrackingOverrides)
        .values(withTimestamps)
        .returning();
      return inserted[0];
    }
  }

  async upsertManyRevenueTrackingOverrides(overrides: InsertRevenueTrackingOverride[]): Promise<RevenueTrackingOverride[]> {
    if (overrides.length === 0) return [];
    const results: RevenueTrackingOverride[] = [];
    for (const override of overrides) {
      const result = await this.upsertRevenueTrackingOverride(override);
      results.push(result);
    }
    return results;
  }

  async deleteRevenueTrackingOverridesByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(revenueTrackingOverrides).where(eq(revenueTrackingOverrides.projectName, projectName));
  }

  // Expenditure Overrides (user edits for expenses)
  async getExpenditureOverridesByProject(projectName: string): Promise<ExpenditureOverride[]> {
    return this.dbInstance.select()
      .from(expenditureOverrides)
      .where(eq(expenditureOverrides.projectName, projectName))
      .orderBy(expenditureOverrides.rowNumber);
  }

  async getAllExpenditureOverrides(): Promise<ExpenditureOverride[]> {
    return this.dbInstance.select()
      .from(expenditureOverrides)
      .orderBy(expenditureOverrides.projectName, expenditureOverrides.rowNumber);
  }

  async upsertExpenditureOverride(override: InsertExpenditureOverride): Promise<ExpenditureOverride> {
    const now = new Date();
    const withTimestamps = { ...override, createdAt: now, updatedAt: now };
    
    const existing = await this.dbInstance.select()
      .from(expenditureOverrides)
      .where(and(
        eq(expenditureOverrides.projectName, override.projectName),
        eq(expenditureOverrides.rowNumber, override.rowNumber),
        eq(expenditureOverrides.fieldName, override.fieldName)
      ))
      .limit(1);

    if (existing.length > 0) {
      const updated = await this.dbInstance
        .update(expenditureOverrides)
        .set({ overrideValue: override.overrideValue, updatedAt: now })
        .where(eq(expenditureOverrides.id, existing[0].id))
        .returning();
      return updated[0];
    } else {
      const inserted = await this.dbInstance
        .insert(expenditureOverrides)
        .values(withTimestamps)
        .returning();
      return inserted[0];
    }
  }

  async upsertManyExpenditureOverrides(overrides: InsertExpenditureOverride[]): Promise<ExpenditureOverride[]> {
    if (overrides.length === 0) return [];
    const results: ExpenditureOverride[] = [];
    for (const override of overrides) {
      const result = await this.upsertExpenditureOverride(override);
      results.push(result);
    }
    return results;
  }

  async deleteExpenditureOverridesByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(expenditureOverrides).where(eq(expenditureOverrides.projectName, projectName));
  }

  // Finance Revenue Overrides (user edits for monthly revenue)
  async getFinanceRevenueOverridesByProject(projectName: string): Promise<FinanceRevenueOverride[]> {
    return this.dbInstance.select()
      .from(financeRevenueOverrides)
      .where(eq(financeRevenueOverrides.projectName, projectName))
      .orderBy(financeRevenueOverrides.monthEndDate, financeRevenueOverrides.category);
  }

  async upsertFinanceRevenueOverride(override: InsertFinanceRevenueOverride): Promise<FinanceRevenueOverride> {
    const now = new Date();
    const withTimestamps = { ...override, createdAt: now, updatedAt: now };
    
    const existing = await this.dbInstance.select()
      .from(financeRevenueOverrides)
      .where(and(
        eq(financeRevenueOverrides.projectName, override.projectName),
        eq(financeRevenueOverrides.category, override.category),
        eq(financeRevenueOverrides.monthEndDate, override.monthEndDate)
      ))
      .limit(1);

    if (existing.length > 0) {
      const updated = await this.dbInstance
        .update(financeRevenueOverrides)
        .set({ overrideValue: override.overrideValue, updatedAt: now })
        .where(eq(financeRevenueOverrides.id, existing[0].id))
        .returning();
      return updated[0];
    } else {
      const inserted = await this.dbInstance
        .insert(financeRevenueOverrides)
        .values(withTimestamps)
        .returning();
      return inserted[0];
    }
  }

  async upsertManyFinanceRevenueOverrides(overrides: InsertFinanceRevenueOverride[]): Promise<FinanceRevenueOverride[]> {
    if (overrides.length === 0) return [];
    const results: FinanceRevenueOverride[] = [];
    for (const override of overrides) {
      const result = await this.upsertFinanceRevenueOverride(override);
      results.push(result);
    }
    return results;
  }

  async deleteFinanceRevenueOverridesByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(financeRevenueOverrides).where(eq(financeRevenueOverrides.projectName, projectName));
  }

  // Finance COS Overrides (user edits for monthly COS)
  async getFinanceCosOverridesByProject(projectName: string): Promise<FinanceCosOverride[]> {
    return this.dbInstance.select()
      .from(financeCosOverrides)
      .where(eq(financeCosOverrides.projectName, projectName))
      .orderBy(financeCosOverrides.monthEndDate, financeCosOverrides.category);
  }

  async upsertFinanceCosOverride(override: InsertFinanceCosOverride): Promise<FinanceCosOverride> {
    const now = new Date();
    const withTimestamps = { ...override, createdAt: now, updatedAt: now };
    
    const existing = await this.dbInstance.select()
      .from(financeCosOverrides)
      .where(and(
        eq(financeCosOverrides.projectName, override.projectName),
        eq(financeCosOverrides.category, override.category),
        eq(financeCosOverrides.monthEndDate, override.monthEndDate)
      ))
      .limit(1);

    if (existing.length > 0) {
      const updated = await this.dbInstance
        .update(financeCosOverrides)
        .set({ overrideValue: override.overrideValue, updatedAt: now })
        .where(eq(financeCosOverrides.id, existing[0].id))
        .returning();
      return updated[0];
    } else {
      const inserted = await this.dbInstance
        .insert(financeCosOverrides)
        .values(withTimestamps)
        .returning();
      return inserted[0];
    }
  }

  async upsertManyFinanceCosOverrides(overrides: InsertFinanceCosOverride[]): Promise<FinanceCosOverride[]> {
    if (overrides.length === 0) return [];
    const results: FinanceCosOverride[] = [];
    for (const override of overrides) {
      const result = await this.upsertFinanceCosOverride(override);
      results.push(result);
    }
    return results;
  }

  async deleteFinanceCosOverridesByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(financeCosOverrides).where(eq(financeCosOverrides.projectName, projectName));
  }

  // Working Plan Scenarios
  async getActiveScenario(projectName: string): Promise<WorkingPlanScenario | undefined> {
    const [scenario] = await this.dbInstance.select()
      .from(workingPlanScenario)
      .where(and(
        eq(workingPlanScenario.projectName, projectName),
        eq(workingPlanScenario.isActive, 1)
      ))
      .limit(1);
    return scenario;
  }

  async getOrCreateActiveScenario(projectName: string): Promise<WorkingPlanScenario> {
    const existing = await this.getActiveScenario(projectName);
    if (existing) return existing;
    
    const now = new Date();
    const [created] = await this.dbInstance.insert(workingPlanScenario)
      .values({
        projectName,
        name: "Working Plan",
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  }

  async resetScenario(scenarioId: number): Promise<void> {
    await this.dbInstance.delete(workingPlanTaskOverride)
      .where(eq(workingPlanTaskOverride.scenarioId, scenarioId));
    await this.dbInstance.delete(workingPlanDependencyOverride)
      .where(eq(workingPlanDependencyOverride.scenarioId, scenarioId));
  }

  // Working Plan Task Overrides
  async getTaskOverridesByScenario(scenarioId: number): Promise<WorkingPlanTaskOverride[]> {
    return await this.dbInstance.select()
      .from(workingPlanTaskOverride)
      .where(eq(workingPlanTaskOverride.scenarioId, scenarioId));
  }

  async createTaskOverride(override: InsertWorkingPlanTaskOverride): Promise<WorkingPlanTaskOverride> {
    const now = new Date();
    const [created] = await this.dbInstance.insert(workingPlanTaskOverride)
      .values({ ...override, createdAt: now, updatedAt: now })
      .returning();
    return created;
  }

  async updateTaskOverride(id: number, data: Partial<InsertWorkingPlanTaskOverride>): Promise<WorkingPlanTaskOverride | undefined> {
    const now = new Date();
    const [updated] = await this.dbInstance.update(workingPlanTaskOverride)
      .set({ ...data, updatedAt: now })
      .where(eq(workingPlanTaskOverride.id, id))
      .returning();
    return updated;
  }

  async softDeleteTaskOverride(id: number): Promise<void> {
    await this.dbInstance.update(workingPlanTaskOverride)
      .set({ deletedFlag: 1, updatedAt: new Date() })
      .where(eq(workingPlanTaskOverride.id, id));
  }

  // Project Plan Dependencies
  async getDependenciesByProject(projectName: string): Promise<ProjectPlanDependency[]> {
    return await this.dbInstance.select()
      .from(projectPlanDependency)
      .where(eq(projectPlanDependency.projectName, projectName));
  }

  async createDependency(dep: InsertProjectPlanDependency): Promise<ProjectPlanDependency> {
    const now = new Date();
    const [created] = await this.dbInstance.insert(projectPlanDependency)
      .values({ ...dep, createdAt: now })
      .returning();
    return created;
  }

  async deleteDependency(id: number): Promise<void> {
    await this.dbInstance.delete(projectPlanDependency)
      .where(eq(projectPlanDependency.id, id));
  }

  async deleteDependenciesByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(projectPlanDependency)
      .where(eq(projectPlanDependency.projectName, projectName));
  }

  // Working Plan Dependency Overrides
  async getDependencyOverridesByScenario(scenarioId: number): Promise<WorkingPlanDependencyOverride[]> {
    return await this.dbInstance.select()
      .from(workingPlanDependencyOverride)
      .where(eq(workingPlanDependencyOverride.scenarioId, scenarioId));
  }

  async createDependencyOverride(override: InsertWorkingPlanDependencyOverride): Promise<WorkingPlanDependencyOverride> {
    const now = new Date();
    const [created] = await this.dbInstance.insert(workingPlanDependencyOverride)
      .values({ ...override, createdAt: now, updatedAt: now })
      .returning();
    return created;
  }

  async softDeleteDependencyOverride(id: number): Promise<void> {
    await this.dbInstance.update(workingPlanDependencyOverride)
      .set({ deletedFlag: 1, updatedAt: new Date() })
      .where(eq(workingPlanDependencyOverride.id, id));
  }

  // Schedule Change Notices
  async getChangeNoticesByProject(projectName: string): Promise<ScheduleChangeNotice[]> {
    return await this.dbInstance.select()
      .from(scheduleChangeNotice)
      .where(eq(scheduleChangeNotice.projectName, projectName))
      .orderBy(desc(scheduleChangeNotice.createdAt));
  }

  async createChangeNotice(notice: InsertScheduleChangeNotice): Promise<ScheduleChangeNotice> {
    const now = new Date();
    const [created] = await this.dbInstance.insert(scheduleChangeNotice)
      .values({ ...notice, createdAt: now })
      .returning();
    return created;
  }

  async updateChangeNotice(id: number, data: Partial<InsertScheduleChangeNotice>): Promise<ScheduleChangeNotice | undefined> {
    const [updated] = await this.dbInstance.update(scheduleChangeNotice)
      .set(data)
      .where(eq(scheduleChangeNotice.id, id))
      .returning();
    return updated;
  }

  async clearAllData(): Promise<{ tablesCleared: string[]; filesDeleted: number }> {
    const tablesCleared: string[] = [];
    let filesDeleted = 0;

    // Helper to safely delete from a table (handles missing tables gracefully)
    const safeDelete = async (table: any, name: string) => {
      try {
        await this.dbInstance.delete(table);
        tablesCleared.push(name);
      } catch (err: any) {
        // Skip if table doesn't exist
        if (!err.message?.includes('does not exist')) {
          throw err;
        }
      }
    };

    // Clear all data tables (order matters for foreign keys)
    await safeDelete(scheduleChangeNotice, "scheduleChangeNotice");
    await safeDelete(workingPlanDependencyOverride, "workingPlanDependencyOverride");
    await safeDelete(projectPlanDependency, "projectPlanDependency");
    await safeDelete(workingPlanTaskOverride, "workingPlanTaskOverride");
    await safeDelete(workingPlanScenario, "workingPlanScenario");
    await safeDelete(financeCosOverrides, "financeCosOverrides");
    await safeDelete(financeRevenueOverrides, "financeRevenueOverrides");
    await safeDelete(expenditureOverrides, "expenditureOverrides");
    await safeDelete(revenueTrackingOverrides, "revenueTrackingOverrides");
    await safeDelete(projectPlanOverrides, "projectPlanOverrides");
    await safeDelete(cashflowPlanningOverrides, "cashflowPlanningOverrides");
    await safeDelete(financeCosMonthly, "financeCosMonthly");
    await safeDelete(financeRevenueMonthly, "financeRevenueMonthly");
    await safeDelete(cashflowPoints, "cashflowPoints");
    await safeDelete(normalizedCostLines, "normalizedCostLines");
    await safeDelete(normalizedRevenueLines, "normalizedRevenueLines");
    await safeDelete(workItems, "workItems");
    await safeDelete(projectInfo, "projectInfo");
    await safeDelete(refreshLogs, "refreshLogs");
    await safeDelete(uploadMetadata, "uploadMetadata");
    await safeDelete(budgets, "budgets");
    await safeDelete(tasks, "tasks");
    await safeDelete(revenues, "revenues");
    await safeDelete(expenses, "expenses");
    await safeDelete(projects, "projects");

    // Delete uploaded files
    const fs = await import("fs");
    const path = await import("path");
    const uploadsDir = path.resolve("./uploads");
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        const filePath = path.join(uploadsDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
          filesDeleted++;
        }
      }
    }

    return { tablesCleared, filesDeleted };
  }

  // Project Revenue Summary
  async getAllProjectRevenueSummaries(): Promise<ProjectRevenueSummary[]> {
    return this.dbInstance.select().from(projectRevenueSummary);
  }

  async getProjectRevenueSummary(projectName: string): Promise<ProjectRevenueSummary | undefined> {
    const results = await this.dbInstance.select().from(projectRevenueSummary).where(eq(projectRevenueSummary.projectName, projectName));
    return results[0];
  }

  async upsertProjectRevenueSummary(data: InsertProjectRevenueSummary): Promise<ProjectRevenueSummary> {
    const existing = await this.getProjectRevenueSummary(data.projectName);
    if (existing) {
      const updated = await this.dbInstance.update(projectRevenueSummary)
        .set({ ...data, capturedAt: new Date() })
        .where(eq(projectRevenueSummary.projectName, data.projectName))
        .returning();
      return updated[0];
    } else {
      const inserted = await this.dbInstance.insert(projectRevenueSummary).values(data).returning();
      return inserted[0];
    }
  }

  // Milestone Task Links
  async getAllMilestoneTaskLinks(): Promise<MilestoneTaskLink[]> {
    return await this.dbInstance.select().from(milestoneTaskLinks);
  }

  async getMilestoneTaskLinks(projectName: string): Promise<MilestoneTaskLink[]> {
    return await this.dbInstance.select().from(milestoneTaskLinks).where(eq(milestoneTaskLinks.projectName, projectName));
  }

  async upsertMilestoneTaskLink(projectName: string, milestoneRowNumber: number, taskId: number): Promise<MilestoneTaskLink> {
    const existing = await this.dbInstance.select().from(milestoneTaskLinks)
      .where(and(eq(milestoneTaskLinks.projectName, projectName), eq(milestoneTaskLinks.milestoneRowNumber, milestoneRowNumber)));
    if (existing.length > 0) {
      const updated = await this.dbInstance.update(milestoneTaskLinks)
        .set({ taskId })
        .where(and(eq(milestoneTaskLinks.projectName, projectName), eq(milestoneTaskLinks.milestoneRowNumber, milestoneRowNumber)))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(milestoneTaskLinks).values({ projectName, milestoneRowNumber, taskId }).returning();
    return inserted[0];
  }

  async deleteMilestoneTaskLink(projectName: string, milestoneRowNumber: number): Promise<void> {
    await this.dbInstance.delete(milestoneTaskLinks)
      .where(and(eq(milestoneTaskLinks.projectName, projectName), eq(milestoneTaskLinks.milestoneRowNumber, milestoneRowNumber)));
  }

  async updateMilestoneDateOverride(projectName: string, milestoneRowNumber: number, dateOverride: string | null, reason: string | null): Promise<void> {
    await this.dbInstance.update(milestoneTaskLinks)
      .set({ dateOverride, dateOverrideReason: reason })
      .where(and(eq(milestoneTaskLinks.projectName, projectName), eq(milestoneTaskLinks.milestoneRowNumber, milestoneRowNumber)));
  }

  async getExpenseTaskLinks(projectName: string): Promise<ExpenseTaskLink[]> {
    return await this.dbInstance.select().from(expenseTaskLinks).where(eq(expenseTaskLinks.projectName, projectName));
  }

  async getAllExpenseTaskLinks(): Promise<ExpenseTaskLink[]> {
    return await this.dbInstance.select().from(expenseTaskLinks);
  }

  async upsertExpenseTaskLink(projectName: string, expenseId: number, taskId: number, createdBy?: number): Promise<ExpenseTaskLink> {
    const existing = await this.dbInstance.select().from(expenseTaskLinks)
      .where(and(eq(expenseTaskLinks.projectName, projectName), eq(expenseTaskLinks.expenseId, expenseId)));
    if (existing.length > 0) {
      const updated = await this.dbInstance.update(expenseTaskLinks)
        .set({ taskId, updatedAt: new Date() })
        .where(and(eq(expenseTaskLinks.projectName, projectName), eq(expenseTaskLinks.expenseId, expenseId)))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(expenseTaskLinks).values({ projectName, expenseId, taskId, createdBy }).returning();
    return inserted[0];
  }

  async deleteExpenseTaskLink(projectName: string, expenseId: number): Promise<void> {
    await this.dbInstance.delete(expenseTaskLinks)
      .where(and(eq(expenseTaskLinks.projectName, projectName), eq(expenseTaskLinks.expenseId, expenseId)));
  }

  async updateExpenseTaskLinkDateOverride(projectName: string, expenseId: number, dateOverride: string | null, reason: string | null): Promise<void> {
    await this.dbInstance.update(expenseTaskLinks)
      .set({ dateOverride, dateOverrideReason: reason, updatedAt: new Date() })
      .where(and(eq(expenseTaskLinks.projectName, projectName), eq(expenseTaskLinks.expenseId, expenseId)));
  }

  async createManualExpense(data: InsertProgramExpense): Promise<ProgramExpense> {
    const mapped = {
      projectName: data.projectName,
      costCategory: data.expenseCategory || null,
      description: data.expenseLineItem || null,
      amountExVat: data.expenseActualTotal?.toString() || null,
      invoiceNumber: data.expenseInvoiceNumber || null,
      invoiceDate: data.expenseInvoicedDate || null,
      invoiceDateConfirmed: data.invoiceDateConfirmed ?? null,
      invoiceDateFontColor: data.invoiceDateFontColor || null,
      paidDate: data.expensePaymentDate || null,
      paidDateConfirmed: data.paymentDateConfirmed ?? null,
      paidDateFontColor: data.paymentDateFontColor || null,
      poNumber: data.expensePoNumber || null,
      counterpartyName: data.supplierName || null,
      sourceRow: data.rowNumber || null,
    };
    const inserted = await this.dbInstance.insert(normalizedCostLines).values(mapped).returning();
    const { adaptCostToExpense } = await import("./lib/data-merge");
    return adaptCostToExpense(inserted[0], inserted[0].projectName) as any;
  }

  // Home Notes
  async getHomeNotes(): Promise<HomeNotes | undefined> {
    const results = await this.dbInstance.select().from(homeNotes).orderBy(desc(homeNotes.updatedAt)).limit(1);
    return results[0];
  }

  async saveHomeNotes(notes: InsertHomeNotes): Promise<HomeNotes> {
    const existing = await this.getHomeNotes();
    if (existing) {
      const updated = await this.dbInstance.update(homeNotes)
        .set({ ...notes, updatedAt: new Date() })
        .where(eq(homeNotes.id, existing.id))
        .returning();
      return updated[0];
    } else {
      const inserted = await this.dbInstance.insert(homeNotes).values(notes).returning();
      return inserted[0];
    }
  }

  async getProjectEditableFields(projectName: string): Promise<ProjectEditableFields | undefined> {
    const results = await this.dbInstance.select().from(projectEditableFields).where(eq(projectEditableFields.projectName, projectName));
    return results[0];
  }

  async getAllProjectEditableFields(): Promise<ProjectEditableFields[]> {
    return this.dbInstance.select().from(projectEditableFields);
  }

  async upsertProjectEditableFields(data: InsertProjectEditableFields): Promise<ProjectEditableFields> {
    const existing = await this.getProjectEditableFields(data.projectName);
    if (existing) {
      const updated = await this.dbInstance.update(projectEditableFields)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(projectEditableFields.id, existing.id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(projectEditableFields).values(data).returning();
    return inserted[0];
  }

  async getAllCashflowWeeklyManual(): Promise<CashflowWeeklyManual[]> {
    return this.dbInstance.select().from(cashflowWeeklyManual);
  }

  async upsertCashflowWeeklyManual(weekStartDate: string, openingBalance: string): Promise<CashflowWeeklyManual> {
    const existing = await this.dbInstance.select().from(cashflowWeeklyManual).where(eq(cashflowWeeklyManual.weekStartDate, weekStartDate));
    if (existing[0]) {
      const updated = await this.dbInstance.update(cashflowWeeklyManual)
        .set({ openingBalance, updatedAt: new Date() })
        .where(eq(cashflowWeeklyManual.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(cashflowWeeklyManual).values({ weekStartDate, openingBalance }).returning();
    return inserted[0];
  }

  async deleteCashflowWeeklyManual(weekStartDate: string): Promise<void> {
    await this.dbInstance.delete(cashflowWeeklyManual)
      .where(eq(cashflowWeeklyManual.weekStartDate, weekStartDate));
  }

  async deleteAllCashflowWeeklyManualAfter(weekStartDate: string): Promise<string[]> {
    const toDelete = await this.dbInstance.select({ weekStartDate: cashflowWeeklyManual.weekStartDate })
      .from(cashflowWeeklyManual)
      .where(gte(cashflowWeeklyManual.weekStartDate, weekStartDate));
    const weeks = toDelete.map((r: { weekStartDate: string }) => r.weekStartDate);
    if (weeks.length > 0) {
      await this.dbInstance.delete(cashflowWeeklyManual)
        .where(gte(cashflowWeeklyManual.weekStartDate, weekStartDate));
    }
    return weeks;
  }

  async getBalanceHistory(weekStartDate: string): Promise<CashflowBalanceHistory[]> {
    return this.dbInstance.select().from(cashflowBalanceHistory)
      .where(eq(cashflowBalanceHistory.weekStartDate, weekStartDate))
      .orderBy(desc(cashflowBalanceHistory.changedAt));
  }

  async getAllBalanceHistory(): Promise<CashflowBalanceHistory[]> {
    return this.dbInstance.select().from(cashflowBalanceHistory)
      .orderBy(desc(cashflowBalanceHistory.changedAt));
  }

  async addBalanceHistory(entry: InsertCashflowBalanceHistory): Promise<CashflowBalanceHistory> {
    const inserted = await this.dbInstance.insert(cashflowBalanceHistory).values(entry).returning();
    return inserted[0];
  }

  async getAllOpexBudgetMonthly(): Promise<OpexBudgetMonthly[]> {
    return this.dbInstance.select().from(opexBudgetMonthly);
  }

  async upsertOpexBudgetMonthly(monthKey: string, amount: string): Promise<OpexBudgetMonthly> {
    const existing = await this.dbInstance.select().from(opexBudgetMonthly).where(eq(opexBudgetMonthly.monthKey, monthKey));
    if (existing[0]) {
      const updated = await this.dbInstance.update(opexBudgetMonthly)
        .set({ amount, updatedAt: new Date() })
        .where(eq(opexBudgetMonthly.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(opexBudgetMonthly).values({ monthKey, amount }).returning();
    return inserted[0];
  }

  async getAllOpexWeeklyManual(): Promise<OpexWeeklyManual[]> {
    return this.dbInstance.select().from(opexWeeklyManual);
  }

  async upsertOpexWeeklyManual(weekStartDate: string, opexAmount: string): Promise<OpexWeeklyManual> {
    const existing = await this.dbInstance.select().from(opexWeeklyManual).where(eq(opexWeeklyManual.weekStartDate, weekStartDate));
    if (existing[0]) {
      const updated = await this.dbInstance.update(opexWeeklyManual)
        .set({ opexAmount, updatedAt: new Date() })
        .where(eq(opexWeeklyManual.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(opexWeeklyManual).values({ weekStartDate, opexAmount }).returning();
    return inserted[0];
  }

  async deleteOpexWeeklyManual(weekStartDate: string): Promise<void> {
    await this.dbInstance.delete(opexWeeklyManual).where(eq(opexWeeklyManual.weekStartDate, weekStartDate));
  }

  async getAllAvailablePaymentOverrides(): Promise<AvailablePaymentOverride[]> {
    return this.dbInstance.select().from(availablePaymentOverrides);
  }

  async upsertAvailablePaymentOverride(weekStartDate: string, overrideValue: string, reason: string | null, updatedBy: string | null): Promise<AvailablePaymentOverride> {
    const existing = await this.dbInstance.select().from(availablePaymentOverrides).where(eq(availablePaymentOverrides.weekStartDate, weekStartDate));
    if (existing[0]) {
      const updated = await this.dbInstance.update(availablePaymentOverrides)
        .set({ overrideValue, reason, updatedBy, updatedAt: new Date() })
        .where(eq(availablePaymentOverrides.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(availablePaymentOverrides).values({ weekStartDate, overrideValue, reason, updatedBy }).returning();
    return inserted[0];
  }

  async deleteAvailablePaymentOverride(weekStartDate: string): Promise<void> {
    await this.dbInstance.delete(availablePaymentOverrides).where(eq(availablePaymentOverrides.weekStartDate, weekStartDate));
  }

  async getAvailablePaymentHistory(weekStartDate: string): Promise<AvailablePaymentHistory[]> {
    return this.dbInstance.select().from(availablePaymentHistory)
      .where(eq(availablePaymentHistory.weekStartDate, weekStartDate))
      .orderBy(desc(availablePaymentHistory.changedAt));
  }

  async addAvailablePaymentHistory(entry: InsertAvailablePaymentHistory): Promise<AvailablePaymentHistory> {
    const inserted = await this.dbInstance.insert(availablePaymentHistory).values(entry).returning();
    return inserted[0];
  }

  async getTrackerMonthlyManual(trackerType: string): Promise<TrackerMonthlyManual[]> {
    return this.dbInstance.select().from(trackerMonthlyManual).where(eq(trackerMonthlyManual.trackerType, trackerType));
  }

  async upsertTrackerMonthlyManual(data: InsertTrackerMonthlyManual): Promise<TrackerMonthlyManual> {
    const existing = await this.dbInstance.select().from(trackerMonthlyManual)
      .where(and(eq(trackerMonthlyManual.trackerType, data.trackerType), eq(trackerMonthlyManual.monthKey, data.monthKey)));
    if (existing[0]) {
      const updated = await this.dbInstance.update(trackerMonthlyManual)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(trackerMonthlyManual.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(trackerMonthlyManual).values(data).returning();
    return inserted[0];
  }

  async getAllScenarios(): Promise<Scenario[]> {
    return this.dbInstance.select().from(scenarios).orderBy(desc(scenarios.createdAt));
  }

  async getScenario(id: number): Promise<Scenario | undefined> {
    const rows = await this.dbInstance.select().from(scenarios).where(eq(scenarios.id, id));
    return rows[0];
  }

  async createScenario(scenario: InsertScenario): Promise<Scenario> {
    const inserted = await this.dbInstance.insert(scenarios).values(scenario).returning();
    return inserted[0];
  }

  async deleteScenario(id: number): Promise<void> {
    await this.dbInstance.delete(scenarios).where(eq(scenarios.id, id));
  }

  async duplicateScenario(id: number, newName: string): Promise<Scenario> {
    const source = await this.getScenario(id);
    if (!source) throw new Error('Scenario not found');
    const newScenario = await this.createScenario({ name: newName, description: source.description, createdBy: source.createdBy, isDefault: false });
    const overrides = await this.getDateOverridesByScenario(id);
    for (const ov of overrides) {
      await this.createDateOverride({
        scenarioId: newScenario.id,
        entityType: ov.entityType,
        entityId: ov.entityId,
        fieldName: ov.fieldName,
        originalDate: ov.originalDate,
        overrideDate: ov.overrideDate,
        reason: ov.reason,
        createdBy: ov.createdBy,
      });
    }
    return newScenario;
  }

  async getDateOverridesByScenario(scenarioId: number): Promise<DateOverride[]> {
    return this.dbInstance.select().from(dateOverrides).where(eq(dateOverrides.scenarioId, scenarioId));
  }

  async createDateOverride(override: InsertDateOverride): Promise<DateOverride> {
    const inserted = await this.dbInstance.insert(dateOverrides).values(override).returning();
    return inserted[0];
  }

  async deleteDateOverride(id: number): Promise<void> {
    await this.dbInstance.delete(dateOverrides).where(eq(dateOverrides.id, id));
  }

  async clearDateOverrides(scenarioId: number): Promise<void> {
    await this.dbInstance.delete(dateOverrides).where(eq(dateOverrides.scenarioId, scenarioId));
  }

  // Operational Tasks
  async getAllOperationalTasks(): Promise<OperationalTask[]> {
    return safeLegacyQuery(() => this.dbInstance.select().from(operationalTasks).where(isNull(operationalTasks.deletedAt)), []);
  }

  async getOperationalTasksByProject(projectName: string): Promise<OperationalTask[]> {
    return safeLegacyQuery(() => this.dbInstance.select().from(operationalTasks).where(and(eq(operationalTasks.projectName, projectName), isNull(operationalTasks.deletedAt))).orderBy(operationalTasks.sortOrder), []);
  }

  async getOperationalTask(id: number): Promise<OperationalTask | undefined> {
    const results = await safeLegacyQuery(() => this.dbInstance.select().from(operationalTasks).where(eq(operationalTasks.id, id)), []);
    return results[0];
  }

  async createOperationalTask(data: InsertOperationalTask): Promise<OperationalTask> {
    const now = new Date();
    const [created] = await this.dbInstance.insert(operationalTasks).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return created;
  }

  async updateOperationalTask(id: number, data: Partial<InsertOperationalTask>): Promise<OperationalTask> {
    const [updated] = await this.dbInstance.update(operationalTasks).set({ ...data, updatedAt: new Date() }).where(eq(operationalTasks.id, id)).returning();
    return updated;
  }

  async deleteOperationalTask(id: number): Promise<void> {
    await safeLegacyWrite(() => this.dbInstance.update(operationalTasks).set({ deletedAt: new Date() }).where(eq(operationalTasks.id, id)));
  }

  // Task Comments
  async getTaskComments(taskId: number): Promise<TaskComment[]> {
    return this.dbInstance.select().from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(desc(taskComments.createdAt));
  }

  async createTaskComment(data: InsertTaskComment): Promise<TaskComment> {
    const [created] = await this.dbInstance.insert(taskComments).values({ ...data, createdAt: new Date() }).returning();
    return created;
  }

  async deleteTaskComment(id: number): Promise<void> {
    await this.dbInstance.delete(taskComments).where(eq(taskComments.id, id));
  }

  // Task Checklists
  async getTaskChecklists(taskId: number): Promise<TaskChecklist[]> {
    return this.dbInstance.select().from(taskChecklists).where(eq(taskChecklists.taskId, taskId)).orderBy(taskChecklists.sortOrder);
  }

  async createTaskChecklist(data: InsertTaskChecklist): Promise<TaskChecklist> {
    const [created] = await this.dbInstance.insert(taskChecklists).values({ ...data, createdAt: new Date() }).returning();
    return created;
  }

  async deleteTaskChecklist(id: number): Promise<void> {
    await this.dbInstance.delete(taskChecklists).where(eq(taskChecklists.id, id));
  }

  // Task Checklist Items
  async getChecklistItems(checklistId: number): Promise<TaskChecklistItem[]> {
    return this.dbInstance.select().from(taskChecklistItems).where(eq(taskChecklistItems.checklistId, checklistId)).orderBy(taskChecklistItems.sortOrder);
  }

  async createChecklistItem(data: InsertTaskChecklistItem): Promise<TaskChecklistItem> {
    const [created] = await this.dbInstance.insert(taskChecklistItems).values({ ...data, createdAt: new Date() }).returning();
    return created;
  }

  async updateChecklistItem(id: number, data: Partial<InsertTaskChecklistItem>): Promise<TaskChecklistItem> {
    const [updated] = await this.dbInstance.update(taskChecklistItems).set(data).where(eq(taskChecklistItems.id, id)).returning();
    return updated;
  }

  async deleteChecklistItem(id: number): Promise<void> {
    await this.dbInstance.delete(taskChecklistItems).where(eq(taskChecklistItems.id, id));
  }

  // Task Attachments
  async getTaskAttachments(taskId: number): Promise<TaskAttachment[]> {
    return this.dbInstance.select().from(taskAttachments).where(eq(taskAttachments.taskId, taskId)).orderBy(desc(taskAttachments.createdAt));
  }

  async createTaskAttachment(data: InsertTaskAttachment): Promise<TaskAttachment> {
    const [created] = await this.dbInstance.insert(taskAttachments).values({ ...data, createdAt: new Date() }).returning();
    return created;
  }

  async deleteTaskAttachment(id: number): Promise<void> {
    await this.dbInstance.delete(taskAttachments).where(eq(taskAttachments.id, id));
  }

  // Task Activity Log
  async getTaskActivityLog(taskId: number): Promise<TaskActivityLog[]> {
    return this.dbInstance.select().from(taskActivityLog).where(eq(taskActivityLog.taskId, taskId)).orderBy(desc(taskActivityLog.createdAt));
  }

  async createTaskActivityLog(data: InsertTaskActivityLog): Promise<TaskActivityLog> {
    const [created] = await this.dbInstance.insert(taskActivityLog).values({ ...data, createdAt: new Date() }).returning();
    return created;
  }

  // Writeback Mappings
  async getAllWritebackMappings(): Promise<WritebackMapping[]> {
    return this.dbInstance.select().from(writebackMappings).orderBy(desc(writebackMappings.createdAt));
  }

  async getWritebackMapping(id: number): Promise<WritebackMapping | undefined> {
    const [mapping] = await this.dbInstance.select().from(writebackMappings).where(eq(writebackMappings.id, id));
    return mapping;
  }

  async createWritebackMapping(data: InsertWritebackMapping): Promise<WritebackMapping> {
    const now = new Date();
    const [created] = await this.dbInstance.insert(writebackMappings).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return created;
  }

  async updateWritebackMapping(id: number, data: Partial<InsertWritebackMapping>): Promise<WritebackMapping> {
    const [updated] = await this.dbInstance.update(writebackMappings).set({ ...data, updatedAt: new Date() }).where(eq(writebackMappings.id, id)).returning();
    return updated;
  }

  async deleteWritebackMapping(id: number): Promise<void> {
    await this.dbInstance.delete(writebackMappings).where(eq(writebackMappings.id, id));
  }

  // Writeback Audit Log
  async getWritebackAuditLogs(mappingId?: number): Promise<WritebackAuditLog[]> {
    if (mappingId !== undefined) {
      return this.dbInstance.select().from(writebackAuditLog).where(eq(writebackAuditLog.mappingId, mappingId)).orderBy(desc(writebackAuditLog.appliedAt));
    }
    return this.dbInstance.select().from(writebackAuditLog).orderBy(desc(writebackAuditLog.appliedAt));
  }

  async createWritebackAuditLog(data: InsertWritebackAuditLog): Promise<WritebackAuditLog> {
    const [created] = await this.dbInstance.insert(writebackAuditLog).values({ ...data, appliedAt: new Date() }).returning();
    return created;
  }

  async updateWritebackAuditLog(id: number, data: Partial<InsertWritebackAuditLog>): Promise<WritebackAuditLog> {
    const [updated] = await this.dbInstance.update(writebackAuditLog).set(data).where(eq(writebackAuditLog.id, id)).returning();
    return updated;
  }

  async getKeyDateMappings(projectName: string): Promise<KeyDateMapping[]> {
    return await this.dbInstance.select().from(keyDateMappings)
      .where(eq(keyDateMappings.projectName, projectName))
      .orderBy(keyDateMappings.sortOrder);
  }

  async createKeyDateMapping(data: InsertKeyDateMapping): Promise<KeyDateMapping> {
    const [created] = await this.dbInstance.insert(keyDateMappings).values(data).returning();
    return created;
  }

  async updateKeyDateMapping(id: number, data: Partial<InsertKeyDateMapping>): Promise<KeyDateMapping> {
    const [updated] = await this.dbInstance.update(keyDateMappings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(keyDateMappings.id, id))
      .returning();
    return updated;
  }

  async deleteKeyDateMapping(id: number): Promise<void> {
    await this.dbInstance.delete(keyDateMappings).where(eq(keyDateMappings.id, id));
  }

  // My Tool - Tasks
  async getMytoolTasks(ownerUserId: number): Promise<MytoolTask[]> {
    return this.dbInstance.select().from(mytoolTasks)
      .where(and(eq(mytoolTasks.ownerUserId, ownerUserId), isNull(mytoolTasks.deletedAt)))
      .orderBy(mytoolTasks.sortOrder);
  }

  async getMytoolTasksByDate(ownerUserId: number, date: string): Promise<MytoolTask[]> {
    return this.dbInstance.select().from(mytoolTasks)
      .where(and(
        eq(mytoolTasks.ownerUserId, ownerUserId),
        isNull(mytoolTasks.deletedAt),
        or(
          eq(mytoolTasks.plannedForDate, date),
          and(
            not(inArray(mytoolTasks.status, ['done', 'cancelled'])),
            sql`${mytoolTasks.plannedForDate} < ${date}`
          ),
          and(
            not(inArray(mytoolTasks.status, ['done', 'cancelled'])),
            sql`${mytoolTasks.plannedForDate} IS NULL`
          )
        )
      ))
      .orderBy(mytoolTasks.sortOrder);
  }

  async getMytoolTask(id: number): Promise<MytoolTask | undefined> {
    const [task] = await this.dbInstance.select().from(mytoolTasks).where(eq(mytoolTasks.id, id));
    return task;
  }

  async createMytoolTask(data: InsertMytoolTask): Promise<MytoolTask> {
    const now = new Date();
    const [created] = await this.dbInstance.insert(mytoolTasks).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return created;
  }

  async updateMytoolTask(id: number, data: Partial<InsertMytoolTask>): Promise<MytoolTask> {
    const updateData: any = { ...data, updatedAt: new Date() };
    if ((data as any).status === 'done') {
      updateData.completedAt = new Date();
    }
    const [updated] = await this.dbInstance.update(mytoolTasks).set(updateData).where(eq(mytoolTasks.id, id)).returning();
    return updated;
  }

  async deleteMytoolTask(id: number): Promise<void> {
    await this.dbInstance.update(mytoolTasks).set({ deletedAt: new Date() }).where(eq(mytoolTasks.id, id));
  }

  // My Tool - Timeblocks
  async getMytoolTimeblocks(ownerUserId: number, date: string): Promise<MytoolTimeblock[]> {
    return this.dbInstance.select().from(mytoolTimeblocks)
      .where(and(
        eq(mytoolTimeblocks.ownerUserId, ownerUserId),
        eq(mytoolTimeblocks.date, date)
      ));
  }

  async createMytoolTimeblock(data: InsertMytoolTimeblock): Promise<MytoolTimeblock> {
    const now = new Date();
    const [created] = await this.dbInstance.insert(mytoolTimeblocks).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return created;
  }

  async updateMytoolTimeblock(id: number, data: Partial<InsertMytoolTimeblock>): Promise<MytoolTimeblock> {
    const [updated] = await this.dbInstance.update(mytoolTimeblocks).set({ ...data, updatedAt: new Date() }).where(eq(mytoolTimeblocks.id, id)).returning();
    return updated;
  }

  async deleteMytoolTimeblock(id: number): Promise<void> {
    await this.dbInstance.delete(mytoolTimeblocks).where(eq(mytoolTimeblocks.id, id));
  }

  // My Tool - Daily Reviews
  async getMytoolDailyReview(ownerUserId: number, date: string): Promise<MytoolDailyReview | undefined> {
    const [review] = await this.dbInstance.select().from(mytoolDailyReviews)
      .where(and(
        eq(mytoolDailyReviews.ownerUserId, ownerUserId),
        eq(mytoolDailyReviews.date, date)
      ));
    return review;
  }

  async upsertMytoolDailyReview(data: InsertMytoolDailyReview): Promise<MytoolDailyReview> {
    const now = new Date();
    const existing = await this.getMytoolDailyReview(data.ownerUserId, data.date);
    if (existing) {
      const [updated] = await this.dbInstance.update(mytoolDailyReviews)
        .set({ ...data, updatedAt: now })
        .where(eq(mytoolDailyReviews.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await this.dbInstance.insert(mytoolDailyReviews).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return created;
  }

  // My Tool - Company Priorities
  async getMytoolCompanyPriorities(horizon?: string): Promise<MytoolCompanyPriority[]> {
    if (horizon) {
      return this.dbInstance.select().from(mytoolCompanyPriorities)
        .where(eq(mytoolCompanyPriorities.horizon, horizon as any));
    }
    return this.dbInstance.select().from(mytoolCompanyPriorities);
  }

  async createMytoolCompanyPriority(data: InsertMytoolCompanyPriority): Promise<MytoolCompanyPriority> {
    const now = new Date();
    if (data.priorityRank != null) {
      const conditions = [gte(mytoolCompanyPriorities.priorityRank, data.priorityRank)];
      if (data.department) {
        conditions.push(eq(mytoolCompanyPriorities.department, data.department) as any);
      }
      await this.dbInstance.update(mytoolCompanyPriorities)
        .set({ priorityRank: sql`${mytoolCompanyPriorities.priorityRank} + 1`, updatedAt: now })
        .where(and(...conditions));
    } else {
      const existing = await this.dbInstance.select().from(mytoolCompanyPriorities)
        .where(data.department ? eq(mytoolCompanyPriorities.department, data.department) : sql`true`);
      const maxRank = existing.reduce((max: number, p: any) => Math.max(max, p.priorityRank ?? 0), 0);
      data = { ...data, priorityRank: maxRank + 1 };
    }
    const [created] = await this.dbInstance.insert(mytoolCompanyPriorities).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return created;
  }

  async updateMytoolCompanyPriority(id: number, data: Partial<InsertMytoolCompanyPriority>): Promise<MytoolCompanyPriority> {
    if (data.priorityRank != null) {
      const current = await this.dbInstance.select().from(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, id));
      if (current.length > 0) {
        const oldRank = current[0].priorityRank;
        const dept = data.department ?? current[0].department;
        const newRank = data.priorityRank;
        if (oldRank !== newRank) {
          const deptCondition = dept ? eq(mytoolCompanyPriorities.department, dept) : sql`true`;
          if (oldRank == null || newRank < oldRank) {
            await this.dbInstance.update(mytoolCompanyPriorities)
              .set({ priorityRank: sql`${mytoolCompanyPriorities.priorityRank} + 1`, updatedAt: new Date() })
              .where(and(
                gte(mytoolCompanyPriorities.priorityRank, newRank),
                oldRank != null ? lte(mytoolCompanyPriorities.priorityRank, oldRank - 1) : sql`true`,
                deptCondition as any,
                not(eq(mytoolCompanyPriorities.id, id))
              ));
          } else {
            await this.dbInstance.update(mytoolCompanyPriorities)
              .set({ priorityRank: sql`${mytoolCompanyPriorities.priorityRank} - 1`, updatedAt: new Date() })
              .where(and(
                gte(mytoolCompanyPriorities.priorityRank, oldRank + 1),
                lte(mytoolCompanyPriorities.priorityRank, newRank),
                deptCondition as any,
                not(eq(mytoolCompanyPriorities.id, id))
              ));
          }
        }
      }
    }
    const [updated] = await this.dbInstance.update(mytoolCompanyPriorities).set({ ...data, updatedAt: new Date() }).where(eq(mytoolCompanyPriorities.id, id)).returning();
    return updated;
  }

  async deleteMytoolCompanyPriority(id: number): Promise<void> {
    await this.dbInstance.delete(mytoolCompanyPriorities).where(eq(mytoolCompanyPriorities.id, id));
  }

  // My Tool - Email Links
  async getEmailLinksByTask(taskId: number): Promise<MytoolEmailLink[]> {
    return this.dbInstance.select().from(mytoolEmailLinks).where(eq(mytoolEmailLinks.linkedTaskId, taskId)).orderBy(desc(mytoolEmailLinks.createdAt));
  }

  async getEmailLinksByOperationalTask(taskId: number): Promise<MytoolEmailLink[]> {
    return this.dbInstance.select().from(mytoolEmailLinks).where(eq(mytoolEmailLinks.linkedOperationalTaskId, taskId)).orderBy(desc(mytoolEmailLinks.createdAt));
  }

  async getEmailLinksByPriority(priorityId: number): Promise<MytoolEmailLink[]> {
    return this.dbInstance.select().from(mytoolEmailLinks).where(eq(mytoolEmailLinks.linkedPriorityId, priorityId)).orderBy(desc(mytoolEmailLinks.createdAt));
  }

  async createEmailLink(data: InsertMytoolEmailLink): Promise<MytoolEmailLink> {
    const [created] = await this.dbInstance.insert(mytoolEmailLinks).values(data).returning();
    return created;
  }

  async deleteEmailLink(id: number): Promise<void> {
    await this.dbInstance.delete(mytoolEmailLinks).where(eq(mytoolEmailLinks.id, id));
  }

  // My Tool - DoD Templates
  async getMytoolDodTemplates(): Promise<MytoolDodTemplate[]> {
    return this.dbInstance.select().from(mytoolDodTemplates).orderBy(mytoolDodTemplates.name);
  }
  async createMytoolDodTemplate(data: InsertMytoolDodTemplate): Promise<MytoolDodTemplate> {
    const [created] = await this.dbInstance.insert(mytoolDodTemplates).values({ ...data, createdAt: new Date() }).returning();
    return created;
  }
  async deleteMytoolDodTemplate(id: number): Promise<void> {
    await this.dbInstance.delete(mytoolDodTemplates).where(eq(mytoolDodTemplates.id, id));
  }

  // My Tool - User Preferences
  async getMytoolUserPreferences(ownerUserId: number): Promise<MytoolUserPreferences | undefined> {
    const [prefs] = await this.dbInstance.select().from(mytoolUserPreferences)
      .where(eq(mytoolUserPreferences.ownerUserId, ownerUserId));
    return prefs;
  }

  async upsertMytoolUserPreferences(data: InsertMytoolUserPreferences): Promise<MytoolUserPreferences> {
    const now = new Date();
    const existing = await this.getMytoolUserPreferences(data.ownerUserId);
    if (existing) {
      const [updated] = await this.dbInstance.update(mytoolUserPreferences)
        .set({ ...data, updatedAt: now })
        .where(eq(mytoolUserPreferences.ownerUserId, data.ownerUserId))
        .returning();
      return updated;
    }
    const [created] = await this.dbInstance.insert(mytoolUserPreferences).values({ ...data, updatedAt: now }).returning();
    return created;
  }

  // My Tool - Settings
  async getMytoolSettings(): Promise<any> {
    const [settings] = await this.dbInstance.select().from(mytoolSettings);
    if (!settings) {
      return { enabled: true, allowedRoles: 'admin', defaultPriorityHorizon: 'week' };
    }
    return settings;
  }

  async updateMytoolSettings(data: any): Promise<any> {
    const [existing] = await this.dbInstance.select().from(mytoolSettings);
    if (existing) {
      const [updated] = await this.dbInstance.update(mytoolSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(mytoolSettings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await this.dbInstance.insert(mytoolSettings).values({ ...data, updatedAt: new Date() }).returning();
    return created;
  }
  // Error Logs
  async createErrorLog(log: InsertErrorLog): Promise<ErrorLog> {
    const [result] = await this.dbInstance.insert(errorLogs).values(log).returning();
    return result;
  }

  // Support Tickets
  async createSupportTicket(ticket: InsertSupportTicket): Promise<SupportTicket> {
    const [result] = await this.dbInstance.insert(supportTickets).values(ticket).returning();
    return result;
  }

  async getSupportTickets(): Promise<SupportTicket[]> {
    return this.dbInstance.select().from(supportTickets).orderBy(desc(supportTickets.createdAt));
  }

  // SharePoint Settings
  async getSpSettings(): Promise<SpSettings | undefined> {
    const [row] = await this.dbInstance.select().from(spSettings);
    return row;
  }

  async upsertSpSettings(data: InsertSpSettings): Promise<SpSettings> {
    const existing = await this.getSpSettings();
    if (existing) {
      const [updated] = await this.dbInstance.update(spSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(spSettings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await this.dbInstance.insert(spSettings).values(data).returning();
    return created;
  }

  // SharePoint Files
  async getAllSpFiles(): Promise<SpFile[]> {
    return this.dbInstance.select().from(spFiles).orderBy(desc(spFiles.createdAt));
  }

  async getSpFile(id: number): Promise<SpFile | undefined> {
    const [row] = await this.dbInstance.select().from(spFiles).where(eq(spFiles.id, id));
    return row;
  }

  async getSpFileByItemId(siteId: string, driveId: string, itemId: string): Promise<SpFile | undefined> {
    const [row] = await this.dbInstance.select().from(spFiles)
      .where(and(eq(spFiles.siteId, siteId), eq(spFiles.driveId, driveId), eq(spFiles.itemId, itemId)));
    return row;
  }

  async upsertSpFile(data: InsertSpFile): Promise<SpFile> {
    const existing = await this.getSpFileByItemId(data.siteId, data.driveId, data.itemId);
    if (existing) {
      const [updated] = await this.dbInstance.update(spFiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(spFiles.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await this.dbInstance.insert(spFiles).values(data).returning();
    return created;
  }

  async deactivateSpFile(id: number): Promise<void> {
    await this.dbInstance.update(spFiles)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(spFiles.id, id));
  }

  // Import Runs
  async getAllImportRuns(): Promise<ImportRun[]> {
    return this.dbInstance.select().from(importRuns).orderBy(desc(importRuns.startedAt));
  }

  async getImportRun(id: number): Promise<ImportRun | undefined> {
    const [row] = await this.dbInstance.select().from(importRuns).where(eq(importRuns.id, id));
    return row;
  }

  async createImportRun(data: InsertImportRun): Promise<ImportRun> {
    const [row] = await this.dbInstance.insert(importRuns).values(data).returning();
    return row;
  }

  async updateImportRun(id: number, data: Partial<ImportRun>): Promise<ImportRun> {
    const [row] = await this.dbInstance.update(importRuns).set(data).where(eq(importRuns.id, id)).returning();
    return row;
  }

  // Change Ledger
  async getAllChangeLedger(filters?: { runId?: number; fileId?: number; eventType?: string; importStatus?: string }): Promise<ChangeLedger[]> {
    const conditions: any[] = [];
    if (filters?.runId !== undefined) conditions.push(eq(changeLedger.runId, filters.runId));
    if (filters?.fileId !== undefined) conditions.push(eq(changeLedger.fileId, filters.fileId));
    if (filters?.eventType !== undefined) conditions.push(eq(changeLedger.eventType, filters.eventType as any));
    if (filters?.importStatus !== undefined) conditions.push(eq(changeLedger.importStatus, filters.importStatus as any));

    if (conditions.length > 0) {
      return this.dbInstance.select().from(changeLedger).where(and(...conditions)).orderBy(desc(changeLedger.detectedAt));
    }
    return this.dbInstance.select().from(changeLedger).orderBy(desc(changeLedger.detectedAt));
  }

  async getChangeLedgerEntry(id: number): Promise<ChangeLedger | undefined> {
    const [row] = await this.dbInstance.select().from(changeLedger).where(eq(changeLedger.id, id));
    return row;
  }

  async createChangeLedgerEntry(data: InsertChangeLedger): Promise<ChangeLedger> {
    const [row] = await this.dbInstance.insert(changeLedger).values(data).returning();
    return row;
  }

  async updateChangeLedgerEntry(id: number, data: Partial<ChangeLedger>): Promise<ChangeLedger> {
    const [row] = await this.dbInstance.update(changeLedger).set(data).where(eq(changeLedger.id, id)).returning();
    return row;
  }

  async getPendingLedgerEntries(): Promise<ChangeLedger[]> {
    return this.dbInstance.select().from(changeLedger).where(eq(changeLedger.importStatus, 'pending')).orderBy(desc(changeLedger.detectedAt));
  }

  async getFailedLedgerEntries(): Promise<ChangeLedger[]> {
    return this.dbInstance.select().from(changeLedger).where(eq(changeLedger.importStatus, 'failed')).orderBy(desc(changeLedger.detectedAt));
  }

  // Snapshots
  async getAllSnapshots(fileId?: number): Promise<Snapshot[]> {
    if (fileId !== undefined) {
      return this.dbInstance.select().from(snapshots).where(eq(snapshots.fileId, fileId)).orderBy(desc(snapshots.importedAt));
    }
    return this.dbInstance.select().from(snapshots).orderBy(desc(snapshots.importedAt));
  }

  async getSnapshot(id: number): Promise<Snapshot | undefined> {
    const [row] = await this.dbInstance.select().from(snapshots).where(eq(snapshots.id, id));
    return row;
  }

  async getLatestSnapshotForFile(fileId: number): Promise<Snapshot | undefined> {
    const [row] = await this.dbInstance.select().from(snapshots)
      .where(eq(snapshots.fileId, fileId))
      .orderBy(desc(snapshots.importedAt))
      .limit(1);
    return row;
  }

  async createSnapshot(data: InsertSnapshot): Promise<Snapshot> {
    const [row] = await this.dbInstance.insert(snapshots).values(data).returning();
    return row;
  }

  // Snapshot Metrics
  async getSnapshotMetrics(snapshotId: number): Promise<SnapshotMetric[]> {
    return this.dbInstance.select().from(snapshotMetrics).where(eq(snapshotMetrics.snapshotId, snapshotId));
  }

  async createSnapshotMetric(data: InsertSnapshotMetric): Promise<SnapshotMetric> {
    const [row] = await this.dbInstance.insert(snapshotMetrics).values(data).returning();
    return row;
  }

  async createManySnapshotMetrics(data: InsertSnapshotMetric[]): Promise<SnapshotMetric[]> {
    if (data.length === 0) return [];
    return this.dbInstance.insert(snapshotMetrics).values(data).returning();
  }

}

export const storage = new DatabaseStorage();
