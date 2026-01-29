import { db, getDbMode } from "./db";
import { eq, desc, and, gte, lte, isNotNull, isNull, sql } from "drizzle-orm";
import {
  users, projects, expenses, revenues, tasks, budgets, uploadMetadata, refreshLogs,
  projectInfo, programExpense, programInflows, projectPlan,
  cashflowPoints, financeRevenueMonthly, financeCosMonthly,
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
    const [created] = await this.dbInstance.insert(users).values(user).returning();
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
    const [created] = await this.dbInstance.insert(projects).values(project).returning();
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
    const [created] = await this.dbInstance.insert(expenses).values(expense).returning();
    return created;
  }

  async createManyExpenses(expenseList: InsertExpense[]): Promise<Expense[]> {
    if (expenseList.length === 0) return [];
    return this.dbInstance.insert(expenses).values(expenseList).returning();
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
    const [created] = await this.dbInstance.insert(revenues).values(revenue).returning();
    return created;
  }

  async createManyRevenues(revenueList: InsertRevenue[]): Promise<Revenue[]> {
    if (revenueList.length === 0) return [];
    return this.dbInstance.insert(revenues).values(revenueList).returning();
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
    const [created] = await this.dbInstance.insert(tasks).values(task).returning();
    return created;
  }

  async createManyTasks(taskList: InsertTask[]): Promise<Task[]> {
    if (taskList.length === 0) return [];
    return this.dbInstance.insert(tasks).values(taskList).returning();
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
    const [created] = await this.dbInstance.insert(budgets).values(budget).returning();
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
    const [created] = await this.dbInstance.insert(projectInfo).values(info).returning();
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
    return this.dbInstance.insert(programExpense).values(expenseList).returning();
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
    return this.dbInstance.insert(programInflows).values(inflowList).returning();
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
    return this.dbInstance.insert(projectPlan).values(planList).returning();
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
    return this.dbInstance.insert(cashflowPoints).values(pointList).returning();
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
    return this.dbInstance.insert(financeRevenueMonthly).values(dataList).returning();
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
    return this.dbInstance.insert(financeCosMonthly).values(dataList).returning();
  }

  async deleteFinanceCosMonthlyByProject(projectName: string): Promise<void> {
    await this.dbInstance.delete(financeCosMonthly).where(eq(financeCosMonthly.projectName, projectName));
  }
}

export const storage = new DatabaseStorage();
