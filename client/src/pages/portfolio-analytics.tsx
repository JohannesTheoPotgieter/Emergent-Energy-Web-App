/**
 * D5: Portfolio Analytics — revenue vs target, margin trends, phase distribution,
 * VO exposure, and resource allocation overview.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import {
  BarChart3, TrendingUp, DollarSign, PieChart, AlertTriangle,
  Users, Activity, Zap, Download,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ProjectSummary {
  project_name: string;
  phase: string | null;
  pm: string | null;
  rag_status: string | null;
  total_contract_revenue: number | null;
  actual_revenue: number | null;
  total_expenses: number | null;
  actual_expenses: number | null;
  gp_percent: number | null;
  current_vo_total: number | null;
  project_pct_complete: number | null;
  expected_pct_complete: number | null;
  is_active: boolean;
  has_tracker_import: boolean;
}

function money(v: number | null | undefined): string {
  if (!v || !Number.isFinite(v)) return "R 0";
  if (Math.abs(v) >= 1_000_000) return `R ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R ${(v / 1_000).toFixed(0)}K`;
  return `R ${v.toFixed(0)}`;
}

function pct(v: number | null | undefined): string {
  if (!v || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

const RAG_COLORS: Record<string, string> = {
  Green: "bg-green-500",
  Amber: "bg-amber-500",
  Red: "bg-red-500",
};

const PHASE_COLORS: Record<string, string> = {
  "Planning": "bg-blue-500",
  "Construction": "bg-amber-500",
  "QA": "bg-orange-500",
  "Handover": "bg-teal-500",
  "DLP": "bg-indigo-500",
  "Financial Close": "bg-purple-500",
  "Commercial Close Out": "bg-emerald-500",
  "Compliance Handover": "bg-cyan-500",
  "Hold": "bg-rose-500",
};

export default function PortfolioAnalyticsPage() {
  const { data: projects = [], isLoading } = useQuery<ProjectSummary[]>({
    queryKey: ["/api/projects-summary"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/projects-summary");
      return res.json();
    },
  });

  const active = useMemo(() => projects.filter(p => p.is_active && p.has_tracker_import), [projects]);

  // Phase distribution
  const phaseDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    active.forEach(p => {
      const phase = p.phase || "Unknown";
      counts[phase] = (counts[phase] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([phase, count]) => ({ phase, count, pct: active.length ? count / active.length : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [active]);

  // RAG distribution
  const ragDistribution = useMemo(() => {
    const counts: Record<string, number> = { Green: 0, Amber: 0, Red: 0 };
    active.forEach(p => {
      const rag = p.rag_status || "Green";
      counts[rag] = (counts[rag] || 0) + 1;
    });
    return counts;
  }, [active]);

  // Financial aggregates
  const financials = useMemo(() => {
    let totalContractRevenue = 0;
    let totalActualRevenue = 0;
    let totalExpenses = 0;
    let totalActualExpenses = 0;
    let totalVo = 0;
    let projectsWithVo = 0;

    active.forEach(p => {
      totalContractRevenue += p.total_contract_revenue || 0;
      totalActualRevenue += p.actual_revenue || 0;
      totalExpenses += p.total_expenses || 0;
      totalActualExpenses += p.actual_expenses || 0;
      if (p.current_vo_total && p.current_vo_total !== 0) {
        totalVo += p.current_vo_total;
        projectsWithVo++;
      }
    });

    const portfolioMargin = totalActualRevenue > 0
      ? (totalActualRevenue - totalActualExpenses) / totalActualRevenue
      : 0;

    return {
      totalContractRevenue,
      totalActualRevenue,
      totalExpenses,
      totalActualExpenses,
      totalVo,
      projectsWithVo,
      portfolioMargin,
      revenueRealisedPct: totalContractRevenue > 0 ? totalActualRevenue / totalContractRevenue : 0,
    };
  }, [active]);

  // PM workload
  const pmWorkload = useMemo(() => {
    const counts: Record<string, number> = {};
    active.forEach(p => {
      const pm = p.pm || "Unassigned";
      counts[pm] = (counts[pm] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([pm, count]) => ({ pm, count }))
      .sort((a, b) => b.count - a.count);
  }, [active]);

  // Projects behind plan
  const behindPlan = useMemo(() =>
    active.filter(p => {
      const actual = p.project_pct_complete ?? 0;
      const expected = p.expected_pct_complete ?? 0;
      return expected > 0 && (actual - expected) < -0.1;
    }),
  [active]);

  // Top VO exposure
  const topVo = useMemo(() =>
    active
      .filter(p => p.current_vo_total && p.current_vo_total !== 0)
      .sort((a, b) => Math.abs(b.current_vo_total || 0) - Math.abs(a.current_vo_total || 0))
      .slice(0, 8),
  [active]);

  if (isLoading) return <PageSkeleton />;

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-portfolio-analytics">
      <SectionHeader
        icon={<BarChart3 className="h-5 w-5" />}
        eyebrow="Reports"
        title="Portfolio Analytics"
        description={`${active.length} active projects across the portfolio`}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              const token = localStorage.getItem("auth_token");
              const headers: Record<string, string> = {};
              if (token) headers["Authorization"] = `Bearer ${token}`;
              fetch("/api/reports/board-pack", { credentials: "include", headers })
                .then(res => res.blob())
                .then(blob => {
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `board-pack-${new Date().toISOString().slice(0, 10)}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                });
            }}
          >
            <Download className="h-4 w-4" /> Board Pack PDF
          </Button>
        }
      />

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1">Contract Revenue</div>
            <div className="text-lg font-bold">{money(financials.totalContractRevenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1">Actual Revenue</div>
            <div className="text-lg font-bold text-emerald-600">{money(financials.totalActualRevenue)}</div>
            <div className="text-[10px] text-muted-foreground">{pct(financials.revenueRealisedPct)} realised</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1">Actual Expenses</div>
            <div className="text-lg font-bold text-orange-600">{money(financials.totalActualExpenses)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1">Portfolio Margin</div>
            <div className={`text-lg font-bold ${financials.portfolioMargin >= 0.15 ? "text-emerald-600" : financials.portfolioMargin >= 0.05 ? "text-amber-600" : "text-red-600"}`}>
              {pct(financials.portfolioMargin)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1">VO Exposure</div>
            <div className="text-lg font-bold text-amber-600">{money(financials.totalVo)}</div>
            <div className="text-[10px] text-muted-foreground">{financials.projectsWithVo} projects</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1">Behind Plan</div>
            <div className={`text-lg font-bold ${behindPlan.length > 0 ? "text-red-600" : "text-emerald-600"}`}>
              {behindPlan.length}
            </div>
            <div className="text-[10px] text-muted-foreground">of {active.length} projects</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Phase Distribution */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <PieChart className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Phase Distribution</h3>
            </div>
            <div className="space-y-2">
              {phaseDistribution.map(({ phase, count, pct }) => (
                <div key={phase} className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${PHASE_COLORS[phase] || "bg-slate-400"}`} />
                  <span className="text-xs flex-1 truncate">{phase}</span>
                  <span className="text-xs font-medium">{count}</span>
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${PHASE_COLORS[phase] || "bg-slate-400"}`} style={{ width: `${pct * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* RAG Distribution */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">RAG Status</h3>
            </div>
            <div className="flex items-center gap-4 mb-3">
              {Object.entries(ragDistribution).map(([rag, count]) => (
                <div key={rag} className="flex items-center gap-1.5">
                  <div className={`w-3 h-3 rounded-full ${RAG_COLORS[rag] || "bg-slate-400"}`} />
                  <span className="text-xl font-bold">{count}</span>
                  <span className="text-xs text-muted-foreground">{rag}</span>
                </div>
              ))}
            </div>
            {/* Stacked bar */}
            <div className="flex h-4 rounded-full overflow-hidden">
              {active.length > 0 && (
                <>
                  <div className="bg-green-500" style={{ width: `${(ragDistribution.Green / active.length) * 100}%` }} />
                  <div className="bg-amber-500" style={{ width: `${(ragDistribution.Amber / active.length) * 100}%` }} />
                  <div className="bg-red-500" style={{ width: `${(ragDistribution.Red / active.length) * 100}%` }} />
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* PM Workload */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">PM Workload</h3>
            </div>
            <div className="space-y-1.5">
              {pmWorkload.slice(0, 8).map(({ pm, count }) => (
                <div key={pm} className="flex items-center gap-2">
                  <span className="text-xs flex-1 truncate">{pm}</span>
                  <Badge variant="secondary" className="text-[10px]">{count} projects</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* VO Exposure Table */}
      {topVo.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold">VO Exposure — Top Projects</h3>
            </div>
            <div className="space-y-1.5">
              {topVo.map(p => (
                <div key={p.project_name} className="flex items-center gap-3 text-sm">
                  <span className="flex-1 truncate font-medium">{p.project_name.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted-foreground">{p.phase}</span>
                  <span className={`font-mono text-xs font-medium ${(p.current_vo_total || 0) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {money(p.current_vo_total)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Behind Plan Projects */}
      {behindPlan.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-red-500" />
              <h3 className="text-sm font-semibold">Projects Behind Plan</h3>
            </div>
            <div className="space-y-1.5">
              {behindPlan.slice(0, 10).map(p => {
                const delta = (p.project_pct_complete ?? 0) - (p.expected_pct_complete ?? 0);
                return (
                  <div key={p.project_name} className="flex items-center gap-3 text-sm">
                    <div className={`w-2 h-2 rounded-full ${RAG_COLORS[p.rag_status || ""] || "bg-slate-400"}`} />
                    <span className="flex-1 truncate">{p.project_name.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{p.pm}</span>
                    <span className="text-xs font-mono text-red-600">{(delta * 100).toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
