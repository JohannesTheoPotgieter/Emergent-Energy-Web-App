import { queryOptions } from "@tanstack/react-query";

const API_BASE = "/api";

function getAuthToken(): string | null {
  return localStorage.getItem('auth_token');
}

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem('auth_token', token);
  } else {
    localStorage.removeItem('auth_token');
  }
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...headers,
      ...options?.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  
  return response.json();
}

// Auth API
export const authApi = {
  login: async (email: string, password: string) => {
    return fetchJSON<{ message: string; user: User; token: string }>(`${API_BASE}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  logout: async () => {
    return fetchJSON<{ message: string }>(`${API_BASE}/auth/logout`, {
      method: "POST",
    });
  },
  me: async () => {
    return fetchJSON<{ user: User }>(`${API_BASE}/auth/me`);
  },
  status: async () => {
    return fetchJSON<{ authenticated: boolean; hasSession: boolean; hasUser: boolean; hasCookie: boolean; hasAuthHeader: boolean; jwtValid: boolean; sessionAuth: boolean }>(`${API_BASE}/auth/status`);
  },
};

// Dashboard API
export const dashboardApi = {
  getData: async () => {
    return fetchJSON<DashboardData>(`${API_BASE}/dashboard`);
  },
  refresh: async () => {
    return fetchJSON<{ message: string; refreshedAt: string }>(`${API_BASE}/refresh`, {
      method: "POST",
    });
  },
  getLatestRefresh: async () => {
    return fetchJSON<{ lastRefresh: string | null }>(`${API_BASE}/refresh/latest`);
  },
};

// Projects API
export const projectsApi = {
  getAll: async () => {
    return fetchJSON<Project[]>(`${API_BASE}/projects`);
  },
  getById: async (id: number) => {
    return fetchJSON<Project>(`${API_BASE}/projects/${id}`);
  },
};

// Expenses API
export const expensesApi = {
  getAll: async (projectId?: number) => {
    const url = projectId 
      ? `${API_BASE}/expenses?projectId=${projectId}` 
      : `${API_BASE}/expenses`;
    return fetchJSON<Expense[]>(url);
  },
};

// Revenues API
export const revenuesApi = {
  getAll: async (projectId?: number) => {
    const url = projectId 
      ? `${API_BASE}/revenues?projectId=${projectId}` 
      : `${API_BASE}/revenues`;
    return fetchJSON<Revenue[]>(url);
  },
};

// Tasks API
export const tasksApi = {
  getAll: async (projectId?: number) => {
    const url = projectId 
      ? `${API_BASE}/tasks?projectId=${projectId}` 
      : `${API_BASE}/tasks`;
    return fetchJSON<Task[]>(url);
  },
};

// Budgets API
export const budgetsApi = {
  getAll: async () => {
    return fetchJSON<Budget[]>(`${API_BASE}/budgets`);
  },
  create: async (budget: CreateBudget) => {
    return fetchJSON<Budget>(`${API_BASE}/budgets`, {
      method: "POST",
      body: JSON.stringify(budget),
    });
  },
  delete: async (id: number) => {
    return fetchJSON<{ message: string }>(`${API_BASE}/budgets/${id}`, {
      method: "DELETE",
    });
  },
};

// Upload API
export const uploadApi = {
  uploadFiles: async (files: File[]) => {
    const formData = new FormData();
    files.forEach(file => formData.append("files", file));
    
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      credentials: "include",
      headers,
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Upload failed" }));
      throw new Error(error.message || "Upload failed");
    }
    
    return response.json() as Promise<UploadResult>;
  },
  getHistory: async () => {
    return fetchJSON<UploadMetadata[]>(`${API_BASE}/uploads`);
  },
};

// Overview API (new tracker-based data)
export const overviewApi = {
  getData: async () => {
    return fetchJSON<OverviewData>(`${API_BASE}/overview`);
  },
  getProjectsSummary: async () => {
    return fetchJSON<ProjectSummary[]>(`${API_BASE}/projects-summary`);
  },
  getProgramExpenses: async (projectName?: string) => {
    const url = projectName 
      ? `${API_BASE}/program-expenses?projectName=${encodeURIComponent(projectName)}` 
      : `${API_BASE}/program-expenses`;
    return fetchJSON<ProgramExpense[]>(url);
  },
  getProgramInflows: async (projectName?: string) => {
    const url = projectName 
      ? `${API_BASE}/program-inflows?projectName=${encodeURIComponent(projectName)}` 
      : `${API_BASE}/program-inflows`;
    return fetchJSON<ProgramInflow[]>(url);
  },
  getProjectPlans: async (projectName?: string) => {
    const url = projectName 
      ? `${API_BASE}/project-plans?projectName=${encodeURIComponent(projectName)}` 
      : `${API_BASE}/project-plans`;
    return fetchJSON<ProjectPlanItem[]>(url);
  },
  getProjectInfo: async () => {
    return fetchJSON<ProjectInfo[]>(`${API_BASE}/project-info`);
  },
};

// Export API (these return files, not JSON)
export const exportApi = {
  projects: () => `${API_BASE}/export/projects`,
  expenses: () => `${API_BASE}/export/expenses`,
  revenues: () => `${API_BASE}/export/revenues`,
  tasks: () => `${API_BASE}/export/tasks`,
  projectsSummary: () => `${API_BASE}/export/projects-summary`,
};

// Types
export interface User {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
}

export interface Project {
  id: number;
  name: string;
  code: string;
  manager: string;
  site: string;
  status: string;
  stage: string;
  startDate: string;
  completionDate: string;
  budget: string;
  sourceFile: string;
  lastUpdated: string;
}

export interface Expense {
  id: number;
  projectId: number;
  category: string;
  description: string;
  amount: string;
  date: string;
  vendor: string;
  invoiceNumber?: string;
  status: string;
  sourceSheet: string;
  rowLocator?: number;
}

export interface Revenue {
  id: number;
  projectId: number;
  type: string;
  amount: string;
  date: string;
  status: string;
  sourceSheet: string;
  rowLocator?: number;
}

export interface Task {
  id: number;
  projectId: number;
  taskName: string;
  startDate: string;
  endDate: string;
  progress: number;
  status: string;
  assignee: string;
  sourceSheet: string;
  rowLocator?: number;
}

export interface Budget {
  id: number;
  projectId: number;
  month: string;
  category: string;
  amount: string;
}

export interface CreateBudget {
  projectId: number;
  month: string;
  category: "REV" | "COS" | "OPS";
  amount: string;
}

export interface DashboardData {
  projects: Project[];
  expenses: Expense[];
  revenues: Revenue[];
  tasks: Task[];
  budgets: Budget[];
  lastRefresh: string | null;
}

export interface UploadResult {
  message: string;
  results: {
    file: string;
    status: string;
    message?: string;
    project_name?: string;
    expensesParsed?: number;
    inflowsParsed?: number;
    planParsed?: number;
    infoParsed?: boolean;
    warnings?: string[];
  }[];
}

export interface UploadMetadata {
  id: number;
  fileName: string;
  uploadedBy?: number;
  uploadedAt: string;
  recordsProcessed: number;
  validationErrors?: string;
  status: string;
}

export interface OverviewData {
  total_program_budget: number;
  actual_spend_paid: number;
  revenue_realised: number;
  active_projects: number;
  data_as_of: string;
}

export interface ProjectSummary {
  project_name: string;
  size_kwp: number | null;
  pd: string | null;
  pm: string | null;
  phase: string | null;
  project_pct_complete: number | null;
  expected_pct_complete: number | null;
  delta_vs_expected: number | null;
  actual_revenue: number;
  actual_expenses: number;
  gp_percent: number | null;
  revenue_outstanding: number;
  expenses_outstanding: number;
  current_vo_total: number;
}

export interface ProjectInfo {
  id: number;
  projectName: string;
  sizeKwp: string | null;
  pd: string | null;
  pm: string | null;
  contractValue: string | null;
  phase: string | null;
  updatedAt: string;
}

export interface ProgramExpense {
  id: number;
  projectName: string;
  rowNumber: number | null;
  expenseCategory: string | null;
  expenseLineItem: string | null;
  expenseQty: string | null;
  expenseRateUnit: string | null;
  expenseActualTotal: string | null;
  expensePoNumber: string | null;
  expenseInvoiceNumber: string | null;
  expenseInvoicedDate: string | null;
  revenueAmount: string | null;
  expensePaymentDate: string | null;
  cosAmount: string | null;
}

export interface ProgramInflow {
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
}

export interface ProjectPlanItem {
  id: number;
  projectName: string;
  rowNumber: number | null;
  taskNo: string | null;
  highLevelProgramme: string | null;
  actualStart: string | null;
  durationDays: number | null;
  actualEnd: string | null;
  actualPctComplete: number | null;
  expectedPctComplete: number | null;
}

// Query Options
export const dashboardQueryOptions = queryOptions({
  queryKey: ["dashboard"],
  queryFn: dashboardApi.getData,
  staleTime: 30000,
});

export const projectsQueryOptions = queryOptions({
  queryKey: ["projects"],
  queryFn: projectsApi.getAll,
});

export const budgetsQueryOptions = queryOptions({
  queryKey: ["budgets"],
  queryFn: budgetsApi.getAll,
});

export const overviewQueryOptions = queryOptions({
  queryKey: ["overview"],
  queryFn: overviewApi.getData,
});

export const projectsSummaryQueryOptions = queryOptions({
  queryKey: ["projects-summary"],
  queryFn: overviewApi.getProjectsSummary,
});
