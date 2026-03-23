import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import RAGBadge from "@/components/reports/RAGBadge";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function PmMonthlyReportProject() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/reports/pm/monthly/:month/project/:projectId");
  const month = params?.month || "";
  const projectId = params?.projectId || "";

  // First load the main report to get the snapshot ID
  const { data: report } = useQuery({
    queryKey: ["/api/reports/pm/monthly", month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/pm/monthly?month=${month}`, { headers: getAuthHeaders() });
      return res.json();
    },
    enabled: !!month,
  });

  const reportId = report?.id;

  const { data: projectData, isLoading } = useQuery({
    queryKey: ["/api/reports/pm/monthly/project", reportId, projectId],
    queryFn: async () => {
      const res = await fetch(`/api/reports/pm/monthly/${reportId}/project/${projectId}`, { headers: getAuthHeaders() });
      return res.json();
    },
    enabled: !!reportId && !!projectId,
  });

  const ps = projectData?.projectStatus;
  const fin = projectData?.financials || {};
  const tasks = projectData?.tasks;
  const raids = projectData?.raidItems || [];
  const quality = projectData?.quality;
  const procurement = projectData?.procurement || [];

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/reports/pm/monthly?month=${month}`)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-2xl font-bold">{ps?.projectName || "Project Detail"}</h1>
        <span className="text-sm text-muted-foreground">{month}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[30vh]"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !ps ? (
        <p className="text-muted-foreground">No data available for this project.</p>
      ) : (
        <>
          {/* Project Header */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Phase</p><p className="font-medium">{ps.phase || "—"}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">RAG</p><RAGBadge status={ps.ragStatus} /></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">PM</p><p className="font-medium text-sm">{ps.pm || "—"}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Health</p><p className="font-medium">{ps.healthScore?.toFixed(1) || "—"}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Size</p><p className="font-medium">{ps.sizeKwp || "—"} kWp</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Client</p><p className="font-medium text-sm">{ps.clientName || "—"}</p></CardContent></Card>
          </div>

          {/* Financials */}
          {fin.revenue && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Financial Summary</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Revenue</p><p className="font-mono">R {(fin.revenue?.totalInvoiced || 0).toLocaleString("en-ZA", { maximumFractionDigits: 2 })}</p></div>
                  <div><p className="text-xs text-muted-foreground">Cost</p><p className="font-mono">R {(fin.cost?.actualCost || 0).toLocaleString("en-ZA", { maximumFractionDigits: 2 })}</p></div>
                  <div><p className="text-xs text-muted-foreground">Gross Profit</p><p className="font-mono">R {(fin.grossProfit?.grossProfit || 0).toLocaleString("en-ZA", { maximumFractionDigits: 2 })}</p></div>
                  <div><p className="text-xs text-muted-foreground">GP %</p><p className="font-medium">{(fin.grossProfit?.gpMarginPct || 0).toFixed(1)}%</p></div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tasks */}
          {tasks && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Tasks</CardTitle></CardHeader>
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

          {/* RAID */}
          {raids.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">RAID Items ({raids.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {raids.map((r: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs p-2 border rounded">
                      <span className="uppercase text-[10px] font-medium text-muted-foreground w-16">{r.type}</span>
                      <div className="flex-1">
                        <p className="font-medium">{r.title}</p>
                        {r.mitigation && <p className="text-muted-foreground mt-0.5">{r.mitigation}</p>}
                      </div>
                      <span className="text-[10px]">{r.priority}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* QC */}
          {quality && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Quality</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Applicable Items</p><p className="font-bold">{quality.itemsApplicable}</p></div>
                  <div><p className="text-xs text-muted-foreground">Approved</p><p className="font-bold text-emerald-600">{quality.itemsApproved}</p></div>
                  <div><p className="text-xs text-muted-foreground">Progress</p><p className="font-bold">{quality.progressPct?.toFixed(1)}%</p></div>
                  <div><p className="text-xs text-muted-foreground">Warnings</p><p className="font-bold text-red-600">{quality.openWarnings}</p></div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Procurement */}
          {procurement.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Procurement ({procurement.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-3 py-2">Item</th>
                        <th className="text-left px-3 py-2">Category</th>
                        <th className="text-right px-3 py-2">Cost</th>
                        <th className="text-left px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {procurement.map((p: any, i: number) => (
                        <tr key={i} className="border-b">
                          <td className="px-3 py-1.5">{p.title}</td>
                          <td className="px-3 py-1.5">{p.category}</td>
                          <td className="px-3 py-1.5 text-right font-mono">R {(p.actualCost || p.expectedCost || 0).toLocaleString()}</td>
                          <td className="px-3 py-1.5">{p.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
