import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { PageError } from "@/components/ui/page-states";
import { formatZar as formatZarShared } from "@/lib/currency";
import { Money } from "@/components/ui/money";
import { PageHero } from "@/components/finance/PageHero";
import { KpiTile } from "@/components/finance/KpiTile";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, AlertTriangle, CheckCircle2, MinusCircle, Pencil, FlaskConical, RotateCcw } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { computeEarnedVsInvoiced } from "@shared/lib/financeAnalysis";

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
interface EarnedResponse {
  rows: EarnedRow[];
  defaultToleranceBandPct: number;
  trust?: { sourceLayer?: string; basis?: string; asOf?: string };
}
interface CounterpartyPoint { counterpartyId: number | null; counterpartyName: string; monthKey: string; amount: number }
interface CounterpartyResponse { months: number; points: CounterpartyPoint[] }

async function okJson(r: Response) {
  if (!r.ok) throw new Error("Unable to load COS analysis data right now.");
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
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ projectId: number; bandPct: number } | null>(null);
  const canEditTolerance = ["COO_ADMIN", "CEO_ADMIN", "CFO", "PROGRAM_FINANCE_MANAGER"].includes(
    String(user?.role ?? "").toUpperCase(),
  );

  // Sandbox: client-side what-if. Override pctComplete, invoiced amount, or
  // tolerance band per project. Nothing is written to the DB.
  type SandboxOverride = { pctComplete?: number; invoiced?: number; bandPct?: number };
  const [sandboxOn, setSandboxOn] = useState(false);
  const [overrides, setOverrides] = useState<Record<number, SandboxOverride>>({});
  const setOverride = (projectId: number, patch: SandboxOverride) =>
    setOverrides((prev) => ({ ...prev, [projectId]: { ...prev[projectId], ...patch } }));
  const resetSandbox = () => setOverrides({});

  const earned = useQuery<EarnedResponse>({
    queryKey: ["finance", "analysis", "cos", "earned-vs-invoiced"],
    queryFn: () => fetch("/api/finance/analysis/cos/earned-vs-invoiced").then(okJson),
  });

  const counterparty = useQuery<CounterpartyResponse>({
    queryKey: ["finance", "analysis", "cos", "counterparty-trend"],
    queryFn: () => fetch("/api/finance/analysis/cos/counterparty-trend?months=6").then(okJson),
  });

  const updateTolerance = useMutation({
    mutationFn: async ({ projectId, bandPct }: { projectId: number; bandPct: number }) => {
      if (!canEditTolerance) throw new Error("You are not allowed to update tolerance bands.");
      const res = await fetch(`/api/finance/analysis/tolerance/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bandPct }),
      });
      if (!res.ok) {
        // Surface the structured ApiError message only — not the raw response
        // body, which can carry server stack/schema details when the
        // EXPOSE_ERROR_DETAIL flag is on.
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status} ${res.statusText}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Tolerance band updated" });
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["finance", "analysis", "cos", "earned-vs-invoiced"] });
    },
    onError: (err: Error) => toast({
      title: "Failed to update tolerance band",
      description: err.message,
      variant: "destructive",
    }),
  });

  // Sandbox-aware view rows. When sandbox is OFF this is identity; when ON it
  // re-runs computeEarnedVsInvoiced() with the user's overrides applied.
  const earnedView: EarnedRow[] = useMemo(() => {
    const rows = earned.data?.rows ?? [];
    if (!sandboxOn) return rows;
    return rows.map((r) => {
      const ov = overrides[r.projectId] ?? {};
      const pct = ov.pctComplete ?? r.pctComplete;
      const invoiced = ov.invoiced ?? r.invoiced;
      const band = ov.bandPct ?? r.toleranceBandPct;
      const ev = computeEarnedVsInvoiced({
        plannedExpenditure: r.plannedExpenditure,
        pctComplete: pct,
        invoicedToDate: invoiced,
        toleranceBandPct: band,
      });
      return {
        ...r,
        pctComplete: pct,
        invoiced,
        toleranceBandPct: band,
        earned: ev.earned,
        variance: ev.variance,
        variancePct: ev.variancePct,
        flag: ev.flag,
      };
    });
  }, [earned.data, sandboxOn, overrides]);

  const summary = useMemo(() => {
    return earnedView.reduce(
      (acc, r) => ({
        earned: acc.earned + r.earned,
        invoiced: acc.invoiced + r.invoiced,
        over: acc.over + (r.flag === "over_billed" ? 1 : 0),
        under: acc.under + (r.flag === "under_billed" ? 1 : 0),
      }),
      { earned: 0, invoiced: 0, over: 0, under: 0 },
    );
  }, [earnedView]);

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
      {/* Visual redesign — PageHero (wave 4e). Single answer: how much
          have we earned (POC × planned) vs. how much have we billed. */}
      <PageHero
        eyebrow="Finance · COS analysis"
        label="Total earned to date"
        value={<Money value={summary.earned} />}
        tone={summary.earned >= summary.invoiced ? 'default' : 'warning'}
        supporting={
          <>
            vs. invoiced <Money value={summary.invoiced} /> · {summary.over} over-billed ·{' '}
            {summary.under} under-billed
          </>
        }
        trust={[
          { label: 'Source', value: earned.data?.trust?.sourceLayer ?? 'canonical' },
          { label: 'Basis', value: 'COS invoices vs progress' },
          { label: 'Updated', value: earned.data?.trust?.asOf ?? '—' },
        ]}
        actions={
          <div className="flex items-center gap-2 border-l pl-3">
            <FlaskConical className="w-4 h-4 text-amber-600" />
            <span className="text-xs">Sandbox</span>
            <Switch checked={sandboxOn} onCheckedChange={setSandboxOn} data-testid="sandbox-toggle" />
          </div>
        }
        className="mb-4"
        data-testid="cos-analysis-page-hero"
      />
      <h2 className="sr-only" data-testid="page-title">COS Analysis</h2>
      <p className="sr-only" data-testid="analysis-metadata">
        Source: {earned.data?.trust?.sourceLayer ?? "canonical"} · Basis: captured COS invoices vs project progress · Last updated: {earned.data?.trust?.asOf ?? "—"}
      </p>

      {sandboxOn && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700 p-3" data-testid="sandbox-banner">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <FlaskConical className="w-4 h-4 text-amber-600" />
              <strong>Sandbox mode</strong>
              <span className="text-muted-foreground">
                Hypothetical: {Object.keys(overrides).length} project{Object.keys(overrides).length === 1 ? "" : "s"} overridden. Nothing is saved.
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={resetSandbox} data-testid="sandbox-reset">
              <RotateCcw className="w-3 h-3 mr-1" /> Reset
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <KpiTile
          label="Total earned (to date)"
          value={<Money value={summary.earned} />}
          data-testid="kpi-tile-cos-earned"
        />
        <KpiTile
          label="Total invoiced"
          value={<Money value={summary.invoiced} />}
          data-testid="kpi-tile-cos-invoiced"
        />
        <KpiTile
          label="Projects over-billed"
          value={String(summary.over)}
          tone={summary.over > 0 ? 'critical' : 'default'}
          data-testid="kpi-tile-cos-over"
        />
        <KpiTile
          label="Projects under-billed"
          value={String(summary.under)}
          tone={summary.under > 0 ? 'warning' : 'default'}
          data-testid="kpi-tile-cos-under"
        />
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">Project earned vs invoiced</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {earned.isError ? (
            <SectionError onRetry={() => earned.refetch()} />
          ) : earned.isLoading || !earned.data ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : earnedView.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active projects to analyse.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Planned COS</TableHead>
                  <TableHead className="text-right">% Complete{sandboxOn && <span className="text-amber-600"> (sim)</span>}</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Invoiced{sandboxOn && <span className="text-amber-600"> (sim)</span>}</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Variance %</TableHead>
                  <TableHead>Tolerance ±{sandboxOn && <span className="text-amber-600"> (sim)</span>}</TableHead>
                  <TableHead>Flag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...earnedView]
                  .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
                  .map((row) => (
                    <TableRow key={row.projectId} data-testid={`cos-row-${row.projectId}`}>
                      <TableCell className="font-medium">{row.projectName}</TableCell>
                      <TableCell className="text-right font-mono"><Money value={row.plannedExpenditure} /></TableCell>
                      <TableCell className="text-right">
                        {sandboxOn ? (
                          <Input
                            type="number"
                            step={1}
                            min={0}
                            max={100}
                            className="w-20 h-7 ml-auto text-right"
                            value={Math.round(row.pctComplete * 100)}
                            onChange={(e) => setOverride(row.projectId, { pctComplete: Number(e.target.value) / 100 })}
                            data-testid={`sandbox-pct-${row.projectId}`}
                          />
                        ) : (
                          formatPct(row.pctComplete)
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono"><Money value={row.earned} /></TableCell>
                      <TableCell className="text-right font-mono">
                        {sandboxOn ? (
                          <Input
                            type="number"
                            step={1000}
                            min={0}
                            className="w-32 h-7 ml-auto text-right"
                            value={Math.round(row.invoiced)}
                            onChange={(e) => setOverride(row.projectId, { invoiced: Number(e.target.value) })}
                            data-testid={`sandbox-invoiced-${row.projectId}`}
                          />
                        ) : (
                          <Money value={row.invoiced} />
                        )}
                      </TableCell>
                      {/* TF-33 (audit V3) — variance badge pairs the colour
                          with a directional arrow so colour-blind users still
                          read positive vs. negative variance at a glance. */}
                      <TableCell className={`text-right font-mono ${row.variance > 0 ? "text-rose-600" : row.variance < 0 ? "text-amber-600" : ""}`}>
                        <span className="inline-flex items-center justify-end gap-1">
                          {row.variance > 0 ? (
                            <span aria-label="over-billed" className="text-rose-600">▲</span>
                          ) : row.variance < 0 ? (
                            <span aria-label="under-billed" className="text-amber-600">▼</span>
                          ) : null}
                          <Money value={row.variance} />
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{formatPct(row.variancePct)}</TableCell>
                      <TableCell>
                        {sandboxOn ? (
                          <Input
                            type="number"
                            step={1}
                            min={0}
                            max={100}
                            className="w-16 h-7"
                            value={row.toleranceBandPct}
                            onChange={(e) => setOverride(row.projectId, { bandPct: Number(e.target.value) })}
                            data-testid={`sandbox-band-${row.projectId}`}
                          />
                        ) : canEditTolerance && editing?.projectId === row.projectId ? (
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
                        ) : canEditTolerance ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:underline"
                            onClick={() => setEditing({ projectId: row.projectId, bandPct: row.toleranceBandPct })}
                            data-testid={`tolerance-edit-${row.projectId}`}
                          >
                            {row.toleranceBandPct}% <Pencil className="w-3 h-3 text-muted-foreground" />
                          </button>
                        ) : (
                          <span>{row.toleranceBandPct}%</span>
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
          {counterparty.isError ? (
            <SectionError onRetry={() => counterparty.refetch()} />
          ) : counterparty.isLoading ? (
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

// Visual redesign (wave 4e) — the local <KpiCard> helper was dropped
// in favour of the canonical <KpiTile> from @/components/finance/KpiTile.
