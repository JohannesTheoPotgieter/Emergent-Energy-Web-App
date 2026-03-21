import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
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
  canManageRoleActions,
  resolveAdminRolesViewState,
  resolveSelectedRole,
  type AdminRolesViewState,
  type RoleSummary,
  type UserSummary,
} from "./admin-roles.utils";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clock, Eye, EyeOff, FileText, Pencil, Plus, Save, Search, Shield, ShieldCheck, Trash2, Users, UserCheck, Lock, X, ToggleLeft, ToggleRight } from "lucide-react";
import type { PermissionAction, PermissionEntity } from "@shared/schema";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";

const DEPARTMENTS = [
  "Executive", "Engineering", "Finance", "Operations", "Project Development",
  "Project Management", "Quality", "Procurement", "Commercial", "Construction",
  "Health & Safety", "IT", "HR", "Legal",
];

const ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];
const NAV_SECTIONS = [
  { key: "COCKPIT", label: "Home", description: "Home, My Work" },
  { key: "PROJECTS", label: "Project Lifecycle", description: "Overview, Lifecycle Board, Stage Gates, Clients" },
  { key: "PROJECT_DEVELOPMENT", label: "Project Development", description: "PD Dashboard, PD Tickets" },
  { key: "PROJECT_MANAGEMENT", label: "Project Management", description: "Execution Dashboard, Project List, Deliverables, PM Dashboard, PM On-The-Go" },
  { key: "ENGINEERING", label: "Engineering", description: "Engineering Overview, Requests & Tasks" },
  { key: "GOVERNANCE", label: "Quality", description: "Quality Workspace" },
  { key: "MONEY", label: "Finance", description: "Cashflow, Cost of Sales, Revenue, Gross Profit, Procurement" },
  { key: "INFORMATION", label: "Knowledge", description: "Lifecycle & SOP, Leaderboard, Training, Feedback" },
  { key: "COLLABORATION", label: "Collaboration", description: "Project Chat & Meetings" },
  { key: "ADMIN", label: "Admin", description: "Control Center, Smart Import, Roles & Permissions, Audit Log" },
];

const ENTITY_DESCRIPTIONS: Record<string, string> = {
  home: "Home page dashboard & landing",
  my_work: "My Work hub — tasks, calendar, meetings",
  my_tool: "My Work task planner (Today, Week, Backlog)",
  company_priorities: "Company-wide priorities & goals",

  lifecycle: "Project Lifecycle overview & board",
  create_project: "Create new project from lifecycle",
  pd_clients: "Clients list & client overview",

  pd_dashboard: "PD Dashboard — project development pipeline",
  pd_tickets: "PD Tickets — development tickets & tracking",

  projects: "Project List — all projects summary table",
  execution_board: "Execution Dashboard — delivery KPIs & cards",
  deliverables: "Deliverables tracker across projects",
  pm_dashboard: "Project Manager Dashboard",
  pm_on_the_go: "PM On-The-Go mobile site management",
  approvals: "Approvals — pending approval queue",
  weekly_review_wizard: "Weekly Reviews — guided review wizard",
  portfolios: "Portfolio view — grouped project analysis",
  portfolio_detail: "Portfolio detail — drilldown view",

  engineering: "Engineering Overview — team workload & status",
  eng_tasks: "Engineering Requests & Tasks",
  eng_stages: "Engineering 5-Stage Checklist system",

  quality: "Quality Workspace — QA gates & inspections",

  cashflow: "Cashflow — inflows, outflows, forecast",
  cos: "Cost of Sales — COS tracking & realised",
  revenue_tracker: "Revenue Tracker — invoiced & outstanding",
  gp_tracker: "Gross Profit Tracker — GP% & margins",
  financials: "Finance — general financial access",
  procurement: "Procurement Hub & subcontractor management",
  subcontractors: "Counterparties & procurement pipeline",
  invoice_patterns: "Invoice Pattern Library",

  ee_info: "Lifecycle & SOP — company knowledge base",
  leaderboard: "Leaderboard — team & department scores",
  training: "Training — learning resources & modules",
  feedback: "Feedback & Support — suggestions & issues",
  department_scores: "Department Scores — team performance",

  teams_chat: "Teams Chat — Microsoft Teams messages",
  project_chat: "Project Chat — per-project messaging",
  collaboration_hub: "Collaboration Hub — files & communication",
  sharepoint_files: "SharePoint Files — document library",
  meetings: "Meetings — calendar & meeting notes",

  admin: "Admin Control Center — system settings",
  admin_roles: "Roles & Permissions management",
  smart_import: "Smart Import — Excel data import",
  data_import: "Data Import tools",
  data_export: "Data Export tools",
  database_migration: "Database Migration tools",
  task_management: "Task Management — create, edit, assign, delete tasks",
  handover: "PD-PM Handover — submit, approve, reject, reopen handovers",
  standups: "Standups — manage standup schedules and entries",
  reports: "Reports — view project plan, cost, quality, resource reports",
  counterparties: "Counterparties — manage external counterparty records",
  commissioning: "Commissioning — manage commissioning items and evidence",
  ms_integration: "Microsoft 365 integration setup",
  ms_sync: "MS Graph Sync — calendar, email, Teams",
  activity_log: "Activity Log — system change audit",
  audit_trail: "Audit Trail — detailed change history",

  pd_overview: "Project detail > Overview tab",
  pd_plan: "Project detail > Plan (WBS grid)",
  pd_gantt: "Project detail > Gantt chart",
  pd_finance: "Project detail > Finance tab",
  pd_revenue: "Project detail > Revenue tracker",
  pd_cashflow: "Project detail > Cashflow tab",
  pd_cos_tracker: "Project detail > Cost of Sales",
  pd_expenditure: "Project detail > Expenditure breakdown",
  pd_history: "Project detail > Change history",
  pd_key_dates: "Project detail > Key dates & milestones",
  pd_quality: "Project detail > Quality tab",
  pd_engineering: "Project detail > Engineering tab",
  pd_eng_tasks: "Project detail > Engineering tasks",
  pd_eng_stages: "Project detail > Engineering stages",
  pd_collaboration: "Project detail > Files & collaboration",
  pd_subcontractors: "Project detail > Subcontractors",
  pd_change_control: "Project detail > Change control / VOs",
  pd_commissioning: "Project detail > Commissioning & closeout",
  pd_dependencies: "Project detail > Linked dependencies",
  pd_raid: "Project detail > RAID log (Risks, Actions, Issues)",

  dashboard_widgets: "Home dashboard — widget cards & charts",
  financial_integration: "Financial Integration — rule-based matching",
  financial_linking: "Financial Linking — expense/revenue pairing",
  governance: "Governance — phase gate & compliance controls",
  operational_tasks: "Operational Tasks — ad-hoc task tracking (via work_items)",
  gamification: "Gamification — points, streaks & leaderboard",
  project_creation: "Create Project — new project wizard",
  project_tagging: "Project Tagging — labels & categories",
  work_items: "Work Items — canonical task/work tracking",
};

