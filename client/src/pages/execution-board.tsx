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
  Building2, ArrowRight, ClipboardList, Receipt,
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

function ragColor(rag: string | null): string {
  if (!rag) return "bg-slate-100 text-slate-500 border-slate-200";
  const colors: Record<string, string> = {
    Green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Amber: "bg-amber-50 text-amber-700 border-amber-200",
    Red: "bg-red-50 text-red-700 border-red-200",
  };
  return colors[rag] || "bg-slate-50 text-slate-600 border-slate-200";
}

function progressBarColor(pct: number, expected: number | null): string {
  if (expected !== null && pct < expected - 10) return "bg-red-500";
  if (expected !== null && pct < expected - 5) return "bg-amber-500";
  if (pct >= 90) return "bg-emerald-500";
  if (pct >= 60) return "bg-blue-500";
  return "bg-blue-400";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
}

function ScheduleHealthBadge({ actual, expected }: { actual: number | null; expected: number | null }) {
  if (actual === null) return <Badge variant="outline" className="text-[9px] text-slate-400">No plan</Badge>;
  const diff = expected !== null ? Math.round((actual - expected) * 100) : null;
  if (diff === null) return <Badge variant="outline" className="text-[9px]">{Math.round(actual * 100)}%</Badge>;
  if (diff >= 0) {
    return (
      <Badge className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200 gap-0.5">
        <TrendingUp className="w-2.5 h-2.5" />+{diff}%
      </Badge>
    );
  }
  return (
    <Badge className="text-[9px] bg-red-50 text-red-700 border-red-200 gap-0.5">
      <TrendingDown className="w-2.5 h-2.5" />{diff}%
    </Badge>
  );
}

