import React, { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Shield, ShieldCheck, Lock, Users, Layers, Key } from "lucide-react";
import type { RoleSummary } from "../settings-types";
import { ACTIONS, ENTITY_CATEGORIES } from "../settings-types";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";

interface RoleOverviewCardProps {
  role: RoleSummary;
  users: Array<{ id: number; name: string }>;
}

export function RoleOverviewCard({ role, users }: RoleOverviewCardProps) {
  const allEntities = Object.values(ENTITY_CATEGORIES).flatMap((c) => c.entities);
  const ep = (role.entityPermissions || {}) as Record<string, Record<string, boolean>>;

  const { granted, total, bySource } = useMemo(() => {
    let granted = 0;
    let fromDefault = 0;
    let fromOverride = 0;
    const total = allEntities.length * ACTIONS.length;
    const normalizedRole = role.role || "";

    for (const entity of allEntities) {
      for (const action of ACTIONS) {
        const dbOverride = ep[entity]?.[action];
        if (typeof dbOverride === "boolean") {
          if (dbOverride) { granted++; fromOverride++; }
          continue;
        }
        const defaultRule = ENTITY_PERMISSION_DEFAULTS.find((r) => r.entity === entity);
        if (defaultRule) {
          const roleList = (defaultRule as any)[`${action}_roles`] as string[] | undefined;
          if (roleList?.includes(normalizedRole)) { granted++; fromDefault++; }
        }
      }
    }
    return { granted, total, bySource: { fromDefault, fromOverride } };
  }, [allEntities, ep, role.role]);

  const pct = total > 0 ? Math.round((granted / total) * 100) : 0;
  const navCount = (role.sections || []).length;

  // Authority scope summary
  const highestScope = useMemo(() => {
    const summary = role.authoritySummary || [];
    const scopes = new Set<string>();
    summary.forEach((row) => row.actions.filter((a) => a.allowed).forEach((a) => scopes.add(a.scope)));
    if (scopes.has("company_admin")) return "Company Admin";
    if (scopes.has("all_projects")) return "All Projects";
    if (scopes.has("assigned_projects")) return "Assigned Projects";
    if (scopes.has("department")) return "Department";
    if (scopes.has("own")) return "Own Only";
    return "None configured";
  }, [role.authoritySummary]);

  return (
    <div className="space-y-5">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Key className="h-4 w-4 text-emerald-600" />}
          label="Permissions"
          value={`${granted}/${total}`}
          helper={`${pct}% granted`}
          color="emerald"
        />
        <StatCard
          icon={<Layers className="h-4 w-4 text-blue-600" />}
          label="Navigation"
          value={`${navCount}/10`}
          helper={`${navCount} sections enabled`}
          color="blue"
        />
        <StatCard
          icon={<Users className="h-4 w-4 text-violet-600" />}
          label="Users"
          value={String(users.length)}
          helper={users.length === 1 ? "1 assigned user" : `${users.length} assigned users`}
          color="violet"
        />
        <StatCard
          icon={<Shield className="h-4 w-4 text-amber-600" />}
          label="Authority Scope"
          value={highestScope}
          helper="Highest scope level"
          color="amber"
        />
      </div>

      {/* Permission Coverage Bar */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-800">Permission Coverage</span>
          <span className="text-sm font-bold text-gray-900">{pct}%</span>
        </div>
        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              pct > 75 ? "bg-emerald-500" : pct > 40 ? "bg-amber-500" : "bg-gray-400"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-blue-400" />
            <span>{bySource.fromDefault} from defaults</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span>{bySource.fromOverride} from overrides</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-gray-300" />
            <span>{total - granted} denied</span>
          </div>
        </div>
      </div>

      {/* Role Details */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-800">Role Properties</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">Type</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {role.protected ? <Lock className="h-3.5 w-3.5 text-amber-500" /> : role.isSystem ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> : <Shield className="h-3.5 w-3.5 text-emerald-500" />}
              <span className="font-medium">{role.protected ? "Protected System" : role.isSystem ? "System" : "Custom"}</span>
            </div>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Role Key</span>
            <code className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded mt-0.5 inline-block">{role.role}</code>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Can Manage Users</span>
            <Badge variant={role.canManageUsers ? "default" : "secondary"} className={`mt-0.5 text-[10px] ${role.canManageUsers ? "bg-emerald-100 text-emerald-700 border-emerald-200" : ""}`}>
              {role.canManageUsers ? "Yes" : "No"}
            </Badge>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Can Manage Roles</span>
            <Badge variant={role.canManageRoles ? "default" : "secondary"} className={`mt-0.5 text-[10px] ${role.canManageRoles ? "bg-emerald-100 text-emerald-700 border-emerald-200" : ""}`}>
              {role.canManageRoles ? "Yes" : "No"}
            </Badge>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Can Edit Data</span>
            <Badge variant={role.canEditData ? "default" : "secondary"} className={`mt-0.5 text-[10px] ${role.canEditData ? "bg-emerald-100 text-emerald-700 border-emerald-200" : ""}`}>
              {role.canEditData ? "Yes" : "No"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Assigned Users Preview */}
      {users.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Assigned Users</h4>
          <div className="flex flex-wrap gap-2">
            {users.slice(0, 12).map((u) => (
              <div key={u.id} className="flex items-center gap-1.5 bg-gray-50 rounded-full px-2.5 py-1 border border-gray-200">
                <div className="h-5 w-5 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-[9px]">
                  {(u.name || "?").charAt(0).toUpperCase()}
                </div>
                <span className="text-xs text-gray-700">{u.name}</span>
              </div>
            ))}
            {users.length > 12 && (
              <div className="flex items-center bg-gray-50 rounded-full px-2.5 py-1 border border-gray-200">
                <span className="text-xs text-gray-500">+{users.length - 12} more</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, helper, color }: { icon: React.ReactNode; label: string; value: string; helper: string; color: string }) {
  const bgMap: Record<string, string> = {
    emerald: "bg-emerald-50 border-emerald-200",
    blue: "bg-blue-50 border-blue-200",
    violet: "bg-violet-50 border-violet-200",
    amber: "bg-amber-50 border-amber-200",
  };

  return (
    <div className={`rounded-lg border p-3 ${bgMap[color] || "bg-gray-50 border-gray-200"}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-lg font-bold text-gray-900 leading-tight">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{helper}</div>
    </div>
  );
}
