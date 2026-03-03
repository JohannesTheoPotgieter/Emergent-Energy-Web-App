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
  Loader2, Search, Zap, AlertCircle, CheckCircle2, Info, AlertTriangle,
  ArrowRight, TrendingUp, TrendingDown, DollarSign, BarChart3,
  Calendar, ChevronDown, ChevronUp, ExternalLink, Target,
  Building2, Percent, ArrowUpRight,
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

function ScheduleHealth({ actual, expected }: { actual: number | null; expected: number | null }) {
  if (actual === null) return <span className="text-[10px] text-slate-400">No plan data</span>;
  const diff = expected !== null ? Math.round((actual - expected) * 100) : null;
  if (diff === null) return <span className="text-[10px] text-slate-500">{Math.round(actual * 100)}%</span>;
  if (diff >= 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium">
        <TrendingUp className="w-3 h-3" />+{diff}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-red-600 font-medium">
      <TrendingDown className="w-3 h-3" />{diff}%
    </span>
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

    const behindSchedule = projects.filter(p => {
      if (p.projectPctComplete === null || p.expectedPctComplete === null) return false;
      return p.projectPctComplete < p.expectedPctComplete - 0.05;
    }).length;

    return { avgCompletion, totalContractValue, totalRevenue, totalReceived, totalCost, totalPaid, behindSchedule, total: projects.length };
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
    <div className="space-y-5" data-testid="execution-board-page">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight" data-testid="text-execution-title">Execution Dashboard</h1>
          <p className="text-muted-foreground text-xs sm:text-sm">Project plan progress and financial overview</p>
        </div>
        <Badge variant="outline" className="text-xs">
          {stats.total} active project{stats.total !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="overflow-hidden" data-testid="stat-avg-completion">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-blue-50"><Target className="w-3.5 h-3.5 text-blue-600" /></div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Avg Completion</span>
            </div>
            <div className="text-2xl font-bold">{stats.avgCompletion}%</div>
            <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${stats.avgCompletion}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden" data-testid="stat-schedule-health">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg ${stats.behindSchedule > 0 ? "bg-red-50" : "bg-emerald-50"}`}>
                <BarChart3 className={`w-3.5 h-3.5 ${stats.behindSchedule > 0 ? "text-red-600" : "text-emerald-600"}`} />
              </div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Schedule</span>
            </div>
            <div className={`text-2xl font-bold ${stats.behindSchedule > 0 ? "text-red-600" : "text-emerald-600"}`}>
              {stats.behindSchedule > 0 ? `${stats.behindSchedule} behind` : "On track"}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {stats.total - stats.behindSchedule} project{stats.total - stats.behindSchedule !== 1 ? "s" : ""} on schedule
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden" data-testid="stat-revenue">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-emerald-50"><DollarSign className="w-3.5 h-3.5 text-emerald-600" /></div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Revenue</span>
            </div>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalRevenue)}</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {formatCurrency(stats.totalReceived)} received
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden" data-testid="stat-costs">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-orange-50"><TrendingUp className="w-3.5 h-3.5 text-orange-600" /></div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Costs</span>
            </div>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalCost)}</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {formatCurrency(stats.totalPaid)} paid
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search projects..."
            className="pl-9 h-9"
            data-testid="input-search-execution"
          />
        </div>
        <Select value={phaseFilter} onValueChange={setPhaseFilter}>
          <SelectTrigger className="w-[180px] h-9" data-testid="select-trigger-phase-filter">
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
        <span className="ml-auto text-xs text-muted-foreground" data-testid="text-filtered-count">
          {filtered.length} of {executionProjects.length}
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

            return (
              <Card
                key={p.id ?? p.projectName}
                className={`overflow-hidden transition-all ${isExpanded ? "ring-1 ring-blue-200" : "hover:shadow-sm"}`}
                data-testid={`card-project-${p.id}`}
              >
                <div
                  className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm truncate" data-testid={`text-name-${p.id}`}>
                        {cleanProjectName(p.projectName)}
                      </span>
                      <Badge className={`text-[9px] px-1.5 py-0 shrink-0 ${ragColor(p.ragStatus)}`}>
                        {p.ragStatus || "—"}
                      </Badge>
                      {p.executionPhase && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 hidden sm:inline-flex">
                          {p.executionPhase}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      {p.pm && <span>{p.pm}</span>}
                      {p.planTotal > 0 && <span>{p.planTotal} plan tasks</span>}
                      {contractVal > 0 && <span>{formatCurrency(contractVal)}</span>}
                    </div>
                  </div>

                  <div className="hidden sm:flex items-center gap-4 shrink-0">
                    {actualPct !== null && (
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden relative">
                          {expectedPct !== null && (
                            <div
                              className="absolute top-0 h-full bg-slate-300/40 rounded-full"
                              style={{ width: `${Math.min(expectedPct, 100)}%` }}
                            />
                          )}
                          <div
                            className={`relative h-full rounded-full transition-all ${progressBarColor(actualPct, expectedPct)}`}
                            style={{ width: `${Math.min(actualPct, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium w-[32px] text-right">{actualPct}%</span>
                      </div>
                    )}
                    <ScheduleHealth actual={p.projectPctComplete} expected={p.expectedPctComplete} />
                  </div>

                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </div>

                {isExpanded && (
                  <div className="border-t bg-slate-50/50 px-3 sm:px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Plan Progress</p>
                        {actualPct !== null ? (
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2.5 bg-slate-200 rounded-full overflow-hidden relative">
                                {expectedPct !== null && (
                                  <div className="absolute top-0 h-full bg-slate-300/50 rounded-full" style={{ width: `${Math.min(expectedPct, 100)}%` }} />
                                )}
                                <div className={`relative h-full rounded-full ${progressBarColor(actualPct, expectedPct)}`} style={{ width: `${Math.min(actualPct, 100)}%` }} />
                              </div>
                              <span className="text-sm font-bold">{actualPct}%</span>
                            </div>
                            {expectedPct !== null && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">Expected: {expectedPct}%</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">No plan imported</p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Revenue</p>
                        {p.totalRevenue > 0 ? (
                          <div>
                            <p className="text-sm font-bold">{formatCurrency(p.totalRevenue)}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${revenueCollectedPct}%` }} />
                              </div>
                              <span className="text-[10px] text-muted-foreground">{revenueCollectedPct}% received</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">No revenue data</p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Costs</p>
                        {p.totalCost > 0 ? (
                          <div>
                            <p className="text-sm font-bold">{formatCurrency(p.totalCost)}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                <div className="h-full bg-orange-500 rounded-full" style={{ width: `${costPaidPct}%` }} />
                              </div>
                              <span className="text-[10px] text-muted-foreground">{costPaidPct}% paid</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">No cost data</p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">GP%</p>
                        {p.gpPct !== null ? (
                          <div>
                            <p className={`text-sm font-bold ${p.gpPct >= 20 ? "text-emerald-600" : p.gpPct >= 0 ? "text-amber-600" : "text-red-600"}`}>
                              {p.gpPct}%
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {contractVal > 0 ? `Contract: ${formatCurrency(contractVal)}` : ""}
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">No data</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[10px]">
                      {p.constructionStartDate && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          <span>Construction: {new Date(p.constructionStartDate).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" })}</span>
                        </div>
                      )}
                      {p.commissioningDate && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Zap className="w-3 h-3 text-amber-500" />
                          <span>Commissioning: {new Date(p.commissioningDate).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" })}</span>
                        </div>
                      )}
                      {p.clientHandoverDate && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          <span>Handover: {new Date(p.clientHandoverDate).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" })}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      {p.id && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs gap-1"
                            onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}`); }}
                            data-testid={`btn-view-project-${p.id}`}
                          >
                            <ExternalLink className="w-3 h-3" />
                            Project Detail
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=plan`); }}
                            data-testid={`btn-view-plan-${p.id}`}
                          >
                            <Target className="w-3 h-3" />
                            Plan Tasks
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=revenue`); }}
                            data-testid={`btn-view-revenue-${p.id}`}
                          >
                            <DollarSign className="w-3 h-3" />
                            Revenue
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={(e) => { e.stopPropagation(); setLocation(`/projects/${p.id}?tab=expenditure`); }}
                            data-testid={`btn-view-costs-${p.id}`}
                          >
                            <BarChart3 className="w-3 h-3" />
                            Expenditure
                          </Button>
                        </>
                      )}
                    </div>
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
