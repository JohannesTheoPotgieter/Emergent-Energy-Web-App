import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Archive, Check, Copy, Eye, Key, Layers, Lock, Pencil, Save, Shield, ShieldCheck, Trash2, Users, X, Compass, ChevronDown, ChevronRight } from "lucide-react";
import type { RoleSummary, UserSummary, EffectivePermission } from "../settings-types";
import { ACTIONS, ENTITY_CATEGORIES, ENTITY_DESCRIPTIONS, formatEntityName } from "../settings-types";
import { RoleOverviewCard } from "./role-overview-card";
import { RoleNavAccess } from "./role-nav-access";
import { RolePermissionsMatrix } from "./role-permissions-matrix";
import { RoleAuthorityConfig } from "./role-authority-config";
import * as api from "../settings-api";

type DetailTab = "overview" | "navigation" | "permissions" | "authority" | "users";

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

export function RoleDetailPanel({
  role, users, draft, onUpdateDraft, onResetDraft, onSave, onClone, onArchive, onDelete, canManageRoles, isSaving,
}: RoleDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");

  const hasChanges = Object.keys(draft).length > 0;
  const roleUsers = users.filter((u) => u.role === role.role);

  const getRoleIcon = () => {
    if (role.protected) return <Lock className="h-4 w-4 text-amber-500" />;
    if (role.isSystem) return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
    return <Shield className="h-4 w-4 text-emerald-500" />;
  };

  const saveDescription = () => {
    onUpdateDraft({ description: descriptionDraft });
    setEditingDescription(false);
  };

  const TABS: Array<{ key: DetailTab; label: string; icon: React.ReactNode }> = [
    { key: "overview", label: "Overview", icon: <Eye className="h-3.5 w-3.5" /> },
    { key: "navigation", label: "Navigation", icon: <Compass className="h-3.5 w-3.5" /> },
    { key: "permissions", label: "Permissions", icon: <Key className="h-3.5 w-3.5" /> },
    { key: "authority", label: "Authority", icon: <Shield className="h-3.5 w-3.5" /> },
    { key: "users", label: `Users (${roleUsers.length})`, icon: <Users className="h-3.5 w-3.5" /> },
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

      <Card className="border-gray-200 shadow-sm">
        {/* Header */}
        <CardHeader className="border-b border-gray-100 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center">{getRoleIcon()}</div>
              <div>
                <CardTitle className="text-base font-semibold text-gray-900">{role.label}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {role.isSystem ? "System" : "Custom"} · {roleUsers.length} user{roleUsers.length !== 1 ? "s" : ""}
                </p>
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
            <div className="flex items-center gap-2">
              {roleUsers.length > 0 && (
                <div className="flex -space-x-2 mr-2">
                  {roleUsers.slice(0, 5).map((u) => (
                    <div key={u.id} className="h-7 w-7 rounded-full bg-emerald-100 border-2 border-white flex items-center justify-center text-emerald-700 font-bold text-[10px]" title={u.name}>
                      {(u.name || "?").charAt(0).toUpperCase()}
                    </div>
                  ))}
                  {roleUsers.length > 5 && <div className="h-7 w-7 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-gray-600 font-bold text-[10px]">+{roleUsers.length - 5}</div>}
                </div>
              )}
              {canManageRoles && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-gray-600 border-gray-200 hover:bg-gray-50" onClick={onClone} title="Clone this role" data-testid="button-clone-role">
                    <Copy className="h-3 w-3" /> Clone
                  </Button>
                  {!role.protected && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-amber-600 border-amber-200 hover:bg-amber-50" onClick={onArchive} title="Archive this role" data-testid="button-archive-role">
                        <Archive className="h-3 w-3" /> Archive
                      </Button>
                      {!role.isSystem && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-red-600 border-red-200 hover:bg-red-50" onClick={onDelete} title="Delete this role" data-testid="button-delete-role">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-100">
          {TABS.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${activeTab === tab.key ? "border-emerald-600 text-emerald-700 bg-emerald-50/50" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"}`}
              data-testid={`tab-role-${tab.key}`}
            >{tab.icon}{tab.label}</button>
          ))}
        </div>

        {/* Tab Content */}
        <CardContent className="p-4">
          {activeTab === "overview" && <RoleOverviewCard role={{ ...role, ...draft } as RoleSummary} users={roleUsers} />}
          {activeTab === "navigation" && <RoleNavAccess role={role} draft={draft} onUpdateDraft={onUpdateDraft} canManageRoles={canManageRoles} />}
          {activeTab === "permissions" && (
            <div className="space-y-3">
              <div className="rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2">
                <p className="text-xs text-blue-700"><span className="font-semibold">Permissions</span> control <span className="font-semibold">what</span> this role can do — grant or deny specific actions (view, create, edit, approve, override, delete) on each entity.</p>
              </div>
              <RolePermissionsMatrix role={role} draft={draft} onUpdateDraft={onUpdateDraft} canManageRoles={canManageRoles} />
            </div>
          )}
          {activeTab === "authority" && (
            <div className="space-y-3">
              <div className="rounded-md border border-violet-100 bg-violet-50/50 px-3 py-2">
                <p className="text-xs text-violet-700"><span className="font-semibold">Authority</span> controls <span className="font-semibold">how far</span> permissions reach — e.g., can this role manage only their own items, their department, assigned projects, or everything company-wide?</p>
              </div>
              <RoleAuthorityConfig role={role} draft={draft} onUpdateDraft={onUpdateDraft} canManageRoles={canManageRoles} />
            </div>
          )}
          {activeTab === "users" && (
            <RoleUsersTab role={role} users={roleUsers} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Users Tab with effective permission preview ──

function RoleUsersTab({ role, users }: { role: RoleSummary; users: UserSummary[] }) {
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [userPerms, setUserPerms] = useState<Record<number, EffectivePermission[]>>({});
  const [loadingUser, setLoadingUser] = useState<number | null>(null);

  const loadUserPerms = useCallback(async (userId: number) => {
    if (userPerms[userId]) return;
    setLoadingUser(userId);
    try {
      const perms = await api.fetchEffectivePermissions(userId);
      setUserPerms((prev) => ({ ...prev, [userId]: perms }));
    } catch {
      // Silently fail — user will see empty state
    } finally {
      setLoadingUser(null);
    }
  }, [userPerms]);

  const toggleUser = (userId: number) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
    } else {
      setExpandedUser(userId);
      loadUserPerms(userId);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800">Users with role: {role.label}</h4>
        <span className="text-[11px] text-muted-foreground">{users.length} user{users.length !== 1 ? "s" : ""}</span>
      </div>
      {users.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">No users assigned to this role.</div>
      ) : (
        <div className="space-y-1">
          {users.map((u) => {
            const isExpanded = expandedUser === u.id;
            const perms = userPerms[u.id];
            const overrideCount = perms ? perms.filter((p) => p.source === "user_override").length : 0;
            const grantedCount = perms ? perms.filter((p) => p.allowed).length : 0;
            const totalCount = perms ? perms.length : 0;

            return (
              <div key={u.id} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 p-2.5 hover:bg-gray-50 text-left"
                  onClick={() => toggleUser(u.id)}
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" /> : <ChevronRight className="h-3 w-3 text-gray-400 shrink-0" />}
                  <div className="h-7 w-7 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-[10px] shrink-0">
                    {(u.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-gray-900 truncate">{u.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {u.department && (
                      <Badge variant="outline" className="text-[9px] h-4">{u.department}</Badge>
                    )}
                    {perms && overrideCount > 0 && (
                      <Badge variant="secondary" className="text-[9px] h-4 bg-amber-100 text-amber-700 border-amber-200">{overrideCount} overrides</Badge>
                    )}
                    {perms && (
                      <span className="text-[9px] text-muted-foreground">{grantedCount}/{totalCount}</span>
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 px-3 py-2 bg-gray-50/50">
                    {loadingUser === u.id ? (
                      <div className="text-[11px] text-muted-foreground py-3 text-center">Loading effective permissions...</div>
                    ) : perms ? (
                      <UserPermissionSummary permissions={perms} />
                    ) : (
                      <div className="text-[11px] text-muted-foreground py-3 text-center">Click to load effective permissions</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Compact summary of a user's effective permissions grouped by category
function UserPermissionSummary({ permissions }: { permissions: EffectivePermission[] }) {
  const permMap = new Map<string, EffectivePermission>();
  for (const p of permissions) {
    permMap.set(`${p.entity}.${p.action}`, p);
  }

  const categories = Object.entries(ENTITY_CATEGORIES);
  const overrides = permissions.filter((p) => p.source === "user_override");

  return (
    <div className="space-y-2">
      {overrides.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
          <div className="text-[10px] font-semibold text-amber-800 mb-1">User-Specific Overrides ({overrides.length})</div>
          <div className="flex flex-wrap gap-1">
            {overrides.map((o) => (
              <Badge
                key={`${o.entity}.${o.action}`}
                variant="outline"
                className={`text-[8px] h-4 ${o.allowed ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"}`}
              >
                {formatEntityName(o.entity)} · {o.action} ({o.allowed ? "granted" : "denied"})
              </Badge>
            ))}
          </div>
        </div>
      )}
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-2 gap-1.5">
          {categories.map(([key, cat]) => {
            let granted = 0;
            let total = 0;
            for (const entity of cat.entities) {
              for (const action of ACTIONS) {
                total++;
                const perm = permMap.get(`${entity}.${action}`);
                if (perm?.allowed) granted++;
              }
            }
            const pct = total > 0 ? Math.round((granted / total) * 100) : 0;
            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1 cursor-default">
                    <div className="text-[10px] font-medium text-gray-700 flex-1 truncate">{cat.label}</div>
                    <div className="w-10 h-1 bg-gray-200 rounded-full overflow-hidden shrink-0">
                      <div
                        className={`h-full rounded-full ${pct > 75 ? "bg-emerald-500" : pct > 25 ? "bg-amber-500" : "bg-gray-400"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground w-8 text-right shrink-0">{granted}/{total}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px]">
                  <p className="font-medium">{cat.label}</p>
                  <p className="text-muted-foreground">{granted} of {total} permissions granted ({pct}%)</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}
