/**
 * Finance Home — the answer-first finance landing.
 *
 * Opens with the four questions the weekly finance meeting asks, each a single
 * figure + trend + drill-down, sourced from EXISTING canonical endpoints (no
 * new calculation, no figure changes):
 *
 *   1. GP this month vs budget        → /api/cos-tracker + /api/revenue-tracker
 *                                        (GP = Revenue − COS, same pipeline as
 *                                         the GP page; see lib/finance/gp-summary)
 *   2. Revenue recognised vs FY target→ /api/company-overview
 *                                        (executiveSummary.revenueVsTarget).
 *                                        Target is the planned-revenue proxy —
 *                                        rendered PROVISIONAL pending a board FY
 *                                        target (P4.4).
 *   3. Cash available this week       → /api/cashflow-2026 (current week
 *                                        availablePayment).
 *   4. Tracker-vs-QB (COMPANY only)   → /api/finance/qb-recon/summary (current
 *                                        period REV/COS/GP, company grain). QB
 *                                        cost bills aren't project-tagged, so QB
 *                                        reconciles at company level ONLY — there
 *                                        is no per-project QB anywhere on this page.
 *
 * Below the four answers: the per-project app-vs-tracker reconciliation health
 * list, reusing the reconciliation portfolio data, sorted attention-first. Each
 * row shows the project, its app-vs-tracker delta, and its app-vs-tracker status
 * (Ties / Drift / Structural) — never a per-project QB column.
 *
 * Brand: centralised tokens only (brand-* / status-* utilities, design/tokens).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { KpiTile } from "@/components/finance/KpiTile";
import { TrustBadge } from "@/components/finance/TrustBadge";
import {
  ReconStatusChip,
  RECON_STATUS_RANK,
  type ReconDisplayStatus,
} from "@/components/finance/recon-status";
import { fetchQueryFn } from "@/lib/queryClient";
import { formatZarCompact } from "@/lib/currency";
import { coveragePct, coverageLabel, LOW_COVERAGE_THRESHOLD } from "@/lib/finance/qb-recon-coverage";
import { useFinancialYearScope } from "@/hooks/use-financial-year-scope";
import {
  buildGpMonthSummaries,
  pickCurrentMonth,
  type CosTrackerMonth,
  type RevTrackerResponse,
} from "@/lib/finance/gp-summary";
import { ArrowRight, GitCompare } from "lucide-react";

// ── Response shapes (subset of canonical endpoints) ───────────────────────────

interface CompanyOverviewResponse {
  executiveSummary?: {
    revenueVsTarget?: { actual: number; target: number; pct: number };
  };
}

interface CashflowWeek {
  weekStart: string;
  weekEnd: string;
  availablePayment: number;
  hasAvailPayOverride: boolean;
}

interface ReconProject {
  projectId: number;
  projectName: string;
  /** App-vs-tracker status (the §3.3 cross-check). There is no per-project QB
   *  status — QB cost bills aren't project-tagged (company-grain QB only). */
  status: ReconDisplayStatus;
  /** Σ (app §3.3 revenue − pasted tracker value), signed. */
  appVsTrackerDelta: number;
  absDelta: number;
}
interface ReconResponse {
  projects: ReconProject[];
  summary: { total: number; red: number; unlinked: number; amber: number; green: number; unknown: number };
}

