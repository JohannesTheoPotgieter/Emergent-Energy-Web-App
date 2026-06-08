/**
 * QuickBooks Reconciliation — company-wide, period-bucketed tracker-vs-QB.
 *
 * Reads the R2 engine endpoints (no calculation here, no project dimension):
 *   /api/finance/qb-recon/summary?grain=  → per-period REV / COS / GP tiles
 *   /api/finance/qb-recon/lines           → the variance/unmatched worklist
 *   /api/finance/qb-recon/ignores         → suppressed variances (who/why)
 *
 * The app COMPARES and flags; it never adjusts a tracker (§ 3.4). Cash ≠ revenue.
 * Brand: centralised tokens (brand-* / status-* utilities) — no hardcoded hex;
 * every status is paired with an icon + word (colour-blind safe).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  CheckCircle2,
  AlertTriangle,
  FileMinus,
  FilePlus,
  Clock,
  ArrowUpDown,
  EyeOff,
} from "lucide-react";

import { fetchQueryFn } from "@/lib/queryClient";
import { formatZar } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import {
  buildWorklist,
  displayStatus,
  type Grain,
  type LineStatus,
  type DisplayStatus,
} from "@/lib/finance/qb-recon-worklist";

type Stream = "COS" | "REV";

interface SummaryRow {
  stream: Stream;
  trackerTotal: number;
  qbTotal: number;
  matchedTotal: number;
  varianceTotal: number;
  trackerOnlyTotal: number;
  qbOnlyTotal: number;
}
interface PeriodSummary {
  periodKey: string;
  fiscalPeriodId: number | null;
  rev: SummaryRow | null;
  cos: SummaryRow | null;
  gpTracker: number;
  gpQb: number;
  gpDelta: number;
}
interface SummaryResp {
  generatedAt: string;
  grain: Grain;
  periods: PeriodSummary[];
}
interface ReconLine {
  id: number;
  stream: Stream;
  invoiceNoRaw: string | null;
  invoiceNoNorm: string;
  trackerAmountExVat: string | null;
  qbAmountExVat: string | null;
  delta: string | null;
  status: LineStatus;
  trackerDate: string | null;
  qbDate: string | null;
  fiscalPeriodId: number | null;
  timingFlag: boolean;
}
interface LinesResp {
  generatedAt: string;
  count: number;
  lines: ReconLine[];
}
interface IgnoreView {
  side: "cost" | "revenue";
  qbDocNumber: string | null;
  counterpartyName: string | null;
  amountExVat: number | null;
  reason: string;
  ignoredByName: string | null;
  ignoredAt: string | null;
}
interface IgnoresResp {
  generatedAt: string;
  count: number;
  ignores: IgnoreView[];
}

const TOLERANCE = 1;
const num = (v: string | null): number => (v == null ? 0 : Number(v) || 0);
const round2 = (n: number): number => Number(n.toFixed(2));

const STATUS_META: Record<DisplayStatus, { label: string; icon: typeof CheckCircle2; chip: string }> = {
  amount_variance: { label: "Variance", icon: AlertTriangle, chip: "border-amber-300 bg-amber-50 text-amber-800" },
  tracker_only: { label: "Tracker only", icon: FileMinus, chip: "border-slate-300 bg-slate-50 text-slate-700" },
  qb_only: { label: "QB only", icon: FilePlus, chip: "border-slate-300 bg-slate-50 text-slate-700" },
  timing: { label: "Timing", icon: Clock, chip: "border-sky-300 bg-sky-50 text-sky-800" },
  matched: { label: "Matched", icon: CheckCircle2, chip: "border-status-ties/30 bg-status-ties/10 text-status-ties" },
};

function StatusChip({ status }: { status: DisplayStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={`gap-1 text-xs font-medium ${m.chip}`} data-testid={`qb-recon-status-${status}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {m.label}
    </Badge>
  );
}

function MetricTile({ label, tracker, qb }: { label: string; tracker: number; qb: number }) {
  const delta = round2(tracker - qb);
  const tie = Math.abs(delta) <= TOLERANCE;
  return (
    <Card data-testid={`qb-recon-tile-${label.toLowerCase()}`}>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-brand-muted">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-lg font-semibold text-brand-text">{formatZar(tracker)}</span>
          {tie ? (
            <Badge variant="outline" className="gap-1 border-status-ties/30 bg-status-ties/10 text-status-ties text-xs">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Tie
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-800 text-xs">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Variance
            </Badge>
          )}
        </div>
        <p className="text-xs text-brand-muted">
          tracker {formatZar(tracker)} · QB {formatZar(qb)}
        </p>
        {!tie && (
          <p className="font-mono text-sm font-semibold text-amber-700" data-testid={`qb-recon-tile-${label.toLowerCase()}-delta`}>
            Δ {formatZar(delta)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function FinanceQbReconciliationPage() {
  const [grain, setGrain] = useState<Grain>("month");
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [sortByValue, setSortByValue] = useState(false);

  const summaryQuery = useQuery<SummaryResp>({
    queryKey: ["/api/finance/qb-recon/summary", grain],
    queryFn: fetchQueryFn(`/api/finance/qb-recon/summary?grain=${grain}`),
    staleTime: 60_000,
  });
  const linesQuery = useQuery<LinesResp>({
    queryKey: ["/api/finance/qb-recon/lines"],
    queryFn: fetchQueryFn("/api/finance/qb-recon/lines"),
    staleTime: 60_000,
  });
  const ignoresQuery = useQuery<IgnoresResp>({
    queryKey: ["/api/finance/qb-recon/ignores"],
    queryFn: fetchQueryFn("/api/finance/qb-recon/ignores"),
    staleTime: 60_000,
  });

  const periods = useMemo(() => summaryQuery.data?.periods ?? [], [summaryQuery.data]);

  // Default to the most recent period; keep selection valid when grain changes.
  useEffect(() => {
    if (periods.length === 0) {
      setSelectedPeriod(null);
      return;
    }
    setSelectedPeriod((prev) => (prev && periods.some((p) => p.periodKey === prev) ? prev : periods[periods.length - 1].periodKey));
  }, [periods]);

  const period = useMemo(
    () => periods.find((p) => p.periodKey === selectedPeriod) ?? periods[periods.length - 1] ?? null,
    [periods, selectedPeriod],
  );

  const worklist = useMemo(() => {
    const all = linesQuery.data?.lines ?? [];
    if (!period) return [];
    return buildWorklist(all, period.periodKey, grain, sortByValue);
  }, [linesQuery.data, period, grain, sortByValue]);

  const ignores = ignoresQuery.data?.ignores ?? [];

  return (
    <div className="min-h-full bg-brand-surface text-brand-text" data-testid="qb-reconciliation-view">
      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        {/* Header + period selector */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-brand-text">QuickBooks Reconciliation</h1>
            <p className="text-sm text-brand-muted">
              Company-wide tracker vs QuickBooks — matched on invoice number + ex-VAT amount. The app compares and flags;
              it never adjusts a tracker.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-brand-muted/40" role="group" aria-label="Period grain">
              {(["day", "week", "month"] as Grain[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrain(g)}
                  className={`px-3 py-1.5 text-sm capitalize ${grain === g ? "bg-brand-green text-white" : "bg-white text-brand-text hover:bg-brand-muted/10"}`}
                  data-testid={`qb-recon-grain-${g}`}
                >
                  {g}
                </button>
              ))}
            </div>
            {periods.length > 0 && (
              <select
                className="rounded-md border border-brand-muted/40 bg-white px-2 py-1.5 text-sm text-brand-text"
                value={period?.periodKey ?? ""}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                data-testid="qb-recon-period-select"
                aria-label="Period"
              >
                {[...periods].reverse().map((p) => (
                  <option key={p.periodKey} value={p.periodKey}>
                    {p.periodKey}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {summaryQuery.isLoading ? (
          <LoadingState variant="skeleton-card" cards={3} />
        ) : periods.length === 0 ? (
          <div className="rounded-md border border-brand-muted/40 bg-white px-4 py-8 text-center text-sm text-brand-muted">
            No reconciliation computed yet. It refreshes daily (or trigger a refresh from the API).
          </div>
        ) : (
          <>
            {/* Headline tiles — REV / COS / GP */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricTile label="Revenue" tracker={period?.rev?.trackerTotal ?? 0} qb={period?.rev?.qbTotal ?? 0} />
              <MetricTile label="COS" tracker={period?.cos?.trackerTotal ?? 0} qb={period?.cos?.qbTotal ?? 0} />
              <MetricTile label="GP" tracker={period?.gpTracker ?? 0} qb={period?.gpQb ?? 0} />
            </div>

            {/* Worklist */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-semibold text-brand-text">
                  Worklist — {worklist.length} item{worklist.length === 1 ? "" : "s"} · {period?.periodKey}
                </CardTitle>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setSortByValue((v) => !v)} data-testid="qb-recon-sort">
                  <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                  {sortByValue ? "Grouped" : "Sort by value"}
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {worklist.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-brand-muted">Everything ties for this period. 🎉</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="qb-recon-worklist">
                      <thead>
                        <tr className="border-b border-brand-muted/30 text-left text-xs uppercase tracking-wider text-brand-muted">
                          <th className="px-4 py-2 font-medium">Stream</th>
                          <th className="px-4 py-2 font-medium">Invoice #</th>
                          <th className="px-4 py-2 text-right font-medium">Tracker</th>
                          <th className="px-4 py-2 text-right font-medium">QB</th>
                          <th className="px-4 py-2 text-right font-medium">Δ</th>
                          <th className="px-4 py-2 font-medium">Tracker date</th>
                          <th className="px-4 py-2 font-medium">QB date</th>
                          <th className="px-4 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {worklist.map((l) => (
                          <tr key={`${l.stream}-${l.id}`} className="border-b border-brand-muted/15" data-testid={`qb-recon-row-${l.id}`}>
                            <td className="px-4 py-2 text-xs font-medium text-brand-muted">{l.stream}</td>
                            <td className="px-4 py-2 font-mono">{l.invoiceNoRaw ?? l.invoiceNoNorm}</td>
                            <td className="px-4 py-2 text-right font-mono">{l.trackerAmountExVat == null ? "—" : formatZar(num(l.trackerAmountExVat))}</td>
                            <td className="px-4 py-2 text-right font-mono">{l.qbAmountExVat == null ? "—" : formatZar(num(l.qbAmountExVat))}</td>
                            <td className="px-4 py-2 text-right font-mono text-amber-700">{l.delta == null ? "—" : formatZar(num(l.delta))}</td>
                            <td className="px-4 py-2 text-xs text-brand-muted">{l.trackerDate ?? "—"}</td>
                            <td className="px-4 py-2 text-xs text-brand-muted">{l.qbDate ?? "—"}</td>
                            <td className="px-4 py-2"><StatusChip status={displayStatus(l)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recon-ignores — suppressed, never silently dropped */}
            {ignores.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-brand-text">
                    <EyeOff className="h-4 w-4 text-brand-muted" aria-hidden="true" />
                    Recon-ignores ({ignores.length}) — excluded from the gap, shown for audit
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5" data-testid="qb-recon-ignores">
                  {ignores.map((ig, i) => (
                    <div key={`${ig.side}-${ig.qbDocNumber}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-xs text-brand-muted">
                      <span className="font-medium uppercase">{ig.side}</span>
                      <span className="font-mono text-brand-text">{ig.qbDocNumber ?? "—"}</span>
                      {ig.counterpartyName && <span>· {ig.counterpartyName}</span>}
                      {ig.amountExVat != null && <span>· {formatZar(ig.amountExVat)}</span>}
                      <span>· ignored by {ig.ignoredByName ?? "unknown"}, {ig.reason}</span>
                      {ig.ignoredAt && <span>· {ig.ignoredAt.slice(0, 10)}</span>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <p className="text-xs text-brand-muted">
              QB COS bills aren&apos;t project-tagged, so this reconciliation is company-wide (no project dimension). The
              per-project app-vs-tracker check lives on the{" "}
              <Link href="/finance/reconciliation" className="text-brand-green hover:underline">
                Reconciliation board
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
