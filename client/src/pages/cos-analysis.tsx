import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, CheckCircle2, MinusCircle, Pencil } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface EarnedRow {
  projectId: number;
  projectName: string;
  plannedExpenditure: number;
  pctComplete: number;
  toleranceBandPct: number;
  earned: number;
  invoiced: number;
  variance: number;
  variancePct: number;
  flag: "over_billed" | "in_line" | "under_billed";
}
interface EarnedResponse { rows: EarnedRow[]; defaultToleranceBandPct: number }
interface CounterpartyPoint { counterpartyId: number | null; counterpartyName: string; monthKey: string; amount: number }
interface CounterpartyResponse { months: number; points: CounterpartyPoint[] }

function formatZar(value: number): string {
  if (!Number.isFinite(value)) return "R 0";
  return `R ${Math.round(value).toLocaleString("en-ZA")}`;
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(value * 100).toFixed(1)}%`;
}

function flagBadge(flag: EarnedRow["flag"]) {
  switch (flag) {
    case "over_billed":
      return <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> Over-billed</Badge>;
    case "under_billed":
      return <Badge variant="secondary" className="gap-1"><MinusCircle className="w-3 h-3" /> Under-billed</Badge>;
    default:
      return <Badge variant="default" className="gap-1"><CheckCircle2 className="w-3 h-3" /> In line</Badge>;
  }
}

export default function CosAnalysisPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ projectId: number; bandPct: number } | null>(null);

  const earned = useQuery<EarnedResponse>({
    queryKey: ["finance", "analysis", "cos", "earned-vs-invoiced"],
    queryFn: () => fetch("/api/finance/analysis/cos/earned-vs-invoiced").then((r) => r.json()),
  });

  const counterparty = useQuery<CounterpartyResponse>({
    queryKey: ["finance", "analysis", "cos", "counterparty-trend"],
    queryFn: () => fetch("/api/finance/analysis/cos/counterparty-trend?months=6").then((r) => r.json()),
  });

  const updateTolerance = useMutation({
    mutationFn: async ({ projectId, bandPct }: { projectId: number; bandPct: number }) => {
      const res = await fetch(`/api/finance/analysis/tolerance/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bandPct }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Tolerance band updated" });
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["finance", "analysis", "cos", "earned-vs-invoiced"] });
    },
    onError: (err: any) => toast({ title: "Failed to update", description: String(err?.message ?? err), variant: "destructive" }),
  });

  const summary = useMemo(() => {
    const rows = earned.data?.rows ?? [];
    const totals = rows.reduce(
      (acc, r) => ({
        earned: acc.earned + r.earned,
        invoiced: acc.invoiced + r.invoiced,
        over: acc.over + (r.flag === "over_billed" ? 1 : 0),
        under: acc.under + (r.flag === "under_billed" ? 1 : 0),
      }),
      { earned: 0, invoiced: 0, over: 0, under: 0 },
    );
    return totals;
  }, [earned.data]);

  // Pivot counterparty trend → wide format for the chart.
  const trendChartData = useMemo(() => {
    if (!counterparty.data) return [];
    const months = Array.from(new Set(counterparty.data.points.map((p) => p.monthKey))).sort();
    const counterparties = Array.from(new Set(counterparty.data.points.map((p) => p.counterpartyName)));
    const top5 = counterparties
      .map((name) => ({
        name,
        total: counterparty.data!.points.filter((p) => p.counterpartyName === name).reduce((s, p) => s + p.amount, 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((c) => c.name);
    return months.map((month) => {
      const row: Record<string, string | number> = { month };
      for (const name of top5) {
        const found = counterparty.data!.points.find((p) => p.monthKey === month && p.counterpartyName === name);
        row[name] = found?.amount ?? 0;
      }
      return row;
    });
  }, [counterparty.data]);

  const trendKeys = trendChartData.length > 0 ? Object.keys(trendChartData[0]).filter((k) => k !== "month") : [];

  return (
    <FinanceShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight" data-testid="page-title">COS Analysis</h2>
          <p className="text-sm text-muted-foreground">
            Compares COS invoices against project plan progress. Per-project tolerance band determines the "in line" zone.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <KpiCard title="Total earned (to date)" value={formatZar(summary.earned)} loading={earned.isLoading} />
        <KpiCard title="Total invoiced" value={formatZar(summary.invoiced)} loading={earned.isLoading} />
        <KpiCard
          title="Projects over-billed"
          value={String(summary.over)}
          loading={earned.isLoading}
          accent={summary.over > 0 ? "danger" : undefined}
        />
        <KpiCard
          title="Projects under-billed"
          value={String(summary.under)}
          loading={earned.isLoading}
          accent={summary.under > 0 ? "warning" : undefined}
        />
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">Project earned vs invoiced</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {earned.isLoading || !earned.data ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : earned.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active projects to analyse.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Planned COS</TableHead>
                  <TableHead className="text-right">% Complete</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Invoiced</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Variance %</TableHead>
                  <TableHead>Tolerance ±</TableHead>
                  <TableHead>Flag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {earned.data.rows
                  .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
                  .map((row) => (
                    <TableRow key={row.projectId} data-testid={`cos-row-${row.projectId}`}>
                      <TableCell className="font-medium">{row.projectName}</TableCell>
                      <TableCell className="text-right font-mono">{formatZar(row.plannedExpenditure)}</TableCell>
                      <TableCell className="text-right">{formatPct(row.pctComplete)}</TableCell>
                      <TableCell className="text-right font-mono">{formatZar(row.earned)}</TableCell>
                      <TableCell className="text-right font-mono">{formatZar(row.invoiced)}</TableCell>
                      <TableCell className={`text-right font-mono ${row.variance > 0 ? "text-rose-600" : row.variance < 0 ? "text-amber-600" : ""}`}>
                        {formatZar(row.variance)}
                      </TableCell>
                      <TableCell className="text-right">{formatPct(row.variancePct)}</TableCell>
                      <TableCell>
                        {editing?.projectId === row.projectId ? (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              step={1}
                              min={0}
                              max={100}
                              className="w-16 h-7"
                              value={editing.bandPct}
                              onChange={(e) => setEditing({ projectId: row.projectId, bandPct: Number(e.target.value) })}
                              data-testid={`tolerance-input-${row.projectId}`}
                            />
                            <Button
                              size="sm"
                              className="h-7"
                              disabled={updateTolerance.isPending}
                              onClick={() => updateTolerance.mutate(editing)}
                              data-testid={`tolerance-save-${row.projectId}`}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:underline"
                            onClick={() => setEditing({ projectId: row.projectId, bandPct: row.toleranceBandPct })}
                            data-testid={`tolerance-edit-${row.projectId}`}
                          >
                            {row.toleranceBandPct}% <Pencil className="w-3 h-3 text-muted-foreground" />
                          </button>
                        )}
                      </TableCell>
                      <TableCell>{flagBadge(row.flag)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top-5 counterparty COS trend (last 6 months)</CardTitle>
        </CardHeader>
        <CardContent style={{ height: 320 }}>
          {counterparty.isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : trendChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No counterparty invoices in this window.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                {trendKeys.map((k, i) => (
                  <Line key={k} type="monotone" dataKey={k} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </FinanceShell>
  );
}

const SERIES_COLORS = ["#16A34A", "#DC2626", "#2563EB", "#D97706", "#7C3AED"];

function KpiCard(props: { title: string; value: string; loading: boolean; accent?: "danger" | "warning" }) {
  const accentClass = props.accent === "danger" ? "text-rose-600" : props.accent === "warning" ? "text-amber-600" : "";
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground mb-1">{props.title}</div>
        <div className={`text-xl font-bold font-mono ${accentClass}`}>
          {props.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : props.value}
        </div>
      </CardContent>
    </Card>
  );
}
