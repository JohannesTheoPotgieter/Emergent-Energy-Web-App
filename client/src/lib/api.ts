import { queryOptions } from "@tanstack/react-query";

const API_BASE = "/api";

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
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
    return fetchJSON<{ message: string; user: User }>(`${API_BASE}/auth/login`, {
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
    
    const response = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Upload failed" }));
      throw new Error(error.message);
    }
    
    return response.json() as Promise<UploadResult>;
  },
  getHistory: async () => {
    return fetchJSON<UploadMetadata[]>(`${API_BASE}/uploads`);
  },
};

// Export API (these return files, not JSON)
export const exportApi = {
  projects: () => `${API_BASE}/export/projects`,
  expenses: () => `${API_BASE}/export/expenses`,
  revenues: () => `${API_BASE}/export/revenues`,
  tasks: () => `${API_BASE}/export/tasks`,
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
    records?: number;
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
