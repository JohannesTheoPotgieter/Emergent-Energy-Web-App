import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";
import { EnergyLoader } from "@/components/ui/energy-loader";
import {
  Activity, AlertCircle, AlertTriangle, CalendarClock, ChevronDown, ChevronUp,
  DollarSign, ExternalLink, RefreshCw,
} from "lucide-react";
import {
  BaseExecutionProject,
  DerivedExecutionProject,
  ExecutionFilters,
  aggregateExecutionStats,
  deriveExecutionProjectMetrics,
  filterExecutionProjects,
  formatCurrencyCompact,
  formatCurrencyFull,
  formatDate,
  getProjectExceptionFlags,
  groupProjectsByExecutionPhase,
  groupProjectsByPm,
} from "@/lib/execution-dashboard";

type RoleView = "coo" | "program" | "finance" | "construction";
type SortKey = "project" | "pm" | "actual" | "expected" | "variance" | "revenueRemaining" | "invoicedUnpaid" | "costRemaining" | "gp";

const defaultFilters: ExecutionFilters = {
  search: "",
  executionPhase: "all",
  pm: "all",
  rag: "all",
  gateStatus: "ENABLED",
  exceptionOnly: false,
  behindScheduleOnly: false,
  marginRiskOnly: false,
  cashRiskOnly: false,
  commissioningDueOnly: false,
  handoverDueOnly: false,
};

function ragClass(rag: string | null) {
  if (rag === "Red") return "bg-red-50 text-red-700 border-red-200";
  if (rag === "Amber") return "bg-amber-50 text-amber-700 border-amber-200";
  if (rag === "Green") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-muted text-muted-foreground border-border";
}

