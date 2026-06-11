/**
 * QuickBooks Reconciliation — company-wide, period-bucketed tracker-vs-QB.
 *
 * Reads the R2 engine endpoints (no calculation here, no project dimension):
 *   /api/finance/qb-recon/summary?grain=  → per-period REV / COS / GP + coverage
 *   /api/finance/qb-recon/lines           → the four-state invoice worklist
 *   /api/finance/qb-recon/ignores         → suppressed differences (who/why)
 * and writes ONLY recon-ignore annotations (POST/DELETE /qb-recon/ignore):
 *   - mark an accepted difference ignored (captures by-whom + why + when)
 *   - restore it. NEVER writes back to QuickBooks; never adjusts a tracker (§ 3.4).
 *
 * Three views: (1) a Day/Week/Month grain selector; (2) a MONTH COMPARISON
 * table — tracker vs QB REV/COS/GP + variance + match COVERAGE per period, with
 * low-coverage flagged (never presented as fully reconciled); (3) an INVOICE
 * WORKLIST drilled from a period, split REVENUE / COST (the documents differ),
 * each in the four states MATCHED / UNMATCHED-IN-QB / UNMATCHED-IN-TRACKER /
 * AMBIGUOUS. GP is never shown per invoice. Ex-VAT throughout.
 * Brand: centralised tokens; every state pairs an icon + word (colour-blind safe).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  CheckCircle2,
  AlertTriangle,
  FileMinus,
  FilePlus,
  HelpCircle,
  Clock,
  EyeOff,
  RotateCcw,
} from "lucide-react";

import { fetchQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatZar, formatZarCompact } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import {
  buildSideWorklist,
  type Grain,
  type LineStatus,
  type MatchState,
  type SideWorklist,
  type Stream,
} from "@/lib/finance/qb-recon-worklist";
import {
  monthCoverage,
  coverageLabel,
  variance,
  LOW_COVERAGE_THRESHOLD,
} from "@/lib/finance/qb-recon-coverage";

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
  ignoredCount?: number;
  lines: ReconLine[];
}
interface IgnoreView {
  source: "recon_line" | "qb_doc";
  id: number | null;
  side: "cost" | "revenue";
  stream: Stream | null;
  invoiceNoNorm: string | null;
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
const money = (v: number) => <span title={formatZar(v)}>{formatZarCompact(v)}</span>;

const STATE_META: Record<MatchState, { label: string; icon: typeof CheckCircle2; chip: string }> = {
  matched: { label: "Matched", icon: CheckCircle2, chip: "border-status-ties/30 bg-status-ties/10 text-status-ties" },
  ambiguous: { label: "Ambiguous", icon: HelpCircle, chip: "border-amber-300 bg-amber-50 text-amber-800" },
  unmatched_in_qb: { label: "Unmatched in QB", icon: FileMinus, chip: "border-slate-300 bg-slate-50 text-slate-700" },
  unmatched_in_tracker: { label: "Unmatched in tracker", icon: FilePlus, chip: "border-slate-300 bg-slate-50 text-slate-700" },
};

function StateChip({ state }: { state: MatchState }) {
  const m = STATE_META[state];
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={`gap-1 text-xs font-medium ${m.chip}`} data-testid={`qb-recon-state-${state}`}>
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

/** Tracker / QB / Δ triple for one metric in the month table. */
function MetricCells({ tracker, qb }: { tracker: number; qb: number }) {
  const d = variance(tracker, qb);
  const tie = Math.abs(d) <= TOLERANCE;
  return (
    <>
      <td className="px-3 py-2 text-right font-mono text-brand-text">{money(tracker)}</td>
      <td className="px-3 py-2 text-right font-mono text-brand-muted">{money(qb)}</td>
      <td className={`px-3 py-2 text-right font-mono ${tie ? "text-brand-muted" : "text-amber-700 font-semibold"}`}>
        {tie ? "—" : <>Δ {money(d)}</>}
      </td>
    </>
  );
}

