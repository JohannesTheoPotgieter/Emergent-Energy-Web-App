import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ragBadgeClasses } from "@/lib/status-colors";
import {
  formatCurrencyCompact,
  formatCurrencyFull,
  formatDate,
  type ExecutionDashboardProject,
} from "@/lib/execution-dashboard";
import {
  ArrowRight, ArrowUpDown, ChevronDown, ChevronUp,
  DollarSign, TrendingUp, TrendingDown, BarChart3,
  AlertTriangle, ExternalLink, Info,
} from "lucide-react";
import { useExecutionData } from "./use-execution-data";

type SortKey = "projectName" | "pm" | "plannedRevenue" | "receivedInflow" | "revenueVariance" | "plannedExpenditure" | "paidExpenditure" | "expenditureVariance" | "grossProfit" | "grossMargin" | "openInflow" | "openExpenditure";
type SortDir = "asc" | "desc";

function sortProjects(projects: ExecutionDashboardProject[], key: SortKey, dir: SortDir): ExecutionDashboardProject[] {
  const m = dir === "asc" ? 1 : -1;
  return [...projects].sort((a, b) => {
    switch (key) {
      case "projectName": return m * (a.projectName || "").localeCompare(b.projectName || "");
      case "pm": return m * (a.pm || "").localeCompare(b.pm || "");
      case "plannedRevenue": return m * (a.plannedRevenueFy - b.plannedRevenueFy);
      case "receivedInflow": return m * (a.receivedInflowFy - b.receivedInflowFy);
      case "revenueVariance": return m * ((a.receivedInflowFy - a.plannedRevenueFy) - (b.receivedInflowFy - b.plannedRevenueFy));
      case "plannedExpenditure": return m * (a.plannedExpenditureFy - b.plannedExpenditureFy);
      case "paidExpenditure": return m * (a.paidExpenditureFy - b.paidExpenditureFy);
      case "expenditureVariance": return m * ((a.paidExpenditureFy - a.plannedExpenditureFy) - (b.paidExpenditureFy - b.plannedExpenditureFy));
      case "grossProfit": return m * (a.grossProfitFy - b.grossProfitFy);
      case "grossMargin": return m * ((a.grossMarginPctFy || 0) - (b.grossMarginPctFy || 0));
      case "openInflow": return m * (a.openInflowFy - b.openInflowFy);
      case "openExpenditure": return m * (a.openExpenditureFy - b.openExpenditureFy);
      default: return 0;
    }
  });
}

