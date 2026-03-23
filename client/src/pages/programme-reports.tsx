import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Download, FileSpreadsheet, Search, Clock, ShieldAlert, CalendarDays, BarChart3 } from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function StalenessWarning({ isStale, daysSinceImport }: { isStale: boolean; daysSinceImport: number }) {
  if (!isStale) return null;
  return (
    <div className="flex items-center gap-1.5 text-amber-600 text-xs">
      <Clock className="w-3.5 h-3.5" />
      <span>Data is {daysSinceImport >= 0 ? `${daysSinceImport} day(s)` : "never imported"} since last import</span>
    </div>
  );
}

function ManualEditIndicator({ hasProtectedFields }: { hasProtectedFields: boolean }) {
  if (!hasProtectedFields) return null;
  return (
    <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50 text-[10px] gap-1">
      <ShieldAlert className="w-3 h-3" />
      Contains protected manual edits
    </Badge>
  );
}

function ReportMeta({ meta, lastImportAt, hasProtectedFields }: { meta: any; lastImportAt?: string; hasProtectedFields?: boolean }) {
  const hasStale = meta?.stalenessThresholdDays;
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground px-1 py-2">
      <div className="flex items-center gap-3">
        <span>{meta?.count || 0} records</span>
        {lastImportAt && (
          <span>Last import: {new Date(lastImportAt).toLocaleString()}</span>
        )}
        {hasStale && <span className="text-slate-400">(Staleness threshold: {meta.stalenessThresholdDays} days)</span>}
      </div>
      {hasProtectedFields && <ManualEditIndicator hasProtectedFields />}
    </div>
  );
}

