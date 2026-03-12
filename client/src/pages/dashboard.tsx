import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Link } from "wouter";
import {
  Activity, AlertCircle, AlertTriangle, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, DollarSign, Clock, Shield, FileWarning,
  Users, FolderOpen, ArrowRight, Filter, RotateCcw, ExternalLink,
  BarChart3
} from "lucide-react";

type DashboardResponse = {
  meta: { fyStart: string; fyEnd: string };
  kpis: Record<string, number | null>;
  options: { portfolios: string[]; pms: string[]; pds: string[]; executionPhases: string[]; rags: string[] };
  projects: any[];
  actionCenter: Record<string, any[]>;
};

const tabs = ["COO", "Program", "Finance", "Construction"] as const;

const money = (n: number | null | undefined) => `R ${(Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

function severityStyle(severity: string) {
  const s = severity?.toLowerCase();
  if (s === "critical") return { bg: "bg-red-50 border-red-200", text: "text-red-700", dot: "bg-red-500" };
  if (s === "high") return { bg: "bg-orange-50 border-orange-200", text: "text-orange-700", dot: "bg-orange-500" };
  if (s === "medium") return { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", dot: "bg-amber-500" };
  return { bg: "bg-slate-50 border-slate-200", text: "text-slate-600", dot: "bg-slate-400" };
}

function queueMeta(key: string) {
  switch (key) {
    case "projectsBehindPlan":
      return { icon: <Clock className="w-4 h-4 text-red-500" />, border: "border-l-red-500", bg: "bg-red-50/30" };
    case "inflowAtRisk":
      return { icon: <DollarSign className="w-4 h-4 text-blue-500" />, border: "border-l-blue-500", bg: "bg-blue-50/30" };
    case "expenditureAtRisk":
      return { icon: <TrendingDown className="w-4 h-4 text-orange-500" />, border: "border-l-orange-500", bg: "bg-orange-50/30" };
    case "engineeringBottlenecks":
      return { icon: <Shield className="w-4 h-4 text-violet-500" />, border: "border-l-violet-500", bg: "bg-violet-50/30" };
    case "qualityIssues":
      return { icon: <FileWarning className="w-4 h-4 text-amber-500" />, border: "border-l-amber-500", bg: "bg-amber-50/30" };
    case "pendingApprovalsDecisions":
      return { icon: <Users className="w-4 h-4 text-emerald-500" />, border: "border-l-emerald-500", bg: "bg-emerald-50/30" };
    default:
      return { icon: <AlertCircle className="w-4 h-4 text-slate-500" />, border: "border-l-slate-400", bg: "bg-slate-50/30" };
  }
}

function ragBadge(rag: string) {
  if (rag === "Red") return "bg-red-100 text-red-700 border-red-200";
  if (rag === "Amber") return "bg-amber-100 text-amber-700 border-amber-200";
  if (rag === "Green") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  return "bg-slate-100 text-slate-500 border-slate-200";
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("COO");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [collapsedQueues, setCollapsedQueues] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    search: "", portfolio: "all", pm: "all", pd: "all", executionPhase: "all", rag: "all",
    exceptionOnly: false, behindPlanOnly: false, inflowRiskOnly: false, outflowRiskOnly: false,
    engineeringBlockersOnly: false, qualityIssuesOnly: false, pendingApprovalsOnly: false, staleImportsOnly: false,
  });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (typeof v === "boolean") {
        if (v) params.set(k, "true");
      } else if (v && v !== "all") params.set(k, v);
    });
    return params.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: ["/api/program-dashboard", query],
    queryFn: async () => {
      const res = await fetch(`/api/program-dashboard${query ? `?${query}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const opts = data?.options || { portfolios: [], pms: [], pds: [], executionPhases: [], rags: [] };

  const toggleQueue = (queue: string) => {
    setCollapsedQueues(prev => {
      const next = new Set(prev);
      if (next.has(queue)) next.delete(queue); else next.add(queue);
      return next;
    });
  };

  const queueKeys: Array<[string, string]> = [
    ["projectsBehindPlan", "Projects Behind Plan"],
    ["inflowAtRisk", "Inflow at Risk"],
    ["expenditureAtRisk", "Expenditure / COS at Risk"],
    ["engineeringBottlenecks", "Engineering Bottlenecks"],
    ["qualityIssues", "Quality Issues"],
    ["pendingApprovalsDecisions", "Pending Approvals / Decisions"],
  ];

  const hasActiveFilters = filters.search || filters.portfolio !== "all" || filters.pm !== "all" || filters.pd !== "all" || filters.executionPhase !== "all" || filters.rag !== "all" || filters.exceptionOnly || filters.behindPlanOnly || filters.inflowRiskOnly || filters.outflowRiskOnly || filters.engineeringBlockersOnly || filters.qualityIssuesOnly || filters.pendingApprovalsOnly || filters.staleImportsOnly;

  const totalActionItems = useMemo(() => {
    if (!data?.actionCenter) return 0;
    return queueKeys.reduce((sum, [k]) => sum + (data.actionCenter[k]?.length || 0), 0);
  }, [data?.actionCenter]);

  return (
    <div className="space-y-5 max-w-[1800px] mx-auto p-4 pb-8" data-testid="execution-dashboard-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Activity className="w-5 h-5 text-emerald-600" />
            </div>
            Execution Dashboard
          </h1>
          {data?.meta && (
            <p className="text-muted-foreground text-sm mt-1.5 ml-[46px]">
              Financial year <span className="font-medium text-foreground">{data.meta.fyStart}</span> to <span className="font-medium text-foreground">{data.meta.fyEnd}</span>
            </p>
          )}
        </div>
        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={() => setFilters({
            search: "", portfolio: "all", pm: "all", pd: "all", executionPhase: "all", rag: "all",
            exceptionOnly: false, behindPlanOnly: false, inflowRiskOnly: false, outflowRiskOnly: false,
            engineeringBlockersOnly: false, qualityIssuesOnly: false, pendingApprovalsOnly: false, staleImportsOnly: false,
          })} className="gap-1.5 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" />Clear filters
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b pb-0">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
            data-testid={`tab-${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filters</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
            <Input placeholder="Search projects..." value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} className="h-9" data-testid="input-filter-search" />
            <SearchableSelect value={filters.portfolio} onValueChange={(v) => setFilters((f) => ({ ...f, portfolio: v }))} placeholder="Portfolio" options={[{ value: "all", label: "All Portfolios" }, ...opts.portfolios.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.pm} onValueChange={(v) => setFilters((f) => ({ ...f, pm: v }))} placeholder="Project Manager" options={[{ value: "all", label: "All PMs" }, ...opts.pms.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.pd} onValueChange={(v) => setFilters((f) => ({ ...f, pd: v }))} placeholder="Project Developer" options={[{ value: "all", label: "All PDs" }, ...opts.pds.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.executionPhase} onValueChange={(v) => setFilters((f) => ({ ...f, executionPhase: v }))} placeholder="Execution Phase" options={[{ value: "all", label: "All Phases" }, ...opts.executionPhases.map((v) => ({ value: v, label: v }))]} />
            <SearchableSelect value={filters.rag} onValueChange={(v) => setFilters((f) => ({ ...f, rag: v }))} placeholder="RAG Status" options={[{ value: "all", label: "All RAG" }, ...opts.rags.map((v) => ({ value: v, label: v }))]} />
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
              const active = Boolean((filters as any)[key]);
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
              <div><p className="text-[10px] text-muted-foreground">Active Projects</p><p className="text-lg font-bold">{Number(data?.kpis?.activeDashboardProjects || 0)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Behind Plan</p><p className="text-lg font-bold text-red-600">{Number(data?.kpis?.projectsBehindPlan || 0)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Avg. Actual</p><p className="text-sm font-semibold">{pct(data?.kpis?.averageActualProgressPct)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Avg. Expected</p><p className="text-sm font-semibold">{pct(data?.kpis?.averageExpectedProgressPct)}</p></div>
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
              <div><p className="text-[10px] text-muted-foreground">Planned Revenue</p><p className="text-sm font-semibold">{money(data?.kpis?.plannedRevenueFy)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Received</p><p className="text-sm font-semibold text-emerald-600">{money(data?.kpis?.receivedInflowFy)}</p></div>
              <div className="col-span-2"><p className="text-[10px] text-muted-foreground">Open Inflow</p><p className="text-lg font-bold text-amber-600">{money(data?.kpis?.openInflowFy)}</p></div>
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
              <div><p className="text-[10px] text-muted-foreground">Planned</p><p className="text-sm font-semibold">{money(data?.kpis?.plannedExpenditureFy)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Paid</p><p className="text-sm font-semibold text-emerald-600">{money(data?.kpis?.paidExpenditureFy)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Open</p><p className="text-sm font-semibold text-amber-600">{money(data?.kpis?.openExpenditureFy)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">GP Margin</p><p className="text-sm font-semibold">{pct(data?.kpis?.grossMarginPctFy)}</p></div>
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
              <div><p className="text-[10px] text-muted-foreground">Eng. Blockers</p><p className="text-sm font-semibold">{Number(data?.kpis?.openEngineeringBlockers || 0)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Quality Issues</p><p className="text-sm font-semibold">{Number(data?.kpis?.openQualityWarnings || 0)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Pending Approvals</p><p className="text-sm font-semibold">{Number(data?.kpis?.pendingApprovals || 0)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Stale Imports</p><p className="text-sm font-semibold">{Number(data?.kpis?.staleImports || 0)}</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {activeTab === "COO" && (
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                <h2 className="text-base font-semibold">Action Center</h2>
                <Badge variant="outline" className="text-xs ml-1">{totalActionItems} items</Badge>
              </div>
            </div>

            <div className="space-y-3">
              {queueKeys.map(([k, title]) => {
                const rows = data?.actionCenter?.[k] || [];
                if (rows.length === 0) return null;
                const meta = queueMeta(k);
                const isCollapsed = collapsedQueues.has(k);
                const criticalCount = rows.filter((r: any) => r.severity?.toLowerCase() === "critical").length;

                return (
                  <div key={k} className={`rounded-lg border border-l-4 overflow-hidden ${meta.border} ${meta.bg}`}>
                    <button
                      onClick={() => toggleQueue(k)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/40 transition-colors"
                      data-testid={`queue-toggle-${k}`}
                    >
                      {meta.icon}
                      <span className="text-sm font-semibold flex-1">{title}</span>
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
                            {rows.map((r: any, idx: number) => {
                              const sev = severityStyle(r.severity);
                              return (
                                <tr key={idx} className="border-t border-border/40 hover:bg-white/80 transition-colors">
                                  <td className="py-2.5 px-4 font-medium text-foreground">{r.project}</td>
                                  <td className="py-2.5 px-4 text-muted-foreground max-w-[300px] truncate">{r.issueTitle}</td>
                                  <td className="py-2.5 px-4">
                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${sev.bg} ${sev.text}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                                      {r.severity}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-muted-foreground">{r.owner || "—"}</td>
                                  <td className="py-2.5 px-4 text-muted-foreground tabular-nums">{r.dueDate || "—"}</td>
                                  <td className="py-2.5 px-4 text-right">
                                    {r.links?.project && (
                                      <Link href={r.links.project}>
                                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
                                          <ArrowRight className="w-4 h-4" />
                                        </Button>
                                      </Link>
                                    )}
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

              {totalActionItems === 0 && (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                    <Activity className="w-6 h-6 text-emerald-500" />
                  </div>
                  <p className="text-sm text-muted-foreground">No action items to review</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "Program" && <Card className="border-border/60"><CardContent className="p-6 text-sm text-muted-foreground">Phase flow, PM load, delivery exceptions, and schedule behavior all use the same canonical progress source for the visible project set.</CardContent></Card>}
      {activeTab === "Finance" && <Card className="border-border/60"><CardContent className="p-6 text-sm text-muted-foreground">Planned/received/open inflow and planned/paid/open expenditure are FY-only and reconcile with the main table and KPI strip.</CardContent></Card>}
      {activeTab === "Construction" && <Card className="border-border/60"><CardContent className="p-6 text-sm text-muted-foreground">Phase, dates, site readiness and execution timing for the same visible project population.</CardContent></Card>}

      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold">Project Portfolio</h2>
            <Badge variant="outline" className="text-xs ml-1">{(data?.projects || []).length} projects</Badge>
          </div>
          {isLoading ? (
            <div className="text-center py-10 text-sm text-muted-foreground">Loading projects...</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="min-w-[2000px] w-full text-sm" data-testid="execution-dashboard-table">
                <thead>
                  <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2.5 px-3 font-medium sticky left-0 bg-muted/40 z-10">Project</th>
                    <th className="text-left py-2.5 px-3 font-medium">Portfolio</th>
                    <th className="text-left py-2.5 px-3 font-medium">PM</th>
                    <th className="text-left py-2.5 px-3 font-medium">PD</th>
                    <th className="text-left py-2.5 px-3 font-medium">Phase</th>
                    <th className="text-center py-2.5 px-3 font-medium">RAG</th>
                    <th className="text-right py-2.5 px-3 font-medium">Actual %</th>
                    <th className="text-right py-2.5 px-3 font-medium">Expected %</th>
                    <th className="text-right py-2.5 px-3 font-medium">Variance</th>
                    <th className="text-right py-2.5 px-3 font-medium">Revenue</th>
                    <th className="text-right py-2.5 px-3 font-medium">Inflow</th>
                    <th className="text-right py-2.5 px-3 font-medium">Open Inflow</th>
                    <th className="text-right py-2.5 px-3 font-medium">Expenditure</th>
                    <th className="text-right py-2.5 px-3 font-medium">Paid</th>
                    <th className="text-right py-2.5 px-3 font-medium">Open Exp.</th>
                    <th className="text-right py-2.5 px-3 font-medium">GP %</th>
                    <th className="text-center py-2.5 px-3 font-medium">Eng.</th>
                    <th className="text-center py-2.5 px-3 font-medium">Quality</th>
                    <th className="text-center py-2.5 px-3 font-medium">Import</th>
                    <th className="text-center py-2.5 px-3 font-medium">Actions</th>
                    <th className="w-8 py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.projects || []).map((p: any) => {
                    const isExpanded = expanded === p.projectId;
                    const variance = Number(p.scheduleVariancePct || 0);
                    return (
                      <Fragment key={p.projectId}>
                        <tr
                          className={`border-t border-border/40 cursor-pointer transition-colors ${isExpanded ? "bg-emerald-50/40" : "hover:bg-muted/30"}`}
                          onClick={() => setExpanded(isExpanded ? null : p.projectId)}
                          data-testid={`project-row-${p.projectId}`}
                        >
                          <td className="py-2.5 px-3 font-medium text-foreground sticky left-0 bg-white z-10">{p.projectName}</td>
                          <td className="py-2.5 px-3 text-muted-foreground">{p.portfolio || "—"}</td>
                          <td className="py-2.5 px-3 text-muted-foreground">{p.pm || "—"}</td>
                          <td className="py-2.5 px-3 text-muted-foreground">{p.pd || "—"}</td>
                          <td className="py-2.5 px-3 text-muted-foreground">{p.executionPhase || "—"}</td>
                          <td className="py-2.5 px-3 text-center">
                            <Badge className={`text-[10px] ${ragBadge(p.rag || "Unknown")}`}>{p.rag || "—"}</Badge>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-medium">{pct(p.actualProgressPct)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{pct(p.expectedProgressPct)}</td>
                          <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${variance < 0 ? "text-red-600" : variance > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                            {pct(p.scheduleVariancePct)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{money(p.plannedRevenueFy)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-emerald-600">{money(p.receivedInflowFy)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-amber-600">{money(p.openInflowFy)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{money(p.plannedExpenditureFy)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-emerald-600">{money(p.paidExpenditureFy)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-amber-600">{money(p.openExpenditureFy)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-medium">{pct((p.grossMarginPctFy || 0) * 100)}</td>
                          <td className="py-2.5 px-3 text-center text-xs text-muted-foreground">{p.engineeringStatus}</td>
                          <td className="py-2.5 px-3 text-center text-xs text-muted-foreground">{p.qualityStatus}</td>
                          <td className="py-2.5 px-3 text-center text-xs text-muted-foreground">{p.importFreshness}</td>
                          <td className="py-2.5 px-3 text-center">
                            {p.criticalActionCount > 0 ? (
                              <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{p.criticalActionCount}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-muted/20 border-t border-border/40">
                            <td colSpan={21} className="p-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                                <div className="bg-white rounded-lg border p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Project Summary</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{p.projectName}</span></p>
                                    <p><span className="text-muted-foreground">PM:</span> {p.pm || "—"}</p>
                                    <p><span className="text-muted-foreground">PD:</span> {p.pd || "—"}</p>
                                    <p><span className="text-muted-foreground">Phase:</span> {p.executionPhase || "—"}</p>
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg border p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Progress</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Actual:</span> <span className="font-medium">{pct(p.actualProgressPct)}</span></p>
                                    <p><span className="text-muted-foreground">Expected:</span> {pct(p.expectedProgressPct)}</p>
                                    <p><span className="text-muted-foreground">Variance:</span> <span className={variance < 0 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>{pct(p.scheduleVariancePct)}</span></p>
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg border p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Financials</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Revenue:</span> {money(p.plannedRevenueFy)}</p>
                                    <p><span className="text-muted-foreground">Inflow:</span> <span className="text-emerald-600">{money(p.receivedInflowFy)}</span></p>
                                    <p><span className="text-muted-foreground">Expenditure:</span> {money(p.plannedExpenditureFy)}</p>
                                    <p><span className="text-muted-foreground">GP Margin:</span> <span className="font-medium">{pct((p.grossMarginPctFy || 0) * 100)}</span></p>
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg border p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Issues & Exceptions</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Critical actions:</span> <span className="font-medium">{p.criticalActionCount}</span></p>
                                    <p><span className="text-muted-foreground">Eng. status:</span> {p.engineeringStatus}</p>
                                    <p><span className="text-muted-foreground">Quality:</span> {p.qualityStatus}</p>
                                    <p><span className="text-muted-foreground">Import:</span> {p.importFreshness}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2 mt-3 flex-wrap">
                                <Link href={`/project/${encodeURIComponent(p.projectName)}`}>
                                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                    <ExternalLink className="w-3.5 h-3.5" />Open Project
                                  </Button>
                                </Link>
                                <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=plan`}>
                                  <Button size="sm" variant="outline">Plan</Button>
                                </Link>
                                <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=revenue-tracking`}>
                                  <Button size="sm" variant="outline">Revenue</Button>
                                </Link>
                                <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=expenditure`}>
                                  <Button size="sm" variant="outline">Expenditure</Button>
                                </Link>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {(data?.projects || []).length === 0 && (
                <div className="text-center py-12">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                    <FolderOpen className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">No projects match current filters</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
