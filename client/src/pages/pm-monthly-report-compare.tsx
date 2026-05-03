import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import DeltaIndicator from "@/components/reports/DeltaIndicator";
import { PageHeader } from "@/components/ui/page-header";
import { QueryLoading, QueryError } from "@/components/ui/query-states";
import { PageLayout } from "@/components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
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

  const { data, isLoading, isError, error, refetch } = useQuery({
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
    <PageLayout
      data-testid="pm-monthly-report-compare-page"
      header={
        <PageHeader
          title="PM Report — Month Comparison"
          subtitle={monthA && monthB && monthA !== monthB ? `Comparing ${monthA} vs ${monthB}` : "Select two different months"}
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/reports/pm/monthly")}
              data-testid="btn-back-pm-monthly"
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          }
        />
      }
    >
      <div className="flex items-center gap-3">
        <Select value={monthA} onValueChange={setMonthA}>
          <SelectTrigger className="w-[180px]" data-testid="select-month-a"><SelectValue placeholder="Month A" /></SelectTrigger>
          <SelectContent>{monthOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-muted-foreground">vs</span>
        <Select value={monthB} onValueChange={setMonthB}>
          <SelectTrigger className="w-[180px]" data-testid="select-month-b"><SelectValue placeholder="Month B" /></SelectTrigger>
          <SelectContent>{monthOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {monthA === monthB && <p className="text-sm text-amber-600">Select two different months to compare.</p>}

      {isLoading && <QueryLoading />}
      {isError && <QueryError error={error} onRetry={() => refetch()} />}

      {data && (
        <Card>
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold mb-3">KPI Comparison</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">{monthA}</TableHead>
                  <TableHead className="text-right">{monthB}</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
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
                    <TableRow key={i} data-testid={`row-metric-${i}`}>
                      <TableCell className="font-medium">{m.label}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{fmtVal(a)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{fmtVal(b)}</TableCell>
                      <TableCell className="text-right">
                        <DeltaIndicator value={delta} higherIsBetter={m.higherIsBetter} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageLayout>
  );
}
