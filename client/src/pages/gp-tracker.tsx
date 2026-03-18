import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Line,
} from "recharts";
import {
  DollarSign, TrendingUp, Activity, Percent, Search,
  Target, ChevronDown, ChevronRight, X, HelpCircle,
} from "lucide-react";
import { useLocation } from "wouter";

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

function KpiCard({ icon: Icon, label, value, sub, color, tooltip }: {
  icon: any; label: string; value: string; sub?: string; color?: string; tooltip?: string;
}) {
  return (
    <Card data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
          <Icon className={`h-3.5 w-3.5 ${color || ""}`} aria-hidden="true" /> {label}
          {tooltip && (
            <UiTooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground/50 hover:text-muted-foreground transition-colors" aria-label={`Info: ${label}`}>
                  <HelpCircle className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px] text-xs leading-relaxed">
                {tooltip}
              </TooltipContent>
            </UiTooltip>
          )}
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

function GpMonthDetailPanel({ monthKey, monthLabel, onClose }: { monthKey: string; monthLabel: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["gp-tracker-month-detail", monthKey],
    queryFn: async () => {
      const res = await fetch(`/api/gp-tracker/month-detail?monthKey=${encodeURIComponent(monthKey)}`, { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load GP month detail");
      return res.json();
    },
    enabled: !!monthKey,
  });

  return (
    <Card className="border-blue-200 bg-blue-50/20">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">GP Line Items — {monthLabel}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data ? `${data.lineCount} items | Revenue ${formatRand(data.totalRevenue)} | COS ${formatRand(data.totalCOS)} | GP ${formatRand(data.totalGP)}` : "Loading..."}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0" data-testid="button-close-month-detail">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {isLoading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Loading line items...</div>
        ) : !data?.items?.length ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No line items for this month</div>
        ) : (
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 font-medium">Line Item</th>
                  <th className="pb-2 font-medium">Supplier</th>
                  <th className="pb-2 font-medium text-right">COS</th>
                  <th className="pb-2 font-medium text-right">Revenue</th>
                  <th className="pb-2 font-medium text-right">GP</th>
                  <th className="pb-2 font-medium text-right">GP%</th>
                  <th className="pb-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item: any) => (
                  <tr key={item.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="py-1.5 font-medium text-blue-600 max-w-[140px] truncate">{item.projectName}</td>
                    <td className="py-1.5 text-muted-foreground max-w-[160px] truncate">{item.lineItem || item.category || "-"}</td>
                    <td className="py-1.5 text-muted-foreground max-w-[120px] truncate">{item.supplier || "-"}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatRand(item.costAmount)}</td>
                    <td className="py-1.5 text-right tabular-nums text-blue-600">{formatRand(item.revenueAmount)}</td>
                    <td className={`py-1.5 text-right tabular-nums font-semibold ${(item.gpAmount ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatRand(item.gpAmount)}</td>
                    <td className="py-1.5 text-right tabular-nums">{(item.gpPct ?? 0).toFixed(1)}%</td>
                    <td className="py-1.5">
                      <Badge className={`text-[9px] ${item.isRealised ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {item.gpState}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function GpTrackerPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [showMonthly, setShowMonthly] = useState(true);
  const [showYtd, setShowYtd] = useState(true);
  const [showProjects, setShowProjects] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<{ monthKey: string; monthLabel: string } | null>(null);

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
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto" data-testid="gp-tracker-page">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-3 w-16 mb-2" />
                <Skeleton className="h-6 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-4">
            <Skeleton className="h-[280px] w-full rounded-lg" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Skeleton className="h-5 w-32 mb-3" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3 py-2">
                <Skeleton className="h-4 w-28" />
                {Array.from({ length: 5 }).map((_, j) => (
                  <Skeleton key={j} className="h-4 w-16 ml-auto" />
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
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
          <p className="text-sm text-muted-foreground">Portfolio-level Gross Profit — Budget vs Actual (Sep 2025 – Aug 2026). Click any GP row cell to drill down to line items.</p>
        </div>
      </div>

      <TooltipProvider delayDuration={300}>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3" role="region" aria-label="GP KPI Summary">
          <KpiCard icon={DollarSign} label="Total Revenue" value={formatRand(totalRevenue)} color="text-blue-500" tooltip="Sum of all milestone revenue across all projects for the financial year." />
          <KpiCard icon={TrendingUp} label="Total COS" value={formatRand(totalCOS)} color="text-red-500" tooltip="Sum of all Cost of Sales across all projects for the financial year." />
          <KpiCard icon={Activity} label="Total GP" value={formatRand(totalGP)} color={totalGP >= 0 ? "text-emerald-500" : "text-red-500"} tooltip="Gross Profit = Total Revenue minus Total COS. Green if positive, red if loss-making." />
          <KpiCard icon={Percent} label="GP%" value={formatPercent(overallGpPct)} color={overallGpPct >= 15 ? "text-emerald-500" : "text-red-500"} tooltip="Gross Profit as a percentage of revenue. Target is >= 15%." />
          <KpiCard icon={Activity} label="YTD GP" value={formatRand(ytdGP)} color={ytdGP >= 0 ? "text-emerald-500" : "text-red-500"} tooltip="Year-to-date cumulative Gross Profit." />
          <KpiCard icon={Target} label="YTD Budget" value={formatRand(ytdBudget)} color="text-purple-500" tooltip="Year-to-date GP budget based on revenue and COS budget entries." />
          <KpiCard icon={Activity} label="YTD Variance" value={formatRand(ytdVariance)} color={ytdVariance >= 0 ? "text-emerald-500" : "text-red-500"} tooltip="Difference between actual GP and budget GP. Positive = outperforming." />
          <KpiCard icon={Percent} label="YTD GP%" value={formatPercent(ytdGpPct)} color={ytdGpPct >= 15 ? "text-emerald-500" : "text-red-500"} tooltip="Year-to-date GP percentage. Green if >= 15% target." />
        </div>
      </TooltipProvider>

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
          <button
            type="button"
            className="flex items-center gap-2 cursor-pointer select-none mb-2"
            onClick={() => setShowMonthly(!showMonthly)}
            aria-expanded={showMonthly}
            aria-label={`${showMonthly ? 'Collapse' : 'Expand'} Monthly Tracking`}
            data-testid="button-toggle-monthly"
          >
            {showMonthly ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <h3 className="text-sm font-semibold">Monthly Tracking</h3>
          </button>
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
                  {monthlyRows.map(row => {
                    const isDrillable = ["totalGP", "realisedGP", "unrealisedGP", "totalRevenue", "totalCOS"].includes(row.key);
                    return (
                    <tr key={row.key} className="border-b border-border/40 hover:bg-muted/20" data-testid={`row-${row.key}`}>
                      <td className="py-2 px-3 font-medium text-muted-foreground sticky left-0 bg-white z-10 whitespace-nowrap">
                        {row.label}
                      </td>
                      {months.map((m: any) => {
                        const val = getCellValue(m, row.dataKey);
                        const colorClass = row.colorCoded ? getVarianceColor(val) : row.colorClass;
                        return (
                          <td
                            key={m.monthKey}
                            className={`py-2 px-3 text-right ${colorClass} ${isDrillable ? 'cursor-pointer hover:bg-blue-50 hover:underline' : ''}`}
                            onClick={isDrillable ? () => setSelectedMonth({ monthKey: m.monthKey, monthLabel: m.monthLabel }) : undefined}
                          >
                            {formatCellValue(val, row.dataKey)}
                          </td>
                        );
                      })}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedMonth && (
        <GpMonthDetailPanel
          monthKey={selectedMonth.monthKey}
          monthLabel={selectedMonth.monthLabel}
          onClose={() => setSelectedMonth(null)}
        />
      )}

      <Card>
        <CardContent className="p-4">
          <button
            type="button"
            className="flex items-center gap-2 cursor-pointer select-none mb-2"
            onClick={() => setShowYtd(!showYtd)}
            aria-expanded={showYtd}
            aria-label={`${showYtd ? 'Collapse' : 'Expand'} Year-to-Date Tracking`}
            data-testid="button-toggle-ytd"
          >
            {showYtd ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <h3 className="text-sm font-semibold">Year-to-Date Tracking</h3>
          </button>
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
          <button
            type="button"
            className="flex items-center gap-2 cursor-pointer select-none mb-2"
            onClick={() => setShowProjects(!showProjects)}
            aria-expanded={showProjects}
            aria-label={`${showProjects ? 'Collapse' : 'Expand'} Project GP Breakdown`}
            data-testid="button-toggle-projects"
          >
            {showProjects ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <h3 className="text-sm font-semibold">Project GP Breakdown</h3>
          </button>
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
