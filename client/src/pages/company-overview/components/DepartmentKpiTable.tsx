import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  TableProperties,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import type { Department, DepartmentScore, KpiScore } from "@shared/config/kpi-registry";
import { ALL_DEPARTMENTS } from "@shared/config/kpi-registry";

function formatValue(kpi: KpiScore): string {
  if (kpi.actual == null) return "—";
  if (kpi.kpiName.includes("Revenue") || kpi.kpiName.includes("Cash") || kpi.kpiName.includes("COS") || kpi.kpiName.includes("Debtors") || kpi.kpiName.includes("Pipeline")) {
    return `R ${Number(kpi.actual).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (kpi.kpiName.includes("%") || kpi.kpiName.includes("Rate") || kpi.kpiName.includes("Compliance") || kpi.kpiName.includes("Completeness") || kpi.kpiName.includes("Margin")) {
    return `${Number(kpi.actual).toFixed(1)}%`;
  }
  if (kpi.kpiName.includes("Ageing") || kpi.kpiName.includes("Turnaround")) {
    return `${Math.round(kpi.actual)}d`;
  }
  return String(Math.round(kpi.actual));
}

export function DepartmentKpiTable({
  scores,
  isLoading,
}: {
  scores: DepartmentScore[] | null;
  isLoading: boolean;
}) {
  const [filterDept, setFilterDept] = useState<Department | "all">("all");

  const rows = useMemo(() => {
    if (!scores) return [];
    const all: Array<KpiScore & { department: Department }> = [];
    for (const ds of scores) {
      for (const kpi of ds.kpis) {
        all.push({ ...kpi, department: ds.department });
      }
    }

    const filtered = filterDept === "all" ? all : all.filter((r) => r.department === filterDept);

    // Sort by worst variance (lowest score first)
    return filtered.sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
  }, [scores, filterDept]);

  if (isLoading || !scores) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-5">
          <Skeleton className="h-5 w-40 mb-4" />
          {Array.from({ length: 6 }).map((_, j) => (
            <Skeleton key={j} className="h-8 w-full mb-1" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TableProperties className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Department KPIs</h3>
          </div>
          <div className="flex items-center gap-2">
            {/* Department filter */}
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value as Department | "all")}
              className="text-[11px] border rounded px-2 py-1 bg-background text-foreground"
            >
              <option value="all">All Departments</option>
              {ALL_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 px-1 font-medium text-muted-foreground">Department</th>
                <th className="text-left py-2 px-1 font-medium text-muted-foreground">KPI</th>
                <th className="text-right py-2 px-1 font-medium text-muted-foreground">Actual</th>
                <th className="text-right py-2 px-1 font-medium text-muted-foreground">Target</th>
                <th className="text-right py-2 px-1 font-medium text-muted-foreground">Score</th>
                <th className="text-center py-2 px-1 font-medium text-muted-foreground">Trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const scoreColor = row.score == null
                  ? "text-muted-foreground"
                  : row.score >= 85 ? "text-emerald-600"
                  : row.score >= 70 ? "text-amber-600"
                  : "text-red-600";

                return (
                  <tr key={`${row.department}-${row.kpiKey}`} className="border-b border-border/20 hover:bg-muted/30">
                    <td className="py-1.5 px-1">
                      <span className="text-[10px] text-muted-foreground">{row.department}</span>
                    </td>
                    <td className="py-1.5 px-1">
                      <span className="text-xs text-foreground">{row.kpiName}</span>
                      {row.provisional && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 ml-1 border-amber-300 text-amber-600">P</Badge>
                      )}
                    </td>
                    <td className="py-1.5 px-1 text-right font-mono">{formatValue(row)}</td>
                    <td className="py-1.5 px-1 text-right font-mono text-muted-foreground">
                      {row.target != null ? formatValue({ ...row, actual: row.target }) : "—"}
                    </td>
                    <td className={`py-1.5 px-1 text-right font-mono font-semibold ${scoreColor}`}>
                      {row.score != null ? Math.round(row.score) : "—"}
                    </td>
                    <td className="py-1.5 px-1 text-center">
                      {row.trend === "up" && <ArrowUp className="w-3 h-3 text-emerald-600 inline" />}
                      {row.trend === "down" && <ArrowDown className="w-3 h-3 text-red-600 inline" />}
                      {row.trend === "flat" && <Minus className="w-3 h-3 text-muted-foreground inline" />}
                      {!row.trend && <Minus className="w-3 h-3 text-muted-foreground/30 inline" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">No KPI data available</p>
        )}
      </CardContent>
    </Card>
  );
}
