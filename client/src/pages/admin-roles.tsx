import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  UserPlus,
  KeyRound,
  Home,
  LayoutDashboard,
  DollarSign,
  Wrench,
  ShieldCheck,
  BookOpen,
  Settings,
  FolderKanban,
  Eye,
  Edit3,
  ThumbsUp,
  Zap,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Lock,
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
  "COCKPIT",
  "PROJECTS",
  "MONEY",
  "DELIVERY",
  "GOVERNANCE",
  "INFORMATION",
  "ADMIN",
] as const;

const SECTION_LABELS: Record<string, string> = {
  COCKPIT: "EXCO",
  PROJECTS: "Project Management",
  MONEY: "Project Finance",
  DELIVERY: "Engineering",
  GOVERNANCE: "Governance",
  INFORMATION: "Information",
  ADMIN: "Admin",
};

const SECTION_ICONS: Record<string, any> = {
  COCKPIT: LayoutDashboard,
  PROJECTS: FolderKanban,
  MONEY: DollarSign,
  DELIVERY: Wrench,
  GOVERNANCE: ShieldCheck,
  INFORMATION: BookOpen,
  ADMIN: Settings,
};

const SECTION_COLORS: Record<string, string> = {
  COCKPIT: "bg-indigo-50 border-indigo-200 text-indigo-700",
  PROJECTS: "bg-blue-50 border-blue-200 text-blue-700",
  MONEY: "bg-emerald-50 border-emerald-200 text-emerald-700",
  DELIVERY: "bg-orange-50 border-orange-200 text-orange-700",
  GOVERNANCE: "bg-purple-50 border-purple-200 text-purple-700",
  INFORMATION: "bg-cyan-50 border-cyan-200 text-cyan-700",
  ADMIN: "bg-slate-50 border-slate-200 text-slate-700",
};

interface PermissionCategory {
  key: string;
  label: string;
  description: string;
  icon: any;
  color: string;
  entities: { entity: PermissionEntity; label: string; description: string }[];
}

