import { useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import KPITileGrid from "@/components/reports/KPITileGrid";
import type { KPITile } from "@/components/reports/KPITileGrid";
import TaskCompletionChart from "@/components/reports/charts/TaskCompletionChart";
import DeliverableStatusChart from "@/components/reports/charts/DeliverableStatusChart";
import ResourceWorkloadChart from "@/components/reports/charts/ResourceWorkloadChart";
import ReportShell from "@/components/reports/shared/ReportShell";
import DrilldownDrawer from "@/components/reports/shared/DrilldownDrawer";

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

function getCurrentMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getPreviousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function humanDate(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-ZA") : "—";
}

function safePct(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
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
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  const isNeutral = diff === 0;
  const isGood = diff > 0;
  return (
    <div className={`inline-flex items-center gap-1 text-xs ${isNeutral ? "text-muted-foreground" : isGood ? "text-emerald-700" : "text-red-700"}`}>
      {isNeutral ? <Minus className="h-3 w-3" /> : isGood ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      <span>{Math.abs(diff).toFixed(0)} vs last month</span>
    </div>
  );
}

function ExceptionTable({ title, rows, columns, emptyLabel = "No exceptions" }: { title: string; rows: any[]; columns: { key: string; label: string; className?: string }[]; emptyLabel?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>{columns.map(c => <th key={c.key} className={`text-left px-3 py-2 font-medium ${c.className || ""}`}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">{emptyLabel}</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                    {columns.map(c => <td key={c.key} className={`px-3 py-1.5 ${c.className || ""}`}>{String(r[c.key] ?? "—")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EngineeringMonthlyReport() {
  const [month, setMonth] = useState(getCurrentMonth);
  const [drill, setDrill] = useState<{ title: string; context: Record<string, any> } | null>(null);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const prevMonth = useMemo(() => getPreviousMonth(month), [month]);

  const { data: report, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/reports/engineering/monthly", month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/engineering/monthly?month=${month}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        const text = await res.text();
        let msg = "Failed to load report";
        try { msg = JSON.parse(text).error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      return res.json();
    },
  });

  const { data: prevReport } = useQuery({
    queryKey: ["/api/reports/engineering/monthly", prevMonth, "previous"],
    queryFn: async () => {
      const res = await fetch(`/api/reports/engineering/monthly?month=${prevMonth}`, { headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!month,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/reports/engineering/monthly", month] });
  }, [queryClient, month]);

  const safeAction = useCallback(async (action: () => Promise<void>, label: string) => {
    try {
      await action();
      invalidate();
      toast({ title: "Success", description: `${label} completed.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || `${label} failed.`, variant: "destructive" });
    }
  }, [invalidate, toast]);

  const reportData = report?.data || {};
  const prevData = prevReport?.data || {};
  const kpis = reportData.kpis || {};
  const prevKpis = prevData.kpis || {};
  const status = report?.status || "draft";
  const reportId = report?.id;
  // Anchor every "> 7 days old" threshold on the report's generation time
  // so published reports stay deterministic. For drafts we fall back to
  // "now" so the dashboard reflects live state.
  const reportNowMs = report?.generatedAt ? new Date(report.generatedAt).getTime() : Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

  const approvals = reportData.approvals || [];
  const stageGates = reportData.stageGates || [];
  const resources = reportData.resources || [];
  const tasksPerProject = reportData.tasks?.perProject || [];
  const deliverableRegister = reportData.deliverables?.register || [];

  const pendingApprovals = approvals.filter((a: any) => String(a.status).toLowerCase() === "pending").length;
  const overdueApprovals = approvals.filter((a: any) => String(a.status).toLowerCase() === "pending" && a.date && (reportNowMs - new Date(a.date).getTime()) > SEVEN_DAYS_MS).length;
  const blockedGates = stageGates.filter((s: any) => String(s.status).toLowerCase() === "blocked").length;
  const overloadedResources = resources.filter((r: any) => r.assignedTasks >= 15 || r.overdue >= 3).length;

  const topBlockedProjects = tasksPerProject
    .filter((r: any) => (r.overdue || 0) > 0)
    .sort((a: any, b: any) => (b.overdue || 0) - (a.overdue || 0))
    .slice(0, 5)
    .map((r: any) => ({ project: r.projectName, overdue: r.overdue, completion: `${(r.completionPct || 0).toFixed(0)}%` }));

  const topOverloadedResources = resources
    .filter((r: any) => r.assignedTasks > 0)
    .sort((a: any, b: any) => (b.assignedTasks + b.overdue * 2) - (a.assignedTasks + a.overdue * 2))
    .slice(0, 5)
    .map((r: any) => ({ engineer: r.resource, assigned: r.assignedTasks, overdue: r.overdue, projects: r.projectCount }));

  const managementInterventions = [
    { item: "Projects with ≥3 overdue engineering tasks", count: tasksPerProject.filter((p: any) => (p.overdue || 0) >= 3).length, owner: "Engineering Managers" },
    { item: "Resources overloaded (>=15 tasks or >=3 overdue)", count: overloadedResources, owner: "Resourcing Lead" },
    { item: "Pending approvals older than 7 days", count: overdueApprovals, owner: "Approvers" },
    { item: "Blocked stage-gates", count: blockedGates, owner: "Project Owners" },
  ].filter((row) => row.count > 0);

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <div className="p-4 md:p-6"><PageError title="Unable to load engineering monthly report" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></div>;

  const kpiTiles: KPITile[] = [
    { label: "Total Eng Tasks", value: kpis.totalEngineeringTasks ?? 0, onClick: () => setDrill({ title: "Engineering Tasks", context: { tab: "tasks" } }) },
    { label: "Done This Month", value: kpis.tasksCompletedThisMonth ?? 0, onClick: () => setDrill({ title: "Tasks Completed This Month", context: { tab: "tasks", metric: "tasksCompletedThisMonth" } }) },
    { label: "Completion %", value: `${(kpis.cumulativeCompletionRate ?? 0).toFixed(0)}%` },
    { label: "Open Blockers", value: kpis.openBlockers ?? 0, color: (kpis.openBlockers ?? 0) > 0 ? "red" as const : "default" as const, onClick: () => setDrill({ title: "Open Blockers", context: { tab: "tasks", metric: "openBlockers" } }) },
    { label: "Submitted", value: kpis.deliverablesSubmitted ?? 0, onClick: () => setDrill({ title: "Submitted Deliverables", context: { tab: "deliverables", status: "NEEDS APPROVAL" } }) },
    { label: "Approved", value: kpis.deliverablesApproved ?? 0, onClick: () => setDrill({ title: "Approved Deliverables", context: { tab: "deliverables", status: "QC APPROVED" } }) },
    { label: "Rejected", value: kpis.deliverablesRejected ?? 0, color: (kpis.deliverablesRejected ?? 0) > 0 ? "red" as const : "default" as const, onClick: () => setDrill({ title: "Rejected Deliverables", context: { tab: "deliverables", status: "PROVIDE FEEDBACK" } }) },
    { label: "Overdue Approvals", value: overdueApprovals, color: overdueApprovals > 0 ? "red" as const : "default" as const, onClick: () => setDrill({ title: "Overdue Approvals", context: { tab: "approvals", status: "pending" } }) },
    { label: "Stage Gates Blocked", value: blockedGates, color: blockedGates > 0 ? "red" as const : "default" as const, onClick: () => setDrill({ title: "Blocked Stage Gates", context: { tab: "stages", status: "blocked" } }) },
    { label: "Resource Overload", value: overloadedResources, color: overloadedResources > 0 ? "red" as const : "default" as const, onClick: () => setDrill({ title: "Overloaded Resources", context: { tab: "tasks" } }) },
  ];

  return (
    <ReportShell
      title="Engineering Monthly Report"
      month={month}
      onMonthChange={setMonth}
      status={status}
      generatedAt={report?.generatedAt}
      regeneratedAt={report?.regeneratedAt}
      reportId={reportId}
      isLoading={isLoading}
      lastImportAt={reportData.meta?.lastImportAt}
      periodType={reportData.meta?.periodType}
      periodStart={reportData.meta?.periodStart}
      periodEnd={reportData.meta?.periodEnd}
      snapshotBehavior={reportData.meta?.snapshotBehavior}
      snapshotFreshness={(report as any)?.freshness}
      onRegenerate={reportId ? () => safeAction(() => apiPost(`/api/reports/engineering/monthly/${reportId}/regenerate`), "Regenerate") : undefined}
      onReview={reportId && status === "draft" ? () => safeAction(() => apiPost(`/api/reports/engineering/monthly/${reportId}/review`), "Review") : undefined}
      onPublish={reportId && status === "reviewed" ? () => safeAction(() => apiPost(`/api/reports/engineering/monthly/${reportId}/publish`), "Publish") : undefined}
      onRevert={reportId && status === "reviewed" ? () => safeAction(() => apiPost(`/api/reports/engineering/monthly/${reportId}/revert`), "Revert") : undefined}
      onExportPdf={reportId ? () => safeAction(() => downloadFile(`/api/reports/engineering/monthly/${reportId}/export/pdf`, `Engineering_Report_${month}.pdf`), "PDF Export") : undefined}
      onExportExcel={reportId ? () => safeAction(() => downloadFile(`/api/reports/engineering/monthly/${reportId}/export/excel`, `Engineering_Report_${month}.xlsx`), "Excel Export") : undefined}
      onCompare={() => navigate(`/reports/engineering/monthly/compare?monthA=${month}`)}
      onHistory={() => navigate("/reports/engineering/monthly/history")}
    >
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {(error as Error).message || "Failed to load report"}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !error && (
        <div className="space-y-4">
          <KPITileGrid tiles={kpiTiles} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">What changed since last month ({prevMonth})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between"><span className="text-sm">Tasks completed this month</span><Delta current={kpis.tasksCompletedThisMonth || 0} previous={prevKpis.tasksCompletedThisMonth || 0} /></div>
                <div className="flex items-center justify-between"><span className="text-sm">Completion %</span><Delta current={kpis.cumulativeCompletionRate || 0} previous={prevKpis.cumulativeCompletionRate || 0} /></div>
                <div className="flex items-center justify-between"><span className="text-sm">Open blockers</span><Delta current={kpis.openBlockers || 0} previous={prevKpis.openBlockers || 0} /></div>
                <div className="flex items-center justify-between"><span className="text-sm">Approved deliverables</span><Delta current={kpis.deliverablesApproved || 0} previous={prevKpis.deliverablesApproved || 0} /></div>
              </CardContent>
            </Card>
            <ExceptionTable
              title="Management intervention needed"
              rows={managementInterventions}
              emptyLabel="No immediate intervention flags."
              columns={[
                { key: "item", label: "Intervention" },
                { key: "count", label: "Count", className: "text-right" },
                { key: "owner", label: "Owner" },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ExceptionTable title="Top blocked projects" rows={topBlockedProjects} columns={[{ key: "project", label: "Project" }, { key: "overdue", label: "Overdue", className: "text-right" }, { key: "completion", label: "Completion", className: "text-right" }]} />
            <ExceptionTable title="Top overloaded resources" rows={topOverloadedResources} columns={[{ key: "engineer", label: "Engineer" }, { key: "assigned", label: "Assigned", className: "text-right" }, { key: "overdue", label: "Overdue", className: "text-right text-red-600" }, { key: "projects", label: "Projects", className: "text-right" }]} />
          </div>

          <Tabs defaultValue="tasks" className="w-full">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
              <TabsTrigger value="stages">Stages</TabsTrigger>
              <TabsTrigger value="resources">Resources</TabsTrigger>
              <TabsTrigger value="approvals">Approvals</TabsTrigger>
            </TabsList>

            <TabsContent value="tasks" className="mt-4">
              <EngTasksTab data={reportData.tasks || {}} reportId={reportId} month={month} setDrill={setDrill} />
            </TabsContent>
            <TabsContent value="deliverables" className="mt-4">
              <DeliverablesTab data={reportData.deliverables || {}} setDrill={setDrill} />
            </TabsContent>
            <TabsContent value="stages" className="mt-4">
              <StagesTab data={stageGates} setDrill={setDrill} />
            </TabsContent>
            <TabsContent value="resources" className="mt-4">
              <ResourcesTab data={resources} setDrill={setDrill} />
            </TabsContent>
            <TabsContent value="approvals" className="mt-4">
              <ApprovalsTab data={approvals} pendingApprovals={pendingApprovals} setDrill={setDrill} />
            </TabsContent>
          </Tabs>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Deliverables with approval bottlenecks</CardTitle></CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground mb-2">Submitted deliverables pending approval for more than 7 days.</div>
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[240px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0"><tr><th className="text-left px-3 py-2">Project</th><th className="text-left px-3 py-2">Deliverable</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Last Update</th></tr></thead>
                    <tbody>
                      {deliverableRegister.filter((d: any) => d.status === "NEEDS APPROVAL" && d.updatedAt && (reportNowMs - new Date(d.updatedAt).getTime()) > SEVEN_DAYS_MS).slice(0, 12).map((d: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setDrill({ title: "Pending approval deliverables", context: { tab: "deliverables", status: "NEEDS APPROVAL", projectId: d.projectId } })}>
                          <td className="px-3 py-1.5">{d.projectName}</td><td className="px-3 py-1.5">{d.title}</td><td className="px-3 py-1.5">{d.type}</td><td className="px-3 py-1.5"><Badge variant="outline" className="text-[10px]">{d.status}</Badge></td><td className="px-3 py-1.5">{humanDate(d.updatedAt)}</td>
                        </tr>
                      ))}
                      {deliverableRegister.filter((d: any) => d.status === "NEEDS APPROVAL" && d.updatedAt && (reportNowMs - new Date(d.updatedAt).getTime()) > SEVEN_DAYS_MS).length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No bottlenecks found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <DrilldownDrawer
        open={!!drill}
        onOpenChange={(o) => !o && setDrill(null)}
        title={drill?.title || "Drill-through"}
        endpoint={reportId ? `/api/reports/engineering/monthly/${reportId}/drilldown` : "/api/reports/engineering/monthly/0/drilldown"}
        context={drill?.context || {}}
      />
    </ReportShell>
  );
}

function EngTasksTab({ data, reportId, month, setDrill }: { data: any; reportId?: number; month: string; setDrill: (v: any) => void }) {
  const [, navigate] = useLocation();
  const perProject = data.perProject || [];
  const slowProjects = [...perProject].sort((a: any, b: any) => (b.overdue || 0) - (a.overdue || 0)).slice(0, 5);

  return (
    <div className="space-y-4">
      <TaskCompletionChart data={perProject} showNotStarted />
      <ExceptionTable title="Biggest blocked / slow projects" rows={slowProjects.map((r: any) => ({ project: r.projectName, overdue: r.overdue, notStarted: r.notStarted, completedThisMonth: r.completedThisMonth }))} columns={[{ key: "project", label: "Project" }, { key: "overdue", label: "Overdue", className: "text-right text-red-600" }, { key: "notStarted", label: "Not started", className: "text-right" }, { key: "completedThisMonth", label: "Completed this month", className: "text-right" }]} />
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0"><tr><th className="text-left px-3 py-2 font-medium">Project</th><th className="text-right px-3 py-2 font-medium">Total</th><th className="text-right px-3 py-2 font-medium">Done</th><th className="text-right px-3 py-2 font-medium">In Progress</th><th className="text-right px-3 py-2 font-medium">Not Started</th><th className="text-right px-3 py-2 font-medium">Overdue</th><th className="text-right px-3 py-2 font-medium">Done %</th><th className="text-right px-3 py-2 font-medium">This Month</th></tr></thead>
            <tbody>
              {perProject.length === 0 ? <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr> : perProject.map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => reportId && navigate(`/reports/engineering/monthly/${month}/project/${r.projectId}`)}>
                  <td className="px-3 py-1.5 font-medium max-w-[220px] truncate">{r.projectName}</td>
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
      <div className="text-xs text-muted-foreground">Tip: click any project row for exact engineering task line-items and provenance.</div>
      <div><button className="text-xs underline" onClick={() => setDrill({ title: "All Engineering Task Rows", context: { tab: "tasks" } })}>Open full task drill-through</button></div>
    </div>
  );
}

function DeliverablesTab({ data, setDrill }: { data: any; setDrill: (v: any) => void }) {
  const activity = data.activity || {};
  const register = data.register || [];
  const byType = Object.entries(register.reduce((acc: Record<string, number>, row: any) => {
    const key = row.type || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 6);

  const resubmissionHotspots = register
    .map((d: any) => ({ ...d, versionsCount: (d.versions || []).length }))
    .filter((d: any) => d.versionsCount > 2)
    .sort((a: any, b: any) => b.versionsCount - a.versionsCount)
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="cursor-pointer" onClick={() => setDrill({ title: "Submitted Deliverables", context: { tab: "deliverables", status: "NEEDS APPROVAL" } })}><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Submitted</p><p className="text-xl font-bold">{activity.submittedThisMonth ?? 0}</p></CardContent></Card>
        <Card className="cursor-pointer" onClick={() => setDrill({ title: "Approved Deliverables", context: { tab: "deliverables", status: "QC APPROVED" } })}><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Approved</p><p className="text-xl font-bold text-emerald-600">{activity.approvedThisMonth ?? 0}</p></CardContent></Card>
        <Card className="cursor-pointer" onClick={() => setDrill({ title: "Rejected Deliverables", context: { tab: "deliverables", status: "PROVIDE FEEDBACK" } })}><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Rejected</p><p className="text-xl font-bold text-red-600">{activity.rejectedThisMonth ?? 0}</p></CardContent></Card>
        <Card className="cursor-pointer" onClick={() => setDrill({ title: "Pending Review Deliverables", context: { tab: "deliverables", status: "NEEDS APPROVAL" } })}><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Pending Review</p><p className="text-xl font-bold text-amber-600">{activity.pendingReview ?? 0}</p></CardContent></Card>
      </div>
      <DeliverableStatusChart data={register} />
      <ExceptionTable title="Resubmission hotspots" rows={resubmissionHotspots.map((d: any) => ({ project: d.projectName, deliverable: d.title, type: d.type, versions: d.versionsCount }))} columns={[{ key: "project", label: "Project" }, { key: "deliverable", label: "Deliverable" }, { key: "type", label: "Type" }, { key: "versions", label: "Versions", className: "text-right" }]} />
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Deliverable type breakdown</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
          {byType.map(([type, count]) => <div key={type} className="border rounded px-2 py-1.5 flex justify-between"><span>{type}</span><span className="font-medium">{String(count)}</span></div>)}
          {byType.length === 0 && <div className="text-muted-foreground">No data</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function StagesTab({ data, setDrill }: { data: any[]; setDrill: (v: any) => void }) {
  const blocked = data.filter((r: any) => r.status === "blocked");
  const longestOpen = [...data].filter((r: any) => r.startedAt && !r.completedAt).sort((a: any, b: any) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()).slice(0, 8);

  return (
    <div className="space-y-4">
      <ExceptionTable title="Blocked gates" rows={blocked.map((r: any) => ({ project: r.projectName, stage: r.stageName, status: r.status }))} columns={[{ key: "project", label: "Project" }, { key: "stage", label: "Stage" }, { key: "status", label: "Status" }]} />
      <ExceptionTable title="Longest-open stage items" rows={longestOpen.map((r: any) => ({ project: r.projectName, stage: r.stageName, started: humanDate(r.startedAt) }))} columns={[{ key: "project", label: "Project" }, { key: "stage", label: "Stage" }, { key: "started", label: "Started" }]} />
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0"><tr><th className="text-left px-3 py-2">Project</th><th className="text-left px-3 py-2">Stage</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Started</th><th className="text-left px-3 py-2">Completed</th></tr></thead>
            <tbody>
              {data.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr> : data.map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setDrill({ title: "Stage Gate Drill-through", context: { tab: "stages", projectId: r.projectId } })}>
                  <td className="px-3 py-1.5">{r.projectName}</td><td className="px-3 py-1.5">{r.stageName}</td><td className="px-3 py-1.5"><Badge variant="outline" className="text-[10px]">{r.status}</Badge></td><td className="px-3 py-1.5">{humanDate(r.startedAt)}</td><td className="px-3 py-1.5">{humanDate(r.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ResourcesTab({ data, setDrill }: { data: any[]; setDrill: (v: any) => void }) {
  return (
    <div className="space-y-4">
      <ResourceWorkloadChart data={data} />
      <ExceptionTable title="Overload / underload flags" rows={data.map((r: any) => ({ engineer: r.resource, assigned: r.assignedTasks, overdue: r.overdue, flag: r.assignedTasks >= 15 || r.overdue >= 3 ? "Overloaded" : r.assignedTasks <= 2 ? "Underloaded" : "Balanced" }))} columns={[{ key: "engineer", label: "Engineer" }, { key: "assigned", label: "Assigned", className: "text-right" }, { key: "overdue", label: "Overdue", className: "text-right" }, { key: "flag", label: "Flag" }]} />
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0"><tr><th className="text-left px-3 py-2">Engineer</th><th className="text-right px-3 py-2">Assigned</th><th className="text-right px-3 py-2">Done This Month</th><th className="text-right px-3 py-2">Overdue</th><th className="text-right px-3 py-2">Projects</th></tr></thead>
            <tbody>
              {data.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr> : data.map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setDrill({ title: `${r.resource} workload details`, context: { tab: "tasks", owner: r.resource } })}>
                  <td className="px-3 py-1.5 font-medium">{r.resource}</td><td className="px-3 py-1.5 text-right">{r.assignedTasks}</td><td className="px-3 py-1.5 text-right text-emerald-600">{r.completedThisMonth}</td><td className="px-3 py-1.5 text-right text-red-600">{r.overdue}</td><td className="px-3 py-1.5 text-right">{r.projectCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ApprovalsTab({ data, pendingApprovals, setDrill }: { data: any[]; pendingApprovals: number; setDrill: (v: any) => void }) {
  const approvedThisMonth = data.filter((r: any) => r.status === "approved" && r.date && new Date(r.date).getMonth() === new Date().getMonth()).length;
  const rejectedThisMonth = data.filter((r: any) => r.status === "rejected" && r.date && new Date(r.date).getMonth() === new Date().getMonth()).length;
  const byApprover = Object.entries(data.reduce((acc: Record<string, number>, row: any) => {
    const key = row.approverName || "Unassigned";
    if (row.status === "pending") acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 8).map(([approver, pending]) => ({ approver, pending }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="cursor-pointer" onClick={() => setDrill({ title: "Pending Approvals", context: { tab: "approvals", status: "pending" } })}><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Pending</p><p className="text-xl font-bold text-amber-700">{pendingApprovals}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Approved this month</p><p className="text-xl font-bold text-emerald-600">{approvedThisMonth}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Rejected this month</p><p className="text-xl font-bold text-red-600">{rejectedThisMonth}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Approval rate</p><p className="text-xl font-bold">{safePct(data.filter((r: any) => r.status === "approved").length, data.length).toFixed(0)}%</p></CardContent></Card>
      </div>
      <ExceptionTable title="Approver bottlenecks (pending count)" rows={byApprover} columns={[{ key: "approver", label: "Approver" }, { key: "pending", label: "Pending", className: "text-right" }]} />
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0"><tr><th className="text-left px-3 py-2">Project</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Approver</th><th className="text-left px-3 py-2">Date</th></tr></thead>
            <tbody>
              {data.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr> : data.map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setDrill({ title: "Approval row detail", context: { tab: "approvals", projectId: r.projectId } })}>
                  <td className="px-3 py-1.5">{r.projectName}</td><td className="px-3 py-1.5">{r.approvalType}</td><td className="px-3 py-1.5"><Badge variant="outline" className="text-[10px]">{r.status}</Badge></td><td className="px-3 py-1.5">{r.approverName || "—"}</td><td className="px-3 py-1.5">{humanDate(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
