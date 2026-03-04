import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest, invalidateDashboardQueries } from "@/lib/queryClient";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  Target,
  Activity,
} from "lucide-react";

interface MonthData {
  monthKey: string;
  monthLabel: string;
  planned: number;
  realised: number;
  outstanding: number;
  budget: number;
  variance: number;
  variancePct: number;
  ytdPlanned: number;
  ytdRealised: number;
  ytdOutstanding: number;
  ytdBudget: number;
  ytdVariance: number;
  ytdVariancePct: number;
}

function formatRand(val: number | null | undefined): string {
  if (val == null) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

type EditableField = "realised" | "outstanding" | "budget";

interface EditingCell {
  field: EditableField;
  monthKey: string;
  value: string;
}

const ROW_DEFS: {
  key: string;
  label: string;
  dataKey: keyof MonthData;
  editable: boolean;
  colorClass: string;
  group: "monthly" | "ytd";
  colorCoded?: boolean;
}[] = [
  { key: "planned", label: "Planned", dataKey: "planned", editable: false, colorClass: "text-blue-600", group: "monthly" },
  { key: "realised", label: "Realised", dataKey: "realised", editable: true, colorClass: "text-green-600", group: "monthly" },
  { key: "outstanding", label: "Outstanding", dataKey: "outstanding", editable: true, colorClass: "text-amber-600", group: "monthly" },
  { key: "budget", label: "Costed", dataKey: "budget", editable: true, colorClass: "text-purple-600", group: "monthly" },
  { key: "variance", label: "Variance", dataKey: "variance", editable: false, colorClass: "", group: "monthly", colorCoded: true },
  { key: "variancePct", label: "Variance %", dataKey: "variancePct", editable: false, colorClass: "", group: "monthly", colorCoded: true },
  { key: "ytdPlanned", label: "YTD Planned", dataKey: "ytdPlanned", editable: false, colorClass: "text-blue-600", group: "ytd" },
  { key: "ytdRealised", label: "YTD Realised", dataKey: "ytdRealised", editable: false, colorClass: "text-green-600", group: "ytd" },
  { key: "ytdOutstanding", label: "YTD Outstanding", dataKey: "ytdOutstanding", editable: false, colorClass: "text-amber-600", group: "ytd" },
  { key: "ytdBudget", label: "YTD Costed", dataKey: "ytdBudget", editable: false, colorClass: "text-purple-600", group: "ytd" },
  { key: "ytdVariance", label: "YTD Variance", dataKey: "ytdVariance", editable: false, colorClass: "", group: "ytd", colorCoded: true },
  { key: "ytdVariancePct", label: "YTD Variance %", dataKey: "ytdVariancePct", editable: false, colorClass: "", group: "ytd", colorCoded: true },
];

export default function RevenueTracker() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EditingCell | null>(null);

  const { data: months = [], isLoading } = useQuery<MonthData[]>({
    queryKey: ["/api/rev-tracker"],
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async (body: { trackerType: string; monthKey: string; realised?: string; outstanding?: string; budget?: string }) => {
      await apiRequest("POST", "/api/tracker-monthly", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/rev-tracker"] });
      invalidateDashboardQueries(qc);
    },
  });

  const lastMonth = useMemo(() => {
    if (!months.length) return null;
    return months[months.length - 1];
  }, [months]);

  const startEdit = useCallback((field: EditableField, monthKey: string, currentValue: number) => {
    setEditing({ field, monthKey, value: String(currentValue) });
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const payload: Record<string, string> = {
      trackerType: "REV",
      monthKey: editing.monthKey,
    };
    payload[editing.field] = editing.value;
    mutation.mutate(payload as any);
    setEditing(null);
  }, [editing, mutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitEdit();
      if (e.key === "Escape") setEditing(null);
    },
    [commitEdit],
  );

  const chartData = useMemo(
    () =>
      months.map((m) => ({
        month: m.monthLabel,
        Planned: m.planned,
        Realised: m.realised,
        Costed: m.budget,
        "YTD Variance": m.ytdVariance,
      })),
    [months],
  );

  const getCellColor = (val: number) => (val >= 0 ? "text-green-600" : "text-red-600");

  const formatCell = (row: (typeof ROW_DEFS)[number], val: number) => {
    if (row.key === "variancePct" || row.key === "ytdVariancePct") {
      return `${(val * 100).toFixed(1)}%`;
    }
    return formatRand(val);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground" data-testid="loading-indicator">
        Loading revenue data…
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <div className="bg-card border-b border-border px-6 py-6">
        <h2 className="text-3xl font-heading font-bold text-foreground" data-testid="text-page-title">
          Revenue Tracker FY26
        </h2>
        <p className="text-muted-foreground mt-1" data-testid="text-page-subtitle">
          Monthly revenue tracking with planned vs costed analysis
        </p>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-ytd-planned">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-100 p-2">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">YTD Revenue (Planned)</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-ytd-planned-value">
                    {formatRand(lastMonth?.ytdPlanned ?? 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-ytd-realised">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-green-100 p-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">YTD Revenue (Realised)</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-ytd-realised-value">
                    {formatRand(lastMonth?.ytdRealised ?? 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-ytd-budget">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-100 p-2">
                  <Target className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">YTD Costed</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-ytd-budget-value">
                    {formatRand(lastMonth?.ytdBudget ?? 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-ytd-variance">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${(lastMonth?.ytdVariance ?? 0) >= 0 ? "bg-green-100" : "bg-red-100"}`}>
                  <Activity className={`h-5 w-5 ${(lastMonth?.ytdVariance ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">YTD Variance</p>
                  <p
                    className={`text-2xl font-bold font-mono ${(lastMonth?.ytdVariance ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}
                    data-testid="text-ytd-variance-value"
                  >
                    {formatRand(lastMonth?.ytdVariance ?? 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Monthly Revenue Grid</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-revenue-grid">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left font-semibold min-w-[160px]">
                      Metric
                    </th>
                    {months.map((m) => (
                      <th key={m.monthKey} className="px-4 py-3 text-right font-semibold whitespace-nowrap min-w-[110px]">
                        {m.monthLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROW_DEFS.map((row) => {
                    const isYtd = row.group === "ytd";
                    return (
                      <tr
                        key={row.key}
                        className={`border-b ${isYtd ? "bg-muted" : "bg-card"} hover:bg-muted/30`}
                        data-testid={`row-${row.key}`}
                      >
                        <td className={`sticky left-0 z-10 px-4 py-2 font-medium ${isYtd ? "bg-muted" : "bg-card"}`}>
                          {row.label}
                        </td>
                        {months.map((m) => {
                          const val = m[row.dataKey] as number;
                          const isEditing =
                            editing?.field === row.key && editing?.monthKey === m.monthKey;

                          if (row.editable) {
                            return (
                              <td key={m.monthKey} className="px-2 py-1 text-right">
                                {isEditing ? (
                                  <Input
                                    type="number"
                                    className="h-8 w-full text-right font-mono text-sm"
                                    value={editing.value}
                                    onChange={(e) =>
                                      setEditing({ ...editing, value: e.target.value })
                                    }
                                    onBlur={commitEdit}
                                    onKeyDown={handleKeyDown}
                                    autoFocus
                                    data-testid={`input-${row.key}-${m.monthKey}`}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className={`w-full text-right font-mono cursor-pointer hover:bg-muted rounded px-2 py-1 ${row.colorClass}`}
                                    onClick={() =>
                                      startEdit(row.key as EditableField, m.monthKey, val)
                                    }
                                    data-testid={`cell-${row.key}-${m.monthKey}`}
                                  >
                                    {formatRand(val)}
                                  </button>
                                )}
                              </td>
                            );
                          }

                          const colorClass = row.colorCoded
                            ? getCellColor(val)
                            : row.colorClass;

                          return (
                            <td
                              key={m.monthKey}
                              className={`px-4 py-2 text-right font-mono ${colorClass}`}
                              data-testid={`cell-${row.key}-${m.monthKey}`}
                            >
                              {formatCell(row, val)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue Overview Chart</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[400px]" data-testid="chart-revenue">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis
                    tickFormatter={(v: number) => formatRand(v)}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    formatter={(value: number) => formatRand(value)}
                  />
                  <Legend />
                  <Bar dataKey="Planned" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Realised" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Costed" fill="#a855f7" radius={[4, 4, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="YTD Variance"
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
