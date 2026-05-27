import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft } from "lucide-react";
import RAGBadge from "@/components/reports/RAGBadge";
import { PageHeader } from "@/components/ui/page-header";
import { QueryLoading, QueryError } from "@/components/ui/query-states";
import { Money } from "@/components/ui/money";
import { PageLayout, DetailLayout } from "@/components/layout";

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

// TF-16 (audit V3) — migrated to the canonical <Money> component
// (which wraps formatZar + adds a screen-reader-friendly aria-label).
// Callers now render <Money value={v} cents /> instead of money(v).

const TAB_MAP: Record<string, string> = {
  revenue: "financial",
  cost: "financial",
  tasks: "tasks",
  raid: "raid",
  quality: "quality",
  procurement: "procurement",
};

function ProjectDetailTable({ reportId, projectId, title, metric, defaultSort = "" }: { reportId?: number; projectId: string; title: string; metric: string; defaultSort?: string }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState(defaultSort);
  const tab = TAB_MAP[metric] || metric;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["pm-project-tab", reportId, projectId, metric],
    enabled: !!reportId,
    queryFn: async () => {
      const q = new URLSearchParams({ projectId, tab, metric });
      const res = await fetch(`/api/reports/pm/monthly/${reportId}/drilldown?${q.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load drill rows");
      return res.json();
    },
  });

  const rows = useMemo(() => {
    let list = [...(data?.rows || [])];
    if (search.trim()) {
      const term = search.toLowerCase();
      list = list.filter((r: any) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(term)));
    }
    if (sortKey) {
      list.sort((a: any, b: any) => String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? "")));
    }
    return list;
  }, [data?.rows, search, sortKey]);

  const cols = Object.keys(rows[0] || data?.rows?.[0] || {});
  const totals = data?.aggregates?.sums || {};

  const exportExcel = async () => {
    if (!reportId) return;
    const q = new URLSearchParams({ projectId, tab, metric, format: "xlsx" });
    const res = await fetch(`/api/reports/pm/monthly/${reportId}/drilldown?${q.toString()}`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Button size="sm" variant="outline" onClick={exportExcel} data-testid={`btn-export-${metric}`}>Export to Excel</Button>
        </div>

        <div className="text-xs text-muted-foreground border rounded px-2 py-1 bg-muted/20">
          Data source / filters applied: {JSON.stringify(data?.appliedFilters || { tab, metric, projectId })}
        </div>

        <div className="sticky top-0 z-10 bg-background border rounded p-2 text-xs flex flex-wrap gap-3">
          <span>Rows: <strong className="tabular-nums">{rows.length}</strong></span>
          {Object.entries(totals).slice(0, 5).map(([k, v]) => <span key={k}>{k}: <strong className="tabular-nums">{typeof v === "number" ? v.toLocaleString() : String(v)}</strong></span>)}
        </div>

        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter rows..." className="h-8" />

        {isLoading ? <QueryLoading /> : isError ? <QueryError error={error} onRetry={() => refetch()} /> : (
          <div className="border rounded overflow-auto max-h-[52vh]">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>{cols.map((c) => <th key={c} className="text-left px-2 py-2 cursor-pointer" onClick={() => setSortKey(c)}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={cols.length || 1} className="p-4 text-center text-muted-foreground">No rows found.</td></tr> : rows.map((r: any, idx: number) => (
                  <tr key={idx} className="border-b">{cols.map((c) => <td key={c} className="px-2 py-1.5">{String(r[c] ?? "—")}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PmMonthlyReportProject() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/reports/pm/monthly/:month/project/:projectId");
  const month = params?.month || "";
  const projectId = params?.projectId || "";

  const { data: report, isLoading: reportLoading, isError: reportError, error: reportQueryError, refetch: refetchReport } = useQuery({
    queryKey: ["/api/reports/pm/monthly", month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/pm/monthly?month=${month}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
    enabled: !!month,
  });

  const reportId = report?.id;
  const { data: projectData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/reports/pm/monthly/project", reportId, projectId],
    queryFn: async () => {
      const res = await fetch(`/api/reports/pm/monthly/${reportId}/project/${projectId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load project data");
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

  const pageTitle = ps?.projectName || "Project Detail";

  return (
    <PageLayout
      data-testid="pm-monthly-report-project-page"
      header={
        <PageHeader
          title={pageTitle}
          subtitle={month}
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/reports/pm/monthly?month=${month}`)}
              data-testid="btn-back-monthly-report"
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          }
        />
      }
    >
      {reportLoading ? (
        <QueryLoading />
      ) : reportError ? (
        <QueryError error={reportQueryError} onRetry={() => refetchReport()} />
      ) : isLoading ? (
        <QueryLoading />
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : !ps ? (
        <p className="text-muted-foreground">No data available for this project.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Phase</p><p className="font-medium">{ps.phase || "—"}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">RAG</p><RAGBadge status={ps.ragStatus} /></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Health</p><p className="font-medium tabular-nums">{ps.healthScore?.toFixed(1) || "—"}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Revenue</p><Money className="font-mono text-sm" value={fin.revenue?.totalInvoiced || 0} cents /></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Cost</p><Money className="font-mono text-sm" value={fin.cost?.actualCost || 0} cents /></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">GP</p><Money className="font-mono text-sm" value={fin.grossProfit?.grossProfit || 0} cents /></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Overdue Tasks</p><p className="font-medium text-red-700 tabular-nums">{tasks?.overdue || 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Open RAID</p><p className="font-medium tabular-nums">{raids.length}</p></CardContent></Card>
          </div>

          <DetailLayout
            defaultTab="revenue"
            tabs={[
              { key: "revenue", label: "Revenue lines", content: <ProjectDetailTable reportId={reportId} projectId={projectId} title="Revenue Line Items" metric="revenue" defaultSort="invoiceDate" /> },
              { key: "cost", label: "Cost lines", content: <ProjectDetailTable reportId={reportId} projectId={projectId} title="Cost Line Items" metric="cost" defaultSort="invoiceDate" /> },
              { key: "tasks", label: "Task lines", content: <ProjectDetailTable reportId={reportId} projectId={projectId} title="Task Line Items" metric="tasks" defaultSort="endDate" /> },
              { key: "raid", label: "RAID lines", content: <ProjectDetailTable reportId={reportId} projectId={projectId} title="RAID Line Items" metric="raid" defaultSort="dueDate" /> },
              { key: "quality", label: "Quality lines", content: <ProjectDetailTable reportId={reportId} projectId={projectId} title="Quality Line Items" metric="quality" defaultSort="createdAt" /> },
              { key: "procurement", label: "Procurement lines", content: <ProjectDetailTable reportId={reportId} projectId={projectId} title="Procurement Line Items" metric="procurement" defaultSort="status" /> },
            ]}
          />

          <div className="grid sm:grid-cols-3 gap-3 text-xs">
            <Card><CardContent className="p-3"><p className="text-muted-foreground">Project QC Warnings</p><p className="font-medium text-red-700 tabular-nums">{quality?.openWarnings || 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-muted-foreground">Procurement Lines</p><p className="font-medium tabular-nums">{procurement.length}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-muted-foreground">Task Completion</p><p className="font-medium tabular-nums">{tasks?.completionPct?.toFixed(0) || 0}%</p></CardContent></Card>
          </div>
        </>
      )}
    </PageLayout>
  );
}
