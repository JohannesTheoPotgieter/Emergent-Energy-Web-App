import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Compass, Search } from "lucide-react";
import { NAV_SECTIONS } from "../settings-types";
import type { RoleSummary } from "../settings-types";
import { TOP_SECTIONS } from "@/config/app-navigation";

interface RoleNavAccessProps {
  role: RoleSummary;
  draft: Partial<RoleSummary>;
  onUpdateDraft: (update: Partial<RoleSummary>) => void;
  canManageRoles: boolean;
}

/** Map nav section keys to their secondary (sub-page) items from the live navigation config */
function getSecondaryItems(sectionKey: string): string[] {
  const section = TOP_SECTIONS.find((s) => s.key === sectionKey);
  if (!section) return [];
  return section.secondary.map((item) => item.label);
}

export function RoleNavAccess({ role, draft, onUpdateDraft, canManageRoles }: RoleNavAccessProps) {
  const effectiveSections = (draft.sections ?? role.sections) || [];
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const enabledCount = effectiveSections.length;

  const filteredSections = useMemo(() => {
    if (!search) return NAV_SECTIONS;
    const q = search.toLowerCase();
    return NAV_SECTIONS.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        getSecondaryItems(s.key).some((item) => item.toLowerCase().includes(q))
    );
  }, [search]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSection = (key: string, checked: boolean) => {
    const next = new Set(effectiveSections);
    if (checked) next.add(key); else next.delete(key);
    onUpdateDraft({ sections: [...next] });
  };

  const bulkToggle = (keys: string[], value: boolean) => {
    const next = new Set(effectiveSections);
    keys.forEach((k) => { if (value) next.add(k); else next.delete(k); });
    onUpdateDraft({ sections: [...next] });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">Navigation Sections</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control which top-level sections this role can see in the sidebar.{" "}
            <Badge variant="outline" className="text-[10px] ml-1 font-semibold">
              {enabledCount}/{NAV_SECTIONS.length} enabled
            </Badge>
          </p>
        </div>
        {canManageRoles && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => bulkToggle(NAV_SECTIONS.map((s) => s.key), true)}
              className="text-[10px] px-2 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium border border-emerald-200"
              data-testid="button-enable-all-nav"
            >
              Enable All
            </button>
            <button
              type="button"
              onClick={() => bulkToggle(NAV_SECTIONS.map((s) => s.key), false)}
              className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium border border-red-200"
              data-testid="button-disable-all-nav"
            >
              Disable All
            </button>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8 h-8 text-sm bg-gray-50 border-gray-200"
          placeholder="Filter sections..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-search-nav-sections"
        />
      </div>

      {/* Info banner */}
      <div className="rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2">
        <p className="text-xs text-blue-700">
          <span className="font-semibold">Navigation access</span> controls which top-level tabs appear in the sidebar. Expand each section to see the pages it contains. Permissions for individual actions within each section are managed separately on the <span className="font-semibold">Permissions</span> tab.
        </p>
      </div>

      {/* Sections list */}
      <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {filteredSections.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">No sections match "{search}"</div>
        )}
        {filteredSections.map((section) => {
          const checked = effectiveSections.includes(section.key);
          const isExpanded = expanded.has(section.key);
          const secondaryItems = getSecondaryItems(section.key);

          return (
            <div key={section.key} className={`transition-colors ${checked ? "bg-emerald-50/40" : "bg-white"}`}>
              {/* Section row */}
              <div className="flex items-center gap-3 px-3 py-2.5">
                {/* Expand toggle */}
                <button
                  type="button"
                  onClick={() => toggleExpand(section.key)}
                  className="text-gray-400 hover:text-gray-600 shrink-0"
                  data-testid={`expand-nav-${section.key}`}
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>

                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggleSection(section.key, e.target.checked)}
                  disabled={!canManageRoles}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                  data-testid={`checkbox-nav-${section.key}`}
                />

                {/* Label & description */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(section.key)}>
                  <div className="flex items-center gap-2">
                    <Compass className={`h-3.5 w-3.5 shrink-0 ${checked ? "text-emerald-600" : "text-gray-400"}`} />
                    <span className={`text-sm font-semibold ${checked ? "text-emerald-800" : "text-gray-700"}`}>
                      {section.label}
                    </span>
                    {secondaryItems.length > 0 && (
                      <Badge variant="outline" className="text-[9px] font-normal text-gray-400 border-gray-200">
                        {secondaryItems.length} pages
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{section.description}</p>
                </div>

                {/* Status badge */}
                <Badge
                  variant="outline"
                  className={`text-[9px] shrink-0 ${checked ? "text-emerald-600 border-emerald-200 bg-emerald-50" : "text-gray-400 border-gray-200"}`}
                >
                  {checked ? "Visible" : "Hidden"}
                </Badge>
              </div>

              {/* Expanded detail: secondary items */}
              {isExpanded && secondaryItems.length > 0 && (
                <div className="px-12 pb-3 pt-0">
                  <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                    Pages in this section
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {secondaryItems.map((item) => (
                      <span
                        key={item}
                        className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${
                          checked
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-gray-50 text-gray-400 border-gray-200"
                        }`}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick-assign presets */}
      {canManageRoles && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
          <div className="text-xs font-semibold text-gray-600 mb-2">Quick Presets</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onUpdateDraft({ sections: ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "HSE", "ENGINEERING", "QUALITY", "FINANCE", "REPORTS", "ADMIN"] })}
              className="text-[10px] px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 font-medium"
              data-testid="preset-full-access"
            >
              Full Access (all sections)
            </button>
            <button
              type="button"
              onClick={() => onUpdateDraft({ sections: ["HOME", "PROJECT_DELIVERY", "QUALITY", "HSE", "FINANCE", "REPORTS"] })}
              className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium"
              data-testid="preset-site-pm"
            >
              Site PM (Delivery + Finance + Reports)
            </button>
            <button
              type="button"
              onClick={() => onUpdateDraft({ sections: ["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "FINANCE", "REPORTS"] })}
              className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium"
              data-testid="preset-commercial"
            >
              Commercial (PD + Finance + Reports)
            </button>
            <button
              type="button"
              onClick={() => onUpdateDraft({ sections: ["HOME", "ENGINEERING", "QUALITY"] })}
              className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium"
              data-testid="preset-engineer"
            >
              Engineer (Engineering + Quality)
            </button>
            <button
              type="button"
              onClick={() => onUpdateDraft({ sections: ["HOME", "PORTFOLIO", "FINANCE", "PROJECT_DELIVERY", "REPORTS"] })}
              className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium"
              data-testid="preset-finance"
            >
              Finance (Finance + Delivery + Reports)
            </button>
            <button
              type="button"
              onClick={() => onUpdateDraft({ sections: ["HOME", "HSE", "QUALITY", "ENGINEERING"] })}
              className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium"
              data-testid="preset-hse"
            >
              HSE / SSEG (HSE + Quality + Engineering)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
