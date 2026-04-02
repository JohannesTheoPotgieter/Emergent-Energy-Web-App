import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Plus, Search, Shield, ShieldCheck } from "lucide-react";
import type { RoleSummary } from "../settings-types";

interface RoleListPanelProps {
  roles: RoleSummary[];
  selectedRole: string;
  onSelectRole: (role: string) => void;
  onCreateRole: () => void;
  canManageRoles: boolean;
}

export function RoleListPanel({ roles, selectedRole, onSelectRole, onCreateRole, canManageRoles }: RoleListPanelProps) {
  const [filter, setFilter] = useState("");

  const filteredRoles = roles.filter((r) => {
    const q = filter.toLowerCase();
    return !q || r.role.toLowerCase().includes(q) || r.label.toLowerCase().includes(q);
  });

  const getRoleIcon = (r: RoleSummary) => {
    if (r.protected) return <Lock className="h-3.5 w-3.5 text-amber-500" />;
    if (r.isSystem) return <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />;
    return <Shield className="h-3.5 w-3.5 text-emerald-500" />;
  };

  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm h-full flex flex-col">
      <div className="p-3 border-b border-gray-100 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">{roles.length} Roles</span>
          <Button size="sm" onClick={onCreateRole} disabled={!canManageRoles} className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 px-2.5 text-xs" data-testid="button-create-role">
            <Plus className="h-3.5 w-3.5 mr-1" /> New
          </Button>
        </div>
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-7 bg-gray-50 border-gray-200 focus:bg-white text-xs" placeholder="Search roles..." value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="input-search-roles" />
        </div>
      </div>
      <div className="space-y-0.5 overflow-auto flex-1 p-1.5">
        {filteredRoles.map((r) => {
          const isSelected = selectedRole === r.role;
          return (
            <button key={r.role}
              className={`w-full text-left rounded-md px-2.5 py-2 transition-all ${isSelected ? "bg-emerald-50 border border-emerald-300 shadow-sm" : "hover:bg-gray-50 border border-transparent"}`}
              onClick={() => onSelectRole(r.role)} data-testid={`button-role-${r.role}`}
            >
              <div className="flex items-center gap-2">
                {getRoleIcon(r)}
                <div className="min-w-0 flex-1">
                  <span className={`font-medium text-xs block truncate ${isSelected ? "text-emerald-900" : "text-gray-900"}`}>{r.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {r.userCount || 0} user{(r.userCount || 0) !== 1 ? "s" : ""}
                    {r.isSystem && <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3 ml-1 bg-gray-100 text-gray-500 border-gray-200">System</Badge>}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
