import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Plus } from "lucide-react";
import { AdminQueryState } from "@/components/admin/admin-shell";
import { useToast } from "@/hooks/use-toast";
import * as api from "../settings-api";
import type { RoleSummary, UserSummary } from "../settings-types";
import { resolveSelectedRole, resolveAdminRolesViewState, canManageRoleActions } from "../settings-types";
import { RoleListPanel } from "./role-list-panel";
import { RoleDetailPanel } from "./role-detail-panel";
import { CreateRoleDialog, CloneRoleDialog, ArchiveRoleDialog, DeleteRoleDialog } from "./create-role-dialog";

export function RolesSection() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedRole, setSelectedRole] = useState("");
  const [draft, setDraft] = useState<Partial<RoleSummary>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [canManage, setCanManage] = useState(false);

  // Dialog states
  const [showCreate, setShowCreate] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const [roleResult, usersData, permData] = await Promise.all([
        api.fetchRolesControlCenter(),
        api.fetchUsers(),
        api.fetchPermissions(),
      ]);
      setRoles(roleResult.roles);
      setUsers(usersData);
      setCanManage(canManageRoleActions(Boolean(permData?.canManageRoles), roleResult.ok));
      setSelectedRole((prev) => resolveSelectedRole(prev, roleResult.roles));
      if (!roleResult.ok) setLoadError("Unable to load roles. Your account may not have access.");
    } catch {
      setRoles([]); setUsers([]); setLoadError("Unable to load roles right now.");
    } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDraft({}); }, [selectedRole]);

  const selected = useMemo(() => roles.find((r) => r.role === selectedRole), [roles, selectedRole]);
  const viewState = resolveAdminRolesViewState({ isLoading, hasError: Boolean(loadError), roleCount: roles.length, canManageRoles: canManage });

  const updateDraft = useCallback((update: Partial<RoleSummary>) => {
    setDraft((d) => ({ ...d, ...update }));
  }, []);

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !canManage) throw new Error("Not allowed");
      const result = await api.saveRole(selected.role, draft);
      if (!result.ok) throw new Error(result.error || "Save failed");
    },
    onSuccess: () => { setDraft({}); load(); toast({ title: "Role saved successfully" }); },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async ({ key, label }: { key: string; label: string }) => {
      if (!canManage) throw new Error("Not allowed");
      const ok = await api.createRole({ role: key, label, sections: ["HOME"], canEditData: true });
      if (!ok) throw new Error("Create role failed");
    },
    onSuccess: () => { setShowCreate(false); load(); toast({ title: "Role created" }); },
    onError: () => toast({ title: "Create role failed", variant: "destructive" }),
  });

  const cloneMutation = useMutation({
    mutationFn: async ({ key, label }: { key: string; label: string }) => {
      if (!selected || !canManage) throw new Error("Not allowed");
      const result = await api.cloneRole(selected.role, { role: key, label });
      if (!result.ok) throw new Error(result.error || "Clone failed");
    },
    onSuccess: () => { setShowClone(false); load(); toast({ title: "Role cloned", description: `Cloned from ${selected?.label}` }); },
    onError: (err: Error) => toast({ title: "Clone failed", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !canManage) throw new Error("Not allowed");
      const result = await api.archiveRole(selected.role);
      if (!result.ok) throw new Error(result.error || "Archive failed");
    },
    onSuccess: () => { setShowArchive(false); load(); toast({ title: "Role archived", description: `${selected?.label} has been archived` }); },
    onError: (err: Error) => toast({ title: "Archive failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !canManage) throw new Error("Not allowed");
      const result = await api.deleteRole(selected.role);
      if (!result.ok) throw new Error(result.error || "Delete failed");
    },
    onSuccess: () => { setShowDelete(false); setSelectedRole(""); load(); toast({ title: "Role deleted", description: `${selected?.label} has been permanently removed` }); },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 16rem)" }}>
        {/* Left Panel - Role List */}
        <div className="w-[220px] shrink-0 sticky top-4 self-start max-h-[calc(100vh-6rem)] overflow-hidden">
          <RoleListPanel
            roles={roles}
            selectedRole={selectedRole}
            onSelectRole={setSelectedRole}
            onCreateRole={() => setShowCreate(true)}
            onCompareRoles={() => {}}
            canManageRoles={canManage}
          />
        </div>

        {/* Right Panel - Role Detail */}
        <div className="flex-1 min-w-0">
          <AdminQueryState isLoading={viewState === "loading"} error={viewState === "error" ? loadError : null} onRetry={load} loadingLabel="Loading roles...">
            {viewState === "empty" ? (
              <Card className="border-gray-200 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Shield className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-lg font-semibold text-gray-900">No roles configured</p>
                  <p className="text-sm text-muted-foreground mt-1">Seeded roles appear automatically on startup.</p>
                  {canManage && <Button size="sm" onClick={() => setShowCreate(true)} className="mt-4 bg-emerald-600 hover:bg-emerald-700"><Plus className="h-3.5 w-3.5 mr-1" />Create Role</Button>}
                </CardContent>
              </Card>
            ) : viewState === "ready" && selected ? (
              <RoleDetailPanel
                role={selected}
                users={users}
                draft={draft}
                onUpdateDraft={updateDraft}
                onResetDraft={() => setDraft({})}
                onSave={() => saveMutation.mutate()}
                onClone={() => setShowClone(true)}
                onArchive={() => setShowArchive(true)}
                onDelete={() => setShowDelete(true)}
                canManageRoles={canManage}
                isSaving={saveMutation.isPending}
              />
            ) : viewState === "ready" ? (
              <Card className="border-gray-200 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Shield className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-lg font-semibold text-gray-900">Select a role</p>
                  <p className="text-sm text-muted-foreground mt-1">Choose a role from the list to view and manage its settings.</p>
                </CardContent>
              </Card>
            ) : null}
          </AdminQueryState>
        </div>
      </div>

      {/* Dialogs */}
      <CreateRoleDialog
        open={showCreate} onOpenChange={setShowCreate}
        onConfirm={(key, label) => createMutation.mutate({ key, label })}
        canManageRoles={canManage} isPending={createMutation.isPending}
      />
      <CloneRoleDialog
        open={showClone} onOpenChange={setShowClone}
        onConfirm={(key, label) => cloneMutation.mutate({ key, label })}
        sourceLabel={selected?.label || ""} isPending={cloneMutation.isPending}
      />
      <ArchiveRoleDialog
        open={showArchive} onOpenChange={setShowArchive}
        onConfirm={() => archiveMutation.mutate()}
        roleLabel={selected?.label || ""} userCount={selected?.userCount || 0} isPending={archiveMutation.isPending}
      />
      <DeleteRoleDialog
        open={showDelete} onOpenChange={setShowDelete}
        onConfirm={() => deleteMutation.mutate()}
        roleLabel={selected?.label || ""} userCount={selected?.userCount || 0} isPending={deleteMutation.isPending}
      />
    </>
  );
}
