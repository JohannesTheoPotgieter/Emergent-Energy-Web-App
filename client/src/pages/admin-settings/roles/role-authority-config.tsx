import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, Globe, Search, Building2, User, FolderOpen, Shield } from "lucide-react";
import type { RoleSummary } from "../settings-types";
import { ENTITY_CATEGORIES, ENTITY_DESCRIPTIONS, formatEntityName } from "../settings-types";

const AUTHORITY_ACTIONS = ["view", "create", "edit", "delete", "approve", "assign", "reassign", "close_complete", "export", "manage_settings"] as const;
type AuthorityAction = typeof AUTHORITY_ACTIONS[number];

// Short labels for column headers
const ACTION_SHORT: Record<string, string> = {
  view: "V",
  create: "C",
  edit: "E",
  delete: "D",
  approve: "A",
  assign: "As",
  reassign: "Re",
  close_complete: "Cl",
  export: "Ex",
  manage_settings: "Ms",
};

const AUTHORITY_SCOPES = [
  { value: "own", label: "Own", icon: User, color: "bg-gray-100 text-gray-700 border-gray-300", short: "O" },
  { value: "department", label: "Department", icon: Building2, color: "bg-blue-50 text-blue-700 border-blue-200", short: "D" },
  { value: "assigned_projects", label: "Assigned Projects", icon: FolderOpen, color: "bg-amber-50 text-amber-700 border-amber-200", short: "P" },
  { value: "all_projects", label: "All Projects", icon: Globe, color: "bg-emerald-50 text-emerald-700 border-emerald-200", short: "A" },
  { value: "company_admin", label: "Company Admin", icon: Shield, color: "bg-violet-50 text-violet-700 border-violet-200", short: "C" },
] as const;

// Cycle order for clicking
const SCOPE_CYCLE = ["", "own", "department", "assigned_projects", "all_projects", "company_admin"] as const;

function getScopeStyle(scope: string | null) {
  const found = AUTHORITY_SCOPES.find(s => s.value === scope);
  if (!found) return { color: "bg-gray-50 text-gray-300 border-gray-200", short: "—", label: "No scope" };
  return found;
}

interface RoleAuthorityConfigProps {
  role: RoleSummary;
  draft: Partial<RoleSummary>;
  onUpdateDraft: (update: Partial<RoleSummary>) => void;
  canManageRoles: boolean;
}

