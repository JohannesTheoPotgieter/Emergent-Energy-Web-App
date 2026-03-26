import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, ChevronDown, ChevronRight, Eye, Pencil, Plus, Search, Shield, ShieldCheck, Trash2, X } from "lucide-react";
import type { PermissionAction } from "@shared/schema";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";
import type { RoleSummary } from "../settings-types";
import { ACTIONS, ENTITY_CATEGORIES, ENTITY_DESCRIPTIONS, formatEntityName } from "../settings-types";

interface RolePermissionsMatrixProps {
  role: RoleSummary;
  draft: Partial<RoleSummary>;
  onUpdateDraft: (update: Partial<RoleSummary>) => void;
  canManageRoles: boolean;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  view: <Eye className="h-3.5 w-3.5" />,
  create: <Plus className="h-3.5 w-3.5" />,
  edit: <Pencil className="h-3.5 w-3.5" />,
  approve: <Check className="h-3.5 w-3.5" />,
  override: <ShieldCheck className="h-3.5 w-3.5" />,
  delete: <Trash2 className="h-3.5 w-3.5" />,
};

// Source-based colors for the permission cells
const SOURCE_COLORS = {
  role_override_on: "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200",
  default_on: "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100",
  role_override_off: "bg-red-50 text-red-400 border-red-200 hover:bg-red-100",
  no_access: "bg-gray-50 text-gray-300 border-gray-200 hover:bg-gray-100",
};

function getPermissionState(
  entity: string,
  action: string,
  ep: Record<string, Record<string, boolean>>,
  normalizedRole: string
): { allowed: boolean; source: "role_override" | "default" | "none" } {
  const dbOverride = ep[entity]?.[action];
  if (typeof dbOverride === "boolean") {
    return { allowed: dbOverride, source: "role_override" };
  }
  const defaultRule = ENTITY_PERMISSION_DEFAULTS.find((r) => r.entity === entity);
  if (defaultRule) {
    const roleList = (defaultRule as any)[`${action}_roles`] as string[] | undefined;
    if (roleList?.includes(normalizedRole)) return { allowed: true, source: "default" };
  }
  return { allowed: false, source: "none" };
}

