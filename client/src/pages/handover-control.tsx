// Site / Execution Controls — Execution enablement and handover controls
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

function daysUntil(dateValue?: string | null): number | null {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}

function rowColour(row: any): string {
  const status = row.handover_status || "DRAFT";
  if (status === "HANDOVER_COMPLETE" && row.kickoff_date) return "bg-emerald-50/50";
  if (status === "DRAFT" || status === "SUBMITTED_FOR_PM_REVIEW") return "bg-amber-50/30";
  const days = daysBetween(row.updated_at);
  if (days > 7) return "bg-rose-50/30";
  return "";
}

function countOpenRisks(formData: any): number {
  if (!formData || typeof formData !== "object") return 0;
  const risks = formData.risksTable;
  return Array.isArray(risks) ? risks.length : 0;
}

const STATUS_DISPLAY: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED_FOR_PM_REVIEW: "Submitted for PM Review",
  ACCEPTED: "Accepted",
  REJECTED: "Returned for Rework",
  HANDOVER_COMPLETE: "Handover Complete",
};

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
      complete: rows.filter((r) => r.handover_status === "HANDOVER_COMPLETE").length,
      stale: rows.filter((r) => daysBetween(r.updated_at) > 7 && r.handover_status !== "HANDOVER_COMPLETE").length,
    };
  }, [data]);

  return (
    <PageShell className="p-4 md:p-6" data-testid="handover-control-page">
      <SectionHeader icon={<Handshake className="h-5 w-5" />} title="Handover Health Score" description="COO view: execution enablement, handover controls, and health scoring." />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-semibold">{totals.total}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Waiting PM</p><p className="text-xl font-semibold">{totals.pending}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Overdue review</p><p className="text-xl font-semibold text-red-600">{totals.overdue}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">No tracker</p><p className="text-xl font-semibold text-amber-600">{totals.noTracker}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Complete</p><p className="text-xl font-semibold text-emerald-600">{totals.complete}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Stale (7d+)</p><p className="text-xl font-semibold text-rose-600">{totals.stale}</p></CardContent></Card>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading handover control view...</p> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Failed to load handover index.</div> : null}

      <div className="border rounded-xl overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left">
              {['Project','Client','PD','PM','Status','Days','Readiness','Risks','Kickoff','Lessons','Deliverables','Tracker','Exec','Next Action','Owner','Open'].map((h) => (
                <th key={h} className="p-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((row) => {
              const days = daysBetween(row.updated_at || row.submitted_date);
              const formData = typeof row.handover_form_data === "string" ? JSON.parse(row.handover_form_data || "{}") : (row.handover_form_data || {});
              const openRisks = countOpenRisks(formData);
              const daysToKickoff = daysUntil(row.kickoff_date);
              const readinessScore = row.readiness_score ?? 0;
              const lessonsReviewed = row.lessons_reviewed === true;
              return (
                <tr key={row.project_id} className={`border-t ${rowColour(row)}`}>
                  <td className="p-2 font-medium">{row.project_name}</td>
                  <td className="p-2">{row.client_name || '—'}</td>
                  <td className="p-2">{row.pd_owner || row.pd || '—'}</td>
                  <td className="p-2">{row.pm_owner || row.pm || '—'}</td>
                  <td className="p-2"><Badge variant="outline" className="text-[10px]">{STATUS_DISPLAY[row.handover_status] || row.handover_status || 'Draft'}</Badge></td>
                  <td className="p-2">{days}d</td>
                  <td className="p-2">
                    <span className={readinessScore === 100 ? "text-emerald-700" : readinessScore > 0 ? "text-amber-700" : "text-muted-foreground"}>
                      {readinessScore}%
                    </span>
                  </td>
                  <td className="p-2">{openRisks > 0 ? <span className="text-rose-600">{openRisks}</span> : "0"}</td>
                  <td className="p-2 whitespace-nowrap">{daysToKickoff !== null ? `${daysToKickoff}d` : '—'}</td>
                  <td className="p-2">{lessonsReviewed ? <span className="text-emerald-600">Y</span> : <span className="text-muted-foreground">N</span>}</td>
                  <td className="p-2">{row.deliverables_complete ? 'Yes' : 'No'}</td>
                  <td className="p-2">{row.tracker_linked ? 'Yes' : 'No'}</td>
                  <td className="p-2">{row.execution_enabled ? 'Yes' : 'No'}</td>
                  <td className="p-2 max-w-[150px] truncate" title={row.next_action || ''}>{row.next_action || '—'}</td>
                  <td className="p-2">{row.action_owner || '—'}</td>
                  <td className="p-2 whitespace-nowrap">
                    <Link href={`/pd/handover/${row.project_id}`} className="text-blue-600 underline">Detail</Link>
                    {" · "}
                    <Link href={`/handover/${row.project_id}/live`} className="text-primary underline" data-testid={`live-room-${row.project_id}`}>Live room</Link>
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
