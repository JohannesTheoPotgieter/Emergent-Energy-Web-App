import React, { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RoleSummary } from "../settings-types";
import { ENTITY_CATEGORIES, ENTITY_DESCRIPTIONS, PERM_CATEGORY_TO_NAV_SECTION, formatEntityName } from "../settings-types";

interface RolePermissionsMatrixProps {
  role: RoleSummary;
  draft: Partial<RoleSummary>;
  onUpdateDraft: (update: Partial<RoleSummary>) => void;
  canManageRoles: boolean;
  enabledNavSections: string[];
  /** Permission entities corresponding to disabled screens — filtered out of the matrix. */
  disabledEntityIds?: Set<string>;
  /**
   * When provided, ONLY these entities are shown (live-ready mode scopes the
   * matrix to the finance-function permission categories). Undefined = show all.
   */
  allowedEntityIds?: Set<string>;
  /**
   * Entities already controlled elsewhere in the unified editor (the page/screen
   * access list). Hidden here so each entity is configured in exactly one place.
   */
  hiddenEntityIds?: Set<string>;
  /**
   * UI/UX audit X6 — called with the audit justification the admin entered
   * when confirming a bulk Grant-All / Revoke-All flip. The parent threads
   * this through the save mutation so it is persisted to the audit log.
   */
  onBulkAuditReason?: (reason: string) => void;
}

interface PendingBulk {
  kind: "global" | "category" | "entity";
  label: string;
  entities: string[];
  value: boolean;
}

// Collapsed permission model: every protected resource is governed by one
// three-state scale. `edit` subsumes every mutating capability (create,
// update, approve, override, delete); `view` is read-only; `none` clears both.
type AccessLevel = "none" | "view" | "edit";

const LEVEL_META: Record<AccessLevel, { label: string; selected: string }> = {
  none: { label: "No access", selected: "bg-gray-200 text-gray-700 border-gray-300" },
  view: { label: "View", selected: "bg-emerald-50 text-emerald-700 border-emerald-300" },
  edit: { label: "Edit", selected: "bg-emerald-100 text-emerald-800 border-emerald-400" },
};
const LEVEL_ORDER: AccessLevel[] = ["none", "view", "edit"];

