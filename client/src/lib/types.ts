export type ProjectStatus = "Planning" | "Active" | "Completed" | "On Hold";
export type ProjectStage = "Development" | "Construction" | "Operations";

export interface ProjectInfo {
  id: string;
  name: string;
  code: string;
  manager: string;
  site: string;
  status: ProjectStatus;
  stage: ProjectStage;
  startDate: string;
  completionDate: string;
  budget: number;
  sourceFile: string;
  lastUpdated: string;
}

export interface ExpenditureItem {
  id: string;
  projectId: string;
  category: "Procurement" | "Construction" | "Legal" | "Development" | "Grid Connection" | "Operational";
  description: string;
  amount: number;
  date: string;
  vendor: string;
  invoiceNumber?: string;
  status: "Paid" | "Pending" | "Forecast";
  sourceSheet: "Expenditure Breakdown";
  rowLocator: number;
}

export interface RevenueItem {
  id: string;
  projectId: string;
  type: "PPA" | "Merchant" | "LGC" | "Capacity";
  amount: number;
  date: string;
  status: "Realised" | "Forecast";
  sourceSheet: "Revenue Tracking";
  rowLocator: number;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  taskName: string;
  startDate: string;
  endDate: string;
  progress: number;
  status: "Not Started" | "In Progress" | "Complete" | "Delayed";
  assignee: string;
  sourceSheet: "Project Plan";
  rowLocator: number;
}

export interface BudgetEntry {
  id: string;
  projectId: string;
  month: string; // YYYY-MM
  category: "REV" | "COS" | "OPS";
  amount: number;
}

export interface ProgramData {
  projects: ProjectInfo[];
  expenses: ExpenditureItem[];
  revenues: RevenueItem[];
  tasks: ProjectTask[];
  budgets: BudgetEntry[];
  lastRefresh: string;
}
