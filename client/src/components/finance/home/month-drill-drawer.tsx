/**
 * Month drill drawer — the Month → Project → Invoice → tracker source-cell leg
 * of the Finance Home drill chain.
 *
 * Opened from a revenue-by-month bar. Lists the month's projects (realised
 * revenue from the canonical revenue tracker), and on selecting one fetches the
 * canonical invoice leaves (/api/finance/drill/invoices) — each carrying its
 * tracker source cell, so a headline figure can always be traced to the cell it
 * came from. Read-only; no figure is computed here.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, ChevronRight, FileSpreadsheet } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MoneyValue, FinanceLoading, FinanceEmpty, FinanceError } from "@/components/finance/template";
import { fetchQueryFn } from "@/lib/queryClient";
import type { ProjectAmount } from "@/lib/finance/home-data";

interface DrillInvoiceLeaf {
  lineId: number | null;
  parentLineId: number | null;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  perLineRevenue: number;
  perLineGp: number;
  bucket: string | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  sourceCell: string | null;
}
interface DrillInvoicesResponse {
  projectId: number;
  invoices: DrillInvoiceLeaf[];
  total: number;
  subtotal: { revenue: number; cos: number; gp: number; count: number };
}

export interface MonthDrillTarget {
  monthKey: string;
  monthLabel: string;
  projects: ProjectAmount[];
}

export function MonthDrillDrawer({
  target,
  fy,
  nameById,
  onClose,
}: {
  target: MonthDrillTarget | null;
  fy: number | null;
  nameById: Map<string, number>;
  onClose: () => void;
}) {
  const [selected, setSelected] = React.useState<{ id: number; name: string } | null>(null);

  // Reset the selected project whenever the month changes.
  React.useEffect(() => {
    setSelected(null);
  }, [target?.monthKey]);

  const invoicesQuery = useQuery<DrillInvoicesResponse>({
    queryKey: ["/api/finance/drill/invoices", fy, selected?.id, target?.monthKey],
    queryFn: fetchQueryFn(
      `/api/finance/drill/invoices?fy=${fy}&projectId=${selected?.id}&month=${target?.monthKey}`,
    ),
    enabled: selected != null && target != null && fy != null,
    staleTime: 60_000,
  });

  const projects = [...(target?.projects ?? [])].sort((a, b) => b.amount - a.amount);

  return (
    <Sheet open={target != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto" data-testid="finance-home-month-drill">
        <SheetHeader>
          <SheetTitle>{target?.monthLabel ?? "Month"} — drill-down</SheetTitle>
          <SheetDescription>
            Realised revenue by project. Pick a project to see its invoice lines and the tracker
            cell each figure came from.
          </SheetDescription>
        </SheetHeader>

        {/* Step 1 — projects in this month */}
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
            Projects ({projects.length})
          </p>
          {projects.length === 0 ? (
            <FinanceEmpty title="No realised revenue this month." />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {projects.map((p) => {
                const id = nameById.get(p.projectName) ?? null;
                const isSel = selected?.id === id;
                return (
                  <li key={p.projectName}>
                    <button
                      type="button"
                      disabled={id == null}
                      onClick={() => id != null && setSelected({ id, name: p.projectName })}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                        isSel ? "bg-emerald-50" : "hover:bg-slate-50"
                      } ${id == null ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <ChevronRight
                          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isSel ? "rotate-90" : ""}`}
                        />
                        <span className="truncate font-medium text-slate-700">{p.projectName}</span>
                      </span>
                      <MoneyValue value={p.amount} className="text-sm" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Step 2 — invoice lines + source cell for the selected project */}
        {selected && (
          <div className="mt-4" data-testid="finance-home-month-drill-invoices">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {selected.name} · invoice lines
              </p>
              <Link
                href={`/projects/${selected.id}/finance`}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-green hover:underline"
              >
                Open project finance <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {invoicesQuery.isLoading ? (
              <FinanceLoading label="Loading invoice lines…" />
            ) : invoicesQuery.isError ? (
              <FinanceError title="Could not load invoice lines." onRetry={() => invoicesQuery.refetch()} />
            ) : (invoicesQuery.data?.invoices.length ?? 0) === 0 ? (
              <FinanceEmpty title="No invoice lines for this project this month." />
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold">Invoice</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Revenue</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Source cell</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicesQuery.data!.invoices.map((inv, i) => (
                      <tr key={inv.lineId ?? i} className="border-t border-slate-100">
                        <td className="px-2 py-1.5">
                          <span className="font-medium text-slate-700">
                            {inv.invoiceNumber || "—"}
                          </span>
                          {inv.invoiceRaisedDate && (
                            <span className="ml-1 text-[11px] text-slate-400">{inv.invoiceRaisedDate}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <MoneyValue value={inv.perLineRevenue} className="text-sm" />
                        </td>
                        <td className="px-2 py-1.5">
                          {inv.sourceCell ? (
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500">
                              <FileSpreadsheet className="h-3 w-3 text-slate-400" />
                              {inv.sourceCell}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
