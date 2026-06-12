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
 * Compact finance template: header (+ grain selector) → KPI row (REV/COS/GP
 * tracker-vs-QB for the selected period) → a DrillTable period comparison (the
 * grouped trk·QB·Δ columns FLATTENED to numeric columns, kept in compact ZAR) →
 * an invoice worklist split REVENUE / COST, each side rendered through DrillTables
 * under collapsible four-state group headings. Presentation only — no figure changes.
 * Brand: centralised tokens; every state pairs an icon + word (colour-blind safe).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileMinus,
  FilePlus,
  HelpCircle,
  Clock,
  EyeOff,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

import { fetchQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatZar, formatZarCompact } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FinancePageHeader,
  KpiRow,
  KpiTile,
  MoneyValue,
  StatusBadge,
  DrillTable,
  FinanceLoading,
  FinanceEmpty,
  FinanceError,
  type StatusTone,
  type DrillColumn,
} from "@/components/finance/template";
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
/** Compact ZAR for the period table (intentionally compact, not whole-Rand). */
const money = (v: number) => <span title={formatZar(v)}>{formatZarCompact(v)}</span>;

const STATE_META: Record<MatchState, { label: string; icon: LucideIcon; tone: StatusTone }> = {
  matched: { label: "Matched", icon: CheckCircle2, tone: "ties" },
  ambiguous: { label: "Ambiguous", icon: HelpCircle, tone: "warning" },
  unmatched_in_qb: { label: "Unmatched in QB", icon: FileMinus, tone: "neutral" },
  unmatched_in_tracker: { label: "Unmatched in tracker", icon: FilePlus, tone: "neutral" },
};

function StateChip({ state }: { state: MatchState }) {
  const m = STATE_META[state];
  return <StatusBadge tone={m.tone} icon={m.icon} label={m.label} data-testid={`qb-recon-state-${state}`} />;
}

/** trk · QB · Δ for one metric, as a compact text triple for the KPI supporting line. */
function tripleText(tracker: number, qb: number): string {
  const d = variance(tracker, qb);
  const tie = Math.abs(d) <= TOLERANCE;
  return `tracker ${formatZarCompact(tracker)} · QB ${formatZarCompact(qb)}${tie ? "" : ` · Δ ${formatZarCompact(d)}`}`;
}

// ── Period comparison — flattened numeric columns (compact ZAR) ────────────────
// The DrillTable has no colSpan super-headers, so the grouped Rev/COS/GP triples
// are flattened to individual numeric columns. Cells keep the LOCAL compact money()
// renderer (the period table intentionally uses compact, not whole-Rand MoneyValue).

/** One metric's Δ cell — em-dash on tie, amber compact Δ otherwise. */
function deltaCell(tracker: number, qb: number) {
  const d = variance(tracker, qb);
  const tie = Math.abs(d) <= TOLERANCE;
  return tie ? <span className="text-brand-muted">—</span> : <span className="text-amber-700 font-semibold">Δ {money(d)}</span>;
}

function periodColumns(grainLabel: string): DrillColumn<PeriodSummary>[] {
  return [
    {
      key: "period",
      header: grainLabel,
      cell: (p) => (
        <span className="font-medium text-brand-text" data-testid={`qb-recon-month-row-${p.periodKey}`}>
          {p.periodKey}
        </span>
      ),
    },
    { key: "revTrk", header: "Rev trk", numeric: true, cell: (p) => money(p.rev?.trackerTotal ?? 0) },
    { key: "revQb", header: "Rev QB", numeric: true, cell: (p) => <span className="text-brand-muted">{money(p.rev?.qbTotal ?? 0)}</span> },
    { key: "revD", header: "Rev Δ", numeric: true, cell: (p) => deltaCell(p.rev?.trackerTotal ?? 0, p.rev?.qbTotal ?? 0) },
    { key: "cosTrk", header: "COS trk", numeric: true, cell: (p) => money(p.cos?.trackerTotal ?? 0) },
    { key: "cosQb", header: "COS QB", numeric: true, cell: (p) => <span className="text-brand-muted">{money(p.cos?.qbTotal ?? 0)}</span> },
    { key: "cosD", header: "COS Δ", numeric: true, cell: (p) => deltaCell(p.cos?.trackerTotal ?? 0, p.cos?.qbTotal ?? 0) },
    { key: "gpTrk", header: "GP trk", numeric: true, cell: (p) => money(p.gpTracker) },
    { key: "gpQb", header: "GP QB", numeric: true, cell: (p) => <span className="text-brand-muted">{money(p.gpQb)}</span> },
    { key: "gpD", header: "GP Δ", numeric: true, cell: (p) => deltaCell(p.gpTracker, p.gpQb) },
    {
      key: "coverage",
      header: "Coverage",
      align: "right",
      cell: (p) => {
        const cov = monthCoverage(p);
        return (
          <span data-testid={`qb-recon-coverage-${p.periodKey}`}>
            {cov.overall == null ? (
              <span className="text-brand-muted">—</span>
            ) : cov.low ? (
              <StatusBadge
                tone="warning"
                label={coverageLabel(cov.overall)}
                title={`Below ${LOW_COVERAGE_THRESHOLD}% — not fully reconciled`}
              />
            ) : (
              <span className="font-mono text-brand-text">{coverageLabel(cov.overall)}</span>
            )}
          </span>
        );
      },
    },
  ];
}

