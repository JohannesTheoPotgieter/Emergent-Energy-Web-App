import { db, getDbMode } from "./db";
import { UsersRepository } from "./repositories/users-repository";
import { WorkManagementRepository } from "./repositories/work-management-repository";
import { SupportTicketsRepository } from "./repositories/support-tickets-repository";
import { MytoolStateRepository } from "./repositories/mytool-state-repository";
import { ProjectSupportRepository } from "./repositories/project-support-repository";
import { FinanceSupportRepository } from "./repositories/finance-support-repository";
import { FinanceTemporalRepository } from "./repositories/finance-temporal-repository";
import { FinanceInflowsRepository } from "./repositories/finance-inflows-repository";
import { FinanceExpenseEngineRepository } from "./repositories/finance-expense-engine-repository";
import { ProjectInfoRepository } from "./repositories/project-info-repository";
import { ProjectInfoReadRepository } from "./repositories/project-info-read-repository";
import { ProjectStateRepository } from "./repositories/project-state-repository";
import { LegacyProjectReadRepository } from "./repositories/legacy-project-read-repository";
import { softCloseByProjectName } from "./lib/temporal-helpers";
import { eq, desc, and, or, gte, lte, isNull, sql, inArray, not, ilike } from "drizzle-orm";
import {
  users, uploadMetadata, refreshLogs,
  projectInfo, normalizedCostLines, normalizedRevenueLines, workItems, projectPlan,
  cashflowPoints, financeRevenueMonthly, financeCosMonthly,
  workingPlanScenario, projectPlanDependency,
  workingPlanDependencyOverride, scheduleChangeNotice,
  taskComments, taskChecklists, taskChecklistItems, taskAttachments, taskActivityLog, writebackMappings, writebackAuditLog,
  type User, type InsertUser,
  type Project,
  type Expense, type InsertExpense,
  type Revenue, type InsertRevenue,
  type Task, type InsertTask,
  type Budget, type InsertBudget,
  type UploadMetadata, type InsertUploadMetadata,
  type RefreshLog, type InsertRefreshLog,
  type ProjectInfo, type InsertProjectInfo,
  type ExpenseLine, type InsertExpenseLine,
  type InflowLine, type InsertInflowLine,
  type ProjectPlan, type InsertProjectPlan,
  type CashflowPoint, type InsertCashflowPoint,
  type FinanceRevenueMonthly, type InsertFinanceRevenueMonthly,
  type FinanceCosMonthly, type InsertFinanceCosMonthly,
  type WorkingPlanScenario, type InsertWorkingPlanScenario,
  type ProjectPlanDependency, type InsertProjectPlanDependency,
  type WorkingPlanDependencyOverride, type InsertWorkingPlanDependencyOverride,
  type ScheduleChangeNotice, type InsertScheduleChangeNotice,
  type ProjectRevenueSummary, type InsertProjectRevenueSummary,
  type HomeNotes, type InsertHomeNotes,
  type ProjectEditableFields, type InsertProjectEditableFields,
  type CashflowWeeklyManual, type InsertCashflowWeeklyManual,
  type CashflowBalanceHistory, type InsertCashflowBalanceHistory,
  type OpexBudgetMonthly, type InsertOpexBudgetMonthly,
  type OpexWeeklyManual, type InsertOpexWeeklyManual,
  type AvailablePaymentOverride, type InsertAvailablePaymentOverride,
  type AvailablePaymentHistory, type InsertAvailablePaymentHistory,
  type TrackerMonthlyManual, type InsertTrackerMonthlyManual,
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
  mytoolTimeblocks,
  errorLogs, supportTickets,
  type MytoolTimeblock, type InsertMytoolTimeblock,
  type MytoolDailyReview, type InsertMytoolDailyReview,
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
  getAllProjectInfo(): Promise<any[]>;
  upsertProjectInfo(info: InsertProjectInfo): Promise<ProjectInfo>;
  updateProjectInfoById(id: number, fields: Partial<InsertProjectInfo>): Promise<ProjectInfo | undefined>;
  deleteProjectInfo(projectName: string): Promise<void>;
  markProjectsActive(activeNames: string[]): Promise<void>;
  getProjectCounts(): Promise<{ active: number; historical: number; total: number }>;

  // Program Expense (new)
  // Canonical cost-line read for cashflow — reads normalized_cost_lines only,
  // bypassing the program_expense merge. Returns adapted expense-shaped rows.
  getAllCostLinesForCashflow(): Promise<any[]>;
  createManyProgramExpenses(expenses: InsertExpenseLine[]): Promise<ExpenseLine[]>;
  deleteProgramExpensesByProject(projectName: string): Promise<void>;
  updateProgramExpenseFields(id: number, fields: Record<string, any>): Promise<ExpenseLine | undefined>;
  updateProgramInflowFields(id: number, fields: Record<string, any>): Promise<any | undefined>;

  // Program Inflows (new)
  getAllProgramInflows(): Promise<InflowLine[]>;
  getProgramInflowsByProject(projectName: string, opts?: { applyOverrides?: boolean }): Promise<InflowLine[]>;
  // Canonical revenue-line read for cashflow — reads normalized_revenue_lines only.
  getAllRevenueLinesForCashflow(): Promise<any[]>;
  createManyProgramInflows(inflows: InsertInflowLine[]): Promise<InflowLine[]>;
  deleteProgramInflowsByProject(projectName: string): Promise<void>;

  // Project Plan (new)
  getAllProjectPlans(): Promise<ProjectPlan[]>;
  getProjectPlansByProject(projectName: string): Promise<ProjectPlan[]>;
  createManyProjectPlans(plans: InsertProjectPlan[]): Promise<ProjectPlan[]>;
  deleteProjectPlansByProject(projectName: string): Promise<void>;

  // Plan overrides (collapsed into direct work-item edits)
  upsertManyProjectPlanOverrides(
    overrides: Array<{ projectName: string; rowNumber: number; fieldName: string; overrideValue: any; createdBy?: number }>
  ): Promise<Array<{ projectName: string; rowNumber: number; fieldName: string; overrideValue: any }>>;
  deleteProjectPlanOverridesByProject(projectName: string): Promise<void>;

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

  // Working Plan Scenarios
  getActiveScenario(projectName: string): Promise<WorkingPlanScenario | undefined>;
  getOrCreateActiveScenario(projectName: string): Promise<WorkingPlanScenario>;
  resetScenario(scenarioId: number): Promise<void>;

  // Working Plan Task Overrides
  getTaskOverridesByScenario(scenarioId: number): Promise<any[]>;
  createTaskOverride(override: any): Promise<any>;
  updateTaskOverride(id: number, data: Partial<any>): Promise<any | undefined>;
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
  createManualExpense(data: InsertExpenseLine & { projectName?: string; idempotencyKey?: string; projectId?: number }): Promise<ExpenseLine>;

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
  getTrackerMonthlyManual(trackerType: string, projectInfoId?: number | null): Promise<TrackerMonthlyManual[]>;
  upsertTrackerMonthlyManual(data: InsertTrackerMonthlyManual): Promise<TrackerMonthlyManual>;

  // Operational Tasks (now backed by work_items)
  getAllOperationalTasks(): Promise<any[]>;
  getOperationalTasksByProject(projectName: string): Promise<any[]>;
  getOperationalTask(id: number): Promise<any | undefined>;
  createOperationalTask(data: any): Promise<any>;
  updateOperationalTask(id: number, data: any): Promise<any>;
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

  // My Tool - Tasks (unified: backed by work_items with workstream='PERSONAL')
  getMytoolTasks(ownerUserId: number): Promise<any[]>;
  getMytoolTasksByDate(ownerUserId: number, date: string): Promise<any[]>;
  getMytoolTask(id: number): Promise<any | undefined>;
  createMytoolTask(data: any): Promise<any>;
  updateMytoolTask(id: number, data: any): Promise<any>;
  deleteMytoolTask(id: number): Promise<void>;

  // My Tool - Timeblocks
  getMytoolTimeblocks(ownerUserId: number, date: string): Promise<MytoolTimeblock[]>;
  createMytoolTimeblock(data: InsertMytoolTimeblock): Promise<MytoolTimeblock>;
  updateMytoolTimeblock(id: number, data: Partial<InsertMytoolTimeblock>): Promise<MytoolTimeblock>;
  deleteMytoolTimeblock(id: number): Promise<void>;

  // My Tool - Daily Reviews
  getMytoolDailyReview(ownerUserId: number, date: string): Promise<MytoolDailyReview | undefined>;
  upsertMytoolDailyReview(data: InsertMytoolDailyReview): Promise<MytoolDailyReview>;

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
  private readonly workManagementRepository: WorkManagementRepository;
  private readonly supportTicketsRepository: SupportTicketsRepository;
  private readonly mytoolStateRepository: MytoolStateRepository;
  private readonly projectSupportRepository: ProjectSupportRepository;
  private readonly financeSupportRepository: FinanceSupportRepository;
  private readonly financeTemporalRepository: FinanceTemporalRepository;
  private readonly financeInflowsRepository: FinanceInflowsRepository;
  private readonly financeExpenseEngineRepository: FinanceExpenseEngineRepository;
  private readonly projectInfoRepository: ProjectInfoRepository;
  private readonly projectInfoReadRepository: ProjectInfoReadRepository;
  private readonly projectStateRepository: ProjectStateRepository;
  private readonly legacyProjectReadRepository: LegacyProjectReadRepository;

  // Getter that always returns the current db (handles dynamic switching)
  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
    this.usersRepository = new UsersRepository(this.dbInstance);
    this.workManagementRepository = new WorkManagementRepository(this.dbInstance);
    this.supportTicketsRepository = new SupportTicketsRepository(this.dbInstance);
    this.mytoolStateRepository = new MytoolStateRepository(this.dbInstance);
    this.projectSupportRepository = new ProjectSupportRepository(this.dbInstance);
    this.financeSupportRepository = new FinanceSupportRepository(this.dbInstance);
    this.financeTemporalRepository = new FinanceTemporalRepository(this.dbInstance);
    this.financeInflowsRepository = new FinanceInflowsRepository(this.dbInstance);
    this.financeExpenseEngineRepository = new FinanceExpenseEngineRepository(this.dbInstance);
    this.projectInfoRepository = new ProjectInfoRepository(this.dbInstance);
    this.projectInfoReadRepository = new ProjectInfoReadRepository(this.dbInstance);
    this.projectStateRepository = new ProjectStateRepository(this.dbInstance);
    this.legacyProjectReadRepository = new LegacyProjectReadRepository(this.dbInstance);
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

  private mapCostLineToLegacyExpense(line: typeof normalizedCostLines.$inferSelect, projectId: number): Expense {
    return {
      id: line.id,
      projectId,
      category: (line.costCategory || "Other") as any,
      description: line.description || line.counterpartyName || "",
      amount: line.amountExVat || "0",
      date: line.invoiceDate || line.approvedDate || line.paidDate || "",
      vendor: line.counterpartyName || "",
      invoiceNumber: line.invoiceNumber,
      status: (line.status === "paid" ? "Paid" : line.status === "approved" ? "Approved" : "Forecast") as any,
      sourceSheet: line.sourceSheet || "normalized_cost_lines",
      rowLocator: line.sourceRow,
      createdAt: new Date(),
    };
  }

  private mapRevenueLineToLegacyRevenue(line: typeof normalizedRevenueLines.$inferSelect, projectId: number): Revenue {
    return {
      id: line.id,
      projectId,
      type: (line.milestoneName ? "Milestone" : "Other") as any,
      amount: line.amountExVat || "0",
      date: line.invoiceDate || line.expectedPaymentDate || line.paidDate || "",
      status: (line.status === "paid" ? "Paid" : line.status === "invoiced" ? "Invoiced" : "Forecast") as any,
      sourceSheet: line.sourceSheet || "normalized_revenue_lines",
      rowLocator: line.sourceRow,
      createdAt: new Date(),
    };
  }

  private mapWorkItemToLegacyTask(item: typeof workItems.$inferSelect, projectId: number): Task {
    return {
      id: item.id,
      projectId,
      taskName: item.title,
      startDate: item.startDate || item.scheduledDate || "",
      endDate: item.endDate || item.actualEnd || "",
      progress: Math.round(Number(item.percentComplete || 0) * 100),
      status: (item.status || "Not Started") as any,
      assignee: item.ownerName || "",
      sourceSheet: item.sourceSheet || "work_items",
      rowLocator: item.sourceRow,
      createdAt: item.createdAt,
    };
  }

  // Projects (legacy) — delegated to LegacyProjectReadRepository
  async getAllProjects(): Promise<Project[]> {
    return this.legacyProjectReadRepository.getAll();
  }

  async getProject(id: number): Promise<Project | undefined> {
    return this.legacyProjectReadRepository.getById(id);
  }

  // Expenses (legacy)
  async getAllExpenses(): Promise<Expense[]> {
    const lines = await this.dbInstance.select().from(normalizedCostLines).where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt))).orderBy(desc(normalizedCostLines.id));
    const projectMap = new Map((await this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo)).map((p: any) => [p.projectName, p.id]));
    return lines.map((line: any) => this.mapCostLineToLegacyExpense(line, projectMap.get(line.projectName) ?? line.projectId ?? 0));
  }

  async getExpensesByProject(projectId: number): Promise<Expense[]> {
    const [project] = await this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId));
    if (!project?.projectName) return [];
    const lines = await this.dbInstance.select().from(normalizedCostLines).where(and(eq(normalizedCostLines.projectName, project.projectName), and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)))).orderBy(desc(normalizedCostLines.id));
    return lines.map((line: any) => this.mapCostLineToLegacyExpense(line, projectId));
  }

  async createExpense(expense: InsertExpense): Promise<Expense> {
    // Explicitly provide timestamp for SQLite compatibility
    const [project] = await this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, expense.projectId));
    const [created] = await this.dbInstance.insert(normalizedCostLines).values({
      projectId: expense.projectId,
      projectName: project?.projectName || "",
      costCategory: expense.category,
      description: expense.description,
      amountExVat: String(expense.amount),
      invoiceNumber: expense.invoiceNumber || null,
      invoiceDate: expense.date,
      counterpartyName: expense.vendor,
      status: "planned",
      sourceSheet: expense.sourceSheet,
      sourceRow: expense.rowLocator,
    } as any).returning();
    return this.mapCostLineToLegacyExpense(created, expense.projectId);
  }

  async createManyExpenses(expenseList: InsertExpense[]): Promise<Expense[]> {
    if (expenseList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const created: Expense[] = [];
    for (const expense of expenseList) {
      created.push(await this.createExpense(expense));
    }
    return created;
  }

  async deleteExpensesByProject(projectId: number): Promise<void> {
    const [project] = await this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId));
    if (!project?.projectName) return;
    // Temporal: soft-close instead of hard delete (Prompt 10)
    await softCloseByProjectName(this.dbInstance, "normalized_cost_lines", project.projectName);
  }

  // Revenues (legacy)
  async getAllRevenues(): Promise<Revenue[]> {
    const lines = await this.dbInstance.select().from(normalizedRevenueLines).where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))).orderBy(desc(normalizedRevenueLines.id));
    const projectMap = new Map((await this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo)).map((p: any) => [p.projectName, p.id]));
    return lines.map((line: any) => this.mapRevenueLineToLegacyRevenue(line, projectMap.get(line.projectName) ?? line.projectId ?? 0));
  }

  async getRevenuesByProject(projectId: number): Promise<Revenue[]> {
    const [project] = await this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId));
    if (!project?.projectName) return [];
    const lines = await this.dbInstance.select().from(normalizedRevenueLines).where(and(eq(normalizedRevenueLines.projectName, project.projectName), and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt)))).orderBy(desc(normalizedRevenueLines.id));
    return lines.map((line: any) => this.mapRevenueLineToLegacyRevenue(line, projectId));
  }

  async createRevenue(revenue: InsertRevenue): Promise<Revenue> {
    // Explicitly provide timestamp for SQLite compatibility
    const [project] = await this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, revenue.projectId));
    const [created] = await this.dbInstance.insert(normalizedRevenueLines).values({
      projectId: revenue.projectId,
      projectName: project?.projectName || "",
      milestoneName: revenue.type,
      amountExVat: String(revenue.amount),
      invoiceDate: revenue.date,
      status: "planned",
      sourceSheet: revenue.sourceSheet,
      sourceRow: revenue.rowLocator,
      importRunId: 1,
    } as any).returning();
    return this.mapRevenueLineToLegacyRevenue(created, revenue.projectId);
  }

  async createManyRevenues(revenueList: InsertRevenue[]): Promise<Revenue[]> {
    if (revenueList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const created: Revenue[] = [];
    for (const revenue of revenueList) {
      created.push(await this.createRevenue(revenue));
    }
    return created;
  }

  async deleteRevenuesByProject(projectId: number): Promise<void> {
    const [project] = await this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId));
    if (!project?.projectName) return;
    // Temporal: soft-close instead of hard delete (Prompt 10)
    await softCloseByProjectName(this.dbInstance, "normalized_revenue_lines", project.projectName);
  }

  // Tasks (legacy)
  async getAllTasks(): Promise<Task[]> {
    const items = await this.dbInstance.select().from(workItems).where(isNull(workItems.deletedAt)).orderBy(desc(workItems.createdAt));
    const projectMap = new Map((await this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo)).map((p: any) => [p.projectName, p.id]));
    return items.map((item: any) => this.mapWorkItemToLegacyTask(item, projectMap.get(item.projectName) ?? item.projectId ?? 0));
  }

  async getTasksByProject(projectId: number): Promise<Task[]> {
    const [project] = await this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId));
    if (!project?.projectName) return [];
    const items = await this.dbInstance.select().from(workItems).where(and(eq((workItems as any).projectName, project.projectName), isNull(workItems.deletedAt))).orderBy(desc(workItems.createdAt));
    return items.map((item: any) => this.mapWorkItemToLegacyTask(item, projectId));
  }

  async createTask(task: InsertTask): Promise<Task> {
    const [project] = await this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, task.projectId));
    const [created] = await this.dbInstance.insert(workItems).values({
      projectId: task.projectId,
      projectName: project?.projectName || "",
      title: task.taskName,
      status: task.status,
      startDate: task.startDate,
      endDate: task.endDate,
      percentComplete: Number(task.progress || 0) / 100,
      ownerName: task.assignee,
      sourceSheet: task.sourceSheet,
      sourceRow: task.rowLocator,
    } as any).returning();
    return this.mapWorkItemToLegacyTask(created, task.projectId);
  }

  async createManyTasks(taskList: InsertTask[]): Promise<Task[]> {
    if (taskList.length === 0) return [];
    const created: Task[] = [];
    for (const task of taskList) {
      created.push(await this.createTask(task));
    }
    return created;
  }

  async deleteTasksByProject(projectId: number): Promise<void> {
    const [project] = await this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, projectId));
    if (!project?.projectName) return;
    await this.dbInstance.update(workItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq((workItems as any).projectName, project.projectName));
  }

  // Budgets
  // budgets table dropped — return empty (no client consumers)
  async getAllBudgets(): Promise<Budget[]> { return []; }
  async getBudgetsByProject(_projectId: number): Promise<Budget[]> { return []; }
  async createBudget(_budget: InsertBudget): Promise<Budget> { return {} as Budget; }
  async deleteBudget(_id: number): Promise<boolean> { return false; }

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
    return this.projectInfoReadRepository.getByName(projectName);
  }

  async getProjectInfoById(id: number): Promise<ProjectInfo | undefined> {
    return this.projectInfoReadRepository.getById(id);
  }

  async updateProjectInfoById(id: number, fields: Partial<InsertProjectInfo>): Promise<ProjectInfo | undefined> {
    return this.projectInfoRepository.updateById(id, fields);
  }

  async getAllProjectInfo(): Promise<any[]> {
    return this.projectInfoReadRepository.getAll();
  }

  async upsertProjectInfo(info: InsertProjectInfo): Promise<ProjectInfo> {
    const existing = await this.getProjectInfo((info as any).projectName);
    return this.projectInfoRepository.upsert(info, existing);
  }

  async deleteProjectInfo(projectName: string): Promise<void> {
    await this.dbInstance.delete(projectInfo).where(eq(projectInfo.projectName, projectName));
  }

  async markProjectsActive(activeNames: string[]): Promise<void> {
    return this.projectStateRepository.markProjectsActive(activeNames);
  }

  async getProjectCounts(): Promise<{ active: number; historical: number; total: number }> {
    return this.projectStateRepository.getProjectCounts();
  }

  async getAllCostLinesForCashflow(): Promise<any[]> {
    return this.financeExpenseEngineRepository.getAllCostLinesForCashflow();
  }

  async createManyProgramExpenses(expenseList: InsertExpenseLine[]): Promise<ExpenseLine[]> {
    return this.financeExpenseEngineRepository.createManyProgramExpenses(expenseList);
  }

  async deleteProgramExpensesByProject(projectName: string): Promise<void> {
    return this.financeExpenseEngineRepository.deleteProgramExpensesByProject(projectName);
  }

  async updateProgramExpenseFields(id: number, fields: Record<string, any>, expectedUpdatedAt?: string): Promise<ExpenseLine | undefined> {
    return this.financeExpenseEngineRepository.updateProgramExpenseFields(id, fields, expectedUpdatedAt);
  }

  async updateProgramInflowFields(id: number, fields: Record<string, any>): Promise<any | undefined> {
    return this.financeInflowsRepository.updateProgramInflowFields(id, fields);
  }

  async getAllProgramInflows(): Promise<any[]> {
    return this.financeInflowsRepository.getAllProgramInflows();
  }

  async getAllRevenueLinesForCashflow(): Promise<any[]> {
    return this.financeInflowsRepository.getAllRevenueLinesForCashflow();
  }

  async getProgramInflowsByProject(projectName: string, opts?: { applyOverrides?: boolean }): Promise<any[]> {
    return this.financeInflowsRepository.getProgramInflowsByProject(projectName, opts);
  }

  async createManyProgramInflows(inflowList: InsertInflowLine[]): Promise<InflowLine[]> {
    return this.financeInflowsRepository.createManyProgramInflows(inflowList);
  }

  async deleteProgramInflowsByProject(projectName: string): Promise<void> {
    return this.financeInflowsRepository.deleteProgramInflowsByProject(projectName);
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
      trueActualStart: wi.actualStart || wi.startDate || null,
      trueActualEnd: wi.actualEnd || wi.endDate || null,
    } as unknown as ProjectPlan;
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
    return rows.map((wi: any) => this.mapWorkItemToProjectPlan(wi, (wi.projectId ? piNameMap.get(wi.projectId) : null) as string || ""));
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
    const projectNames = Array.from(new Set(planList.map((p: any) => p.projectName)));
    const piRows = await this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo).where(inArray(projectInfo.projectName, projectNames));
    const piMap = new Map(piRows.map((p: any) => [p.projectName, p.id]));
    const now = new Date();
    const wiValues = planList.map((p: any) => ({
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
    return results.map((wi: any) => this.mapWorkItemToProjectPlan(wi, (planList[0] as any)?.projectName || ""));
  }

  async deleteProjectPlansByProject(projectName: string): Promise<void> {
    const scenarioIds = await this.dbInstance
      .select({ id: workingPlanScenario.id })
      .from(workingPlanScenario)
      .where(eq(workingPlanScenario.projectName, projectName));
    if (scenarioIds.length > 0) {
      const sIds = scenarioIds.map((s: any) => s.id);
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

  /**
   * Applies inline field overrides to work-item backed project plan rows.
   * Replaces the removed project_plan_overrides table — edits are applied
   * directly to the work_items row identified by sourceRow + projectName.
   */
  async upsertManyProjectPlanOverrides(
    overrides: Array<{ projectName: string; rowNumber: number; fieldName: string; overrideValue: any; createdBy?: number }>
  ): Promise<Array<{ projectName: string; rowNumber: number; fieldName: string; overrideValue: any }>> {
    const PLAN_FIELD_TO_WI: Record<string, string> = {
      highLevelProgramme: "title",
      actualStart: "startDate",
      durationDays: "duration",
      actualEnd: "endDate",
      actualPctComplete: "percentComplete",
      expectedPctComplete: "expectedPctComplete",
      taskNo: "wbsCode",
    };

    const results: typeof overrides = [];

    for (const o of overrides) {
      const wiColumn = PLAN_FIELD_TO_WI[o.fieldName] || o.fieldName;
      const piRow = await this.dbInstance.select({ id: projectInfo.id }).from(projectInfo)
        .where(eq(projectInfo.projectName, o.projectName)).limit(1);
      if (piRow.length === 0) continue;

      const matchingRows = await this.dbInstance.select({ id: workItems.id }).from(workItems)
        .where(and(
          eq(workItems.projectId, piRow[0].id),
          eq(workItems.workstream, "PM"),
          eq(workItems.source, "SMART_IMPORT"),
          eq(workItems.sourceRow, o.rowNumber),
          isNull(workItems.deletedAt),
        )).limit(1);

      if (matchingRows.length > 0) {
        await this.dbInstance.update(workItems)
          .set({ [wiColumn]: o.overrideValue, updatedAt: new Date() } as any)
          .where(eq(workItems.id, matchingRows[0].id));
        results.push(o);
      }
    }

    return results;
  }

  /**
   * Soft-deletes all work-item backed plan rows for a project.
   * Replaces the removed deleteProjectPlanOverridesByProject.
   */
  async deleteProjectPlanOverridesByProject(projectName: string): Promise<void> {
    await this.deleteProjectPlansByProject(projectName);
  }

  // Cashflow Points (repository extracted)
  async getAllCashflowPoints(): Promise<CashflowPoint[]> {
    return this.financeTemporalRepository.getAllCashflowPoints();
  }

  async getCashflowPointsByProject(projectName: string): Promise<CashflowPoint[]> {
    return this.financeTemporalRepository.getCashflowPointsByProject(projectName);
  }

  async createManyCashflowPoints(pointList: InsertCashflowPoint[]): Promise<CashflowPoint[]> {
    return this.financeTemporalRepository.createManyCashflowPoints(pointList);
  }

  async deleteCashflowPointsByProject(projectName: string): Promise<void> {
    return this.financeTemporalRepository.deleteCashflowPointsByProject(projectName);
  }

  // Finance Revenue Monthly (repository extracted)
  async getAllFinanceRevenueMonthly(): Promise<FinanceRevenueMonthly[]> {
    return this.financeTemporalRepository.getAllFinanceRevenueMonthly();
  }

  async getFinanceRevenueMonthlyByProject(projectName: string): Promise<FinanceRevenueMonthly[]> {
    return this.financeTemporalRepository.getFinanceRevenueMonthlyByProject(projectName);
  }

  async createManyFinanceRevenueMonthly(dataList: InsertFinanceRevenueMonthly[]): Promise<FinanceRevenueMonthly[]> {
    return this.financeTemporalRepository.createManyFinanceRevenueMonthly(dataList);
  }

  async deleteFinanceRevenueMonthlyByProject(projectName: string): Promise<void> {
    return this.financeTemporalRepository.deleteFinanceRevenueMonthlyByProject(projectName);
  }

  // Finance COS Monthly (repository extracted)
  async getAllFinanceCosMonthly(): Promise<FinanceCosMonthly[]> {
    return this.financeTemporalRepository.getAllFinanceCosMonthly();
  }

  async getFinanceCosMonthlyByProject(projectName: string): Promise<FinanceCosMonthly[]> {
    return this.financeTemporalRepository.getFinanceCosMonthlyByProject(projectName);
  }

  async createManyFinanceCosMonthly(dataList: InsertFinanceCosMonthly[]): Promise<FinanceCosMonthly[]> {
    return this.financeTemporalRepository.createManyFinanceCosMonthly(dataList);
  }

  async deleteFinanceCosMonthlyByProject(projectName: string): Promise<void> {
    return this.financeTemporalRepository.deleteFinanceCosMonthlyByProject(projectName);
  }

  // ===================== INLINE EDIT METHODS (replaces override tables) =====================
  // These methods edit base table rows directly with snapshot/source tracking.

  async editBaseRowInline(
    tableName: string, rowId: number, fields: Record<string, any>, userId: number | null,
  ): Promise<void> {
    const { inlineEdit } = await import("./lib/inline-edit-helper");
    await inlineEdit(tableName, rowId, fields, userId, this.dbInstance);
  }

  async revertBaseRowToImported(tableName: string, rowId: number): Promise<boolean> {
    const { revertToImported } = await import("./lib/inline-edit-helper");
    return revertToImported(tableName, rowId, this.dbInstance);
  }

  async applyFieldOverridesInline(
    tableName: string, rowId: number,
    overrides: Array<{ fieldName: string; overrideValue: string | null }>,
    userId: number | null,
  ): Promise<void> {
    const { applyFieldOverrides } = await import("./lib/inline-edit-helper");
    await applyFieldOverrides(tableName, rowId, overrides, userId, this.dbInstance);
  }


  // Working Plan Scenarios
  async getActiveScenario(projectName: string): Promise<WorkingPlanScenario | undefined> {
    const [scenario] = await this.dbInstance.select()
      .from(workingPlanScenario)
      .where(and(
        eq(workingPlanScenario.projectName, projectName),
        eq(workingPlanScenario.isActive, true)
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
    await this.dbInstance.delete(workingPlanDependencyOverride)
      .where(eq(workingPlanDependencyOverride.scenarioId, scenarioId));
  }

  // Working Plan Task Overrides — table dropped (Cleanup Prompt 4)
  async getTaskOverridesByScenario(_scenarioId: number): Promise<any[]> { return []; }
  async createTaskOverride(_override: any): Promise<any> { return {}; }
  async updateTaskOverride(_id: number, _data: any): Promise<any> { return undefined; }
  async softDeleteTaskOverride(_id: number): Promise<void> {}

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
    await safeDelete(workingPlanScenario, "workingPlanScenario");
    await safeDelete(financeCosMonthly, "financeCosMonthly");
    await safeDelete(financeRevenueMonthly, "financeRevenueMonthly");
    await safeDelete(cashflowPoints, "cashflowPoints");
    await safeDelete(normalizedCostLines, "normalizedCostLines");
    await safeDelete(normalizedRevenueLines, "normalizedRevenueLines");
    await safeDelete(workItems, "workItems");
    await safeDelete(projectInfo, "projectInfo");
    await safeDelete(refreshLogs, "refreshLogs");
    await safeDelete(uploadMetadata, "uploadMetadata");
    // Legacy tables (projects, expenses, revenues, budgets, tasks) dropped
    // Data lives in project_info, normalized_cost_lines, normalized_revenue_lines, work_items

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

  // Project Revenue Summary (repository extracted)
  async getAllProjectRevenueSummaries(): Promise<ProjectRevenueSummary[]> {
    return this.financeTemporalRepository.getAllProjectRevenueSummaries();
  }

  async getProjectRevenueSummary(projectName: string): Promise<ProjectRevenueSummary | undefined> {
    return this.financeTemporalRepository.getProjectRevenueSummary(projectName);
  }

  async upsertProjectRevenueSummary(data: InsertProjectRevenueSummary): Promise<ProjectRevenueSummary> {
    return this.financeTemporalRepository.upsertProjectRevenueSummary(data);
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

  async createManualExpense(data: InsertExpenseLine & { idempotencyKey?: string; projectId?: number; projectName?: string }): Promise<ExpenseLine> {
    return this.financeExpenseEngineRepository.createManualExpense(data);
  }

  // Home Notes
  async getHomeNotes(): Promise<HomeNotes | undefined> {
    return this.projectSupportRepository.getHomeNotes();
  }

  async saveHomeNotes(notes: InsertHomeNotes): Promise<HomeNotes> {
    return this.projectSupportRepository.saveHomeNotes(notes);
  }

  async getProjectEditableFields(projectName: string): Promise<ProjectEditableFields | undefined> {
    return this.projectSupportRepository.getProjectEditableFields(projectName);
  }

  async getAllProjectEditableFields(): Promise<ProjectEditableFields[]> {
    return this.projectSupportRepository.getAllProjectEditableFields();
  }

  async upsertProjectEditableFields(data: InsertProjectEditableFields): Promise<ProjectEditableFields> {
    return this.projectSupportRepository.upsertProjectEditableFields(data);
  }

  async getAllCashflowWeeklyManual(): Promise<CashflowWeeklyManual[]> {
    return this.financeSupportRepository.getAllCashflowWeeklyManual();
  }

  async upsertCashflowWeeklyManual(weekStartDate: string, openingBalance: string): Promise<CashflowWeeklyManual> {
    return this.financeSupportRepository.upsertCashflowWeeklyManual(weekStartDate, openingBalance);
  }

  async deleteCashflowWeeklyManual(weekStartDate: string): Promise<void> {
    return this.financeSupportRepository.deleteCashflowWeeklyManual(weekStartDate);
  }

  async deleteAllCashflowWeeklyManualAfter(weekStartDate: string): Promise<string[]> {
    return this.financeSupportRepository.deleteAllCashflowWeeklyManualAfter(weekStartDate);
  }

  async getBalanceHistory(weekStartDate: string): Promise<CashflowBalanceHistory[]> {
    return this.financeSupportRepository.getBalanceHistory(weekStartDate);
  }

  async getAllBalanceHistory(): Promise<CashflowBalanceHistory[]> {
    return this.financeSupportRepository.getAllBalanceHistory();
  }

  async addBalanceHistory(entry: InsertCashflowBalanceHistory): Promise<CashflowBalanceHistory> {
    return this.financeSupportRepository.addBalanceHistory(entry);
  }

  async getAllOpexBudgetMonthly(): Promise<OpexBudgetMonthly[]> {
    return this.financeSupportRepository.getAllOpexBudgetMonthly();
  }

  async upsertOpexBudgetMonthly(monthKey: string, amount: string): Promise<OpexBudgetMonthly> {
    return this.financeSupportRepository.upsertOpexBudgetMonthly(monthKey, amount);
  }

  async getAllOpexWeeklyManual(): Promise<OpexWeeklyManual[]> {
    return this.financeSupportRepository.getAllOpexWeeklyManual();
  }

  async upsertOpexWeeklyManual(weekStartDate: string, opexAmount: string): Promise<OpexWeeklyManual> {
    return this.financeSupportRepository.upsertOpexWeeklyManual(weekStartDate, opexAmount);
  }

  async deleteOpexWeeklyManual(weekStartDate: string): Promise<void> {
    return this.financeSupportRepository.deleteOpexWeeklyManual(weekStartDate);
  }

  async getAllAvailablePaymentOverrides(): Promise<AvailablePaymentOverride[]> {
    return this.financeSupportRepository.getAllAvailablePaymentOverrides();
  }

  async upsertAvailablePaymentOverride(weekStartDate: string, overrideValue: string, reason: string | null, updatedBy: string | null): Promise<AvailablePaymentOverride> {
    return this.financeSupportRepository.upsertAvailablePaymentOverride(weekStartDate, overrideValue, reason, updatedBy);
  }

  async deleteAvailablePaymentOverride(weekStartDate: string): Promise<void> {
    return this.financeSupportRepository.deleteAvailablePaymentOverride(weekStartDate);
  }

  async getAvailablePaymentHistory(weekStartDate: string): Promise<AvailablePaymentHistory[]> {
    return this.financeSupportRepository.getAvailablePaymentHistory(weekStartDate);
  }

  async addAvailablePaymentHistory(entry: InsertAvailablePaymentHistory): Promise<AvailablePaymentHistory> {
    return this.financeSupportRepository.addAvailablePaymentHistory(entry);
  }

  async getTrackerMonthlyManual(trackerType: string, projectInfoId?: number | null): Promise<TrackerMonthlyManual[]> {
    return this.financeSupportRepository.getTrackerMonthlyManual(trackerType, projectInfoId ?? null);
  }

  async upsertTrackerMonthlyManual(data: InsertTrackerMonthlyManual): Promise<TrackerMonthlyManual> {
    return this.financeSupportRepository.upsertTrackerMonthlyManual(data);
  }

  // Operational and work-management domains (repository extracted)
  async getAllOperationalTasks(): Promise<any[]> { return this.workManagementRepository.getAllOperationalTasks(); }
  async getOperationalTasksByProject(projectName: string): Promise<any[]> { return this.workManagementRepository.getOperationalTasksByProject(projectName); }
  async getOperationalTask(id: number): Promise<any | undefined> { return this.workManagementRepository.getOperationalTask(id); }
  async createOperationalTask(data: any): Promise<any> { return this.workManagementRepository.createOperationalTask(data); }
  async updateOperationalTask(id: number, data: any): Promise<any> { return this.workManagementRepository.updateOperationalTask(id, data); }
  async deleteOperationalTask(id: number): Promise<void> { return this.workManagementRepository.deleteOperationalTask(id); }

  async getTaskComments(taskId: number): Promise<TaskComment[]> { return this.workManagementRepository.getTaskComments(taskId); }
  async createTaskComment(data: InsertTaskComment): Promise<TaskComment> { return this.workManagementRepository.createTaskComment(data); }
  async deleteTaskComment(id: number): Promise<void> { return this.workManagementRepository.deleteTaskComment(id); }

  async getTaskChecklists(taskId: number): Promise<TaskChecklist[]> { return this.workManagementRepository.getTaskChecklists(taskId); }
  async createTaskChecklist(data: InsertTaskChecklist): Promise<TaskChecklist> { return this.workManagementRepository.createTaskChecklist(data); }
  async deleteTaskChecklist(id: number): Promise<void> { return this.workManagementRepository.deleteTaskChecklist(id); }

  async getChecklistItems(checklistId: number): Promise<TaskChecklistItem[]> { return this.workManagementRepository.getChecklistItems(checklistId); }
  async createChecklistItem(data: InsertTaskChecklistItem): Promise<TaskChecklistItem> { return this.workManagementRepository.createChecklistItem(data); }
  async updateChecklistItem(id: number, data: Partial<InsertTaskChecklistItem>): Promise<TaskChecklistItem> { return this.workManagementRepository.updateChecklistItem(id, data); }
  async deleteChecklistItem(id: number): Promise<void> { return this.workManagementRepository.deleteChecklistItem(id); }

  async getTaskAttachments(taskId: number): Promise<TaskAttachment[]> { return this.workManagementRepository.getTaskAttachments(taskId); }
  async createTaskAttachment(data: InsertTaskAttachment): Promise<TaskAttachment> { return this.workManagementRepository.createTaskAttachment(data); }
  async deleteTaskAttachment(id: number): Promise<void> { return this.workManagementRepository.deleteTaskAttachment(id); }

  async getTaskActivityLog(taskId: number): Promise<TaskActivityLog[]> { return this.workManagementRepository.getTaskActivityLog(taskId); }
  async createTaskActivityLog(data: InsertTaskActivityLog): Promise<TaskActivityLog> { return this.workManagementRepository.createTaskActivityLog(data); }

  async getAllWritebackMappings(): Promise<WritebackMapping[]> { return this.workManagementRepository.getAllWritebackMappings(); }
  async getWritebackMapping(id: number): Promise<WritebackMapping | undefined> { return this.workManagementRepository.getWritebackMapping(id); }
  async createWritebackMapping(data: InsertWritebackMapping): Promise<WritebackMapping> { return this.workManagementRepository.createWritebackMapping(data); }
  async updateWritebackMapping(id: number, data: Partial<InsertWritebackMapping>): Promise<WritebackMapping> { return this.workManagementRepository.updateWritebackMapping(id, data); }
  async deleteWritebackMapping(id: number): Promise<void> { return this.workManagementRepository.deleteWritebackMapping(id); }

  async getWritebackAuditLogs(mappingId?: number): Promise<WritebackAuditLog[]> { return this.workManagementRepository.getWritebackAuditLogs(mappingId); }
  async createWritebackAuditLog(data: InsertWritebackAuditLog): Promise<WritebackAuditLog> { return this.workManagementRepository.createWritebackAuditLog(data); }
  async updateWritebackAuditLog(id: number, data: Partial<InsertWritebackAuditLog>): Promise<WritebackAuditLog> { return this.workManagementRepository.updateWritebackAuditLog(id, data); }

  async getKeyDateMappings(projectName: string): Promise<KeyDateMapping[]> { return this.workManagementRepository.getKeyDateMappings(projectName); }
  async createKeyDateMapping(data: InsertKeyDateMapping): Promise<KeyDateMapping> { return this.workManagementRepository.createKeyDateMapping(data); }
  async updateKeyDateMapping(id: number, data: Partial<InsertKeyDateMapping>): Promise<KeyDateMapping> { return this.workManagementRepository.updateKeyDateMapping(id, data); }
  async deleteKeyDateMapping(id: number): Promise<void> { return this.workManagementRepository.deleteKeyDateMapping(id); }

  async getMytoolTasks(ownerUserId: number): Promise<any[]> { return this.workManagementRepository.getMytoolTasks(ownerUserId); }
  async getMytoolTasksByDate(ownerUserId: number, date: string): Promise<any[]> { return this.workManagementRepository.getMytoolTasksByDate(ownerUserId, date); }
  async getMytoolTask(id: number): Promise<any | undefined> { return this.workManagementRepository.getMytoolTask(id); }
  async createMytoolTask(data: any): Promise<any> { return this.workManagementRepository.createMytoolTask(data); }
  async updateMytoolTask(id: number, data: any): Promise<any> { return this.workManagementRepository.updateMytoolTask(id, data); }
  async deleteMytoolTask(id: number): Promise<void> { return this.workManagementRepository.deleteMytoolTask(id); }

  async getMytoolTimeblocks(ownerUserId: number, date: string): Promise<MytoolTimeblock[]> { return this.workManagementRepository.getMytoolTimeblocks(ownerUserId, date); }
  async createMytoolTimeblock(data: InsertMytoolTimeblock): Promise<MytoolTimeblock> { return this.workManagementRepository.createMytoolTimeblock(data); }
  async updateMytoolTimeblock(id: number, data: Partial<InsertMytoolTimeblock>): Promise<MytoolTimeblock> { return this.workManagementRepository.updateMytoolTimeblock(id, data); }
  async deleteMytoolTimeblock(id: number): Promise<void> { return this.workManagementRepository.deleteMytoolTimeblock(id); }

  // My Tool - Daily Reviews
  async getMytoolDailyReview(ownerUserId: number, date: string): Promise<MytoolDailyReview | undefined> {
    return this.mytoolStateRepository.getMytoolDailyReview(ownerUserId, date);
  }

  async upsertMytoolDailyReview(data: InsertMytoolDailyReview): Promise<MytoolDailyReview> {
    return this.mytoolStateRepository.upsertMytoolDailyReview(data);
  }

  // My Tool - Email Links
  async getEmailLinksByTask(taskId: number): Promise<MytoolEmailLink[]> {
    return this.mytoolStateRepository.getEmailLinksByTask(taskId);
  }

  async getEmailLinksByOperationalTask(taskId: number): Promise<MytoolEmailLink[]> {
    return this.mytoolStateRepository.getEmailLinksByOperationalTask(taskId);
  }

  async getEmailLinksByPriority(priorityId: number): Promise<MytoolEmailLink[]> {
    return this.mytoolStateRepository.getEmailLinksByPriority(priorityId);
  }

  async createEmailLink(data: InsertMytoolEmailLink): Promise<MytoolEmailLink> {
    return this.mytoolStateRepository.createEmailLink(data);
  }

  async deleteEmailLink(id: number): Promise<void> {
    return this.mytoolStateRepository.deleteEmailLink(id);
  }

  // My Tool - DoD Templates
  async getMytoolDodTemplates(): Promise<MytoolDodTemplate[]> {
    return this.mytoolStateRepository.getMytoolDodTemplates();
  }
  async createMytoolDodTemplate(data: InsertMytoolDodTemplate): Promise<MytoolDodTemplate> {
    return this.mytoolStateRepository.createMytoolDodTemplate(data);
  }
  async deleteMytoolDodTemplate(id: number): Promise<void> {
    return this.mytoolStateRepository.deleteMytoolDodTemplate(id);
  }

  // My Tool - User Preferences
  async getMytoolUserPreferences(ownerUserId: number): Promise<MytoolUserPreferences | undefined> {
    return this.mytoolStateRepository.getMytoolUserPreferences(ownerUserId);
  }

  async upsertMytoolUserPreferences(data: InsertMytoolUserPreferences): Promise<MytoolUserPreferences> {
    return this.mytoolStateRepository.upsertMytoolUserPreferences(data);
  }

  // My Tool - Settings
  async getMytoolSettings(): Promise<any> {
    return this.mytoolStateRepository.getMytoolSettings();
  }

  async updateMytoolSettings(data: any): Promise<any> {
    return this.mytoolStateRepository.updateMytoolSettings(data);
  }
  // Error Logs
  async createErrorLog(log: InsertErrorLog): Promise<ErrorLog> {
    const [result] = await this.dbInstance.insert(errorLogs).values(log).returning();
    return result;
  }

  // Support Tickets
  async createSupportTicket(ticket: InsertSupportTicket): Promise<SupportTicket> {
    return this.supportTicketsRepository.create(ticket);
  }

  async getSupportTickets(): Promise<SupportTicket[]> {
    return this.supportTicketsRepository.list();
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
    const existing = await this.getSpFileByItemId((data as any).siteId, (data as any).driveId, (data as any).itemId);
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
