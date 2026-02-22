import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Loader2, Shield, ShieldCheck, Wrench, Eye, Crown, Briefcase,
  DollarSign, HardHat, Calculator, Key, UserCog, Plus, Pencil, Trash2,
  Lock, ChevronDown, ChevronRight, LayoutDashboard, FileSpreadsheet,
  Wallet, TrendingUp, Settings, ListTodo, Layers, FolderPlus, History,
  Upload, Flag, Monitor, PenLine, SlidersHorizontal,
} from "lucide-react";

async function adminFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

interface UserInfo {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface RolePermission {
  id: number;
  role: string;
  label: string;
  description: string | null;
  sections: string[];
  canManageUsers: boolean;
  canManageRoles: boolean;
  canEditData: boolean;
  isSystem: boolean;
}

const ALL_SECTIONS = ["EXCO", "PROJECT_MANAGEMENT", "ENGINEERING", "QUALITY", "ADMIN", "MY_TOOL", "FINANCE"];

const SECTION_LABELS: Record<string, string> = {
  EXCO: "Executive",
  PROJECT_MANAGEMENT: "Projects",
  ENGINEERING: "Engineering",
  QUALITY: "Quality",
  ADMIN: "Admin",
  MY_TOOL: "My Tool",
  FINANCE: "Finance",
};

const SECTION_COLORS: Record<string, string> = {
  EXCO: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  PROJECT_MANAGEMENT: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  ENGINEERING: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
  QUALITY: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  ADMIN: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  MY_TOOL: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  FINANCE: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
};

interface ScreenDef {
  label: string;
  icon: any;
  path: string;
}

const SECTION_SCREENS: Record<string, ScreenDef[]> = {
  EXCO: [
    { label: "Lifecycle Board", icon: Layers, path: "/lifecycle-board" },
    { label: "Company Priorities", icon: Flag, path: "/company-priorities" },
    { label: "Planning Board", icon: LayoutDashboard, path: "/planning" },
    { label: "Risks & Flags", icon: Flag, path: "/risks-flags" },
  ],
  PROJECT_MANAGEMENT: [
    { label: "Execution Dashboard", icon: LayoutDashboard, path: "/dashboard" },
    { label: "Project Summary", icon: FileSpreadsheet, path: "/projects" },
    { label: "Project Detail", icon: FileSpreadsheet, path: "/project/:projectName" },
  ],
  ENGINEERING: [
    { label: "Eng Dashboard", icon: Wrench, path: "/engineering" },
    { label: "Task Board", icon: ListTodo, path: "/engineering/tasks" },
    { label: "Deliverables", icon: FileSpreadsheet, path: "/engineering/deliverables" },
  ],
  QUALITY: [
    { label: "Quality Dashboard", icon: ShieldCheck, path: "/quality" },
  ],
  ADMIN: [
    { label: "Settings", icon: Settings, path: "/admin/settings" },
    { label: "Phase Templates", icon: Layers, path: "/admin/phase-templates" },
    { label: "New Project", icon: FolderPlus, path: "/project-create" },
    { label: "Audit Log", icon: History, path: "/admin/audit-log" },
    { label: "Teams & Roles", icon: Users, path: "/admin/teams" },
    { label: "Data Import", icon: Upload, path: "/admin" },
    { label: "Writeback Manager", icon: Upload, path: "/writeback-admin" },
  ],
  MY_TOOL: [
    { label: "My Tool — Today", icon: Briefcase, path: "/my-tool" },
    { label: "My Tool — Week", icon: Briefcase, path: "/my-tool/week" },
    { label: "My Tool — Backlog", icon: Briefcase, path: "/my-tool/backlog" },
    { label: "My Tool — Cockpit", icon: Briefcase, path: "/my-tool/cockpit" },
    { label: "Triage Inbox", icon: Briefcase, path: "/my-tool/triage-inbox" },
    { label: "My Tool — Settings", icon: Settings, path: "/my-tool/settings" },
  ],
  FINANCE: [
    { label: "Cashflow", icon: Wallet, path: "/cashflow" },
    { label: "Cashflow Forecast", icon: Wallet, path: "/cashflow-forecast" },
    { label: "COS Tracker", icon: TrendingUp, path: "/cos" },
    { label: "COS Control Tower", icon: TrendingUp, path: "/cos-control" },
    { label: "Revenue Tracker", icon: TrendingUp, path: "/revenue" },
  ],
};

const ROLE_ICONS: Record<string, any> = {
  COO_ADMIN: Crown,
  CEO_ADMIN: Crown,
  CCO: Briefcase,
  CFO: DollarSign,
  PROGRAM_MANAGER: UserCog,
  PROGRAM_FINANCE_MANAGER: Calculator,
  CONSTRUCTION_MANAGER: HardHat,
  QUALITY_MANAGER: ShieldCheck,
  ENGINEERING_MANAGER: Wrench,
  KEY_ACCOUNTS_MANAGER: Key,
  VIEWER: Eye,
};

const ROLE_COLORS: Record<string, string> = {
  COO_ADMIN: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  CEO_ADMIN: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  CCO: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400",
  CFO: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  PROGRAM_MANAGER: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  PROGRAM_FINANCE_MANAGER: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
  CONSTRUCTION_MANAGER: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400",
  QUALITY_MANAGER: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  ENGINEERING_MANAGER: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
  KEY_ACCOUNTS_MANAGER: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400",
  VIEWER: "bg-slate-100 text-slate-700 dark:bg-slate-950/40 dark:text-slate-400",
};

function getRoleIcon(role: string) {
  return ROLE_ICONS[role] || Shield;
}

function getRoleColor(role: string) {
  return ROLE_COLORS[role] || "bg-slate-100 text-slate-700 dark:bg-slate-950/40 dark:text-slate-400";
}

function getAccessibleScreens(sections: string[]): { section: string; screens: ScreenDef[] }[] {
  const seen = new Set<string>();
  const result: { section: string; screens: ScreenDef[] }[] = [];
  for (const s of sections) {
    const screens = (SECTION_SCREENS[s] || []).filter(sc => {
      if (seen.has(sc.path)) return false;
      seen.add(sc.path);
      return true;
    });
    if (screens.length > 0) {
      result.push({ section: s, screens });
    }
  }
  return result;
}

export default function EngineeringTeamsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingRole, setEditingRole] = useState<RolePermission | null>(null);
  const [showAddRole, setShowAddRole] = useState(false);
  const [newRole, setNewRole] = useState({ role: "", label: "", description: "", sections: [] as string[], canManageUsers: false, canManageRoles: false, canEditData: true });

  const { data: users = [], isLoading: usersLoading } = useQuery<UserInfo[]>({
    queryKey: ["admin-users"],
    queryFn: () => adminFetch("/api/admin/users"),
  });

  const { data: roles = [], isLoading: rolesLoading } = useQuery<RolePermission[]>({
    queryKey: ["roles"],
    queryFn: () => adminFetch("/api/roles"),
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) =>
      adminFetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setEditingUserId(null);
      toast({ title: "Role updated", description: "User role has been changed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateRolePermMutation = useMutation({
    mutationFn: (data: Partial<RolePermission> & { role: string }) =>
      adminFetch(`/api/roles/${data.role}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setEditingRole(null);
      toast({ title: "Role updated", description: "Permissions saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createRoleMutation = useMutation({
    mutationFn: (data: typeof newRole) =>
      adminFetch("/api/roles", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setShowAddRole(false);
      setNewRole({ role: "", label: "", description: "", sections: [], canManageUsers: false, canManageRoles: false, canEditData: true });
      toast({ title: "Role created", description: "New role has been added." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (role: string) =>
      adminFetch(`/api/roles/${role}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast({ title: "Role deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isLoading = usersLoading || rolesLoading;

  const sortedUsers = [...users].sort((a, b) => {
    const roleOrder = ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER", "CONSTRUCTION_MANAGER", "QUALITY_MANAGER", "ENGINEERING_MANAGER", "KEY_ACCOUNTS_MANAGER", "VIEWER"];
    return (roleOrder.indexOf(a.role) === -1 ? 99 : roleOrder.indexOf(a.role)) - (roleOrder.indexOf(b.role) === -1 ? 99 : roleOrder.indexOf(b.role));
  });

  return (
    <div data-testid="admin-teams-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8 text-blue-500" />
          <div>
            <h2 className="text-lg sm:text-xl md:text-2xl font-heading font-bold" data-testid="text-teams-title">Teams & Roles</h2>
            <p className="text-sm text-muted-foreground">Manage users, permissions, and screen access</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowAddRole(true)} data-testid="btn-add-role">
          <Plus className="h-4 w-4 mr-1" /> Add Role
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {sortedUsers.map(user => {
            const rolePerm = roles.find(r => r.role === user.role);
            const Icon = getRoleIcon(user.role);
            const isExpanded = expandedUserId === user.id;
            const isEditing = editingUserId === user.id;
            const accessibleScreens = getAccessibleScreens(rolePerm?.sections || []);
            const totalScreens = accessibleScreens.reduce((sum, s) => sum + s.screens.length, 0);

            return (
              <Card key={user.id} className="border overflow-hidden" data-testid={`card-user-${user.id}`}>
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                >
                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`} />
                  <div className={`p-2 rounded-lg ${getRoleColor(user.role)}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm" data-testid={`text-user-name-${user.id}`}>{user.name}</span>
                      <Badge variant="secondary" className={`text-[10px] px-2 py-0 ${getRoleColor(user.role)}`} data-testid={`badge-user-role-${user.id}`}>
                        {rolePerm?.label || user.role}
                      </Badge>
                      {rolePerm?.isSystem && <Lock className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    <p className="text-xs text-muted-foreground" data-testid={`text-user-email-${user.id}`}>{user.email}</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Monitor className="h-3.5 w-3.5" />
                      <span>{totalScreens} screen{totalScreens !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex gap-1">
                      {rolePerm?.canEditData && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Edit</span>
                      )}
                      {rolePerm?.canManageUsers && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Manage Users</span>
                      )}
                      {rolePerm?.canManageRoles && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">Manage Roles</span>
                      )}
                      {!rolePerm?.canEditData && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">View Only</span>
                      )}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t bg-muted/10">
                    <div className="p-4 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold">Access & Permissions</h4>
                          {rolePerm?.description && (
                            <span className="text-xs text-muted-foreground">— {rolePerm.description}</span>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {isEditing ? (
                            <Select
                              defaultValue={user.role}
                              onValueChange={(val) => {
                                updateUserRoleMutation.mutate({ userId: user.id, role: val });
                              }}
                            >
                              <SelectTrigger className="w-[200px] h-8 text-xs" data-testid={`select-role-${user.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {roles.map(r => (
                                  <SelectItem key={r.role} value={r.role} data-testid={`option-role-${r.role}-${user.id}`}>
                                    {r.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setEditingUserId(user.id); }} data-testid={`btn-edit-role-${user.id}`}>
                              <Pencil className="h-3 w-3 mr-1" /> Change Role
                            </Button>
                          )}
                          {isEditing && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setEditingUserId(null); }} data-testid={`btn-cancel-edit-${user.id}`}>
                              Cancel
                            </Button>
                          )}
                          {rolePerm && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setEditingRole(rolePerm); }} data-testid={`btn-edit-perms-${user.id}`}>
                              <SlidersHorizontal className="h-3 w-3 mr-1" /> Edit Permissions
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="space-y-2">
                          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <SlidersHorizontal className="h-3 w-3" /> Permissions
                          </h5>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-xs">
                              <div className={`w-2 h-2 rounded-full ${rolePerm?.canEditData ? "bg-blue-500" : "bg-slate-300"}`} />
                              <span className={rolePerm?.canEditData ? "" : "text-muted-foreground"}>
                                {rolePerm?.canEditData ? "Can edit data" : "View only (no editing)"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <div className={`w-2 h-2 rounded-full ${rolePerm?.canManageUsers ? "bg-orange-500" : "bg-slate-300"}`} />
                              <span className={rolePerm?.canManageUsers ? "" : "text-muted-foreground"}>
                                {rolePerm?.canManageUsers ? "Can manage users" : "Cannot manage users"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <div className={`w-2 h-2 rounded-full ${rolePerm?.canManageRoles ? "bg-red-500" : "bg-slate-300"}`} />
                              <span className={rolePerm?.canManageRoles ? "" : "text-muted-foreground"}>
                                {rolePerm?.canManageRoles ? "Can manage roles" : "Cannot manage roles"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Shield className="h-3 w-3" /> Section Access
                          </h5>
                          <div className="flex flex-wrap gap-1">
                            {ALL_SECTIONS.map(s => {
                              const hasAccess = rolePerm?.sections.includes(s);
                              return (
                                <span
                                  key={s}
                                  className={`text-[10px] px-2 py-0.5 rounded ${
                                    hasAccess
                                      ? SECTION_COLORS[s] || "bg-muted"
                                      : "bg-muted/50 text-muted-foreground/40 line-through"
                                  }`}
                                  data-testid={`section-badge-${user.id}-${s}`}
                                >
                                  {SECTION_LABELS[s] || s}
                                </span>
                              );
                            })}
                          </div>
                        </div>

                        <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Monitor className="h-3 w-3" /> Screens ({totalScreens})
                          </h5>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {accessibleScreens.map(({ section, screens }) => (
                          <div key={section} className="space-y-1">
                            <p className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-t ${SECTION_COLORS[section] || "bg-muted"}`}>
                              {SECTION_LABELS[section] || section}
                            </p>
                            <div className="space-y-0.5 pl-1">
                              {screens.map(screen => {
                                const ScreenIcon = screen.icon;
                                return (
                                  <div key={screen.path} className="flex items-center gap-2 text-xs py-0.5" data-testid={`screen-${user.id}-${screen.path}`}>
                                    <ScreenIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <span className="truncate">{screen.label}</span>
                                    {rolePerm?.canEditData ? (
                                      <PenLine className="h-2.5 w-2.5 text-blue-500 shrink-0 ml-auto" />
                                    ) : (
                                      <Eye className="h-2.5 w-2.5 text-slate-400 shrink-0 ml-auto" />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                        {accessibleScreens.length === 0 && (
                          <p className="text-xs text-muted-foreground col-span-full">No screens assigned to this role</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editingRole} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Permissions — {editingRole?.label}</DialogTitle>
          </DialogHeader>
          {editingRole && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium">Display Name</label>
                  <Input value={editingRole.label} onChange={(e) => setEditingRole({ ...editingRole, label: e.target.value })} data-testid="input-edit-label" />
                </div>
                <div>
                  <label className="text-xs font-medium">Description</label>
                  <Input value={editingRole.description || ""} onChange={(e) => setEditingRole({ ...editingRole, description: e.target.value })} data-testid="input-edit-description" />
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold mb-2">Section Access</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {ALL_SECTIONS.map(s => (
                    <label key={s} className="flex items-center gap-2 text-xs cursor-pointer p-1.5 rounded hover:bg-muted/50">
                      <Checkbox
                        checked={editingRole.sections.includes(s)}
                        onCheckedChange={(checked) => {
                          const newSections = checked
                            ? [...editingRole.sections, s]
                            : editingRole.sections.filter(x => x !== s);
                          setEditingRole({ ...editingRole, sections: newSections });
                        }}
                        data-testid={`check-section-${editingRole.role}-${s}`}
                      />
                      <span className={`px-1.5 py-0.5 rounded ${SECTION_COLORS[s] || "bg-muted"}`}>
                        {SECTION_LABELS[s] || s}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold mb-2">Capabilities</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={editingRole.canEditData}
                      onCheckedChange={(checked) => setEditingRole({ ...editingRole, canEditData: !!checked })}
                      data-testid={`check-edit-data-${editingRole.role}`}
                    />
                    Can edit data
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={editingRole.canManageUsers}
                      onCheckedChange={(checked) => setEditingRole({ ...editingRole, canManageUsers: !!checked })}
                      data-testid={`check-manage-users-${editingRole.role}`}
                    />
                    Can manage users
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={editingRole.canManageRoles}
                      onCheckedChange={(checked) => setEditingRole({ ...editingRole, canManageRoles: !!checked })}
                      data-testid={`check-manage-roles-${editingRole.role}`}
                    />
                    Can manage roles
                  </label>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRole(null)}>Cancel</Button>
            {editingRole && !editingRole.isSystem && (
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { deleteRoleMutation.mutate(editingRole.role); setEditingRole(null); }} data-testid={`btn-delete-role-${editingRole?.role}`}>
                <Trash2 className="h-3 w-3 mr-1" /> Delete Role
              </Button>
            )}
            <Button onClick={() => editingRole && updateRolePermMutation.mutate({
              role: editingRole.role,
              label: editingRole.label,
              description: editingRole.description,
              sections: editingRole.sections,
              canEditData: editingRole.canEditData,
              canManageUsers: editingRole.canManageUsers,
              canManageRoles: editingRole.canManageRoles,
            })} data-testid="btn-save-role-details">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddRole} onOpenChange={setShowAddRole}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Role Key (unique, uppercase)</label>
              <Input value={newRole.role} onChange={(e) => setNewRole({ ...newRole, role: e.target.value.toUpperCase().replace(/\s+/g, "_") })} placeholder="CUSTOM_ROLE" data-testid="input-new-role-key" />
            </div>
            <div>
              <label className="text-xs font-medium">Display Label</label>
              <Input value={newRole.label} onChange={(e) => setNewRole({ ...newRole, label: e.target.value })} placeholder="Custom Role Name" data-testid="input-new-role-label" />
            </div>
            <div>
              <label className="text-xs font-medium">Description</label>
              <Input value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} placeholder="What this role does" data-testid="input-new-role-desc" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Section Access</label>
              <div className="flex flex-wrap gap-2">
                {ALL_SECTIONS.map(s => (
                  <label key={s} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox
                      checked={newRole.sections.includes(s)}
                      onCheckedChange={(checked) => {
                        setNewRole(prev => ({
                          ...prev,
                          sections: checked ? [...prev.sections, s] : prev.sections.filter(x => x !== s),
                        }));
                      }}
                      data-testid={`check-new-section-${s}`}
                    />
                    {SECTION_LABELS[s] || s}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRole(false)}>Cancel</Button>
            <Button onClick={() => createRoleMutation.mutate(newRole)} disabled={!newRole.role || !newRole.label} data-testid="btn-create-role">
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
