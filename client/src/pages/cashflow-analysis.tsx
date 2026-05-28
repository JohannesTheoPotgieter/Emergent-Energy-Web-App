import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { PageError } from "@/components/ui/page-states";
import { Money } from "@/components/ui/money";
import { PageHero } from "@/components/finance/PageHero";
import { KpiTile } from "@/components/finance/KpiTile";
import { formatZar as formatZarShared } from "@/lib/currency";
import { Loader2, AlertTriangle, TrendingUp, TrendingDown, Wallet, Users, FlaskConical, RotateCcw, CheckCircle2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { bucketForDaysOverdue } from "@shared/lib/financeAnalysis";

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
  trust?: { sourceLayer?: string; basis?: string; asOf?: string };
}

async function okJson(r: Response) {
  if (!r.ok) throw new Error("Unable to load cashflow analysis data right now.");
  return r.json();
}

// Canonical precise ZAR. Absent / non-numeric → "—" (never "R 0").
function formatZar(value: number | null | undefined): string {
  return formatZarShared(value);
}

/** Distinct error state (with retry) so a failed load never reads as "all clear". */
function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <PageError
      title="Couldn't load this section"
      message="The data failed to load. This is not the same as having nothing to show — retry to try again."
      onRetry={onRetry}
    />
  );
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(value * 100).toFixed(1)}%`;
}

export default function CashflowAnalysisPage() {
  const [mode, setMode] = useState<OverdueMode>("expected_date");
  const [side, setSide] = useState<Side>("both");

  // Sandbox: client-side simulation. Never writes to the DB.
  // - paidIds: invoices the user has hypothetically marked paid.
  // - dateShiftDays: shift every due date by N days (positive = later → less overdue).
  const [sandboxOn, setSandboxOn] = useState(false);
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  const [dateShiftDays, setDateShiftDays] = useState(0);
  const togglePaid = (key: string) => setPaidIds((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const resetSandbox = () => { setPaidIds(new Set()); setDateShiftDays(0); };

  const aging = useQuery<AgingResponse>({
    queryKey: ["finance", "analysis", "cashflow", "aging", mode],
    queryFn: () => fetch(`/api/finance/analysis/cashflow/aging?mode=${mode}`).then(okJson),
  });

  const overdue = useQuery<OverdueResponse>({
    queryKey: ["finance", "analysis", "cashflow", "overdue", mode, side],
    queryFn: () => fetch(`/api/finance/analysis/cashflow/overdue?mode=${mode}&side=${side}`).then(okJson),
  });

  const dso = useQuery<DsoDpoResponse>({
    queryKey: ["finance", "analysis", "cashflow", "dso-dpo"],
    queryFn: () => fetch("/api/finance/analysis/cashflow/dso-dpo?weeks=12").then(okJson),
  });

  const atRisk = useQuery<{ rows: AtRiskRow[] }>({
    queryKey: ["finance", "analysis", "cashflow", "at-risk", mode],
    queryFn: () => fetch(`/api/finance/analysis/cashflow/at-risk?mode=${mode}&limit=10`).then(okJson),
  });

  const concentration = useQuery<ConcentrationResponse>({
    queryKey: ["finance", "analysis", "cashflow", "concentration"],
    queryFn: () => fetch("/api/finance/analysis/cashflow/concentration?top=5").then(okJson),
  });

  const forecast = useQuery<ForecastActualResponse>({
    queryKey: ["finance", "analysis", "cashflow", "forecast-actual"],
    queryFn: () => fetch("/api/finance/analysis/cashflow/forecast-actual").then(okJson),
  });

  // Sandbox-aware derived rows. When sandbox is OFF this is identity; when ON it
  // (a) drops rows the user has marked paid and (b) re-applies dateShiftDays.
  const overdueRowsView = useMemo(() => {
    const raw = overdue.data?.rows ?? [];
    if (!sandboxOn) return raw;
    return raw
      .filter((r) => !paidIds.has(`${r.kind}-${r.id}`))
      .map((r) => {
        const adjusted = Math.max(0, r.daysOverdue - dateShiftDays);
        return { ...r, daysOverdue: adjusted, bucket: bucketForDaysOverdue(adjusted) };
      })
      .filter((r) => r.daysOverdue > 0)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [overdue.data, sandboxOn, paidIds, dateShiftDays]);

  const atRiskRowsView = useMemo(() => {
    const raw = atRisk.data?.rows ?? [];
    if (!sandboxOn) return raw;
    return raw
      .filter((r) => !paidIds.has(`ar-${r.id}`))
      .map((r) => {
        const adjusted = Math.max(0, r.daysOverdue - dateShiftDays);
        return { ...r, daysOverdue: adjusted, riskScore: r.amount * Math.log(1 + adjusted) };
      })
      .filter((r) => r.daysOverdue > 0)
      .sort((a, b) => b.riskScore - a.riskScore);
  }, [atRisk.data, sandboxOn, paidIds, dateShiftDays]);

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
      {/* Visual redesign — PageHero + KpiTile (wave 4e). Replaces the
          ad-hoc h2 + sentence + local KpiCard cluster with the canonical
          single-answer layout used across the rest of the finance surface. */}
      <PageHero
        eyebrow="Finance · Cashflow analysis"
        label="Outstanding AR · we are owed"
        value={<Money value={aging.data?.arTotal ?? 0} />}
        tone="positive"
        supporting={
          aging.data
            ? `${Object.values(aging.data.ar).reduce((s, b) => s + b.count, 0)} invoices · oldest bucket ${aging.data.buckets[aging.data.buckets.length - 1]?.label ?? "—"}`
            : "Loading…"
        }
        trust={[
          { label: 'Source', value: forecast.data?.trust?.sourceLayer ?? 'canonical' },
          { label: 'Basis', value: 'payment dates' },
          { label: 'Updated', value: forecast.data?.trust?.asOf ?? forecast.data?.today ?? '—' },
        ]}
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Overdue mode:</span>
              <Tabs value={mode} onValueChange={(v) => setMode(v as OverdueMode)}>
                <TabsList>
                  <TabsTrigger value="expected_date" data-testid="tab-mode-expected">Expected date</TabsTrigger>
                  <TabsTrigger value="payment_terms" data-testid="tab-mode-terms">Payment terms</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex items-center gap-2 border-l pl-3">
              <FlaskConical className="w-4 h-4 text-amber-600" />
              <span className="text-xs">Sandbox</span>
              <Switch checked={sandboxOn} onCheckedChange={setSandboxOn} data-testid="sandbox-toggle" />
            </div>
          </div>
        }
        className="mb-4"
        data-testid="cashflow-analysis-page-hero"
      />
      <h2 className="sr-only" data-testid="page-title">Cashflow Analysis</h2>
      <p className="sr-only" data-testid="analysis-metadata">
        Source: {forecast.data?.trust?.sourceLayer ?? "canonical"} · Basis: payment dates · Last updated: {forecast.data?.trust?.asOf ?? forecast.data?.today ?? "—"}
      </p>

      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50/70 p-3" data-testid="cashflow-analysis-trust-note">
        <p className="text-sm text-slate-800">Cashflow actuals use payment received / paid dates.</p>
        <p className="mt-1 text-sm text-slate-700">Forecast dates may use planned-payment fallback where no canonical payment date exists.</p>
        <p className="mt-1 text-xs text-slate-600">Use forecast values as planning data until reconciled.</p>
      </div>

      {sandboxOn && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700 p-3" data-testid="sandbox-banner">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <FlaskConical className="w-4 h-4 text-amber-600" />
              <strong>Sandbox mode</strong>
              <span className="text-muted-foreground">
                Hypothetical: {paidIds.size} marked paid, due dates shifted +{dateShiftDays}d. Nothing is saved.
              </span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-[260px]">
                <span className="text-xs whitespace-nowrap">Shift due dates by</span>
                <Slider
                  value={[dateShiftDays]}
                  min={0}
                  max={90}
                  step={1}
                  onValueChange={(v) => setDateShiftDays(v[0] ?? 0)}
                  className="w-32"
                  data-testid="sandbox-slider-shift"
                />
                <span className="text-xs font-mono w-10 text-right">{dateShiftDays}d</span>
              </div>
              <Button size="sm" variant="ghost" onClick={resetSandbox} data-testid="sandbox-reset">
                <RotateCcw className="w-3 h-3 mr-1" /> Reset
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Headline KPI strip — outstanding AR (already the hero) + AP + Overdue. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <KpiTile
          icon={<Wallet className="w-4 h-4" />}
          label="Outstanding AR"
          value={<Money value={aging.data?.arTotal ?? 0} />}
          supporting={`${aging.data ? Object.values(aging.data.ar).reduce((s, b) => s + b.count, 0) : 0} invoices`}
          tone="positive"
          data-testid="kpi-tile-outstanding-ar"
        />
        <KpiTile
          icon={<TrendingDown className="w-4 h-4" />}
          label="Outstanding AP"
          value={<Money value={aging.data?.apTotal ?? 0} />}
          supporting={`${aging.data ? Object.values(aging.data.ap).reduce((s, b) => s + b.count, 0) : 0} bills`}
          data-testid="kpi-tile-outstanding-ap"
        />
        <KpiTile
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Overdue items"
          value={String(overdue.data?.count ?? 0)}
          supporting={
            overdue.data
              ? `${overdue.data.rows.filter((r) => r.kind === 'ar').length} AR / ${overdue.data.rows.filter((r) => r.kind === 'ap').length} AP`
              : '—'
          }
          tone={overdue.data && overdue.data.count > 0 ? 'warning' : 'default'}
          data-testid="kpi-tile-overdue-items"
        />
      </div>

      {/* Aging buckets */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">Aging buckets</CardTitle>
        </CardHeader>
        <CardContent>
          {aging.isError ? (
            <SectionError onRetry={() => aging.refetch()} />
          ) : aging.isLoading || !aging.data ? (
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
          {overdue.isError ? (
            <SectionError onRetry={() => overdue.refetch()} />
          ) : overdue.isLoading || !overdue.data ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : overdueRowsView.length === 0 ? (
            <p className="text-sm text-muted-foreground">{sandboxOn ? "Sandbox cleared all overdue items 🎉" : "No overdue items 🎉"}</p>
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
                  {sandboxOn && <TableHead className="text-right">Sandbox</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdueRowsView.slice(0, 100).map((row) => (
                  <TableRow key={`${row.kind}-${row.id}`} data-testid={`overdue-row-${row.kind}-${row.id}`}>
                    <TableCell><Badge variant={row.kind === "ar" ? "default" : "secondary"}>{row.kind.toUpperCase()}</Badge></TableCell>
                    <TableCell>{row.projectName}</TableCell>
                    <TableCell>{row.party}</TableCell>
                    <TableCell className="text-right font-mono"><Money value={row.amount} /></TableCell>
                    <TableCell>{row.invoiceNumber ?? "—"}</TableCell>
                    <TableCell>{row.dueDate ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="destructive">{row.daysOverdue} days</Badge>
                    </TableCell>
                    {sandboxOn && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => togglePaid(`${row.kind}-${row.id}`)}
                          data-testid={`sandbox-mark-paid-${row.kind}-${row.id}`}
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Mark paid
                        </Button>
                      </TableCell>
                    )}
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
            {dso.isError ? (
              <SectionError onRetry={() => dso.refetch()} />
            ) : dso.isLoading ? (
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
            {concentration.isError ? (
              <SectionError onRetry={() => concentration.refetch()} />
            ) : concentration.isLoading || !concentration.data ? (
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
          {atRisk.isError ? (
            <SectionError onRetry={() => atRisk.refetch()} />
          ) : atRisk.isLoading || !atRisk.data ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : atRiskRowsView.length === 0 ? (
            <p className="text-sm text-muted-foreground">{sandboxOn ? "Sandbox cleared all at-risk items." : "Nothing flagged."}</p>
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
                  {sandboxOn && <TableHead className="text-right">Sandbox</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {atRiskRowsView.slice(0, 10).map((r) => (
                  <TableRow key={r.id} data-testid={`at-risk-${r.id}`}>
                    <TableCell>{r.projectName}</TableCell>
                    <TableCell>{r.invoiceNumber ?? "—"}</TableCell>
                    <TableCell>{r.dueDate ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono"><Money value={r.amount} /></TableCell>
                    <TableCell className="text-right"><Badge variant="destructive">{r.daysOverdue}d</Badge></TableCell>
                    <TableCell className="text-right font-mono">{Math.round(r.riskScore).toLocaleString("en-ZA")}</TableCell>
                    {sandboxOn && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => togglePaid(`ar-${r.id}`)}
                          data-testid={`sandbox-mark-paid-ar-${r.id}`}
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Mark paid
                        </Button>
                      </TableCell>
                    )}
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
          {forecast.isError ? (
            <SectionError onRetry={() => forecast.refetch()} />
          ) : forecast.isLoading ? (
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

// Visual redesign (wave 4e) — the local <KpiCard> helper was dropped in
// favour of the canonical <KpiTile> from @/components/finance/KpiTile.

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
                <TableCell className="text-right font-mono"><Money value={cell.amount} /></TableCell>
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
              <Money className="font-mono" value={r.amount} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
