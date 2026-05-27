import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileSpreadsheet, Search, Clock, ShieldAlert, CalendarDays, Building2, Briefcase, ChevronRight, FileText } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { ReportCard } from "@/components/reports/ReportCard";
import DrilldownDrawer from "@/components/reports/shared/DrilldownDrawer";
import { ReportTrustNotice } from "@/components/reports/ReportTrustNotice";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

// TF-16 (audit V3) — migrated to canonical formatZar so the
// programme-reports page renders the same en-ZA money strings as
// every other finance surface.
import { formatZar as formatCurrency } from "@/lib/currency";
import { Money } from "@/components/ui/money";

function getMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 25; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-ZA", { year: "numeric", month: "long" });
    options.push({ value, label });
  }
  return options;
}

function parseAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value || "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function ExportButton({ reportType, filters }: { reportType: string; filters: Record<string, string> }) {
  const handleExport = () => {
    const params = new URLSearchParams({ ...filters, format: "xlsx" });
    const url = `/api/reports/${reportType}?${params.toString()}`;
    const link = document.createElement("a");
    fetch(url, { headers: getAuthHeaders() })
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        link.href = blobUrl;
        link.download = `${reportType}_report.xlsx`;
        link.click();
        URL.revokeObjectURL(blobUrl);
      });
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
      <Download className="w-3.5 h-3.5" />
      Export .xlsx
    </Button>
  );
}

function ReportMeta({ meta, lastImportAt, hasProtectedFields }: { meta: any; lastImportAt?: string; hasProtectedFields?: boolean }) {
  const hasStale = meta?.stalenessThresholdDays;
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground px-1 py-2">
      <div className="flex items-center gap-3">
        <span>{meta?.count || 0} records</span>
        {lastImportAt && <span>Last import: {new Date(lastImportAt).toLocaleString()}</span>}
        {hasStale && <span className="text-slate-400">(Staleness threshold: {meta.stalenessThresholdDays} days)</span>}
      </div>
      {hasProtectedFields && (
        <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50 text-[10px] gap-1">
          <ShieldAlert className="w-3 h-3" /> Contains protected manual edits
        </Badge>
      )}
    </div>
  );
}

