// Roles tab — Task #101.
//
// Three sections:
//   1. Compare two roles — picks A and B and lists what each can/can't do
//      in plain English, grouped by registry category.
//   2. Curated template gallery — apply a template to a role.
//   3. (Implicit) Detail view appears inside the Compare card so the COO
//      can see a single role's full grant list by picking the same role on
//      both sides — every action falls into "shared" and renders as a
//      grouped, plain-English permission list.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, GitCompare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { COMPANY_ROLES } from "@shared/schema";

interface TemplateRow {
  id: number; key: string; name: string; summary: string;
  category: string; sections: string[];
}

// Mirrors server DiffEntry shape (role-template-service.ts).
interface DiffRowEntry {
  entity: string;
  title: string;
  category: string;
  gained: string[];
  lost: string[];
}

interface DiffPayload {
  role: string; templateKey: string; templateName: string; templateSummary: string;
  entries: DiffRowEntry[]; totalsGained: number; totalsLost: number; englishHeadline: string;
}

// Mirrors server RoleCompareEntry shape.
interface CompareEntry {
  entity: string;
  title: string;
  category: string;
  aOnly: string[];
  bOnly: string[];
  shared: string[];
}

interface CompareResult {
  roleA: string;
  roleB: string;
  entries: CompareEntry[];
  totalsAOnly: number;
  totalsBOnly: number;
  totalsShared: number;
  englishHeadline: string;
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

// Action chip ordering — keeps the plain-English list stable.
const ACTION_ORDER: Record<string, number> = {
  view: 0, create: 1, edit: 2, approve: 3, override: 4, delete: 5,
};
function sortActions(a: string[]): string[] {
  return [...a].sort((x, y) => (ACTION_ORDER[x] ?? 99) - (ACTION_ORDER[y] ?? 99));
}

// Group compare entries by registry category for the plain-English layout.
function groupByCategory<T extends { category: string }>(rows: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[r.category] ??= []).push(r);
  return out;
}

