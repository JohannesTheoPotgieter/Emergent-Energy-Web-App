import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

type Deliverable = { reference: string; uploadedBy: string; uploadedDate: string };
type HandoverData = {
  project: any;
  handover: any;
  blockers: string[];
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED_FOR_PM_REVIEW: "Submitted for PM Review",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

const isPmRole = (role?: string) => ["PROJECT_MANAGER_SITE", "PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN", "admin"].includes(role || "");

export default function PdPmHandoverPage() {
  const [, params] = useRoute("/pd/handover/:projectId");
  const projectId = Number(params?.projectId);
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<HandoverData>({
    queryKey: ["pd-pm-handover", projectId],
    enabled: Number.isFinite(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const [form, setForm] = useState<any>({});
  useEffect(() => {
    if (data) {
      setForm({
        pdOwner: data.handover.pd_owner || data.project.pd || "",
        pmOwner: data.handover.pm_owner || data.project.pm || "",
        summary: data.handover.summary || "",
        risks: data.handover.risks || "",
        assumptions: data.handover.assumptions || "",
        engineeringStatus: data.handover.engineering_status || "",
        qualityStatus: data.handover.quality_status || "",
        notesToPm: data.handover.notes_to_pm || "",
        deliverables: data.handover.deliverables || {},
      });
    }
  }, [data]);

  const status = data?.handover?.status || "DRAFT";
  const pdCanEdit = user?.role === "PROJECT_DEVELOPER" || user?.role === "admin";
  const pmCanReview = isPmRole(user?.role);

  const saveDraft = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}/draft`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Draft save failed");
    },
    onSuccess: () => {
      toast({ title: "Draft saved" });
      qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}/submit`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Submit failed");
    },
    onSuccess: () => { toast({ title: "Submitted for PM Review" }); qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] }); },
    onError: (e: any) => toast({ title: "Cannot submit", description: e.message, variant: "destructive" }),
  });

  const accept = useMutation({ mutationFn: async () => {
    const res = await fetch(`/api/pd-pm-handover/${projectId}/accept`, { method: "POST", credentials: "include" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Accept failed");
  }, onSuccess: () => { toast({ title: "Handover accepted" }); qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] }); }});

  const reject = useMutation({ mutationFn: async () => {
    const reason = window.prompt("Rejection reason (required):") || "";
    const res = await fetch(`/api/pd-pm-handover/${projectId}/reject`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Reject failed");
  }, onSuccess: () => { toast({ title: "Handover rejected" }); qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] }); }});

  const setDeliverable = (key: string, patch: Partial<Deliverable>) => {
    const current = (form.deliverables?.[key] || {}) as Deliverable;
    setForm((f: any) => ({ ...f, deliverables: { ...(f.deliverables || {}), [key]: { ...current, ...patch } } }));
  };

  if (isLoading || !data) return <div className="p-6">Loading handover…</div>;

  const deliverables = [
    { key: "handoverCharter", label: "Handover Charter" },
    { key: "siteVisitReport", label: "Site Visit Report" },
    { key: "signedCostProposal", label: "Signed Cost Proposal" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>PD to PM Handover — {data.project.projectName}</CardTitle>
          <p className="text-sm text-muted-foreground">Status: <strong>{STATUS_LABELS[status] || status}</strong> · PD: {data.project.pd || "—"} · PM: {data.project.pm || "—"}</p>
          <p className="text-xs text-muted-foreground">Blockers: {data.blockers.length} · Mandatory deliverables complete: {3 - deliverables.filter((d) => !(form.deliverables?.[d.key]?.reference)).length}/3</p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle>Handover checklist</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {data.blockers.length > 0 && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">Cannot proceed. Missing items: {data.blockers.join(", ")}.</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>Scope Summary</Label><Textarea value={form.summary || ""} onChange={(e) => setForm({ ...form, summary: e.target.value })} disabled={!pdCanEdit} /></div>
            <div><Label>Notes to PM</Label><Textarea value={form.notesToPm || ""} onChange={(e) => setForm({ ...form, notesToPm: e.target.value })} disabled={!pdCanEdit} /></div>
            <div><Label>Open Risks</Label><Textarea value={form.risks || ""} onChange={(e) => setForm({ ...form, risks: e.target.value })} disabled={!pdCanEdit} /></div>
            <div><Label>Assumptions</Label><Textarea value={form.assumptions || ""} onChange={(e) => setForm({ ...form, assumptions: e.target.value })} disabled={!pdCanEdit} /></div>
            <div><Label>Engineering Status</Label><Input value={form.engineeringStatus || ""} onChange={(e) => setForm({ ...form, engineeringStatus: e.target.value })} disabled={!pdCanEdit} /></div>
            <div><Label>Quality Check Status</Label><Input value={form.qualityStatus || ""} onChange={(e) => setForm({ ...form, qualityStatus: e.target.value })} disabled={!pdCanEdit} /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Mandatory deliverables</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {deliverables.map((d) => {
            const item = form.deliverables?.[d.key] || {};
            const complete = !!item.reference;
            return (
              <div key={d.key} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end border rounded p-2">
                <div className="font-medium">{d.label}</div>
                <Input placeholder="File name / document reference" value={item.reference || ""} onChange={(e) => setDeliverable(d.key, { reference: e.target.value })} disabled={!pdCanEdit} />
                <Input placeholder="Uploaded by" value={item.uploadedBy || ""} onChange={(e) => setDeliverable(d.key, { uploadedBy: e.target.value })} disabled={!pdCanEdit} />
                <Input type="date" value={item.uploadedDate || ""} onChange={(e) => setDeliverable(d.key, { uploadedDate: e.target.value })} disabled={!pdCanEdit} />
                <div className={`text-xs ${complete ? "text-green-700" : "text-red-700"}`}>{complete ? "Complete" : "Missing"}</div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => saveDraft.mutate()} disabled={!pdCanEdit}>Save Draft</Button>
        <Button onClick={() => submit.mutate()} disabled={!pdCanEdit || status === "ACCEPTED"}>Submit for PM Review</Button>
        <Button onClick={() => accept.mutate()} disabled={!pmCanReview || status !== "SUBMITTED_FOR_PM_REVIEW"}>Accept Handover</Button>
        <Button variant="destructive" onClick={() => reject.mutate()} disabled={!pmCanReview || status !== "SUBMITTED_FOR_PM_REVIEW"}>Reject Handover</Button>
      </div>

      {status === "ACCEPTED" && (
        <Card>
          <CardHeader><CardTitle>Excel-linked PM operating file</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">Now available after accepted handover.</p>
            <Input placeholder="Paste Excel tracker link (optional)" value={data.project.excelTrackerLink || ""} disabled />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