function riskClass(level: "High" | "Medium" | "Low") {
  if (level === "High") return "bg-red-50 text-red-700 border-red-200";
  if (level === "Medium") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function SortHeader({ label, keyName, sortKey, sortDir, onSort }: {
  label: string;
  keyName: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  return (
    <button onClick={() => onSort(keyName)} className="font-semibold text-left inline-flex items-center gap-1 hover:text-foreground">
      {label}
      {sortKey === keyName && <span className="text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

export default function ExecutionBoard() {
  const { allowed: canView } = usePermission("execution_board", "view");
  const [allProjects, setAllProjects] = useState<BaseExecutionProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ExecutionFilters>(defaultFilters);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<RoleView>("coo");
  const [sortKey, setSortKey] = useState<SortKey>("project");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/lifecycle-board/projects", { headers });
      if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
      const data: BaseExecutionProject[] = await res.json();
      setAllProjects(data);
    } catch (err: any) {
      setError(err.message || "Failed to load projects");
      toast({ title: "Error", description: err.message || "Failed to load projects", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const activeProjects = useMemo(
    () => allProjects.filter((p) => p.archivedStatus === "ACTIVE").map(deriveExecutionProjectMetrics),
    [allProjects],
  );

  const phases = useMemo(() => Array.from(new Set(activeProjects.map((p) => p.executionPhase).filter(Boolean) as string[])).sort(), [activeProjects]);
  const pms = useMemo(() => Array.from(new Set(activeProjects.map((p) => p.pm || "Unassigned"))).sort(), [activeProjects]);

  const filteredProjects = useMemo(() => filterExecutionProjects(activeProjects, filters), [activeProjects, filters]);
  const stats = useMemo(() => aggregateExecutionStats(filteredProjects), [filteredProjects]);
  const allStats = useMemo(() => aggregateExecutionStats(activeProjects), [activeProjects]);

  const sortedProjects = useMemo(() => {
    const sorted = [...filteredProjects];
    sorted.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const read = (project: DerivedExecutionProject): number | string => {
        if (sortKey === "project") return project.cleanName;
        if (sortKey === "pm") return project.pm || "Unassigned";
        if (sortKey === "actual") return project.actualPct ?? -1;
        if (sortKey === "expected") return project.expectedPct ?? -1;
        if (sortKey === "variance") return project.scheduleVariancePct ?? -999;
        if (sortKey === "revenueRemaining") return project.revenueRemainingToCollect;
        if (sortKey === "invoicedUnpaid") return project.revenueInvoicedUnpaid;
        if (sortKey === "costRemaining") return project.costRemainingToPay;
        return project.gpPct ?? -999;
      };
      const av = read(a);
      const bv = read(b);
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
    return sorted;
  }, [filteredProjects, sortKey, sortDir]);

  const groupedPhase = useMemo(() => groupProjectsByExecutionPhase(filteredProjects), [filteredProjects]);
  const groupedPm = useMemo(() => groupProjectsByPm(filteredProjects), [filteredProjects]);

  const cooAttention = useMemo(() => [...filteredProjects].sort((a, b) => {
    const score = (p: DerivedExecutionProject) =>
      (p.isRed ? 5 : 0) + (p.isBehindSchedule ? 3 : 0) + (p.isMarginRisk ? 3 : 0) + (p.isCashRisk ? 2 : 0) + (p.hasEscalation ? 4 : 0);
    return score(b) - score(a);
  }).slice(0, 8), [filteredProjects]);

  const financeTotals = useMemo(() => filteredProjects.reduce((acc, p) => {
    acc.totalRevenue += p.totalRevenue;
    acc.totalCost += p.totalCost;
    acc.received += p.receivedRevenue;
    acc.invoicedRevenue += p.invoicedRevenue;
    acc.paid += p.paidCost;
    acc.invoicedCost += p.invoicedCost;
    acc.revNotInv += p.revenueNotYetInvoiced;
    acc.revInvUnpaid += p.revenueInvoicedUnpaid;
    acc.costNotInv += p.costNotYetInvoiced;
    acc.costInvUnpaid += p.costInvoicedUnpaid;
    return acc;
  }, { totalRevenue: 0, totalCost: 0, received: 0, invoicedRevenue: 0, paid: 0, invoicedCost: 0, revNotInv: 0, revInvUnpaid: 0, costNotInv: 0, costInvUnpaid: 0 }), [filteredProjects]);

  const applyQuickFilter = (type: string) => {
    setFilters((prev) => {
      if (type === "all") return { ...defaultFilters };
      if (type === "red") return { ...prev, rag: "Red" };
      if (type === "behind") return { ...prev, behindScheduleOnly: true };
      if (type === "cash") return { ...prev, cashRiskOnly: true };
      if (type === "margin") return { ...prev, marginRiskOnly: true };
      if (type === "commissioning") return { ...prev, commissioningDueOnly: true };
      return { ...prev, handoverDueOnly: true };
    });
  };

  const handleSort = (key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  };

  const openProject = (project: DerivedExecutionProject, tab?: string) => {
    if (!project.id) return;
    setLocation(tab ? `/projects/${project.id}?tab=${tab}` : `/projects/${project.id}`);
  };

  // Backend currently only supplies generic lifecycle payload; no dedicated domain RAG fields yet.
  const domainStatus = (project: DerivedExecutionProject) => {
    const schedule = project.isBehindSchedule ? "Red" : project.actualPct === null || project.expectedPct === null ? "Amber" : "Green";
    const finance = project.isMarginRisk && project.isCashRisk ? "Red" : project.isMarginRisk || project.isCashRisk ? "Amber" : "Green";
    const construction = project.isConstructionDateMissing || project.isExecutionDateRisk ? "Red" : (project.isCommissioningDueSoon || project.isHandoverDueSoon) && (project.actualPct ?? 100) < 80 ? "Amber" : "Green";
    const dates = (project.isCommissioningDueSoon || project.isHandoverDueSoon) && (project.actualPct ?? 100) < 85 ? "Red" : "Green";
    return { schedule, finance, construction, dates };
  };

  const constructionRisk = (project: DerivedExecutionProject): "High" | "Medium" | "Low" => {
    if (project.isConstructionDateMissing || (project.isBehindSchedule && (project.isCommissioningDueSoon || project.isHandoverDueSoon))) return "High";
    if ((project.isCommissioningDueSoon || project.isHandoverDueSoon) && (project.actualPct ?? 100) < 80) return "Medium";
    return "Low";
  };

  if (loading) {
    return <div className="flex flex-col items-center justify-center py-24 gap-3" data-testid="execution-board-loading"><EnergyLoader size="lg" label="Loading execution data..." /></div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4" data-testid="execution-board-error">
        <div className="rounded-full bg-red-50 p-4"><AlertCircle className="w-8 h-8 text-red-500" /></div>
        <div className="text-center"><p className="text-sm font-medium text-red-700 mb-1">Failed to load data</p><p className="text-xs text-muted-foreground max-w-xs">{error}</p></div>
        <Button variant="outline" size="sm" onClick={loadData}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry</Button>
      </div>
    );
  }

  if (!canView) {
    return <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container"><Card className="max-w-md w-full shadow-lg"><CardContent className="py-12 text-center"><AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" /><h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2><p className="text-muted-foreground text-sm">You don't have permission to view the Execution Board.</p></CardContent></Card></div>;
  }

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto pb-6" data-testid="execution-board-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Activity className="w-6 h-6 text-blue-600" />Execution Command Center</h1>
          <p className="text-muted-foreground text-sm mt-1">Live portfolio control across delivery, finance, and site execution</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={loadData}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
          <Button variant="outline" size="sm" onClick={() => setFilters(defaultFilters)}>Reset filters</Button>
          <Button variant="outline" size="sm" disabled>Export</Button>
          <Button variant="outline" size="sm" disabled>Save view</Button>
        </div>
      </div>

      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            <Input placeholder="Search project / site / client" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
            <SearchableSelect value={filters.executionPhase} onValueChange={(v) => setFilters((f) => ({ ...f, executionPhase: v }))} placeholder="Execution phase" options={[{ value: "all", label: "All phases" }, { value: "Awaiting Phase", label: "Awaiting Phase" }, ...phases.map((phase) => ({ value: phase, label: phase }))]} />
            <SearchableSelect value={filters.pm} onValueChange={(v) => setFilters((f) => ({ ...f, pm: v }))} placeholder="PM" options={[{ value: "all", label: "All PMs" }, ...pms.map((pm) => ({ value: pm, label: pm }))]} />
            <SearchableSelect value={filters.rag} onValueChange={(v) => setFilters((f) => ({ ...f, rag: v }))} placeholder="RAG" options={[{ value: "all", label: "All RAG" }, { value: "Red", label: "Red" }, { value: "Amber", label: "Amber" }, { value: "Green", label: "Green" }, { value: "Unknown", label: "Unknown" }]} />
            <SearchableSelect
              value={filters.gateStatus}
              onValueChange={(v) => setFilters((f) => ({ ...f, gateStatus: v }))}
              placeholder="Execution eligibility"
              options={[
                { value: "all", label: "All eligibility states" },
                { value: "ENABLED", label: "Enabled" },
                { value: "ELIGIBLE", label: "Eligible (not enabled)" },
                { value: "NOT_ELIGIBLE", label: "Not eligible" },
              ]}
            />
            <div className="text-xs text-muted-foreground flex items-center">Showing {filteredProjects.length} of {allStats.totalProjects} active execution projects</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["exceptionOnly", "Exception only"], ["behindScheduleOnly", "Behind schedule only"], ["marginRiskOnly", "Margin risk only"], ["cashRiskOnly", "Cash risk only"], ["commissioningDueOnly", "Commissioning due soon"], ["handoverDueOnly", "Handover due soon"],
            ].map(([key, label]) => {
              const active = Boolean(filters[key as keyof ExecutionFilters]);
              return <Button key={key} size="sm" variant={active ? "default" : "outline"} onClick={() => setFilters((f) => ({ ...f, [key]: !active }))}>{label}</Button>;
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="cursor-pointer" onClick={() => applyQuickFilter("all")}>All Active</Badge>
            <Badge className="cursor-pointer bg-red-50 text-red-700 border-red-200" onClick={() => applyQuickFilter("red")}>Red Only</Badge>
            <Badge className="cursor-pointer" onClick={() => applyQuickFilter("behind")}>Behind Schedule</Badge>
            <Badge className="cursor-pointer" onClick={() => applyQuickFilter("cash")}>Cash Stuck</Badge>
            <Badge className="cursor-pointer" onClick={() => applyQuickFilter("margin")}>Margin Risk</Badge>
            <Badge className="cursor-pointer" onClick={() => applyQuickFilter("commissioning")}>Commissioning Due 14d</Badge>
            <Badge className="cursor-pointer" onClick={() => applyQuickFilter("handover")}>Handover Due 30d</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {[
          { title: "Active Execution Projects", value: stats.totalProjects, action: () => setFilters(defaultFilters) },
          { title: "Execution Enabled", value: allStats.enabled, action: () => setFilters((f) => ({ ...f, gateStatus: "ENABLED" })) },
          { title: "Eligible (Not Enabled)", value: allStats.eligible, action: () => setFilters((f) => ({ ...f, gateStatus: "ELIGIBLE" })) },
          { title: "Not Eligible", value: allStats.notEligible, action: () => setFilters((f) => ({ ...f, gateStatus: "NOT_ELIGIBLE" })) },
          { title: "Total Contract Value", value: formatCurrencyCompact(stats.contractValue), action: () => setActiveView("coo") },
          { title: "Portfolio Completion %", value: `${stats.weightedCompletion}%`, action: () => setActiveView("program") },
          { title: "Revenue Remaining to Collect", value: formatCurrencyCompact(stats.revenueRemaining), action: () => { setActiveView("finance"); setFilters((f) => ({ ...f, cashRiskOnly: true })); } },
          { title: "Cost Remaining to Pay", value: formatCurrencyCompact(stats.costRemaining), action: () => setActiveView("finance") },
          { title: "Red Projects", value: stats.redProjects, action: () => setFilters((f) => ({ ...f, rag: "Red" })) },
          { title: "Escalation Projects", value: stats.escalations, action: () => { setActiveView("coo"); setFilters((f) => ({ ...f, exceptionOnly: true })); } },
          { title: "Key Dates Due in 14 Days", value: stats.keyDatesDue, action: () => { setActiveView("construction"); setFilters((f) => ({ ...f, commissioningDueOnly: true })); } },
        ].map((kpi) => (
          <Card key={kpi.title} className="cursor-pointer hover:shadow-md" onClick={kpi.action}><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">{kpi.title}</p><p className="text-lg font-bold mt-1">{kpi.value}</p></CardContent></Card>
        ))}
      </div>


      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="p-3 text-xs md:text-sm text-blue-900">
          <p className="font-semibold">Canonical execution gate is now visible</p>
          <p className="mt-1">
            Eligibility is backend-driven from signed status, signed date, and signed document link.
            The board shows ACTIVE projects and defaults to Enabled via the eligibility filter.
            Each project row now exposes its gate state so users can reconcile enabled vs eligible vs not eligible.
          </p>
        </CardContent>
      </Card>

      <div className="flex gap-2 border-b pb-2">
        {(["coo", "program", "finance", "construction"] as RoleView[]).map((view) => (
          <Button key={view} variant={activeView === view ? "default" : "ghost"} onClick={() => setActiveView(view)}>{view.toUpperCase()}</Button>
        ))}
      </div>

      {activeView === "coo" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Portfolio Contract Value</p><p className="text-xl font-bold">{formatCurrencyCompact(stats.contractValue)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Weighted Completion</p><p className="text-xl font-bold">{stats.weightedCompletion}%</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Revenue Remaining to Collect</p><p className="text-xl font-bold">{formatCurrencyCompact(stats.revenueRemaining)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Invoiced but Unpaid</p><p className="text-xl font-bold">{formatCurrencyCompact(stats.invoicedUnpaid)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Overall GP %</p><p className="text-xl font-bold">{stats.overallGpPct?.toFixed(1) ?? "—"}%</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Escalation Projects</p><p className="text-xl font-bold">{stats.escalations}</p></CardContent></Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card><CardHeader><CardTitle className="text-base">Needs COO Attention</CardTitle></CardHeader><CardContent className="space-y-2">{cooAttention.map((p) => <div key={p.projectName} className="text-sm border rounded p-2 cursor-pointer" onClick={() => setExpandedId(p.id ?? null)}><div className="flex justify-between gap-2"><p className="font-medium truncate">{p.cleanName}</p><Badge className={ragClass(p.ragStatus)}>{p.ragStatus || "Unknown"}</Badge></div><p className="text-xs text-muted-foreground">{p.pm || "Unassigned"} · GP {p.gpPct?.toFixed(1) ?? "—"}% · Var {p.scheduleVariancePct ?? "—"}%</p></div>)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Portfolio Health Matrix</CardTitle></CardHeader><CardContent className="space-y-2">{filteredProjects.slice(0, 8).map((p) => { const ds = domainStatus(p); return <div key={p.projectName} className="text-xs grid grid-cols-6 gap-1 items-center"><span className="col-span-2 truncate">{p.cleanName}</span><Badge className={ragClass(p.ragStatus)}>{p.ragStatus || "N/A"}</Badge><Badge className={ragClass(ds.schedule)}>{ds.schedule}</Badge><Badge className={ragClass(ds.finance)}>{ds.finance}</Badge><Badge className={ragClass(ds.construction)}>{ds.construction}</Badge></div>; })}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Decision Queue</CardTitle></CardHeader><CardContent className="space-y-2">{filteredProjects.filter((p) => p.hasEscalation || p.isRed || p.isMarginRisk || p.isExecutionDateRisk).slice(0, 10).map((p) => <div key={p.projectName} className="text-sm border rounded p-2"><p className="font-medium">{p.cleanName}</p><p className="text-xs text-muted-foreground truncate">{getProjectExceptionFlags(p).join(" · ")}</p></div>)}</CardContent></Card>
          </div>
        </div>
      )}

      {activeView === "program" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <Card><CardContent className="p-3"><p className="text-xs">Projects in Execution</p><p className="text-xl font-bold">{stats.totalProjects}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">On Track</p><p className="text-xl font-bold">{stats.totalProjects - stats.behind}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Behind Schedule</p><p className="text-xl font-bold text-red-600">{stats.behind}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Avg Variance</p><p className="text-xl font-bold">{Math.round(filteredProjects.reduce((s, p) => s + (p.scheduleVariancePct || 0), 0) / (filteredProjects.length || 1))}%</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Commissioning Due 14d</p><p className="text-xl font-bold">{filteredProjects.filter((p) => p.isCommissioningDueSoon).length}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Handover Due 30d</p><p className="text-xl font-bold">{filteredProjects.filter((p) => p.isHandoverDueSoon).length}</p></CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle className="text-base">Execution Phase Flow Board</CardTitle></CardHeader><CardContent><div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2">{Object.entries(groupedPhase).map(([phase, projects]) => <div key={phase} className="rounded border p-2 bg-muted/30"><p className="text-xs font-semibold mb-2">{phase} ({projects.length})</p><div className="space-y-1">{projects.slice(0, 5).map((p) => <div key={p.projectName} className="rounded bg-card border p-1.5 text-xs cursor-pointer" onClick={() => setExpandedId(p.id ?? null)}><p className="font-medium truncate">{p.cleanName}</p><p className="text-muted-foreground">{p.pm || "Unassigned"} · {p.actualPct ?? "—"}%/{p.expectedPct ?? "—"}%</p><div className="flex gap-1 mt-1 flex-wrap">{p.isBehindSchedule && <Badge variant="outline">behind</Badge>}{p.isCashRisk && <Badge variant="outline">cash</Badge>}{p.isMarginRisk && <Badge variant="outline">margin</Badge>}{(p.isCommissioningDueSoon || p.isHandoverDueSoon) && <Badge variant="outline">due soon</Badge>}</div></div>)}</div></div>)}</div></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">PM Load Matrix</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th>PM</th><th>Active</th><th>Red</th><th>Behind</th><th>Avg completion</th><th>Cash risks</th><th>Margin risks</th></tr></thead><tbody>{Object.entries(groupedPm).map(([pm, projects]) => <tr key={pm} className="border-t"><td className="py-2">{pm}</td><td>{projects.length}</td><td>{projects.filter((p) => p.isRed).length}</td><td>{projects.filter((p) => p.isBehindSchedule).length}</td><td>{Math.round(projects.reduce((s, p) => s + (p.actualPct || 0), 0) / (projects.length || 1))}%</td><td>{projects.filter((p) => p.isCashRisk).length}</td><td>{projects.filter((p) => p.isMarginRisk).length}</td></tr>)}</tbody></table></div></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Program Exception Table</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th>Project</th><th>PM</th><th>Phase</th><th>Exception</th><th>Severity</th><th>Actual</th><th>Expected</th><th>Next date</th><th>RAG</th></tr></thead><tbody>{filteredProjects.filter((p) => p.exceptions.length).map((p) => <tr key={p.projectName} className="border-t"><td>{p.cleanName}</td><td>{p.pm || "Unassigned"}</td><td>{p.executionPhase || "Awaiting"}</td><td>{p.exceptions[0]}</td><td>{constructionRisk(p)}</td><td>{p.actualPct ?? "—"}%</td><td>{p.expectedPct ?? "—"}%</td><td>{formatDate(p.commissioningDate || p.clientHandoverDate)}</td><td><Badge className={ragClass(p.ragStatus)}>{p.ragStatus || "Unknown"}</Badge></td></tr>)}</tbody></table></div></CardContent></Card>
        </div>
      )}

      {activeView === "finance" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <Card><CardContent className="p-3"><p className="text-xs">Revenue Remaining to Collect</p><p className="text-xl font-bold">{formatCurrencyCompact(stats.revenueRemaining)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Invoiced but Unpaid</p><p className="text-xl font-bold">{formatCurrencyCompact(stats.invoicedUnpaid)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Cost Remaining to Pay</p><p className="text-xl font-bold">{formatCurrencyCompact(stats.costRemaining)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Cost Invoiced Unpaid</p><p className="text-xl font-bold">{formatCurrencyCompact(stats.costInvoicedUnpaid)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Overall GP %</p><p className="text-xl font-bold">{stats.overallGpPct?.toFixed(1) ?? "—"}%</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Cash Risk Projects</p><p className="text-xl font-bold">{stats.cashRisk}</p></CardContent></Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card><CardHeader><CardTitle className="text-base">Revenue Summary</CardTitle></CardHeader><CardContent className="text-sm space-y-2"><div className="flex justify-between"><span>Total Revenue</span><span>{formatCurrencyFull(financeTotals.totalRevenue)}</span></div><div className="flex justify-between"><span>Not Yet Invoiced</span><span>{formatCurrencyFull(financeTotals.revNotInv)}</span></div><div className="flex justify-between"><span>Invoiced Unpaid</span><span>{formatCurrencyFull(financeTotals.revInvUnpaid)}</span></div><div className="flex justify-between"><span>Received</span><span>{formatCurrencyFull(financeTotals.received)}</span></div></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Cost Summary</CardTitle></CardHeader><CardContent className="text-sm space-y-2"><div className="flex justify-between"><span>Total Cost</span><span>{formatCurrencyFull(financeTotals.totalCost)}</span></div><div className="flex justify-between"><span>Not Yet Invoiced</span><span>{formatCurrencyFull(financeTotals.costNotInv)}</span></div><div className="flex justify-between"><span>Invoiced Unpaid</span><span>{formatCurrencyFull(financeTotals.costInvUnpaid)}</span></div><div className="flex justify-between"><span>Paid</span><span>{formatCurrencyFull(financeTotals.paid)}</span></div></CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle className="text-base">Debtors Risk Table</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th>Project</th><th>PM</th><th>Total Revenue</th><th>Invoiced Revenue</th><th>Received Revenue</th><th>Invoiced Unpaid</th><th>Revenue Remaining</th><th>GP%</th><th>Finance risk</th></tr></thead><tbody>{sortedProjects.map((p) => <tr key={p.projectName} className="border-t"><td>{p.cleanName}</td><td>{p.pm || "Unassigned"}</td><td>{formatCurrencyCompact(p.totalRevenue)}</td><td>{formatCurrencyCompact(p.invoicedRevenue)}</td><td>{formatCurrencyCompact(p.receivedRevenue)}</td><td>{formatCurrencyCompact(p.revenueInvoicedUnpaid)}</td><td>{formatCurrencyCompact(p.revenueRemainingToCollect)}</td><td>{p.gpPct?.toFixed(1) ?? "—"}%</td><td>{p.isCashRisk || p.isMarginRisk ? <Badge className="bg-amber-50 text-amber-700 border-amber-200">Risk</Badge> : <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Stable</Badge>}</td></tr>)}</tbody></table></div></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Margin Watchlist</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th>Project</th><th>PM</th><th>Revenue</th><th>Cost</th><th>GP%</th><th>Margin Risk</th><th>Cash Risk</th><th>RAG</th></tr></thead><tbody>{sortedProjects.filter((p) => p.isMarginRisk || p.isCashRisk).map((p) => <tr key={p.projectName} className="border-t"><td>{p.cleanName}</td><td>{p.pm || "Unassigned"}</td><td>{formatCurrencyCompact(p.totalRevenue)}</td><td>{formatCurrencyCompact(p.totalCost)}</td><td>{p.gpPct?.toFixed(1) ?? "—"}%</td><td>{p.isMarginRisk ? "Yes" : "No"}</td><td>{p.isCashRisk ? "Yes" : "No"}</td><td><Badge className={ragClass(p.ragStatus)}>{p.ragStatus || "Unknown"}</Badge></td></tr>)}</tbody></table></div></CardContent></Card>
        </div>
      )}

      {activeView === "construction" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <Card><CardContent className="p-3"><p className="text-xs">Sites in Construction</p><p className="text-xl font-bold">{filteredProjects.filter((p) => (p.executionPhase || "").toLowerCase().includes("construction")).length}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Delayed / Missing Starts</p><p className="text-xl font-bold">{filteredProjects.filter((p) => p.isConstructionDateMissing).length}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Commissioning Due 14d</p><p className="text-xl font-bold">{filteredProjects.filter((p) => p.isCommissioningDueSoon).length}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Handover Due 30d</p><p className="text-xl font-bold">{filteredProjects.filter((p) => p.isHandoverDueSoon).length}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Behind Schedule Projects</p><p className="text-xl font-bold">{filteredProjects.filter((p) => p.isBehindSchedule).length}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs">Construction Risk Projects</p><p className="text-xl font-bold">{filteredProjects.filter((p) => constructionRisk(p) !== "Low").length}</p></CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle className="text-base">Site Status Board</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th>Project</th><th>PM</th><th>Execution Phase</th><th>Construction Start</th><th>Commissioning</th><th>Handover</th><th>Actual</th><th>Expected</th><th>Variance</th><th>RAG</th><th>Construction Risk</th></tr></thead><tbody>{sortedProjects.map((p) => <tr key={p.projectName} className="border-t"><td>{p.cleanName}</td><td>{p.pm || "Unassigned"}</td><td>{p.executionPhase || "Awaiting"}</td><td>{formatDate(p.constructionStartDate)}</td><td>{formatDate(p.commissioningDate)}</td><td>{formatDate(p.clientHandoverDate)}</td><td>{p.actualPct ?? "—"}%</td><td>{p.expectedPct ?? "—"}%</td><td>{p.scheduleVariancePct ?? "—"}%</td><td><Badge className={ragClass(p.ragStatus)}>{p.ragStatus || "Unknown"}</Badge></td><td><Badge className={riskClass(constructionRisk(p))}>{constructionRisk(p)}</Badge></td></tr>)}</tbody></table></div></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Date Readiness Signals</CardTitle></CardHeader><CardContent><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">{filteredProjects.slice(0, 12).map((p) => <div className="border rounded p-2 text-xs" key={p.projectName}><p className="font-medium mb-1">{p.cleanName}</p><p>Construction date: {p.constructionStartDate ? "Yes" : "No"}</p><p>Commissioning date: {p.commissioningDate ? "Yes" : "No"}</p><p>Handover date: {p.clientHandoverDate ? "Yes" : "No"}</p><p>Behind schedule: {p.isBehindSchedule ? "Yes" : "No"}</p><p>In construction phase: {(p.executionPhase || "").toLowerCase().includes("construction") ? "Yes" : "No"}</p><p>Date pressure: {p.isExecutionDateRisk ? "Yes" : "No"}</p></div>)}</div></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Construction Exceptions</CardTitle></CardHeader><CardContent className="space-y-2">{filteredProjects.filter((p) => p.isConstructionDateMissing || p.isExecutionDateRisk || (p.isHandoverDueSoon && (p.actualPct ?? 100) < 80)).map((p) => <div className="border rounded p-2" key={p.projectName}><div className="flex justify-between"><p className="font-medium text-sm">{p.cleanName}</p><Badge className={riskClass(constructionRisk(p))}>{constructionRisk(p)}</Badge></div><p className="text-xs text-muted-foreground">{p.exceptions.join(" · ")}</p></div>)}</CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Full Drilldown Table</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[1300px] text-sm">
            <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
              <tr>
                <th className="py-2"><SortHeader label="Project" keyName="project" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></th>
                <th><SortHeader label="PM" keyName="pm" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></th>
                <th>Phase</th>
                <th><SortHeader label="Actual %" keyName="actual" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></th>
                <th><SortHeader label="Expected %" keyName="expected" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></th>
                <th><SortHeader label="Variance" keyName="variance" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></th>
                <th><SortHeader label="Revenue Remaining" keyName="revenueRemaining" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></th>
                <th><SortHeader label="Invoiced Unpaid" keyName="invoicedUnpaid" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></th>
                <th><SortHeader label="Cost Remaining" keyName="costRemaining" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></th>
                <th><SortHeader label="GP %" keyName="gp" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} /></th>
                <th>RAG</th>
                <th>Eligibility</th>
                <th>Escalation</th>
                <th>Construction</th>
                <th>Commissioning</th>
                <th>Handover</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedProjects.map((p) => {
                const expanded = expandedId === p.id;
                return (
                  <React.Fragment key={`row-${p.id ?? p.projectName}`}>
                    <tr className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setExpandedId(expanded ? null : p.id)}>
                      <td className="py-2 font-medium">{p.cleanName}</td>
                      <td>{p.pm || "Unassigned"}</td>
                      <td>{p.executionPhase || "Awaiting"}</td>
                      <td>{p.actualPct ?? "—"}%</td>
                      <td>{p.expectedPct ?? "—"}%</td>
                      <td className={(p.scheduleVariancePct ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}>{p.scheduleVariancePct ?? "—"}%</td>
                      <td>{formatCurrencyCompact(p.revenueRemainingToCollect)}</td>
                      <td>{formatCurrencyCompact(p.revenueInvoicedUnpaid)}</td>
                      <td>{formatCurrencyCompact(p.costRemainingToPay)}</td>
                      <td>{p.gpPct?.toFixed(1) ?? "—"}%</td>
                      <td><Badge className={ragClass(p.ragStatus)}>{p.ragStatus || "Unknown"}</Badge></td>
                      <td><Badge variant="outline">{p.executionGateStatus || "NOT_ELIGIBLE"}</Badge></td>
                      <td>{p.escalationLevel || "—"}</td>
                      <td>{formatDate(p.constructionStartDate)}</td>
                      <td>{formatDate(p.commissioningDate)}</td>
                      <td>{formatDate(p.clientHandoverDate)}</td>
                      <td>{expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                    </tr>
                    {expanded && (
                      <tr className="bg-muted/30">
                        <td colSpan={17} className="p-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                            <div className="border rounded p-2"><p className="font-semibold mb-1">Summary</p><p>Project: {p.cleanName}</p><p>PM: {p.pm || "Unassigned"}</p><p>Phase: {p.executionPhase || "Awaiting"}</p><p>RAG: {p.ragStatus || "Unknown"}</p><p>Eligibility: {p.executionGateStatus || "NOT_ELIGIBLE"}</p><p>Escalation: {p.escalationLevel || "—"}</p><p>Size: {p.sizeKwp || "—"}</p><p>Contract: {formatCurrencyFull(p.contractValueNum)}</p></div>
                            <div className="border rounded p-2"><p className="font-semibold mb-1">Progress</p><p>Actual: {p.actualPct ?? "—"}%</p><p>Expected: {p.expectedPct ?? "—"}%</p><p>Variance: {p.scheduleVariancePct ?? "—"}%</p><p>Plan tasks: {p.planTotal || 0}</p><p className="font-semibold mt-2 mb-1">Dates</p><p>Construction: {formatDate(p.constructionStartDate)}</p><p>Commissioning: {formatDate(p.commissioningDate)}</p><p>Handover: {formatDate(p.clientHandoverDate)}</p></div>
                            <div className="border rounded p-2"><p className="font-semibold mb-1">Finance</p><p>Total revenue: {formatCurrencyFull(p.totalRevenue)}</p><p>Invoiced revenue: {formatCurrencyFull(p.invoicedRevenue)}</p><p>Received revenue: {formatCurrencyFull(p.receivedRevenue)}</p><p>Revenue remaining: {formatCurrencyFull(p.revenueRemainingToCollect)}</p><p>Total cost: {formatCurrencyFull(p.totalCost)}</p><p>Invoiced cost: {formatCurrencyFull(p.invoicedCost)}</p><p>Paid cost: {formatCurrencyFull(p.paidCost)}</p><p>Cost remaining: {formatCurrencyFull(p.costRemainingToPay)}</p><p>GP%: {p.gpPct?.toFixed(1) ?? "—"}%</p></div>
                          </div>
                          <div className="mt-2"><p className="font-semibold text-sm">Exceptions</p><div className="flex flex-wrap gap-1 mt-1">{p.exceptions.length ? p.exceptions.map((ex) => <Badge key={ex} variant="outline">{ex}</Badge>) : <span className="text-xs text-muted-foreground">No active exceptions</span>}</div></div>
                          {p.executionGateStatus !== "ENABLED" && p.executionEligibilityReasons && p.executionEligibilityReasons.length > 0 && (
                            <div className="mt-2">
                              <p className="font-semibold text-sm">Execution eligibility blockers</p>
                              <ul className="list-disc pl-5 text-xs text-muted-foreground mt-1">
                                {p.executionEligibilityReasons.map((reason) => <li key={`${p.projectName}-${reason}`}>{reason}</li>)}
                              </ul>
                            </div>
                          )}
                          <div className="flex gap-2 mt-3 flex-wrap">
                            <Button size="sm" onClick={() => openProject(p)}><ExternalLink className="w-3.5 h-3.5 mr-1" />Open Project</Button>
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
          {sortedProjects.length === 0 && <div className="text-center text-sm text-muted-foreground py-10">No projects match current filters.</div>}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Placeholder controls (Export / Save view) are UI scaffolds pending backend support.</div>
    </div>
  );
}