function useProgrammeData() {
  const projectPlanQuery = useQuery({
    queryKey: ["/api/reports/project-plan"],
    queryFn: async () => {
      const res = await fetch("/api/reports/project-plan", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch data (' + res.status + ')');
      return res.json();
    },
  });
  const costQuery = useQuery({
    queryKey: ["/api/reports/cost"],
    queryFn: async () => {
      const res = await fetch("/api/reports/cost", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch data (' + res.status + ')');
      return res.json();
    },
  });
  const qualityQuery = useQuery({
    queryKey: ["/api/reports/quality"],
    queryFn: async () => {
      const res = await fetch("/api/reports/quality", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch data (' + res.status + ')');
      return res.json();
    },
  });
  const resourceQuery = useQuery({
    queryKey: ["/api/reports/resource-allocation"],
    queryFn: async () => {
      const res = await fetch("/api/reports/resource-allocation", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch data (' + res.status + ')');
      return res.json();
    },
  });

  return { projectPlanQuery, costQuery, qualityQuery, resourceQuery };
}

type PeriodType = "month" | "prior" | "custom";

function ProgrammeControlBar({ periodType, setPeriodType, month, setMonth, fromDate, setFromDate, toDate, setToDate, onBoardPdf }: {
  periodType: PeriodType;
  setPeriodType: (v: PeriodType) => void;
  month: string;
  setMonth: (v: string) => void;
  fromDate: string;
  setFromDate: (v: string) => void;
  toDate: string;
  setToDate: (v: string) => void;
  onBoardPdf: () => void;
}) {
  const monthOptions = useMemo(() => getMonthOptions(), []);
  return (
    <Card>
      <CardContent className="pt-4 flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={periodType} onValueChange={(v: PeriodType) => setPeriodType(v)}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Operating Month</SelectItem>
              <SelectItem value="prior">Prior Month</SelectItem>
              <SelectItem value="custom">Custom Date Range</SelectItem>
            </SelectContent>
          </Select>
          {(periodType === "month" || periodType === "prior") && (
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[220px] h-9">
                <CalendarDays className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {periodType === "custom" && (
            <>
              <Input type="date" className="h-9 w-[170px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              <Input type="date" className="h-9 w-[170px]" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </>
          )}
        </div>
        <Button size="sm" className="gap-1.5" onClick={onBoardPdf}>
          <FileText className="w-3.5 h-3.5" /> Export Board PDF
        </Button>
      </CardContent>
    </Card>
  );
}

function BoardView({ summary, trendText, openDrill, exportBoardPdf }: { summary: any; trendText: string; openDrill: (title: string, context: Record<string, any>) => void; exportBoardPdf: () => void }) {
  const health = summary.health;
  const topProjects = summary.criticalProjects.slice(0, 8);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="cursor-pointer" onClick={() => openDrill("Portfolio Health", { tab: "project-plan", metric: "portfolioHealth" })}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Overall Portfolio Health</p><p className="text-2xl font-semibold">{health.green}/{health.amber}/{health.red}</p><p className="text-xs text-muted-foreground">Green / Amber / Red</p></CardContent></Card>
        <Card className="cursor-pointer" onClick={() => openDrill("Revenue Position", { tab: "cost", metric: "revenuePosition" })}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Revenue / Cost / Margin</p><p className="text-2xl font-semibold">{formatCurrency(summary.financial.revenue)}</p><p className="text-xs">Cost {formatCurrency(summary.financial.cost)} • Margin {summary.financial.marginPct.toFixed(1)}%</p></CardContent></Card>
        <Card className="cursor-pointer" onClick={() => openDrill("Top Delivery Risks", { tab: "project-plan", metric: "deliveryRisks" })}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Top Delivery Risks</p><p className="text-2xl font-semibold text-amber-600">{summary.risks.delivery}</p><p className="text-xs">Open late tasks and slippage</p></CardContent></Card>
        <Card className="cursor-pointer" onClick={() => openDrill("Top Engineering Risks", { tab: "project-plan", metric: "engineeringRisks" })}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Top Engineering Risks</p><p className="text-2xl font-semibold text-red-600">{summary.risks.engineering}</p><p className="text-xs">Blocked / aging task pressure</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Executive Scorecard</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between cursor-pointer" onClick={() => openDrill("Quality Risks", { tab: "quality", metric: "qualityRisks" })}><span>Top quality risks</span><span className="font-semibold">{summary.risks.quality}</span></div>
            <div className="flex justify-between cursor-pointer" onClick={() => openDrill("Procurement Exposure", { tab: "cost", metric: "procurementExposure" })}><span>Procurement exposure</span><span className="font-semibold">{formatCurrency(summary.procurement.exposure)}</span></div>
            <div className="flex justify-between cursor-pointer" onClick={() => openDrill("Margin At Risk", { tab: "cost", metric: "marginAtRisk" })}><span>Margin at risk</span><span className="font-semibold text-red-600">{formatCurrency(summary.financial.marginAtRisk)}</span></div>
            <div className="flex justify-between"><span>Major achievements this period</span><span className="font-semibold">{summary.achievements}</span></div>
            <div className="flex justify-between"><span>Decisions / escalations needed</span><span className="font-semibold">{summary.decisionsNeeded}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Trend vs Previous Month</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm">{trendText}</p>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={exportBoardPdf}>Export board-ready PDF</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Critical Projects List</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {topProjects.length === 0 ? <p className="text-sm text-muted-foreground">No critical projects in selected period.</p> : topProjects.map((p: any) => (
            <div key={`${p.projectName}-${p.owner}`} className="flex items-center justify-between text-sm py-1 border-b last:border-0 cursor-pointer" onClick={() => openDrill(`Project Detail: ${p.projectName}`, { tab: "project-plan", projectId: p.projectId })}>
              <span>{p.projectName}</span>
              <span className="text-muted-foreground">{p.owner || "Unassigned"} <ChevronRight className="inline w-3.5 h-3.5" /></span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ManagementView({ summary, openDrill }: { summary: any; openDrill: (title: string, context: Record<string, any>) => void }) {
  const sections = [
    { id: "portfolio", title: "Portfolio Overview", cards: [{ label: "Active projects", value: summary.counts.activeProjects, ctx: { tab: "project-plan" } }, { label: "Red projects", value: summary.health.red, ctx: { tab: "quality", status: "red" } }] },
    { id: "financial", title: "Financial Control", cards: [{ label: "Revenue", value: formatCurrency(summary.financial.revenue), ctx: { tab: "cost", metric: "revenue" } }, { label: "Cost", value: formatCurrency(summary.financial.cost), ctx: { tab: "cost", metric: "cost" } }, { label: "Margin", value: `${summary.financial.marginPct.toFixed(1)}%`, ctx: { tab: "cost", metric: "margin" } }] },
    { id: "delivery", title: "Delivery Control", cards: [{ label: "Overdue tasks", value: summary.risks.delivery, ctx: { tab: "project-plan", metric: "overdueTasks" } }, { label: "At risk projects", value: summary.health.red + summary.health.amber, ctx: { tab: "project-plan", metric: "projectsAtRisk" } }] },
    { id: "engineering", title: "Engineering Control", cards: [{ label: "Blocked tasks", value: summary.risks.engineering, ctx: { tab: "project-plan", metric: "engineeringRisks" } }] },
    { id: "quality", title: "Quality Control", cards: [{ label: "Quality warnings", value: summary.risks.quality, ctx: { tab: "quality" } }] },
    { id: "procurement", title: "Procurement Control", cards: [{ label: "Unpaid exposure", value: formatCurrency(summary.procurement.exposure), ctx: { tab: "cost", metric: "procurementExposure" } }] },
    { id: "resource", title: "Resource Control", cards: [{ label: "High utilisation owners", value: summary.resources.highUtilization, ctx: { tab: "resource", metric: "highUtilization" } }] },
    { id: "import", title: "Import / Data Quality", cards: [{ label: "Stale rows", value: summary.staleness.staleRows, ctx: { tab: "project-plan", metric: "staleRows" } }, { label: "Last import", value: summary.staleness.lastImportLabel, ctx: { tab: "project-plan", metric: "importHealth" } }] },
  ];

  return (
    <Tabs defaultValue="portfolio" className="w-full">
      <TabsList className="w-full justify-start flex-wrap h-auto">
        {sections.map(s => <TabsTrigger key={s.id} value={s.id}>{s.title}</TabsTrigger>)}
      </TabsList>
      {sections.map(section => (
        <TabsContent key={section.id} value={section.id} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {section.cards.map((card) => (
              <Card key={card.label} className="cursor-pointer" onClick={() => openDrill(`${section.title}: ${card.label}`, card.ctx)}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="text-xl font-semibold">{card.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Exception-first list</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {summary.criticalProjects.slice(0, 6).map((p: any) => (
                <div key={`${section.id}-${p.projectName}`} className="flex items-center justify-between text-sm py-1 border-b last:border-0 cursor-pointer" onClick={() => openDrill(`${section.title}: ${p.projectName}`, { tab: "project-plan", projectId: p.projectId })}>
                  <span>{p.projectName}</span><Badge variant="outline">{p.status || "risk"}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function ProjectPlanReport() {
  const [projectFilter, setProjectFilter] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/project-plan", projectFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectFilter) params.set("projectName", projectFilter);
      return (await fetch(`/api/reports/project-plan?${params}`, { headers: getAuthHeaders() })).json();
    },
  });
  const rows = data?.data || [];
  const hasProtected = rows.some((r: any) => r.hasProtectedFields);
  const latestImport = rows.reduce(
    (max: string, r: any) => (r.lastImportAt && r.lastImportAt > max ? r.lastImportAt : max),
    "",
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Filter by project..."
            className="pl-9 h-9"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          />
        </div>
        <ExportButton reportType="project-plan" filters={{ projectName: projectFilter }} />
      </div>
      <ReportMeta meta={data?.meta} lastImportAt={latestImport} hasProtectedFields={hasProtected} />
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Task</th>
                <th className="text-left px-3 py-2 font-medium">Owner</th>
                <th className="text-left px-3 py-2 font-medium">Lead</th>
                <th className="text-left px-3 py-2 font-medium">Resource 1</th>
                <th className="text-left px-3 py-2 font-medium">Resource 2</th>
                <th className="text-right px-3 py-2 font-medium">Work Days</th>
                <th className="text-left px-3 py-2 font-medium">Tracker Comments</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">% Complete</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Loading...</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No data</td>
                </tr>
              ) : (
                rows.map((r: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-1.5 max-w-[180px] truncate">{r.projectName}</td>
                    <td className="px-3 py-1.5 max-w-[220px] truncate">{r.taskName}</td>
                    <td className="px-3 py-1.5">{r.owner || "—"}</td>
                    <td className="px-3 py-1.5">{r.lead || "—"}</td>
                    <td className="px-3 py-1.5">{r.resource1 || "—"}</td>
                    <td className="px-3 py-1.5">{r.resource2 || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.workDays ?? "—"}</td>
                    <td
                      className="px-3 py-1.5 max-w-[200px] truncate"
                      title={r.trackerComments || ""}
                    >
                      {r.trackerComments || "—"}
                    </td>
                    <td className="px-3 py-1.5">{r.status || "—"}</td>
                    <td className="px-3 py-1.5 text-right">
                      {r.percentComplete != null ? `${r.percentComplete}%` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CostReport() {
  const [projectFilter, setProjectFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/cost", projectFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectFilter) params.set("projectName", projectFilter);
      if (categoryFilter) params.set("costCategory", categoryFilter);
      return (await fetch(`/api/reports/cost?${params}`, { headers: getAuthHeaders() })).json();
    },
  });
  const rows = data?.data || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2 flex-1 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Filter project..."
              className="pl-9 h-9"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            />
          </div>
          <Input
            placeholder="Filter category..."
            className="h-9 max-w-[180px]"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          />
        </div>
        <ExportButton
          reportType="cost"
          filters={{ projectName: projectFilter, costCategory: categoryFilter }}
        />
      </div>
      <ReportMeta meta={data?.meta} />
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">Counterparty</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-center px-3 py-2 font-medium" title="Smart Import v2 check_flag column">
                  Check
                </th>
                <th className="text-right px-3 py-2 font-medium">Saving / Overrun</th>
                <th className="text-left px-3 py-2 font-medium">Comments</th>
                <th className="text-left px-3 py-2 font-medium">COS Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Loading...</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No data</td>
                </tr>
              ) : (
                rows.map((r: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-1.5 max-w-[150px] truncate">{r.projectName}</td>
                    <td className="px-3 py-1.5">{r.costCategory || "—"}</td>
                    <td className="px-3 py-1.5 max-w-[150px] truncate">{r.counterpartyName || "—"}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.amountExVat || "—"}</td>
                    <td
                      className="px-3 py-1.5 text-center font-mono"
                      title={r.checkFlag || undefined}
                    >
                      {r.checkFlag ? (
                        <span className="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-300">
                          {r.checkFlag}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.savingOverrun ?? "—"}</td>
                    <td
                      className="px-3 py-1.5 max-w-[200px] truncate"
                      title={r.comments || ""}
                    >
                      {r.comments || "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge variant="outline">{r.cosStatus}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function QualityReport() {
  const [projectFilter, setProjectFilter] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/quality", projectFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectFilter) params.set("projectName", projectFilter);
      return (await fetch(`/api/reports/quality?${params}`, { headers: getAuthHeaders() })).json();
    },
  });
  const rows = data?.data || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Filter by project..."
            className="pl-9 h-9"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          />
        </div>
        <ExportButton reportType="quality" filters={{ projectName: projectFilter }} />
      </div>
      <ReportMeta meta={data?.meta} />
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Phase</th>
                <th className="text-left px-3 py-2 font-medium">RAG Status</th>
                <th className="text-left px-3 py-2 font-medium">Last Import</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Loading...</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No data</td>
                </tr>
              ) : (
                rows.map((r: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-1.5">{r.projectName}</td>
                    <td className="px-3 py-1.5">{r.phase || "—"}</td>
                    <td className="px-3 py-1.5">
                      <Badge variant="outline">{r.ragStatus || "—"}</Badge>
                    </td>
                    <td className="px-3 py-1.5">
                      {r.lastImportAt ? new Date(r.lastImportAt).toLocaleDateString() : "Never"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ResourceAllocationReport() {
  const [resourceFilter, setResourceFilter] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/resource-allocation", resourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (resourceFilter) params.set("resource", resourceFilter);
      return (await fetch(`/api/reports/resource-allocation?${params}`, { headers: getAuthHeaders() })).json();
    },
  });
  const rows = data?.data || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Filter by resource..."
            className="pl-9 h-9"
            value={resourceFilter}
            onChange={(e) => setResourceFilter(e.target.value)}
          />
        </div>
        <ExportButton reportType="resource-allocation" filters={{ resource: resourceFilter }} />
      </div>
      <ReportMeta meta={data?.meta} />
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Resource</th>
                <th className="text-right px-3 py-2 font-medium">Total Tasks</th>
                <th className="text-right px-3 py-2 font-medium">Utilisation</th>
                <th className="text-left px-3 py-2 font-medium">Projects</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Loading...</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No data</td>
                </tr>
              ) : (
                rows.map((r: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-medium">{r.resource}</td>
                    <td className="px-3 py-1.5 text-right">{r.totalTasks}</td>
                    <td className="px-3 py-1.5 text-right">
                      {r.utilisation > 0 ? `${r.utilisation}%` : "—"}
                    </td>
                    <td
                      className="px-3 py-1.5 max-w-[200px] truncate text-slate-500"
                      title={r.projects}
                    >
                      {r.projects}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ProgrammeReports() {
  const [drill, setDrill] = useState<{ title: string; context: Record<string, any> } | null>(null);
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  const [month, setMonth] = useState(getMonthOptions()[0].value);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { projectPlanQuery, costQuery, qualityQuery, resourceQuery } = useProgrammeData();

  const isLoading = projectPlanQuery.isLoading || costQuery.isLoading || qualityQuery.isLoading || resourceQuery.isLoading;
  const isError = projectPlanQuery.isError || costQuery.isError || qualityQuery.isError || resourceQuery.isError;
  const firstError = projectPlanQuery.error || costQuery.error || qualityQuery.error || resourceQuery.error;
  const refetchAll = () => { projectPlanQuery.refetch(); costQuery.refetch(); qualityQuery.refetch(); resourceQuery.refetch(); };

  const period = useMemo(() => {
    if (periodType === "custom") return { from: fromDate || undefined, to: toDate || undefined, month: null as string | null };
    const [year, m] = month.split("-").map(Number);
    const base = periodType === "prior" ? new Date(year, (m - 1) - 1, 1) : new Date(year, m - 1, 1);
    const start = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-01`;
    const endDate = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
    return { from: start, to: end, month: `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}` };
  }, [periodType, month, fromDate, toDate]);

  const summary = useMemo(() => {
    const planRows = projectPlanQuery.data?.data || [];
    const costRows = costQuery.data?.data || [];
    const qualityRows = qualityQuery.data?.data || [];
    const resourceRows = resourceQuery.data?.data || [];

    const inPeriod = (date?: string | null) => {
      if (!date) return true;
      const normalized = date.substring(0, 10);
      if (period.from && normalized < period.from) return false;
      if (period.to && normalized > period.to) return false;
      return true;
    };

    const filteredPlan = planRows.filter((r: any) => inPeriod(r.endDate || r.startDate));
    const filteredCost = costRows.filter((r: any) => inPeriod(r.paidDate || r.invoiceDate));
    const filteredQuality = qualityRows;

    const revenue = filteredCost.filter((r: any) => String(r.costCategory || "").toLowerCase().includes("revenue")).reduce((sum: number, r: any) => sum + parseAmount(r.amountExVat), 0);
    const cost = filteredCost.reduce((sum: number, r: any) => sum + parseAmount(r.amountExVat), 0);
    const margin = revenue - cost;
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
    const marginAtRisk = filteredCost.filter((r: any) => !["Paid", "Realised"].includes(r.cosStatus)).reduce((sum: number, r: any) => sum + parseAmount(r.amountExVat), 0);
    const deliveryRisks = filteredPlan.filter((r: any) => (r.endDate && r.endDate < new Date().toISOString().substring(0, 10)) && !["done", "complete", "completed"].includes(String(r.status || "").toLowerCase())).length;
    const engineeringRisks = filteredPlan.filter((r: any) => String(r.phase || "").toLowerCase().includes("eng") && !["done", "complete", "completed"].includes(String(r.status || "").toLowerCase())).length;
    const qualityRisks = filteredQuality.filter((r: any) => ["red", "amber"].includes(String(r.ragStatus || "").toLowerCase())).length;
    const procurementExposure = filteredCost.filter((r: any) => !r.paymentConfirmed).reduce((sum: number, r: any) => sum + parseAmount(r.amountExVat), 0);
    const health = {
      green: filteredQuality.filter((r: any) => String(r.ragStatus || "").toLowerCase() === "green").length,
      amber: filteredQuality.filter((r: any) => String(r.ragStatus || "").toLowerCase() === "amber").length,
      red: filteredQuality.filter((r: any) => String(r.ragStatus || "").toLowerCase() === "red").length,
    };

    const projectCounts = new Map<string, number>();
    filteredPlan.forEach((r: any) => {
      if (!r.projectName) return;
      const key = String(r.projectName);
      if ((r.endDate && r.endDate < new Date().toISOString().substring(0, 10)) || ["blocked", "at risk", "late"].includes(String(r.status || "").toLowerCase())) {
        projectCounts.set(key, (projectCounts.get(key) || 0) + 1);
      }
    });
    const criticalProjects = Array.from(projectCounts.entries()).sort((a, b) => b[1] - a[1]).map(([projectName, count]) => {
      const row = filteredPlan.find((r: any) => r.projectName === projectName);
      return { projectName, projectId: row?.projectId, owner: row?.owner, status: `${count} risks` };
    });

    const allRows = [...planRows, ...costRows, ...qualityRows];
    const staleRows = allRows.filter((r: any) => r.isStale).length;
    const lastImport = allRows.map((r: any) => r.lastImportAt).filter(Boolean).sort().reverse()[0];

    return {
      counts: { activeProjects: new Set(filteredPlan.map((r: any) => r.projectName).filter(Boolean)).size },
      health,
      financial: { revenue, cost, margin, marginPct, marginAtRisk },
      risks: { delivery: deliveryRisks, engineering: engineeringRisks, quality: qualityRisks },
      procurement: { exposure: procurementExposure },
      achievements: filteredPlan.filter((r: any) => ["complete", "completed", "done"].includes(String(r.status || "").toLowerCase())).length,
      decisionsNeeded: deliveryRisks + qualityRisks,
      criticalProjects,
      resources: { highUtilization: resourceRows.filter((r: any) => (r.utilisation || 0) > 100).length },
      staleness: { staleRows, lastImportLabel: lastImport ? new Date(lastImport).toLocaleString() : "Never" },
    };
  }, [projectPlanQuery.data, costQuery.data, qualityQuery.data, resourceQuery.data, period]);

  const trendText = useMemo(() => `Margin at risk is ${formatCurrency(summary.financial.marginAtRisk)} with ${summary.risks.delivery} delivery exceptions and ${summary.risks.quality} quality exceptions in selected period.`, [summary]);
  const reportFreshnessAt = [
    projectPlanQuery.data?.meta?.generatedAt,
    costQuery.data?.meta?.generatedAt,
    qualityQuery.data?.meta?.generatedAt,
    resourceQuery.data?.meta?.generatedAt,
    summary.staleness.lastImportLabel !== "Never" ? summary.staleness.lastImportLabel : null,
  ].filter((value): value is string => typeof value === "string" && value.length > 0).sort().at(-1);

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <div className="p-4 md:p-6"><PageError title="Unable to load programme reports" message={firstError instanceof Error ? firstError.message : "Failed to fetch data"} onRetry={refetchAll} /></div>;

  const openDrill = (title: string, context: Record<string, any>) => {
    setDrill({ title, context: { ...context, dateFrom: period.from, dateTo: period.to } });
  };

  const exportBoardPdf = async () => {
    const params = new URLSearchParams();
    if (period.from) params.set("dateFrom", period.from);
    if (period.to) params.set("dateTo", period.to);
    if (period.month) params.set("month", period.month);
    const res = await fetch(`/api/reports/programme/board-pdf?${params.toString()}`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `programme_board_pack_${period.month || "custom"}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reportCatalog = [
    { name: "Project Plan Report", category: "Engineering", description: "Programme progress and schedule status.", type: "chart" as const },
    { name: "Cost Report", category: "Financial", description: "Planned vs actual cost insights.", type: "excel" as const },
    { name: "Quality Report", category: "Quality", description: "Open NCRs and warning trends.", type: "pdf" as const },
    { name: "Resource Allocation", category: "Executive", description: "People, capacity, and workload summary.", type: "chart" as const },
  ];

  return (
    <PageLayout
      data-testid="programme-reports-page"
      header={
        <PageHeader
          title="Programme Reports"
          subtitle="Board and management reporting cockpit with full drill-through"
          actions={
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span className="tabular-nums">Last import: {summary.staleness.lastImportLabel} · {summary.staleness.staleRows} stale rows</span>
            </div>
          }
        />
      }
    >
      <ReportTrustNotice
        lastUpdatedAt={reportFreshnessAt}
        sourceLabel="Programme reports APIs (/api/reports/*)"
        note="Board and management views are generated from live report endpoints; stale rows are highlighted for trust transparency."
      />

      <ProgrammeControlBar periodType={periodType} setPeriodType={setPeriodType} month={month} setMonth={setMonth} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} onBoardPdf={exportBoardPdf} />

      <Tabs defaultValue="board" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="board"><Building2 className="w-3.5 h-3.5 mr-1" />Board View</TabsTrigger>
          <TabsTrigger value="management"><Briefcase className="w-3.5 h-3.5 mr-1" />Management View</TabsTrigger>
          <TabsTrigger value="library"><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Report Library</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          <BoardView summary={summary} trendText={trendText} openDrill={openDrill} exportBoardPdf={exportBoardPdf} />
        </TabsContent>

        <TabsContent value="management" className="mt-4">
          <ManagementView summary={summary} openDrill={openDrill} />
        </TabsContent>

        <TabsContent value="library" className="mt-4 space-y-4">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Report Library</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reportCatalog.map((report) => (
                <ReportCard key={report.name} name={report.name} description={`${report.category} • ${report.description}`} type={report.type} lastGenerated={new Date().toLocaleDateString()} />
              ))}
            </div>
          </div>
          <Tabs defaultValue="project-plan" className="w-full">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="project-plan">Project Plan</TabsTrigger>
              <TabsTrigger value="cost">Cost</TabsTrigger>
              <TabsTrigger value="quality">Quality</TabsTrigger>
              <TabsTrigger value="resource">Resource Allocation</TabsTrigger>
            </TabsList>
            <TabsContent value="project-plan" className="mt-4"><ProjectPlanReport /></TabsContent>
            <TabsContent value="cost" className="mt-4"><CostReport /></TabsContent>
            <TabsContent value="quality" className="mt-4"><QualityReport /></TabsContent>
            <TabsContent value="resource" className="mt-4"><ResourceAllocationReport /></TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

      <DrilldownDrawer
        open={!!drill}
        onOpenChange={(o) => !o && setDrill(null)}
        title={drill?.title || "Programme drill-through"}
        endpoint="/api/reports/programme/drilldown"
        context={drill?.context || {}}
      />
    </PageLayout>
  );
}
