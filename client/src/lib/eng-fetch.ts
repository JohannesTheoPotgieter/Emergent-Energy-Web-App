/**
 * Shared fetch utility for engineering endpoints.
 * Handles auth token injection, JSON content type, and error parsing.
 */

/** Raw fetch with auth headers — returns the raw Response (caller handles .ok / .json()). */
export function engFetchRaw(url: string, options?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body && typeof options.body === "string") headers["Content-Type"] = "application/json";
  return fetch(url, { ...options, headers, credentials: "include" });
}

export async function engFetch(url: string, options?: RequestInit) {
  const res = await engFetchRaw(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function engPatch(url: string, body: Record<string, any>) {
  return engFetch(url, { method: "PATCH", body: JSON.stringify(body) });
}

export async function engPost(url: string, body: Record<string, any>) {
  return engFetch(url, { method: "POST", body: JSON.stringify(body) });
}
