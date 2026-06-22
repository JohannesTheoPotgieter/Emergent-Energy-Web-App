import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RagBadge } from "@/components/ui/status-badge";
import { Download } from "lucide-react";
import type { DeliveryProgramRow } from "@/lib/execution-types";
import { fmtDate, parseExecDate } from "@/lib/execution-types";
import { useTableSort, SortHeader, downloadCsv } from "@/lib/table-utils";

const SOURCE_LABEL: Record<DeliveryProgramRow["source"], string> = {
  milestone: "milestone",
  procurement: "procurement",
  task: "plan task",
};

function deliverySortValue(r: DeliveryProgramRow, key: string): string | number | null {
  switch (key) {
    case "site": return r.projectName.toLowerCase();
    case "item": return r.label.toLowerCase();
    case "source": return SOURCE_LABEL[r.source];
    case "date": { const d = parseExecDate(r.date); return d ? d.getTime() : null; }
    case "status": return r.complete ? 2 : r.overdue ? 0 : 1; // overdue first
    default: return null;
  }
}

export default function ExecutionDeliveries() {
  const [, navigate] = useLocation();
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery<DeliveryProgramRow[]>({
    queryKey: ["/api/execution-review/program/deliveries"],
  });

  const rows = useMemo(
    () => (data ?? []).filter((r) => {
      if (overdueOnly && !r.overdue) return false;
      if (hideCompleted && r.complete) return false;
      return true;
    }),
    [data, overdueOnly, hideCompleted],
  );
  const { sorted, sort, toggle } = useTableSort(rows, deliverySortValue);

  const exportCsv = () => downloadCsv(
    "execution-deliveries",
    ["Site", "Item", "Source", "Date", "Status"],
    sorted.map((r) => [r.projectName, r.label, SOURCE_LABEL[r.source], r.date ?? "", r.complete ? "done" : r.overdue ? "overdue" : "open"]),
  );

  return (
    <PageShell className="max-w-4xl p-4 md:p-6" data-testid="execution-deliveries-page">
      <PageHeader title="Deliveries" subtitle="Procurement, delivery milestones & plan tasks named “delivery” across all active sites" />
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Button size="sm" variant={overdueOnly ? "default" : "outline"} onClick={() => setOverdueOnly((v) => !v)} data-testid="deliveries-overdue-only">
          Overdue only
        </Button>
        <Button size="sm" variant={hideCompleted ? "default" : "outline"} onClick={() => setHideCompleted((v) => !v)} data-testid="deliveries-hide-completed">
          Hide completed
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{rows.length} of {data?.length ?? 0}</span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv} disabled={rows.length === 0} data-testid="deliveries-export">
            <Download className="w-4 h-4" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>
      <Card className="mt-4"><CardContent className="p-0 overflow-x-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : isError ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Could not load. <Button variant="link" onClick={() => refetch()}>Retry</Button></p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No deliveries match these filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <SortHeader label="Site" sortKey="site" sort={sort} onSort={toggle} />
              <SortHeader label="Item" sortKey="item" sort={sort} onSort={toggle} />
              <SortHeader label="Source" sortKey="source" sort={sort} onSort={toggle} />
              <SortHeader label="Date" sortKey="date" sort={sort} onSort={toggle} />
              <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} />
            </tr></thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={`${r.projectId}-${r.source}-${i}`} className="border-b hover:bg-muted/40 cursor-pointer"
                  onClick={() => navigate(`/execution/site/${r.projectId}`)} data-testid="deliveries-row">
                  <td className="py-2 px-3 font-medium">{r.projectName}</td>
                  <td className={`py-2 px-3 ${r.complete ? "text-muted-foreground line-through" : ""}`}>{r.label}</td>
                  <td className="py-2 px-3 text-muted-foreground">{SOURCE_LABEL[r.source]}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5"><RagBadge rag={r.rag} dotOnly showLabel={false} />{fmtDate(r.date)}</span>
                  </td>
                  <td className="py-2 px-3">
                    {r.complete ? <Badge variant="secondary">done</Badge> : r.overdue ? <Badge variant="destructive">overdue</Badge> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent></Card>
    </PageShell>
  );
}