// Company-wide tracker-vs-QuickBooks summary (the R2 invoice-level engine).
interface QbReconRow {
  stream: "COS" | "REV";
  trackerTotal: number;
  qbTotal: number;
  matchedTotal: number;
  varianceTotal: number;
}
interface QbReconPeriod {
  periodKey: string;
  rev: QbReconRow | null;
  cos: QbReconRow | null;
  gpTracker: number;
  gpQb: number;
  gpDelta: number;
}
interface QbReconSummaryResp {
  grain: string;
  periods: QbReconPeriod[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const todayIso = new Date().toISOString().slice(0, 10);
const currentYyyyMm = todayIso.slice(0, 7);

function variancePct(actual: number, base: number): number | undefined {
  return base !== 0 ? ((actual - base) / Math.abs(base)) * 100 : undefined;
}

function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(d.getTime())) return weekStart;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

/** Per-metric tracker-vs-QB delta for the company QB tile (ties within R1). */
function qbMetric(tracker: number, qb: number): { delta: number; tie: boolean; text: string } {
  const delta = Number((tracker - qb).toFixed(2));
  const tie = Math.abs(delta) <= 1;
  return { delta, tie, text: tie ? "ties" : `Δ ${formatZarCompact(delta)}` };
}

/**
 * Explicit empty-state tile value — visually distinct from a real "R 0" figure
 * (muted, lighter, italic, smaller) so "we have no data" never reads as "the
 * value is zero" (mirrors the formatZar integrity rule in lib/currency.ts).
 */
function noDataValue(text: string) {
  return <span className="text-base font-medium italic text-slate-400">{text}</span>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FinanceHomePage() {
  const fyScope = useFinancialYearScope();
  const qs = fyScope.apiQueryString;

  // GP — cos + revenue trackers (FY-scoped, default current FY).
  const cosQuery = useQuery<CosTrackerMonth[]>({
    queryKey: ["/api/cos-tracker", qs],
    queryFn: fetchQueryFn(`/api/cos-tracker?${qs}`),
    staleTime: 60_000,
  });
  const revQuery = useQuery<RevTrackerResponse>({
    queryKey: ["/api/revenue-tracker", qs],
    queryFn: fetchQueryFn(`/api/revenue-tracker?${qs}`),
    staleTime: 60_000,
  });

  // Revenue recognised vs FY target — company overview executive summary.
  const overviewQuery = useQuery<CompanyOverviewResponse>({
    queryKey: ["/api/company-overview"],
    queryFn: fetchQueryFn("/api/company-overview"),
    staleTime: 60_000,
  });

  // Cash available this week — weekly cashflow series.
  const cashflowQuery = useQuery<{ weeks: CashflowWeek[] }>({
    queryKey: ["/api/cashflow-2026"],
    queryFn: fetchQueryFn("/api/cashflow-2026"),
    staleTime: 60_000,
  });

  // Per-project app-vs-tracker health — reconciliation portfolio (no QB here).
  const reconQuery = useQuery<ReconResponse>({
    queryKey: ["/api/finance/reconciliation"],
    queryFn: fetchQueryFn("/api/finance/reconciliation"),
    staleTime: 60_000,
  });

  // Company-wide tracker-vs-QuickBooks for the current month (the R2 engine).
  const qbReconQuery = useQuery<QbReconSummaryResp>({
    queryKey: ["/api/finance/qb-recon/summary", "month"],
    queryFn: fetchQueryFn("/api/finance/qb-recon/summary?grain=month"),
    staleTime: 60_000,
  });

  const gp = useMemo(() => {
    const months = buildGpMonthSummaries(cosQuery.data ?? [], revQuery.data?.months ?? []);
    return pickCurrentMonth(months, currentYyyyMm);
  }, [cosQuery.data, revQuery.data]);

  const gpCur = gp.current;
  // Non-null ONLY when the month has genuine realised tracker activity (some
  // realised revenue OR some realised COS). A break-even month (realised rev =
  // realised COS, GP = R0) still has data and renders "R 0"; a month with no
  // realised lines at all renders the explicit "No data" empty state instead.
  const gpRealised =
    gpCur != null && (gpCur.realisedRevenue !== 0 || gpCur.realisedCOS !== 0) ? gpCur : null;

  const revVsTarget = overviewQuery.data?.executiveSummary?.revenueVsTarget ?? null;

  const currentWeek = useMemo(() => {
    const weeks = cashflowQuery.data?.weeks ?? [];
    return (
      weeks.find((w) => w.weekStart <= todayIso && todayIso < w.weekEnd) ??
      weeks.find((w) => w.weekStart <= todayIso) ??
      null
    );
  }, [cashflowQuery.data]);

  // The current month's QB reconciliation (fallback to the latest period).
  const qbPeriod = useMemo(() => {
    const periods = qbReconQuery.data?.periods ?? [];
    if (periods.length === 0) return null;
    return periods.find((p) => p.periodKey === currentYyyyMm) ?? periods[periods.length - 1];
  }, [qbReconQuery.data]);

  const cq = useMemo(() => {
    if (!qbPeriod) return null;
    const rev = qbMetric(qbPeriod.rev?.trackerTotal ?? 0, qbPeriod.rev?.qbTotal ?? 0);
    const cos = qbMetric(qbPeriod.cos?.trackerTotal ?? 0, qbPeriod.cos?.qbTotal ?? 0);
    const gp = qbMetric(qbPeriod.gpTracker, qbPeriod.gpQb);
    // Match coverage = matched ex-VAT ÷ tracker-invoiced ex-VAT (company-wide).
    // A low-coverage period is never shown as fully reconciled (S5).
    const matched = (qbPeriod.rev?.matchedTotal ?? 0) + (qbPeriod.cos?.matchedTotal ?? 0);
    const trackerInvoiced = (qbPeriod.rev?.trackerTotal ?? 0) + (qbPeriod.cos?.trackerTotal ?? 0);
    const coverage = coveragePct(matched, trackerInvoiced);
    const coverageLow = coverage != null && coverage < LOW_COVERAGE_THRESHOLD;
    return {
      periodKey: qbPeriod.periodKey,
      rev,
      cos,
      gp,
      allTie: rev.tie && cos.tie && gp.tie,
      coverage,
      coverageLow,
    };
  }, [qbPeriod]);

  // Portfolio reconciliation posture — drives the trust badge on the
  // tracker-derived figures (GP, Revenue). "Do these numbers reconcile?"
  const portfolioTrust: "ties" | "drift" = useMemo(() => {
    const s = reconQuery.data?.summary;
    return s && s.red + s.amber + s.unlinked > 0 ? "drift" : "ties";
  }, [reconQuery.data]);

  const healthRows = useMemo(() => {
    const projects = [...(reconQuery.data?.projects ?? [])];
    // Attention-first on the app-vs-tracker status alone — there is no
    // per-project QB status to factor in (QB cost bills aren't project-tagged).
    return projects.sort((a, b) => {
      const rankA = RECON_STATUS_RANK[a.status];
      const rankB = RECON_STATUS_RANK[b.status];
      if (rankA !== rankB) return rankA - rankB;
      return (b.absDelta ?? 0) - (a.absDelta ?? 0);
    });
  }, [reconQuery.data]);

  const gpLoading = cosQuery.isLoading || revQuery.isLoading;
  const placeholder = (loading: boolean) => (loading ? "…" : "—");

  return (
    <PageShell data-testid="finance-home-page">
      {/* Header — title only; the Emergent logo lives in the global app
          header (AppLayout), so the page must not render a second one. */}
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
          Finance Home
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          The four answers the weekly meeting asks — {fyScope.label}.
        </p>
      </div>

      {/* The four answers */}
      <section className="mb-3" data-testid="finance-home-answers" aria-label="Headline finance answers">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {/* 1 — GP this month vs budget */}
          <KpiTile
            data-testid="finance-home-gp"
            label="GP this month"
            description={gpCur?.monthLabel}
            value={
              gpLoading
                ? "…"
                : gpRealised
                  ? <Money value={gpRealised.realisedGP} />
                  : noDataValue("No data")
            }
            tone={
              gpRealised && gpRealised.budgetGP !== 0
                ? gpRealised.realisedGP >= gpRealised.budgetGP
                  ? "positive"
                  : "critical"
                : "default"
            }
            supporting={
              gpRealised
                ? gpRealised.realisedMarginPct != null
                  ? `Margin ${gpRealised.realisedMarginPct.toFixed(1)}%`
                  : "No realised revenue this month"
                : gpLoading
                  ? "Loading…"
                  : "No realised tracker data this month"
            }
            delta={
              gpRealised && gpRealised.budgetGP !== 0
                ? {
                    label: "vs budget",
                    priorValue: <Money value={gpRealised.budgetGP} />,
                    pct: variancePct(gpRealised.realisedGP, gpRealised.budgetGP),
                    positiveIs: "good",
                  }
                : undefined
            }
            sourceBadge={reconQuery.data ? <TrustBadge status={portfolioTrust} /> : undefined}
            href="/finance/gp/company"
          />

          {/* 2 — Revenue recognised vs FY target (provisional target) */}
          <KpiTile
            data-testid="finance-home-revenue"
            label="Revenue recognised"
            description="FYTD"
            value={revVsTarget ? <Money value={revVsTarget.actual} /> : placeholder(overviewQuery.isLoading)}
            tone="positive"
            progress={revVsTarget ? { pct: revVsTarget.pct, tone: "positive" } : undefined}
            supporting={
              revVsTarget ? (
                <span className="inline-flex items-center gap-1.5">
                  <span>
                    vs FY plan {formatZarCompact(revVsTarget.target)} · {revVsTarget.pct}%
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[9px] border-status-drift/40 text-status-drift"
                    title="Target is the planned-revenue proxy, not a board-set FY target. Pending P4.4."
                  >
                    Provisional
                  </Badge>
                </span>
              ) : overviewQuery.isLoading ? (
                "Loading…"
              ) : (
                "No data"
              )
            }
            sourceBadge={reconQuery.data ? <TrustBadge status={portfolioTrust} /> : undefined}
            href="/revenue-tracker"
          />

          {/* 3 — Cash available this week */}
          <KpiTile
            data-testid="finance-home-cash"
            label="Cash available this week"
            description={currentWeek ? `Week of ${weekLabel(currentWeek.weekStart)}` : undefined}
            value={currentWeek ? <Money value={currentWeek.availablePayment} /> : placeholder(cashflowQuery.isLoading)}
            tone={currentWeek ? (currentWeek.availablePayment >= 0 ? "positive" : "critical") : "default"}
            supporting={
              currentWeek
                ? currentWeek.hasAvailPayOverride
                  ? "Manual override in effect"
                  : "Opening + inflows − outflows"
                : cashflowQuery.isLoading
                  ? "Loading…"
                  : "No week in range"
            }
            href="/cashflow"
          />

          {/* 4 — Tracker vs QuickBooks (COMPANY-WIDE invoice match, current period).
                 QB is not project-tagged, so this is the ONLY QB surface on the
                 page. No qb-recon result for the period → an explicit empty state,
                 never a silent "—". */}
          <KpiTile
            data-testid="finance-home-tracker-qb"
            label="Tracker vs QuickBooks"
            description={cq ? `Invoice match · ${cq.periodKey}` : "Company-wide"}
            value={
              qbReconQuery.isLoading
                ? "…"
                : cq
                  ? cq.allTie
                    ? cq.coverageLow
                      ? "Ties · low cov"
                      : "Ties"
                    : "Variance"
                  : noDataValue("Not run")
            }
            tone={cq ? (cq.allTie && !cq.coverageLow ? "positive" : "warning") : "default"}
            supporting={
              cq
                ? `Rev ${cq.rev.text} · COS ${cq.cos.text} · GP ${cq.gp.text} · Cov ${coverageLabel(cq.coverage)}`
                : qbReconQuery.isLoading
                  ? "Loading…"
                  : qbReconQuery.isError
                    ? "QB recon unavailable right now"
                    : "QB recon not run for this period"
            }
            sourceBadge={cq ? <TrustBadge status={cq.allTie && !cq.coverageLow ? "ties" : "drift"} /> : undefined}
            href="/finance/qb-reconciliation"
          />
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          Revenue target is <span className="font-medium">provisional</span> — the sum of planned
          revenue, pending a board-set FY revenue target (P4.4). Every tile reads the same canonical
          endpoints as the finance pages; GP this month is Revenue − COS from those trackers — the
          identical derivation the GP page uses — so Home never shows a figure the finance pages
          don&apos;t.
        </p>
      </section>

      {/* Per-project app-vs-tracker reconciliation health (no per-project QB) */}
      <section aria-label="Project reconciliation health">
        <Card data-testid="finance-home-health">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-brand-green" />
              Project reconciliation health
              <Badge variant="outline" className="text-[10px]">{healthRows.length}</Badge>
            </CardTitle>
            <Link
              href="/finance/qb-reconciliation"
              className="text-xs font-medium text-brand-green hover:underline inline-flex items-center gap-1"
            >
              QB Reconciliation <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="pt-0">
            {reconQuery.isLoading ? (
              <p className="text-xs text-muted-foreground py-6 text-center">Loading project health…</p>
            ) : reconQuery.isError ? (
              <p className="text-xs text-red-700 py-6 text-center">Could not load reconciliation health.</p>
            ) : healthRows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No active projects.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {healthRows.map((p) => (
                  <li key={p.projectId} className="py-2" data-testid={`finance-home-health-row-${p.projectId}`}>
                    <Link
                      href={`/projects/${p.projectId}/finance`}
                      className="flex items-center justify-between gap-3 -mx-2 px-2 py-1 rounded hover:bg-[hsl(var(--surface-tint))] transition-colors"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {p.projectName}
                      </span>
                      <span
                        className="font-mono text-xs tabular-nums text-muted-foreground shrink-0 w-24 text-right"
                        title="App §3.3 revenue minus the pasted tracker value (app-vs-tracker delta)"
                      >
                        Δ {p.absDelta === 0 ? formatZarCompact(0) : formatZarCompact(p.appVsTrackerDelta)}
                      </span>
                      <ReconStatusChip status={p.status} className="shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </PageShell>
  );
}
