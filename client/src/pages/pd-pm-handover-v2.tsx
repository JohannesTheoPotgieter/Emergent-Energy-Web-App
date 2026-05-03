import { useRoute } from "wouter";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { isPdRole as sharedIsPdRole, canReviewHandover as sharedIsPmRole } from "@shared/roles/pd-roles";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  Handshake, Loader2, Plus, Trash2, X,
} from "lucide-react";

// ===================== CONSTANTS =====================

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED_FOR_PM_REVIEW: "Submitted for PM Review",
  ACCEPTED: "Accepted",
  REJECTED: "Returned for Rework",
  HANDOVER_COMPLETE: "Handover Complete",
};

// PD_ROLES and PM_REVIEW_ROLES previously duplicated locally with "admin"
// (not a real company role) and without KEY_ACCOUNTS_MANAGER. Now imported
// as helper functions from the shared module. See shared/roles/pd-roles.ts.
const PROJECT_TYPES = ["C&I", "Utility", "BESS", "Hybrid"];
const SYSTEM_TYPES = ["Grid-tied", "Hybrid", "Off-grid", "BESS"];
const FUNDING_MODELS = ["Self-funded", "Bank-financed", "PPA", "Lease", "Other"];
const RISK_CATEGORIES = ["Structural", "Access/Logistics", "Wildlife/Bird-proofing", "Shading", "Regulatory", "Utility/Municipality", "Client Relationship", "Other"];
const STAKEHOLDER_ROLES = ["Client Primary", "Client Site Contact", "Electrician", "Property Manager", "O&M Partner", "SSEG Coordinator", "Subcontractor", "Independent Engineer", "SunGrow/Battery Rep", "Municipality", "Other"];

const READINESS_ITEMS: { key: string; label: string }[] = [
  { key: "specsLocked", label: "All module/inverter specs locked and confirmed with procurement" },
  { key: "structuralConfirmed", label: "Structural assessment status confirmed" },
  { key: "commercialResolved", label: "Commercial flags resolved: funding model set, BDP/referral fees checked" },
  { key: "milestoneDrafted", label: "Payment milestone schedule drafted" },
  { key: "stakeholderComplete", label: "Stakeholder list complete" },
  { key: "lessonsReviewed", label: "Lessons learnt from similar projects reviewed" },
  { key: "engPackReviewed", label: "Engineering pack reviewed: shading, crane access, roof obstructions, tie-in points" },
  { key: "moduleSpecMatch", label: "Module spec matches signed proposal" },
];

const TAB_IDS = ["background", "design", "commercial", "risks", "regulatory", "stakeholders", "oam", "actions", "kickoff"] as const;
const TAB_LABELS = ["1. Background", "2. Design", "3. Commercial", "4. Risks", "5. Regulatory", "6. Stakeholders", "7. O&M", "8. Actions", "9. Kickoff"];

// ===================== TYPES =====================

interface TabFormData {
  // Tab 1 - Project Background
  clientName?: string;
  relationshipHistory?: string;
  referralSource?: string;
  projectType?: string;
  siteAddress?: string;
  projectNarrative?: string;
  // Tab 2 - System Design
  systemSizeKwp?: string;
  storageSizeKwh?: string;
  systemType?: string;
  equipment?: Array<{ componentType: string; make: string; model: string; qty: string; rating: string }>;
  specChanged?: boolean;
  changeReason?: string;
  clientNotified?: boolean;
  // Tab 3 - Commercial
  fundingModel?: string;
  paymentMilestones?: Array<{ name: string; percent: string; trigger: string }>;
  warrantyExtensions?: string;
  subDeliverables?: string;
  bankRequirements?: string;
  // Tab 4 - Site Risks
  risksTable?: Array<{ description: string; category: string; mitigation: string; owner: string }>;
  specialConditions?: string;
  securityPlan?: string;
  // Tab 5 - Regulatory
  municipalityContact?: string;
  municipalityPhone?: string;
  cocRequirements?: string;
  independentEngineer?: string;
  lifelinesRequired?: string;
  // Tab 6 - Stakeholders (managed via API, not in JSONB)
  // Tab 7 - O&M
  oamPartner?: string;
  slaScope?: string;
  specialMaintenance?: string;
  matriarchInvolvement?: string;
  // Tab 8 - Action Items (managed via work items API)
  // Tab 9 - Kickoff
  kickoffDate?: string;
  attendees?: string;
  agenda?: string;
}

interface StakeholderRow {
  id: number;
  name: string;
  role: string;
  company: string;
  phone: string;
  email: string;
  notes: string;
}

interface WorkItemRow {
  id: number;
  title: string;
  ownerName: string | null;
  endDate: string | null;
  status: string;
}

interface LessonRow {
  id: number;
  title: string;
  description: string;
  tags: string[];
  projectType: string;
}

// ===================== HELPERS =====================

