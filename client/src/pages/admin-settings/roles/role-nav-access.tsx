import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  const applyPreset = (sections: string[]) => {
    onUpdateDraft({ sections });
  };

  return (
    <div className="space-y-3 pt-3">
      {/* Quick Presets — inline at the top */}
      {canManageRoles && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] text-muted-foreground font-medium self-center mr-1">Presets:</span>
          <button type="button" onClick={() => applyPreset(["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "PROJECT_DELIVERY", "HSE", "ENGINEERING", "QUALITY", "FINANCE", "REPORTS", "ADMIN"])}
            className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 font-medium" data-testid="preset-full-access">
            Full Access
          </button>
          <button type="button" onClick={() => applyPreset(["HOME", "PROJECT_DELIVERY", "QUALITY", "HSE", "FINANCE", "REPORTS"])}
            className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium" data-testid="preset-site-pm">
            Site PM
          </button>
          <button type="button" onClick={() => applyPreset(["HOME", "PORTFOLIO", "PROJECT_DEVELOPMENT", "FINANCE", "REPORTS"])}
            className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium" data-testid="preset-commercial">
            Commercial
          </button>
          <button type="button" onClick={() => applyPreset(["HOME", "ENGINEERING", "QUALITY"])}
            className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium" data-testid="preset-engineer">
            Engineer
          </button>
          <button type="button" onClick={() => applyPreset(["HOME", "PORTFOLIO", "FINANCE", "PROJECT_DELIVERY", "REPORTS"])}
            className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium" data-testid="preset-finance">
            Finance
          </button>
          <button type="button" onClick={() => applyPreset(["HOME", "PROJECT_DELIVERY", "HSE", "QUALITY", "ENGINEERING"])}
            className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium" data-testid="preset-hse">
            HSE / SSEG
          </button>
        </div>
      )}

      {/* Section toggles — compact list */}
      <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {NAV_SECTIONS.map((section) => {
          const sectionEnabled = effectiveSections.includes(section.key);
          const isExpanded = expanded.has(section.key);
          const secondaryItems = getSecondaryItems(section.key);
          const subPageStats = getEnabledSubPageCount(effectiveSections, section.key);

          return (
            <div key={section.key} className={`transition-colors ${sectionEnabled ? "bg-emerald-50/30" : "bg-white"}`}>
              <div className="flex items-center gap-2.5 px-3 py-2">
                {secondaryItems.length > 0 && (
                  <button type="button" onClick={() => toggleExpand(section.key)} className="text-gray-400 hover:text-gray-600 shrink-0" data-testid={`expand-nav-${section.key}`}>
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                )}
                {secondaryItems.length === 0 && <div className="w-3.5" />}

                <input
                  type="checkbox"
                  checked={sectionEnabled}
                  onChange={(e) => toggleSection(section.key, e.target.checked)}
                  disabled={!canManageRoles}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                  data-testid={`checkbox-nav-${section.key}`}
                />

                <div className="flex-1 min-w-0 flex items-center gap-2" onClick={() => secondaryItems.length > 0 ? toggleExpand(section.key) : undefined}>
                  <span className={`text-xs font-medium ${sectionEnabled ? "text-emerald-800" : "text-gray-600"}`}>
                    {section.label}
                  </span>
                  {secondaryItems.length > 0 && sectionEnabled && subPageStats.enabled < subPageStats.total && (
                    <Badge variant="outline" className="text-[9px] font-normal text-amber-600 border-amber-200 bg-amber-50">
                      {subPageStats.enabled}/{subPageStats.total}
                    </Badge>
                  )}
                </div>

                <span className={`text-[10px] shrink-0 ${sectionEnabled ? "text-emerald-600" : "text-gray-400"}`}>
                  {sectionEnabled ? "Visible" : "Hidden"}
                </span>
              </div>

              {isExpanded && secondaryItems.length > 0 && (
                <div className="px-6 pb-2.5 pt-0 ml-6">
                  {canManageRoles && sectionEnabled && (
                    <div className="flex gap-1.5 mb-1.5">
                      <button type="button" onClick={() => toggleAllSubPages(section.key, true)}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium border border-emerald-200" data-testid={`button-enable-all-subpages-${section.key}`}>
                        All
                      </button>
                      <button type="button" onClick={() => toggleAllSubPages(section.key, false)}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium border border-red-200" data-testid={`button-disable-all-subpages-${section.key}`}>
                        None
                      </button>
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {secondaryItems.map((item) => {
                      const subEnabled = sectionEnabled && !isSubPageDisabled(effectiveSections, section.key, item.path);
                      const isDisabledSection = !sectionEnabled;
                      return (
                        <label
                          key={item.path}
                          className={`flex items-center gap-2 px-2 py-1 rounded transition-colors cursor-pointer ${
                            isDisabledSection ? "opacity-40 cursor-not-allowed" : subEnabled ? "hover:bg-emerald-50" : "hover:bg-gray-50"
                          }`}
                          data-testid={`subpage-row-${section.key}-${item.path.replace(/\//g, "-")}`}
                        >
                          <input
                            type="checkbox"
                            checked={subEnabled}
                            onChange={(e) => toggleSubPage(section.key, item.path, e.target.checked)}
                            disabled={!canManageRoles || isDisabledSection}
                            className="h-3 w-3 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                            data-testid={`checkbox-subpage-${section.key}-${item.path.replace(/\//g, "-")}`}
                          />
                          {subEnabled ? <Eye className="h-3 w-3 text-emerald-500 shrink-0" /> : <EyeOff className="h-3 w-3 text-gray-300 shrink-0" />}
                          <span className={`text-[11px] ${isDisabledSection ? "text-gray-400" : subEnabled ? "text-gray-700" : "text-gray-400 line-through"}`}>
                            {item.label}
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
    </div>
  );
}
