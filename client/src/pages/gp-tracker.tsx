import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Line,
} from "recharts";
import {
  DollarSign, TrendingUp, Activity, Percent, Search,
  Target, ChevronDown, ChevronRight,
} from "lucide-react";
import { useLocation } from "wouter";
import { EnergyLoader } from "@/components/ui/energy-loader";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatRand(val: number | null | undefined): string {
  if (val == null) return "R 0";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `R ${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `R ${(val / 1_000).toFixed(1)}K`;
  return `R ${val.toFixed(0)}`;
}

function formatPercent(val: number | null | undefined): string {
  if (val == null) return "0%";
  return `${val.toFixed(1)}%`;
}

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <Card data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Icon className={`h-3.5 w-3.5 ${color || ""}`} /> {label}
        </div>
        <p className="text-xl font-bold">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

const ROW_DEFS: {
  key: string; label: string; dataKey: string;
  colorClass: string; group: "monthly" | "ytd";
  colorCoded?: boolean;
}[] = [
  { key: "totalRevenue", label: "Revenue (Actual)", dataKey: "totalRevenue", colorClass: "text-blue-600 font-semibold", group: "monthly" },
  { key: "totalCOS", label: "COS (Actual)", dataKey: "totalCOS", colorClass: "text-red-600 font-semibold", group: "monthly" },
  { key: "totalGP", label: "GP (Actual)", dataKey: "totalGP", colorClass: "text-foreground font-bold", group: "monthly" },
  { key: "realisedGP", label: "Realised GP", dataKey: "realisedGP", colorClass: "text-emerald-600 font-semibold", group: "monthly" },
  { key: "unrealisedGP", label: "Unrealised GP", dataKey: "unrealisedGP", colorClass: "text-red-600 font-semibold", group: "monthly" },
  { key: "revBudget", label: "Revenue Budget", dataKey: "revBudget", colorClass: "text-blue-400", group: "monthly" },
  { key: "cosBudget", label: "COS Budget", dataKey: "cosBudget", colorClass: "text-red-400", group: "monthly" },
  { key: "budget", label: "GP Budget (Rev - COS)", dataKey: "budget", colorClass: "text-purple-600 font-semibold", group: "monthly" },
  { key: "variance", label: "Variance", dataKey: "variance", colorClass: "", group: "monthly", colorCoded: true },
  { key: "variancePct", label: "Variance %", dataKey: "variancePct", colorClass: "", group: "monthly", colorCoded: true },
  { key: "gpPct", label: "GP %", dataKey: "gpPct", colorClass: "text-foreground font-semibold", group: "monthly" },
  { key: "ytdGP", label: "YTD GP", dataKey: "ytdGP", colorClass: "text-foreground font-bold", group: "ytd" },
  { key: "ytdBudget", label: "YTD Budget", dataKey: "ytdBudget", colorClass: "text-purple-600", group: "ytd" },
  { key: "ytdVariance", label: "YTD Variance", dataKey: "ytdVariance", colorClass: "", group: "ytd", colorCoded: true },
  { key: "ytdVariancePct", label: "YTD Var %", dataKey: "ytdVariancePct", colorClass: "", group: "ytd", colorCoded: true },
  { key: "ytdGpPct", label: "YTD GP %", dataKey: "ytdGpPct", colorClass: "text-foreground font-semibold", group: "ytd" },
];

export default function GpTrackerPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [showMonthly, setShowMonthly] = useState(true);
  const [showYtd, setShowYtd] = useState(true);
  const [showProjects, setShowProjects] = useState(true);

  const { data, isLoading, isError, error, refetch } = useQuery<any>({
    queryKey: ["gp-tracker-portfolio"],
    queryFn: async () => {
      const res = await fetch("/api/gp-tracker", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load GP tracker");
      return res.json();
    },
  });

  const months = data?.months || [];
  const projects = data?.projects || [];

  const chartData = useMemo(() => {
    return months.map((m: any) => ({
      name: m.monthLabel || "",
      "Actual GP": Math.round(m.totalGP || 0),
      Budget: Math.round(m.budget || 0),
      "GP%": parseFloat((m.gpPct ?? 0).toFixed(1)),
    }));
  }, [months]);

  const filteredProjects = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter((p: any) => (p.projectName || "").toLowerCase().includes(q));
  }, [projects, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]" data-testid="gp-tracker-page">
        <EnergyLoader size="lg" label="Loading GP tracker..." />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto" data-testid="gp-tracker-error-state">
        <Card className="border-red-200 bg-red-50/40">
          <CardContent className="py-10 text-center space-y-2">
            <p className="text-sm font-semibold text-red-700">GP tracker data failed to load.</p>
            <p className="text-xs text-red-600/90">{(error as Error)?.message || "Please retry."}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-gp-tracker">Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalRevenue = data?.totalRevenue || 0;
  const totalCOS = data?.totalCOS || 0;
  const totalGP = data?.totalGP || 0;
  const overallGpPct = data?.overallGpPct || 0;

  const lastMonth = months.length > 0 ? months[months.length - 1] : null;
  const ytdGP = lastMonth?.ytdGP || 0;
  const ytdBudget = lastMonth?.ytdBudget || 0;
  const ytdVariance = lastMonth?.ytdVariance || 0;
  const ytdGpPct = lastMonth?.ytdGpPct || 0;

  const monthlyRows = ROW_DEFS.filter(r => r.group === "monthly");
  const ytdRows = ROW_DEFS.filter(r => r.group === "ytd");

  function getCellValue(m: any, dataKey: string): number {
    return m[dataKey] ?? 0;
  }

  function formatCellValue(val: number, key: string): string {
    if (key.includes("Pct") || key === "gpPct" || key === "ytdGpPct") return formatPercent(val);
    return formatRand(val);
  }

  function getVarianceColor(val: number): string {
    if (val > 0) return "text-emerald-600";
    if (val < 0) return "text-red-600";
    return "text-muted-foreground";
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto page-enter" data-testid="gp-tracker-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">GP Tracker</h1>
          <p className="text-sm text-muted-foreground">Portfolio-level Gross Profit — Budget vs Actual (Sep 2025 – Aug 2026). Monthly grid cells are summary values (no line-item drill-down yet).</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCard icon={DollarSign} label="Total Revenue" value={formatRand(totalRevenue)} color="text-blue-500" />
        <KpiCard icon={TrendingUp} label="Total COS" value={formatRand(totalCOS)} color="text-red-500" />
        <KpiCard icon={Activity} label="Total GP" value={formatRand(totalGP)} color={totalGP >= 0 ? "text-emerald-500" : "text-red-500"} />
        <KpiCard icon={Percent} label="GP%" value={formatPercent(overallGpPct)} color={overallGpPct >= 15 ? "text-emerald-500" : "text-red-500"} />
        <KpiCard icon={Activity} label="YTD GP" value={formatRand(ytdGP)} color={ytdGP >= 0 ? "text-emerald-500" : "text-red-500"} />
        <KpiCard icon={Target} label="YTD Budget" value={formatRand(ytdBudget)} color="text-purple-500" />
        <KpiCard icon={Activity} label="YTD Variance" value={formatRand(ytdVariance)} color={ytdVariance >= 0 ? "text-emerald-500" : "text-red-500"} />
        <KpiCard icon={Percent} label="YTD GP%" value={formatPercent(ytdGpPct)} color={ytdGpPct >= 15 ? "text-emerald-500" : "text-red-500"} />
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Budget vs Actual GP</h3>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatRand(v)} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} domain={[-50, 50]} />
                <Tooltip formatter={(value: number, name: string) => name === "GP%" ? `${value}%` : formatRand(value)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="Actual GP" fill="#10b981" radius={[3, 3, 0, 0]} barSize={24} />
                <Bar yAxisId="left" dataKey="Budget" fill="#a855f7" radius={[3, 3, 0, 0]} barSize={24} opacity={0.7} />
                <Line yAxisId="right" type="monotone" dataKey="GP%" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div
            className="flex items-center gap-2 cursor-pointer select-none mb-2"
            onClick={() => setShowMonthly(!showMonthly)}
            data-testid="button-toggle-monthly"
          >
            {showMonthly ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <h3 className="text-sm font-semibold">Monthly Tracking</h3>
          </div>
          {showMonthly && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="py-2 px-3 text-left font-semibold text-muted-foreground sticky left-0 bg-white z-10 min-w-[140px]">Metric</th>
                    {months.map((m: any) => (
                      <th key={m.monthKey} className="py-2 px-3 text-right font-semibold text-muted-foreground min-w-[100px]">{m.monthLabel}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map(row => (
                    <tr key={row.key} className="border-b border-border/40 hover:bg-muted/20" data-testid={`row-${row.key}`}>
                      <td className="py-2 px-3 font-medium text-muted-foreground sticky left-0 bg-white z-10 whitespace-nowrap">
                        {row.label}
                      </td>
                      {months.map((m: any) => {
                        const val = getCellValue(m, row.dataKey);
                        const colorClass = row.colorCoded ? getVarianceColor(val) : row.colorClass;
                        return (
                          <td key={m.monthKey} className={`py-2 px-3 text-right ${colorClass}`}>
                            {formatCellValue(val, row.dataKey)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div
            className="flex items-center gap-2 cursor-pointer select-none mb-2"
            onClick={() => setShowYtd(!showYtd)}
            data-testid="button-toggle-ytd"
          >
            {showYtd ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <h3 className="text-sm font-semibold">Year-to-Date Tracking</h3>
          </div>
          {showYtd && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="py-2 px-3 text-left font-semibold text-muted-foreground sticky left-0 bg-white z-10 min-w-[140px]">Metric</th>
                    {months.map((m: any) => (
                      <th key={m.monthKey} className="py-2 px-3 text-right font-semibold text-muted-foreground min-w-[100px]">{m.monthLabel}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ytdRows.map(row => (
                    <tr key={row.key} className="border-b border-border/40 hover:bg-muted/20" data-testid={`row-${row.key}`}>
                      <td className="py-2 px-3 font-medium text-muted-foreground sticky left-0 bg-white z-10 whitespace-nowrap">{row.label}</td>
                      {months.map((m: any) => {
                        const val = getCellValue(m, row.dataKey);
                        const colorClass = row.colorCoded ? getVarianceColor(val) : row.colorClass;
                        return (
                          <td key={m.monthKey} className={`py-2 px-3 text-right ${colorClass}`}>
                            {formatCellValue(val, row.dataKey)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div
            className="flex items-center gap-2 cursor-pointer select-none mb-2"
            onClick={() => setShowProjects(!showProjects)}
            data-testid="button-toggle-projects"
          >
            {showProjects ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <h3 className="text-sm font-semibold">Project GP Breakdown</h3>
          </div>
          {showProjects && (
            <>
              <div className="relative w-60 mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search projects by name..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                  data-testid="input-search-projects"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Project</th>
                      <th className="pb-2 font-medium text-right">Revenue</th>
                      <th className="pb-2 font-medium text-right">COS</th>
                      <th className="pb-2 font-medium text-right">GP</th>
                      <th className="pb-2 font-medium text-right">GP%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProjects.map((p: any) => (
                      <tr
                        key={p.projectName}
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                        onClick={() => navigate(`/project/${encodeURIComponent(p.projectName)}?tab=gp-tracker`)}
                        data-testid={`row-project-${p.projectName}`}
                      >
                        <td className="py-2 font-medium text-blue-600 hover:underline">{p.projectName}</td>
                        <td className="py-2 text-right">{formatRand(p.revenue)}</td>
                        <td className="py-2 text-right">{formatRand(p.cos)}</td>
                        <td className={`py-2 text-right font-semibold ${(p.gp ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatRand(p.gp)}</td>
                        <td className="py-2 text-right">
                          <Badge className={`text-[9px] ${(p.gpPct ?? 0) >= 15 ? 'bg-emerald-50 text-emerald-700' : (p.gpPct ?? 0) >= 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                            {(p.gpPct ?? 0).toFixed(1)}%
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {filteredProjects.length === 0 && (
                      <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No projects match this search. Try different keywords.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
