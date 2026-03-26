import React, { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Eye, EyeOff, Key, Lock, Pencil, Plus, Search, Shield, Trash2, UserCheck, Users, X } from "lucide-react";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";
import * as api from "../settings-api";
import type { RoleSummary, UserSummary, UserOverrideRow } from "../settings-types";
import { DEPARTMENTS, ACTIONS, ENTITY_DESCRIPTIONS } from "../settings-types";
import { UserEffectivePerms } from "./user-effective-perms";

export function UsersSection() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeUserTab, setActiveUserTab] = useState<"details" | "effective_perms" | "overrides">("details");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<UserSummary | null>(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState<UserSummary | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", name: "", email: "", password: "", role: "", department: "" });

  // Override state
  const [overrides, setOverrides] = useState<UserOverrideRow[]>([]);
  const [showAddOverride, setShowAddOverride] = useState(false);
  const [newEntity, setNewEntity] = useState("");
  const [newAction, setNewAction] = useState("view");
  const [newAllowed, setNewAllowed] = useState(true);
  const [newReason, setNewReason] = useState("");

  const loadAll = useCallback(async () => {
    const [u, r] = await Promise.all([api.fetchUsers(), api.fetchRoles()]);
    setUsers(u);
    setRoles(r);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Load overrides when user is expanded and overrides tab is active
  useEffect(() => {
    if (expandedId && activeUserTab === "overrides") {
      api.fetchUserOverrides(expandedId).then(setOverrides);
    }
  }, [expandedId, activeUserTab]);

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const ok = await api.updateUserRole(id, role);
      if (!ok) throw new Error("Failed to update role");
      return { id, role };
    },
    onSuccess: ({ id, role }) => {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
      toast({ title: "Role updated", description: `Role changed to ${roles.find(r => r.role === role)?.label || role}` });
    },
    onError: () => toast({ title: "Failed to update role", variant: "destructive" }),
  });

  const updateDeptMutation = useMutation({
    mutationFn: async ({ id, department }: { id: number; department: string }) => {
      const result = await api.updateUserDepartment(id, department);
      if (!result.ok) throw new Error("Failed to update department");
      return { id, department: result.data?.department ?? department };
    },
    onSuccess: ({ id, department }) => {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, department } : u)));
      toast({ title: "Department updated" });
    },
    onError: () => toast({ title: "Failed to update department", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (form: typeof createForm) => {
      const result = await api.createUser(form);
      if (!result.ok) throw new Error(result.error || "Unknown error");
      return result.data;
    },
    onSuccess: (data) => {
      setUsers((prev) => [...prev, data]);
      setShowCreateDialog(false);
      setCreateForm({ username: "", name: "", email: "", password: "", role: "", department: "" });
      toast({ title: "User created", description: `${data.name} has been added` });
    },
    onError: (err: Error) => toast({ title: "Failed to create user", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (user: UserSummary) => {
      const result = await api.deleteUser(user.id);
      if (!result.ok) throw new Error(result.error || "Unknown error");
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

  const handleResetPassword = async () => {
    if (!showPasswordDialog || !newPassword || newPassword.length < 8) {
      toast({ title: "Password too short", description: "Must be at least 8 characters", variant: "destructive" });
      return;
    }
    const result = await api.resetUserPassword(showPasswordDialog.id, newPassword);
    if (result.ok) toast({ title: "Password reset", description: `Password updated for ${showPasswordDialog.name}` });
    else toast({ title: "Failed", description: result.error || "Unknown error", variant: "destructive" });
    setShowPasswordDialog(null); setNewPassword(""); setShowPassword(false);
  };

  const handleAddOverride = async () => {
    if (!expandedId || !newEntity || !newAction) return;
    const result = await api.addUserOverride({ userId: expandedId, entity: newEntity, action: newAction, allowed: newAllowed, reason: newReason || null });
    if (result.ok) {
      toast({ title: "Override added" });
      setShowAddOverride(false); setNewEntity(""); setNewAction("view"); setNewAllowed(true); setNewReason("");
      api.fetchUserOverrides(expandedId).then(setOverrides);
    } else {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    }
  };

  const handleDeleteOverride = async (overrideId: number) => {
    const ok = await api.deleteUserOverride(overrideId);
    if (ok && expandedId) {
      toast({ title: "Override removed" });
      api.fetchUserOverrides(expandedId).then(setOverrides);
    }
  };

  const filtered = users.filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (deptFilter && u.department !== deptFilter) return false;
    return `${u.name} ${u.email} ${u.role} ${u.department || ""}`.toLowerCase().includes(search.toLowerCase());
  });

  const entityOptions = ENTITY_PERMISSION_DEFAULTS.map((e) => e.entity);

  return (
    <>
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
          {/* Filters */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9 h-10 bg-gray-50 border-gray-200 focus:bg-white" placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-users" aria-label="Search users" />
            </div>
            <div className="w-48">
              <SearchableSelect
                options={[{ value: "", label: "All Roles" }, ...roles.map((r) => ({ value: r.role, label: r.label }))]}
                value={roleFilter}
                onValueChange={setRoleFilter}
                placeholder="Filter by role..."
              />
            </div>
            <div className="w-48">
              <SearchableSelect
                options={[{ value: "", label: "All Departments" }, ...DEPARTMENTS.map((d) => ({ value: d, label: d }))]}
                value={deptFilter}
                onValueChange={setDeptFilter}
                placeholder="Filter by dept..."
              />
            </div>
          </div>

          {/* User List */}
          <div className="space-y-2">
            {filtered.map((u) => {
              const isExpanded = expandedId === u.id;
              const roleLabel = roles.find((r) => r.role === u.role)?.label || u.role;
              const userRole = roles.find((r) => r.role === u.role);
              return (
                <div key={u.id} className={`border rounded-lg bg-white transition-colors ${isExpanded ? "border-emerald-300 shadow-sm" : "border-gray-200 hover:border-gray-300"}`}>
                  <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => { setExpandedId(isExpanded ? null : u.id); setActiveUserTab("details"); }} data-testid={`row-user-${u.id}`}>
                    <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm shrink-0">
                      {(u.name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-gray-900">{u.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs shrink-0 hidden sm:inline-flex">{roleLabel}</Badge>
                    {u.department && <Badge variant="outline" className="text-xs shrink-0 hidden sm:inline-flex">{u.department}</Badge>}
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      {/* User Detail Tabs */}
                      <div className="flex border-b border-gray-100 px-4">
                        {([
                          { key: "details" as const, label: "Details", icon: <Pencil className="h-3 w-3" /> },
                          { key: "effective_perms" as const, label: "Effective Permissions", icon: <Key className="h-3 w-3" /> },
                          { key: "overrides" as const, label: "Overrides", icon: <Shield className="h-3 w-3" /> },
                        ]).map((tab) => (
                          <button
                            key={tab.key}
                            onClick={(e) => { e.stopPropagation(); setActiveUserTab(tab.key); }}
                            className={`flex items-center gap-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${activeUserTab === tab.key ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                          >{tab.icon}{tab.label}</button>
                        ))}
                      </div>

                      <div className="px-4 py-4 bg-gray-50/50">
                        {activeUserTab === "details" && (
                          <div className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <Label className="text-xs font-medium text-gray-600 mb-1.5 block">Role</Label>
                                <SearchableSelect
                                  options={roles.map((r) => ({ value: r.role, label: r.label }))}
                                  value={u.role}
                                  onValueChange={(val) => { if (val) updateRoleMutation.mutate({ id: u.id, role: val }); }}
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
                                  onValueChange={(val) => { if (val) updateDeptMutation.mutate({ id: u.id, department: val }); }}
                                  placeholder="Select department"
                                  searchPlaceholder="Search departments..."
                                  data-testid={`select-department-${u.id}`}
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={(e) => { e.stopPropagation(); setShowPasswordDialog(u); }} data-testid={`button-reset-password-${u.id}`}>
                                <Lock className="h-3.5 w-3.5" /> Reset Password
                              </Button>
                              <div className="flex-1" />
                              <Button variant="outline" size="sm" className="gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700" onClick={(e) => { e.stopPropagation(); setShowDeleteDialog(u); }} data-testid={`button-delete-user-${u.id}`}>
                                <Trash2 className="h-3.5 w-3.5" /> Delete User
                              </Button>
                            </div>
                          </div>
                        )}

                        {activeUserTab === "effective_perms" && <UserEffectivePerms user={u} role={userRole} />}

                        {activeUserTab === "overrides" && (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="text-sm font-semibold text-gray-800">Permission Overrides</h4>
                                <p className="text-xs text-muted-foreground">Grant or revoke specific permissions for this user, overriding role defaults.</p>
                              </div>
                              <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowAddOverride(true)}>
                                <Plus className="h-4 w-4 mr-1" /> Add Override
                              </Button>
                            </div>
                            {overrides.length > 0 ? (
                              <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Entity</th>
                                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Action</th>
                                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Access</th>
                                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Reason</th>
                                      <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">Expires</th>
                                      <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {overrides.map((o) => (
                                      <tr key={o.id} className="border-t hover:bg-gray-50/50">
                                        <td className="px-3 py-2 font-mono text-xs">{o.entity}</td>
                                        <td className="px-3 py-2 font-mono text-xs">{o.action}</td>
                                        <td className="px-3 py-2">
                                          <Badge variant={o.allowed ? "default" : "destructive"} className={o.allowed ? "bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]" : "text-[10px]"}>
                                            {o.allowed ? "Granted" : "Denied"}
                                          </Badge>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-gray-500">{o.reason || "—"}</td>
                                        <td className="px-3 py-2 text-xs text-gray-500">{o.expiresAt ? new Date(o.expiresAt).toLocaleDateString() : "Never"}</td>
                                        <td className="px-3 py-2 text-right">
                                          <Button variant="ghost" size="sm" onClick={() => handleDeleteOverride(o.id)}>
                                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                          </Button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="text-center py-6 text-gray-400 text-sm">No user-specific overrides. This user uses their role defaults only.</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">{search || roleFilter || deptFilter ? "No users match your filters" : "No users found"}</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-emerald-600" /> Add New User</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="text-xs font-medium text-gray-600">Full Name *</Label><Input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. John Smith" data-testid="input-create-name" /></div>
            <div><Label className="text-xs font-medium text-gray-600">Username *</Label><Input value={createForm.username} onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))} placeholder="e.g. johnsmith" data-testid="input-create-username" /></div>
            <div><Label className="text-xs font-medium text-gray-600">Email *</Label><Input type="email" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))} placeholder="e.g. john@company.com" data-testid="input-create-email" /></div>
            <div><Label className="text-xs font-medium text-gray-600">Password *</Label><Input type="password" value={createForm.password} onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))} placeholder="Set a password" data-testid="input-create-password" /></div>
            <div><Label className="text-xs font-medium text-gray-600">Role</Label><SearchableSelect options={roles.map((r) => ({ value: r.role, label: r.label }))} value={createForm.role} onValueChange={(val) => setCreateForm((f) => ({ ...f, role: val }))} placeholder="Select role" searchPlaceholder="Search roles..." data-testid="select-create-role" /></div>
            <div><Label className="text-xs font-medium text-gray-600">Department</Label><SearchableSelect options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} value={createForm.department} onValueChange={(val) => setCreateForm((f) => ({ ...f, department: val }))} placeholder="Select department" searchPlaceholder="Search departments..." data-testid="select-create-department" /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-create-user">Cancel</Button>
            <Button onClick={() => { if (createForm.username && createForm.name && createForm.email && createForm.password) createMutation.mutate(createForm); else toast({ title: "Missing fields", description: "Please fill in all required fields", variant: "destructive" }); }} disabled={createMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-confirm-create-user">
              {createMutation.isPending ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={!!showDeleteDialog} onOpenChange={() => setShowDeleteDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-red-600"><Trash2 className="h-5 w-5" /> Delete User</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">Are you sure you want to permanently delete <span className="font-semibold">{showDeleteDialog?.name}</span>? This action cannot be undone.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(null)} data-testid="button-cancel-delete">Cancel</Button>
            <Button variant="destructive" onClick={() => { if (showDeleteDialog) deleteMutation.mutate(showDeleteDialog); }} disabled={deleteMutation.isPending} data-testid="button-confirm-delete">
              {deleteMutation.isPending ? "Deleting..." : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={!!showPasswordDialog} onOpenChange={() => { setShowPasswordDialog(null); setNewPassword(""); setShowPassword(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-emerald-600" /> Reset Password</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600">Set a new password for <span className="font-semibold">{showPasswordDialog?.name}</span></p>
          <div className="relative py-2">
            <Input type={showPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password (min 8 characters)" data-testid="input-new-password" />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowPasswordDialog(null); setNewPassword(""); setShowPassword(false); }} data-testid="button-cancel-password">Cancel</Button>
            <Button onClick={handleResetPassword} disabled={newPassword.length < 8} className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-confirm-password">
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Override Dialog */}
      <Dialog open={showAddOverride} onOpenChange={setShowAddOverride}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Permission Override</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs">Entity</Label><SearchableSelect options={entityOptions.map((e) => ({ value: e, label: `${e} — ${ENTITY_DESCRIPTIONS[e] || e}` }))} value={newEntity} onValueChange={setNewEntity} placeholder="Select entity..." /></div>
            <div><Label className="text-xs">Action</Label><SearchableSelect options={ACTIONS.map((a) => ({ value: a, label: a }))} value={newAction} onValueChange={setNewAction} placeholder="Select action..." /></div>
            <div className="flex items-center gap-3"><Label className="text-xs">Access</Label><Switch checked={newAllowed} onCheckedChange={setNewAllowed} /><span className="text-sm">{newAllowed ? "Grant" : "Deny"}</span></div>
            <div><Label className="text-xs">Reason (optional)</Label><Input value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="Why this override exists..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddOverride(false)}>Cancel</Button>
            <Button onClick={handleAddOverride} disabled={!newEntity || !newAction} className="bg-blue-600 hover:bg-blue-700">Add Override</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
