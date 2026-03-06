import { useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  RefreshCw,
  MapPin,
  FileText,
  Receipt,
  GitBranch,
  Clock,
  AlertTriangle,
  Camera,
  TrendingUp,
  Megaphone,
  CheckCircle2,
  Circle,
  Shield,
  ShieldAlert,
  Loader2,
  CreditCard,
  ClipboardCheck,
  ThumbsUp,
  Check,
  X,
} from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: { ...getAuthHeaders(), ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || "Request failed");
  }
  return res.json();
}

interface Snapshot {
  projectId: number;
  projectName: string;
  phase: string | null;
  budget: number;
  committed: number;
  spent: number;
  spendPercent: number;
  voPending: number;
  cashflowStatus: "on_track" | "risk" | "critical";
  schedulePct: number;
  expectedPct: number;
  daysBehindAhead: number;
  safetyStatus: string;
}

interface Compliance {
  weekStartDate: string;
  dailyDiaryDone: string[];
  weeklyProgressDone: boolean;
  weeklyRiskDone: boolean;
}

type ActionType =
  | "site_visit"
  | "generate_po"
  | "link_invoice"
  | "raise_variation"
  | "log_delay"
  | "log_risk"
  | "upload_photo"
  | "update_progress"
  | "escalate"
  | "add_procurement"
  | "update_commissioning"
  | "review_approvals";

const ACTION_CONFIG: {
  type: ActionType;
  label: string;
  icon: typeof MapPin;
  color: string;
}[] = [
  { type: "site_visit", label: "Log Site Visit", icon: MapPin, color: "bg-blue-600 hover:bg-blue-700" },
  { type: "generate_po", label: "Generate PO", icon: FileText, color: "bg-indigo-600 hover:bg-indigo-700" },
  { type: "link_invoice", label: "Link Invoice", icon: Receipt, color: "bg-purple-600 hover:bg-purple-700" },
  { type: "raise_variation", label: "Raise Variation", icon: GitBranch, color: "bg-orange-600 hover:bg-orange-700" },
  { type: "log_delay", label: "Log Delay", icon: Clock, color: "bg-amber-600 hover:bg-amber-700" },
  { type: "log_risk", label: "Log Risk", icon: AlertTriangle, color: "bg-red-600 hover:bg-red-700" },
  { type: "upload_photo", label: "Upload Photo", icon: Camera, color: "bg-teal-600 hover:bg-teal-700" },
  { type: "update_progress", label: "Update Progress", icon: TrendingUp, color: "bg-emerald-600 hover:bg-emerald-700" },
  { type: "escalate", label: "Escalate", icon: Megaphone, color: "bg-rose-600 hover:bg-rose-700" },
  { type: "add_procurement", label: "Add Procurement", icon: CreditCard, color: "bg-violet-600 hover:bg-violet-700" },
  { type: "update_commissioning", label: "Commissioning", icon: ClipboardCheck, color: "bg-cyan-600 hover:bg-cyan-700" },
  { type: "review_approvals", label: "Approvals", icon: ThumbsUp, color: "bg-lime-600 hover:bg-lime-700" },
];

