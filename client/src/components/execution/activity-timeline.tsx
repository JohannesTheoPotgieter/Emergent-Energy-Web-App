// ============================================================
// Activity Planning — timeline visualisations
//
// Presentational components extracted from milestone-tracker.tsx: the per-project
// Gantt-style ActivityTimeline (with a rolled-up "Project overall" band), the
// program month-column overlay (ProgramMonthlyOverlay) and the consolidated
// program-wide monthly cash timeline (ProgramMonthlyTimeline). Read-only — they
// render TimelineActivity data the service already computed.
// ============================================================

import { useMemo } from "react";
import { format } from "date-fns";
import { AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDate, parseExecDate } from "@/lib/execution-types";
import { type TimelineActivity, type AxisState, money } from "@/lib/milestone-tracker-types";

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
  const label = cashLabel(a.cashflowDays);
  const title = a.cashflowState === "positive" ? "Money in lands before money out (cash-positive)"
    : a.cashflowState === "negative" ? "Money out before money in (you fund the work first)"
    : "No outflow dates to compare yet";
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{label}
    </span>
  );
}

function AxisBadge({ state, label, title }: { state: AxisState; label: string; title?: string }) {
  const s = AXIS_STYLE[state];
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{label}
    </span>
  );
}

function cashLabel(days: number | null): string {
  return days == null ? "Cash —" : days >= 0 ? `Cash +${days}d` : `Cash ${days}d`;
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

export function ActivityTimeline({ activities, onOpenProject, showProject }: {
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

  // Project overall — roll up every built activity into one band: the full work
  // span, total money in/out/net, whether the whole project is on schedule (no
  // task behind), and the project-level cash timing (amount-weighted money-out
  // date minus amount-weighted money-in date).
  const overall = useMemo(() => {
    if (activities.length === 0) return null;
    let start: string | null = null, end: string | null = null;
    let moneyIn = 0, moneyOut = 0, overdue = 0;
    let inW = 0, inD = 0, outW = 0, outD = 0;
    for (const a of activities) {
      if (a.taskStart && (start == null || a.taskStart < start)) start = a.taskStart;
      if (a.taskEnd && (end == null || a.taskEnd > end)) end = a.taskEnd;
      moneyIn += a.amount ?? 0;
      moneyOut += a.outflowTotal;
      overdue += a.overdueTaskCount;
      const inMs = a.inflow ? parseExecDate(a.inflow.date)?.getTime() : undefined;
      const inAmt = a.amount ?? 0;
      if (inMs != null && inAmt > 0) { inW += inAmt; inD += inMs * inAmt; }
      for (const o of a.outflows) {
        const oMs = parseExecDate(o.date)?.getTime();
        const amt = o.amount ?? 0;
        if (oMs != null && amt > 0) { outW += amt; outD += oMs * amt; }
      }
    }
    const wIn = inW > 0 ? inD / inW : null;
    const wOut = outW > 0 ? outD / outW : null;
    const cashflowDays = wIn != null && wOut != null ? Math.round((wOut - wIn) / 86_400_000) : null;
    return {
      start, end, moneyIn, moneyOut, net: moneyIn - moneyOut, overdue,
      scheduleState: (overdue > 0 ? "negative" : "positive") as AxisState,
      cashflowDays,
      cashflowState: (cashflowDays == null ? "unknown" : cashflowDays >= 0 ? "positive" : "negative") as AxisState,
      wIn, wOut,
    };
  }, [activities]);

  if (activities.length === 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">No fully-built activities yet — link an inflow milestone to a plan task to see it on the timeline.</p>;
  }
  if (!bounds) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Built activities have no dates to plot yet.</p>;
  }
  const pctMs = (t: number | null | undefined): number | null =>
    t == null ? null : ((t - bounds.min) / (bounds.max - bounds.min)) * 100;
  const pct = (d: string | null): number | null => (d ? pctMs(parseExecDate(d)?.getTime()) : null);
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
        {overall && (() => {
          const s = pct(overall.start), e = pct(overall.end);
          const barLeft = s != null && e != null ? Math.min(s, e) : null;
          const barWidth = s != null && e != null ? Math.max(Math.abs(e - s), 1.2) : null;
          const inPct = pctMs(overall.wIn), outPct = pctMs(overall.wOut);
          return (
            <div className="flex items-center rounded-md border bg-muted/40" data-testid="timeline-overall">
              <div className="w-56 shrink-0 pl-2 pr-2 py-1.5">
                <div className="text-xs font-semibold">Project overall</div>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <AxisBadge state={overall.scheduleState} title="Overall schedule — is any task behind?"
                    label={overall.scheduleState === "negative" ? `Behind · ${overall.overdue} late` : "On schedule"} />
                  <AxisBadge state={overall.cashflowState} title="Overall money-in vs money-out timing across the project" label={cashLabel(overall.cashflowDays)} />
                </div>
                <div className="text-[10px] mt-0.5">
                  <span className="text-emerald-600 tabular-nums">{money(overall.moneyIn)} in</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-red-600 tabular-nums">{money(overall.moneyOut)} out</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className={`tabular-nums font-medium ${overall.net >= 0 ? "text-emerald-700" : "text-red-700"}`}>{overall.net >= 0 ? "+" : ""}{money(overall.net)}</span>
                </div>
              </div>
              <div className="relative flex-1 h-10">
                <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/50" />
                {todayPct != null && todayPct >= 0 && todayPct <= 100 && <div className="absolute top-0 bottom-0 w-px bg-emerald-400/70" style={{ left: `${todayPct}%` }} title="Today" />}
                {barLeft != null && barWidth != null && (
                  <div className={`absolute top-1/2 -translate-y-1/2 h-3 rounded ${overall.scheduleState === "negative" ? "bg-red-500" : "bg-emerald-500"}`}
                    style={{ left: `${barLeft}%`, width: `${barWidth}%` }} title={`Project span ${fmtDate(overall.start)} – ${fmtDate(overall.end)}`} />
                )}
                {inPct != null && (
                  <span className="absolute top-0 -translate-x-1/2 text-emerald-700" style={{ left: `${inPct}%` }} title="Weighted money-in date"><TrendingUp className="w-3.5 h-3.5" /></span>
                )}
                {outPct != null && (
                  <span className="absolute bottom-0 -translate-x-1/2 text-red-700" style={{ left: `${outPct}%` }} title="Weighted money-out date"><TrendingDown className="w-3.5 h-3.5" /></span>
                )}
              </div>
            </div>
          );
        })()}
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

export function ProgramMonthlyOverlay({ activities, onOpen }: { activities: TimelineActivity[]; onOpen: (id: number) => void }) {
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

interface MonthSeriesPoint {
  key: string; label: string; moneyIn: number; moneyOut: number; net: number; cumNet: number;
  scheduleNeg: number; cashNeg: number; count: number;
}

/** Continuous month series (gaps filled) across the whole program, with a
 *  running cumulative net so the program's cash trajectory reads left-to-right. */
function buildMonthSeries(activities: TimelineActivity[]): MonthSeriesPoint[] {
  const buckets = groupByMonth(activities).filter((m) => m.key !== "—");
  if (buckets.length === 0) return [];
  const byKey = new Map(buckets.map((m) => [m.key, m]));
  const [fy, fm] = buckets[0].key.split("-").map(Number);
  const [ly, lm] = buckets[buckets.length - 1].key.split("-").map(Number);
  const out: MonthSeriesPoint[] = [];
  let y = fy, mo = fm, cum = 0, guard = 0;
  while ((y < ly || (y === ly && mo <= lm)) && guard++ < 240) {
    const key = `${y}-${String(mo).padStart(2, "0")}`;
    const b = byKey.get(key);
    const moneyIn = b?.moneyIn ?? 0;
    const moneyOut = b?.moneyOut ?? 0;
    const net = moneyIn - moneyOut;
    cum += net;
    out.push({
      key,
      label: format(parseExecDate(`${key}-01`) ?? new Date(`${key}-01`), "MMM ''yy"),
      moneyIn, moneyOut, net, cumNet: cum,
      scheduleNeg: b?.scheduleNeg ?? 0, cashNeg: b?.cashNeg ?? 0, count: b?.list.length ?? 0,
    });
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

/** Consolidated, program-wide monthly timeline: one diverging in/out bar per
 *  month across a continuous axis, with running cumulative net cash and the
 *  month's schedule + cash health — the whole program at a glance, month by month. */
export function ProgramMonthlyTimeline({ activities }: { activities: TimelineActivity[] }) {
  const series = useMemo(() => buildMonthSeries(activities), [activities]);
  if (activities.length === 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">No fully-built activities across the program yet — link inflow milestones to plan tasks to populate the schedule.</p>;
  }
  if (series.length === 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Built activities have no money-in month to plot yet.</p>;
  }
  const maxFlow = Math.max(1, ...series.map((m) => Math.max(m.moneyIn, m.moneyOut)));
  const totalIn = series.reduce((s, m) => s + m.moneyIn, 0);
  const totalOut = series.reduce((s, m) => s + m.moneyOut, 0);
  const endCum = series[series.length - 1].cumNet;
  return (
    <div className="mt-3" data-testid="program-monthly-timeline">
      <Card><CardContent className="p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-emerald-600 tabular-nums">{money(totalIn)} in</span>
          <span className="text-red-600 tabular-nums">{money(totalOut)} out</span>
          <span className={`font-medium tabular-nums ${endCum >= 0 ? "text-emerald-700" : "text-red-700"}`}>Net {endCum >= 0 ? "+" : ""}{money(endCum)}</span>
          <span className="text-muted-foreground">across {series.length} months</span>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-2">
          {series.map((m) => (
            <div key={m.key} className="flex flex-col items-center w-20 shrink-0" data-testid={`pmt-${m.key}`}>
              <div className="h-20 w-full flex flex-col justify-end items-center" title={`${money(m.moneyIn)} in`}>
                <div className="w-7 bg-emerald-400 rounded-t" style={{ height: `${(m.moneyIn / maxFlow) * 100}%` }} />
              </div>
              <div className="w-full border-t border-border" />
              <div className="h-20 w-full flex flex-col justify-start items-center" title={`${money(m.moneyOut)} out`}>
                <div className="w-7 bg-red-400 rounded-b" style={{ height: `${(m.moneyOut / maxFlow) * 100}%` }} />
              </div>
              <div className="text-[10px] font-medium mt-1 whitespace-nowrap">{m.label}</div>
              <div className={`text-[10px] tabular-nums ${m.net >= 0 ? "text-emerald-700" : "text-red-700"}`} title="Month net">{m.net >= 0 ? "+" : ""}{money(m.net)}</div>
              <div className="text-[9px] text-muted-foreground tabular-nums" title="Cumulative net cash to end of month">Σ {money(m.cumNet)}</div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${m.scheduleNeg > 0 ? "bg-red-500" : "bg-emerald-500"}`} title={m.scheduleNeg > 0 ? `${m.scheduleNeg} behind` : "on schedule"} />
                <span className={`w-1.5 h-1.5 rounded-full ${m.cashNeg > 0 ? "bg-red-500" : "bg-emerald-500"}`} title={m.cashNeg > 0 ? `${m.cashNeg} cash-negative` : "cash-positive"} />
                {m.count > 0 && <span className="text-[9px] text-muted-foreground tabular-nums">{m.count}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-emerald-400" /> Money in</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-red-400" /> Money out</span>
          <span>Σ = cumulative net cash</span>
          <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> / <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> schedule · cash health</span>
        </div>
      </CardContent></Card>
    </div>
  );
}
