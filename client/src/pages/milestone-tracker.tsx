import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, CheckCircle2,
  X, Download,
} from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { apiRequest } from "@/lib/queryClient";
import { fmtDate, parseExecDate } from "@/lib/execution-types";
import { useTableSort, SortHeader, downloadCsv } from "@/lib/table-utils";
import { PhaseMultiSelect, buildPhaseOptions, canonicalPhaseLabel, phaseInScope } from "@/components/execution/phase-filter";
import {
  type MilestoneProgram, type MilestoneProgramRow, type ProjectMilestoneDetail, type MilestoneView,
  type LinkedTaskView, type TimelineActivity, type AxisState, type FlowState, type TaskState, type ActivityTaskNode,
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

// ──────────────────────────────── timeline / scheduler ───────────────────────
//
// A built activity = an inflow milestone wired to plan task(s) (+ the outflows
// those tasks incur). The PER-PROJECT view plots each activity on a shared date
// axis (work span + money-in / money-out markers); the PROGRAM view buckets the
// same activities by money-in month so you can read, per month, whether we are
// schedule-positive (work on time) and cashflow-positive (money in before out).

const AXIS_STYLE: Record<AxisState, { cls: string; dot: string }> = {
  positive: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  negative: { cls: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  unknown: { cls: "bg-slate-50 text-slate-500 border-slate-200", dot: "bg-slate-300" },
};

function ScheduleBadge({ a }: { a: TimelineActivity }) {
  const s = AXIS_STYLE[a.scheduleState];
  const label = a.scheduleState === "positive" ? "On schedule"
    : a.scheduleState === "negative" ? `Behind · ${a.overdueTaskCount} late`
    : "No dates";
  return (
    <span title="Schedule: are the linked tasks on time?" className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{label}
    </span>
  );
}
function CashBadge({ a }: { a: TimelineActivity }) {
  const s = AXIS_STYLE[a.cashflowState];
  const label = a.cashflowDays == null ? "Cash —" : a.cashflowDays >= 0 ? `Cash +${a.cashflowDays}d` : `Cash ${a.cashflowDays}d`;
  const title = a.cashflowState === "positive" ? "Money in lands before money out (cash-positive)"
    : a.cashflowState === "negative" ? "Money out before money in (you fund the work first)"
    : "No outflow dates to compare yet";
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{label}
    </span>
  );
}

function activityDates(a: TimelineActivity): string[] {
  const ds: string[] = [];
  if (a.taskStart) ds.push(a.taskStart);
  if (a.taskEnd) ds.push(a.taskEnd);
  if (a.invoiceDate) ds.push(a.invoiceDate);
  if (a.inflow) ds.push(a.inflow.date);
  for (const o of a.outflows) ds.push(o.date);
  return ds;
}

function TimelineRow({ a, pct, todayPct, onOpenProject, showProject }: {
  a: TimelineActivity; pct: (d: string | null) => number | null; todayPct: number | null;
  onOpenProject?: (id: number) => void; showProject?: boolean;
}) {
  const s = pct(a.taskStart), e = pct(a.taskEnd);
  const barLeft = s != null && e != null ? Math.min(s, e) : null;
  const barWidth = s != null && e != null ? Math.max(Math.abs(e - s), 1.2) : null;
  const barCls = a.scheduleState === "negative" ? "bg-red-400" : a.scheduleState === "positive" ? "bg-emerald-400" : "bg-slate-300";
  const inflowPct = a.inflow ? pct(a.inflow.date) : null;
  const invPct = pct(a.invoiceDate);
  return (
    <div className="flex items-center" data-testid={`timeline-row-${a.milestoneRowHash}`}>
      <button className="w-56 shrink-0 pr-2 text-left hover:opacity-80" onClick={() => onOpenProject?.(a.projectId)}>
        <div className="text-xs font-medium truncate">{showProject ? `${a.projectName} · ` : ""}{a.title}</div>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap"><ScheduleBadge a={a} /><CashBadge a={a} /></div>
      </button>
      <div className="relative flex-1 h-10">
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/50" />
        {todayPct != null && todayPct >= 0 && todayPct <= 100 && (
          <div className="absolute top-0 bottom-0 w-px bg-emerald-400/70" style={{ left: `${todayPct}%` }} title="Today" />
        )}
        {barLeft != null && barWidth != null && (
          <div className={`absolute top-1/2 -translate-y-1/2 h-2 rounded ${barCls}`} style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
            title={`Work ${fmtDate(a.taskStart)} – ${fmtDate(a.taskEnd)} · ${a.tasksComplete}/${a.tasksTotal} done`} />
        )}
        {invPct != null && (
          <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rotate-45 border border-slate-400 bg-white"
            style={{ left: `${invPct}%` }} title={`Invoice ${fmtDate(a.invoiceDate)}`} />
        )}
        {inflowPct != null && (
          <span className="absolute top-0 -translate-x-1/2 text-emerald-600" style={{ left: `${inflowPct}%` }}
            title={`${a.inflow!.realised ? "Received" : "Money in"} ${fmtDate(a.inflow!.date)} · ${money(a.amount)}`}>
            <TrendingUp className={`w-3 h-3 ${a.inflow!.realised ? "" : "opacity-50"}`} />
          </span>
        )}
        {a.outflows.map((o, i) => {
          const op = pct(o.date);
          return op == null ? null : (
            <span key={i} className="absolute bottom-0 -translate-x-1/2 text-red-600" style={{ left: `${op}%` }}
              title={`${o.realised ? "Paid" : "Money out"} ${fmtDate(o.date)} · ${money(o.amount)}`}>
              <TrendingDown className={`w-3 h-3 ${o.realised ? "" : "opacity-50"}`} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ActivityTimeline({ activities, onOpenProject, showProject }: {
  activities: TimelineActivity[]; onOpenProject?: (id: number) => void; showProject?: boolean;
}) {
  const bounds = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const a of activities) for (const d of activityDates(a)) {
      const t = parseExecDate(d)?.getTime();
      if (t == null) continue;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    const span = Math.max(max - min, 86_400_000);
    return { min: min - span * 0.04, max: max + span * 0.04 };
  }, [activities]);

  if (activities.length === 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">No fully-built activities yet — link an inflow milestone to a plan task to see it on the timeline.</p>;
  }
  if (!bounds) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Built activities have no dates to plot yet.</p>;
  }
  const pct = (d: string | null): number | null => {
    if (!d) return null;
    const t = parseExecDate(d)?.getTime();
    if (t == null) return null;
    return ((t - bounds.min) / (bounds.max - bounds.min)) * 100;
  };
  const todayPct = pct(format(new Date(), "yyyy-MM-dd"));
  // month ticks across the axis
  const ticks: { label: string; left: number }[] = [];
  const d = new Date(bounds.min);
  d.setDate(1);
  while (d.getTime() < bounds.min) d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= bounds.max) {
    const left = pct(format(d, "yyyy-MM-dd"));
    if (left != null) ticks.push({ label: format(d, "MMM ''yy"), left });
    d.setMonth(d.getMonth() + 1);
  }

  return (
    <div className="mt-3" data-testid="activity-timeline">
      <Card><CardContent className="p-3 space-y-2">
        <div className="flex">
          <div className="w-56 shrink-0" />
          <div className="relative flex-1 h-5 border-b">
            {ticks.map((t, i) => (
              <div key={i} className="absolute top-0 -translate-x-1/2 text-[10px] text-muted-foreground whitespace-nowrap" style={{ left: `${t.left}%` }}>{t.label}</div>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          {activities.map((a) => (
            <TimelineRow key={a.projectId + a.milestoneRowHash} a={a} pct={pct} todayPct={todayPct} onOpenProject={onOpenProject} showProject={showProject} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-emerald-400" /> Work span (on schedule)</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-red-400" /> Work span (behind)</span>
          <span className="inline-flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-600" /> Money in</span>
          <span className="inline-flex items-center gap-1"><TrendingDown className="w-3 h-3 text-red-600" /> Money out</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rotate-45 border border-slate-400 bg-white" /> Invoice</span>
          <span className="text-muted-foreground/70">faded marker = forecast · solid = realised</span>
        </div>
      </CardContent></Card>
    </div>
  );
}

interface MonthBucket {
  key: string; label: string; list: TimelineActivity[];
  moneyIn: number; moneyOut: number; net: number;
  schedulePos: number; scheduleNeg: number; cashPos: number; cashNeg: number; spill: number;
}

function groupByMonth(activities: TimelineActivity[]): MonthBucket[] {
  const map = new Map<string, TimelineActivity[]>();
  for (const a of activities) {
    const k = a.inflow?.date ? a.inflow.date.slice(0, 7) : "—";
    (map.get(k) ?? map.set(k, []).get(k)!).push(a);
  }
  const keys = [...map.keys()].sort((x, y) => (x === "—" ? 1 : y === "—" ? -1 : x.localeCompare(y)));
  return keys.map((key) => {
    const list = map.get(key)!;
    let moneyIn = 0, moneyOut = 0, schedulePos = 0, scheduleNeg = 0, cashPos = 0, cashNeg = 0, spill = 0;
    for (const a of list) {
      moneyIn += a.amount ?? 0;
      moneyOut += a.outflowTotal;
      if (a.scheduleState === "positive") schedulePos++; else if (a.scheduleState === "negative") scheduleNeg++;
      if (a.cashflowState === "positive") cashPos++; else if (a.cashflowState === "negative") cashNeg++;
      const spillsWork = a.taskEnd != null && a.taskEnd.slice(0, 7) !== key;
      const spillsOut = a.outflows.some((o) => o.date.slice(0, 7) !== key);
      if (key !== "—" && (spillsWork || spillsOut)) spill++;
    }
    const label = key === "—" ? "Unscheduled" : format(parseExecDate(`${key}-01`) ?? new Date(`${key}-01`), "MMM yyyy");
    return { key, label, list, moneyIn, moneyOut, net: moneyIn - moneyOut, schedulePos, scheduleNeg, cashPos, cashNeg, spill };
  });
}

function SentChip({ kind, neg }: { kind: "schedule" | "cash"; neg: number }) {
  const ok = neg === 0;
  const s = ok ? AXIS_STYLE.positive : AXIS_STYLE.negative;
  const label = kind === "schedule" ? (ok ? "On schedule" : `${neg} behind`) : (ok ? "Cash-positive" : `${neg} cash-neg`);
  return (
    <span className={`inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{label}
    </span>
  );
}

function ProgramMonthlyOverlay({ activities, onOpen }: { activities: TimelineActivity[]; onOpen: (id: number) => void }) {
  const months = useMemo(() => groupByMonth(activities), [activities]);
  if (activities.length === 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">No fully-built activities across the program yet — link inflow milestones to plan tasks to populate the schedule.</p>;
  }
  return (
    <div className="mt-3 flex gap-3 overflow-x-auto pb-2" data-testid="program-monthly-overlay">
      {months.map((mo) => (
        <Card key={mo.key} className="w-72 shrink-0 self-start"><CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">{mo.label}</div>
            <span className="text-[11px] text-muted-foreground">{mo.list.length} activit{mo.list.length === 1 ? "y" : "ies"}</span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <SentChip kind="schedule" neg={mo.scheduleNeg} />
            <SentChip kind="cash" neg={mo.cashNeg} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <span className="text-emerald-600 tabular-nums">{money(mo.moneyIn)} in</span>
            <span className="text-red-600 tabular-nums">{money(mo.moneyOut)} out</span>
            <span className={`tabular-nums font-medium ${mo.net >= 0 ? "text-emerald-700" : "text-red-700"}`}>{mo.net >= 0 ? "+" : ""}{money(mo.net)}</span>
          </div>
          {mo.spill > 0 && (
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700" title="Activities whose work or outflows land in a different month">
              <AlertTriangle className="w-3 h-3" />{mo.spill} spill to other months
            </div>
          )}
          <div className="mt-2 space-y-1.5 max-h-96 overflow-y-auto">
            {mo.list.map((a) => (
              <button key={a.projectId + a.milestoneRowHash} onClick={() => onOpen(a.projectId)}
                className="w-full text-left rounded-md border p-2 hover:bg-muted/40" data-testid={`overlay-activity-${a.milestoneRowHash}`}>
                <div className="text-xs font-medium truncate">{a.projectName}</div>
                <div className="text-[11px] text-muted-foreground truncate">{a.title}</div>
                <div className="flex items-center gap-1 mt-1 flex-wrap"><ScheduleBadge a={a} /><CashBadge a={a} /></div>
                <div className="flex items-center justify-between text-[10px] mt-1">
                  <span className="text-emerald-600 tabular-nums">{money(a.amount)} in</span>
                  <span className="text-red-600 tabular-nums">{money(a.outflowTotal)} out</span>
                </div>
              </button>
            ))}
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}

// ──────────────────────────────── milestone card ─────────────────────────────

interface LinkHandlers {
  onLinkTask: (revenueRowHash: string, workItemId: number) => void;
  onUnlinkTask: (revenueRowHash: string, workItemId: number) => void;
  onLinkCost: (workItemId: number, costRowHash: string) => void;
  onUnlinkCost: (workItemId: number, costRowHash: string) => void;
  onLinkDep: (predecessorId: number, successorId: number) => void;
  onUnlinkDep: (predecessorId: number, successorId: number) => void;
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

/**
 * Drill-down worklist: what still needs LINKING. Activity Planning's job is to
 * wire money to work, so the two panels surface the unlinked line items —
 * inflow milestones with no plan task, and outflow cost lines incurred by no
 * task — regardless of payment status. (This is why a far-along project shows
 * far more than just its still-unpaid outflows here.)
 */
function OpenItemsBlock({ detail }: { detail: ProjectMilestoneDetail }) {
  const unlinkedIn = detail.milestones.filter((m) => m.tasks.length === 0);
  const unlinkedOut = detail.outflowItems.filter((o) => o.linkedTaskIds.length === 0);
  const inAmt = unlinkedIn.reduce((s, m) => s + (m.amount ?? 0), 0);
  const outAmt = unlinkedOut.reduce((s, o) => s + (o.amount ?? 0), 0);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3" data-testid="open-items-block">
      <Card><CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold inline-flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-emerald-600" />Inflows not linked</span>
          <span className="text-xs text-muted-foreground tabular-nums">{unlinkedIn.length} · {money(inAmt)}</span>
        </div>
        {unlinkedIn.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Every inflow milestone is linked to a task.</p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {unlinkedIn.map((m) => (
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
          <span className="text-sm font-semibold inline-flex items-center gap-1.5"><TrendingDown className="w-4 h-4 text-red-600" />Outflows not linked</span>
          <span className="text-xs text-muted-foreground tabular-nums">{unlinkedOut.length} · {money(outAmt)}</span>
        </div>
        {unlinkedOut.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Every outflow cost line is linked to a task.</p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {unlinkedOut.map((o) => (
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

// ──────────────────────────────── Project Plan tab ───────────────────────────

function PlanTaskRow({ t, detail, h }: { t: ActivityTaskNode; detail: ProjectMilestoneDetail; h: LinkHandlers }) {
  const taskByNo = new Map(detail.planTasks.map((x) => [x.id, x]));
  const predIds = new Set(t.predecessors.map((p) => p.workItemId));
  const predOptions = detail.planTasks
    .filter((o) => o.id !== t.id && !predIds.has(o.id))
    .map((o) => ({ value: String(o.id), label: `${o.taskNo ?? ""} ${o.title}`.trim() }));
  const msOptions = detail.milestones
    .filter((m) => !t.linkedMilestoneHashes.includes(m.rowHash))
    .map((m) => ({ value: m.rowHash, label: `${m.milestoneNo ?? ""} ${m.milestoneName ?? ""}`.trim() || m.rowHash }));
  const costOptions = detail.availableCostLines
    .filter((c) => !t.linkedCostHashes.includes(c.rowHash))
    .map((c) => ({ value: c.rowHash, label: `${c.description ?? c.costCategory ?? "Cost"} · ${money(c.amount)}` }));

  return (
    <Card data-testid={`plan-task-${t.id}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground tabular-nums">{t.taskNo}</span>
          <span className="font-medium text-sm">{t.title}</span>
          {t.isMilestone && <span className="text-emerald-600" title="Milestone">◆</span>}
          <TaskBadge state={t.state} />
          {t.predecessors.length > 0 && (t.predecessorsComplete
            ? <span className="text-[11px] text-emerald-700">unblocked</span>
            : <span className="inline-flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="w-3 h-3" />blocked</span>)}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {fmtDate(t.startDate)} – {fmtDate(t.endDate)} · {t.percentComplete == null ? "—" : `${Math.round(t.percentComplete)}%`}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground">Depends on:</span>
          {t.predecessors.length === 0 && <span className="text-[11px] text-muted-foreground">none</span>}
          {t.predecessors.map((p) => (
            <span key={p.workItemId}
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${p.complete ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
              {p.complete ? "✓" : "⏳"} {taskByNo.get(p.workItemId)?.taskNo ?? `#${p.workItemId}`}
              {p.source === "MANUAL"
                ? <button onClick={() => h.onUnlinkDep(p.workItemId, t.id)} className="text-muted-foreground hover:text-foreground" title="Remove dependency" data-testid={`dep-remove-${t.id}-${p.workItemId}`}>×</button>
                : <span title="From the imported plan" className="opacity-50">·</span>}
            </span>
          ))}
          <SearchableSelect value="" onValueChange={(v) => { if (v) h.onLinkDep(Number(v), t.id); }}
            placeholder="+ predecessor" triggerClassName="h-7 w-44 text-xs" options={predOptions} data-testid={`dep-add-${t.id}`} />
        </div>

        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700"><span aria-hidden>↑</span>{t.linkedMilestoneHashes.length} inflow</span>
          <SearchableSelect value="" onValueChange={(v) => { if (v) h.onLinkTask(v, t.id); }}
            placeholder="+ inflow" triggerClassName="h-7 w-40 text-xs" options={msOptions} data-testid={`task-inflow-${t.id}`} />
          <span className="inline-flex items-center gap-1 text-[11px] text-red-700 ml-2"><span aria-hidden>↓</span>{t.linkedCostHashes.length} outflow</span>
          <SearchableSelect value="" onValueChange={(v) => { if (v) h.onLinkCost(t.id, v); }}
            placeholder="+ outflow" triggerClassName="h-7 w-40 text-xs" options={costOptions} data-testid={`task-outflow-${t.id}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function PlanTab({ detail, h }: { detail: ProjectMilestoneDetail; h: LinkHandlers }) {
  if (detail.planTasks.length === 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">No plan tasks imported for this project.</p>;
  }
  return (
    <div className="space-y-2 mt-3" data-testid="plan-tab">
      {detail.planTasks.map((t) => <PlanTaskRow key={t.id} t={t} detail={detail} h={h} />)}
    </div>
  );
}

// ──────────────────────────────── Outflow line items tab ─────────────────────

function OutflowItemsTab({ detail, h }: { detail: ProjectMilestoneDetail; h: LinkHandlers }) {
  const taskById = new Map(detail.planTasks.map((t) => [t.id, t]));
  if (detail.outflowItems.length === 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">No outflow cost lines for this project.</p>;
  }
  return (
    <div className="space-y-2 mt-3" data-testid="outflow-tab">
      {detail.outflowItems.map((o) => {
        const linkedIds = new Set(o.linkedTaskIds);
        const taskOptions = detail.planTasks
          .filter((t) => !linkedIds.has(t.id))
          .map((t) => ({ value: String(t.id), label: `${t.taskNo ?? ""} ${t.title}`.trim() }));
        return (
          <Card key={o.rowHash} data-testid={`outflow-item-${o.rowHash}`}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{o.description || o.costCategory || "Cost line"}</span>
                {o.costCategory && <span className="text-[11px] text-muted-foreground">{o.costCategory}</span>}
                {o.counterpartyName && <span className="text-[11px] text-muted-foreground">· {o.counterpartyName}</span>}
                <FlowBadge state={o.state} />
                <span className="ml-auto text-sm tabular-nums">{money(o.amount)}</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-muted-foreground">Incurred by:</span>
                {o.linkedTaskIds.length === 0 && <GapBadge label="No task linked" />}
                {o.linkedTaskIds.map((tid) => (
                  <span key={tid} className="inline-flex items-center gap-1 rounded-full border bg-slate-50 border-slate-200 text-slate-600 px-1.5 py-0.5 text-[11px]">
                    {taskById.get(tid)?.taskNo ?? `#${tid}`}
                    <button onClick={() => h.onUnlinkCost(tid, o.rowHash)} className="text-muted-foreground hover:text-foreground" title="Unlink" data-testid={`outflow-unlink-${o.rowHash}-${tid}`}>×</button>
                  </span>
                ))}
                <SearchableSelect value="" onValueChange={(v) => { if (v) h.onLinkCost(Number(v), o.rowHash); }}
                  placeholder="+ link task" triggerClassName="h-7 w-44 text-xs" options={taskOptions} data-testid={`outflow-link-${o.rowHash}`} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ProjectWorkspace({ projectId, onBack }: { projectId: number; onBack: () => void }) {
  const qc = useQueryClient();
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
  const linkDep = useApiMutation({
    mutationFn: async (v: { predecessorId: number; successorId: number }) => {
      await apiRequest("POST", "/api/milestone-tracker/task-dependencies", { projectId, ...v });
    },
    successToast: "Dependency added", errorToast: "Could not add dependency", onSuccess: invalidate,
  });
  const unlinkDep = useApiMutation({
    mutationFn: async (v: { predecessorId: number; successorId: number }) => {
      await apiRequest("DELETE", "/api/milestone-tracker/task-dependencies", { projectId, ...v });
    },
    successToast: "Dependency removed", errorToast: "Could not remove dependency", onSuccess: invalidate,
  });

  const handlers: LinkHandlers = {
    onLinkTask: (revenueRowHash, workItemId) => linkTask.mutate({ revenueRowHash, workItemId }),
    onUnlinkTask: (revenueRowHash, workItemId) => unlinkTask.mutate({ revenueRowHash, workItemId }),
    onLinkCost: (workItemId, costRowHash) => linkCost.mutate({ workItemId, costRowHash }),
    onUnlinkCost: (workItemId, costRowHash) => unlinkCost.mutate({ workItemId, costRowHash }),
    onLinkDep: (predecessorId, successorId) => linkDep.mutate({ predecessorId, successorId }),
    onUnlinkDep: (predecessorId, successorId) => unlinkDep.mutate({ predecessorId, successorId }),
  };

  return (
    <PageShell className="max-w-5xl p-4 md:p-6" data-testid="milestone-project-workspace">
      <Button variant="ghost" size="sm" className="mb-2 -ml-2 gap-1" onClick={onBack} data-testid="milestone-back">
        <ArrowLeft className="w-4 h-4" /> All projects
      </Button>
      <PageHeader title={data?.project.projectName ?? "Project"} subtitle="Inflow milestones · Project Plan · Outflow line items — wire money-in to the work to money-out, and track completion + dependencies" />

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

          {data.summary.readyToInvoiceCount > 0 && (
            <div className="mt-3 inline-flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />{data.summary.readyToInvoiceCount} ready to invoice (work + dependencies complete)
            </div>
          )}

          <Tabs defaultValue="inflows" className="mt-3">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="inflows" data-testid="ap-tab-inflows">Inflow milestones</TabsTrigger>
              <TabsTrigger value="plan" data-testid="ap-tab-plan">Project Plan</TabsTrigger>
              <TabsTrigger value="outflows" data-testid="ap-tab-outflows">Outflow line items</TabsTrigger>
              <TabsTrigger value="timeline" data-testid="ap-tab-timeline">Timeline</TabsTrigger>
            </TabsList>

            <TabsContent value="inflows">
              {data.milestones.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground mt-3">No payment milestones in the revenue tracker for this project.</p>
              ) : (
                <div className="space-y-3 mt-3">
                  {data.milestones.map((m) => <MilestoneCard key={m.rowHash} m={m} detail={data} h={handlers} />)}
                </div>
              )}
            </TabsContent>

            <TabsContent value="plan"><PlanTab detail={data} h={handlers} /></TabsContent>
            <TabsContent value="outflows"><OutflowItemsTab detail={data} h={handlers} /></TabsContent>
            <TabsContent value="timeline"><ActivityTimeline activities={data.activities} /></TabsContent>
          </Tabs>
        </>
      )}
    </PageShell>
  );
}

// ──────────────────────────────── program overview ───────────────────────────

function programSortValue(r: MilestoneProgramRow, key: string): string | number | null {
  switch (key) {
    case "site": return r.projectName.toLowerCase();
    case "phase": return canonicalPhaseLabel(r.phase).toLowerCase();
    case "milestones": return r.linkedMilestoneCount;
    case "inflow": return r.inflowTotal;
    case "openIn": return r.openInflowAmount;
    case "linkedOut": return r.outflowTotal;
    case "openOut": return r.openOutflowAmount;
    case "ready": return r.readyToInvoiceCount;
    case "gaps": return r.gapCount;
    case "nextInflow": return r.nextInflowDate; // yyyy-mm-dd sorts lexicographically
    default: return null;
  }
}

function ProgramOverview({ onOpen }: { onOpen: (id: number) => void }) {
  const [view, setView] = useState<"list" | "timeline">("list");
  const [search, setSearch] = useState("");
  const { data, isLoading, isError, refetch } = useQuery<MilestoneProgram>({
    queryKey: ["/api/milestone-tracker/program"],
  });

  const [phases, setPhases] = useState<string[]>([]);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  // Phase filter options — the same board range; empty selection = the default
  // Financial Close → Client Handover scope (see phaseInScope).
  const phaseOptions = useMemo(() => buildPhaseOptions(rows.map((r) => r.phase)), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (!q || r.projectName.toLowerCase().includes(q)) && phaseInScope(r.phase, phases),
    );
  }, [rows, search, phases]);
  const { sorted, sort, toggle } = useTableSort(filtered, programSortValue);

  const exportCsv = () => downloadCsv(
    "milestone-tracker",
    ["Site", "Phase", "Milestones linked", "Milestones total", "Inflow total", "Open inflow #", "Open inflow R", "Linked outflow R", "Open outflow #", "Open outflow R", "Ready to invoice", "Gaps", "Next inflow"],
    sorted.map((r) => [r.projectName, canonicalPhaseLabel(r.phase), r.linkedMilestoneCount, r.milestoneCount, Math.round(r.inflowTotal), r.openInflowCount, Math.round(r.openInflowAmount), Math.round(r.outflowTotal), r.openOutflowCount, Math.round(r.openOutflowAmount), r.readyToInvoiceCount, r.gapCount, r.nextInflowDate ?? ""]),
  );

  return (
    <PageShell className="max-w-6xl p-4 md:p-6" data-testid="milestone-tracker-page">
      <PageHeader title="Activity Planning" subtitle="Plan the money in, the work that earns it, and the money out — link inflow milestones, plan tasks and outflow line items, and track completion and dependencies" />

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

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <Button size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")} data-testid="program-view-list">By project</Button>
            <Button size="sm" variant={view === "timeline" ? "default" : "outline"} onClick={() => setView("timeline")} data-testid="program-view-timeline">Timeline</Button>
            {view === "list" && (
              <>
                <Input className="w-48 h-8" placeholder="Search site…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="milestone-search" />
                <PhaseMultiSelect options={phaseOptions} selected={phases} onChange={setPhases} />
                {phases.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {phases.map((p) => (
                      <button
                        key={p}
                        onClick={() => setPhases((cur) => cur.filter((x) => x !== p))}
                        className="inline-flex items-center gap-1 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700 px-2 py-0.5 text-xs hover:bg-emerald-100"
                        data-testid={`milestone-phase-chip-${p}`}
                      >
                        {p}<span aria-hidden className="text-emerald-500">×</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{filtered.length} of {rows.length} sites · {data.header.milestoneCount} milestones</span>
              {view === "list" && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv} data-testid="milestone-export">
                  <Download className="w-4 h-4" /><span className="hidden sm:inline">Export</span>
                </Button>
              )}
            </div>
          </div>

          {view === "list" ? (
            <Card className="mt-3"><CardContent className="p-0 overflow-x-auto">
              {rows.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">No projects have revenue-tracker milestones yet.</p>
              ) : filtered.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">No sites match these filters.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground">
                    <SortHeader label="Site" sortKey="site" sort={sort} onSort={toggle} />
                    <SortHeader label="Phase" sortKey="phase" sort={sort} onSort={toggle} />
                    <SortHeader label="Milestones" sortKey="milestones" sort={sort} onSort={toggle} />
                    <SortHeader label="Inflow" sortKey="inflow" sort={sort} onSort={toggle} />
                    <SortHeader label="Open inflows" sortKey="openIn" sort={sort} onSort={toggle} />
                    <SortHeader label="Linked outflow" sortKey="linkedOut" sort={sort} onSort={toggle} />
                    <SortHeader label="Open outflows" sortKey="openOut" sort={sort} onSort={toggle} />
                    <SortHeader label="Ready" sortKey="ready" sort={sort} onSort={toggle} />
                    <SortHeader label="Gaps" sortKey="gaps" sort={sort} onSort={toggle} />
                    <SortHeader label="Next inflow" sortKey="nextInflow" sort={sort} onSort={toggle} />
                  </tr></thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.projectId} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(r.projectId)} data-testid={`program-row-${r.projectId}`}>
                        <td className="py-2 px-3 font-medium">{r.projectName}</td>
                        <td className="py-2 px-3 whitespace-nowrap text-xs text-muted-foreground">{canonicalPhaseLabel(r.phase) || "—"}</td>
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
            <ProgramMonthlyOverlay activities={data.activities} onOpen={onOpen} />
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
