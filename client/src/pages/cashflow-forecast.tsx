import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Line,
  ReferenceLine,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Calendar,
  ChevronRight,
  X,
} from "lucide-react";

function formatRand(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

interface CashflowWeek {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  openingBalance: number;
  inflowsActual: number;
  inflowsForecast: number;
  outflowsActual: number;
  outflowsForecast: number;
  closingBalance: number;
  inflowLineCount: number;
  outflowLineCount: number;
}

interface WeekLineItem {
  id: number;
  projectName: string;
  type: string;
  amount: number;
  actualDate: string | null;
  forecastDate: string | null;
  confidence: string;
  assumptionDriver: string;
  description: string;
  invoiceNumber: string | null;
  poNumber: string | null;
  category: string | null;
  supplierName: string | null;
}

const confidenceColors: Record<string, string> = {
  High: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  Low: "bg-red-100 text-red-700",
};

function WeekDetailPanel({ weekStart, weekEnd, weekLabel, onClose }: {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<{ lines: WeekLineItem[]; total: number }>({
    queryKey: [`/api/cashflow-forecast/week-detail?weekStart=${weekStart}&weekEnd=${weekEnd}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const inflows = useMemo(() => (data?.lines ?? []).filter(l => l.type === 'inflow'), [data]);
  const outflows = useMemo(() => (data?.lines ?? []).filter(l => l.type === 'outflow'), [data]);

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-background border-l shadow-lg z-50 flex flex-col" data-testid="week-detail-panel">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="font-bold">Week of {weekLabel}</h3>
          <p className="text-xs text-muted-foreground">{weekStart} to {weekEnd}</p>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-muted rounded" data-testid="button-close-detail">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="text-center text-muted-foreground">Loading...</div>
        ) : (
          <>
            <div>
              <h4 className="font-medium text-sm text-green-600 mb-2">Inflows ({inflows.length})</h4>
              {inflows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No inflows this week</p>
              ) : (
                <div className="space-y-2">
                  {inflows.map((line) => (
                    <div key={`in-${line.id}`} className="border rounded p-2 text-xs space-y-1">
                      <div className="flex justify-between items-start">
                        <span className="font-medium truncate max-w-[200px]">{line.projectName}</span>
                        <span className="font-mono font-bold text-green-600">{formatRand(line.amount)}</span>
                      </div>
                      <p className="text-muted-foreground">{line.description}</p>
                      <div className="flex gap-2 items-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${confidenceColors[line.confidence] || ''}`}>
                          {line.confidence}
                        </span>
                        <span className="text-muted-foreground text-[10px]">{line.assumptionDriver}</span>
                      </div>
                      {line.invoiceNumber && <div className="text-muted-foreground">Invoice: {line.invoiceNumber}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4 className="font-medium text-sm text-red-600 mb-2">Outflows ({outflows.length})</h4>
              {outflows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No outflows this week</p>
              ) : (
                <div className="space-y-2">
                  {outflows.map((line) => (
                    <div key={`out-${line.id}`} className="border rounded p-2 text-xs space-y-1">
                      <div className="flex justify-between items-start">
                        <span className="font-medium truncate max-w-[200px]">{line.projectName}</span>
                        <span className="font-mono font-bold text-red-600">{formatRand(line.amount)}</span>
                      </div>
                      <p className="text-muted-foreground">{line.description}</p>
                      <div className="flex gap-2 items-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${confidenceColors[line.confidence] || ''}`}>
                          {line.confidence}
                        </span>
                        <span className="text-muted-foreground text-[10px]">{line.assumptionDriver}</span>
                      </div>
                      {line.supplierName && <div className="text-muted-foreground">Supplier: {line.supplierName}</div>}
                      {line.invoiceNumber && <div className="text-muted-foreground">Invoice: {line.invoiceNumber}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CashflowForecastPage() {
  const [selectedWeek, setSelectedWeek] = useState<CashflowWeek | null>(null);
  const [weeksToShow, setWeeksToShow] = useState(26);

  const startDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return d.toISOString().split('T')[0];
  }, []);

  const { data, isLoading } = useQuery<{
    weeks: CashflowWeek[];
    totalInflows: number;
    totalOutflows: number;
  }>({
    queryKey: [`/api/cashflow-forecast/weekly?weeks=${weeksToShow + 8}&start=${startDate}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const weeks = data?.weeks ?? [];

  const chartData = useMemo(() => {
    return weeks.slice(0, weeksToShow).map(w => ({
      ...w,
      inflowTotal: w.inflowsActual + w.inflowsForecast,
      outflowTotal: -(w.outflowsActual + w.outflowsForecast),
      netFlow: (w.inflowsActual + w.inflowsForecast) - (w.outflowsActual + w.outflowsForecast),
    }));
  }, [weeks, weeksToShow]);

  const totals = useMemo(() => {
    const result = { inflowsActual: 0, inflowsForecast: 0, outflowsActual: 0, outflowsForecast: 0 };
    for (const w of weeks.slice(0, weeksToShow)) {
      result.inflowsActual += w.inflowsActual;
      result.inflowsForecast += w.inflowsForecast;
      result.outflowsActual += w.outflowsActual;
      result.outflowsForecast += w.outflowsForecast;
    }
    return result;
  }, [weeks, weeksToShow]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold">Cashflow Forecast</h2>
        <div className="p-12 text-center text-muted-foreground">Loading forecast data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="cashflow-forecast-page">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-heading font-bold text-foreground">Cashflow Forecast</h2>
          <p className="text-muted-foreground">Weekly line-item-driven forecast with drilldown</p>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-sm text-muted-foreground">Show:</span>
          {[13, 26, 39, 52].map(n => (
            <button
              key={n}
              data-testid={`button-weeks-${n}`}
              className={`px-3 py-1 rounded text-sm ${weeksToShow === n ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
              onClick={() => setWeeksToShow(n)}
            >
              {n}w
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Inflows (Actual)</p>
            <p className="text-xl font-bold text-green-600">{formatRand(totals.inflowsActual)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Inflows (Forecast)</p>
            <p className="text-xl font-bold text-green-400">{formatRand(totals.inflowsForecast)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Outflows (Actual)</p>
            <p className="text-xl font-bold text-red-600">{formatRand(totals.outflowsActual)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Outflows (Forecast)</p>
            <p className="text-xl font-bold text-red-400">{formatRand(totals.outflowsForecast)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Weekly Cashflow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} interval={Math.floor(weeksToShow / 12)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatRand(v)} />
                <Tooltip
                  formatter={(value: number) => formatRand(value)}
                  labelFormatter={(label: string) => `Week of ${label}`}
                />
                <Legend />
                <Bar dataKey="inflowTotal" name="Inflows" fill="#22c55e" opacity={0.7} />
                <Bar dataKey="outflowTotal" name="Outflows" fill="#ef4444" opacity={0.7} />
                <Line dataKey="closingBalance" name="Closing Balance" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Weekly Grid</CardTitle>
          <p className="text-xs text-muted-foreground">Click any week to drill down to individual line items</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background z-10 border-b">
                <tr>
                  <th className="p-2 text-left">Week</th>
                  <th className="p-2 text-right">Inflows (Actual)</th>
                  <th className="p-2 text-right">Inflows (Forecast)</th>
                  <th className="p-2 text-right">Outflows (Actual)</th>
                  <th className="p-2 text-right">Outflows (Forecast)</th>
                  <th className="p-2 text-right">Net</th>
                  <th className="p-2 text-right">Balance</th>
                  <th className="p-2 text-center">Lines</th>
                  <th className="p-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {weeks.slice(0, weeksToShow).map((week) => {
                  const net = (week.inflowsActual + week.inflowsForecast) - (week.outflowsActual + week.outflowsForecast);
                  const hasActivity = week.inflowLineCount + week.outflowLineCount > 0;
                  return (
                    <tr
                      key={week.weekStart}
                      data-testid={`cashflow-week-${week.weekStart}`}
                      className={`border-b cursor-pointer transition-colors ${
                        selectedWeek?.weekStart === week.weekStart ? 'bg-primary/5' : 'hover:bg-muted/50'
                      } ${!hasActivity ? 'opacity-50' : ''}`}
                      onClick={() => hasActivity && setSelectedWeek(week)}
                    >
                      <td className="p-2 font-medium text-xs whitespace-nowrap">{week.weekLabel}</td>
                      <td className="p-2 text-right font-mono text-xs text-green-600">
                        {week.inflowsActual > 0 ? formatRand(week.inflowsActual) : '-'}
                      </td>
                      <td className="p-2 text-right font-mono text-xs text-green-400">
                        {week.inflowsForecast > 0 ? formatRand(week.inflowsForecast) : '-'}
                      </td>
                      <td className="p-2 text-right font-mono text-xs text-red-600">
                        {week.outflowsActual > 0 ? formatRand(week.outflowsActual) : '-'}
                      </td>
                      <td className="p-2 text-right font-mono text-xs text-red-400">
                        {week.outflowsForecast > 0 ? formatRand(week.outflowsForecast) : '-'}
                      </td>
                      <td className={`p-2 text-right font-mono text-xs font-medium ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {hasActivity ? formatRand(net) : '-'}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">{formatRand(week.closingBalance)}</td>
                      <td className="p-2 text-center text-xs text-muted-foreground">
                        {hasActivity ? week.inflowLineCount + week.outflowLineCount : '-'}
                      </td>
                      <td className="p-2">
                        {hasActivity && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selectedWeek && (
        <WeekDetailPanel
          weekStart={selectedWeek.weekStart}
          weekEnd={selectedWeek.weekEnd}
          weekLabel={selectedWeek.weekLabel}
          onClose={() => setSelectedWeek(null)}
        />
      )}
    </div>
  );
}
