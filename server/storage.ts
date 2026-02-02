import { db, getDbMode } from "./db";
import { eq, desc, and, gte, lte, isNotNull, isNull, sql } from "drizzle-orm";
import {
  users, projects, expenses, revenues, tasks, budgets, uploadMetadata, refreshLogs,
  projectInfo, programExpense, programInflows, projectPlan,
  cashflowPoints, financeRevenueMonthly, financeCosMonthly,
  cashflowPlanningOverrides, projectPlanOverrides, revenueTrackingOverrides,
  expenditureOverrides, financeRevenueOverrides, financeCosOverrides,
  workingPlanScenario, workingPlanTaskOverride, projectPlanDependency,
  workingPlanDependencyOverride, scheduleChangeNotice,
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
}

export const storage = new DatabaseStorage();
