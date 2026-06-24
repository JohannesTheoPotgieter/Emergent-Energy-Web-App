import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Archive, Check, ChevronDown, ChevronRight, Copy, Key, Compass, Lock, Pencil, Save, Shield, ShieldCheck, Trash2, Users, X } from "lucide-react";
import type { RoleSummary, UserSummary, PermDiff } from "../settings-types";
import { ACTIONS, ENTITY_CATEGORIES, computePermDiff } from "../settings-types";
import { RoleNavAccess } from "./role-nav-access";
import { RolePermissionsMatrix } from "./role-permissions-matrix";
import { RoleAuthorityConfig } from "./role-authority-config";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";
import { PAGE_REGISTRY } from "@/config/page-registry";
import { NAVIGATION_PERMISSION_MODEL } from "@/config/navigation-permissions";
import { LIVE_READY_MODE } from "@shared/config/enabled-modules";
import { useScreenAvailability } from "@/hooks/use-screen-availability";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// When the app runs live-ready, the role permission matrix is scoped to the
// finance function: only the Finance and Admin permission categories are shown
// (Cashflow, COS, Revenue, GP, FYE, Smart Import, integrations, roles, audit …);
// every operational-module category is hidden. Reverts automatically if
// LIVE_READY_MODE is turned off. Keys match ENTITY_CATEGORIES in settings-types.
const FINANCE_FUNCTION_ENTITY_CATEGORIES = ["finance", "admin"] as const;

// The nav-access editor only exposes the live nav sections (TOP_SECTIONS via
// NAVIGATION_PERMISSION_MODEL). Derive the badge count + total from that model
// so "X/Y sections" matches what a COO can actually toggle here — not the
// larger legacy data-scope section list a role may still carry in storage.
const NAV_SECTION_KEYS = new Set<string>(NAVIGATION_PERMISSION_MODEL.map((s) => s.key));
const NAV_SECTION_TOTAL = NAVIGATION_PERMISSION_MODEL.length;

interface RoleDetailPanelProps {
  role: RoleSummary;
  users: UserSummary[];
  draft: Partial<RoleSummary>;
  onUpdateDraft: (update: Partial<RoleSummary>) => void;
  onResetDraft: () => void;
  /** UI/UX audit X6 — the audit justification entered on Save is persisted. */
  onSave: (reason: string) => void;
  onClone: () => void;
  onArchive: () => void;
  onDelete: () => void;
  canManageRoles: boolean;
  isSaving: boolean;
  /**
   * UI/UX audit X3 — concise pre/post permission diff to show after a save.
   * Provided by the parent (which owns the save lifecycle / success signal).
   */
  lastSaveDiff?: PermDiff | null;
  onDismissDiff?: () => void;
}

type SectionKey = "navigation" | "permissions" | "authority";

