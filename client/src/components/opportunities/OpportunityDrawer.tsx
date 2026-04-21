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

interface ProjectTask {
  id: number;
  pdTicketId: number | null;
  title: string;
  status: string;
  phase: string | null;
  priority: string | null;
  endDate: string | null;
  percentComplete: number | null;
  ownerUserId: number | null;
  ownerName: string | null;
}

interface OpportunityTicket {
  id: number;
  status: string;
  requestType: string;
  priority: string;
  dueDate: string | null;
  comments: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  clientId: number | null;
  projectId: number | null;
  projectName: string | null;
  tasksSpawnedAt: string | null;
  projectDeveloperUserId: number | null;
  projectDeveloperName: string | null;
  designerUserId: number | null;
  designerName: string | null;
}

interface WorkflowResponse {
  crm: CrmBlock;
  clientName: string | null;
  siteName: string | null;
  pd: PdBlock;
  tasks: Array<{ id: number; title: string; status: string; priority: string | null; endDate: string | null }>;
  tickets?: OpportunityTicket[];
  projectTasks?: ProjectTask[];
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

              {/* === Engineering task board (tickets + project board merged) === */}
              {(data.tickets ?? []).length > 0 ? (
                <section className="rounded-md border p-3 space-y-3" data-testid="section-engineering-task-board">
                  <header className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground flex items-center gap-1.5">
                      <Zap className="h-3 w-3 text-emerald-600" /> Engineering task board
                    </h3>
                  </header>
                  <EngineeringTicketsSection tickets={data.tickets ?? []} />
                  {(data.tickets ?? []).some((t) => t.projectId) && (
                    <ProjectTaskBoard
                      tasks={data.projectTasks ?? []}
                      tickets={data.tickets ?? []}
                      projectName={(data.tickets ?? []).find((t) => t.projectName)?.projectName ?? null}
                    />
                  )}
                </section>
              ) : (
                /* Legacy "spawn tasks for the shadow PD ticket" surface — only
                   shown when the opportunity has NO real tickets yet. Once the
                   user creates an engineering ticket via the working-list flow,
                   this is replaced by the ticket tracking list above. */
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
                    <p className="text-[11px] text-muted-foreground italic">No engineering tickets yet — create one from the working list, or convert this opportunity to a project first.</p>
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
              )}