// ── Invoice worklist ──────────────────────────────────────────────────────────

/** The four-state worklist columns for one side (REV or COS). */
function worklistColumns(
  onIgnore: (line: ReconLine) => void,
  ignoring: boolean,
): DrillColumn<ReconLine>[] {
  return [
    { key: "invoice", header: "Invoice #", cell: (l) => <span className="font-mono" data-testid={`qb-recon-row-${l.id}`}>{l.invoiceNoRaw ?? l.invoiceNoNorm}</span> },
    { key: "tracker", header: "Tracker", numeric: true, cell: (l) => (l.trackerAmountExVat == null ? "—" : <MoneyValue value={num(l.trackerAmountExVat)} />) },
    { key: "qb", header: "QB", numeric: true, cell: (l) => (l.qbAmountExVat == null ? "—" : <MoneyValue value={num(l.qbAmountExVat)} />) },
    {
      key: "delta",
      header: "Δ",
      numeric: true,
      cell: (l) => <span className="text-amber-700">{l.delta == null ? "—" : <MoneyValue value={num(l.delta)} muteNegative={false} />}</span>,
    },
    { key: "trackerDate", header: "Tracker date", hideBelowMd: true, cell: (l) => <span className="text-xs text-brand-muted">{l.trackerDate ?? "—"}</span> },
    { key: "qbDate", header: "QB date", hideBelowMd: true, cell: (l) => <span className="text-xs text-brand-muted">{l.qbDate ?? "—"}</span> },
    { key: "timing", header: "", cell: (l) => (l.timingFlag ? <StatusBadge tone="info" icon={Clock} label="Timing" /> : null) },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (l) =>
        l.status !== "matched" || l.timingFlag ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-brand-muted hover:text-brand-text"
            onClick={() => onIgnore(l)}
            disabled={ignoring}
            data-testid={`qb-recon-ignore-${l.id}`}
          >
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Ignore
          </Button>
        ) : null,
    },
  ];
}

