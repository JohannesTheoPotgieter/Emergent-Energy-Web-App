import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Compass, Search, Eye, EyeOff } from "lucide-react";
import { NAV_SECTIONS } from "../settings-types";
import type { RoleSummary } from "../settings-types";
import { TOP_SECTIONS } from "@/config/app-navigation";

interface RoleNavAccessProps {
  role: RoleSummary;
  draft: Partial<RoleSummary>;
  onUpdateDraft: (update: Partial<RoleSummary>) => void;
  canManageRoles: boolean;
}

function getSecondaryItems(sectionKey: string): { label: string; path: string }[] {
  const section = TOP_SECTIONS.find((s) => s.key === sectionKey);
  if (!section) return [];
  return section.secondary.map((item) => ({ label: item.label, path: item.path }));
}

function isSubPageDisabled(sections: string[], sectionKey: string, path: string): boolean {
  return sections.includes(`!${sectionKey}:${path}`);
}

function getEnabledSubPageCount(sections: string[], sectionKey: string): { total: number; enabled: number } {
  const items = getSecondaryItems(sectionKey);
  const sectionEnabled = sections.includes(sectionKey);
  if (!sectionEnabled) return { total: items.length, enabled: 0 };
  const disabled = items.filter((item) => isSubPageDisabled(sections, sectionKey, item.path));
  return { total: items.length, enabled: items.length - disabled.length };
}