function ExportButton({ reportType, filters }: { reportType: string; filters: Record<string, string> }) {
  const handleExport = () => {
    const params = new URLSearchParams({ ...filters, format: "xlsx" });
    const url = `/api/reports/${reportType}?${params.toString()}`;
    const link = document.createElement("a");
    link.href = url;
    // Add auth header via fetch
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

function ProjectPlanReport() {
  const [projectFilter, setProjectFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/project-plan", projectFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectFilter) params.set("projectName", projectFilter);
      const res = await fetch(`/api/reports/project-plan?${params}`, { headers: getAuthHeaders() });
      return res.json();
    },
  });

  const rows = data?.data || [];
  const hasStale = rows.some((r: any) => r.isStale);
  const hasProtected = rows.some((r: any) => r.hasProtectedFields);
  const latestImport = rows.reduce((max: string, r: any) => r.lastImportAt && r.lastImportAt > max ? r.lastImportAt : max, "");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Filter by project..."
            className="pl-9 h-9"
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
          />
        </div>
        <ExportButton reportType="project-plan" filters={{ projectName: projectFilter }} />
      </div>

      {hasStale && (
        <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Some project data exceeds the staleness threshold. Consider re-importing.
        </div>
      )}

      <ReportMeta meta={data?.meta} lastImportAt={latestImport} hasProtectedFields={hasProtected} />

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Task</th>
                <th className="text-left px-3 py-2 font-medium">Phase</th>
                <th className="text-left px-3 py-2 font-medium">Start</th>
                <th className="text-left px-3 py-2 font-medium">End</th>
                <th className="text-left px-3 py-2 font-medium">Owner</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">% Complete</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
              ) : rows.map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-1.5 max-w-[180px] truncate">{r.projectName}</td>
                  <td className="px-3 py-1.5 max-w-[200px] truncate">{r.isMilestone ? `[M] ${r.taskName}` : r.taskName}</td>
                  <td className="px-3 py-1.5">{r.phase || "—"}</td>
                  <td className="px-3 py-1.5">{r.startDate || "—"}</td>
                  <td className="px-3 py-1.5">{r.endDate || "—"}</td>
                  <td className="px-3 py-1.5">{r.owner || "—"}</td>
                  <td className="px-3 py-1.5">{r.status || "—"}</td>
                  <td className="px-3 py-1.5 text-right">{r.percentComplete != null ? `${r.percentComplete}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function getMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  // Show last 24 months plus current month
  for (let i = 0; i < 25; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-ZA", { year: "numeric", month: "long" });
    options.push({ value, label });
  }
  return options;
}

function parseMonth(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function CostAnalysis({ rows }: { rows: any[] }) {
  const analysis = useMemo(() => {
    // Category breakdown
    const byCategory: Record<string, { total: number; realized: number; unrealized: number; count: number }> = {};
    // COS Status breakdown
    const byStatus: Record<string, { total: number; count: number }> = {};
    // Counterparty breakdown (top 10)
    const byCounterparty: Record<string, { total: number; count: number }> = {};

    for (const r of rows) {
      const amt = parseFloat(r.amountExVat || "0") || 0;
      const cat = r.costCategory || "Uncategorised";
      const status = r.cosStatus || "Planned";
      const counterparty = r.counterpartyName || "Unknown";

      if (!byCategory[cat]) byCategory[cat] = { total: 0, realized: 0, unrealized: 0, count: 0 };
      byCategory[cat].total += amt;
      byCategory[cat].count++;
      if (r.cosRealized) byCategory[cat].realized += amt;
      else byCategory[cat].unrealized += amt;

      if (!byStatus[status]) byStatus[status] = { total: 0, count: 0 };
      byStatus[status].total += amt;
      byStatus[status].count++;

      if (!byCounterparty[counterparty]) byCounterparty[counterparty] = { total: 0, count: 0 };
      byCounterparty[counterparty].total += amt;
      byCounterparty[counterparty].count++;
    }

    const totalAmount = rows.reduce((sum, r) => sum + (parseFloat(r.amountExVat || "0") || 0), 0);

    const topCounterparties = Object.entries(byCounterparty)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 10);

    return { byCategory, byStatus, byCounterparty: topCounterparties, totalAmount };
  }, [rows]);

  if (rows.length === 0) return null;

  const statusColors: Record<string, string> = {
    Paid: "bg-emerald-500",
    Realised: "bg-blue-500",
    Committed: "bg-purple-500",
    Planned: "bg-slate-300",
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <BarChart3 className="w-4 h-4" />
        Monthly Analysis
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category Breakdown */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">By Category</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="space-y-2">
              {Object.entries(analysis.byCategory)
                .sort(([, a], [, b]) => b.total - a.total)
                .map(([cat, data]) => {
                  const pct = analysis.totalAmount > 0 ? (data.total / analysis.totalAmount) * 100 : 0;
                  return (
                    <div key={cat} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="truncate max-w-[200px]" title={cat}>{cat}</span>
                        <span className="font-mono font-medium">R {data.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                      </div>
                      <div className="flex gap-3 text-[10px] text-muted-foreground">
                        <span>{data.count} items</span>
                        <span className="text-emerald-600">Realized: R {data.realized.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span className="text-amber-600">Unrealized: R {data.unrealized.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>

        {/* COS Status Breakdown */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">By COS Status</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="space-y-2">
                {Object.entries(analysis.byStatus)
                  .sort(([, a], [, b]) => b.total - a.total)
                  .map(([status, data]) => {
                    const pct = analysis.totalAmount > 0 ? (data.total / analysis.totalAmount) * 100 : 0;
                    return (
                      <div key={status} className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColors[status] || "bg-slate-300"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between text-xs">
                            <span>{status}</span>
                            <span className="font-mono font-medium">R {data.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${statusColors[status] || "bg-slate-300"}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground w-16 text-right">{data.count} ({pct.toFixed(1)}%)</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>

          {/* Top Counterparties */}
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top Counterparties</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="space-y-1.5">
                {analysis.byCounterparty.map(([name, data], idx) => (
                  <div key={name} className="flex justify-between text-xs">
                    <span className="truncate max-w-[200px] text-muted-foreground" title={name}>
                      {idx + 1}. {name}
                    </span>
                    <span className="font-mono font-medium shrink-0 ml-2">
                      R {data.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      <span className="text-muted-foreground ml-1">({data.count})</span>
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CostReport() {
  const [projectFilter, setProjectFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/cost", projectFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectFilter) params.set("projectName", projectFilter);
      if (categoryFilter) params.set("costCategory", categoryFilter);
      const res = await fetch(`/api/reports/cost?${params}`, { headers: getAuthHeaders() });
      return res.json();
    },
  });

  const allRows = data?.data || [];
  const hasStale = allRows.some((r: any) => r.isStale);
  const hasProtected = allRows.some((r: any) => r.hasProtectedFields);

  // Apply month filter client-side using payment date, falling back to invoice date
  const rows = useMemo(() => {
    if (monthFilter === "all") return allRows;
    return allRows.filter((r: any) => {
      const month = parseMonth(r.paidDate) || parseMonth(r.invoiceDate);
      return month === monthFilter;
    });
  }, [allRows, monthFilter]);

  // Recalculate aggregates for filtered data
  const agg = useMemo(() => {
    let totalActuals = 0;
    let totalCosRealized = 0;
    for (const r of rows) {
      const amt = parseFloat(r.amountExVat || "0") || 0;
      totalActuals += amt;
      if (r.cosRealized) totalCosRealized += amt;
    }
    return { totalActuals, totalCosRealized, totalUnrealized: totalActuals - totalCosRealized };
  }, [rows]);

  const monthOptions = useMemo(() => getMonthOptions(), []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2 flex-1 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Filter project..." className="pl-9 h-9" value={projectFilter} onChange={e => setProjectFilter(e.target.value)} />
          </div>
          <Input placeholder="Filter category..." className="h-9 max-w-[180px]" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} />
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="h-9 w-[200px]">
              <CalendarDays className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="All months" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {monthOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ExportButton reportType="cost" filters={{ projectName: projectFilter, costCategory: categoryFilter }} />
      </div>

      {hasStale && (
        <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Some cost data exceeds the staleness threshold.
        </div>
      )}

      {/* Aggregates */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-card"><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Total Actuals</p>
          <p className="text-lg font-bold">R {(agg.totalActuals || 0).toLocaleString()}</p>
        </CardContent></Card>
        <Card className="bg-card"><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">COS Realized</p>
          <p className="text-lg font-bold text-emerald-600">R {(agg.totalCosRealized || 0).toLocaleString()}</p>
        </CardContent></Card>
        <Card className="bg-card"><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Unrealized COS</p>
          <p className="text-lg font-bold text-amber-600">R {(agg.totalUnrealized || 0).toLocaleString()}</p>
        </CardContent></Card>
      </div>

      <ReportMeta meta={{ count: rows.length, stalenessThresholdDays: data?.meta?.stalenessThresholdDays }} hasProtectedFields={hasProtected} />

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">Counterparty</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium">Invoice</th>
                <th className="text-left px-3 py-2 font-medium">COS Status</th>
                <th className="text-left px-3 py-2 font-medium">Payment</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No data{monthFilter !== "all" ? " for selected month" : ""}</td></tr>
              ) : rows.map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-1.5 max-w-[150px] truncate">{r.projectName}</td>
                  <td className="px-3 py-1.5">{r.costCategory || "—"}</td>
                  <td className="px-3 py-1.5 max-w-[150px] truncate">{r.counterpartyName || "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.amountExVat || "—"}</td>
                  <td className="px-3 py-1.5">
                    {r.invoiceNumber || "—"}
                    {r.invoiceDateConfirmed && <span className="ml-1 text-emerald-600" title="Confirmed">&#x2713;</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant="outline" className={`text-[10px] ${
                      r.cosStatus === "Paid" ? "text-emerald-700 border-emerald-200 bg-emerald-50" :
                      r.cosStatus === "Realised" ? "text-blue-700 border-blue-200 bg-blue-50" :
                      r.cosStatus === "Committed" ? "text-purple-700 border-purple-200 bg-purple-50" :
                      "text-slate-500 border-slate-200"
                    }`}>
                      {r.cosStatus}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5">
                    {r.paidDate || "—"}
                    {r.paymentConfirmed && <span className="ml-1 text-emerald-600" title="Confirmed">&#x2713;</span>}
                    {r.paidDate && !r.paymentConfirmed && <span className="ml-1 text-red-400" title="Unconfirmed (not black)">?</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Analysis Section - shown when month filter is active */}
      {monthFilter !== "all" && <CostAnalysis rows={rows} />}
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
      const res = await fetch(`/api/reports/quality?${params}`, { headers: getAuthHeaders() });
      return res.json();
    },
  });

  const rows = data?.data || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Filter by project..." className="pl-9 h-9" value={projectFilter} onChange={e => setProjectFilter(e.target.value)} />
        </div>
        <ExportButton reportType="quality" filters={{ projectName: projectFilter }} />
      </div>

      <ReportMeta meta={data?.meta} />

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Phase</th>
                <th className="text-left px-3 py-2 font-medium">RAG Status</th>
                <th className="text-left px-3 py-2 font-medium">Size (kWp)</th>
                <th className="text-left px-3 py-2 font-medium">PD</th>
                <th className="text-left px-3 py-2 font-medium">PM</th>
                <th className="text-left px-3 py-2 font-medium">Last Import</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
              ) : rows.map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-1.5">{r.projectName}</td>
                  <td className="px-3 py-1.5">{r.phase || "—"}</td>
                  <td className="px-3 py-1.5">
                    {r.ragStatus ? (
                      <Badge variant="outline" className={`text-[10px] ${
                        r.ragStatus === "GREEN" || r.ragStatus === "green" ? "text-emerald-700 border-emerald-200 bg-emerald-50" :
                        r.ragStatus === "AMBER" || r.ragStatus === "amber" ? "text-amber-700 border-amber-200 bg-amber-50" :
                        r.ragStatus === "RED" || r.ragStatus === "red" ? "text-red-700 border-red-200 bg-red-50" :
                        "text-slate-500"
                      }`}>
                        {r.ragStatus}
                      </Badge>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5">{r.sizeKwp || "—"}</td>
                  <td className="px-3 py-1.5">{r.pd || "—"}</td>
                  <td className="px-3 py-1.5">{r.pm || "—"}</td>
                  <td className="px-3 py-1.5 text-slate-400">
                    {r.lastImportAt ? new Date(r.lastImportAt).toLocaleDateString() : "Never"}
                    {r.isStale && <AlertTriangle className="w-3 h-3 inline ml-1 text-amber-500" />}
                  </td>
                </tr>
              ))}
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
      const res = await fetch(`/api/reports/resource-allocation?${params}`, { headers: getAuthHeaders() });
      return res.json();
    },
  });

  const rows = data?.data || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Filter by resource..." className="pl-9 h-9" value={resourceFilter} onChange={e => setResourceFilter(e.target.value)} />
        </div>
        <ExportButton reportType="resource-allocation" filters={{ resource: resourceFilter }} />
      </div>

      <ReportMeta meta={data?.meta} />

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Resource</th>
                <th className="text-right px-3 py-2 font-medium">Total Tasks</th>
                <th className="text-right px-3 py-2 font-medium">Completed</th>
                <th className="text-right px-3 py-2 font-medium">In Progress</th>
                <th className="text-right px-3 py-2 font-medium">Planned Hrs</th>
                <th className="text-right px-3 py-2 font-medium">Actual Hrs</th>
                <th className="text-right px-3 py-2 font-medium">Utilisation</th>
                <th className="text-left px-3 py-2 font-medium">Projects</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
              ) : rows.map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-1.5 font-medium">{r.resource}</td>
                  <td className="px-3 py-1.5 text-right">{r.totalTasks}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-600">{r.completedTasks}</td>
                  <td className="px-3 py-1.5 text-right text-blue-600">{r.inProgressTasks}</td>
                  <td className="px-3 py-1.5 text-right">{r.plannedHours || "—"}</td>
                  <td className="px-3 py-1.5 text-right">{r.actualHours || "—"}</td>
                  <td className="px-3 py-1.5 text-right">{r.utilisation > 0 ? `${r.utilisation}%` : "—"}</td>
                  <td className="px-3 py-1.5 max-w-[200px] truncate text-slate-500" title={r.projects}>{r.projects}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ProgrammeReports() {
  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Programme Reports</h1>
      </div>

      <Tabs defaultValue="project-plan" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="project-plan">Project Plan</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="resource">Resource Allocation</TabsTrigger>
        </TabsList>

        <TabsContent value="project-plan" className="mt-4">
          <ProjectPlanReport />
        </TabsContent>

        <TabsContent value="cost" className="mt-4">
          <CostReport />
        </TabsContent>

        <TabsContent value="quality" className="mt-4">
          <QualityReport />
        </TabsContent>

        <TabsContent value="resource" className="mt-4">
          <ResourceAllocationReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