export function RolesTab() {
  const [target, setTarget] = useState<{ template: TemplateRow; role: string } | null>(null);
  const [reason, setReason] = useState("");
  const [roleA, setRoleA] = useState<string>("");
  const [roleB, setRoleB] = useState<string>("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const tplQ = useQuery<{ templates: TemplateRow[] }>({
    queryKey: ["/api/admin/role-templates"],
    queryFn: () => fetchJSON("/api/admin/role-templates"),
  });

  const compareQ = useQuery<CompareResult>({
    queryKey: ["/api/admin/roles/compare", roleA, roleB],
    queryFn: () =>
      fetchJSON<CompareResult>(
        `/api/admin/roles/compare?a=${encodeURIComponent(roleA)}&b=${encodeURIComponent(roleB)}`,
      ),
    enabled: !!roleA && !!roleB,
  });

  const previewQ = useQuery<DiffPayload>({
    queryKey: ["preview-template-role", target?.role, target?.template.key],
    queryFn: () =>
      fetchJSON<DiffPayload>(
        `/api/admin/roles/${target!.role}/preview-template/${target!.template.key}`,
      ),
    enabled: !!target,
  });

  const applyM = useMutation<unknown, Error>({
    mutationFn: () =>
      fetchJSON(`/api/admin/roles/${target!.role}/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey: target!.template.key, reason }),
      }),
    onSuccess: () => {
      toast({ title: "Template applied to role", description: `${target?.template.name} → ${target?.role}` });
      qc.invalidateQueries({ queryKey: ["/api/admin/role-templates"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/roles/compare"] });
      setTarget(null); setReason("");
    },
    onError: (err) =>
      toast({ title: "Apply failed", description: errorMessage(err), variant: "destructive" }),
  });

  const grouped = useMemo(() => {
    const out: Record<string, TemplateRow[]> = {};
    for (const t of tplQ.data?.templates ?? []) {
      (out[t.category] ??= []).push(t);
    }
    return out;
  }, [tplQ.data]);

  const compareGrouped = useMemo(
    () => (compareQ.data ? groupByCategory(compareQ.data.entries) : {}),
    [compareQ.data],
  );

  const sameRolePicked = !!roleA && roleA === roleB;

  return (
    <div className="space-y-6" data-testid="roles-tab">
      {/* ============== Compare two roles ============== */}
      <Card data-testid="card-compare-roles">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCompare className="h-4 w-4 text-emerald-600" />
            Compare two roles {sameRolePicked && <Badge variant="outline" className="ml-1 text-xs">single-role detail</Badge>}
          </CardTitle>
          <p className="text-xs text-slate-500">
            Pick any two roles to see what each can do — grouped by workspace, in plain English.
            Pick the same role on both sides to view a single role's full grant list.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-600">Role A</label>
              <select
                data-testid="select-compare-role-a"
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
                value={roleA}
                onChange={(e) => setRoleA(e.target.value)}
              >
                <option value="">Choose a role…</option>
                {(COMPANY_ROLES as readonly string[]).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Role B</label>
              <select
                data-testid="select-compare-role-b"
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
                value={roleB}
                onChange={(e) => setRoleB(e.target.value)}
              >
                <option value="">Choose a role…</option>
                {(COMPANY_ROLES as readonly string[]).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {!roleA || !roleB ? (
            <div className="rounded border border-dashed p-3 text-xs text-slate-500" data-testid="text-compare-hint">
              Pick a role on both sides to see the comparison.
            </div>
          ) : compareQ.isLoading || !compareQ.data ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculating comparison…
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded bg-emerald-50 p-3 text-sm" data-testid="text-compare-headline">
                {compareQ.data.englishHeadline}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                <Badge variant="outline" data-testid="badge-totals-a-only">
                  Only {compareQ.data.roleA}: {compareQ.data.totalsAOnly}
                </Badge>
                <Badge variant="outline" data-testid="badge-totals-b-only">
                  Only {compareQ.data.roleB}: {compareQ.data.totalsBOnly}
                </Badge>
                <Badge variant="outline" data-testid="badge-totals-shared">
                  Shared: {compareQ.data.totalsShared}
                </Badge>
              </div>

              {Object.entries(compareGrouped).map(([cat, rows]) => (
                <section key={cat} data-testid={`compare-category-${cat}`} className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase text-slate-500">{cat}</h3>
                  <div className="overflow-x-auto rounded border text-xs">
                    <table className="w-full">
                      <thead className="bg-slate-50 text-left">
                        <tr>
                          <th className="px-2 py-1">Workspace</th>
                          <th className="px-2 py-1 text-emerald-700">Only {compareQ.data!.roleA}</th>
                          <th className="px-2 py-1 text-sky-700">Only {compareQ.data!.roleB}</th>
                          <th className="px-2 py-1 text-slate-700">Shared by both</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.entity} className="border-t" data-testid={`compare-row-${r.entity}`}>
                            <td className="px-2 py-1">
                              <div className="font-medium">{r.title}</div>
                            </td>
                            <td className="px-2 py-1 text-emerald-700">{sortActions(r.aOnly).join(", ") || "—"}</td>
                            <td className="px-2 py-1 text-sky-700">{sortActions(r.bOnly).join(", ") || "—"}</td>
                            <td className="px-2 py-1 text-slate-700">{sortActions(r.shared).join(", ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============== Template gallery ============== */}
      {tplQ.isLoading && (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
        </div>
      )}
      {Object.entries(grouped).map(([cat, list]) => (
        <section key={cat} className="space-y-2" data-testid={`category-${cat}`}>
          <h2 className="text-sm font-semibold uppercase text-slate-500">{cat}</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {list.map((t) => (
              <Card key={t.key} data-testid={`card-template-${t.key}`}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-emerald-600" /> {t.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-slate-600" data-testid={`text-template-summary-${t.key}`}>{t.summary}</p>
                  <div className="flex flex-wrap gap-1">
                    {t.sections.map((s) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Apply to role</label>
                    <select
                      data-testid={`select-role-${t.key}`}
                      className="mt-1 w-full rounded border px-2 py-1 text-sm"
                      defaultValue=""
                      onChange={(e) => e.target.value && setTarget({ template: t, role: e.target.value })}
                    >
                      <option value="" disabled>Choose a role…</option>
                      {(COMPANY_ROLES as readonly string[]).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{target ? `Apply "${target.template.name}" to role "${target.role}"` : ""}</DialogTitle>
          </DialogHeader>
          {previewQ.isLoading || !previewQ.data ? (
            <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Calculating diff…</div>
          ) : (
            <div className="space-y-3">
              <div className="rounded bg-emerald-50 p-3 text-sm" data-testid="text-roles-diff-headline">{previewQ.data.englishHeadline}</div>
              <div>
                <label className="text-xs font-medium text-slate-600">Reason (saved to audit log)</label>
                <Textarea data-testid="input-roles-apply-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Aligning Engineering Manager role with new SOP." />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button disabled={!reason.trim() || applyM.isPending} onClick={() => applyM.mutate()} data-testid="button-roles-confirm-apply">
              {applyM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
