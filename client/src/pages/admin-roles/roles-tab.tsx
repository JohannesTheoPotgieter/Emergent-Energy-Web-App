// Roles tab — Task #101.
// Gallery of curated role templates grouped by category. Admin can preview
// what each template grants and apply it to one of the existing roles.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { COMPANY_ROLES } from "@shared/schema";

interface TemplateRow {
  id: number; key: string; name: string; summary: string;
  category: string; sections: string[];
}
interface DiffPayload {
  role: string; templateKey: string; templateName: string; templateSummary: string;
  entries: any[]; totalsGained: number; totalsLost: number; englishHeadline: string;
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function RolesTab() {
  const [target, setTarget] = useState<{ template: TemplateRow; role: string } | null>(null);
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const tplQ = useQuery<{ templates: TemplateRow[] }>({
    queryKey: ["/api/admin/role-templates"],
    queryFn: () => fetchJSON("/api/admin/role-templates"),
  });
  const previewQ = useQuery<DiffPayload>({
    queryKey: ["preview-template-role", target?.role, target?.template.key],
    queryFn: () =>
      fetchJSON<DiffPayload>(
        `/api/admin/roles/${target!.role}/preview-template/${target!.template.key}`,
      ),
    enabled: !!target,
  });
  const applyM = useMutation({
    mutationFn: () =>
      fetchJSON(`/api/admin/roles/${target!.role}/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey: target!.template.key, reason }),
      }),
    onSuccess: () => {
      toast({ title: "Template applied to role", description: `${target?.template.name} → ${target?.role}` });
      qc.invalidateQueries({ queryKey: ["/api/admin/role-templates"] });
      setTarget(null); setReason("");
    },
    onError: (err: any) => toast({ title: "Apply failed", description: String(err?.message ?? err), variant: "destructive" }),
  });

  const grouped = (() => {
    const out: Record<string, TemplateRow[]> = {};
    for (const t of tplQ.data?.templates ?? []) {
      (out[t.category] ??= []).push(t);
    }
    return out;
  })();

  return (
    <div className="space-y-6" data-testid="roles-tab">
      {tplQ.isLoading && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates…</div>}
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
