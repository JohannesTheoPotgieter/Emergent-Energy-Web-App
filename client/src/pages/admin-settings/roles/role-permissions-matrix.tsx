import React, { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, ChevronDown, ChevronRight, Eye, Pencil, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import type { PermissionAction } from "@shared/schema";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RoleSummary } from "../settings-types";
import { ACTIONS, ENTITY_CATEGORIES, ENTITY_DESCRIPTIONS, PERM_CATEGORY_TO_NAV_SECTION, formatEntityName } from "../settings-types";

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
   * UI/UX audit X6 — called with the audit justification the admin entered
   * when confirming a bulk Grant-All / Revoke-All flip. The parent threads
   * this through the save mutation so it is persisted to the audit log.
   */
  onBulkAuditReason?: (reason: string) => void;
}

// Calm, security-screen palette (UI/UX audit X4): emerald = granted,
// one semantic red = explicitly denied, neutral grey otherwise. No blue/amber.
const CELL_STYLES = {
  granted: "bg-emerald-100 text-emerald-700 border-emerald-300",
  denied: "bg-red-50 text-red-600 border-red-200",
  neutral: "bg-gray-50 text-gray-400 border-gray-200",
};

interface PendingBulk {
  kind: "global" | "category" | "entity";
  label: string;
  entities: string[];
  value: boolean;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  view: <Eye className="h-3 w-3" />,
  create: <Plus className="h-3 w-3" />,
  edit: <Pencil className="h-3 w-3" />,
  approve: <Check className="h-3 w-3" />,
  override: <ShieldCheck className="h-3 w-3" />,
  delete: <Trash2 className="h-3 w-3" />,
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

export function RolePermissionsMatrix({ role, draft, onUpdateDraft, canManageRoles, enabledNavSections, disabledEntityIds, allowedEntityIds, onBulkAuditReason }: RolePermissionsMatrixProps) {
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
    (e: string) => (!allowedEntityIds || allowedEntityIds.has(e)) && !disabledEntityIds?.has(e),
    [allowedEntityIds, disabledEntityIds],
  );
  const allEntities = Object.values(ENTITY_CATEGORIES).flatMap((c) => c.entities).filter(isEntityVisible).sort();

  const updateEp = (entity: string, action: string, value: boolean) => {
    const next = { ...currentEp, [entity]: { ...(currentEp[entity] || {}), [action]: value } };
    if ((action === "edit" || action === "approve" || action === "delete") && value) next[entity].view = true;
    onUpdateDraft({ entityPermissions: next });
  };

  // Applies the actual bulk change to the draft (after confirmation).
  const applyBulk = (entities: string[], value: boolean) => {
    const next = { ...currentEp };
    entities.forEach((entity) => {
      const updated: Record<string, boolean> = {};
      ACTIONS.forEach((a) => { updated[a] = value; });
      next[entity] = updated;
    });
    onUpdateDraft({ entityPermissions: next });
  };

