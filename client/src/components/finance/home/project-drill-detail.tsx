/**
 * Project drill detail — per-project MONTHLY Revenue / COS / GP for the selected
 * FY, rendered inside an expandable Finance Home table row. Mirrors the figures
 * on the Cost-of-Sales / Revenue / Gross-Profit tracker tabs.
 *
 * Fetches the canonical per-project line read (/api/finance/lines/:projectId)
 * scoped to the same FY window as the page, and shows its monthly rollup. Read
 * only; computes nothing. Figures are RECOGNISED (committed + realised) — the
 * same basis the tracker tabs headline — so they will read higher than the
 * realised-only totals on the row above.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

import { MoneyValue, FinanceLoading, FinanceError } from "@/components/finance/template";
import { monthLabelFromKey } from "@/lib/finance/home-data";
import { fetchQueryFn } from "@/lib/queryClient";

interface MonthlyRow {
  monthKey: string;
  revenue: number;
  cos: number;
  gp: number;
  gpPct: number | null;
}
interface ProjectLinesResponse {
  projectId: number;
  monthly: MonthlyRow[];
}

/** gpPct on the wire is a fraction (0.231 = 23.1%); render as a percentage. */
function pct(fraction: number | null | undefined): string {
  return fraction != null ? `${(fraction * 100).toFixed(1)}%` : "—";
}

export function ProjectDrillDetail({
  projectId,
  fyWindowQs,
}: {
  projectId: number;
  fyWindowQs: string;
}) {
  const detailQuery = useQuery<ProjectLinesResponse>({
    queryKey: ["/api/finance/lines", projectId, fyWindowQs],
    queryFn: fetchQueryFn(`/api/finance/lines/${projectId}${fyWindowQs}`),
    staleTime: 60_000,
  });

  if (detailQuery.isLoading) return <FinanceLoading label="Loading months…" />;
  if (detailQuery.isError) {
    return <FinanceError title="Could not load monthly figures." onRetry={() => detailQuery.refetch()} />;
  }

  const months = [...(detailQuery.data?.monthly ?? [])].sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );
  // FY total computed from the months shown so the footer always ties to the
  // rows above (the endpoint's `total` also folds in dateless/unrecognised
  // lines that have no month to display here).
  const total = months.reduce(
    (acc, m) => ({ revenue: acc.revenue + m.revenue, cos: acc.cos + m.cos, gp: acc.gp + m.gp }),
    { revenue: 0, cos: 0, gp: 0 },
  );
  const totalGpPct = total.revenue !== 0 ? total.gp / total.revenue : null;

  return (
    <div data-testid={`finance-home-project-drill-${projectId}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          Monthly Revenue · COS · GP — recognised (committed + realised), as on the tracker tabs.
        </p>
        <Link
          href={`/projects/${projectId}/finance`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-green hover:underline"
        >
          Open tracker tabs <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {months.length === 0 ? (
        <p className="py-2 text-xs text-slate-500">No monthly figures in this financial year.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left font-semibold">Month</th>
                <th className="px-2 py-1 text-right font-semibold">Revenue</th>
                <th className="px-2 py-1 text-right font-semibold">COS</th>
                <th className="px-2 py-1 text-right font-semibold">GP</th>
                <th className="px-2 py-1 text-right font-semibold">GP %</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.monthKey} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-medium text-slate-700">{monthLabelFromKey(m.monthKey)}</td>
                  <td className="px-2 py-1 text-right"><MoneyValue value={m.revenue} className="text-xs" /></td>
                  <td className="px-2 py-1 text-right"><MoneyValue value={m.cos} className="text-xs" /></td>
                  <td className="px-2 py-1 text-right"><MoneyValue value={m.gp} className="text-xs" /></td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-600">{pct(m.gpPct)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-700">
              <tr>
                <td className="px-2 py-1">FY total</td>
                <td className="px-2 py-1 text-right"><MoneyValue value={total.revenue} className="text-xs" /></td>
                <td className="px-2 py-1 text-right"><MoneyValue value={total.cos} className="text-xs" /></td>
                <td className="px-2 py-1 text-right"><MoneyValue value={total.gp} className="text-xs" /></td>
                <td className="px-2 py-1 text-right tabular-nums">{pct(totalGpPct)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
