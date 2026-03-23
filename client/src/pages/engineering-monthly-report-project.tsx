import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2 } from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function EngineeringMonthlyReportProject() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/reports/engineering/monthly/:month/project/:projectId");
  const month = params?.month || "";
  const projectId = params?.projectId || "";

  const { data: report } = useQuery({
    queryKey: ["/api/reports/engineering/monthly", month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/engineering/monthly?month=${month}`, { headers: getAuthHeaders() });
      return res.json();
    },
    enabled: !!month,
  });

  const reportId = report?.id;

  const { data: projectData, isLoading } = useQuery({
    queryKey: ["/api/reports/engineering/monthly/project", reportId, projectId],
    queryFn: async () => {
      const res = await fetch(`/api/reports/engineering/monthly/${reportId}/project/${projectId}`, { headers: getAuthHeaders() });
      return res.json();
    },
    enabled: !!reportId && !!projectId,
  });

  const tasks = projectData?.tasks;
  const deliverables = projectData?.deliverables || [];
  const stages = projectData?.stageGates || [];
  const approvals = projectData?.approvals || [];

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/reports/engineering/monthly?month=${month}`)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-2xl font-bold">Engineering Project Detail</h1>
        <span className="text-sm text-muted-foreground">{month}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[30vh]"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {tasks && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Task Summary — {tasks.projectName}</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Total</p><p className="font-bold">{tasks.totalTasks}</p></div>
                  <div><p className="text-xs text-muted-foreground">Completed</p><p className="font-bold text-emerald-600">{tasks.completed}</p></div>
                  <div><p className="text-xs text-muted-foreground">In Progress</p><p className="font-bold text-blue-600">{tasks.inProgress}</p></div>
                  <div><p className="text-xs text-muted-foreground">Overdue</p><p className="font-bold text-red-600">{tasks.overdue}</p></div>
                  <div><p className="text-xs text-muted-foreground">Done %</p><p className="font-bold">{tasks.completionPct?.toFixed(0)}%</p></div>
                </div>
              </CardContent>
            </Card>
          )}

          {deliverables.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Deliverables ({deliverables.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-3 py-2">Deliverable</th>
                        <th className="text-left px-3 py-2">Type</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-right px-3 py-2">Version</th>
                        <th className="text-left px-3 py-2">Owner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliverables.map((d: any, i: number) => (
                        <tr key={i} className="border-b">
                          <td className="px-3 py-1.5">{d.title}</td>
                          <td className="px-3 py-1.5">{d.type}</td>
                          <td className="px-3 py-1.5"><Badge variant="outline" className="text-[10px]">{d.status}</Badge></td>
                          <td className="px-3 py-1.5 text-right">v{d.currentVersion}</td>
                          <td className="px-3 py-1.5">{d.ownerName || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {stages.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Stage Gates ({stages.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-3 py-2">Stage</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-left px-3 py-2">Started</th>
                        <th className="text-left px-3 py-2">Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stages.map((s: any, i: number) => (
                        <tr key={i} className="border-b">
                          <td className="px-3 py-1.5">{s.stageName}</td>
                          <td className="px-3 py-1.5"><Badge variant="outline" className="text-[10px]">{s.status}</Badge></td>
                          <td className="px-3 py-1.5">{s.startedAt ? new Date(s.startedAt).toLocaleDateString("en-ZA") : "—"}</td>
                          <td className="px-3 py-1.5">{s.completedAt ? new Date(s.completedAt).toLocaleDateString("en-ZA") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {approvals.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Approvals ({approvals.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-3 py-2">Type</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-left px-3 py-2">Approver</th>
                        <th className="text-left px-3 py-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvals.map((a: any, i: number) => (
                        <tr key={i} className="border-b">
                          <td className="px-3 py-1.5">{a.approvalType}</td>
                          <td className="px-3 py-1.5"><Badge variant="outline" className="text-[10px]">{a.status}</Badge></td>
                          <td className="px-3 py-1.5">{a.approverName || "—"}</td>
                          <td className="px-3 py-1.5">{a.date ? new Date(a.date).toLocaleDateString("en-ZA") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {!tasks && deliverables.length === 0 && stages.length === 0 && (
            <p className="text-muted-foreground text-center py-8">No engineering data available for this project.</p>
          )}
        </>
      )}
    </div>
  );
}