export function RoleAuthorityConfig({ role, draft, onUpdateDraft, canManageRoles }: RoleAuthorityConfigProps) {
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const effectiveModel = (draft.authorityModel ?? role.authorityModel) as { rules?: Record<string, { enabled?: boolean; scope?: string }> } | null;
  const rules = effectiveModel?.rules || {};

  const updateRule = (entityAction: string, scope: string) => {
    const nextRules = { ...rules, [entityAction]: { enabled: true, scope } };
    onUpdateDraft({ authorityModel: { ...effectiveModel, rules: nextRules } });
  };

  const removeRule = (entityAction: string) => {
    const nextRules = { ...rules };
    delete nextRules[entityAction];
    onUpdateDraft({ authorityModel: { ...effectiveModel, rules: nextRules } });
  };

  const cycleScope = (entity: string, action: string) => {
    if (!canManageRoles) return;
    const ruleKey = `${entity}.${action}`;
    const currentScope = rules[ruleKey]?.scope || "";
    const currentIdx = SCOPE_CYCLE.indexOf(currentScope as any);
    const nextIdx = (currentIdx + 1) % SCOPE_CYCLE.length;
    const nextScope = SCOPE_CYCLE[nextIdx];
    if (nextScope === "") {
      removeRule(ruleKey);
    } else {
      updateRule(ruleKey, nextScope);
    }
  };

  const toggleCategory = (key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const filteredCategories = useMemo(() => {
    const cats = Object.entries(ENTITY_CATEGORIES).map(([key, cat]) => ({
      key, label: cat.label, entities: cat.entities,
    }));
    if (!search) return cats;
    const q = search.toLowerCase();
    return cats.map((cat) => ({
      ...cat,
      entities: cat.entities.filter((e) => formatEntityName(e).toLowerCase().includes(q) || cat.label.toLowerCase().includes(q)),
    })).filter((cat) => cat.entities.length > 0);
  }, [search]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, { configured: number; total: number }> = {};
    for (const [key, val] of Object.entries(ENTITY_CATEGORIES)) {
      let count = 0;
      for (const entity of val.entities) {
        for (const action of AUTHORITY_ACTIONS) {
          if (rules[`${entity}.${action}`]?.enabled) count++;
        }
      }
      counts[key] = { configured: count, total: val.entities.length * AUTHORITY_ACTIONS.length };
    }
    return counts;
  }, [rules]);

  const isExpanded = (key: string) => search ? true : expandedCategories.has(key);

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-7 text-xs bg-gray-50 border-gray-200" placeholder="Filter entities..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Scope Legend — compact inline */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2 text-[9px]">
        <span className="text-muted-foreground">Scopes:</span>
        {AUTHORITY_SCOPES.map((scope) => (
          <span key={scope.value} className={`rounded border px-1 py-0 font-medium ${scope.color}`}>{scope.short} = {scope.label}</span>
        ))}
        <span className="text-muted-foreground ml-1">Click cells to cycle</span>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
        <TooltipProvider delayDuration={150}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left pl-3 pr-1 py-1.5 text-[10px] font-semibold text-gray-600 bg-gray-50" style={{ minWidth: 140 }}>ENTITY</th>
                {AUTHORITY_ACTIONS.map((a) => (
                  <th key={a} className="text-center px-0 py-1.5 text-[10px] font-semibold text-gray-600 bg-gray-50" style={{ width: 30 }}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default">{ACTION_SHORT[a]}</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[10px] capitalize">{a.replace("_", " ")}</TooltipContent>
                    </Tooltip>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCategories.map((cat) => {
                const counts = categoryCounts[cat.key];
                const expanded = isExpanded(cat.key);
                const pct = counts ? Math.round((counts.configured / counts.total) * 100) : 0;

                return (
                  <React.Fragment key={cat.key}>
                    <tr className="bg-gray-50/80 cursor-pointer hover:bg-gray-100/60" onClick={() => toggleCategory(cat.key)}>
                      <td colSpan={AUTHORITY_ACTIONS.length + 1} className="px-2 py-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {expanded ? <ChevronDown className="h-3 w-3 text-gray-400" /> : <ChevronRight className="h-3 w-3 text-gray-400" />}
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{cat.label}</span>
                            {counts && counts.configured > 0 && (
                              <Badge variant="secondary" className="text-[8px] px-1 h-3.5 bg-violet-100 text-violet-600 border-violet-200">
                                {counts.configured} rules
                              </Badge>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                    {expanded && cat.entities.map((entity) => {
                      const desc = ENTITY_DESCRIPTIONS[entity];
                      return (
                        <tr key={entity} className="border-t border-gray-100 hover:bg-gray-50/50">
                          <td className="pl-3 pr-1 py-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-[11px] font-medium text-gray-800 cursor-default truncate block max-w-[160px]">{formatEntityName(entity)}</span>
                              </TooltipTrigger>
                              {desc && (
                                <TooltipContent side="right" className="text-[10px] max-w-[220px]">
                                  <p>{desc}</p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </td>
                          {AUTHORITY_ACTIONS.map((action) => {
                            const ruleKey = `${entity}.${action}`;
                            const rule = rules[ruleKey];
                            const currentScope = rule?.scope || null;
                            const scopeStyle = getScopeStyle(currentScope);

                            return (
                              <td key={action} className="text-center px-0 py-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => cycleScope(entity, action)}
                                      disabled={!canManageRoles}
                                      className={`inline-flex items-center justify-center rounded border text-[9px] font-bold transition-all ${canManageRoles ? "cursor-pointer hover:scale-110" : "cursor-not-allowed opacity-60"} ${scopeStyle.color}`}
                                      style={{ height: 22, width: 22 }}
                                    >
                                      {scopeStyle.short}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-[10px]">
                                    <p className="font-medium">{formatEntityName(entity)} · {action.replace("_", " ")}</p>
                                    <p className="text-muted-foreground">Scope: {scopeStyle.label}</p>
                                    {canManageRoles && <p className="text-muted-foreground italic">Click to cycle scope</p>}
                                  </TooltipContent>
                                </Tooltip>
                              </td>
                            );
                          })}
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
