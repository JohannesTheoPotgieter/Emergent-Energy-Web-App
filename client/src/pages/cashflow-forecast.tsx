import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Line, ReferenceLine,
} from "recharts";
import {
  Calendar, ChevronRight, X, Edit2, TrendingUp, TrendingDown,
} from "lucide-react";
import ScenarioSelector from "@/components/ScenarioSelector";

function formatRand(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

const confidenceColors: Record<string, string> = {
  High: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  Low: "bg-red-100 text-red-700",
};

interface ScenarioWeek {
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
  baselineClosingBalance: number;
  baselineInflowsTotal: number;
  baselineOutflowsTotal: number;
  deltaInflows: number;
  deltaOutflows: number;
  deltaClosingBalance: number;
}

interface WeekLineItem {
  id: number;
  type: string;
  projectName: string;
  description: string;
  amount: number;
  actualDate: string | null;
  forecastDate: string | null;
  effectiveDate: string;
  invoiceNumber: string | null;
  poNumber: string | null;
  category: string | null;
  supplierName: string | null;
  confidence: string;
  hasOverride: boolean;
  originalDate: string | null;
}

function DateEditDialog({ open, onClose, item, scenarioId }: {
  open: boolean;
  onClose: () => void;
  item: WeekLineItem | null;
  scenarioId: number;
}) {
  const [newDate, setNewDate] = useState("");
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const entityType = item.type === 'inflow' ? 'inflow_line' : 'expense_line';
      const fieldName = item.type === 'inflow' ? 'receipt_date' : 'payment_date';
      await apiRequest("POST", `/api/scenarios/${scenarioId}/overrides`, {
        entityType,
        entityId: String(item.id),
        fieldName,
        originalDate: item.originalDate,
        overrideDate: newDate,
        reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      onClose();
      setNewDate("");
      setReason("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {item?.type === 'inflow' ? 'Receipt' : 'Payment'} Date</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Line</label>
            <p className="text-sm text-muted-foreground">{item?.description}</p>
            <p className="text-xs text-muted-foreground">{item?.projectName} | {formatRand(item?.amount)}</p>
          </div>
          <div>
            <label className="text-sm font-medium">Current Date</label>
            <p className="text-sm text-muted-foreground">{item?.effectiveDate || 'None'}</p>
          </div>
          <div>
            <label className="text-sm font-medium">New Date</label>
            <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} data-testid="input-forecast-date" />
          </div>
          <div>
            <label className="text-sm font-medium">Reason</label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this date changing?" data-testid="input-forecast-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!newDate || !reason || saveMutation.isPending} data-testid="button-save-forecast-override">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WeekDetailPanel({ weekStart, weekEnd, weekLabel, scenarioId, onClose }: {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  scenarioId: number | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<{
    lines: WeekLineItem[];
    total: number;
    inflowTotal: number;
    outflowTotal: number;
    inflowCount: number;
    outflowCount: number;
  }>({
    queryKey: [`/api/cashflow-forecast/scenario-week-detail?weekStart=${weekStart}&weekEnd=${weekEnd}&scenarioId=${scenarioId || ''}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const [editItem, setEditItem] = useState<WeekLineItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const inflows = useMemo(() => {
    let items = (data?.lines ?? []).filter(l => l.type === 'inflow');
    if (searchTerm) items = items.filter(l => 
      l.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.invoiceNumber || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
    return items;
  }, [data, searchTerm]);

  const outflows = useMemo(() => {
    let items = (data?.lines ?? []).filter(l => l.type === 'outflow');
    if (searchTerm) items = items.filter(l =>
      l.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.invoiceNumber || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
    return items;
  }, [data, searchTerm]);

  return (
    <>
      <div className="fixed right-0 top-0 h-full w-[420px] bg-background border-l shadow-lg z-50 flex flex-col" data-testid="week-detail-panel">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-bold">Week of {weekLabel}</h3>
              <p className="text-xs text-muted-foreground">{weekStart} to {weekEnd}</p>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-muted rounded" data-testid="button-close-detail">
              <X className="h-5 w-5" />
            </button>
          </div>
          <Input
            placeholder="Search lines..."
            className="h-7 text-xs"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            data-testid="input-week-search"
          />
          {data && (
            <div className="flex gap-4 mt-2 text-xs">
              <span className="text-green-600">Inflows: {data.inflowCount} | {formatRand(data.inflowTotal)}</span>
              <span className="text-red-600">Outflows: {data.outflowCount} | {formatRand(data.outflowTotal)}</span>
            </div>
          )}
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
                    {inflows.map(line => (
                      <div key={`in-${line.id}`} className={`border rounded p-2 text-xs space-y-1 ${line.hasOverride ? 'border-amber-300 bg-amber-50/30' : ''}`}>
                        <div className="flex justify-between items-start">
                          <span className="font-medium truncate max-w-[200px]">{line.projectName}</span>
                          <span className="font-mono font-bold text-green-600">{formatRand(line.amount)}</span>
                        </div>
                        <p className="text-muted-foreground">{line.description}</p>
                        <div className="flex gap-2 items-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${confidenceColors[line.confidence] || ''}`}>
                            {line.confidence}
                          </span>
                          {line.hasOverride && <span className="text-amber-600 text-[10px]">overridden</span>}
                          {scenarioId && (
                            <Button size="sm" variant="ghost" className="h-5 px-1 ml-auto" onClick={() => setEditItem(line)} data-testid={`button-edit-inflow-${line.id}`}>
                              <Edit2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
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
                    {outflows.map(line => (
                      <div key={`out-${line.id}`} className={`border rounded p-2 text-xs space-y-1 ${line.hasOverride ? 'border-amber-300 bg-amber-50/30' : ''}`}>
                        <div className="flex justify-between items-start">
                          <span className="font-medium truncate max-w-[200px]">{line.projectName}</span>
                          <span className="font-mono font-bold text-red-600">{formatRand(line.amount)}</span>
                        </div>
                        <p className="text-muted-foreground">{line.description}</p>
                        <div className="flex gap-2 items-center flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${confidenceColors[line.confidence] || ''}`}>
                            {line.confidence}
                          </span>
                          {line.supplierName && <span className="text-muted-foreground">{line.supplierName}</span>}
                          {line.invoiceNumber && <span className="text-muted-foreground">Inv: {line.invoiceNumber}</span>}
                          {line.hasOverride && <span className="text-amber-600 text-[10px]">overridden</span>}
                          {scenarioId && (
                            <Button size="sm" variant="ghost" className="h-5 px-1 ml-auto" onClick={() => setEditItem(line)} data-testid={`button-edit-outflow-${line.id}`}>
                              <Edit2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {editItem && scenarioId && (
        <DateEditDialog open={!!editItem} onClose={() => setEditItem(null)} item={editItem} scenarioId={scenarioId} />
      )}
    </>
  );
}

export default function CashflowForecastPage() {
  const [scenarioId, setScenarioId] = useState<number | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<ScenarioWeek | null>(null);
  const [weeksToShow, setWeeksToShow] = useState(26);
  const [showReconciliation, setShowReconciliation] = useState(false);

  const { data, isLoading } = useQuery<{ weeks: ScenarioWeek[] }>({
    queryKey: [`/api/cashflow-forecast/scenario-weekly?scenarioId=${scenarioId || ''}`],
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
    const result = { inflowsActual: 0, inflowsForecast: 0, outflowsActual: 0, outflowsForecast: 0, deltaInflows: 0, deltaOutflows: 0, deltaBalance: 0 };
    for (const w of weeks.slice(0, weeksToShow)) {
      result.inflowsActual += w.inflowsActual;
      result.inflowsForecast += w.inflowsForecast;
      result.outflowsActual += w.outflowsActual;
      result.outflowsForecast += w.outflowsForecast;
      result.deltaInflows += w.deltaInflows;
      result.deltaOutflows += w.deltaOutflows;
    }
    const lastWeek = weeks[Math.min(weeksToShow - 1, weeks.length - 1)];
    result.deltaBalance = lastWeek?.deltaClosingBalance ?? 0;
    return result;
  }, [weeks, weeksToShow]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-heading font-bold">Cashflow Forecast</h2>
        <div className="p-12 text-center text-muted-foreground">Loading forecast data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="cashflow-forecast-page">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-heading font-bold">Cashflow Forecast</h2>
          <p className="text-sm text-muted-foreground">Weekly line-item forecast — edit dates, see cashflow impact</p>
        </div>
        <div className="flex gap-3 items-center">
          <ScenarioSelector selectedScenarioId={scenarioId} onScenarioChange={setScenarioId} />
          <div className="flex gap-1 items-center">
            {[13, 26, 39, 52].map(n => (
              <button
                key={n}
                data-testid={`button-weeks-${n}`}
                className={`px-2 py-1 rounded text-xs ${weeksToShow === n ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                onClick={() => setWeeksToShow(n)}
              >
                {n}w
              </button>
            ))}
          </div>
        </div>
      </div>

      {!scenarioId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          Viewing baseline. Create a scenario to edit dates and see cashflow impact.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Inflows (Actual)</p>
            <p className="text-lg font-bold text-green-600">{formatRand(totals.inflowsActual)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Inflows (Forecast)</p>
            <p className="text-lg font-bold text-green-400">{formatRand(totals.inflowsForecast)}</p>
            {scenarioId && totals.deltaInflows !== 0 && (
              <p className={`text-xs ${totals.deltaInflows > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totals.deltaInflows > 0 ? '+' : ''}{formatRand(totals.deltaInflows)} vs baseline
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Outflows (Actual)</p>
            <p className="text-lg font-bold text-red-600">{formatRand(totals.outflowsActual)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Outflows (Forecast)</p>
            <p className="text-lg font-bold text-red-400">{formatRand(totals.outflowsForecast)}</p>
            {scenarioId && totals.deltaOutflows !== 0 && (
              <p className={`text-xs ${totals.deltaOutflows < 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totals.deltaOutflows > 0 ? '+' : ''}{formatRand(totals.deltaOutflows)} vs baseline
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <CardTitle className="text-sm">Weekly Cashflow</CardTitle>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowReconciliation(!showReconciliation)} data-testid="button-toggle-reconciliation">
              {showReconciliation ? 'Hide' : 'Show'} Reconciliation
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} interval={Math.floor(weeksToShow / 12)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatRand(v)} />
                <Tooltip formatter={(value: number) => formatRand(value)} labelFormatter={(label: string) => `Week of ${label}`} />
                <Legend />
                <Bar dataKey="inflowTotal" name="Inflows" fill="#22c55e" opacity={0.7} />
                <Bar dataKey="outflowTotal" name="Outflows" fill="#ef4444" opacity={0.7} />
                <Line dataKey="closingBalance" name="Balance" stroke="#3b82f6" strokeWidth={2} dot={false} />
                {scenarioId && (
                  <Line dataKey="baselineClosingBalance" name="Baseline Balance" stroke="#9ca3af" strokeWidth={1} strokeDasharray="5 5" dot={false} />
                )}
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Weekly Grid</CardTitle>
          <p className="text-xs text-muted-foreground">Click any week to drill down and edit line-item dates</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background z-10 border-b">
                <tr>
                  <th className="p-2 text-left">Week</th>
                  <th className="p-2 text-right">Inflows</th>
                  <th className="p-2 text-right">Outflows</th>
                  <th className="p-2 text-right">Net</th>
                  <th className="p-2 text-right">Balance</th>
                  {scenarioId && (
                    <>
                      <th className="p-2 text-right text-amber-600">Δ Inflows</th>
                      <th className="p-2 text-right text-amber-600">Δ Outflows</th>
                      <th className="p-2 text-right text-amber-600">Δ Balance</th>
                    </>
                  )}
                  <th className="p-2 text-center">Lines</th>
                  <th className="p-2 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {weeks.slice(0, weeksToShow).map(week => {
                  const inflowTotal = week.inflowsActual + week.inflowsForecast;
                  const outflowTotal = week.outflowsActual + week.outflowsForecast;
                  const net = inflowTotal - outflowTotal;
                  const hasActivity = week.inflowLineCount + week.outflowLineCount > 0;
                  const hasDelta = scenarioId && (week.deltaInflows !== 0 || week.deltaOutflows !== 0);

                  return (
                    <tr
                      key={week.weekStart}
                      data-testid={`cashflow-week-${week.weekStart}`}
                      className={`border-b cursor-pointer transition-colors ${
                        selectedWeek?.weekStart === week.weekStart ? 'bg-primary/5' : 'hover:bg-muted/50'
                      } ${!hasActivity ? 'opacity-50' : ''} ${hasDelta ? 'bg-amber-50/30' : ''}`}
                      onClick={() => hasActivity && setSelectedWeek(week)}
                    >
                      <td className="p-2 font-medium text-xs whitespace-nowrap">{week.weekLabel}</td>
                      <td className="p-2 text-right font-mono text-xs text-green-600">
                        {inflowTotal > 0 ? formatRand(inflowTotal) : '-'}
                      </td>
                      <td className="p-2 text-right font-mono text-xs text-red-600">
                        {outflowTotal > 0 ? formatRand(outflowTotal) : '-'}
                      </td>
                      <td className={`p-2 text-right font-mono text-xs font-medium ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {hasActivity ? formatRand(net) : '-'}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">{formatRand(week.closingBalance)}</td>
                      {scenarioId && (
                        <>
                          <td className={`p-2 text-right font-mono text-xs ${week.deltaInflows > 0 ? 'text-green-600' : week.deltaInflows < 0 ? 'text-red-600' : ''}`}>
                            {week.deltaInflows !== 0 ? (week.deltaInflows > 0 ? '+' : '') + formatRand(week.deltaInflows) : '-'}
                          </td>
                          <td className={`p-2 text-right font-mono text-xs ${week.deltaOutflows < 0 ? 'text-green-600' : week.deltaOutflows > 0 ? 'text-red-600' : ''}`}>
                            {week.deltaOutflows !== 0 ? (week.deltaOutflows > 0 ? '+' : '') + formatRand(week.deltaOutflows) : '-'}
                          </td>
                          <td className={`p-2 text-right font-mono text-xs ${week.deltaClosingBalance > 0 ? 'text-green-600' : week.deltaClosingBalance < 0 ? 'text-red-600' : ''}`}>
                            {week.deltaClosingBalance !== 0 ? (week.deltaClosingBalance > 0 ? '+' : '') + formatRand(week.deltaClosingBalance) : '-'}
                          </td>
                        </>
                      )}
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

      {showReconciliation && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Reconciliation Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs space-y-1">
              <div className="flex justify-between">
                <span>Total weeks displayed</span>
                <span>{Math.min(weeksToShow, weeks.length)}</span>
              </div>
              <div className="flex justify-between">
                <span>Weeks with activity</span>
                <span>{weeks.slice(0, weeksToShow).filter(w => w.inflowLineCount + w.outflowLineCount > 0).length}</span>
              </div>
              <div className="flex justify-between">
                <span>Total inflow amount</span>
                <span className="text-green-600">{formatRand(totals.inflowsActual + totals.inflowsForecast)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total outflow amount</span>
                <span className="text-red-600">{formatRand(totals.outflowsActual + totals.outflowsForecast)}</span>
              </div>
              {scenarioId && (
                <>
                  <div className="border-t my-2" />
                  <div className="flex justify-between font-medium">
                    <span>Net delta vs baseline</span>
                    <span className={totals.deltaBalance > 0 ? 'text-green-600' : 'text-red-600'}>
                      {totals.deltaBalance > 0 ? '+' : ''}{formatRand(totals.deltaBalance)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedWeek && (
        <WeekDetailPanel
          weekStart={selectedWeek.weekStart}
          weekEnd={selectedWeek.weekEnd}
          weekLabel={selectedWeek.weekLabel}
          scenarioId={scenarioId}
          onClose={() => setSelectedWeek(null)}
        />
      )}
    </div>
  );
}
