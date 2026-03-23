import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { format, parseISO } from "date-fns";

interface CashflowWeek {
  weekStart: string;
  weekEnd: string;
  openingBalance: number;
  computedOpening: number;
  hasManualOverride: boolean;
  balanceDelta: number;
  projectInflows: number;
  opexOutflows: number;
  computedOpex: number;
  hasOpexOverride: boolean;
  projectOutflows: number;
  pastDueUnpaid: number;
  closingBalance: number;
  availablePayment: number;
}

interface CashflowTabProps {
  projectName?: string;
  projectNames?: string[];
  title?: string;
}

function formatRand(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${abs.toFixed(0)}`;
}

function formatWeek(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "dd MMM");
  } catch {
    return dateStr;
  }
}

function isCurrentWeek(weekStart: string, weekEnd: string): boolean {
  const now = new Date();
  const start = parseISO(weekStart);
  const end = parseISO(weekEnd);
  return now >= start && now < end;
}

export function CashflowTab({ projectName, projectNames, title }: CashflowTabProps) {
  const filterParam = useMemo(() => {
    if (projectNames && projectNames.length > 0) return projectNames.join(",");
    if (projectName) return projectName;
    return undefined;
  }, [projectName, projectNames]);

  const { data: cashflowData = [], isLoading } = useQuery<CashflowWeek[]>({
    queryKey: ["/api/cashflow-2026", filterParam],
    queryFn: async () => {
      const url = filterParam
        ? `/api/cashflow-2026?project=${encodeURIComponent(filterParam)}`
        : "/api/cashflow-2026";
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to fetch cashflow data");
      return res.json();
    },
  });

  const chartData = useMemo(() => {
    return cashflowData.map((w) => ({
      week: formatWeek(w.weekStart),
      "Opening Balance": w.openingBalance,
      "Inflows": w.projectInflows,
      "Outflows": w.projectOutflows,
      "Closing Balance": w.closingBalance,
    }));
  }, [cashflowData]);

  const kpis = useMemo(() => {
    const totalInflows = cashflowData.reduce((s, w) => s + (w.projectInflows || 0), 0);
    const totalOutflows = cashflowData.reduce((s, w) => s + (w.projectOutflows || 0), 0);
    const now = new Date();
    const currentWeek = cashflowData.find((w) => {
      const start = parseISO(w.weekStart);
      const end = parseISO(w.weekEnd);
      return now >= start && now < end;
    });
    const currentWeekOpeningBalance =
      currentWeek?.openingBalance ?? (cashflowData.length > 0 ? cashflowData[0].openingBalance : 0);
    const lastWeek = cashflowData.length > 0 ? cashflowData[cashflowData.length - 1] : null;
    const forecastedEndOfFYPosition = lastWeek?.closingBalance ?? 0;
    return { totalInflows, totalOutflows, currentWeekOpeningBalance, forecastedEndOfFYPosition };
  }, [cashflowData]);

  const displayTitle = title || (projectName ? `Cashflow — ${projectName}` : "Cashflow FY26");

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (cashflowData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{displayTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">
            No cashflow data available
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="cashflow-tab-fy26">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiMini
          label="Total Inflows"
          value={formatRand(kpis.totalInflows)}
          icon={<TrendingUp className="h-4 w-4" />}
          color="green"
        />
        <KpiMini
          label="Total Outflows"
          value={formatRand(kpis.totalOutflows)}
          icon={<TrendingDown className="h-4 w-4" />}
          color="red"
        />
        <KpiMini
          label="Current Week Balance"
          value={formatRand(kpis.currentWeekOpeningBalance)}
          icon={<DollarSign className="h-4 w-4" />}
          color={kpis.currentWeekOpeningBalance >= 0 ? "blue" : "red"}
        />
        <KpiMini
          label="FY End Forecast"
          value={formatRand(kpis.forecastedEndOfFYPosition)}
          icon={kpis.forecastedEndOfFYPosition >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
          color={kpis.forecastedEndOfFYPosition >= 0 ? "green" : "red"}
        />
      </div>

      <Card className="border border-border shadow-sm rounded-xl overflow-hidden">
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-sm font-semibold text-foreground">{displayTitle}</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3">
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="week"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  angle={-45}
                  textAnchor="end"
                  height={55}
                  tick={{ fill: "#64748b" }}
                />
                <YAxis
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "#64748b" }}
                  tickFormatter={(val) => {
                    const abs = Math.abs(val);
                    if (abs >= 1_000_000) return `R${(val / 1_000_000).toFixed(1)}M`;
                    if (abs >= 1_000) return `R${(val / 1_000).toFixed(0)}K`;
                    return `R${val}`;
                  }}
                  width={65}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [formatRand(value), name]}
                  contentStyle={{
                    borderRadius: "10px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                    fontSize: "12px",
                    padding: "8px 12px",
                  }}
                  labelStyle={{ fontWeight: 600, marginBottom: 4, color: "#334155" }}
                />
                <Legend wrapperStyle={{ paddingTop: "8px", fontSize: "11px" }} iconType="circle" iconSize={8} />
                <Line type="monotone" dataKey="Opening Balance" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                <Line type="monotone" dataKey="Inflows" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                <Line type="monotone" dataKey="Outflows" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                <Line type="monotone" dataKey="Closing Balance" stroke="#8b5cf6" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border shadow-sm rounded-xl overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[50vh]">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-20">
                <tr className="bg-muted/80 border-b-2 border-border">
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider sticky left-0 bg-muted/80 z-30 min-w-[90px]">
                    Week
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[110px] bg-muted/80">
                    Opening Bal
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[110px] bg-muted/80">
                    Inflows
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[110px] bg-muted/80">
                    Outflows
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[110px] bg-muted/80">
                    Closing Bal
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider min-w-[120px] bg-muted/80">
                    Net Flow
                  </th>
                </tr>
              </thead>
              <tbody>
                {cashflowData.map((week, idx) => {
                  const current = isCurrentWeek(week.weekStart, week.weekEnd);
                  const isEven = idx % 2 === 0;
                  const netFlow = (week.projectInflows || 0) - (week.projectOutflows || 0);

                  return (
                    <tr
                      key={week.weekStart}
                      className={`border-b border-border transition-colors ${
                        current
                          ? "bg-blue-50/70 border-l-[3px] border-l-blue-500"
                          : isEven
                          ? "bg-card"
                          : "bg-muted/30"
                      } hover:bg-muted/60`}
                    >
                      <td
                        className={`px-4 py-2.5 font-medium text-foreground sticky left-0 z-10 ${
                          current ? "bg-blue-50/70" : isEven ? "bg-card" : "bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px]">{formatWeek(week.weekStart)}</span>
                          {current && (
                            <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
                              NOW
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[13px] text-blue-600">
                        {formatRand(week.openingBalance)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[13px] text-emerald-600">
                        {formatRand(week.projectInflows)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[13px]">
                        <span className="text-red-500">{formatRand(week.projectOutflows)}</span>
                        {(week.pastDueUnpaid || 0) > 0 && (
                          <div className="text-[10px] font-semibold text-red-700 bg-red-100 rounded px-1 py-0.5 mt-0.5 inline-block" title="Past-due outflows not yet confirmed out of bank">
                            {formatRand(week.pastDueUnpaid)} overdue
                          </div>
                        )}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono text-[13px] font-bold ${(week.closingBalance || 0) >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {formatRand(week.closingBalance)}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono text-[13px] font-semibold ${netFlow >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {formatRand(netFlow)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiMini({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: "green" | "red" | "blue";
}) {
  const colorMap = {
    green: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", iconBg: "bg-emerald-100", iconColor: "text-emerald-600" },
    red: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", iconBg: "bg-red-100", iconColor: "text-red-600" },
    blue: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", iconBg: "bg-blue-100", iconColor: "text-blue-600" },
  };
  const c = colorMap[color];
  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-3 flex items-center gap-2.5`}>
      <div className={`rounded-lg ${c.iconBg} p-2 ${c.iconColor}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</p>
        <p className={`text-base font-bold font-mono ${c.text} truncate`}>{value}</p>
      </div>
    </div>
  );
}
