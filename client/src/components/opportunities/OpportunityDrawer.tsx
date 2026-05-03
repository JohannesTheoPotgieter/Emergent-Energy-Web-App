/**
 * Unified Opportunity drawer (2026-04-20; slimmed 2026-04-24, task #76;
 * no-shadow render contract hardened 2026-04-24, task #83).
 *
 * Replaces the legacy "Engineering ticket detail" page (formerly
 * called "PD Ticket detail"; vocabulary retired in task #56). Treats
 * a Pipedrive opportunity + its shadow `pd_tickets` row as a single
 * user-facing record. The drawer is now read-only at the body level —
 * it renders three stacked sections, in this order:
 *   - CRM details (blue 🔵): read-only — Pipedrive sync owns these.
 *   - Activity: last/next CRM activity + a preview of the most
 *     recent PD comment (sourced from `pd.comments` on the workflow
 *     payload; no edit affordance).
 *   - Tickets: engineering tickets attached to the opportunity, plus
 *     the project-level Kanban board when at least one ticket has
 *     been linked to a project.
 * A "Convert-to-Project" wizard still lives below the three sections
 * for opportunities that aren't yet linked to a project.
 *
 * The previously-editable "Internal readiness" block (request type /
 * priority / status / due-date selects, the technical-readiness
 * checklist, and the PD comments textarea) was removed in task #76.
 * The underlying columns and the PATCH /api/opportunities/:id/pd
 * endpoint remain in the schema/server for other surfaces that may
 * still write them; the drawer simply no longer exposes them.
 *
 * No-shadow render contract (task #83):
 *   `GET /api/opportunities/:id/workflow` returns `pd: null` when the
 *   opportunity has no engineering shadow ticket yet (auto-spawn was
 *   removed 2026-04-23 — tickets are only created by an explicit user
 *   action). The drawer MUST render successfully in that case: only
 *   the data-load failure (`isError || !data`) shows the "Could not
 *   load opportunity" fallback. Every reference to the `merged` PD
 *   block below is null-safe; when `merged == null` the header status
 *   badge degrades to "No engineering ticket", margin renders "—",
 *   the PD-note row is hidden, and the empty-tickets section shows
 *   the standard "no PD tickets yet" copy with the convert CTA below.
 *
 * Backed by:
 *   GET  /api/opportunities/:id/workflow   (read-only; pd may be null)
 *   POST /api/opportunities/:id/convert-to-project
 *
 * NOTE: the legacy POST /api/opportunities/:id/spawn-tasks endpoint
 * was retired in the Path 2 engineering-ticket consolidation. The
 * sibling work_items row is created in lock-step with the engineering
 * ticket itself by POST /api/opportunities/:id/engineering-tickets.
 */
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getEngineeringTicketStatusLabel,
  getEngineeringTicketStatusBadgeClass,
  normalizeEngineeringTicketStatus,
  isTicketDoneForReporting,
  isTicketBlocked,
} from "@shared/engineering-ticket-status";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, Lock, Sparkles, Zap, ArrowRight, CheckCircle2, Building2, Inbox } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { invalidateEngineeringTicketCaches } from "@/lib/task-cache";
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
  /** `null` when no engineering shadow ticket exists yet — see the
   *  no-shadow render contract in the file-header docblock (Task #83). */
  pd: PdBlock | null;
  tasks: Array<{ id: number; title: string; status: string; priority: string | null; endDate: string | null }>;
  tickets?: OpportunityTicket[];
  projectTasks?: ProjectTask[];
}

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
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0" data-testid="opportunity-drawer">
        <OpportunityDetailBody opportunityId={opportunityId} active={open} variant="drawer" />
      </SheetContent>
    </Sheet>
  );
}

interface DetailBodyProps {
  opportunityId: number | null;
  /** Whether the body should fetch / be shown. In the inline panel,
   *  callers pass `active={opportunityId != null}` so the query only
   *  runs when something is selected. */
  active: boolean;
  /** "drawer" adds inner padding to fit a SheetContent; "inline" omits
   *  outer padding so the host can control its own gutters. */
  variant?: "drawer" | "inline";
}

