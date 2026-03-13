import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  Save,
  Shield,
  Users,
  AlertTriangle,
  Check,
  X,
  Plus,
  Pencil,
  Trash2,
  UserPlus,
  KeyRound,
  RefreshCw,
  Eye,
  Edit3,
  ThumbsUp,
  Zap,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  FolderKanban,
  DollarSign,
  Wrench,
  ShieldCheck,
  BookOpen,
  Settings,
  Briefcase,
  FileText,
  MessageSquare,
  FileEdit,
  Info,
  Lock,
  Search,
  ShieldAlert,
  Layers,
  Network,
  CheckCircle2,
  XCircle,
  ArrowLeftRight,
  Globe,
  Monitor,
  Server,
  Workflow,
} from "lucide-react";
import {
  COMPANY_ROLE_LABELS,
  ENTITY_PERMISSION_DEFAULTS,
  type CompanyRole,
  type RolePermission,
  type PermissionEntity,
  type PermissionAction,
} from "@shared/schema";

const ALL_SECTIONS = [
  "MY_WORK", "COCKPIT", "COLLABORATION", "PROJECTS", "MONEY", "PROJECT_DEVELOPMENT", "DELIVERY", "GOVERNANCE", "PROJECT_DETAIL", "INFORMATION", "SETTINGS",
] as const;