export function RoleDetailPanel({
  role, users, draft, onUpdateDraft, onResetDraft, onSave, onClone, onArchive, onDelete, canManageRoles, isSaving, lastSaveDiff, onDismissDiff,
}: RoleDetailPanelProps) {
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(new Set(["navigation", "permissions"]));
  // UI/UX audit X2 — the direct full-matrix save now also requires a reason
  // (symmetric with, and at least as governed as, the Apply-template path).
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  // UI/UX audit X6 — a justification captured at bulk Grant/Revoke time is
  // surfaced as the default save reason so it is not lost on the way to save.
  const [bulkReason, setBulkReason] = useState("");

  const hasChanges = Object.keys(draft).length > 0;
  const roleUsers = users.filter((u) => u.role === role.role);

  // Pending change preview (pre = saved role, post = draft about to be saved).
  const pendingDiff = useMemo<PermDiff>(
    () => computePermDiff(role.entityPermissions, draft.entityPermissions ?? role.entityPermissions),
    [role.entityPermissions, draft.entityPermissions],
  );
  const touchesPermissions = draft.entityPermissions !== undefined || draft.authorityModel !== undefined;

  const { disabledScreenIds } = useScreenAvailability();
  const disabledEntityIds = useMemo(() => {
    if (disabledScreenIds.size === 0) return undefined;
    const entities = new Set<string>();
    for (const page of PAGE_REGISTRY) {
      if (page.permissionEntity && disabledScreenIds.has(page.id)) {
        entities.add(page.permissionEntity);
      }
    }
    return entities.size > 0 ? entities : undefined;
  }, [disabledScreenIds]);

  // Live-Ready: restrict the matrix to the finance-function permission
  // categories. Undefined (= show everything) when live-ready mode is off.
  const allowedEntityIds = useMemo(() => {
    if (!LIVE_READY_MODE) return undefined;
    const entities = new Set<string>();
    for (const key of FINANCE_FUNCTION_ENTITY_CATEGORIES) {
      const cat = ENTITY_CATEGORIES[key];
      if (cat) cat.entities.forEach((e) => entities.add(e));
    }
    return entities;
  }, []);

  // Compute permission stats for header
  const permStats = useMemo(() => {
    const allEntities = Object.values(ENTITY_CATEGORIES)
      .flatMap((c) => c.entities)
      .filter((e) => !allowedEntityIds || allowedEntityIds.has(e));
    const ep = ((draft.entityPermissions ?? role.entityPermissions) || {}) as Record<string, Record<string, boolean>>;
    const total = allEntities.length * ACTIONS.length;
    let granted = 0;
    const normalizedRole = role.role || "";
    for (const entity of allEntities) {
      for (const action of ACTIONS) {
        const dbOverride = ep[entity]?.[action];
        if (typeof dbOverride === "boolean") { if (dbOverride) granted++; continue; }
        const defaultRule = ENTITY_PERMISSION_DEFAULTS.find((r) => r.entity === entity);
        if (defaultRule) {
          const roleList = (defaultRule as any)[`${action}_roles`] as string[] | undefined;
          if (roleList?.includes(normalizedRole)) granted++;
        }
      }
    }
    return { granted, total, pct: total > 0 ? Math.round((granted / total) * 100) : 0 };
  }, [role, draft, allowedEntityIds]);

  const navCount = ((draft.sections ?? role.sections) || []).filter((s) => !s.startsWith("!") && NAV_SECTION_KEYS.has(s)).length;

  const getRoleIcon = () => {
    if (role.protected) return <Lock className="h-4 w-4 text-amber-500" />;
    if (role.isSystem) return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
    return <Shield className="h-4 w-4 text-emerald-500" />;
  };

  const saveDescription = () => {
    onUpdateDraft({ description: descriptionDraft });
    setEditingDescription(false);
  };

  const toggleSection = (key: SectionKey) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const SECTIONS: Array<{ key: SectionKey; label: string; icon: React.ReactNode; badge?: string }> = [
    { key: "navigation", label: "Navigation Access", icon: <Compass className="h-4 w-4" />, badge: `${navCount}/${NAV_SECTION_TOTAL} sections` },
    { key: "permissions", label: "Permissions", icon: <Key className="h-4 w-4" />, badge: `${permStats.granted}/${permStats.total} (${permStats.pct}%)` },
    { key: "authority", label: "Authority Scope", icon: <Shield className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-3">
      {/* UI/UX audit X3 — post-save change summary / diff. */}
      {lastSaveDiff && (lastSaveDiff.added.length > 0 || lastSaveDiff.removed.length > 0) && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm" data-testid="post-save-diff">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 min-w-0">
              <p className="text-sm font-medium text-emerald-800">
                Saved · {lastSaveDiff.added.length} permission{lastSaveDiff.added.length !== 1 ? "s" : ""} granted,{" "}
                {lastSaveDiff.removed.length} removed
              </p>
              {lastSaveDiff.added.length > 0 && (
                <p className="text-xs text-emerald-700 break-words">
                  <span className="font-semibold">Granted:</span> {lastSaveDiff.added.slice(0, 25).join(", ")}
                  {lastSaveDiff.added.length > 25 ? ` +${lastSaveDiff.added.length - 25} more` : ""}
                </p>
              )}
              {lastSaveDiff.removed.length > 0 && (
                <p className="text-xs text-red-700 break-words">
                  <span className="font-semibold">Removed:</span> {lastSaveDiff.removed.slice(0, 25).join(", ")}
                  {lastSaveDiff.removed.length > 25 ? ` +${lastSaveDiff.removed.length - 25} more` : ""}
                </p>
              )}
            </div>
            {onDismissDiff && (
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={onDismissDiff} data-testid="button-dismiss-diff">
                <X className="h-3 w-3 text-emerald-700" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Unsaved changes banner */}
      {hasChanges && (
        <div className="sticky top-2 z-20 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">Unsaved changes</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onResetDraft} className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100" data-testid="button-reset-changes">Discard</Button>
            <Button size="sm" onClick={() => setConfirmSaveOpen(true)} disabled={!canManageRoles || isSaving} className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" data-testid="button-save-changes">
              <Save className="h-3 w-3 mr-1" />{isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      )}

      {/* Role Header — compact with inline stats */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center">{getRoleIcon()}</div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-900">{role.label}</h2>
                  <Badge variant="outline" className="text-[10px]">{role.isSystem ? "System" : "Custom"}</Badge>
                </div>
                {!editingDescription && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground mt-0.5 flex items-center gap-1 group"
                    onClick={() => { setDescriptionDraft((draft.description ?? role.description) || ""); setEditingDescription(true); }}
                    disabled={!canManageRoles}
                  >
                    {(draft.description ?? role.description) || "No description — click to add"}
                    {canManageRoles && <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
                  </button>
                )}
                {editingDescription && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <Input className="h-6 text-[11px] w-64" value={descriptionDraft} onChange={(e) => setDescriptionDraft(e.target.value)} placeholder="Role description..." autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") saveDescription(); if (e.key === "Escape") setEditingDescription(false); }}
                    />
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={saveDescription}><Check className="h-3 w-3 text-emerald-600" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingDescription(false)}><X className="h-3 w-3 text-gray-400" /></Button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Inline stats */}
              <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground mr-2">
                <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {roleUsers.length} user{roleUsers.length !== 1 ? "s" : ""}</span>
                <span className="flex items-center gap-1"><Key className="h-3 w-3" /> {permStats.pct}% perms</span>
                <span className="flex items-center gap-1"><Compass className="h-3 w-3" /> {navCount} sections</span>
              </div>
              {/* Actions */}
              {canManageRoles && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-gray-600 border-gray-200 hover:bg-gray-50" onClick={onClone} data-testid="button-clone-role">
                    <Copy className="h-3 w-3" /> Clone
                  </Button>
                  {!role.protected && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-amber-600 border-amber-200 hover:bg-amber-50" onClick={onArchive} data-testid="button-archive-role">
                        <Archive className="h-3 w-3" />
                      </Button>
                      {!role.isSystem && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-red-600 border-red-200 hover:bg-red-50" onClick={onDelete} data-testid="button-delete-role">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Collapsible sections — all on one scrollable page */}
      {SECTIONS.map((section) => {
        const isOpen = expandedSections.has(section.key);
        return (
          <Card key={section.key} className="border-gray-200 shadow-sm">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/50 transition-colors"
              onClick={() => toggleSection(section.key)}
              data-testid={`section-toggle-${section.key}`}
            >
              <div className="flex items-center gap-2.5">
                {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                <span className={`${isOpen ? "text-emerald-600" : "text-gray-500"}`}>{section.icon}</span>
                <span className="text-sm font-semibold text-gray-900">{section.label}</span>
              </div>
              {section.badge && (
                <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                  {section.badge}
                </Badge>
              )}
            </button>
            {isOpen && (
              <CardContent className="pt-0 pb-4 px-4 border-t border-gray-100">
                {section.key === "navigation" && (
                  <RoleNavAccess role={role} draft={draft} onUpdateDraft={onUpdateDraft} canManageRoles={canManageRoles} />
                )}
                {section.key === "permissions" && (
                  <RolePermissionsMatrix role={role} draft={draft} onUpdateDraft={onUpdateDraft} canManageRoles={canManageRoles} enabledNavSections={(draft.sections ?? role.sections) || []} disabledEntityIds={disabledEntityIds} allowedEntityIds={allowedEntityIds} onBulkAuditReason={setBulkReason} />
                )}
                {section.key === "authority" && (
                  <RoleAuthorityConfig role={role} draft={draft} onUpdateDraft={onUpdateDraft} canManageRoles={canManageRoles} />
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      {/* UI/UX audit X2 — direct/full-matrix save is governed symmetrically
          with Apply-template: an audit justification is required, and it is
          persisted to the permission audit log via the save mutation. */}
      <ConfirmDialog
        open={confirmSaveOpen}
        onOpenChange={setConfirmSaveOpen}
        title={`Save changes to ${role.label}?`}
        description={
          touchesPermissions
            ? `This updates the permission set for the ${role.label} role. Every user with this role is affected. The change is recorded in the audit log.${bulkReason ? ` (Bulk-flip note: "${bulkReason}")` : ""}`
            : `This updates the ${role.label} role. The change is recorded in the audit log.`
        }
        confirmLabel={isSaving ? "Saving…" : "Save changes"}
        impact={
          touchesPermissions ? (
            <p>
              <strong>{pendingDiff.added.length}</strong> permission
              {pendingDiff.added.length !== 1 ? "s" : ""} will be granted and{" "}
              <strong>{pendingDiff.removed.length}</strong> removed for role{" "}
              <strong>{role.label}</strong> ({roleUsers.length} user
              {roleUsers.length !== 1 ? "s" : ""} affected).
            </p>
          ) : undefined
        }
        requireReason
        reasonLabel="Reason (recorded in the audit log)"
        onConfirm={(reason) => {
          setConfirmSaveOpen(false);
          onSave(reason ?? "");
        }}
      />
    </div>
  );
}
