import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import ReportHeader from "@/components/reports/ReportHeader";
import KPITileGrid from "@/components/reports/KPITileGrid";
import type { KPITile } from "@/components/reports/KPITileGrid";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getCurrentMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function apiPost(url: string) {
  const res = await fetch(url, { method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function downloadFile(url: string, filename: string) {
  const res = await fetch(url, { headers: getAuthHeaders() });
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

export default function EngineeringMonthlyReport() {
  const [month, setMonth] = useState(getCurrentMonth);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: report, isLoading } = useQuery({
    queryKey: ["/api/reports/engineering/monthly", month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/engineering/monthly?month=${month}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/reports/engineering/monthly", month] });
  }, [queryClient, month]);

  const reportData = report?.data || {};
  const kpis = reportData.kpis || {};
  const status = report?.status || "draft";
  const reportId = report?.id;

  const kpiTiles: KPITile[] = [
    { label: "Eng Tasks", value: kpis.totalEngineeringTasks ?? 0 },
    { label: "Done This Month", value: kpis.tasksCompletedThisMonth ?? 0 },
    { label: "Completion Rate", value: `${(kpis.completionRate ?? 0).toFixed(0)}%` },
    { label: "Approved", value: kpis.deliverablesApproved ?? 0 },
    { label: "Submitted", value: kpis.deliverablesSubmitted ?? 0 },
    { label: "Blockers", value: kpis.openBlockers ?? 0, color: (kpis.openBlockers ?? 0) > 0 ? "red" as const : "default" as const },
  ];

  return (
    <div className="container mx-auto p-6 space-y-4">
      <ReportHeader
        title="Engineering Monthly Report"
        month={month}
        onMonthChange={setMonth}
        status={status}
        generatedAt={report?.generatedAt}
        regeneratedAt={report?.regeneratedAt}
        reportId={reportId}
        isLoading={isLoading}
        onRegenerate={reportId ? async () => { await apiPost(`/api/reports/engineering/monthly/${reportId}/regenerate`); invalidate(); } : undefined}
        onReview={reportId && status === "draft" ? async () => { await apiPost(`/api/reports/engineering/monthly/${reportId}/review`); invalidate(); } : undefined}
        onPublish={reportId && status === "reviewed" ? async () => { await apiPost(`/api/reports/engineering/monthly/${reportId}/publish`); invalidate(); } : undefined}
        onRevert={reportId && status === "reviewed" ? async () => { await apiPost(`/api/reports/engineering/monthly/${reportId}/revert`); invalidate(); } : undefined}
        onExportPdf={reportId ? () => downloadFile(`/api/reports/engineering/monthly/${reportId}/export/pdf`, `Engineering_Report_${month}.pdf`) : undefined}
        onExportExcel={reportId ? () => downloadFile(`/api/reports/engineering/monthly/${reportId}/export/excel`, `Engineering_Report_${month}.xlsx`) : undefined}
        onCompare={() => navigate(`/reports/engineering/monthly/compare?monthA=${month}`)}
        onHistory={() => navigate("/reports/engineering/monthly/history")}
      />

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <KPITileGrid tiles={kpiTiles} />

          <Tabs defaultValue="tasks" className="w-full">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
              <TabsTrigger value="stages">Stages</TabsTrigger>
              <TabsTrigger value="resources">Resources</TabsTrigger>
              <TabsTrigger value="approvals">Approvals</TabsTrigger>
            </TabsList>

            <TabsContent value="tasks" className="mt-4">
              <EngTasksTab data={reportData.tasks || {}} reportId={reportId} month={month} />
            </TabsContent>

            <TabsContent value="deliverables" className="mt-4 space-y-4">
              <DeliverablesTab data={reportData.deliverables || {}} />
            </TabsContent>

            <TabsContent value="stages" className="mt-4">
              <StagesTab data={reportData.stageGates || []} />
            </TabsContent>

            <TabsContent value="resources" className="mt-4">
              <ResourcesTab data={reportData.resources || []} />
            </TabsContent>

            <TabsContent value="approvals" className="mt-4">
              <ApprovalsTab data={reportData.approvals || []} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function EngTasksTab({ data, reportId, month }: { data: any; reportId?: number; month: string }) {
  const [, navigate] = useLocation();
  const perProject = data.perProject || [];

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Project</th>
              <th className="text-right px-3 py-2 font-medium">Total</th>
              <th className="text-right px-3 py-2 font-medium">Done</th>
              <th className="text-right px-3 py-2 font-medium">In Progress</th>
              <th className="text-right px-3 py-2 font-medium">Not Started</th>
              <th className="text-right px-3 py-2 font-medium">Overdue</th>
              <th className="text-right px-3 py-2 font-medium">Done %</th>
              <th className="text-right px-3 py-2 font-medium">This Month</th>
            </tr>
          </thead>
          <tbody>
            {perProject.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
            ) : perProject.map((r: any, i: number) => (
              <tr
                key={i}
                className="border-b hover:bg-muted/30 cursor-pointer"
                onClick={() => reportId && navigate(`/reports/engineering/monthly/${month}/project/${r.projectId}`)}
              >
                <td className="px-3 py-1.5 font-medium max-w-[180px] truncate">{r.projectName}</td>
                <td className="px-3 py-1.5 text-right">{r.totalTasks}</td>
                <td className="px-3 py-1.5 text-right text-emerald-600">{r.completed}</td>
                <td className="px-3 py-1.5 text-right text-blue-600">{r.inProgress}</td>
                <td className="px-3 py-1.5 text-right">{r.notStarted}</td>
                <td className="px-3 py-1.5 text-right text-red-600">{r.overdue}</td>
                <td className="px-3 py-1.5 text-right">{r.completionPct?.toFixed(0)}%</td>
                <td className="px-3 py-1.5 text-right text-blue-600">{r.completedThisMonth}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeliverablesTab({ data }: { data: any }) {
  const activity = data.activity || {};

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Submitted</p>
          <p className="text-xl font-bold">{activity.submittedThisMonth ?? 0}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Approved</p>
          <p className="text-xl font-bold text-emerald-600">{activity.approvedThisMonth ?? 0}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Rejected</p>
          <p className="text-xl font-bold text-red-600">{activity.rejectedThisMonth ?? 0}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Pending Review</p>
          <p className="text-xl font-bold text-amber-600">{activity.pendingReview ?? 0}</p>
        </CardContent></Card>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Deliverable</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Version</th>
                <th className="text-left px-3 py-2 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody>
              {(data.register || []).length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
              ) : (data.register || []).map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-1.5 max-w-[140px] truncate">{r.projectName}</td>
                  <td className="px-3 py-1.5 max-w-[160px] truncate">{r.title}</td>
                  <td className="px-3 py-1.5">{r.type}</td>
                  <td className="px-3 py-1.5">
                    <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right">v{r.currentVersion}</td>
                  <td className="px-3 py-1.5">{r.ownerName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function StagesTab({ data }: { data: any[] }) {
  const statusColors: Record<string, string> = {
    complete: "text-emerald-700 bg-emerald-50 border-emerald-200",
    in_progress: "text-blue-700 bg-blue-50 border-blue-200",
    not_started: "text-slate-500 bg-slate-50 border-slate-200",
    blocked: "text-red-700 bg-red-50 border-red-200",
    ready_for_review: "text-amber-700 bg-amber-50 border-amber-200",
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Project</th>
              <th className="text-left px-3 py-2 font-medium">Stage</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Started</th>
              <th className="text-left px-3 py-2 font-medium">Completed</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
            ) : data.map((r: any, i: number) => (
              <tr key={i} className={`border-b hover:bg-muted/30 ${r.completedThisMonth ? "bg-emerald-50/30" : ""}`}>
                <td className="px-3 py-1.5">{r.projectName}</td>
                <td className="px-3 py-1.5">{r.stageName}</td>
                <td className="px-3 py-1.5">
                  <Badge variant="outline" className={`text-[10px] ${statusColors[r.status] || ""}`}>{r.status}</Badge>
                </td>
                <td className="px-3 py-1.5">{r.startedAt ? new Date(r.startedAt).toLocaleDateString("en-ZA") : "—"}</td>
                <td className="px-3 py-1.5">{r.completedAt ? new Date(r.completedAt).toLocaleDateString("en-ZA") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResourcesTab({ data }: { data: any[] }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Engineer</th>
              <th className="text-right px-3 py-2 font-medium">Assigned</th>
              <th className="text-right px-3 py-2 font-medium">Done This Month</th>
              <th className="text-right px-3 py-2 font-medium">Overdue</th>
              <th className="text-right px-3 py-2 font-medium">Projects</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
            ) : data.map((r: any, i: number) => (
              <tr key={i} className="border-b hover:bg-muted/30">
                <td className="px-3 py-1.5 font-medium">{r.resource}</td>
                <td className="px-3 py-1.5 text-right">{r.assignedTasks}</td>
                <td className="px-3 py-1.5 text-right text-emerald-600">{r.completedThisMonth}</td>
                <td className="px-3 py-1.5 text-right text-red-600">{r.overdue}</td>
                <td className="px-3 py-1.5 text-right">{r.projectCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApprovalsTab({ data }: { data: any[] }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Project</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Approver</th>
              <th className="text-left px-3 py-2 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
            ) : data.map((r: any, i: number) => (
              <tr key={i} className="border-b hover:bg-muted/30">
                <td className="px-3 py-1.5">{r.projectName}</td>
                <td className="px-3 py-1.5">{r.approvalType}</td>
                <td className="px-3 py-1.5">
                  <Badge variant="outline" className={`text-[10px] ${
                    r.status === "approved" ? "text-emerald-700 bg-emerald-50" :
                    r.status === "rejected" ? "text-red-700 bg-red-50" :
                    "text-amber-700 bg-amber-50"
                  }`}>{r.status}</Badge>
                </td>
                <td className="px-3 py-1.5">{r.approverName || "—"}</td>
                <td className="px-3 py-1.5">{r.date ? new Date(r.date).toLocaleDateString("en-ZA") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