export function RoleNavAccess({ role, draft, onUpdateDraft, canManageRoles }: RoleNavAccessProps) {
  const effectiveSections = (draft.sections ?? role.sections) || [];
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const topLevelEnabled = effectiveSections.filter((s) => !s.startsWith("!"));
  const enabledCount = topLevelEnabled.length;

  const filteredSections = useMemo(() => {
    if (!search) return NAV_SECTIONS;
    const q = search.toLowerCase();
    return NAV_SECTIONS.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        getSecondaryItems(s.key).some((item) => item.label.toLowerCase().includes(q))
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
    const next = [...effectiveSections];
    if (checked) {
      if (!next.includes(key)) next.push(key);
      const exclusions = next.filter((s) => s.startsWith(`!${key}:`));
      exclusions.forEach((ex) => {
        const idx = next.indexOf(ex);
        if (idx >= 0) next.splice(idx, 1);
      });
    } else {
      const idx = next.indexOf(key);
      if (idx >= 0) next.splice(idx, 1);
      const exclusions = next.filter((s) => s.startsWith(`!${key}:`));
      exclusions.forEach((ex) => {
        const exIdx = next.indexOf(ex);
        if (exIdx >= 0) next.splice(exIdx, 1);
      });
    }
    onUpdateDraft({ sections: next });
  };

  const toggleSubPage = (sectionKey: string, path: string, checked: boolean) => {
    const exclusionKey = `!${sectionKey}:${path}`;
    const next = [...effectiveSections];
    if (checked) {
      const idx = next.indexOf(exclusionKey);
      if (idx >= 0) next.splice(idx, 1);
    } else {
      if (!next.includes(exclusionKey)) next.push(exclusionKey);
    }
    onUpdateDraft({ sections: next });
  };

  const toggleAllSubPages = (sectionKey: string, value: boolean) => {
    const items = getSecondaryItems(sectionKey);
    const next = [...effectiveSections];
    items.forEach((item) => {
      const exclusionKey = `!${sectionKey}:${item.path}`;
      const idx = next.indexOf(exclusionKey);
      if (value) {
        if (idx >= 0) next.splice(idx, 1);
      } else {
        if (!next.includes(exclusionKey)) next.push(exclusionKey);
      }
    });
    onUpdateDraft({ sections: next });
  };

  const bulkToggle = (keys: string[], value: boolean) => {
    let next = [...effectiveSections];
    if (value) {
      keys.forEach((k) => { if (!next.includes(k)) next.push(k); });
      next = next.filter((s) => !s.startsWith("!"));
    } else {
      next = next.filter((s) => !keys.includes(s) && !s.startsWith("!"));
    }
    onUpdateDraft({ sections: next });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">Navigation Sections</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control which sections and individual pages this role can see.{" "}
            <Badge variant="outline" className="text-[10px] ml-1 font-semibold">
              {enabledCount}/{NAV_SECTIONS.length} sections
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

      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8 h-8 text-sm bg-gray-50 border-gray-200"
          placeholder="Filter sections or pages..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-search-nav-sections"
        />
      </div>

      <div className="rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2">
        <p className="text-xs text-blue-700">
          <span className="font-semibold">Navigation access</span> controls which tabs and pages appear for this role. Toggle entire sections or expand to control individual sub-pages. Disabling a section hides all its pages.
        </p>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {filteredSections.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">No sections match "{search}"</div>
        )}
        {filteredSections.map((section) => {
          const sectionEnabled = effectiveSections.includes(section.key);
          const isExpanded = expanded.has(section.key);
          const secondaryItems = getSecondaryItems(section.key);
          const subPageStats = getEnabledSubPageCount(effectiveSections, section.key);

          return (
            <div key={section.key} className={`transition-colors ${sectionEnabled ? "bg-emerald-50/40" : "bg-white"}`}>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleExpand(section.key)}
                  className="text-gray-400 hover:text-gray-600 shrink-0"
                  data-testid={`expand-nav-${section.key}`}
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>

                <input
                  type="checkbox"
                  checked={sectionEnabled}
                  onChange={(e) => toggleSection(section.key, e.target.checked)}
                  disabled={!canManageRoles}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                  data-testid={`checkbox-nav-${section.key}`}
                />

                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(section.key)}>
                  <div className="flex items-center gap-2">
                    <Compass className={`h-3.5 w-3.5 shrink-0 ${sectionEnabled ? "text-emerald-600" : "text-gray-400"}`} />
                    <span className={`text-sm font-semibold ${sectionEnabled ? "text-emerald-800" : "text-gray-700"}`}>
                      {section.label}
                    </span>
                    {secondaryItems.length > 0 && (
                      <Badge variant="outline" className={`text-[9px] font-normal ${
                        sectionEnabled
                          ? subPageStats.enabled < subPageStats.total
                            ? "text-amber-600 border-amber-200 bg-amber-50"
                            : "text-emerald-600 border-emerald-200"
                          : "text-gray-400 border-gray-200"
                      }`}>
                        {sectionEnabled ? `${subPageStats.enabled}/${subPageStats.total} pages` : `${subPageStats.total} pages`}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{section.description}</p>
                </div>

                <Badge
                  variant="outline"
                  className={`text-[9px] shrink-0 ${sectionEnabled ? "text-emerald-600 border-emerald-200 bg-emerald-50" : "text-gray-400 border-gray-200"}`}
                >
                  {sectionEnabled ? "Visible" : "Hidden"}
                </Badge>
              </div>

              {isExpanded && secondaryItems.length > 0 && (
                <div className="px-6 pb-3 pt-0 ml-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                      Pages in this section
                    </div>
                    {canManageRoles && sectionEnabled && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleAllSubPages(section.key, true)}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium border border-emerald-200"
                          data-testid={`button-enable-all-subpages-${section.key}`}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleAllSubPages(section.key, false)}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium border border-red-200"
                          data-testid={`button-disable-all-subpages-${section.key}`}
                        >
                          None
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    {secondaryItems.map((item) => {
                      const subEnabled = sectionEnabled && !isSubPageDisabled(effectiveSections, section.key, item.path);
                      const isDisabledSection = !sectionEnabled;
                      return (
                        <label
                          key={item.path}
                          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${
                            isDisabledSection
                              ? "bg-gray-50 opacity-50 cursor-not-allowed"
                              : subEnabled
                                ? "bg-emerald-50/60 hover:bg-emerald-50"
                                : "bg-white hover:bg-gray-50"
                          }`}
                          data-testid={`subpage-row-${section.key}-${item.path.replace(/\//g, "-")}`}
                        >
                          <input
                            type="checkbox"
                            checked={subEnabled}
                            onChange={(e) => toggleSubPage(section.key, item.path, e.target.checked)}
                            disabled={!canManageRoles || isDisabledSection}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                            data-testid={`checkbox-subpage-${section.key}-${item.path.replace(/\//g, "-")}`}
                          />
                          {subEnabled ? (
                            <Eye className="h-3 w-3 text-emerald-500 shrink-0" />
                          ) : (
                            <EyeOff className="h-3 w-3 text-gray-300 shrink-0" />
                          )}
                          <span className={`text-xs font-medium ${
                            isDisabledSection
                              ? "text-gray-400"
                              : subEnabled
                                ? "text-emerald-700"
                                : "text-gray-400 line-through"
                          }`}>
                            {item.label}
                          </span>
                          <span className="text-[10px] text-gray-400 ml-auto font-mono">
                            {item.path}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

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
