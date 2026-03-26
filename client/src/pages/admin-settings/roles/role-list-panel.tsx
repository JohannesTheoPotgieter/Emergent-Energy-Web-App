import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Lock, Plus, Search, Shield, ShieldCheck, GitCompareArrows } from "lucide-react";
import type { RoleSummary } from "../settings-types";

interface RoleListPanelProps {
  roles: RoleSummary[];
  selectedRole: string;
  onSelectRole: (role: string) => void;
  onCreateRole: () => void;
  onCompareRoles: () => void;
  canManageRoles: boolean;
}

export function RoleListPanel({ roles, selectedRole, onSelectRole, onCreateRole, onCompareRoles, canManageRoles }: RoleListPanelProps) {
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "system" | "custom">("all");

  const systemRoleCount = roles.filter((r) => r.isSystem).length;
  const customRoleCount = roles.filter((r) => !r.isSystem).length;
  const assignedUsers = roles.reduce((sum, r) => sum + (r.userCount || 0), 0);

  const filteredRoles = roles.filter((r) => {
    if (kindFilter === "system" && !r.isSystem) return false;
    if (kindFilter === "custom" && r.isSystem) return false;
    const q = filter.toLowerCase();
    return !q || r.role.toLowerCase().includes(q) || r.label.toLowerCase().includes(q);
  });

  const getRoleIcon = (r: RoleSummary) => {
    if (r.protected) return <Lock className="h-4 w-4 text-amber-500" />;
    if (r.isSystem) return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
    return <Shield className="h-4 w-4 text-emerald-500" />;
  };

  return (
    <Card className="border-gray-200 shadow-sm h-full flex flex-col">
      <CardHeader className="pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-gray-900">Roles</CardTitle>
          <div className="flex gap-1">
            <Button
              size="sm" variant="outline"
              onClick={onCompareRoles}
              className="h-7 px-2 text-xs border-gray-200 text-gray-600 hover:bg-gray-50"
              title="Compare two roles"
              data-testid="button-compare-roles"
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={onCreateRole} disabled={!canManageRoles} className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 px-2.5 text-xs" data-testid="button-create-role">
              <Plus className="h-3.5 w-3.5 mr-1" /> New Role
            </Button>
          </div>
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
                onClick={() => onSelectRole(r.role)} data-testid={`button-role-${r.role}`}
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
  );
}
