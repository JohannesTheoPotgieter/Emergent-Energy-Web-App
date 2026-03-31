import type { RoleSummary, UserSummary, UserOverrideRow, AuditLogEntry, PdVisConfig, WorkstreamVisConfig, EffectivePermission, RoleComparisonResult } from "./settings-types";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const fetchOpts: RequestInit = { credentials: "include" };

// ── Roles ──

export async function fetchRolesControlCenter(): Promise<{ roles: RoleSummary[]; ok: boolean }> {
  const res = await fetch("/api/roles/control-center", { headers: authHeaders(), ...fetchOpts });
  const data = await parseJsonSafe<{ roles?: RoleSummary[] }>(res);
  return { roles: Array.isArray(data?.roles) ? data!.roles : [], ok: res.ok };
}

export async function fetchRoles(): Promise<RoleSummary[]> {
  const res = await fetch("/api/roles", { headers: authHeaders(), ...fetchOpts });
  const data = await parseJsonSafe<RoleSummary[] | { error?: string }>(res);
  return Array.isArray(data) ? data : [];
}

export async function fetchPermissions(): Promise<{ canManageRoles?: boolean; canManageUsers?: boolean }> {
  const res = await fetch("/api/auth/permissions", { headers: authHeaders(), ...fetchOpts });
  return (await parseJsonSafe<{ canManageRoles?: boolean; canManageUsers?: boolean }>(res)) || {};
}

export async function saveRole(roleKey: string, payload: Partial<RoleSummary>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/roles/${roleKey}`, { method: "PUT", headers: authHeaders(), ...fetchOpts, body: JSON.stringify(payload) });
  if (!res.ok) {
    const body = await parseJsonSafe<{ error?: string }>(res);
    return { ok: false, error: body?.error || `Save failed (${res.status})` };
  }
  return { ok: true };
}

export async function createRole(payload: { role: string; label: string; sections?: string[]; canEditData?: boolean }): Promise<boolean> {
  const res = await fetch("/api/roles", { method: "POST", headers: authHeaders(), ...fetchOpts, body: JSON.stringify(payload) });
  return res.ok;
}

export async function cloneRole(sourceRole: string, payload: { role: string; label: string }): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/roles/${sourceRole}/clone`, { method: "POST", headers: authHeaders(), ...fetchOpts, body: JSON.stringify(payload) });
  if (!res.ok) { const err = await parseJsonSafe<{ error?: string }>(res); return { ok: false, error: err?.error || "Clone failed" }; }
  return { ok: true };
}

export async function archiveRole(roleKey: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/roles/${roleKey}/archive`, { method: "PATCH", headers: authHeaders(), ...fetchOpts, body: JSON.stringify({ archived: true }) });
  if (!res.ok) { const err = await parseJsonSafe<{ error?: string }>(res); return { ok: false, error: err?.error || "Archive failed" }; }
  return { ok: true };
}

export async function deleteRole(roleKey: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/roles/${roleKey}`, { method: "DELETE", headers: authHeaders(), ...fetchOpts });
  if (!res.ok) { const err = await parseJsonSafe<{ error?: string }>(res); return { ok: false, error: err?.error || "Delete failed" }; }
  return { ok: true };
}

export async function compareRoles(roleKeys: string[]): Promise<RoleComparisonResult | null> {
  const params = new URLSearchParams({ roles: roleKeys.join(",") });
  const res = await fetch(`/api/roles/compare?${params}`, { headers: authHeaders(), ...fetchOpts });
  if (!res.ok) return null;
  return parseJsonSafe<RoleComparisonResult>(res);
}

// ── Users ──

export async function fetchUsers(): Promise<UserSummary[]> {
  const res = await fetch("/api/admin/users", { headers: authHeaders(), ...fetchOpts });
  const data = await parseJsonSafe<UserSummary[] | { error?: string }>(res);
  return Array.isArray(data) ? data : [];
}

export async function createUser(form: { username: string; name: string; email: string; password: string; role: string; department: string }): Promise<{ ok: boolean; data?: any; error?: string }> {
  const res = await fetch("/api/admin/users", { method: "POST", headers: authHeaders(), ...fetchOpts, body: JSON.stringify(form) });
  const data = await parseJsonSafe<any>(res);
  if (!res.ok || !data || data.error) return { ok: false, error: data?.error || "Unknown error" };
  return { ok: true, data };
}

export async function updateUserRole(userId: number, role: string): Promise<boolean> {
  const res = await fetch(`/api/admin/users/${userId}/role`, { method: "PATCH", headers: authHeaders(), ...fetchOpts, body: JSON.stringify({ role }) });
  return res.ok;
}

