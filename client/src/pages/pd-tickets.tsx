import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  FileEdit,
  FileStack,
  Handshake,
  PauseCircle,
  Plus,
  Send,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useLocation } from "wouter";
import { usePermission } from "@/hooks/use-permissions";

/**
 * Project Development Dashboard (lean).
 *
 * KPI cards + PD work queue + handover readiness only. The full ticket list
 * and the active opportunities list have been merged into /opportunities —
 * this page is now an at-a-glance overview. KPI card clicks navigate to
 * /opportunities with a status filter.
 */
async function pdFetch(url: string) {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(body?.error || `Request to ${url} failed (${r.status}).`);
  }
  return body;
}

const KANBAN_COLUMN_COLORS: Record<string, string> = {
  "New": "border-t-slate-400",
  "In Progress": "border-t-blue-500",
  "Under Review": "border-t-amber-500",
  "Ready for Handover": "border-t-violet-500",
  "Handed Over": "border-t-green-500",
};

export default function PdTicketsPage() {
  const [, navigate] = useLocation();
  const { allowed: canView, loading: permLoading } = usePermission("pd_dashboard", "view");

  const { data: stats } = useQuery<{
    total: number;
    active: number;
    overdue: number;
    dueThisWeek: number;
    onHold: number;
    completed: number;
  }>({
    queryKey: ["/api/pd/dashboard"],
    queryFn: () => pdFetch("/api/pd/dashboard"),
    enabled: canView,
  });

  const { data: pipeline } = useQuery<{
    tickets: unknown[];
    byStatus: Record<string, { count: number; tickets: unknown[] }>;
    byRequestType: Record<string, number>;
    overdue: { week: unknown[]; twoWeeks: unknown[]; month: unknown[] };
    totalPipelineValue: number;
    kanbanColumns: string[];
  }>({
    queryKey: ["/api/pd/pipeline"],
    queryFn: () => pdFetch("/api/pd/pipeline"),
    staleTime: 30_000,
    enabled: canView,
  });

  const { data: handoverControl } = useQuery<{
    items: Array<{ handover_status: string; days_in_status: number }>;
  }>({
    queryKey: ["/api/pd-pm-handover/control"],
    queryFn: () => pdFetch("/api/pd-pm-handover/control"),
    staleTime: 60_000,
    enabled: canView,
  });

  const handoverStats = (() => {
    const items = handoverControl?.items || [];
    const awaitingPmReview = items.filter((i) => i.handover_status === "SUBMITTED_FOR_PM_REVIEW").length;
    const rejected = items.filter((i) => i.handover_status === "REJECTED").length;
    const drafts = items.filter((i) => i.handover_status === "DRAFT").length;
    const accepted = items.filter((i) => i.handover_status === "ACCEPTED").length;
    const overdueReview = items.filter(
      (i) => i.handover_status === "SUBMITTED_FOR_PM_REVIEW" && i.days_in_status > 5,
    ).length;
    return { awaitingPmReview, rejected, drafts, accepted, overdueReview, total: items.length };
  })();

  const totalOverdue = pipeline
    ? pipeline.overdue.week.length + pipeline.overdue.twoWeeks.length + pipeline.overdue.month.length
    : 0;

  if (!permLoading && !canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to view Project Development.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const goToOpportunities = (status?: string) => {
    const url = status && status !== "all" ? `/opportunities?status=${encodeURIComponent(status)}` : "/opportunities";
    navigate(url);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="pd-dashboard-title">
            <FileEdit className="h-6 w-6 text-violet-600" />
            Project Development Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            At-a-glance view of the PD work queue and handover readiness. The full ticket + opportunity list lives on{" "}
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={() => goToOpportunities()}
            >
              Pipeline / Opportunities
            </button>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/pd/reports")} className="gap-1.5">
            <BarChart3 className="h-4 w-4" /> Reports
          </Button>
          <Button onClick={() => navigate("/pd/tickets/create")} className="gap-1.5" data-testid="btn-create-ticket">
            <Plus className="h-4 w-4" /> New Ticket
          </Button>
        </div>
      </div>

      {/* KPI cards — click through to the merged Opportunities page */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total", value: stats?.total || 0, icon: FileStack, color: "text-foreground bg-muted", statusFilter: "all" },
          { label: "Active", value: stats?.active || 0, icon: FileEdit, color: "text-blue-700 bg-blue-100", statusFilter: "In Progress" },
          { label: "Overdue", value: stats?.overdue || 0, icon: AlertTriangle, color: "text-red-700 bg-red-100", statusFilter: "all" },
          { label: "Due This Week", value: stats?.dueThisWeek || 0, icon: Clock, color: "text-amber-700 bg-amber-100", statusFilter: "all" },
          { label: "On Hold", value: stats?.onHold || 0, icon: PauseCircle, color: "text-orange-700 bg-orange-100", statusFilter: "On Hold" },
          { label: "Completed", value: stats?.completed || 0, icon: CheckCircle2, color: "text-green-700 bg-green-100", statusFilter: "Completed" },
        ].map((card) => (
          <Card
            key={card.label}
            className="hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => goToOpportunities(card.statusFilter)}
            data-testid={`pd-stat-${card.label.toLowerCase().replace(/\s/g, "-")}`}
          >
            <CardContent className="p-4 flex flex-col items-center text-center gap-1">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${card.color}`}>
                <card.icon className="h-5 w-5" />
              </div>
              <span className="text-2xl font-bold">{card.value}</span>
              <span className="text-[11px] text-muted-foreground">{card.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* PD work queue (kanban column summary) */}
      {pipeline && pipeline.kanbanColumns && pipeline.kanbanColumns.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-600" />
              PD work queue
            </h2>
            {pipeline.totalPipelineValue > 0 && (
              <Badge variant="outline" className="text-sm gap-1 font-semibold">
                Tickets value: R{" "}
                {pipeline.totalPipelineValue.toLocaleString("en-ZA", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {pipeline.kanbanColumns.map((col) => {
              const data = pipeline.byStatus[col];
              return (
                <Card key={col} className={`border-t-4 ${KANBAN_COLUMN_COLORS[col] || "border-t-gray-300"}`}>
                  <CardContent className="p-3">
                    <p className="text-[11px] text-muted-foreground font-medium">{col}</p>
                    <span className="text-2xl font-bold">{data?.count || 0}</span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {totalOverdue > 0 && (
            <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{totalOverdue}</strong> overdue ticket{totalOverdue !== 1 ? "s" : ""}:
                {pipeline.overdue.week.length > 0 && ` ${pipeline.overdue.week.length} this week,`}
                {pipeline.overdue.twoWeeks.length > 0 && ` ${pipeline.overdue.twoWeeks.length} (1-2 weeks),`}
                {pipeline.overdue.month.length > 0 && ` ${pipeline.overdue.month.length} (2+ weeks)`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* PD → PM handover readiness */}
      {handoverStats.total > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Handshake className="h-4 w-4 text-amber-600" />
              PD → PM handover readiness
            </h2>
            <Button
              variant="link"
              size="sm"
              onClick={() => navigate("/handover-control")}
              data-testid="link-handover-control"
            >
              View handover control
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Drafts (PD action)", value: handoverStats.drafts, icon: FileEdit, color: "text-slate-700 bg-slate-100" },
              { label: "Awaiting PM Review", value: handoverStats.awaitingPmReview, icon: Send, color: "text-blue-700 bg-blue-100" },
              { label: "Overdue Review (>5d)", value: handoverStats.overdueReview, icon: AlertTriangle, color: "text-red-700 bg-red-100" },
              { label: "Accepted", value: handoverStats.accepted, icon: CheckCircle2, color: "text-green-700 bg-green-100" },
            ].map((card) => (
              <Card
                key={card.label}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate("/handover-control")}
                data-testid={`handover-stat-${card.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${card.color}`}>
                    <card.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-xl font-bold">{card.value}</span>
                    <p className="text-[10px] text-muted-foreground leading-tight">{card.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {handoverStats.rejected > 0 && (
            <div
              className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-700"
              data-testid="handover-rejected-alert"
            >
              <XCircle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{handoverStats.rejected}</strong> handover
                {handoverStats.rejected !== 1 ? "s" : ""} returned for rework — PD action required to address feedback and resubmit.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
