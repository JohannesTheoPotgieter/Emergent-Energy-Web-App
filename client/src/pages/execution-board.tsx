import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";
import {
  Loader2, Search, Zap, AlertCircle, CheckCircle2, AlertTriangle,
  TrendingUp, TrendingDown, DollarSign, BarChart3,
  Calendar, ChevronDown, ChevronUp, ExternalLink, Target,
  Building2, ArrowRight, ClipboardList, Receipt, Activity,
} from "lucide-react";

interface ProjectInfo {
  id: number | null;
  projectName: string;
  sizeKwp: string | null;
  pd: string | null;
  pm: string | null;
  contractValue: string | null;
  phase: string | null;
  isActive: boolean;
  escalationLevel: string | null;
  ragStatus: string | null;
  executionEnabled: boolean;
  executionGateStatus: string;
  signedStatus: string;
  executionPhase: string | null;
  archivedStatus: string;
  hasTracker: boolean;
  planTotal: number;
  planAvgPct: number;
  projectPctComplete: number | null;
  expectedPctComplete: number | null;
  totalRevenue: number;
  invoicedRevenue: number;
  receivedRevenue: number;
  totalCost: number;
  invoicedCost: number;
  paidCost: number;
  gpPct: number | null;
  constructionStartDate: string | null;
  commissioningDate: string | null;
  clientHandoverDate: string | null;
}