const isPmRole = (role?: string) => sharedIsPmRole(role || "");
const isPdRole = (role?: string) => sharedIsPdRole(role || "");

function formatDateTime(value?: string | null) {
  if (!value) return "No date";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

async function parseErrorMessage(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return data?.error || data?.message || fallback;
}

// ===================== READINESS CHECKLIST COMPONENT =====================

function ReadinessChecklist({
  checklist,
  onChange,
  disabled,
}: {
  checklist: Record<string, boolean>;
  onChange: (updated: Record<string, boolean>) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(true);
  const checked = Object.values(checklist).filter(Boolean).length;
  const total = READINESS_ITEMS.length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;

  return (
    <Card className={pct === 100 ? "border-emerald-200" : "border-amber-200"}>
      <CardHeader className="cursor-pointer" onClick={() => setOpen(!open)}>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Pre-Handover Readiness Checklist ({checked}/{total})</span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={pct === 100 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>
              {pct}%
            </Badge>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          {pct < 100 && (
            <p className="text-xs text-amber-700 mb-2">All items must be checked before you can submit for PM review.</p>
          )}
          {READINESS_ITEMS.map((item) => (
            <label key={item.key} className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={!!checklist[item.key]}
                onCheckedChange={(val) => onChange({ ...checklist, [item.key]: !!val })}
                disabled={disabled}
                className="mt-0.5"
              />
              <span className="text-sm">{item.label}</span>
            </label>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

// ===================== PROGRESS BAR =====================

function TabProgressBar({ tabData }: { tabData: TabFormData }) {
  const tabFilled = [
    !!(tabData.clientName || tabData.projectNarrative),
    !!(tabData.systemSizeKwp || tabData.systemType),
    !!(tabData.fundingModel),
    !!((tabData.risksTable || []).length > 0),
    !!(tabData.municipalityContact || tabData.cocRequirements),
    true, // stakeholders managed via API
    !!(tabData.oamPartner || tabData.slaScope),
    true, // actions managed via API
    !!(tabData.kickoffDate),
  ];
  const filled = tabFilled.filter(Boolean).length;
  const pct = Math.round((filled / tabFilled.length) * 100);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Tab completion</span>
        <span>{pct}% ({filled}/{tabFilled.length} tabs started)</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ===================== STAKEHOLDER TAB COMPONENT =====================

function StakeholderTab({ projectId, items, onRefresh, disabled }: { projectId: number; items: StakeholderRow[]; onRefresh: () => void; disabled: boolean }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState({ name: "", role: "", company: "", phone: "", email: "", notes: "" });
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!newRow.name || !newRow.role) throw new Error("Name and role required.");
      const res = await fetch(`/api/engineering-pm-handover/${projectId}/stakeholders`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRow),
      });
      if (!res.ok) throw new Error("Could not add stakeholder.");
    },
    onSuccess: () => {
      setNewRow({ name: "", role: "", company: "", phone: "", email: "", notes: "" });
      setAdding(false);
      toast({ title: "Stakeholder added" });
      onRefresh();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/engineering-pm-handover/${projectId}/stakeholders/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Could not delete.");
    },
    onSuccess: () => { setDeleteId(null); toast({ title: "Stakeholder removed" }); onRefresh(); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Stakeholder Map</span>
          {!disabled && <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus className="h-3 w-3 mr-1" /> Add</Button>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr><th className="p-2 text-left">Name</th><th className="p-2 text-left">Role</th><th className="p-2 text-left">Company</th><th className="p-2 text-left">Phone</th><th className="p-2 text-left">Email</th><th className="p-2 text-left">Notes</th>{!disabled && <th className="p-2 w-8" />}</tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2">{row.name}</td><td className="p-2">{row.role}</td><td className="p-2">{row.company}</td>
                  <td className="p-2">{row.phone}</td><td className="p-2">{row.email}</td><td className="p-2 max-w-[150px] truncate">{row.notes}</td>
                  {!disabled && <td className="p-2"><Button variant="ghost" size="sm" onClick={() => setDeleteId(row.id)}><Trash2 className="h-3 w-3 text-rose-500" /></Button></td>}
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground text-xs">No stakeholders added yet</td></tr>}
            </tbody>
          </table>
        </div>

        {adding && (
          <div className="mt-3 border rounded-lg p-3 space-y-2 bg-muted/20">
            <div className="grid gap-2 md:grid-cols-3">
              <div><Label>Name</Label><Input value={newRow.name} onChange={(e) => setNewRow({ ...newRow, name: e.target.value })} /></div>
              <div>
                <Label>Role</Label>
                <Select value={newRow.role || "NONE"} onValueChange={(v) => setNewRow({ ...newRow, role: v === "NONE" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">— Select —</SelectItem>
                    {STAKEHOLDER_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Company</Label><Input value={newRow.company} onChange={(e) => setNewRow({ ...newRow, company: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={newRow.phone} onChange={(e) => setNewRow({ ...newRow, phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={newRow.email} onChange={(e) => setNewRow({ ...newRow, email: e.target.value })} /></div>
              <div><Label>Notes</Label><Input value={newRow.notes} onChange={(e) => setNewRow({ ...newRow, notes: e.target.value })} /></div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Remove stakeholder?</DialogTitle></DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => deleteId && deleteMutation.mutate(deleteId)}>Remove</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ===================== MAIN V2 COMPONENT =====================

/** Route-aware page wrapper used by App.tsx lazy import */
export default function PdPmHandoverPage() {
  const [, params] = useRoute("/pd/handover/:projectId");
  const projectId = Number(params?.projectId);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return (
      <PageShell className="p-4 md:p-6">
        <p className="text-destructive">Invalid project ID.</p>
      </PageShell>
    );
  }
  return <PdPmHandoverV2 projectId={projectId} />;
}

export function PdPmHandoverV2({ projectId }: { projectId: number }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<string>("background");
  const [tabData, setTabData] = useState<TabFormData>({});
  const [readiness, setReadiness] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [lessonsBanner, setLessonsBanner] = useState<LessonRow[]>([]);
  const [lessonsDismissed, setLessonsDismissed] = useState(false);

  // Legacy form fields (backwards compat)
  const [legacyForm, setLegacyForm] = useState<any>({});

  // ---- Data Loading ----
  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["pd-pm-handover", projectId],
    enabled: Number.isFinite(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/engineering-pm-handover/${projectId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not load handover."));
      return res.json();
    },
    retry: false,
  });

  const { data: stakeholderData, refetch: refetchStakeholders } = useQuery<{ items: StakeholderRow[] }>({
    queryKey: ["handover-stakeholders", projectId],
    enabled: Number.isFinite(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/engineering-pm-handover/${projectId}/stakeholders`, { credentials: "include" });
      if (!res.ok) return { items: [] };
      return res.json();
    },
  });

  // ---- Initialize form from server data ----
  useEffect(() => {
    if (!data) return;
    const h = data.handover || {};
    const fd: TabFormData = h.handover_form_data || h.handoverFormData || {};

    // Auto-fill from project data
    if (!fd.clientName && data.project?.clientName) fd.clientName = data.project.clientName;
    if (!fd.siteAddress && data.project?.siteAddress) fd.siteAddress = data.project.siteAddress;
    if (!fd.systemSizeKwp && data.project?.sizeKwp) fd.systemSizeKwp = String(data.project.sizeKwp);
    if (!fd.agenda && h.summary) fd.agenda = h.summary;

    setTabData(fd);
    setReadiness(h.readiness_checklist || h.readinessChecklist || {});

    // Map to legacy form fields for backwards compat on save
    setLegacyForm({
      pdOwner: h.pd_owner || data.project?.pd || "",
      pmOwner: h.pm_owner || data.project?.pm || "",
      summary: h.summary || fd.projectNarrative || "",
      risks: h.risks || "",
      assumptions: h.assumptions || "",
      engineeringStatus: h.engineering_status || "",
      qualityStatus: h.quality_status || "",
      notesToPm: h.notes_to_pm || "",
      deliverables: h.deliverables || {},
      feasibilityStatus: h.feasibility_status || "",
      feasibilityNotes: h.feasibility_notes || "",
      dependencySummary: h.dependency_summary || "",
      handoverReadinessStatus: h.handover_readiness_status || "",
      handoverReadinessNotes: h.handover_readiness_notes || "",
    });
  }, [data]);

  // ---- Mutations ----
  const invalidate = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["pd-pm-handover", projectId] }),
      qc.invalidateQueries({ queryKey: ["handover-stakeholders", projectId] }),
      qc.invalidateQueries({ queryKey: ["/api/engineering-pm-handover/control"] }),
      qc.invalidateQueries({ queryKey: ["/api/projects-summary"] }),
    ]);
  }, [qc, projectId]);

  const saveDraft = useMutation({
    mutationFn: async () => {
      const body = {
        ...legacyForm,
        summary: legacyForm.summary || tabData.projectNarrative || "",
        risks: legacyForm.risks || (tabData.risksTable || []).map((r) => r.description).join("; "),
        handoverFormData: tabData,
        readinessChecklist: readiness,
        kickoffDate: tabData.kickoffDate || null,
        lessonsReviewed: lessonsDismissed || false,
      };
      const res = await fetch(`/api/engineering-pm-handover/${projectId}/draft`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not save draft."));
    },
    onSuccess: async () => {
      toast({ title: "Draft saved" });
      await invalidate();
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      setSubmitError(null);
      const res = await fetch(`/api/engineering-pm-handover/${projectId}/submit`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not submit.");
    },
    onSuccess: async () => {
      toast({ title: "Submitted for PM Review" });
      await invalidate();
    },
    onError: (err: any) => {
      setSubmitError(err.message);
      toast({ title: "Cannot submit", description: err.message, variant: "destructive" });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/engineering-pm-handover/${projectId}/accept`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not accept.");
    },
    onSuccess: async () => { toast({ title: "Handover accepted" }); await invalidate(); },
    onError: (err: any) => toast({ title: "Accept failed", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!rejectReason.trim()) throw new Error("Rejection reason required.");
      const res = await fetch(`/api/engineering-pm-handover/${projectId}/reject`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not reject.");
    },
    onSuccess: async () => {
      setRejectReason(""); setRejectModalOpen(false);
      toast({ title: "Handover rejected" }); await invalidate();
    },
    onError: (err: any) => toast({ title: "Reject failed", description: err.message, variant: "destructive" }),
  });

  const pdSignOff = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/engineering-pm-handover/${projectId}/pd-sign-off`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "PD sign-off failed.");
    },
    onSuccess: async () => { toast({ title: "PD sign-off recorded" }); await invalidate(); },
    onError: (err: any) => toast({ title: "Sign-off failed", description: err.message, variant: "destructive" }),
  });

  const pmSignOff = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/engineering-pm-handover/${projectId}/pm-sign-off`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "PM sign-off failed.");
    },
    onSuccess: async () => { toast({ title: "PM sign-off recorded" }); await invalidate(); },
    onError: (err: any) => toast({ title: "Sign-off failed", description: err.message, variant: "destructive" }),
  });

  // ---- Lessons banner fetch ----
  useEffect(() => {
    if (!tabData.projectType || lessonsDismissed) return;
    fetch(`/api/lessons-learnt?projectType=${encodeURIComponent(tabData.projectType)}&limit=3`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setLessonsBanner(d.items || []))
      .catch(() => {});
  }, [tabData.projectType, lessonsDismissed]);

  // ---- Tab data updater ----
  const updateTab = useCallback((patch: Partial<TabFormData>) => {
    setTabData((prev) => ({ ...prev, ...patch }));
  }, []);

  // ---- Computed ----
  const status = data?.handover?.status || "DRAFT";
  const pdCanEdit = isPdRole(user?.role) && (status === "DRAFT" || status === "REJECTED");
  const pmCanReview = isPmRole(user?.role);
  const readinessScore = useMemo(() => {
    const total = READINESS_ITEMS.length;
    const checked = READINESS_ITEMS.filter((item) => readiness[item.key]).length;
    return total > 0 ? Math.round((checked / total) * 100) : 0;
  }, [readiness]);

  // ---- Loading / Error ----
  if (isLoading) {
    return (
      <PageShell className="p-4 md:p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading handover...
        </div>
      </PageShell>
    );
  }
  if (!data) {
    return (
      <PageShell className="p-4 md:p-6">
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-4 text-sm text-rose-700">Could not load handover.</CardContent>
        </Card>
      </PageShell>
    );
  }

  // ---- RENDER ----
  return (
    <PageShell className="space-y-4 p-4 md:p-6" data-testid="pd-pm-handover-v2">
      <SectionHeader
        icon={<Handshake className="h-5 w-5" />}
        title="PD to PM Handover"
        description={`${data.project?.projectName || "Project"} — structured handover form`}
        meta={<>{STATUS_LABELS[status] || status}</>}
        actions={
          <div className="flex flex-wrap gap-2">
            {pdCanEdit && <Button size="sm" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}>{saveDraft.isPending ? "Saving..." : "Save Draft"}</Button>}
            {pdCanEdit && <Button size="sm" onClick={() => submitMutation.mutate()} disabled={readinessScore < 100 || submitMutation.isPending}>{submitMutation.isPending ? "Submitting..." : "Submit for PM Review"}</Button>}
            {pmCanReview && status === "SUBMITTED_FOR_PM_REVIEW" && <Button size="sm" onClick={() => acceptMutation.mutate()} disabled={acceptMutation.isPending}>Accept</Button>}
            {pmCanReview && status === "SUBMITTED_FOR_PM_REVIEW" && <Button size="sm" variant="destructive" onClick={() => setRejectModalOpen(true)}>Reject</Button>}
          </div>
        }
      />

      {submitError && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-3 text-sm text-rose-700 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {submitError}</CardContent>
        </Card>
      )}

      {/* Progress bar */}
      <TabProgressBar tabData={tabData} />

      {/* Readiness checklist */}
      <ReadinessChecklist checklist={readiness} onChange={setReadiness} disabled={!pdCanEdit} />

      {/* Lessons banner */}
      {lessonsBanner.length > 0 && !lessonsDismissed && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>Lessons from similar {tabData.projectType} projects — review before proceeding</span>
              <Button variant="ghost" size="sm" onClick={() => { setLessonsDismissed(true); updateTab({}); }}>
                <X className="h-4 w-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lessonsBanner.map((lesson) => (
              <div key={lesson.id} className="rounded border border-blue-200 bg-white p-2 text-xs">
                <p className="font-medium">{lesson.title}</p>
                <p className="mt-1 text-muted-foreground">{lesson.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ===== 9 TABS ===== */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start">
          {TAB_IDS.map((id, i) => (
            <TabsTrigger key={id} value={id} className="text-xs">{TAB_LABELS[i]}</TabsTrigger>
          ))}
        </TabsList>

        {/* ===== TAB 1: PROJECT BACKGROUND ===== */}
        <TabsContent value="background">
          <Card>
            <CardHeader><CardTitle className="text-base">Project Background</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Client Name</Label>
                <Input value={tabData.clientName || ""} onChange={(e) => updateTab({ clientName: e.target.value })} disabled={!pdCanEdit} />
              </div>
              <div>
                <Label>Referral Source</Label>
                <Input value={tabData.referralSource || ""} onChange={(e) => updateTab({ referralSource: e.target.value })} disabled={!pdCanEdit} />
              </div>
              <div>
                <Label>Project Type</Label>
                <Select value={tabData.projectType || "NONE"} onValueChange={(v) => updateTab({ projectType: v === "NONE" ? "" : v })} disabled={!pdCanEdit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">— Select —</SelectItem>
                    {PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Site Address</Label>
                <Input value={tabData.siteAddress || ""} onChange={(e) => updateTab({ siteAddress: e.target.value })} disabled={!pdCanEdit} />
              </div>
              <div className="md:col-span-2">
                <Label>Relationship History</Label>
                <Textarea value={tabData.relationshipHistory || ""} onChange={(e) => updateTab({ relationshipHistory: e.target.value })} disabled={!pdCanEdit} rows={3} />
              </div>
              <div className="md:col-span-2">
                <Label>Brief Project Narrative</Label>
                <Textarea value={tabData.projectNarrative || ""} onChange={(e) => updateTab({ projectNarrative: e.target.value })} disabled={!pdCanEdit} rows={4} />
                {(tabData.projectNarrative || "").length > 500 && (
                  <p className="text-xs text-amber-600 mt-1">{(tabData.projectNarrative || "").length} characters — consider keeping under 500</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 2: SYSTEM DESIGN ===== */}
        <TabsContent value="design">
          <Card>
            <CardHeader><CardTitle className="text-base">System Design</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label>System Size kWp</Label>
                  <Input value={tabData.systemSizeKwp || ""} onChange={(e) => updateTab({ systemSizeKwp: e.target.value })} disabled={!pdCanEdit} />
                </div>
                <div>
                  <Label>Storage Size kWh</Label>
                  <Input type="number" value={tabData.storageSizeKwh || ""} onChange={(e) => updateTab({ storageSizeKwh: e.target.value })} disabled={!pdCanEdit} />
                </div>
                <div>
                  <Label>System Type</Label>
                  <Select value={tabData.systemType || "NONE"} onValueChange={(v) => updateTab({ systemType: v === "NONE" ? "" : v })} disabled={!pdCanEdit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">— Select —</SelectItem>
                      {SYSTEM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Equipment table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Equipment</Label>
                  {pdCanEdit && (
                    <Button variant="outline" size="sm" onClick={() => updateTab({ equipment: [...(tabData.equipment || []), { componentType: "", make: "", model: "", qty: "", rating: "" }] })}>
                      <Plus className="h-3 w-3 mr-1" /> Add Row
                    </Button>
                  )}
                </div>
                <div className="border rounded-lg overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr><th className="p-2 text-left">Component</th><th className="p-2 text-left">Make</th><th className="p-2 text-left">Model</th><th className="p-2 text-left">Qty</th><th className="p-2 text-left">kW/kWh</th>{pdCanEdit && <th className="p-2 w-8" />}</tr>
                    </thead>
                    <tbody>
                      {(tabData.equipment || []).map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-1"><Input value={row.componentType} onChange={(e) => { const eq = [...(tabData.equipment || [])]; eq[i] = { ...eq[i], componentType: e.target.value }; updateTab({ equipment: eq }); }} disabled={!pdCanEdit} className="h-8" /></td>
                          <td className="p-1"><Input value={row.make} onChange={(e) => { const eq = [...(tabData.equipment || [])]; eq[i] = { ...eq[i], make: e.target.value }; updateTab({ equipment: eq }); }} disabled={!pdCanEdit} className="h-8" /></td>
                          <td className="p-1"><Input value={row.model} onChange={(e) => { const eq = [...(tabData.equipment || [])]; eq[i] = { ...eq[i], model: e.target.value }; updateTab({ equipment: eq }); }} disabled={!pdCanEdit} className="h-8" /></td>
                          <td className="p-1"><Input value={row.qty} onChange={(e) => { const eq = [...(tabData.equipment || [])]; eq[i] = { ...eq[i], qty: e.target.value }; updateTab({ equipment: eq }); }} disabled={!pdCanEdit} className="h-8 w-16" /></td>
                          <td className="p-1"><Input value={row.rating} onChange={(e) => { const eq = [...(tabData.equipment || [])]; eq[i] = { ...eq[i], rating: e.target.value }; updateTab({ equipment: eq }); }} disabled={!pdCanEdit} className="h-8 w-20" /></td>
                          {pdCanEdit && <td className="p-1"><Button variant="ghost" size="sm" onClick={() => { const eq = (tabData.equipment || []).filter((_, j) => j !== i); updateTab({ equipment: eq }); }}><Trash2 className="h-3 w-3 text-rose-500" /></Button></td>}
                        </tr>
                      ))}
                      {(tabData.equipment || []).length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground text-xs">No equipment added yet</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Spec change */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2">
                  <Checkbox checked={!!tabData.specChanged} onCheckedChange={(v) => updateTab({ specChanged: !!v })} disabled={!pdCanEdit} />
                  <span className="text-sm">Equipment differs from proposal</span>
                </label>
              </div>
              {tabData.specChanged && (
                <div className="grid gap-3 md:grid-cols-2 pl-6">
                  <div>
                    <Badge variant="destructive" className="mb-1">Spec Change</Badge>
                    <Label>Change Reason</Label>
                    <Textarea value={tabData.changeReason || ""} onChange={(e) => updateTab({ changeReason: e.target.value })} disabled={!pdCanEdit} rows={2} />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <Checkbox checked={!!tabData.clientNotified} onCheckedChange={(v) => updateTab({ clientNotified: !!v })} disabled={!pdCanEdit} />
                    <span className="text-sm">Client notified?</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 3: COMMERCIAL ===== */}
        <TabsContent value="commercial">
          <Card>
            <CardHeader><CardTitle className="text-base">Commercial</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Funding Model</Label>
                <Select value={tabData.fundingModel || "NONE"} onValueChange={(v) => updateTab({ fundingModel: v === "NONE" ? "" : v })} disabled={!pdCanEdit}>
                  <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">— Select —</SelectItem>
                    {FUNDING_MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Payment milestones */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Payment Milestones</Label>
                  {pdCanEdit && (
                    <Button variant="outline" size="sm" onClick={() => updateTab({ paymentMilestones: [...(tabData.paymentMilestones || []), { name: "", percent: "", trigger: "" }] })}>
                      <Plus className="h-3 w-3 mr-1" /> Add
                    </Button>
                  )}
                </div>
                <div className="border rounded-lg overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr><th className="p-2 text-left">Milestone</th><th className="p-2 text-left">% of Contract</th><th className="p-2 text-left">Trigger Event</th>{pdCanEdit && <th className="p-2 w-8" />}</tr>
                    </thead>
                    <tbody>
                      {(tabData.paymentMilestones || []).map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-1"><Input value={row.name} onChange={(e) => { const ms = [...(tabData.paymentMilestones || [])]; ms[i] = { ...ms[i], name: e.target.value }; updateTab({ paymentMilestones: ms }); }} disabled={!pdCanEdit} className="h-8" /></td>
                          <td className="p-1"><Input value={row.percent} onChange={(e) => { const ms = [...(tabData.paymentMilestones || [])]; ms[i] = { ...ms[i], percent: e.target.value }; updateTab({ paymentMilestones: ms }); }} disabled={!pdCanEdit} className="h-8 w-24" /></td>
                          <td className="p-1"><Input value={row.trigger} onChange={(e) => { const ms = [...(tabData.paymentMilestones || [])]; ms[i] = { ...ms[i], trigger: e.target.value }; updateTab({ paymentMilestones: ms }); }} disabled={!pdCanEdit} className="h-8" /></td>
                          {pdCanEdit && <td className="p-1"><Button variant="ghost" size="sm" onClick={() => updateTab({ paymentMilestones: (tabData.paymentMilestones || []).filter((_, j) => j !== i) })}><Trash2 className="h-3 w-3 text-rose-500" /></Button></td>}
                        </tr>
                      ))}
                      {(tabData.paymentMilestones || []).length === 0 && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground text-xs">No milestones added</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div><Label>Warranty Extensions</Label><Textarea value={tabData.warrantyExtensions || ""} onChange={(e) => updateTab({ warrantyExtensions: e.target.value })} disabled={!pdCanEdit} rows={2} /></div>
              <div><Label>Sub-deliverables for Invoicing</Label><Textarea value={tabData.subDeliverables || ""} onChange={(e) => updateTab({ subDeliverables: e.target.value })} disabled={!pdCanEdit} rows={2} /></div>
              <div><Label>Bank/Funder Requirements</Label><Textarea value={tabData.bankRequirements || ""} onChange={(e) => updateTab({ bankRequirements: e.target.value })} disabled={!pdCanEdit} rows={2} /></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 4: SITE-SPECIFIC RISKS ===== */}
        <TabsContent value="risks">
          <Card>
            <CardHeader><CardTitle className="text-base">Site-Specific Risks</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Risks</Label>
                  {pdCanEdit && (
                    <Button variant="outline" size="sm" onClick={() => updateTab({ risksTable: [...(tabData.risksTable || []), { description: "", category: "", mitigation: "", owner: "" }] })}>
                      <Plus className="h-3 w-3 mr-1" /> Add Risk
                    </Button>
                  )}
                </div>
                <div className="border rounded-lg overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr><th className="p-2 text-left">Description</th><th className="p-2 text-left">Category</th><th className="p-2 text-left">Mitigation</th><th className="p-2 text-left">Owner</th>{pdCanEdit && <th className="p-2 w-8" />}</tr>
                    </thead>
                    <tbody>
                      {(tabData.risksTable || []).map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-1"><Input value={row.description} onChange={(e) => { const r = [...(tabData.risksTable || [])]; r[i] = { ...r[i], description: e.target.value }; updateTab({ risksTable: r }); }} disabled={!pdCanEdit} className="h-8" /></td>
                          <td className="p-1">
                            <Select value={row.category || "NONE"} onValueChange={(v) => { const r = [...(tabData.risksTable || [])]; r[i] = { ...r[i], category: v === "NONE" ? "" : v }; updateTab({ risksTable: r }); }} disabled={!pdCanEdit}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">—</SelectItem>
                                {RISK_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="p-1"><Input value={row.mitigation} onChange={(e) => { const r = [...(tabData.risksTable || [])]; r[i] = { ...r[i], mitigation: e.target.value }; updateTab({ risksTable: r }); }} disabled={!pdCanEdit} className="h-8" /></td>
                          <td className="p-1"><Input value={row.owner} onChange={(e) => { const r = [...(tabData.risksTable || [])]; r[i] = { ...r[i], owner: e.target.value }; updateTab({ risksTable: r }); }} disabled={!pdCanEdit} className="h-8" /></td>
                          {pdCanEdit && <td className="p-1"><Button variant="ghost" size="sm" onClick={() => updateTab({ risksTable: (tabData.risksTable || []).filter((_, j) => j !== i) })}><Trash2 className="h-3 w-3 text-rose-500" /></Button></td>}
                        </tr>
                      ))}
                      {(tabData.risksTable || []).length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground text-xs">No risks added</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <div><Label>Special Conditions</Label><Textarea value={tabData.specialConditions || ""} onChange={(e) => updateTab({ specialConditions: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
              <div><Label>Security Plan</Label><Textarea value={tabData.securityPlan || ""} onChange={(e) => updateTab({ securityPlan: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 5: REGULATORY & COMPLIANCE ===== */}
        <TabsContent value="regulatory">
          <Card>
            <CardHeader><CardTitle className="text-base">Regulatory & Compliance</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div><Label>Municipality Contact</Label><Input value={tabData.municipalityContact || ""} onChange={(e) => updateTab({ municipalityContact: e.target.value })} disabled={!pdCanEdit} /></div>
                <div><Label>Municipality Phone</Label><Input value={tabData.municipalityPhone || ""} onChange={(e) => updateTab({ municipalityPhone: e.target.value })} disabled={!pdCanEdit} /></div>
                <div><Label>Independent Engineer</Label><Input value={tabData.independentEngineer || ""} onChange={(e) => updateTab({ independentEngineer: e.target.value })} disabled={!pdCanEdit} /></div>
                <div>
                  <Label>Lifelines Required</Label>
                  <Select value={tabData.lifelinesRequired || "NONE"} onValueChange={(v) => updateTab({ lifelinesRequired: v === "NONE" ? "" : v })} disabled={!pdCanEdit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">— Select —</SelectItem>
                      <SelectItem value="Yes">Yes</SelectItem>
                      <SelectItem value="No">No</SelectItem>
                      <SelectItem value="TBC">TBC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>COC Requirements</Label><Textarea value={tabData.cocRequirements || ""} onChange={(e) => updateTab({ cocRequirements: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
              {/* SSEG status - read from existing data */}
              <div className="rounded-lg border p-3 bg-muted/30">
                <p className="text-sm font-medium mb-1">SSEG Status</p>
                <p className="text-xs text-muted-foreground">SSEG items for this project are managed via the Handover & Closeout module. Navigate there to view/update SSEG application status.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 6: STAKEHOLDER MAP ===== */}
        <TabsContent value="stakeholders">
          <StakeholderTab projectId={projectId} items={stakeholderData?.items || []} onRefresh={refetchStakeholders} disabled={!pdCanEdit} />
        </TabsContent>
        {/* ===== TAB 7: O&M HANDOVER NOTES ===== */}
        <TabsContent value="oam">
          <Card>
            <CardHeader><CardTitle className="text-base">O&M Handover Notes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label>O&M Partner Confirmed</Label><Input value={tabData.oamPartner || ""} onChange={(e) => updateTab({ oamPartner: e.target.value })} disabled={!pdCanEdit} placeholder="Partner name" /></div>
              <div><Label>SLA Scope Summary</Label><Textarea value={tabData.slaScope || ""} onChange={(e) => updateTab({ slaScope: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
              <div><Label>Special Maintenance Conditions</Label><Textarea value={tabData.specialMaintenance || ""} onChange={(e) => updateTab({ specialMaintenance: e.target.value })} disabled={!pdCanEdit} rows={3} /></div>
              <div>
                <Label>Matriarch Involvement</Label>
                <Select value={tabData.matriarchInvolvement || "NONE"} onValueChange={(v) => updateTab({ matriarchInvolvement: v === "NONE" ? "" : v })} disabled={!pdCanEdit}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">— Select —</SelectItem>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                    <SelectItem value="TBC">TBC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 8: ACTION ITEMS ===== */}
        <TabsContent value="actions">
          <Card>
            <CardHeader><CardTitle className="text-base">Action Items (Handover Work Items)</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Action items are managed as Work Items with workstream "Handover". They appear in each assignee's My Work inbox automatically.
                Create and manage them via the Task Management page for this project.
              </p>
              <div className="rounded-lg border p-4 bg-muted/20 text-center">
                <p className="text-sm text-muted-foreground">
                  Handover work items for this project are displayed in the Task Management hub.
                </p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => window.open(`/tasks?projectId=${projectId}&workstream=HANDOVER`, "_blank")}>
                  Open Task Management
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 9: KICKOFF MEETING ===== */}
        <TabsContent value="kickoff">
          <Card>
            <CardHeader><CardTitle className="text-base">Kickoff Meeting</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Kickoff Meeting Date</Label>
                  <Input type="date" value={tabData.kickoffDate || ""} onChange={(e) => updateTab({ kickoffDate: e.target.value })} disabled={!pdCanEdit} />
                </div>
                <div>
                  <Label>Attendees</Label>
                  <Input value={tabData.attendees || ""} onChange={(e) => updateTab({ attendees: e.target.value })} disabled={!pdCanEdit} placeholder="Comma-separated names" />
                </div>
              </div>
              <div>
                <Label>Pre-populated Agenda</Label>
                <Textarea value={tabData.agenda || ""} onChange={(e) => updateTab({ agenda: e.target.value })} disabled={!pdCanEdit} rows={6} placeholder="Meeting agenda..." />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== SIGN-OFF PANEL ===== */}
      {status === "ACCEPTED" && (
        <Card className="border-emerald-200">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Dual Sign-Off</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Both PD and PM must sign off to complete the handover. Once both have signed, the project transitions to HANDOVER_COMPLETE.</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">PD Sign-Off</p>
                {data.handover?.pd_sign_off_at || data.handover?.pdSignOffAt ? (
                  <p className="text-xs text-emerald-700 mt-1">Signed by {data.handover?.pd_sign_off_by || data.handover?.pdSignOffBy} on {formatDateTime(data.handover?.pd_sign_off_at || data.handover?.pdSignOffAt)}</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mt-1">Not yet signed</p>
                    {isPdRole(user?.role) && (
                      <Button size="sm" className="mt-2" onClick={() => pdSignOff.mutate()} disabled={pdSignOff.isPending}>
                        {pdSignOff.isPending ? "Signing..." : "PD Sign Off"}
                      </Button>
                    )}
                  </>
                )}
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">PM Sign-Off</p>
                {data.handover?.pm_sign_off_at || data.handover?.pmSignOffAt ? (
                  <p className="text-xs text-emerald-700 mt-1">Signed by {data.handover?.pm_sign_off_by || data.handover?.pmSignOffBy} on {formatDateTime(data.handover?.pm_sign_off_at || data.handover?.pmSignOffAt)}</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mt-1">Not yet signed</p>
                    {isPmRole(user?.role) && (
                      <Button size="sm" className="mt-2" onClick={() => pmSignOff.mutate()} disabled={pmSignOff.isPending}>
                        {pmSignOff.isPending ? "Signing..." : "PM Sign Off"}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {status === "HANDOVER_COMPLETE" && (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="p-4 flex items-center gap-2 text-emerald-800">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Handover Complete</span>
            <span className="text-sm text-emerald-600 ml-2">Version {data.handover?.version || 1}</span>
          </CardContent>
        </Card>
      )}

      {/* Reject modal */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Reject Handover</DialogTitle><DialogDescription>Provide a reason so PD can correct and resubmit.</DialogDescription></DialogHeader>
          <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} placeholder="Rejection reason..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectModalOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
