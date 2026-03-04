import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Line,
} from "recharts";
import {
  DollarSign, TrendingUp, Activity, Percent, Search, Loader2, ChevronDown, ChevronRight,
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

export default function GpTrackerPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<any>({
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
      Revenue: Math.round(m.totalRevenue || 0),
      COS: Math.round(m.totalCOS || 0),
      GP: Math.round(m.totalGP || 0),
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
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalRevenue = data?.totalRevenue || 0;
  const totalCOS = data?.totalCOS || 0;
  const totalGP = data?.totalGP || 0;
  const overallGpPct = data?.overallGpPct || 0;

  const currentMonth = months.find((m: any) => {
    const now = new Date();
    const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return m.monthKey === mk;
  });
  const ytdGP = currentMonth?.ytdGP || 0;
  const ytdGpPct = currentMonth?.ytdGpPct || 0;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto page-enter" data-testid="gp-tracker-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">GP Tracker</h1>
          <p className="text-sm text-muted-foreground">Portfolio-level Gross Profit analysis across all projects</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={DollarSign} label="Total Revenue" value={formatRand(totalRevenue)} color="text-blue-500" />
        <KpiCard icon={TrendingUp} label="Total COS" value={formatRand(totalCOS)} color="text-red-500" />
        <KpiCard icon={Activity} label="Total GP" value={formatRand(totalGP)} color={totalGP >= 0 ? "text-emerald-500" : "text-red-500"} />
        <KpiCard icon={Percent} label="Overall GP%" value={`${overallGpPct.toFixed(1)}%`} color={overallGpPct >= 15 ? "text-emerald-500" : "text-red-500"} />
        <KpiCard icon={Activity} label="YTD GP" value={formatRand(ytdGP)} sub="year to date" color={ytdGP >= 0 ? "text-emerald-500" : "text-red-500"} />
        <KpiCard icon={Percent} label="YTD GP%" value={`${ytdGpPct.toFixed(1)}%`} sub="year to date" color={ytdGpPct >= 15 ? "text-emerald-500" : "text-red-500"} />
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Monthly GP Trend (Sep 2025 – Aug 2026)</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatRand(v)} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} domain={[-50, 50]} />
                <Tooltip
                  formatter={(value: number, name: string) =>
                    name === "GP%" ? `${value}%` : formatRand(value)
                  }
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="Revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} barSize={20} />
                <Bar yAxisId="left" dataKey="COS" fill="#ef4444" radius={[3, 3, 0, 0]} barSize={20} />
                <Bar yAxisId="left" dataKey="GP" fill="#10b981" radius={[3, 3, 0, 0]} barSize={20} />
                <Line yAxisId="right" type="monotone" dataKey="GP%" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Monthly Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Month</th>
                  <th className="pb-2 font-medium text-right">Revenue</th>
                  <th className="pb-2 font-medium text-right">COS</th>
                  <th className="pb-2 font-medium text-right">GP</th>
                  <th className="pb-2 font-medium text-right">GP%</th>
                  <th className="pb-2 font-medium text-right">YTD GP</th>
                  <th className="pb-2 font-medium text-right">YTD GP%</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m: any) => (
                  <tr key={m.monthKey} className="border-b border-border/50 hover:bg-muted/30" data-testid={`row-month-${m.monthKey}`}>
                    <td className="py-2 font-medium">{m.monthLabel}</td>
                    <td className="py-2 text-right text-blue-600">{formatRand(m.totalRevenue)}</td>
                    <td className="py-2 text-right text-red-600">{formatRand(m.totalCOS)}</td>
                    <td className={`py-2 text-right font-semibold ${m.totalGP >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatRand(m.totalGP)}</td>
                    <td className={`py-2 text-right ${(m.gpPct ?? 0) >= 15 ? 'text-emerald-600' : 'text-red-600'}`}>{(m.gpPct ?? 0).toFixed(1)}%</td>
                    <td className={`py-2 text-right font-semibold ${m.ytdGP >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatRand(m.ytdGP)}</td>
                    <td className={`py-2 text-right ${(m.ytdGpPct ?? 0) >= 15 ? 'text-emerald-600' : 'text-red-600'}`}>{(m.ytdGpPct ?? 0).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Project GP Breakdown</h3>
            <div className="relative w-60">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
                data-testid="input-search-projects"
              />
            </div>
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
                    <td className={`py-2 text-right font-semibold ${p.gp >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatRand(p.gp)}</td>
                    <td className="py-2 text-right">
                      <Badge className={`text-[9px] ${(p.gpPct ?? 0) >= 15 ? 'bg-emerald-50 text-emerald-700' : (p.gpPct ?? 0) >= 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                        {(p.gpPct ?? 0).toFixed(1)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
                {filteredProjects.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No projects found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
