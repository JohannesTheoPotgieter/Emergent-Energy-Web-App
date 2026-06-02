/**
 * Program Plan — per-project replica of the Tracker workbook's Project
 * Plan sheet.
 *
 * Top: metadata card from `tracker_project_metadata` — Project Start,
 *   Baseline / Forecasted Completion, Duration metrics.
 *
 * Body: 13-column WBS-indented task list reading from `work_items`
 *   (filtered by `source='SMART_IMPORT'`, `workstream='PM'`,
 *   `deleted_at IS NULL` per the spine doc).
 *
 * Note: the daily-resolution Gantt strip on the right side of the source
 * sheet (~365 daily cells per task) is intentionally NOT rendered in this
 * v1. It requires column virtualisation, week-grouped headers, and bar
 * placement logic — a substantial follow-up. The metadata + task list IS
 * the data the user explicitly asked to see preserved.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fetchQueryFn } from "@/lib/queryClient";
import { styleForCell } from "@/lib/tracker-cell-format";
import { humaniseField } from "@/lib/field-labels";
import { Loader2, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";

interface ProgramPlanResponse {
  projectId: number;
  metadata: {
    baselineCompletionDate: string | null;
    forecastedCompletionDate: string | null;
    projectStartDate: string | null;
    durationMonthsFromSiteEstab: string | null;
    durationMonthsToCapacityTest: string | null;
    cellFormat: unknown;
  } | null;
  dependencies?: Array<{
    predecessorId: number;
    successorId: number;
    depType: string;
    lagDays: number;
  }>;
  tasks: Array<{
    id: number;
    parentId: number | null;
    isMilestone: boolean | null;
    wbsCode: string | null;
    outlineNumber: string | null;
    indentLevel: number | null;
    title: string;
    ownerName: string | null;
    trackerComments: string | null;
    lead: string | null;
    startDate: string | null;
    endDate: string | null;
    duration: number | null;
    // Mirror-the-workbook columns (per 2026-05-07 product change):
    // import populates baseline* with the workbook's PLANNED dates
    // and actual* with the workbook's ACTUAL dates so the replica
    // can show both side-by-side, the same way the source sheet does.
    baselineStart: string | null;
    baselineEnd: string | null;
    baselineDuration: number | null;
    actualStart: string | null;
    actualEnd: string | null;
    actualDuration: number | null;
    percentComplete: number | null;
    expectedPctComplete: number | null;
    workDays: number | null;
    resource1: string | null;
    resource2: string | null;
    cellFormat: unknown;
    manualOverrides?: Record<string, unknown> | null;
  }>;
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  return v.length >= 10 ? v.slice(0, 10) : v;
}
function pct(v: number | null): string {
  if (v === null || v === undefined) return "—";
  if (!isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}
function num(v: number | string | null): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n.toLocaleString("en-ZA", { maximumFractionDigits: 2 }) : String(v);
}

export function ProgramPlanContent({ projectId }: { projectId: number }) {
  const { data, isLoading, error } = useQuery<ProgramPlanResponse>({
    queryKey: [`/api/tracker-replica/${projectId}/program-plan`],
    queryFn: fetchQueryFn(`/api/tracker-replica/${projectId}/program-plan`),
    enabled: Number.isFinite(projectId),
  });

  if (isLoading) {
    return <div className="p-8 flex items-center text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</div>;
  }
  if (error || !data) {
    return <div className="p-8 text-red-600">Failed to load program plan.</div>;
  }

  const m = data.metadata;
  return (
    <div className="space-y-6" data-testid="program-plan-content">
      <Card>
        <CardHeader><CardTitle className="text-base">Project Plan Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Project Start Date</div>
            <div className="font-mono" style={m ? styleForCell(m.cellFormat, "projectStartDate") : {}}>{fmtDate(m?.projectStartDate ?? null)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Baseline Completion</div>
            <div className="font-mono" style={m ? styleForCell(m.cellFormat, "baselineCompletionDate") : {}}>{fmtDate(m?.baselineCompletionDate ?? null)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Forecasted Completion</div>
            <div className="font-mono" style={m ? styleForCell(m.cellFormat, "forecastedCompletionDate") : {}}>{fmtDate(m?.forecastedCompletionDate ?? null)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Duration from Site Establishment (months)</div>
            <div className="font-mono" style={m ? styleForCell(m.cellFormat, "durationMonthsFromSiteEstab") : {}}>{num(m?.durationMonthsFromSiteEstab ?? null)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Duration to Capacity Tests (months)</div>
            <div className="font-mono" style={m ? styleForCell(m.cellFormat, "durationMonthsToCapacityTest") : {}}>{num(m?.durationMonthsToCapacityTest ?? null)}</div>
          </div>
          {!m && <p className="col-span-full text-xs text-muted-foreground">No header data yet — re-import the Tracker workbook to populate.</p>}
        </CardContent>
      </Card>

      <Tabs defaultValue="plan" className="w-full">
        <TabsList>
          <TabsTrigger value="plan">Gantt</TabsTrigger>
          <TabsTrigger value="tasks">Task List</TabsTrigger>
          <TabsTrigger value="gantt">Daily Gantt</TabsTrigger>
        </TabsList>

        <TabsContent value="plan">
          <ProGantt tasks={data.tasks} dependencies={data.dependencies ?? []} startDate={m?.projectStartDate ?? null} />
        </TabsContent>

        <TabsContent value="gantt">
          <GanttSection tasks={data.tasks} startDate={m?.projectStartDate ?? null} />
        </TabsContent>

        <TabsContent value="tasks">

      <Card>
        <CardHeader><CardTitle className="text-base">Tasks (WBS-indented)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>WBS</TableHead>
                <TableHead>TASK</TableHead>
                <TableHead>OWNER</TableHead>
                <TableHead>COMMENTS</TableHead>
                <TableHead>LEAD</TableHead>
                <TableHead>PLANNED START</TableHead>
                <TableHead>ACTUAL START</TableHead>
                <TableHead>PLANNED END</TableHead>
                <TableHead>ACTUAL END</TableHead>
                <TableHead>DAYS</TableHead>
                <TableHead>% DONE</TableHead>
                <TableHead>% Forecasted</TableHead>
                <TableHead>WORK DAYS</TableHead>
                <TableHead>Resource 1</TableHead>
                <TableHead>Resource 2</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tasks.map((t) => {
                const indent = t.indentLevel ?? 0;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono" style={{ paddingLeft: `${0.5 + indent * 1}rem`, ...styleForCell(t.cellFormat, "wbsCode") }}>{t.wbsCode ?? t.outlineNumber ?? "—"}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "title")}>
                      <div className="flex flex-col gap-0.5">
                        <span>{t.title}</span>
                        {Object.keys(t.manualOverrides ?? {}).length > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[9px] font-medium text-amber-600 cursor-help"
                            title={`${Object.keys(t.manualOverrides!).length} field edit(s): ${Object.keys(t.manualOverrides!).map(humaniseField).join(", ")}`}
                            data-testid={`override-badge-${t.id}`}
                          >
                            <span aria-hidden="true">✎</span>
                            <span className="sr-only">Edited:</span>
                            {" "}{Object.keys(t.manualOverrides!).length} field edits
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "ownerName")}>{t.ownerName ?? "—"}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "trackerComments")} className="max-w-xs truncate">{t.trackerComments ?? "—"}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "lead")}>{t.lead ?? "—"}</TableCell>
                    {/* Planned dates come from the workbook's Planned Start/End
                        columns, stored on baselineStart/baselineEnd. Actual
                        dates come from Actual Start/End. The single
                        startDate/endDate column on work_items now carries
                        actual ?? planned (the "primary" date the rest of the
                        app displays) so this view falls back to startDate
                        when the actual column wasn't filled by the import. */}
                    <TableCell style={styleForCell(t.cellFormat, "baselineStart")}>{fmtDate(t.baselineStart ?? t.startDate)}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "actualStart")}>{fmtDate(t.actualStart)}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "baselineEnd")}>{fmtDate(t.baselineEnd ?? t.endDate)}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "actualEnd")}>{fmtDate(t.actualEnd)}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "duration")} className="text-right">{num(t.duration)}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "percentComplete")} className="text-right">{pct(t.percentComplete)}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "expectedPctComplete")} className="text-right">{pct(t.expectedPctComplete)}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "workDays")} className="text-right">{num(t.workDays)}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "resource1")}>{t.resource1 ?? "—"}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "resource2")}>{t.resource2 ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
              {data.tasks.length === 0 && (
                <TableRow><TableCell colSpan={15} className="text-center text-sm text-muted-foreground">No tasks yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Professional Gantt — WBS tree (collapse/expand), summary/task/milestone bars,
// baseline overlay, dependency arrows, critical path, today line.
// ---------------------------------------------------------------------------

const G_ROW_H = 28;       // px per task row
const G_HEADER_H = 38;    // px for the month/week header
const G_LABEL_W = 360;    // px for the WBS + name tree column
const G_DAY_W = 6;        // px per day on the timeline
const G_BAR_H = 14;       // px bar height

type PlanTask = ProgramPlanResponse["tasks"][number];
type PlanDep = NonNullable<ProgramPlanResponse["dependencies"]>[number];

function ProGantt({
  tasks,
  dependencies,
  startDate,
}: {
  tasks: PlanTask[];
  dependencies: PlanDep[];
  startDate: string | null;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [showCritical, setShowCritical] = useState(true);

  const byId = useMemo(() => {
    const m = new Map<number, PlanTask>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  // Children keyed by parent (null = root). Input order is already sortOrder/sourceRow.
  const childrenOf = useMemo(() => {
    const m = new Map<number | null, PlanTask[]>();
    for (const t of tasks) {
      const p = t.parentId != null && byId.has(t.parentId) ? t.parentId : null;
      const arr = m.get(p) ?? [];
      arr.push(t);
      m.set(p, arr);
    }
    return m;
  }, [tasks, byId]);
  const hasKids = (id: number) => (childrenOf.get(id)?.length ?? 0) > 0;

  // Effective start/end per task. Leaves use actual ?? planned dates; summaries
  // roll up to span their descendants (min start / max end).
  const eff = useMemo(() => {
    const cache = new Map<number, { start: Date | null; end: Date | null }>();
    const leafStart = (t: PlanTask) => asDay(t.actualStart ?? t.baselineStart ?? t.startDate);
    const leafEnd = (t: PlanTask) => asDay(t.actualEnd ?? t.baselineEnd ?? t.endDate);
    const compute = (t: PlanTask, seen: Set<number>): { start: Date | null; end: Date | null } => {
      const hit = cache.get(t.id);
      if (hit) return hit;
      if (seen.has(t.id)) return { start: null, end: null };
      seen.add(t.id);
      let s = leafStart(t);
      let e = leafEnd(t);
      for (const k of childrenOf.get(t.id) ?? []) {
        const ce = compute(k, seen);
        if (ce.start && (!s || ce.start < s)) s = ce.start;
        if (ce.end && (!e || ce.end > e)) e = ce.end;
      }
      const r = { start: s, end: e };
      cache.set(t.id, r);
      return r;
    };
    for (const t of tasks) compute(t, new Set());
    return cache;
  }, [tasks, childrenOf]);

  // Timeline bounds (pad a week on each side).
  const { minDate, totalDays } = useMemo(() => {
    let lo: Date | null = asDay(startDate);
    let hi: Date | null = null;
    for (const t of tasks) {
      const e = eff.get(t.id);
      if (e?.start && (!lo || e.start < lo)) lo = e.start;
      if (e?.end && (!hi || e.end > hi)) hi = e.end;
    }
    if (!lo) lo = asDay(new Date()) ?? new Date();
    const start = addDays(lo, -3);
    const span = hi ? Math.max(30, diffDays(hi, start) + 7) : 30;
    return { minDate: start, totalDays: span };
  }, [tasks, eff, startDate]);

  // Visible rows: DFS preserving input order, skipping collapsed subtrees.
  const rows = useMemo(() => {
    const out: { t: PlanTask; depth: number }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const t of childrenOf.get(parent) ?? []) {
        out.push({ t, depth });
        if (hasKids(t.id) && !collapsed.has(t.id)) walk(t.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [childrenOf, collapsed]);

  // Critical path (CPM) over leaf tasks using the dependency graph. Approximate
  // (SS/SF keyed off predecessor start; FS/FF off finish) and fully guarded —
  // if there are no deps or the graph cycles, no path is highlighted.
  const critical = useMemo(() => {
    const empty = new Set<number>();
    if (dependencies.length === 0) return empty;
    try {
      const dur = (id: number): number => {
        const e = eff.get(id);
        if (e?.start && e?.end) return Math.max(1, diffDays(e.end, e.start) + 1);
        const t = byId.get(id);
        return Math.max(1, Number(t?.duration ?? 1));
      };
      const preds = new Map<number, PlanDep[]>();
      const succs = new Map<number, PlanDep[]>();
      for (const d of dependencies) {
        if (!byId.has(d.predecessorId) || !byId.has(d.successorId)) continue;
        (preds.get(d.successorId) ?? preds.set(d.successorId, []).get(d.successorId)!).push(d);
        (succs.get(d.predecessorId) ?? succs.set(d.predecessorId, []).get(d.predecessorId)!).push(d);
      }
      const es = new Map<number, number>();
      const ef = new Map<number, number>();
      const calcES = (id: number, seen: Set<number>): number => {
        const hit = es.get(id);
        if (hit !== undefined) return hit;
        if (seen.has(id)) return 0;
        seen.add(id);
        let v = 0;
        for (const p of preds.get(id) ?? []) {
          const useStart = p.depType === "SS" || p.depType === "SF";
          const base = useStart ? calcES(p.predecessorId, seen) : calcEF(p.predecessorId, seen);
          v = Math.max(v, base + (p.lagDays ?? 0));
        }
        es.set(id, v);
        return v;
      };
      const calcEF = (id: number, seen: Set<number>): number => {
        const hit = ef.get(id);
        if (hit !== undefined) return hit;
        const v = calcES(id, seen) + dur(id);
        ef.set(id, v);
        return v;
      };
      let projEnd = 0;
      for (const t of tasks) projEnd = Math.max(projEnd, calcEF(t.id, new Set()));
      const lf = new Map<number, number>();
      const ls = new Map<number, number>();
      const calcLF = (id: number, seen: Set<number>): number => {
        const hit = lf.get(id);
        if (hit !== undefined) return hit;
        if (seen.has(id)) return projEnd;
        seen.add(id);
        const ss = succs.get(id) ?? [];
        let v = ss.length === 0 ? projEnd : Infinity;
        for (const s of ss) v = Math.min(v, calcLS(s.successorId, seen) - (s.lagDays ?? 0));
        if (!Number.isFinite(v)) v = projEnd;
        lf.set(id, v);
        return v;
      };
      const calcLS = (id: number, seen: Set<number>): number => {
        const hit = ls.get(id);
        if (hit !== undefined) return hit;
        const v = calcLF(id, seen) - dur(id);
        ls.set(id, v);
        return v;
      };
      for (const t of tasks) calcLF(t.id, new Set());
      const crit = new Set<number>();
      for (const t of tasks) {
        if (hasKids(t.id)) continue; // summaries roll up; not on the path itself
        const float = (ls.get(t.id) ?? 0) - (es.get(t.id) ?? 0);
        if (float <= 0.0001) crit.add(t.id);
      }
      return crit;
    } catch {
      return empty;
    }
  }, [tasks, dependencies, eff, byId]);

  // Per-row bar geometry (only for rows with a resolvable span).
  const geom = useMemo(() => {
    const m = new Map<number, { i: number; x0: number; x1: number }>();
    rows.forEach(({ t }, i) => {
      const e = eff.get(t.id);
      if (!e?.start || !e?.end) return;
      const x0 = diffDays(e.start, minDate) * G_DAY_W;
      const x1 = (diffDays(e.end, minDate) + 1) * G_DAY_W;
      m.set(t.id, { i, x0, x1 });
    });
    return m;
  }, [rows, eff, minDate]);

  // Month header segments.
  const months = useMemo(() => {
    const out: { label: string; x: number; w: number }[] = [];
    let cursor = new Date(Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth(), 1));
    const last = addDays(minDate, totalDays);
    while (cursor.getTime() <= last.getTime()) {
      const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      const segStart = cursor.getTime() < minDate.getTime() ? minDate : cursor;
      const x = Math.max(0, diffDays(segStart, minDate)) * G_DAY_W;
      const w = (diffDays(next, segStart)) * G_DAY_W;
      out.push({ label: cursor.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" }), x, w });
      cursor = next;
    }
    return out;
  }, [minDate, totalDays]);

  const today = asDay(new Date());
  const todayX = today ? diffDays(today, minDate) * G_DAY_W : -1;
  const timelineW = totalDays * G_DAY_W;
  const bodyH = rows.length * G_ROW_H;

  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allParentIds = useMemo(() => tasks.filter((t) => hasKids(t.id)).map((t) => t.id), [tasks, childrenOf]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Programme Gantt</CardTitle>
          <div className="flex items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-1 cursor-pointer select-none">
              <input type="checkbox" checked={showCritical} onChange={(e) => setShowCritical(e.target.checked)} data-testid="gantt-critical-toggle" />
              Critical path
            </label>
            <Button size="sm" variant="outline" onClick={() => setCollapsed(new Set(allParentIds))} data-testid="gantt-collapse-all">Collapse all</Button>
            <Button size="sm" variant="outline" onClick={() => setCollapsed(new Set())} data-testid="gantt-expand-all">Expand all</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2.5 bg-emerald-400 rounded-sm" /> Task</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-1.5 bg-slate-700" /> Summary</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 bg-amber-500 rotate-45" /> Milestone</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2.5 border border-red-500 rounded-sm" /> Critical</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-1 bg-slate-300" /> Baseline</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">No plan tasks to plot.</div>
        ) : (
          <div className="flex border-t" data-testid="pro-gantt">
            {/* Left: WBS tree */}
            <div className="shrink-0 border-r bg-background" style={{ width: G_LABEL_W }}>
              <div className="border-b px-2 flex items-end pb-1 text-xs font-semibold text-muted-foreground" style={{ height: G_HEADER_H }}>WBS · Task</div>
              {rows.map(({ t, depth }) => {
                const isParent = hasKids(t.id);
                const isCrit = showCritical && critical.has(t.id);
                return (
                  <div key={t.id} className="flex items-center border-b text-xs hover:bg-muted/20" style={{ height: G_ROW_H, paddingLeft: 6 + depth * 14 }} data-testid={`gantt-tree-row-${t.id}`}>
                    {isParent ? (
                      <button onClick={() => toggle(t.id)} className="w-4 h-4 mr-1 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0" aria-label={collapsed.has(t.id) ? "Expand" : "Collapse"}>
                        {collapsed.has(t.id) ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    ) : (
                      <span className="w-4 mr-1 shrink-0" />
                    )}
                    <span className="font-mono text-muted-foreground shrink-0 mr-1.5">{t.wbsCode ?? t.outlineNumber ?? ""}</span>
                    <span className={`truncate ${isParent ? "font-semibold" : ""} ${isCrit ? "text-red-600" : ""}`} title={t.title}>{t.title}</span>
                  </div>
                );
              })}
            </div>

            {/* Right: timeline */}
            <div className="overflow-x-auto flex-1" data-testid="gantt-timeline-scroll">
              <div className="relative" style={{ width: Math.max(timelineW, 200), height: G_HEADER_H + bodyH }}>
                {/* Month header */}
                <div className="absolute top-0 left-0 right-0 border-b bg-background" style={{ height: G_HEADER_H }}>
                  {months.map((mo, i) => (
                    <div key={i} className="absolute top-0 h-full border-r text-[10px] text-muted-foreground px-1 pt-1 overflow-hidden" style={{ left: mo.x, width: mo.w }}>
                      {mo.label}
                    </div>
                  ))}
                </div>

                {/* Today line */}
                {todayX >= 0 && todayX <= timelineW && (
                  <div className="absolute w-px bg-blue-500/70 z-20" style={{ left: todayX, top: G_HEADER_H, height: bodyH }} title="Today" />
                )}

                {/* Row backgrounds + bars */}
                {rows.map(({ t }, i) => {
                  const g = geom.get(t.id);
                  const top = G_HEADER_H + i * G_ROW_H;
                  const isParent = hasKids(t.id);
                  const isMs = !!t.isMilestone && !isParent;
                  const isCrit = showCritical && critical.has(t.id);
                  const pctDone = Math.max(0, Math.min(1, t.percentComplete ?? 0));
                  // Baseline overlay (planned) when distinct from the drawn span.
                  const bStart = asDay(t.baselineStart);
                  const bEnd = asDay(t.baselineEnd);
                  return (
                    <div key={t.id} className="absolute left-0 right-0 border-b hover:bg-muted/10" style={{ top, height: G_ROW_H }}>
                      {g && bStart && bEnd && (
                        <div className="absolute bg-slate-300 rounded-sm" style={{ left: diffDays(bStart, minDate) * G_DAY_W, width: Math.max(2, (diffDays(bEnd, bStart) + 1) * G_DAY_W), top: G_ROW_H - 5, height: 3 }} title={`Baseline ${fmtDate(t.baselineStart)} → ${fmtDate(t.baselineEnd)}`} />
                      )}
                      {g && isMs && (
                        <div className={`absolute ${isCrit ? "bg-red-500" : "bg-amber-500"} rotate-45`} style={{ left: g.x0 - 5, top: (G_ROW_H - 10) / 2, width: 10, height: 10 }} title={`${t.title} · ${fmtDate(t.startDate)}`} />
                      )}
                      {g && isParent && (
                        <div className={`absolute ${isCrit ? "bg-red-600" : "bg-slate-700"}`} style={{ left: g.x0, width: Math.max(2, g.x1 - g.x0), top: (G_ROW_H - 6) / 2, height: 6, borderRadius: 2 }} title={`${t.title} (summary)`} />
                      )}
                      {g && !isParent && !isMs && (
                        <div className={`absolute rounded-sm overflow-hidden border ${isCrit ? "border-red-500 bg-red-100" : "border-emerald-500 bg-emerald-100"}`} style={{ left: g.x0, width: Math.max(3, g.x1 - g.x0), top: (G_ROW_H - G_BAR_H) / 2, height: G_BAR_H }} title={`${t.title} · ${fmtDate(t.startDate)} → ${fmtDate(t.endDate)} · ${pct(t.percentComplete)}`}>
                          <div className={`${isCrit ? "bg-red-500" : "bg-emerald-500"} h-full`} style={{ width: `${pctDone * 100}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Dependency arrows */}
                <svg className="absolute pointer-events-none" style={{ left: 0, top: G_HEADER_H, width: Math.max(timelineW, 200), height: bodyH, zIndex: 15 }}>
                  <defs>
                    <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" className="fill-slate-400" />
                    </marker>
                    <marker id="gantt-arrow-crit" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" className="fill-red-500" />
                    </marker>
                  </defs>
                  {dependencies.map((d, idx) => {
                    const gp = geom.get(d.predecessorId);
                    const gs = geom.get(d.successorId);
                    if (!gp || !gs) return null;
                    const yp = gp.i * G_ROW_H + G_ROW_H / 2;
                    const ys = gs.i * G_ROW_H + G_ROW_H / 2;
                    // FS/FF start from predecessor finish; SS/SF from its start.
                    const fromX = d.depType === "SS" || d.depType === "SF" ? gp.x0 : gp.x1;
                    const toX = d.depType === "FF" || d.depType === "SF" ? gs.x1 : gs.x0;
                    const crit = showCritical && critical.has(d.predecessorId) && critical.has(d.successorId);
                    const midX = Math.max(fromX, toX) + 8;
                    const path = `M ${fromX} ${yp} H ${midX} V ${ys} H ${toX}`;
                    return (
                      <path
                        key={idx}
                        d={path}
                        fill="none"
                        className={crit ? "stroke-red-500" : "stroke-slate-400"}
                        strokeWidth={crit ? 1.5 : 1}
                        markerEnd={`url(#${crit ? "gantt-arrow-crit" : "gantt-arrow"})`}
                      />
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        )}
        {dependencies.length === 0 && rows.length > 0 && (
          <p className="text-xs text-muted-foreground px-3 py-2 border-t">
            No task dependencies found in the workbook — add a “Predecessors” column to the Project Plan sheet (e.g. <span className="font-mono">1.2, 1.3FS+2d</span>) and re-import to draw dependency links and the critical path.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Daily Gantt strip
// ---------------------------------------------------------------------------

const DAY_MS = 86400_000;
const DEFAULT_WINDOW_DAYS = 84; // 12 weeks
const CELL_WIDTH = 18;          // px per day cell
const TASK_LABEL_WIDTH = 360;   // px for the WBS + name column

/** Strip the time component and return a UTC midnight Date. */
function asDay(input: string | Date | null): Date | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

function shortMonth(d: Date): string {
  return d.toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
}

function dayOfWeekLetter(d: Date): string {
  return ["S", "M", "T", "W", "T", "F", "S"][d.getUTCDay()];
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

interface GanttSectionProps {
  tasks: ProgramPlanResponse["tasks"];
  startDate: string | null;
}

function GanttSection({ tasks, startDate }: GanttSectionProps) {
  // Window anchor: project start, or earliest task start, or today.
  const anchor = useMemo(() => {
    const candidates: Date[] = [];
    const projStart = asDay(startDate);
    if (projStart) candidates.push(projStart);
    for (const t of tasks) {
      const s = asDay(t.startDate);
      if (s) candidates.push(s);
    }
    if (candidates.length === 0) return asDay(new Date()) ?? new Date();
    return new Date(Math.min(...candidates.map(d => d.getTime())));
  }, [tasks, startDate]);

  const [windowStartOffset, setWindowStartOffset] = useState(0);
  const windowStart = useMemo(() => addDays(anchor, windowStartOffset), [anchor, windowStartOffset]);
  const windowEnd = useMemo(() => addDays(windowStart, DEFAULT_WINDOW_DAYS - 1), [windowStart]);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < DEFAULT_WINDOW_DAYS; i++) {
      out.push(addDays(windowStart, i));
    }
    return out;
  }, [windowStart]);

  const today = asDay(new Date());

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Daily Gantt — 12-week window</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setWindowStartOffset(o => o - 28)} data-testid="gantt-back-4w">
              <ChevronLeft className="h-3.5 w-3.5" /> 4w
            </Button>
            <Button size="sm" variant="outline" onClick={() => setWindowStartOffset(0)} data-testid="gantt-reset">
              Project start
            </Button>
            <Button size="sm" variant="outline" onClick={() => setWindowStartOffset(o => o + 28)} data-testid="gantt-fwd-4w">
              4w <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {shortMonth(windowStart)} — {shortMonth(windowEnd)}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto" data-testid="gantt-scroll">
          <div style={{ width: TASK_LABEL_WIDTH + days.length * CELL_WIDTH }}>
            {/* Header rows: week start + day-of-week */}
            <div className="flex sticky top-0 bg-background z-10 border-b">
              <div className="font-semibold text-xs px-2 py-1 border-r" style={{ width: TASK_LABEL_WIDTH }}>WBS · Task</div>
              {days.map((d, i) => {
                const isWeekStart = d.getUTCDay() === 1 || i === 0;
                return (
                  <div
                    key={`hdr-${i}`}
                    className={`text-[10px] text-center border-r ${isWeekend(d) ? "bg-muted/40" : ""}`}
                    style={{ width: CELL_WIDTH }}
                  >
                    <div className={`font-mono ${isWeekStart ? "font-semibold" : "text-muted-foreground"}`}>
                      {isWeekStart ? d.getUTCDate() : ""}
                    </div>
                    <div className="text-muted-foreground">{dayOfWeekLetter(d)}</div>
                  </div>
                );
              })}
            </div>

            {/* Task rows */}
            {tasks.map((t) => {
              const start = asDay(t.startDate);
              const end = asDay(t.endDate);
              const pct = t.percentComplete ?? 0;
              const isComplete = pct >= 1;
              const overdue = end !== null && today !== null && end.getTime() < today.getTime() && !isComplete;

              return (
                <div key={t.id} className="flex items-stretch border-b hover:bg-muted/20" data-testid={`gantt-row-${t.id}`}>
                  <div className="text-xs px-2 py-1 border-r flex items-center gap-1.5" style={{ width: TASK_LABEL_WIDTH, paddingLeft: `${0.5 + (t.indentLevel ?? 0) * 0.75}rem` }}>
                    <span className="font-mono text-muted-foreground shrink-0">{t.wbsCode ?? t.outlineNumber ?? "—"}</span>
                    <span className="truncate" title={t.title}>{t.title}</span>
                  </div>
                  {days.map((d, i) => {
                    const inRange = start && end && d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
                    const isToday = today && d.getTime() === today.getTime();
                    let bg = "bg-transparent";
                    if (inRange) {
                      bg = isComplete ? "bg-emerald-300" : overdue ? "bg-red-300" : "bg-emerald-200";
                    } else if (isWeekend(d)) {
                      bg = "bg-muted/30";
                    }
                    return (
                      <div
                        key={`cell-${t.id}-${i}`}
                        className={`border-r ${bg} ${isToday ? "outline outline-blue-500 outline-2 outline-offset-[-2px]" : ""}`}
                        style={{ width: CELL_WIDTH, minHeight: 24 }}
                        title={inRange ? `${shortMonth(d)} — ${t.title}` : ""}
                      />
                    );
                  })}
                </div>
              );
            })}

            {tasks.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-6">No tasks to plot.</div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-emerald-200 rounded-sm" /> In progress</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-emerald-300 rounded-sm" /> Complete</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-red-300 rounded-sm" /> Overdue</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-muted/40 border rounded-sm" /> Weekend</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 outline outline-blue-500 outline-2 rounded-sm" /> Today</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProgramPlanPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  return (
    <div className="p-6 space-y-6" data-testid="program-plan-page">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Program Plan</h1>
        <Badge variant="outline">Tracker replica · Project #{projectId}</Badge>
      </header>
      <ProgramPlanContent projectId={projectId} />
    </div>
  );
}