export default function FinancePage() {
  const { kpis, filteredProjects, actionRows, openProject, fyLabel } = useExecutionData();
  const [sortKey, setSortKey] = useState<SortKey>("grossMargin");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const sorted = useMemo(() => sortProjects(filteredProjects, sortKey, sortDir), [filteredProjects, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortHeader = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={`py-2.5 px-2 font-medium cursor-pointer hover:text-foreground select-none whitespace-nowrap ${className || ""}`} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">
        {children}
        {sortKey === k && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        {sortKey !== k && <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  );

  // Margin erosion watchlist: projects with negative or low margin
  const marginWatchlist = useMemo(() => {
    return [...filteredProjects]
      .filter((p) => p.grossMarginPctFy !== null && p.grossMarginPctFy < 15)
      .sort((a, b) => (a.grossMarginPctFy || 0) - (b.grossMarginPctFy || 0))
      .slice(0, 10);
  }, [filteredProjects]);

  // Finance risk rows from action center
  const financeRiskRows = useMemo(() => {
    return actionRows
      .filter((r) => {
        const q = r.queue?.toLowerCase() || "";
        return q.includes("inflow") || q.includes("expenditure") || q.includes("cos");
      })
      .slice(0, 15);
  }, [actionRows]);

  return (
    <div className="space-y-5">
      {/* KPI STRIP - Revenue */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label={`Budget Revenue (${fyLabel})`} value={formatCurrencyCompact(kpis.plannedRevenueFy)} icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} iconBg="bg-emerald-100" />
        <KpiCard label={`Actual Revenue (${fyLabel})`} value={formatCurrencyCompact(kpis.receivedInflowFy)} icon={<TrendingUp className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-100" sub={`${kpis.plannedRevenueFy > 0 ? Math.round((kpis.receivedInflowFy / kpis.plannedRevenueFy) * 100) : 0}% collected`} />
        <KpiCard label="Revenue Outstanding" value={formatCurrencyCompact(kpis.openInflowFy)} icon={<DollarSign className="w-4 h-4 text-amber-600" />} iconBg="bg-amber-100" valueClass="text-amber-600" />
        <KpiCard label={`Budget Expenditure (${fyLabel})`} value={formatCurrencyCompact(kpis.plannedExpenditureFy)} icon={<TrendingDown className="w-4 h-4 text-orange-600" />} iconBg="bg-orange-100" />
        <KpiCard label={`Actual Expenditure (${fyLabel})`} value={formatCurrencyCompact(kpis.paidExpenditureFy)} icon={<TrendingDown className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-100" sub={`${kpis.plannedExpenditureFy > 0 ? Math.round((kpis.paidExpenditureFy / kpis.plannedExpenditureFy) * 100) : 0}% spent`} />
        <KpiCard label="Expense Outstanding" value={formatCurrencyCompact(kpis.openExpenditureFy)} icon={<DollarSign className="w-4 h-4 text-amber-600" />} iconBg="bg-amber-100" valueClass="text-amber-600" />
      </div>

      {/* KPI STRIP - Margin */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Gross Profit" value={formatCurrencyCompact(kpis.grossProfitFy)} icon={<BarChart3 className="w-4 h-4 text-emerald-600" />} iconBg="bg-emerald-100" />
        <KpiCard label="Planned Margin" value={`${kpis.grossMarginPctFy ?? "—"}%`} icon={<BarChart3 className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-100" />
        <KpiCard label="Actual Margin" value={`${kpis.actualMarginPctFy ?? "—"}%`} icon={<BarChart3 className="w-4 h-4 text-violet-600" />} iconBg="bg-violet-100" />
        <KpiCard
          label="Margin Variance"
          value={kpis.marginVariancePct !== null ? `${kpis.marginVariancePct > 0 ? "+" : ""}${kpis.marginVariancePct}%` : "—"}
          icon={<BarChart3 className="w-4 h-4 text-amber-600" />}
          iconBg="bg-amber-100"
          valueClass={(kpis.marginVariancePct ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}
        />
        <KpiCard label="Inflow Risk Projects" value={kpis.inflowRiskProjects} icon={<AlertTriangle className="w-4 h-4 text-red-600" />} iconBg="bg-red-100" valueClass="text-red-600" sub={`${kpis.outflowRiskProjects} outflow risk`} />
      </div>

      {/* Data availability notice */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Budget vs Actual is shown at FY level only. Weekly and monthly breakdowns are not yet available in the data contract. AR/AP ageing, cashflow forecasts, and VO/change control data are also not yet available.
        </span>
      </div>

      {/* Gross Profit & Collection Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-emerald-700 font-medium uppercase">Gross Profit ({fyLabel})</div>
            <p className="text-xl font-bold text-emerald-800">{formatCurrencyCompact(kpis.grossProfitFy)}</p>
            <p className="text-[10px] text-emerald-600">Planned Margin: {kpis.grossMarginPctFy ?? "—"}% | Actual: {kpis.actualMarginPctFy ?? "—"}%</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-blue-700 font-medium uppercase">Inflow Collection Rate</div>
            <p className="text-xl font-bold text-blue-800">{kpis.plannedRevenueFy > 0 ? `${Math.round((kpis.receivedInflowFy / kpis.plannedRevenueFy) * 100)}%` : "—"}</p>
            <p className="text-[10px] text-blue-600">{formatCurrencyCompact(kpis.receivedInflowFy)} of {formatCurrencyCompact(kpis.plannedRevenueFy)}</p>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-orange-700 font-medium uppercase">Expenditure Paid Rate</div>
            <p className="text-xl font-bold text-orange-800">{kpis.plannedExpenditureFy > 0 ? `${Math.round((kpis.paidExpenditureFy / kpis.plannedExpenditureFy) * 100)}%` : "—"}</p>
            <p className="text-[10px] text-orange-600">{formatCurrencyCompact(kpis.paidExpenditureFy)} of {formatCurrencyCompact(kpis.plannedExpenditureFy)}</p>
          </CardContent>
        </Card>
      </div>

      {/* PROJECT FINANCE CONTROL TABLE */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold">Project Finance Control</h2>
            <Badge variant="outline" className="text-xs ml-1">{sorted.length} projects</Badge>
          </div>
          <div className="rounded-lg border border-border/60 overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <SortHeader k="projectName" className="text-left px-3">Project</SortHeader>
                  <SortHeader k="pm" className="text-left">PM</SortHeader>
                  <SortHeader k="plannedRevenue" className="text-right">Budget Rev.</SortHeader>
                  <SortHeader k="receivedInflow" className="text-right">Actual Rev.</SortHeader>
                  <SortHeader k="openInflow" className="text-right">Rev. Open</SortHeader>
                  <SortHeader k="plannedExpenditure" className="text-right">Budget Exp.</SortHeader>
                  <SortHeader k="paidExpenditure" className="text-right">Actual Exp.</SortHeader>
                  <SortHeader k="openExpenditure" className="text-right">Exp. Open</SortHeader>
                  <SortHeader k="grossProfit" className="text-right">GP</SortHeader>
                  <SortHeader k="grossMargin" className="text-right">Margin</SortHeader>
                  <th className="w-8 py-2.5 px-1"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const expanded = expandedId === p.projectId;
                  const revenueVar = p.receivedInflowFy - p.plannedRevenueFy;
                  const expenditureVar = p.paidExpenditureFy - p.plannedExpenditureFy;
                  return (
                    <React.Fragment key={p.projectId}>
                      <tr
                        className={`border-t border-border/40 cursor-pointer transition-colors ${expanded ? "bg-emerald-50/40" : "hover:bg-muted/30"}`}
                        onClick={() => setExpandedId(expanded ? null : p.projectId)}
                      >
                        <td className="py-2 px-3 font-medium truncate max-w-[180px]">{p.projectName}</td>
                        <td className="py-2 px-2 text-muted-foreground text-xs">{p.pm || "—"}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs">{formatCurrencyCompact(p.plannedRevenueFy)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs text-emerald-600">{formatCurrencyCompact(p.receivedInflowFy)}</td>
                        <td className={`py-2 px-2 text-right tabular-nums text-xs ${p.openInflowFy > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{formatCurrencyCompact(p.openInflowFy)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs">{formatCurrencyCompact(p.plannedExpenditureFy)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs text-emerald-600">{formatCurrencyCompact(p.paidExpenditureFy)}</td>
                        <td className={`py-2 px-2 text-right tabular-nums text-xs ${p.openExpenditureFy > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{formatCurrencyCompact(p.openExpenditureFy)}</td>
                        <td className={`py-2 px-2 text-right tabular-nums text-xs font-medium ${p.grossProfitFy < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrencyCompact(p.grossProfitFy)}</td>
                        <td className={`py-2 px-2 text-right tabular-nums text-xs font-medium ${(p.grossMarginPctFy ?? 0) < 10 ? "text-red-600" : (p.grossMarginPctFy ?? 0) < 20 ? "text-amber-600" : ""}`}>
                          {p.grossMarginPctFy === null ? "—" : `${p.grossMarginPctFy}%`}
                        </td>
                        <td className="py-2 px-1 text-center">
                          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/20 border-t border-border/40">
                          <td colSpan={11} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Revenue ({fyLabel})</p>
                                <div className="space-y-1.5 text-sm">
                                  <p><span className="text-muted-foreground">Budget:</span> {formatCurrencyFull(p.plannedRevenueFy)}</p>
                                  <p><span className="text-muted-foreground">Received:</span> <span className="text-emerald-600">{formatCurrencyFull(p.receivedInflowFy)}</span></p>
                                  <p><span className="text-muted-foreground">Outstanding:</span> <span className="text-amber-600">{formatCurrencyFull(p.openInflowFy)}</span></p>
                                  <p><span className="text-muted-foreground">Variance:</span> <span className={revenueVar < 0 ? "text-red-600" : "text-emerald-600"}>{formatCurrencyFull(revenueVar)}</span></p>
                                  <p><span className="text-muted-foreground">Inflow Risk:</span> <span className={p.inflowRisk ? "text-red-600 font-medium" : "text-emerald-600"}>{p.inflowRisk ? "Yes" : "No"}</span></p>
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Expenditure ({fyLabel})</p>
                                <div className="space-y-1.5 text-sm">
                                  <p><span className="text-muted-foreground">Budget:</span> {formatCurrencyFull(p.plannedExpenditureFy)}</p>
                                  <p><span className="text-muted-foreground">Paid:</span> <span className="text-emerald-600">{formatCurrencyFull(p.paidExpenditureFy)}</span></p>
                                  <p><span className="text-muted-foreground">Outstanding:</span> <span className="text-amber-600">{formatCurrencyFull(p.openExpenditureFy)}</span></p>
                                  <p><span className="text-muted-foreground">Variance:</span> <span className={expenditureVar > 0 ? "text-red-600" : "text-emerald-600"}>{formatCurrencyFull(expenditureVar)}</span></p>
                                  <p><span className="text-muted-foreground">Outflow Risk:</span> <span className={p.outflowRisk ? "text-red-600 font-medium" : "text-emerald-600"}>{p.outflowRisk ? "Yes" : "No"}</span></p>
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Profitability</p>
                                <div className="space-y-1.5 text-sm">
                                  <p><span className="text-muted-foreground">Gross Profit:</span> <span className={p.grossProfitFy < 0 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>{formatCurrencyFull(p.grossProfitFy)}</span></p>
                                  <p><span className="text-muted-foreground">GP Margin:</span> <span className="font-medium">{p.grossMarginPctFy === null ? "—" : `${p.grossMarginPctFy}%`}</span></p>
                                  <p><span className="text-muted-foreground">Portfolio:</span> {p.portfolio || "—"}</p>
                                  <p><span className="text-muted-foreground">Phase:</span> {p.executionPhase || "—"}</p>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <Button size="sm" onClick={() => openProject(p)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                <ExternalLink className="w-3.5 h-3.5" />Open Project
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openProject(p, "revenue")}>Revenue</Button>
                              <Button size="sm" variant="outline" onClick={() => openProject(p, "expenditure")}>Expenditure</Button>
                              <Button size="sm" variant="outline" onClick={() => openProject(p, "cashflow")}>Cashflow</Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {sorted.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground">No projects match current filters</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* MARGIN EROSION WATCHLIST */}
      {marginWatchlist.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <h3 className="text-sm font-semibold">Margin Erosion Watchlist</h3>
              <Badge variant="outline" className="text-xs">{marginWatchlist.length} projects under 15% margin</Badge>
            </div>
            <div className="rounded-lg border border-border/60 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Project</th>
                    <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">PM</th>
                    <th className="text-right py-2 px-3 font-medium">GP Margin</th>
                    <th className="text-right py-2 px-3 font-medium">Gross Profit</th>
                    <th className="text-right py-2 px-3 font-medium hidden md:table-cell">Revenue</th>
                    <th className="text-right py-2 px-3 font-medium hidden md:table-cell">Expenditure</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {marginWatchlist.map((p) => (
                    <tr key={p.projectId} className="border-t border-border/40 hover:bg-muted/30 cursor-pointer" onClick={() => openProject(p, "revenue")}>
                      <td className="py-2 px-3 font-medium truncate max-w-[200px]">{p.projectName}</td>
                      <td className="py-2 px-3 text-muted-foreground text-xs hidden sm:table-cell">{p.pm || "—"}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-medium ${(p.grossMarginPctFy ?? 0) < 0 ? "text-red-600" : (p.grossMarginPctFy ?? 0) < 10 ? "text-red-600" : "text-amber-600"}`}>
                        {p.grossMarginPctFy === null ? "—" : `${p.grossMarginPctFy}%`}
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums ${p.grossProfitFy < 0 ? "text-red-600" : ""}`}>{formatCurrencyCompact(p.grossProfitFy)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs hidden md:table-cell">{formatCurrencyCompact(p.plannedRevenueFy)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs hidden md:table-cell">{formatCurrencyCompact(p.plannedExpenditureFy)}</td>
                      <td className="py-2 px-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); openProject(p, "revenue"); }}>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* FINANCE RISK ITEMS */}
      {financeRiskRows.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-orange-500" />
              <h3 className="text-sm font-semibold">Cash / Exposure Risks</h3>
              <Badge variant="outline" className="text-xs">{financeRiskRows.length}</Badge>
            </div>
            <div className="rounded-lg border border-border/60 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Project</th>
                    <th className="text-left py-2 px-3 font-medium">Risk</th>
                    <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Category</th>
                    <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Owner</th>
                    <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Severity</th>
                    <th className="text-left py-2 px-3 font-medium hidden lg:table-cell">Due</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {financeRiskRows.map((r, i) => (
                    <tr key={i} className="border-t border-border/40 hover:bg-muted/30">
                      <td className="py-2 px-3 font-medium">{r.projectName}</td>
                      <td className="py-2 px-3 text-muted-foreground truncate max-w-[250px]">{r.issueTitle}</td>
                      <td className="py-2 px-3 text-muted-foreground text-xs hidden md:table-cell">{r.queue}</td>
                      <td className="py-2 px-3 text-muted-foreground text-xs hidden md:table-cell">{r.owner}</td>
                      <td className="py-2 px-3 hidden md:table-cell">
                        <Badge className={`text-[10px] ${r.severity === "critical" ? "bg-red-100 text-red-700" : r.severity === "high" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{r.severity}</Badge>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground text-xs tabular-nums hidden lg:table-cell">{formatDate(r.dueDate)}</td>
                      <td className="py-2 px-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => window.location.href = r.link}>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ icon, iconBg, label, value, sub, valueClass }: {
  icon: React.ReactNode; iconBg: string; label: string; value: React.ReactNode; sub?: string; valueClass?: string;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>{icon}</div>
          <span className="text-[10px] text-muted-foreground font-medium leading-tight">{label}</span>
        </div>
        <p className={`text-lg font-bold tabular-nums ${valueClass || ""}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}
