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
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";

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
  tasks: Array<{
    id: number;
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

      <Tabs defaultValue="tasks" className="w-full">
        <TabsList>
          <TabsTrigger value="tasks">Task List</TabsTrigger>
          <TabsTrigger value="gantt">Daily Gantt</TabsTrigger>
        </TabsList>

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
                <TableHead>START</TableHead>
                <TableHead>END</TableHead>
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
                            title={`${Object.keys(t.manualOverrides!).length} field(s) overridden: ${Object.keys(t.manualOverrides!).join(", ")}`}
                            data-testid={`override-badge-${t.id}`}
                          >
                            ✎ {Object.keys(t.manualOverrides!).length} edited
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "ownerName")}>{t.ownerName ?? "—"}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "trackerComments")} className="max-w-xs truncate">{t.trackerComments ?? "—"}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "lead")}>{t.lead ?? "—"}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "startDate")}>{fmtDate(t.startDate)}</TableCell>
                    <TableCell style={styleForCell(t.cellFormat, "endDate")}>{fmtDate(t.endDate)}</TableCell>
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
                <TableRow><TableCell colSpan={13} className="text-center text-sm text-muted-foreground">No tasks yet.</TableCell></TableRow>
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
