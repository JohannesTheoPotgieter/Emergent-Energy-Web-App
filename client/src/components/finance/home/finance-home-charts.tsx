/**
 * Finance Home charts — presentation only (recharts), brand-token colours.
 *
 * Every chart is fed numbers the page already pulled from a canonical tracker
 * endpoint (see client/src/lib/finance/home-data.ts). These components never
 * fetch or derive a finance figure; they group/plot what they are given. Money
 * is formatted with the canonical ZAR formatters so axes/tooltips match the
 * rest of the finance UI.
 */
import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatZar, formatZarCompact } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type {
  CashWeekPoint,
  GpMarginPoint,
  MonthStatePoint,
  OnTrackPoint,
  ProjectGpRow,
} from "@/lib/finance/home-data";

// Brand-aligned series colours (emerald = realised/positive; slate = budget;
// amber = planned/forecast; rose = outflow/negative).
const C = {
  realised: "#16A34A",
  budget: "#94A3B8",
  planned: "#F59E0B",
  quickbooks: "#6366F1",
  inflow: "#16A34A",
  outflow: "#E11D48",
  available: "#0EA5E9",
  marginLine: "#0F172A",
  positive: "#16A34A",
  negative: "#E11D48",
} as const;

const axisTick = { fontSize: 10, fill: "#64748b" } as const;
const zarAxis = (v: number) => formatZarCompact(v);
const tooltipStyle = {
  borderRadius: "8px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
  fontSize: "12px",
  padding: "6px 10px",
} as const;

export function ChartCard({
  title,
  hint,
  action,
  children,
  className,
  "data-testid": testId,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div
      className={cn("rounded-lg border border-slate-200 bg-white p-3", className)}
      data-testid={testId}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 leading-tight">{title}</h3>
          {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

interface BarClickState {
  activePayload?: Array<{ payload?: { monthKey?: string } }>;
}

/** Revenue by month — grouped bars: budget · planned · realised. Click a month. */
export function RevenueStatesChart({
  data,
  onMonthClick,
}: {
  data: MonthStatePoint[];
  onMonthClick?: (monthKey: string) => void;
}) {
  const handleClick = (state: unknown) => {
    const key = (state as BarClickState)?.activePayload?.[0]?.payload?.monthKey;
    if (key) onMonthClick?.(key);
  };
  // A future month with no manual budget captured renders a zero-height (so
  // visually absent) budget bar. Footnote that absence rather than leaving the
  // viewer to wonder why Jul/Aug show only a Planned bar.
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const hasFutureBudgetGap = data.some((d) => !d.budgetSet && d.monthKey > currentMonthKey);
  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 8, left: 4, bottom: 4 }}
          onClick={handleClick}
          className={onMonthClick ? "cursor-pointer" : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
          <XAxis dataKey="monthLabel" tick={axisTick} tickLine={false} axisLine={false} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={zarAxis} width={56} />
          <Tooltip
            formatter={(v: number, name: string) => [formatZar(v), name]}
            contentStyle={tooltipStyle}
            cursor={{ fill: "rgba(148,163,184,0.12)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
          <Bar dataKey="budget" name="Budget" fill={C.budget} radius={[2, 2, 0, 0]} />
          <Bar dataKey="planned" name="Planned" fill={C.planned} radius={[2, 2, 0, 0]} />
          <Bar dataKey="realised" name="Realised" fill={C.realised} radius={[2, 2, 0, 0]} />
          <Bar dataKey="qb" name="QB realised" fill={C.quickbooks} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {hasFutureBudgetGap && (
        <p className="mt-1 text-[10px] text-slate-400" data-testid="revenue-budget-future-note">
          * Budget not set for future months
        </p>
      )}
    </div>
  );
}

/** Cumulative realised vs cumulative budget across the FY (pace line). */
export function OnTrackChart({ data }: { data: OnTrackPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
        <XAxis dataKey="monthLabel" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={zarAxis} width={56} />
        <Tooltip
          formatter={(v: number, name: string) => [formatZar(v), name]}
          contentStyle={tooltipStyle}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
        <Line
          type="monotone"
          dataKey="cumBudget"
          name="Cumulative budget"
          stroke={C.budget}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="cumRealised"
          name="Cumulative realised"
          stroke={C.realised}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** GP by month (bars) + realised margin % (line, right axis). */
export function GpMarginChart({ data }: { data: GpMarginPoint[] }) {
  const rows = data.map((m) => ({
    monthLabel: m.monthLabel,
    gp: m.gp,
    margin: m.margin,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
        <XAxis dataKey="monthLabel" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis yAxisId="gp" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={zarAxis} width={56} />
        <YAxis
          yAxisId="margin"
          orientation="right"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          width={40}
        />
        <Tooltip
          formatter={(v: number, name: string) =>
            name === "Margin %" ? [`${v.toFixed(1)}%`, name] : [formatZar(v), name]
          }
          contentStyle={tooltipStyle}
          cursor={{ fill: "rgba(148,163,184,0.12)" }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
        <ReferenceLine yAxisId="gp" y={0} stroke="#cbd5e1" />
        <Bar yAxisId="gp" dataKey="gp" name="GP" radius={[2, 2, 0, 0]}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.gp >= 0 ? C.positive : C.negative} />
          ))}
        </Bar>
        <Line
          yAxisId="margin"
          type="monotone"
          dataKey="margin"
          name="Margin %"
          stroke={C.marginLine}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Cash by week — inflows vs outflows (and available-to-pay). */
export function CashByWeekChart({ data }: { data: CashWeekPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={zarAxis} width={56} />
        <Tooltip
          formatter={(v: number, name: string) => [formatZar(v), name]}
          contentStyle={tooltipStyle}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
        <ReferenceLine y={0} stroke="#cbd5e1" />
        <Line type="monotone" dataKey="inflows" name="Inflows" stroke={C.inflow} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="outflows" name="Outflows" stroke={C.outflow} strokeWidth={2} dot={false} />
        <Line
          type="monotone"
          dataKey="available"
          name="Available"
          stroke={C.available}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Top projects by GP — horizontal bar list. */
export function TopProjectsGpChart({
  data,
  onProjectClick,
}: {
  data: ProjectGpRow[];
  onProjectClick?: (projectId: number) => void;
}) {
  const rows = data.map((p) => ({
    projectId: p.projectId,
    name: p.projectName.length > 22 ? `${p.projectName.slice(0, 22)}…` : p.projectName,
    gp: p.gp,
  }));
  const handleClick = (state: unknown) => {
    const id = (state as { activePayload?: Array<{ payload?: { projectId?: number } }> })
      ?.activePayload?.[0]?.payload?.projectId;
    if (id != null) onProjectClick?.(id);
  };
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 30)}>
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
        onClick={handleClick}
        className={onProjectClick ? "cursor-pointer" : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f6" />
        <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={zarAxis} />
        <YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={false} width={130} />
        <Tooltip
          formatter={(v: number) => [formatZar(v), "GP"]}
          contentStyle={tooltipStyle}
          cursor={{ fill: "rgba(148,163,184,0.12)" }}
        />
        <Bar dataKey="gp" name="GP" radius={[0, 3, 3, 0]}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.gp >= 0 ? C.positive : C.negative} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