  // Single-entity all/none toggle stays inline (low blast radius — one entity).
  const bulkUpdateEntity = (entity: string, value: boolean) => {
    applyBulk([entity], value);
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
            <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => requestBulk("global", "all workspaces", allEntities, true)} data-testid="button-grant-all-global">Grant All</Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 text-red-600 border-red-200 hover:bg-red-50" onClick={() => requestBulk("global", "all workspaces", allEntities, false)} data-testid="button-revoke-all-global">Revoke All</Button>
          </div>
        )}
      </div>

      {/* Legend — calm 3-state palette (UI/UX audit X4) */}
      <div className="flex items-center gap-3 mb-2 text-[9px] text-muted-foreground px-1">
        <div className="flex items-center gap-1"><div className="h-2 w-2 rounded border bg-emerald-100 border-emerald-300" /><span>Granted</span></div>
        <div className="flex items-center gap-1"><div className="h-2 w-2 rounded border bg-red-50 border-red-200" /><span>Denied</span></div>
        <div className="flex items-center gap-1"><div className="h-2 w-2 rounded border bg-gray-50 border-gray-200" /><span>No access</span></div>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[65vh] overflow-y-auto">
        <TooltipProvider delayDuration={150}>
          <table className="w-full text-xs" data-testid="permissions-table">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left pl-3 pr-1 py-1.5 text-[10px] font-semibold text-gray-600 bg-gray-50" style={{ minWidth: 160 }}>ENTITY</th>
                {ACTIONS.map((a) => (
                  <th key={a} scope="col" aria-label={`${a} permission`} className="text-center px-0.5 py-1.5 text-[10px] font-semibold text-gray-600 bg-gray-50" style={{ width: 44 }}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center gap-0.5 cursor-default" aria-hidden="true">{ACTION_ICONS[a]}</div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[10px] capitalize">{a}</TooltipContent>
                    </Tooltip>
                  </th>
                ))}
                {canManageRoles && <th className="w-[52px] bg-gray-50" />}
              </tr>
            </thead>
            <tbody>
              {filteredCategories.length === 0 && (
                <tr><td colSpan={ACTIONS.length + (canManageRoles ? 2 : 1)} className="text-center py-6 text-xs text-muted-foreground">No permissions match "{permSearch}"</td></tr>
              )}
              {filteredCategories.map((cat) => {
                const summary = categorySummary[cat.key];
                const expanded = isExpanded(cat.key);
                const pct = summary ? Math.round((summary.granted / summary.total) * 100) : 0;
                const navSection = PERM_CATEGORY_TO_NAV_SECTION[cat.key];
                const navDisabled = navSection ? !enabledNavSections.includes(navSection) : false;
                return (
                  <React.Fragment key={cat.key}>
                    <tr className={`cursor-pointer ${navDisabled ? "bg-gray-100/60 opacity-60" : "bg-gray-50/80 hover:bg-gray-100/60"}`} onClick={() => toggleCategory(cat.key)}>
                      <td colSpan={ACTIONS.length + (canManageRoles ? 2 : 1)} className="px-2 py-1">
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
                              <button type="button" onClick={() => requestBulk("category", cat.label, cat.entities, true)} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium" data-testid={`grant-category-${cat.key}`}>Grant all</button>
                              <button type="button" onClick={() => requestBulk("category", cat.label, cat.entities, false)} className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium" data-testid={`revoke-category-${cat.key}`}>Revoke all</button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && navDisabled && (
                      <tr>
                        <td colSpan={ACTIONS.length + (canManageRoles ? 2 : 1)} className="px-4 py-2 bg-gray-50">
                          <p className="text-[10px] text-gray-400 italic">Enable this section in Navigation Access first.</p>
                        </td>
                      </tr>
                    )}
                    {expanded && cat.entities.map((entity) => {
                      const desc = ENTITY_DESCRIPTIONS[entity];
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
                          {ACTIONS.map((action) => {
                            const state = getPermissionState(entity, action, currentEp, normalizedRole);
                            // Calm 3-state palette (X4): granted / denied / no-access.
                            const cellColor = navDisabled
                              ? CELL_STYLES.neutral
                              : state.allowed
                                ? CELL_STYLES.granted
                                : state.source === "role_override"
                                  ? CELL_STYLES.denied
                                  : CELL_STYLES.neutral;

                            // Text companion for the cell source — never colour-only (X4).
                            const sourceLabel = navDisabled
                              ? "Navigation disabled"
                              : state.allowed
                                ? state.source === "role_override" ? "Granted (role override)" : "Granted (default)"
                                : state.source === "role_override" ? "Denied (role override)" : "No access";
                            const sourceTag = navDisabled
                              ? ""
                              : state.source === "role_override"
                                ? "override"
                                : state.source === "default"
                                  ? "default"
                                  : "";

                            return (
                              <td key={action} className="text-center px-0.5 py-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button type="button" disabled={!canManageRoles || navDisabled} onClick={() => updateEp(entity, action, !state.allowed)}
                                      aria-label={`${formatEntityName(entity)} ${action}: ${sourceLabel}`}
                                      className={`relative inline-flex items-center justify-center h-5.5 w-5.5 rounded border transition-all ${!canManageRoles || navDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:scale-110"} ${cellColor}`}
                                      style={{ height: 22, width: 22 }}
                                      data-testid={`toggle-${entity}-${action}`}
                                    >
                                      {!navDisabled && state.allowed ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                                      {sourceTag === "override" && (
                                        <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-gray-500 ring-1 ring-white" />
                                      )}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-[10px]">
                                    <p className="font-medium">{formatEntityName(entity)} · {action}</p>
                                    <p className="text-muted-foreground">{sourceLabel}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </td>
                            );
                          })}
                          {canManageRoles && (
                            <td className="text-center px-0.5 py-1">
                              {!navDisabled && (
                                <div className="flex gap-0.5 justify-center">
                                  <button type="button" onClick={() => bulkUpdateEntity(entity, true)} className="text-[8px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100" title="Grant all" data-testid={`grant-all-${entity}`}>All</button>
                                  <button type="button" onClick={() => bulkUpdateEntity(entity, false)} className="text-[8px] px-1 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100" title="Revoke all" data-testid={`revoke-all-${entity}`}>None</button>
                                </div>
                              )}
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

      {/* UI/UX audit X6 — bulk Grant-All / Revoke-All confirmation with an
          impact preview (actual counts) and required justification. */}
      <ConfirmDialog
        open={!!pendingBulk}
        onOpenChange={(o) => { if (!o) setPendingBulk(null); }}
        title={pendingBulk?.value ? "Grant all permissions?" : "Revoke all permissions?"}
        description={
          pendingBulk
            ? `This ${pendingBulk.value ? "grants" : "revokes"} every action for ${
                pendingBulk.kind === "global" ? "every workspace" : `the "${pendingBulk.label}" group`
              } on the ${effectiveRole.label || normalizedRole} role.`
            : undefined
        }
        variant={pendingBulk?.value ? "default" : "destructive"}
        confirmLabel={pendingBulk?.value ? "Grant all" : "Revoke all"}
        impact={
          pendingBulk ? (
            <p>
              {pendingBulk.value ? "Grant All" : "Revoke All"} will set{" "}
              <strong>{pendingBulk.entities.length * ACTIONS.length}</strong> permissions across{" "}
              <strong>{pendingBulk.entities.length}</strong>{" "}
              {pendingBulk.entities.length === 1 ? "workspace" : "workspaces"} for role{" "}
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
