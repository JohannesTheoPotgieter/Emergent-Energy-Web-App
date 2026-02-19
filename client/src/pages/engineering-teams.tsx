import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Users, Loader2, Shield, ShieldCheck, Wrench, Eye, Crown, Briefcase, DollarSign, HardHat, Calculator, Key, UserCog, Plus, Pencil, Trash2, Lock, ChevronRight } from "lucide-react";

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

export default function EngineeringTeamsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingRole, setEditingRole] = useState<RolePermission | null>(null);
  const [showAddRole, setShowAddRole] = useState(false);
  const [newRole, setNewRole] = useState({ role: "", label: "", description: "", sections: [] as string[], canManageUsers: false, canManageRoles: false, canEditData: true });
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

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

  return (
    <div data-testid="admin-teams-page" className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-8 w-8 text-blue-500" />
        <div>
          <h2 className="text-2xl sm:text-3xl font-heading font-bold" data-testid="text-teams-title">Teams & Roles</h2>
          <p className="text-sm text-muted-foreground">Unified role management — assign roles, edit permissions, manage section access</p>
        </div>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="users" data-testid="tab-users">Users ({users.length})</TabsTrigger>
          <TabsTrigger value="roles" data-testid="tab-roles">Roles & Permissions ({roles.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4 mt-4">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
            {roles.slice(0, 6).map(r => {
              const count = users.filter(u => u.role === r.role).length;
              const Icon = getRoleIcon(r.role);
              return (
                <Card key={r.role} className="border">
                  <CardContent className="p-3 flex items-center gap-2">
                    <div className={`p-1.5 rounded ${getRoleColor(r.role)}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xl font-bold" data-testid={`count-role-${r.role}`}>{count}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{r.label}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">All Users</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : users.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground" data-testid="text-teams-empty">
                  <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-lg font-medium">No users found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="hidden md:table-cell">Sections</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map(user => {
                        const rolePerm = roles.find(r => r.role === user.role);
                        const Icon = getRoleIcon(user.role);
                        const isEditing = editingUserId === user.id;
                        return (
                          <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                            <TableCell className="font-medium" data-testid={`text-user-name-${user.id}`}>{user.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground" data-testid={`text-user-email-${user.id}`}>{user.email}</TableCell>
                            <TableCell>
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
                                <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${getRoleColor(user.role)}`} data-testid={`badge-user-role-${user.id}`}>
                                  <Icon className="h-3 w-3 mr-1" />
                                  {rolePerm?.label || user.role}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <div className="flex flex-wrap gap-1">
                                {(rolePerm?.sections || []).map(s => (
                                  <span key={s} className={`text-[9px] px-1.5 py-0.5 rounded ${SECTION_COLORS[s] || "bg-muted text-muted-foreground"}`}>
                                    {SECTION_LABELS[s] || s}
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingUserId(null)} data-testid={`btn-cancel-edit-${user.id}`}>
                                  Cancel
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditingUserId(user.id)} data-testid={`btn-edit-role-${user.id}`}>
                                  Edit Role
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Configure which sections each role can access and what permissions they have.</p>
            <Button size="sm" onClick={() => setShowAddRole(true)} data-testid="btn-add-role">
              <Plus className="h-4 w-4 mr-1" /> Add Role
            </Button>
          </div>

          <div className="space-y-2">
            {roles.map(role => {
              const Icon = getRoleIcon(role.role);
              const isExpanded = expandedRole === role.role;
              const userCount = users.filter(u => u.role === role.role).length;
              return (
                <Card key={role.role} className="border">
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedRole(isExpanded ? null : role.role)}
                    data-testid={`role-row-${role.role}`}
                  >
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    <div className={`p-1.5 rounded ${getRoleColor(role.role)}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{role.label}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{role.role}</span>
                        {role.isSystem && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </div>
                      {role.description && <p className="text-xs text-muted-foreground">{role.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{userCount} user{userCount !== 1 ? "s" : ""}</Badge>
                      <div className="flex flex-wrap gap-1 max-w-[300px]">
                        {role.sections.map(s => (
                          <span key={s} className={`text-[9px] px-1.5 py-0.5 rounded ${SECTION_COLORS[s] || "bg-muted"}`}>
                            {SECTION_LABELS[s] || s}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t">
                      <div className="grid gap-4 sm:grid-cols-2 mt-3">
                        <div>
                          <p className="text-xs font-semibold mb-2">Section Access</p>
                          <div className="space-y-1.5">
                            {ALL_SECTIONS.map(s => (
                              <label key={s} className="flex items-center gap-2 text-xs cursor-pointer">
                                <Checkbox
                                  checked={role.sections.includes(s)}
                                  onCheckedChange={(checked) => {
                                    const newSections = checked
                                      ? [...role.sections, s]
                                      : role.sections.filter(x => x !== s);
                                    updateRolePermMutation.mutate({ role: role.role, sections: newSections });
                                  }}
                                  data-testid={`check-section-${role.role}-${s}`}
                                />
                                <span className={`px-1.5 py-0.5 rounded ${SECTION_COLORS[s] || "bg-muted"}`}>
                                  {SECTION_LABELS[s] || s}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold mb-2">Permissions</p>
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <Checkbox
                                checked={role.canManageUsers}
                                onCheckedChange={(checked) => updateRolePermMutation.mutate({ role: role.role, canManageUsers: !!checked })}
                                data-testid={`check-manage-users-${role.role}`}
                              />
                              Can manage users
                            </label>
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <Checkbox
                                checked={role.canManageRoles}
                                onCheckedChange={(checked) => updateRolePermMutation.mutate({ role: role.role, canManageRoles: !!checked })}
                                data-testid={`check-manage-roles-${role.role}`}
                              />
                              Can manage roles
                            </label>
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <Checkbox
                                checked={role.canEditData}
                                onCheckedChange={(checked) => updateRolePermMutation.mutate({ role: role.role, canEditData: !!checked })}
                                data-testid={`check-edit-data-${role.role}`}
                              />
                              Can edit data
                            </label>
                          </div>
                          <div className="flex gap-2 mt-4">
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditingRole(role)} data-testid={`btn-edit-details-${role.role}`}>
                              <Pencil className="h-3 w-3 mr-1" /> Edit Details
                            </Button>
                            {!role.isSystem && (
                              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => deleteRoleMutation.mutate(role.role)} data-testid={`btn-delete-role-${role.role}`}>
                                <Trash2 className="h-3 w-3 mr-1" /> Delete
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editingRole} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Role — {editingRole?.label}</DialogTitle>
          </DialogHeader>
          {editingRole && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium">Label</label>
                <Input value={editingRole.label} onChange={(e) => setEditingRole({ ...editingRole, label: e.target.value })} data-testid="input-edit-label" />
              </div>
              <div>
                <label className="text-xs font-medium">Description</label>
                <Input value={editingRole.description || ""} onChange={(e) => setEditingRole({ ...editingRole, description: e.target.value })} data-testid="input-edit-description" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRole(null)}>Cancel</Button>
            <Button onClick={() => editingRole && updateRolePermMutation.mutate({ role: editingRole.role, label: editingRole.label, description: editingRole.description })} data-testid="btn-save-role-details">
              Save
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