function formatZAR(value: number): string {
  return `R ${value.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function PMOnTheGoProject() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId || "0");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);

  const { data: snapshot, isLoading: snapshotLoading, refetch: refetchSnapshot } = useQuery<Snapshot>({
    queryKey: ["pm-otg-snapshot", projectId],
    queryFn: () => apiFetch(`/api/pm-otg/projects/${projectId}/snapshot`),
    enabled: projectId > 0,
  });

  const { data: compliance, refetch: refetchCompliance } = useQuery<Compliance>({
    queryKey: ["pm-otg-compliance", projectId],
    queryFn: () => apiFetch(`/api/pm-otg/projects/${projectId}/compliance`),
    enabled: projectId > 0,
  });

  const refreshAll = useCallback(() => {
    refetchSnapshot();
    refetchCompliance();
  }, [refetchSnapshot, refetchCompliance]);

  const riskConfirmMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/pm-otg/projects/${projectId}/compliance/risk-confirm`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Risk review confirmed" });
      refetchCompliance();
    },
  });

  if (snapshotLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="p-4 space-y-4">
        <Button variant="ghost" onClick={() => navigate("/pm/on-the-go")} data-testid="btn-back-home">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Card className="p-8 text-center text-muted-foreground">Project not found or not assigned.</Card>
      </div>
    );
  }

  const today = new Date().toISOString().split("T")[0];
  const diaryDoneToday = compliance?.dailyDiaryDone?.includes(today) || false;
  const progressDone = compliance?.weeklyProgressDone || false;
  const riskDone = compliance?.weeklyRiskDone || false;

  return (
    <div className="p-3 sm:p-4 space-y-4 max-w-4xl mx-auto pb-20">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pm/on-the-go")} data-testid="btn-back-home">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Button variant="outline" size="sm" onClick={refreshAll} data-testid="btn-refresh-project">
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      <h2 className="text-xl sm:text-2xl font-heading font-bold truncate" data-testid="text-pm-otg-project-title">
        {snapshot.projectName}
      </h2>

      <Card className="p-3 sm:p-4 space-y-3" data-testid="card-health-snapshot">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Health Snapshot</span>
          {snapshot.phase && <Badge variant="outline" data-testid="badge-phase">{snapshot.phase}</Badge>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Budget</p>
            <p className="text-sm font-semibold" data-testid="text-budget">{formatZAR(snapshot.budget)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Committed</p>
            <p className="text-sm font-semibold" data-testid="text-committed">{formatZAR(snapshot.committed)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Spent</p>
            <p className="text-sm font-semibold" data-testid="text-spent">{formatZAR(snapshot.spent)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">VO Pending</p>
            <p className="text-sm font-semibold" data-testid="text-vo-pending">{formatZAR(snapshot.voPending)}</p>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1">
            <span>Spend: {snapshot.spendPercent}%</span>
          </div>
          <Progress value={Math.min(snapshot.spendPercent, 100)} className="h-2" data-testid="progress-spend" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge
            variant={snapshot.cashflowStatus === "on_track" ? "default" : "destructive"}
            className={
              snapshot.cashflowStatus === "on_track"
                ? "bg-green-600"
                : snapshot.cashflowStatus === "risk"
                ? "bg-amber-500"
                : "bg-red-600"
            }
            data-testid="badge-cashflow-status"
          >
            Cashflow: {snapshot.cashflowStatus === "on_track" ? "On Track" : snapshot.cashflowStatus === "risk" ? "Risk" : "Critical"}
          </Badge>

          <Badge variant="outline" data-testid="badge-schedule">
            Schedule: {snapshot.schedulePct}% ({snapshot.daysBehindAhead >= 0 ? `+${snapshot.daysBehindAhead}` : snapshot.daysBehindAhead} days)
          </Badge>

          {snapshot.safetyStatus === "clear" ? (
            <Badge className="bg-green-600" data-testid="badge-safety">
              <Shield className="w-3 h-3 mr-1" /> Safety Clear
            </Badge>
          ) : (
            <Badge variant="destructive" data-testid="badge-safety">
              <ShieldAlert className="w-3 h-3 mr-1" /> Safety Issue
            </Badge>
          )}
        </div>
      </Card>

      <Card className="p-3 sm:p-4" data-testid="card-compliance">
        <span className="text-sm font-medium text-muted-foreground mb-2 block">Compliance</span>
        <div className="flex items-center gap-4 flex-wrap">
          <ComplianceCheck label="Diary Today" done={diaryDoneToday} testId="compliance-diary" />
          <ComplianceCheck label="Progress (Week)" done={progressDone} testId="compliance-progress" />
          <div className="flex items-center gap-1.5">
            {riskDone ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-sm" data-testid="compliance-risk">Risk (Week)</span>
            {!riskDone && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6 px-2"
                onClick={() => riskConfirmMutation.mutate()}
                disabled={riskConfirmMutation.isPending}
                data-testid="btn-confirm-risk"
              >
                Confirm
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-2 sm:gap-3" data-testid="grid-actions">
        {ACTION_CONFIG.map(({ type, label, icon: Icon, color }) => (
          <Button
            key={type}
            variant="default"
            className={`${color} h-20 sm:h-24 flex flex-col items-center justify-center gap-1 text-white text-xs sm:text-sm font-medium rounded-xl`}
            onClick={() => setActiveAction(type)}
            data-testid={`btn-action-${type}`}
          >
            <Icon className="w-6 h-6 sm:w-7 sm:h-7" />
            <span className="text-center leading-tight">{label}</span>
          </Button>
        ))}
      </div>

      {activeAction && (
        <ActionDialog
          actionType={activeAction}
          projectId={projectId}
          onClose={() => setActiveAction(null)}
          onSuccess={() => {
            setActiveAction(null);
            refreshAll();
            queryClient.invalidateQueries({ queryKey: ["pm-otg-snapshot", projectId] });
            queryClient.invalidateQueries({ queryKey: ["pm-otg-compliance", projectId] });
          }}
        />
      )}
    </div>
  );
}

function ComplianceCheck({ label, done, testId }: { label: string; done: boolean; testId: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {done ? (
        <CheckCircle2 className="w-4 h-4 text-green-500" />
      ) : (
        <Circle className="w-4 h-4 text-muted-foreground" />
      )}
      <span className="text-sm" data-testid={testId}>{label}</span>
    </div>
  );
}

function ActionDialog({
  actionType,
  projectId,
  onClose,
  onSuccess,
}: {
  actionType: ActionType;
  projectId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (endpoint: string, body: Record<string, any>, isFormData = false) => {
    setSubmitting(true);
    try {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (!isFormData) headers["Content-Type"] = "application/json";

      const res = await fetch(`/api/pm-otg/projects/${projectId}/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers,
        body: isFormData ? (body as any) : JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Request failed");
      }

      toast({ title: "Action submitted successfully" });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const config = ACTION_CONFIG.find((a) => a.type === actionType)!;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <config.icon className="w-5 h-5" />
            {config.label}
          </DialogTitle>
          <DialogDescription>Fill in the details and submit.</DialogDescription>
        </DialogHeader>

        {actionType === "site_visit" && (
          <SiteVisitForm onSubmit={handleSubmit} submitting={submitting} />
        )}
        {actionType === "generate_po" && (
          <GeneratePoForm onSubmit={handleSubmit} submitting={submitting} />
        )}
        {actionType === "link_invoice" && (
          <LinkInvoiceForm onSubmit={handleSubmit} submitting={submitting} />
        )}
        {actionType === "raise_variation" && (
          <RaiseVariationForm onSubmit={handleSubmit} submitting={submitting} />
        )}
        {actionType === "log_delay" && (
          <LogDelayForm onSubmit={handleSubmit} submitting={submitting} />
        )}
        {actionType === "log_risk" && (
          <LogRiskForm onSubmit={handleSubmit} submitting={submitting} />
        )}
        {actionType === "upload_photo" && (
          <UploadPhotoForm onSubmit={handleSubmit} submitting={submitting} />
        )}
        {actionType === "update_progress" && (
          <UpdateProgressForm onSubmit={handleSubmit} submitting={submitting} />
        )}
        {actionType === "escalate" && (
          <EscalateForm onSubmit={handleSubmit} submitting={submitting} />
        )}
        {actionType === "add_procurement" && (
          <AddProcurementForm projectId={projectId} onClose={onClose} onSuccess={onSuccess} />
        )}
        {actionType === "update_commissioning" && (
          <UpdateCommissioningForm projectId={projectId} />
        )}
        {actionType === "review_approvals" && (
          <ReviewApprovalsForm projectId={projectId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type FormSubmit = (endpoint: string, body: any, isFormData?: boolean) => Promise<void>;

function SiteVisitForm({ onSubmit, submitting }: { onSubmit: FormSubmit; submitting: boolean }) {
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [weather, setWeather] = useState("clear");
  const [safety, setSafety] = useState("clear");
  const [files, setFiles] = useState<FileList | null>(null);

  const handleSubmit = () => {
    const fd = new FormData();
    fd.append("visitDate", visitDate);
    fd.append("notes", notes);
    fd.append("weatherConditions", weather);
    fd.append("safetyStatus", safety);
    if (files) {
      Array.from(files).forEach((f) => fd.append("photos", f));
    }
    onSubmit("site-visit", fd, true);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="sv-date">Date</Label>
        <Input id="sv-date" type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} data-testid="input-sv-date" />
      </div>
      <div>
        <Label htmlFor="sv-notes">Notes</Label>
        <Textarea id="sv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Site visit notes..." data-testid="input-sv-notes" />
      </div>
      <div>
        <Label>Weather</Label>
        <SearchableSelect
          value={weather}
          onValueChange={setWeather}
          data-testid="select-sv-weather"
          options={[
            { value: "clear", label: "Clear" },
            { value: "cloudy", label: "Cloudy" },
            { value: "rain", label: "Rain" },
            { value: "windy", label: "Windy" },
            { value: "storm", label: "Storm" },
          ]}
        />
      </div>
      <div>
        <Label>Safety Status</Label>
        <div className="flex gap-4 mt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="safety" value="clear" checked={safety === "clear"} onChange={() => setSafety("clear")} data-testid="radio-safety-clear" />
            <span className="text-sm">Clear</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="safety" value="issue_open" checked={safety === "issue_open"} onChange={() => setSafety("issue_open")} data-testid="radio-safety-issue" />
            <span className="text-sm">Issue Open</span>
          </label>
        </div>
      </div>
      <div>
        <Label htmlFor="sv-photos">Photos / Audio</Label>
        <Input id="sv-photos" type="file" accept="image/*,audio/*" multiple onChange={(e) => setFiles(e.target.files)} data-testid="input-sv-photos" />
      </div>
      <Button onClick={handleSubmit} disabled={submitting} className="w-full" data-testid="btn-submit-site-visit">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Log Site Visit
      </Button>
    </div>
  );
}

function GeneratePoForm({ onSubmit, submitting }: { onSubmit: FormSubmit; submitting: boolean }) {
  const [poNumber, setPoNumber] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [supplier, setSupplier] = useState("");

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="po-number">PO Number *</Label>
        <Input id="po-number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-001" data-testid="input-po-number" />
      </div>
      <div>
        <Label htmlFor="po-desc">Description *</Label>
        <Textarea id="po-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="PO description..." data-testid="input-po-description" />
      </div>
      <div>
        <Label htmlFor="po-amount">Amount (ZAR)</Label>
        <Input id="po-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="input-po-amount" />
      </div>
      <div>
        <Label htmlFor="po-supplier">Supplier</Label>
        <Input id="po-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" data-testid="input-po-supplier" />
      </div>
      <Button onClick={() => onSubmit("generate-po", { poNumber, description, amount, supplier })} disabled={submitting || !poNumber || !description} className="w-full" data-testid="btn-submit-generate-po">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Generate PO Request
      </Button>
    </div>
  );
}

function LinkInvoiceForm({ onSubmit, submitting }: { onSubmit: FormSubmit; submitting: boolean }) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [poReference, setPoReference] = useState("");

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="inv-number">Invoice Number *</Label>
        <Input id="inv-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-001" data-testid="input-inv-number" />
      </div>
      <div>
        <Label htmlFor="inv-amount">Amount (ZAR)</Label>
        <Input id="inv-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="input-inv-amount" />
      </div>
      <div>
        <Label htmlFor="inv-po">PO Reference</Label>
        <Input id="inv-po" value={poReference} onChange={(e) => setPoReference(e.target.value)} placeholder="PO-001" data-testid="input-inv-po" />
      </div>
      <Button onClick={() => onSubmit("link-invoice", { invoiceNumber, amount, poReference })} disabled={submitting || !invoiceNumber} className="w-full" data-testid="btn-submit-link-invoice">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Link Invoice
      </Button>
    </div>
  );
}

function RaiseVariationForm({ onSubmit, submitting }: { onSubmit: FormSubmit; submitting: boolean }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [justification, setJustification] = useState("");

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="vo-desc">Description *</Label>
        <Textarea id="vo-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Variation description..." data-testid="input-vo-description" />
      </div>
      <div>
        <Label htmlFor="vo-amount">Amount (ZAR) *</Label>
        <Input id="vo-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="input-vo-amount" />
      </div>
      <div>
        <Label htmlFor="vo-just">Justification</Label>
        <Textarea id="vo-just" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Why is this variation needed?" data-testid="input-vo-justification" />
      </div>
      <Button onClick={() => onSubmit("raise-variation", { description, amount, justification })} disabled={submitting || !description || !amount} className="w-full" data-testid="btn-submit-raise-variation">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Raise Variation Order
      </Button>
    </div>
  );
}

function LogDelayForm({ onSubmit, submitting }: { onSubmit: FormSubmit; submitting: boolean }) {
  const [description, setDescription] = useState("");
  const [daysDelayed, setDaysDelayed] = useState("");
  const [impact, setImpact] = useState("Medium");

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="delay-desc">Description *</Label>
        <Textarea id="delay-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the delay..." data-testid="input-delay-description" />
      </div>
      <div>
        <Label htmlFor="delay-days">Days Delayed</Label>
        <Input id="delay-days" type="number" value={daysDelayed} onChange={(e) => setDaysDelayed(e.target.value)} placeholder="0" data-testid="input-delay-days" />
      </div>
      <div>
        <Label>Impact</Label>
        <SearchableSelect
          value={impact}
          onValueChange={setImpact}
          data-testid="select-delay-impact"
          options={[
            { value: "Low", label: "Low" },
            { value: "Medium", label: "Medium" },
            { value: "High", label: "High" },
          ]}
        />
      </div>
      <Button onClick={() => onSubmit("log-delay", { description, daysDelayed, impact })} disabled={submitting || !description} className="w-full" data-testid="btn-submit-log-delay">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Log Delay
      </Button>
    </div>
  );
}

function LogRiskForm({ onSubmit, submitting }: { onSubmit: FormSubmit; submitting: boolean }) {
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("Medium");
  const [mitigationNotes, setMitigationNotes] = useState("");

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="risk-desc">Description *</Label>
        <Textarea id="risk-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the risk..." data-testid="input-risk-description" />
      </div>
      <div>
        <Label>Severity *</Label>
        <SearchableSelect
          value={severity}
          onValueChange={setSeverity}
          data-testid="select-risk-severity"
          options={[
            { value: "Low", label: "Low" },
            { value: "Medium", label: "Medium" },
            { value: "High", label: "High" },
            { value: "Critical", label: "Critical" },
          ]}
        />
      </div>
      <div>
        <Label htmlFor="risk-mitigation">Mitigation Notes</Label>
        <Textarea id="risk-mitigation" value={mitigationNotes} onChange={(e) => setMitigationNotes(e.target.value)} placeholder="Mitigation plan..." data-testid="input-risk-mitigation" />
      </div>
      <Button onClick={() => onSubmit("log-risk", { description, severity, mitigationNotes })} disabled={submitting || !description || !severity} className="w-full" data-testid="btn-submit-log-risk">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Log Risk
      </Button>
    </div>
  );
}

function UploadPhotoForm({ onSubmit, submitting }: { onSubmit: FormSubmit; submitting: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [linkedEvent, setLinkedEvent] = useState("");

  const handleSubmit = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    fd.append("caption", caption);
    fd.append("linkedEvent", linkedEvent);
    onSubmit("upload-photo", fd, true);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="photo-file">Photo *</Label>
        <Input id="photo-file" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="input-photo-file" />
      </div>
      <div>
        <Label htmlFor="photo-caption">Caption</Label>
        <Input id="photo-caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Optional caption" data-testid="input-photo-caption" />
      </div>
      <div>
        <Label htmlFor="photo-event">Link to Event</Label>
        <Input id="photo-event" value={linkedEvent} onChange={(e) => setLinkedEvent(e.target.value)} placeholder="e.g. Site Visit #12" data-testid="input-photo-event" />
      </div>
      <Button onClick={handleSubmit} disabled={submitting || !file} className="w-full" data-testid="btn-submit-upload-photo">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Upload Photo
      </Button>
    </div>
  );
}

function UpdateProgressForm({ onSubmit, submitting }: { onSubmit: FormSubmit; submitting: boolean }) {
  const [progressPercent, setProgressPercent] = useState(50);
  const [notes, setNotes] = useState("");

  return (
    <div className="space-y-3">
      <div>
        <Label>Progress: {progressPercent}%</Label>
        <Slider
          value={[progressPercent]}
          onValueChange={(v) => setProgressPercent(v[0])}
          min={0}
          max={100}
          step={1}
          className="mt-2"
          data-testid="slider-progress"
        />
      </div>
      <div>
        <Label htmlFor="prog-notes">Notes</Label>
        <Textarea id="prog-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Progress update notes..." data-testid="input-progress-notes" />
      </div>
      <Button onClick={() => onSubmit("update-progress", { progressPercent: String(progressPercent), notes })} disabled={submitting} className="w-full" data-testid="btn-submit-update-progress">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Update Progress
      </Button>
    </div>
  );
}

function EscalateForm({ onSubmit, submitting }: { onSubmit: FormSubmit; submitting: boolean }) {
  const [description, setDescription] = useState("");
  const [escalationLevel, setEscalationLevel] = useState("High");
  const [urgency, setUrgency] = useState("High");

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="esc-desc">Description *</Label>
        <Textarea id="esc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs escalation?" data-testid="input-esc-description" />
      </div>
      <div>
        <Label>Escalation Level</Label>
        <SearchableSelect
          value={escalationLevel}
          onValueChange={setEscalationLevel}
          data-testid="select-esc-level"
          options={[
            { value: "Medium", label: "Medium" },
            { value: "High", label: "High" },
            { value: "Critical", label: "Critical" },
          ]}
        />
      </div>
      <div>
        <Label>Urgency</Label>
        <SearchableSelect
          value={urgency}
          onValueChange={setUrgency}
          data-testid="select-esc-urgency"
          options={[
            { value: "Medium", label: "Medium" },
            { value: "High", label: "High" },
            { value: "Critical", label: "Critical" },
          ]}
        />
      </div>
      <Button onClick={() => onSubmit("escalate", { description, escalationLevel, urgency })} disabled={submitting || !description} className="w-full" data-testid="btn-submit-escalate">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Escalate
      </Button>
    </div>
  );
}

function AddProcurementForm({ projectId, onClose, onSuccess }: { projectId: number; onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [expectedCost, setExpectedCost] = useState("");
  const [requiredDate, setRequiredDate] = useState("");

  const mutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/procurement`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ ...data, projectId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Request failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Procurement item added" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-3 bg-white">
      <div>
        <Label htmlFor="proc-title">Title *</Label>
        <Input id="proc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Procurement item title" data-testid="input-proc-title" />
      </div>
      <div>
        <Label htmlFor="proc-desc">Description</Label>
        <Textarea id="proc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details..." data-testid="input-proc-description" />
      </div>
      <div>
        <Label>Category</Label>
        <SearchableSelect
          value={category}
          onValueChange={setCategory}
          data-testid="select-proc-category"
          options={[
            { value: "material", label: "Material" },
            { value: "equipment", label: "Equipment" },
            { value: "service", label: "Service" },
            { value: "subcontract", label: "Subcontract" },
            { value: "other", label: "Other" },
          ]}
        />
      </div>
      <div>
        <Label htmlFor="proc-cost">Expected Cost (ZAR)</Label>
        <Input id="proc-cost" type="number" value={expectedCost} onChange={(e) => setExpectedCost(e.target.value)} placeholder="0.00" data-testid="input-proc-cost" />
      </div>
      <div>
        <Label htmlFor="proc-date">Required Date</Label>
        <Input id="proc-date" type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} data-testid="input-proc-date" />
      </div>
      <Button
        onClick={() => mutation.mutate({ title, description, category, expectedCost: expectedCost ? parseFloat(expectedCost) : undefined, requiredDate: requiredDate || undefined })}
        disabled={mutation.isPending || !title}
        className="w-full bg-[#16A34A] hover:bg-[#15803d] text-white"
        data-testid="btn-submit-procurement"
      >
        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Add Procurement Item
      </Button>
    </div>
  );
}

function UpdateCommissioningForm({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: items, isLoading } = useQuery<any[]>({
    queryKey: ["commissioning-items", projectId],
    queryFn: () => apiFetch(`/api/commissioning/project/${projectId}`),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/commissioning/${itemId}`, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Request failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Status updated" });
      queryClient.invalidateQueries({ queryKey: ["commissioning-items", projectId] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [pendingStatus, setPendingStatus] = useState<Record<number, string>>({});

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-commissioning">No commissioning items found.</p>;
  }

  const statusOptions = [
    { value: "not_started", label: "Not Started" },
    { value: "in_progress", label: "In Progress" },
    { value: "ready_for_review", label: "Ready for Review" },
    { value: "approved", label: "Approved" },
    { value: "closed", label: "Closed" },
  ];

  const statusColors: Record<string, string> = {
    not_started: "bg-gray-100 text-gray-700",
    in_progress: "bg-blue-100 text-blue-700",
    ready_for_review: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
    closed: "bg-slate-100 text-slate-700",
  };

  return (
    <div className="space-y-3 bg-white max-h-[60vh] overflow-y-auto">
      {items.map((item: any) => (
        <Card key={item.id} className="p-3 space-y-2" data-testid={`card-commissioning-${item.id}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium truncate" data-testid={`text-commissioning-title-${item.id}`}>{item.title}</span>
            <Badge className={statusColors[item.status] || "bg-gray-100"} data-testid={`badge-commissioning-status-${item.id}`}>
              {item.status?.replace(/_/g, " ")}
            </Badge>
          </div>
          {item.category && <span className="text-xs text-muted-foreground">{item.category}</span>}
          <div className="flex items-center gap-2">
            <SearchableSelect
              value={pendingStatus[item.id] || item.status}
              onValueChange={(val) => setPendingStatus((prev) => ({ ...prev, [item.id]: val }))}
              options={statusOptions}
              data-testid={`select-commissioning-status-${item.id}`}
              triggerClassName="flex-1 h-8 text-xs"
            />
            <Button
              size="sm"
              className="h-8 bg-[#16A34A] hover:bg-[#15803d] text-white"
              disabled={statusMutation.isPending || !pendingStatus[item.id] || pendingStatus[item.id] === item.status}
              onClick={() => statusMutation.mutate({ itemId: item.id, status: pendingStatus[item.id] })}
              data-testid={`btn-save-commissioning-${item.id}`}
            >
              {statusMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ReviewApprovalsForm({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ items: any[]; counts: any }>({
    queryKey: ["pending-approvals"],
    queryFn: () => apiFetch(`/api/approvals/pending`),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let url: string;
      let method: string;
      let body: string | undefined;

      if (id.startsWith("eng-")) {
        const actualId = id.replace("eng-", "");
        url = `/api/eng-stages/approvals/${actualId}`;
        method = "PATCH";
        body = JSON.stringify({ status: action === "approve" ? "approved" : "rejected" });
      } else {
        const numericId = id.replace(/^(qc-|del-)/, "");
        url = `/api/approvals/general/${numericId}`;
        method = "PATCH";
        body = JSON.stringify({ status: action === "approve" ? "approved" : "rejected" });
      }

      const res = await fetch(url, { method, credentials: "include", headers, body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Request failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Approval action completed" });
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const filteredItems = (data?.items || []).filter((item: any) => item.projectId === projectId);

  if (filteredItems.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-approvals">No pending approvals for this project.</p>;
  }

  const typeColors: Record<string, string> = {
    engineering: "bg-indigo-100 text-indigo-700",
    quality: "bg-purple-100 text-purple-700",
    deliverable: "bg-blue-100 text-blue-700",
  };

  return (
    <div className="space-y-3 bg-white max-h-[60vh] overflow-y-auto">
      {filteredItems.map((item: any) => (
        <Card key={item.id} className="p-3 space-y-2" data-testid={`card-approval-${item.id}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate" data-testid={`text-approval-title-${item.id}`}>{item.title}</span>
            <Badge className={typeColors[item.type] || "bg-gray-100"} data-testid={`badge-approval-type-${item.id}`}>
              {item.type}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {item.assignee && <span>Assignee: {item.assignee}</span>}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 h-8 bg-[#16A34A] hover:bg-[#15803d] text-white"
              disabled={actionMutation.isPending}
              onClick={() => actionMutation.mutate({ id: item.id, action: "approve" })}
              data-testid={`btn-approve-${item.id}`}
            >
              <Check className="w-3 h-3 mr-1" /> Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1 h-8"
              disabled={actionMutation.isPending}
              onClick={() => actionMutation.mutate({ id: item.id, action: "reject" })}
              data-testid={`btn-reject-${item.id}`}
            >
              <X className="w-3 h-3 mr-1" /> Reject
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
