import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Line, LineChart, ResponsiveContainer } from "recharts";

export type FinancialTile = {
  key: string;
  label: string;
  plan: number;
  actual: number;
  forecast: number;
  trend: Array<{ month: string; value: number }>;
};

export type FinancialSummaryResponse = { period: string; metrics: FinancialTile[] };

const PERIODS = ["ytd", "current_fy", "this_month", "last_month", "custom"] as const;

const money = (n: number) => `R ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function FinancialSummaryTiles({ data, onPeriodChange, loading }: { data?: FinancialSummaryResponse; onPeriodChange: (period: string) => void; loading: boolean }) {
  const [period, setPeriod] = useState<string>("ytd");

  const rows = useMemo(() => data?.metrics || [], [data]);

  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Financial Summary</h3>
          <Tabs value={period} onValueChange={(value) => { setPeriod(value); onPeriodChange(value); }}>
            <TabsList>
              {PERIODS.map((p) => <TabsTrigger key={p} value={p}>{p.replace("_", " ")}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>

        {loading ? <Skeleton className="h-36 w-full" /> : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {rows.map((row) => {
              const variance = row.actual - row.plan;
              const variancePct = row.plan ? (variance / row.plan) * 100 : 0;
              const overBudget = variance > 0;
              return (
                <div key={row.key} className="rounded-lg border p-4 shadow-sm">
                  <p className="text-sm text-muted-foreground">{row.label}</p>
                  <p className="text-3xl font-bold mt-1">{money(row.actual)}</p>
                  <div className="text-xs mt-2 space-y-1">
                    <p>Plan: {money(row.plan)}</p>
                    <p>Forecast: {money(row.forecast)}</p>
                    <p className={overBudget ? "text-red-600" : "text-green-600"}>Δ {money(Math.abs(variance))} ({Math.abs(variancePct).toFixed(1)}%)</p>
                  </div>
                  <div className="h-12 mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={row.trend}>
                        <Line type="monotone" dataKey="value" stroke={overBudget ? "#ef4444" : "#22c55e"} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
