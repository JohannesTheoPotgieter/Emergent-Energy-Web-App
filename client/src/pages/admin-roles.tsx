import { useState, useEffect, useCallback } from "react";
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
import {
  Loader2,
  Save,
  Shield,
  Users,
  AlertTriangle,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  UserPlus,
  KeyRound,
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

const SECTION_CONFIG: {
  key: string;
  label: string;
  description: string;
  icon: string;
  entities: { entity: PermissionEntity; entityLabel: string }[];
}[] = [
  {
    key: "COCKPIT",
    label: "EXCO",
    description: "My Tool, Company Priorities, Lifecycle Dashboard",
    icon: "📊",
    entities: [
      { entity: "my_tool" as PermissionEntity, entityLabel: "My Tool" },
      { entity: "lifecycle" as PermissionEntity, entityLabel: "Lifecycle Board" },
    ],
  },
  {
    key: "PROJECTS",
    label: "Project Management",
    description: "Execution Board, Project Summary, TR Register, Smart Import, Create Project",
    icon: "📋",
    entities: [
      { entity: "projects" as PermissionEntity, entityLabel: "Projects" },
      { entity: "pm_dashboard" as PermissionEntity, entityLabel: "PM Dashboard" },
      { entity: "smart_import" as PermissionEntity, entityLabel: "Smart Import" },
      { entity: "tr_register" as PermissionEntity, entityLabel: "TR Register" },
      { entity: "create_project" as PermissionEntity, entityLabel: "Create Project" },
    ],
  },
  {
    key: "MONEY",
    label: "Project Finance",
    description: "Cashflow, COS Tracker, Procurement",
    icon: "💰",
    entities: [
      { entity: "financials" as PermissionEntity, entityLabel: "Financials" },
      { entity: "cos" as PermissionEntity, entityLabel: "COS Tracker" },
      { entity: "cashflow" as PermissionEntity, entityLabel: "Cashflow" },
      { entity: "procurement" as PermissionEntity, entityLabel: "Procurement" },
    ],
  },
  {
    key: "DELIVERY",
    label: "Engineering",
    description: "Engineering Dashboard, Task Board, Stage Checklists",
    icon: "🔧",
    entities: [
      { entity: "engineering" as PermissionEntity, entityLabel: "Engineering" },
      { entity: "eng_tasks" as PermissionEntity, entityLabel: "Task Board" },
      { entity: "eng_stages" as PermissionEntity, entityLabel: "Stage Checklists" },
    ],
  },
  {
    key: "GOVERNANCE",
    label: "Governance",
    description: "Quality Dashboard, Weekly Reviews",
    icon: "🛡️",
    entities: [
      { entity: "quality" as PermissionEntity, entityLabel: "Quality" },
      { entity: "governance" as PermissionEntity, entityLabel: "Governance" },
      { entity: "weekly_reviews" as PermissionEntity, entityLabel: "Weekly Reviews" },
    ],
  },
  {
    key: "INFORMATION",
    label: "Information",
    description: "Feedback & Support, Emergent Energy Info",
    icon: "📖",
    entities: [
      { entity: "ee_info" as PermissionEntity, entityLabel: "EE Info & Walkthroughs" },
    ],
  },
  {
    key: "ADMIN",
    label: "Admin",
    description: "Settings, Roles & Permissions",
    icon: "⚙️",
    entities: [
      { entity: "admin" as PermissionEntity, entityLabel: "Admin" },
    ],
  },
];

const PROJECT_DETAIL_TAB_CONFIG: {
  group: string;
  groupLabel: string;
  icon: string;
  items: { entity: PermissionEntity; label: string }[];
}[] = [
  {
    group: "overview_section",
    groupLabel: "Overview (Landing Page)",
    icon: "📊",
    items: [
      { entity: "pd_overview" as PermissionEntity, label: "Tasks (Grid / Board / Calendar)" },
      { entity: "pd_engineering" as PermissionEntity, label: "Engineering Pillar Card" },
      { entity: "pd_quality" as PermissionEntity, label: "Quality Pillar Card" },
    ],
  },
  {
    group: "pm_section",
    groupLabel: "Project Management Section",
    icon: "📋",
    items: [
      { entity: "pd_plan" as PermissionEntity, label: "Plan (Gantt / Key Dates)" },
      { entity: "pd_finance" as PermissionEntity, label: "Finance (Revenue / Expenditure / COS / Cashflow)" },
      { entity: "pd_history" as PermissionEntity, label: "History / Weekly Reviews" },
    ],
  },
  {
    group: "plan_subtabs",
    groupLabel: "Plan Sub-tabs",
    icon: "📅",
    items: [
      { entity: "pd_gantt" as PermissionEntity, label: "Gantt Chart" },
      { entity: "pd_key_dates" as PermissionEntity, label: "Key Dates" },
    ],
  },
  {
    group: "finance_subtabs",
    groupLabel: "Finance Sub-tabs",
    icon: "💵",
    items: [
      { entity: "pd_revenue" as PermissionEntity, label: "Revenue" },
      { entity: "pd_expenditure" as PermissionEntity, label: "Expenditure" },
      { entity: "pd_cos_tracker" as PermissionEntity, label: "COS Tracker" },
      { entity: "pd_cashflow" as PermissionEntity, label: "Cashflow" },
      { entity: "pd_subcontractors" as PermissionEntity, label: "Subcontractors" },
    ],
  },
  {
    group: "engineering_section",
    groupLabel: "Engineering Section",
    icon: "🔩",
    items: [
      { entity: "pd_eng_tasks" as PermissionEntity, label: "Engineering Tasks" },
      { entity: "pd_eng_stages" as PermissionEntity, label: "Engineering Stages" },
    ],
  },
  {
    group: "quality_section",
    groupLabel: "Quality Section",
    icon: "🛡️",
    items: [
      { entity: "pd_quality" as PermissionEntity, label: "Quality Checklist" },
    ],
  },
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

export default function AdminRolesPage() {
  const { toast } = useToast();
  const companyRole = localStorage.getItem("company_role");

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
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900" data-testid="text-page-title">
          Roles & Permissions
        </h1>
        <p className="text-sm text-gray-500 mt-1">Manage role permissions, section access, and user assignments</p>
      </header>

      <RoleTableSection toast={toast} />
      <UserManagementSection toast={toast} />
    </div>
  );
}

function RoleTableSection({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [roles, setRoles] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, Partial<RolePermission>>>({});
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleKey, setNewRoleKey] = useState("");
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = useState("");
  const [deletingRole, setDeletingRole] = useState<string | null>(null);

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

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const toggleSection = (roleKey: string, section: string) => {
    const role = roles.find(r => r.role === roleKey);
    if (!role) return;
    const validKeys = new Set(ALL_SECTIONS as readonly string[]);
    const raw = (pendingChanges[roleKey]?.sections as string[] | undefined) || (role.sections as string[]) || [];
    const current = raw.filter(s => validKeys.has(s));
    const next = current.includes(section)
      ? current.filter(s => s !== section)
      : [...current, section];
    setPendingChanges(prev => ({
      ...prev,
      [roleKey]: { ...prev[roleKey], sections: next },
    }));
  };

  const toggleCapability = (roleKey: string, field: "canManageUsers" | "canManageRoles" | "canEditData") => {
    const role = roles.find(r => r.role === roleKey);
    if (!role) return;
    const currentVal = pendingChanges[roleKey]?.[field] ?? role[field];
    setPendingChanges(prev => ({
      ...prev,
      [roleKey]: { ...prev[roleKey], [field]: !currentVal },
    }));
  };

  const getEntityPerm = (roleKey: string, entity: PermissionEntity, action: PermissionAction): boolean => {
    const changes = pendingChanges[roleKey]?.entityPermissions as Record<string, Record<string, boolean>> | undefined;
    if (changes?.[entity]?.[action] !== undefined) return changes[entity][action];
    const role = roles.find(r => r.role === roleKey);
    const stored = role?.entityPermissions as Record<string, Record<string, boolean>> | null;
    if (stored?.[entity]?.[action] !== undefined) return stored[entity][action];
    const defaults = ENTITY_PERMISSION_DEFAULTS.find(r => r.entity === entity);
    if (!defaults) return false;
    const key = `${action}_roles` as keyof typeof defaults;
    return ((defaults[key] as string[]) || []).includes(roleKey);
  };

  const toggleEntityPerm = (roleKey: string, entity: PermissionEntity, action: PermissionAction) => {
    const current = getEntityPerm(roleKey, entity, action);
    const role = roles.find(r => r.role === roleKey);
    const storedEp = (role?.entityPermissions || {}) as Record<string, Record<string, boolean>>;
    const pendingEp = (pendingChanges[roleKey]?.entityPermissions || storedEp) as Record<string, Record<string, boolean>>;
    const updated = { ...pendingEp, [entity]: { ...(pendingEp[entity] || {}), [action]: !current } };
    setPendingChanges(prev => ({
      ...prev,
      [roleKey]: { ...prev[roleKey], entityPermissions: updated as any },
    }));
  };

  const handleSaveRole = async (roleKey: string) => {
    const changes = pendingChanges[roleKey];
    if (!changes) return;
    setSaving(roleKey);
    try {
      const res = await fetch(`/api/roles/${roleKey}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(changes),
      });
      if (res.ok) {
        toast({ title: "Saved", description: `Permissions updated for ${roleKey}.` });
        setPendingChanges(prev => {
          const next = { ...prev };
          delete next[roleKey];
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
      setSaving(null);
    }
  };

  const handleDiscardChanges = (roleKey: string) => {
    setPendingChanges(prev => {
      const next = { ...prev };
      delete next[roleKey];
      return next;
    });
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

  const handleRenameRole = async (roleKey: string) => {
    if (!editLabelValue.trim()) return;
    setSaving(roleKey);
    try {
      const res = await fetch(`/api/roles/${roleKey}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ label: editLabelValue.trim() }),
      });
      if (res.ok) {
        toast({ title: "Renamed", description: `Role renamed to "${editLabelValue.trim()}".` });
        setEditingLabel(null);
        loadRoles();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to rename.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to rename role.", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleDeleteRole = async (roleKey: string) => {
    setDeletingRole(roleKey);
    try {
      const res = await fetch(`/api/roles/${roleKey}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        toast({ title: "Deleted", description: `Role "${roleKey}" has been deleted.` });
        loadRoles();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to delete role.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete role.", variant: "destructive" });
    } finally {
      setDeletingRole(null);
    }
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

  return (
    <>
    <Card data-testid="card-role-table">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-600" />
          Role Permissions
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700"
            onClick={() => setShowCreateRole(true)}
            data-testid="btn-create-role"
          >
            <Plus className="h-4 w-4 mr-1" /> New Role
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setLoading(true); loadRoles(); }}
            data-testid="btn-refresh-roles"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {roles.map((role) => {
          const isExpanded = expandedRole === role.role;
          const changes = pendingChanges[role.role];
          const hasChanges = !!changes;
          const rawSections = (changes?.sections as string[] | undefined) || (role.sections as string[]) || [];
          const validSectionKeys = new Set(ALL_SECTIONS as readonly string[]);
          const effectiveSections = rawSections.filter(s => validSectionKeys.has(s));
          const effectiveCanManageUsers = changes?.canManageUsers ?? role.canManageUsers;
          const effectiveCanManageRoles = changes?.canManageRoles ?? role.canManageRoles;
          const effectiveCanEditData = changes?.canEditData ?? role.canEditData;

          return (
            <div
              key={role.role}
              className={`border rounded-lg transition-colors ${hasChanges ? "border-amber-300 bg-amber-50/30" : "border-gray-200"}`}
              data-testid={`role-row-${role.role}`}
            >
              <div className="flex items-center gap-1 p-3">
                <button
                  className="flex-1 flex items-center gap-3 text-left hover:bg-gray-50/50 transition-colors rounded"
                  onClick={() => setExpandedRole(isExpanded ? null : role.role)}
                  data-testid={`btn-expand-role-${role.role}`}
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {editingLabel === role.role ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={editLabelValue}
                            onChange={(e) => setEditLabelValue(e.target.value)}
                            className="h-7 w-40 text-sm"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") handleRenameRole(role.role); if (e.key === "Escape") setEditingLabel(null); }}
                            data-testid={`input-rename-role-${role.role}`}
                          />
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); handleRenameRole(role.role); }}>
                            <Check className="h-3 w-3 text-green-600" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); setEditingLabel(null); }}>
                            <X className="h-3 w-3 text-gray-400" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-gray-800" data-testid={`text-role-name-${role.role}`}>
                            {role.label}
                          </span>
                          <span className="text-xs text-gray-400 font-mono">{role.role}</span>
                          {role.isSystem && <Badge variant="outline" className="text-[10px] py-0 px-1.5">System</Badge>}
                          {hasChanges && <Badge className="text-[10px] py-0 px-1.5 bg-amber-500">Unsaved</Badge>}
                        </>
                      )}
                    </div>
                    {role.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{role.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{effectiveSections.length} of {ALL_SECTIONS.length} sections</Badge>
                  </div>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={(e) => { e.stopPropagation(); setEditingLabel(role.role); setEditLabelValue(role.label); }}
                    title="Rename role"
                    data-testid={`btn-rename-role-${role.role}`}
                  >
                    <Pencil className="h-3 w-3 text-gray-400" />
                  </Button>
                  {!role.isSystem && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={(e) => { e.stopPropagation(); handleDeleteRole(role.role); }}
                      disabled={deletingRole === role.role}
                      title="Delete role"
                      data-testid={`btn-delete-role-${role.role}`}
                    >
                      {deletingRole === role.role ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3 text-red-400" />}
                    </Button>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="px-3 pb-3 space-y-4 border-t border-gray-100 pt-3" data-testid={`role-details-${role.role}`}>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Sidebar Sections — What this role can see</h4>
                    <div className="grid grid-cols-1 gap-2">
                      {SECTION_CONFIG.map(({ key, label, description, icon, entities }) => {
                        const isActive = effectiveSections.includes(key);
                        return (
                          <div
                            key={key}
                            className={`rounded-lg border transition-all ${
                              isActive
                                ? "border-green-200 bg-green-50/50"
                                : "border-gray-100 bg-gray-50/30 opacity-60"
                            }`}
                            data-testid={`section-card-${role.role}-${key}`}
                          >
                            <div className="flex items-center gap-3 px-3 py-2.5">
                              <Switch
                                checked={isActive}
                                onCheckedChange={() => toggleSection(role.role, key)}
                                data-testid={`badge-section-${role.role}-${key}`}
                              />
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-base">{icon}</span>
                                <div>
                                  <span className="text-sm font-medium text-gray-800">{label}</span>
                                  <p className="text-[11px] text-gray-500 leading-tight">{description}</p>
                                </div>
                              </div>
                              {isActive && entities.length > 0 && (
                                <div className="flex gap-0.5 shrink-0">
                                  {(["view", "edit", "approve", "override", "delete"] as PermissionAction[]).map(action => (
                                    <span key={action} className="text-[9px] text-gray-400 font-medium uppercase w-11 text-center">{action}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {isActive && entities.length > 0 && (
                              <div className="px-3 pb-2.5 pt-0">
                                <div className="ml-12 space-y-1">
                                  {entities.map(({ entity, entityLabel }) => (
                                    <div key={entity} className="flex items-center justify-between" data-testid={`entity-row-${role.role}-${entity}`}>
                                      <span className="text-xs text-gray-600">{entityLabel}</span>
                                      <div className="flex gap-0.5">
                                        {(["view", "edit", "approve", "override", "delete"] as PermissionAction[]).map(action => {
                                          const active = getEntityPerm(role.role, entity, action);
                                          return (
                                            <button
                                              key={action}
                                              className={`w-11 h-6 rounded border text-[10px] font-medium transition-colors ${
                                                active
                                                  ? "bg-green-600 border-green-600 text-white"
                                                  : "bg-white border-gray-200 text-gray-300 hover:border-gray-400 hover:text-gray-400"
                                              }`}
                                              onClick={() => toggleEntityPerm(role.role, entity, action)}
                                              data-testid={`entity-perm-${role.role}-${entity}-${action}`}
                                            >
                                              {active ? "Yes" : "No"}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Project Detail Sections — What this role sees on each project</h4>
                    <div className="grid grid-cols-1 gap-2">
                      {PROJECT_DETAIL_TAB_CONFIG.map(({ group, groupLabel, icon, items }) => (
                        <div key={group} className="rounded-lg border border-gray-100 bg-gray-50/30" data-testid={`pd-group-${role.role}-${group}`}>
                          <div className="flex items-center gap-3 px-3 py-2">
                            <span className="text-base">{icon}</span>
                            <span className="text-sm font-medium text-gray-700 flex-1">{groupLabel}</span>
                            <div className="flex gap-0.5 shrink-0">
                              {(["view", "edit"] as PermissionAction[]).map(action => (
                                <span key={action} className="text-[9px] text-gray-400 font-medium uppercase w-11 text-center">{action}</span>
                              ))}
                            </div>
                          </div>
                          <div className="px-3 pb-2.5 pt-0">
                            <div className="ml-9 space-y-1">
                              {items.map(({ entity, label }) => (
                                <div key={entity} className="flex items-center justify-between" data-testid={`pd-entity-row-${role.role}-${entity}`}>
                                  <span className="text-xs text-gray-600">{label}</span>
                                  <div className="flex gap-0.5">
                                    {(["view", "edit"] as PermissionAction[]).map(action => {
                                      const active = getEntityPerm(role.role, entity, action);
                                      return (
                                        <button
                                          key={action}
                                          className={`w-11 h-6 rounded border text-[10px] font-medium transition-colors ${
                                            active
                                              ? "bg-green-600 border-green-600 text-white"
                                              : "bg-white border-gray-200 text-gray-300 hover:border-gray-400 hover:text-gray-400"
                                          }`}
                                          onClick={() => toggleEntityPerm(role.role, entity, action)}
                                          data-testid={`pd-perm-${role.role}-${entity}-${action}`}
                                        >
                                          {active ? "Yes" : "No"}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Special Capabilities</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <label
                        className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer"
                        data-testid={`toggle-canManageUsers-${role.role}`}
                      >
                        <div>
                          <span className="text-sm text-gray-700 font-medium block">Manage Users</span>
                          <span className="text-[11px] text-gray-400">Create, edit, delete user accounts</span>
                        </div>
                        <Switch
                          checked={!!effectiveCanManageUsers}
                          onCheckedChange={() => toggleCapability(role.role, "canManageUsers")}
                        />
                      </label>
                      <label
                        className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer"
                        data-testid={`toggle-canManageRoles-${role.role}`}
                      >
                        <div>
                          <span className="text-sm text-gray-700 font-medium block">Manage Roles</span>
                          <span className="text-[11px] text-gray-400">Create, edit role permissions</span>
                        </div>
                        <Switch
                          checked={!!effectiveCanManageRoles}
                          onCheckedChange={() => toggleCapability(role.role, "canManageRoles")}
                        />
                      </label>
                      <label
                        className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer"
                        data-testid={`toggle-canEditData-${role.role}`}
                      >
                        <div>
                          <span className="text-sm text-gray-700 font-medium block">Edit Data</span>
                          <span className="text-[11px] text-gray-400">Inline editing of project data</span>
                        </div>
                        <Switch
                          checked={!!effectiveCanEditData}
                          onCheckedChange={() => toggleCapability(role.role, "canEditData")}
                        />
                      </label>
                    </div>
                  </div>

                  {hasChanges && (
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => handleSaveRole(role.role)}
                        disabled={saving === role.role}
                        data-testid={`btn-save-role-${role.role}`}
                      >
                        {saving === role.role ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                        Save Changes
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDiscardChanges(role.role)}
                        data-testid={`btn-discard-role-${role.role}`}
                      >
                        <X className="h-3 w-3 mr-1" /> Discard
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>

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

function UserManagementSection({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [userList, setUserList] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RolePermission[]>([]);
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

  const loadData = useCallback(async () => {
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetch("/api/admin/users", { headers: getAuthHeaders() }),
        fetch("/api/roles", { headers: getAuthHeaders() }),
      ]);
      if (usersRes.ok) setUserList(await usersRes.json());
      if (rolesRes.ok) setRoles(await rolesRes.json());
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
        loadData();
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
        loadData();
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
        loadData();
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

  return (
    <>
    <Card data-testid="card-user-management">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-green-600" />
          User Management
        </CardTitle>
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700"
          onClick={() => setShowCreateUser(true)}
          data-testid="btn-create-user"
        >
          <UserPlus className="h-4 w-4 mr-1" /> New User
        </Button>
      </CardHeader>
      <CardContent>
        {userList.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-users">No users found.</p>
        ) : (
          <div className="space-y-2">
            {userList.map((user) => {
              const roleObj = roles.find(r => r.role === user.role);
              const roleLabel = roleObj?.label || COMPANY_ROLE_LABELS[user.role as CompanyRole] || user.role;
              return (
                <div
                  key={user.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                  data-testid={`user-row-${user.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800" data-testid={`text-user-name-${user.id}`}>
                        {user.name}
                      </span>
                      <span className="text-xs text-gray-400">{user.email}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className="text-[10px]" data-testid={`text-user-role-${user.id}`}>
                        {roleLabel}
                      </Badge>
                    </div>
                  </div>

                  <Select
                    value={user.role}
                    onValueChange={(val) => handleChangeRole(user.id, val)}
                    disabled={changingUserId === user.id}
                  >
                    <SelectTrigger
                      className="w-48 h-8 text-xs"
                      data-testid={`select-role-${user.id}`}
                    >
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
