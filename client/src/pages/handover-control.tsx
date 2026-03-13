import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Handshake } from "lucide-react";

function daysBetween(dateValue?: string | null): number {
  if (!dateValue) return 0;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

export default function HandoverControlPage() {
  const { data, isLoading, error } = useQuery<{ items: any[] }>({
    queryKey: ["/api/pd-pm-handover/control"],
  });

  const totals = useMemo(() => {
    const rows = data?.items || [];
    return {
      total: rows.length,
      pending: rows.filter((r) => r.handover_status === "SUBMITTED_FOR_PM_REVIEW").length,
      overdue: rows.filter((r) => r.handover_status === "SUBMITTED_FOR_PM_REVIEW" && daysBetween(r.submitted_date || r.updated_at) > 5).length,
      noTracker: rows.filter((r) => r.handover_status === "ACCEPTED" && !r.tracker_linked).length,
    };
  }, [data]);

  return (
    <PageShell className="p-4 md:p-6" data-testid="handover-control-page">
      <SectionHeader icon={<Handshake className="h-5 w-5" />} title="PD→PM Handover Control" description="Operational tracker for handover readiness and execution enablement." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Total handovers</p><p className="text-xl font-semibold">{totals.total}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Waiting PM review</p><p className="text-xl font-semibold">{totals.pending}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Overdue review</p><p className="text-xl font-semibold text-red-600">{totals.overdue}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Accepted, no tracker</p><p className="text-xl font-semibold text-amber-600">{totals.noTracker}</p></CardContent></Card>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading handover control view...</p> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Failed to load handover index.</div> : null}

      <div className="border rounded-xl overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left">
              {['Project','Client','PD owner','PM owner','Handover status','Submitted date','Days in status','Rejection reason','Deliverables complete','Tracker linked','Execution enabled','Next action','Action owner','Open'].map((h) => (
                <th key={h} className="p-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((row) => {
              const days = daysBetween(row.status_updated_at || row.updated_at || row.submitted_date);
              return (
                <tr key={row.project_id} className="border-t">
                  <td className="p-2 font-medium">{row.project_name}</td>
                  <td className="p-2">{row.client_name || '—'}</td>
                  <td className="p-2">{row.pd_owner || row.pd || '—'}</td>
                  <td className="p-2">{row.pm_owner || row.pm || '—'}</td>
                  <td className="p-2"><Badge variant="outline">{row.handover_status || 'DRAFT'}</Badge></td>
                  <td className="p-2">{row.submitted_date ? new Date(row.submitted_date).toLocaleDateString() : '—'}</td>
                  <td className="p-2">{days}</td>
                  <td className="p-2 max-w-[180px] truncate" title={row.rejection_reason || ''}>{row.rejection_reason || '—'}</td>
                  <td className="p-2">{row.deliverables_complete ? 'Yes' : 'No'}</td>
                  <td className="p-2">{row.tracker_linked ? 'Yes' : 'No'}</td>
                  <td className="p-2">{row.execution_enabled ? 'Yes' : 'No'}</td>
                  <td className="p-2 max-w-[180px] truncate" title={row.next_action || ''}>{row.next_action || '—'}</td>
                  <td className="p-2">{row.action_owner || '—'}</td>
                  <td className="p-2 whitespace-nowrap">
                    <Link href={`/pd/handover/${row.project_id}`} className="text-blue-600 underline">PD Detail</Link>
                    <span className="mx-1">·</span>
                    <Link href="/pm/handover-review" className="text-blue-600 underline">PM Queue</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
