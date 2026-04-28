// Task #107 — Right panel for a selected role.
//
// Wraps the existing RoleDetailPanel (matrix + nav + authority) with the
// same draft / save / clone / archive / delete mutations from
// admin-settings/roles/roles-section.tsx so this single screen is feature-
// equivalent with the older /admin/settings?section=roles surface.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Shield } from "lucide-react";
import { queryClient as appQueryClient } from "@/lib/queryClient";
import * as api from "../admin-settings/settings-api";
import type { RoleSummary, UserSummary } from "../admin-settings/settings-types";
import { canManageRoleActions } from "../admin-settings/settings-types";
import { RoleDetailPanel } from "../admin-settings/roles/role-detail-panel";
import {
  CreateRoleDialog,
  CloneRoleDialog,
  ArchiveRoleDialog,
  DeleteRoleDialog,
} from "../admin-settings/roles/create-role-dialog";

interface RightPanelRoleProps {
  roleKey: string;
  onRoleDeleted?: () => void;
}

export function RightPanelRole({ roleKey, onRoleDeleted }: RightPanelRoleProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Partial<RoleSummary>>({});
  const [showClone, setShowClone] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  // Create dialog is reachable from the parent page (rail "+" button).
  const [showCreate] = useState(false);

  const rolesQ = useQuery({
    queryKey: ["/api/roles/control-center"],
    queryFn: api.fetchRolesControlCenter,
  });

  const usersQ = useQuery<UserSummary[]>({
    queryKey: ["/api/admin/users"],
    queryFn: api.fetchUsers,
  });

  const permsQ = useQuery({
    queryKey: ["/api/auth/permissions"],
    queryFn: api.fetchPermissions,
  });

  const role = useMemo(
    () => rolesQ.data?.roles.find((r) => r.role === roleKey),
    [rolesQ.data, roleKey],
  );
  const canManage = canManageRoleActions(
    Boolean(permsQ.data?.canManageRoles),
    rolesQ.data?.ok ?? false,
  );

  // Reset draft when the picked role changes.
  useEffect(() => {
    setDraft({});
  }, [roleKey]);

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/roles/control-center"] });
    qc.invalidateQueries({ queryKey: ["/api/roles"] });
    appQueryClient.invalidateQueries({ queryKey: ["auth-permissions-matrix"] });
  };

  const saveM = useMutation({
    mutationFn: async () => {
      if (!role || !canManage) throw new Error("Not allowed");
      const r = await api.saveRole(role.role, draft);
      if (!r.ok) throw new Error(r.error || "Save failed");
    },
    onSuccess: () => {
      setDraft({});
      refetchAll();
      toast({ title: "Role saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const cloneM = useMutation({
    mutationFn: async ({ key, label }: { key: string; label: string }) => {
      if (!role || !canManage) throw new Error("Not allowed");
      const r = await api.cloneRole(role.role, { role: key, label });
      if (!r.ok) throw new Error(r.error || "Clone failed");
    },
    onSuccess: () => {
      setShowClone(false);
      refetchAll();
      toast({ title: "Role cloned", description: `Cloned from ${role?.label}` });
    },
    onError: (e: Error) => toast({ title: "Clone failed", description: e.message, variant: "destructive" }),
  });

  const archiveM = useMutation({
    mutationFn: async () => {
      if (!role || !canManage) throw new Error("Not allowed");
      const r = await api.archiveRole(role.role);
      if (!r.ok) throw new Error(r.error || "Archive failed");
    },
    onSuccess: () => {
      setShowArchive(false);
      refetchAll();
      toast({ title: "Role archived" });
    },
    onError: (e: Error) => toast({ title: "Archive failed", description: e.message, variant: "destructive" }),
  });

  const deleteM = useMutation({
    mutationFn: async () => {
      if (!role || !canManage) throw new Error("Not allowed");
      const r = await api.deleteRole(role.role);
      if (!r.ok) throw new Error(r.error || "Delete failed");
    },
    onSuccess: () => {
      setShowDelete(false);
      refetchAll();
      toast({ title: "Role deleted" });
      onRoleDeleted?.();
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  if (rolesQ.isLoading || permsQ.isLoading) {
    return (
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="flex items-center gap-2 py-12 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading role…
        </CardContent>
      </Card>
    );
  }

  if (!role) {
    return (
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="py-12 text-center">
          <Shield className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-600">Role not found.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div data-testid="right-panel-role">
      <RoleDetailPanel
        role={role}
        users={usersQ.data ?? []}
        draft={draft}
        onUpdateDraft={(u) => setDraft((d) => ({ ...d, ...u }))}
        onResetDraft={() => setDraft({})}
        onSave={() => saveM.mutate()}
        onClone={() => setShowClone(true)}
        onArchive={() => setShowArchive(true)}
        onDelete={() => setShowDelete(true)}
        canManageRoles={canManage}
        isSaving={saveM.isPending}
      />

      <CloneRoleDialog
        open={showClone}
        onOpenChange={setShowClone}
        onConfirm={(key, label) => cloneM.mutate({ key, label })}
        sourceLabel={role.label}
        isPending={cloneM.isPending}
      />
      <ArchiveRoleDialog
        open={showArchive}
        onOpenChange={setShowArchive}
        onConfirm={() => archiveM.mutate()}
        roleLabel={role.label}
        userCount={role.userCount || 0}
        isPending={archiveM.isPending}
      />
      <DeleteRoleDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        onConfirm={() => deleteM.mutate()}
        roleLabel={role.label}
        userCount={role.userCount || 0}
        isPending={deleteM.isPending}
      />
      {/* CreateRoleDialog rendered here for completeness; controlled by parent
          if we ever surface a "+" affordance for roles in the rail. */}
      <CreateRoleDialog
        open={showCreate}
        onOpenChange={() => {}}
        onConfirm={() => {}}
        canManageRoles={canManage}
        isPending={false}
      />
    </div>
  );
}