/** One collapsible four-state group: heading (chip + count + total) → DrillTable. */
function StateGroup({
  state,
  lines,
  columns,
  defaultOpen,
}: {
  state: MatchState;
  lines: ReconLine[];
  columns: DrillColumn<ReconLine>[];
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
          <span className="text-xs text-brand-muted">{lines.length} · <MoneyValue value={total} align="left" /></span>
        </span>
        <span className="text-xs text-brand-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <DrillTable
          columns={columns}
          rows={lines}
          rowKey={(l) => `${l.stream}-${l.id}`}
          stickyHeader={false}
          className="border-0"
          data-testid={`qb-recon-group-table-${state}`}
        />
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
  const columns = useMemo(() => worklistColumns(onIgnore, ignoring), [onIgnore, ignoring]);
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
          <FinanceEmpty title="No invoices in this period." />
        ) : (
          <div className="divide-y divide-brand-muted/15">
            {/* Differences first (expanded); clean matches last (collapsed). */}
            <StateGroup state="ambiguous" lines={worklist.ambiguous} columns={columns} defaultOpen />
            <StateGroup state="unmatched_in_qb" lines={worklist.unmatchedInQb} columns={columns} defaultOpen />
            <StateGroup state="unmatched_in_tracker" lines={worklist.unmatchedInTracker} columns={columns} defaultOpen />
            <StateGroup state="matched" lines={worklist.matched} columns={columns} defaultOpen={false} />
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

  const grainLabel = grain === "month" ? "Month" : grain === "week" ? "Week" : "Day";
  const periodCols = useMemo(() => periodColumns(grainLabel), [grainLabel]);

  // Selected-period REV / COS / GP triples for the KPI row.
  const kpis = useMemo(() => {
    const metric = (tracker: number, qb: number) => {
      const delta = round2(tracker - qb);
      const tie = Math.abs(delta) <= TOLERANCE;
      return { tracker, qb, delta, tie };
    };
    return {
      rev: metric(period?.rev?.trackerTotal ?? 0, period?.rev?.qbTotal ?? 0),
      cos: metric(period?.cos?.trackerTotal ?? 0, period?.cos?.qbTotal ?? 0),
      gp: metric(period?.gpTracker ?? 0, period?.gpQb ?? 0),
    };
  }, [period]);

  const kpiTile = (label: string, key: "rev" | "cos" | "gp") => {
    const m = kpis[key];
    return (
      <KpiTile
        data-testid={`qb-recon-tile-${label.toLowerCase()}`}
        label={label}
        value={<MoneyValue value={m.tracker} align="left" muteNegative={false} />}
        tone={m.tie ? "positive" : "warning"}
        supporting={tripleText(m.tracker, m.qb)}
        sourceBadge={<StatusBadge tone={m.tie ? "ties" : "warning"} label={m.tie ? "Tie" : "Variance"} />}
      />
    );
  };

  return (
    <div className="min-h-full bg-brand-surface text-brand-text" data-testid="qb-reconciliation-view">
      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        {/* Header + grain selector */}
        <FinancePageHeader
          title="QuickBooks Reconciliation"
          question="Company-wide tracker vs QuickBooks — matched on invoice number + ex-VAT amount. The app compares and flags; it never adjusts a tracker or writes back to QuickBooks."
          source="QB invoice-match engine · ex-VAT"
          period={
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
          }
        />

        {summaryQuery.isLoading ? (
          <FinanceLoading label="Loading reconciliation…" />
        ) : summaryQuery.isError ? (
          <FinanceError
            hint={(summaryQuery.error as Error)?.message}
            onRetry={() => void summaryQuery.refetch()}
          />
        ) : periods.length === 0 ? (
          <FinanceEmpty
            title="No reconciliation computed yet"
            hint="It refreshes daily (or trigger a refresh from the API)."
          />
        ) : (
          <>
            {/* Selected-period summary tiles (REV / COS / GP tracker-vs-QB) */}
            <KpiRow>
              {kpiTile("Revenue", "rev")}
              {kpiTile("COS", "cos")}
              {kpiTile("GP", "gp")}
            </KpiRow>

            {/* Period comparison table — tracker vs QB REV/COS/GP + Δ + coverage.
                Click a row to drill its invoice worklist below. */}
            <div>
              <h2 className="mb-2 text-sm font-semibold text-brand-text">
                Tracker vs QuickBooks by {grainLabel.toLowerCase()} — REV / COS / GP + variance + match coverage
              </h2>
              <DrillTable
                data-testid="qb-recon-month-table"
                columns={periodCols}
                rows={periods}
                rowKey={(p) => p.periodKey}
                onRowClick={(p) => setSelectedPeriod(p.periodKey)}
                maxBodyHeightClass="max-h-[50vh]"
                caption="Tracker vs QuickBooks per period with variance and match coverage."
              />
              <p className="px-1 py-2 text-[11px] text-brand-muted">
                Coverage = matched ex-VAT value ÷ tracker-invoiced value. A flagged period is{" "}
                <span className="font-medium">not</span> fully reconciled — unmatched is the default, not an error.
                Click a row to drill into its invoice worklist.
              </p>
            </div>

            {/* Invoice worklist, drilled from the selected period, split
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

            {/* Recon-ignores: accepted differences, excluded from the worklist
                but kept visible + audited (who / why / when). Audit footer. */}
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
                      {ig.amountExVat != null && <span>· <MoneyValue value={ig.amountExVat} align="left" /></span>}
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
                        <span className="text-[11px] italic">(per-project — restore on the per-project recon view)</span>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <p className="text-xs text-brand-muted">
              QB COS bills aren&apos;t project-tagged, so this reconciliation is company-wide (no project dimension).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
