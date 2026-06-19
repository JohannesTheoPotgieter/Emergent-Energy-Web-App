import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { UpcomingProgramRow } from "@/lib/execution-types";
import { fmtDate } from "@/lib/execution-types";

export default function ExecutionUpcoming() {
  const [, navigate] = useLocation();
  const [days, setDays] = useState(14);
  const { data, isLoading, isError, refetch } = useQuery<UpcomingProgramRow[]>({
    // Single-string key so the default queryFn (queryKey.join("/")) builds a
    // clean URL with the query string, not ".../upcoming/?daysOut=14".
    queryKey: [`/api/execution-review/program/upcoming?daysOut=${days}`],
  });

  const byDay = useMemo(() => {
    const m = new Map<string, UpcomingProgramRow[]>();
    for (const r of data ?? []) {
      const key = r.date ? fmtDate(r.date) : "Undated";
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return [...m.entries()];
  }, [data]);

  return (
    <PageShell className="max-w-4xl p-4 md:p-6" data-testid="execution-upcoming-page">
      <PageHeader title="This fortnight" subtitle="Plan tasks starting soon across all active sites" />
      <div className="flex gap-2 mt-3">
        {[14, 30].map((d) => (
          <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
            {d} days
          </Button>
        ))}
      </div>
      <div className="mt-4 space-y-4">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Could not load. <Button variant="link" onClick={() => refetch()}>Retry</Button></p>
        ) : byDay.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled in this window.</p>
        ) : (
          byDay.map(([day, rows]) => (
            <div key={day}>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{day}</h3>
              <Card><CardContent className="p-0">
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.projectId}-${r.taskNo}-${i}`} className="border-b hover:bg-muted/40 cursor-pointer"
                        onClick={() => navigate(`/execution/site/${r.projectId}`)}>
                        <td className="py-2 px-3 font-medium">{r.projectName}</td>
                        <td className="py-2 px-3">{r.taskName}{r.isMilestone ? <Badge variant="outline" className="ml-2">◆</Badge> : null}</td>
                        <td className="py-2 px-3 text-muted-foreground text-xs">{r.taskNo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent></Card>
            </div>
          ))
        )}
      </div>
    </PageShell>
  );
}
