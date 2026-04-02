import React, { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { NAVIGATION_PERMISSION_MODEL, type AccessLevel } from "@/config/navigation-permissions";
import type { RoleSummary } from "../settings-types";

interface RoleNavAccessProps {
  role: RoleSummary;
  draft: Partial<RoleSummary>;
  onUpdateDraft: (update: Partial<RoleSummary>) => void;
  canManageRoles: boolean;
}

function basePath(path: string) {
  return path.split("?")[0] || path;
}

function isSubPageDisabled(sections: string[], sectionKey: string, path: string): boolean {
  return sections.includes(`!${sectionKey}:${path}`) || sections.includes(`!${sectionKey}:${basePath(path)}`);
}

function updateSubPageExclusion(next: string[], sectionKey: string, path: string, disabled: boolean) {
  const rawKey = `!${sectionKey}:${path}`;
  const baseKey = `!${sectionKey}:${basePath(path)}`;
  const removeKeys = [rawKey, baseKey];

  removeKeys.forEach((k) => {
    const idx = next.indexOf(k);
    if (idx >= 0) next.splice(idx, 1);
  });

  if (disabled) {
    next.push(baseKey);
  }
}

function AccessPill({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: AccessLevel;
  onChange: (next: AccessLevel) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const options: Array<{ value: AccessLevel; label: string }> = [
    { value: "none", label: "No access" },
    { value: "view", label: "View" },
    { value: "edit", label: "Edit" },
  ];

  return (
    <div className={`inline-flex rounded-md border border-gray-200 bg-white ${compact ? "text-[10px]" : "text-xs"}`}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            disabled={disabled}
            className={`px-2.5 py-1 font-medium transition-colors ${active ? "bg-emerald-600 text-white" : "text-gray-600 hover:bg-gray-50"} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function RoleNavAccess({ role, draft, onUpdateDraft, canManageRoles }: RoleNavAccessProps) {
  const sections = (draft.sections ?? role.sections) || [];
  const entityPermissions = ((draft.entityPermissions ?? role.entityPermissions) || {}) as Record<string, Record<string, boolean>>;

  const setNext = (nextSections: string[], nextEntityPermissions: Record<string, Record<string, boolean>>) => {
    onUpdateDraft({ sections: nextSections, entityPermissions: nextEntityPermissions });
  };

  const resolveItemLevel = (sectionKey: string, path: string, permissionEntity?: string): AccessLevel => {
    const sectionEnabled = sections.includes(sectionKey);
    if (!sectionEnabled || isSubPageDisabled(sections, sectionKey, path)) return "none";
    if (!permissionEntity) return "view";

    const entityPerm = entityPermissions[permissionEntity] || {};
    if (entityPerm.view === false) return "none";
    if (entityPerm.edit === true) return "edit";
    return "view";
  };

  const setItemLevel = (sectionKey: string, path: string, permissionEntity: string | undefined, level: AccessLevel) => {
    const nextSections = [...sections];
    const nextEntityPermissions: Record<string, Record<string, boolean>> = { ...entityPermissions };

    if (!nextSections.includes(sectionKey) && level !== "none") {
      nextSections.push(sectionKey);
    }

    updateSubPageExclusion(nextSections, sectionKey, path, level === "none");

    if (level === "none" && permissionEntity) {
      nextEntityPermissions[permissionEntity] = {
        ...(nextEntityPermissions[permissionEntity] || {}),
        view: false,
        edit: false,
      };
    }

    if (permissionEntity && level !== "none") {
      nextEntityPermissions[permissionEntity] = {
        ...(nextEntityPermissions[permissionEntity] || {}),
        view: true,
        edit: level === "edit",
      };
    }

    setNext(nextSections, nextEntityPermissions);
  };

  const setSectionLevel = (sectionKey: string, level: AccessLevel) => {
    const section = NAVIGATION_PERMISSION_MODEL.find((s) => s.key === sectionKey);
    if (!section) return;

    const nextSections = [...sections.filter((entry) => !entry.startsWith(`!${sectionKey}:`))];
    const nextEntityPermissions: Record<string, Record<string, boolean>> = { ...entityPermissions };

    const keyIdx = nextSections.indexOf(sectionKey);
    if (level === "none") {
      if (keyIdx >= 0) nextSections.splice(keyIdx, 1);
    } else if (keyIdx < 0) {
      nextSections.push(sectionKey);
    }

    for (const item of section.items) {
      updateSubPageExclusion(nextSections, sectionKey, item.path, level === "none");
      if (!item.permissionEntity) continue;
      nextEntityPermissions[item.permissionEntity] = {
        ...(nextEntityPermissions[item.permissionEntity] || {}),
        view: level !== "none",
        edit: level === "edit",
      };
    }

    setNext(nextSections, nextEntityPermissions);
  };

  const sectionLevel = (sectionKey: string): AccessLevel => {
    const section = NAVIGATION_PERMISSION_MODEL.find((s) => s.key === sectionKey);
    if (!section) return "none";

    const levels = section.items.map((item) => resolveItemLevel(sectionKey, item.path, item.permissionEntity));
    if (levels.every((lvl) => lvl === "none")) return "none";
    if (levels.every((lvl) => lvl === "edit")) return "edit";
    return "view";
  };

  const preview = useMemo(() => {
    return NAVIGATION_PERMISSION_MODEL
      .map((section) => {
        const items = section.items.filter((item) => resolveItemLevel(section.key, item.path, item.permissionEntity) !== "none");
        return { label: section.label, items };
      })
      .filter((section) => section.items.length > 0);
  }, [sections, entityPermissions]);

  return (
    <div className="space-y-4 pt-3">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-xs font-semibold text-emerald-800">What this role will see</p>
        {preview.length === 0 ? (
          <p className="text-xs text-emerald-700 mt-1">No pages are visible.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {preview.map((section) => (
              <div key={section.label} className="text-xs">
                <span className="font-medium text-emerald-900">{section.label}:</span>{" "}
                <span className="text-emerald-800">{section.items.map((item) => item.itemLabel).join(", ")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {NAVIGATION_PERMISSION_MODEL.map((section) => {
          const currentSectionLevel = sectionLevel(section.key);
          return (
            <div key={section.key} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{section.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{section.helpText}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">Section access</Badge>
                  <AccessPill value={currentSectionLevel} onChange={(level) => setSectionLevel(section.key, level)} disabled={!canManageRoles} />
                </div>
              </div>

              <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                {section.items.map((item) => {
                  const level = resolveItemLevel(section.key, item.path, item.permissionEntity);
                  return (
                    <div key={`${section.key}:${item.path}`} className="flex items-center justify-between gap-3 rounded-md border border-gray-100 px-3 py-2">
                      <div>
                        <p className="text-xs font-medium text-gray-900">{item.itemLabel}</p>
                        {item.description && <p className="text-[11px] text-muted-foreground">{item.description}</p>}
                      </div>
                      <AccessPill
                        value={level}
                        onChange={(next) => setItemLevel(section.key, item.path, item.permissionEntity, next)}
                        disabled={!canManageRoles}
                        compact
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