function cleanProjectName(name: string): string {
  return name.replace(/_Tracker$/i, "").replace(/_/g, " ");
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}K`;
  return `R${value.toFixed(0)}`;
}

function formatCurrencyFull(value: number): string {
  return `R${value.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function ragColor(rag: string | null): string {
  if (!rag) return "bg-slate-100 text-slate-500 border-slate-200";
  const colors: Record<string, string> = {
    Green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Amber: "bg-amber-50 text-amber-700 border-amber-200",
    Red: "bg-red-50 text-red-700 border-red-200",
  };
  return colors[rag] || "bg-slate-50 text-slate-600 border-slate-200";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
}

function ScheduleHealthBadge({ actual, expected }: { actual: number | null; expected: number | null }) {
  if (actual === null) return <Badge variant="outline" className="text-[10px] text-slate-400 border-slate-200">No plan</Badge>;
  const diff = expected !== null ? Math.round((actual - expected) * 100) : null;
  if (diff === null) return <Badge variant="outline" className="text-[10px]">{Math.round(actual * 100)}%</Badge>;
  if (diff >= 0) {
    return (
      <Badge className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 gap-0.5 font-medium">
        <TrendingUp className="w-3 h-3" />+{diff}%
      </Badge>
    );
  }
  return (
    <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200 gap-0.5 font-medium">
      <TrendingDown className="w-3 h-3" />{diff}%
    </Badge>
  );
}

function DualProgressBar({ actual, expected, height = "h-2.5" }: {
  actual: number; expected: number | null; height?: string;
}) {
  const actualPct = Math.min(100, Math.max(0, actual));
  const expectedPct = expected !== null ? Math.min(100, Math.max(0, expected)) : null;
  const isAhead = expectedPct !== null && actualPct >= expectedPct;
  const isBehind = expectedPct !== null && actualPct < expectedPct - 5;
  const barColor = isBehind ? "bg-red-500" : isAhead ? "bg-emerald-500" : "bg-blue-500";

  return (
    <div className={`w-full ${height} bg-slate-100 rounded-full overflow-hidden relative`}>
      {expectedPct !== null && (
        <div
          className="absolute top-0 h-full rounded-full border-r-2 border-dashed border-slate-400/60 bg-slate-200/50"
          style={{ width: `${expectedPct}%` }}
        />
      )}
      <div
        className={`relative h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
        style={{ width: `${actualPct}%` }}
      />
    </div>
  );
}

function FinanceBar({ value, max, color, height = "h-2" }: {
  value: number; max: number; color: string; height?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={`w-full ${height} bg-slate-100 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ExecutionBoard() {
  const { allowed: canView } = usePermission('execution_board', 'view');
  const [allProjects, setAllProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/lifecycle-board/projects", { headers });
      if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
      const data: ProjectInfo[] = await res.json();
      setAllProjects(data);
    } catch (err: any) {
      setError(err.message || "Failed to load projects");
      toast({ title: "Error", description: err.message || "Failed to load projects", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const executionProjects = useMemo(
    () => allProjects.filter(p => p.executionEnabled === true && p.archivedStatus === "ACTIVE"),
    [allProjects]
  );

  const executionPhases = useMemo(() => {
    const phases = new Set<string>();
    executionProjects.forEach(p => { if (p.executionPhase) phases.add(p.executionPhase); });
    return Array.from(phases).sort();
  }, [executionProjects]);

  const filtered = useMemo(() => {
    return executionProjects.filter(p => {
      if (searchTerm) {
        const clean = cleanProjectName(p.projectName).toLowerCase();
        if (!clean.includes(searchTerm.toLowerCase())) return false;
      }
      if (phaseFilter !== "all") {
        if (phaseFilter === "awaiting") { if (p.executionPhase !== null) return false; }
        else { if (p.executionPhase !== phaseFilter) return false; }
      }
      return true;
    });
  }, [executionProjects, searchTerm, phaseFilter]);

  const stats = useMemo(() => {
    const projects = executionProjects;
    const withPct = projects.filter(p => p.projectPctComplete !== null);
    const avgCompletion = withPct.length > 0
      ? Math.round(withPct.reduce((s, p) => s + (p.projectPctComplete || 0) * 100, 0) / withPct.length)
      : 0;

    const totalContractValue = projects.reduce((s, p) => s + (parseFloat(p.contractValue || "0") || 0), 0);
    const totalRevenue = projects.reduce((s, p) => s + (p.totalRevenue || 0), 0);
    const totalReceived = projects.reduce((s, p) => s + (p.receivedRevenue || 0), 0);
    const totalCost = projects.reduce((s, p) => s + (p.totalCost || 0), 0);
    const totalPaid = projects.reduce((s, p) => s + (p.paidCost || 0), 0);
    const overallGP = totalRevenue > 0 ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100) : null;

    const behindSchedule = projects.filter(p => {
      if (p.projectPctComplete === null || p.expectedPctComplete === null) return false;
      return p.projectPctComplete < p.expectedPctComplete - 0.05;
    }).length;

    return { avgCompletion, totalContractValue, totalRevenue, totalReceived, totalCost, totalPaid, overallGP, behindSchedule, total: projects.length };
  }, [executionProjects]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3" data-testid="execution-board-loading">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-sm text-muted-foreground">Loading execution data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4" data-testid="execution-board-error">
        <div className="rounded-full bg-red-50 p-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-red-700 mb-1">Failed to load data</p>
          <p className="text-xs text-muted-foreground max-w-xs">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} data-testid="btn-retry" className="gap-1.5">
          <Activity className="w-3.5 h-3.5" /> Retry
        </Button>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground text-sm">You don't have permission to view the Execution Dashboard.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto" data-testid="execution-board-page">
      <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-execution-title">
            <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
            Execution Dashboard
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">Plan progress & financial health across active projects</p>
        </div>
        <Badge className="text-xs font-semibold px-3 py-1.5 bg-blue-50 text-blue-700 border-blue-200">
          {stats.total} active project{stats.total !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="border-l-4 border-l-blue-500 shadow-sm hover:shadow-md transition-shadow" data-testid="stat-avg-completion">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Target className="w-4 h-4 text-blue-600" />
              <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Avg Completion</span>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-blue-700">{stats.avgCompletion}%</div>
            <div className="mt-2">
              <FinanceBar value={stats.avgCompletion} max={100} color="bg-blue-500" height="h-1.5" />
            </div>
          </CardContent>
        </Card>

        <Card className={`border-l-4 shadow-sm hover:shadow-md transition-shadow ${stats.behindSchedule > 0 ? "border-l-red-500" : "border-l-emerald-500"}`} data-testid="stat-schedule-health">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <BarChart3 className={`w-4 h-4 ${stats.behindSchedule > 0 ? "text-red-600" : "text-emerald-600"}`} />
              <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Schedule</span>
            </div>
            <div className={`text-2xl sm:text-3xl font-bold ${stats.behindSchedule > 0 ? "text-red-600" : "text-emerald-600"}`}>
              {stats.behindSchedule > 0 ? `${stats.behindSchedule} behind` : "On track"}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {stats.total - stats.behindSchedule} of {stats.total} on schedule
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 shadow-sm hover:shadow-md transition-shadow" data-testid="stat-revenue">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Revenue</span>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-emerald-700">{formatCurrency(stats.totalRevenue)}</div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1">
                <FinanceBar value={stats.totalReceived} max={stats.totalRevenue} color="bg-emerald-500" height="h-1.5" />
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{formatCurrency(stats.totalReceived)} in</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500 shadow-sm hover:shadow-md transition-shadow" data-testid="stat-costs">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Receipt className="w-4 h-4 text-orange-600" />
              <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Costs</span>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-orange-700">{formatCurrency(stats.totalCost)}</div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1">
                <FinanceBar value={stats.totalPaid} max={stats.totalCost} color="bg-orange-500" height="h-1.5" />
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{formatCurrency(stats.totalPaid)} paid</span>
            </div>
          </CardContent>
        </Card>

        <Card className={`border-l-4 col-span-2 md:col-span-1 shadow-sm hover:shadow-md transition-shadow ${(stats.overallGP ?? 0) >= 20 ? "border-l-emerald-500" : (stats.overallGP ?? 0) >= 0 ? "border-l-amber-500" : "border-l-red-500"}`} data-testid="stat-gp">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className={`w-4 h-4 ${(stats.overallGP ?? 0) >= 20 ? "text-emerald-600" : (stats.overallGP ?? 0) >= 0 ? "text-amber-600" : "text-red-600"}`} />
              <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Overall GP%</span>
            </div>
            <div className={`text-2xl sm:text-3xl font-bold ${(stats.overallGP ?? 0) >= 20 ? "text-emerald-600" : (stats.overallGP ?? 0) >= 0 ? "text-amber-600" : "text-red-600"}`}>
              {stats.overallGP !== null ? `${stats.overallGP}%` : "—"}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Contract: {formatCurrency(stats.totalContractValue)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search projects..."
            className="pl-9 h-9 text-sm"
            data-testid="input-search-execution"
          />
        </div>
        <Select value={phaseFilter} onValueChange={setPhaseFilter}>
          <SelectTrigger className="w-[170px] h-9 text-xs" data-testid="select-trigger-phase-filter">
            <SelectValue placeholder="All phases" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="select-item-all">All Phases</SelectItem>
            <SelectItem value="awaiting" data-testid="select-item-awaiting">Awaiting Import</SelectItem>
            {executionPhases.map(phase => (
              <SelectItem key={phase} value={phase} data-testid={`select-item-${phase}`}>{phase}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-[11px] text-muted-foreground font-medium" data-testid="text-filtered-count">
          {filtered.length} of {executionProjects.length} shown
        </span>
      </div>

      {executionProjects.length === 0 ? (
        <Card className="shadow-sm" data-testid="empty-state">
          <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="rounded-full bg-slate-50 p-5">
              <Building2 className="w-10 h-10 text-slate-300" />
            </div>
            <div className="text-center max-w-md">
              <p className="text-sm font-medium text-slate-600 mb-1">No projects in execution yet</p>
              <p className="text-xs text-muted-foreground">
                Projects require signed evidence and admin approval to enter execution.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Search className="w-8 h-8 text-slate-300" />
            <p className="text-sm text-muted-foreground">No projects match your filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5" data-testid="execution-projects-list">
          {filtered.map((p) => {
            const actualPct = p.projectPctComplete !== null ? Math.round(p.projectPctComplete * 100) : null;
            const expectedPct = p.expectedPctComplete !== null ? Math.round(p.expectedPctComplete * 100) : null;
            const isExpanded = expandedId === p.id;
            const contractVal = parseFloat(p.contractValue || "0") || 0;
            const revenueCollectedPct = p.totalRevenue > 0 ? Math.round((p.receivedRevenue / p.totalRevenue) * 100) : 0;
            const costPaidPct = p.totalCost > 0 ? Math.round((p.paidCost / p.totalCost) * 100) : 0;
            const scheduleDiff = (actualPct !== null && expectedPct !== null) ? actualPct - expectedPct : null;
            const projectGP = p.gpPct;

            return (
              <Card
                key={p.id ?? p.projectName}
                className={`overflow-hidden transition-all duration-200 shadow-sm ${isExpanded ? "ring-2 ring-blue-200 shadow-md" : "hover:shadow-md hover:border-blue-100"}`}
                data-testid={`card-project-${p.id}`}
              >
                <div
                  className="flex items-center gap-2 sm:gap-4 px-3 sm:px-5 py-3 sm:py-4 cursor-pointer select-none"
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        className="font-semibold text-sm sm:text-[15px] truncate hover:text-blue-600 transition-colors text-left leading-tight"
                        onClick={(e) => { e.stopPropagation(); if (p.id) setLocation(`/projects/${p.id}`); }}
                        data-testid={`link-name-${p.id}`}
                      >
                        {cleanProjectName(p.projectName)}
                      </button>
                      <Badge className={`text-[9px] px-1.5 py-0 shrink-0 border ${ragColor(p.ragStatus)}`}>
                        {p.ragStatus || "—"}
                      </Badge>
                      {p.executionPhase && (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 hidden sm:inline-flex">
                          {p.executionPhase}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      {p.pm && <span className="truncate max-w-[120px]">{p.pm}</span>}
                      {p.sizeKwp && <span className="font-medium">{p.sizeKwp} kWp</span>}
                      {contractVal > 0 && <span className="hidden sm:inline font-medium">{formatCurrency(contractVal)}</span>}
                    </div>
                  </div>

                  <div className="hidden md:flex items-center gap-4 shrink-0">
                    {actualPct !== null && (
                      <div className="flex items-center gap-2 w-[160px]">
                        <div className="flex-1">
                          <DualProgressBar actual={actualPct} expected={expectedPct} height="h-2.5" />
                        </div>
                        <span className="text-sm font-bold tabular-nums w-[36px] text-right">{actualPct}%</span>
                      </div>
                    )}
                    <ScheduleHealthBadge actual={p.projectPctComplete} expected={p.expectedPctComplete} />
                  </div>

                  <div className="hidden lg:flex items-center gap-4 shrink-0">
                    {p.totalRevenue > 0 && (
                      <div className="flex items-center gap-1 text-[11px] text-emerald-600">
                        <DollarSign className="w-3.5 h-3.5" />
                        <span className="font-semibold">{formatCurrency(p.receivedRevenue)}/{formatCurrency(p.totalRevenue)}</span>
                      </div>
                    )}
                    {projectGP !== null && (
                      <span className={`text-[11px] font-bold ${projectGP >= 20 ? "text-emerald-600" : projectGP >= 0 ? "text-amber-600" : "text-red-600"}`}>
                        GP {projectGP}%
                      </span>
                    )}
                  </div>

                  <div className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors ${isExpanded ? "bg-blue-50 text-blue-600" : "text-muted-foreground hover:bg-slate-50"}`}>
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>

                {/* Mobile summary bar */}
                <div className="md:hidden px-3 pb-2 flex items-center gap-2">
                  {actualPct !== null && (
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex-1">
                        <DualProgressBar actual={actualPct} expected={expectedPct} height="h-2" />
                      </div>
                      <span className="text-xs font-bold tabular-nums">{actualPct}%</span>
                      <ScheduleHealthBadge actual={p.projectPctComplete} expected={p.expectedPctComplete} />
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="border-t bg-slate-50/60 px-3 sm:px-5 py-4 sm:py-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                      <div className="rounded-xl bg-white border shadow-sm p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Plan Progress</span>
                          </div>
                          {p.id && (
                            <button
                              className="text-[11px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5 hover:underline"
                              onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=plan`); }}
                              data-testid={`btn-view-plan-${p.id}`}
                            >
                              View <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {actualPct !== null ? (
                          <>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-3xl font-bold">{actualPct}%</span>
                              {expectedPct !== null && (
                                <span className="text-[11px] text-muted-foreground">/ {expectedPct}% expected</span>
                              )}
                            </div>
                            <DualProgressBar actual={actualPct} expected={expectedPct} height="h-3" />
                            <div className="flex items-center justify-between">
                              {scheduleDiff !== null && (
                                <div className={`text-[11px] font-semibold flex items-center gap-0.5 ${scheduleDiff >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                  {scheduleDiff >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                  {scheduleDiff >= 0 ? `${scheduleDiff}% ahead` : `${Math.abs(scheduleDiff)}% behind`}
                                </div>
                              )}
                              <span className="text-[11px] text-muted-foreground">{p.planTotal} tasks</span>
                            </div>
                          </>
                        ) : (
                          <div className="py-3 text-center">
                            <p className="text-xs text-slate-400 italic">No plan imported</p>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl bg-white border shadow-sm p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Revenue</span>
                          </div>
                          {p.id && (
                            <button
                              className="text-[11px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5 hover:underline"
                              onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=revenue`); }}
                              data-testid={`btn-view-revenue-${p.id}`}
                            >
                              View <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {p.totalRevenue > 0 ? (
                          <>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-3xl font-bold text-emerald-700">{formatCurrency(p.totalRevenue)}</span>
                              <span className="text-[11px] text-muted-foreground">costed</span>
                            </div>
                            <FinanceBar value={p.receivedRevenue} max={p.totalRevenue} color="bg-emerald-500" height="h-3" />
                            <div className="flex justify-between text-[11px]">
                              <span className="text-muted-foreground">Invoiced: {formatCurrency(p.invoicedRevenue)}</span>
                              <span className="font-semibold text-emerald-600">{revenueCollectedPct}% in bank</span>
                            </div>
                          </>
                        ) : (
                          <div className="py-3 text-center">
                            <p className="text-xs text-slate-400 italic">No revenue data</p>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl bg-white border shadow-sm p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                            <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Expenditure</span>
                          </div>
                          {p.id && (
                            <button
                              className="text-[11px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5 hover:underline"
                              onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=expenditure`); }}
                              data-testid={`btn-view-costs-${p.id}`}
                            >
                              View <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {p.totalCost > 0 ? (
                          <>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-3xl font-bold text-orange-700">{formatCurrency(p.totalCost)}</span>
                              <span className="text-[11px] text-muted-foreground">costed</span>
                            </div>
                            <FinanceBar value={p.paidCost} max={p.totalCost} color="bg-orange-500" height="h-3" />
                            <div className="flex justify-between text-[11px]">
                              <span className="text-muted-foreground">Invoiced: {formatCurrency(p.invoicedCost)}</span>
                              <span className="font-semibold text-orange-600">{costPaidPct}% paid</span>
                            </div>
                          </>
                        ) : (
                          <div className="py-3 text-center">
                            <p className="text-xs text-slate-400 italic">No cost data</p>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl bg-white border shadow-sm p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${(projectGP ?? 0) >= 20 ? "bg-emerald-500" : (projectGP ?? 0) >= 0 ? "bg-amber-500" : "bg-red-500"}`} />
                            <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">GP% & Dates</span>
                          </div>
                          {p.id && (
                            <button
                              className="text-[11px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5 hover:underline"
                              onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}`); }}
                              data-testid={`btn-view-project-${p.id}`}
                            >
                              Detail <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {projectGP !== null ? (
                          <div className="flex items-baseline gap-1.5">
                            <span className={`text-3xl font-bold ${projectGP >= 20 ? "text-emerald-600" : projectGP >= 0 ? "text-amber-600" : "text-red-600"}`}>
                              {projectGP}%
                            </span>
                            {contractVal > 0 && <span className="text-[11px] text-muted-foreground">of {formatCurrencyFull(contractVal)}</span>}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic py-1">No financial data</p>
                        )}
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-[11px]">
                            <Calendar className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span className="text-muted-foreground">Construction</span>
                            <span className="ml-auto font-medium">{formatDate(p.constructionStartDate)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span className="text-muted-foreground">Commissioning</span>
                            <span className="ml-auto font-medium">{formatDate(p.commissioningDate)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="text-muted-foreground">Handover</span>
                            <span className="ml-auto font-medium">{formatDate(p.clientHandoverDate)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {p.id && (
                      <div className="flex items-center gap-2 mt-4 pt-3 border-t flex-wrap">
                        <Button
                          size="sm"
                          className="h-8 text-xs gap-1.5 shadow-sm"
                          onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}`); }}
                          data-testid={`btn-open-project-${p.id}`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Project
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1.5"
                          onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=plan`); }}
                          data-testid={`btn-goto-plan-${p.id}`}
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                          Plan Tasks
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1.5"
                          onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=revenue`); }}
                          data-testid={`btn-goto-revenue-${p.id}`}
                        >
                          <DollarSign className="w-3.5 h-3.5" />
                          Revenue
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1.5"
                          onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=expenditure`); }}
                          data-testid={`btn-goto-expenditure-${p.id}`}
                        >
                          <Receipt className="w-3.5 h-3.5" />
                          Expenditure
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
