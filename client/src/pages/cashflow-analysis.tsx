import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { Loader2, AlertTriangle, TrendingUp, TrendingDown, Wallet, Users } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type OverdueMode = "expected_date" | "payment_terms";
type Side = "ar" | "ap" | "both";

interface AgingBucket {
  count: number;
  amount: number;
}
interface AgingResponse {
  mode: OverdueMode;
  buckets: Array<{ key: string; label: string }>;
  ar: Record<string, AgingBucket>;
  ap: Record<string, AgingBucket>;
  arTotal: number;
  apTotal: number;
}
interface OverdueRow {
  kind: "ar" | "ap";
  id: number;
  projectId: number;
  projectName: string;
  party: string;
  amount: number;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  daysOverdue: number;
  status: string;
  bucket: string;
}
interface OverdueResponse { rows: OverdueRow[]; count: number }
interface DsoDpoPoint { weekStart: string; dso: number | null; dpo: number | null }
interface DsoDpoResponse { weeks: number; points: DsoDpoPoint[] }
interface AtRiskRow {
  id: number;
  projectName: string;
  amount: number;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  daysOverdue: number;
  riskScore: number;
}
interface ConcentrationResponse {
  topN: number;
  arTopProjects: { topAmount: number; totalAmount: number; sharePct: number };
  apTopSuppliers: { topAmount: number; totalAmount: number; sharePct: number };
  arRanked: Array<{ key: string; amount: number }>;
  apRanked: Array<{ key: string; amount: number }>;
}
interface ForecastActualResponse {
  from: string;
  to: string;
  today: string;
  points: Array<{ pointDate: string; series: string; value: number }>;
}

