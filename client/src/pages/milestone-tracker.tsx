import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  format, addMonths, subMonths, isSameMonth, isToday,
} from "date-fns";
import {
  ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, CheckCircle2,
  ChevronLeft, ChevronRight, ListChecks, X,
} from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { apiRequest } from "@/lib/queryClient";
import { fmtDate, parseExecDate } from "@/lib/execution-types";
import {
  type MilestoneProgram, type ProjectMilestoneDetail, type MilestoneView,
  type LinkedTaskView, type CalendarEvent, type FlowState, type TaskState,
  money, FLOW_STATE_STYLE, TASK_STATE_STYLE,
} from "@/lib/milestone-tracker-types";

// ──────────────────────────────── badges ─────────────────────────────────────

function FlowBadge({ state }: { state: FlowState }) {
  const s = FLOW_STATE_STYLE[state];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  );
}
function TaskBadge({ state }: { state: TaskState }) {
  const s = TASK_STATE_STYLE[state];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  );
}
function GapBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 text-amber-700 px-1.5 py-0.5 text-[11px] font-medium">
      <AlertTriangle className="w-3 h-3" />{label}
    </span>
  );
}
function Kpi({ label, value, tone, accent }: { label: string; value: string | number; tone?: string; accent?: string }) {
  return (
    <Card className="relative overflow-hidden">
      {accent && <span className={`absolute left-0 top-0 h-full w-1 ${accent}`} aria-hidden />}
      <CardContent className="p-3 pl-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────── calendar ───────────────────────────────────

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function eventStyle(e: CalendarEvent) {
  return e.kind === "task" ? TASK_STATE_STYLE[e.state as TaskState] : FLOW_STATE_STYLE[e.state as FlowState];
}

function MonthCalendar({ events, onOpenProject, showProject }: { events: CalendarEvent[]; onOpenProject?: (id: number) => void; showProject?: boolean }) {
  const [month, setMonth] = useState(() => {
    // Land on the first month that has an event, else today.
    const first = [...events].sort((a, b) => a.date.localeCompare(b.date))[0];
    return first ? new Date(first.date) : new Date();
  });
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) { const arr = m.get(e.date) ?? []; arr.push(e); m.set(e.date, arr); }
    return m;
  }, [events]);
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  return (
    <Card><CardContent className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">{format(month, "MMMM yyyy")}</div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setMonth((m) => subMonths(m, 1))} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMonth(new Date())}>Today</Button>
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month"><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => <div key={d} className="text-[10px] font-medium text-muted-foreground text-center py-1">{d}</div>)}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = byDay.get(key) ?? [];
          const muted = !isSameMonth(day, month);
          return (
            <div key={key} className={`min-h-[78px] rounded border p-1 ${muted ? "bg-muted/20 border-transparent" : "border-border/60"} ${isToday(day) ? "ring-1 ring-emerald-400" : ""}`}>
              <div className={`text-[10px] mb-0.5 ${muted ? "text-muted-foreground/50" : "text-muted-foreground"}`}>{format(day, "d")}</div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((e, i) => {
                  const st = eventStyle(e);
                  return (
                    <button
                      key={i}
                      className={`w-full truncate rounded px-1 py-0.5 text-[10px] border flex items-center gap-1 ${st.cls} ${onOpenProject ? "hover:opacity-80" : "cursor-default"}`}
                      title={`${showProject ? e.projectName + " · " : ""}${e.label}${e.amount != null ? " · " + money(e.amount) : ""}`}
                      onClick={() => onOpenProject?.(e.projectId)}
                      data-testid="calendar-event"
                    >
                      {e.kind === "inflow" ? <TrendingUp className="w-2.5 h-2.5 shrink-0" /> : e.kind === "outflow" ? <TrendingDown className="w-2.5 h-2.5 shrink-0" /> : <ListChecks className="w-2.5 h-2.5 shrink-0" />}
                      <span className="truncate">{e.amount != null ? money(e.amount) : e.label}</span>
                    </button>
                  );
                })}
                {dayEvents.length > 3 && <div className="text-[9px] text-muted-foreground pl-1">+{dayEvents.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-600" /> Inflow (payment)</span>
        <span className="inline-flex items-center gap-1"><TrendingDown className="w-3 h-3 text-red-600" /> Outflow (cost)</span>
        <span className="inline-flex items-center gap-1"><ListChecks className="w-3 h-3" /> Task due</span>
      </div>
    </CardContent></Card>
  );
}

// ──────────────────────────────── milestone card ─────────────────────────────

interface LinkHandlers {
  onLinkTask: (revenueRowHash: string, workItemId: number) => void;
  onUnlinkTask: (revenueRowHash: string, workItemId: number) => void;
  onLinkCost: (workItemId: number, costRowHash: string) => void;
  onUnlinkCost: (workItemId: number, costRowHash: string) => void;
}

function TaskRow({ m, t, detail, h }: { m: MilestoneView; t: LinkedTaskView; detail: ProjectMilestoneDetail; h: LinkHandlers }) {
  const linkedCostHashes = new Set(t.outflows.map((o) => o.rowHash));
  const costOptions = detail.availableCostLines
    .filter((c) => !linkedCostHashes.has(c.rowHash))
    .map((c) => ({ value: c.rowHash, label: `${c.description || c.costCategory || "Cost"} · ${money(c.amount)}` }));
  return (
    <div className="rounded-md border border-border/60 p-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <TaskBadge state={t.state} />
        <span className="text-xs font-medium truncate">{t.taskNo ? `${t.taskNo} · ` : ""}{t.title}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{t.percentComplete == null ? "" : `${Math.round(t.percentComplete)}%`}</span>
        {t.endDate && <span className="text-[11px] text-muted-foreground">due {fmtDate(t.endDate)}</span>}
        <Button size="icon" variant="ghost" className="h-6 w-6 ml-auto" onClick={() => h.onUnlinkTask(m.rowHash, t.id)} aria-label="Unlink task" data-testid={`unlink-task-${t.id}`}>
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
      </div>
      {/* outflows linked to this task */}
      <div className="pl-1 space-y-1">
        {t.outflows.map((o) => (
          <div key={o.rowHash} className="flex items-center gap-2 text-[11px]">
            <TrendingDown className="w-3 h-3 text-red-500 shrink-0" />
            <span className="truncate">{o.description || o.costCategory || "Cost"}</span>
            <span className="tabular-nums text-muted-foreground">{money(o.amount)}</span>
            <FlowBadge state={o.state} />
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => h.onUnlinkCost(t.id, o.rowHash)} aria-label="Unlink cost" data-testid={`unlink-cost-${t.id}-${o.rowHash}`}>
              <X className="w-3 h-3 text-muted-foreground" />
            </Button>
          </div>
        ))}
        {t.noOutflow && <GapBadge label="No outflow linked" />}
        <div className="pt-0.5">
          <SearchableSelect
            value=""
            onValueChange={(v) => { if (v) h.onLinkCost(t.id, v); }}
            placeholder="+ Link outflow cost line…"
            triggerClassName="h-7 text-xs"
            data-testid={`link-cost-${t.id}`}
            options={costOptions}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Per-milestone money KPI: GP = connected inflow − connected outflows, plus the
 * payment-timing gap. Timing is the amount-weighted average outflow payment
 * date minus the inflow payment date, in days: a PLUS means the inflow lands
 * first (cash-positive), a MINUS means the outflows are paid before the inflow
 * (you fund the work first).
 */
function MilestoneGp({ m }: { m: MilestoneView }) {
  const inflow = m.amount ?? 0;
  const outflow = m.outflowTotal;
  const gp = inflow - outflow;
  const gpPct = inflow > 0 ? (gp / inflow) * 100 : null;

  const timingDays = useMemo(() => {
    const inD = parseExecDate(m.expectedPaymentDate ?? m.paidDate);
    if (!inD) return null;
    let wsum = 0, dsum = 0;
    for (const o of m.outflows) {
      const d = parseExecDate(o.forecastPaymentDate ?? o.paidDate ?? o.invoiceDate);
      const amt = o.amount ?? 0;
      if (d && amt > 0) { wsum += amt; dsum += d.getTime() * amt; }
    }
    if (wsum === 0) return null;
    return Math.round((dsum / wsum - inD.getTime()) / 86_400_000);
  }, [m]);

  const outW = inflow > 0 ? Math.min(100, Math.max(0, (outflow / inflow) * 100)) : (outflow > 0 ? 100 : 0);

  return (
    <div className="rounded-md border bg-muted/20 px-2.5 py-2 space-y-1.5 text-left" data-testid={`milestone-gp-${m.rowHash}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Gross profit</span>
        <span>
          <span className={`text-sm font-semibold tabular-nums ${gp >= 0 ? "text-emerald-600" : "text-red-600"}`} data-testid={`gp-amount-${m.rowHash}`}>{money(gp)}</span>
          {gpPct != null && <span className="text-[11px] text-muted-foreground"> · {Math.round(gpPct)}%</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden flex" title={`${money(inflow)} in · ${money(outflow)} out`}>
        <div className="h-full bg-red-500" style={{ width: `${outW}%` }} />
        <div className="h-full bg-emerald-500" style={{ width: `${100 - outW}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-emerald-600">{money(inflow)} in</span>
        <span className="text-red-600">{money(outflow)} out</span>
      </div>
      {timingDays != null && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t">
          <span className="text-[11px] text-muted-foreground">Payment timing</span>
          <span
            className={`inline-flex items-baseline gap-1 text-xs font-semibold tabular-nums ${timingDays >= 0 ? "text-emerald-600" : "text-red-600"}`}
            title={timingDays >= 0 ? "Inflow lands before the outflows (cash-positive)" : "Outflows are paid before the inflow (you fund the work first)"}
            data-testid={`gp-timing-${m.rowHash}`}
          >
            {timingDays >= 0 ? `+${timingDays}d` : `${timingDays}d`}
            <span className="text-[10px] font-normal text-muted-foreground">{timingDays >= 0 ? "in first" : "out first"}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function MilestoneCard({ m, detail, h }: { m: MilestoneView; detail: ProjectMilestoneDetail; h: LinkHandlers }) {
  const linkedTaskIds = new Set(m.tasks.map((t) => t.id));
  const taskOptions = detail.availableTasks
    .filter((t) => !linkedTaskIds.has(t.id))
    .map((t) => ({ value: String(t.id), label: `${t.taskNo ? t.taskNo + " · " : ""}${t.title}` }));
  return (
    <Card data-testid={`milestone-${m.rowHash}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {m.milestoneNo ? `${m.milestoneNo}. ` : ""}{m.milestoneName || "Milestone"}
              {m.milestonePercent != null && <span className="ml-1 text-xs text-muted-foreground">({Math.round(m.milestonePercent * 100) / 100}%)</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              Expected payment {fmtDate(m.expectedPaymentDate)}{m.invoiceNumber ? ` · inv ${m.invoiceNumber}` : ""}
            </div>
          </div>
          <div className="ml-auto w-full sm:w-60 shrink-0 space-y-1.5">
            <div className="text-right text-sm font-semibold tabular-nums">{money(m.amount)}</div>
            <MilestoneGp m={m} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <FlowBadge state={m.state} />
          {m.readyToInvoice && (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 px-1.5 py-0.5 text-[11px] font-medium">
              <CheckCircle2 className="w-3 h-3" />Ready to invoice
            </span>
          )}
          {m.tasksTotal > 0 && <span className="text-[11px] text-muted-foreground">{m.tasksComplete}/{m.tasksTotal} tasks done</span>}
          {m.gaps.noTasks && <GapBadge label="No tasks linked" />}
          {m.gaps.noOutflow && !m.gaps.noTasks && <GapBadge label="No outflow coverage" />}
          {m.gaps.overdue && <GapBadge label="Payment overdue / no date" />}
        </div>

        <div className="space-y-1.5">
          {m.tasks.map((t) => <TaskRow key={t.id} m={m} t={t} detail={detail} h={h} />)}
        </div>

        <SearchableSelect
          value=""
          onValueChange={(v) => { if (v) h.onLinkTask(m.rowHash, Number(v)); }}
          placeholder="+ Link a plan task that makes this invoiceable…"
          triggerClassName="h-8 text-xs"
          data-testid={`link-task-${m.rowHash}`}
          options={taskOptions}
        />
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────── project workspace ──────────────────────────

/** Drill-down detail: the project's still-open inflow and outflow line items. */
function OpenItemsBlock({ detail }: { detail: ProjectMilestoneDetail }) {
  const openIn = detail.milestones.filter((m) => m.state !== "paid" && m.status !== "written_off");
  const openOut = detail.availableCostLines.filter((o) => o.state !== "paid");
  const inAmt = openIn.reduce((s, m) => s + (m.amount ?? 0), 0);
  const outAmt = openOut.reduce((s, o) => s + (o.amount ?? 0), 0);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3" data-testid="open-items-block">
      <Card><CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold inline-flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-emerald-600" />Open inflows to collect</span>
          <span className="text-xs text-muted-foreground tabular-nums">{openIn.length} · {money(inAmt)}</span>
        </div>
        {openIn.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">All inflows settled.</p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {openIn.map((m) => (
              <div key={m.rowHash} className="flex items-center gap-2 text-xs">
                <span className="truncate flex-1">{m.milestoneNo ? `${m.milestoneNo}. ` : ""}{m.milestoneName || "Milestone"}</span>
                <span className="text-muted-foreground whitespace-nowrap">{fmtDate(m.expectedPaymentDate)}</span>
                <span className="tabular-nums whitespace-nowrap">{money(m.amount)}</span>
                <FlowBadge state={m.state} />
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>
      <Card><CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold inline-flex items-center gap-1.5"><TrendingDown className="w-4 h-4 text-red-600" />Open outflows to pay</span>
          <span className="text-xs text-muted-foreground tabular-nums">{openOut.length} · {money(outAmt)}</span>
        </div>
        {openOut.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">All outflows paid.</p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {openOut.map((o) => (
              <div key={o.rowHash} className="flex items-center gap-2 text-xs">
                <span className="truncate flex-1">{o.description || o.costCategory || "Cost"}{o.counterpartyName ? <span className="text-muted-foreground"> · {o.counterpartyName}</span> : null}</span>
                <span className="text-muted-foreground whitespace-nowrap">{fmtDate(o.forecastPaymentDate ?? o.invoiceDate)}</span>
                <span className="tabular-nums whitespace-nowrap">{money(o.amount)}</span>
                <FlowBadge state={o.state} />
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}

function ProjectWorkspace({ projectId, onBack }: { projectId: number; onBack: () => void }) {
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "calendar">("list");
  const { data, isLoading, isError, refetch } = useQuery<ProjectMilestoneDetail>({
    queryKey: ["/api/milestone-tracker/projects", projectId],
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/milestone-tracker/projects", projectId] });
    qc.invalidateQueries({ queryKey: ["/api/milestone-tracker/program"] });
  };

  const linkTask = useApiMutation({
    mutationFn: async (v: { revenueRowHash: string; workItemId: number }) => {
      await apiRequest("POST", "/api/milestone-tracker/milestone-task-links", { projectId, ...v });
    },
    successToast: "Task linked", errorToast: "Could not link task", onSuccess: invalidate,
  });
  const unlinkTask = useApiMutation({
    mutationFn: async (v: { revenueRowHash: string; workItemId: number }) => {
      await apiRequest("DELETE", "/api/milestone-tracker/milestone-task-links", { projectId, ...v });
    },
    successToast: "Task unlinked", errorToast: "Could not unlink task", onSuccess: invalidate,
  });
  const linkCost = useApiMutation({
    mutationFn: async (v: { workItemId: number; costRowHash: string }) => {
      await apiRequest("POST", "/api/milestone-tracker/task-cost-links", { projectId, ...v });
    },
    successToast: "Outflow linked", errorToast: "Could not link outflow", onSuccess: invalidate,
  });
  const unlinkCost = useApiMutation({
    mutationFn: async (v: { workItemId: number; costRowHash: string }) => {
      await apiRequest("DELETE", "/api/milestone-tracker/task-cost-links", { projectId, ...v });
    },
    successToast: "Outflow unlinked", errorToast: "Could not unlink outflow", onSuccess: invalidate,
  });

  const handlers: LinkHandlers = {
    onLinkTask: (revenueRowHash, workItemId) => linkTask.mutate({ revenueRowHash, workItemId }),
    onUnlinkTask: (revenueRowHash, workItemId) => unlinkTask.mutate({ revenueRowHash, workItemId }),
    onLinkCost: (workItemId, costRowHash) => linkCost.mutate({ workItemId, costRowHash }),
    onUnlinkCost: (workItemId, costRowHash) => unlinkCost.mutate({ workItemId, costRowHash }),
  };

  return (
    <PageShell className="max-w-5xl p-4 md:p-6" data-testid="milestone-project-workspace">
      <Button variant="ghost" size="sm" className="mb-2 -ml-2 gap-1" onClick={onBack} data-testid="milestone-back">
        <ArrowLeft className="w-4 h-4" /> All projects
      </Button>
      <PageHeader title={data?.project.projectName ?? "Project"} subtitle="Payment milestones → the plan tasks that make them invoiceable → the outflow cost lines those tasks incur" />

      {isLoading ? (
        <div className="mt-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : isError || !data ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Could not load. <Button variant="link" onClick={() => refetch()}>Retry</Button></p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            <Kpi label="Milestones" value={data.summary.milestoneCount} accent="bg-slate-400" />
            <Kpi label="Inflow total" value={money(data.summary.inflowTotal)} accent="bg-emerald-500" />
            <Kpi label="Outstanding" value={money(data.summary.inflowOutstanding)} tone={data.summary.inflowOutstanding > 0 ? "text-amber-600" : ""} accent="bg-amber-500" />
            <Kpi label="Linked outflow" value={money(data.summary.outflowTotal)} accent="bg-red-500" />
            <Kpi label="Gaps" value={data.summary.gapCount} tone={data.summary.gapCount > 0 ? "text-amber-600" : ""} accent="bg-amber-500" />
          </div>

          <OpenItemsBlock detail={data} />

          <div className="flex items-center gap-2 mt-4">
            <Button size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")} data-testid="milestone-view-list">Milestones</Button>
            <Button size="sm" variant={view === "calendar" ? "default" : "outline"} onClick={() => setView("calendar")} data-testid="milestone-view-calendar">Calendar</Button>
            {data.summary.readyToInvoiceCount > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />{data.summary.readyToInvoiceCount} ready to invoice
              </span>
            )}
          </div>

          {view === "list" ? (
            data.milestones.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground mt-3">No payment milestones in the revenue tracker for this project.</p>
            ) : (
              <div className="space-y-3 mt-3">
                {data.milestones.map((m) => <MilestoneCard key={m.rowHash} m={m} detail={data} h={handlers} />)}
              </div>
            )
          ) : (
            <div className="mt-3"><MonthCalendar events={data.calendar} /></div>
          )}
        </>
      )}
    </PageShell>
  );
}

// ──────────────────────────────── program overview ───────────────────────────

function ProgramOverview({ onOpen }: { onOpen: (id: number) => void }) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const { data, isLoading, isError, refetch } = useQuery<MilestoneProgram>({
    queryKey: ["/api/milestone-tracker/program"],
  });

  return (
    <PageShell className="max-w-6xl p-4 md:p-6" data-testid="milestone-tracker-page">
      <PageHeader title="Milestone Tracker" subtitle="Payment milestones (from the revenue tracker) linked to the plan tasks that make them invoiceable, and the outflows those tasks incur" />

      {isLoading ? (
        <div className="mt-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : isError || !data ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Could not load. <Button variant="link" onClick={() => refetch()}>Retry</Button></p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            <Kpi label="Inflow total" value={money(data.header.inflowTotal)} accent="bg-emerald-500" />
            <Kpi label="Outstanding" value={money(data.header.inflowOutstanding)} tone={data.header.inflowOutstanding > 0 ? "text-amber-600" : ""} accent="bg-amber-500" />
            <Kpi label="Linked outflow" value={money(data.header.outflowTotal)} accent="bg-red-500" />
            <Kpi label="Ready to invoice" value={data.header.readyToInvoiceCount} tone={data.header.readyToInvoiceCount > 0 ? "text-emerald-600" : ""} accent="bg-emerald-500" />
            <Kpi label="Gaps" value={data.header.gapCount} tone={data.header.gapCount > 0 ? "text-amber-600" : ""} accent="bg-amber-500" />
          </div>

          <div className="flex items-center gap-2 mt-4">
            <Button size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")} data-testid="program-view-list">By project</Button>
            <Button size="sm" variant={view === "calendar" ? "default" : "outline"} onClick={() => setView("calendar")} data-testid="program-view-calendar">Calendar</Button>
            <span className="ml-auto text-xs text-muted-foreground">{data.rows.length} sites · {data.header.milestoneCount} milestones</span>
          </div>

          {view === "list" ? (
            <Card className="mt-3"><CardContent className="p-0 overflow-x-auto">
              {data.rows.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">No projects have revenue-tracker milestones yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground">
                    {["Site", "Milestones", "Inflow", "Open inflows", "Linked outflow", "Open outflows", "Ready", "Gaps", "Next inflow"].map((hh) => <th key={hh} className="py-2 px-3 font-medium whitespace-nowrap">{hh}</th>)}
                  </tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.projectId} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(r.projectId)} data-testid={`program-row-${r.projectId}`}>
                        <td className="py-2 px-3 font-medium">{r.projectName}</td>
                        <td className="py-2 px-3 tabular-nums">{r.linkedMilestoneCount}/{r.milestoneCount} linked</td>
                        <td className="py-2 px-3 tabular-nums whitespace-nowrap">{money(r.inflowTotal)}</td>
                        <td className="py-2 px-3 whitespace-nowrap" data-testid={`open-inflows-${r.projectId}`}>
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`tabular-nums font-medium ${r.openInflowCount > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{r.openInflowCount}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{money(r.openInflowAmount)}</span>
                          </span>
                        </td>
                        <td className="py-2 px-3 tabular-nums whitespace-nowrap">{money(r.outflowTotal)}</td>
                        <td className="py-2 px-3 whitespace-nowrap" data-testid={`open-outflows-${r.projectId}`}>
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`tabular-nums font-medium ${r.openOutflowCount > 0 ? "text-red-600" : "text-muted-foreground"}`}>{r.openOutflowCount}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{money(r.openOutflowAmount)}</span>
                          </span>
                        </td>
                        <td className="py-2 px-3 tabular-nums">{r.readyToInvoiceCount > 0 ? <span className="text-emerald-600">{r.readyToInvoiceCount}</span> : "—"}</td>
                        <td className="py-2 px-3">{r.gapCount > 0 ? <GapBadge label={String(r.gapCount)} /> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-2 px-3 whitespace-nowrap">{fmtDate(r.nextInflowDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent></Card>
          ) : (
            <div className="mt-3"><MonthCalendar events={data.calendar} onOpenProject={onOpen} showProject /></div>
          )}
        </>
      )}
    </PageShell>
  );
}

// ──────────────────────────────── page ───────────────────────────────────────

export default function MilestoneTrackerPage() {
  const [selected, setSelected] = useState<number | null>(null);
  return selected == null
    ? <ProgramOverview onOpen={setSelected} />
    : <ProjectWorkspace projectId={selected} onBack={() => setSelected(null)} />;
}