const SECTION_META: Record<string, { label: string; icon: any; color: string; bg: string; description: string; pages: string[] }> = {
  MY_WORK: { label: "My Work", icon: Briefcase, color: "text-green-600", bg: "bg-green-50 border-green-200", description: "Personal workspace and daily tools", pages: ["Home", "Command Center", "Tasks", "Approvals", "Calendar", "Meetings", "Email", "Teams Chat"] },
  PROJECT_DEVELOPMENT: { label: "Project Development", icon: FileEdit, color: "text-teal-600", bg: "bg-teal-50 border-teal-200", description: "Pipeline and lifecycle management", pages: ["Lifecycle Board", "Clients"] },
  DELIVERY: { label: "Engineering", icon: Wrench, color: "text-orange-600", bg: "bg-orange-50 border-orange-200", description: "Engineering operations and task tracking", pages: ["Eng Overview", "Task Execution"] },
  GOVERNANCE: { label: "Quality", icon: ShieldCheck, color: "text-purple-600", bg: "bg-purple-50 border-purple-200", description: "Quality management and compliance", pages: ["Quality Dashboard"] },
  PROJECTS: { label: "Project Management", icon: FolderKanban, color: "text-blue-600", bg: "bg-blue-50 border-blue-200", description: "Project tracking, portfolios, and reviews", pages: ["Project List", "Portfolios", "PM Dashboard", "Execution Board", "PM On-The-Go", "Weekly Reviews", "PM Handover Review"] },
  MONEY: { label: "Commercial", icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", description: "Financial tracking and procurement", pages: ["Cashflow Control", "COS Control", "Revenue Control", "Gross Profit Control", "Procurement Hub", "Invoice Pattern Library"] },
  COCKPIT: { label: "EXCO", icon: LayoutDashboard, color: "text-indigo-600", bg: "bg-indigo-50 border-indigo-200", description: "Executive cockpit and lifecycle board", pages: ["EXCO Dashboard"] },
  COLLABORATION: { label: "Collaboration", icon: MessageSquare, color: "text-pink-600", bg: "bg-pink-50 border-pink-200", description: "Communication tools", pages: ["Email", "Teams", "SharePoint"] },
  PROJECT_DETAIL: { label: "Project Detail Tabs", icon: FileText, color: "text-cyan-600", bg: "bg-cyan-50 border-cyan-200", description: "Per-project tab access control", pages: ["Overview", "Plan", "Key Dates", "Financials", "Revenue", "Expenditure", "COS", "Cashflow", "Subcontractors", "RAID", "Change Control", "Procurement", "Commissioning", "Engineering", "Quality"] },
  INFORMATION: { label: "Information", icon: BookOpen, color: "text-slate-500", bg: "bg-muted border-border", description: "Knowledge base, leaderboard, and feedback", pages: ["Feedback", "Knowledge Base", "Leaderboard"] },
  SETTINGS: { label: "System / Admin", icon: Settings, color: "text-muted-foreground", bg: "bg-muted border-border", description: "Administration and system configuration", pages: ["Control Center", "Users & Roles", "App Settings", "Activity Log", "Smart Import", "Import Control Tower", "Recovery Center", "KPI Traceability", "Excel Updates", "Feedback & Support", "Leaderboard"] },
};

interface PermCat {
  key: string;
  section: string;
  label: string;
  icon: any;
  color: string;
  items: { entity: PermissionEntity; label: string; actions: PermissionAction[]; enforcement?: string }[];
}

const PERM_CATEGORIES: PermCat[] = [
  {
    key: "my_work", section: "MY_WORK", label: "My Work", icon: Briefcase, color: "bg-green-500",
    items: [
      { entity: "home" as PermissionEntity, label: "Home", actions: ["view", "edit"] },
      { entity: "admin" as PermissionEntity, label: "Command Center", actions: ["view"] },
      { entity: "my_tool" as PermissionEntity, label: "Tasks", actions: ["view", "edit"] },
      { entity: "my_work" as PermissionEntity, label: "Approvals / Calendar", actions: ["view", "edit"] },
      { entity: "meetings" as PermissionEntity, label: "Meetings", actions: ["view", "edit"] },
      { entity: "collaboration_hub" as PermissionEntity, label: "Email", actions: ["view", "edit"] },
      { entity: "teams_chat" as PermissionEntity, label: "Teams Chat", actions: ["view", "edit", "delete"] },
    ],
  },
  {
    key: "project_dev", section: "PROJECT_DEVELOPMENT", label: "Project Development", icon: FileEdit, color: "bg-teal-500",
    items: [
      { entity: "pd_dashboard" as PermissionEntity, label: "PD Dashboard", actions: ["view"] },
      { entity: "pd_tickets" as PermissionEntity, label: "PD Tickets", actions: ["view", "edit", "delete"], enforcement: "backend" },
      { entity: "pd_clients" as PermissionEntity, label: "Clients", actions: ["view", "edit", "delete"], enforcement: "backend" },
      { entity: "lifecycle" as PermissionEntity, label: "Lifecycle Board", actions: ["view", "edit", "override"], enforcement: "backend" },
      { entity: "company_priorities" as PermissionEntity, label: "Company Priorities", actions: ["view", "edit", "delete"] },
    ],
  },
  {
    key: "engineering", section: "DELIVERY", label: "Engineering", icon: Wrench, color: "bg-orange-500",
    items: [
      { entity: "engineering" as PermissionEntity, label: "Eng Overview", actions: ["view", "edit"] },
      { entity: "eng_tasks" as PermissionEntity, label: "Task Execution", actions: ["view", "edit", "delete"] },
    ],
  },
  {
    key: "quality", section: "GOVERNANCE", label: "Quality", icon: ShieldCheck, color: "bg-purple-500",
    items: [
      { entity: "quality" as PermissionEntity, label: "Quality Dashboard", actions: ["view", "edit", "approve", "override"], enforcement: "backend" },
    ],
  },
  {
    key: "pm", section: "PROJECTS", label: "Project Management", icon: FolderKanban, color: "bg-blue-500",
    items: [
      { entity: "projects" as PermissionEntity, label: "Project List", actions: ["view", "edit", "delete"], enforcement: "backend" },
      { entity: "portfolios" as PermissionEntity, label: "Portfolios", actions: ["view", "edit", "delete"] },
      { entity: "portfolio_detail" as PermissionEntity, label: "Portfolio Detail", actions: ["view", "edit", "delete"] },
      { entity: "execution_board" as PermissionEntity, label: "Execution Board", actions: ["view", "edit"] },
      { entity: "pm_dashboard" as PermissionEntity, label: "PM Dashboard", actions: ["view"] },
      { entity: "pm_on_the_go" as PermissionEntity, label: "On-The-Go", actions: ["view", "edit"] },
      { entity: "weekly_review_wizard" as PermissionEntity, label: "Weekly Reviews", actions: ["view", "edit"], enforcement: "backend" },
      { entity: "weekly_reviews" as PermissionEntity, label: "Weekly Review Data", actions: ["view", "edit"], enforcement: "backend" },
      { entity: "create_project" as PermissionEntity, label: "Create Project", actions: ["edit"] },
    ],
  },
  {
    key: "finance", section: "MONEY", label: "Commercial", icon: DollarSign, color: "bg-emerald-500",
    items: [
      { entity: "cashflow" as PermissionEntity, label: "Cashflow Control", actions: ["view", "edit"] },
      { entity: "cos" as PermissionEntity, label: "COS Control", actions: ["view", "edit"] },
      { entity: "revenue_tracker" as PermissionEntity, label: "Revenue Control", actions: ["view", "edit"] },
      { entity: "gp_tracker" as PermissionEntity, label: "Gross Profit Control", actions: ["view", "edit"] },
      { entity: "subcontractors" as PermissionEntity, label: "Procurement Hub", actions: ["view", "edit", "delete"], enforcement: "backend" },
      { entity: "invoice_patterns" as PermissionEntity, label: "Invoice Pattern Library", actions: ["view", "edit"], enforcement: "backend" },
    ],
  },
  {
    key: "project_detail", section: "PROJECT_DETAIL", label: "Project Detail Tabs", icon: FileText, color: "bg-cyan-500",
    items: [
      { entity: "pd_overview" as PermissionEntity, label: "Overview", actions: ["view", "edit"] },
      { entity: "pd_plan" as PermissionEntity, label: "Project Plan", actions: ["view", "edit"] },
      { entity: "pd_key_dates" as PermissionEntity, label: "Key Dates", actions: ["view", "edit"] },
      { entity: "pd_finance" as PermissionEntity, label: "Finance Summary", actions: ["view", "edit"] },
      { entity: "pd_revenue" as PermissionEntity, label: "Revenue", actions: ["view", "edit"] },
      { entity: "pd_expenditure" as PermissionEntity, label: "Expenditure", actions: ["view", "edit"] },
      { entity: "pd_cos_tracker" as PermissionEntity, label: "COS Tracker", actions: ["view", "edit"] },
      { entity: "pd_cashflow" as PermissionEntity, label: "Cashflow", actions: ["view", "edit"] },
      { entity: "pd_subcontractors" as PermissionEntity, label: "Subcontractors", actions: ["view", "edit"] },
      { entity: "pd_raid" as PermissionEntity, label: "RAID Log", actions: ["view", "edit", "delete"], enforcement: "backend" },
      { entity: "pd_change_control" as PermissionEntity, label: "Change Control", actions: ["view", "edit", "approve", "delete"], enforcement: "backend" },
      { entity: "pd_procurement" as PermissionEntity, label: "Procurement", actions: ["view", "edit", "approve", "delete"], enforcement: "backend" },
      { entity: "pd_commissioning" as PermissionEntity, label: "Commissioning", actions: ["view", "edit", "approve"], enforcement: "backend" },
      { entity: "pd_dependencies" as PermissionEntity, label: "Dependencies", actions: ["view", "edit", "delete"] },
      { entity: "pd_engineering" as PermissionEntity, label: "Engineering Section", actions: ["view", "edit"] },
      { entity: "pd_eng_tasks" as PermissionEntity, label: "Engineering Tasks", actions: ["view", "edit", "delete"] },
      { entity: "pd_eng_stages" as PermissionEntity, label: "Engineering Stages", actions: ["view", "edit", "approve"] },
      { entity: "pd_quality" as PermissionEntity, label: "Quality Tab", actions: ["view", "edit", "approve", "delete"] },
      { entity: "financials" as PermissionEntity, label: "Financials Overview", actions: ["view", "edit"], enforcement: "backend" },
      { entity: "financial_integration" as PermissionEntity, label: "Financial Integration", actions: ["view", "edit", "approve"] },
      { entity: "financial_linking" as PermissionEntity, label: "Financial Linking", actions: ["view", "edit"] },
    ],
  },
  {
    key: "system", section: "SETTINGS", label: "System / Admin", icon: Settings, color: "bg-slate-500",
    items: [
      { entity: "admin_roles" as PermissionEntity, label: "Users & Roles", actions: ["view", "edit"], enforcement: "backend" },
      { entity: "admin" as PermissionEntity, label: "App Settings", actions: ["view", "edit"], enforcement: "backend" },
      { entity: "activity_log" as PermissionEntity, label: "Activity Log", actions: ["view"] },
      { entity: "smart_import" as PermissionEntity, label: "Smart Import", actions: ["view", "edit"], enforcement: "backend" },
      { entity: "excel_updates" as PermissionEntity, label: "Excel Updates", actions: ["view", "approve"] },
      { entity: "feedback" as PermissionEntity, label: "Feedback & Support", actions: ["view", "edit"] },
      { entity: "ee_info" as PermissionEntity, label: "Emergent Energy Info", actions: ["view", "edit"] },
      { entity: "leaderboard" as PermissionEntity, label: "Leaderboard", actions: ["view"] },
      { entity: "gamification" as PermissionEntity, label: "Gamification", actions: ["view"] },
      { entity: "ee_info_lifecycle" as PermissionEntity, label: "OS Map — Lifecycle", actions: ["view", "edit"] },
      { entity: "ee_info_departments" as PermissionEntity, label: "OS Map — Departments", actions: ["view", "edit", "delete"] },
      { entity: "ee_info_processes" as PermissionEntity, label: "OS Map — Processes", actions: ["view", "edit", "delete"] },
      { entity: "ee_info_templates" as PermissionEntity, label: "OS Map — Templates", actions: ["view", "edit", "delete"] },
      { entity: "database_migration" as PermissionEntity, label: "Database Migration", actions: ["view", "edit"] },
    ],
  },
];

const ACTION_META: Record<PermissionAction, { label: string; short: string; icon: any; activeColor: string; activeBg: string; risk: "low" | "medium" | "high" }> = {
  view: { label: "View", short: "V", icon: Eye, activeColor: "text-blue-700", activeBg: "bg-blue-100 border-blue-300 text-blue-700", risk: "low" },
  edit: { label: "Edit", short: "E", icon: Edit3, activeColor: "text-amber-700", activeBg: "bg-amber-100 border-amber-300 text-amber-700", risk: "medium" },
  approve: { label: "Approve", short: "A", icon: ThumbsUp, activeColor: "text-green-700", activeBg: "bg-green-100 border-green-300 text-green-700", risk: "medium" },
  override: { label: "Override", short: "O", icon: Zap, activeColor: "text-purple-700", activeBg: "bg-purple-100 border-purple-300 text-purple-700", risk: "high" },
  delete: { label: "Delete", short: "D", icon: Trash2, activeColor: "text-red-700", activeBg: "bg-red-100 border-red-300 text-red-700", risk: "high" },
};

const SECTION_GROUPS: Record<string, string[]> = {
  MY_WORK: ["MY_WORK", "COLLABORATION"],
  PROJECT_DEVELOPMENT: ["PROJECT_DEVELOPMENT"],
};

const NAV_DISPLAY_SECTIONS = ["MY_WORK", "PROJECT_DEVELOPMENT", "DELIVERY", "GOVERNANCE", "PROJECTS", "MONEY", "SETTINGS"] as const;

const SCOPE_RULES = [
  { endpoint: "Project List", scope: "Full oversight for management roles. Site PMs see owned + assigned projects. Engineers see assigned projects only.", roles_affected: "PROJECT_MANAGER_SITE, ENGINEER", enforced: "backend" },
  { endpoint: "Task List", scope: "Non-management users scoped to assigned or owned tasks only.", roles_affected: "ENGINEER, PROJECT_MANAGER_SITE, PROJECT_DEVELOPER", enforced: "backend" },
  { endpoint: "My Work", scope: "Strictly scoped to the current user. No cross-user visibility.", roles_affected: "All roles", enforced: "backend" },
  { endpoint: "PD Tickets", scope: "Project Developers see only their own tickets. Admin/management see all.", roles_affected: "PROJECT_DEVELOPER", enforced: "backend" },
  { endpoint: "Weekly Reviews", scope: "Requires project edit permission. Scoped to assigned projects for site PMs.", roles_affected: "PROJECT_MANAGER_SITE", enforced: "backend" },
];

const SCOPE_TIERS = [
  { tier: "Full Oversight", description: "Can see all projects, tasks, and data across the organization.", roles: "CEO Admin, COO Admin, CCO, CFO, Program Manager, Finance PM, Accountant" },
  { tier: "Owned Projects", description: "Can see projects they own (PM) plus any assigned tasks.", roles: "Project Manager (Site)" },
  { tier: "Assigned Only", description: "Can only see tasks and projects they are directly assigned to.", roles: "Engineer" },
  { tier: "Own Records", description: "Can only see records they created (e.g., PD tickets).", roles: "Project Developer" },
];

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

interface UserRecord { id: number; name: string; email: string; role: string; }

export default function AdminRolesPage() {
  const { toast } = useToast();
  const companyRole = localStorage.getItem("company_role");
  const shared = useRolesData();

  if (companyRole !== "COO_ADMIN" && companyRole !== "CEO_ADMIN") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">Only COO Admin or CEO Admin can access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto" data-testid="admin-roles-page">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3" data-testid="text-page-title">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center">
            <Shield className="h-5 w-5 text-white" />
          </div>
          Roles & Permissions
        </h1>
        <p className="text-sm text-muted-foreground mt-1 ml-[52px]">Configure navigation access, feature permissions, and review enforcement truth per role</p>
      </header>

      <Tabs defaultValue="permissions" className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-11">
          <TabsTrigger value="permissions" className="flex items-center gap-2 text-sm" data-testid="tab-permissions">
            <Shield className="h-4 w-4" /> Permissions
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2 text-sm" data-testid="tab-users">
            <Users className="h-4 w-4" /> Users
          </TabsTrigger>
        </TabsList>
        <TabsContent value="permissions" className="mt-4">
          <PermissionsTab toast={toast} shared={shared} />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTab toast={toast} shared={shared} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useRolesData() {
  const [roles, setRoles] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingChanges, setPendingChanges] = useState<Record<string, Partial<RolePermission>>>({});

  const loadRoles = useCallback(async () => {
    try {
      const res = await fetch("/api/roles", { headers: getAuthHeaders(), credentials: "include" });
      if (res.ok) {
        const data: RolePermission[] = await res.json();
        data.sort((a, b) => a.label.localeCompare(b.label));
        setRoles(data);
      }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const getEntityPerm = useCallback((roleKey: string, entity: PermissionEntity, action: PermissionAction): boolean => {
    const changes = pendingChanges[roleKey]?.entityPermissions as Record<string, Record<string, boolean>> | undefined;
    if (changes?.[entity]?.[action] !== undefined) return changes[entity][action];
    const role = roles.find(r => r.role === roleKey);
    const stored = role?.entityPermissions as Record<string, Record<string, boolean>> | null;
    if (stored?.[entity]?.[action] !== undefined) return stored[entity][action];
    const defaults = ENTITY_PERMISSION_DEFAULTS.find(r => r.entity === entity);
    if (!defaults) return false;
    const key = `${action}_roles` as keyof typeof defaults;
    return ((defaults[key] as string[]) || []).includes(roleKey);
  }, [roles, pendingChanges]);

  const toggleEntityPerm = useCallback((roleKey: string, entity: PermissionEntity, action: PermissionAction) => {
    const current = getEntityPerm(roleKey, entity, action);
    const role = roles.find(r => r.role === roleKey);
    const storedEp = (role?.entityPermissions || {}) as Record<string, Record<string, boolean>>;
    const pendingEp = (pendingChanges[roleKey]?.entityPermissions || storedEp) as Record<string, Record<string, boolean>>;
    const updated = { ...pendingEp, [entity]: { ...(pendingEp[entity] || {}), [action]: !current } };
    setPendingChanges(prev => ({ ...prev, [roleKey]: { ...prev[roleKey], entityPermissions: updated as any } }));
  }, [roles, pendingChanges, getEntityPerm]);

  return { roles, loading, pendingChanges, setPendingChanges, loadRoles, getEntityPerm, toggleEntityPerm, setLoading };
}

function PermissionsTab({ toast, shared }: { toast: any; shared: ReturnType<typeof useRolesData> }) {
  const { roles, loading, pendingChanges, setPendingChanges, loadRoles, getEntityPerm, toggleEntityPerm, setLoading } = shared;
  const [selectedRole, setSelectedRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleKey, setNewRoleKey] = useState("");
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [editLabelValue, setEditLabelValue] = useState("");
  const [deletingRole, setDeletingRole] = useState(false);
  const [showSaveAllConfirm, setShowSaveAllConfirm] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [roleSearch, setRoleSearch] = useState("");
  const [activeSubTab, setActiveSubTab] = useState("navigation");
  const [showCompare, setShowCompare] = useState(false);
  const [compareRole, setCompareRole] = useState("");
  const [permSearch, setPermSearch] = useState("");

  useEffect(() => { if (roles.length > 0 && !selectedRole) setSelectedRole(roles[0].role); }, [roles, selectedRole]);

  const currentRole = roles.find(r => r.role === selectedRole);
  const hasChanges = !!pendingChanges[selectedRole];
  const hasAnyChanges = Object.keys(pendingChanges).length > 0;
  const changedRoleCount = Object.keys(pendingChanges).length;

  const effectiveSections = useMemo(() => {
    if (!currentRole) return [] as string[];
    const raw = (pendingChanges[selectedRole]?.sections as string[] | undefined) || (currentRole.sections as string[]) || [];
    return raw.filter(s => (ALL_SECTIONS as readonly string[]).includes(s));
  }, [currentRole, pendingChanges, selectedRole]);

  const toggleSection = (section: string) => {
    if (!currentRole) return;
    const related = SECTION_GROUPS[section] || [section];
    const isActive = related.some(s => effectiveSections.includes(s));
    const next = isActive
      ? effectiveSections.filter(s => !related.includes(s))
      : [...effectiveSections, ...related.filter(s => !effectiveSections.includes(s))];
    setPendingChanges(prev => ({ ...prev, [selectedRole]: { ...prev[selectedRole], sections: next } }));
  };

  const handleSave = async () => {
    const changes = pendingChanges[selectedRole];
    if (!changes) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/roles/${selectedRole}`, { method: "PUT", headers: getAuthHeaders(), credentials: "include", body: JSON.stringify(changes) });
      if (res.ok) {
        toast({ title: "Saved", description: `Permissions updated for ${currentRole?.label || selectedRole}.` });
        setPendingChanges(prev => { const n = { ...prev }; delete n[selectedRole]; return n; });
        loadRoles();
      } else { const d = await res.json(); toast({ title: "Error", description: d.error || "Failed to save.", variant: "destructive" }); }
    } catch { toast({ title: "Error", description: "Failed to save.", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleSaveAll = async () => {
    setSavingAll(true);
    const roleKeys = Object.keys(pendingChanges);
    let successCount = 0;
    let failCount = 0;
    for (const roleKey of roleKeys) {
      try {
        const res = await fetch(`/api/roles/${roleKey}`, { method: "PUT", headers: getAuthHeaders(), credentials: "include", body: JSON.stringify(pendingChanges[roleKey]) });
        if (res.ok) { successCount++; } else { failCount++; }
      } catch { failCount++; }
    }
    if (successCount > 0) {
      toast({ title: "All Changes Saved", description: `${successCount} role(s) updated successfully.${failCount > 0 ? ` ${failCount} failed.` : ""}` });
      setPendingChanges({});
      loadRoles();
    } else if (failCount > 0) {
      toast({ title: "Error", description: `Failed to save ${failCount} role(s).`, variant: "destructive" });
    }
    setSavingAll(false);
    setShowSaveAllConfirm(false);
  };

  const handleCreate = async () => {
    if (!newRoleKey || !newRoleLabel) return;
    setCreatingRole(true);
    try {
      const res = await fetch("/api/roles", { method: "POST", headers: getAuthHeaders(), credentials: "include", body: JSON.stringify({ role: newRoleKey.toUpperCase().replace(/\s+/g, "_"), label: newRoleLabel }) });
      if (res.ok) { toast({ title: "Created", description: `${newRoleLabel} role created.` }); setShowCreateRole(false); setNewRoleKey(""); setNewRoleLabel(""); loadRoles(); }
      else { const d = await res.json(); toast({ title: "Error", description: d.error || "Failed.", variant: "destructive" }); }
    } catch { toast({ title: "Error", description: "Failed to create role.", variant: "destructive" }); }
    finally { setCreatingRole(false); }
  };

  const handleRename = async () => {
    if (!editLabelValue.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/roles/${selectedRole}`, { method: "PUT", headers: getAuthHeaders(), credentials: "include", body: JSON.stringify({ label: editLabelValue.trim() }) });
      if (res.ok) { toast({ title: "Renamed" }); setEditingLabel(false); loadRoles(); }
      else { const d = await res.json(); toast({ title: "Error", description: d.error || "Failed.", variant: "destructive" }); }
    } catch { toast({ title: "Error", description: "Failed.", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDeleteRole = async () => {
    setDeletingRole(true);
    try {
      const res = await fetch(`/api/roles/${selectedRole}`, { method: "DELETE", headers: getAuthHeaders(), credentials: "include" });
      if (res.ok) { toast({ title: "Deleted" }); setSelectedRole(roles[0]?.role || ""); loadRoles(); }
      else { const d = await res.json(); toast({ title: "Error", description: d.error || "Failed.", variant: "destructive" }); }
    } catch { toast({ title: "Error", description: "Failed.", variant: "destructive" }); }
    finally { setDeletingRole(false); }
  };

  const setCategoryPreset = (cat: PermCat, preset: "all" | "view" | "none") => {
    const role = roles.find(r => r.role === selectedRole);
    const storedEp = (role?.entityPermissions || {}) as Record<string, Record<string, boolean>>;
    const pendingEp = (pendingChanges[selectedRole]?.entityPermissions || { ...storedEp }) as Record<string, Record<string, boolean>>;
    const updated = { ...pendingEp };
    for (const item of cat.items) {
      updated[item.entity] = { ...(updated[item.entity] || {}) };
      for (const action of item.actions) {
        updated[item.entity][action] = preset === "all" ? true : preset === "view" ? action === "view" : false;
      }
    }
    setPendingChanges(prev => ({ ...prev, [selectedRole]: { ...prev[selectedRole], entityPermissions: updated as any } }));
  };

  const roleStats = useMemo(() => {
    if (!selectedRole) return { sections: 0, editableEntities: 0, highRisk: 0, totalEntities: 0 };
    const activeCats = PERM_CATEGORIES.filter(c => c.section === "PROJECT_DETAIL" || c.section === "SETTINGS" || (SECTION_GROUPS[c.section] || [c.section]).some(s => effectiveSections.includes(s)));
    let editableEntities = 0;
    let highRisk = 0;
    let totalEntities = 0;
    for (const cat of activeCats) {
      for (const item of cat.items) {
        totalEntities++;
        if (item.actions.some(a => a !== "view" && getEntityPerm(selectedRole, item.entity, a))) editableEntities++;
        if (["delete", "override"].some(a => item.actions.includes(a as PermissionAction) && getEntityPerm(selectedRole, item.entity, a as PermissionAction))) highRisk++;
      }
    }
    return { sections: effectiveSections.length, editableEntities, highRisk, totalEntities };
  }, [selectedRole, effectiveSections, getEntityPerm]);

  const filteredRoles = useMemo(() => {
    if (!roleSearch) return roles;
    const t = roleSearch.toLowerCase();
    return roles.filter(r => r.label.toLowerCase().includes(t) || r.role.toLowerCase().includes(t));
  }, [roles, roleSearch]);

  const getRoleRiskLevel = useCallback((roleKey: string): "low" | "medium" | "high" => {
    let highCount = 0;
    for (const cat of PERM_CATEGORIES) {
      for (const item of cat.items) {
        if (["delete", "override"].some(a => item.actions.includes(a as PermissionAction) && getEntityPerm(roleKey, item.entity, a as PermissionAction))) highCount++;
      }
    }
    if (highCount >= 3) return "high";
    if (highCount >= 1) return "medium";
    return "low";
  }, [getEntityPerm]);

  if (loading) {
    return <Card><CardContent className="py-12 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="ml-2 text-muted-foreground">Loading...</span></CardContent></Card>;
  }

  const activeCats = PERM_CATEGORIES.filter(c => c.section === "PROJECT_DETAIL" || c.section === "SETTINGS" || (SECTION_GROUPS[c.section] || [c.section]).some(s => effectiveSections.includes(s)));

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Role List Panel */}
        <div className="lg:w-60 shrink-0">
          <Card data-testid="card-role-selector">
            <CardHeader className="py-3 px-3 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">Roles</CardTitle>
              <div className="flex items-center gap-0.5">
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowCompare(true)} title="Compare roles" data-testid="btn-compare-roles">
                  <ArrowLeftRight className="h-3.5 w-3.5 text-blue-500" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowCreateRole(true)} title="Create role" data-testid="btn-create-role">
                  <Plus className="h-3.5 w-3.5 text-green-600" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setLoading(true); loadRoles(); }} title="Refresh" data-testid="btn-refresh-roles">
                  <RefreshCw className="h-3 w-3 text-gray-400" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-1.5 pt-0 space-y-0.5">
              <div className="px-1.5 pb-1.5">
                <div className="relative">
                  <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    placeholder="Filter roles..."
                    value={roleSearch}
                    onChange={e => setRoleSearch(e.target.value)}
                    className="h-7 pl-7 text-xs"
                    data-testid="input-search-roles"
                  />
                </div>
              </div>
              <div className="max-h-[460px] overflow-y-auto space-y-0.5">
                {filteredRoles.map(role => {
                  const sel = selectedRole === role.role;
                  const riskLevel = getRoleRiskLevel(role.role);
                  return (
                    <button
                      key={role.role}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${sel ? "bg-green-50 border border-green-200" : "hover:bg-muted border border-transparent"}`}
                      onClick={() => setSelectedRole(role.role)}
                      data-testid={`btn-select-role-${role.role}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`font-medium flex-1 min-w-0 truncate ${sel ? "text-green-800" : "text-foreground"}`}>{role.label}</span>
                        {!!pendingChanges[role.role] && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
                        {riskLevel === "high" && <ShieldAlert className="h-3 w-3 text-red-400 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {role.isSystem ? (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-blue-200 text-blue-600 bg-blue-50">System</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-gray-200 text-gray-500">Custom</Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Panel */}
        <div className="flex-1 min-w-0 space-y-4">
          {currentRole && (
            <>
              {/* Role Summary Header */}
              <Card data-testid="card-role-summary">
                <CardContent className="py-3 px-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {editingLabel ? (
                          <div className="flex items-center gap-1.5">
                            <Input value={editLabelValue} onChange={e => setEditLabelValue(e.target.value)} className="h-7 w-36 sm:w-48 text-sm" autoFocus onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditingLabel(false); }} data-testid="input-rename-role" />
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={handleRename}><Check className="h-3 w-3 text-green-600" /></Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingLabel(false)}><X className="h-3 w-3 text-gray-400" /></Button>
                          </div>
                        ) : (
                          <>
                            <h2 className="text-lg font-bold text-foreground" data-testid="text-selected-role-name">{currentRole.label}</h2>
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => { setEditingLabel(true); setEditLabelValue(currentRole.label); }} data-testid="btn-rename-role">
                              <Pencil className="h-3 w-3 text-gray-400" />
                            </Button>
                          </>
                        )}
                        {currentRole.isSystem ? (
                          <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-600 bg-blue-50">System Role</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Custom Role</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Layers className="h-3 w-3" />
                          {roleStats.sections} sections
                        </span>
                        <span className="flex items-center gap-1">
                          <Edit3 className="h-3 w-3" />
                          {roleStats.editableEntities} editable
                        </span>
                        {roleStats.highRisk > 0 && (
                          <span className="flex items-center gap-1 text-red-500 font-medium">
                            <ShieldAlert className="h-3 w-3" />
                            {roleStats.highRisk} high-risk
                          </span>
                        )}
                        <span className="text-gray-300">|</span>
                        <span>{roleStats.totalEntities} total features</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!currentRole.isSystem && (
                        <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-50 h-7" onClick={handleDeleteRole} disabled={deletingRole} data-testid="btn-delete-role">
                          {deletingRole ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      {hasChanges && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setPendingChanges(prev => { const n = { ...prev }; delete n[selectedRole]; return n; })} data-testid="btn-discard-changes">
                            <X className="h-3.5 w-3.5 mr-1" /> Discard
                          </Button>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handleSave} disabled={saving} data-testid="btn-save-role">
                            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                            Save
                          </Button>
                        </>
                      )}
                      {hasAnyChanges && changedRoleCount > 1 && (
                        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowSaveAllConfirm(true)} disabled={savingAll} data-testid="btn-save-all-changes">
                          {savingAll ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                          Save All ({changedRoleCount})
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Sub-tabs */}
              <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
                <TabsList className="grid w-full grid-cols-4 h-10">
                  <TabsTrigger value="navigation" className="flex items-center gap-1.5 text-xs" data-testid="subtab-navigation">
                    <Globe className="h-3.5 w-3.5" /> Navigation
                  </TabsTrigger>
                  <TabsTrigger value="capabilities" className="flex items-center gap-1.5 text-xs" data-testid="subtab-capabilities">
                    <Shield className="h-3.5 w-3.5" /> Capabilities
                  </TabsTrigger>
                  <TabsTrigger value="scope" className="flex items-center gap-1.5 text-xs" data-testid="subtab-scope">
                    <Network className="h-3.5 w-3.5" /> Scope & Limits
                  </TabsTrigger>
                  <TabsTrigger value="enforcement" className="flex items-center gap-1.5 text-xs" data-testid="subtab-enforcement">
                    <ShieldCheck className="h-3.5 w-3.5" /> Enforcement
                  </TabsTrigger>
                </TabsList>

                {/* Navigation Tab */}
                <TabsContent value="navigation" className="mt-3 space-y-3">
                  <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-2.5 flex items-start gap-3" data-testid="info-navigation">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      Controls which sidebar sections this role can see. Turning a section <strong>off</strong> hides it from the sidebar and blocks the routes. This is fully enforced.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    {NAV_DISPLAY_SECTIONS.map(sectionKey => {
                      const meta = SECTION_META[sectionKey];
                      if (!meta) return null;
                      const Icon = meta.icon;
                      const sectionRelated = SECTION_GROUPS[sectionKey] || [sectionKey];
                      const sectionActive = sectionRelated.some(s => effectiveSections.includes(s));
                      const alwaysOn = sectionKey === "SETTINGS";

                      return (
                        <div
                          key={sectionKey}
                          className={`rounded-lg border p-3 transition-all ${sectionActive || alwaysOn ? meta.bg : "bg-gray-50 border-gray-200 opacity-60"}`}
                          data-testid={`nav-section-${sectionKey}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${sectionActive || alwaysOn ? "bg-white/80" : "bg-gray-100"}`}>
                              <Icon className={`h-4 w-4 ${sectionActive || alwaysOn ? meta.color : "text-gray-400"}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${sectionActive || alwaysOn ? "text-foreground" : "text-gray-400"}`}>{meta.label}</span>
                                {alwaysOn && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-gray-300 text-gray-500">Always On</Badge>}
                                {sectionActive && !alwaysOn && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-green-300 text-green-600 bg-green-50">Active</Badge>}
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{meta.description}</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {meta.pages.map(page => (
                                  <span key={page} className={`text-[10px] px-1.5 py-0.5 rounded ${sectionActive || alwaysOn ? "bg-white/60 text-foreground" : "bg-gray-100 text-gray-400"}`}>
                                    {page}
                                  </span>
                                ))}
                              </div>
                            </div>
                            {!alwaysOn && (
                              <Switch
                                checked={sectionActive}
                                onCheckedChange={() => toggleSection(sectionKey)}
                                className="shrink-0"
                                data-testid={`switch-section-${selectedRole}-${sectionKey}`}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>

                {/* Capabilities Tab */}
                <TabsContent value="capabilities" className="mt-3 space-y-3">
                  <div className="flex items-center gap-2 justify-between">
                    <div className="relative flex-1 max-w-xs">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <Input
                        placeholder="Filter features..."
                        value={permSearch}
                        onChange={e => setPermSearch(e.target.value)}
                        className="h-8 pl-8 text-xs"
                        data-testid="input-search-permissions"
                      />
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-blue-200" /> View</span>
                      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-amber-200" /> Edit</span>
                      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-green-200" /> Approve</span>
                      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-purple-200" /> Override</span>
                      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-red-200" /> Delete</span>
                    </div>
                  </div>

                  <div className="space-y-3" data-testid="permission-categories">
                    {PERM_CATEGORIES.map(cat => {
                      const Icon = cat.icon;
                      const sectionRelated = SECTION_GROUPS[cat.section] || [cat.section];
                      const sectionActive = sectionRelated.some(s => effectiveSections.includes(s));
                      const alwaysOn = cat.section === "PROJECT_DETAIL" || cat.section === "SETTINGS";
                      const isActive = alwaysOn || sectionActive;
                      const activeCount = cat.items.filter(i => i.actions.some(a => getEntityPerm(selectedRole, i.entity, a))).length;

                      const filteredItems = permSearch
                        ? cat.items.filter(i => i.label.toLowerCase().includes(permSearch.toLowerCase()) || i.entity.toLowerCase().includes(permSearch.toLowerCase()))
                        : cat.items;

                      if (permSearch && filteredItems.length === 0) return null;

                      return (
                        <Card
                          key={cat.key}
                          className={`overflow-hidden transition-all ${!isActive ? "opacity-50 border-dashed" : ""}`}
                          data-testid={`category-${cat.key}`}
                        >
                          <div className={`flex items-center gap-2 px-4 py-2 border-b ${isActive ? "bg-muted/80" : "bg-muted/60"}`}>
                            <div className={`h-5 w-5 rounded ${isActive ? cat.color : "bg-gray-300"} flex items-center justify-center shrink-0`}>
                              <Icon className="h-3 w-3 text-white" />
                            </div>
                            <span className={`text-xs font-semibold flex-1 ${isActive ? "text-foreground" : "text-gray-400"}`}>{cat.label}</span>
                            {isActive ? (
                              <Badge variant="secondary" className="text-[10px] font-normal">{activeCount}/{cat.items.length}</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] font-normal border-dashed text-gray-400 bg-transparent flex items-center gap-1">
                                <Lock className="h-2.5 w-2.5" /> Section Off
                              </Badge>
                            )}
                            {isActive && (
                              <div className="flex items-center gap-1 ml-2">
                                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] font-semibold text-green-600 hover:bg-green-50" onClick={() => setCategoryPreset(cat, "all")} data-testid={`preset-full-${cat.key}`}>All</Button>
                                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] font-semibold text-blue-600 hover:bg-blue-50" onClick={() => setCategoryPreset(cat, "view")} data-testid={`preset-view-${cat.key}`}>View</Button>
                                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] font-semibold text-red-500 hover:bg-red-50" onClick={() => setCategoryPreset(cat, "none")} data-testid={`preset-none-${cat.key}`}>Off</Button>
                              </div>
                            )}
                          </div>

                          <div className={`divide-y divide-gray-50 ${!isActive ? "pointer-events-none" : ""}`}>
                            {!isActive && (
                              <div className="px-4 py-2 bg-muted/50 flex items-center gap-2">
                                <Lock className="h-3 w-3 text-gray-300" />
                                <span className="text-[11px] text-gray-400">Enable this section in the Navigation tab to configure permissions.</span>
                              </div>
                            )}
                            {filteredItems.map((item) => (
                              <div
                                key={item.entity}
                                className={`flex items-center gap-3 px-4 py-2 transition-colors ${isActive ? "hover:bg-blue-50/30" : "bg-muted/30"}`}
                                data-testid={`entity-row-${selectedRole}-${item.entity}`}
                              >
                                <span className={`text-xs flex-1 min-w-0 truncate ${isActive ? "text-foreground" : "text-gray-300"}`} title={item.label}>
                                  {item.label}
                                </span>
                                {item.enforcement === "backend" && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-green-200 text-green-600 bg-green-50 shrink-0">
                                    <Server className="h-2 w-2 mr-0.5" />BE
                                  </Badge>
                                )}
                                <div className="flex items-center gap-1 shrink-0">
                                  {item.actions.map(action => {
                                    const active = isActive && getEntityPerm(selectedRole, item.entity, action);
                                    const actionMeta = ACTION_META[action];
                                    const isHighRisk = actionMeta.risk === "high" && active;
                                    return (
                                      <button
                                        key={action}
                                        className={`h-6 min-w-[44px] px-1.5 rounded-md text-[10px] font-semibold border transition-all flex items-center justify-center gap-0.5 ${
                                          !isActive
                                            ? "bg-muted border-border text-gray-200 cursor-not-allowed"
                                            : active
                                              ? `${actionMeta.activeBg} ${isHighRisk ? "ring-1 ring-red-300" : ""}`
                                              : "bg-muted border-border text-gray-300 hover:bg-muted hover:text-muted-foreground"
                                        }`}
                                        onClick={() => { if (isActive) toggleEntityPerm(selectedRole, item.entity, action); }}
                                        title={isActive ? `${actionMeta.label}: ${item.label}${isHighRisk ? " (high-risk)" : ""}` : "Enable section first"}
                                        disabled={!isActive}
                                        data-testid={`perm-${selectedRole}-${item.entity}-${action}`}
                                      >
                                        {actionMeta.short}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </TabsContent>

                {/* Scope & Limits Tab */}
                <TabsContent value="scope" className="mt-3 space-y-4">
                  <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-2.5 flex items-start gap-3" data-testid="info-scope">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      Scope rules determine <strong>which records</strong> a role can see, beyond just having permission to access a feature. These are enforced at the backend level.
                    </p>
                  </div>

                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Layers className="h-4 w-4 text-blue-600" />
                        Access Scope Tiers
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="space-y-2">
                        {SCOPE_TIERS.map((tier, idx) => {
                          const isCurrentTier = tier.roles.toLowerCase().includes(selectedRole.toLowerCase().replace(/_/g, " ")) ||
                            (tier.tier === "Full Oversight" && ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "ACCOUNTANT"].includes(selectedRole)) ||
                            (tier.tier === "Owned Projects" && selectedRole === "PROJECT_MANAGER_SITE") ||
                            (tier.tier === "Assigned Only" && selectedRole === "ENGINEER") ||
                            (tier.tier === "Own Records" && selectedRole === "PROJECT_DEVELOPER");
                          return (
                            <div
                              key={idx}
                              className={`rounded-lg border p-3 transition-all ${isCurrentTier ? "border-green-300 bg-green-50" : "border-border"}`}
                              data-testid={`scope-tier-${idx}`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-xs font-semibold ${isCurrentTier ? "text-green-700" : "text-foreground"}`}>{tier.tier}</span>
                                {isCurrentTier && (
                                  <Badge className="text-[9px] px-1.5 py-0 h-4 bg-green-600 text-white">Current Role</Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground">{tier.description}</p>
                              <p className="text-[10px] text-gray-400 mt-1">Roles: {tier.roles}</p>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Server className="h-4 w-4 text-purple-600" />
                        Backend-Enforced Scope Rules
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="space-y-1.5">
                        {SCOPE_RULES.map((rule, idx) => (
                          <div key={idx} className="rounded-lg border border-border p-2.5" data-testid={`scope-rule-${idx}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-semibold text-foreground">{rule.endpoint}</span>
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-green-300 text-green-600 bg-green-50">
                                <Server className="h-2 w-2 mr-0.5" />{rule.enforced}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground">{rule.scope}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">Affects: {rule.roles_affected}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Enforcement & Risks Tab */}
                <TabsContent value="enforcement" className="mt-3 space-y-4">
                  <EnforcementPanel selectedRole={selectedRole} getEntityPerm={getEntityPerm} effectiveSections={effectiveSections} />
                </TabsContent>
              </Tabs>

              {/* Sticky save bar */}
              {hasAnyChanges && (
                <div className="sticky bottom-4 z-10">
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-lg">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="text-sm font-medium text-amber-800">
                        {changedRoleCount === 1
                          ? `Unsaved changes for ${currentRole?.label || selectedRole}`
                          : `Unsaved changes for ${changedRoleCount} roles`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {hasChanges && (
                        <Button size="sm" variant="ghost" className="text-amber-700 h-8" onClick={() => setPendingChanges(prev => { const n = { ...prev }; delete n[selectedRole]; return n; })} data-testid="btn-discard-bottom">Discard Current</Button>
                      )}
                      {hasChanges && (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 h-8" onClick={handleSave} disabled={saving} data-testid="btn-save-bottom">
                          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}Save
                        </Button>
                      )}
                      {changedRoleCount > 1 && (
                        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 h-8" onClick={() => setShowSaveAllConfirm(true)} disabled={savingAll} data-testid="btn-save-all-bottom">
                          {savingAll ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}Save All ({changedRoleCount})
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Save All Confirm Dialog */}
      <Dialog open={showSaveAllConfirm} onOpenChange={setShowSaveAllConfirm}>
        <DialogContent data-testid="dialog-save-all-confirm">
          <DialogHeader><DialogTitle>Save All Changes</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">You have unsaved changes for {changedRoleCount} role(s):</p>
            <ul className="text-sm space-y-1">
              {Object.keys(pendingChanges).map(roleKey => {
                const roleObj = roles.find(r => r.role === roleKey);
                return (
                  <li key={roleKey} className="flex items-center gap-2" data-testid={`save-all-role-${roleKey}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />
                    <span className="font-medium">{roleObj?.label || roleKey}</span>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-muted-foreground">Are you sure you want to save all changes?</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowSaveAllConfirm(false)} data-testid="btn-cancel-save-all">Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleSaveAll} disabled={savingAll} data-testid="btn-confirm-save-all">
              {savingAll ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save All Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Role Dialog */}
      <Dialog open={showCreateRole} onOpenChange={setShowCreateRole}>
        <DialogContent data-testid="dialog-create-role">
          <DialogHeader><DialogTitle>Create New Role</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Role Key</Label>
              <Input placeholder="e.g. SITE_MANAGER" value={newRoleKey} onChange={e => setNewRoleKey(e.target.value.toUpperCase().replace(/\s+/g, "_"))} data-testid="input-new-role-key" />
              <p className="text-[10px] text-gray-400 mt-0.5">Auto-formatted uppercase identifier</p>
            </div>
            <div>
              <Label>Display Name</Label>
              <Input placeholder="e.g. Site Manager" value={newRoleLabel} onChange={e => setNewRoleLabel(e.target.value)} data-testid="input-new-role-label" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreateRole(false)} data-testid="btn-cancel-create-role">Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleCreate} disabled={creatingRole || !newRoleKey || !newRoleLabel} data-testid="btn-confirm-create-role">
              {creatingRole ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compare Roles Dialog */}
      <Dialog open={showCompare} onOpenChange={setShowCompare}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="dialog-compare-roles">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /> Compare Roles</DialogTitle></DialogHeader>
          <CompareRolesPanel roles={roles} selectedRole={selectedRole} compareRole={compareRole} setCompareRole={setCompareRole} getEntityPerm={getEntityPerm} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CompareRolesPanel({ roles, selectedRole, compareRole, setCompareRole, getEntityPerm }: {
  roles: RolePermission[];
  selectedRole: string;
  compareRole: string;
  setCompareRole: (r: string) => void;
  getEntityPerm: (role: string, entity: PermissionEntity, action: PermissionAction) => boolean;
}) {
  const currentRoleObj = roles.find(r => r.role === selectedRole);
  const otherRoles = roles.filter(r => r.role !== selectedRole);

  const differences = useMemo(() => {
    if (!compareRole) return [];
    const diffs: { category: string; entity: string; label: string; action: string; roleA: boolean; roleB: boolean }[] = [];
    for (const cat of PERM_CATEGORIES) {
      for (const item of cat.items) {
        for (const action of item.actions) {
          const a = getEntityPerm(selectedRole, item.entity, action);
          const b = getEntityPerm(compareRole, item.entity, action);
          if (a !== b) {
            diffs.push({ category: cat.label, entity: item.entity, label: item.label, action, roleA: a, roleB: b });
          }
        }
      }
    }
    return diffs;
  }, [compareRole, selectedRole, getEntityPerm]);

  const compareRoleObj = roles.find(r => r.role === compareRole);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Role A</Label>
          <div className="text-sm font-semibold mt-0.5">{currentRoleObj?.label || selectedRole}</div>
        </div>
        <ArrowLeftRight className="h-4 w-4 text-gray-400 shrink-0" />
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Role B</Label>
          <SearchableSelect
            value={compareRole}
            onValueChange={setCompareRole}
            triggerClassName="h-8 text-xs mt-0.5"
            placeholder="Select role to compare..."
            data-testid="select-compare-role"
            options={otherRoles.map(r => ({ value: r.role, label: r.label }))}
          />
        </div>
      </div>

      {compareRole && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {differences.length === 0
              ? "These roles have identical permissions."
              : `${differences.length} difference${differences.length !== 1 ? "s" : ""} found:`}
          </p>

          {differences.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_80px_60px_60px] gap-0 text-[10px] font-semibold text-muted-foreground bg-muted/80 px-3 py-1.5 border-b">
                <span>Category</span>
                <span>Feature</span>
                <span>Action</span>
                <span className="text-center">{currentRoleObj?.label?.split(" ")[0] || "A"}</span>
                <span className="text-center">{compareRoleObj?.label?.split(" ")[0] || "B"}</span>
              </div>
              <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-50">
                {differences.map((d, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_80px_60px_60px] gap-0 text-xs px-3 py-1.5 hover:bg-muted/30" data-testid={`compare-diff-${i}`}>
                    <span className="text-gray-500 truncate">{d.category}</span>
                    <span className="font-medium truncate">{d.label}</span>
                    <span className="text-muted-foreground capitalize">{d.action}</span>
                    <span className="text-center">{d.roleA ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline" /> : <XCircle className="h-3.5 w-3.5 text-gray-300 inline" />}</span>
                    <span className="text-center">{d.roleB ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline" /> : <XCircle className="h-3.5 w-3.5 text-gray-300 inline" />}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EnforcementPanel({ selectedRole, getEntityPerm, effectiveSections }: {
  selectedRole: string;
  getEntityPerm: (role: string, entity: PermissionEntity, action: PermissionAction) => boolean;
  effectiveSections: string[];
}) {
  const [enforcement, setEnforcement] = useState<any>(null);
  const [loadingEnf, setLoadingEnf] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingEnf(true);
      try {
        const res = await fetch("/api/admin/control-center/permission-enforcement", { headers: getAuthHeaders(), credentials: "include" });
        if (res.ok && !cancelled) {
          setEnforcement(await res.json());
        }
      } catch {}
      if (!cancelled) setLoadingEnf(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const highRiskPerms = useMemo(() => {
    const risks: { entity: string; label: string; action: string; category: string }[] = [];
    for (const cat of PERM_CATEGORIES) {
      for (const item of cat.items) {
        for (const action of item.actions) {
          if ((action === "delete" || action === "override") && getEntityPerm(selectedRole, item.entity, action as PermissionAction)) {
            risks.push({ entity: item.entity, label: item.label, action, category: cat.label });
          }
        }
      }
    }
    return risks;
  }, [selectedRole, getEntityPerm]);

  const uiOnlyEntities = useMemo(() => {
    const uiOnly: { entity: string; label: string; category: string }[] = [];
    for (const cat of PERM_CATEGORIES) {
      for (const item of cat.items) {
        if (!item.enforcement && item.actions.some(a => getEntityPerm(selectedRole, item.entity, a))) {
          uiOnly.push({ entity: item.entity, label: item.label, category: cat.label });
        }
      }
    }
    return uiOnly;
  }, [selectedRole, getEntityPerm]);

  const backendEnforcedEntities = useMemo(() => {
    const be: { entity: string; label: string; category: string }[] = [];
    for (const cat of PERM_CATEGORIES) {
      for (const item of cat.items) {
        if (item.enforcement === "backend" && item.actions.some(a => getEntityPerm(selectedRole, item.entity, a))) {
          be.push({ entity: item.entity, label: item.label, category: cat.label });
        }
      }
    }
    return be;
  }, [selectedRole, getEntityPerm]);

  if (loadingEnf) {
    return <Card><CardContent className="py-8 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /><span className="ml-2 text-sm text-muted-foreground">Loading enforcement data...</span></CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-2.5 flex items-start gap-3" data-testid="info-enforcement">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-800 space-y-1">
          <p className="font-semibold">Enforcement Truth</p>
          <p>This panel shows what is actually enforced by the server vs. what is only visible in the UI. Use this to understand the real security posture of each role.</p>
        </div>
      </div>

      {/* Summary Stats */}
      {enforcement && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="enforcement-stats">
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
            <div className="text-lg font-bold text-green-700">{enforcement.summary.totalBackendEnforcedRoutes}</div>
            <div className="text-[10px] text-green-600 font-medium">Backend-Enforced Routes</div>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
            <div className="text-lg font-bold text-blue-700">{enforcement.summary.totalOwnershipScopedEndpoints}</div>
            <div className="text-[10px] text-blue-600 font-medium">Ownership-Scoped</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
            <div className="text-lg font-bold text-gray-700">{enforcement.summary.totalApplicationLogicOnly}</div>
            <div className="text-[10px] text-gray-600 font-medium">App Logic Only</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
            <div className="text-lg font-bold text-amber-700">{enforcement.summary.recentAccessDenials7d}</div>
            <div className="text-[10px] text-amber-600 font-medium">Denials (7 days)</div>
          </div>
        </div>
      )}

      {/* High-risk permissions for this role */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-500" />
            High-Risk Permissions
            {highRiskPerms.length > 0 && <Badge className="text-[10px] bg-red-100 text-red-700 border-red-200" variant="outline">{highRiskPerms.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {highRiskPerms.length === 0 ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              This role has no high-risk permissions (delete, override) enabled.
            </div>
          ) : (
            <div className="space-y-1">
              {highRiskPerms.map((p, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded bg-red-50/50 border border-red-100" data-testid={`high-risk-${i}`}>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${p.action === "delete" ? "bg-red-100 text-red-700" : "bg-purple-100 text-purple-700"}`}>
                    {p.action.toUpperCase()}
                  </span>
                  <span className="text-xs font-medium">{p.label}</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{p.category}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backend-enforced features */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="h-4 w-4 text-green-600" />
            Backend-Enforced Features
            <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200" variant="outline">{backendEnforcedEntities.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {backendEnforcedEntities.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No backend-enforced features are enabled for this role.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {backendEnforcedEntities.map((e, i) => (
                <Badge key={i} variant="outline" className="text-[10px] border-green-200 text-green-700 bg-green-50">{e.label}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* UI-only features */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Monitor className="h-4 w-4 text-amber-600" />
            UI-Visibility Only Features
            <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200" variant="outline">{uiOnlyEntities.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-[11px] text-muted-foreground mb-2">
            These features are gated by the UI (hidden/shown) but do not have dedicated backend middleware on their write routes. Access may still be limited by authentication and application logic.
          </p>
          {uiOnlyEntities.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No UI-only features enabled.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {uiOnlyEntities.map((e, i) => (
                <Badge key={i} variant="outline" className="text-[10px] border-amber-200 text-amber-700 bg-amber-50">{e.label}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Known gaps */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4 text-gray-500" />
            Known Limitations
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
              <p>Row-level security (RLS) is not fully implemented. Some read endpoints rely on application-level filtering rather than database-enforced row filtering.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
              <p>Project-specific read endpoints (work items, engineering tasks within a project) are scoped by the frontend providing a project context rather than by backend ownership checks.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
              <p>Rate limiting and brute-force protection are not yet implemented on API endpoints.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
              <p>Audit logging for permission changes is limited. Changes are saved but detailed change-level audit trails are not yet available.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UsersTab({ toast, shared }: { toast: any; shared: ReturnType<typeof useRolesData> }) {
  const roles = shared.roles;
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingId, setChangingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", name: "", email: "", password: "", role: "PROGRAM_MANAGER" });
  const [creating, setCreating] = useState(false);
  const [resetUser, setResetUser] = useState<UserRecord | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetting, setResetting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<UserRecord | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try { const r = await fetch("/api/admin/users", { headers: getAuthHeaders(), credentials: "include" }); if (r.ok) setUsers(await r.json()); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const changeRole = async (uid: number, role: string) => {
    setChangingId(uid);
    try {
      const r = await fetch(`/api/admin/users/${uid}/role`, { method: "PATCH", headers: getAuthHeaders(), credentials: "include", body: JSON.stringify({ role }) });
      if (r.ok) { toast({ title: "Updated", description: `Role changed.` }); load(); }
      else { const d = await r.json(); toast({ title: "Error", description: d.error || "Failed.", variant: "destructive" }); }
    } catch { toast({ title: "Error", description: "Failed.", variant: "destructive" }); }
    finally { setChangingId(null); }
  };

  const createUser = async () => {
    if (!newUser.username || !newUser.name || !newUser.email || !newUser.password) { toast({ title: "Error", description: "All fields required.", variant: "destructive" }); return; }
    setCreating(true);
    try {
      const r = await fetch("/api/admin/users", { method: "POST", headers: getAuthHeaders(), credentials: "include", body: JSON.stringify(newUser) });
      if (r.ok) { toast({ title: "Created", description: `${newUser.name} added.` }); setShowCreate(false); setNewUser({ username: "", name: "", email: "", password: "", role: "PROGRAM_MANAGER" }); load(); }
      else { const d = await r.json(); toast({ title: "Error", description: d.error || "Failed.", variant: "destructive" }); }
    } catch { toast({ title: "Error", description: "Failed.", variant: "destructive" }); }
    finally { setCreating(false); }
  };

  const doResetPw = async () => {
    if (!resetUser || resetPw.length < 4) { toast({ title: "Error", description: "Min 4 characters.", variant: "destructive" }); return; }
    setResetting(true);
    try {
      const r = await fetch(`/api/admin/users/${resetUser.id}/password`, { method: "PATCH", headers: { ...getAuthHeaders(), "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ password: resetPw }) });
      if (r.ok) { toast({ title: "Done", description: `Password reset for ${resetUser.name}.` }); setResetUser(null); setResetPw(""); }
      else { const d = await r.json(); toast({ title: "Error", description: d.error || "Failed.", variant: "destructive" }); }
    } catch { toast({ title: "Error", description: "Failed.", variant: "destructive" }); }
    finally { setResetting(false); }
  };

  const deleteUser = async (uid: number) => {
    setDeletingId(uid);
    try {
      const r = await fetch(`/api/admin/users/${uid}`, { method: "DELETE", headers: getAuthHeaders(), credentials: "include" });
      if (r.ok) { toast({ title: "Removed" }); load(); }
      else { const d = await r.json(); toast({ title: "Error", description: d.error || "Failed.", variant: "destructive" }); }
    } catch { toast({ title: "Error", description: "Failed.", variant: "destructive" }); }
    finally { setDeletingId(null); }
  };

  const filtered = useMemo(() => {
    if (!search) return users;
    const t = search.toLowerCase();
    return users.filter(u => u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t) || u.role.toLowerCase().includes(t));
  }, [users, search]);

  const roleColors: Record<string, string> = {
    CEO_ADMIN: "bg-red-100 text-red-700 border-red-200",
    COO_ADMIN: "bg-red-100 text-red-700 border-red-200",
    CCO: "bg-orange-100 text-orange-700 border-orange-200",
    CFO: "bg-emerald-100 text-emerald-700 border-emerald-200",
    PROGRAM_MANAGER: "bg-blue-100 text-blue-700 border-blue-200",
    PROGRAM_FINANCE_MANAGER: "bg-teal-100 text-teal-700 border-teal-200",
    CONSTRUCTION_MANAGER: "bg-amber-100 text-amber-700 border-amber-200",
    QUALITY_MANAGER: "bg-purple-100 text-purple-700 border-purple-200",
    ENGINEERING_MANAGER: "bg-orange-100 text-orange-700 border-orange-200",
    ENGINEER: "bg-sky-100 text-sky-700 border-sky-200",
    ACCOUNTANT: "bg-lime-100 text-lime-700 border-lime-200",
    KEY_ACCOUNTS_MANAGER: "bg-indigo-100 text-indigo-700 border-indigo-200",
    PROJECT_MANAGER_SITE: "bg-cyan-100 text-cyan-700 border-cyan-200",
    PROJECT_DEVELOPER: "bg-violet-100 text-violet-700 border-violet-200",
  };

  if (loading) return <Card><CardContent className="py-12 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="ml-2 text-muted-foreground">Loading...</span></CardContent></Card>;

  return (
    <>
      <Card data-testid="card-user-management">
        <CardHeader className="flex flex-row items-center justify-between py-3 px-5">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-green-600" /> Users</CardTitle>
            <p className="text-xs text-gray-400">{users.length} registered</p>
          </div>
          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => setShowCreate(true)} data-testid="btn-create-user">
            <UserPlus className="h-4 w-4 mr-1" /> New User
          </Button>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <Input placeholder="Search by name, email, or role..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 mb-3" data-testid="input-search-users" />
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-users">No users found.</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map(user => {
                const roleObj = roles.find(r => r.role === user.role);
                const roleLabel = roleObj?.label || COMPANY_ROLE_LABELS[user.role as CompanyRole] || user.role;
                const rc = roleColors[user.role] || "bg-muted text-foreground border-border";
                return (
                  <div key={user.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-muted/80 transition-all" data-testid={`user-row-${user.id}`}>
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-green-100 to-emerald-200 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-green-700">{user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
                        <span className="text-sm font-medium text-foreground" data-testid={`text-user-name-${user.id}`}>{user.name}</span>
                        <span className="text-xs text-gray-400 truncate">{user.email}</span>
                      </div>
                      <Badge className={`text-[10px] mt-0.5 border ${rc}`} variant="outline" data-testid={`text-user-role-${user.id}`}>{roleLabel}</Badge>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <SearchableSelect
                        value={user.role}
                        onValueChange={val => changeRole(user.id, val)}
                        disabled={changingId === user.id}
                        triggerClassName="w-28 sm:w-44 h-7 text-xs"
                        data-testid={`select-role-${user.id}`}
                        options={roles.map(r => ({ value: r.role, label: r.label }))}
                      />
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setResetUser(user); setResetPw(""); }} title="Reset password" data-testid={`btn-reset-password-${user.id}`}>
                        <KeyRound className="h-3.5 w-3.5 text-blue-500" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setConfirmDelete(user)} disabled={deletingId === user.id} title="Delete user" data-testid={`btn-delete-user-${user.id}`}>
                        {deletingId === user.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-red-600" />}
                      </Button>
                      {changingId === user.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent data-testid="dialog-create-user">
          <DialogHeader><DialogTitle>Create User</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Username</Label><Input placeholder="johndoe" value={newUser.username} onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))} data-testid="input-new-user-username" /></div>
            <div><Label>Full Name</Label><Input placeholder="John Doe" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} data-testid="input-new-user-name" /></div>
            <div><Label>Email</Label><Input type="email" placeholder="john@example.com" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} data-testid="input-new-user-email" /></div>
            <div><Label>Password</Label><Input type="password" placeholder="Enter password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} data-testid="input-new-user-password" /></div>
            <div>
              <Label>Role</Label>
              <SearchableSelect
                value={newUser.role}
                onValueChange={val => setNewUser(p => ({ ...p, role: val }))}
                triggerClassName="h-9"
                data-testid="select-new-user-role"
                options={roles.map(r => ({ value: r.role, label: r.label }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreate(false)} data-testid="btn-cancel-create-user">Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={createUser} disabled={creating || !newUser.username || !newUser.name || !newUser.email || !newUser.password} data-testid="btn-confirm-create-user">
              {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetUser} onOpenChange={open => { if (!open) { setResetUser(null); setResetPw(""); } }}>
        <DialogContent data-testid="dialog-reset-password">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Reset Password</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">New password for <strong>{resetUser?.name}</strong></p>
          <Input type="password" placeholder="Min 4 characters" value={resetPw} onChange={e => setResetPw(e.target.value)} data-testid="input-reset-password" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setResetUser(null); setResetPw(""); }} data-testid="btn-cancel-reset-password">Cancel</Button>
            <Button onClick={doResetPw} disabled={resetting || resetPw.length < 4} data-testid="btn-confirm-reset-password">
              {resetting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1" />}Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={open => { if (!open) setConfirmDelete(null); }}>
        <DialogContent data-testid="dialog-confirm-delete-user">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="h-5 w-5" /> Remove User</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Remove <strong>{confirmDelete?.name}</strong>? They will no longer be able to log in.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} data-testid="btn-cancel-delete-user">Cancel</Button>
            <Button variant="destructive" onClick={() => { if (confirmDelete) { deleteUser(confirmDelete.id); setConfirmDelete(null); } }} disabled={deletingId !== null} data-testid="btn-confirm-delete-user">
              {deletingId !== null ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