function AccessLevelSelect({
  value,
  disabled,
  onChange,
  entityName,
  isOverride,
}: {
  value: AccessLevel;
  disabled: boolean;
  onChange: (level: AccessLevel) => void;
  entityName: string;
  isOverride: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`${entityName} access level`}
      className="inline-flex rounded-md border border-gray-200 overflow-hidden bg-white"
    >
      {LEVEL_ORDER.map((lvl) => {
        const active = value === lvl;
        return (
          <button
            key={lvl}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(lvl)}
            data-testid={`access-${entityName}-${lvl}`}
            className={`relative px-2.5 py-1 text-[10px] font-medium transition-colors border-r last:border-r-0 border-gray-200 ${
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-gray-50"
            } ${active ? LEVEL_META[lvl].selected : "bg-white text-gray-400"}`}
          >
            {LEVEL_META[lvl].label}
            {active && isOverride && lvl !== "none" && (
              <span
                aria-hidden="true"
                title="Role-specific override"
                className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-gray-500 ring-1 ring-white"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

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

export function RolePermissionsMatrix({ role, draft, onUpdateDraft, canManageRoles, enabledNavSections, disabledEntityIds, allowedEntityIds, hiddenEntityIds, onBulkAuditReason }: RolePermissionsMatrixProps) {
  const [permSearch, setPermSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  // UI/UX audit X6 — bulk flips are gated behind a confirm + justification.
  const [pendingBulk, setPendingBulk] = useState<PendingBulk | null>(null);

  const effectiveRole = { ...role, ...draft } as RoleSummary;
  const currentEp = (effectiveRole.entityPermissions || {}) as Record<string, Record<string, boolean>>;
  const normalizedRole = effectiveRole.role || "";
  // An entity is visible when it's in the allow-list (if one is set) AND not in
  // the disabled set. allEntities (drives global Grant/Revoke All) respects the
  // same scope so a bulk flip never touches a hidden entity.
  const isEntityVisible = useCallback(
    (e: string) => (!allowedEntityIds || allowedEntityIds.has(e)) && !disabledEntityIds?.has(e) && !hiddenEntityIds?.has(e),
    [allowedEntityIds, disabledEntityIds, hiddenEntityIds],
  );
  const allEntities = Object.values(ENTITY_CATEGORIES).flatMap((c) => c.entities).filter(isEntityVisible).sort();

  // Derive the effective three-state level for an entity from the underlying
  // view/edit grants (role override layered over registry defaults).
  const getEntityLevel = (entity: string): { level: AccessLevel; isOverride: boolean } => {
    const editState = getPermissionState(entity, "edit", currentEp, normalizedRole);
    const viewState = getPermissionState(entity, "view", currentEp, normalizedRole);
    if (editState.allowed) return { level: "edit", isOverride: editState.source === "role_override" };
    if (viewState.allowed) return { level: "view", isOverride: viewState.source === "role_override" };
    const denied = editState.source === "role_override" || viewState.source === "role_override";
    return { level: "none", isOverride: denied };
  };

  // Writes the entity's view/edit booleans to match the chosen level. `edit`
  // implies `view`; `none` explicitly denies both.
  const setEntityLevel = (entity: string, level: AccessLevel) => {
    const view = level === "view" || level === "edit";
    const edit = level === "edit";
    const next = { ...currentEp, [entity]: { ...(currentEp[entity] || {}), view, edit } };
    onUpdateDraft({ entityPermissions: next });
  };

  // Applies the actual bulk change to the draft (after confirmation).
  // value=true -> Edit (full mutating access); value=false -> No access.
  const applyBulk = (entities: string[], value: boolean) => {
    const next = { ...currentEp };
    entities.forEach((entity) => {
      next[entity] = { ...(next[entity] || {}), view: value, edit: value };
    });
    onUpdateDraft({ entityPermissions: next });
  };

  // Global + category flips must be confirmed with an impact preview + reason.
  const requestBulk = (kind: PendingBulk["kind"], label: string, entities: string[], value: boolean) => {
    setPendingBulk({ kind, label, entities, value });
  };

  const confirmBulk = (reason?: string) => {
    if (!pendingBulk) return;
    applyBulk(pendingBulk.entities, pendingBulk.value);
    if (reason && onBulkAuditReason) onBulkAuditReason(reason);
    setPendingBulk(null);
  };

  const toggleCategory = (key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const allKnownEntities = useMemo(() => {
    const set = new Set<string>();
    Object.keys(currentEp).filter((k) => !k.startsWith("_")).forEach((e) => set.add(e));
    ENTITY_PERMISSION_DEFAULTS.forEach((r) => set.add(r.entity));
    return [...set].sort();
  }, [currentEp]);

  const categorizedEntities = useMemo(() => {
    const assigned = new Set<string>();
    const result: { key: string; label: string; entities: string[] }[] = [];
    Object.entries(ENTITY_CATEGORIES).forEach(([key, cat]) => {
      const entities = cat.entities.filter(isEntityVisible);
      entities.forEach((e) => assigned.add(e));
      if (entities.length > 0) result.push({ key, label: cat.label, entities });
    });
    const uncategorized = allKnownEntities.filter((e) => !assigned.has(e) && isEntityVisible(e));
    if (uncategorized.length > 0) result.push({ key: "uncategorized", label: "Other Permissions", entities: uncategorized });
    return result;
  }, [allKnownEntities, isEntityVisible]);

  const filteredCategories = useMemo(() => {
    if (!permSearch) return categorizedEntities;
    const q = permSearch.toLowerCase();
    return categorizedEntities.map((cat) => ({
      ...cat,
      entities: cat.entities.filter((e) => formatEntityName(e).toLowerCase().includes(q) || cat.label.toLowerCase().includes(q)),
    })).filter((cat) => cat.entities.length > 0);
  }, [categorizedEntities, permSearch]);

  // Category progress: how many entities have any access (view or edit) granted.
  const categorySummary = useMemo(() => {
    const summary: Record<string, { granted: number; total: number }> = {};
    for (const cat of categorizedEntities) {
      let granted = 0;
      const total = cat.entities.length;
      for (const entity of cat.entities) {
        const viewState = getPermissionState(entity, "view", currentEp, normalizedRole);
        const editState = getPermissionState(entity, "edit", currentEp, normalizedRole);
        if (viewState.allowed || editState.allowed) granted++;
      }
      summary[cat.key] = { granted, total };
    }
    return summary;
  }, [categorizedEntities, currentEp, normalizedRole]);

  const isExpanded = (key: string) => permSearch ? true : expandedCategories.has(key);

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-7 text-xs bg-gray-50 border-gray-200" placeholder="Filter permissions..." value={permSearch} onChange={(e) => setPermSearch(e.target.value)} data-testid="input-search-permissions" />
        </div>
        {canManageRoles && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => requestBulk("global", "all workspaces", allEntities, true)} data-testid="button-grant-all-global">Grant All (Edit)</Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 text-red-600 border-red-200 hover:bg-red-50" onClick={() => requestBulk("global", "all workspaces", allEntities, false)} data-testid="button-revoke-all-global">Revoke All</Button>
          </div>
        )}
      </div>

      {/* Legend — the three-state access scale that governs every resource. */}
      <div className="flex items-center gap-3 mb-2 text-[9px] text-muted-foreground px-1">
        <div className="flex items-center gap-1"><div className="h-2 w-2 rounded border bg-gray-200 border-gray-300" /><span>No access</span></div>
        <div className="flex items-center gap-1"><div className="h-2 w-2 rounded border bg-emerald-50 border-emerald-300" /><span>View (read-only)</span></div>
        <div className="flex items-center gap-1"><div className="h-2 w-2 rounded border bg-emerald-100 border-emerald-400" /><span>Edit (full — incl. create/approve/delete)</span></div>
        <div className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-gray-500 inline-block" /><span>Role override</span></div>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[65vh] overflow-y-auto">
        <TooltipProvider delayDuration={150}>
          <table className="w-full text-xs" data-testid="permissions-table">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left pl-3 pr-1 py-1.5 text-[10px] font-semibold text-gray-600 bg-gray-50" style={{ minWidth: 160 }}>ENTITY</th>
                <th className="text-right pr-3 py-1.5 text-[10px] font-semibold text-gray-600 bg-gray-50" style={{ width: 240 }}>ACCESS LEVEL</th>
              </tr>
            </thead>
            <tbody>
              {filteredCategories.length === 0 && (
                <tr><td colSpan={2} className="text-center py-6 text-xs text-muted-foreground">No permissions match "{permSearch}"</td></tr>
              )}
              {filteredCategories.map((cat) => {
                const summary = categorySummary[cat.key];
                const expanded = isExpanded(cat.key);
                const pct = summary && summary.total > 0 ? Math.round((summary.granted / summary.total) * 100) : 0;
                const navSection = PERM_CATEGORY_TO_NAV_SECTION[cat.key];
                const navDisabled = navSection ? !enabledNavSections.includes(navSection) : false;
                return (
                  <React.Fragment key={cat.key}>
                    <tr className={`cursor-pointer ${navDisabled ? "bg-gray-100/60 opacity-60" : "bg-gray-50/80 hover:bg-gray-100/60"}`} onClick={() => toggleCategory(cat.key)}>
                      <td colSpan={2} className="px-2 py-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {expanded ? <ChevronDown className="h-3 w-3 text-gray-400" /> : <ChevronRight className="h-3 w-3 text-gray-400" />}
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${navDisabled ? "text-gray-400 line-through" : "text-gray-500"}`}>{cat.label}</span>
                            {navDisabled && <span className="text-[9px] text-red-400 font-medium ml-1">Nav disabled</span>}
                            {!navDisabled && summary && (
                              <div className="flex items-center gap-1 ml-1">
                                <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${pct > 75 ? "bg-emerald-500" : "bg-gray-400"}`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-[9px] text-gray-400 font-medium">{summary.granted}/{summary.total}</span>
                              </div>
                            )}
                          </div>
                          {canManageRoles && !navDisabled && (
                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                              <button type="button" onClick={() => requestBulk("category", cat.label, cat.entities, true)} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium" data-testid={`grant-category-${cat.key}`}>Edit all</button>
                              <button type="button" onClick={() => requestBulk("category", cat.label, cat.entities, false)} className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium" data-testid={`revoke-category-${cat.key}`}>No access</button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && navDisabled && (
                      <tr>
                        <td colSpan={2} className="px-4 py-2 bg-gray-50">
                          <p className="text-[10px] text-gray-400 italic">Enable this section in Navigation Access first.</p>
                        </td>
                      </tr>
                    )}
                    {expanded && cat.entities.map((entity) => {
                      const desc = ENTITY_DESCRIPTIONS[entity];
                      const { level, isOverride } = getEntityLevel(entity);
                      return (
                        <tr key={entity} className={`border-t border-gray-100 ${navDisabled ? "opacity-40" : "hover:bg-gray-50/50"}`} data-testid={`perm-row-${entity}`}>
                          <td className="pl-3 pr-1 py-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`text-[11px] font-medium cursor-default truncate block max-w-[180px] ${navDisabled ? "text-gray-400" : "text-gray-800"}`}>{formatEntityName(entity)}</span>
                              </TooltipTrigger>
                              {desc && (
                                <TooltipContent side="right" className="text-[10px] max-w-[220px]">
                                  <p>{desc}</p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </td>
                          <td className="pr-3 py-1">
                            <div className="flex justify-end">
                              <AccessLevelSelect
                                value={level}
                                disabled={!canManageRoles || navDisabled}
                                onChange={(lvl) => setEntityLevel(entity, lvl)}
                                entityName={formatEntityName(entity)}
                                isOverride={isOverride}
                              />
                            </div>
                          </td>
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

      {/* UI/UX audit X6 — bulk Grant-All / Revoke-All confirmation with an
          impact preview (actual counts) and required justification. */}
      <ConfirmDialog
        open={!!pendingBulk}
        onOpenChange={(o) => { if (!o) setPendingBulk(null); }}
        title={pendingBulk?.value ? "Grant Edit on all?" : "Revoke all access?"}
        description={
          pendingBulk
            ? `This sets ${
                pendingBulk.kind === "global" ? "every workspace" : `the "${pendingBulk.label}" group`
              } to ${pendingBulk.value ? "Edit (full access)" : "No access"} on the ${effectiveRole.label || normalizedRole} role.`
            : undefined
        }
        variant={pendingBulk?.value ? "default" : "destructive"}
        confirmLabel={pendingBulk?.value ? "Set all to Edit" : "Set all to No access"}
        impact={
          pendingBulk ? (
            <p>
              This will set{" "}
              <strong>{pendingBulk.entities.length}</strong>{" "}
              {pendingBulk.entities.length === 1 ? "workspace" : "workspaces"} to{" "}
              <strong>{pendingBulk.value ? "Edit" : "No access"}</strong> for role{" "}
              <strong>{effectiveRole.label || normalizedRole}</strong>. Every user with this role
              is affected. Save to apply.
            </p>
          ) : undefined
        }
        requireReason
        reasonLabel="Reason (recorded in the audit log)"
        onConfirm={(reason) => confirmBulk(reason)}
      />
    </div>
  );
}
