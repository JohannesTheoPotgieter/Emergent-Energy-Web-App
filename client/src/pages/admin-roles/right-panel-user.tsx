// Task #107 — Right panel for a selected person.
//
// Folds the legacy people-tab apply-template flow + user-overrides view +
// user-effective-perms into one focused, scrollable panel. Account-level
// CRUD lives behind the "Manage account" button (drawer).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, ShieldCheck, UserCog, Plus, Trash2, KeyRound, AlertTriangle } from "lucide-react";
import { COMPANY_ROLES, ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";
import * as api from "../admin-settings/settings-api";
import { ACTIONS, ENTITY_DESCRIPTIONS } from "../admin-settings/settings-types";
import type { RoleSummary, UserOverrideRow, UserSummary } from "../admin-settings/settings-types";
import { UserEffectivePerms } from "../admin-settings/users/user-effective-perms";

interface TemplateRow {
  id: number;
  key: string;
  name: string;
  summary: string;
  category: string;
}
interface DiffEntry {
  entity: string; title: string; category: string;
  gained: string[]; lost: string[];
}
interface DiffPayload {
  templateName: string; templateSummary: string;
  englishHeadline: string;
  entries: DiffEntry[];
  totalsGained: number; totalsLost: number;
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

interface RightPanelUserProps {
  user: UserSummary;
  onOpenManageAccount: () => void;
  onUserDeleted?: (userId: number) => void;
}

export function RightPanelUser({ user, onOpenManageAccount }: RightPanelUserProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [pendingTemplate, setPendingTemplate] = useState<TemplateRow | null>(null);
  const [reason, setReason] = useState("");

  // Add-override state
  const [showAddOverride, setShowAddOverride] = useState(false);
  const [newEntity, setNewEntity] = useState("");
  const [newAction, setNewAction] = useState("view");
  const [newAllowed, setNewAllowed] = useState(true);
  const [newReason, setNewReason] = useState("");

  // Reset transient state when the picked user changes.
  useEffect(() => {
    setPendingTemplate(null);
    setReason("");
    setShowAddOverride(false);
    setNewEntity(""); setNewAction("view"); setNewAllowed(true); setNewReason("");
  }, [user.id]);

  // Permission gate — read-only viewers see the panel but cannot mutate.
  const permsQ = useQuery({
    queryKey: ["/api/auth/permissions"],
    queryFn: api.fetchPermissions,
    staleTime: 60_000,
  });
  const canManage = Boolean(permsQ.data?.canManageRoles);

  const tplQ = useQuery<{ templates: TemplateRow[] }>({
    queryKey: ["/api/admin/role-templates"],
    queryFn: () => fetchJSON("/api/admin/role-templates"),
  });

  const rolesQ = useQuery<RoleSummary[]>({
    queryKey: ["/api/roles"],
    queryFn: api.fetchRoles,
  });

  const overridesQ = useQuery<UserOverrideRow[]>({
    queryKey: ["/api/admin/user-overrides", user.id],
    queryFn: () => api.fetchUserOverrides(user.id),
  });

  const previewQ = useQuery<DiffPayload>({
    queryKey: ["preview-template-user", user.id, pendingTemplate?.key],
    queryFn: () =>
      fetchJSON<DiffPayload>(`/api/admin/users/${user.id}/preview-template/${pendingTemplate!.key}`),
    enabled: !!pendingTemplate,
  });

  const reassignM = useMutation({
    mutationFn: async (newRole: string) => {
      const ok = await api.updateUserRole(user.id, newRole);
      if (!ok) throw new Error("Role change failed");
      return newRole;
    },
    onSuccess: (newRole) => {
      toast({ title: "Role reassigned", description: `${user.name} → ${newRole}` });
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (e: Error) =>
      toast({ title: "Role change failed", description: e.message, variant: "destructive" }),
  });

  const applyTplM = useMutation({
    mutationFn: () =>
      fetchJSON(`/api/admin/users/${user.id}/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey: pendingTemplate!.key, reason }),
      }),
    onSuccess: () => {
      toast({
        title: "Template applied",
        description: `${pendingTemplate?.name} → ${user.name}`,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/user-overrides", user.id] });
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setPendingTemplate(null); setReason("");
    },
    onError: (e: Error) =>
      toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  const addOverrideM = useMutation({
    mutationFn: async () => {
      const r = await api.addUserOverride({
        userId: user.id, entity: newEntity, action: newAction,
        allowed: newAllowed, reason: newReason || null,
      });
      if (!r.ok) throw new Error(r.error || "Failed");
    },
    onSuccess: () => {
      toast({ title: "Exception added" });
      qc.invalidateQueries({ queryKey: ["/api/admin/user-overrides", user.id] });
      setShowAddOverride(false);
      setNewEntity(""); setNewAction("view"); setNewAllowed(true); setNewReason("");
    },
    onError: (e: Error) =>
      toast({ title: "Could not add exception", description: e.message, variant: "destructive" }),
  });

  const removeOverrideM = useMutation({
    mutationFn: async (id: number) => {
      const ok = await api.deleteUserOverride(id);
      if (!ok) throw new Error("Remove failed");
    },
    onSuccess: () => {
      toast({ title: "Exception removed" });
      qc.invalidateQueries({ queryKey: ["/api/admin/user-overrides", user.id] });
    },
    onError: (e: Error) =>
      toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  const userRole = useMemo(
    () => rolesQ.data?.find((r) => r.role === user.role),
    [rolesQ.data, user.role],
  );

  const overrides = overridesQ.data ?? [];
  const templates = tplQ.data?.templates ?? [];
  const entityOptions = ENTITY_PERMISSION_DEFAULTS.map((e) => e.entity);

  return (
    <div className="space-y-4" data-testid="right-panel-user">
      {/* Header card — name, role badge, manage account button */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                {(user.name || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-gray-900" data-testid="user-name">
                  {user.name}
                </h2>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">{user.email}</span>
                  <span className="text-gray-300">·</span>
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">{user.role}</Badge>
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onOpenManageAccount}
              disabled={!permsQ.data?.canManageUsers}
              title={!permsQ.data?.canManageUsers ? "You do not have permission to manage accounts" : undefined}
              data-testid="button-manage-account"
            >
              <UserCog className="h-3.5 w-3.5" /> Manage account
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change role + Apply template */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            Change what they can do
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Reassign role</span> picks a new baseline for this person.{" "}
            <span className="font-medium">Apply template</span> writes one-off exceptions on top of their current role — the role itself is not touched.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div data-testid="reassign-role-section">
              <Label className="text-xs font-medium text-gray-600">Reassign role</Label>
              <SearchableSelect
                options={(COMPANY_ROLES as readonly string[]).map((r) => ({ value: r, label: r }))}
                value={user.role}
                disabled={!canManage}
                onValueChange={(val) => {
                  if (!val || val === user.role) return;
                  if (window.confirm(
                    `Reassign ${user.name} from "${user.role}" to "${val}"?\n\n` +
                    "This changes their baseline role. Existing one-off exceptions remain on top of the new baseline.",
                  )) {
                    reassignM.mutate(val);
                  }
                }}
                placeholder="Select a role"
                searchPlaceholder="Search roles…"
              />
            </div>
            <div data-testid="apply-template-section">
              <Label className="text-xs font-medium text-gray-600">Apply template (writes exceptions)</Label>
              <SearchableSelect
                options={templates.map((t) => ({ value: t.key, label: t.name }))}
                value=""
                disabled={!canManage}
                onValueChange={(val) => {
                  const tpl = templates.find((t) => t.key === val);
                  if (tpl) {
                    setPendingTemplate(tpl);
                    setReason("");
                  }
                }}
                placeholder="Pick a template…"
                searchPlaceholder="Search templates…"
              />
            </div>
          </div>
          {!canManage && !permsQ.isLoading && (
            <p className="text-xs text-amber-700" data-testid="text-readonly-notice">
              You have view-only access to this page. Ask an administrator to make changes.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Exceptions */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Exceptions ({overrides.length})
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              disabled={!canManage}
              onClick={() => setShowAddOverride(true)}
              data-testid="button-add-exception"
            >
              <Plus className="h-3 w-3" /> Add exception
            </Button>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Use sparingly. Exceptions take precedence over the role's defaults and should always include a reason.
          </p>
        </CardHeader>
        <CardContent>
          {overridesQ.isLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : overrides.length === 0 ? (
            <div className="rounded border border-dashed py-6 text-center text-xs text-gray-400">
              No exceptions. {user.name} follows the {user.role} role exactly.
            </div>
          ) : (
            <div className="overflow-hidden rounded border">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-600">Workspace</th>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-600">Action</th>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-600">Access</th>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-600">Reason</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((o) => (
                    <tr key={o.id} className="border-t hover:bg-gray-50/50" data-testid={`exception-row-${o.id}`}>
                      <td className="px-2 py-1.5 font-mono">{o.entity}</td>
                      <td className="px-2 py-1.5 font-mono">{o.action}</td>
                      <td className="px-2 py-1.5">
                        <Badge variant={o.allowed ? "default" : "destructive"} className={o.allowed ? "h-4 bg-emerald-100 text-emerald-700 border-emerald-200 px-1 text-[10px]" : "h-4 px-1 text-[10px]"}>
                          {o.allowed ? "Granted" : "Denied"}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-gray-500">{o.reason || "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          disabled={!canManage}
                          onClick={() => removeOverrideM.mutate(o.id)}
                          aria-label="Remove exception"
                          data-testid={`button-remove-exception-${o.id}`}
                        >
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Effective permissions */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="h-4 w-4 text-emerald-600" />
            What {user.name.split(" ")[0] || user.name} can do today
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Computed live from their role + exceptions. Use the search box inside the table to find a workspace.
          </p>
        </CardHeader>
        <CardContent>
          {rolesQ.isLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : (
            <UserEffectivePerms user={user} role={userRole} />
          )}
        </CardContent>
      </Card>

      {/* Apply template preview dialog */}
      <Dialog open={!!pendingTemplate} onOpenChange={(o) => !o && setPendingTemplate(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-apply-template">
          <DialogHeader>
            <DialogTitle>
              {pendingTemplate ? `Apply "${pendingTemplate.name}" to ${user.name}` : ""}
            </DialogTitle>
            {pendingTemplate && (
              <p className="text-xs text-muted-foreground">
                Writes exceptions for {user.name} only. Their role ({user.role}) stays the same.
              </p>
            )}
          </DialogHeader>
          {previewQ.isLoading || !previewQ.data ? (
            <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Calculating diff…</div>
          ) : (
            <div className="space-y-3">
              <div className="rounded bg-emerald-50 p-3 text-sm" data-testid="text-diff-headline">
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
                        <tr key={e.entity} className="border-t" data-testid={`diff-row-${e.entity}`}>
                          <td className="px-2 py-1">{e.title}</td>
                          <td className="px-2 py-1 text-emerald-700">{e.gained.join(", ") || "—"}</td>
                          <td className="px-2 py-1 text-rose-700">{e.lost.join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div>
                <Label className="text-xs font-medium text-gray-600">Reason (saved to change history)</Label>
                <Textarea
                  data-testid="input-apply-reason"
                  placeholder="e.g. Promoting Lara to Engineering Manager."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingTemplate(null)} data-testid="button-cancel-apply">Cancel</Button>
            <Button
              data-testid="button-confirm-apply"
              disabled={!canManage || !reason.trim() || applyTplM.isPending || previewQ.isLoading}
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => applyTplM.mutate()}
            >
              {applyTplM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add exception dialog */}
      <Dialog open={showAddOverride} onOpenChange={setShowAddOverride}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Add an exception
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Workspace</Label>
              <SearchableSelect
                options={entityOptions.map((e) => ({ value: e, label: `${e} — ${ENTITY_DESCRIPTIONS[e] || e}` }))}
                value={newEntity}
                onValueChange={setNewEntity}
                placeholder="Select workspace…"
              />
            </div>
            <div>
              <Label className="text-xs">Action</Label>
              <SearchableSelect
                options={ACTIONS.map((a) => ({ value: a, label: a }))}
                value={newAction}
                onValueChange={setNewAction}
                placeholder="Select action…"
              />
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Access</Label>
              <Switch checked={newAllowed} onCheckedChange={setNewAllowed} />
              <span className="text-sm">{newAllowed ? "Grant" : "Deny"}</span>
            </div>
            <div>
              <Label className="text-xs">Reason (required)</Label>
              <Input
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="Why this exception exists…"
                data-testid="input-exception-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddOverride(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!canManage || !newEntity || !newAction || newReason.trim().length < 5 || addOverrideM.isPending}
              onClick={() => addOverrideM.mutate()}
              data-testid="button-confirm-add-exception"
            >
              {addOverrideM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add exception"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
