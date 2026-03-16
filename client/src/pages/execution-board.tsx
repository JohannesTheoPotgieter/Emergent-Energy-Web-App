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
import {
  Activity, AlertCircle, AlertTriangle, ChevronDown, ChevronUp,
  ExternalLink, RefreshCw, TrendingUp, TrendingDown, DollarSign,
  BarChart3, Shield, FileWarning, Clock, Users, FolderOpen,
  ArrowRight, Filter, RotateCcw
} from "lucide-react";
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

function ragBadge(rag: string) {
  if (rag === "Red") return "bg-red-100 text-red-700 border-red-200";
  if (rag === "Amber") return "bg-amber-100 text-amber-700 border-amber-200";
  if (rag === "Green") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  return "bg-slate-100 text-slate-500 border-slate-200";
}

function severityBadge(severity: string) {
  const s = severity?.toLowerCase();
  if (s === "critical") return { bg: "bg-red-50 border-red-200", text: "text-red-700", dot: "bg-red-500" };
  if (s === "high") return { bg: "bg-orange-50 border-orange-200", text: "text-orange-700", dot: "bg-orange-500" };
  if (s === "medium") return { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", dot: "bg-amber-500" };
  return { bg: "bg-slate-50 border-slate-200", text: "text-slate-600", dot: "bg-slate-400" };
}

function queueIcon(queue: string) {
  const q = queue?.toLowerCase();
  if (q.includes("inflow")) return <DollarSign className="w-4 h-4 text-blue-500" />;
  if (q.includes("expenditure") || q.includes("cos")) return <TrendingDown className="w-4 h-4 text-orange-500" />;
  if (q.includes("behind") || q.includes("plan")) return <Clock className="w-4 h-4 text-red-500" />;
  if (q.includes("engineering")) return <Shield className="w-4 h-4 text-violet-500" />;
  if (q.includes("quality")) return <FileWarning className="w-4 h-4 text-amber-500" />;
  if (q.includes("approval")) return <Users className="w-4 h-4 text-emerald-500" />;
  return <AlertCircle className="w-4 h-4 text-slate-500" />;
}

function queueColor(queue: string) {
  const q = queue?.toLowerCase();
  if (q.includes("inflow")) return "border-l-blue-500 bg-blue-50/30";
  if (q.includes("expenditure") || q.includes("cos")) return "border-l-orange-500 bg-orange-50/30";
  if (q.includes("behind") || q.includes("plan")) return "border-l-red-500 bg-red-50/30";
  if (q.includes("engineering")) return "border-l-violet-500 bg-violet-50/30";
  if (q.includes("quality")) return "border-l-amber-500 bg-amber-50/30";
  if (q.includes("approval")) return "border-l-emerald-500 bg-emerald-50/30";
  return "border-l-slate-400 bg-slate-50/30";
}

const ROLE_VIEW_LABELS: Record<RoleView, string> = {
  coo: "COO Overview",
  program: "Program View",
  finance: "Finance View",
  construction: "Construction View",
};

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
  const [collapsedQueues, setCollapsedQueues] = useState<Set<string>>(new Set());

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

  const groupedActions = useMemo(() => {
    const groups: Record<string, typeof actionRows> = {};
    for (const row of actionRows) {
      const key = row.queue || "Other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }
    return groups;
  }, [actionRows]);

  const openProject = (project: ExecutionDashboardProject, tab?: string) => {
    const projectPath = `/project/${encodeURIComponent(project.projectName)}`;
    setLocation(tab ? `${projectPath}?tab=${tab}` : projectPath);
  };

  const toggleQueue = (queue: string) => {
    setCollapsedQueues(prev => {
      const next = new Set(prev);
      if (next.has(queue)) next.delete(queue); else next.add(queue);
      return next;
    });
  };

  if (loading) return <div className="flex flex-col items-center justify-center py-24 gap-3"><EnergyLoader size="lg" label="Loading work plan / board..." /></div>;
  if (error) return <div className="flex flex-col items-center justify-center py-24 gap-4"><AlertCircle className="w-8 h-8 text-red-500" /><p>{error}</p><Button onClick={loadData}><RefreshCw className="w-3.5 h-3.5 mr-1" />Retry</Button></div>;
  if (!canView) return <div className="flex items-center justify-center min-h-[60vh]"><Card><CardContent className="py-8 text-center"><AlertTriangle className="mx-auto mb-2" /><p>Access Denied</p></CardContent></Card></div>;

  const hasActiveFilters = filters.search || filters.portfolio !== "all" || filters.pm !== "all" || filters.pd !== "all" || filters.executionPhase !== "all" || filters.rag !== "all" || filters.exceptionOnly || filters.behindPlanOnly || filters.inflowRiskOnly || filters.outflowRiskOnly || filters.engineeringBlockersOnly || filters.qualityIssuesOnly || filters.pendingApprovalsOnly || filters.staleImportsOnly;

  return (
    <div className="space-y-5 max-w-[1800px] mx-auto pb-8" data-testid="execution-board-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Activity className="w-5 h-5 text-emerald-600" />
            </div>
            Work Plan / Board
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5 ml-[46px]">
            Post-handover execution view for <span className="font-medium text-foreground">{fyLabel}</span> ({dashboard?.financialYear.start} to {dashboard?.financialYear.end})
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={loadData} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />Refresh
          </Button>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={() => setFilters(defaultFilters)} className="gap-1.5 text-muted-foreground">
              <RotateCcw className="w-3.5 h-3.5" />Clear filters
            </Button>
          )}
        </div>
      </div>

      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filters</span>
            <span className="text-xs text-muted-foreground ml-auto">{filteredProjects.length} of {allProjects.length} projects</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
            <Input placeholder="Search projects..." value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} className="h-9" data-testid="input-filter-search" />
            <SearchableSelect value={filters.portfolio} onValueChange={(v) => setFilters((f) => ({ ...f, portfolio: v }))} placeholder="Portfolio" options={[{ value: "all", label: "All Portfolios" }, ...portfolios.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.pm} onValueChange={(v) => setFilters((f) => ({ ...f, pm: v }))} placeholder="Project Manager" options={[{ value: "all", label: "All PMs" }, ...pms.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.pd} onValueChange={(v) => setFilters((f) => ({ ...f, pd: v }))} placeholder="Project Developer" options={[{ value: "all", label: "All PDs" }, ...pds.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.executionPhase} onValueChange={(v) => setFilters((f) => ({ ...f, executionPhase: v }))} placeholder="Execution Phase" options={[{ value: "all", label: "All Phases" }, ...phases.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.rag} onValueChange={(v) => setFilters((f) => ({ ...f, rag: v }))} placeholder="RAG Status" options={[{ value: "all", label: "All RAG" }, { value: "Red", label: "Red" }, { value: "Amber", label: "Amber" }, { value: "Green", label: "Green" }, { value: "Unknown", label: "Unknown" }]} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ["exceptionOnly", "Exceptions"],
              ["behindPlanOnly", "Behind plan"],
              ["inflowRiskOnly", "Inflow risk"],
              ["outflowRiskOnly", "Outflow risk"],
              ["engineeringBlockersOnly", "Eng. blockers"],
              ["qualityIssuesOnly", "Quality issues"],
              ["pendingApprovalsOnly", "Pending approvals"],
              ["staleImportsOnly", "Stale imports"],
            ] as const).map(([key, label]) => {
              const active = Boolean(filters[key as keyof ExecutionFilters]);
              return (
                <button
                  key={key}
                  onClick={() => setFilters((f) => ({ ...f, [key]: !active }))}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    active
                      ? "bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm"
                      : "bg-white border-border text-muted-foreground hover:bg-muted/50 hover:border-border"
                  }`}
                  data-testid={`filter-toggle-${key}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <FolderOpen className="w-4 h-4 text-blue-600" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Portfolio</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div><p className="text-[10px] text-muted-foreground">Active Projects</p><p className="text-lg font-bold">{kpis.activeDashboardProjects}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Behind Plan</p><p className="text-lg font-bold text-red-600">{kpis.projectsBehindPlan}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Avg. Actual</p><p className="text-sm font-semibold">{kpis.averageActualProgressPct ?? "—"}%</p></div>
              <div><p className="text-[10px] text-muted-foreground">Avg. Expected</p><p className="text-sm font-semibold">{kpis.averageExpectedProgressPct ?? "—"}%</p></div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Revenue & Inflow</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div><p className="text-[10px] text-muted-foreground">Planned Revenue</p><p className="text-sm font-semibold">{formatCurrencyCompact(kpis.plannedRevenueFy)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Received</p><p className="text-sm font-semibold text-emerald-600">{formatCurrencyCompact(kpis.receivedInflowFy)}</p></div>
              <div className="col-span-2"><p className="text-[10px] text-muted-foreground">Open Inflow</p><p className="text-lg font-bold text-amber-600">{formatCurrencyCompact(kpis.openInflowFy)}</p></div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-orange-600" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Expenditure</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div><p className="text-[10px] text-muted-foreground">Planned</p><p className="text-sm font-semibold">{formatCurrencyCompact(kpis.plannedExpenditureFy)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Paid</p><p className="text-sm font-semibold text-emerald-600">{formatCurrencyCompact(kpis.paidExpenditureFy)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Open</p><p className="text-sm font-semibold text-amber-600">{formatCurrencyCompact(kpis.openExpenditureFy)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">GP Margin</p><p className="text-sm font-semibold">{kpis.grossMarginPctFy === null ? "—" : `${kpis.grossMarginPctFy}%`}</p></div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-red-600" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Risks & Actions</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div><p className="text-[10px] text-muted-foreground">Eng. Blockers</p><p className="text-sm font-semibold">{kpis.openEngineeringBlockers}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Quality Issues</p><p className="text-sm font-semibold">{kpis.openQualityWarnings}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Pending Approvals</p><p className="text-sm font-semibold">{kpis.pendingApprovals}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Stale Imports</p><p className="text-sm font-semibold">{kpis.staleImports}</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-1 border-b pb-0">
        {(["coo", "program", "finance", "construction"] as RoleView[]).map((view) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeView === view
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
            data-testid={`tab-view-${view}`}
          >
            {ROLE_VIEW_LABELS[view]}
          </button>
        ))}
      </div>

      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <h2 className="text-base font-semibold">Action Center</h2>
              <Badge variant="outline" className="text-xs ml-1">{actionRows.length} items</Badge>
            </div>
          </div>

          {actionRows.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                <Activity className="w-6 h-6 text-emerald-500" />
              </div>
              <p className="text-sm text-muted-foreground">No action items for current filters</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(groupedActions).map(([queue, rows]) => {
                const isCollapsed = collapsedQueues.has(queue);
                const criticalCount = rows.filter(r => r.severity?.toLowerCase() === "critical").length;
                return (
                  <div key={queue} className={`rounded-lg border border-l-4 overflow-hidden ${queueColor(queue)}`}>
                    <button
                      onClick={() => toggleQueue(queue)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/40 transition-colors"
                      data-testid={`queue-toggle-${queue}`}
                    >
                      {queueIcon(queue)}
                      <span className="text-sm font-semibold flex-1">{queue}</span>
                      <Badge variant="outline" className="text-[10px] font-medium">{rows.length} {rows.length === 1 ? "issue" : "issues"}</Badge>
                      {criticalCount > 0 && (
                        <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{criticalCount} critical</Badge>
                      )}
                      {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
                    </button>

                    {!isCollapsed && (
                      <div className="bg-white/60 border-t">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              <th className="text-left py-2 px-4 font-medium">Project</th>
                              <th className="text-left py-2 px-4 font-medium">Issue</th>
                              <th className="text-left py-2 px-4 font-medium">Severity</th>
                              <th className="text-left py-2 px-4 font-medium">Owner</th>
                              <th className="text-left py-2 px-4 font-medium">Due</th>
                              <th className="text-right py-2 px-4 font-medium w-16"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, idx) => {
                              const sev = severityBadge(r.severity);
                              return (
                                <tr key={`${r.projectId}-${idx}`} className="border-t border-border/40 hover:bg-white/80 transition-colors">
                                  <td className="py-2.5 px-4 font-medium text-foreground">{r.projectName}</td>
                                  <td className="py-2.5 px-4 text-muted-foreground max-w-[300px] truncate">{r.issueTitle}</td>
                                  <td className="py-2.5 px-4">
                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${sev.bg} ${sev.text}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                                      {r.severity}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-muted-foreground">{r.owner}</td>
                                  <td className="py-2.5 px-4 text-muted-foreground tabular-nums">{formatDate(r.dueDate)}</td>
                                  <td className="py-2.5 px-4 text-right">
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600" onClick={() => setLocation(r.link)} data-testid={`btn-open-action-${r.projectId}-${idx}`}>
                                      <ArrowRight className="w-4 h-4" />
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold">Project Portfolio</h2>
            <Badge variant="outline" className="text-xs ml-1">{filteredProjects.length} projects</Badge>
          </div>
          <div className="rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left py-2.5 px-3 font-medium">Project</th>
                  <th className="text-left py-2.5 px-2 font-medium hidden lg:table-cell">PM</th>
                  <th className="text-center py-2.5 px-2 font-medium">RAG</th>
                  <th className="text-right py-2.5 px-2 font-medium">Progress</th>
                  <th className="text-right py-2.5 px-2 font-medium hidden md:table-cell">Variance</th>
                  <th className="text-right py-2.5 px-2 font-medium hidden lg:table-cell">Open Inflow</th>
                  <th className="text-right py-2.5 px-2 font-medium hidden lg:table-cell">Open Exp.</th>
                  <th className="text-right py-2.5 px-2 font-medium hidden md:table-cell">GP %</th>
                  <th className="text-center py-2.5 px-2 font-medium">Issues</th>
                  <th className="w-8 py-2.5 px-1"></th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((p) => {
                  const expanded = expandedId === p.projectId;
                  const variance = p.scheduleVariancePct || 0;
                  return (
                    <React.Fragment key={p.projectId}>
                      <tr
                        className={`border-t border-border/40 cursor-pointer transition-colors ${expanded ? "bg-emerald-50/40" : "hover:bg-muted/30"}`}
                        onClick={() => setExpandedId(expanded ? null : p.projectId)}
                        data-testid={`project-row-${p.projectId}`}
                      >
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-foreground truncate max-w-[200px]">{p.projectName}</div>
                          <div className="text-[11px] text-muted-foreground lg:hidden">{p.pm || "—"}</div>
                        </td>
                        <td className="py-2.5 px-2 text-muted-foreground text-xs hidden lg:table-cell">{p.pm || "—"}</td>
                        <td className="py-2.5 px-2 text-center">
                          <Badge className={`text-[10px] ${ragBadge(p.rag)}`}>{p.rag}</Badge>
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <span className="tabular-nums font-medium text-sm">{p.actualProgressPct ?? "—"}%</span>
                          <div className="text-[10px] text-muted-foreground tabular-nums">of {p.expectedProgressPct ?? "—"}%</div>
                        </td>
                        <td className={`py-2.5 px-2 text-right tabular-nums text-sm font-medium hidden md:table-cell ${variance < 0 ? "text-red-600" : variance > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                          {p.scheduleVariancePct != null ? `${variance > 0 ? "+" : ""}${variance}%` : "—"}
                        </td>
                        <td className="py-2.5 px-2 text-right tabular-nums text-sm text-amber-600 hidden lg:table-cell">{formatCurrencyCompact(p.openInflowFy)}</td>
                        <td className="py-2.5 px-2 text-right tabular-nums text-sm text-amber-600 hidden lg:table-cell">{formatCurrencyCompact(p.openExpenditureFy)}</td>
                        <td className="py-2.5 px-2 text-right tabular-nums text-sm font-medium hidden md:table-cell">{p.grossMarginPctFy === null ? "—" : `${p.grossMarginPctFy}%`}</td>
                        <td className="py-2.5 px-2 text-center">
                          {p.criticalActionCount > 0 ? (
                            <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{p.criticalActionCount}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="py-2.5 px-1 text-center">
                          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/20 border-t border-border/40">
                          <td colSpan={10} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Project Details</p>
                                <div className="space-y-1.5 text-sm">
                                  <p><span className="text-muted-foreground">Portfolio:</span> <span className="font-medium">{p.portfolio || "—"}</span></p>
                                  <p><span className="text-muted-foreground">PM:</span> {p.pm || "Unassigned"}</p>
                                  <p><span className="text-muted-foreground">PD:</span> {p.pd || "Unassigned"}</p>
                                  <p><span className="text-muted-foreground">Phase:</span> {p.executionPhase || "—"}</p>
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Progress</p>
                                <div className="space-y-1.5 text-sm">
                                  <p><span className="text-muted-foreground">Actual:</span> <span className="font-medium">{p.actualProgressPct ?? "—"}%</span></p>
                                  <p><span className="text-muted-foreground">Expected:</span> {p.expectedProgressPct ?? "—"}%</p>
                                  <p><span className="text-muted-foreground">Variance:</span> <span className={variance < 0 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>{p.scheduleVariancePct ?? "—"}%</span></p>
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Financials ({fyLabel})</p>
                                <div className="space-y-1.5 text-sm">
                                  <p><span className="text-muted-foreground">Revenue:</span> {formatCurrencyFull(p.plannedRevenueFy)}</p>
                                  <p><span className="text-muted-foreground">Inflow:</span> <span className="text-emerald-600">{formatCurrencyFull(p.receivedInflowFy)}</span></p>
                                  <p><span className="text-muted-foreground">Open Inflow:</span> <span className="text-amber-600">{formatCurrencyFull(p.openInflowFy)}</span></p>
                                  <p><span className="text-muted-foreground">Expenditure:</span> {formatCurrencyFull(p.plannedExpenditureFy)}</p>
                                  <p><span className="text-muted-foreground">Paid:</span> <span className="text-emerald-600">{formatCurrencyFull(p.paidExpenditureFy)}</span></p>
                                  <p><span className="text-muted-foreground">Open Exp:</span> <span className="text-amber-600">{formatCurrencyFull(p.openExpenditureFy)}</span></p>
                                  <p><span className="text-muted-foreground">GP Margin:</span> <span className="font-medium">{p.grossMarginPctFy === null ? "—" : `${p.grossMarginPctFy}%`}</span></p>
                                </div>
                              </div>
                              <div className="bg-white rounded-lg border p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Issues & Status</p>
                                <div className="space-y-1.5 text-sm">
                                  <p><span className="text-muted-foreground">Critical actions:</span> <span className="font-medium">{p.criticalActionCount}</span></p>
                                  <p><span className="text-muted-foreground">Eng. blockers:</span> {p.engineeringBlockerCount}</p>
                                  <p><span className="text-muted-foreground">Quality issues:</span> {p.openQualityWarningCount}</p>
                                  <p><span className="text-muted-foreground">Pending approvals:</span> {p.pendingApprovalCount}</p>
                                  <p><span className="text-muted-foreground">Engineering:</span> {p.engineeringStatus}</p>
                                  <p><span className="text-muted-foreground">Quality:</span> {p.qualityStatus}</p>
                                  <p><span className="text-muted-foreground">Import:</span> {p.importFreshness}</p>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 mt-3 flex-wrap">
                              <Button size="sm" onClick={() => openProject(p)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" data-testid={`btn-open-project-${p.projectId}`}>
                                <ExternalLink className="w-3.5 h-3.5" />Open Project
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openProject(p, "plan")}>Plan</Button>
                              <Button size="sm" variant="outline" onClick={() => openProject(p, "revenue")}>Revenue</Button>
                              <Button size="sm" variant="outline" onClick={() => openProject(p, "expenditure")}>Expenditure</Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {filteredProjects.length === 0 && (
              <div className="text-center py-12">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <FolderOpen className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No projects match current filters</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
