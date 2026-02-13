import { db, getDbMode } from "./db";
import { eq, desc, and, gte, lte, isNotNull, isNull, sql, inArray, count, not } from "drizzle-orm";
import {
  users, projects, expenses, revenues, tasks, budgets, uploadMetadata, refreshLogs,
  projectInfo, programExpense, programInflows, projectPlan,
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
} from "@shared/schema";

export interface IStorage {
  // Transaction support
  transaction<T>(callback: (txStorage: IStorage) => Promise<T>): Promise<T>;
  
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
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
  getAllProjectInfo(): Promise<ProjectInfo[]>;
  upsertProjectInfo(info: InsertProjectInfo): Promise<ProjectInfo>;
  deleteProjectInfo(projectName: string): Promise<void>;
  markProjectsActive(activeNames: string[]): Promise<void>;
  getProjectCounts(): Promise<{ active: number; historical: number; total: number }>;

  // Program Expense (new)
  getAllProgramExpenses(): Promise<ProgramExpense[]>;
  getProgramExpensesByProject(projectName: string): Promise<ProgramExpense[]>;
  createManyProgramExpenses(expenses: InsertProgramExpense[]): Promise<ProgramExpense[]>;
  deleteProgramExpensesByProject(projectName: string): Promise<void>;

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
}

export class DatabaseStorage implements IStorage {
  private _dbInstance?: typeof db;
  
  // Getter that always returns the current db (handles dynamic switching)
  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }
  
  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
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
    const [user] = await this.dbInstance.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.dbInstance.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    // Explicitly provide timestamp for SQLite compatibility
    const [created] = await this.dbInstance.insert(users).values({
      ...user,
      createdAt: new Date(),
    }).returning();
    return created;
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
    return this.dbInstance.select().from(tasks).orderBy(desc(tasks.createdAt));
  }

  async getTasksByProject(projectId: number): Promise<Task[]> {
    return this.dbInstance.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(desc(tasks.createdAt));
  }

  async createTask(task: InsertTask): Promise<Task> {
    // Explicitly provide timestamp for SQLite compatibility
    const [created] = await this.dbInstance.insert(tasks).values({
      ...task,
      createdAt: new Date(),
    }).returning();
    return created;
  }

  async createManyTasks(taskList: InsertTask[]): Promise<Task[]> {
    if (taskList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
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

  async getAllProjectInfo(): Promise<ProjectInfo[]> {
    return this.dbInstance.select().from(projectInfo).orderBy(desc(projectInfo.updatedAt));
  }

  async upsertProjectInfo(info: InsertProjectInfo): Promise<ProjectInfo> {
    const existing = await this.getProjectInfo(info.projectName);
    if (existing) {
      const [updated] = await this.dbInstance
        .update(projectInfo)
        .set({ ...info, updatedAt: new Date() })
        .where(eq(projectInfo.projectName, info.projectName))
        .returning();
      return updated;
    }
    // Explicitly provide timestamp for SQLite compatibility
    const [created] = await this.dbInstance.insert(projectInfo).values({
      ...info,
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

  // Program Expense (new)
  async getAllProgramExpenses(): Promise<ProgramExpense[]> {
    return this.dbInstance.select().from(programExpense).orderBy(desc(programExpense.createdAt));
  }

  async getProgramExpensesByProject(projectName: string): Promise<ProgramExpense[]> {
    return this.dbInstance.select().from(programExpense).where(eq(programExpense.projectName, projectName));
  }

  async createManyProgramExpenses(expenseList: InsertProgramExpense[]): Promise<ProgramExpense[]> {
    if (expenseList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = expenseList.map(e => ({ ...e, createdAt: now }));
    return this.dbInstance.insert(programExpense).values(withTimestamps).returning();
  }

  async deleteProgramExpensesByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(programExpense).where(eq(programExpense.projectName, projectName));
  }

  // Program Inflows (new)
  async getAllProgramInflows(): Promise<ProgramInflows[]> {
    return this.dbInstance.select().from(programInflows).orderBy(desc(programInflows.createdAt));
  }

  async getProgramInflowsByProject(projectName: string): Promise<ProgramInflows[]> {
    return this.dbInstance.select().from(programInflows).where(eq(programInflows.projectName, projectName));
  }

  async createManyProgramInflows(inflowList: InsertProgramInflows[]): Promise<ProgramInflows[]> {
    if (inflowList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = inflowList.map(i => ({ ...i, createdAt: now }));
    return this.dbInstance.insert(programInflows).values(withTimestamps).returning();
  }

  async deleteProgramInflowsByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(programInflows).where(eq(programInflows.projectName, projectName));
  }

  // Project Plan (new)
  async getAllProjectPlans(): Promise<ProjectPlan[]> {
    return this.dbInstance.select().from(projectPlan).orderBy(desc(projectPlan.createdAt));
  }

  async getProjectPlansByProject(projectName: string): Promise<ProjectPlan[]> {
    return this.dbInstance.select().from(projectPlan).where(eq(projectPlan.projectName, projectName));
  }

  async createManyProjectPlans(planList: InsertProjectPlan[]): Promise<ProjectPlan[]> {
    if (planList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = planList.map(p => ({ ...p, createdAt: now }));
    return this.dbInstance.insert(projectPlan).values(withTimestamps).returning();
  }

  async deleteProjectPlansByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(projectPlan).where(eq(projectPlan.projectName, projectName));
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
    await safeDelete(projectPlan, "projectPlan");
    await safeDelete(programInflows, "programInflows");
    await safeDelete(programExpense, "programExpense");
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
    const inserted = await this.dbInstance.insert(programExpense).values(data).returning();
    return inserted[0];
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
    return this.dbInstance.select().from(operationalTasks);
  }

  async getOperationalTasksByProject(projectName: string): Promise<OperationalTask[]> {
    return this.dbInstance.select().from(operationalTasks).where(eq(operationalTasks.projectName, projectName)).orderBy(operationalTasks.sortOrder);
  }

  async getOperationalTask(id: number): Promise<OperationalTask | undefined> {
    const [task] = await this.dbInstance.select().from(operationalTasks).where(eq(operationalTasks.id, id));
    return task;
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
    await this.dbInstance.delete(operationalTasks).where(eq(operationalTasks.id, id));
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
}

export const storage = new DatabaseStorage();
