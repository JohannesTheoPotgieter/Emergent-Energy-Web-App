import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, BarChart3, ArrowLeft, TrendingUp, Users, AlertTriangle, CheckCircle2, XCircle, Copy } from "lucide-react";
import { useLocation } from "wouter";
import { usePermission } from "@/hooks/use-permissions";

function pdFetch(url: string) {
  return fetch(url, { credentials: "include" }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); });
}

function MetricCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={`text-xl font-bold ${color || ""}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 text-right text-muted-foreground truncate">{label}</span>
      <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 font-medium">{value}</span>
    </div>
  );
}

export default function PdReportsPage() {
  const [, navigate] = useLocation();
  const { allowed: canView, loading: permLoading } = usePermission('pd_dashboard', 'view');

  const { data: report, isLoading } = useQuery<any>({
    queryKey: ["/api/pd/reports"],
    queryFn: () => pdFetch("/api/pd/reports"),
  });

  if (!permLoading && !canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full"><CardContent className="py-12 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">You don't have permission to view PD Reports.</p>
        </CardContent></Card>
      </div>
    );
  }

  const copyMetrics = () => {
    if (!report) return;
    const t = report.throughput;
    const h = report.handover;
    const p = report.pipelineHealth;
    const lines = [
      `PD Report — ${report.fyLabel}`,
      ``,
      `THROUGHPUT`,
      `  Created this month: ${t.createdThisMonth}`,
      `  Created FY: ${t.createdFY}`,
      `  Completed this month: ${t.completedThisMonth}`,
      `  Completed FY: ${t.completedFY}`,
      `  Avg handover cycle time: ${t.avgHandoverCycleTimeDays ?? "N/A"} days`,
      ``,
      `PIPELINE HEALTH`,
      `  Active by status: ${Object.entries(p.activeByStatus).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
      `  Overdue: ${p.overdueCount}`,
      ``,
      `HANDOVER`,
      `  Submitted: ${h.submitted}`,
      `  Accepted: ${h.accepted}`,
      `  Rejected: ${h.rejected} (${h.rejectionRate}%)`,
      `  Avg decision time: ${h.avgDecisionTimeDays ?? "N/A"} days`,
      ``,
      `CROSS-FUNCTIONAL`,
      `  Engineering requests: ${report.crossFunctional.engineeringRequests}`,
    ];
    navigator.clipboard.writeText(lines.join("\n"));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report) return null;

  const t = report.throughput;
  const p = report.pipelineHealth;
  const h = report.handover;
  const maxByStatus = Math.max(...Object.values(p.activeByStatus as Record<string, number>), 1);
  const maxByType = Math.max(...Object.values(p.activeByType as Record<string, number>), 1);
  const maxPerMember = Math.max(...Object.values(p.ticketsPerMember as Record<string, number>), 1);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/pd")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-violet-600" />
              PD Reports
            </h1>
            <p className="text-xs text-muted-foreground">{report.fyLabel}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={copyMetrics} className="gap-1.5">
          <Copy className="h-3.5 w-3.5" /> Copy Metrics
        </Button>
      </div>

      {/* Throughput */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Throughput
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard label="Created This Month" value={t.createdThisMonth} />
          <MetricCard label="Created FY" value={t.createdFY} />
          <MetricCard label="Completed This Month" value={t.completedThisMonth} color="text-green-600" />
          <MetricCard label="Completed FY" value={t.completedFY} color="text-green-600" />
          <MetricCard label="Avg Handover Cycle" value={t.avgHandoverCycleTimeDays != null ? `${t.avgHandoverCycleTimeDays}d` : "N/A"} sub="draft → accepted" />
        </div>
        {/* Quarterly breakdown */}
        {t.quarterly && t.quarterly.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs border rounded-lg">
              <thead>
                <tr className="bg-muted/40 border-b text-[11px] text-muted-foreground">
                  <th className="p-2 text-left">Quarter</th>
                  <th className="p-2 text-right">Created</th>
                  <th className="p-2 text-right">Completed</th>
                  <th className="p-2 text-right">Handovers Submitted</th>
                </tr>
              </thead>
              <tbody>
                {t.quarterly.map((q: any) => (
                  <tr key={q.quarter} className="border-b">
                    <td className="p-2 font-medium">{q.quarter}</td>
                    <td className="p-2 text-right">{q.created}</td>
                    <td className="p-2 text-right">{q.completed}</td>
                    <td className="p-2 text-right">{q.submitted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Cycle time by type */}
        {Object.keys(t.avgCycleTimeByType || {}).length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground mb-1">Avg cycle time by request type (days)</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(t.avgCycleTimeByType as Record<string, number>).map(([type, days]) => (
                <Badge key={type} variant="outline" className="text-[10px] gap-1">{type}: <strong>{days}d</strong></Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pipeline Health */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Pipeline Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium mb-2">Active Tickets by Status</p>
              <div className="space-y-1.5">
                {Object.entries(p.activeByStatus as Record<string, number>).map(([status, count]) => (
                  <BarRow key={status} label={status} value={count} max={maxByStatus} color="bg-blue-500" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium mb-2">Active Tickets by Request Type</p>
              <div className="space-y-1.5">
                {Object.entries(p.activeByType as Record<string, number>).map(([type, count]) => (
                  <BarRow key={type} label={type} value={count} max={maxByType} color="bg-violet-500" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <MetricCard label="Overdue Tickets" value={p.overdueCount} color={p.overdueCount > 0 ? "text-red-600" : "text-green-600"} />
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium mb-2 flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Workload Distribution</p>
              <div className="space-y-1.5">
                {Object.entries(p.ticketsPerMember as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                  <BarRow key={name} label={name} value={count} max={maxPerMember} color="bg-amber-500" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Handover Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Handover Metrics</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard label="Submitted" value={h.submitted} />
          <MetricCard label="Accepted" value={h.accepted} color="text-green-600" />
          <MetricCard label="Rejected" value={h.rejected} color={h.rejected > 0 ? "text-red-600" : ""} />
          <MetricCard label="Rejection Rate" value={`${h.rejectionRate}%`} color={h.rejectionRate > 20 ? "text-red-600" : ""} />
          <MetricCard label="Avg Decision Time" value={h.avgDecisionTimeDays != null ? `${h.avgDecisionTimeDays}d` : "N/A"} sub="submission → decision" />
        </div>
        {h.topRejectionReasons && h.topRejectionReasons.length > 0 && (
          <Card className="mt-3">
            <CardContent className="p-4">
              <p className="text-xs font-medium mb-2">Top Rejection Reasons</p>
              <div className="space-y-1.5">
                {h.topRejectionReasons.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    <span className="flex-1 truncate">{r.reason}</span>
                    <Badge variant="secondary" className="text-[10px]">{r.count}x</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Cross-functional */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Cross-functional Demand</h2>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="Engineering Requests" value={report.crossFunctional.engineeringRequests} sub="Active engineering-type tickets" />
        </div>
      </div>
    </div>
  );
}
