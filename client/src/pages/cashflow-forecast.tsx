import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Line, ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, DollarSign, ArrowDownRight, ArrowUpRight } from "lucide-react";

function formatRand(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

function formatRandExact(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "R 0.00";
  return `R ${val.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

interface TrackerWeek {
  weekStart: string;
  inflows: number;
  confirmedInflows: number;
  outflows: number;
  confirmedOutflows: number;
  cashflow: number;
  invoicedPayments: number;
}

interface TrackerData {
  weeks: TrackerWeek[];
  totals: {
    inflows: number;
    confirmedInflows: number;
    outflows: number;
    confirmedOutflows: number;
    cashflow: number;
    invoicedPayments: number;
  };
}

function getFinancialYear(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  if (month >= 3) return `FY${year}/${year + 1}`;
  return `FY${year - 1}/${year}`;
}

function getMonthKey(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[month]} ${year}`;
}

export default function CashflowForecastPage() {
  const [viewMode, setViewMode] = useState<'weekly' | 'monthly' | 'fy'>('monthly');
  const [fyFilter, setFyFilter] = useState<string>('all');

  const { data, isLoading } = useQuery<TrackerData>({
    queryKey: ["/api/cashflow-tracker"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const allFYs = useMemo(() => {
    if (!data?.weeks) return [];
    const fys = new Set<string>();
    data.weeks.forEach(w => fys.add(getFinancialYear(w.weekStart)));
    return Array.from(fys).sort();
  }, [data]);

  const filteredWeeks = useMemo(() => {
    if (!data?.weeks) return [];
    if (fyFilter === 'all') return data.weeks;
    return data.weeks.filter(w => getFinancialYear(w.weekStart) === fyFilter);
  }, [data, fyFilter]);

  const monthlyData = useMemo(() => {
    const monthMap = new Map<string, { inflows: number; outflows: number; cashflow: number; confirmedInflows: number; confirmedOutflows: number; invoicedPayments: number }>();
    for (const w of filteredWeeks) {
      const mk = getMonthKey(w.weekStart);
      if (!monthMap.has(mk)) monthMap.set(mk, { inflows: 0, outflows: 0, cashflow: 0, confirmedInflows: 0, confirmedOutflows: 0, invoicedPayments: 0 });
      const bucket = monthMap.get(mk)!;
      bucket.inflows += w.inflows;
      bucket.outflows += w.outflows;
      bucket.cashflow += w.cashflow;
      bucket.confirmedInflows += w.confirmedInflows;
      bucket.confirmedOutflows += w.confirmedOutflows;
      bucket.invoicedPayments += w.invoicedPayments;
    }
    return Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([mk, vals]) => ({
      label: getMonthLabel(mk),
      ...vals,
    }));
  }, [filteredWeeks]);

  const fyGrouped = useMemo(() => {
    const fyMap = new Map<string, { inflows: number; outflows: number; cashflow: number; confirmedInflows: number; confirmedOutflows: number; invoicedPayments: number }>();
    for (const w of filteredWeeks) {
      const fy = getFinancialYear(w.weekStart);
      if (!fyMap.has(fy)) fyMap.set(fy, { inflows: 0, outflows: 0, cashflow: 0, confirmedInflows: 0, confirmedOutflows: 0, invoicedPayments: 0 });
      const bucket = fyMap.get(fy)!;
      bucket.inflows += w.inflows;
      bucket.outflows += w.outflows;
      bucket.cashflow += w.cashflow;
      bucket.confirmedInflows += w.confirmedInflows;
      bucket.confirmedOutflows += w.confirmedOutflows;
      bucket.invoicedPayments += w.invoicedPayments;
    }
    return Array.from(fyMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([fy, vals]) => ({
      label: fy,
      ...vals,
    }));
  }, [filteredWeeks]);

  const filteredTotals = useMemo(() => {
    const t = { inflows: 0, outflows: 0, cashflow: 0, confirmedInflows: 0, confirmedOutflows: 0, invoicedPayments: 0 };
    for (const w of filteredWeeks) {
      t.inflows += w.inflows;
      t.outflows += w.outflows;
      t.cashflow += w.cashflow;
      t.confirmedInflows += w.confirmedInflows;
      t.confirmedOutflows += w.confirmedOutflows;
      t.invoicedPayments += w.invoicedPayments;
    }
    return t;
  }, [filteredWeeks]);

  const displayData = useMemo(() => {
    if (viewMode === 'fy') return fyGrouped;
    if (viewMode === 'monthly') return monthlyData;
    return filteredWeeks.map(w => ({ label: formatWeekLabel(w.weekStart), ...w }));
  }, [viewMode, fyGrouped, monthlyData, filteredWeeks]);

  const chartData = useMemo(() => {
    let cumCashflow = 0;
    return displayData.map(d => {
      cumCashflow += d.cashflow;
      return { ...d, cumulativeCashflow: cumCashflow };
    });
  }, [displayData]);

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading cashflow data...</div>;

  return (
    <div className="space-y-4" data-testid="cashflow-forecast-page">
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Cashflow Tracker</h2>
          <p className="text-sm text-muted-foreground">{filteredWeeks.length} weeks of cashflow data from underlying project records</p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            className="h-8 rounded-md border px-2 text-sm bg-background"
            value={fyFilter}
            onChange={e => setFyFilter(e.target.value)}
            data-testid="select-fy-filter"
          >
            <option value="all">All Financial Years</option>
            {allFYs.map(fy => <option key={fy} value={fy}>{fy}</option>)}
          </select>
          <div className="flex gap-1">
            <Button size="sm" variant={viewMode === 'fy' ? 'default' : 'ghost'} onClick={() => setViewMode('fy')} data-testid="button-view-fy">By FY</Button>
            <Button size="sm" variant={viewMode === 'monthly' ? 'default' : 'ghost'} onClick={() => setViewMode('monthly')} data-testid="button-view-monthly">Monthly</Button>
            <Button size="sm" variant={viewMode === 'weekly' ? 'default' : 'ghost'} onClick={() => setViewMode('weekly')} data-testid="button-view-weekly">Weekly</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Inflows</p>
            <p className="text-lg font-bold text-green-600" data-testid="text-total-inflows">{formatRand(filteredTotals.inflows)}</p>
            <p className="text-[10px] text-muted-foreground">Confirmed: {formatRand(filteredTotals.confirmedInflows)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Outflows</p>
            <p className="text-lg font-bold text-red-600" data-testid="text-total-outflows">{formatRand(filteredTotals.outflows)}</p>
            <p className="text-[10px] text-muted-foreground">Confirmed: {formatRand(filteredTotals.confirmedOutflows)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Net Cashflow</p>
            <p className={`text-lg font-bold ${filteredTotals.cashflow >= 0 ? 'text-green-600' : 'text-red-600'}`} data-testid="text-net-cashflow">{formatRand(filteredTotals.cashflow)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Invoiced Payments</p>
            <p className="text-lg font-bold text-blue-600" data-testid="text-invoiced-payments">{formatRand(filteredTotals.invoicedPayments)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Outstanding Outflows</p>
            <p className="text-lg font-bold text-amber-600" data-testid="text-outstanding-outflows">{formatRand(filteredTotals.outflows - filteredTotals.confirmedOutflows)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cashflow Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={viewMode === 'weekly' ? -45 : 0} textAnchor={viewMode === 'weekly' ? 'end' : 'middle'} height={viewMode === 'weekly' ? 60 : 30} />
              <YAxis tickFormatter={(v: number) => formatRand(v)} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => formatRandExact(v)} />
              <Legend />
              <Bar dataKey="inflows" fill="#22c55e" name="Inflows" opacity={0.8} />
              <Bar dataKey="outflows" fill="#ef4444" name="Outflows" opacity={0.8} />
              <Line type="monotone" dataKey="cumulativeCashflow" stroke="#3b82f6" strokeWidth={2} name="Cumulative Cashflow" dot={false} />
              <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cashflow Tracker</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="p-2 text-left font-semibold sticky left-0 bg-muted/50">Cashflow</th>
                  {displayData.map(d => (
                    <th key={d.label} className="p-2 text-right font-medium whitespace-nowrap text-xs">{d.label}</th>
                  ))}
                  <th className="p-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-muted/30 bg-green-50/50">
                  <td className="p-2 font-medium text-green-700 sticky left-0 bg-green-50/50">COS Inflows</td>
                  {displayData.map(d => (
                    <td key={d.label} className="p-2 text-right font-mono text-xs text-green-700">{d.inflows > 0 ? formatRandExact(d.inflows) : '-'}</td>
                  ))}
                  <td className="p-2 text-right font-mono text-xs font-bold text-green-700">{formatRandExact(filteredTotals.inflows)}</td>
                </tr>
                <tr className="border-b hover:bg-muted/30 bg-red-50/50">
                  <td className="p-2 font-medium text-red-700 sticky left-0 bg-red-50/50">COS Outflows</td>
                  {displayData.map(d => (
                    <td key={d.label} className="p-2 text-right font-mono text-xs text-red-700">{d.outflows > 0 ? formatRandExact(d.outflows) : '-'}</td>
                  ))}
                  <td className="p-2 text-right font-mono text-xs font-bold text-red-700">{formatRandExact(filteredTotals.outflows)}</td>
                </tr>
                <tr className="border-b hover:bg-muted/30 bg-emerald-50/70">
                  <td className="p-2 font-semibold text-emerald-800 sticky left-0 bg-emerald-50/70">Project Cashflow</td>
                  {displayData.map(d => (
                    <td key={d.label} className={`p-2 text-right font-mono text-xs font-semibold ${d.cashflow >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {d.inflows > 0 || d.outflows > 0 ? formatRandExact(d.cashflow) : '-'}
                    </td>
                  ))}
                  <td className={`p-2 text-right font-mono text-xs font-bold ${filteredTotals.cashflow >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatRandExact(filteredTotals.cashflow)}</td>
                </tr>
                <tr className="border-b hover:bg-muted/30 bg-orange-50/50">
                  <td className="p-2 font-medium text-orange-700 sticky left-0 bg-orange-50/50">Project Outflows</td>
                  {displayData.map(d => (
                    <td key={d.label} className="p-2 text-right font-mono text-xs text-orange-700">{d.confirmedOutflows > 0 ? formatRandExact(d.confirmedOutflows) : '-'}</td>
                  ))}
                  <td className="p-2 text-right font-mono text-xs font-bold text-orange-700">{formatRandExact(filteredTotals.confirmedOutflows)}</td>
                </tr>
                <tr className="border-b hover:bg-muted/30">
                  <td className="p-2 font-medium text-blue-700 sticky left-0 bg-white">Invoiced Payments</td>
                  {displayData.map(d => (
                    <td key={d.label} className="p-2 text-right font-mono text-xs text-blue-700">{d.invoicedPayments > 0 ? formatRandExact(d.invoicedPayments) : '-'}</td>
                  ))}
                  <td className="p-2 text-right font-mono text-xs font-bold text-blue-700">{formatRandExact(filteredTotals.invoicedPayments)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
