import React, { useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { usePermission } from "@/hooks/use-permissions";
import { EnergyLoader } from "@/components/ui/energy-loader";
import {
  Activity, AlertCircle, AlertTriangle, RefreshCw, Filter, RotateCcw,
  LayoutDashboard, Layers, HardHat, DollarSign,
} from "lucide-react";
import {
  ExecutionDashboardContext,
  useExecutionDataProvider,
  defaultFilters,
} from "./use-execution-data";
import OverviewPage from "./OverviewPage";
import ProgramPage from "./ProgramPage";
import ConstructionPage from "./ConstructionPage";
import FinancePage from "./FinancePage";

type DashboardView = "overview" | "program" | "construction" | "finance";

const VIEW_CONFIG: { key: DashboardView; label: string; icon: React.ReactNode; path: string }[] = [
  { key: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" />, path: "/execution-board" },
  { key: "program", label: "Program View", icon: <Layers className="w-4 h-4" />, path: "/execution-board/program" },
  { key: "construction", label: "Construction View", icon: <HardHat className="w-4 h-4" />, path: "/execution-board/construction" },
  { key: "finance", label: "Program Finance", icon: <DollarSign className="w-4 h-4" />, path: "/execution-board/finance" },
];

function resolveView(pathname: string): DashboardView {
  if (pathname.startsWith("/execution-board/program")) return "program";
  if (pathname.startsWith("/execution-board/construction")) return "construction";
  if (pathname.startsWith("/execution-board/finance")) return "finance";
  return "overview";
}

const VIEW_COMPONENTS: Record<DashboardView, React.ComponentType> = {
  overview: OverviewPage,
  program: ProgramPage,
  construction: ConstructionPage,
  finance: FinancePage,
};

export default function ExecutionDashboard() {
  const { allowed: canView } = usePermission("execution_board", "view");
  const [location, setLocation] = useLocation();
  const activeView = resolveView(location);
  const ctx = useExecutionDataProvider(setLocation);

  useEffect(() => { ctx.loadData(); }, [ctx.loadData]);

  if (ctx.loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <EnergyLoader size="lg" label="Loading execution dashboard..." />
      </div>
    );
  }

  if (ctx.error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p>{ctx.error}</p>
        <Button onClick={ctx.loadData}><RefreshCw className="w-3.5 h-3.5 mr-1" />Retry</Button>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card><CardContent className="py-8 text-center"><AlertTriangle className="mx-auto mb-2" /><p>Access Denied</p></CardContent></Card>
      </div>
    );
  }

  const staleCount = ctx.filteredProjects.filter((p) => p.importFreshness !== "Fresh").length;
  const ActivePage = VIEW_COMPONENTS[activeView];

  return (
    <ExecutionDashboardContext.Provider value={ctx}>
      <div className="space-y-5 max-w-[1800px] mx-auto pb-8" data-testid="execution-board-page">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Activity className="w-5 h-5 text-emerald-600" />
              </div>
              Execution Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1.5 ml-[46px]">
              Post-handover execution view for{" "}
              <span className="font-medium text-foreground">{ctx.fyLabel}</span>
              {ctx.dashboard && ` (${ctx.dashboard.financialYear.start} to ${ctx.dashboard.financialYear.end})`}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {ctx.lastRefresh && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                Data as of {ctx.lastRefresh.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={ctx.loadData} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />Refresh
            </Button>
            {ctx.hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={() => ctx.setFilters(defaultFilters)} className="gap-1.5 text-muted-foreground">
                <RotateCcw className="w-3.5 h-3.5" />Clear filters
              </Button>
            )}
          </div>
        </div>

        {/* Stale data warning */}
        {staleCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              <strong>{staleCount} project{staleCount !== 1 ? "s" : ""}</strong> have stale imports (&gt;7 days since last data sync).
            </span>
          </div>
        )}

        {/* Filter bar */}
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filters</span>
              <span className="text-xs text-muted-foreground ml-auto">{ctx.filteredProjects.length} of {ctx.allProjects.length} projects</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
              <Input placeholder="Search projects..." value={ctx.filters.search} onChange={(e) => ctx.setFilters((f) => ({ ...f, search: e.target.value }))} className="h-9" data-testid="input-filter-search" />
              <SearchableSelect value={ctx.filters.portfolio} onValueChange={(v) => ctx.setFilters((f) => ({ ...f, portfolio: v }))} placeholder="Portfolio" options={[{ value: "all", label: "All Portfolios" }, ...ctx.portfolios.map((v) => ({ value: v, label: v }))]} />
              <SearchableSelect value={ctx.filters.pm} onValueChange={(v) => ctx.setFilters((f) => ({ ...f, pm: v }))} placeholder="Project Manager" options={[{ value: "all", label: "All PMs" }, ...ctx.pms.map((v) => ({ value: v, label: v }))]} />
              <SearchableSelect value={ctx.filters.pd} onValueChange={(v) => ctx.setFilters((f) => ({ ...f, pd: v }))} placeholder="Project Developer" options={[{ value: "all", label: "All PDs" }, ...ctx.pds.map((v) => ({ value: v, label: v }))]} />
              <SearchableSelect value={ctx.filters.executionPhase} onValueChange={(v) => ctx.setFilters((f) => ({ ...f, executionPhase: v }))} placeholder="Execution Phase" options={[{ value: "all", label: "All Phases" }, ...ctx.phases.map((v) => ({ value: v, label: v }))]} />
              <SearchableSelect value={ctx.filters.rag} onValueChange={(v) => ctx.setFilters((f) => ({ ...f, rag: v }))} placeholder="RAG Status" options={[{ value: "all", label: "All RAG" }, { value: "Red", label: "Red" }, { value: "Amber", label: "Amber" }, { value: "Green", label: "Green" }, { value: "Unknown", label: "Unknown" }]} />
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
                const active = Boolean(ctx.filters[key]);
                return (
                  <button
                    key={key}
                    onClick={() => ctx.setFilters((f) => ({ ...f, [key]: !active }))}
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

        {/* Page navigation */}
        <div className="flex gap-1 border-b pb-0">
          {VIEW_CONFIG.map((view) => (
            <button
              key={view.key}
              onClick={() => setLocation(view.path)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeView === view.key
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
              data-testid={`tab-view-${view.key}`}
            >
              {view.icon}
              {view.label}
            </button>
          ))}
        </div>

        {/* Active page */}
        <ActivePage />
      </div>
    </ExecutionDashboardContext.Provider>
  );
}
