import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { ApiError, parseApiError, networkError } from "./api-error";
import { runAsyncAction } from "./async-action";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      try {
        const text = await res.text();
        body = { message: text || res.statusText };
      } catch {
        body = { message: res.statusText || "Request failed" };
      }
    }
    throw parseApiError(res, body);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { headers?: Record<string, string> },
): Promise<Response> {
  const headers: Record<string, string> = { ...(options?.headers || {}) };
  if (data) {
    headers["Content-Type"] = "application/json";
  }
  const token = localStorage.getItem('auth_token');
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });
  } catch (err) {
    throw networkError();
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const requestUrl = queryKey.join("/") as string;
    return runAsyncAction(async ({ signal, correlationId }) => {
      const headers: Record<string, string> = {
        "X-Correlation-ID": correlationId,
      };
      const token = localStorage.getItem('auth_token');
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      let res: Response;
      try {
        res = await fetch(requestUrl, {
          signal,
          credentials: "include",
          headers,
        });
      } catch {
        throw networkError();
      }

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    }, {
      action: `queryFn:GET:${requestUrl}`,
    });
  };

export function invalidateDashboardQueries(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["/api/program-dashboard"] });
  qc.invalidateQueries({ queryKey: ["/api/dashboard/high-priority"] });
  qc.invalidateQueries({ queryKey: ["/api/projects-summary"] });
  qc.invalidateQueries({ queryKey: ["/api/portfolio-dashboard"] });
  qc.invalidateQueries({ queryKey: ["/api/lifecycle-board/projects"] });
  qc.invalidateQueries({ queryKey: ["/api/financial-headline"] });
  qc.invalidateQueries({ queryKey: ["/api/home/summary"] });
  qc.invalidateQueries({ queryKey: ["/api/upcoming-events"] });
  qc.invalidateQueries({ queryKey: ["/api/upcoming-financials"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  qc.invalidateQueries({ queryKey: ["overview"] });
  qc.invalidateQueries({ queryKey: ["projects-summary"] });
  qc.invalidateQueries({ queryKey: ["/api/revenue-tracker"] });
  qc.invalidateQueries({ queryKey: ["gp-tracker-portfolio"] });
  qc.invalidateQueries({ predicate: (query) => {
    const key = query.queryKey[0];
    if (typeof key === 'string') {
      return key.startsWith('/api/revenue-tracker') ||
             key.startsWith('/api/revenue-tab/') ||
             key.startsWith('/api/revenue-tracking/') ||
             key.startsWith('/api/cashflow-2026') ||
             key.startsWith('/api/cashflow') ||
             key.startsWith('/api/expenditure-breakdown') ||
             key.startsWith('/api/cos-tracker') ||
             key.startsWith('/api/gp-tracker') ||
             key === 'revenue-tracker-project' ||
             key === 'revenue-tab' ||
             key === 'finance-revenue';
    }
    return false;
  }});
}

export function invalidateProjectQueries(qc: QueryClient, projectName: string) {
  invalidateDashboardQueries(qc);
  qc.invalidateQueries({ queryKey: ["planning-tasks", projectName] });
  qc.invalidateQueries({ queryKey: ["operational-tasks", projectName] });
  qc.invalidateQueries({ queryKey: ["working-plan", projectName] });
  qc.invalidateQueries({ queryKey: ["revenue-tab", projectName] });
  qc.invalidateQueries({ queryKey: ["expenditure-breakdown", projectName] });
  qc.invalidateQueries({ queryKey: ["cashflow", projectName] });
  qc.invalidateQueries({ queryKey: ["program-expenses", projectName] });
  qc.invalidateQueries({ queryKey: ["program-inflows", projectName] });
  qc.invalidateQueries({ queryKey: ["quality-summary", projectName] });
  qc.invalidateQueries({ queryKey: ["finance-revenue", projectName] });
  qc.invalidateQueries({ queryKey: ["finance-cos", projectName] });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: 30_000,
      gcTime: 300_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (!error.retryable) return false;
          if (error.status === 401 || error.status === 403 || error.status === 404) return false;
        }
        if (error instanceof Error && error.message.startsWith("401")) return false;
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    },
    mutations: {
      retry: false,
    },
  },
});
