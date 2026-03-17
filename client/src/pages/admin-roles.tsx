import React, { useEffect, useMemo, useState } from "react";
import { AdminPageShell, AdminQueryState } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { isSuperAdmin } from "@/lib/access-control";
import {
  buildRoleAuthorityCategories,
  canManageRoleActions,
  resolveAdminRolesViewState,
  resolveSelectedRole,
  type AdminRolesViewState,
  type RoleSummary,
  type UserSummary,
} from "./admin-roles.utils";
import { AlertTriangle, Plus, Save, Search, Shield, ShieldAlert, Users } from "lucide-react";
import type { AuthorityAction, PermissionAction } from "@shared/schema";

const DEPARTMENTS = [
  "Executive",
  "Engineering",
  "Finance",
  "Operations",
  "Project Development",
  "Project Management",
  "Quality",
  "Procurement",
  "Commercial",
  "Construction",
  "Health & Safety",
  "IT",
  "HR",
  "Legal",
];

const ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];
const AUTHORITY_ACTIONS: AuthorityAction[] = ["view", "create", "edit", "delete", "approve", "assign", "reassign", "close_complete", "export", "manage_settings"];
const AUTHORITY_SCOPES = ["own", "department", "assigned_projects", "all_projects", "company_admin"] as const;
const NAV_SECTIONS = ["MY_WORK", "PROJECTS", "PROJECT_DEVELOPMENT", "DELIVERY", "GOVERNANCE", "MONEY", "INFORMATION", "SETTINGS"];

type RoleRow = RoleSummary;
type UserRow = UserSummary;

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

export default function AdminRolesPage() {
  const companyRole = localStorage.getItem("company_role");
  const tokenRole = localStorage.getItem("user_role");
  if (!isSuperAdmin(tokenRole, companyRole)) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Card><CardContent className="py-12 px-16 text-center"><AlertTriangle className="mx-auto mb-3 text-amber-500" /><p>Access denied.</p></CardContent></Card></div>;
  }

  return (
    <AdminPageShell
      surfaceId="roles"
      title="Roles & Permissions"
      description="Control backend-aligned role authority, assignment visibility, and user access governance from one trusted surface."
      statuses={[
        { label: "Backend enforcement aligned here", tone: "success" },
        { label: "Role-aware administration", tone: "info" },
      ]}
    >
      <div className="space-y-4" data-testid="admin-roles-page">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-5 w-5" />Roles & Permissions</h1>
        <Tabs defaultValue="roles">
          <TabsList className="grid grid-cols-2 w-full max-w-[360px]"><TabsTrigger value="roles">Roles / Permissions</TabsTrigger><TabsTrigger value="users">Users</TabsTrigger></TabsList>
          <TabsContent value="roles"><RolesControlCenter /></TabsContent>
          <TabsContent value="users"><GlobalUsersView /></TabsContent>
        </Tabs>
      </div>
    </AdminPageShell>
  );
}

