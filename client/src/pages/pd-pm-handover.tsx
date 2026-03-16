import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, ClipboardList, Handshake, Loader2, ShieldAlert, Workflow } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED_FOR_PM_REVIEW: "Submitted for PM Review",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

const FEASIBILITY_OPTIONS = [
  { value: "NOT_ASSESSED", label: "Not assessed" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "FEASIBLE", label: "Feasible" },
  { value: "CONDITIONAL", label: "Conditional" },
  { value: "NOT_FEASIBLE", label: "Not feasible" },
];

const READINESS_OPTIONS = [
  { value: "NOT_READY", label: "Not ready" },
  { value: "READY_WITH_ACTIONS", label: "Ready with actions" },
  { value: "READY_FOR_HANDOVER", label: "Ready for handover" },
];

const PM_REVIEW_ROLES = ["PROJECT_MANAGER_SITE", "PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN", "admin"];
const DELIVERABLES = [
  { key: "handoverCharter", label: "Handover Charter" },
  { key: "siteVisitReport", label: "Site Visit Report" },
  { key: "signedCostProposal", label: "Signed Cost Proposal" },
];

const isPmRole = (role?: string) => PM_REVIEW_ROLES.includes(role || "");

const parseErrorMessage = async (res: Response, fallback: string) => {
  const data = await res.json().catch(() => null);
  return data?.error || data?.message || fallback;
};

