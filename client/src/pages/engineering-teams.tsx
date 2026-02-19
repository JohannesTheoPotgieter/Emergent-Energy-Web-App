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
import { useToast } from "@/hooks/use-toast";
import { Users, Loader2, Shield, ShieldCheck, Wrench, Eye, Crown, Briefcase, DollarSign, HardHat, Calculator, Key, UserCog } from "lucide-react";

async function adminFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface UserInfo {
  id: number;
  name: string;
  email: string;
  role: string;
}

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin", description: "Full access to all features", icon: Shield, color: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
  { value: "quality_manager", label: "Quality Manager", description: "Quality dashboard + view-only Projects", icon: ShieldCheck, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" },
  { value: "viewer", label: "Viewer", description: "View-only access to project data", icon: Eye, color: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" },
];

const COMPANY_ROLES = [
  { value: "COO_ADMIN", label: "COO Admin", description: "Full executive access, settings, password management", icon: Crown, color: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" },
  { value: "CEO_ADMIN", label: "CEO Admin", description: "Full executive access, strategic oversight", icon: Crown, color: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400" },
  { value: "CCO", label: "CCO", description: "Commercial operations, project oversight", icon: Briefcase, color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400" },
  { value: "CFO", label: "CFO", description: "Financial oversight, cashflow, budgets", icon: DollarSign, color: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
  { value: "PROGRAM_MANAGER", label: "Program Manager", description: "Project management, engineering dashboard", icon: UserCog, color: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400" },
  { value: "PROGRAM_FINANCE_MANAGER", label: "Program Finance Manager", description: "Project finance, cost tracking", icon: Calculator, color: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400" },
  { value: "CONSTRUCTION_MANAGER", label: "Construction Manager", description: "Construction oversight, site management", icon: HardHat, color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400" },
  { value: "QUALITY_MANAGER", label: "Quality Manager", description: "Quality checklists, post-mortems, inspections", icon: ShieldCheck, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" },
  { value: "ENGINEERING_MANAGER", label: "Engineering Manager", description: "Engineering tasks, deliverables, approvals", icon: Wrench, color: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400" },
  { value: "KEY_ACCOUNTS_MANAGER", label: "Key Accounts Manager", description: "Client relations, account management", icon: Key, color: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400" },
];

function getRoleInfo(role: string) {
  return ROLE_OPTIONS.find(r => r.value === role) || COMPANY_ROLES.find(r => r.value === role) || ROLE_OPTIONS[2];
}

export default function EngineeringTeamsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingUserId, setEditingUserId] = useState<number | null>(null);

  const { data: users = [], isLoading } = useQuery<UserInfo[]>({
    queryKey: ["admin-users"],
    queryFn: () => adminFetch("/api/eng/users"),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) =>
      adminFetch(`/api/quality/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setEditingUserId(null);
      toast({ title: "Role updated", description: "User role has been changed successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update role.", variant: "destructive" });
    },
  });

  const userRoleCounts = ROLE_OPTIONS.map(r => ({
    ...r,
    count: users.filter(u => u.role === r.value).length,
  }));

  return (
    <div data-testid="admin-teams-page" className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-8 w-8 text-blue-500" />
        <div>
          <h2 className="text-2xl sm:text-3xl font-heading font-bold" data-testid="text-teams-title">Teams & Roles</h2>
          <p className="text-sm text-muted-foreground">Assign roles and manage access rights for all users</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {userRoleCounts.map(r => (
          <Card key={r.value} className="border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${r.color}`}>
                <r.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold" data-testid={`count-role-${r.value}`}>{r.count}</p>
                <p className="text-xs text-muted-foreground truncate">{r.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">All Users ({users.length})</CardTitle>
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
                    <TableHead className="hidden md:table-cell">Access</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(user => {
                    const roleInfo = getRoleInfo(user.role);
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
                                updateRoleMutation.mutate({ userId: user.id, role: val });
                              }}
                            >
                              <SelectTrigger className="w-[180px] h-8 text-xs" data-testid={`select-role-${user.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_OPTIONS.map(r => (
                                  <SelectItem key={r.value} value={r.value} data-testid={`option-role-${r.value}-${user.id}`}>
                                    {r.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${roleInfo.color}`} data-testid={`badge-user-role-${user.id}`}>
                              {roleInfo.label}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[200px]" data-testid={`text-user-access-${user.id}`}>
                          {roleInfo.description}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setEditingUserId(null)}
                              data-testid={`btn-cancel-edit-${user.id}`}
                            >
                              Cancel
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setEditingUserId(user.id)}
                              data-testid={`btn-edit-role-${user.id}`}
                            >
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

      <Card className="border-muted">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Company Roles</CardTitle>
          <p className="text-xs text-muted-foreground">Role-based access via company login (separate from user accounts)</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {COMPANY_ROLES.map(r => (
              <div key={r.value} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border">
                <div className={`p-1.5 rounded ${r.color} shrink-0 mt-0.5`}>
                  <r.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{r.label}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{r.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">User Roles</CardTitle>
          <p className="text-xs text-muted-foreground">Application user account roles</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {ROLE_OPTIONS.map(r => (
              <div key={r.value} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border">
                <div className={`p-1.5 rounded ${r.color} shrink-0 mt-0.5`}>
                  <r.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{r.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
