import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Archive, Check, Copy, Eye, Key, Layers, Lock, Pencil, Save, Shield, ShieldCheck, Trash2, Users, X, Compass } from "lucide-react";
import type { RoleSummary, UserSummary } from "../settings-types";
import { RoleOverviewCard } from "./role-overview-card";
import { RoleNavAccess } from "./role-nav-access";
import { RolePermissionsMatrix } from "./role-permissions-matrix";
import { RoleAuthorityConfig } from "./role-authority-config";

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
          {activeTab === "permissions" && <RolePermissionsMatrix role={role} draft={draft} onUpdateDraft={onUpdateDraft} canManageRoles={canManageRoles} />}
          {activeTab === "authority" && <RoleAuthorityConfig role={role} draft={draft} onUpdateDraft={onUpdateDraft} canManageRoles={canManageRoles} />}
          {activeTab === "users" && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-800">Users with role: {role.label}</h4>
              {roleUsers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">No users assigned to this role.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {roleUsers.map((u) => (
                    <div key={u.id} className="flex items-center gap-2.5 rounded-lg border border-gray-200 bg-white p-3 hover:bg-gray-50">
                      <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xs shrink-0">
                        {(u.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{u.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{u.email}</div>
                      </div>
                      {u.department && (
                        <Badge variant="outline" className="text-[9px] ml-auto shrink-0">{u.department}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
