import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RagBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import type { BoardResult, BoardRow } from "@/lib/execution-types";
import { fmtPct, fmtDate } from "@/lib/execution-types";

interface Filters {
  search: string;
  phase: string;
  rag: string;
  pm: string;
  hasFlags: boolean;
}
const DEFAULT_FILTERS: Filters = { search: "", phase: "all", rag: "all", pm: "all", hasFlags: false };
const LS_KEY = "execution-board-filters";
const LS_GROUP = "execution-board-group-by-pm";

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ScheduleCell({ row }: { row: BoardRow }) {
  if (!row.schedule.hasPlan) {
    return <span className="text-muted-foreground" title="No imported program plan">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <RagBadge rag={row.schedule.rag} dotOnly showLabel={false} />
      <span className="tabular-nums">{fmtPct(row.schedule.actualPct)}/{fmtPct(row.schedule.expectedPct)}</span>
    </span>
  );
}

function Row({ row, onOpen }: { row: BoardRow; onOpen: (id: number) => void }) {
  return (
    <tr
      className="border-b hover:bg-muted/40 cursor-pointer"
      onClick={() => onOpen(row.projectId)}
      data-testid={`execution-row-${row.projectId}`}
    >
      <td className="py-2 pr-3 font-medium">{row.projectName}</td>
      <td className="py-2 pr-3 text-muted-foreground">{row.phase ?? "—"}</td>
      <td className="py-2 pr-3"><ScheduleCell row={row} /></td>
      <td className="py-2 pr-3">
        {row.nextTask ? (
          <span className="whitespace-nowrap">{row.nextTask.taskName} · {fmtDate(row.nextTask.date)}</span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2 pr-3">
        {row.nextDelivery ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <RagBadge rag={row.nextDelivery.rag} dotOnly showLabel={false} />
            {row.nextDelivery.label} · {fmtDate(row.nextDelivery.date)}
          </span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2 pr-3">
        {row.installers.count > 0 ? (
          <span title={row.installers.list.map((i) => i.name).join(", ")}>
            {row.installers.primary}{row.installers.count > 1 ? ` +${row.installers.count - 1}` : ""}
          </span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2 pr-3">{row.pmName ?? <span className="text-muted-foreground">—</span>}</td>
      <td className="py-2 pr-3"><RagBadge rag={row.engineering.rag} dotOnly showLabel={false} /></td>
      <td className="py-2 pr-3"><RagBadge rag={row.quality.rag} dotOnly showLabel={false} /></td>
      <td className="py-2 pr-1 tabular-nums">
        {row.flags.open + row.flags.flagged}/{row.flags.actioned}
      </td>
    </tr>
  );
}

const HEAD = ["Site", "Phase", "Sched", "Next task ·14d", "Next delivery", "Installer", "PM", "Eng", "QA", "Flags"];

export default function ExecutionReviewBoard() {
  const [, navigate] = useLocation();
  const { data, isLoading, isError, refetch } = useQuery<BoardResult>({
    queryKey: ["/api/execution-review/board"],
  });

  const [filters, setFilters] = useState<Filters>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? { ...DEFAULT_FILTERS, ...JSON.parse(raw) } : DEFAULT_FILTERS;
    } catch {
      return DEFAULT_FILTERS;
    }
  });
  const [groupByPm, setGroupByPm] = useState<boolean>(() => localStorage.getItem(LS_GROUP) === "1");

  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(filters)); }, [filters]);
  useEffect(() => { localStorage.setItem(LS_GROUP, groupByPm ? "1" : "0"); }, [groupByPm]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const phases = useMemo(() => [...new Set(rows.map((r) => r.phase).filter(Boolean))] as string[], [rows]);
  const pms = useMemo(() => [...new Set(rows.map((r) => r.pmName).filter(Boolean))] as string[], [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filters.search && !r.projectName.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.phase !== "all" && r.phase !== filters.phase) return false;
    if (filters.rag !== "all" && r.schedule.rag !== filters.rag) return false;
    if (filters.pm !== "all" && r.pmName !== filters.pm) return false;
    if (filters.hasFlags && r.flags.open + r.flags.flagged === 0) return false;
    return true;
  }), [rows, filters]);

  const byPm = useMemo(() => {
    const m = new Map<string, BoardRow[]>();
    for (const r of filtered) {
      const k = r.pmName ?? "Unassigned";
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const open = (id: number) => navigate(`/execution/site/${id}`);
  const h = data?.header;

  return (
    <PageShell className="max-w-7xl p-4 md:p-6" data-testid="execution-board-page">
      <PageHeader
        title="Execution"
        subtitle="Program-wide delivery control tower · schedule read verbatim from the latest imported program plan"
      />

      {h && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
          <Kpi label="Active sites" value={h.activeCount} />
          <Kpi label="Behind (red)" value={h.ragRed} tone={h.ragRed > 0 ? "text-red-600" : ""} />
          <Kpi label="Overdue deliveries" value={h.overdueDeliveries} tone={h.overdueDeliveries > 0 ? "text-amber-600" : ""} />
          <Kpi label="Open flags" value={h.openFlags} />
          <Kpi label="Prog actual/exp" value={`${fmtPct(h.weightedActual)}/${fmtPct(h.weightedExpected)}`} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Input
          className="w-48"
          placeholder="Search site…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          data-testid="execution-search"
        />
        <Select value={filters.phase} onValueChange={(v) => setFilters((f) => ({ ...f, phase: v }))}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Phase" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All phases</SelectItem>
            {phases.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.rag} onValueChange={(v) => setFilters((f) => ({ ...f, rag: v }))}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Schedule RAG" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All RAG</SelectItem>
            <SelectItem value="red">Red</SelectItem>
            <SelectItem value="amber">Amber</SelectItem>
            <SelectItem value="green">Green</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.pm} onValueChange={(v) => setFilters((f) => ({ ...f, pm: v }))}>
          <SelectTrigger className="w-40"><SelectValue placeholder="PM" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All PMs</SelectItem>
            {pms.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          variant={filters.hasFlags ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters((f) => ({ ...f, hasFlags: !f.hasFlags }))}
        >
          Has flags
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant={groupByPm ? "default" : "outline"} size="sm" onClick={() => setGroupByPm((v) => !v)}>
            Group by PM
          </Button>
        </div>
      </div>

      <Card className="mt-3">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Could not load the board. <Button variant="link" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No active sites match these filters.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {HEAD.map((hd) => <th key={hd} className="py-2 pr-3 font-medium">{hd}</th>)}
                </tr>
              </thead>
              <tbody>
                {groupByPm
                  ? byPm.map(([pm, prs]) => (
                      <Fragment key={`g-${pm}`}>
                        <tr className="bg-muted/30">
                          <td colSpan={HEAD.length} className="py-1.5 px-2 text-xs font-medium">
                            {pm} — {prs.length} active · {prs.filter((r) => r.schedule.rag === "red").length} behind
                          </td>
                        </tr>
                        {prs.map((r) => <Row key={r.projectId} row={r} onOpen={open} />)}
                      </Fragment>
                    ))
                  : filtered.map((r) => <Row key={r.projectId} row={r} onOpen={open} />)}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="mr-1">as imported</Badge>
        Schedule = actual%/expected%, duration-weighted from the latest tracker import. Flags = open/actioned.
      </p>
    </PageShell>
  );
}
