import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Globe, Search, Building2, User, FolderOpen, Shield } from "lucide-react";
import type { RoleSummary } from "../settings-types";
import { ENTITY_CATEGORIES, ENTITY_DESCRIPTIONS, formatEntityName } from "../settings-types";

const AUTHORITY_ACTIONS = ["view", "create", "edit", "delete", "approve", "assign", "reassign", "close_complete", "export", "manage_settings"] as const;
type AuthorityAction = typeof AUTHORITY_ACTIONS[number];

const AUTHORITY_SCOPES = [
  { value: "own", label: "Own", icon: User, color: "bg-gray-100 text-gray-700 border-gray-300" },
  { value: "department", label: "Department", icon: Building2, color: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "assigned_projects", label: "Assigned Projects", icon: FolderOpen, color: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "all_projects", label: "All Projects", icon: Globe, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "company_admin", label: "Company Admin", icon: Shield, color: "bg-violet-50 text-violet-700 border-violet-200" },
] as const;

interface RoleAuthorityConfigProps {
  role: RoleSummary;
  draft: Partial<RoleSummary>;
  onUpdateDraft: (update: Partial<RoleSummary>) => void;
  canManageRoles: boolean;
}

export function RoleAuthorityConfig({ role, draft, onUpdateDraft, canManageRoles }: RoleAuthorityConfigProps) {
  const [search, setSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

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

  const toggleCategory = (key: string) => {
    setCollapsedCategories((prev) => {
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

  // Count configured rules per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of Object.entries(ENTITY_CATEGORIES)) {
      const [key, val] = cat;
      let count = 0;
      for (const entity of val.entities) {
        for (const action of AUTHORITY_ACTIONS) {
          if (rules[`${entity}.${action}`]?.enabled) count++;
        }
      }
      counts[key] = count;
    }
    return counts;
  }, [rules]);

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-gray-800">Authority & Scope Rules</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          Define the scope of authority for each entity-action pair. This controls how far a role's permissions reach
          (e.g., can they only manage their own items, or everything in a department).
        </p>
      </div>

      {/* Scope Legend */}
      <div className="flex flex-wrap gap-2">
        {AUTHORITY_SCOPES.map((scope) => {
          const Icon = scope.icon;
          return (
            <div key={scope.value} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium ${scope.color}`}>
              <Icon className="h-3 w-3" />
              {scope.label}
            </div>
          );
        })}
      </div>

      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8 h-8 text-sm bg-gray-50 border-gray-200" placeholder="Filter entities..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[55vh] overflow-y-auto">
        {filteredCategories.map((cat) => {
          const isCollapsed = collapsedCategories.has(cat.key);
          const configuredCount = categoryCounts[cat.key] || 0;

          return (
            <div key={cat.key}>
              <div
                className="bg-gray-50/80 px-3 py-1.5 cursor-pointer border-b border-gray-200 flex items-center justify-between"
                onClick={() => toggleCategory(cat.key)}
              >
                <div className="flex items-center gap-2">
                  {isCollapsed ? <ChevronRight className="h-3 w-3 text-gray-400" /> : <ChevronDown className="h-3 w-3 text-gray-400" />}
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{cat.label}</span>
                  {configuredCount > 0 && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 h-4 bg-violet-100 text-violet-600 border-violet-200">
                      {configuredCount} rules
                    </Badge>
                  )}
                </div>
              </div>
              {!isCollapsed && cat.entities.map((entity) => (
                <div key={entity} className="px-3 py-2 border-b border-gray-100 last:border-b-0">
                  <div className="text-xs font-medium text-gray-800 mb-1.5">{formatEntityName(entity)}</div>
                  {ENTITY_DESCRIPTIONS[entity] && <div className="text-[10px] text-muted-foreground mb-2">{ENTITY_DESCRIPTIONS[entity]}</div>}
                  <div className="flex flex-wrap gap-1.5">
                    {AUTHORITY_ACTIONS.map((action) => {
                      const ruleKey = `${entity}.${action}`;
                      const rule = rules[ruleKey];
                      const currentScope = rule?.scope || null;

                      return (
                        <div key={action} className="flex items-center gap-0.5">
                          <span className="text-[10px] text-gray-500 w-16 text-right mr-1">{action}</span>
                          <select
                            value={currentScope || ""}
                            onChange={(e) => {
                              if (e.target.value) updateRule(ruleKey, e.target.value);
                              else removeRule(ruleKey);
                            }}
                            disabled={!canManageRoles}
                            className="text-[10px] h-6 rounded border border-gray-200 bg-white px-1 py-0 text-gray-700 focus:border-violet-300 focus:ring-1 focus:ring-violet-200 disabled:opacity-50"
                          >
                            <option value="">—</option>
                            {AUTHORITY_SCOPES.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
