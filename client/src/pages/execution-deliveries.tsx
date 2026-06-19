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
import type { DeliveryProgramRow } from "@/lib/execution-types";
import { fmtDate } from "@/lib/execution-types";

export default function ExecutionDeliveries() {
  const [, navigate] = useLocation();
  const [overdueOnly, setOverdueOnly] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery<DeliveryProgramRow[]>({
    queryKey: ["/api/execution-review/program/deliveries"],
  });

  const rows = useMemo(
    () => (data ?? []).filter((r) => (overdueOnly ? r.overdue : true)),
    [data, overdueOnly],
  );

  return (
    <PageShell className="max-w-4xl p-4 md:p-6" data-testid="execution-deliveries-page">
      <PageHeader title="Deliveries" subtitle="Open procurement & delivery milestones across all active sites" />
      <div className="flex gap-2 mt-3">
        <Button size="sm" variant={overdueOnly ? "default" : "outline"} onClick={() => setOverdueOnly((v) => !v)}>
          Overdue only
        </Button>
      </div>
      <Card className="mt-4"><CardContent className="p-0 overflow-x-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : isError ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Could not load. <Button variant="link" onClick={() => refetch()}>Retry</Button></p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No deliveries scheduled.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              {["Site", "Item", "Source", "Date", ""].map((h) => <th key={h} className="py-2 px-3 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.projectId}-${r.source}-${i}`} className="border-b hover:bg-muted/40 cursor-pointer"
                  onClick={() => navigate(`/execution/site/${r.projectId}`)}>
                  <td className="py-2 px-3 font-medium">{r.projectName}</td>
                  <td className="py-2 px-3">{r.label}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.source}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5"><RagBadge rag={r.rag} dotOnly showLabel={false} />{fmtDate(r.date)}</span>
                  </td>
                  <td className="py-2 px-3">{r.overdue ? <Badge variant="destructive">overdue</Badge> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent></Card>
    </PageShell>
  );
}