function RolesControlCenter() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "system" | "custom">("all");
  const [draft, setDraft] = useState<Partial<RoleRow>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createKey, setCreateKey] = useState("");
  const [createLabel, setCreateLabel] = useState("");
  const [effective, setEffective] = useState<any[]>([]);
  const [authorityEffective, setAuthorityEffective] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>("");
  const [canManageRoles, setCanManageRoles] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const [roleRes, userRes, permRes] = await Promise.all([
        fetch("/api/roles/control-center", { headers: authHeaders(), credentials: "include" }),
        fetch("/api/admin/users", { headers: authHeaders(), credentials: "include" }),
        fetch("/api/auth/permissions", { headers: authHeaders(), credentials: "include" }),
      ]);

      const roleData = await parseJsonSafe<{ roles?: RoleRow[] }>(roleRes);
      const userData = await parseJsonSafe<UserRow[] | { error?: string }>(userRes);
      const permData = await parseJsonSafe<{ canManageRoles?: boolean }>(permRes);

      const nextRoles = Array.isArray(roleData?.roles) ? roleData!.roles : [];
      const nextUsers = Array.isArray(userData) ? userData : [];

      setRoles(nextRoles);
      setUsers(nextUsers);
      setCanManageRoles(canManageRoleActions(Boolean(permData?.canManageRoles), roleRes.ok && userRes.ok));
      setSelectedRole((prev) => resolveSelectedRole(prev, nextRoles));

      if (!roleRes.ok) {
        setLoadError("Unable to load roles. Your account may not have access.");
      }
    } catch {
      setRoles([]);
      setUsers([]);
      setLoadError("Unable to load roles right now.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { setDraft({}); }, [selectedRole]);

  const selected = useMemo(() => roles.find((r) => r.role === selectedRole), [roles, selectedRole]);
  const hasChanges = Object.keys(draft).length > 0;
  const filteredRoles = roles.filter((r) => {
    if (kindFilter === "system" && !r.isSystem) return false;
    if (kindFilter === "custom" && r.isSystem) return false;
    const q = filter.toLowerCase();
    return !q || r.role.toLowerCase().includes(q) || r.label.toLowerCase().includes(q);
  });

  const effectiveRole = { ...selected, ...draft } as RoleRow;
  const currentEp = (effectiveRole.entityPermissions || {}) as Record<string, Record<string, boolean>>;
  const authorityRules = effectiveRole.authorityModel?.rules || {};
  const authorityCategories = buildRoleAuthorityCategories(effectiveRole);

  const updateEp = (entity: string, action: string, value: boolean) => {
    const next = { ...currentEp, [entity]: { ...(currentEp[entity] || {}), [action]: value } };
    if ((action === "edit" || action === "approve" || action === "delete") && value) next[entity].view = true;
    setDraft((d) => ({ ...d, entityPermissions: next }));
  };

  const updateAuthorityRule = (entity: string, action: AuthorityAction, patch: { enabled?: boolean; scope?: string }) => {
    const key = `${entity}.${action}`;
    const nextRules = { ...authorityRules, [key]: { ...(authorityRules[key] || {}), ...patch } };
    setDraft((d) => ({ ...d, authorityModel: { ...(effectiveRole.authorityModel || {}), rules: nextRules } }));
  };

  const save = async () => {
    if (!selected || !canManageRoles) return;
    const res = await fetch(`/api/roles/${selected.role}`, { method: "PUT", headers: authHeaders(), credentials: "include", body: JSON.stringify(draft) });
    if (!res.ok) return toast({ title: "Save failed", variant: "destructive" });
    setDraft({});
    await load();
    toast({ title: "Role updated" });
  };

  const createRole = async () => {
    if (!canManageRoles) return;
    const res = await fetch("/api/roles", { method: "POST", headers: authHeaders(), credentials: "include", body: JSON.stringify({ role: createKey.trim(), label: createLabel.trim(), sections: ["MY_WORK"], canEditData: true }) });
    if (!res.ok) return toast({ title: "Create role failed", variant: "destructive" });
    setShowCreate(false); setCreateKey(""); setCreateLabel(""); await load();
  };

  const loadEffective = async (userId?: number) => {
    const res = await fetch("/api/roles/effective-access", { method: "POST", headers: authHeaders(), credentials: "include", body: JSON.stringify({ role: selectedRole, userId }) });
    const data = await parseJsonSafe<{ matrix?: any[]; authorityMatrix?: any[] }>(res);
    setEffective(data?.matrix || []);
    setAuthorityEffective(data?.authorityMatrix || []);
  };

  const resources = Object.keys(currentEp).filter((k) => !k.startsWith("_")).sort();
  const viewState: AdminRolesViewState = resolveAdminRolesViewState({ isLoading, hasError: Boolean(loadError), roleCount: roles.length, canManageRoles });
  const systemRoleCount = roles.filter((role) => role.isSystem).length;
  const customRoleCount = roles.filter((role) => !role.isSystem).length;
  const protectedRoleCount = roles.filter((role) => role.protected).length;
  const assignedUsers = users.filter((user) => Boolean(user.role)).length;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px,minmax(0,1fr)]">
      <Card className="xl:sticky xl:top-4 xl:self-start">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            Roles
            <Button size="sm" onClick={() => setShowCreate(true)} disabled={!canManageRoles}>
              <Plus className="h-3 w-3 mr-1" />
              Create
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/70 bg-muted/30 p-3 text-xs">
            <div>
              <p className="text-muted-foreground uppercase tracking-wide">Roles</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{roles.length}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wide">Assigned Users</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{assignedUsers}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wide">System</p>
              <p className="mt-1 text-sm font-medium text-foreground">{systemRoleCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wide">Protected</p>
              <p className="mt-1 text-sm font-medium text-foreground">{protectedRoleCount}</p>
            </div>
          </div>
          <div className="relative"><Search className="h-3 w-3 absolute left-2 top-2.5" /><Input className="pl-7 h-8" placeholder="Search roles" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
          <div className="flex flex-wrap gap-1"><Button variant={kindFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setKindFilter("all")}>All</Button><Button variant={kindFilter === "system" ? "default" : "outline"} size="sm" onClick={() => setKindFilter("system")}>System</Button><Button variant={kindFilter === "custom" ? "default" : "outline"} size="sm" onClick={() => setKindFilter("custom")}>Custom</Button></div>
          <div className="space-y-1 max-h-[70vh] overflow-auto">{filteredRoles.map((r) => <button key={r.role} className={`w-full text-left rounded-xl border p-3 ${selectedRole === r.role ? "border-primary bg-primary/5 shadow-[var(--shadow-xs)]" : "border-border/70 bg-background hover:bg-muted/35"}`} onClick={() => setSelectedRole(r.role)}><div className="font-medium text-sm flex items-center justify-between gap-2">{r.label} {r.isSystem && <Badge variant="secondary">System</Badge>}</div><div className="mt-1 text-xs text-muted-foreground flex items-center gap-2"><Users className="h-3 w-3" />{r.userCount || 0} users {r.protected && <ShieldAlert className="h-3 w-3 text-amber-500" />}</div></button>)}</div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <AdminQueryState
          isLoading={viewState === "loading"}
          error={viewState === "error" ? loadError : null}
          onRetry={() => { void load(); }}
          loadingLabel="Loading role authority structure..."
        >
          {viewState === "empty" ? (
            <Card>
              <CardHeader><CardTitle className="text-base">No roles configured</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">No system or custom roles were returned. Seeded roles should appear automatically; if this persists, check startup seed status.</p>
                {canManageRoles && <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-3 w-3 mr-1" />Create Role</Button>}
              </CardContent>
            </Card>
          ) : (
            <>
              {viewState === "ready" && <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">System Roles</p><p className="mt-1 text-2xl font-semibold">{systemRoleCount}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Custom Roles</p><p className="mt-1 text-2xl font-semibold">{customRoleCount}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Protected Roles</p><p className="mt-1 text-2xl font-semibold">{protectedRoleCount}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Users With Roles</p><p className="mt-1 text-2xl font-semibold">{assignedUsers}</p></CardContent></Card>
              </div>}
              {viewState === "ready" && hasChanges && <div className="sticky top-2 z-20 rounded border bg-amber-50 px-3 py-2 flex items-center justify-between"><span className="text-sm">Unsaved changes</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDraft({})}>Reset</Button><Button size="sm" onClick={save} disabled={!canManageRoles}><Save className="h-3 w-3 mr-1" />Save</Button></div></div>}
              {viewState === "ready" && <Card><CardHeader><CardTitle className="text-base">{selected?.label || "Select role"}</CardTitle></CardHeader><CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  {authorityCategories.map((category) => (
                    <Card key={category.label}>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">{category.label}</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        {category.items.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {category.items.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No authority configured.</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Tabs defaultValue="overview">
                  <TabsList className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 w-full h-auto gap-1">
                    <TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="navigation">Navigation</TabsTrigger><TabsTrigger value="resources">Legacy Permissions</TabsTrigger><TabsTrigger value="authority">Authority Model</TabsTrigger><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="effective">Effective Access</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview" className="space-y-3 mt-3"><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><div><Label>Name</Label><Input value={effectiveRole.label || ""} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} disabled={!canManageRoles} /></div><div><Label>Description</Label><Input value={effectiveRole.description || ""} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} disabled={!canManageRoles} /></div></div><div className="text-sm text-muted-foreground">Type: {selected?.isSystem ? "System" : "Custom"} | Assigned users: {selected?.userCount || 0}</div></TabsContent>
                  <TabsContent value="navigation" className="mt-3"><div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">{NAV_SECTIONS.map((s) => <label key={s} className="text-sm border rounded p-2 flex items-center gap-2"><input type="checkbox" checked={Boolean((effectiveRole.sections || []).includes(s))} onChange={(e) => {
                    const next = new Set(effectiveRole.sections || []);
                    if (e.target.checked) next.add(s); else next.delete(s);
                    setDraft((d) => ({ ...d, sections: [...next] }));
                  }} disabled={!canManageRoles} />{s}</label>)}</div></TabsContent>
                  <TabsContent value="resources" className="mt-3"><div className="space-y-2 max-h-[46vh] overflow-auto">{resources.map((entity) => <div key={entity} className="rounded border p-2"><div className="font-medium text-sm mb-2">{entity}</div><div className="flex gap-2 flex-wrap">{ACTIONS.map((a) => <label key={a} className="text-xs border rounded px-2 py-1 flex items-center gap-1"><input type="checkbox" checked={Boolean(currentEp[entity]?.[a])} onChange={(e) => updateEp(entity, a, e.target.checked)} disabled={!canManageRoles} />{a}</label>)}</div></div>)}</div></TabsContent>
                  <TabsContent value="authority" className="mt-3 space-y-2">
                    <div className="text-xs text-muted-foreground">Operational authority model with scopes, assignment controls, and approval workflow hooks.</div>
                    <div className="space-y-2 max-h-[46vh] overflow-auto">
                      {resources.map((entity) => (
                        <div key={entity} className="rounded border p-2 space-y-2">
                          <div className="font-medium text-sm">{entity}</div>
                          {AUTHORITY_ACTIONS.map((action) => {
                            const key = `${entity}.${action}`;
                            const rule = authorityRules[key] || {};
                            return (
                              <div key={key} className="grid grid-cols-1 gap-2 md:grid-cols-4 items-center text-xs">
                                <span>{action}</span>
                                <Switch checked={Boolean(rule.enabled)} onCheckedChange={(v) => updateAuthorityRule(entity, action, { enabled: v })} disabled={!canManageRoles} />
                                <select className="border rounded h-8 px-2" value={rule.scope || "assigned_projects"} onChange={(e) => updateAuthorityRule(entity, action, { scope: e.target.value })} disabled={!canManageRoles}>
                                  {AUTHORITY_SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
                                </select>
                                <span className="text-muted-foreground">auditable</span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                  <TabsContent value="users" className="mt-3"><div className="space-y-2">{users.filter((u) => u.role === selectedRole).map((u) => <div key={u.id} className="border rounded p-2 flex justify-between items-center gap-3"><div><div className="text-sm font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{u.email}</div></div><Button size="sm" variant="outline" onClick={() => loadEffective(u.id)}>Inspect access</Button></div>)}</div></TabsContent>
                  <TabsContent value="effective" className="mt-3"><Button size="sm" onClick={() => loadEffective()}>Refresh effective access</Button><div className="space-y-2 mt-2 max-h-[45vh] overflow-auto">
                    <div className="text-sm font-medium">Legacy effective permissions by role</div>
                    {effective.map((row: any) => <div key={`legacy-${row.entity}`} className="rounded border p-2"><div className="font-medium text-sm mb-1">{row.entity}</div><div className="grid grid-cols-1 md:grid-cols-3 gap-1">{row.actions.map((a: any) => <div key={a.action} className={`text-xs rounded p-1 ${a.allowed ? "bg-green-50" : "bg-red-50"}`}>{a.action}: {a.allowed ? "Allowed" : "Blocked"}</div>)}</div></div>)}
                    <div className="text-sm font-medium pt-2">Authority effective permissions by role / user</div>
                    {authorityEffective.map((row: any) => <div key={`auth-${row.entity}`} className="rounded border p-2"><div className="font-medium text-sm mb-1">{row.entity}</div><div className="grid grid-cols-1 md:grid-cols-2 gap-1">{row.actions.map((a: any) => <div key={a.action} className={`text-xs rounded p-1 ${a.allowed ? "bg-green-50" : "bg-red-50"}`}>{a.action}: {a.allowed ? "Allowed" : "Blocked"} ({a.scope})</div>)}</div></div>)}
                  </div></TabsContent>
                </Tabs>
              </CardContent></Card>}
            </>
          )}
        </AdminQueryState>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}><DialogContent><DialogHeader><DialogTitle>Create role</DialogTitle></DialogHeader><div className="space-y-2"><Label>Role key</Label><Input value={createKey} onChange={(e) => setCreateKey(e.target.value.toUpperCase())} /><Label>Label</Label><Input value={createLabel} onChange={(e) => setCreateLabel(e.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={createRole} disabled={!canManageRoles}>Create</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function GlobalUsersView() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [search, setSearch] = useState("");
  const [savingDepartmentId, setSavingDepartmentId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [u, r] = await Promise.all([
        fetch("/api/admin/users", { headers: authHeaders(), credentials: "include" }),
        fetch("/api/roles", { headers: authHeaders(), credentials: "include" }),
      ]);
      const usersData = await parseJsonSafe<UserRow[] | { error?: string }>(u);
      const roleData = await parseJsonSafe<RoleRow[] | { error?: string }>(r);
      setUsers(Array.isArray(usersData) ? usersData : []);
      setRoles(Array.isArray(roleData) ? roleData : []);
    })();
  }, []);

  const updateRole = async (id: number, role: string) => {
    if (!role) return;
    const res = await fetch(`/api/admin/users/${id}/role`, { method: "PATCH", headers: authHeaders(), credentials: "include", body: JSON.stringify({ role }) });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    }
  };

  const updateDepartment = async (id: number, department: string) => {
    setSavingDepartmentId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}/department`, {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ department }),
      });
      const data = await parseJsonSafe<UserRow | { error?: string }>(res);
      if (!res.ok || !data || Array.isArray(data)) return;
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, department: "department" in data ? (data as UserRow).department ?? null : department || null } : u)),
      );
    } finally {
      setSavingDepartmentId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input placeholder="Search users" value={search} onChange={(e) => setSearch(e.target.value)} />
        {users
          .filter((u) => `${u.name} ${u.email} ${u.department || ""}`.toLowerCase().includes(search.toLowerCase()))
          .map((u) => (
            <div key={u.id} className="border rounded p-3 grid gap-3 lg:grid-cols-[minmax(0,1fr),220px,220px] lg:items-center">
              <div>
                <div className="font-medium text-sm">{u.name}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Department: <span className="font-medium text-foreground">{u.department || "Unassigned"}</span>
                </div>
              </div>
              <SearchableSelect
                options={roles.map((r) => ({ value: r.role, label: r.label }))}
                value={u.role}
                onValueChange={(val) => updateRole(u.id, val)}
                placeholder="Select role"
                searchPlaceholder="Search roles..."
                data-testid={`select-role-${u.id}`}
              />
              <SearchableSelect
                options={[
                  ...DEPARTMENTS.map((d) => ({ value: d, label: d })),
                  ...(u.department && !DEPARTMENTS.includes(u.department) ? [{ value: u.department, label: u.department }] : []),
                ]}
                value={u.department || ""}
                onValueChange={(val) => { if (val) void updateDepartment(u.id, val); }}
                placeholder="Select department"
                searchPlaceholder="Search departments..."
                disabled={savingDepartmentId === u.id}
                data-testid={`select-department-${u.id}`}
              />
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
