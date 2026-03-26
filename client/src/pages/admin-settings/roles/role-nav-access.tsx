import React from "react";
import { NAV_SECTIONS } from "../settings-types";
import type { RoleSummary } from "../settings-types";

interface RoleNavAccessProps {
  role: RoleSummary;
  draft: Partial<RoleSummary>;
  onUpdateDraft: (update: Partial<RoleSummary>) => void;
  canManageRoles: boolean;
}

export function RoleNavAccess({ role, draft, onUpdateDraft, canManageRoles }: RoleNavAccessProps) {
  const effectiveSections = (draft.sections ?? role.sections) || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">Navigation Sections</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control which top-level sections this role can see in the sidebar. {effectiveSections.length}/{NAV_SECTIONS.length} enabled.
          </p>
        </div>
        {canManageRoles && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onUpdateDraft({ sections: NAV_SECTIONS.map((s) => s.key) })}
              className="text-[10px] px-2 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium border border-emerald-200"
            >
              Enable All
            </button>
            <button
              type="button"
              onClick={() => onUpdateDraft({ sections: [] })}
              className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium border border-red-200"
            >
              Disable All
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {NAV_SECTIONS.map((section) => {
          const checked = effectiveSections.includes(section.key);
          return (
            <label key={section.key}
              className={`flex items-center gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors ${checked ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
            >
              <input type="checkbox" checked={checked}
                onChange={(e) => {
                  const next = new Set(effectiveSections);
                  if (e.target.checked) next.add(section.key); else next.delete(section.key);
                  onUpdateDraft({ sections: [...next] });
                }}
                disabled={!canManageRoles}
                className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                data-testid={`checkbox-nav-${section.key}`}
              />
              <div className="min-w-0">
                <span className={`text-sm font-semibold block ${checked ? "text-emerald-800" : "text-gray-700"}`}>{section.label}</span>
                <span className="text-[11px] text-muted-foreground">{section.description}</span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
