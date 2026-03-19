import React, { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ragBadgeClasses, severityStyle } from "@/lib/status-colors";
import {
  formatCurrencyCompact,
  formatDate,
} from "@/lib/execution-dashboard";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip,
  CartesianGrid,
} from "recharts";
import {
  Activity, AlertCircle, AlertTriangle, ChevronDown, ChevronUp,
  ExternalLink, TrendingUp, TrendingDown, DollarSign,
  Shield, FileWarning, Clock, Users, FolderOpen,
  ArrowRight, BarChart3, PieChart,
} from "lucide-react";
import { useExecutionData } from "./use-execution-data";

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

export default function OverviewPage() {
  const { kpis, filteredProjects, actionRows, openProject, ragDistribution, fyLabel } = useExecutionData();
  const [, setLocation] = useLocation();
  const [collapsedQueues, setCollapsedQueues] = useState<Set<string>>(new Set());

  const toggleQueue = (queue: string) => {
    setCollapsedQueues((prev) => {
      const next = new Set(prev);
      if (next.has(queue)) next.delete(queue); else next.add(queue);
      return next;
    });
  };

  const EXCLUDED_QUEUES = new Set(["Inflow at Risk", "Expenditure / COS at Risk"]);

  const filteredActionRows = useMemo(
    () => actionRows.filter((r) => !EXCLUDED_QUEUES.has(r.queue || "")),
    [actionRows],
  );

  const groupedActions = useMemo(() => {
    const groups: Record<string, typeof actionRows> = {};
    for (const row of filteredActionRows) {
      const key = row.queue || "Other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }
    return groups;
  }, [filteredActionRows]);

  // Top problem projects: sorted by criticalActionCount, showing red/amber first
  const topProblemProjects = useMemo(() => {
    return [...filteredProjects]
      .filter((p) => p.criticalActionCount > 0 || p.rag === "Red" || p.behindPlan || p.inflowRisk || p.outflowRisk)
      .sort((a, b) => {
        const ragOrder: Record<string, number> = { Red: 0, Amber: 1, Green: 2, Unknown: 3 };
        const ragDiff = (ragOrder[a.rag] ?? 3) - (ragOrder[b.rag] ?? 3);
        if (ragDiff !== 0) return ragDiff;
        return b.criticalActionCount - a.criticalActionCount;
      })
      .slice(0, 10);
  }, [filteredProjects]);

  // Phase distribution
  const phaseDistribution = useMemo(() => {
    const dist: Record<string, number> = {};
    for (const p of filteredProjects) {
      const phase = p.executionPhase || "Unassigned";
      dist[phase] = (dist[phase] || 0) + 1;
    }
    return Object.entries(dist).sort((a, b) => b[1] - a[1]);
  }, [filteredProjects]);

  return (
    <div className="space-y-5">
      {/* A. TOP KPI STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={<FolderOpen className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-100" label="Active Projects" value={kpis.activeDashboardProjects} />
        <KpiCard icon={<AlertCircle className="w-4 h-4 text-red-600" />} iconBg="bg-red-100" label="Projects Red" value={kpis.projectsRed} valueClass="text-red-600" />
        <KpiCard icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} iconBg="bg-amber-100" label="Projects Amber" value={kpis.projectsAmber} valueClass="text-amber-600" />
        <KpiCard icon={<Activity className="w-4 h-4 text-emerald-600" />} iconBg="bg-emerald-100" label="Projects Green" value={kpis.projectsGreen} valueClass="text-emerald-600" />
        <KpiCard icon={<Clock className="w-4 h-4 text-red-600" />} iconBg="bg-red-100" label="Behind Plan" value={kpis.projectsBehindPlan} valueClass="text-red-600" />
        <KpiCard icon={<Users className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-100" label="Pending Approvals" value={kpis.pendingApprovals} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} iconBg="bg-emerald-100" label={`Revenue (${fyLabel})`} value={formatCurrencyCompact(kpis.plannedRevenueFy)} sub={`Received: ${formatCurrencyCompact(kpis.receivedInflowFy)}`} />
        <KpiCard icon={<DollarSign className="w-4 h-4 text-amber-600" />} iconBg="bg-amber-100" label="Revenue Outstanding" value={formatCurrencyCompact(kpis.openInflowFy)} valueClass="text-amber-600" />
        <KpiCard icon={<TrendingDown className="w-4 h-4 text-orange-600" />} iconBg="bg-orange-100" label={`Expenditure (${fyLabel})`} value={formatCurrencyCompact(kpis.plannedExpenditureFy)} sub={`Paid: ${formatCurrencyCompact(kpis.paidExpenditureFy)}`} />
        <KpiCard icon={<DollarSign className="w-4 h-4 text-amber-600" />} iconBg="bg-amber-100" label="Expense Outstanding" value={formatCurrencyCompact(kpis.openExpenditureFy)} valueClass="text-amber-600" />
        <KpiCard icon={<BarChart3 className="w-4 h-4 text-emerald-600" />} iconBg="bg-emerald-100" label="Gross Profit" value={formatCurrencyCompact(kpis.grossProfitFy)} sub={`Margin: ${kpis.grossMarginPctFy ?? "—"}%`} />
        <KpiCard icon={<Shield className="w-4 h-4 text-violet-600" />} iconBg="bg-violet-100" label="Open Blockers" value={kpis.openEngineeringBlockers + kpis.openQualityWarnings} sub={`${kpis.openEngineeringBlockers} eng + ${kpis.openQualityWarnings} quality`} />
      </div>

      {/* B. OPERATIONAL EXCEPTION PANELS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Portfolio by Phase */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Portfolio by Phase</h3>
            <div className="space-y-2">
              {phaseDistribution.map(([phase, count]) => {
                const pct = Math.round((count / (filteredProjects.length || 1)) * 100);
                return (
                  <div key={phase}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="truncate font-medium">{phase}</span>
                      <span className="text-muted-foreground ml-2">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* RAG Distribution */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">RAG Distribution</h3>
            <div className="space-y-2">
              {Object.entries(ragDistribution).map(([rag, count]) => {
                const pct = Math.round((count / (filteredProjects.length || 1)) * 100);
                const colors: Record<string, string> = { Red: "bg-red-500", Amber: "bg-amber-500", Green: "bg-emerald-500", Unknown: "bg-slate-400" };
                return (
                  <div key={rag}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="font-medium">{rag}</span>
                      <span className="text-muted-foreground">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${colors[rag] || colors.Unknown}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Decision Queue */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Decision Queue</h3>
            {kpis.pendingApprovals === 0 ? (
              <p className="text-xs text-muted-foreground">No pending decisions</p>
            ) : (
              <div className="space-y-1.5">
                {actionRows
                  .filter((r) => r.queue?.toLowerCase().includes("approval"))
                  .slice(0, 5)
                  .map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs group cursor-pointer" onClick={() => setLocation(r.link)}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.severity === "critical" ? "bg-red-500" : "bg-amber-500"}`} />
                      <span className="truncate group-hover:text-emerald-600 transition-colors">{r.projectName}: {r.issueTitle}</span>
                    </div>
                  ))}
                {kpis.pendingApprovals > 5 && (
                  <p className="text-[10px] text-muted-foreground">+{kpis.pendingApprovals - 5} more</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cash / Exposure Alert */}
        <Card className="border-border/60">
          <CardContent className="p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Cash / Exposure Alerts</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Inflow Risk Projects</span>
                <span className={`font-medium ${kpis.inflowRiskProjects > 0 ? "text-red-600" : "text-emerald-600"}`}>{kpis.inflowRiskProjects}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Outflow Risk Projects</span>
                <span className={`font-medium ${kpis.outflowRiskProjects > 0 ? "text-red-600" : "text-emerald-600"}`}>{kpis.outflowRiskProjects}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Revenue Outstanding</span>
                <span className="font-medium text-amber-600">{formatCurrencyCompact(kpis.openInflowFy)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expense Outstanding</span>
                <span className="font-medium text-amber-600">{formatCurrencyCompact(kpis.openExpenditureFy)}</span>
              </div>
              <div className="flex justify-between border-t pt-1.5">
                <span className="text-muted-foreground">Margin Variance</span>
                <span className={`font-medium ${(kpis.marginVariancePct ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {kpis.marginVariancePct !== null ? `${kpis.marginVariancePct > 0 ? "+" : ""}${kpis.marginVariancePct}%` : "—"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* D. REALISATION KPIs SUMMARY */}
      <RealisationSummaryStrip />

      {/* Top Problem Projects panel */}
      {topProblemProjects.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <h3 className="text-sm font-semibold">Top Problem Projects</h3>
              <Badge variant="outline" className="text-xs">{topProblemProjects.length}</Badge>
            </div>
            <div className="rounded-lg border border-border/60 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Project</th>
                    <th className="text-left py-2 px-2 font-medium hidden sm:table-cell">PM</th>
                    <th className="text-center py-2 px-2 font-medium">RAG</th>
                    <th className="text-left py-2 px-2 font-medium hidden md:table-cell">Phase</th>
                    <th className="text-right py-2 px-2 font-medium hidden lg:table-cell">Margin</th>
                    <th className="text-center py-2 px-2 font-medium">Issues</th>
                    <th className="w-8 py-2 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {topProblemProjects.map((p) => (
                    <tr key={p.projectId} className="border-t border-border/40 hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => openProject(p)}>
                      <td className="py-2 px-3 font-medium truncate max-w-[200px]">{p.projectName}</td>
                      <td className="py-2 px-2 text-muted-foreground text-xs hidden sm:table-cell">{p.pm || "—"}</td>
                      <td className="py-2 px-2 text-center"><Badge className={`text-[10px] ${ragBadgeClasses(p.rag)}`}>{p.rag}</Badge></td>
                      <td className="py-2 px-2 text-muted-foreground text-xs hidden md:table-cell">{p.executionPhase || "—"}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs hidden lg:table-cell">{p.grossMarginPctFy === null ? "—" : `${p.grossMarginPctFy}%`}</td>
                      <td className="py-2 px-2 text-center">
                        {p.criticalActionCount > 0 ? (
                          <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{p.criticalActionCount}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="py-2 px-1 text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600" onClick={(e) => { e.stopPropagation(); openProject(p); }}>
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

      {/* C. ACTION CENTER */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <h2 className="text-base font-semibold">Action Center</h2>
              <Badge variant="outline" className="text-xs ml-1">{filteredActionRows.length} items</Badge>
            </div>
          </div>

          {filteredActionRows.length === 0 ? (
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
                const criticalCount = rows.filter((r) => r.severity?.toLowerCase() === "critical").length;
                return (
                  <div key={queue} className={`rounded-lg border border-l-4 overflow-hidden ${queueColor(queue)}`}>
                    <button
                      onClick={() => toggleQueue(queue)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/40 transition-colors"
                    >
                      {queueIcon(queue)}
                      <span className="text-sm font-semibold flex-1">{queue}</span>
                      <Badge variant="outline" className="text-[10px] font-medium">{rows.length} {rows.length === 1 ? "issue" : "issues"}</Badge>
                      {criticalCount > 0 && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{criticalCount} critical</Badge>}
                      {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
                    </button>
                    {!isCollapsed && (
                      <div className="bg-white/60 border-t overflow-x-auto">
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
                              const sev = severityStyle(r.severity);
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
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600" onClick={() => setLocation(r.link)}>
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
    </div>
  );
}

function KpiCard({ icon, iconBg, label, value, sub, valueClass }: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: React.ReactNode;
  sub?: string;
  valueClass?: string;
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

/* ── Realisation KPI Summary (fetches its own data) ──────────── */

interface RealisationPeriod {
  total: number; realised: number; unrealised: number; realisedPct: number;
  lineCount: number; realisedCount: number;
}
interface RealisationYTD extends RealisationPeriod { budget?: number; variance?: number; variancePct?: number; }
interface RealisationSeriesPoint { label: string; total: number; realised: number; unrealised: number; }

function fmtC(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R${(v / 1_000).toFixed(0)}K`;
  return `R${v.toFixed(0)}`;
}

function RealisationSummaryStrip() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<{
    fyLabel: string;
    cos: { thisMonth: RealisationPeriod; ytd: RealisationYTD; monthlySeries: RealisationSeriesPoint[] };
    cashflow: { thisMonth: RealisationPeriod; ytd: RealisationYTD; monthlySeries: RealisationSeriesPoint[] };
  } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch("/api/realisation-kpis", { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  const { cos, cashflow } = data;

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
            <PieChart className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Realisation Tracking</h3>
            <p className="text-[10px] text-muted-foreground">COS &amp; Cashflow realisation — {data.fyLabel}</p>
          </div>
        </div>
        <Button
          size="sm" variant="outline" className="text-xs gap-1"
          onClick={() => setLocation("/execution-board/finance")}
        >
          <BarChart3 className="w-3.5 h-3.5" /> View Detail
        </Button>
      </div>

      {/* COS + Cashflow KPI cards side by side */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* COS */}
        <KpiCard icon={<TrendingDown className="w-4 h-4 text-emerald-600" />} iconBg="bg-emerald-100" label="COS This Month" value={fmtC(cos.thisMonth.total)} sub={`${cos.thisMonth.realisedPct}% realised`} />
        <KpiCard icon={<TrendingDown className="w-4 h-4 text-emerald-600" />} iconBg="bg-emerald-100" label="COS YTD Realised" value={fmtC(cos.ytd.realised)} sub={`${cos.ytd.realisedPct}% of ${fmtC(cos.ytd.total)}`} />
        <KpiCard icon={<DollarSign className="w-4 h-4 text-amber-600" />} iconBg="bg-amber-100" label="COS YTD Unrealised" value={fmtC(cos.ytd.unrealised)} valueClass="text-amber-600" />
        <KpiCard
          icon={<BarChart3 className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-100"
          label="COS YTD Variance"
          value={cos.ytd.variancePct !== undefined ? `${cos.ytd.variancePct > 0 ? "+" : ""}${cos.ytd.variancePct}%` : "—"}
          sub={cos.ytd.variance !== undefined ? fmtC(cos.ytd.variance) : undefined}
          valueClass={(cos.ytd.variance ?? 0) > 0 ? "text-red-600" : "text-emerald-600"}
        />
        {/* Cashflow */}
        <KpiCard icon={<DollarSign className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-100" label="CF This Month" value={fmtC(cashflow.thisMonth.total)} sub={`${cashflow.thisMonth.realisedPct}% out of bank`} />
        <KpiCard icon={<DollarSign className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-100" label="CF YTD Out of Bank" value={fmtC(cashflow.ytd.realised)} sub={`${cashflow.ytd.realisedPct}% of ${fmtC(cashflow.ytd.total)}`} />
        <KpiCard icon={<DollarSign className="w-4 h-4 text-amber-600" />} iconBg="bg-amber-100" label="CF YTD Pending" value={fmtC(cashflow.ytd.unrealised)} valueClass="text-amber-600" />
        <KpiCard icon={<BarChart3 className="w-4 h-4 text-violet-600" />} iconBg="bg-violet-100" label="CF YTD Total" value={fmtC(cashflow.ytd.total)} sub={`${cashflow.ytd.lineCount} line items`} />
      </div>

      {/* Mini sparkline charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="border-border/60">
          <CardContent className="p-3">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">COS Realisation by Month</h4>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={cos.monthlySeries} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => fmtC(v)} width={50} />
                <Bar dataKey="realised" stackId="a" fill="#059669" />
                <Bar dataKey="unrealised" stackId="a" fill="#fbbf24" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-3">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Cashflow Realisation by Month</h4>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={cashflow.monthlySeries} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => fmtC(v)} width={50} />
                <Bar dataKey="realised" stackId="a" fill="#2563eb" />
                <Bar dataKey="unrealised" stackId="a" fill="#93c5fd" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
