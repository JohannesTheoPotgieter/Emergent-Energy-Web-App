import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";
import { EnergyLoader } from "@/components/ui/energy-loader";
import { Activity, AlertCircle, AlertTriangle, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from "lucide-react";
import {
  ExecutionDashboardProject,
  ExecutionDashboardResponse,
  ExecutionFilters,
  filterExecutionProjects,
  formatCurrencyCompact,
  formatCurrencyFull,
  formatDate,
} from "@/lib/execution-dashboard";

type RoleView = "coo" | "program" | "finance" | "construction";

const defaultFilters: ExecutionFilters = {
  search: "",
  portfolio: "all",
  pm: "all",
  pd: "all",
  executionPhase: "all",
  rag: "all",
  exceptionOnly: false,
  behindPlanOnly: false,
  inflowRiskOnly: false,
  outflowRiskOnly: false,
  engineeringBlockersOnly: false,
  qualityIssuesOnly: false,
  pendingApprovalsOnly: false,
  staleImportsOnly: false,
};

function ragClass(rag: string) {
  if (rag === "Red") return "bg-red-50 text-red-700 border-red-200";
  if (rag === "Amber") return "bg-amber-50 text-amber-700 border-amber-200";
  if (rag === "Green") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-muted text-muted-foreground border-border";
}

export default function ExecutionBoard() {
  const { allowed: canView } = usePermission("execution_board", "view");
  const [dashboard, setDashboard] = useState<ExecutionDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ExecutionFilters>(defaultFilters);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<RoleView>("coo");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/lifecycle-board/execution-dashboard", { headers });
      if (!res.ok) throw new Error(`Failed to load dashboard (${res.status})`);
      const data: ExecutionDashboardResponse = await res.json();
      setDashboard(data);
    } catch (err: any) {
      setError(err.message || "Failed to load execution dashboard");
      toast({ title: "Error", description: err.message || "Failed to load execution dashboard", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const allProjects = dashboard?.projects || [];
  const fyLabel = dashboard?.financialYear?.label || "Current FY";

  const filteredProjects = useMemo(() => filterExecutionProjects(allProjects, filters), [allProjects, filters]);

  const portfolios = useMemo(() => Array.from(new Set(allProjects.map((p) => p.portfolio || "—"))).sort(), [allProjects]);
  const pms = useMemo(() => Array.from(new Set(allProjects.map((p) => p.pm || "Unassigned"))).sort(), [allProjects]);
  const pds = useMemo(() => Array.from(new Set(allProjects.map((p) => p.pd || "Unassigned"))).sort(), [allProjects]);
  const phases = useMemo(() => Array.from(new Set(allProjects.map((p) => p.executionPhase || "Unassigned"))).sort(), [allProjects]);

  const kpis = useMemo(() => {
    const plannedRevenue = filteredProjects.reduce((s, p) => s + p.plannedRevenueFy, 0);
    const receivedInflow = filteredProjects.reduce((s, p) => s + p.receivedInflowFy, 0);
    const plannedExpenditure = filteredProjects.reduce((s, p) => s + p.plannedExpenditureFy, 0);
    const paidExpenditure = filteredProjects.reduce((s, p) => s + p.paidExpenditureFy, 0);
    return {
      activeDashboardProjects: filteredProjects.length,
      averageActualProgressPct: filteredProjects.length ? Number((filteredProjects.reduce((s, p) => s + (p.actualProgressPct || 0), 0) / filteredProjects.length).toFixed(1)) : null,
      averageExpectedProgressPct: filteredProjects.length ? Number((filteredProjects.reduce((s, p) => s + (p.expectedProgressPct || 0), 0) / filteredProjects.length).toFixed(1)) : null,
      projectsBehindPlan: filteredProjects.filter((p) => p.behindPlan).length,
      plannedRevenueFy: plannedRevenue,
      receivedInflowFy: receivedInflow,
      openInflowFy: plannedRevenue - receivedInflow,
      plannedExpenditureFy: plannedExpenditure,
      paidExpenditureFy: paidExpenditure,
      openExpenditureFy: plannedExpenditure - paidExpenditure,
      grossProfitFy: plannedRevenue - plannedExpenditure,
      grossMarginPctFy: plannedRevenue > 0 ? Number((((plannedRevenue - plannedExpenditure) / plannedRevenue) * 100).toFixed(1)) : null,
      openEngineeringBlockers: filteredProjects.reduce((s, p) => s + p.engineeringBlockerCount, 0),
      openQualityWarnings: filteredProjects.reduce((s, p) => s + p.openQualityWarningCount, 0),
      pendingApprovals: filteredProjects.reduce((s, p) => s + p.pendingApprovalCount, 0),
      staleImports: filteredProjects.filter((p) => p.importFreshness !== "Fresh").length,
    };
  }, [filteredProjects]);

  const actionRows = useMemo(() => {
    if (!dashboard) return [];
    const visibleIds = new Set(filteredProjects.map((p) => p.projectId));
    return dashboard.actionCenter.rows.filter((r) => visibleIds.has(r.projectId));
  }, [dashboard, filteredProjects]);

  const openProject = (project: ExecutionDashboardProject, tab?: string) => {
    setLocation(tab ? `/projects/${project.projectId}?tab=${tab}` : `/projects/${project.projectId}`);
  };

  if (loading) return <div className="flex flex-col items-center justify-center py-24 gap-3"><EnergyLoader size="lg" label="Loading execution dashboard..." /></div>;
  if (error) return <div className="flex flex-col items-center justify-center py-24 gap-4"><AlertCircle className="w-8 h-8 text-red-500" /><p>{error}</p><Button onClick={loadData}><RefreshCw className="w-3.5 h-3.5 mr-1" />Retry</Button></div>;
  if (!canView) return <div className="flex items-center justify-center min-h-[60vh]"><Card><CardContent className="py-8 text-center"><AlertTriangle className="mx-auto mb-2" /><p>Access Denied</p></CardContent></Card></div>;

  return (
    <div className="space-y-4 max-w-[1800px] mx-auto pb-6" data-testid="execution-board-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Activity className="w-6 h-6 text-blue-600" />Execution Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Import-backed operational view for {fyLabel} ({dashboard?.financialYear.start} to {dashboard?.financialYear.end})</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={loadData}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
          <Button variant="outline" size="sm" onClick={() => setFilters(defaultFilters)}>Reset filters</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
            <Input placeholder="Search" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
            <SearchableSelect value={filters.portfolio} onValueChange={(v) => setFilters((f) => ({ ...f, portfolio: v }))} placeholder="Portfolio" options={[{ value: "all", label: "All" }, ...portfolios.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.pm} onValueChange={(v) => setFilters((f) => ({ ...f, pm: v }))} placeholder="PM" options={[{ value: "all", label: "All" }, ...pms.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.pd} onValueChange={(v) => setFilters((f) => ({ ...f, pd: v }))} placeholder="PD" options={[{ value: "all", label: "All" }, ...pds.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.executionPhase} onValueChange={(v) => setFilters((f) => ({ ...f, executionPhase: v }))} placeholder="Execution Phase" options={[{ value: "all", label: "All" }, ...phases.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.rag} onValueChange={(v) => setFilters((f) => ({ ...f, rag: v }))} placeholder="RAG" options={[{ value: "all", label: "All" }, { value: "Red", label: "Red" }, { value: "Amber", label: "Amber" }, { value: "Green", label: "Green" }, { value: "Unknown", label: "Unknown" }]} />
            <div className="text-xs text-muted-foreground flex items-center">Showing {filteredProjects.length} of {allProjects.length} projects</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["exceptionOnly", "Exception only"], ["behindPlanOnly", "Behind plan only"], ["inflowRiskOnly", "Inflow risk only"], ["outflowRiskOnly", "Outflow risk only"], ["engineeringBlockersOnly", "Engineering blockers only"], ["qualityIssuesOnly", "Quality issues only"], ["pendingApprovalsOnly", "Pending approvals only"], ["staleImportsOnly", "Stale imports only"],
            ].map(([key, label]) => {
              const active = Boolean(filters[key as keyof ExecutionFilters]);
              return <Button key={key} size="sm" variant={active ? "default" : "outline"} onClick={() => setFilters((f) => ({ ...f, [key]: !active }))}>{label}</Button>;
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {[
          ["Active Dashboard Projects", kpis.activeDashboardProjects],
          ["Average Actual Progress %", kpis.averageActualProgressPct === null ? "—" : `${kpis.averageActualProgressPct}%`],
          ["Average Expected Progress %", kpis.averageExpectedProgressPct === null ? "—" : `${kpis.averageExpectedProgressPct}%`],
          ["Projects Behind Plan", kpis.projectsBehindPlan],
          [`Planned Revenue (${fyLabel})`, formatCurrencyCompact(kpis.plannedRevenueFy)],
          [`Received Inflow (${fyLabel})`, formatCurrencyCompact(kpis.receivedInflowFy)],
          [`Open Inflow (${fyLabel})`, formatCurrencyCompact(kpis.openInflowFy)],
          [`Planned Expenditure (${fyLabel})`, formatCurrencyCompact(kpis.plannedExpenditureFy)],
          [`Paid Expenditure (${fyLabel})`, formatCurrencyCompact(kpis.paidExpenditureFy)],
          [`Open Expenditure (${fyLabel})`, formatCurrencyCompact(kpis.openExpenditureFy)],
          [`Gross Profit (${fyLabel})`, formatCurrencyCompact(kpis.grossProfitFy)],
          [`Gross Margin % (${fyLabel})`, kpis.grossMarginPctFy === null ? "—" : `${kpis.grossMarginPctFy}%`],
          ["Open Engineering Blockers", kpis.openEngineeringBlockers],
          ["Open Quality Warnings", kpis.openQualityWarnings],
          ["Pending Approvals", kpis.pendingApprovals],
          ["Stale Imports", kpis.staleImports],
        ].map(([title, value]) => <Card key={String(title)}><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">{title}</p><p className="text-lg font-bold mt-1">{value as any}</p></CardContent></Card>)}
      </div>

      <div className="flex gap-2 border-b pb-2">
        {(["coo", "program", "finance", "construction"] as RoleView[]).map((view) => (
          <Button key={view} variant={activeView === view ? "default" : "ghost"} onClick={() => setActiveView(view)}>{view.toUpperCase()}</Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-3">
          <h2 className="text-lg font-semibold mb-2">Action Center</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">Queue</th><th>Project</th><th>Issue title</th><th>Severity</th><th>Owner</th><th>Due date</th><th></th>
                </tr>
              </thead>
              <tbody>
                {actionRows.map((r, idx) => (
                  <tr key={`${r.projectId}-${idx}`} className="border-t">
                    <td className="py-2">{r.queue}</td><td>{r.projectName}</td><td>{r.issueTitle}</td><td>{r.severity}</td><td>{r.owner}</td><td>{formatDate(r.dueDate)}</td>
                    <td><Button size="sm" variant="outline" onClick={() => setLocation(r.link)}><ExternalLink className="w-3.5 h-3.5" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {actionRows.length === 0 && <div className="text-sm text-muted-foreground py-4">No action items for current filters.</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 overflow-x-auto">
          <table className="min-w-[2000px] w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Project Name</th><th>Portfolio</th><th>PM</th><th>PD</th><th>Execution Phase</th><th>RAG</th><th>Actual Progress %</th><th>Expected Progress %</th><th>Schedule Variance %</th><th>Planned Revenue (FY)</th><th>Received Inflow (FY)</th><th>Open Inflow (FY)</th><th>Planned Expenditure (FY)</th><th>Paid Expenditure (FY)</th><th>Open Expenditure (FY)</th><th>Gross Margin % (FY)</th><th>Engineering Status</th><th>Quality Status</th><th>Import Freshness</th><th>Critical Action Count</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => {
                const expanded = expandedId === p.projectId;
                return (
                  <React.Fragment key={p.projectId}>
                    <tr className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setExpandedId(expanded ? null : p.projectId)}>
                      <td className="py-2 font-medium">{p.projectName}</td><td>{p.portfolio}</td><td>{p.pm || "Unassigned"}</td><td>{p.pd || "Unassigned"}</td><td>{p.executionPhase || "—"}</td><td><Badge className={ragClass(p.rag)}>{p.rag}</Badge></td><td>{p.actualProgressPct ?? "—"}%</td><td>{p.expectedProgressPct ?? "—"}%</td><td className={(p.scheduleVariancePct || 0) < 0 ? "text-red-600" : "text-emerald-600"}>{p.scheduleVariancePct ?? "—"}%</td>
                      <td>{formatCurrencyCompact(p.plannedRevenueFy)}</td><td>{formatCurrencyCompact(p.receivedInflowFy)}</td><td>{formatCurrencyCompact(p.openInflowFy)}</td><td>{formatCurrencyCompact(p.plannedExpenditureFy)}</td><td>{formatCurrencyCompact(p.paidExpenditureFy)}</td><td>{formatCurrencyCompact(p.openExpenditureFy)}</td><td>{p.grossMarginPctFy === null ? "—" : `${p.grossMarginPctFy}%`}</td><td>{p.engineeringStatus}</td><td>{p.qualityStatus}</td><td>{p.importFreshness}</td><td>{p.criticalActionCount}</td><td>{expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                    </tr>
                    {expanded && (
                      <tr className="bg-muted/20"><td colSpan={21} className="p-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                          <div className="border rounded p-2"><p className="font-semibold mb-1">Project Summary</p><p>{p.projectName}</p><p>PM: {p.pm || "Unassigned"}</p><p>PD: {p.pd || "Unassigned"}</p><p>Phase: {p.executionPhase || "—"}</p></div>
                          <div className="border rounded p-2"><p className="font-semibold mb-1">Progress Summary</p><p>Actual: {p.actualProgressPct ?? "—"}%</p><p>Expected: {p.expectedProgressPct ?? "—"}%</p><p>Variance: {p.scheduleVariancePct ?? "—"}%</p></div>
                          <div className="border rounded p-2"><p className="font-semibold mb-1">Financial Summary ({fyLabel})</p><p>Planned Revenue: {formatCurrencyFull(p.plannedRevenueFy)}</p><p>Received Inflow: {formatCurrencyFull(p.receivedInflowFy)}</p><p>Open Inflow: {formatCurrencyFull(p.openInflowFy)}</p><p>Planned Expenditure: {formatCurrencyFull(p.plannedExpenditureFy)}</p><p>Paid Expenditure: {formatCurrencyFull(p.paidExpenditureFy)}</p><p>Open Expenditure: {formatCurrencyFull(p.openExpenditureFy)}</p><p>Gross Margin: {p.grossMarginPctFy === null ? "—" : `${p.grossMarginPctFy}%`}</p></div>
                          <div className="border rounded p-2"><p className="font-semibold mb-1">Active Issues / Exceptions</p><p>Critical actions: {p.criticalActionCount}</p><p>Engineering blockers: {p.engineeringBlockerCount}</p><p>Quality issues: {p.openQualityWarningCount}</p><p>Pending approvals: {p.pendingApprovalCount}</p><p>Import freshness: {p.importFreshness}</p></div>
                        </div>
                        <div className="flex gap-2 mt-3 flex-wrap">
                          <Button size="sm" onClick={() => openProject(p)}><ExternalLink className="w-3.5 h-3.5 mr-1" />Project</Button>
                          <Button size="sm" variant="outline" onClick={() => openProject(p, "plan")}>Plan</Button>
                          <Button size="sm" variant="outline" onClick={() => openProject(p, "revenue")}>Revenue</Button>
                          <Button size="sm" variant="outline" onClick={() => openProject(p, "expenditure")}>Expenditure</Button>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {filteredProjects.length === 0 && <div className="text-center text-sm text-muted-foreground py-10">No projects match current filters.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
