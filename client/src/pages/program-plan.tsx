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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fetchQueryFn } from "@/lib/queryClient";
import { styleForCell } from "@/lib/tracker-cell-format";
import { Loader2 } from "lucide-react";

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

export default function ProgramPlanPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);

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
    <div className="p-6 space-y-6" data-testid="program-plan-page">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Program Plan</h1>
        <Badge variant="outline">Tracker replica · Project #{projectId}</Badge>
      </header>

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
                    <TableCell style={styleForCell(t.cellFormat, "title")}>{t.title}</TableCell>
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
    </div>
  );
}
