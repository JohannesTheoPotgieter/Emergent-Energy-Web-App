// People tab. Apply-template writes USER OVERRIDES only; the role
// definition is never mutated here.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Search, Sparkles, Loader2, ShieldCheck, UserCog } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { COMPANY_ROLES } from "@shared/schema";

interface UserRow { id: number; username: string; name?: string; role: string; email?: string }
interface TemplateRow { id: number; key: string; name: string; summary: string; category: string }
interface DiffRow {
  entity: string; title: string; category: string;
  gained: string[]; lost: string[];
}
interface DiffPayload {
  targetKind: "user";
  targetUserId: number;
  currentRole: string;
  templateKey: string; templateName: string; templateSummary: string;
  entries: DiffRow[]; totalsGained: number; totalsLost: number;
  englishHeadline: string;
}
interface ApplyResponse { ok: true; written: number; cleared: number }

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function PeopleTab() {
  const [filter, setFilter] = useState("");
  const [target, setTarget] = useState<{ user: UserRow; template: TemplateRow } | null>(null);
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  // /api/admin/users returns a raw array; normalise to handle either shape.
  const usersQ = useQuery<UserRow[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const raw = await fetchJSON<UserRow[] | { users: UserRow[] }>("/api/admin/users");
      if (Array.isArray(raw)) return raw;
      if (raw && Array.isArray(raw.users)) return raw.users;
      return [];
    },
  });
  const tplQ = useQuery<{ templates: TemplateRow[] }>({
    queryKey: ["/api/admin/role-templates"],
    queryFn: () => fetchJSON("/api/admin/role-templates"),
  });

  const previewQ = useQuery<DiffPayload>({
    queryKey: ["preview-template-user", target?.user.id, target?.template.key],
    queryFn: () =>
      fetchJSON<DiffPayload>(
        `/api/admin/users/${target!.user.id}/preview-template/${target!.template.key}`,
      ),
    enabled: !!target,
  });

  const applyM = useMutation<ApplyResponse, Error>({
    mutationFn: () =>
      fetchJSON<ApplyResponse>(`/api/admin/users/${target!.user.id}/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey: target!.template.key, reason }),
      }),
    onSuccess: (r) => {
      toast({
        title: "Template applied to user",
        description: `${target?.template.name} → ${target?.user.name ?? target?.user.username} (${r.written} override${r.written === 1 ? "" : "s"} written, ${r.cleared} cleared)`,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setTarget(null); setReason("");
    },
    onError: (err) =>
      toast({ title: "Apply failed", description: String(err?.message ?? err), variant: "destructive" }),
  });

  // Reassign a user's role baseline (separate from override application).
  const reassignRoleM = useMutation<{ ok: true } & Record<string, unknown>, Error, { userId: number; newRole: string }>({
    mutationFn: async ({ userId, newRole }) =>
      fetchJSON<{ ok: true } & Record<string, unknown>>(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      }),
    onSuccess: (_data, variables) => {
      toast({
        title: "Role reassigned",
        description: `User #${variables.userId} → ${variables.newRole}. Existing overrides remain in place.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (err) =>
      toast({
        title: "Role change failed",
        description: String(err?.message ?? err),
        variant: "destructive",
      }),
  });

  const users = usersQ.data ?? [];
  const templates = tplQ.data?.templates ?? [];
  const filtered = users.filter((u) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q) ||
      (u.name ?? "").toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4" data-testid="people-tab">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" /> People
          </CardTitle>
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            Two paths per person: <strong>Change role</strong> reassigns the user to a different role baseline; <strong>Apply template</strong> writes one-off overrides for that user only. Neither path changes the role for everyone.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              data-testid="input-people-filter"
              placeholder="Search by name, username, role, or email…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-9"
            />
          </div>
          {usersQ.isLoading ? (
            <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading users…</div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-3 py-2">Person</th>
                    <th className="px-3 py-2">Role today</th>
                    <th className="px-3 py-2">Change role (reassign baseline)</th>
                    <th className="px-3 py-2">Apply template (overrides only)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((u) => (
                    <tr key={u.id} className="border-t" data-testid={`row-user-${u.id}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium" data-testid={`text-user-name-${u.id}`}>{u.name ?? u.username}</div>
                        <div className="text-xs text-slate-500">{u.email ?? u.username}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" data-testid={`badge-role-${u.id}`}>{u.role}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <UserCog className="h-3 w-3 text-slate-400" />
                          <select
                            data-testid={`select-change-role-${u.id}`}
                            className="rounded border px-2 py-1 text-sm"
                            value={u.role}
                            disabled={reassignRoleM.isPending}
                            onChange={(e) => {
                              const newRole = e.target.value;
                              if (!newRole || newRole === u.role) return;
                              const ok = window.confirm(
                                `Reassign ${u.name ?? u.username} from "${u.role}" to "${newRole}"?\n\n` +
                                  "This changes the user's role baseline. Any existing one-off overrides for this user remain in place on top of the new baseline.",
                              );
                              if (ok) {
                                reassignRoleM.mutate({ userId: u.id, newRole });
                              } else {
                                e.currentTarget.value = u.role;
                              }
                            }}
                          >
                            {(COMPANY_ROLES as readonly string[]).map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          data-testid={`select-template-${u.id}`}
                          className="rounded border px-2 py-1 text-sm"
                          defaultValue=""
                          onChange={(e) => {
                            const tpl = templates.find((t) => t.key === e.target.value);
                            if (tpl) setTarget({ user: u, template: tpl });
                            e.currentTarget.value = "";
                          }}
                        >
                          <option value="" disabled>Choose a template…</option>
                          {templates.map((t) => (
                            <option key={t.key} value={t.key}>{t.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-apply-template">
          <DialogHeader>
            <DialogTitle>
              {target ? `Apply "${target.template.name}" to ${target.user.name ?? target.user.username}` : ""}
            </DialogTitle>
            {target && (
              <p className="text-xs text-slate-500">
                Writes overrides for this user only. Their role ({target.user.role}) is unchanged.
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
                    <thead className="bg-slate-50 text-left"><tr>
                      <th className="px-2 py-1">Workspace</th>
                      <th className="px-2 py-1 text-emerald-700">Will gain</th>
                      <th className="px-2 py-1 text-rose-700">Will lose</th>
                    </tr></thead>
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
                <label className="text-xs font-medium text-slate-600">Reason (saved to audit log)</label>
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
            <Button variant="outline" onClick={() => setTarget(null)} data-testid="button-cancel-apply">Cancel</Button>
            <Button
              data-testid="button-confirm-apply"
              disabled={!reason.trim() || applyM.isPending || previewQ.isLoading}
              onClick={() => applyM.mutate()}
            >
              {applyM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
