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
  "EXCO",
  "PROJECT_MANAGEMENT",
  "ENGINEERING",
  "QUALITY",
  "ADMIN",
  "MY_TOOL",
  "FINANCE",
  "PROJECTS",
  "OPERATIONS",
  "GOVERNANCE",
  "COCKPIT",
  "MONEY",
  "DELIVERY",
] as const;

const SECTION_LABELS: Record<string, string> = {
  EXCO: "EXCO",
  PROJECT_MANAGEMENT: "Project Management",
  ENGINEERING: "Engineering",
  QUALITY: "Quality",
  ADMIN: "Admin",
  MY_TOOL: "My Tool",
  FINANCE: "Finance",
  PROJECTS: "Projects",
  OPERATIONS: "Operations",
  GOVERNANCE: "Governance",
  COCKPIT: "Cockpit",
  MONEY: "Money",
  DELIVERY: "Delivery",
};

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
    const current = (pendingChanges[roleKey]?.sections as string[] | undefined) || (role.sections as string[]) || [];
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
    <Card data-testid="card-role-table">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-600" />
          Role Permissions
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setLoading(true); loadRoles(); }}
          data-testid="btn-refresh-roles"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {roles.map((role) => {
          const isExpanded = expandedRole === role.role;
          const changes = pendingChanges[role.role];
          const hasChanges = !!changes;
          const effectiveSections = (changes?.sections as string[] | undefined) || (role.sections as string[]) || [];
          const effectiveCanManageUsers = changes?.canManageUsers ?? role.canManageUsers;
          const effectiveCanManageRoles = changes?.canManageRoles ?? role.canManageRoles;
          const effectiveCanEditData = changes?.canEditData ?? role.canEditData;

          return (
            <div
              key={role.role}
              className={`border rounded-lg transition-colors ${hasChanges ? "border-amber-300 bg-amber-50/30" : "border-gray-200"}`}
              data-testid={`role-row-${role.role}`}
            >
              <button
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50/50 transition-colors"
                onClick={() => setExpandedRole(isExpanded ? null : role.role)}
                data-testid={`btn-expand-role-${role.role}`}
              >
                {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800" data-testid={`text-role-name-${role.role}`}>
                      {role.label}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">{role.role}</span>
                    {role.isSystem && <Badge variant="outline" className="text-[10px] py-0 px-1.5">System</Badge>}
                    {hasChanges && <Badge className="text-[10px] py-0 px-1.5 bg-amber-500">Unsaved</Badge>}
                  </div>
                  {role.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{role.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className="text-[10px]">{effectiveSections.length} sections</Badge>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 space-y-4 border-t border-gray-100 pt-3" data-testid={`role-details-${role.role}`}>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Section Access</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_SECTIONS.map((section) => {
                        const isActive = effectiveSections.includes(section);
                        return (
                          <Badge
                            key={section}
                            variant={isActive ? "default" : "outline"}
                            className={`cursor-pointer select-none transition-colors text-xs ${
                              isActive
                                ? "bg-green-600 hover:bg-green-700 text-white border-green-600"
                                : "hover:bg-gray-100 text-gray-500 border-gray-300"
                            }`}
                            onClick={() => toggleSection(role.role, section)}
                            data-testid={`badge-section-${role.role}-${section}`}
                          >
                            {SECTION_LABELS[section] || section}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Capabilities</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label
                        className="flex items-center justify-between gap-2 p-2 rounded-md border border-gray-100 hover:bg-gray-50 cursor-pointer"
                        data-testid={`toggle-canManageUsers-${role.role}`}
                      >
                        <span className="text-sm text-gray-700">Manage Users</span>
                        <Switch
                          checked={!!effectiveCanManageUsers}
                          onCheckedChange={() => toggleCapability(role.role, "canManageUsers")}
                        />
                      </label>
                      <label
                        className="flex items-center justify-between gap-2 p-2 rounded-md border border-gray-100 hover:bg-gray-50 cursor-pointer"
                        data-testid={`toggle-canManageRoles-${role.role}`}
                      >
                        <span className="text-sm text-gray-700">Manage Roles</span>
                        <Switch
                          checked={!!effectiveCanManageRoles}
                          onCheckedChange={() => toggleCapability(role.role, "canManageRoles")}
                        />
                      </label>
                      <label
                        className="flex items-center justify-between gap-2 p-2 rounded-md border border-gray-100 hover:bg-gray-50 cursor-pointer"
                        data-testid={`toggle-canEditData-${role.role}`}
                      >
                        <span className="text-sm text-gray-700">Edit Data</span>
                        <Switch
                          checked={!!effectiveCanEditData}
                          onCheckedChange={() => toggleCapability(role.role, "canEditData")}
                        />
                      </label>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Entity Permissions</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" data-testid={`entity-perms-${role.role}`}>
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="text-left py-1 pr-4 font-medium text-gray-500 w-28">Entity</th>
                            {(["view", "edit", "approve", "override"] as PermissionAction[]).map(a => (
                              <th key={a} className="text-center py-1 px-2 font-medium text-gray-500 capitalize w-16">{a}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(["projects", "financials", "quality", "engineering", "procurement", "admin", "governance"] as PermissionEntity[]).map(entity => (
                            <tr key={entity} className="border-b border-gray-50 hover:bg-gray-50/50">
                              <td className="py-1.5 pr-4 capitalize font-medium text-gray-700">{entity}</td>
                              {(["view", "edit", "approve", "override"] as PermissionAction[]).map(action => {
                                const active = getEntityPerm(role.role, entity, action);
                                return (
                                  <td key={action} className="text-center py-1.5 px-2">
                                    <button
                                      className={`w-6 h-6 rounded-md border transition-colors ${
                                        active
                                          ? "bg-green-600 border-green-600 text-white"
                                          : "bg-white border-gray-300 text-gray-300 hover:border-gray-400"
                                      }`}
                                      onClick={() => toggleEntityPerm(role.role, entity, action)}
                                      data-testid={`entity-perm-${role.role}-${entity}-${action}`}
                                    >
                                      {active ? <Check className="h-3 w-3 mx-auto" /> : null}
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
  );
}

function UserManagementSection({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingUserId, setChangingUserId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetch("/api/admin/users", { headers: getAuthHeaders() }),
        fetch("/api/roles", { headers: getAuthHeaders() }),
      ]);
      if (usersRes.ok) setUsers(await usersRes.json());
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
    <Card data-testid="card-user-management">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-green-600" />
          User Management
        </CardTitle>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-users">No users found.</p>
        ) : (
          <div className="space-y-2">
            {users.map((user) => {
              const roleLabel = COMPANY_ROLE_LABELS[user.role as CompanyRole] || user.role;
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
  );
}
