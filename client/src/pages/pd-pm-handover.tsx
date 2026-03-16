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
import { AlertTriangle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Deliverable = { reference: string; uploadedBy: string; uploadedDate: string };
type EvidenceEval = {
  totalRequired: number;
  totalPresent: number;
  missingItems: Array<{ requirementKey: string; label: string; missingBy: number }>;
  score: number;
  threshold: number;
  pass: boolean;
};

type HandoverData = {
  project: any;
  handover: any;
  blockers: string[];
  evidence?: EvidenceEval;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED_FOR_PM_REVIEW: "Submitted for PM Review",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

const PM_REVIEW_ROLES = ["PROJECT_MANAGER_SITE", "PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN", "admin"];
const isPmRole = (role?: string) => PM_REVIEW_ROLES.includes(role || "");

const parseErrorMessage = async (res: Response, fallback: string) => {
  const data = await res.json().catch(() => null);
  return data?.error || data?.message || fallback;
};

export default function PdPmHandoverPage() {
  const [, params] = useRoute("/pd/handover/:projectId");
  const projectId = Number(params?.projectId);
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectInlineError, setRejectInlineError] = useState<string | null>(null);
  const [excelTrackerDraft, setExcelTrackerDraft] = useState("");
  const [evidenceOverrideReason, setEvidenceOverrideReason] = useState("");
  const [newEvidence, setNewEvidence] = useState({ requirementKey: "", evidenceType: "document", title: "", valueRef: "" });

  const { data, isLoading, error: handoverLoadError, refetch } = useQuery<HandoverData>({
    queryKey: ["pd-pm-handover", projectId],
    enabled: Number.isFinite(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}`, { credentials: "include" });
      if (!res.ok) {
        const reason = await parseErrorMessage(res, "Could not load handover.");
        throw new Error(reason);
      }
      return res.json();
    },
    retry: false,
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
      setExcelTrackerDraft(data.project.excelTrackerLink || "");
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
      if (!res.ok) {
        const message = await parseErrorMessage(
          res,
          "Could not save handover draft. Likely reason: temporary server or network issue. How to fix: verify required fields, refresh, and retry. If it persists, contact your admin.",
        );
        throw new Error(message);
      }
    },
    onSuccess: () => {
      toast({ title: "Draft saved", description: "Draft changes were stored successfully." });
      qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] });
    },
    onError: (e: any) =>
      toast({
        title: "Could not save handover draft",
        description:
          e.message ||
          "Likely reason: temporary server or permission issue. How to fix: refresh, verify access, and retry. If it persists, contact your admin.",
        variant: "destructive",
      }),
  });

  const addEvidence = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}/evidence`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newEvidence),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not attach evidence.");
    },
    onSuccess: () => {
      toast({ title: "Evidence attached" });
      setNewEvidence({ requirementKey: "", evidenceType: "document", title: "", valueRef: "" });
      qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] });
    },
    onError: (e: any) => toast({ title: "Evidence failed", description: e.message, variant: "destructive" }),
  });

  const submit = useMutation({
    mutationFn: async () => {
      setSubmitError(null);
      const res = await fetch(`/api/pd-pm-handover/${projectId}/submit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidenceOverrideReason: evidenceOverrideReason.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not submit handover. Refresh and retry.");
    },
    onSuccess: () => {
      toast({ title: "Submitted for PM Review", description: "PM reviewers can now accept or reject this handover." });
      qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] });
    },
    onError: (e: any) => {
      setSubmitError(e.message || "Could not submit handover. Complete missing fields and retry.");
      toast({
        title: "Cannot submit handover",
        description: e.message || "Likely reason: required data is missing. Complete blockers shown on this page and retry.",
        variant: "destructive",
      });
    },
  });

  const accept = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}/accept`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body.error ||
            "Could not accept handover. Likely reason: permission issue or incomplete submission. Refresh, verify PM access, and retry.",
        );
      }
    },
    onSuccess: () => {
      toast({ title: "Handover accepted", description: "Execution is now enabled and PM controls are active." });
      qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] });
    },
    onError: (e: any) =>
      toast({
        title: "Could not accept handover",
        description:
          e.message ||
          "Likely reason: permission mismatch or stale state. Refresh, verify PM/admin access, and retry.",
        variant: "destructive",
      }),
  });

  const reject = useMutation({
    mutationFn: async () => {
      const reason = rejectReason.trim();
      if (!reason) throw new Error("Rejection reason is required. Enter a clear reason, then retry.");
      const res = await fetch(`/api/pd-pm-handover/${projectId}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body.error ||
            "Could not reject handover. Enter a reason, then retry. If it still fails, refresh and contact your admin.",
        );
      }
    },
    onSuccess: async () => {
      setRejectReason("");
      setRejectInlineError(null);
      setRejectModalOpen(false);
      await qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] });
      await refetch();
      toast({ title: "Handover rejected", description: "The rejection was saved and sent back for PD updates." });
    },
    onError: (e: any) => {
      const message =
        e.message ||
        "Could not reject handover. Enter a reason, then retry. If it still fails, contact your admin.";
      setRejectInlineError(message);
      toast({ title: "Could not reject handover", description: message, variant: "destructive" });
    },
  });

  const updateExcelTracker = useMutation({
    mutationFn: async () => {
      const link = excelTrackerDraft.trim();
      if (!link) {
        throw new Error("PM Excel Tracker Link is required. Paste the live tracker URL, then retry.");
      }
      const res = await fetch(`/api/pd-pm-handover/${projectId}/excel-tracker`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excelTrackerLink: link }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body.error ||
            "Could not save PM Excel Tracker Link. Verify a valid URL, refresh, and retry. If it persists, contact your admin.",
        );
      }
    },
    onSuccess: () => {
      toast({ title: "PM Excel Tracker Link saved", description: "The project record now points to the active PM operating tracker." });
      qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] });
    },
    onError: (e: any) =>
      toast({
        title: "Could not update PM Excel Tracker Link",
        description: e.message || "Check the URL format and retry. If it persists, contact your admin.",
        variant: "destructive",
      }),
  });

  const setDeliverable = (key: string, patch: Partial<Deliverable>) => {
    const current = (form.deliverables?.[key] || {}) as Deliverable;
    setForm((f: any) => ({ ...f, deliverables: { ...(f.deliverables || {}), [key]: { ...current, ...patch } } }));
  };

  const deliverables = [
    { key: "handoverCharter", label: "Handover Charter" },
    { key: "siteVisitReport", label: "Site Visit Report" },
    { key: "signedCostProposal", label: "Signed Cost Proposal" },
  ];

  const blockersText = useMemo(() => (data?.blockers || []).join(", "), [data?.blockers]);

  if (isLoading) return <div className="p-6">Loading handover…</div>;

  if (!data) {
    return (
      <div className="p-6">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">
            <p className="font-semibold mb-1">Could not load handover.</p>
            <p>Likely reason: temporary server or network issue.</p>
            <p>How to fix: refresh and retry. If it persists, contact your admin.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {handoverLoadError ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">
            <p className="font-semibold">Could not load handover.</p>
            <p>{handoverLoadError instanceof Error ? handoverLoadError.message : "Likely reason: temporary server or network issue."}</p>
            <p>How to fix: refresh and retry. If it persists, contact your admin.</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>PD to PM Handover — {data.project.projectName}</CardTitle>
          <p className="text-sm text-muted-foreground">Status: <strong>{STATUS_LABELS[status] || status}</strong> · PD: {data.project.pd || "—"} · PM: {data.project.pm || "—"}</p>
          <p className="text-xs text-muted-foreground">Blockers: {data.blockers.length} · Mandatory deliverables complete: {3 - deliverables.filter((d) => !(form.deliverables?.[d.key]?.reference)).length}/3</p>
          <p className="text-xs text-muted-foreground">Evidence score: <strong>{data.evidence?.score ?? 0}%</strong> (threshold {data.evidence?.threshold ?? 0}%)</p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle>Handover checklist</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {(data.blockers.length > 0 || (data.evidence && !data.evidence.pass)) && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">Cannot submit handover. Missing items: {blockersText || data.evidence?.missingItems?.map((m) => m.label).join(", ")}. Complete these fields/documents, then retry.</div>}
          {!!data.evidence?.missingItems?.length && (
            <ul className="text-xs text-red-700 list-disc pl-4">
              {data.evidence.missingItems.map((m) => (<li key={m.requirementKey}>{m.label} (missing {m.missingBy})</li>))}
            </ul>
          )}
          {!!submitError && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{submitError}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>PD Owner</Label><Input value={form.pdOwner || ""} onChange={(e) => setForm({ ...form, pdOwner: e.target.value })} disabled={!pdCanEdit} /></div>
            <div><Label>PM Owner</Label><Input value={form.pmOwner || ""} onChange={(e) => setForm({ ...form, pmOwner: e.target.value })} disabled={!pdCanEdit} /></div>
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
        <CardHeader><CardTitle>Evidence checklist</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Input placeholder="Requirement key (optional)" value={newEvidence.requirementKey} onChange={(e) => setNewEvidence((v) => ({ ...v, requirementKey: e.target.value }))} />
            <Input placeholder="Evidence type (document/photo/form/sign_off...)" value={newEvidence.evidenceType} onChange={(e) => setNewEvidence((v) => ({ ...v, evidenceType: e.target.value }))} />
            <Input placeholder="Title" value={newEvidence.title} onChange={(e) => setNewEvidence((v) => ({ ...v, title: e.target.value }))} />
            <Input placeholder="Reference / URL" value={newEvidence.valueRef} onChange={(e) => setNewEvidence((v) => ({ ...v, valueRef: e.target.value }))} />
          </div>
          <Button type="button" variant="outline" onClick={() => addEvidence.mutate()} disabled={addEvidence.isPending}>{addEvidence.isPending ? "Attaching..." : "Attach evidence"}</Button>
          {user?.role && ["PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN", "admin"].includes(user.role) && (
            <div className="space-y-1">
              <Label>Override reason (required only if score is below threshold)</Label>
              <Textarea value={evidenceOverrideReason} onChange={(e) => setEvidenceOverrideReason(e.target.value)} placeholder="Explain why completion is still allowed despite missing evidence" />
            </div>
          )}
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
        <Button onClick={() => saveDraft.mutate()} disabled={!pdCanEdit || saveDraft.isPending}>{saveDraft.isPending ? "Saving..." : "Save Draft"}</Button>
        <Button onClick={() => submit.mutate()} disabled={!pdCanEdit || status === "ACCEPTED" || submit.isPending}>{submit.isPending ? "Submitting..." : "Submit for PM Review"}</Button>
        <Button onClick={() => accept.mutate()} disabled={!pmCanReview || status !== "SUBMITTED_FOR_PM_REVIEW" || accept.isPending}>{accept.isPending ? "Accepting..." : "Accept Handover"}</Button>
        <Button variant="destructive" onClick={() => { setRejectInlineError(null); setRejectModalOpen(true); }} disabled={!pmCanReview || status !== "SUBMITTED_FOR_PM_REVIEW" || reject.isPending}>Reject Handover</Button>
      </div>

      {status === "ACCEPTED" && (
        <Card className="border-emerald-200 shadow-sm">
          <CardHeader>
            <CardTitle>PM Excel Tracker Link</CardTitle>
            <p className="text-sm text-muted-foreground">Available only after accepted handover. Update this link to point to the live PM operating tracker.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="excel-tracker-link">Link PM Operating Tracker</Label>
              <Input
                id="excel-tracker-link"
                placeholder="https://..."
                value={excelTrackerDraft}
                onChange={(e) => setExcelTrackerDraft(e.target.value)}
                disabled={!pmCanReview || updateExcelTracker.isPending}
              />
            </div>
            <Button onClick={() => updateExcelTracker.mutate()} disabled={!pmCanReview || updateExcelTracker.isPending}>
              {updateExcelTracker.isPending ? (
                <span className="inline-flex items-center gap-1"><Loader2 className="h-4 w-4 animate-spin" /> Saving...</span>
              ) : (
                "Save PM Excel Tracker Link"
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject handover</DialogTitle>
            <DialogDescription>
              Provide a clear rejection reason so PD can correct and resubmit. Rejection reason is mandatory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rejection-reason">Rejection reason</Label>
            <Textarea
              id="rejection-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain what must be fixed before acceptance..."
              rows={5}
            />
            {rejectInlineError ? (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 inline-flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                <div>{rejectInlineError}</div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectModalOpen(false); setRejectInlineError(null); setRejectReason(""); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => reject.mutate()} disabled={reject.isPending}>
              {reject.isPending ? "Submitting rejection..." : "Submit Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
