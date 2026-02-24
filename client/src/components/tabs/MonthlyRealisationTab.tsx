import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";

interface MonthlyRealisationTabProps {
  projectName: string;
}

interface MonthlyRow {
  month: string;
  revenue: number;
  cos: number;
  margin: number;
  revenueConfirmed: boolean;
  cosConfirmed: boolean;
}

const formatCurrency = (amount: number) => {
  if (amount === 0) return "-";
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatMonth = (dateStr: string) => {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr + "-01");
    return d.toLocaleDateString("en-ZA", { year: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
};

export function MonthlyRealisationTab({ projectName }: MonthlyRealisationTabProps) {
  const { data: revenueData = [], isLoading: revLoading } = useQuery({
    queryKey: ["finance-revenue", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/finance/revenue?projectName=${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: cosData = [], isLoading: cosLoading } = useQuery({
    queryKey: ["finance-cos", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/finance/cos?projectName=${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const isLoading = revLoading || cosLoading;

  const { rows, totals } = useMemo(() => {
    const monthMap = new Map<string, MonthlyRow>();

    const revArr = Array.isArray(revenueData) ? revenueData : [];
    const cosArr = Array.isArray(cosData) ? cosData : [];

    for (const r of revArr) {
      const m = r.month || r.monthKey || "";
      if (!m) continue;
      const existing = monthMap.get(m) || { month: m, revenue: 0, cos: 0, margin: 0, revenueConfirmed: false, cosConfirmed: false };
      existing.revenue += parseFloat(r.amount || r.totalAmount || "0") || 0;
      existing.revenueConfirmed = existing.revenueConfirmed || !!(r.confirmed || r.isConfirmed);
      monthMap.set(m, existing);
    }

    for (const c of cosArr) {
      const m = c.month || c.monthKey || "";
      if (!m) continue;
      const existing = monthMap.get(m) || { month: m, revenue: 0, cos: 0, margin: 0, revenueConfirmed: false, cosConfirmed: false };
      existing.cos += parseFloat(c.amount || c.totalAmount || "0") || 0;
      existing.cosConfirmed = existing.cosConfirmed || !!(c.confirmed || c.isConfirmed);
      monthMap.set(m, existing);
    }

    const sorted = Array.from(monthMap.values())
      .map(r => ({ ...r, margin: r.revenue - r.cos }))
      .sort((a, b) => a.month.localeCompare(b.month));

    let cumulativeRevenue = 0;
    let cumulativeCos = 0;
    const withCumulative = sorted.map(r => {
      cumulativeRevenue += r.revenue;
      cumulativeCos += r.cos;
      return { ...r, cumulativeRevenue, cumulativeCos, cumulativeMargin: cumulativeRevenue - cumulativeCos };
    });

    const totalRevenue = sorted.reduce((s, r) => s + r.revenue, 0);
    const totalCos = sorted.reduce((s, r) => s + r.cos, 0);

    return {
      rows: withCumulative,
      totals: { revenue: totalRevenue, cos: totalCos, margin: totalRevenue - totalCos },
    };
  }, [revenueData, cosData]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loading-realisation" />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <p className="text-center text-muted-foreground" data-testid="no-realisation-data">
            No monthly realisation data available. Import a tracker file with Finance-Revenue and Finance-COS sheets to populate this view.
          </p>
        </CardContent>
      </Card>
    );
  }

  const marginPct = totals.revenue > 0 ? ((totals.margin / totals.revenue) * 100).toFixed(1) : "0.0";

  return (
    <div className="space-y-4" data-testid="monthly-realisation-tab">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="text-lg font-bold text-green-700" data-testid="total-revenue">{formatCurrency(totals.revenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Cost of Sales</p>
            <p className="text-lg font-bold text-red-700" data-testid="total-cos">{formatCurrency(totals.cos)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Net Margin</p>
            <p className={`text-lg font-bold ${totals.margin >= 0 ? "text-green-700" : "text-red-700"}`} data-testid="total-margin">{formatCurrency(totals.margin)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Margin %</p>
            <p className={`text-lg font-bold ${totals.margin >= 0 ? "text-green-700" : "text-red-700"}`} data-testid="margin-pct">{marginPct}%</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Monthly Realisation Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Month</TableHead>
                  <TableHead className="text-xs text-right">Revenue</TableHead>
                  <TableHead className="text-xs text-right">COS</TableHead>
                  <TableHead className="text-xs text-right">Margin</TableHead>
                  <TableHead className="text-xs text-right">Cumulative Rev</TableHead>
                  <TableHead className="text-xs text-right">Cumulative COS</TableHead>
                  <TableHead className="text-xs text-right">Cumulative Margin</TableHead>
                  <TableHead className="text-xs text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={row.month} data-testid={`realisation-row-${idx}`}>
                    <TableCell className="text-xs font-medium">{formatMonth(row.month)}</TableCell>
                    <TableCell className="text-xs text-right font-mono text-green-700">{formatCurrency(row.revenue)}</TableCell>
                    <TableCell className="text-xs text-right font-mono text-red-700">{formatCurrency(row.cos)}</TableCell>
                    <TableCell className={`text-xs text-right font-mono ${row.margin >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {formatCurrency(row.margin)}
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono text-muted-foreground">{formatCurrency(row.cumulativeRevenue)}</TableCell>
                    <TableCell className="text-xs text-right font-mono text-muted-foreground">{formatCurrency(row.cumulativeCos)}</TableCell>
                    <TableCell className={`text-xs text-right font-mono ${row.cumulativeMargin >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {formatCurrency(row.cumulativeMargin)}
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      {row.margin > 0 ? (
                        <Badge variant="outline" className="text-green-600 border-green-200 gap-1">
                          <TrendingUp className="h-3 w-3" /> Positive
                        </Badge>
                      ) : row.margin < 0 ? (
                        <Badge variant="outline" className="text-red-600 border-red-200 gap-1">
                          <TrendingDown className="h-3 w-3" /> Negative
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground gap-1">Even</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold border-t-2">
                  <TableCell className="text-xs">Total</TableCell>
                  <TableCell className="text-xs text-right font-mono text-green-700">{formatCurrency(totals.revenue)}</TableCell>
                  <TableCell className="text-xs text-right font-mono text-red-700">{formatCurrency(totals.cos)}</TableCell>
                  <TableCell className={`text-xs text-right font-mono ${totals.margin >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {formatCurrency(totals.margin)}
                  </TableCell>
                  <TableCell colSpan={4}></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
