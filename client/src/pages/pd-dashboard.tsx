import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileEdit, Plus, AlertTriangle, Clock, CheckCircle2, PauseCircle, FileStack } from "lucide-react";
import { useLocation } from "wouter";
import { usePermission } from "@/hooks/use-permissions";

function pdFetch(url: string) {
  return fetch(url, { credentials: "include" }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); });
}

export default function PdDashboardPage() {
  const [, navigate] = useLocation();
  const { allowed: canView, loading: permLoading } = usePermission('pd_dashboard', 'view');
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
        <Button onClick={() => navigate("/pd/tickets/create")} className="gap-1.5" data-testid="btn-create-pd-ticket">
          <Plus className="h-4 w-4" /> New PD Ticket
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Total", value: stats?.total || 0, icon: FileStack, color: "text-gray-700 bg-gray-100" },
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

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Tickets</h2>
          <Button variant="link" size="sm" onClick={() => navigate("/pd/tickets")} data-testid="link-view-all-tickets">View all</Button>
        </div>
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
                    <Badge className={`text-[10px] shrink-0 ${statusColor(t.status)}`}>{t.status}</Badge>
                    <Badge className={`text-[10px] shrink-0 ${priorityColor(t.priority)}`}>{t.priority}</Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function statusColor(s: string) {
  if (s === "Completed") return "bg-green-100 text-green-700";
  if (s === "In Progress") return "bg-blue-100 text-blue-700";
  if (s === "On Hold") return "bg-orange-100 text-orange-700";
  if (s === "Cancelled") return "bg-gray-100 text-gray-500";
  return "bg-gray-100 text-gray-700";
}

function priorityColor(p: string) {
  if (p === "Critical") return "bg-red-100 text-red-700";
  if (p === "High") return "bg-orange-100 text-orange-700";
  if (p === "Low") return "bg-green-100 text-green-700";
  return "bg-blue-100 text-blue-700";
}