const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    key: "home_exco",
    label: "Home & EXCO",
    description: "Home dashboard, My Tool, company priorities, meetings, lifecycle board",
    icon: Home,
    color: "bg-indigo-500",
    entities: [
      { entity: "home" as PermissionEntity, label: "Home / Action Hub", description: "Dashboard with stats, tasks, and notifications" },
      { entity: "my_tool" as PermissionEntity, label: "My Tool", description: "Personal task manager with today, week, backlog views" },
      { entity: "lifecycle" as PermissionEntity, label: "Lifecycle Board", description: "Company pipeline with deal phases" },
      { entity: "company_priorities" as PermissionEntity, label: "Company Priorities", description: "Strategic priorities and focus areas" },
      { entity: "meetings" as PermissionEntity, label: "Meetings", description: "Meeting notes and Read.ai integration" },
      { entity: "notifications" as PermissionEntity, label: "Notifications", description: "Notification center and alerts" },
    ],
  },
  {
    key: "project_mgmt",
    label: "Project Management",
    description: "Projects, execution board, PM dashboard, import, portfolios",
    icon: FolderKanban,
    color: "bg-blue-500",
    entities: [
      { entity: "projects" as PermissionEntity, label: "Projects", description: "View and manage project list" },
      { entity: "execution_board" as PermissionEntity, label: "Execution Board", description: "Kanban-style project execution tracking" },
      { entity: "pm_dashboard" as PermissionEntity, label: "PM Dashboard", description: "Program manager overview dashboard" },
      { entity: "portfolios" as PermissionEntity, label: "Portfolios", description: "Portfolio management and dashboard views" },
      { entity: "smart_import" as PermissionEntity, label: "Smart Import", description: "Excel data import wizard" },
      { entity: "tr_register" as PermissionEntity, label: "TR Register", description: "Technical review action items" },
      { entity: "create_project" as PermissionEntity, label: "Create Project", description: "Ability to create new projects" },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    description: "Financial tracking, COS, cashflow, invoicing, procurement",
    icon: DollarSign,
    color: "bg-emerald-500",
    entities: [
      { entity: "financials" as PermissionEntity, label: "Financials", description: "Revenue and expense tracking" },
      { entity: "cos" as PermissionEntity, label: "COS Tracker", description: "Cost of sales tracking per project" },
      { entity: "cos_control" as PermissionEntity, label: "COS Control", description: "COS control dashboard and analysis" },
      { entity: "cashflow" as PermissionEntity, label: "Cashflow", description: "Cash flow tracker" },
      { entity: "cashflow_forecast" as PermissionEntity, label: "Cashflow Forecast", description: "Cash flow projections and forecasting" },
      { entity: "procurement" as PermissionEntity, label: "Procurement", description: "Procurement and purchase orders" },
      { entity: "invoice_patterns" as PermissionEntity, label: "Invoice Patterns", description: "Invoice pattern analysis" },
      { entity: "subcontractors" as PermissionEntity, label: "Subcontractors", description: "Subcontractor management dashboard" },
    ],
  },
  {
    key: "engineering",
    label: "Engineering",
    description: "Engineering stages, task boards, and delivery management",
    icon: Wrench,
    color: "bg-orange-500",
    entities: [
      { entity: "engineering" as PermissionEntity, label: "Engineering Dashboard", description: "Overview of all engineering activity" },
      { entity: "eng_tasks" as PermissionEntity, label: "Task Board", description: "Engineering task management board" },
      { entity: "eng_stages" as PermissionEntity, label: "Stage Checklists", description: "5-stage engineering checklist system" },
    ],
  },
  {
    key: "governance",
    label: "Governance & Quality",
    description: "Quality management, reviews, leaderboard, approvals",
    icon: ShieldCheck,
    color: "bg-purple-500",
    entities: [
      { entity: "quality" as PermissionEntity, label: "Quality Dashboard", description: "Quality management overview" },
      { entity: "governance" as PermissionEntity, label: "Governance", description: "Governance tracking and compliance" },
      { entity: "weekly_reviews" as PermissionEntity, label: "Weekly Reviews", description: "Weekly project review sessions" },
      { entity: "leaderboard" as PermissionEntity, label: "Leaderboard", description: "Gamification leaderboard and badges" },
      { entity: "approvals" as PermissionEntity, label: "Approvals", description: "Pending approvals queue" },
    ],
  },
  {
    key: "information",
    label: "Information & Support",
    description: "Knowledge base, walkthroughs, feedback",
    icon: BookOpen,
    color: "bg-cyan-500",
    entities: [
      { entity: "ee_info" as PermissionEntity, label: "EE Info & Walkthroughs", description: "Knowledge base and guided tours" },
      { entity: "feedback" as PermissionEntity, label: "Feedback & Support", description: "User feedback and support requests" },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    description: "System settings, roles, templates, activity logs",
    icon: Settings,
    color: "bg-slate-500",
    entities: [
      { entity: "admin" as PermissionEntity, label: "Admin Settings", description: "System configuration and settings" },
      { entity: "phase_templates" as PermissionEntity, label: "Phase Templates", description: "Engineering phase template management" },
      { entity: "activity_log" as PermissionEntity, label: "Activity Log", description: "System audit trail" },
    ],
  },
];

const PROJECT_DETAIL_CATEGORIES: PermissionCategory[] = [
  {
    key: "pd_overview",
    label: "Project Overview",
    description: "Landing page, task views, pillar cards",
    icon: Eye,
    color: "bg-blue-500",
    entities: [
      { entity: "pd_overview" as PermissionEntity, label: "Overview / Tasks", description: "Grid, Board, Calendar task views" },
      { entity: "pd_engineering" as PermissionEntity, label: "Engineering Pillar", description: "Engineering summary card on overview" },
      { entity: "pd_quality" as PermissionEntity, label: "Quality Pillar", description: "Quality summary card on overview" },
    ],
  },
  {
    key: "pd_pm",
    label: "Project Management",
    description: "Plan views, history, weekly reviews",
    icon: FolderKanban,
    color: "bg-indigo-500",
    entities: [
      { entity: "pd_plan" as PermissionEntity, label: "Plan", description: "Project plan with Gantt and key dates" },
      { entity: "pd_gantt" as PermissionEntity, label: "Gantt Chart", description: "Interactive Gantt chart view" },
      { entity: "pd_key_dates" as PermissionEntity, label: "Key Dates", description: "Milestone dates and deadlines" },
      { entity: "pd_history" as PermissionEntity, label: "History / Reviews", description: "Project history and weekly review log" },
    ],
  },
  {
    key: "pd_finance",
    label: "Project Finance",
    description: "Revenue, expenditure, COS, cashflow, subcontractors",
    icon: DollarSign,
    color: "bg-emerald-500",
    entities: [
      { entity: "pd_finance" as PermissionEntity, label: "Finance Summary", description: "Combined finance overview" },
      { entity: "pd_revenue" as PermissionEntity, label: "Revenue", description: "Revenue lines and inflows" },
      { entity: "pd_expenditure" as PermissionEntity, label: "Expenditure", description: "Expense lines and outflows" },
      { entity: "pd_cos_tracker" as PermissionEntity, label: "COS Tracker", description: "Project-level cost of sales" },
      { entity: "pd_cashflow" as PermissionEntity, label: "Cashflow", description: "Project cash flow tracking" },
      { entity: "pd_subcontractors" as PermissionEntity, label: "Subcontractors", description: "Subcontractor assignments and costs" },
    ],
  },
  {
    key: "pd_eng",
    label: "Project Engineering",
    description: "Engineering tasks and stage checklists",
    icon: Wrench,
    color: "bg-orange-500",
    entities: [
      { entity: "pd_eng_tasks" as PermissionEntity, label: "Engineering Tasks", description: "Task list for this project" },
      { entity: "pd_eng_stages" as PermissionEntity, label: "Engineering Stages", description: "Stage checklist progress" },
    ],
  },
];

const ACTION_CONFIG: { action: PermissionAction; label: string; icon: any; color: string; description: string }[] = [
  { action: "view", label: "View", icon: Eye, color: "bg-blue-600", description: "Can see this feature" },
  { action: "edit", label: "Edit", icon: Edit3, color: "bg-amber-600", description: "Can modify data" },
  { action: "approve", label: "Approve", icon: ThumbsUp, color: "bg-green-600", description: "Can approve items" },
  { action: "override", label: "Override", icon: Zap, color: "bg-purple-600", description: "Can override restrictions" },
  { action: "delete", label: "Delete", icon: Trash2, color: "bg-red-600", description: "Can delete records" },
];

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

interface UserRecord {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface SharedRolesState {
  roles: RolePermission[];
  loading: boolean;
  pendingChanges: Record<string, Partial<RolePermission>>;
  setPendingChanges: React.Dispatch<React.SetStateAction<Record<string, Partial<RolePermission>>>>;
  loadRoles: () => Promise<void>;
  getEntityPerm: (roleKey: string, entity: PermissionEntity, action: PermissionAction) => boolean;
  toggleEntityPerm: (roleKey: string, entity: PermissionEntity, action: PermissionAction) => void;
  setLoading: (v: boolean) => void;
}

export default function AdminRolesPage() {
  const { toast } = useToast();
  const companyRole = localStorage.getItem("company_role");
  const sharedState = useRolesData();

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
    <div className="space-y-6 max-w-[1400px] mx-auto" data-testid="admin-roles-page">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 flex items-center gap-3" data-testid="text-page-title">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center">
              <Shield className="h-5 w-5 text-white" />
            </div>
            Roles & Permissions
          </h1>
          <p className="text-sm text-gray-500 mt-1 ml-[52px]">Configure what each role can see and do across the application</p>
        </div>
      </header>

      <Tabs defaultValue="permissions" className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-12">
          <TabsTrigger value="permissions" className="flex items-center gap-2 text-sm" data-testid="tab-permissions">
            <Shield className="h-4 w-4" />
            Role Permissions
          </TabsTrigger>
          <TabsTrigger value="project-detail" className="flex items-center gap-2 text-sm" data-testid="tab-project-detail">
            <FolderKanban className="h-4 w-4" />
            Project Detail Access
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2 text-sm" data-testid="tab-users">
            <Users className="h-4 w-4" />
            User Management
          </TabsTrigger>
        </TabsList>

        <TabsContent value="permissions" className="mt-4">
          <RolePermissionsTab toast={toast} shared={sharedState} />
        </TabsContent>
        <TabsContent value="project-detail" className="mt-4">
          <ProjectDetailTab toast={toast} shared={sharedState} />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UserManagementSection toast={toast} shared={sharedState} />
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
      const res = await fetch("/api/roles", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setRoles(data);
      }
    } catch {
    } finally {
      setLoading(false);
    }
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
    setPendingChanges(prev => ({
      ...prev,
      [roleKey]: { ...prev[roleKey], entityPermissions: updated as any },
    }));
  }, [roles, pendingChanges, getEntityPerm]);

  return { roles, loading, pendingChanges, setPendingChanges, loadRoles, getEntityPerm, toggleEntityPerm, setLoading };
}

