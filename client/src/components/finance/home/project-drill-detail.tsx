/**
 * Project drill detail — the Project → Line → Invoice → tracker source-cell leg,
 * rendered inside an expandable Finance Home table row.
 *
 * Fetches the canonical per-project reconciliation detail
 * (/api/finance/reconciliation/:projectId), which returns each contributing
 * line with its derived revenue, GP and the tracker cell it came from. Read
 * only; computes nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, FileSpreadsheet } from "lucide-react";

import { MoneyValue, FinanceLoading, FinanceError } from "@/components/finance/template";
import { fetchQueryFn } from "@/lib/queryClient";

interface ReconDetailLine {
  lineId: number;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  revenueDerived: number;
  perLineGp: number;
  bucket: string | null;
  sourceCell: string | null;
  offending: boolean;
}
interface ReconProjectDetailResponse {
  projectId: number;
  projectName: string | null;
  reason: string;
  lines: ReconDetailLine[];
}

const MAX_ROWS = 12;

export function ProjectDrillDetail({ projectId }: { projectId: number }) {
  const detailQuery = useQuery<ReconProjectDetailResponse>({
    queryKey: ["/api/finance/reconciliation", projectId],
    queryFn: fetchQueryFn(`/api/finance/reconciliation/${projectId}`),
    staleTime: 60_000,
  });

  if (detailQuery.isLoading) return <FinanceLoading label="Loading lines…" />;
  if (detailQuery.isError) {
    return <FinanceError title="Could not load lines." onRetry={() => detailQuery.refetch()} />;
  }

  const lines = detailQuery.data?.lines ?? [];
  const shown = lines.slice(0, MAX_ROWS);

  return (
    <div data-testid={`finance-home-project-drill-${projectId}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">{detailQuery.data?.reason}</p>
        <Link
          href={`/projects/${projectId}/finance`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-green hover:underline"
        >
          Open tracker tabs <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="py-2 text-xs text-slate-500">No contributing lines.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left font-semibold">Invoice</th>
                <th className="px-2 py-1 text-right font-semibold">Revenue</th>
                <th className="px-2 py-1 text-right font-semibold">GP</th>
                <th className="px-2 py-1 text-left font-semibold">Source cell</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.lineId} className="border-t border-slate-100">
                  <td className="px-2 py-1">
                    <span className="font-medium text-slate-700">{l.invoiceNumber || "—"}</span>
                    {l.invoiceRaisedDate && (
                      <span className="ml-1 text-[10px] text-slate-400">{l.invoiceRaisedDate}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <MoneyValue value={l.revenueDerived} className="text-xs" />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <MoneyValue value={l.perLineGp} className="text-xs" />
                  </td>
                  <td className="px-2 py-1">
                    {l.sourceCell ? (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-500">
                        <FileSpreadsheet className="h-3 w-3 text-slate-400" />
                        {l.sourceCell}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lines.length > MAX_ROWS && (
            <p className="px-2 py-1 text-[10px] text-slate-400">
              Showing {MAX_ROWS} of {lines.length} lines — open the tracker tabs for the full list.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