function formatZar(value: number): string {
  if (!Number.isFinite(value)) return "R 0";
  return `R ${Math.round(value).toLocaleString("en-ZA")}`;
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(value * 100).toFixed(1)}%`;
}

export default function CashflowAnalysisPage() {
  const [mode, setMode] = useState<OverdueMode>("expected_date");
  const [side, setSide] = useState<Side>("both");

  const aging = useQuery<AgingResponse>({
    queryKey: ["finance", "analysis", "cashflow", "aging", mode],
    queryFn: () => fetch(`/api/finance/analysis/cashflow/aging?mode=${mode}`).then((r) => r.json()),
  });

  const overdue = useQuery<OverdueResponse>({
    queryKey: ["finance", "analysis", "cashflow", "overdue", mode, side],
    queryFn: () => fetch(`/api/finance/analysis/cashflow/overdue?mode=${mode}&side=${side}`).then((r) => r.json()),
  });

  const dso = useQuery<DsoDpoResponse>({
    queryKey: ["finance", "analysis", "cashflow", "dso-dpo"],
    queryFn: () => fetch("/api/finance/analysis/cashflow/dso-dpo?weeks=12").then((r) => r.json()),
  });

  const atRisk = useQuery<{ rows: AtRiskRow[] }>({
    queryKey: ["finance", "analysis", "cashflow", "at-risk", mode],
    queryFn: () => fetch(`/api/finance/analysis/cashflow/at-risk?mode=${mode}&limit=10`).then((r) => r.json()),
  });

  const concentration = useQuery<ConcentrationResponse>({
    queryKey: ["finance", "analysis", "cashflow", "concentration"],
    queryFn: () => fetch("/api/finance/analysis/cashflow/concentration?top=5").then((r) => r.json()),
  });

  const forecast = useQuery<ForecastActualResponse>({
    queryKey: ["finance", "analysis", "cashflow", "forecast-actual"],
    queryFn: () => fetch("/api/finance/analysis/cashflow/forecast-actual").then((r) => r.json()),
  });

  const dsoChartData = useMemo(() => dso.data?.points ?? [], [dso.data]);
  const forecastChartData = useMemo(() => {
    if (!forecast.data) return [];
    const map = new Map<string, Record<string, string | number>>();
    for (const p of forecast.data.points) {
      const row = map.get(p.pointDate) ?? { date: p.pointDate };
      row[p.series] = p.value;
      map.set(p.pointDate, row);
    }
    return Array.from(map.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [forecast.data]);

  return (
    <FinanceShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight" data-testid="page-title">Cashflow Analysis</h2>
          <p className="text-sm text-muted-foreground">AR/AP aging, overdue, DSO/DPO, and concentration risk.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Overdue mode:</span>
          <Tabs value={mode} onValueChange={(v) => setMode(v as OverdueMode)}>
            <TabsList>
              <TabsTrigger value="expected_date" data-testid="tab-mode-expected">Expected date</TabsTrigger>
              <TabsTrigger value="payment_terms" data-testid="tab-mode-terms">Payment terms</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Headline cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <KpiCard
          icon={<Wallet className="w-4 h-4 text-emerald-600" />}
          title="Outstanding AR"
          value={formatZar(aging.data?.arTotal ?? 0)}
          subtitle={`${aging.data ? Object.values(aging.data.ar).reduce((s, b) => s + b.count, 0) : 0} invoices`}
          loading={aging.isLoading}
        />
        <KpiCard
          icon={<TrendingDown className="w-4 h-4 text-rose-600" />}
          title="Outstanding AP"
          value={formatZar(aging.data?.apTotal ?? 0)}
          subtitle={`${aging.data ? Object.values(aging.data.ap).reduce((s, b) => s + b.count, 0) : 0} bills`}
          loading={aging.isLoading}
        />
        <KpiCard
          icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}
          title="Overdue items"
          value={String(overdue.data?.count ?? 0)}
          subtitle={overdue.data ? `${overdue.data.rows.filter((r) => r.kind === "ar").length} AR / ${overdue.data.rows.filter((r) => r.kind === "ap").length} AP` : "—"}
          loading={overdue.isLoading}
        />
      </div>

      {/* Aging buckets */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">Aging buckets</CardTitle>
        </CardHeader>
        <CardContent>
          {aging.isLoading || !aging.data ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AgingBuckets title="Accounts Receivable" data={aging.data.ar} buckets={aging.data.buckets} />
              <AgingBuckets title="Accounts Payable" data={aging.data.ap} buckets={aging.data.buckets} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overdue list */}
      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Overdue payments</CardTitle>
          <Tabs value={side} onValueChange={(v) => setSide(v as Side)}>
            <TabsList>
              <TabsTrigger value="both" data-testid="tab-side-both">All</TabsTrigger>
              <TabsTrigger value="ar" data-testid="tab-side-ar">AR only</TabsTrigger>
              <TabsTrigger value="ap" data-testid="tab-side-ap">AP only</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {overdue.isLoading || !overdue.data ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : overdue.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No overdue items 🎉</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Side</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Counterparty / customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Days overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdue.data.rows.slice(0, 100).map((row) => (
                  <TableRow key={`${row.kind}-${row.id}`} data-testid={`overdue-row-${row.kind}-${row.id}`}>
                    <TableCell><Badge variant={row.kind === "ar" ? "default" : "secondary"}>{row.kind.toUpperCase()}</Badge></TableCell>
                    <TableCell>{row.projectName}</TableCell>
                    <TableCell>{row.party}</TableCell>
                    <TableCell className="text-right font-mono">{formatZar(row.amount)}</TableCell>
                    <TableCell>{row.invoiceNumber ?? "—"}</TableCell>
                    <TableCell>{row.dueDate ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="destructive">{row.daysOverdue} days</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* DSO / DPO trend */}
        <Card>
          <CardHeader><CardTitle className="text-sm">DSO / DPO (last 12 weeks)</CardTitle></CardHeader>
          <CardContent style={{ height: 280 }}>
            {dso.isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dsoChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="dso" name="DSO (days)" stroke="#16A34A" />
                  <Line type="monotone" dataKey="dpo" name="DPO (days)" stroke="#DC2626" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Concentration */}
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" /> Concentration risk</CardTitle></CardHeader>
          <CardContent>
            {concentration.isLoading || !concentration.data ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <div className="space-y-4">
                <ConcentrationBlock
                  label="Top 5 customers (AR)"
                  share={concentration.data.arTopProjects.sharePct}
                  rows={concentration.data.arRanked}
                />
                <ConcentrationBlock
                  label="Top 5 suppliers (AP)"
                  share={concentration.data.apTopSuppliers.sharePct}
                  rows={concentration.data.apRanked}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* At-risk receivables */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" /> Top 10 at-risk receivables
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {atRisk.isLoading || !atRisk.data ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : atRisk.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing flagged.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Days overdue</TableHead>
                  <TableHead className="text-right">Risk score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {atRisk.data.rows.map((r) => (
                  <TableRow key={r.id} data-testid={`at-risk-${r.id}`}>
                    <TableCell>{r.projectName}</TableCell>
                    <TableCell>{r.invoiceNumber ?? "—"}</TableCell>
                    <TableCell>{r.dueDate ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatZar(r.amount)}</TableCell>
                    <TableCell className="text-right"><Badge variant="destructive">{r.daysOverdue}d</Badge></TableCell>
                    <TableCell className="text-right font-mono">{Math.round(r.riskScore).toLocaleString("en-ZA")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Forecast vs actual */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" /> Forecast vs actual cash position
          </CardTitle>
        </CardHeader>
        <CardContent style={{ height: 280 }}>
          {forecast.isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : forecastChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cashflow points in the lookback window.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={forecastChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                {Array.from(new Set(forecast.data!.points.map((p) => p.series))).map((s, i) => (
                  <Line key={s} type="monotone" dataKey={s} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} />
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

function KpiCard(props: { icon: React.ReactNode; title: string; value: string; subtitle: string; loading: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">{props.icon}{props.title}</div>
        <div className="text-xl font-bold font-mono">{props.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : props.value}</div>
        <div className="text-xs text-muted-foreground mt-1">{props.subtitle}</div>
      </CardContent>
    </Card>
  );
}

function AgingBuckets(props: { title: string; data: Record<string, AgingBucket>; buckets: Array<{ key: string; label: string }> }) {
  const total = props.buckets.reduce((s, b) => s + (props.data[b.key]?.amount ?? 0), 0);
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-2">{props.title}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Bucket</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.buckets.map((b) => {
            const cell = props.data[b.key] ?? { count: 0, amount: 0 };
            return (
              <TableRow key={b.key}>
                <TableCell>{b.label}</TableCell>
                <TableCell className="text-right">{cell.count}</TableCell>
                <TableCell className="text-right font-mono">{formatZar(cell.amount)}</TableCell>
                <TableCell className="text-right">{total > 0 ? formatPct(cell.amount / total) : "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ConcentrationBlock(props: { label: string; share: number; rows: Array<{ key: string; amount: number }> }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider">{props.label}</span>
        <Badge variant={props.share > 0.6 ? "destructive" : props.share > 0.4 ? "secondary" : "default"}>
          {formatPct(props.share)} of outstanding
        </Badge>
      </div>
      <div className="space-y-1">
        {props.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data.</p>
        ) : (
          props.rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between text-sm">
              <span className="truncate">{r.key}</span>
              <span className="font-mono">{formatZar(r.amount)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
