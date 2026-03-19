import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3,
  ChevronDown, ChevronUp, Calendar, Clock, CalendarDays,
  RefreshCw, AlertCircle,
} from "lucide-react";
import { useExecutionData } from "./use-execution-data";

type TimePeriod = "weekly" | "monthly" | "yearly";

interface PeriodData {
  total: number;
  realised: number;
  unrealised: number;
  realisedPct: number;
  lineCount: number;
  realisedCount: number;
  projects: { projectName: string; total: number; realised: number; unrealised: number }[];
}

interface YTDData extends PeriodData {
  budget?: number;
  variance?: number;
  variancePct?: number;
}

interface SeriesPoint {
  monthKey: string;
  label: string;
  total: number;
  realised: number;
  unrealised: number;
  realisedPct: number;
}

interface TrackerData {
  thisWeek: PeriodData;
  lastWeek: PeriodData;
  thisMonth: PeriodData;
  lastMonth: PeriodData;
  ytd: YTDData;
  monthlySeries: SeriesPoint[];
}

interface RealisationKPIResponse {
  asOf: string;
  fyLabel: string;
  fyStart: string;
  fyEnd: string;
  cos: TrackerData;
  cashflow: TrackerData;
}

function formatCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R${(v / 1_000).toFixed(0)}K`;
  return `R${v.toFixed(0)}`;
}

function formatCurrencyFull(v: number): string {
  return `R ${v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pctChange(current: number, previous: number): { value: number; label: string } | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { value: 100, label: "+100%" };
  const pct = ((current - previous) / previous) * 100;
  return { value: pct, label: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` };
}

export default function RealisationKPIsPage() {
  const { fyLabel } = useExecutionData();
  const [data, setData] = useState<RealisationKPIResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<TimePeriod>("monthly");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const token = localStorage.getItem("auth_token");
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch("/api/realisation-kpis", { headers });
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        setData(await res.json());
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground mr-2" />
        <span className="text-sm text-muted-foreground">Loading realisation KPIs...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertCircle className="w-6 h-6 text-red-500" />
        <p className="text-sm text-muted-foreground">{error || "No data"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">View:</span>
        {([
          { key: "weekly" as TimePeriod, label: "Weekly", icon: <Clock className="w-3.5 h-3.5" /> },
          { key: "monthly" as TimePeriod, label: "Monthly", icon: <Calendar className="w-3.5 h-3.5" /> },
          { key: "yearly" as TimePeriod, label: "YTD / Yearly", icon: <CalendarDays className="w-3.5 h-3.5" /> },
        ]).map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              period === p.key
                ? "bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm"
                : "bg-white border-border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {p.icon}
            {p.label}
          </button>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">
          Data as of {new Date(data.asOf).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}
        </span>
      </div>

      {/* COS REALISATION */}
      <SectionHeader title="COS Realisation" subtitle="Invoice captured + invoice date confirmed = realised in that month" color="emerald" />

      {period === "weekly" && (
        <PeriodComparisonRow
          current={data.cos.thisWeek}
          previous={data.cos.lastWeek}
          currentLabel="This Week"
          previousLabel="Last Week"
          color="emerald"
          expandedSection={expandedSection}
          setExpandedSection={setExpandedSection}
          sectionPrefix="cos-week"
        />
      )}

      {period === "monthly" && (
        <PeriodComparisonRow
          current={data.cos.thisMonth}
          previous={data.cos.lastMonth}
          currentLabel="This Month"
          previousLabel="Last Month"
          color="emerald"
          expandedSection={expandedSection}
          setExpandedSection={setExpandedSection}
          sectionPrefix="cos-month"
        />
      )}

      {period === "yearly" && (
        <YTDSection
          ytd={data.cos.ytd}
          fyLabel={data.fyLabel}
          color="emerald"
          expandedSection={expandedSection}
          setExpandedSection={setExpandedSection}
          sectionPrefix="cos-ytd"
        />
      )}

      {/* COS Sparkline Chart */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">COS Realisation by Month ({data.fyLabel})</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.cos.monthlySeries} barGap={1}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrency(v)} width={70} />
              <Tooltip
                formatter={(value: number, name: string) => [formatCurrencyFull(value), name]}
                labelFormatter={(l) => `Month: ${l}`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="realised" name="Realised" stackId="a" fill="#059669" radius={[0,0,0,0]} />
              <Bar dataKey="unrealised" name="Unrealised" stackId="a" fill="#fbbf24" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* CASHFLOW REALISATION */}
      <SectionHeader title="Cashflow Realisation" subtitle="Invoice captured + payment date confirmed (black) = out of bank in that month" color="blue" />

      {period === "weekly" && (
        <PeriodComparisonRow
          current={data.cashflow.thisWeek}
          previous={data.cashflow.lastWeek}
          currentLabel="This Week"
          previousLabel="Last Week"
          color="blue"
          expandedSection={expandedSection}
          setExpandedSection={setExpandedSection}
          sectionPrefix="cf-week"
        />
      )}

      {period === "monthly" && (
        <PeriodComparisonRow
          current={data.cashflow.thisMonth}
          previous={data.cashflow.lastMonth}
          currentLabel="This Month"
          previousLabel="Last Month"
          color="blue"
          expandedSection={expandedSection}
          setExpandedSection={setExpandedSection}
          sectionPrefix="cf-month"
        />
      )}

      {period === "yearly" && (
        <YTDSection
          ytd={data.cashflow.ytd}
          fyLabel={data.fyLabel}
          color="blue"
          expandedSection={expandedSection}
          setExpandedSection={setExpandedSection}
          sectionPrefix="cf-ytd"
        />
      )}

      {/* Cashflow Sparkline Chart */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Cashflow Realisation by Month ({data.fyLabel})</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.cashflow.monthlySeries} barGap={1}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrency(v)} width={70} />
              <Tooltip
                formatter={(value: number, name: string) => [formatCurrencyFull(value), name]}
                labelFormatter={(l) => `Month: ${l}`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="realised" name="Out of Bank" stackId="a" fill="#2563eb" radius={[0,0,0,0]} />
              <Bar dataKey="unrealised" name="Planned/Pending" stackId="a" fill="#93c5fd" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

function SectionHeader({ title, subtitle, color }: { title: string; subtitle: string; color: "emerald" | "blue" }) {
  const iconBg = color === "emerald" ? "bg-emerald-100" : "bg-blue-100";
  const iconColor = color === "emerald" ? "text-emerald-600" : "text-blue-600";
  return (
    <div className="flex items-center gap-2.5 mt-2">
      <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
        <DollarSign className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-[10px] text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function PeriodComparisonRow({
  current, previous, currentLabel, previousLabel, color, expandedSection, setExpandedSection, sectionPrefix,
}: {
  current: PeriodData; previous: PeriodData;
  currentLabel: string; previousLabel: string;
  color: "emerald" | "blue";
  expandedSection: string | null;
  setExpandedSection: (s: string | null) => void;
  sectionPrefix: string;
}) {
  const totalChange = pctChange(current.total, previous.total);
  const realisedChange = pctChange(current.realised, previous.realised);

  const accent = color === "emerald" ? "emerald" : "blue";
  const currentExpanded = expandedSection === `${sectionPrefix}-current`;
  const previousExpanded = expandedSection === `${sectionPrefix}-previous`;

  return (
    <div className="space-y-3">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label={`Total (${currentLabel})`}
          value={formatCurrency(current.total)}
          sub={totalChange ? `${totalChange.label} vs ${previousLabel.toLowerCase()}` : undefined}
          subColor={totalChange && totalChange.value > 0 ? "text-red-500" : "text-emerald-500"}
          accent={accent}
        />
        <KpiCard
          label={`Realised (${currentLabel})`}
          value={formatCurrency(current.realised)}
          sub={realisedChange ? `${realisedChange.label} vs ${previousLabel.toLowerCase()}` : undefined}
          subColor={realisedChange && realisedChange.value > 0 ? "text-emerald-500" : "text-amber-500"}
          accent={accent}
        />
        <KpiCard
          label={`Unrealised (${currentLabel})`}
          value={formatCurrency(current.unrealised)}
          accent="amber"
        />
        <KpiCard
          label="Realised %"
          value={`${current.realisedPct}%`}
          sub={`${current.realisedCount} of ${current.lineCount} lines`}
          accent={accent}
        />
        <KpiCard
          label={`Total (${previousLabel})`}
          value={formatCurrency(previous.total)}
          sub={`${previous.realisedPct}% realised`}
          accent="slate"
        />
        <KpiCard
          label={`Realised (${previousLabel})`}
          value={formatCurrency(previous.realised)}
          sub={`${previous.realisedCount} of ${previous.lineCount} lines`}
          accent="slate"
        />
      </div>

      {/* Expandable project detail */}
      {current.projects.length > 0 && (
        <Card className="border-border/60">
          <button
            className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors"
            onClick={() => setExpandedSection(currentExpanded ? null : `${sectionPrefix}-current`)}
          >
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {currentLabel} — Project Breakdown ({current.projects.length} projects)
            </span>
            {currentExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {currentExpanded && <ProjectBreakdownTable projects={current.projects} />}
        </Card>
      )}
    </div>
  );
}

function YTDSection({
  ytd, fyLabel, color, expandedSection, setExpandedSection, sectionPrefix,
}: {
  ytd: YTDData; fyLabel: string; color: "emerald" | "blue";
  expandedSection: string | null;
  setExpandedSection: (s: string | null) => void;
  sectionPrefix: string;
}) {
  const accent = color === "emerald" ? "emerald" : "blue";
  const expanded = expandedSection === sectionPrefix;
  const hasBudget = ytd.budget !== undefined;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label={`YTD Total (${fyLabel})`} value={formatCurrency(ytd.total)} sub={`${ytd.lineCount} line items`} accent={accent} />
        <KpiCard label="YTD Realised" value={formatCurrency(ytd.realised)} sub={`${ytd.realisedCount} lines realised`} accent={accent} />
        <KpiCard label="YTD Unrealised" value={formatCurrency(ytd.unrealised)} accent="amber" />
        <KpiCard label="Realised %" value={`${ytd.realisedPct}%`} accent={accent} />
        {hasBudget && (
          <>
            <KpiCard label="YTD Budget" value={formatCurrency(ytd.budget!)} accent="slate" />
            <KpiCard
              label="YTD Variance"
              value={`${(ytd.variancePct ?? 0) > 0 ? "+" : ""}${ytd.variancePct ?? 0}%`}
              sub={formatCurrency(ytd.variance ?? 0)}
              subColor={(ytd.variance ?? 0) > 0 ? "text-red-500" : "text-emerald-500"}
              accent={(ytd.variance ?? 0) > 0 ? "red" : "emerald"}
            />
          </>
        )}
        {!hasBudget && (
          <>
            <KpiCard label="Total Lines" value={ytd.lineCount} accent="slate" />
            <KpiCard label="Realised Lines" value={ytd.realisedCount} accent="slate" />
          </>
        )}
      </div>

      {ytd.projects.length > 0 && (
        <Card className="border-border/60">
          <button
            className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors"
            onClick={() => setExpandedSection(expanded ? null : sectionPrefix)}
          >
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              YTD — Project Breakdown ({ytd.projects.length} projects)
            </span>
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {expanded && <ProjectBreakdownTable projects={ytd.projects} />}
        </Card>
      )}
    </div>
  );
}

function ProjectBreakdownTable({ projects }: { projects: { projectName: string; total: number; realised: number; unrealised: number }[] }) {
  return (
    <div className="px-3 pb-3">
      <div className="rounded-lg border border-border/60 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left py-2 px-3 font-medium">Project</th>
              <th className="text-right py-2 px-3 font-medium">Total</th>
              <th className="text-right py-2 px-3 font-medium">Realised</th>
              <th className="text-right py-2 px-3 font-medium">Unrealised</th>
              <th className="text-right py-2 px-3 font-medium">Realised %</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const pct = p.total > 0 ? ((p.realised / p.total) * 100).toFixed(1) : "0.0";
              return (
                <tr key={p.projectName} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="py-1.5 px-3 font-medium text-xs truncate max-w-[200px]">{p.projectName}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-xs">{formatCurrency(p.total)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-xs text-emerald-600">{formatCurrency(p.realised)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-xs text-amber-600">{formatCurrency(p.unrealised)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-xs">
                    <span className={`inline-flex items-center gap-1 ${parseFloat(pct) >= 80 ? "text-emerald-600" : parseFloat(pct) >= 50 ? "text-amber-600" : "text-red-500"}`}>
                      {pct}%
                      <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-current rounded-full" style={{ width: `${Math.min(100, parseFloat(pct))}%` }} />
                      </div>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, subColor, accent }: {
  label: string; value: React.ReactNode; sub?: string; subColor?: string; accent: string;
}) {
  const bgMap: Record<string, string> = {
    emerald: "bg-emerald-100", blue: "bg-blue-100", amber: "bg-amber-100", red: "bg-red-100", slate: "bg-slate-100",
  };
  const iconMap: Record<string, string> = {
    emerald: "text-emerald-600", blue: "text-blue-600", amber: "text-amber-600", red: "text-red-600", slate: "text-slate-500",
  };
  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className={`w-6 h-6 rounded-md ${bgMap[accent] || bgMap.slate} flex items-center justify-center shrink-0`}>
            <BarChart3 className={`w-3.5 h-3.5 ${iconMap[accent] || iconMap.slate}`} />
          </div>
          <span className="text-[10px] text-muted-foreground font-medium leading-tight">{label}</span>
        </div>
        <p className="text-lg font-bold tabular-nums">{value}</p>
        {sub && <p className={`text-[10px] mt-0.5 ${subColor || "text-muted-foreground"}`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}