export async function updateUserDepartment(userId: number, department: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/admin/users/${userId}/department`, { method: "PATCH", headers: authHeaders(), ...fetchOpts, body: JSON.stringify({ department }) });
  const data = await parseJsonSafe<any>(res);
  return { ok: res.ok, data };
}

export async function deleteUser(userId: number): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE", headers: authHeaders(), ...fetchOpts });
  if (!res.ok) { const data = await parseJsonSafe<any>(res); return { ok: false, error: data?.error || "Unknown error" }; }
  return { ok: true };
}

export async function resetUserPassword(userId: number, password: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/users/${userId}/password`, { method: "PATCH", headers: authHeaders(), ...fetchOpts, body: JSON.stringify({ password }) });
  if (!res.ok) { const data = await parseJsonSafe<any>(res); return { ok: false, error: data?.error || "Unknown error" }; }
  return { ok: true };
}

export async function fetchEffectivePermissions(userId: number): Promise<EffectivePermission[]> {
  const res = await fetch(`/api/admin/users/${userId}/effective-permissions`, { headers: authHeaders(), ...fetchOpts });
  if (!res.ok) return [];
  const data = await parseJsonSafe<{ permissions?: EffectivePermission[] }>(res);
  return data?.permissions || [];
}

// ── User Overrides ──

export async function fetchUserOverrides(userId: number): Promise<UserOverrideRow[]> {
  const res = await fetch(`/api/admin/user-overrides/${userId}`, { headers: authHeaders(), ...fetchOpts });
  const data = await parseJsonSafe<UserOverrideRow[]>(res);
  return Array.isArray(data) ? data : [];
}

export async function addUserOverride(payload: { userId: number; entity: string; action: string; allowed: boolean; reason: string | null }): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/admin/user-overrides", { method: "POST", headers: authHeaders(), ...fetchOpts, body: JSON.stringify(payload) });
  if (!res.ok) { const err = await parseJsonSafe<{ error?: string }>(res); return { ok: false, error: err?.error }; }
  return { ok: true };
}

export async function deleteUserOverride(overrideId: number): Promise<boolean> {
  const res = await fetch(`/api/admin/user-overrides/${overrideId}`, { method: "DELETE", headers: authHeaders(), ...fetchOpts });
  return res.ok;
}

// ── Audit Log ──

export async function fetchAuditLog(params?: { eventType?: string; limit?: number }): Promise<AuditLogEntry[]> {
  const searchParams = new URLSearchParams({ limit: String(params?.limit || 100) });
  if (params?.eventType) searchParams.set("eventType", params.eventType);
  const res = await fetch(`/api/admin/permission-audit-log?${searchParams}`, { headers: authHeaders(), ...fetchOpts });
  const data = await parseJsonSafe<{ entries?: AuditLogEntry[] }>(res);
  return Array.isArray(data?.entries) ? data!.entries : [];
}

// ── Visibility ──

export async function fetchPdVisibility(): Promise<PdVisConfig[]> {
  const res = await fetch("/api/admin/pd-visibility", { headers: authHeaders(), ...fetchOpts });
  const data = await parseJsonSafe<PdVisConfig[]>(res);
  return Array.isArray(data) ? data : [];
}

export async function savePdVisibilityRole(role: string, ticketTypes: string[], scope: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/admin/pd-visibility/role", { method: "PUT", headers: authHeaders(), ...fetchOpts, body: JSON.stringify({ role, ticketTypes, scope }) });
  if (!res.ok) { const err = await parseJsonSafe<{ error?: string }>(res); return { ok: false, error: err?.error }; }
  return { ok: true };
}

export async function savePdVisibilityUser(userId: number, ticketTypes: string[], scope: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/admin/pd-visibility/user", { method: "PUT", headers: authHeaders(), ...fetchOpts, body: JSON.stringify({ userId, ticketTypes, scope }) });
  if (!res.ok) { const err = await parseJsonSafe<{ error?: string }>(res); return { ok: false, error: err?.error }; }
  return { ok: true };
}

export async function deletePdVisibilityConfig(configId: number): Promise<boolean> {
  const res = await fetch(`/api/admin/pd-visibility/${configId}`, { method: "DELETE", headers: authHeaders(), ...fetchOpts });
  return res.ok;
}

export async function fetchWorkstreamVisibility(): Promise<WorkstreamVisConfig[]> {
  const res = await fetch("/api/admin/workstream-visibility", { headers: authHeaders(), ...fetchOpts });
  const data = await parseJsonSafe<{ configs?: WorkstreamVisConfig[] }>(res);
  return Array.isArray(data?.configs) ? data!.configs : [];
}

export async function saveWorkstreamVisibilityRole(role: string, workstreams: string[], ticketTypes: string[], scope: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/admin/workstream-visibility/role", { method: "PUT", headers: authHeaders(), ...fetchOpts, body: JSON.stringify({ role, workstreams, ticketTypes, scope }) });
  if (!res.ok) { const err = await parseJsonSafe<{ error?: string }>(res); return { ok: false, error: err?.error }; }
  return { ok: true };
}

export async function deleteWorkstreamVisibilityConfig(configId: number): Promise<boolean> {
  const res = await fetch(`/api/admin/workstream-visibility/${configId}`, { method: "DELETE", headers: authHeaders(), ...fetchOpts });
  return res.ok;
}
