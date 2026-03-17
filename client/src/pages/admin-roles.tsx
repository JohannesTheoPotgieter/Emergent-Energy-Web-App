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
import { AlertTriangle, Check, ChevronDown, ChevronRight, Eye, EyeOff, Pencil, Plus, Save, Search, Shield, ShieldCheck, Trash2, Users, UserCheck, Lock, X, ToggleLeft, ToggleRight } from "lucide-react";
import type { AuthorityAction, PermissionAction } from "@shared/schema";

const DEPARTMENTS = [
  "Executive", "Engineering", "Finance", "Operations", "Project Development",
  "Project Management", "Quality", "Procurement", "Commercial", "Construction",
  "Health & Safety", "IT", "HR", "Legal",
];

const ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];
const AUTHORITY_ACTIONS: AuthorityAction[] = ["view", "create", "edit", "delete", "approve", "assign", "reassign", "close_complete", "export", "manage_settings"];
const AUTHORITY_SCOPES = ["own", "department", "assigned_projects", "all_projects", "company_admin"] as const;
const NAV_SECTIONS = [
  { key: "HOME", label: "Home", description: "Dashboard & My Work" },
  { key: "PROJECT_LIFECYCLE", label: "Project Lifecycle", description: "Lifecycle stages & clients" },
  { key: "PROJECT_DEVELOPMENT", label: "Project Development", description: "PD dashboard & tickets" },
  { key: "PROJECT_MANAGEMENT", label: "Project Management", description: "Execution & project controls" },
  { key: "ENGINEERING", label: "Engineering", description: "Engineering tasks & overview" },
  { key: "QUALITY", label: "Quality", description: "Quality workspace" },
  { key: "FINANCE", label: "Finance", description: "Cashflow, COS, revenue & GP" },
  { key: "KNOWLEDGE", label: "Knowledge", description: "SOPs, training & feedback" },
  { key: "ADMIN", label: "Admin", description: "System settings & tools" },
];

const ENTITY_CATEGORIES: Record<string, { label: string; entities: string[] }> = {
  core: {
    label: "Core Access",
    entities: ["projects", "my_work", "notifications", "deliverables", "activity_log", "audit_trail"],
  },
  engineering: {
    label: "Engineering",
    entities: ["engineering", "eng_tasks", "eng_stages"],
  },
  quality: {
    label: "Quality",
    entities: ["quality"],
  },
  finance: {
    label: "Finance & Commercial",
    entities: ["financials", "procurement"],
  },
  project_dev: {
    label: "Project Development",
    entities: ["pd_dashboard", "pd_overview", "pd_plan", "pd_gantt", "pd_finance", "pd_revenue", "pd_cashflow", "pd_cos_tracker", "pd_expenditure", "pd_history", "pd_key_dates", "pd_quality", "pd_engineering", "pd_eng_tasks", "pd_eng_stages", "pd_collaboration", "pd_subcontractors"],
  },
  collaboration: {
    label: "Collaboration & Comms",
    entities: ["teams_chat", "project_chat", "collaboration_hub", "sharepoint_files", "meetings"],
  },
  admin: {
    label: "Administration",
    entities: ["admin", "admin_roles", "data_import", "data_export", "database_migration", "ms_integration", "ms_sync"],
  },
  other: {
    label: "Other",
    entities: ["approvals", "leaderboard", "feedback", "portfolio_detail", "weekly_review_wizard", "create_project"],
  },
};