const ENTITY_CATEGORIES: Record<string, { label: string; entities: string[] }> = {
  home: {
    label: "Home",
    entities: ["home", "my_work", "my_tool", "company_priorities"],
  },
  lifecycle: {
    label: "Project Lifecycle",
    entities: ["lifecycle", "create_project", "pd_clients"],
  },
  project_dev: {
    label: "Project Development",
    entities: ["pd_dashboard", "pd_tickets"],
  },
  project_management: {
    label: "Project Management",
    entities: ["projects", "execution_board", "deliverables", "pm_dashboard", "pm_on_the_go", "approvals", "weekly_review_wizard", "portfolios", "portfolio_detail", "handover", "commissioning", "task_management", "standups"],
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
    label: "Finance",
    entities: ["cashflow", "cos", "revenue_tracker", "gp_tracker", "financials", "procurement", "counterparties", "subcontractors", "invoice_patterns"],
  },
  knowledge: {
    label: "Knowledge",
    entities: ["ee_info", "leaderboard", "training", "feedback", "department_scores"],
  },
  collaboration: {
    label: "Collaboration",
    entities: ["teams_chat", "project_chat", "collaboration_hub", "sharepoint_files", "meetings", "reports"],
  },
  admin: {
    label: "Admin",
    entities: ["admin", "admin_roles", "smart_import", "data_import", "data_export", "database_migration", "ms_integration", "ms_sync", "activity_log", "audit_trail"],
  },
  project_detail: {
    label: "Project Detail Tabs",
    entities: ["pd_overview", "pd_plan", "pd_gantt", "pd_finance", "pd_revenue", "pd_cashflow", "pd_cos_tracker", "pd_expenditure", "pd_history", "pd_key_dates", "pd_quality", "pd_engineering", "pd_eng_tasks", "pd_eng_stages", "pd_collaboration", "pd_subcontractors", "pd_change_control", "pd_commissioning", "pd_dependencies", "pd_raid"],
  },
  other: {
    label: "Other Permissions",
    entities: ["dashboard_widgets", "financial_integration", "financial_linking", "governance", "operational_tasks", "gamification", "project_creation", "project_tagging", "work_items"],
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
            <TabsTrigger value="overrides" className="data-[state=active]:bg-white data-[state=active]:shadow-sm px-5 py-2 text-sm font-medium" data-testid="tab-overrides">
              User Overrides
            </TabsTrigger>
            <TabsTrigger value="audit" className="data-[state=active]:bg-white data-[state=active]:shadow-sm px-5 py-2 text-sm font-medium" data-testid="tab-audit">
              Permission Audit Log
            </TabsTrigger>
          </TabsList>
          <TabsContent value="roles" className="mt-4"><RolesControlCenter /></TabsContent>
          <TabsContent value="users" className="mt-4"><GlobalUsersView /></TabsContent>
          <TabsContent value="overrides" className="mt-4"><UserOverridesView /></TabsContent>
          <TabsContent value="audit" className="mt-4"><PermissionAuditLogView /></TabsContent>
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
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>("");
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [activeTab, setActiveTab] = useState<"navigation" | "permissions">("navigation");
  const [permSearch, setPermSearch] = useState("");

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
      if (!roleRes.ok) setLoadError("Unable to load roles. Your account may not have access.");
    } catch {
      setRoles([]); setUsers([]); setLoadError("Unable to load roles right now.");
    } finally { setIsLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { setDraft({}); setPermSearch(""); }, [selectedRole]);

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
  const updateEp = (entity: string, action: string, value: boolean) => {
    const next = { ...currentEp, [entity]: { ...(currentEp[entity] || {}), [action]: value } };
    if ((action === "edit" || action === "approve" || action === "delete") && value) next[entity].view = true;
    setDraft((d) => ({ ...d, entityPermissions: next }));
  };

  const bulkUpdateCategory = (entities: string[], value: boolean) => {
    const next = { ...currentEp };
    entities.forEach((entity) => {
      const existing = next[entity] || {};
      const actions = Object.keys(existing).length > 0 ? Object.keys(existing) : ACTIONS.map(String);
      const updated: Record<string, boolean> = {};
      actions.forEach((a) => { updated[a] = value; });
      next[entity] = updated;
    });
    setDraft((d) => ({ ...d, entityPermissions: next }));
  };

  const saveRoleMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !canManageRoles) throw new Error("Not allowed");
      const res = await fetch(`/api/roles/${selected.role}`, { method: "PUT", headers: authHeaders(), credentials: "include", body: JSON.stringify(draft) });
      if (!res.ok) throw new Error("Save failed");
    },
    onSuccess: () => { setDraft({}); load(); toast({ title: "Role saved successfully" }); },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });
  const save = () => saveRoleMutation.mutate();

  const createRoleMutation = useMutation({
    mutationFn: async () => {
      if (!canManageRoles) throw new Error("Not allowed");
      const res = await fetch("/api/roles", { method: "POST", headers: authHeaders(), credentials: "include", body: JSON.stringify({ role: createKey.trim(), label: createLabel.trim(), sections: ["MY_WORK"], canEditData: true }) });
      if (!res.ok) throw new Error("Create role failed");
    },
    onSuccess: () => { setShowCreate(false); setCreateKey(""); setCreateLabel(""); load(); toast({ title: "Role created" }); },
    onError: () => toast({ title: "Create role failed", variant: "destructive" }),
  });
  const createRole = () => createRoleMutation.mutate();

  const resources = Object.keys(currentEp).filter((k) => !k.startsWith("_")).sort();
  const allEntities = Object.values(ENTITY_CATEGORIES).flatMap((c) => c.entities).sort();
  const viewState: AdminRolesViewState = resolveAdminRolesViewState({ isLoading, hasError: Boolean(loadError), roleCount: roles.length, canManageRoles });
  const systemRoleCount = roles.filter((role) => role.isSystem).length;
  const customRoleCount = roles.filter((role) => !role.isSystem).length;
  const assignedUsers = users.filter((user) => Boolean(user.role)).length;
  const roleUsers = users.filter((u) => u.role === selectedRole);

  const getRoleIcon = (r: RoleRow) => {
    if (r.protected) return <Lock className="h-4 w-4 text-amber-500" />;
    if (r.isSystem) return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
    return <Shield className="h-4 w-4 text-emerald-500" />;
  };

  const categorizedEntities = useMemo(() => {
    const assigned = new Set<string>();
    const result: { key: string; label: string; entities: string[] }[] = [];
    Object.entries(ENTITY_CATEGORIES).forEach(([key, cat]) => {
      cat.entities.forEach((e) => assigned.add(e));
      result.push({ key, label: cat.label, entities: cat.entities });
    });
    const uncategorized = resources.filter((e) => !assigned.has(e));
    if (uncategorized.length > 0) result.push({ key: "uncategorized", label: "Other Permissions", entities: uncategorized });
    return result;
  }, [resources]);

  const filteredCategories = useMemo(() => {
    if (!permSearch) return categorizedEntities;
    const q = permSearch.toLowerCase();
    return categorizedEntities.map((cat) => ({
      ...cat,
      entities: cat.entities.filter((e) => formatEntityName(e).toLowerCase().includes(q) || cat.label.toLowerCase().includes(q)),
    })).filter((cat) => cat.entities.length > 0);
  }, [categorizedEntities, permSearch]);

  const totalGranted = allEntities.reduce((s, e) => s + Object.values(currentEp[e] || {}).filter(Boolean).length, 0);
  const totalPossible = allEntities.length * ACTIONS.length;

  return (
    <div className="flex gap-4" style={{ minHeight: 'calc(100vh - 10rem)' }}>
      <div className="w-[260px] shrink-0 sticky top-4 self-start max-h-[calc(100vh-6rem)] overflow-hidden">
        <Card className="border-gray-200 shadow-sm h-full flex flex-col">
          <CardHeader className="pb-3 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-900">Roles</CardTitle>
              <Button size="sm" onClick={() => setShowCreate(true)} disabled={!canManageRoles} className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 px-2.5 text-xs" data-testid="button-create-role">
                <Plus className="h-3.5 w-3.5 mr-1" /> New Role
              </Button>
            </div>
            <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
              <span>{roles.length} total</span>
              <span>·</span>
              <span>{systemRoleCount} system</span>
              <span>·</span>
              <span>{customRoleCount} custom</span>
              <span>·</span>
              <span>{assignedUsers} users</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="relative shrink-0">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9 h-8 bg-gray-50 border-gray-200 focus:bg-white text-sm" placeholder="Search roles..." value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="input-search-roles" />
            </div>
            <div className="flex gap-1 shrink-0">
              {(["all", "system", "custom"] as const).map((k) => (
                <Button key={k} variant={kindFilter === k ? "default" : "outline"} size="sm" onClick={() => setKindFilter(k)}
                  className={`h-6 text-[11px] font-medium flex-1 ${kindFilter === k ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                  data-testid={`button-filter-${k}`}
                >{k.charAt(0).toUpperCase() + k.slice(1)}</Button>
              ))}
            </div>
            <div className="space-y-1 overflow-auto flex-1 pr-1">
              {filteredRoles.map((r) => {
                const isSelected = selectedRole === r.role;
                return (
                  <button key={r.role}
                    className={`w-full text-left rounded-lg border p-2.5 transition-all group ${isSelected ? "border-emerald-300 bg-emerald-50 shadow-sm" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"}`}
                    onClick={() => setSelectedRole(r.role)} data-testid={`button-role-${r.role}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${isSelected ? "bg-emerald-100" : "bg-gray-100"}`}>
                        {getRoleIcon(r)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-semibold text-xs truncate ${isSelected ? "text-emerald-900" : "text-gray-900"}`}>{r.label}</span>
                          {r.isSystem && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 bg-gray-100 text-gray-500 border-gray-200 shrink-0">System</Badge>}
                        </div>
                        <span className="text-[11px] text-muted-foreground">{r.userCount || 0} users{r.protected ? " · Protected" : ""}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <AdminQueryState isLoading={viewState === "loading"} error={viewState === "error" ? loadError : null} onRetry={() => { void load(); }} loadingLabel="Loading roles...">
          {viewState === "empty" ? (
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="py-16 text-center">
                <Shield className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-lg font-semibold text-gray-900">No roles configured</p>
                <p className="text-sm text-muted-foreground mt-1">Seeded roles appear automatically on startup.</p>
                {canManageRoles && <Button size="sm" onClick={() => setShowCreate(true)} className="mt-4 bg-emerald-600 hover:bg-emerald-700"><Plus className="h-3.5 w-3.5 mr-1" />Create Role</Button>}
              </CardContent>
            </Card>
          ) : viewState === "ready" && (
            <>
              {hasChanges && (
                <div className="sticky top-2 z-20 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Unsaved changes</span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDraft({})} className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100" data-testid="button-reset-changes">Discard</Button>
                    <Button size="sm" onClick={save} disabled={!canManageRoles} className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" data-testid="button-save-changes">
                      <Save className="h-3 w-3 mr-1" />Save
                    </Button>
                  </div>
                </div>
              )}

              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="border-b border-gray-100 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center">{selected && getRoleIcon(selected)}</div>
                      <div>
                        <CardTitle className="text-base font-semibold text-gray-900">{selected?.label || "Select a role"}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {selected?.isSystem ? "System" : "Custom"} · {roleUsers.length} user{roleUsers.length !== 1 ? "s" : ""} · {totalGranted}/{totalPossible} permissions granted
                        </p>
                      </div>
                    </div>
                    {roleUsers.length > 0 && (
                      <div className="flex -space-x-2">
                        {roleUsers.slice(0, 5).map((u) => (
                          <div key={u.id} className="h-7 w-7 rounded-full bg-emerald-100 border-2 border-white flex items-center justify-center text-emerald-700 font-bold text-[10px]" title={u.name}>
                            {(u.name || "?").charAt(0).toUpperCase()}
                          </div>
                        ))}
                        {roleUsers.length > 5 && <div className="h-7 w-7 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-gray-600 font-bold text-[10px]">+{roleUsers.length - 5}</div>}
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="flex border-b border-gray-100">
                    {([
                      { key: "navigation" as const, label: "Navigation", icon: <Eye className="h-3.5 w-3.5" /> },
                      { key: "permissions" as const, label: "Permissions", icon: <Shield className="h-3.5 w-3.5" /> },
                    ]).map((tab) => (
                      <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${activeTab === tab.key ? "border-emerald-600 text-emerald-700 bg-emerald-50/50" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"}`}
                        data-testid={`tab-role-${tab.key}`}
                      >{tab.icon}{tab.label}</button>
                    ))}
                  </div>

                  <div className="p-4">
                    {activeTab === "permissions" && (
                      <>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="relative flex-1">
                                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input className="pl-8 h-8 text-sm bg-gray-50 border-gray-200" placeholder="Filter permissions..." value={permSearch} onChange={(e) => setPermSearch(e.target.value)} data-testid="input-search-permissions" />
                              </div>
                              {canManageRoles && (
                                <div className="flex gap-1.5">
                                  <Button size="sm" variant="outline" className="h-8 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => bulkUpdateCategory(allEntities, true)} data-testid="button-grant-all-global">Grant All</Button>
                                  <Button size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={() => bulkUpdateCategory(allEntities, false)} data-testid="button-revoke-all-global">Revoke All</Button>
                                </div>
                              )}
                            </div>

                            <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
                              <table className="w-full text-sm" data-testid="permissions-table">
                                <thead className="sticky top-0 z-10">
                                  <tr className="bg-gray-50 border-b border-gray-200">
                                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600 w-[200px] bg-gray-50">Entity</th>
                                    {ACTIONS.map((a) => (
                                      <th key={a} className="text-center px-1.5 py-2 text-xs font-semibold text-gray-600 capitalize w-[70px] bg-gray-50">
                                        <div className="flex items-center justify-center gap-1">{ACTION_ICONS[a]}{a}</div>
                                      </th>
                                    ))}
                                    {canManageRoles && <th className="w-[80px] bg-gray-50" />}
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredCategories.length === 0 && (
                                    <tr><td colSpan={ACTIONS.length + (canManageRoles ? 2 : 1)} className="text-center py-8 text-sm text-muted-foreground">No permissions match "{permSearch}"</td></tr>
                                  )}
                                  {filteredCategories.map((cat) => (
                                    <React.Fragment key={cat.key}>
                                      <tr className="bg-gray-50/80">
                                        <td colSpan={ACTIONS.length + (canManageRoles ? 2 : 1)} className="px-3 py-1.5">
                                          <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{cat.label}</span>
                                            {canManageRoles && (
                                              <div className="flex gap-1">
                                                <button type="button" onClick={() => bulkUpdateCategory(cat.entities, true)} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium" data-testid={`grant-category-${cat.key}`}>Grant all</button>
                                                <button type="button" onClick={() => bulkUpdateCategory(cat.entities, false)} className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium" data-testid={`revoke-category-${cat.key}`}>Revoke all</button>
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                      {cat.entities.map((entity) => {
                                        const perms = currentEp[entity] || {};
                                        return (
                                          <tr key={entity} className="border-t border-gray-100 hover:bg-gray-50/50" data-testid={`perm-row-${entity}`}>
                                            <td className="px-3 py-2">
                                              <div className="text-xs font-medium text-gray-800">{formatEntityName(entity)}</div>
                                              {ENTITY_DESCRIPTIONS[entity] && <div className="text-[10px] text-muted-foreground leading-tight">{ENTITY_DESCRIPTIONS[entity]}</div>}
                                            </td>
                                            {ACTIONS.map((action) => {
                                              const isOn = Boolean(perms[action]);
                                              return (
                                                <td key={action} className="text-center px-1.5 py-2">
                                                  <button type="button" disabled={!canManageRoles} onClick={() => updateEp(entity, action, !isOn)}
                                                    className={`inline-flex items-center justify-center h-7 w-7 rounded-md border transition-all ${canManageRoles ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${isOn
                                                      ? ACTION_COLORS_ON[action] || "bg-emerald-100 text-emerald-700 border-emerald-300"
                                                      : "bg-gray-50 text-gray-300 border-gray-200 hover:bg-gray-100"}`}
                                                    title={`${isOn ? "Revoke" : "Grant"} ${action} on ${formatEntityName(entity)}`}
                                                    data-testid={`toggle-${entity}-${action}`}
                                                  >
                                                    {isOn ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                                                  </button>
                                                </td>
                                              );
                                            })}
                                            {canManageRoles && (
                                              <td className="text-center px-1.5 py-2">
                                                <div className="flex gap-0.5 justify-center">
                                                  <button type="button" onClick={() => ACTIONS.forEach((a) => updateEp(entity, a, true))} className="text-[9px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100" title="Grant all" data-testid={`grant-all-${entity}`}>All</button>
                                                  <button type="button" onClick={() => ACTIONS.forEach((a) => updateEp(entity, a, false))} className="text-[9px] px-1 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100" title="Revoke all" data-testid={`revoke-all-${entity}`}>None</button>
                                                </div>
                                              </td>
                                            )}
                                          </tr>
                                        );
                                      })}
                                    </React.Fragment>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                      </>
                    )}

                    {activeTab === "navigation" && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {NAV_SECTIONS.map((section) => {
                          const checked = Boolean((effectiveRole.sections || []).includes(section.key));
                          return (
                            <label key={section.key}
                              className={`flex items-center gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors ${checked ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
                            >
                              <input type="checkbox" checked={checked}
                                onChange={(e) => {
                                  const next = new Set(effectiveRole.sections || []);
                                  if (e.target.checked) next.add(section.key); else next.delete(section.key);
                                  setDraft((d) => ({ ...d, sections: [...next] }));
                                }}
                                disabled={!canManageRoles}
                                className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                                data-testid={`checkbox-nav-${section.key}`}
                              />
                              <div className="min-w-0">
                                <span className={`text-sm font-semibold block ${checked ? "text-emerald-800" : "text-gray-700"}`}>{section.label}</span>
                                <span className="text-[11px] text-muted-foreground">{section.description}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}

                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </AdminQueryState>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Create New Role</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs font-medium text-gray-600">Role Key *</Label>
              <Input value={createKey} onChange={(e) => setCreateKey(e.target.value.toUpperCase())} placeholder="e.g. SITE_MANAGER" data-testid="input-create-role-key" />
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-600">Display Name *</Label>
              <Input value={createLabel} onChange={(e) => setCreateLabel(e.target.value)} placeholder="e.g. Site Manager" data-testid="input-create-role-label" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)} data-testid="button-cancel-create">Cancel</Button>
            <Button onClick={createRole} disabled={!canManageRoles} className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-confirm-create">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GlobalUsersView() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<UserRow | null>(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", name: "", email: "", password: "", role: "", department: "" });

  const loadUsers = async () => {
    const [u, r] = await Promise.all([
      fetch("/api/admin/users", { headers: authHeaders(), credentials: "include" }),
      fetch("/api/roles", { headers: authHeaders(), credentials: "include" }),
    ]);
    const usersData = await parseJsonSafe<UserRow[] | { error?: string }>(u);
    const roleData = await parseJsonSafe<RoleRow[] | { error?: string }>(r);
    setUsers(Array.isArray(usersData) ? usersData : []);
    setRoles(Array.isArray(roleData) ? roleData : []);
  };

  useEffect(() => { void loadUsers(); }, []);

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const res = await fetch(`/api/admin/users/${id}/role`, { method: "PATCH", headers: authHeaders(), credentials: "include", body: JSON.stringify({ role }) });
      if (!res.ok) throw new Error("Failed to update role");
      return { id, role };
    },
    onSuccess: ({ id, role }) => {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
      toast({ title: "Role updated", description: `Role changed to ${roles.find(r => r.role === role)?.label || role}` });
    },
    onError: () => toast({ title: "Failed to update role", variant: "destructive" }),
  });
  const updateRole = (id: number, role: string) => { if (role) updateRoleMutation.mutate({ id, role }); };

  const updateDepartmentMutation = useMutation({
    mutationFn: async ({ id, department }: { id: number; department: string }) => {
      const res = await fetch(`/api/admin/users/${id}/department`, { method: "PATCH", headers: authHeaders(), credentials: "include", body: JSON.stringify({ department }) });
      if (!res.ok) throw new Error("Failed to update department");
      return { id, department, data: await parseJsonSafe<UserRow>(res) };
    },
    onSuccess: ({ id, department, data }) => {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, department: ((data as any)?.department ?? department) || null } : u)));
      toast({ title: "Department updated" });
    },
    onError: () => toast({ title: "Failed to update department", variant: "destructive" }),
  });
  const updateDepartment = (id: number, department: string) => updateDepartmentMutation.mutate({ id, department });

  const createUserMutation = useMutation({
    mutationFn: async (form: typeof createForm) => {
      const res = await fetch("/api/admin/users", { method: "POST", headers: authHeaders(), credentials: "include", body: JSON.stringify(form) });
      const data = await parseJsonSafe<any>(res);
      if (!res.ok || !data || data.error) throw new Error(data?.error || "Unknown error");
      return data;
    },
    onSuccess: (data) => {
      setUsers((prev) => [...prev, data]);
      setShowCreateDialog(false);
      setCreateForm({ username: "", name: "", email: "", password: "", role: "", department: "" });
      toast({ title: "User created", description: `${data.name} has been added` });
    },
    onError: (err: Error) => toast({ title: "Failed to create user", description: err.message, variant: "destructive" }),
  });
  const handleCreate = () => {
    if (!createForm.username || !createForm.name || !createForm.email || !createForm.password) {
      toast({ title: "Missing fields", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createUserMutation.mutate(createForm);
  };

  const deleteUserMutation = useMutation({
    mutationFn: async (user: { id: number; name: string }) => {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE", headers: authHeaders(), credentials: "include" });
      if (!res.ok) {
        const data = await parseJsonSafe<any>(res);
        throw new Error(data?.error || "Unknown error");
      }
      return user;
    },
    onSuccess: (user) => {
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      if (expandedId === user.id) setExpandedId(null);
      toast({ title: "User deleted", description: `${user.name} has been removed` });
      setShowDeleteDialog(null);
    },
    onError: (err: Error) => { toast({ title: "Failed to delete", description: err.message, variant: "destructive" }); setShowDeleteDialog(null); },
  });
  const handleDelete = () => {
    if (!showDeleteDialog) return;
    deleteUserMutation.mutate(showDeleteDialog);
  };

  const handleResetPassword = async () => {
    if (!showPasswordDialog || !newPassword) return;
    if (newPassword.length < 4) {
      toast({ title: "Password too short", description: "Must be at least 4 characters", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${showPasswordDialog.id}/password`, { method: "PATCH", headers: authHeaders(), credentials: "include", body: JSON.stringify({ password: newPassword }) });
      if (res.ok) {
        toast({ title: "Password reset", description: `Password updated for ${showPasswordDialog.name}` });
      } else {
        const data = await parseJsonSafe<any>(res);
        toast({ title: "Failed", description: data?.error || "Unknown error", variant: "destructive" });
      }
    } finally { setSaving(false); setShowPasswordDialog(null); setNewPassword(""); setShowPassword(false); }
  };

  const filtered = users.filter((u) => `${u.name} ${u.email} ${u.role} ${u.department || ""}`.toLowerCase().includes(search.toLowerCase()));

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
          <Button onClick={() => setShowCreateDialog(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2" data-testid="button-add-user">
            <Plus className="h-4 w-4" /> Add User
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 h-10 bg-gray-50 border-gray-200 focus:bg-white"
            placeholder="Search users by name, email, role, or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-users"
            aria-label="Search users"
          />
        </div>

        <div className="space-y-2">
          {filtered.map((u) => {
            const isExpanded = expandedId === u.id;
            const roleLabel = roles.find((r) => r.role === u.role)?.label || u.role;
            return (
              <div key={u.id} className={`border rounded-lg bg-white transition-colors ${isExpanded ? "border-emerald-300 shadow-sm" : "border-gray-200 hover:border-gray-300"}`}>
                <div
                  className="p-4 flex items-center gap-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : u.id)}
                  data-testid={`row-user-${u.id}`}
                >
                  <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm shrink-0">
                    {(u.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-gray-900">{u.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  </div>
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs shrink-0 hidden sm:inline-flex">
                    {roleLabel}
                  </Badge>
                  {u.department && (
                    <Badge variant="outline" className="text-xs shrink-0 hidden sm:inline-flex">
                      {u.department}
                    </Badge>
                  )}
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 py-4 space-y-4 bg-gray-50/50">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1.5 block">Role</Label>
                        <SearchableSelect
                          options={roles.map((r) => ({ value: r.role, label: r.label }))}
                          value={u.role}
                          onValueChange={(val) => updateRole(u.id, val)}
                          placeholder="Select role"
                          searchPlaceholder="Search roles..."
                          data-testid={`select-role-${u.id}`}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1.5 block">Department</Label>
                        <SearchableSelect
                          options={[
                            ...DEPARTMENTS.map((d) => ({ value: d, label: d })),
                            ...(u.department && !DEPARTMENTS.includes(u.department) ? [{ value: u.department, label: u.department }] : []),
                          ]}
                          value={u.department || ""}
                          onValueChange={(val) => { if (val) void updateDepartment(u.id, val); }}
                          placeholder="Select department"
                          searchPlaceholder="Search departments..."
                          data-testid={`select-department-${u.id}`}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        onClick={(e) => { e.stopPropagation(); setShowPasswordDialog(u); }}
                        data-testid={`button-reset-password-${u.id}`}
                      >
                        <Lock className="h-3.5 w-3.5" /> Reset Password
                      </Button>
                      <div className="flex-1" />
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                        onClick={(e) => { e.stopPropagation(); setShowDeleteDialog(u); }}
                        data-testid={`button-delete-user-${u.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete User
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {search ? "No users match your search" : "No users found"}
            </div>
          )}
        </div>
      </CardContent>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-600" /> Add New User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs font-medium text-gray-600">Full Name *</Label>
              <Input
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. John Smith"
                data-testid="input-create-name"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-600">Username *</Label>
              <Input
                value={createForm.username}
                onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="e.g. johnsmith"
                data-testid="input-create-username"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-600">Email *</Label>
              <Input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="e.g. john@company.com"
                data-testid="input-create-email"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-600">Password *</Label>
              <Input
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Set a password"
                data-testid="input-create-password"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-600">Role</Label>
              <SearchableSelect
                options={roles.map((r) => ({ value: r.role, label: r.label }))}
                value={createForm.role}
                onValueChange={(val) => setCreateForm((f) => ({ ...f, role: val }))}
                placeholder="Select role"
                searchPlaceholder="Search roles..."
                data-testid="select-create-role"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-600">Department</Label>
              <SearchableSelect
                options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
                value={createForm.department}
                onValueChange={(val) => setCreateForm((f) => ({ ...f, department: val }))}
                placeholder="Select department"
                searchPlaceholder="Search departments..."
                data-testid="select-create-department"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-create-user">Cancel</Button>
            <Button onClick={handleCreate} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-confirm-create-user">
              {saving ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showDeleteDialog} onOpenChange={() => setShowDeleteDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" /> Delete User
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 py-2">
            Are you sure you want to permanently delete <span className="font-semibold">{showDeleteDialog?.name}</span>? This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(null)} data-testid="button-cancel-delete">Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving} data-testid="button-confirm-delete">
              {saving ? "Deleting..." : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showPasswordDialog} onOpenChange={() => { setShowPasswordDialog(null); setNewPassword(""); setShowPassword(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-emerald-600" /> Reset Password
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            Set a new password for <span className="font-semibold">{showPasswordDialog?.name}</span>
          </p>
          <div className="relative py-2">
            <Input
              type={showPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 4 characters)"
              data-testid="input-new-password"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowPasswordDialog(null); setNewPassword(""); setShowPassword(false); }} data-testid="button-cancel-password">Cancel</Button>
            <Button onClick={handleResetPassword} disabled={saving || newPassword.length < 4} className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-confirm-password">
              {saving ? "Saving..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ========== USER OVERRIDES VIEW ==========

interface UserOverrideRow {
  id: number;
  userId: number;
  entity: string;
  action: string;
  allowed: boolean;
  scope: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

function UserOverridesView() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<UserOverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newEntity, setNewEntity] = useState("");
  const [newAction, setNewAction] = useState<string>("view");
  const [newAllowed, setNewAllowed] = useState(true);
  const [newReason, setNewReason] = useState("");
  const [saving, setSaving] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", { headers: authHeaders(), credentials: "include" });
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch { setUsers([]); }
    setLoading(false);
  };

  const loadOverrides = async (userId: number) => {
    try {
      const res = await fetch(`/api/admin/user-overrides/${userId}`, { headers: authHeaders(), credentials: "include" });
      const data = await res.json();
      setOverrides(Array.isArray(data) ? data : []);
    } catch { setOverrides([]); }
  };

  useEffect(() => { void loadUsers(); }, []);
  useEffect(() => { if (selectedUserId) void loadOverrides(selectedUserId); else setOverrides([]); }, [selectedUserId]);

  const handleAdd = async () => {
    if (!selectedUserId || !newEntity || !newAction) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/user-overrides", {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ userId: selectedUserId, entity: newEntity, action: newAction, allowed: newAllowed, reason: newReason || null }),
      });
      if (res.ok) {
        toast({ title: "Override added" });
        setShowAdd(false);
        setNewEntity("");
        setNewAction("view");
        setNewAllowed(true);
        setNewReason("");
        void loadOverrides(selectedUserId);
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch { toast({ title: "Error", variant: "destructive" }); }
    setSaving(false);
  };

  const handleDelete = async (overrideId: number) => {
    try {
      const res = await fetch(`/api/admin/user-overrides/${overrideId}`, { method: "DELETE", headers: authHeaders(), credentials: "include" });
      if (res.ok) {
        toast({ title: "Override removed" });
        if (selectedUserId) void loadOverrides(selectedUserId);
      }
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  const selectedUser = users.find((u) => u.id === selectedUserId);
  const entityOptions = ENTITY_PERMISSION_DEFAULTS.map((e) => e.entity);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-blue-600" />
          User Permission Overrides
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Grant or revoke specific permissions for individual users, overriding their role defaults.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-72">
            <Label className="text-xs text-gray-500 mb-1 block">Select User</Label>
            <SearchableSelect
              options={users.map((u) => ({ value: String(u.id), label: `${u.name} (${u.role})` }))}
              value={selectedUserId ? String(selectedUserId) : ""}
              onValueChange={(v) => setSelectedUserId(v ? Number(v) : null)}
              placeholder="Choose a user..."
            />
          </div>
          {selectedUserId && (
            <Button size="sm" className="mt-5 bg-blue-600 hover:bg-blue-700" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Override
            </Button>
          )}
        </div>

        {selectedUser && (
          <div className="text-sm text-gray-600">
            Showing overrides for <strong>{selectedUser.name}</strong> (Role: <Badge variant="outline">{selectedUser.role}</Badge>)
          </div>
        )}

        {overrides.length > 0 ? (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Entity</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Action</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Access</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Reason</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Expires</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id} className="border-t hover:bg-gray-50/50">
                    <td className="px-4 py-2 font-mono text-xs">{o.entity}</td>
                    <td className="px-4 py-2 font-mono text-xs">{o.action}</td>
                    <td className="px-4 py-2">
                      <Badge variant={o.allowed ? "default" : "destructive"} className={o.allowed ? "bg-emerald-100 text-emerald-700 border-emerald-200" : ""}>
                        {o.allowed ? "Granted" : "Denied"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{o.reason || "—"}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{o.expiresAt ? new Date(o.expiresAt).toLocaleDateString() : "Never"}</td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(o.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : selectedUserId ? (
          <div className="text-center py-8 text-gray-400 text-sm">No user-specific overrides. This user uses their role defaults only.</div>
        ) : null}
      </CardContent>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Permission Override</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Entity</Label>
              <SearchableSelect
                options={entityOptions.map((e) => ({ value: e, label: `${e} — ${ENTITY_DESCRIPTIONS[e] || e}` }))}
                value={newEntity}
                onValueChange={setNewEntity}
                placeholder="Select entity..."
              />
            </div>
            <div>
              <Label className="text-xs">Action</Label>
              <SearchableSelect
                options={["view", "create", "edit", "approve", "override", "delete"].map((a) => ({ value: a, label: a }))}
                value={newAction}
                onValueChange={setNewAction}
                placeholder="Select action..."
              />
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Access</Label>
              <Switch checked={newAllowed} onCheckedChange={setNewAllowed} />
              <span className="text-sm">{newAllowed ? "Grant" : "Deny"}</span>
            </div>
            <div>
              <Label className="text-xs">Reason (optional)</Label>
              <Input value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="Why this override exists..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving || !newEntity || !newAction} className="bg-blue-600 hover:bg-blue-700">
              {saving ? "Saving..." : "Add Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ========== PERMISSION AUDIT LOG VIEW ==========

interface AuditLogEntry {
  id: number;
  eventType: string;
  targetRole: string | null;
  targetUserId: number | null;
  targetUserName: string | null;
  changedByUserId: number | null;
  changedByName: string | null;
  changedByRole: string | null;
  changeDetail: Record<string, any>;
  createdAt: string;
}

function PermissionAuditLogView() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventTypeFilter, setEventTypeFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (eventTypeFilter) params.set("eventType", eventTypeFilter);
      const res = await fetch(`/api/admin/permission-audit-log?${params}`, { headers: authHeaders(), credentials: "include" });
      const data = await res.json();
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
    } catch { setEntries([]); }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [eventTypeFilter]);

  const eventTypes = ["role_created", "role_updated", "role_deleted", "role_cloned", "role_archived", "user_role_changed", "user_override_added", "user_override_removed"];

  const formatEventType = (type: string) => {
    return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const getEventColor = (type: string): string => {
    if (type.includes("deleted") || type.includes("removed")) return "bg-red-100 text-red-700 border-red-200";
    if (type.includes("created") || type.includes("added") || type.includes("cloned")) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (type.includes("updated") || type.includes("changed")) return "bg-blue-100 text-blue-700 border-blue-200";
    return "bg-gray-100 text-gray-700 border-gray-200";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-purple-600" />
          Permission Audit Log
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Track all role changes, permission updates, user overrides, and access control events.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-64">
            <SearchableSelect
              options={[{ value: "", label: "All Events" }, ...eventTypes.map((t) => ({ value: t, label: formatEventType(t) }))]}
              value={eventTypeFilter}
              onValueChange={setEventTypeFilter}
              placeholder="Filter by event type..."
            />
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading audit log...</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No permission audit events recorded yet.</div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Time</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Event</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Target</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Changed By</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t hover:bg-gray-50/50">
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                      <Clock className="h-3 w-3 inline mr-1" />
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className={getEventColor(entry.eventType)}>
                        {formatEventType(entry.eventType)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {entry.targetRole && <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{entry.targetRole}</span>}
                      {entry.targetUserName && <span className="ml-1 text-gray-600">{entry.targetUserName}</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {entry.changedByName || "System"}
                      {entry.changedByRole && <span className="text-gray-400 ml-1">({entry.changedByRole})</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-xs truncate">
                      {summarizeChangeDetail(entry.changeDetail)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function summarizeChangeDetail(detail: Record<string, any>): string {
  if (!detail) return "";
  const parts: string[] = [];
  if (detail.entity) parts.push(`Entity: ${detail.entity}`);
  if (detail.action) parts.push(`Action: ${detail.action}`);
  if (detail.previousRole && detail.newRole) parts.push(`${detail.previousRole} → ${detail.newRole}`);
  if (detail.label) parts.push(`Label: ${detail.label}`);
  if (detail.sourceRole) parts.push(`Cloned from: ${detail.sourceRole}`);
  if (typeof detail.allowed === "boolean") parts.push(detail.allowed ? "Granted" : "Denied");
  if (detail.reason) parts.push(`Reason: ${detail.reason}`);
  if (detail.sections) parts.push(`Sections: ${Array.isArray(detail.sections) ? detail.sections.length : "updated"}`);
  if (detail.hasEntityPermChanges) parts.push("Entity perms updated");
  if (detail.hasAuthorityModelChanges) parts.push("Authority model updated");
  return parts.join(" | ") || JSON.stringify(detail).slice(0, 80);
}
