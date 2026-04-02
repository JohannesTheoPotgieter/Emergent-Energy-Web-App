import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Archive, Check, ChevronDown, ChevronRight, Copy, Key, Compass, Lock, Pencil, Save, Shield, ShieldCheck, Trash2, Users, X } from "lucide-react";
import type { RoleSummary, UserSummary } from "../settings-types";
import { ACTIONS, ENTITY_CATEGORIES } from "../settings-types";
import { RoleNavAccess } from "./role-nav-access";
import { RolePermissionsMatrix } from "./role-permissions-matrix";
import { RoleAuthorityConfig } from "./role-authority-config";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";

interface RoleDetailPanelProps {
  role: RoleSummary;
  users: UserSummary[];
  draft: Partial<RoleSummary>;
  onUpdateDraft: (update: Partial<RoleSummary>) => void;
  onResetDraft: () => void;
  onSave: () => void;
  onClone: () => void;
  onArchive: () => void;
  onDelete: () => void;
  canManageRoles: boolean;
  isSaving: boolean;
}

type SectionKey = "navigation" | "permissions" | "authority";

export function RoleDetailPanel({
  role, users, draft, onUpdateDraft, onResetDraft, onSave, onClone, onArchive, onDelete, canManageRoles, isSaving,
}: RoleDetailPanelProps) {
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(new Set(["navigation", "permissions"]));

  const hasChanges = Object.keys(draft).length > 0;
  const roleUsers = users.filter((u) => u.role === role.role);

  // Compute permission stats for header
  const permStats = useMemo(() => {
    const allEntities = Object.values(ENTITY_CATEGORIES).flatMap((c) => c.entities);
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
  }, [role, draft]);

  const navCount = ((draft.sections ?? role.sections) || []).filter((s) => !s.startsWith("!")).length;

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
    { key: "navigation", label: "Navigation Access", icon: <Compass className="h-4 w-4" />, badge: `${navCount}/11 sections` },
    { key: "permissions", label: "Permissions", icon: <Key className="h-4 w-4" />, badge: `${permStats.granted}/${permStats.total} (${permStats.pct}%)` },
    { key: "authority", label: "Authority Scope", icon: <Shield className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-3">
      {/* Unsaved changes banner */}
      {hasChanges && (
        <div className="sticky top-2 z-20 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">Unsaved changes</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onResetDraft} className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100" data-testid="button-reset-changes">Discard</Button>
            <Button size="sm" onClick={onSave} disabled={!canManageRoles || isSaving} className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" data-testid="button-save-changes">
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
                  <RolePermissionsMatrix role={role} draft={draft} onUpdateDraft={onUpdateDraft} canManageRoles={canManageRoles} enabledNavSections={(draft.sections ?? role.sections) || []} />
                )}
                {section.key === "authority" && (
                  <RoleAuthorityConfig role={role} draft={draft} onUpdateDraft={onUpdateDraft} canManageRoles={canManageRoles} />
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
