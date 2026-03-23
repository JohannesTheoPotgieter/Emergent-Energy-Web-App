import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileEdit, Plus, AlertTriangle, Clock, CheckCircle2, PauseCircle, FileStack, Send, XCircle, LayoutGrid, List, BarChart3 } from "lucide-react";
import { statusColorClasses, priorityColorClasses } from "@/lib/status-colors";
import { useLocation } from "wouter";
import { usePermission } from "@/hooks/use-permissions";

function pdFetch(url: string) {
  return fetch(url, { credentials: "include" }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); });
}

const KANBAN_COLUMN_COLORS: Record<string, string> = {
  "New": "border-t-slate-400",
  "In Progress": "border-t-blue-500",
  "Under Review": "border-t-amber-500",
  "Ready for Handover": "border-t-violet-500",
  "Handed Over": "border-t-green-500",
};

export default function PdDashboardPage() {
  const [, navigate] = useLocation();
  const { allowed: canView, loading: permLoading } = usePermission('pd_dashboard', 'view');
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");

  const { data: stats, isLoading } = useQuery<{
    total: number; active: number; overdue: number; dueThisWeek: number; onHold: number; completed: number;
  }>({
    queryKey: ["/api/pd/dashboard"],
    queryFn: () => pdFetch("/api/pd/dashboard"),
  });

  const { data: tickets = [] } = useQuery<any[]>({
    queryKey: ["/api/pd/tickets"],
    queryFn: () => pdFetch("/api/pd/tickets"),
  });

  const recentTickets = tickets.slice(0, 8);

  const { data: pipeline, isLoading: pipelineLoading } = useQuery<{
    tickets: any[];
    byStatus: Record<string, { count: number; tickets: any[] }>;
    byRequestType: Record<string, number>;
    overdue: { week: any[]; twoWeeks: any[]; month: any[] };
    handoverSummary: { notStarted: number; draft: number; submitted: number; accepted: number; rejected: number };
    totalPipelineValue: number;
    kanbanColumns: string[];
  }>({
    queryKey: ["/api/pd/pipeline"],
    queryFn: () => pdFetch("/api/pd/pipeline"),
    staleTime: 30_000,
  });

  const { data: handoverControl } = useQuery<{ items: any[] }>({
    queryKey: ["/api/pd-pm-handover/control"],
    queryFn: () => pdFetch("/api/pd-pm-handover/control"),
    staleTime: 60_000,
  });

  const handoverStats = (() => {
    const items = handoverControl?.items || [];
    const awaitingPmReview = items.filter(i => i.handover_status === "SUBMITTED_FOR_PM_REVIEW").length;
    const rejected = items.filter(i => i.handover_status === "REJECTED").length;
    const drafts = items.filter(i => i.handover_status === "DRAFT").length;
    const accepted = items.filter(i => i.handover_status === "ACCEPTED").length;
    const overdueReview = items.filter(i => i.handover_status === "SUBMITTED_FOR_PM_REVIEW" && i.days_in_status > 5).length;
    return { awaitingPmReview, rejected, drafts, accepted, overdueReview, total: items.length };
  })();

  if (!permLoading && !canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full"><CardContent className="py-12 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">You don't have permission to view the PD Dashboard.</p>
        </CardContent></Card>
      </div>
    );
  }

  const totalOverdue = pipeline ? pipeline.overdue.week.length + pipeline.overdue.twoWeeks.length + pipeline.overdue.month.length : 0;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="pd-dashboard-title">
            <FileEdit className="h-6 w-6 text-violet-600" />
            Project Development
          </h1>
          <p className="text-sm text-muted-foreground mt-1">PD ticket overview and quick actions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/pd/reports")} className="gap-1.5">
            <BarChart3 className="h-4 w-4" /> Reports
          </Button>
          <Button onClick={() => navigate("/pd/tickets/create")} className="gap-1.5" data-testid="btn-create-pd-ticket">
            <Plus className="h-4 w-4" /> New PD Ticket
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Total", value: stats?.total || 0, icon: FileStack, color: "text-foreground bg-muted" },
            { label: "Active", value: stats?.active || 0, icon: FileEdit, color: "text-blue-700 bg-blue-100" },
            { label: "Overdue", value: stats?.overdue || 0, icon: AlertTriangle, color: "text-red-700 bg-red-100" },
            { label: "Due This Week", value: stats?.dueThisWeek || 0, icon: Clock, color: "text-amber-700 bg-amber-100" },
            { label: "On Hold", value: stats?.onHold || 0, icon: PauseCircle, color: "text-orange-700 bg-orange-100" },
            { label: "Completed", value: stats?.completed || 0, icon: CheckCircle2, color: "text-green-700 bg-green-100" },
          ].map(card => (
            <Card key={card.label} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate("/pd/tickets")} data-testid={`pd-stat-${card.label.toLowerCase().replace(/\s/g, "-")}`}>
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
      )}

      {/* Pipeline Summary */}
      {pipeline && !pipelineLoading && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Pipeline Summary</h2>
            {pipeline.totalPipelineValue > 0 && (
              <Badge variant="outline" className="text-sm gap-1 font-semibold">
                Pipeline Value: R {pipeline.totalPipelineValue.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(pipeline.kanbanColumns || []).map(col => {
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
          {/* Request type breakdown */}
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(pipeline.byRequestType).filter(([, v]) => v > 0).map(([type, count]) => (
              <Badge key={type} variant="outline" className="text-[10px] gap-1">
                {type}: <strong>{count}</strong>
              </Badge>
            ))}
          </div>
          {/* Overdue highlights */}
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

      {handoverStats.total > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Handover Readiness</h2>
            <Button variant="link" size="sm" onClick={() => navigate("/handover-control")} data-testid="link-handover-control">View control center</Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Drafts (PD action)", value: handoverStats.drafts, icon: FileEdit, color: "text-slate-700 bg-slate-100" },
              { label: "Awaiting PM Review", value: handoverStats.awaitingPmReview, icon: Send, color: "text-blue-700 bg-blue-100" },
              { label: "Overdue Review (>5d)", value: handoverStats.overdueReview, icon: AlertTriangle, color: "text-red-700 bg-red-100" },
              { label: "Accepted", value: handoverStats.accepted, icon: CheckCircle2, color: "text-green-700 bg-green-100" },
            ].map(card => (
              <Card key={card.label} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate("/handover-control")} data-testid={`handover-stat-${card.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}>
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
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-700" data-testid="handover-rejected-alert">
              <XCircle className="h-4 w-4 shrink-0" />
              <span><strong>{handoverStats.rejected}</strong> handover{handoverStats.rejected !== 1 ? "s" : ""} rejected — PD action required to address feedback and resubmit.</span>
            </div>
          )}
        </div>
      )}

      {/* View toggle + tickets */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{viewMode === "kanban" ? "Pipeline Board" : "Recent Tickets"}</h2>
          <div className="flex items-center gap-2">
            <div className="flex border rounded-md overflow-hidden">
              <button
                className={`px-2.5 py-1 text-xs flex items-center gap-1 ${viewMode === "list" ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
                onClick={() => setViewMode("list")}
              >
                <List className="h-3.5 w-3.5" /> Table
              </button>
              <button
                className={`px-2.5 py-1 text-xs flex items-center gap-1 border-l ${viewMode === "kanban" ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
                onClick={() => setViewMode("kanban")}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Kanban
              </button>
            </div>
            <Button variant="link" size="sm" onClick={() => navigate("/pd/tickets")} data-testid="link-view-all-tickets">View all</Button>
          </div>
        </div>

        {viewMode === "kanban" && pipeline ? (
          <div className="overflow-x-auto">
            <div className="flex gap-3 min-w-[900px] pb-4">
              {(pipeline.kanbanColumns || []).map(col => {
                const colTickets = pipeline.byStatus[col]?.tickets || [];
                return (
                  <div key={col} className={`flex-1 min-w-[180px] bg-muted/30 rounded-lg border-t-4 ${KANBAN_COLUMN_COLORS[col] || "border-t-gray-300"}`}>
                    <div className="p-2.5 flex items-center justify-between">
                      <span className="text-xs font-semibold">{col}</span>
                      <Badge variant="secondary" className="text-[10px]">{colTickets.length}</Badge>
                    </div>
                    <div className="px-2 pb-2 space-y-2 max-h-[500px] overflow-y-auto">
                      {colTickets.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground text-center py-4">No tickets</p>
                      ) : colTickets.map((t: any) => (
                        <Card key={t.id} className="hover:shadow-sm cursor-pointer transition-shadow" onClick={() => navigate(`/pd/tickets/${t.id}`)}>
                          <CardContent className="p-2.5 space-y-1">
                            <p className="text-xs font-medium truncate">{t.projectSiteName}</p>
                            <div className="flex items-center gap-1 flex-wrap">
                              <Badge variant="outline" className="text-[9px]">{t.requestType}</Badge>
                              <Badge className={`text-[9px] ${priorityColorClasses(t.priority)}`}>{t.priority}</Badge>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span>{t.clientName || "No client"}</span>
                              <span>{t.daysInStage}d</span>
                            </div>
                            {t.developerName && <p className="text-[10px] text-muted-foreground truncate">{t.developerName}</p>}
                            {t.isOverdue && (
                              <Badge variant="destructive" className="text-[9px]">Overdue</Badge>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {recentTickets.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <FileEdit className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="font-medium">No PD tickets yet</p>
                  <p className="text-sm mt-1">Create your first PD ticket to get started</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-2">
                {recentTickets.map((row: any) => {
                  const t = row.ticket;
                  const today = new Date().toISOString().split("T")[0];
                  const overdue = t.dueDate && t.dueDate < today && t.status !== "Completed" && t.status !== "Cancelled";
                  return (
                    <Card key={t.id} className="hover:shadow-sm cursor-pointer transition-shadow" onClick={() => navigate(`/pd/tickets/${t.id}`)} data-testid={`pd-ticket-row-${t.id}`}>
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm truncate">{t.projectSiteName}</span>
                            <Badge className="text-[10px]" variant="outline">{t.requestType}</Badge>
                            {overdue && <Badge className="text-[10px] bg-red-100 text-red-700">Overdue</Badge>}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                            {row.clientName && <span>{row.clientName}</span>}
                            {row.projectName && <span>· {row.projectName}</span>}
                            {row.developerName && <span>· {row.developerName}</span>}
                          </div>
                        </div>
                        {row.taskTotal > 0 && (
                          <div className="flex items-center gap-1 shrink-0">
                            <div className="w-10 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full ${row.taskCompleted === row.taskTotal ? "bg-green-500" : row.taskCompleted > 0 ? "bg-blue-500" : "bg-gray-300"}`}
                                style={{ width: `${Math.round((row.taskCompleted / row.taskTotal) * 100)}%` }}
                              />
                            </div>
                            <span className="text-[9px] text-muted-foreground">{row.taskCompleted}/{row.taskTotal}</span>
                          </div>
                        )}
                        <Badge className={`text-[10px] shrink-0 ${statusColorClasses(t.status)}`}>{t.status}</Badge>
                        <Badge className={`text-[10px] shrink-0 ${priorityColorClasses(t.priority)}`}>{t.priority}</Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
