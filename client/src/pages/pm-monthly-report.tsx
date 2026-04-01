import { useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import KPITileGrid from "@/components/reports/KPITileGrid";
import RAGBadge from "@/components/reports/RAGBadge";
import type { KPITile } from "@/components/reports/KPITileGrid";
import RevenueTrendChart from "@/components/reports/charts/RevenueTrendChart";
import CashflowTrendChart from "@/components/reports/charts/CashflowTrendChart";
import RAGDistributionChart from "@/components/reports/charts/RAGDistributionChart";
import TaskCompletionChart from "@/components/reports/charts/TaskCompletionChart";
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

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `R ${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `R ${(val / 1_000).toFixed(0)}K`;
  return `R ${val.toFixed(0)}`;
}

function fmtMoney(v: number): string {
  return `R ${(v || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getCurrentMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  return { dateFrom: start, dateTo: end };
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
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
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

function TrendChip({ delta }: { delta?: number }) {
  const val = Number(delta || 0);
  const positive = val >= 0;
  return (
    <Badge variant="outline" className={positive ? "text-emerald-700" : "text-red-700"}>
      {positive ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
      {positive ? "+" : ""}{val.toFixed(1)}%
    </Badge>
  );
}

export default function PmMonthlyReport() {
  const [month, setMonth] = useState(getCurrentMonth);
  const [drill, setDrill] = useState<{ title: string; context: Record<string, any> } | null>(null);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const previousMonth = prevMonth(month);

  const { data: report, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/reports/pm/monthly", month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/pm/monthly?month=${month}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        const text = await res.text();
        let msg = "Failed to load report";
        try { msg = JSON.parse(text).error || msg; } catch {}
        throw new Error(msg);
      }
      return res.json();
    },
  });

  const { data: compare } = useQuery({
    queryKey: ["/api/reports/pm/monthly/compare", previousMonth, month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/pm/monthly/compare?monthA=${previousMonth}&monthB=${month}`, { headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/reports/pm/monthly", month] });
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
  const kpis = reportData.kpis || {};
  const status = report?.status || "draft";
  const reportId = report?.id;

  const summary = useMemo(() => {
    const tasks = reportData.tasks?.programmeMetrics || {};
    const raid = reportData.raidItems || {};
    const quality = reportData.quality?.qcProgress || [];
    const procurement = reportData.procurement || [];
    const openWarnings = quality.reduce((sum: number, q: any) => sum + Number(q.openWarnings || 0), 0);
    const procurementAtRisk = procurement.filter((p: any) => ["late", "blocked"].includes(String(p.status || "").toLowerCase())).length;
    return {
      activeProjects: kpis.activeProjects || 0,
      revenueThisMonth: reportData.financials?.revenueSummary?.reduce((s: number, r: any) => s + Number(r.invoicedThisMonth || 0), 0) || 0,
      costThisMonth: reportData.financials?.costSummary?.reduce((s: number, r: any) => s + Number(r.costsThisMonth || 0), 0) || 0,
      blendedGp: Number(kpis.blendedGpMarginPct || 0),
      projectsAtRisk: kpis.projectsAtRisk || 0,
      overdueTasks: tasks.overdueTasks || 0,
      openRaidCount: (raid.items || []).length,
      openQualityWarnings: openWarnings,
      procurementAtRisk,
      stale: !!reportData.meta?.isStale,
    };
  }, [kpis, reportData]);

  const topAttentionItems = useMemo(() => {
    const riskProjects = (reportData.projectStatus || []).filter((p: any) => ["RED", "AMBER"].includes(String(p.ragStatus || "").toUpperCase()));
    const marginMovers = [...(reportData.financials?.grossProfit || [])]
      .sort((a: any, b: any) => Number(a.gpMarginPct || 0) - Number(b.gpMarginPct || 0))
      .slice(0, 3)
      .map((r: any) => `${r.projectName}: ${r.gpMarginPct?.toFixed(1)}% GP`);
    const overdue = (reportData.tasks?.perProject || [])
      .sort((a: any, b: any) => Number(b.overdue || 0) - Number(a.overdue || 0))
      .slice(0, 2)
      .map((t: any) => `${t.projectName}: ${t.overdue} overdue tasks`);

    return [
      ...marginMovers,
      ...overdue,
      ...riskProjects.slice(0, 2).map((p: any) => `${p.projectName}: ${p.ragStatus} status`),
    ].slice(0, 5);
  }, [reportData]);

  const managementActions = useMemo(() => {
    const actions: string[] = [];
    if (summary.projectsAtRisk > 0) actions.push("Escalate RED/AMBER projects in this week’s management review.");
    if (summary.overdueTasks > 0) actions.push("Re-baseline overdue task owners and enforce recovery dates.");
    if (summary.procurementAtRisk > 0) actions.push("Prioritize supplier unblock actions for late/blocked procurement lines.");
    if (summary.openQualityWarnings > 0) actions.push("Assign closure owners for open quality warnings.");
    if (summary.stale) actions.push("Refresh import pipeline before board pack is finalized.");
    return actions.slice(0, 5);
  }, [summary]);

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <div className="p-4 md:p-6"><PageError title="Unable to load PM monthly report" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></div>;

  const kpiTiles: KPITile[] = [
    { label: "Active Projects", value: summary.activeProjects, onClick: () => setDrill({ title: "Active Projects", context: { tab: "projects" } }) },
    { label: "Revenue This Month", value: formatCurrency(summary.revenueThisMonth), onClick: () => setDrill({ title: "Revenue This Month", context: { tab: "financial", metric: "revenueBridge", ...monthRange(month) } }) },
    { label: "Cost This Month", value: formatCurrency(summary.costThisMonth), onClick: () => setDrill({ title: "Cost This Month", context: { tab: "financial", metric: "costBridge", ...monthRange(month) } }) },
    { label: "Blended GP %", value: `${summary.blendedGp.toFixed(1)}%`, onClick: () => setDrill({ title: "GP Bridge", context: { tab: "financial", metric: "gpBridge", ...monthRange(month) } }) },
    { label: "Projects At Risk", value: summary.projectsAtRisk, color: summary.projectsAtRisk > 0 ? "red" : "default", onClick: () => setDrill({ title: "Projects At Risk", context: { tab: "projects", status: "at-risk" } }) },
    { label: "Overdue Tasks", value: summary.overdueTasks, color: summary.overdueTasks > 0 ? "red" : "default", onClick: () => setDrill({ title: "Overdue Tasks", context: { tab: "tasks", status: "overdue" } }) },
    { label: "Open RAID", value: summary.openRaidCount, onClick: () => setDrill({ title: "Open RAID", context: { tab: "raid", status: "open" } }) },
    { label: "Quality Warnings", value: summary.openQualityWarnings, color: summary.openQualityWarnings > 0 ? "amber" : "default", onClick: () => setDrill({ title: "Quality Warnings", context: { tab: "quality", status: "open" } }) },
    { label: "Procurement At Risk", value: summary.procurementAtRisk, color: summary.procurementAtRisk > 0 ? "amber" : "default", onClick: () => setDrill({ title: "Procurement At Risk", context: { tab: "procurement", status: "blocked" } }) },
    { label: "Stale Data", value: summary.stale ? "Yes" : "No", color: summary.stale ? "amber" : "green", onClick: () => setDrill({ title: "Data Freshness Detail", context: { tab: "projects" } }) },
  ];

  return (
    <ReportShell
      title="PM Monthly Report"
      month={month}
      onMonthChange={setMonth}
      status={status}
      generatedAt={report?.generatedAt}
      regeneratedAt={report?.regeneratedAt}
      reportId={reportId}
      isLoading={isLoading}
      isStale={reportData.meta?.isStale}
      daysSinceImport={reportData.meta?.daysSinceImport}
      stalenessThresholdDays={reportData.meta?.stalenessThresholdDays}
      lastImportAt={reportData.meta?.lastImportAt}
      periodType={reportData.meta?.periodType}
      periodStart={reportData.meta?.periodStart}
      periodEnd={reportData.meta?.periodEnd}
      snapshotBehavior={reportData.meta?.snapshotBehavior}
      onRegenerate={reportId ? () => safeAction(() => apiPost(`/api/reports/pm/monthly/${reportId}/regenerate`), "Regenerate") : undefined}
      onReview={reportId && status === "draft" ? () => safeAction(() => apiPost(`/api/reports/pm/monthly/${reportId}/review`), "Review") : undefined}
      onPublish={reportId && status === "reviewed" ? () => safeAction(() => apiPost(`/api/reports/pm/monthly/${reportId}/publish`), "Publish") : undefined}
      onRevert={reportId && status === "reviewed" ? () => safeAction(() => apiPost(`/api/reports/pm/monthly/${reportId}/revert`), "Revert") : undefined}
      onExportPdf={reportId ? () => safeAction(() => downloadFile(`/api/reports/pm/monthly/${reportId}/export/pdf`, `PM_Report_${month}.pdf`), "PDF Export") : undefined}
      onExportExcel={reportId ? () => safeAction(() => downloadFile(`/api/reports/pm/monthly/${reportId}/export/excel`, `PM_Report_${month}.xlsx`), "Excel Export") : undefined}
      onCompare={() => navigate(`/reports/pm/monthly/compare?monthA=${month}`)}
      onHistory={() => navigate("/reports/pm/monthly/history")}
    >
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {(error as Error).message || "Failed to load report"}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !error && (
        <>
          <KPITileGrid tiles={kpiTiles} />

          <div className="grid lg:grid-cols-3 gap-3">
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Trend vs Previous Month ({previousMonth})</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex items-center justify-between"><span>Revenue</span><TrendChip delta={compare?.deltas?.totalRevenue?.pct} /></div>
                <div className="flex items-center justify-between"><span>Cost</span><TrendChip delta={compare?.deltas?.totalCost?.pct} /></div>
                <div className="flex items-center justify-between"><span>GP Margin</span><TrendChip delta={compare?.deltas?.blendedGpMarginPct?.pct} /></div>
                <div className="flex items-center justify-between"><span>At-risk Projects</span><TrendChip delta={compare?.deltas?.projectsAtRisk?.pct} /></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Top 5 Attention Items</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-1">
                {topAttentionItems.length === 0 ? <p className="text-muted-foreground">No critical exceptions this month.</p> : topAttentionItems.map((i, idx) => <p key={idx}>• {i}</p>)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Management Actions Needed</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-1">
                {managementActions.length === 0 ? <p className="text-muted-foreground">No immediate management actions required.</p> : managementActions.map((i, idx) => <p key={idx}>• {i}</p>)}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="financial" className="w-full">
            <TabsList className="w-full justify-start overflow-auto">
              <TabsTrigger value="financial">Financial</TabsTrigger>
              <TabsTrigger value="projects">Projects</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="raid">RAID</TabsTrigger>
              <TabsTrigger value="quality">Quality</TabsTrigger>
              <TabsTrigger value="procurement">Procurement</TabsTrigger>
            </TabsList>

            <TabsContent value="financial" className="mt-4"><FinancialTab data={reportData.financials || {}} month={month} onDrill={setDrill} /></TabsContent>
            <TabsContent value="projects" className="mt-4"><ProjectStatusTab data={reportData.projectStatus || []} month={month} reportId={reportId} onDrill={setDrill} /></TabsContent>
            <TabsContent value="tasks" className="mt-4"><TasksTab data={reportData.tasks || {}} onDrill={setDrill} /></TabsContent>
            <TabsContent value="raid" className="mt-4"><RAIDTab data={reportData.raidItems || {}} onDrill={setDrill} /></TabsContent>
            <TabsContent value="quality" className="mt-4"><QualityTab data={reportData.quality || {}} onDrill={setDrill} /></TabsContent>
            <TabsContent value="procurement" className="mt-4"><ProcurementTab data={reportData.procurement || []} onDrill={setDrill} /></TabsContent>
          </Tabs>
        </>
      )}

      <DrilldownDrawer
        open={!!drill}
        onOpenChange={(o) => !o && setDrill(null)}
        title={drill?.title || "Drill-through"}
        endpoint={reportId ? `/api/reports/pm/monthly/${reportId}/drilldown` : "/api/reports/pm/monthly/0/drilldown"}
        context={drill?.context || {}}
      />
    </ReportShell>
  );
}

function FinancialTab({ data, month, onDrill }: { data: any; month: string; onDrill: (d: any) => void }) {
  const negatives = [...(data.grossProfit || [])].sort((a: any, b: any) => Number(a.gpMarginPct || 0) - Number(b.gpMarginPct || 0)).slice(0, 5);
  const invoiceExposure = (data.revenueSummary || []).reduce((s: number, r: any) => s + Number(r.outstanding || 0), 0);
  const { dateFrom, dateTo } = monthRange(month);

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Revenue Bridge</p><p className="text-lg font-bold">{fmtMoney((data.revenueSummary || []).reduce((s: number, r: any) => s + Number(r.invoicedThisMonth || 0), 0))}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">COS Bridge</p><p className="text-lg font-bold">{fmtMoney((data.costSummary || []).reduce((s: number, r: any) => s + Number(r.costsThisMonth || 0), 0))}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">GP Bridge</p><p className="text-lg font-bold">{fmtMoney((data.grossProfit || []).reduce((s: number, r: any) => s + Number(r.grossProfit || 0), 0))}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Invoice/Receipt Exposure</p><p className="text-lg font-bold text-amber-700">{fmtMoney(invoiceExposure)}</p></CardContent></Card>
      </div>

      <RevenueTrendChart data={data.revenueTrend || []} onChartClick={() => onDrill({ title: "Revenue Bridge", context: { tab: "financial", metric: "revenueBridge", dateFrom, dateTo } })} />
      <CashflowTrendChart data={data.cashflowTrend || []} onChartClick={() => onDrill({ title: "Cashflow Trace", context: { tab: "financial", metric: "cashflow", dateFrom, dateTo } })} />

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Exception List — Biggest Negative Margin Movers</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1">
          {negatives.map((r: any, idx: number) => (
            <div key={idx} className="flex justify-between border-b pb-1 cursor-pointer" onClick={() => onDrill({ title: `${r.projectName} Margin Detail`, context: { tab: "financial", projectId: r.projectId } })}>
              <span>{r.projectName}</span><span className="text-red-700">{r.gpMarginPct?.toFixed(1)}%</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Detailed Table — Budget vs Actual vs Committed vs Paid</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0"><tr><th className="px-2 py-2 text-left">Project</th><th className="px-2 py-2 text-right">Budget</th><th className="px-2 py-2 text-right">Actual</th><th className="px-2 py-2 text-right">Committed</th><th className="px-2 py-2 text-right">Paid</th><th className="px-2 py-2 text-right">Variance</th></tr></thead>
              <tbody>
                {(data.costSummary || []).map((r: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => onDrill({ title: `${r.projectName} Cost Lines`, context: { tab: "financial", projectId: r.projectId } })}>
                    <td className="px-2 py-1.5">{r.projectName}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(r.budgetTotal || 0)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(r.actualCost || 0)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(r.committed || 0)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(r.paid || 0)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(r.variance || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectStatusTab({ data, reportId, month, onDrill }: { data: any[]; reportId?: number; month: string; onDrill: (d: any) => void }) {
  const [, navigate] = useLocation();
  const criticalMisses = data.filter((p: any) => p.ragStatus === "RED");
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Phase Distribution</p><p className="text-lg font-bold">{new Set(data.map((p: any) => p.phase)).size}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">RAG RED+AMBER</p><p className="text-lg font-bold text-red-700">{data.filter((p: any) => ["RED", "AMBER"].includes(String(p.ragStatus || "").toUpperCase())).length}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Construction Starts</p><p className="text-lg font-bold">{data.filter((p: any) => p.constructionStartActual?.startsWith(month)).length}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Commissionings</p><p className="text-lg font-bold">{data.filter((p: any) => p.commissioningActual?.startsWith(month)).length}</p></CardContent></Card>
      </div>

      <RAGDistributionChart data={data} onChartClick={(rag?: string) => onDrill({ title: `RAG ${rag || "Distribution"}`, context: { tab: "projects", status: rag || "at-risk" } })} />

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Exception List — Critical Milestone/Health Misses</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1">
          {criticalMisses.length === 0 ? <p className="text-muted-foreground">No RED project exceptions.</p> : criticalMisses.slice(0, 8).map((r: any, idx: number) => (
            <div key={idx} className="flex justify-between border-b pb-1 cursor-pointer" onClick={() => reportId && navigate(`/reports/pm/monthly/${month}/project/${r.projectId}`)}>
              <span>{r.projectName}</span><span>{r.healthScore?.toFixed(1) || "—"}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Detailed Table — Project Status & Latest Execution Signals</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[520px] overflow-y-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0"><tr><th className="px-2 py-2 text-left">Project</th><th className="px-2 py-2 text-left">Phase</th><th className="px-2 py-2 text-left">RAG</th><th className="px-2 py-2 text-right">Health</th><th className="px-2 py-2 text-right">Tasks %</th><th className="px-2 py-2 text-right">QC %</th></tr></thead>
              <tbody>{data.map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => reportId && navigate(`/reports/pm/monthly/${month}/project/${r.projectId}`)}>
                  <td className="px-2 py-1.5">{r.projectName}</td><td className="px-2 py-1.5">{r.phase || "—"}</td><td className="px-2 py-1.5"><RAGBadge status={r.ragStatus} /></td><td className="px-2 py-1.5 text-right">{r.healthScore?.toFixed(1) || "—"}</td><td className="px-2 py-1.5 text-right">{r.taskProgressPct?.toFixed(0) || 0}%</td><td className="px-2 py-1.5 text-right">{r.qcProgressPct?.toFixed(0) || 0}%</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TasksTab({ data, onDrill }: { data: any; onDrill: (d: any) => void }) {
  const metrics = data.programmeMetrics || {};
  const worst = [...(data.perProject || [])].sort((a: any, b: any) => Number(b.overdue || 0) - Number(a.overdue || 0)).slice(0, 8);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="cursor-pointer" onClick={() => onDrill({ title: "Overdue Tasks", context: { tab: "tasks", status: "overdue" } })}><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Overdue by Owner/Project</p><p className="text-2xl font-bold text-red-600">{metrics.overdueTasks ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Completed This Month</p><p className="text-2xl font-bold text-emerald-600">{metrics.tasksCompletedThisMonth ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Milestone Misses</p><p className="text-2xl font-bold">{metrics.milestonesAchieved ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Active Task Aging</p><p className="text-2xl font-bold">{metrics.totalActiveTasks ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Worst Performers</p><p className="text-2xl font-bold">{worst.length}</p></CardContent></Card>
      </div>

      <TaskCompletionChart data={data.perProject || []} onChartClick={() => onDrill({ title: "Task Contributors", context: { tab: "tasks" } })} />

      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Exception List — Overdue & Leaderboard</CardTitle></CardHeader><CardContent className="text-xs space-y-1">{worst.map((r: any, i: number) => <div key={i} className="flex justify-between border-b pb-1 cursor-pointer" onClick={() => onDrill({ title: `${r.projectName} Task Lines`, context: { tab: "tasks", projectId: r.projectId } })}><span>{r.projectName}</span><span>{r.overdue} overdue / {r.completionPct?.toFixed(0)}%</span></div>)}</CardContent></Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Detailed Table — Task Completion</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto border rounded-lg">
            <table className="w-full text-xs"><thead className="bg-muted sticky top-0"><tr><th className="px-2 py-2 text-left">Project</th><th className="px-2 py-2 text-right">Total</th><th className="px-2 py-2 text-right">Done</th><th className="px-2 py-2 text-right">In Progress</th><th className="px-2 py-2 text-right">Overdue</th><th className="px-2 py-2 text-right">Done %</th></tr></thead><tbody>{(data.perProject || []).map((r: any, i: number) => <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => onDrill({ title: `${r.projectName} Task Rows`, context: { tab: "tasks", projectId: r.projectId } })}><td className="px-2 py-1.5">{r.projectName}</td><td className="px-2 py-1.5 text-right">{r.totalTasks}</td><td className="px-2 py-1.5 text-right">{r.completed}</td><td className="px-2 py-1.5 text-right">{r.inProgress}</td><td className="px-2 py-1.5 text-right">{r.overdue}</td><td className="px-2 py-1.5 text-right">{r.completionPct?.toFixed(0)}%</td></tr>)}</tbody></table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RAIDTab({ data, onDrill }: { data: any; onDrill: (d: any) => void }) {
  const items = data.items || [];
  const critical = items.filter((r: any) => ["critical", "high"].includes(String(r.priority || "").toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Open by Type</p><p className="text-xl font-bold">{items.length}</p></CardContent></Card>
        <Card className="cursor-pointer" onClick={() => onDrill({ title: "Critical/High RAID", context: { tab: "raid", riskPriority: "high" } })}><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Critical/High</p><p className="text-xl font-bold text-red-700">{critical.length}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">New vs Closed</p><p className="text-xl font-bold">{data.newThisMonth || 0} / {data.closedThisMonth || 0}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Overdue Actions</p><p className="text-xl font-bold text-red-700">{data.overdueItems || 0}</p></CardContent></Card>
      </div>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Exception List — Management-level Risks</CardTitle></CardHeader><CardContent className="text-xs space-y-1">{critical.slice(0, 8).map((r: any, i: number) => <div key={i} className="flex justify-between border-b pb-1 cursor-pointer" onClick={() => onDrill({ title: `${r.projectName} RAID`, context: { tab: "raid", projectId: r.projectId, riskPriority: r.priority } })}><span>{r.projectName} - {r.title}</span><span>{r.priority}</span></div>)}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Detailed Table — RAID Items</CardTitle></CardHeader><CardContent><div className="overflow-x-auto max-h-[420px] overflow-y-auto border rounded-lg"><table className="w-full text-xs"><thead className="bg-muted sticky top-0"><tr><th className="px-2 py-2 text-left">Project</th><th className="px-2 py-2 text-left">Type</th><th className="px-2 py-2 text-left">Title</th><th className="px-2 py-2 text-left">Priority</th><th className="px-2 py-2 text-left">Owner</th><th className="px-2 py-2 text-left">Due</th></tr></thead><tbody>{items.map((r: any, i: number) => <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => onDrill({ title: `${r.projectName} RAID`, context: { tab: "raid", projectId: r.projectId } })}><td className="px-2 py-1.5">{r.projectName}</td><td className="px-2 py-1.5 uppercase">{r.type}</td><td className="px-2 py-1.5">{r.title}</td><td className="px-2 py-1.5">{r.priority}</td><td className="px-2 py-1.5">{r.ownerName || "—"}</td><td className="px-2 py-1.5">{r.dueDate || "—"}</td></tr>)}</tbody></table></div></CardContent></Card>
    </div>
  );
}

function QualityTab({ data, onDrill }: { data: any; onDrill: (d: any) => void }) {
  const rows = data.qcProgress || [];
  const belowThreshold = rows.filter((r: any) => Number(r.progressPct || 0) < 80);
  const warnings = rows.reduce((sum: number, r: any) => sum + Number(r.openWarnings || 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">QC Progress Avg</p><p className="text-xl font-bold">{rows.length ? (rows.reduce((s: number, r: any) => s + Number(r.progressPct || 0), 0) / rows.length).toFixed(1) : 0}%</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Open Warnings</p><p className="text-xl font-bold text-red-700">{warnings}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Below Threshold</p><p className="text-xl font-bold text-amber-700">{belowThreshold.length}</p></CardContent></Card>
        <Card className="cursor-pointer" onClick={() => onDrill({ title: "Quality Trend Open/Closed", context: { tab: "quality" } })}><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Open vs Closed Trend</p><p className="text-xl font-bold">View</p></CardContent></Card>
      </div>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Exception List — Projects Below Threshold</CardTitle></CardHeader><CardContent className="text-xs space-y-1">{belowThreshold.map((r: any, i: number) => <div key={i} className="flex justify-between border-b pb-1 cursor-pointer" onClick={() => onDrill({ title: `${r.projectName} QC Detail`, context: { tab: "quality", projectId: r.projectId } })}><span>{r.projectName}</span><span>{r.progressPct?.toFixed(1)}%</span></div>)}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Detailed Table — QC Progress</CardTitle></CardHeader><CardContent><div className="overflow-x-auto max-h-[420px] overflow-y-auto border rounded-lg"><table className="w-full text-xs"><thead className="bg-muted sticky top-0"><tr><th className="px-2 py-2 text-left">Project</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-right">Applicable</th><th className="px-2 py-2 text-right">Approved</th><th className="px-2 py-2 text-right">Progress %</th><th className="px-2 py-2 text-right">Warnings</th></tr></thead><tbody>{rows.map((r: any, i: number) => <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => onDrill({ title: `${r.projectName} Quality Rows`, context: { tab: "quality", projectId: r.projectId } })}><td className="px-2 py-1.5">{r.projectName}</td><td className="px-2 py-1.5">{r.checklistStatus}</td><td className="px-2 py-1.5 text-right">{r.itemsApplicable}</td><td className="px-2 py-1.5 text-right">{r.itemsApproved}</td><td className="px-2 py-1.5 text-right">{r.progressPct?.toFixed(1)}%</td><td className="px-2 py-1.5 text-right">{r.openWarnings}</td></tr>)}</tbody></table></div></CardContent></Card>
    </div>
  );
}

function ProcurementTab({ data, onDrill }: { data: any[]; onDrill: (d: any) => void }) {
  const atRisk = data.filter((r: any) => ["late", "blocked", "missing"].includes(String(r.status || "").toLowerCase()));
  const supplierExposure = new Map<string, number>();
  for (const p of data) {
    const key = p.supplierName || "Unknown Supplier";
    supplierExposure.set(key, (supplierExposure.get(key) || 0) + Number(p.actualCost || p.expectedCost || 0));
  }
  const topSupplier = [...supplierExposure.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Items by Status</p><p className="text-xl font-bold">{data.length}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Late/Blocked/Missing</p><p className="text-xl font-bold text-red-700">{atRisk.length}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Top Supplier Exposure</p><p className="text-xs font-bold">{topSupplier ? `${topSupplier[0]} (${fmtMoney(topSupplier[1])})` : "—"}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">Expected vs Actual</p><p className="text-sm font-bold">{fmtMoney(data.reduce((s: number, r: any) => s + Number(r.expectedCost || 0), 0))} / {fmtMoney(data.reduce((s: number, r: any) => s + Number(r.actualCost || 0), 0))}</p></CardContent></Card>
      </div>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Exception List — Procurement at Risk</CardTitle></CardHeader><CardContent className="text-xs space-y-1">{atRisk.slice(0, 8).map((r: any, i: number) => <div key={i} className="flex justify-between border-b pb-1 cursor-pointer" onClick={() => onDrill({ title: `${r.projectName} Procurement`, context: { tab: "procurement", projectId: r.projectId, status: r.status } })}><span>{r.projectName} - {r.title}</span><span>{r.status}</span></div>)}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Detailed Table — Procurement Items</CardTitle></CardHeader><CardContent><div className="overflow-x-auto max-h-[420px] overflow-y-auto border rounded-lg"><table className="w-full text-xs"><thead className="bg-muted sticky top-0"><tr><th className="px-2 py-2 text-left">Project</th><th className="px-2 py-2 text-left">Item</th><th className="px-2 py-2 text-left">Category</th><th className="px-2 py-2 text-right">Expected</th><th className="px-2 py-2 text-right">Actual</th><th className="px-2 py-2 text-left">Supplier</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Payment</th></tr></thead><tbody>{data.map((r: any, i: number) => <tr key={i} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => onDrill({ title: `${r.projectName} Procurement`, context: { tab: "procurement", projectId: r.projectId } })}><td className="px-2 py-1.5">{r.projectName}</td><td className="px-2 py-1.5">{r.title}</td><td className="px-2 py-1.5">{r.category || "—"}</td><td className="px-2 py-1.5 text-right">{fmtMoney(Number(r.expectedCost || 0))}</td><td className="px-2 py-1.5 text-right">{fmtMoney(Number(r.actualCost || 0))}</td><td className="px-2 py-1.5">{r.supplierName || "—"}</td><td className="px-2 py-1.5">{r.status || "—"}</td><td className="px-2 py-1.5">{r.paymentStatus || "—"}</td></tr>)}</tbody></table></div></CardContent></Card>
    </div>
  );
}
