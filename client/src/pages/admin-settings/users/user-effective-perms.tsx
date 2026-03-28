import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";
import type { UserSummary, RoleSummary, UserOverrideRow } from "../settings-types";
import { ACTIONS, ENTITY_CATEGORIES, ENTITY_DESCRIPTIONS, formatEntityName } from "../settings-types";
import * as api from "../settings-api";

interface UserEffectivePermsProps {
  user: UserSummary;
  role: RoleSummary | undefined;
}

type PermSource = "user_override_grant" | "user_override_deny" | "role_override" | "default" | "none";

function getEffectivePermission(
  entity: string,
  action: string,
  role: RoleSummary | undefined,
  overrides: UserOverrideRow[]
): { allowed: boolean; source: PermSource } {
  // 1. User overrides (highest priority)
  const userOverride = overrides.find((o) => o.entity === entity && o.action === action);
  if (userOverride) {
    return { allowed: userOverride.allowed, source: userOverride.allowed ? "user_override_grant" : "user_override_deny" };
  }

  // 2. Role DB overrides
  if (role) {
    const ep = (role.entityPermissions || {}) as Record<string, Record<string, boolean>>;
    const dbOverride = ep[entity]?.[action];
    if (typeof dbOverride === "boolean") {
      return { allowed: dbOverride, source: "role_override" };
    }
  }

  // 3. Hardcoded defaults
  const defaultRule = ENTITY_PERMISSION_DEFAULTS.find((r) => r.entity === entity);
  if (defaultRule && role) {
    const roleList = (defaultRule as any)[`${action}_roles`] as string[] | undefined;
    if (roleList?.includes(role.role)) return { allowed: true, source: "default" };
  }

  return { allowed: false, source: "none" };
}

const SOURCE_LABELS: Record<PermSource, string> = {
  user_override_grant: "User override (granted)",
  user_override_deny: "User override (denied)",
  role_override: "Role override",
  default: "Default rule",
  none: "No access",
};

const SOURCE_COLORS: Record<PermSource, string> = {
  user_override_grant: "bg-amber-100 text-amber-700 border-amber-300",
  user_override_deny: "bg-red-100 text-red-600 border-red-300",
  role_override: "bg-emerald-100 text-emerald-700 border-emerald-300",
  default: "bg-blue-50 text-blue-600 border-blue-200",
  none: "bg-gray-50 text-gray-300 border-gray-200",
};

export function UserEffectivePerms({ user, role }: UserEffectivePermsProps) {
  const [overrides, setOverrides] = useState<UserOverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    api.fetchUserOverrides(user.id).then(setOverrides).finally(() => setLoading(false));
  }, [user.id]);

  const toggleCategory = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const categories = useMemo(() => {
    const cats = Object.entries(ENTITY_CATEGORIES).map(([key, cat]) => ({
      key, label: cat.label, entities: cat.entities,
    }));
    if (!search) return cats;
    const q = search.toLowerCase();
    return cats.map((c) => ({
      ...c,
      entities: c.entities.filter((e) => formatEntityName(e).toLowerCase().includes(q) || c.label.toLowerCase().includes(q)),
    })).filter((c) => c.entities.length > 0);
  }, [search]);

  const stats = useMemo(() => {
    let granted = 0;
    let total = 0;
    let fromOverride = 0;
    let fromRole = 0;
    let fromDefault = 0;

    for (const cat of Object.values(ENTITY_CATEGORIES)) {
      for (const entity of cat.entities) {
        for (const action of ACTIONS) {
          total++;
          const perm = getEffectivePermission(entity, action, role, overrides);
          if (perm.allowed) {
            granted++;
            if (perm.source === "user_override_grant") fromOverride++;
            else if (perm.source === "role_override") fromRole++;
            else if (perm.source === "default") fromDefault++;
          }
        }
      }
    }
    return { granted, total, fromOverride, fromRole, fromDefault };
  }, [role, overrides]);

  if (loading) return <div className="text-center py-8 text-sm text-muted-foreground">Loading effective permissions...</div>;

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-gray-800">Effective Permissions for {user.name}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          This shows the final resolved permissions after merging role defaults, role overrides, and user-specific overrides.
        </p>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs">
        <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 border-emerald-200">{stats.granted}/{stats.total} granted</Badge>
        <span className="text-muted-foreground">
          {stats.fromDefault} from defaults · {stats.fromRole} from role overrides · {stats.fromOverride} from user overrides
        </span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded border bg-amber-100 border-amber-300" /><span>User override</span></div>
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded border bg-emerald-100 border-emerald-300" /><span>Role override</span></div>
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded border bg-blue-50 border-blue-200" /><span>Default</span></div>
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded border bg-gray-50 border-gray-200" /><span>No access</span></div>
      </div>

      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8 h-8 text-sm bg-gray-50 border-gray-200" placeholder="Filter entities..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[50vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600 w-[200px] bg-gray-50">Entity</th>
              {ACTIONS.map((a) => (
                <th key={a} className="text-center px-1 py-2 text-xs font-semibold text-gray-600 capitalize w-[60px] bg-gray-50">{a}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const isCollapsed = collapsed.has(cat.key);
              return (
                <React.Fragment key={cat.key}>
                  <tr className="bg-gray-50/80 cursor-pointer" onClick={() => toggleCategory(cat.key)}>
                    <td colSpan={ACTIONS.length + 1} className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        {isCollapsed ? <ChevronRight className="h-3 w-3 text-gray-400" /> : <ChevronDown className="h-3 w-3 text-gray-400" />}
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{cat.label}</span>
                      </div>
                    </td>
                  </tr>
                  {!isCollapsed && cat.entities.map((entity) => (
                    <tr key={entity} className="border-t border-gray-100 hover:bg-gray-50/50">
                      <td className="px-3 py-1.5">
                        <div className="text-xs font-medium text-gray-800">{formatEntityName(entity)}</div>
                      </td>
                      {ACTIONS.map((action) => {
                        const perm = getEffectivePermission(entity, action, role, overrides);
                        return (
                          <td key={action} className="text-center px-1 py-1.5">
                            <div
                              className={`inline-flex items-center justify-center h-6 w-6 rounded-md border text-xs ${SOURCE_COLORS[perm.source]}`}
                              title={SOURCE_LABELS[perm.source]}
                            >
                              {perm.allowed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