export function OpportunityDetailBody({ opportunityId, active, variant = "inline" }: DetailBodyProps) {
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
    enabled: active && opportunityId != null,
    staleTime: 30_000,
  });

  useEffect(() => {
    setConvertOpen(false);
  }, [opportunityId]);

  // Path 2: template task-spawn is retired. Engineering work is created
  // by the user via the "Add Engineering Ticket" form (canonical sibling
  // work_items row inserted in the same transaction) or via per-ticket
  // "Add task" actions on the engineering board.

  // Drawer is read-only after the 2026-04-24 simplification — the
  // editable "Internal readiness" section was removed (task #76), so
  // `merged` is now just the server's PD snapshot. We keep the alias
  // so the surrounding sections (header badges, activity preview,
  // project-linked card, tickets fallback) read identically to before.
  const merged = data ? data.pd : null;
  const isPipedrive = data?.crm.source === "pipedrive";
  const daysInStage = daysBetween(data?.crm.pipedriveStageChangedAt ?? data?.crm.pipedriveUpdatedAt ?? null);

  const wrapperClass =
    variant === "drawer"
      ? "p-4 sm:p-5 space-y-4"
      : "space-y-4";

  if (!active || opportunityId == null) {
    return (
      <div
        className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center"
        data-testid="opportunity-detail-empty"
      >
        <Inbox className="h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-700">Select an opportunity</p>
        <p className="mt-1 max-w-xs text-xs text-slate-500">
          Pick a deal from the list on the left to see its CRM details, recent activity, and engineering tickets.
        </p>
      </div>
    );
  }

  return (
    <div className={wrapperClass} data-testid={variant === "drawer" ? undefined : "opportunity-detail-panel"}>
      {isLoading ? (
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
        </div>
      ) : isError || !data ? (
        // Task #83: only a true data-load failure shows this fallback.
        // `merged == null` (no engineering shadow ticket yet) is a
        // valid, expected state — every reference below is null-safe.
        <div className="p-6 text-sm text-muted-foreground" data-testid="opportunity-detail-error">Could not load opportunity.</div>
      ) : (
        <>
          {/* === Header card === */}
          <header
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            data-testid="section-detail-header"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Opportunity #{data.crm.id}
                  {isPipedrive && data.crm.pipedriveDealId && (
                    <span className="ml-2 text-slate-400">· Pipedrive #{data.crm.pipedriveDealId}</span>
                  )}
                </p>
                <h2
                  className="mt-0.5 text-base font-semibold text-slate-900 truncate"
                  data-testid="text-opportunity-name"
                  title={data.crm.dealName || data.clientName || `Opportunity #${data.crm.id}`}
                >
                  {data.crm.dealName || data.clientName || `Opportunity #${data.crm.id}`}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 flex items-center gap-1.5 truncate">
                  <Building2 className="h-3 w-3 text-slate-400 shrink-0" />
                  <span className="truncate">{data.clientName || "No client"}</span>
                  {data.siteName && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="truncate">{data.siteName}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 justify-end">
                {isPipedrive && (
                  <Badge variant="outline" className="text-[10px] border-sky-200 bg-sky-50 text-sky-700">
                    Pipedrive
                  </Badge>
                )}
                {merged ? (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${getEngineeringTicketStatusBadgeClass(merged.status)}`}
                    data-testid="badge-engineering-status"
                  >
                    {getEngineeringTicketStatusLabel(merged.status)}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-slate-200 bg-slate-50 text-slate-600"
                    data-testid="badge-no-engineering-ticket"
                    title="No engineering shadow ticket has been created for this opportunity yet."
                  >
                    No engineering ticket
                  </Badge>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4 text-xs">
              <HeaderStat label="Value" value={fmtMoney(data.crm.estimatedValue, data.crm.currency)} />
              <HeaderStat label="Margin" value={merged?.estimatedMarginPercent ? `${merged.estimatedMarginPercent}%` : "—"} />
              <HeaderStat label="Owner" value={data.crm.dealOwnerName} />
              <HeaderStat label="CRM stage" value={data.crm.stage} />
            </div>
          </header>

          <div className="space-y-4">
              {/* === CRM block (read-only) === */}
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="section-crm">
                <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
                    <Lock className="h-3 w-3 text-sky-600" /> CRM details
                    <span className="font-normal normal-case text-[10px] text-slate-400">· Pipedrive (read-only)</span>
                  </h3>
                  {data.crm.pipedriveUpdatedAt && (
                    <span className="text-[10px] text-slate-500">
                      synced {fmtDate(data.crm.pipedriveUpdatedAt)}
                    </span>
                  )}
                </header>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs p-4">
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

              {/* === Activity card (presentation of CRM activity + PD comments preview) === */}
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="section-activity">
                <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-emerald-600" /> Activity
                  </h3>
                </header>
                <div className="p-4 space-y-2.5 text-xs">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-sky-100 text-sky-700 grid place-items-center text-[10px] font-semibold">
                      P
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-700">
                        <span className="font-medium text-slate-900">Last activity</span>
                        <span className="text-slate-500"> · {fmtDate(data.crm.lastActivityDate)}</span>
                      </p>
                      <p className="text-slate-500 truncate">
                        Pipedrive sync · {data.crm.dealOwnerName || "Deal owner"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-[10px] font-semibold">
                      N
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-700">
                        <span className="font-medium text-slate-900">Next activity</span>
                        <span className="text-slate-500"> · {fmtDate(data.crm.nextActivityDate)}</span>
                      </p>
                      <p className="text-slate-500 truncate" title={data.crm.nextActivitySubject ?? ""}>
                        {data.crm.nextActivitySubject || "No follow-up scheduled in Pipedrive"}
                      </p>
                    </div>
                  </div>
                  {merged && (merged.comments ?? "").trim() && (
                    <div className="flex items-start gap-2 border-t border-slate-100 pt-2.5">
                      <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-slate-100 text-slate-700 grid place-items-center text-[10px] font-semibold">
                        PD
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">PD note</p>
                        <p className="text-slate-600 line-clamp-3 whitespace-pre-wrap">{merged.comments}</p>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* === Engineering task board / Tickets === */}
              {(data.tickets ?? []).length > 0 ? (
                <section className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="section-engineering-task-board">
                  <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
                      <Zap className="h-3 w-3 text-emerald-600" /> Tickets
                    </h3>
                  </header>
                  <div className="p-4 space-y-3">
                    <EngineeringTicketsSection tickets={data.tickets ?? []} opportunityId={opportunityId} />
                    {(data.tickets ?? []).some((t) => t.projectId) && (
                      <ProjectTaskBoard
                        tasks={data.projectTasks ?? []}
                        tickets={data.tickets ?? []}
                        projectName={(data.tickets ?? []).find((t) => t.projectName)?.projectName ?? null}
                      />
                    )}
                  </div>
                </section>
              ) : (
                <section className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="section-tasks">
                  <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
                      <Zap className="h-3 w-3 text-emerald-600" /> Tickets
                    </h3>
                    {/* Path 2: the "Spawn from template" button is retired —
                        see comment by the deleted `spawnTasks` mutation. */}
                  </header>
                  <div className="p-4 space-y-2">
                  {!merged?.projectId ? (
                    <p className="text-[11px] text-muted-foreground italic" data-testid="text-no-pd-tickets-yet">No PD tickets yet — create one from the working list, or convert this opportunity to a project first.</p>
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
                  </div>
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
                      className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 flex items-center justify-between gap-3 shadow-sm"
                      data-testid="section-project-linked"
                    >
                      <div className="text-xs flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-emerald-900">Project linked</p>
                          <p className="text-emerald-800/80 truncate">This opportunity has a working project — no need to convert again.</p>
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
                // Recognize when the engineering intake ticket is already
                // engaged (status moved off Draft, or a request type / due
                // date / comments have been filled in). In that case the
                // "Ready to start the project?" framing is misleading —
                // work has begun, we just haven't materialized a project
                // shell yet. Reframe the CTA around the existing ticket.
                // "Engaged" = anything past the initial to-do/draft state and
                // not yet terminal. Uses the canonical normaliser so legacy
                // values still classify correctly during the transition.
                const activeTicket = (data.tickets ?? []).find((t) => {
                  const c = normalizeEngineeringTicketStatus(t.status);
                  return c !== "to_do" && c !== "not_started" && !isTicketDoneForReporting(t.status);
                });
                if (activeTicket) {
                  return (
                    <section
                      className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 flex items-center justify-between gap-3 shadow-sm"
                      data-testid="section-convert-from-ticket"
                    >
                      <div className="text-xs min-w-0">
                        <p className="font-medium text-emerald-900">
                          PD ticket in progress — no project shell yet
                        </p>
                        <p className="text-emerald-800/80">
                          Materialize a project from "{activeTicket.requestType}" so this ticket's tasks
                          have a home and the team can track progress on a project page.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => setConvertOpen(true)}
                        data-testid="btn-open-convert-wizard"
                      >
                        Create project from ticket <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </section>
                  );
                }
                return (
                  <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 flex items-center justify-between gap-3 shadow-sm" data-testid="section-convert-cta">
                    <div className="text-xs min-w-0">
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
                defaultStage={(data.crm.stage as any) || "won"}
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
    </div>
  );
}

// --- Tiny helpers ---

function HeaderStat({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-xs font-semibold text-slate-800" title={value ?? ""}>
        {value && value.trim() ? value : "—"}
      </p>
    </div>
  );
}

function SectionCard({
  title,
  icon,
  testId,
  rightSlot,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  testId?: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
      data-testid={testId}
    >
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
          {icon}
          {title}
        </h3>
        {rightSlot}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

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
function EngineeringTicketsSection({
  tickets,
  opportunityId,
}: {
  tickets: OpportunityTicket[];
  opportunityId: number | null;
}) {
  const open = tickets.filter((t) => !isTicketDoneForReporting(t.status)).length;
  const closed = tickets.length - open;
  // Resolve the canonical sibling project for this opportunity. When any
  // ticket on the opp is already linked to a working project, that same
  // project is the natural target for the opp's *other* unlinked tickets
  // — they all belong to the same physical site and engineering effort.
  // We surface a one-click "Link to <project>" affordance on each
  // unlinked ticket so users don't need to navigate elsewhere.
  const siblingProject = tickets.find((t) => t.projectId && t.projectName)
    ? {
        id: tickets.find((t) => t.projectId && t.projectName)!.projectId!,
        name: tickets.find((t) => t.projectId && t.projectName)!.projectName!,
      }
    : null;
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
          <TicketRow
            key={t.id}
            ticket={t}
            siblingProject={siblingProject}
            opportunityId={opportunityId}
          />
        ))}
      </ul>
    </div>
  );
}

function ticketStatusClass(status: string): string {
  // Delegate to the shared canonical-status helper so badge colours stay
  // consistent with the engineering board.
  return getEngineeringTicketStatusBadgeClass(status);
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

function TicketRow({
  ticket,
  siblingProject,
  opportunityId,
}: {
  ticket: OpportunityTicket;
  siblingProject: { id: number; name: string } | null;
  opportunityId: number | null;
}) {
  const queryClient = useQueryClient();
  const linkToProject = useMutation({
    mutationFn: async (projectId: number) => {
      const res = await apiRequest("PATCH", `/api/pd/tickets/${ticket.id}`, { projectId });
      return res.json();
    },
    onSuccess: () => {
      // Linking the ticket changes its project assignment, which the
      // Engineering Board / Standup / Plan tab all read. Use the
      // engineering-scoped invalidator so every consumer surface picks
      // up the new project link without requiring a full task-cache
      // sweep.
      invalidateEngineeringTicketCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities/working"] });
    },
  });
  const canOfferSiblingLink =
    !ticket.projectId && siblingProject != null && siblingProject.id !== ticket.projectId;
  const isClosed = isTicketDoneForReporting(ticket.status);
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
        ) : canOfferSiblingLink ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="italic">Not yet linked to a project</span>
            <button
              type="button"
              disabled={linkToProject.isPending}
              onClick={() => linkToProject.mutate(siblingProject!.id)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 text-[10px] font-medium"
              data-testid={`btn-link-ticket-to-project-${ticket.id}`}
              title={`Link this ticket to the same project as the sibling ticket: ${siblingProject!.name}`}
            >
              {linkToProject.isPending ? "Linking…" : `Link to ${siblingProject!.name}`}
              {!linkToProject.isPending && <ArrowRight className="h-2.5 w-2.5" />}
            </button>
          </span>
        ) : (
          <span className="italic">Not yet linked to a project</span>
        )}
        {ticket.tasksSpawnedAt && <span className="text-emerald-700">Tasks spawned</span>}
      </div>
      {linkToProject.isError && (
        <p className="mt-1 text-[10px] text-red-700" data-testid={`error-link-ticket-${ticket.id}`}>
          Failed to link to project. Please try again.
        </p>
      )}
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

  // Path 2 (Task: opportunity-drawer phantom duplicate fix):
  //   The drawer USED to synthesise a "Ticket: <requestType>" board card
  //   for every engineering ticket and union it with the project's
  //   work_items list — which produced two cards per ticket (the
  //   synthetic one AND its sibling work_items row inserted by the
  //   "Add Engineering Ticket" form). work_items is now canonical for
  //   engineering execution, so we render the sibling rows directly
  //   from `tasks` (already scoped server-side to ENG-lane rows linked
  //   to a ticket on this project).
  const allItems: ProjectTask[] = tasks;

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
          No engineering tasks on the project yet — add an engineering ticket above, or use "Add task" on the engineering board.
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

// Path 2: `ticketStatusToWorkItemStatus` was removed alongside the
// synthetic ticket-promoted board cards — work_items now carry their own
// canonical status, so no translation is needed.

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
  opportunityId, defaultName, clientId, defaultStage, onClose, onConverted,
}: {
  opportunityId: number;
  defaultName: string;
  clientId: number | null;
  defaultStage?: string;
  onClose: () => void;
  onConverted: () => void;
}) {
  const STAGE_OPTIONS = ["prospect", "qualification", "proposal", "negotiation", "won", "lost"] as const;
  const [projectName, setProjectName] = useState(defaultName);
  const [sizeKwp, setSizeKwp] = useState("");
  const [stage, setStage] = useState<string>(
    defaultStage && (STAGE_OPTIONS as readonly string[]).includes(defaultStage) ? defaultStage : "won",
  );

  const convert = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/opportunities/${opportunityId}/convert-to-project`, {
        projectName,
        clientId,
        sizeKwp: sizeKwp ? Number(sizeKwp) : null,
        stage,
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
        <Field label="Set CRM stage to">
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="h-9 text-sm w-full rounded-md border border-input bg-background px-2"
            data-testid="select-convert-stage"
          >
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
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
