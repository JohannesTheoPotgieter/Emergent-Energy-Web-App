// Task #107 — Right panel for a selected role.
//
// Wraps the existing RoleDetailPanel (matrix + nav + authority) with the
// same draft / save / clone / archive / delete mutations from
// admin-settings/roles/roles-section.tsx so this single screen is feature-
// equivalent with the older /admin/settings?section=roles surface.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Shield, GitCompareArrows, AlertTriangle } from "lucide-react";
import { queryClient as appQueryClient } from "@/lib/queryClient";
import * as api from "../admin-settings/settings-api";
import type { RoleSummary, UserSummary, PermDiff } from "../admin-settings/settings-types";
import { canManageRoleActions, computePermDiff } from "../admin-settings/settings-types";
import { RoleDetailPanel } from "../admin-settings/roles/role-detail-panel";
import { RoleComparisonDialog } from "../admin-settings/roles/role-comparison-dialog";
import {
  CloneRoleDialog,
  ArchiveRoleDialog,
  DeleteRoleDialog,
} from "../admin-settings/roles/create-role-dialog";

// Shape of /api/admin/role-templates and /api/admin/roles/:role/preview-template/:key.
interface TemplateRow {
  id: number;
  key: string;
  name: string;
  summary: string;
  category: string;
}
interface RoleDiffEntry {
  entity: string;
  title: string;
  category: string;
  gained: string[];
  lost: string[];
}
interface RoleDiffPayload {
  templateName: string;
  templateSummary: string;
  englishHeadline: string;
  entries: RoleDiffEntry[];
  totalsGained: number;
  totalsLost: number;
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

interface RightPanelRoleProps {
  roleKey: string;
  onRoleDeleted?: () => void;
}

export function RightPanelRole({ roleKey, onRoleDeleted }: RightPanelRoleProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Partial<RoleSummary>>({});
  const [lastSaveDiff, setLastSaveDiff] = useState<PermDiff | null>(null);
  const [showClone, setShowClone] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  // Apply-template state — mirrors the user-side flow but writes onto the role itself.
  const [pendingTemplate, setPendingTemplate] = useState<TemplateRow | null>(null);
  const [applyReason, setApplyReason] = useState("");

  const rolesQ = useQuery({
    queryKey: ["/api/roles/control-center"],
    queryFn: api.fetchRolesControlCenter,
  });

  const tplQ = useQuery<{ templates: TemplateRow[] }>({
    queryKey: ["/api/admin/role-templates"],
    queryFn: () => fetchJSON("/api/admin/role-templates"),
  });

  const previewQ = useQuery<RoleDiffPayload>({
    queryKey: ["preview-template-role", roleKey, pendingTemplate?.key],
    queryFn: () =>
      fetchJSON<RoleDiffPayload>(
        `/api/admin/roles/${encodeURIComponent(roleKey)}/preview-template/${pendingTemplate!.key}`,
      ),
    enabled: !!pendingTemplate,
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

  // Reset draft + transient apply state when the picked role changes.
  useEffect(() => {
    setDraft({});
    setLastSaveDiff(null);
    setPendingTemplate(null);
    setApplyReason("");
  }, [roleKey]);

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/roles/control-center"] });
    qc.invalidateQueries({ queryKey: ["/api/roles"] });
    appQueryClient.invalidateQueries({ queryKey: ["auth-permissions-matrix"] });
  };

  const saveM = useMutation({
    mutationFn: async (reason: string) => {
      if (!role || !canManage) throw new Error("Not allowed");
      // Capture the pre/post permission diff before the draft is cleared.
      const diff = computePermDiff(
        role.entityPermissions,
        draft.entityPermissions ?? role.entityPermissions,
      );
      const r = await api.saveRole(role.role, draft, reason || undefined);
      if (!r.ok) throw new Error(r.error || "Save failed");
      return diff;
    },
    onSuccess: (diff) => {
      setDraft({});
      setLastSaveDiff(diff);
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

  // Apply-template mutation — uses the canonical Task #101 endpoint and writes
  // an audit row server-side (event_type=template_applied_to_role).
  const applyTplM = useMutation({
    mutationFn: () => {
      if (!pendingTemplate || !canManage) throw new Error("Not allowed");
      return fetchJSON(
        `/api/admin/roles/${encodeURIComponent(roleKey)}/apply-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateKey: pendingTemplate.key, reason: applyReason }),
        },
      );
    },
    onSuccess: () => {
      toast({
        title: "Template applied to role",
        description: `${pendingTemplate?.name} → ${role?.label ?? roleKey}`,
      });
      setPendingTemplate(null);
      setApplyReason("");
      refetchAll();
    },
    onError: (e: Error) =>
      toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  const templates = tplQ.data?.templates ?? [];

  if (rolesQ.isLoading || permsQ.isLoading) {
    return (
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="flex items-center gap-2 py-12 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading role…
        </CardContent>
      </Card>
    );
  }

  // UI/UX audit X1 — distinguish a failed fetch from a genuinely missing role.
  // A network/permission error must NOT read as "no such role".
  if (rolesQ.isError || permsQ.isError) {
    return (
      <Card className="border-red-200 bg-red-50/40 shadow-sm" data-testid="right-panel-role-error">
        <CardContent className="py-12 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <p className="text-sm font-medium text-red-800">Couldn’t load roles</p>
          <p className="mt-1 text-xs text-red-700">
            This is a loading error, not a missing role. Check your connection and try again.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4 border-red-300 text-red-700 hover:bg-red-100"
            onClick={() => { void rolesQ.refetch(); void permsQ.refetch(); }}
            data-testid="button-retry-roles"
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!role) {
    return (
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="py-12 text-center">
          <Shield className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-700">Role not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No role matches “{roleKey}”. It may have been deleted or renamed — pick another role from the list.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="right-panel-role">
      {/* Role-side header: Apply-template + Compare. Apply writes onto the
          role itself (and audit-logs as template_applied_to_role); Compare
          opens the existing side-by-side comparison dialog. */}
      <div className="flex flex-wrap items-center justify-end gap-2" data-testid="apply-template-role-section">
        <SearchableSelect
          options={templates.map((t) => ({ value: t.key, label: t.name }))}
          value=""
          disabled={!canManage || templates.length === 0}
          onValueChange={(val) => {
            const tpl = templates.find((t) => t.key === val);
            if (tpl) {
              setPendingTemplate(tpl);
              setApplyReason("");
            }
          }}
          placeholder="Apply template…"
          searchPlaceholder="Search templates…"
          data-testid="select-apply-template-role"
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setShowCompare(true)}
          data-testid="button-compare-role"
        >
          <GitCompareArrows className="h-3.5 w-3.5" /> Compare with another role
        </Button>
      </div>

      <RoleDetailPanel
        role={role}
        users={usersQ.data ?? []}
        draft={draft}
        onUpdateDraft={(u) => setDraft((d) => ({ ...d, ...u }))}
        onResetDraft={() => setDraft({})}
        onSave={(reason) => saveM.mutate(reason)}
        onClone={() => setShowClone(true)}
        onArchive={() => setShowArchive(true)}
        onDelete={() => setShowDelete(true)}
        canManageRoles={canManage}
        isSaving={saveM.isPending}
        lastSaveDiff={lastSaveDiff}
        onDismissDiff={() => setLastSaveDiff(null)}
      />

      <RoleComparisonDialog
        open={showCompare}
        onOpenChange={setShowCompare}
        roles={rolesQ.data?.roles ?? []}
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

      {/* Apply-template-to-role preview + confirm dialog ────────────────── */}
      <Dialog
        open={!!pendingTemplate}
        onOpenChange={(o) => {
          if (!o) {
            setPendingTemplate(null);
            setApplyReason("");
          }
        }}
      >
        <DialogContent className="max-w-2xl" data-testid="dialog-apply-template-role">
          <DialogHeader>
            <DialogTitle>
              {pendingTemplate ? `Apply "${pendingTemplate.name}" to ${role.label}` : ""}
            </DialogTitle>
            {pendingTemplate && (
              <p className="text-xs text-muted-foreground">
                Writes the template's permissions onto the {role.label} role itself. Every user
                with this role is affected. The change is recorded in the change log.
              </p>
            )}
          </DialogHeader>
          {previewQ.isLoading || !previewQ.data ? (
            <div className="flex items-center gap-2 py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculating diff…
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded bg-emerald-50 p-3 text-sm" data-testid="text-role-diff-headline">
                {previewQ.data.englishHeadline}
              </div>
              {previewQ.data.entries.length > 0 && (
                <div className="max-h-72 overflow-y-auto rounded border text-xs">
                  <table className="w-full">
                    <thead className="bg-slate-50 text-left">
                      <tr>
                        <th className="px-2 py-1">Workspace</th>
                        <th className="px-2 py-1 text-emerald-700">Will gain</th>
                        <th className="px-2 py-1 text-rose-700">Will lose</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewQ.data.entries.map((e) => (
                        <tr key={e.entity} className="border-t" data-testid={`role-diff-row-${e.entity}`}>
                          <td className="px-2 py-1">{e.title}</td>
                          <td className="px-2 py-1 text-emerald-700">{e.gained.join(", ") || "—"}</td>
                          <td className="px-2 py-1 text-rose-700">{e.lost.join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="role-apply-reason" className="text-xs">
                  Reason for change *
                </Label>
                <Textarea
                  id="role-apply-reason"
                  value={applyReason}
                  onChange={(e) => setApplyReason(e.target.value)}
                  placeholder="Why are you applying this template to the role?"
                  className="text-xs"
                  rows={2}
                  data-testid="input-role-apply-reason"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPendingTemplate(null);
                setApplyReason("");
              }}
              data-testid="button-cancel-apply-role"
            >
              Cancel
            </Button>
            <Button
              onClick={() => applyTplM.mutate()}
              disabled={!applyReason.trim() || applyTplM.isPending || !canManage}
              className="bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-confirm-apply-role"
            >
              {applyTplM.isPending ? "Applying…" : "Apply template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