function MonthComparisonTable({
  periods,
  selected,
  onSelect,
  grain,
}: {
  periods: PeriodSummary[];
  selected: string | null;
  onSelect: (key: string) => void;
  grain: Grain;
}) {
  const grainLabel = grain === "month" ? "Month" : grain === "week" ? "Week" : "Day";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-brand-text">
          Tracker vs QuickBooks by {grainLabel.toLowerCase()} — REV / COS / GP + variance + match coverage
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="qb-recon-month-table">
            <thead>
              <tr className="border-b border-brand-muted/30 text-xs uppercase tracking-wider text-brand-muted">
                <th className="px-3 py-2 text-left font-medium">{grainLabel}</th>
                <th className="px-3 py-2 text-right font-medium" colSpan={3}>Revenue (trk · QB · Δ)</th>
                <th className="px-3 py-2 text-right font-medium" colSpan={3}>COS (trk · QB · Δ)</th>
                <th className="px-3 py-2 text-right font-medium" colSpan={3}>GP (trk · QB · Δ)</th>
                <th className="px-3 py-2 text-right font-medium">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const cov = monthCoverage(p);
                const isSel = p.periodKey === selected;
                return (
                  <tr
                    key={p.periodKey}
                    className={`cursor-pointer border-b border-brand-muted/15 hover:bg-brand-muted/5 ${isSel ? "bg-brand-green/5" : ""}`}
                    onClick={() => onSelect(p.periodKey)}
                    data-testid={`qb-recon-month-row-${p.periodKey}`}
                    aria-selected={isSel}
                  >
                    <th scope="row" className="px-3 py-2 text-left font-medium text-brand-text">
                      <span className="inline-flex items-center gap-1.5">
                        {p.periodKey}
                        {isSel && <span className="text-[10px] uppercase text-brand-green">▸ drill</span>}
                      </span>
                    </th>
                    <MetricCells tracker={p.rev?.trackerTotal ?? 0} qb={p.rev?.qbTotal ?? 0} />
                    <MetricCells tracker={p.cos?.trackerTotal ?? 0} qb={p.cos?.qbTotal ?? 0} />
                    <MetricCells tracker={p.gpTracker} qb={p.gpQb} />
                    <td className="px-3 py-2 text-right" data-testid={`qb-recon-coverage-${p.periodKey}`}>
                      {cov.overall == null ? (
                        <span className="text-brand-muted">—</span>
                      ) : cov.low ? (
                        <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-800 text-xs" title={`Below ${LOW_COVERAGE_THRESHOLD}% — not fully reconciled`}>
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          {coverageLabel(cov.overall)}
                        </Badge>
                      ) : (
                        <span className="font-mono text-brand-text">{coverageLabel(cov.overall)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-[11px] text-brand-muted">
          Coverage = matched ex-VAT value ÷ tracker-invoiced value. A flagged month is{" "}
          <span className="font-medium">not</span> fully reconciled — unmatched is the default, not an error.
          Click a row to drill into its invoice worklist.
        </p>
      </CardContent>
    </Card>
  );
}

function WorklistRow({
  line,
  onIgnore,
  ignoring,
}: {
  line: ReconLine;
  onIgnore: (line: ReconLine) => void;
  ignoring: boolean;
}) {
  const showIgnore = line.status !== "matched" || line.timingFlag;
  return (
    <tr className="border-b border-brand-muted/15" data-testid={`qb-recon-row-${line.id}`}>
      <td className="px-3 py-2 font-mono">{line.invoiceNoRaw ?? line.invoiceNoNorm}</td>
      <td className="px-3 py-2 text-right font-mono">{line.trackerAmountExVat == null ? "—" : formatZar(num(line.trackerAmountExVat))}</td>
      <td className="px-3 py-2 text-right font-mono">{line.qbAmountExVat == null ? "—" : formatZar(num(line.qbAmountExVat))}</td>
      <td className="px-3 py-2 text-right font-mono text-amber-700">{line.delta == null ? "—" : formatZar(num(line.delta))}</td>
      <td className="px-3 py-2 text-xs text-brand-muted">{line.trackerDate ?? "—"}</td>
      <td className="px-3 py-2 text-xs text-brand-muted">{line.qbDate ?? "—"}</td>
      <td className="px-3 py-2">
        {line.timingFlag && (
          <Badge variant="outline" className="mr-1 gap-1 border-sky-300 bg-sky-50 text-sky-800 text-xs">
            <Clock className="h-3 w-3" aria-hidden="true" /> Timing
          </Badge>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {showIgnore && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-brand-muted hover:text-brand-text"
            onClick={() => onIgnore(line)}
            disabled={ignoring}
            data-testid={`qb-recon-ignore-${line.id}`}
          >
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Ignore
          </Button>
        )}
      </td>
    </tr>
  );
}

function StateGroup({
  state,
  lines,
  onIgnore,
  ignoring,
  defaultOpen,
}: {
  state: MatchState;
  lines: ReconLine[];
  onIgnore: (l: ReconLine) => void;
  ignoring: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const total = lines.reduce((s, l) => s + Math.abs(num(l.trackerAmountExVat) || num(l.qbAmountExVat)), 0);
  if (lines.length === 0) return null;
  return (
    <div data-testid={`qb-recon-group-${state}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-brand-muted/5"
      >
        <span className="flex items-center gap-2">
          <StateChip state={state} />
          <span className="text-xs text-brand-muted">{lines.length} · {formatZar(total)}</span>
        </span>
        <span className="text-xs text-brand-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-muted/30 text-left text-[11px] uppercase tracking-wider text-brand-muted">
              <th className="px-3 py-1.5 font-medium">Invoice #</th>
              <th className="px-3 py-1.5 text-right font-medium">Tracker</th>
              <th className="px-3 py-1.5 text-right font-medium">QB</th>
              <th className="px-3 py-1.5 text-right font-medium">Δ</th>
              <th className="px-3 py-1.5 font-medium">Tracker date</th>
              <th className="px-3 py-1.5 font-medium">QB date</th>
              <th className="px-3 py-1.5 font-medium"></th>
              <th className="px-3 py-1.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <WorklistRow key={`${l.stream}-${l.id}`} line={l} onIgnore={onIgnore} ignoring={ignoring} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SideWorklistCard({
  title,
  worklist,
  onIgnore,
  ignoring,
}: {
  title: string;
  worklist: SideWorklist<ReconLine>;
  onIgnore: (l: ReconLine) => void;
  ignoring: boolean;
}) {
  const empty =
    worklist.matched.length +
      worklist.ambiguous.length +
      worklist.unmatchedInQb.length +
      worklist.unmatchedInTracker.length ===
    0;
  return (
    <Card data-testid={`qb-recon-side-${worklist.stream}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-brand-text">
          {title} — {worklist.openCount} to action
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {empty ? (
          <p className="px-3 py-6 text-center text-sm text-brand-muted">No invoices in this period.</p>
        ) : (
          <div className="divide-y divide-brand-muted/15">
            {/* Differences first (expanded); clean matches last (collapsed). */}
            <StateGroup state="ambiguous" lines={worklist.ambiguous} onIgnore={onIgnore} ignoring={ignoring} defaultOpen />
            <StateGroup state="unmatched_in_qb" lines={worklist.unmatchedInQb} onIgnore={onIgnore} ignoring={ignoring} defaultOpen />
            <StateGroup state="unmatched_in_tracker" lines={worklist.unmatchedInTracker} onIgnore={onIgnore} ignoring={ignoring} defaultOpen />
            <StateGroup state="matched" lines={worklist.matched} onIgnore={onIgnore} ignoring={ignoring} defaultOpen={false} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function FinanceQbReconciliationPage() {
  const [grain, setGrain] = useState<Grain>("month");
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/finance/qb-recon/lines"] });
    queryClient.invalidateQueries({ queryKey: ["/api/finance/qb-recon/ignores"] });
  };

  const ignoreMutation = useMutation({
    mutationFn: async (line: ReconLine) => {
      const reason = window.prompt(
        `Accept this ${line.stream} difference as a known/expected item (e.g. genuine timing)?\n\n` +
          `Invoice ${line.invoiceNoRaw ?? line.invoiceNoNorm}\n` +
          `tracker ${line.trackerAmountExVat ?? "—"} · QB ${line.qbAmountExVat ?? "—"}\n\n` +
          `Enter a short reason (recorded against your name + the time):`,
      );
      if (!reason || !reason.trim()) throw new Error("cancelled");
      return apiRequest("POST", "/api/finance/qb-recon/ignore", {
        stream: line.stream,
        invoiceNoNorm: line.invoiceNoNorm,
        invoiceNoRaw: line.invoiceNoRaw,
        trackerAmountExVat: line.trackerAmountExVat == null ? null : num(line.trackerAmountExVat),
        qbAmountExVat: line.qbAmountExVat == null ? null : num(line.qbAmountExVat),
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      toast({ title: "Difference accepted", description: "Dropped from the worklist; kept on the audit list." });
      invalidateAll();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "cancelled") toast({ title: "Could not ignore", description: msg, variant: "destructive" });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (ig: IgnoreView) => {
      if (ig.id == null) throw new Error("cancelled");
      const reason = window.prompt(`Restore ${ig.qbDocNumber ?? "this item"} back into the worklist?\n\nEnter a short reason:`);
      if (!reason || !reason.trim()) throw new Error("cancelled");
      return apiRequest("DELETE", `/api/finance/qb-recon/ignore/${ig.id}`, { reason: reason.trim() });
    },
    onSuccess: () => {
      toast({ title: "Restored to worklist" });
      invalidateAll();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "cancelled") toast({ title: "Could not restore", description: msg, variant: "destructive" });
    },
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

  const revWorklist = useMemo(
    () => (period ? buildSideWorklist(linesQuery.data?.lines ?? [], period.periodKey, grain, "REV") : null),
    [linesQuery.data, period, grain],
  );
  const cosWorklist = useMemo(
    () => (period ? buildSideWorklist(linesQuery.data?.lines ?? [], period.periodKey, grain, "COS") : null),
    [linesQuery.data, period, grain],
  );

  const ignores = ignoresQuery.data?.ignores ?? [];

  return (
    <div className="min-h-full bg-brand-surface text-brand-text" data-testid="qb-reconciliation-view">
      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        {/* Header + grain selector */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-brand-text">QuickBooks Reconciliation</h1>
            <p className="text-sm text-brand-muted">
              Company-wide tracker vs QuickBooks — matched on invoice number + ex-VAT amount. The app compares and flags;
              it never adjusts a tracker or writes back to QuickBooks.
            </p>
          </div>
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
        </div>

        {summaryQuery.isLoading ? (
          <LoadingState variant="skeleton-card" cards={3} />
        ) : periods.length === 0 ? (
          <div className="rounded-md border border-brand-muted/40 bg-white px-4 py-8 text-center text-sm text-brand-muted">
            No reconciliation computed yet. It refreshes daily (or trigger a refresh from the API).
          </div>
        ) : (
          <>
            {/* View 2 — month comparison table (per period across the FY) */}
            <MonthComparisonTable periods={periods} selected={period?.periodKey ?? null} onSelect={setSelectedPeriod} grain={grain} />

            {/* Selected-period summary tiles */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricTile label="Revenue" tracker={period?.rev?.trackerTotal ?? 0} qb={period?.rev?.qbTotal ?? 0} />
              <MetricTile label="COS" tracker={period?.cos?.trackerTotal ?? 0} qb={period?.cos?.qbTotal ?? 0} />
              <MetricTile label="GP" tracker={period?.gpTracker ?? 0} qb={period?.gpQb ?? 0} />
            </div>

            {/* View 3 — invoice worklist, drilled from the selected period, split
                REVENUE vs COST (the documents differ); four states each; no GP/invoice. */}
            <div>
              <h2 className="mb-2 text-sm font-semibold text-brand-text">
                Invoice worklist — {period?.periodKey} (split by side; GP is not an invoice-level concept)
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {revWorklist && (
                  <SideWorklistCard title="Revenue — client invoices ⇄ QB invoices" worklist={revWorklist} onIgnore={(l) => ignoreMutation.mutate(l)} ignoring={ignoreMutation.isPending} />
                )}
                {cosWorklist && (
                  <SideWorklistCard title="Cost — supplier invoices ⇄ QB bills" worklist={cosWorklist} onIgnore={(l) => ignoreMutation.mutate(l)} ignoring={ignoreMutation.isPending} />
                )}
              </div>
            </div>

            {/* View 4 — recon-ignores: accepted differences, excluded from the
                worklist but kept visible + audited (who / why / when). */}
            {ignores.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold text-brand-text">
                    <EyeOff className="h-4 w-4 text-brand-muted" aria-hidden="true" />
                    Recon-ignores ({ignores.length}) — accepted differences, excluded from the worklist, shown for audit
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5" data-testid="qb-recon-ignores">
                  {ignores.map((ig, i) => (
                    <div key={`${ig.source}-${ig.id ?? ig.qbDocNumber}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-xs text-brand-muted">
                      <span className="font-medium uppercase">{ig.side}</span>
                      <span className="font-mono text-brand-text">{ig.qbDocNumber ?? "—"}</span>
                      {ig.counterpartyName && <span>· {ig.counterpartyName}</span>}
                      {ig.amountExVat != null && <span>· {formatZar(ig.amountExVat)}</span>}
                      <span>· ignored by {ig.ignoredByName ?? "unknown"}, {ig.reason}</span>
                      {ig.ignoredAt && <span>· {ig.ignoredAt.slice(0, 10)}</span>}
                      {ig.source === "recon_line" && ig.id != null ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-[11px] text-brand-muted hover:text-brand-text"
                          onClick={() => restoreMutation.mutate(ig)}
                          disabled={restoreMutation.isPending}
                          data-testid={`qb-recon-restore-${ig.id}`}
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden="true" /> Restore
                        </Button>
                      ) : (
                        <span className="text-[11px] italic">(per-project — restore on the tracker-gap view)</span>
                      )}
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