function formatEntityName(entity: string): string {
  return entity
    .replace(/^pd_/, "PD ")
    .replace(/^eng_/, "Eng ")
    .replace(/^ms_/, "MS ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  view: <Eye className="h-3.5 w-3.5" />,
  create: <Plus className="h-3.5 w-3.5" />,
  edit: <Pencil className="h-3.5 w-3.5" />,
  approve: <Check className="h-3.5 w-3.5" />,
  override: <ShieldCheck className="h-3.5 w-3.5" />,
  delete: <Trash2 className="h-3.5 w-3.5" />,
};

const ACTION_COLORS_ON: Record<string, string> = {
  view: "bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-200",
  create: "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200",
  edit: "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200",
  approve: "bg-violet-100 text-violet-700 border-violet-300 hover:bg-violet-200",
  override: "bg-orange-100 text-orange-700 border-orange-300 hover:bg-orange-200",
  delete: "bg-red-100 text-red-700 border-red-300 hover:bg-red-200",
};

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

function PermissionToggle({ entity, action, isOn, disabled, onChange }: {
  entity: string; action: string; isOn: boolean; disabled: boolean;
  onChange: (entity: string, action: string, value: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(entity, action, !isOn)}
      className={`
        inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all duration-150 min-w-[80px] justify-center
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${isOn
          ? ACTION_COLORS_ON[action] || "bg-emerald-100 text-emerald-700 border-emerald-300"
          : "bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100 hover:text-gray-500"
        }
      `}
      title={`${isOn ? "Revoke" : "Grant"} ${action} on ${formatEntityName(entity)}`}
      aria-label={`${action} permission for ${formatEntityName(entity)}: ${isOn ? "enabled" : "disabled"}`}
      data-testid={`toggle-${entity}-${action}`}
    >
      {ACTION_ICONS[action] || (isOn ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />)}
      <span className="capitalize">{action}</span>
    </button>
  );
}

function PermissionMatrixCategory({ categoryKey, category, currentEp, canManageRoles, updateEp }: {
  categoryKey: string;
  category: { label: string; entities: string[] };
  currentEp: Record<string, Record<string, boolean>>;
  canManageRoles: boolean;
  updateEp: (entity: string, action: string, value: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const entitiesWithPerms = category.entities.filter((e) => currentEp[e] !== undefined);
  if (entitiesWithPerms.length === 0) return null;

  const totalGrants = entitiesWithPerms.reduce((sum, e) => {
    return sum + Object.values(currentEp[e] || {}).filter(Boolean).length;
  }, 0);
  const totalPossible = entitiesWithPerms.reduce((sum, e) => {
    return sum + Object.keys(currentEp[e] || {}).length;
  }, 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden" data-testid={`perm-category-${categoryKey}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50/80 hover:bg-gray-100/80 transition-colors"
        data-testid={`toggle-category-${categoryKey}`}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
          <span className="text-sm font-semibold text-gray-800">{category.label}</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 bg-gray-200/70 text-gray-600">
            {entitiesWithPerms.length} {entitiesWithPerms.length === 1 ? "entity" : "entities"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {totalGrants}/{totalPossible} granted
          </span>
          <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: totalPossible > 0 ? `${(totalGrants / totalPossible) * 100}%` : "0%" }}
            />
          </div>
        </div>
      </button>
      {expanded && (
        <div className="divide-y divide-gray-100">
          {entitiesWithPerms.map((entity) => {
            const perms = currentEp[entity] || {};
            const actions = Object.keys(perms);
            const grantedCount = Object.values(perms).filter(Boolean).length;
            return (
              <div key={entity} className="px-4 py-3 hover:bg-gray-50/50 transition-colors" data-testid={`perm-row-${entity}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{formatEntityName(entity)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {grantedCount}/{actions.length} active
                    </span>
                  </div>
                  {canManageRoles && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => actions.forEach((a) => updateEp(entity, a, true))}
                        className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 font-medium"
                        title="Grant all permissions"
                        data-testid={`grant-all-${entity}`}
                      >
                        Grant All
                      </button>
                      <button
                        type="button"
                        onClick={() => actions.forEach((a) => updateEp(entity, a, false))}
                        className="text-[10px] px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 font-medium"
                        title="Revoke all permissions"
                        data-testid={`revoke-all-${entity}`}
                      >
                        Revoke All
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {actions.sort((a, b) => ACTIONS.indexOf(a as PermissionAction) - ACTIONS.indexOf(b as PermissionAction)).map((action) => (
                    <PermissionToggle
                      key={action}
                      entity={entity}
                      action={action}
                      isOn={Boolean(perms[action])}
                      disabled={!canManageRoles}
                      onChange={updateEp}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PermissionsSummaryBar({ currentEp }: { currentEp: Record<string, Record<string, boolean>> }) {
  const entities = Object.keys(currentEp).filter((k) => !k.startsWith("_"));
  const totals: Record<string, { granted: number; total: number }> = {};
  ACTIONS.forEach((a) => { totals[a] = { granted: 0, total: 0 }; });

  entities.forEach((entity) => {
    const perms = currentEp[entity] || {};
    Object.entries(perms).forEach(([action, value]) => {
      if (totals[action]) {
        totals[action].total++;
        if (value) totals[action].granted++;
      }
    });
  });

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4" data-testid="permissions-summary">
      {ACTIONS.map((action) => {
        const { granted, total } = totals[action] || { granted: 0, total: 0 };
        if (total === 0) return null;
        return (
          <div key={action} className="rounded-lg border border-gray-200 bg-white p-2.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              {ACTION_ICONS[action]}
              <span className="text-xs font-semibold capitalize text-gray-700">{action}</span>
            </div>
            <p className="text-lg font-bold text-gray-900">{granted}<span className="text-sm font-normal text-gray-400">/{total}</span></p>
          </div>
        );
      })}
    </div>
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
    return <Shield className="h-4 w-4 text-emerald-500" />;
  };

  const categorizedEntities = useMemo(() => {
    const assigned = new Set<string>();
    const result: { key: string; label: string; entities: string[] }[] = [];
    Object.entries(ENTITY_CATEGORIES).forEach(([key, cat]) => {
      const matching = cat.entities.filter((e) => resources.includes(e));
      matching.forEach((e) => assigned.add(e));
      if (matching.length > 0) result.push({ key, label: cat.label, entities: matching });
    });
    const uncategorized = resources.filter((e) => !assigned.has(e));
    if (uncategorized.length > 0) result.push({ key: "uncategorized", label: "Other Permissions", entities: uncategorized });
    return result;
  }, [resources]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px,minmax(0,1fr)]">
      <div className="space-y-4 md:sticky md:top-4 md:self-start md:max-h-[calc(100vh-6rem)] md:overflow-hidden">
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
            <div className="grid grid-cols-4 gap-1.5">
              <div className="text-center p-1.5 rounded-lg bg-gray-50 border border-gray-100">
                <p className="text-sm font-bold text-gray-900">{roles.length}</p>
                <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Total</p>
              </div>
              <div className="text-center p-1.5 rounded-lg bg-emerald-50 border border-emerald-100">
                <p className="text-sm font-bold text-emerald-700">{systemRoleCount}</p>
                <p className="text-[9px] font-medium text-emerald-600 uppercase tracking-wider">System</p>
              </div>
              <div className="text-center p-1.5 rounded-lg bg-emerald-50/50 border border-emerald-100/70">
                <p className="text-sm font-bold text-emerald-700">{customRoleCount}</p>
                <p className="text-[9px] font-medium text-emerald-600 uppercase tracking-wider">Custom</p>
              </div>
              <div className="text-center p-1.5 rounded-lg bg-emerald-50/30 border border-emerald-100/50">
                <p className="text-sm font-bold text-emerald-700">{assignedUsers}</p>
                <p className="text-[9px] font-medium text-emerald-600 uppercase tracking-wider">Users</p>
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

            <div className="space-y-1.5 max-h-[45vh] lg:max-h-[calc(100vh-22rem)] overflow-auto pr-1">
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
                    <Tabs defaultValue="permissions">
                      <TabsList className="bg-gray-100/80 p-1 h-auto flex-wrap gap-0.5">
                        {[
                          { value: "permissions", label: "Permissions" },
                          { value: "overview", label: "Overview" },
                          { value: "navigation", label: "Navigation" },
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

                      <TabsContent value="permissions" className="mt-4">
                        {resources.length === 0 ? (
                          <div className="py-12 text-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50">
                            <ToggleLeft className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                            <p className="text-sm font-medium text-gray-600">No permissions configured for this role</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              This role has no entity permissions set. Permissions are typically configured during role setup.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-3">
                              <p className="text-sm text-emerald-800">
                                <strong>How it works:</strong> Click any permission button to toggle it on or off.
                                Color-coded buttons show the current state — colored means granted, gray means revoked.
                                Use "Grant All" or "Revoke All" for bulk changes.
                              </p>
                            </div>
                            <PermissionsSummaryBar currentEp={currentEp} />
                            <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
                              {categorizedEntities.map((cat) => (
                                <PermissionMatrixCategory
                                  key={cat.key}
                                  categoryKey={cat.key}
                                  category={cat}
                                  currentEp={currentEp}
                                  canManageRoles={canManageRoles}
                                  updateEp={updateEp}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </TabsContent>

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

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                      </TabsContent>

                      <TabsContent value="navigation" className="mt-4">
                        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-3">
                          <p className="text-sm text-emerald-800">
                            <strong>Navigation access:</strong> Toggle which sections of the app this role can see in the top navigation bar.
                            These match the navigation tabs shown at the top of the screen.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {NAV_SECTIONS.map((section) => {
                            const checked = Boolean((effectiveRole.sections || []).includes(section.key));
                            return (
                              <label
                                key={section.key}
                                className={`flex items-start gap-3 rounded-lg border p-3.5 cursor-pointer transition-colors ${
                                  checked ? "border-emerald-300 bg-emerald-50 shadow-sm" : "border-gray-200 bg-white hover:bg-gray-50"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(effectiveRole.sections || []);
                                    if (e.target.checked) next.add(section.key); else next.delete(section.key);
                                    setDraft((d) => ({ ...d, sections: [...next] }));
                                  }}
                                  disabled={!canManageRoles}
                                  className="h-4 w-4 mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                  data-testid={`checkbox-nav-${section.key}`}
                                />
                                <div className="min-w-0">
                                  <span className={`text-sm font-semibold block ${checked ? "text-emerald-800" : "text-gray-700"}`}>{section.label}</span>
                                  <span className="text-xs text-muted-foreground">{section.description}</span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </TabsContent>

                      <TabsContent value="authority" className="mt-4 space-y-3">
                        <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-4 py-3">
                          <p className="text-sm text-violet-800">
                            <strong>Authority model:</strong> Fine-grained operational authority with scope controls.
                            Enable actions per entity and set the scope (own items, department, assigned projects, all projects, or company-wide).
                          </p>
                        </div>
                        {resources.length === 0 ? (
                          <div className="py-12 text-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50">
                            <Shield className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                            <p className="text-sm font-medium text-gray-600">No authority rules configured</p>
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
                            {resources.map((entity) => (
                              <div key={entity} className="rounded-lg border border-gray-200 p-4 bg-white space-y-3">
                                <div className="font-semibold text-sm text-gray-900 pb-2 border-b border-gray-100">{formatEntityName(entity)}</div>
                                <div className="space-y-2">
                                  {AUTHORITY_ACTIONS.map((action) => {
                                    const key = `${entity}.${action}`;
                                    const rule = authorityRules[key] || {};
                                    const isEnabled = Boolean(rule.enabled);
                                    return (
                                      <div key={key} className={`grid grid-cols-[1fr,auto,1fr] gap-3 items-center text-sm py-1.5 px-2 rounded-md transition-colors ${isEnabled ? "bg-emerald-50/50" : ""}`}>
                                        <span className="text-gray-700 font-medium capitalize">{action.replace(/_/g, " ")}</span>
                                        <Switch
                                          checked={isEnabled}
                                          onCheckedChange={(v) => updateAuthorityRule(entity, action, { enabled: v })}
                                          disabled={!canManageRoles}
                                          aria-label={`${action} authority for ${formatEntityName(entity)}`}
                                          data-testid={`switch-authority-${entity}-${action}`}
                                        />
                                        <select
                                          className={`border rounded-md h-8 px-2 text-sm transition-colors ${
                                            isEnabled
                                              ? "border-emerald-200 bg-emerald-50 text-emerald-800 focus:border-emerald-300 focus:ring-1 focus:ring-emerald-200"
                                              : "border-gray-200 bg-gray-50 text-gray-400 focus:bg-white focus:border-gray-300"
                                          }`}
                                          value={rule.scope || "assigned_projects"}
                                          onChange={(e) => updateAuthorityRule(entity, action, { scope: e.target.value })}
                                          disabled={!canManageRoles || !isEnabled}
                                          aria-label={`Scope for ${action} on ${formatEntityName(entity)}`}
                                          data-testid={`select-scope-${entity}-${action}`}
                                        >
                                          {AUTHORITY_SCOPES.map((scope) => <option key={scope} value={scope}>{scope.replace(/_/g, " ")}</option>)}
                                        </select>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
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
                          {effective.length === 0 && authorityEffective.length === 0 && (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                              Click "Refresh effective access" to see what this role can actually do.
                            </div>
                          )}
                          {effective.length > 0 && <h4 className="text-sm font-semibold text-gray-700">Entity Permissions</h4>}
                          {effective.map((row: any, idx: number) => (
                            <div key={`legacy-${row.entity}-${idx}`} className="rounded-lg border border-gray-200 p-3 bg-white">
                              <div className="font-semibold text-sm mb-2 text-gray-900">{formatEntityName(row.entity)}</div>
                              <div className="flex flex-wrap gap-1.5">
                                {row.actions.map((a: any) => (
                                  <div key={a.action} className={`text-xs rounded-lg px-3 py-1.5 font-semibold flex items-center gap-1.5 ${
                                    a.allowed
                                      ? ACTION_COLORS_ON[a.action] || "bg-emerald-100 text-emerald-700 border border-emerald-300"
                                      : "bg-gray-100 text-gray-400 border border-gray-200"
                                  }`}>
                                    {a.allowed ? (ACTION_ICONS[a.action] || <Check className="h-3 w-3" />) : <X className="h-3 w-3" />}
                                    <span className="capitalize">{a.action}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                          {authorityEffective.length > 0 && <h4 className="text-sm font-semibold text-gray-700 pt-2">Authority Permissions</h4>}
                          {authorityEffective.map((row: any, idx: number) => (
                            <div key={`auth-${row.entity}-${idx}`} className="rounded-lg border border-gray-200 p-3 bg-white">
                              <div className="font-semibold text-sm mb-2 text-gray-900">{formatEntityName(row.entity)}</div>
                              <div className="flex flex-wrap gap-1.5">
                                {row.actions.map((a: any) => (
                                  <div key={a.action} className={`text-xs rounded-lg px-3 py-1.5 font-semibold flex items-center gap-1.5 ${
                                    a.allowed
                                      ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                                      : "bg-gray-100 text-gray-400 border border-gray-200"
                                  }`}>
                                    {a.allowed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                                    <span className="capitalize">{a.action}</span>
                                    <span className="text-[10px] opacity-70">({a.scope})</span>
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
            <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Users className="h-5 w-5 text-emerald-600" />
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
