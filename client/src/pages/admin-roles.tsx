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
import { AlertTriangle, Check, ChevronRight, Plus, Save, Search, Shield, ShieldAlert, ShieldCheck, Users, UserCheck, Crown, Lock } from "lucide-react";
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
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-12 px-16 text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
            <p className="text-lg font-semibold">Access denied</p>
            <p className="text-sm text-muted-foreground mt-1">You don't have permission to manage roles.</p>
          </CardContent>
        </Card>
      </div>
    );
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
      <div className="space-y-6" data-testid="admin-roles-page">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Shield className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Roles & Permissions</h1>
            <p className="text-sm text-muted-foreground">Manage access control and user assignments</p>
          </div>
        </div>
        <Tabs defaultValue="roles">
          <TabsList className="bg-gray-100/80 p-1 h-auto">
            <TabsTrigger value="roles" className="data-[state=active]:bg-white data-[state=active]:shadow-sm px-5 py-2 text-sm font-medium" data-testid="tab-roles">
              Roles & Permissions
            </TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-white data-[state=active]:shadow-sm px-5 py-2 text-sm font-medium" data-testid="tab-users">
              Users
            </TabsTrigger>
          </TabsList>
          <TabsContent value="roles" className="mt-4"><RolesControlCenter /></TabsContent>
          <TabsContent value="users" className="mt-4"><GlobalUsersView /></TabsContent>
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

  const getRoleIcon = (r: RoleRow) => {
    if (r.protected) return <Lock className="h-4 w-4 text-amber-500" />;
    if (r.isSystem) return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
    return <Shield className="h-4 w-4 text-blue-500" />;
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px,minmax(0,1fr)]">
      <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-900">Roles</CardTitle>
              <Button size="sm" onClick={() => setShowCreate(true)} disabled={!canManageRoles} className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-3" data-testid="button-create-role">
                <Plus className="h-3.5 w-3.5 mr-1" />
                New Role
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="text-center p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                <p className="text-lg font-bold text-gray-900">{roles.length}</p>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total</p>
              </div>
              <div className="text-center p-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
                <p className="text-lg font-bold text-emerald-700">{systemRoleCount}</p>
                <p className="text-[11px] font-medium text-emerald-600 uppercase tracking-wider">System</p>
              </div>
              <div className="text-center p-2.5 rounded-lg bg-emerald-50/50 border border-emerald-100/70">
                <p className="text-lg font-bold text-emerald-700">{customRoleCount}</p>
                <p className="text-[11px] font-medium text-emerald-600 uppercase tracking-wider">Custom</p>
              </div>
              <div className="text-center p-2.5 rounded-lg bg-emerald-50/30 border border-emerald-100/50">
                <p className="text-lg font-bold text-emerald-700">{assignedUsers}</p>
                <p className="text-[11px] font-medium text-emerald-600 uppercase tracking-wider">Users</p>
              </div>
            </div>

            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 h-9 bg-gray-50 border-gray-200 focus:bg-white"
                placeholder="Search roles..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                data-testid="input-search-roles"
                aria-label="Search roles"
              />
            </div>

            <div className="flex gap-1">
              {(["all", "system", "custom"] as const).map((k) => (
                <Button
                  key={k}
                  variant={kindFilter === k ? "default" : "outline"}
                  size="sm"
                  onClick={() => setKindFilter(k)}
                  className={`h-7 text-xs font-medium flex-1 ${kindFilter === k ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                  data-testid={`button-filter-${k}`}
                >
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </Button>
              ))}
            </div>

            <div className="space-y-1.5 max-h-[60vh] overflow-auto pr-1">
              {filteredRoles.map((r) => {
                const isSelected = selectedRole === r.role;
                return (
                  <button
                    key={r.role}
                    className={`w-full text-left rounded-lg border p-3 transition-all duration-150 group ${
                      isSelected
                        ? "border-emerald-300 bg-emerald-50 shadow-sm ring-1 ring-emerald-200"
                        : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                    }`}
                    onClick={() => setSelectedRole(r.role)}
                    data-testid={`button-role-${r.role}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected ? "bg-emerald-100" : "bg-gray-100 group-hover:bg-gray-200/70"
                      }`}>
                        {getRoleIcon(r)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold text-sm truncate ${isSelected ? "text-emerald-900" : "text-gray-900"}`}>
                            {r.label}
                          </span>
                          {r.isSystem && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-gray-100 text-gray-500 border-gray-200 font-medium shrink-0">
                              System
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {r.userCount || 0} users
                          </span>
                          {r.protected && (
                            <span className="text-xs text-amber-600 flex items-center gap-0.5">
                              <Lock className="h-3 w-3" />
                              Protected
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className={`h-4 w-4 shrink-0 transition-colors ${isSelected ? "text-emerald-500" : "text-gray-300 group-hover:text-gray-400"}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <AdminQueryState
          isLoading={viewState === "loading"}
          error={viewState === "error" ? loadError : null}
          onRetry={() => { void load(); }}
          loadingLabel="Loading role authority structure..."
        >
          {viewState === "empty" ? (
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="py-16 text-center">
                <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <Shield className="h-6 w-6 text-gray-400" />
                </div>
                <p className="text-lg font-semibold text-gray-900">No roles configured</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  No system or custom roles were found. Seeded roles should appear automatically on startup.
                </p>
                {canManageRoles && (
                  <Button size="sm" onClick={() => setShowCreate(true)} className="mt-4 bg-emerald-600 hover:bg-emerald-700">
                    <Plus className="h-3.5 w-3.5 mr-1" />Create Role
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {viewState === "ready" && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Card className="border-gray-200 shadow-sm" data-testid="stat-system-roles">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-emerald-600 mb-2">
                        <ShieldCheck className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">System Roles</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{systemRoleCount}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-gray-200 shadow-sm" data-testid="stat-custom-roles">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-emerald-600 mb-2">
                        <Shield className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Custom Roles</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{customRoleCount}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-gray-200 shadow-sm" data-testid="stat-protected-roles">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-amber-600 mb-2">
                        <Lock className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Protected</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{protectedRoleCount}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-gray-200 shadow-sm" data-testid="stat-users-assigned">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-emerald-600 mb-2">
                        <UserCheck className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Users Assigned</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{assignedUsers}</p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {viewState === "ready" && hasChanges && (
                <div className="sticky top-2 z-20 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    </div>
                    <span className="text-sm font-medium text-amber-800">You have unsaved changes</span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDraft({})} className="h-8 border-amber-300 text-amber-700 hover:bg-amber-100" data-testid="button-reset-changes">
                      Reset
                    </Button>
                    <Button size="sm" onClick={save} disabled={!canManageRoles} className="h-8 bg-emerald-600 hover:bg-emerald-700" data-testid="button-save-changes">
                      <Save className="h-3.5 w-3.5 mr-1" />Save Changes
                    </Button>
                  </div>
                </div>
              )}

              {viewState === "ready" && (
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader className="border-b border-gray-100 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                        {selected && getRoleIcon(selected)}
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold text-gray-900">{selected?.label || "Select a role"}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {selected?.isSystem ? "System role" : "Custom role"} · {selected?.userCount || 0} users assigned
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                      {authorityCategories.map((category) => (
                        <div key={category.label} className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
                          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{category.label}</h4>
                          {category.items.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {category.items.map((item) => (
                                <Badge key={item} variant="outline" className="text-xs bg-white border-gray-200 text-gray-700 font-medium">
                                  {item}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No authority configured</p>
                          )}
                        </div>
                      ))}
                    </div>

                    <Tabs defaultValue="overview">
                      <TabsList className="bg-gray-100/80 p-1 h-auto flex-wrap gap-0.5">
                        {[
                          { value: "overview", label: "Overview" },
                          { value: "navigation", label: "Navigation" },
                          { value: "resources", label: "Permissions" },
                          { value: "authority", label: "Authority Model" },
                          { value: "users", label: "Users" },
                          { value: "effective", label: "Effective Access" },
                        ].map((tab) => (
                          <TabsTrigger
                            key={tab.value}
                            value={tab.value}
                            className="data-[state=active]:bg-white data-[state=active]:shadow-sm px-3 py-1.5 text-xs font-medium"
                            data-testid={`tab-role-${tab.value}`}
                          >
                            {tab.label}
                          </TabsTrigger>
                        ))}
                      </TabsList>

                      <TabsContent value="overview" className="space-y-4 mt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="role-name" className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Role Name</Label>
                            <Input
                              id="role-name"
                              value={effectiveRole.label || ""}
                              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                              disabled={!canManageRoles}
                              className="h-10 bg-gray-50 border-gray-200 focus:bg-white"
                              data-testid="input-role-name"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="role-description" className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</Label>
                            <Input
                              id="role-description"
                              value={effectiveRole.description || ""}
                              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                              disabled={!canManageRoles}
                              className="h-10 bg-gray-50 border-gray-200 focus:bg-white"
                              data-testid="input-role-description"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-4 py-2 px-3 rounded-lg bg-gray-50 border border-gray-100">
                          <span className="text-sm text-gray-600">
                            <strong>Type:</strong> {selected?.isSystem ? "System" : "Custom"}
                          </span>
                          <span className="text-gray-300">|</span>
                          <span className="text-sm text-gray-600">
                            <strong>Assigned users:</strong> {selected?.userCount || 0}
                          </span>
                        </div>
                      </TabsContent>

                      <TabsContent value="navigation" className="mt-4">
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                          {NAV_SECTIONS.map((s) => {
                            const checked = Boolean((effectiveRole.sections || []).includes(s));
                            return (
                              <label
                                key={s}
                                className={`flex items-center gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors ${
                                  checked ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(effectiveRole.sections || []);
                                    if (e.target.checked) next.add(s); else next.delete(s);
                                    setDraft((d) => ({ ...d, sections: [...next] }));
                                  }}
                                  disabled={!canManageRoles}
                                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className={`text-sm font-medium ${checked ? "text-emerald-800" : "text-gray-700"}`}>{s.replace(/_/g, " ")}</span>
                              </label>
                            );
                          })}
                        </div>
                      </TabsContent>

                      <TabsContent value="resources" className="mt-4">
                        <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
                          {resources.map((entity) => (
                            <div key={entity} className="rounded-lg border border-gray-200 p-3 bg-white">
                              <div className="font-semibold text-sm text-gray-900 mb-2">{entity}</div>
                              <div className="flex gap-2 flex-wrap">
                                {ACTIONS.map((a) => {
                                  const isOn = Boolean(currentEp[entity]?.[a]);
                                  return (
                                    <label
                                      key={a}
                                      className={`text-xs rounded-md px-2.5 py-1.5 flex items-center gap-1.5 cursor-pointer border transition-colors ${
                                        isOn ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-gray-50 border-gray-200 text-gray-500"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isOn}
                                        onChange={(e) => updateEp(entity, a, e.target.checked)}
                                        disabled={!canManageRoles}
                                        className="h-3 w-3 rounded text-emerald-600"
                                      />
                                      <span className="font-medium">{a}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </TabsContent>

                      <TabsContent value="authority" className="mt-4 space-y-3">
                        <p className="text-sm text-muted-foreground px-1">
                          Operational authority model with scopes, assignment controls, and approval workflow hooks.
                        </p>
                        <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
                          {resources.map((entity) => (
                            <div key={entity} className="rounded-lg border border-gray-200 p-4 bg-white space-y-3">
                              <div className="font-semibold text-sm text-gray-900 pb-2 border-b border-gray-100">{entity}</div>
                              {AUTHORITY_ACTIONS.map((action) => {
                                const key = `${entity}.${action}`;
                                const rule = authorityRules[key] || {};
                                return (
                                  <div key={key} className="grid grid-cols-[1fr,auto,1fr,auto] gap-3 items-center text-sm py-1">
                                    <span className="text-gray-700 font-medium">{action}</span>
                                    <Switch
                                      checked={Boolean(rule.enabled)}
                                      onCheckedChange={(v) => updateAuthorityRule(entity, action, { enabled: v })}
                                      disabled={!canManageRoles}
                                    />
                                    <select
                                      className="border border-gray-200 rounded-md h-8 px-2 text-sm bg-gray-50 focus:bg-white focus:border-emerald-300 focus:ring-1 focus:ring-emerald-200"
                                      value={rule.scope || "assigned_projects"}
                                      onChange={(e) => updateAuthorityRule(entity, action, { scope: e.target.value })}
                                      disabled={!canManageRoles}
                                    >
                                      {AUTHORITY_SCOPES.map((scope) => <option key={scope} value={scope}>{scope.replace(/_/g, " ")}</option>)}
                                    </select>
                                    <Badge variant="outline" className="text-[10px] text-gray-400 border-gray-200">auditable</Badge>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </TabsContent>

                      <TabsContent value="users" className="mt-4">
                        <div className="space-y-2">
                          {users.filter((u) => u.role === selectedRole).length === 0 ? (
                            <div className="py-12 text-center">
                              <Users className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                              <p className="text-sm text-muted-foreground">No users assigned to this role</p>
                            </div>
                          ) : (
                            users.filter((u) => u.role === selectedRole).map((u) => (
                              <div key={u.id} className="border border-gray-200 rounded-lg p-3 flex justify-between items-center gap-3 bg-white hover:bg-gray-50 transition-colors">
                                <div className="flex items-center gap-3">
                                  <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold text-sm">
                                    {(u.name || "?").charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                    <div className="text-sm font-semibold text-gray-900">{u.name}</div>
                                    <div className="text-xs text-muted-foreground">{u.email}</div>
                                  </div>
                                </div>
                                <Button size="sm" variant="outline" onClick={() => loadEffective(u.id)} className="h-8 text-xs border-gray-200" data-testid={`button-inspect-${u.id}`}>
                                  Inspect access
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </TabsContent>

                      <TabsContent value="effective" className="mt-4">
                        <Button size="sm" onClick={() => loadEffective()} className="mb-4 bg-emerald-600 hover:bg-emerald-700" data-testid="button-refresh-effective">
                          Refresh effective access
                        </Button>
                        <div className="space-y-3 max-h-[55vh] overflow-auto pr-1">
                          {effective.length > 0 && <h4 className="text-sm font-semibold text-gray-700">Legacy Permissions</h4>}
                          {effective.map((row: any) => (
                            <div key={`legacy-${row.entity}`} className="rounded-lg border border-gray-200 p-3 bg-white">
                              <div className="font-semibold text-sm mb-2 text-gray-900">{row.entity}</div>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                                {row.actions.map((a: any) => (
                                  <div key={a.action} className={`text-xs rounded-md p-2 font-medium flex items-center gap-1.5 ${
                                    a.allowed ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
                                  }`}>
                                    {a.allowed ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                    {a.action}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                          {authorityEffective.length > 0 && <h4 className="text-sm font-semibold text-gray-700 pt-2">Authority Permissions</h4>}
                          {authorityEffective.map((row: any) => (
                            <div key={`auth-${row.entity}`} className="rounded-lg border border-gray-200 p-3 bg-white">
                              <div className="font-semibold text-sm mb-2 text-gray-900">{row.entity}</div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                                {row.actions.map((a: any) => (
                                  <div key={a.action} className={`text-xs rounded-md p-2 font-medium flex items-center gap-1.5 ${
                                    a.allowed ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
                                  }`}>
                                    {a.allowed ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                    {a.action} ({a.scope})
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </AdminQueryState>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg">Create New Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-role-key" className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Role Key</Label>
              <Input id="create-role-key" value={createKey} onChange={(e) => setCreateKey(e.target.value.toUpperCase())} placeholder="e.g. SITE_MANAGER" className="h-10" data-testid="input-create-role-key" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-role-label" className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Display Name</Label>
              <Input id="create-role-label" value={createLabel} onChange={(e) => setCreateLabel(e.target.value)} placeholder="e.g. Site Manager" className="h-10" data-testid="input-create-role-label" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} data-testid="button-cancel-create">Cancel</Button>
            <Button onClick={createRole} disabled={!canManageRoles} className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-confirm-create">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

  const filtered = users.filter((u) => `${u.name} ${u.email} ${u.department || ""}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader className="border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-violet-100 flex items-center justify-center">
              <Users className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold text-gray-900">User Management</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{users.length} total users · {filtered.length} shown</p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 h-10 bg-gray-50 border-gray-200 focus:bg-white"
            placeholder="Search users by name, email, or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-users"
            aria-label="Search users"
          />
        </div>

        <div className="space-y-2">
          {filtered.map((u) => (
            <div key={u.id} className="border border-gray-200 rounded-lg p-4 grid gap-4 lg:grid-cols-[minmax(0,1fr),220px,220px] lg:items-center bg-white hover:bg-gray-50/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm shrink-0">
                  {(u.name || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-gray-900">{u.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Dept: <span className="font-medium text-gray-700">{u.department || "Unassigned"}</span>
                  </div>
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
        </div>
      </CardContent>
    </Card>
  );
}