export function RolePermissionsMatrix({ role, draft, onUpdateDraft, canManageRoles }: RolePermissionsMatrixProps) {
  const [permSearch, setPermSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const effectiveRole = { ...role, ...draft } as RoleSummary;
  const currentEp = (effectiveRole.entityPermissions || {}) as Record<string, Record<string, boolean>>;
  const normalizedRole = effectiveRole.role || "";
  const allEntities = Object.values(ENTITY_CATEGORIES).flatMap((c) => c.entities).sort();

  const updateEp = (entity: string, action: string, value: boolean) => {
    const next = { ...currentEp, [entity]: { ...(currentEp[entity] || {}), [action]: value } };
    if ((action === "edit" || action === "approve" || action === "delete") && value) next[entity].view = true;
    onUpdateDraft({ entityPermissions: next });
  };

  const bulkUpdateCategory = (entities: string[], value: boolean) => {
    const next = { ...currentEp };
    entities.forEach((entity) => {
      const existing = next[entity] || {};
      const actions = Object.keys(existing).length > 0 ? Object.keys(existing) : ACTIONS.map(String);
      const updated: Record<string, boolean> = {};
      actions.forEach((a) => { updated[a] = value; });
      next[entity] = updated;
    });
    onUpdateDraft({ entityPermissions: next });
  };

  const toggleCategory = (key: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const resources = Object.keys(currentEp).filter((k) => !k.startsWith("_")).sort();

  const categorizedEntities = useMemo(() => {
    const assigned = new Set<string>();
    const result: { key: string; label: string; entities: string[] }[] = [];
    Object.entries(ENTITY_CATEGORIES).forEach(([key, cat]) => {
      cat.entities.forEach((e) => assigned.add(e));
      result.push({ key, label: cat.label, entities: cat.entities });
    });
    const uncategorized = resources.filter((e) => !assigned.has(e));
    if (uncategorized.length > 0) result.push({ key: "uncategorized", label: "Other Permissions", entities: uncategorized });
    return result;
  }, [resources]);

  const filteredCategories = useMemo(() => {
    if (!permSearch) return categorizedEntities;
    const q = permSearch.toLowerCase();
    return categorizedEntities.map((cat) => ({
      ...cat,
      entities: cat.entities.filter((e) => formatEntityName(e).toLowerCase().includes(q) || cat.label.toLowerCase().includes(q)),
    })).filter((cat) => cat.entities.length > 0);
  }, [categorizedEntities, permSearch]);

  const categorySummary = useMemo(() => {
    const summary: Record<string, { granted: number; total: number }> = {};
    for (const cat of categorizedEntities) {
      let granted = 0;
      const total = cat.entities.length * ACTIONS.length;
      for (const entity of cat.entities) {
        for (const action of ACTIONS) {
          const state = getPermissionState(entity, action, currentEp, normalizedRole);
          if (state.allowed) granted++;
        }
      }
      summary[cat.key] = { granted, total };
    }
    return summary;
  }, [categorizedEntities, currentEp, normalizedRole]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-8 text-sm bg-gray-50 border-gray-200" placeholder="Filter permissions..." value={permSearch} onChange={(e) => setPermSearch(e.target.value)} data-testid="input-search-permissions" />
        </div>
        {canManageRoles && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => bulkUpdateCategory(allEntities, true)} data-testid="button-grant-all-global">Grant All</Button>
            <Button size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={() => bulkUpdateCategory(allEntities, false)} data-testid="button-revoke-all-global">Revoke All</Button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[10px] text-muted-foreground px-1">
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded border bg-emerald-100 border-emerald-300" /><span>Role override (granted)</span></div>
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded border bg-blue-50 border-blue-200" /><span>Default (granted)</span></div>
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded border bg-red-50 border-red-200" /><span>Role override (denied)</span></div>
        <div className="flex items-center gap-1"><div className="h-3 w-3 rounded border bg-gray-50 border-gray-200" /><span>No access</span></div>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
        <TooltipProvider delayDuration={200}>
          <table className="w-full text-sm" data-testid="permissions-table">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600 w-[200px] bg-gray-50">Entity</th>
                {ACTIONS.map((a) => (
                  <th key={a} className="text-center px-1.5 py-2 text-xs font-semibold text-gray-600 capitalize w-[70px] bg-gray-50">
                    <div className="flex items-center justify-center gap-1">{ACTION_ICONS[a]}{a}</div>
                  </th>
                ))}
                {canManageRoles && <th className="w-[80px] bg-gray-50" />}
              </tr>
            </thead>
            <tbody>
              {filteredCategories.length === 0 && (
                <tr><td colSpan={ACTIONS.length + (canManageRoles ? 2 : 1)} className="text-center py-8 text-sm text-muted-foreground">No permissions match "{permSearch}"</td></tr>
              )}
              {filteredCategories.map((cat) => {
                const summary = categorySummary[cat.key];
                const isCollapsed = collapsedCategories.has(cat.key);
                const pct = summary ? Math.round((summary.granted / summary.total) * 100) : 0;
                return (
                  <React.Fragment key={cat.key}>
                    <tr className="bg-gray-50/80 cursor-pointer" onClick={() => toggleCategory(cat.key)}>
                      <td colSpan={ACTIONS.length + (canManageRoles ? 2 : 1)} className="px-3 py-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isCollapsed ? <ChevronRight className="h-3 w-3 text-gray-400" /> : <ChevronDown className="h-3 w-3 text-gray-400" />}
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{cat.label}</span>
                            {summary && (
                              <div className="flex items-center gap-1.5 ml-2">
                                <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full transition-all ${pct > 75 ? "bg-emerald-500" : pct > 25 ? "bg-amber-500" : "bg-gray-400"}`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-[10px] text-gray-400 font-medium">{summary.granted}/{summary.total}</span>
                              </div>
                            )}
                          </div>
                          {canManageRoles && (
                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                              <button type="button" onClick={() => bulkUpdateCategory(cat.entities, true)} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium" data-testid={`grant-category-${cat.key}`}>Grant all</button>
                              <button type="button" onClick={() => bulkUpdateCategory(cat.entities, false)} className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium" data-testid={`revoke-category-${cat.key}`}>Revoke all</button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed && cat.entities.map((entity) => {
                      return (
                        <tr key={entity} className="border-t border-gray-100 hover:bg-gray-50/50" data-testid={`perm-row-${entity}`}>
                          <td className="px-3 py-2">
                            <div className="text-xs font-medium text-gray-800">{formatEntityName(entity)}</div>
                            {ENTITY_DESCRIPTIONS[entity] && <div className="text-[10px] text-muted-foreground leading-tight">{ENTITY_DESCRIPTIONS[entity]}</div>}
                          </td>
                          {ACTIONS.map((action) => {
                            const state = getPermissionState(entity, action, currentEp, normalizedRole);
                            const cellColor = state.allowed
                              ? state.source === "role_override" ? SOURCE_COLORS.role_override_on : SOURCE_COLORS.default_on
                              : state.source === "role_override" ? SOURCE_COLORS.role_override_off : SOURCE_COLORS.no_access;

                            const tooltipText = state.allowed
                              ? state.source === "role_override"
                                ? `Granted via role override`
                                : `Granted via default (${normalizedRole} in ${action}_roles)`
                              : state.source === "role_override"
                                ? `Denied via role override`
                                : `No access (not in defaults)`;

                            return (
                              <td key={action} className="text-center px-1.5 py-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button type="button" disabled={!canManageRoles} onClick={() => updateEp(entity, action, !state.allowed)}
                                      className={`inline-flex items-center justify-center h-7 w-7 rounded-md border transition-all ${canManageRoles ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${cellColor}`}
                                      title={`${state.allowed ? "Revoke" : "Grant"} ${action} on ${formatEntityName(entity)}`}
                                      data-testid={`toggle-${entity}-${action}`}
                                    >
                                      {state.allowed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                                    <p className="font-medium">{formatEntityName(entity)} · {action}</p>
                                    <p className="text-muted-foreground">{tooltipText}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </td>
                            );
                          })}
                          {canManageRoles && (
                            <td className="text-center px-1.5 py-2">
                              <div className="flex gap-0.5 justify-center">
                                <button type="button" onClick={() => ACTIONS.forEach((a) => updateEp(entity, a, true))} className="text-[9px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100" title="Grant all" data-testid={`grant-all-${entity}`}>All</button>
                                <button type="button" onClick={() => ACTIONS.forEach((a) => updateEp(entity, a, false))} className="text-[9px] px-1 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100" title="Revoke all" data-testid={`revoke-all-${entity}`}>None</button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </TooltipProvider>
      </div>
    </div>
  );
}