function ProgressBar({ value, max, color, expected, height = "h-2" }: {
  value: number; max: number; color: string; expected?: number | null; height?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={`w-full ${height} bg-slate-100 rounded-full overflow-hidden relative`}>
      {expected !== undefined && expected !== null && (
        <div className="absolute top-0 h-full bg-slate-300/40 rounded-full" style={{ width: `${Math.min(expected, 100)}%` }} />
      )}
      <div className={`relative h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
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
      <div className="flex items-center justify-center py-20" data-testid="execution-board-loading">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="execution-board-error">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-red-600">{error}</p>
        <Button variant="outline" size="sm" onClick={loadData} data-testid="btn-retry">Retry</Button>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to view this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-[1400px] mx-auto" data-testid="execution-board-page">
      <div className="flex items-start sm:items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold tracking-tight" data-testid="text-execution-title">Execution Dashboard</h1>
          <p className="text-muted-foreground text-xs sm:text-sm">Plan progress & financial health across active projects</p>
        </div>
        <Badge variant="outline" className="text-xs font-medium px-2.5 py-1">
          {stats.total} active project{stats.total !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3">
        <Card className="border-l-4 border-l-blue-500" data-testid="stat-avg-completion">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Target className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Avg Completion</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{stats.avgCompletion}%</div>
            <ProgressBar value={stats.avgCompletion} max={100} color="bg-blue-500" height="h-1.5" />
          </CardContent>
        </Card>

        <Card className={`border-l-4 ${stats.behindSchedule > 0 ? "border-l-red-500" : "border-l-emerald-500"}`} data-testid="stat-schedule-health">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <BarChart3 className={`w-3.5 h-3.5 ${stats.behindSchedule > 0 ? "text-red-600" : "text-emerald-600"}`} />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Schedule</span>
            </div>
            <div className={`text-xl sm:text-2xl font-bold ${stats.behindSchedule > 0 ? "text-red-600" : "text-emerald-600"}`}>
              {stats.behindSchedule > 0 ? `${stats.behindSchedule} behind` : "On track"}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {stats.total - stats.behindSchedule}/{stats.total} on schedule
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500" data-testid="stat-revenue">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Revenue</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{formatCurrency(stats.totalRevenue)}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <ProgressBar value={stats.totalReceived} max={stats.totalRevenue} color="bg-emerald-500" height="h-1" />
              <span className="text-[9px] text-muted-foreground whitespace-nowrap shrink-0">{formatCurrency(stats.totalReceived)} in</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500" data-testid="stat-costs">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Receipt className="w-3.5 h-3.5 text-orange-600" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Costs</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{formatCurrency(stats.totalCost)}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <ProgressBar value={stats.totalPaid} max={stats.totalCost} color="bg-orange-500" height="h-1" />
              <span className="text-[9px] text-muted-foreground whitespace-nowrap shrink-0">{formatCurrency(stats.totalPaid)} paid</span>
            </div>
          </CardContent>
        </Card>

        <Card className={`border-l-4 col-span-2 lg:col-span-1 ${(stats.overallGP ?? 0) >= 20 ? "border-l-emerald-500" : (stats.overallGP ?? 0) >= 0 ? "border-l-amber-500" : "border-l-red-500"}`} data-testid="stat-gp">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp className={`w-3.5 h-3.5 ${(stats.overallGP ?? 0) >= 20 ? "text-emerald-600" : (stats.overallGP ?? 0) >= 0 ? "text-amber-600" : "text-red-600"}`} />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Overall GP%</span>
            </div>
            <div className={`text-xl sm:text-2xl font-bold ${(stats.overallGP ?? 0) >= 20 ? "text-emerald-600" : (stats.overallGP ?? 0) >= 0 ? "text-amber-600" : "text-red-600"}`}>
              {stats.overallGP !== null ? `${stats.overallGP}%` : "—"}
            </div>
            <p className="text-[9px] text-muted-foreground">Contract: {formatCurrency(stats.totalContractValue)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search projects..."
            className="pl-8 h-8 text-sm"
            data-testid="input-search-execution"
          />
        </div>
        <Select value={phaseFilter} onValueChange={setPhaseFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-trigger-phase-filter">
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
        <span className="ml-auto text-[10px] text-muted-foreground" data-testid="text-filtered-count">
          Showing {filtered.length} of {executionProjects.length}
        </span>
      </div>

      {executionProjects.length === 0 ? (
        <Card data-testid="empty-state">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Building2 className="w-10 h-10 text-slate-300" />
            <p className="text-sm text-muted-foreground text-center max-w-md">
              No projects in execution yet. Projects require signed evidence and admin approval to enter execution.
            </p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-2">
            <Search className="w-8 h-8 text-slate-300" />
            <p className="text-sm text-muted-foreground">No projects match your filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="execution-projects-list">
          {filtered.map((p) => {
            const actualPct = p.projectPctComplete !== null ? Math.round(p.projectPctComplete * 100) : null;
            const expectedPct = p.expectedPctComplete !== null ? Math.round(p.expectedPctComplete * 100) : null;
            const isExpanded = expandedId === p.id;
            const contractVal = parseFloat(p.contractValue || "0") || 0;
            const revenueCollectedPct = p.totalRevenue > 0 ? Math.round((p.receivedRevenue / p.totalRevenue) * 100) : 0;
            const costPaidPct = p.totalCost > 0 ? Math.round((p.paidCost / p.totalCost) * 100) : 0;
            const scheduleDiff = (actualPct !== null && expectedPct !== null) ? actualPct - expectedPct : null;

            return (
              <Card
                key={p.id ?? p.projectName}
                className={`overflow-hidden transition-all duration-200 ${isExpanded ? "ring-1 ring-blue-300 shadow-md" : "hover:shadow-sm"}`}
                data-testid={`card-project-${p.id}`}
              >
                <div
                  className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 cursor-pointer group"
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-0.5">
                      <button
                        className="font-semibold text-sm truncate hover:text-blue-600 hover:underline transition-colors text-left"
                        onClick={(e) => { e.stopPropagation(); if (p.id) setLocation(`/projects/${p.id}`); }}
                        data-testid={`link-name-${p.id}`}
                      >
                        {cleanProjectName(p.projectName)}
                      </button>
                      <Badge className={`text-[8px] px-1 py-0 shrink-0 border ${ragColor(p.ragStatus)}`}>
                        {p.ragStatus || "—"}
                      </Badge>
                      {p.executionPhase && (
                        <Badge variant="secondary" className="text-[8px] px-1 py-0 shrink-0 hidden sm:inline-flex">
                          {p.executionPhase}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      {p.pm && <span className="truncate max-w-[100px]">{p.pm}</span>}
                      {p.sizeKwp && <span>{p.sizeKwp} kWp</span>}
                      {contractVal > 0 && <span className="hidden sm:inline">{formatCurrency(contractVal)}</span>}
                    </div>
                  </div>

                  <div className="hidden md:flex items-center gap-3 shrink-0">
                    {actualPct !== null && (
                      <div className="flex items-center gap-2 w-[140px]">
                        <div className="flex-1">
                          <ProgressBar value={actualPct} max={100} color={progressBarColor(actualPct, expectedPct)} expected={expectedPct} height="h-2" />
                        </div>
                        <span className="text-xs font-bold tabular-nums w-[32px] text-right">{actualPct}%</span>
                      </div>
                    )}
                    <ScheduleHealthBadge actual={p.projectPctComplete} expected={p.expectedPctComplete} />
                  </div>

                  <div className="hidden lg:flex items-center gap-3 shrink-0 text-[10px]">
                    {p.totalRevenue > 0 && (
                      <div className="flex items-center gap-1 text-emerald-600">
                        <DollarSign className="w-3 h-3" />
                        <span className="font-medium">{formatCurrency(p.receivedRevenue)}/{formatCurrency(p.totalRevenue)}</span>
                      </div>
                    )}
                    {p.gpPct !== null && (
                      <span className={`font-bold ${p.gpPct >= 20 ? "text-emerald-600" : p.gpPct >= 0 ? "text-amber-600" : "text-red-600"}`}>
                        GP {p.gpPct}%
                      </span>
                    )}
                  </div>

                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
                  )}
                </div>

                {isExpanded && (
                  <div className="border-t bg-muted/30 px-3 sm:px-4 py-3 sm:py-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                      <div className="rounded-lg bg-background border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Plan Progress</span>
                          {p.id && (
                            <button
                              className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-0.5"
                              onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=plan`); }}
                              data-testid={`btn-view-plan-${p.id}`}
                            >
                              View <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                        {actualPct !== null ? (
                          <>
                            <div className="flex items-baseline gap-1">
                              <span className="text-2xl font-bold">{actualPct}%</span>
                              {expectedPct !== null && (
                                <span className="text-[10px] text-muted-foreground">/ {expectedPct}% expected</span>
                              )}
                            </div>
                            <ProgressBar value={actualPct} max={100} color={progressBarColor(actualPct, expectedPct)} expected={expectedPct} height="h-2.5" />
                            {scheduleDiff !== null && (
                              <div className={`text-[10px] font-medium flex items-center gap-0.5 ${scheduleDiff >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {scheduleDiff >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                {scheduleDiff >= 0 ? `${scheduleDiff}% ahead` : `${Math.abs(scheduleDiff)}% behind`}
                              </div>
                            )}
                            <p className="text-[10px] text-muted-foreground">{p.planTotal} plan tasks</p>
                          </>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No plan imported</p>
                        )}
                      </div>

                      <div className="rounded-lg bg-background border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Revenue</span>
                          {p.id && (
                            <button
                              className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-0.5"
                              onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=revenue`); }}
                              data-testid={`btn-view-revenue-${p.id}`}
                            >
                              View <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                        {p.totalRevenue > 0 ? (
                          <>
                            <div className="flex items-baseline gap-1">
                              <span className="text-2xl font-bold">{formatCurrency(p.totalRevenue)}</span>
                              <span className="text-[10px] text-muted-foreground">costed</span>
                            </div>
                            <ProgressBar value={p.receivedRevenue} max={p.totalRevenue} color="bg-emerald-500" height="h-2.5" />
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>Invoiced: {formatCurrency(p.invoicedRevenue)}</span>
                              <span className="font-medium text-emerald-600">{revenueCollectedPct}% received</span>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No revenue data</p>
                        )}
                      </div>

                      <div className="rounded-lg bg-background border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Expenditure</span>
                          {p.id && (
                            <button
                              className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-0.5"
                              onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=expenditure`); }}
                              data-testid={`btn-view-costs-${p.id}`}
                            >
                              View <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                        {p.totalCost > 0 ? (
                          <>
                            <div className="flex items-baseline gap-1">
                              <span className="text-2xl font-bold">{formatCurrency(p.totalCost)}</span>
                              <span className="text-[10px] text-muted-foreground">costed</span>
                            </div>
                            <ProgressBar value={p.paidCost} max={p.totalCost} color="bg-orange-500" height="h-2.5" />
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>Invoiced: {formatCurrency(p.invoicedCost)}</span>
                              <span className="font-medium text-orange-600">{costPaidPct}% paid</span>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No cost data</p>
                        )}
                      </div>

                      <div className="rounded-lg bg-background border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">GP% & Dates</span>
                          {p.id && (
                            <button
                              className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-0.5"
                              onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}`); }}
                              data-testid={`btn-view-project-${p.id}`}
                            >
                              Detail <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                        {p.gpPct !== null ? (
                          <div className="flex items-baseline gap-1">
                            <span className={`text-2xl font-bold ${p.gpPct >= 20 ? "text-emerald-600" : p.gpPct >= 0 ? "text-amber-600" : "text-red-600"}`}>
                              {p.gpPct}%
                            </span>
                            {contractVal > 0 && <span className="text-[10px] text-muted-foreground">of {formatCurrency(contractVal)}</span>}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No financial data</p>
                        )}
                        <div className="space-y-1 text-[10px] text-muted-foreground">
                          {p.constructionStartDate && (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-blue-500" />
                              <span>Construction: {formatDate(p.constructionStartDate)}</span>
                            </div>
                          )}
                          {p.commissioningDate && (
                            <div className="flex items-center gap-1">
                              <Zap className="w-3 h-3 text-amber-500" />
                              <span>Commissioning: {formatDate(p.commissioningDate)}</span>
                            </div>
                          )}
                          {p.clientHandoverDate && (
                            <div className="flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              <span>Handover: {formatDate(p.clientHandoverDate)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {p.id && (
                      <div className="flex items-center gap-2 pt-1 flex-wrap border-t pt-3">
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}`); }}
                          data-testid={`btn-open-project-${p.id}`}
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open Project
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=plan`); }}
                          data-testid={`btn-goto-plan-${p.id}`}
                        >
                          <ClipboardList className="w-3 h-3" />
                          Plan Tasks
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=revenue`); }}
                          data-testid={`btn-goto-revenue-${p.id}`}
                        >
                          <DollarSign className="w-3 h-3" />
                          Revenue
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=expenditure`); }}
                          data-testid={`btn-goto-expenditure-${p.id}`}
                        >
                          <Receipt className="w-3 h-3" />
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
