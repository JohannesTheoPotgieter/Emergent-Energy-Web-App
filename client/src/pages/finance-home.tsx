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
 *   4. Tracker-vs-QB status           → /api/finance/reconciliation (per-project
 *                                        qbStatus counts).
 *
 * Below the four answers: the per-project GP / reconciliation health list,
 * reusing the reconciliation portfolio data, sorted attention-first.
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
import { useFinancialYearScope } from "@/hooks/use-financial-year-scope";
import {
  buildGpMonthSummaries,
  pickCurrentMonth,
  type CosTrackerMonth,
  type RevTrackerResponse,
} from "@/lib/finance/gp-summary";
import { brand } from "@/design/tokens";
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
  status: ReconDisplayStatus;
  qbStatus: ReconDisplayStatus;
  appVsTrackerDelta: number;
  absDelta: number;
  qbDelta: number;
}
interface ReconResponse {
  projects: ReconProject[];
  summary: { total: number; red: number; amber: number; green: number; unknown: number };
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
  const cashflowQuery = useQuery<CashflowWeek[]>({
    queryKey: ["/api/cashflow-2026"],
    queryFn: fetchQueryFn("/api/cashflow-2026"),
    staleTime: 60_000,
  });

  // Tracker-vs-QB + per-project health — reconciliation portfolio.
  const reconQuery = useQuery<ReconResponse>({
    queryKey: ["/api/finance/reconciliation"],
    queryFn: fetchQueryFn("/api/finance/reconciliation"),
    staleTime: 60_000,
  });

  const gp = useMemo(() => {
    const months = buildGpMonthSummaries(cosQuery.data ?? [], revQuery.data?.months ?? []);
    return pickCurrentMonth(months, currentYyyyMm);
  }, [cosQuery.data, revQuery.data]);

  const revVsTarget = overviewQuery.data?.executiveSummary?.revenueVsTarget ?? null;

  const currentWeek = useMemo(() => {
    const weeks = cashflowQuery.data ?? [];
    return (
      weeks.find((w) => w.weekStart <= todayIso && todayIso < w.weekEnd) ??
      weeks.find((w) => w.weekStart <= todayIso) ??
      null
    );
  }, [cashflowQuery.data]);

  const qb = useMemo(() => {
    const projects = reconQuery.data?.projects ?? [];
    let green = 0;
    let needsReview = 0;
    let noData = 0;
    for (const p of projects) {
      if (p.qbStatus === "green") green += 1;
      else if (p.qbStatus === "amber" || p.qbStatus === "red") needsReview += 1;
      else noData += 1;
    }
    return { green, needsReview, noData, total: projects.length };
  }, [reconQuery.data]);

  // Portfolio reconciliation posture — drives the trust badge on the
  // tracker-derived figures (GP, Revenue). "Do these numbers reconcile?"
  const portfolioTrust: "ties" | "drift" = useMemo(() => {
    const s = reconQuery.data?.summary;
    return s && s.red + s.amber > 0 ? "drift" : "ties";
  }, [reconQuery.data]);

  const healthRows = useMemo(() => {
    const projects = [...(reconQuery.data?.projects ?? [])];
    return projects.sort((a, b) => {
      const worstA = Math.min(RECON_STATUS_RANK[a.status], RECON_STATUS_RANK[a.qbStatus]);
      const worstB = Math.min(RECON_STATUS_RANK[b.status], RECON_STATUS_RANK[b.qbStatus]);
      if (worstA !== worstB) return worstA - worstB;
      return (b.absDelta ?? 0) - (a.absDelta ?? 0);
    });
  }, [reconQuery.data]);

  const gpLoading = cosQuery.isLoading || revQuery.isLoading;
  const placeholder = (loading: boolean) => (loading ? "…" : "—");

  return (
    <PageShell data-testid="finance-home-page">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <img src={brand.logo} alt="Emergent Energy" className="h-8 w-auto" />
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Finance Home
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              The four answers the weekly meeting asks — {fyScope.label}.
            </p>
          </div>
        </div>
      </div>

      {/* The four answers */}
      <section className="mb-3" data-testid="finance-home-answers" aria-label="Headline finance answers">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {/* 1 — GP this month vs budget */}
          <KpiTile
            data-testid="finance-home-gp"
            label="GP this month"
            description={gp.current?.monthLabel}
            value={gp.current ? <Money value={gp.current.realisedGP} /> : placeholder(gpLoading)}
            tone={
              gp.current && gp.current.budgetGP !== 0
                ? gp.current.realisedGP >= gp.current.budgetGP
                  ? "positive"
                  : "critical"
                : "default"
            }
            supporting={
              gp.current?.realisedMarginPct != null
                ? `Margin ${gp.current.realisedMarginPct.toFixed(1)}%`
                : gpLoading
                  ? "Loading…"
                  : "No tracker data this month"
            }
            delta={
              gp.current && gp.current.budgetGP !== 0
                ? {
                    label: "vs budget",
                    priorValue: <Money value={gp.current.budgetGP} />,
                    pct: variancePct(gp.current.realisedGP, gp.current.budgetGP),
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

          {/* 4 — Tracker vs QuickBooks */}
          <KpiTile
            data-testid="finance-home-tracker-qb"
            label="Tracker vs QuickBooks"
            description={reconQuery.data ? `of ${qb.total} projects` : undefined}
            value={reconQuery.data ? `${qb.green} tie` : placeholder(reconQuery.isLoading)}
            tone={qb.needsReview > 0 ? "warning" : "positive"}
            supporting={
              reconQuery.data
                ? `${qb.needsReview} need review${qb.noData > 0 ? ` · ${qb.noData} no QB data` : ""}`
                : reconQuery.isLoading
                  ? "Loading…"
                  : "No data"
            }
            sourceBadge={
              reconQuery.data ? (
                <TrustBadge
                  status={qb.needsReview > 0 ? "drift" : "ties"}
                  label={qb.needsReview > 0 ? `${qb.needsReview} drift` : "Ties"}
                />
              ) : undefined
            }
            href="/finance/reconciliation"
          />
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          Revenue target is <span className="font-medium">provisional</span> — the sum of planned
          revenue, pending a board-set FY revenue target (P4.4). All figures read from canonical
          endpoints; no values are recalculated here.
        </p>
      </section>

      {/* Per-project GP / reconciliation health */}
      <section aria-label="Project reconciliation health">
        <Card data-testid="finance-home-health">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-brand-green" />
              Project GP &amp; reconciliation health
              <Badge variant="outline" className="text-[10px]">{healthRows.length}</Badge>
            </CardTitle>
            <Link
              href="/finance/reconciliation"
              className="text-xs font-medium text-brand-green hover:underline inline-flex items-center gap-1"
            >
              Reconciliation board <ArrowRight className="h-3 w-3" />
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
                      <span className="font-mono text-xs tabular-nums text-muted-foreground shrink-0 w-24 text-right">
                        {p.absDelta === 0 ? formatZarCompact(0) : formatZarCompact(p.appVsTrackerDelta)}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        <span className="text-[9px] font-medium uppercase text-muted-foreground">App</span>
                        <ReconStatusChip status={p.status} />
                      </span>
                      <span className="hidden sm:flex items-center gap-1 shrink-0">
                        <span className="text-[9px] font-medium uppercase text-muted-foreground">QB</span>
                        <ReconStatusChip status={p.qbStatus} />
                      </span>
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
