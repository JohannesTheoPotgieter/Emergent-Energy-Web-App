/**
 * Engineering module fetch wrapper.
 *
 * Use this for engineering-specific API calls (e.g. /api/engineering/*).
 * For React Query integration, prefer queryClient.ts (getQueryFn / fetchQueryFn).
 * For legacy auth/project API calls, see api.ts.
 */

import { parseApiError, networkError, ApiError } from "./api-error";

/** Raw fetch with auth headers — returns the raw Response (caller handles .ok / .json()). */
export function engFetchRaw(url: string, options?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const companyRole = localStorage.getItem("company_role");
  if (companyRole) headers["x-company-role"] = companyRole;
  if (options?.body && typeof options.body === "string") headers["Content-Type"] = "application/json";
  return fetch(url, { ...options, headers, credentials: "include" });
}

export async function engFetch(url: string, options?: RequestInit) {
  let res: Response;
  try {
    res = await engFetchRaw(url, options);
  } catch {
    throw networkError();
  }

  if (!res.ok) {
    // 401 — session expired, redirect to login
    if (res.status === 401 && window.location.pathname !== "/auth/login") {
      window.location.href = "/auth/login";
    }

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
  return res.json();
}

export async function engPatch(url: string, body: Record<string, any>) {
  return engFetch(url, { method: "PATCH", body: JSON.stringify(body) });
}

export async function engPost(url: string, body: Record<string, any>) {
  return engFetch(url, { method: "POST", body: JSON.stringify(body) });
}