              {/* === Convert CTA / linked-project state ===
                  When a project is already linked (either on the opportunity
                  itself or on any of its engineering tickets) we treat the
                  "create project" step as done and render a green confirmation
                  with a deep link instead of the convert button. */}
              {(() => {
                // The shadow PD row is filtered to project_id IS NULL on the
                // server, so a "linked project" can only ever come from a
                // real engineering ticket. Source projectId AND projectName
                // from the same ticket so the deep link is always coherent.
                const linkedFromTicket = (data.tickets ?? []).find((t) => t.projectId && t.projectName);
                const effectiveProjectId = linkedFromTicket?.projectId ?? null;
                const effectiveProjectName = linkedFromTicket?.projectName ?? null;
                if (effectiveProjectId) {
                  return (
                    <section
                      className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 flex items-center justify-between"
                      data-testid="section-project-linked"
                    >
                      <div className="text-xs flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <div>
                          <p className="font-medium text-emerald-900">Project linked</p>
                          <p className="text-emerald-800/80">This opportunity has a working project — no need to convert again.</p>
                        </div>
                      </div>
                      {effectiveProjectName ? (
                        <a
                          href={`/project/${encodeURIComponent(effectiveProjectName)}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                          data-testid="link-project-linked"
                        >
                          {effectiveProjectName} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">#{effectiveProjectId}</span>
                      )}
                    </section>
                  );
                }
                return (
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
                );
              })()}
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

/**
 * Per-ticket tracking row for the drawer.
 *
 * Replaces the old "Convert this opportunity to a project before spawning
 * tasks" placeholder when the opportunity already has at least one real
 * engineering ticket. Each row shows the ticket's request type, status,
 * priority, due date, days-since-created, owners, the linked project (deep
 * link to the project page), and an optional first line of the comments so
 * engineering can leave/track feedback at a glance.
 */
function EngineeringTicketsSection({ tickets }: { tickets: OpportunityTicket[] }) {
  const open = tickets.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length;
  const closed = tickets.length - open;
  return (
    <div className="space-y-1.5" data-testid="section-engineering-tickets">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1.5">
          Tickets
          <span className="text-[10px] font-normal text-muted-foreground tabular-nums">
            • {open} open / {closed} closed
          </span>
        </h4>
      </div>
      <ul className="text-xs space-y-1.5" data-testid="list-engineering-tickets">
        {tickets.map((t) => (
          <TicketRow key={t.id} ticket={t} />
        ))}
      </ul>
    </div>
  );
}

function ticketStatusClass(status: string): string {
  switch (status) {
    case "Completed":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Cancelled":
      return "bg-slate-100 text-slate-600 border-slate-200";
    case "In Progress":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "On Hold":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function ticketPriorityClass(priority: string): string {
  switch (priority) {
    case "Urgent":
      return "bg-red-50 text-red-700 border-red-200";
    case "High":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "Low":
      return "bg-slate-50 text-slate-600 border-slate-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function ticketAgeDays(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)));
}

function TicketRow({ ticket }: { ticket: OpportunityTicket }) {
  const isClosed = ticket.status === "Completed" || ticket.status === "Cancelled";
  const ageDays = ticketAgeDays(ticket.createdAt);
  const owner = ticket.projectDeveloperName || ticket.designerName || null;
  const commentPreview = (ticket.comments || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const projectHref = ticket.projectName
    ? `/project/${encodeURIComponent(ticket.projectName)}`
    : null;
  return (
    <li
      className={`rounded border px-2 py-1.5 ${
        isClosed ? "border-slate-200 bg-slate-50/40" : "border-slate-200 bg-white"
      }`}
      data-testid={`row-eng-ticket-${ticket.id}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-foreground truncate">{ticket.requestType}</span>
        <Badge variant="outline" className={`text-[10px] ${ticketStatusClass(ticket.status)}`}>
          {ticket.status}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${ticketPriorityClass(ticket.priority)}`}>
          {ticket.priority}
        </Badge>
        {ageDays != null && !isClosed && (
          <span
            className={`text-[10px] tabular-nums ${ageDays >= 14 ? "text-amber-700 font-medium" : "text-muted-foreground"}`}
            title={`Created ${ageDays}d ago`}
          >
            {ageDays}d in progress
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">#{ticket.id}</span>
      </div>
      <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[10px] text-muted-foreground">
        {ticket.dueDate && <span>Due {ticket.dueDate}</span>}
        {owner && <span>Owner: <span className="text-foreground">{owner}</span></span>}
        {projectHref ? (
          <a
            href={projectHref}
            className="inline-flex items-center gap-0.5 text-emerald-700 hover:text-emerald-800 hover:underline"
            data-testid={`link-eng-ticket-project-${ticket.id}`}
            title={`Open project ${ticket.projectName} to leave feedback / track progress`}
          >
            {ticket.projectName} <ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : (
          <span className="italic">Not yet linked to a project</span>
        )}
        {ticket.tasksSpawnedAt && <span className="text-emerald-700">Tasks spawned</span>}
      </div>
      {commentPreview && (
        <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2" title={ticket.comments ?? undefined}>
          {commentPreview}
          {ticket.comments && ticket.comments.length > commentPreview.length ? "…" : ""}
        </p>
      )}
    </li>
  );
}

/**
 * Project-level engineering task board.
 *
 * Renders ALL work_items belonging to the linked project (not per-ticket),
 * grouped by `phase` so the user sees the project's engineering pipeline.
 * The First Assessment ticket's tasks (and any future engineering tickets')
 * appear here as items inside their corresponding phase column. Each row
 * shows a status dot, title, the originating ticket chip, and the engineer
 * assigned. Falls back to "Unassigned" when `phase` is null.
 */
function ProjectTaskBoard({
  tasks,
  tickets,
  projectName,
}: {
  tasks: ProjectTask[];
  tickets: OpportunityTicket[];
  projectName: string | null;
}) {
  const ticketLabelById = new Map<number, string>();
  for (const t of tickets) ticketLabelById.set(t.id, t.requestType);

  // Promote each engineering ticket to a first-class board item under its
  // requestType (e.g. "First Assessment") so the ticket itself shows up
  // even when no work_items have been spawned. If the ticket DOES have
  // spawned work_items, those render as additional rows in the same phase
  // column. Tickets linked to a different project (rare) are skipped so
  // we don't pollute this board.
  const linkedProjectId = tickets.find((t) => t.projectId)?.projectId ?? null;
  const ticketsAsTasks: ProjectTask[] = tickets
    .filter((t) => t.projectId == null || t.projectId === linkedProjectId)
    .map((t) => ({
      id: -t.id, // negative id → distinct from real work_items.id
      pdTicketId: t.id,
      title: `Ticket: ${t.requestType}`,
      status: ticketStatusToWorkItemStatus(t.status),
      phase: t.requestType,
      priority: t.priority,
      endDate: t.dueDate,
      percentComplete: null,
      ownerUserId: t.designerUserId ?? t.projectDeveloperUserId ?? null,
      ownerName: t.designerName ?? t.projectDeveloperName ?? null,
    }));
  const allItems: ProjectTask[] = [...ticketsAsTasks, ...tasks];

  // Kanban swimlanes by status. Items keep their phase as a small chip
  // on each card so engineers can still see which phase each task belongs
  // to without losing the at-a-glance "where is each item" board view.
  const lanes: Array<{ key: string; label: string; match: (s: string) => boolean }> = [
    { key: "todo", label: "To do", match: (s) => isTodoStatus(s) },
    { key: "in_progress", label: "In progress", match: (s) => isInProgressStatus(s) },
    { key: "blocked", label: "Blocked", match: (s) => isBlockedStatus(s) },
    { key: "done", label: "Done", match: (s) => isDoneStatus(s) || isCancelledStatus(s) },
  ];
  const itemsByLane = new Map<string, ProjectTask[]>();
  for (const lane of lanes) itemsByLane.set(lane.key, []);
  for (const it of allItems) {
    const lane = lanes.find((l) => l.match(it.status))?.key ?? "todo";
    itemsByLane.get(lane)!.push(it);
  }
  const total = allItems.length;
  const done = allItems.filter((t) => isDoneStatus(t.status)).length;

  return (
    <div className="space-y-1.5" data-testid="section-project-board">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1.5">
          Board
          {projectName && (
            <span className="text-[10px] font-normal text-muted-foreground normal-case">
              · {projectName}
            </span>
          )}
        </h4>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {done}/{total} done
        </span>
      </div>
      {total === 0 ? (
        <p className="text-[11px] text-muted-foreground italic" data-testid="empty-project-board">
          No engineering tasks on the project yet — spawn tasks from a ticket to populate the board.
        </p>
      ) : (
        <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-4" data-testid="project-board">
          {lanes.map((lane) => {
            const items = itemsByLane.get(lane.key) ?? [];
            return (
              <div
                key={lane.key}
                className="rounded border border-slate-200 bg-slate-50/50 p-1.5 min-h-[60px]"
                data-testid={`project-board-lane-${lane.key}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 truncate" title={lane.label}>
                    {lane.label}
                  </span>
                  <span className="text-[9px] tabular-nums text-muted-foreground">{items.length}</span>
                </div>
                <ul className="space-y-1">
                  {items.length === 0 ? (
                    <li className="text-[9px] italic text-muted-foreground">—</li>
                  ) : (
                    items.map((it) => {
                      const ticketLabel = it.pdTicketId != null ? ticketLabelById.get(it.pdTicketId) ?? null : null;
                      const phase = it.phase?.trim() || null;
                      return (
                        <li
                          key={it.id}
                          className="rounded border border-slate-200 bg-white px-1 py-1 space-y-0.5"
                          data-testid={`project-board-task-${it.id}`}
                        >
                          <div className="flex items-center gap-1">
                            <span
                              className={`inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${workItemStatusDot(it.status)}`}
                              title={it.status}
                            />
                            <span className="flex-1 text-[10px] text-foreground truncate" title={it.title}>{it.title}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            {phase && (
                              <span
                                className="text-[9px] px-1 rounded bg-slate-100 text-slate-700 truncate max-w-[80px]"
                                title={`Phase: ${phase}`}
                              >
                                {phase}
                              </span>
                            )}
                            {ticketLabel && phase !== ticketLabel && (
                              <span
                                className="text-[9px] px-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 truncate max-w-[80px]"
                                title={`From ticket: ${ticketLabel}`}
                              >
                                {ticketLabel}
                              </span>
                            )}
                            <span
                              className={`ml-auto text-[9px] truncate max-w-[80px] ${it.ownerName ? "text-slate-600" : "italic text-muted-foreground"}`}
                              title={it.ownerName ? `Assigned to ${it.ownerName}` : "Unassigned"}
                            >
                              {it.ownerName ?? "—"}
                            </span>
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isTodoStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "not_started" || s === "draft" || s === "todo" || s === "to_do" || s === "open";
}

function isInProgressStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "in_progress" || s === "in progress" || s === "doing" || s === "started";
}

function isBlockedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "blocked" || s === "on_hold" || s === "on hold" || s === "waiting";
}

function isCancelledStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "cancelled" || s === "canceled";
}

/** Map a pd_ticket status onto the work_item status vocabulary so the
 *  status-dot helpers below treat ticket items consistently with tasks. */
function ticketStatusToWorkItemStatus(status: string): string {
  switch (status) {
    case "Completed":
      return "done";
    case "Cancelled":
      return "cancelled";
    case "In Progress":
      return "in_progress";
    case "On Hold":
      return "on_hold";
    default:
      return "not_started";
  }
}

function isDoneStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "done" || s === "completed" || s === "complete" || s === "closed";
}

function workItemStatusDot(status: string): string {
  const s = status.toLowerCase();
  if (s === "done" || s === "completed" || s === "complete" || s === "closed") return "bg-emerald-500";
  if (s === "in_progress" || s === "in progress") return "bg-blue-500";
  if (s === "blocked" || s === "on_hold" || s === "on hold") return "bg-amber-500";
  if (s === "cancelled" || s === "canceled") return "bg-slate-400";
  return "bg-slate-300";
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