function RolePermissionsTab({ toast, shared }: { toast: ReturnType<typeof useToast>["toast"]; shared: SharedRolesState }) {
  const { roles, loading, pendingChanges, setPendingChanges, loadRoles, getEntityPerm, toggleEntityPerm, setLoading } = shared;
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleKey, setNewRoleKey] = useState("");
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [editLabelValue, setEditLabelValue] = useState("");
  const [deletingRole, setDeletingRole] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(PERMISSION_CATEGORIES.map(c => c.key)));

  useEffect(() => {
    if (roles.length > 0 && !selectedRole) {
      setSelectedRole(roles[0].role);
    }
  }, [roles, selectedRole]);

  const currentRole = roles.find(r => r.role === selectedRole);
  const hasChanges = !!pendingChanges[selectedRole];

  const effectiveSections = useMemo(() => {
    if (!currentRole) return [] as string[];
    const raw = (pendingChanges[selectedRole]?.sections as string[] | undefined) || (currentRole.sections as string[]) || [];
    const validKeys = new Set(ALL_SECTIONS as readonly string[]);
    return raw.filter(s => validKeys.has(s));
  }, [currentRole, pendingChanges, selectedRole]);

  const toggleSection = (section: string) => {
    if (!currentRole) return;
    const next = effectiveSections.includes(section)
      ? effectiveSections.filter(s => s !== section)
      : [...effectiveSections, section];
    setPendingChanges(prev => ({
      ...prev,
      [selectedRole]: { ...prev[selectedRole], sections: next },
    }));
  };

  const toggleCapability = (field: "canManageUsers" | "canManageRoles" | "canEditData") => {
    if (!currentRole) return;
    const currentVal = pendingChanges[selectedRole]?.[field] ?? currentRole[field];
    setPendingChanges(prev => ({
      ...prev,
      [selectedRole]: { ...prev[selectedRole], [field]: !currentVal },
    }));
  };

  const handleSaveRole = async () => {
    const changes = pendingChanges[selectedRole];
    if (!changes) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/roles/${selectedRole}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(changes),
      });
      if (res.ok) {
        toast({ title: "Saved", description: `Permissions updated for ${currentRole?.label || selectedRole}.` });
        setPendingChanges(prev => {
          const next = { ...prev };
          delete next[selectedRole];
          return next;
        });
        loadRoles();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to save.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save role.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRole = async () => {
    if (!newRoleKey || !newRoleLabel) {
      toast({ title: "Error", description: "Role key and display name are required.", variant: "destructive" });
      return;
    }
    setCreatingRole(true);
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ role: newRoleKey.toUpperCase().replace(/\s+/g, "_"), label: newRoleLabel, description: newRoleDesc }),
      });
      if (res.ok) {
        toast({ title: "Role Created", description: `${newRoleLabel} has been created.` });
        setShowCreateRole(false);
        setNewRoleKey("");
        setNewRoleLabel("");
        setNewRoleDesc("");
        loadRoles();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to create role.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to create role.", variant: "destructive" });
    } finally {
      setCreatingRole(false);
    }
  };

  const handleRenameRole = async () => {
    if (!editLabelValue.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/roles/${selectedRole}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ label: editLabelValue.trim() }),
      });
      if (res.ok) {
        toast({ title: "Renamed", description: `Role renamed to "${editLabelValue.trim()}".` });
        setEditingLabel(false);
        loadRoles();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to rename.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to rename role.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async () => {
    setDeletingRole(true);
    try {
      const res = await fetch(`/api/roles/${selectedRole}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        toast({ title: "Deleted", description: `Role "${selectedRole}" has been deleted.` });
        setSelectedRole(roles[0]?.role || "");
        loadRoles();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to delete role.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete role.", variant: "destructive" });
    } finally {
      setDeletingRole(false);
    }
  };

  const toggleCategoryExpand = (key: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllInCategory = (category: PermissionCategory, action: PermissionAction) => {
    if (!selectedRole) return;
    const allOn = category.entities.every(e => getEntityPerm(selectedRole, e.entity, action));
    category.entities.forEach(e => {
      const current = getEntityPerm(selectedRole, e.entity, action);
      if (allOn ? current : !current) {
        toggleEntityPerm(selectedRole, e.entity, action);
      }
    });
  };

  if (loading) {
    return (
      <Card data-testid="card-roles-loading">
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading roles...</span>
        </CardContent>
      </Card>
    );
  }

  const effectiveCanManageUsers = pendingChanges[selectedRole]?.canManageUsers ?? currentRole?.canManageUsers;
  const effectiveCanManageRoles = pendingChanges[selectedRole]?.canManageRoles ?? currentRole?.canManageRoles;
  const effectiveCanEditData = pendingChanges[selectedRole]?.canEditData ?? currentRole?.canEditData;

  const permCount = PERMISSION_CATEGORIES.reduce((sum, cat) => {
    return sum + cat.entities.filter(e => getEntityPerm(selectedRole, e.entity, "view")).length;
  }, 0);
  const totalEntities = PERMISSION_CATEGORIES.reduce((sum, cat) => sum + cat.entities.length, 0);

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-72 shrink-0 space-y-3">
          <Card data-testid="card-role-selector">
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-gray-700">Roles</CardTitle>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => setShowCreateRole(true)}
                    title="Create new role"
                    data-testid="btn-create-role"
                  >
                    <Plus className="h-3.5 w-3.5 text-green-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => { setLoading(true); loadRoles(); }}
                    data-testid="btn-refresh-roles"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-2 pt-0 space-y-1 max-h-[600px] overflow-y-auto">
              {roles.map((role) => {
                const isSelected = selectedRole === role.role;
                const roleHasChanges = !!pendingChanges[role.role];
                return (
                  <button
                    key={role.role}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-sm ${
                      isSelected
                        ? "bg-green-50 border border-green-200 shadow-sm"
                        : "hover:bg-gray-50 border border-transparent"
                    }`}
                    onClick={() => setSelectedRole(role.role)}
                    data-testid={`btn-select-role-${role.role}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-medium ${isSelected ? "text-green-800" : "text-gray-700"}`}>
                        {role.label}
                      </span>
                      <div className="flex items-center gap-1">
                        {roleHasChanges && (
                          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                        )}
                        {role.isSystem && (
                          <Lock className="h-3 w-3 text-gray-300" />
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono">{role.role}</span>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="flex-1 min-w-0 space-y-4">
          {currentRole && (
            <>
              <Card data-testid="card-role-header">
                <CardContent className="py-4 px-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        {editingLabel ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editLabelValue}
                              onChange={(e) => setEditLabelValue(e.target.value)}
                              className="h-8 w-56 text-sm"
                              autoFocus
                              onKeyDown={(e) => { if (e.key === "Enter") handleRenameRole(); if (e.key === "Escape") setEditingLabel(false); }}
                              data-testid="input-rename-role"
                            />
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleRenameRole}>
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingLabel(false)}>
                              <X className="h-3.5 w-3.5 text-gray-400" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <h2 className="text-lg font-bold text-gray-900" data-testid="text-selected-role-name">{currentRole.label}</h2>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => { setEditingLabel(true); setEditLabelValue(currentRole.label); }}
                              data-testid="btn-rename-role"
                            >
                              <Pencil className="h-3 w-3 text-gray-400" />
                            </Button>
                          </>
                        )}
                        {currentRole.isSystem && <Badge variant="outline" className="text-[10px]">System</Badge>}
                        {hasChanges && <Badge className="text-[10px] bg-amber-500">Unsaved Changes</Badge>}
                      </div>
                      {currentRole.description && (
                        <p className="text-sm text-gray-500 mt-1">{currentRole.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2">
                        <span className="text-xs text-gray-400">{effectiveSections.length} of {ALL_SECTIONS.length} sections</span>
                        <span className="text-xs text-gray-400">{permCount} of {totalEntities} modules accessible</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasChanges && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPendingChanges(prev => {
                              const next = { ...prev };
                              delete next[selectedRole];
                              return next;
                            })}
                            data-testid="btn-discard-changes"
                          >
                            <X className="h-3.5 w-3.5 mr-1" /> Discard
                          </Button>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={handleSaveRole}
                            disabled={saving}
                            data-testid="btn-save-role"
                          >
                            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                            Save Changes
                          </Button>
                        </>
                      )}
                      {!currentRole.isSystem && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={handleDeleteRole}
                          disabled={deletingRole}
                          data-testid="btn-delete-role"
                        >
                          {deletingRole ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-sidebar-access">
                <CardHeader className="py-3 px-5">
                  <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <LayoutDashboard className="h-4 w-4 text-gray-400" />
                    Sidebar Navigation Access
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                    {ALL_SECTIONS.map((section) => {
                      const isActive = effectiveSections.includes(section);
                      const Icon = SECTION_ICONS[section] || LayoutDashboard;
                      const colorClass = SECTION_COLORS[section] || "bg-gray-50 border-gray-200 text-gray-700";
                      return (
                        <button
                          key={section}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                            isActive
                              ? `${colorClass} shadow-sm`
                              : "border-gray-100 bg-gray-50/50 text-gray-400"
                          }`}
                          onClick={() => toggleSection(section)}
                          data-testid={`toggle-section-${selectedRole}-${section}`}
                        >
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                            isActive ? "bg-white/60" : "bg-gray-100"
                          }`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="text-left flex-1">
                            <span className="text-sm font-medium block">{SECTION_LABELS[section]}</span>
                          </div>
                          <div className={`h-5 w-5 rounded-full flex items-center justify-center ${
                            isActive ? "bg-white/80" : "bg-gray-200"
                          }`}>
                            {isActive
                              ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                              : <XCircle className="h-4 w-4 text-gray-300" />
                            }
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-special-capabilities">
                <CardHeader className="py-3 px-5">
                  <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-gray-400" />
                    Special Capabilities
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                        effectiveCanManageUsers ? "border-blue-200 bg-blue-50" : "border-gray-100 bg-gray-50/50"
                      }`}
                      data-testid={`toggle-canManageUsers-${selectedRole}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                          effectiveCanManageUsers ? "bg-blue-100" : "bg-gray-100"
                        }`}>
                          <Users className={`h-4 w-4 ${effectiveCanManageUsers ? "text-blue-600" : "text-gray-400"}`} />
                        </div>
                        <div>
                          <span className={`text-sm font-medium block ${effectiveCanManageUsers ? "text-blue-800" : "text-gray-500"}`}>Manage Users</span>
                          <span className="text-[11px] text-gray-400">Create, edit, delete accounts</span>
                        </div>
                      </div>
                      <Switch
                        checked={!!effectiveCanManageUsers}
                        onCheckedChange={() => toggleCapability("canManageUsers")}
                      />
                    </label>
                    <label
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                        effectiveCanManageRoles ? "border-purple-200 bg-purple-50" : "border-gray-100 bg-gray-50/50"
                      }`}
                      data-testid={`toggle-canManageRoles-${selectedRole}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                          effectiveCanManageRoles ? "bg-purple-100" : "bg-gray-100"
                        }`}>
                          <Shield className={`h-4 w-4 ${effectiveCanManageRoles ? "text-purple-600" : "text-gray-400"}`} />
                        </div>
                        <div>
                          <span className={`text-sm font-medium block ${effectiveCanManageRoles ? "text-purple-800" : "text-gray-500"}`}>Manage Roles</span>
                          <span className="text-[11px] text-gray-400">Create, edit role permissions</span>
                        </div>
                      </div>
                      <Switch
                        checked={!!effectiveCanManageRoles}
                        onCheckedChange={() => toggleCapability("canManageRoles")}
                      />
                    </label>
                    <label
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                        effectiveCanEditData ? "border-amber-200 bg-amber-50" : "border-gray-100 bg-gray-50/50"
                      }`}
                      data-testid={`toggle-canEditData-${selectedRole}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                          effectiveCanEditData ? "bg-amber-100" : "bg-gray-100"
                        }`}>
                          <Edit3 className={`h-4 w-4 ${effectiveCanEditData ? "text-amber-600" : "text-gray-400"}`} />
                        </div>
                        <div>
                          <span className={`text-sm font-medium block ${effectiveCanEditData ? "text-amber-800" : "text-gray-500"}`}>Edit Data</span>
                          <span className="text-[11px] text-gray-400">Inline editing of project data</span>
                        </div>
                      </div>
                      <Switch
                        checked={!!effectiveCanEditData}
                        onCheckedChange={() => toggleCapability("canEditData")}
                      />
                    </label>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3" data-testid="permission-categories">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-gray-400" />
                    Module Permissions
                  </h3>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setExpandedCategories(new Set(PERMISSION_CATEGORIES.map(c => c.key)))}
                    >
                      Expand All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setExpandedCategories(new Set())}
                    >
                      Collapse All
                    </Button>
                  </div>
                </div>

                {PERMISSION_CATEGORIES.map((category) => {
                  const isExpanded = expandedCategories.has(category.key);
                  const Icon = category.icon;
                  const viewCount = category.entities.filter(e => getEntityPerm(selectedRole, e.entity, "view")).length;
                  return (
                    <Card key={category.key} className="overflow-hidden" data-testid={`category-${category.key}`}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 transition-colors text-left"
                        onClick={() => toggleCategoryExpand(category.key)}
                        data-testid={`btn-expand-category-${category.key}`}
                      >
                        <div className={`h-9 w-9 rounded-lg ${category.color} flex items-center justify-center shrink-0`}>
                          <Icon className="h-4.5 w-4.5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-800">{category.label}</span>
                            <Badge variant="outline" className="text-[10px] font-normal">
                              {viewCount}/{category.entities.length} accessible
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{category.description}</p>
                        </div>
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-100">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-50/80">
                                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 w-[280px]">Feature</th>
                                  {ACTION_CONFIG.map(({ action, label, icon: AIcon, color }) => (
                                    <th key={action} className="text-center px-2 py-2 w-[80px]">
                                      <button
                                        className="flex flex-col items-center gap-0.5 mx-auto group"
                                        onClick={() => toggleAllInCategory(category, action)}
                                        title={`Toggle all ${label} in ${category.label}`}
                                      >
                                        <AIcon className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600" />
                                        <span className="text-[10px] font-medium text-gray-400 uppercase group-hover:text-gray-600">{label}</span>
                                      </button>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {category.entities.map((ent, idx) => (
                                  <tr
                                    key={ent.entity}
                                    className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50/30"} hover:bg-blue-50/30 transition-colors`}
                                    data-testid={`entity-row-${selectedRole}-${ent.entity}`}
                                  >
                                    <td className="px-4 py-2.5">
                                      <div>
                                        <span className="text-sm font-medium text-gray-700">{ent.label}</span>
                                        <p className="text-[11px] text-gray-400 leading-tight">{ent.description}</p>
                                      </div>
                                    </td>
                                    {ACTION_CONFIG.map(({ action, color }) => {
                                      const active = getEntityPerm(selectedRole, ent.entity, action);
                                      return (
                                        <td key={action} className="text-center px-2 py-2.5">
                                          <button
                                            className={`h-7 w-14 rounded-md border text-[11px] font-semibold transition-all ${
                                              active
                                                ? `${color} border-transparent text-white shadow-sm`
                                                : "bg-white border-gray-200 text-gray-300 hover:border-gray-300 hover:text-gray-400"
                                            }`}
                                            onClick={() => toggleEntityPerm(selectedRole, ent.entity, action)}
                                            data-testid={`perm-${selectedRole}-${ent.entity}-${action}`}
                                          >
                                            {active ? <Check className="h-3.5 w-3.5 mx-auto" /> : <X className="h-3.5 w-3.5 mx-auto" />}
                                          </button>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>

              {hasChanges && (
                <div className="sticky bottom-4 z-10">
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 flex items-center justify-between shadow-lg">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                      <span className="text-sm font-medium text-amber-800">You have unsaved changes for {currentRole.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-amber-700"
                        onClick={() => setPendingChanges(prev => {
                          const next = { ...prev };
                          delete next[selectedRole];
                          return next;
                        })}
                        data-testid="btn-discard-bottom"
                      >
                        Discard
                      </Button>
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={handleSaveRole}
                        disabled={saving}
                        data-testid="btn-save-bottom"
                      >
                        {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                        Save Changes
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={showCreateRole} onOpenChange={setShowCreateRole}>
        <DialogContent data-testid="dialog-create-role">
          <DialogHeader>
            <DialogTitle>Create New Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="role-key">Role Key</Label>
              <Input
                id="role-key"
                placeholder="e.g. SITE_MANAGER"
                value={newRoleKey}
                onChange={(e) => setNewRoleKey(e.target.value.toUpperCase().replace(/\s+/g, "_"))}
                data-testid="input-new-role-key"
              />
              <p className="text-[10px] text-gray-400 mt-1">Uppercase identifier used internally (auto-formatted)</p>
            </div>
            <div>
              <Label htmlFor="role-label">Display Name</Label>
              <Input
                id="role-label"
                placeholder="e.g. Site Manager"
                value={newRoleLabel}
                onChange={(e) => setNewRoleLabel(e.target.value)}
                data-testid="input-new-role-label"
              />
            </div>
            <div>
              <Label htmlFor="role-desc">Description (optional)</Label>
              <Input
                id="role-desc"
                placeholder="Manages on-site operations"
                value={newRoleDesc}
                onChange={(e) => setNewRoleDesc(e.target.value)}
                data-testid="input-new-role-desc"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreateRole(false)} data-testid="btn-cancel-create-role">Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleCreateRole}
              disabled={creatingRole || !newRoleKey || !newRoleLabel}
              data-testid="btn-confirm-create-role"
            >
              {creatingRole ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProjectDetailTab({ toast, shared }: { toast: ReturnType<typeof useToast>["toast"]; shared: SharedRolesState }) {
  const { roles, loading, pendingChanges, setPendingChanges, loadRoles, getEntityPerm, toggleEntityPerm } = shared;
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (roles.length > 0 && !selectedRole) {
      setSelectedRole(roles[0].role);
    }
  }, [roles, selectedRole]);

  const currentRole = roles.find(r => r.role === selectedRole);
  const hasChanges = !!pendingChanges[selectedRole];

  const handleSaveRole = async () => {
    const changes = pendingChanges[selectedRole];
    if (!changes) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/roles/${selectedRole}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(changes),
      });
      if (res.ok) {
        toast({ title: "Saved", description: `Project detail permissions updated for ${currentRole?.label || selectedRole}.` });
        setPendingChanges(prev => {
          const next = { ...prev };
          delete next[selectedRole];
          return next;
        });
        loadRoles();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to save.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading...</span>
        </CardContent>
      </Card>
    );
  }

  const pdActions: PermissionAction[] = ["view", "edit"];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 px-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1">
              <span className="text-sm font-medium text-gray-600">Editing role:</span>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger className="w-64 h-9" data-testid="select-pd-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map(r => (
                    <SelectItem key={r.role} value={r.role}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {hasChanges && (
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingChanges(prev => {
                    const next = { ...prev };
                    delete next[selectedRole];
                    return next;
                  })}
                  data-testid="btn-pd-discard"
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Discard
                </Button>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={handleSaveRole}
                  disabled={saving}
                  data-testid="btn-pd-save"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Save Changes
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-gray-500 px-1">
        Control what this role can see and edit on individual project detail pages. These permissions apply to all projects the user has access to.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {PROJECT_DETAIL_CATEGORIES.map((category) => {
          const Icon = category.icon;
          const viewCount = category.entities.filter(e => getEntityPerm(selectedRole, e.entity, "view")).length;
          return (
            <Card key={category.key} className="overflow-hidden" data-testid={`pd-category-${category.key}`}>
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50/80 border-b border-gray-100">
                <div className={`h-8 w-8 rounded-lg ${category.color} flex items-center justify-center shrink-0`}>
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1">
                  <span className="text-sm font-semibold text-gray-800">{category.label}</span>
                  <p className="text-[11px] text-gray-400">{category.description}</p>
                </div>
                <Badge variant="outline" className="text-[10px]">{viewCount}/{category.entities.length}</Badge>
              </div>
              <div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 w-auto">Tab / Section</th>
                      {pdActions.map(action => (
                        <th key={action} className="text-center px-2 py-2 w-[70px]">
                          <span className="text-[10px] font-medium text-gray-400 uppercase">{action}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {category.entities.map((ent, idx) => (
                      <tr
                        key={ent.entity}
                        className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50/30"} hover:bg-blue-50/30 transition-colors`}
                        data-testid={`pd-entity-row-${selectedRole}-${ent.entity}`}
                      >
                        <td className="px-4 py-2">
                          <span className="text-sm text-gray-700">{ent.label}</span>
                          <p className="text-[10px] text-gray-400">{ent.description}</p>
                        </td>
                        {pdActions.map(action => {
                          const active = getEntityPerm(selectedRole, ent.entity, action);
                          const actionCfg = ACTION_CONFIG.find(a => a.action === action)!;
                          return (
                            <td key={action} className="text-center px-2 py-2">
                              <button
                                className={`h-7 w-14 rounded-md border text-[11px] font-semibold transition-all ${
                                  active
                                    ? `${actionCfg.color} border-transparent text-white shadow-sm`
                                    : "bg-white border-gray-200 text-gray-300 hover:border-gray-300 hover:text-gray-400"
                                }`}
                                onClick={() => toggleEntityPerm(selectedRole, ent.entity, action)}
                                data-testid={`pd-perm-${selectedRole}-${ent.entity}-${action}`}
                              >
                                {active ? <Check className="h-3.5 w-3.5 mx-auto" /> : <X className="h-3.5 w-3.5 mx-auto" />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>

      {hasChanges && (
        <div className="sticky bottom-4 z-10">
          <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">You have unsaved changes for {currentRole?.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-amber-700"
                onClick={() => setPendingChanges(prev => {
                  const next = { ...prev };
                  delete next[selectedRole];
                  return next;
                })}
              >
                Discard
              </Button>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                onClick={handleSaveRole}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserManagementSection({ toast, shared }: { toast: ReturnType<typeof useToast>["toast"]; shared: SharedRolesState }) {
  const [userList, setUserList] = useState<UserRecord[]>([]);
  const roles = shared.roles;
  const [loading, setLoading] = useState(true);
  const [changingUserId, setChangingUserId] = useState<number | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", name: "", email: "", password: "", role: "PROGRAM_MANAGER" });
  const [creatingUser, setCreatingUser] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserRecord | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<UserRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const loadUsers = useCallback(async () => {
    try {
      const usersRes = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      if (usersRes.ok) setUserList(await usersRes.json());
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleChangeRole = async (userId: number, newRole: string) => {
    setChangingUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        toast({ title: "Role Updated", description: `User role changed to ${newRole}.` });
        loadUsers();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to change role.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to change user role.", variant: "destructive" });
    } finally {
      setChangingUserId(null);
    }
  };

  const handleCreateUser = async () => {
    if (!newUser.username || !newUser.name || !newUser.email || !newUser.password) {
      toast({ title: "Error", description: "All fields are required.", variant: "destructive" });
      return;
    }
    setCreatingUser(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(newUser),
      });
      if (res.ok) {
        toast({ title: "User Created", description: `${newUser.name} has been created.` });
        setShowCreateUser(false);
        setNewUser({ username: "", name: "", email: "", password: "", role: "PROGRAM_MANAGER" });
        loadUsers();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to create user.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to create user.", variant: "destructive" });
    } finally {
      setCreatingUser(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !resetPassword) return;
    if (resetPassword.length < 4) {
      toast({ title: "Error", description: "Password must be at least 4 characters.", variant: "destructive" });
      return;
    }
    setResettingPassword(true);
    try {
      const res = await fetch(`/api/admin/users/${resetPasswordUser.id}/password`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      if (res.ok) {
        toast({ title: "Password Updated", description: `Password has been reset for ${resetPasswordUser.name}.` });
        setResetPasswordUser(null);
        setResetPassword("");
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to reset password.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to reset password.", variant: "destructive" });
    } finally {
      setResettingPassword(false);
    }
  };

  const handleDeleteUser = async (userId: number) => {
    setDeletingUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        toast({ title: "User Deleted", description: "User has been removed." });
        loadUsers();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to delete user.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete user.", variant: "destructive" });
    } finally {
      setDeletingUserId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    if (!searchTerm) return userList;
    const term = searchTerm.toLowerCase();
    return userList.filter(u =>
      u.name.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term) ||
      u.role.toLowerCase().includes(term)
    );
  }, [userList, searchTerm]);

  if (loading) {
    return (
      <Card data-testid="card-users-loading">
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading users...</span>
        </CardContent>
      </Card>
    );
  }

  const roleColorMap: Record<string, string> = {
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

  return (
    <>
      <Card data-testid="card-user-management">
        <CardHeader className="flex flex-row items-center justify-between py-4 px-5">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-green-600" />
              User Management
            </CardTitle>
            <p className="text-xs text-gray-400 mt-0.5">{userList.length} users registered</p>
          </div>
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700"
            onClick={() => setShowCreateUser(true)}
            data-testid="btn-create-user"
          >
            <UserPlus className="h-4 w-4 mr-1" /> New User
          </Button>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="mb-4">
            <Input
              placeholder="Search users by name, email, or role..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9"
              data-testid="input-search-users"
            />
          </div>
          {filteredUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-users">No users found.</p>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((user) => {
                const roleObj = roles.find(r => r.role === user.role);
                const roleLabel = roleObj?.label || COMPANY_ROLE_LABELS[user.role as CompanyRole] || user.role;
                const roleColor = roleColorMap[user.role] || "bg-gray-100 text-gray-700 border-gray-200";
                return (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50/80 hover:border-gray-200 transition-all"
                    data-testid={`user-row-${user.id}`}
                  >
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-green-100 to-emerald-200 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-green-700">
                        {user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800" data-testid={`text-user-name-${user.id}`}>
                          {user.name}
                        </span>
                        <span className="text-xs text-gray-400 truncate">{user.email}</span>
                      </div>
                      <Badge className={`text-[10px] mt-0.5 border ${roleColor}`} variant="outline" data-testid={`text-user-role-${user.id}`}>
                        {roleLabel}
                      </Badge>
                    </div>

                    <Select
                      value={user.role}
                      onValueChange={(val) => handleChangeRole(user.id, val)}
                      disabled={changingUserId === user.id}
                    >
                      <SelectTrigger className="w-48 h-8 text-xs" data-testid={`select-role-${user.id}`}>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r.role} value={r.role} data-testid={`option-role-${user.id}-${r.role}`}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 shrink-0"
                      onClick={() => { setResetPasswordUser(user); setResetPassword(""); }}
                      title="Reset password"
                      data-testid={`btn-reset-password-${user.id}`}
                    >
                      <KeyRound className="h-4 w-4 text-blue-500" />
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 shrink-0"
                      onClick={() => setConfirmDeleteUser(user)}
                      disabled={deletingUserId === user.id}
                      title="Delete user"
                      data-testid={`btn-delete-user-${user.id}`}
                    >
                      {deletingUserId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-400" />}
                    </Button>

                    {changingUserId === user.id && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateUser} onOpenChange={setShowCreateUser}>
        <DialogContent data-testid="dialog-create-user">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="user-username">Username</Label>
              <Input
                id="user-username"
                placeholder="johndoe"
                value={newUser.username}
                onChange={(e) => setNewUser(prev => ({ ...prev, username: e.target.value }))}
                data-testid="input-new-user-username"
              />
            </div>
            <div>
              <Label htmlFor="user-name">Full Name</Label>
              <Input
                id="user-name"
                placeholder="John Doe"
                value={newUser.name}
                onChange={(e) => setNewUser(prev => ({ ...prev, name: e.target.value }))}
                data-testid="input-new-user-name"
              />
            </div>
            <div>
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                placeholder="john@example.com"
                value={newUser.email}
                onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                data-testid="input-new-user-email"
              />
            </div>
            <div>
              <Label htmlFor="user-password">Password</Label>
              <Input
                id="user-password"
                type="password"
                placeholder="Enter password"
                value={newUser.password}
                onChange={(e) => setNewUser(prev => ({ ...prev, password: e.target.value }))}
                data-testid="input-new-user-password"
              />
            </div>
            <div>
              <Label htmlFor="user-role">Role</Label>
              <Select value={newUser.role} onValueChange={(val) => setNewUser(prev => ({ ...prev, role: val }))}>
                <SelectTrigger className="h-9" data-testid="select-new-user-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.role} value={r.role}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreateUser(false)} data-testid="btn-cancel-create-user">Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleCreateUser}
              disabled={creatingUser || !newUser.username || !newUser.name || !newUser.email || !newUser.password}
              data-testid="btn-confirm-create-user"
            >
              {creatingUser ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />}
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetPasswordUser} onOpenChange={(open) => { if (!open) { setResetPasswordUser(null); setResetPassword(""); } }}>
        <DialogContent data-testid="dialog-reset-password">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Reset Password
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Set a new password for <strong>{resetPasswordUser?.name}</strong> ({resetPasswordUser?.email})
          </p>
          <div>
            <Label htmlFor="reset-password">New Password</Label>
            <Input
              id="reset-password"
              type="password"
              placeholder="Enter new password (min 4 characters)"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              data-testid="input-reset-password"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setResetPasswordUser(null); setResetPassword(""); }} data-testid="btn-cancel-reset-password">Cancel</Button>
            <Button
              onClick={handleResetPassword}
              disabled={resettingPassword || resetPassword.length < 4}
              data-testid="btn-confirm-reset-password"
            >
              {resettingPassword ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1" />}
              Update Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDeleteUser} onOpenChange={(open) => { if (!open) setConfirmDeleteUser(null); }}>
        <DialogContent data-testid="dialog-confirm-delete-user">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Remove User
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to remove <strong>{confirmDeleteUser?.name}</strong> ({confirmDeleteUser?.email})?
            This will permanently delete their account and they will no longer be able to log in.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDeleteUser(null)} data-testid="btn-cancel-delete-user">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDeleteUser) {
                  handleDeleteUser(confirmDeleteUser.id);
                  setConfirmDeleteUser(null);
                }
              }}
              disabled={deletingUserId !== null}
              data-testid="btn-confirm-delete-user"
            >
              {deletingUserId !== null ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Remove User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
