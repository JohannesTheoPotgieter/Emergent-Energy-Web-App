/**
 * Unified Opportunity drawer (2026-04-20).
 *
 * Replaces the legacy "PD Ticket detail" page. Treats Pipedrive
 * opportunity + PD-shadow `pd_tickets` row as a single user-facing
 * record:
 *   - CRM block (blue 🔵): read-only — Pipedrive sync owns these.
 *   - PD workflow block (emerald 🟢): editable — the app owns these.
 *   - Tasks block: spawned engineering tasks for this opportunity.
 *   - Convert-to-Project: opens a small wizard to materialise the
 *     project shell at S01_FIRST_ASSESSMENT.
 *
 * Backed by:
 *   GET   /api/opportunities/:id/workflow   (lazy-creates PD shadow)
 *   PATCH /api/opportunities/:id/pd         (PD-side fields only)
 *   POST  /api/opportunities/:id/spawn-tasks
 *   POST  /api/opportunities/:id/convert-to-project
 */
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ExternalLink, Lock, Sparkles, Zap, ArrowRight, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// --- Types matching /api/opportunities/:id/workflow shape ---

interface CrmBlock {
  id: number;
  source: string | null;
  pipedriveDealId: string | null;
  dealName: string | null;
  stage: string | null;
  status: string | null;
  estimatedValue: string | null;
  currency: string | null;
  probability: string | null;
  weightedValue: string | null;
  expectedCloseDate: string | null;
  signedDate: string | null;
  pipedriveUpdatedAt: string | null;
  pipedriveStageChangedAt: string | null;
  dealOwnerName: string | null;
  personName: string | null;
  personEmail: string | null;
  personPhone: string | null;
  lastActivityDate: string | null;
  nextActivityDate: string | null;
  nextActivitySubject: string | null;
  labels: string | null;
  lostReason: string | null;
  notes: string | null;
}

interface PdBlock {
  id: number;
  projectId: number | null;
  projectSiteName: string;
  requestType: string;
  priority: string;
  status: string;
  dueDate: string | null;
  comments: string | null;
  estimatedCost: string | null;
  estimatedMargin: string | null;
  estimatedMarginPercent: string | null;
  financialNotes: string | null;
  billsOrTariffData: boolean | null;
  meteringDataAvailable: boolean | null;
  siteInspectionForm: boolean | null;
  hseDiscussed: boolean | null;
  batteriesNeeded: boolean | null;
  roofReplacementNeeded: boolean | null;
  tasksSpawnedAt: string | null;
}

interface WorkflowResponse {
  crm: CrmBlock;
  clientName: string | null;
  siteName: string | null;
  pd: PdBlock;
  tasks: Array<{ id: number; title: string; status: string; priority: string | null; endDate: string | null }>;
}

const PD_STATUSES = ["Draft", "In Progress", "On Hold", "Completed", "Cancelled"];
const PD_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const PD_REQUEST_TYPES = [
  "Cost Proposal", "IFC Planning", "Construction Support",
  "Commissioning", "Handover", "Compliance",
];