function formatDateTime(value?: string | null) {
  if (!value) return "No date";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function toneClass(mode: "good" | "warn" | "bad" | "neutral") {
  if (mode === "good") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (mode === "warn") return "border-amber-200 bg-amber-50 text-amber-700";
  if (mode === "bad") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function actionLabel(action: string) {
  return String(action || "")
    .replace(/^PD_PM_HANDOVER_/, "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

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
  const [form, setForm] = useState<any>({});

  const { data, isLoading, error: handoverLoadError, refetch } = useQuery<any>({
    queryKey: ["pd-pm-handover", projectId],
    enabled: Number.isFinite(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not load handover."));
      return res.json();
    },
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      pdOwner: data.handover.pd_owner || data.project.pd || "",
      pmOwner: data.handover.pm_owner || data.project.pm || "",
      summary: data.handover.summary || "",
      notesToPm: data.handover.notes_to_pm || "",
      risks: data.handover.risks || "",
      assumptions: data.handover.assumptions || "",
      feasibilityStatus: data.handover.feasibility_status || data.workspace?.readiness?.feasibilityStatus || "",
      feasibilityNotes: data.handover.feasibility_notes || data.workspace?.readiness?.feasibilityNotes || "",
      dependencySummary: data.handover.dependency_summary || data.workspace?.readiness?.dependencySummary || data.workspace?.dependencies?.derivedSummary || "",
      handoverReadinessStatus: data.handover.handover_readiness_status || data.workspace?.readiness?.readinessStatus || "",
      handoverReadinessNotes: data.handover.handover_readiness_notes || data.workspace?.readiness?.readinessNotes || "",
      engineeringStatus: data.handover.engineering_status || "",
      qualityStatus: data.handover.quality_status || "",
      latestUpdate: data.workspace?.latestUpdate?.text || "",
      deliverables: data.handover.deliverables || {},
    });
    setExcelTrackerDraft(data.project.excelTrackerLink || "");
  }, [data]);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] }),
      qc.invalidateQueries({ queryKey: ["/api/pd-pm-handover/control"] }),
      qc.invalidateQueries({ queryKey: ["/api/project-lifecycle/workspace"] }),
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] }),
    ]);
  };

  const saveDraft = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}/draft`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not save handover draft."));
    },
    onSuccess: async () => {
      toast({ title: "Draft saved", description: "Structured handover data and canonical latest update were stored." });
      await invalidate();
    },
    onError: (error: any) => toast({ title: "Could not save handover draft", description: error.message, variant: "destructive" }),
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
      if (!res.ok) throw new Error(body.error || "Could not submit handover.");
    },
    onSuccess: async () => {
      toast({ title: "Submitted for PM Review", description: "The handover now has an auditable review record." });
      await invalidate();
    },
    onError: (error: any) => {
      setSubmitError(error.message);
      toast({ title: "Cannot submit handover", description: error.message, variant: "destructive" });
    },
  });

  const accept = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}/accept`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not accept handover.");
    },
    onSuccess: async () => {
      toast({ title: "Handover accepted", description: "Execution has been enabled on the same project spine." });
      await invalidate();
    },
    onError: (error: any) => toast({ title: "Could not accept handover", description: error.message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: async () => {
      const reason = rejectReason.trim();
      if (!reason) throw new Error("Rejection reason is required.");
      const res = await fetch(`/api/pd-pm-handover/${projectId}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not reject handover.");
    },
    onSuccess: async () => {
      setRejectReason("");
      setRejectInlineError(null);
      setRejectModalOpen(false);
      await invalidate();
      await refetch();
      toast({ title: "Handover rejected", description: "The rejection was logged and sent back to PD." });
    },
    onError: (error: any) => {
      setRejectInlineError(error.message);
      toast({ title: "Could not reject handover", description: error.message, variant: "destructive" });
    },
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
    onSuccess: async () => {
      setNewEvidence({ requirementKey: "", evidenceType: "document", title: "", valueRef: "" });
      toast({ title: "Evidence attached" });
      await invalidate();
    },
  });

  const updateExcelTracker = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pd-pm-handover/${projectId}/excel-tracker`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excelTrackerLink: excelTrackerDraft.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not update PM tracker link.");
    },
    onSuccess: async () => {
      toast({ title: "PM tracker link saved" });
      await invalidate();
    },
  });

  const setDeliverable = (key: string, patch: Record<string, string>) => {
    const current = form.deliverables?.[key] || {};
    setForm((value: any) => ({ ...value, deliverables: { ...(value.deliverables || {}), [key]: { ...current, ...patch } } }));
  };

  if (isLoading) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="pd-pm-handover-loading">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading PD workspace...</div>
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="pd-pm-handover-error">
        <Card className="border-rose-200 bg-rose-50"><CardContent className="p-4 text-sm text-rose-700">Could not load handover.</CardContent></Card>
      </PageShell>
    );
  }

  const status = data.handover?.status || "DRAFT";
  const pdCanEdit = user?.role === "PROJECT_DEVELOPER" || user?.role === "admin";
  const pmCanReview = isPmRole(user?.role);
  const blockersText = (data.blockers || []).join(", ");
  const deliverablesComplete = DELIVERABLES.filter((item) => form.deliverables?.[item.key]?.reference).length;

  return (
    <PageShell className="space-y-6 p-4 md:p-6" data-testid="pd-pm-handover-page">
      <SectionHeader
        icon={<Handshake className="h-5 w-5" />}
        title="Project Development Workspace"
        description="Structured pre-handover workspace on the existing project spine."
        meta={<>{STATUS_LABELS[status] || status} · Project {data.workspace?.spine?.projectInfoId} · Canonical {data.workspace?.spine?.canonicalProjectId || "Not linked"}</>}
        actions={
          <>
            <Button onClick={() => saveDraft.mutate()} disabled={!pdCanEdit || saveDraft.isPending}>Save Draft</Button>
            <Button onClick={() => submit.mutate()} disabled={!pdCanEdit || status === "ACCEPTED" || submit.isPending}>Submit for PM Review</Button>
            <Button onClick={() => accept.mutate()} disabled={!pmCanReview || status !== "SUBMITTED_FOR_PM_REVIEW" || accept.isPending}>Accept Handover</Button>
            <Button variant="destructive" onClick={() => setRejectModalOpen(true)} disabled={!pmCanReview || status !== "SUBMITTED_FOR_PM_REVIEW" || reject.isPending}>Reject Handover</Button>
          </>
        }
      />

      {handoverLoadError ? <Card className="border-rose-200 bg-rose-50"><CardContent className="p-4 text-sm text-rose-700">{String((handoverLoadError as Error)?.message || handoverLoadError)}</CardContent></Card> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-4 text-sm"><p className="text-xs uppercase text-muted-foreground">Blockers</p><p className="text-2xl font-semibold">{data.blockers?.length || 0}</p></CardContent></Card>
        <Card><CardContent className="p-4 text-sm"><p className="text-xs uppercase text-muted-foreground">Intake</p><p className="text-2xl font-semibold">{data.workspace?.intake?.totalRequests || 0}</p><p className="text-xs text-muted-foreground">{data.workspace?.intake?.pendingTaskCount || 0} pending tasks</p></CardContent></Card>
        <Card><CardContent className="p-4 text-sm"><p className="text-xs uppercase text-muted-foreground">Dependencies</p><p className="text-2xl font-semibold">{data.workspace?.dependencies?.total || 0}</p><p className="text-xs text-muted-foreground">{data.workspace?.dependencies?.blockedWorkItems || 0} blocked work items</p></CardContent></Card>
        <Card><CardContent className="p-4 text-sm"><p className="text-xs uppercase text-muted-foreground">Microsoft</p><p className="text-2xl font-semibold">{data.workspace?.microsoft?.totalLinkedItems || 0}</p><p className="text-xs text-muted-foreground">Latest {formatDateTime(data.workspace?.microsoft?.latestLinkedAt)}</p></CardContent></Card>
      </div>

      {(data.blockers?.length || 0) > 0 || submitError ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base text-rose-800"><AlertTriangle className="h-4 w-4" /> Handover cannot be submitted yet</CardTitle></CardHeader>
          <CardContent className="text-sm text-rose-700">{submitError || `Missing items: ${blockersText}`}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Controlled handover fields</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div><Label>PD Owner</Label><Input value={form.pdOwner || ""} onChange={(e) => setForm({ ...form, pdOwner: e.target.value })} disabled={!pdCanEdit} /></div>
            <div><Label>PM Owner</Label><Input value={form.pmOwner || ""} onChange={(e) => setForm({ ...form, pmOwner: e.target.value })} disabled={!pdCanEdit} /></div>
            <div className="md:col-span-2"><Label>Scope Summary</Label><Textarea value={form.summary || ""} onChange={(e) => setForm({ ...form, summary: e.target.value })} disabled={!pdCanEdit} rows={4} /></div>
            <div className="md:col-span-2"><Label>Notes to PM</Label><Textarea value={form.notesToPm || ""} onChange={(e) => setForm({ ...form, notesToPm: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
            <div className="md:col-span-2"><Label>Risk Summary</Label><Textarea value={form.risks || ""} onChange={(e) => setForm({ ...form, risks: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
            <div className="md:col-span-2"><Label>Assumptions</Label><Textarea value={form.assumptions || ""} onChange={(e) => setForm({ ...form, assumptions: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
            <div><Label>Engineering Status</Label><Input value={form.engineeringStatus || ""} onChange={(e) => setForm({ ...form, engineeringStatus: e.target.value })} disabled={!pdCanEdit} /></div>
            <div><Label>Quality Status</Label><Input value={form.qualityStatus || ""} onChange={(e) => setForm({ ...form, qualityStatus: e.target.value })} disabled={!pdCanEdit} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Readiness and canonical update</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>Feasibility Status</Label><Select value={form.feasibilityStatus || "UNSET"} onValueChange={(value) => setForm({ ...form, feasibilityStatus: value === "UNSET" ? "" : value })} disabled={!pdCanEdit}><SelectTrigger><SelectValue placeholder="Select feasibility" /></SelectTrigger><SelectContent><SelectItem value="UNSET">Not set</SelectItem>{FEASIBILITY_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Feasibility Notes</Label><Textarea value={form.feasibilityNotes || ""} onChange={(e) => setForm({ ...form, feasibilityNotes: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
            <div><Label>Dependency Summary</Label><Textarea value={form.dependencySummary || ""} onChange={(e) => setForm({ ...form, dependencySummary: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
            <div><Label>Handover Readiness</Label><Select value={form.handoverReadinessStatus || "UNSET"} onValueChange={(value) => setForm({ ...form, handoverReadinessStatus: value === "UNSET" ? "" : value })} disabled={!pdCanEdit}><SelectTrigger><SelectValue placeholder="Select readiness" /></SelectTrigger><SelectContent><SelectItem value="UNSET">Not set</SelectItem>{READINESS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Readiness Notes</Label><Textarea value={form.handoverReadinessNotes || ""} onChange={(e) => setForm({ ...form, handoverReadinessNotes: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
            <div><Label>Canonical Latest Update</Label><Textarea value={form.latestUpdate || ""} onChange={(e) => setForm({ ...form, latestUpdate: e.target.value })} disabled={!pdCanEdit} rows={4} /><p className="mt-1 text-xs text-muted-foreground">Last saved {formatDateTime(data.workspace?.latestUpdate?.updatedAt)} by {data.workspace?.latestUpdate?.updatedBy || "no owner recorded"}.</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" /> Intake and PD source context</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={toneClass(data.workspace?.intake?.hasSyncConflict ? "bad" : "neutral")}>Sync conflicts {data.workspace?.intake?.hasSyncConflict ? "present" : "clear"}</Badge>
              <Badge variant="outline" className={toneClass(data.workspace?.intake?.hasInternalBlockers ? "bad" : "good")}>Intake blockers {data.workspace?.intake?.hasInternalBlockers ? "open" : "clear"}</Badge>
              <Badge variant="outline" className={toneClass((data.workspace?.intake?.pendingTaskCount || 0) > 0 ? "warn" : "good")}>Pending intake tasks {data.workspace?.intake?.pendingTaskCount || 0}</Badge>
            </div>
            {(data.workspace?.intake?.requests || []).slice(0, 4).map((request: any) => (
              <div key={request.id} className="rounded-xl border border-border/70 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{request.requestType || "Intake request"}</span><Badge variant="outline">{request.status || "No status"}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">Pending tasks {request.pendingTasks} · Due {request.dueDate || "No due date"} · Updated {formatDateTime(request.updatedAt)}</p>
                {request.appInternalBlockers ? <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{request.appInternalBlockers}</p> : null}
              </div>
            ))}
            {(data.workspace?.pdTickets?.tickets || []).slice(0, 3).map((ticket: any) => (
              <div key={ticket.id} className="rounded-xl border border-border/70 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{ticket.requestType}</span><Badge variant="outline">{ticket.status}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">Developer {ticket.developerName || "Unassigned"} · Tasks {ticket.taskCompleted}/{ticket.taskTotal}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4" /> Dependencies, risk, Microsoft, downstream</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={toneClass((data.workspace?.dependencies?.blockedWorkItems || 0) > 0 ? "warn" : "good")}>Blocked work items {data.workspace?.dependencies?.blockedWorkItems || 0}</Badge>
              <Badge variant="outline" className={toneClass((data.workspace?.risks?.critical || 0) > 0 ? "bad" : "neutral")}>Critical risks {data.workspace?.risks?.critical || 0}</Badge>
              <Badge variant="outline" className={toneClass((data.workspace?.microsoft?.actionRequiredCount || 0) > 0 ? "warn" : "neutral")}>Microsoft action items {data.workspace?.microsoft?.actionRequiredCount || 0}</Badge>
            </div>
            <div className="rounded-xl border border-border/70 p-3 text-sm">
              <p className="font-medium">Dependency snapshot</p>
              <p className="mt-1 text-muted-foreground">{data.workspace?.dependencies?.derivedSummary || "No mapped project dependencies yet."}</p>
            </div>
            {(data.workspace?.risks?.items || []).slice(0, 3).map((risk: any) => (
              <div key={risk.id} className="rounded-xl border border-border/70 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{risk.title}</span><Badge variant="outline">{risk.type}</Badge><Badge variant="outline">{risk.priority}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{risk.status} · Due {risk.dueDate || "No due date"}</p>
              </div>
            ))}
            {(data.workspace?.microsoft?.recentItems || []).slice(0, 2).map((item: any) => (
              <div key={item.id} className="rounded-xl border border-border/70 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.subjectOrTitle || "Untitled Microsoft item"}</span><Badge variant="outline">{item.type}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{item.senderOrOrganizer || "No sender recorded"} · {formatDateTime(item.receivedOrStartDatetime)}</p>
                {item.webLink ? <a href={item.webLink} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-primary underline underline-offset-4">Open linked Microsoft item</a> : null}
              </div>
            ))}
            <div className="grid gap-2 md:grid-cols-2 text-sm">
              <div className="rounded-xl border border-border/70 p-3">Engineering: {data.workspace?.downstream?.engineering?.status || "Not set"} · Active items {data.workspace?.downstream?.engineering?.activeWorkItems || 0}</div>
              <div className="rounded-xl border border-border/70 p-3">PM: {data.workspace?.downstream?.projectManagement?.pmOwner || data.project.pm || "Not set"} · Deliverables {data.workspace?.downstream?.projectManagement?.deliverablesComplete || 0}/3</div>
              <div className="rounded-xl border border-border/70 p-3">Finance: cost proposal {data.workspace?.downstream?.finance?.signedCostProposal ? "captured" : "missing"}</div>
              <div className="rounded-xl border border-border/70 p-3">Quality: {data.workspace?.downstream?.quality?.qualityStatus || "Not set"} · Open risks {data.workspace?.downstream?.quality?.openRisks || 0}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4" /> Evidence and deliverables</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Evidence score <strong>{data.evidence?.score ?? 0}%</strong> against a threshold of {data.evidence?.threshold ?? 0}%.</p>
          <div className="grid gap-2 md:grid-cols-4">
            <Input placeholder="Requirement key" value={newEvidence.requirementKey} onChange={(e) => setNewEvidence({ ...newEvidence, requirementKey: e.target.value })} />
            <Input placeholder="Evidence type" value={newEvidence.evidenceType} onChange={(e) => setNewEvidence({ ...newEvidence, evidenceType: e.target.value })} />
            <Input placeholder="Title" value={newEvidence.title} onChange={(e) => setNewEvidence({ ...newEvidence, title: e.target.value })} />
            <Input placeholder="Reference or URL" value={newEvidence.valueRef} onChange={(e) => setNewEvidence({ ...newEvidence, valueRef: e.target.value })} />
          </div>
          <Button variant="outline" onClick={() => addEvidence.mutate()} disabled={addEvidence.isPending}>{addEvidence.isPending ? "Attaching..." : "Attach evidence"}</Button>
          {["PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN", "admin"].includes(user?.role || "") ? <Textarea value={evidenceOverrideReason} onChange={(e) => setEvidenceOverrideReason(e.target.value)} placeholder="Override reason if evidence is below threshold" rows={3} /> : null}
          {DELIVERABLES.map((item) => {
            const current = form.deliverables?.[item.key] || {};
            return (
              <div key={item.key} className="grid gap-2 rounded-xl border border-border/70 p-3 md:grid-cols-5 md:items-end">
                <div className="md:col-span-1"><p className="text-sm font-medium">{item.label}</p><p className={`text-xs ${current.reference ? "text-emerald-700" : "text-rose-700"}`}>{current.reference ? "Complete" : "Missing"}</p></div>
                <Input placeholder="Reference" value={current.reference || ""} onChange={(e) => setDeliverable(item.key, { reference: e.target.value })} disabled={!pdCanEdit} />
                <Input placeholder="Uploaded by" value={current.uploadedBy || ""} onChange={(e) => setDeliverable(item.key, { uploadedBy: e.target.value })} disabled={!pdCanEdit} />
                <Input type="date" value={current.uploadedDate || ""} onChange={(e) => setDeliverable(item.key, { uploadedDate: e.target.value })} disabled={!pdCanEdit} />
                <div className="text-xs text-muted-foreground">{deliverablesComplete}/3 complete</div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {status === "ACCEPTED" ? (
        <Card className="border-emerald-200 shadow-sm">
          <CardHeader><CardTitle className="text-base">PM Excel Tracker Link</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="https://..." value={excelTrackerDraft} onChange={(e) => setExcelTrackerDraft(e.target.value)} disabled={!pmCanReview || updateExcelTracker.isPending} />
            <Button onClick={() => updateExcelTracker.mutate()} disabled={!pmCanReview || updateExcelTracker.isPending}>{updateExcelTracker.isPending ? "Saving..." : "Save PM Excel Tracker Link"}</Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> Recent handover activity</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(data.history || []).length > 0 ? (data.history || []).map((entry: any) => (
            <div key={entry.id} className="rounded-xl border border-border/70 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{actionLabel(entry.action)}</span>{entry.performedByRole ? <Badge variant="outline">{entry.performedByRole}</Badge> : null}</div>
                <span className="text-xs text-muted-foreground">{formatDateTime(entry.performedAt)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{entry.performedByName || "Unknown actor"}</p>
              {entry.details ? <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(entry.details, null, 2)}</pre> : null}
            </div>
          )) : <p className="text-sm text-muted-foreground">No handover activity logged yet.</p>}
        </CardContent>
      </Card>

      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Reject handover</DialogTitle><DialogDescription>Provide a clear rejection reason so PD can correct and resubmit.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rejection-reason">Rejection reason</Label>
            <Textarea id="rejection-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={5} />
            {rejectInlineError ? <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{rejectInlineError}</div> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectModalOpen(false); setRejectInlineError(null); setRejectReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={() => reject.mutate()} disabled={reject.isPending}>{reject.isPending ? "Submitting rejection..." : "Submit Rejection"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
