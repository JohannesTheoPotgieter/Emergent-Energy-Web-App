/**
 * ProjectFinanceCanonical — the ONE per-project finance view.
 *
 * Reads ONLY the canonical § 3.3.2 single read path
 * (`GET /api/finance/lines/:projectId`, backed by finance-line-level-repository)
 * plus the canonical reconciliation status
 * (`GET /api/finance/reconciliation/:projectId`). These are the exact figures
 * the Finance pages (Revenue / COS / GP) and the Reconciliation board render,
 * so a project shows ONE REV / COS / GP everywhere.
 *
 * It replaced five embedded tabs (RevenueTrackingTab, RevenueTrackerTab,
 * MonthlyRealisationTab, GpTrackerTab) that each recomputed finance off a
 * parallel per-project endpoint — the biggest project-level trust risk. No
 * finance number is computed here: every value is read from the canonical
 * response and only summed for display.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { KpiTile } from "@/components/finance/KpiTile";
import {
  ReconStatusChip,
  type ReconDisplayStatus,
} from "@/components/finance/recon-status";
import { fetchQueryFn } from "@/lib/queryClient";
import { formatZar } from "@/lib/currency";
import { useFinancialYearScope } from "@/hooks/use-financial-year-scope";
import { ArrowRight, ShieldCheck } from "lucide-react";

export type FinanceFocus = "revenue" | "cos" | "gp";

// Canonical monthly recon row (server: aggregateLinesByMonth → MonthlyReconRow).
interface ReconRow {
  monthKey: string;
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
  plannedCos: number;
  plannedRevenue: number;
  plannedGp: number;
  realisedCos: number;
  realisedRevenue: number;
  realisedGp: number;
  realisedGpPct: number | null;
}
interface FinanceLinesResponse {
  projectId: number;
  total: ReconRow;
  monthly: ReconRow[];
}
interface ReconDetailResponse {
  status: ReconDisplayStatus;
  reason: string;
}

const FOCUS_META: Record<FinanceFocus, { label: string; realised: keyof ReconRow; planned: keyof ReconRow; tone: "positive" | "default" }> = {
  revenue: { label: "Revenue", realised: "realisedRevenue", planned: "plannedRevenue", tone: "positive" },
  cos: { label: "Cost of Sales", realised: "realisedCos", planned: "plannedCos", tone: "default" },
  gp: { label: "Gross Profit", realised: "realisedGp", planned: "plannedGp", tone: "positive" },
};

function monthLabel(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
}

export function ProjectFinanceCanonical({
  projectId,
  focus,
}: {
  projectId: number | null;
  projectName?: string;
  focus: FinanceFocus;
}) {
  const fyScope = useFinancialYearScope();
  const fyQs = fyScope.allData ? "" : `?fyStart=${fyScope.startDate}&fyEnd=${fyScope.endDate}`;

  const linesQuery = useQuery<FinanceLinesResponse>({
    enabled: projectId != null,
    queryKey: ["/api/finance/lines", projectId, fyScope.apiQueryString],
    queryFn: fetchQueryFn(`/api/finance/lines/${projectId}${fyQs}`),
    staleTime: 60_000,
  });
  const reconQuery = useQuery<ReconDetailResponse>({
    enabled: projectId != null,
    queryKey: ["/api/finance/reconciliation", projectId],
    queryFn: fetchQueryFn(`/api/finance/reconciliation/${projectId}`),
    staleTime: 60_000,
  });

  const total = linesQuery.data?.total ?? null;
  const meta = FOCUS_META[focus];

  const monthsWithActivity = useMemo(
    () => (linesQuery.data?.monthly ?? []).filter((m) => m.revenue !== 0 || m.cos !== 0),
    [linesQuery.data],
  );

  if (projectId == null) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Select a project to view its finance.</p>;
  }
  if (linesQuery.isLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading canonical finance…</p>;
  }
  if (linesQuery.isError || !total) {
    return <p className="text-sm text-red-700 py-8 text-center">Could not load canonical finance for this project.</p>;
  }

  const reconStatus: ReconDisplayStatus = reconQuery.data?.status ?? "unknown";
  const num = (row: ReconRow, key: keyof ReconRow) => (row[key] as number) ?? 0;

  return (
    <div className="space-y-4" data-testid={`project-finance-canonical-${focus}`}>
      {/* Trust banner — provenance of every figure on this view. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-800">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Canonical finance — the single §3.3.2 read path. Identical to the Finance pages and the Reconciliation board.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase text-muted-foreground">Recon</span>
          <ReconStatusChip status={reconStatus} />
        </span>
      </div>

      {/* Canonical REV / COS / GP — always shown together so they reconcile. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiTile
          label="Revenue · realised"
          value={<Money value={total.realisedRevenue} />}
          tone={focus === "revenue" ? "positive" : "default"}
          supporting={`Planned ${formatZar(total.plannedRevenue)}`}
          href="/revenue-tracker"
        />
        <KpiTile
          label="COS · realised"
          value={<Money value={total.realisedCos} />}
          tone={focus === "cos" ? "warning" : "default"}
          supporting={`Planned ${formatZar(total.plannedCos)}`}
          href="/cos"
        />
        <KpiTile
          label="GP · realised"
          value={<Money value={total.realisedGp} />}
          tone={focus === "gp" ? "positive" : "default"}
          supporting={
            total.realisedGpPct != null ? `Margin ${(total.realisedGpPct * 100).toFixed(1)}%` : "Margin —"
          }
          href="/finance/gp/company"
        />
      </div>

      {/* Focus-specific monthly breakdown (canonical recognition month). */}
      <Card data-testid={`project-finance-canonical-monthly-${focus}`}>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-sm">{meta.label} — monthly (realised vs planned)</CardTitle>
          <Link
            href="/finance/qb-reconciliation"
            className="text-xs font-medium text-brand-green hover:underline inline-flex items-center gap-1"
          >
            QB Reconciliation <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="pt-0">
          {monthsWithActivity.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No recognised {meta.label.toLowerCase()} this period.</p>
          ) : (
            <table className="w-full text-xs sm:text-sm" data-testid={`canonical-month-table-${focus}`}>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left font-medium py-1.5">Month</th>
                  <th className="text-right font-medium py-1.5">Realised</th>
                  <th className="text-right font-medium py-1.5">Planned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {monthsWithActivity.map((m) => (
                  <tr key={m.monthKey}>
                    <td className="py-1.5">{monthLabel(m.monthKey)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      <Money value={num(m, meta.realised)} />
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                      {formatZar(num(m, meta.planned))}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5">Total</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    <Money value={num(total, meta.realised)} />
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {formatZar(num(total, meta.planned))}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="mr-1.5 text-[9px]">canonical</Badge>
            Revenue is the §3.3 category-scoped per-line POC; GP = Revenue − COS. No figure is recomputed
            on this page — for line-level edits use the Finance pages.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