function fmtMoney(v: string | null, ccy: string | null): string {
  if (!v) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `${ccy || "ZAR"} ${n.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" });
}

function daysBetween(from: string | null, to: Date = new Date()): number | null {
  if (!from) return null;
  const d = new Date(from);
  if (isNaN(d.getTime())) return null;
  return Math.floor((to.getTime() - d.getTime()) / 86_400_000);
}

interface Props {
  opportunityId: number | null;
  open: boolean;
  onClose: () => void;
}

export function OpportunityDrawer({ opportunityId, open, onClose }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [convertOpen, setConvertOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<WorkflowResponse>({
    queryKey: ["/api/opportunities", opportunityId, "workflow"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/opportunities/${opportunityId}/workflow`);
      if (!res.ok) throw new Error(`Failed to load opportunity (${res.status})`);
      return res.json();
    },
    enabled: open && opportunityId != null,
    // Drawer-hopping is common; brief cache makes re-opens feel instant
    // without going stale relative to mutations (which invalidate this key
    // explicitly).
    staleTime: 30_000,
  });

  // Local PD edit state (controlled inputs — flushed via patch on blur/save)
  const [pdDraft, setPdDraft] = useState<Partial<PdBlock>>({});
  useEffect(() => {
    setPdDraft({});
    setConvertOpen(false);
  }, [opportunityId]);

  const patchPd = useMutation({
    mutationFn: async (fields: Partial<PdBlock>) => {
      const res = await apiRequest("PATCH", `/api/opportunities/${opportunityId}/pd`, fields);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Save failed (${res.status})`);
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities", opportunityId, "workflow"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities/working"] });
      setPdDraft({});
      toast({ title: "PD workflow updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const spawnTasks = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/opportunities/${opportunityId}/spawn-tasks`, {});
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Failed (${res.status})`);
      return body as { spawned: number };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities", opportunityId, "workflow"] });
      toast({ title: `Spawned ${r.spawned} engineering task${r.spawned === 1 ? "" : "s"}` });
    },
    onError: (err: Error) => toast({ title: "Spawn failed", description: err.message, variant: "destructive" }),
  });

  const merged = data ? { ...data.pd, ...pdDraft } : null;
  const hasUnsavedPd = Object.keys(pdDraft).length > 0;
  const isPipedrive = data?.crm.source === "pipedrive";
  const daysInStage = daysBetween(data?.crm.pipedriveStageChangedAt ?? data?.crm.pipedriveUpdatedAt ?? null);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="opportunity-drawer">
        {isLoading ? (
          <div className="flex items-center justify-center h-[60vh]">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
          </div>
        ) : isError || !data || !merged ? (
          <div className="p-6 text-sm text-muted-foreground">Could not load opportunity.</div>
        ) : (
          <>
            <SheetHeader className="space-y-1 pb-3 border-b">
              <SheetTitle className="text-base flex items-start gap-2 pr-6">
                <span className="flex-1" data-testid="text-opportunity-name">
                  {data.crm.dealName || data.clientName || `Opportunity #${data.crm.id}`}
                </span>
              </SheetTitle>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className="border-emerald-200 text-emerald-800 bg-emerald-50">
                  {data.clientName || "No client"}
                </Badge>
                {isPipedrive && data.crm.pipedriveDealId && (
                  <Badge variant="outline" className="text-muted-foreground">
                    Pipedrive #{data.crm.pipedriveDealId}
                  </Badge>
                )}
                <span className="text-muted-foreground">CRM stage: <span className="font-medium text-foreground">{data.crm.stage || "—"}</span></span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">PD status:
                  <span className={`ml-1 font-medium ${merged.status === "Completed" ? "text-emerald-700" : merged.status === "On Hold" ? "text-amber-700" : "text-foreground"}`}>
                    {merged.status}
                  </span>
                </span>
              </div>
            </SheetHeader>

            <div className="py-4 space-y-6">
              {/* === CRM block (read-only, blue accent) === */}
              <section className="rounded-md border border-sky-100 bg-sky-50/40 p-3 space-y-2" data-testid="section-crm">
                <header className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-900 flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> CRM (Pipedrive — read-only)
                  </h3>
                  {data.crm.pipedriveUpdatedAt && (
                    <span className="text-[10px] text-sky-700">
                      synced {fmtDate(data.crm.pipedriveUpdatedAt)}
                    </span>
                  )}
                </header>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <ReadField label="Deal value" value={fmtMoney(data.crm.estimatedValue, data.crm.currency)} />
                  <ReadField label="Weighted value" value={fmtMoney(data.crm.weightedValue, data.crm.currency)} />
                  <ReadField label="Probability" value={data.crm.probability ? `${data.crm.probability}%` : "—"} />
                  <ReadField label="Days in stage" value={daysInStage != null ? `${daysInStage}d` : "—"} />
                  <ReadField label="Expected close" value={fmtDate(data.crm.expectedCloseDate)} />
                  <ReadField label="Deal owner" value={data.crm.dealOwnerName} />
                  <ReadField label="Contact" value={data.crm.personName} />
                  <ReadField label="Contact email" value={data.crm.personEmail} />
                  <ReadField label="Last activity" value={fmtDate(data.crm.lastActivityDate)} />
                  <ReadField label="Next activity" value={data.crm.nextActivitySubject ? `${fmtDate(data.crm.nextActivityDate)} — ${data.crm.nextActivitySubject}` : fmtDate(data.crm.nextActivityDate)} />
                  {data.crm.labels && <ReadField label="Labels" value={data.crm.labels} />}
                  {data.crm.lostReason && <ReadField label="Lost reason" value={data.crm.lostReason} />}
                </dl>
              </section>

              {/* === PD workflow (editable, emerald accent) === */}
              <section className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3 space-y-3" data-testid="section-pd">
                <header className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-900 flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" /> Project Development (editable)
                  </h3>
                  {hasUnsavedPd && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => patchPd.mutate(pdDraft)}
                      disabled={patchPd.isPending}
                      data-testid="btn-save-pd"
                    >
                      {patchPd.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Save changes
                    </Button>
                  )}
                </header>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Request type">
                    <Select
                      value={merged.requestType}
                      onValueChange={(v) => setPdDraft((p) => ({ ...p, requestType: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid="select-pd-request-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PD_REQUEST_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Priority">
                    <Select
                      value={merged.priority}
                      onValueChange={(v) => setPdDraft((p) => ({ ...p, priority: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid="select-pd-priority"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PD_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Status">
                    <Select
                      value={merged.status}
                      onValueChange={(v) => setPdDraft((p) => ({ ...p, status: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid="select-pd-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Due date">
                    <Input
                      type="date"
                      className="h-8 text-xs"
                      value={merged.dueDate ?? ""}
                      onChange={(e) => setPdDraft((p) => ({ ...p, dueDate: e.target.value || null }))}
                      data-testid="input-pd-due-date"
                    />
                  </Field>
                </div>

                <Field label="Technical readiness">
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    {([
                      ["billsOrTariffData", "Bills / tariff data"],
                      ["meteringDataAvailable", "Metering data"],
                      ["siteInspectionForm", "Site inspection done"],
                      ["hseDiscussed", "HSE discussed"],
                      ["batteriesNeeded", "Batteries needed"],
                      ["roofReplacementNeeded", "Roof replacement"],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={Boolean((merged as PdBlock)[key])}
                          onChange={(e) => setPdDraft((p) => ({ ...p, [key]: e.target.checked }))}
                          data-testid={`check-pd-${key}`}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </Field>

                <Field label="PD comments">
                  <Textarea
                    className="text-xs min-h-[60px]"
                    value={merged.comments ?? ""}
                    onChange={(e) => setPdDraft((p) => ({ ...p, comments: e.target.value }))}
                    data-testid="textarea-pd-comments"
                  />
                </Field>
              </section>

              {/* === Tasks === */}
              <section className="rounded-md border p-3 space-y-2" data-testid="section-tasks">
                <header className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground flex items-center gap-1.5">
                    <Zap className="h-3 w-3 text-emerald-600" /> Engineering tasks
                  </h3>
                  {!merged.tasksSpawnedAt && merged.projectId && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => spawnTasks.mutate()}
                      disabled={spawnTasks.isPending}
                      data-testid="btn-spawn-tasks"
                    >
                      {spawnTasks.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Spawn from "{merged.requestType}" template
                    </Button>
                  )}
                </header>
                {!merged.projectId ? (
                  <p className="text-[11px] text-muted-foreground italic">Convert this opportunity to a project before spawning tasks.</p>
                ) : data.tasks.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">No tasks yet.</p>
                ) : (
                  <ul className="text-xs space-y-1">
                    {data.tasks.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 border-b last:border-b-0 py-1">
                        <CheckCircle2 className={`h-3 w-3 ${t.status === "Done" ? "text-emerald-600" : "text-muted-foreground"}`} />
                        <span className="flex-1 truncate">{t.title}</span>
                        <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* === Convert CTA === */}
              {!merged.projectId && (
                <section className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 flex items-center justify-between">
                  <div className="text-xs">
                    <p className="font-medium text-emerald-900">Ready to start the project?</p>
                    <p className="text-emerald-800/80">Creates a project shell at "First Assessment" and links it back here.</p>
                  </div>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => setConvertOpen(true)}
                    data-testid="btn-open-convert-wizard"
                  >
                    Convert to project <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </section>
              )}
              {merged.projectId && (
                <section className="rounded-md border p-3 text-xs flex items-center gap-2 text-muted-foreground">
                  <ExternalLink className="h-3 w-3" />
                  Linked to project ID #{merged.projectId}.
                </section>
              )}
            </div>

            {convertOpen && data && (
              <ConvertWizard
                opportunityId={data.crm.id}
                defaultName={data.crm.dealName || data.clientName || `Opportunity ${data.crm.id}`}
                clientId={null}
                onClose={() => setConvertOpen(false)}
                onConverted={() => {
                  setConvertOpen(false);
                  queryClient.invalidateQueries({ queryKey: ["/api/opportunities", opportunityId, "workflow"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/opportunities/working"] });
                  toast({ title: "Project created" });
                }}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// --- Tiny helpers ---

function ReadField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground truncate" title={value ?? ""}>{value || "—"}</dd>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// --- Convert wizard (small modal-in-drawer) ---

function ConvertWizard({
  opportunityId, defaultName, clientId, onClose, onConverted,
}: {
  opportunityId: number;
  defaultName: string;
  clientId: number | null;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [projectName, setProjectName] = useState(defaultName);
  const [sizeKwp, setSizeKwp] = useState("");

  const convert = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/opportunities/${opportunityId}/convert-to-project`, {
        projectName,
        clientId,
        sizeKwp: sizeKwp ? Number(sizeKwp) : null,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Convert failed (${res.status})`);
      return body;
    },
    onSuccess: onConverted,
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl border max-w-md w-full p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
        data-testid="convert-wizard"
      >
        <h3 className="text-sm font-semibold">Convert to Project</h3>
        <Field label="Project name">
          <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="h-9 text-sm" data-testid="input-convert-project-name" />
        </Field>
        <Field label="Starting kWp (optional)">
          <Input type="number" value={sizeKwp} onChange={(e) => setSizeKwp(e.target.value)} className="h-9 text-sm" data-testid="input-convert-kwp" />
        </Field>
        {convert.isError && (
          <p className="text-xs text-red-600">{(convert.error as Error)?.message ?? "Failed"}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="btn-cancel-convert">Cancel</Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => convert.mutate()}
            disabled={!projectName.trim() || convert.isPending}
            data-testid="btn-confirm-convert"
          >
            {convert.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Create project
          </Button>
        </div>
      </div>
    </div>
  );
}
