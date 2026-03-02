import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  CheckCircle2,
  XCircle,
  LayoutDashboard,
  FolderKanban,
  DollarSign,
  Wrench,
  ShieldCheck,
  BookOpen,
  Settings,
  Lock,
  Briefcase,
  FileText,
  MessageSquare,
  Database,
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
  "COCKPIT", "PROJECTS", "MONEY", "PROJECT_DEVELOPMENT", "DELIVERY", "GOVERNANCE", "INFORMATION", "ADMIN",
] as const;

const SECTION_META: Record<string, { label: string; icon: any; color: string }> = {
  COCKPIT: { label: "EXCO", icon: LayoutDashboard, color: "bg-indigo-50 border-indigo-200 text-indigo-700" },
  PROJECTS: { label: "Project Management", icon: FolderKanban, color: "bg-blue-50 border-blue-200 text-blue-700" },
  MONEY: { label: "Project Finance", icon: DollarSign, color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
  DELIVERY: { label: "Engineering", icon: Wrench, color: "bg-orange-50 border-orange-200 text-orange-700" },
  GOVERNANCE: { label: "Governance", icon: ShieldCheck, color: "bg-purple-50 border-purple-200 text-purple-700" },
  INFORMATION: { label: "Information", icon: BookOpen, color: "bg-cyan-50 border-cyan-200 text-cyan-700" },
  PROJECT_DEVELOPMENT: { label: "Project Development", icon: Briefcase, color: "bg-teal-50 border-teal-200 text-teal-700" },
  ADMIN: { label: "Admin", icon: Settings, color: "bg-slate-50 border-slate-200 text-slate-700" },
};

interface PermCat {
  key: string;
  label: string;
  icon: any;
  color: string;
  items: { entity: PermissionEntity; label: string; actions: PermissionAction[] }[];
}

const PERM_CATEGORIES: PermCat[] = [
  {
    key: "exco",
    label: "EXCO",
    icon: LayoutDashboard,
    color: "bg-indigo-500",
    items: [
      { entity: "home" as PermissionEntity, label: "Home / Action Hub", actions: ["view"] },
      { entity: "my_tool" as PermissionEntity, label: "My Tool (Today, Week, Backlog, Settings)", actions: ["view", "edit"] },
      { entity: "triage_inbox" as PermissionEntity, label: "Triage Inbox (/my-tool/triage-inbox)", actions: ["view", "edit"] },
      { entity: "unclassified_tasks" as PermissionEntity, label: "Unclassified Tasks (/my-tool/unclassified-tasks)", actions: ["view", "edit", "delete"] },
      { entity: "company_priorities" as PermissionEntity, label: "Company Priorities", actions: ["view", "edit", "delete"] },
      { entity: "lifecycle" as PermissionEntity, label: "Lifecycle Board (Phases, Gates, Merge)", actions: ["view", "edit", "override"] },
      { entity: "meetings" as PermissionEntity, label: "Meetings (Calendar, Read.ai)", actions: ["view", "edit"] },
      { entity: "operational_tasks" as PermissionEntity, label: "Operational Tasks (Email-to-Task)", actions: ["view", "edit", "delete"] },
      { entity: "dashboard_widgets" as PermissionEntity, label: "Home Dashboard Widgets", actions: ["view", "edit"] },
    ],
  },
  {
    key: "pm",
    label: "Project Management",
    icon: FolderKanban,
    color: "bg-blue-500",
    items: [
      { entity: "execution_board" as PermissionEntity, label: "Execution Board", actions: ["view", "edit"] },
      { entity: "projects" as PermissionEntity, label: "Project Summary", actions: ["view", "edit", "delete"] },
      { entity: "project_normalized" as PermissionEntity, label: "Normalized Project View (drill-down)", actions: ["view"] },
      { entity: "pm_dashboard" as PermissionEntity, label: "PM Dashboard", actions: ["view"] },
      { entity: "tr_register" as PermissionEntity, label: "TR Register", actions: ["view", "edit", "delete"] },
      { entity: "smart_import" as PermissionEntity, label: "Smart Import", actions: ["view", "edit"] },
      { entity: "portfolios" as PermissionEntity, label: "Portfolios (List)", actions: ["view", "edit", "delete"] },
      { entity: "portfolio_detail" as PermissionEntity, label: "Portfolio Detail (Gantt, Rollups, Key Dates, Rollout)", actions: ["view", "edit", "delete"] },
      { entity: "create_project" as PermissionEntity, label: "Create Project", actions: ["edit"] },
      { entity: "approvals" as PermissionEntity, label: "Approvals (Eng Gates, Quality, Deliverables)", actions: ["view", "approve"] },
      { entity: "pm_on_the_go" as PermissionEntity, label: "PM On-The-Go Mode", actions: ["view", "edit"] },
      { entity: "weekly_review_wizard" as PermissionEntity, label: "Weekly Review Wizard", actions: ["view", "edit"] },
      { entity: "project_creation" as PermissionEntity, label: "Project Creation", actions: ["edit"] },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    icon: DollarSign,
    color: "bg-emerald-500",
    items: [
      { entity: "financials" as PermissionEntity, label: "Financials Overview", actions: ["view", "edit"] },
      { entity: "revenue" as PermissionEntity, label: "Revenue Tracker (/revenue)", actions: ["view", "edit"] },
      { entity: "cashflow" as PermissionEntity, label: "Cashflow", actions: ["view", "edit"] },
      { entity: "cashflow_forecast" as PermissionEntity, label: "Cashflow Forecast (/cashflow-forecast)", actions: ["view", "edit"] },
      { entity: "cos" as PermissionEntity, label: "COS Tracker", actions: ["view", "edit"] },
      { entity: "cos_control" as PermissionEntity, label: "COS Control (Overrides, Invoices)", actions: ["view", "edit", "override"] },
      { entity: "subcontractors" as PermissionEntity, label: "Procurement / Subcontractors", actions: ["view", "edit", "delete"] },
      { entity: "procurement" as PermissionEntity, label: "Procurement Data", actions: ["view", "edit"] },
      { entity: "invoice_patterns" as PermissionEntity, label: "Invoice Patterns", actions: ["view", "edit"] },
      { entity: "financial_integration" as PermissionEntity, label: "Financial Integration (Edit Requests, Rules, Sync)", actions: ["view", "edit", "approve"] },
      { entity: "financial_linking" as PermissionEntity, label: "Financial Linking (Revenue/Expense to Plan)", actions: ["view", "edit"] },
    ],
  },
  {
    key: "engineering",
    label: "Engineering",
    icon: Wrench,
    color: "bg-orange-500",
    items: [
      { entity: "engineering" as PermissionEntity, label: "Engineering Dashboard (Standup)", actions: ["view", "edit"] },
      { entity: "eng_tasks" as PermissionEntity, label: "Task Board (My Tasks, Board, List, Projects)", actions: ["view", "edit", "delete"] },
      { entity: "eng_stages" as PermissionEntity, label: "Engineering Stages (Checklists, Gates)", actions: ["view", "edit", "approve"] },
      { entity: "eng_inbox" as PermissionEntity, label: "Pipeline Intake Inbox (/engineering/inbox)", actions: ["view", "edit", "approve"] },
      { entity: "eng_sync" as PermissionEntity, label: "SharePoint Sync (/engineering/sync)", actions: ["view", "edit"] },
      { entity: "phase_templates" as PermissionEntity, label: "Phase Templates", actions: ["view", "edit"] },
    ],
  },
  {
    key: "quality",
    label: "Quality & Governance",
    icon: ShieldCheck,
    color: "bg-purple-500",
    items: [
      { entity: "quality" as PermissionEntity, label: "Quality Dashboard (Warnings, Overrides)", actions: ["view", "edit", "approve", "override"] },
      { entity: "governance" as PermissionEntity, label: "Governance", actions: ["view", "edit"] },
    ],
  },
  {
    key: "project_detail",
    label: "Project Detail Tabs",
    icon: FileText,
    color: "bg-cyan-500",
    items: [
      { entity: "pd_overview" as PermissionEntity, label: "Overview (Tasks, Board, Calendar)", actions: ["view", "edit"] },
      { entity: "pd_plan" as PermissionEntity, label: "Plan (Milestones, Structure)", actions: ["view", "edit"] },
      { entity: "pd_gantt" as PermissionEntity, label: "Gantt Chart", actions: ["view"] },
      { entity: "pd_key_dates" as PermissionEntity, label: "Key Dates", actions: ["view", "edit"] },
      { entity: "pd_finance" as PermissionEntity, label: "Finance Summary", actions: ["view", "edit"] },
      { entity: "pd_revenue" as PermissionEntity, label: "Revenue", actions: ["view", "edit"] },
      { entity: "pd_expenditure" as PermissionEntity, label: "Expenditure", actions: ["view", "edit"] },
      { entity: "pd_cos_tracker" as PermissionEntity, label: "COS Tracker", actions: ["view", "edit"] },
      { entity: "pd_cashflow" as PermissionEntity, label: "Cashflow", actions: ["view", "edit"] },
      { entity: "pd_subcontractors" as PermissionEntity, label: "Subcontractors", actions: ["view", "edit"] },
      { entity: "pd_engineering" as PermissionEntity, label: "Engineering Section", actions: ["view", "edit"] },
      { entity: "pd_eng_tasks" as PermissionEntity, label: "Engineering Tasks (Detail)", actions: ["view", "edit", "delete"] },
      { entity: "pd_eng_stages" as PermissionEntity, label: "Engineering Stages (Detail)", actions: ["view", "edit", "approve"] },
      { entity: "pd_quality" as PermissionEntity, label: "Quality Tab", actions: ["view", "edit", "approve", "delete"] },
      { entity: "pd_collaboration" as PermissionEntity, label: "Collaboration (Chat, SharePoint, Approvals, Notifications)", actions: ["view", "edit"] },
      { entity: "pd_history" as PermissionEntity, label: "History / Audit", actions: ["view"] },
    ],
  },
  {
    key: "project_dev",
    label: "Project Development",
    icon: Briefcase,
    color: "bg-violet-500",
    items: [
      { entity: "pd_dashboard" as PermissionEntity, label: "PD Dashboard", actions: ["view"] },
      { entity: "pd_tickets" as PermissionEntity, label: "PD Tickets (List)", actions: ["view", "edit", "delete"] },
      { entity: "pd_clients" as PermissionEntity, label: "Clients", actions: ["view", "edit", "delete"] },
    ],
  },
  {
    key: "information",
    label: "Information",
    icon: BookOpen,
    color: "bg-cyan-600",
    items: [
      { entity: "ee_info" as PermissionEntity, label: "Emergent Energy Info (SOPs, Walkthroughs)", actions: ["view", "edit"] },
      { entity: "ee_info_lifecycle" as PermissionEntity, label: "OS Map — Lifecycle Overview", actions: ["view", "edit"] },
      { entity: "ee_info_departments" as PermissionEntity, label: "OS Map — Department Drilldown", actions: ["view", "edit", "delete"] },
      { entity: "ee_info_processes" as PermissionEntity, label: "OS Map — Processes & SOPs", actions: ["view", "edit", "delete"] },
      { entity: "ee_info_templates" as PermissionEntity, label: "OS Map — Templates Library", actions: ["view", "edit", "delete"] },
      { entity: "leaderboard" as PermissionEntity, label: "Leaderboard", actions: ["view"] },
      { entity: "feedback" as PermissionEntity, label: "Feedback & Support", actions: ["view", "edit"] },
      { entity: "notifications" as PermissionEntity, label: "Notifications", actions: ["view"] },
      { entity: "teams_chat" as PermissionEntity, label: "Teams Chat Groups (Channels, Messages, Files)", actions: ["view", "edit", "delete"] },
      { entity: "gamification" as PermissionEntity, label: "Gamification (Badges, Points, Levels)", actions: ["view"] },
    ],
  },
  {
    key: "collaboration",
    label: "Collaboration",
    icon: MessageSquare,
    color: "bg-pink-500",
    items: [
      { entity: "collaboration_hub" as PermissionEntity, label: "Collaboration Hub", actions: ["view", "edit"] },
      { entity: "sharepoint_files" as PermissionEntity, label: "SharePoint Files", actions: ["view", "edit", "delete"] },
      { entity: "project_chat" as PermissionEntity, label: "Project Chat", actions: ["view", "edit"] },
      { entity: "deliverables" as PermissionEntity, label: "Deliverables & Approvals", actions: ["view", "edit", "approve"] },
      { entity: "excel_sync_ack" as PermissionEntity, label: "Excel Sync Acknowledgments", actions: ["view", "approve"] },
      { entity: "my_work" as PermissionEntity, label: "My Work (Unified Dashboard)", actions: ["view", "edit"] },
      { entity: "ms_sync" as PermissionEntity, label: "Microsoft 365 Sync", actions: ["view", "edit"] },
      { entity: "project_tagging" as PermissionEntity, label: "Project Tagging (Link MS Objects)", actions: ["view", "edit", "delete"] },
    ],
  },
  {
    key: "data_reports",
    label: "Data & Reports",
    icon: Database,
    color: "bg-teal-500",
    items: [
      { entity: "data_import" as PermissionEntity, label: "Data Import (Smart Import, Excel)", actions: ["view", "edit"] },
      { entity: "data_export" as PermissionEntity, label: "Data Export & Reports", actions: ["view"] },
      { entity: "audit_trail" as PermissionEntity, label: "Audit Trail & Change History", actions: ["view"] },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    icon: Settings,
    color: "bg-slate-500",
    items: [
      { entity: "admin" as PermissionEntity, label: "Admin Settings (Import, Maintenance)", actions: ["view", "edit"] },
      { entity: "admin_roles" as PermissionEntity, label: "Roles & Permissions (/admin/roles)", actions: ["view", "edit"] },
      { entity: "activity_log" as PermissionEntity, label: "Change Audit (/admin/activity-log)", actions: ["view"] },
      { entity: "weekly_reviews" as PermissionEntity, label: "Weekly Reviews", actions: ["view", "edit"] },
    ],
  },
];

const ACTION_STYLE: Record<PermissionAction, { label: string; icon: any; bg: string }> = {
  view: { label: "View", icon: Eye, bg: "bg-blue-600" },
  edit: { label: "Edit", icon: Edit3, bg: "bg-amber-600" },
  approve: { label: "Approve", icon: ThumbsUp, bg: "bg-green-600" },
  override: { label: "Override", icon: Zap, bg: "bg-purple-600" },
  delete: { label: "Delete", icon: Trash2, bg: "bg-red-600" },
};

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
    <div className="space-y-6 max-w-[1200px] mx-auto" data-testid="admin-roles-page">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-3" data-testid="text-page-title">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center">
            <Shield className="h-5 w-5 text-white" />
          </div>
          Roles & Permissions
        </h1>
        <p className="text-sm text-gray-500 mt-1 ml-[52px]">Configure sidebar access and feature permissions per role</p>
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
      if (res.ok) setRoles(await res.json());
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set(PERM_CATEGORIES.map(c => c.key)));
  const [showSaveAllConfirm, setShowSaveAllConfirm] = useState(false);
  const [savingAll, setSavingAll] = useState(false);

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
    const next = effectiveSections.includes(section)
      ? effectiveSections.filter(s => s !== section)
      : [...effectiveSections, section];
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

  if (loading) {
    return <Card><CardContent className="py-12 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="ml-2 text-muted-foreground">Loading...</span></CardContent></Card>;
  }

  const activePermCount = PERM_CATEGORIES.flatMap(c => c.items).filter(i => i.actions.some(a => getEntityPerm(selectedRole, i.entity, a))).length;
  const totalItems = PERM_CATEGORIES.flatMap(c => c.items).length;

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-56 shrink-0">
          <Card data-testid="card-role-selector">
            <CardHeader className="py-3 px-3 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold text-gray-500 uppercase">Roles</CardTitle>
              <div className="flex items-center gap-0.5">
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowCreateRole(true)} title="Create role" data-testid="btn-create-role">
                  <Plus className="h-3.5 w-3.5 text-green-600" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setLoading(true); loadRoles(); }} title="Refresh" data-testid="btn-refresh-roles">
                  <RefreshCw className="h-3 w-3 text-gray-400" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-1.5 pt-0 space-y-0.5 max-h-[500px] overflow-y-auto">
              {roles.map(role => {
                const sel = selectedRole === role.role;
                return (
                  <button
                    key={role.role}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${sel ? "bg-green-50 border border-green-200" : "hover:bg-gray-50 border border-transparent"}`}
                    onClick={() => setSelectedRole(role.role)}
                    data-testid={`btn-select-role-${role.role}`}
                  >
                    <span className={`font-medium ${sel ? "text-green-800" : "text-gray-700"}`}>{role.label}</span>
                    {!!pendingChanges[role.role] && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />}
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          {currentRole && (
            <>
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
                        <h2 className="text-lg font-bold text-gray-900" data-testid="text-selected-role-name">{currentRole.label}</h2>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => { setEditingLabel(true); setEditLabelValue(currentRole.label); }} data-testid="btn-rename-role">
                          <Pencil className="h-3 w-3 text-gray-400" />
                        </Button>
                      </>
                    )}
                    {currentRole.isSystem && <Badge variant="outline" className="text-[10px]">System</Badge>}
                  </div>
                  <span className="text-xs text-gray-400">{effectiveSections.length} sections, {activePermCount}/{totalItems} features active</span>
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

              <Card data-testid="card-sidebar-access">
                <CardHeader className="py-2.5 px-4">
                  <CardTitle className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sidebar Sections</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-0">
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_SECTIONS.map(s => {
                      const meta = SECTION_META[s];
                      const active = effectiveSections.includes(s);
                      const Icon = meta.icon;
                      return (
                        <button
                          key={s}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${active ? meta.color : "border-gray-100 bg-gray-50/50 text-gray-400"}`}
                          onClick={() => toggleSection(s)}
                          data-testid={`toggle-section-${selectedRole}-${s}`}
                        >
                          <Icon className="h-3 w-3" />
                          {meta.label}
                          {active ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : <XCircle className="h-3 w-3 text-gray-300" />}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2" data-testid="permission-categories">
                {PERM_CATEGORIES.map(cat => {
                  const isExpanded = expanded.has(cat.key);
                  const Icon = cat.icon;
                  const activeCount = cat.items.filter(i => i.actions.some(a => getEntityPerm(selectedRole, i.entity, a))).length;
                  return (
                    <Card key={cat.key} className="overflow-hidden" data-testid={`category-${cat.key}`}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50 transition-colors text-left"
                        onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(cat.key) ? n.delete(cat.key) : n.add(cat.key); return n; })}
                        data-testid={`btn-expand-category-${cat.key}`}
                      >
                        <div className={`h-7 w-7 rounded-md ${cat.color} flex items-center justify-center shrink-0`}>
                          <Icon className="h-3.5 w-3.5 text-white" />
                        </div>
                        <span className="text-sm font-semibold text-gray-800 flex-1">{cat.label}</span>
                        <Badge variant="outline" className="text-[10px]">{activeCount}/{cat.items.length}</Badge>
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-100">
                          <div className="px-4 py-1.5 bg-gray-50/60 flex items-center justify-end gap-1.5">
                            <Button variant="outline" size="sm" className="h-5 text-[10px] px-2 border-green-200 text-green-700 hover:bg-green-50" onClick={() => setCategoryPreset(cat, "all")} data-testid={`preset-full-${cat.key}`}>
                              <Check className="h-2.5 w-2.5 mr-0.5" /> Select All
                            </Button>
                            <Button variant="outline" size="sm" className="h-5 text-[10px] px-2 border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => setCategoryPreset(cat, "view")} data-testid={`preset-view-${cat.key}`}>
                              View Only
                            </Button>
                            <Button variant="outline" size="sm" className="h-5 text-[10px] px-2 border-red-200 text-red-700 hover:bg-red-50" onClick={() => setCategoryPreset(cat, "none")} data-testid={`preset-none-${cat.key}`}>
                              <X className="h-2.5 w-2.5 mr-0.5" /> Deselect All
                            </Button>
                          </div>
                          <div className="divide-y">
                            {cat.items.map((item, idx) => (
                              <div key={item.entity} className={`flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-0 px-4 py-2.5 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/30"} hover:bg-blue-50/30 transition-colors`} data-testid={`entity-row-${selectedRole}-${item.entity}`}>
                                <span className="text-sm text-gray-700 font-medium sm:w-[240px] shrink-0">{item.label}</span>
                                <div className="flex items-center gap-1 flex-wrap">
                                  {item.actions.map(action => {
                                    const active = getEntityPerm(selectedRole, item.entity, action);
                                    const style = ACTION_STYLE[action];
                                    return (
                                      <button
                                        key={action}
                                        className={`h-6 px-2.5 rounded-md border text-[10px] font-semibold transition-all inline-flex items-center gap-1 ${active ? `${style.bg} border-transparent text-white` : "bg-white border-gray-200 text-gray-300 hover:border-gray-300"}`}
                                        onClick={() => toggleEntityPerm(selectedRole, item.entity, action)}
                                        data-testid={`perm-${selectedRole}-${item.entity}-${action}`}
                                      >
                                        {active ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                                        {style.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>

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

      <Dialog open={showSaveAllConfirm} onOpenChange={setShowSaveAllConfirm}>
        <DialogContent data-testid="dialog-save-all-confirm">
          <DialogHeader><DialogTitle>Save All Changes</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">You have unsaved changes for {changedRoleCount} role(s):</p>
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
            <p className="text-sm text-gray-500">Are you sure you want to save all changes?</p>
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
    </>
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
                const rc = roleColors[user.role] || "bg-gray-100 text-gray-700 border-gray-200";
                return (
                  <div key={user.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50/80 transition-all" data-testid={`user-row-${user.id}`}>
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-green-100 to-emerald-200 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-green-700">{user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
                        <span className="text-sm font-medium text-gray-800" data-testid={`text-user-name-${user.id}`}>{user.name}</span>
                        <span className="text-xs text-gray-400 truncate">{user.email}</span>
                      </div>
                      <Badge className={`text-[10px] mt-0.5 border ${rc}`} variant="outline" data-testid={`text-user-role-${user.id}`}>{roleLabel}</Badge>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Select value={user.role} onValueChange={val => changeRole(user.id, val)} disabled={changingId === user.id}>
                        <SelectTrigger className="w-28 sm:w-44 h-7 text-xs" data-testid={`select-role-${user.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{roles.map(r => <SelectItem key={r.role} value={r.role}>{r.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setResetUser(user); setResetPw(""); }} title="Reset password" data-testid={`btn-reset-password-${user.id}`}>
                        <KeyRound className="h-3.5 w-3.5 text-blue-500" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setConfirmDelete(user)} disabled={deletingId === user.id} title="Delete user" data-testid={`btn-delete-user-${user.id}`}>
                        {deletingId === user.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-red-400" />}
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
              <Select value={newUser.role} onValueChange={val => setNewUser(p => ({ ...p, role: val }))}>
                <SelectTrigger className="h-9" data-testid="select-new-user-role"><SelectValue /></SelectTrigger>
                <SelectContent>{roles.map(r => <SelectItem key={r.role} value={r.role}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
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
