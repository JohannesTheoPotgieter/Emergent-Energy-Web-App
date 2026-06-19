import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CriticalPathResult, PlanTaskView } from "@/lib/execution-types";
import { fmtDate, parseExecDate } from "@/lib/execution-types";

interface Bar {
  taskNo: string | null;
  taskName: string;
  start: Date;
  end: Date;
  leftPct: number;
  widthPct: number;
  critical: boolean;
}

/**
 * Date-driven critical path viewer. Renders every dated leaf task as a bar on a
 * shared timeline (positioned by its planned/actual dates) with the critical
 * chain highlighted. The critical path is the longest-duration sequence of
 * non-overlapping tasks ending at the project finish — derived from dates only,
 * since the import carries no explicit predecessor links.
 */
export function CriticalPathViewer({
  criticalPath,
  planTasks,
}: {
  criticalPath: CriticalPathResult;
  planTasks: PlanTaskView[];
}) {
  const { bars, hasTimeline } = useMemo(() => {
    const projStart = parseExecDate(criticalPath.projectStart);
    const projEnd = parseExecDate(criticalPath.projectFinish);
    if (!projStart || !projEnd) return { bars: [] as Bar[], hasTimeline: false };
    const span = projEnd.getTime() - projStart.getTime();
    if (span <= 0) return { bars: [] as Bar[], hasTimeline: false };

    const critical = new Set(criticalPath.criticalTaskNos);
    const parents = new Set(planTasks.map((t) => t.parentTaskNo).filter(Boolean) as string[]);
    const out: Bar[] = [];
    for (const t of planTasks) {
      if (t.taskNo && parents.has(t.taskNo)) continue; // leaves only
      const start = parseExecDate(t.plannedStart ?? t.actualStart);
      const end = parseExecDate(t.plannedEnd ?? t.actualEnd);
      if (!start || !end || end < start) continue;
      out.push({
        taskNo: t.taskNo,
        taskName: t.taskName,
        start,
        end,
        leftPct: ((start.getTime() - projStart.getTime()) / span) * 100,
        widthPct: Math.max(((end.getTime() - start.getTime()) / span) * 100, 0.8),
        critical: Boolean(t.taskNo && critical.has(t.taskNo)),
      });
    }
    out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
    return { bars: out, hasTimeline: true };
  }, [criticalPath, planTasks]);

  if (criticalPath.criticalTaskNos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4" data-testid="critical-path-empty">
        No dated plan tasks — a critical path needs planned (or actual) start and end dates.
      </p>
    );
  }

  return (
    <div data-testid="critical-path-viewer">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Planned start" value={fmtDate(criticalPath.projectStart)} />
        <Stat label="Planned finish" value={fmtDate(criticalPath.projectFinish)} />
        <Stat label="Span" value={criticalPath.spanDays != null ? `${criticalPath.spanDays} days` : "—"} />
        <Stat label="Critical tasks" value={`${criticalPath.criticalTaskNos.length} of ${criticalPath.datedTaskCount}`} />
      </div>

      {hasTimeline && (
        <Card className="mt-3">
          <CardContent className="p-3">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>{fmtDate(criticalPath.projectStart)}</span>
              <span>{fmtDate(criticalPath.projectFinish)}</span>
            </div>
            <div className="space-y-1" data-testid="critical-path-gantt">
              {bars.map((b, i) => (
                <div key={`${b.taskNo}-${i}`} className="flex items-center gap-2">
                  <div className="w-40 shrink-0 truncate text-xs" title={`${b.taskNo ?? ""} ${b.taskName}`}>
                    <span className="text-muted-foreground">{b.taskNo}</span> {b.taskName}
                  </div>
                  <div className="relative h-3 flex-1 rounded bg-muted/40">
                    <div
                      className={`absolute h-3 rounded ${b.critical ? "bg-red-500" : "bg-emerald-300"}`}
                      style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
                      title={`${b.taskName}: ${fmtDate(b.start.toISOString())} → ${fmtDate(b.end.toISOString())}`}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-red-500" /> Critical path</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-emerald-300" /> Other tasks</span>
            </div>
          </CardContent>
        </Card>
      )}

      <h3 className="text-xs uppercase tracking-wide text-muted-foreground mt-4 mb-1">Critical chain</h3>
      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground">
            {["#", "WBS", "Task", "Start", "Finish", "Days"].map((h) => <th key={h} className="py-2 px-3 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {criticalPath.chain.map((c, i) => (
              <tr key={`${c.taskNo}-${i}`} className="border-b" data-testid="critical-path-row">
                <td className="py-1.5 px-3 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="py-1.5 px-3 text-muted-foreground tabular-nums">{c.taskNo}</td>
                <td className="py-1.5 px-3">{c.taskName}</td>
                <td className="py-1.5 px-3 whitespace-nowrap">{fmtDate(c.start)}</td>
                <td className="py-1.5 px-3 whitespace-nowrap">{fmtDate(c.end)}</td>
                <td className="py-1.5 px-3 tabular-nums">{c.durationDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>

      <p className="mt-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="mr-1">date-driven</Badge>
        Derived from the imported plan's dates (longest non-overlapping chain to the finish). The
        import has no explicit task dependencies, so this is a schedule-based approximation.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </CardContent></Card>
  );
}
