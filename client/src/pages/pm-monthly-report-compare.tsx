import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import DeltaIndicator from "@/components/reports/DeltaIndicator";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-ZA", { month: "short", year: "numeric" });
    options.push({ value, label });
  }
  return options;
}

export default function PmMonthlyReportCompare() {
  const [, navigate] = useLocation();
  // Use window.location on mount for initial params (works with wouter)
  const initParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const [monthA, setMonthA] = useState(() => initParams?.get("monthA") || getMonthOptions()[1]?.value || "");
  const [monthB, setMonthB] = useState(() => initParams?.get("monthB") || getMonthOptions()[0]?.value || "");
  const monthOptions = getMonthOptions();

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/reports/pm/monthly/compare", monthA, monthB],
    queryFn: async () => {
      const res = await fetch(`/api/reports/pm/monthly/compare?monthA=${monthA}&monthB=${monthB}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load comparison");
      }
      return res.json();
    },
    enabled: !!monthA && !!monthB && monthA !== monthB,
  });

  const kpisA = (data?.monthA?.data as any)?.kpis || {};
  const kpisB = (data?.monthB?.data as any)?.kpis || {};

  const compareMetrics = [
    { label: "Active Projects", a: kpisA.activeProjects, b: kpisB.activeProjects, higherIsBetter: true },
    { label: "Total Revenue", a: kpisA.totalRevenue, b: kpisB.totalRevenue, higherIsBetter: true, currency: true },
    { label: "Total Cost", a: kpisA.totalCost, b: kpisB.totalCost, higherIsBetter: false, currency: true },
    { label: "GP Margin %", a: kpisA.blendedGpMarginPct, b: kpisB.blendedGpMarginPct, higherIsBetter: true, pct: true },
    { label: "Projects at Risk", a: kpisA.projectsAtRisk, b: kpisB.projectsAtRisk, higherIsBetter: false },
    { label: "Avg Health Score", a: kpisA.avgHealthScore, b: kpisB.avgHealthScore, higherIsBetter: true },
  ];

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/reports/pm/monthly")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-2xl font-bold">PM Report — Month Comparison</h1>
      </div>

      <div className="flex items-center gap-3">
        <Select value={monthA} onValueChange={setMonthA}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Month A" /></SelectTrigger>
          <SelectContent>{monthOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-muted-foreground">vs</span>
        <Select value={monthB} onValueChange={setMonthB}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Month B" /></SelectTrigger>
          <SelectContent>{monthOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {monthA === monthB && <p className="text-sm text-amber-600">Select two different months to compare.</p>}

      {isLoading && (
        <div className="flex items-center justify-center min-h-[30vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}

      {data && (
        <Card>
          <CardHeader><CardTitle className="text-sm">KPI Comparison</CardTitle></CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Metric</th>
                    <th className="text-right px-3 py-2 font-medium">{monthA}</th>
                    <th className="text-right px-3 py-2 font-medium">{monthB}</th>
                    <th className="text-right px-3 py-2 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {compareMetrics.map((m, i) => {
                    const a = m.a ?? 0;
                    const b = m.b ?? 0;
                    const delta = b - a;
                    const fmtVal = (v: number) => {
                      if (m.currency) return `R ${v.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
                      if (m.pct) return `${v.toFixed(1)}%`;
                      return String(Math.round(v));
                    };
                    return (
                      <tr key={i} className="border-b hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">{m.label}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtVal(a)}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtVal(b)}</td>
                        <td className="px-3 py-2 text-right">
                          <DeltaIndicator value={delta} higherIsBetter={m.higherIsBetter} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
