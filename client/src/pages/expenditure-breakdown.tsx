/**
 * Expenditure Breakdown — per-project replica of the Tracker workbook's
 * Expenditure Breakdown sheet (the side-by-side costed / actual layout).
 *
 * Top: header strip with the sidebar values from the source sheet
 *   (USD Exchange Rate, Price per Watt — cols AB-AE).
 *
 * Body: two parallel tables.
 *   LEFT (Costed pane, source cols B–J): No., Product/Service, Description,
 *     QTY, Rate/Unit, Budget Total, Forecasted Payment Date, Total COS,
 *     Total Revenue.
 *   RIGHT (Actual pane, source cols L–AA): No., Product/Service, Description,
 *     QTY, Rate/Unit, Actual Total, PO Number, Invoice Number, Invoice Raised
 *     Date, Revenue Recognition Amount, CHECK, Finance Payment Date, Total
 *     COS, Saving/Overrun, Comments.
 *
 * When a costed line has 1:N actual batches (multiple invoices against one
 * costed item), the actual side expands to multiple rows under the same
 * costed row — sourced from `normalized_cost_line_actuals`.
 *
 * Per-cell font + fill rendering via `styleForCell` against `cell_format`.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchQueryFn } from "@/lib/queryClient";
import { styleForCell } from "@/lib/tracker-cell-format";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, AlertTriangle } from "lucide-react";

interface ExpenditureBreakdownResponse {
  projectId: number;
  costLines: Array<{
    id: number;
    sourceRow: number | null;
    costCategory: string | null;
    categoryKey: string | null;
    description: string | null;
    budgetQty: string | null;
    budgetRate: string | null;
    budgetTotal: string | null;
    budgetCos: string | null;
    forecastPaymentDate: string | null;
    actualQty: string | null;
    actualRate: string | null;
    amountExVat: string | null;
    poNumber: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    revenueRecognitionAmount: string | null;
    checkFlag: string | null;
    paidDate: string | null;
    savingOverrun: string | null;
    comments: string | null;
    cellFormat: unknown;
  }>;
  actualBatches: Array<{
    id: number;
    costLineId: number;
    actualNo: number;
    description: string | null;
    qty: string | null;
    rate: string | null;
    actualTotal: string | null;
    poNumber: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    revenueRecognitionAmount: string | null;
    financePaymentDate: string | null;
    checkFlag: string | null;
    savingOverrun: string | null;
    comments: string | null;
    cellFormat: unknown;
  }>;
  header: { usdExchangeRate: string | null; pricePerWatt: string | null };
}

const ZAR = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: 2 });
const NUM = new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
function money(v: string | null): string {
  if (!v) return "—";
  const n = Number(v);
  return isFinite(n) ? ZAR.format(n) : v;
}
function num(v: string | null): string {
  if (!v) return "—";
  const n = Number(v);
  return isFinite(n) ? NUM.format(n) : v;
}
function fmtDate(v: string | null): string {
  if (!v) return "—";
  return v.length >= 10 ? v.slice(0, 10) : v;
}

export function ExpenditureBreakdownContent({ projectId }: { projectId: number }) {
  const { data, isLoading, error } = useQuery<ExpenditureBreakdownResponse>({
    queryKey: [`/api/tracker-replica/${projectId}/expenditure-breakdown`],
    queryFn: fetchQueryFn(`/api/tracker-replica/${projectId}/expenditure-breakdown`),
    enabled: Number.isFinite(projectId),
  });

  const actualsByCostLine = useMemo(() => {
    const map = new Map<number, ExpenditureBreakdownResponse["actualBatches"]>();
    for (const a of data?.actualBatches ?? []) {
      const arr = map.get(a.costLineId) ?? [];
      arr.push(a);
      map.set(a.costLineId, arr);
    }
    return map;
  }, [data?.actualBatches]);

  if (isLoading) {
    return <div className="p-8 flex items-center text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</div>;
  }
  if (error || !data) {
    return <div className="p-8 text-red-600">Failed to load expenditure breakdown.</div>;
  }

  return (
    <div className="space-y-6" data-testid="expenditure-breakdown-content">
      <Card>
        <CardContent className="p-4 grid grid-cols-2 gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">USD Exchange Rate: </span>
            <span className="font-mono">{num(data.header.usdExchangeRate)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Price per Watt: </span>
            <span className="font-mono">{num(data.header.pricePerWatt)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Costed vs Actual</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-emerald-50">
                <th className="border p-1 text-left" colSpan={9}>Costed (source cols B–J)</th>
                <th className="border p-1 text-left" colSpan={15}>Actual (source cols L–AA)</th>
              </tr>
              <tr className="bg-muted">
                <th className="border p-1">No.</th>
                <th className="border p-1">Product / Service</th>
                <th className="border p-1">Description of Work</th>
                <th className="border p-1">QTY</th>
                <th className="border p-1">Rate / Unit</th>
                <th className="border p-1">Budget Total</th>
                <th className="border p-1">Forecasted Payment Date</th>
                <th className="border p-1">Total COS</th>
                <th className="border p-1">Total Revenue</th>
                <th className="border p-1">No.</th>
                <th className="border p-1">Product / Service</th>
                <th className="border p-1">Description of Work</th>
                <th className="border p-1">QTY</th>
                <th className="border p-1">Rate / Unit</th>
                <th className="border p-1">Actual Total</th>
                <th className="border p-1">PO Number</th>
                <th className="border p-1">Invoice Number</th>
                <th className="border p-1">Invoice Raised Date</th>
                <th className="border p-1">Revenue Recognition</th>
                <th className="border p-1">CHECK</th>
                <th className="border p-1">Finance Payment Date</th>
                <th className="border p-1">Saving / Overrun</th>
                <th className="border p-1">Comments</th>
              </tr>
            </thead>
            <tbody>
              {data.costLines.map((c, idx) => {
                const batches = actualsByCostLine.get(c.id);
                const renderActualPrimary = !batches || batches.length === 0;
                const rowSpan = batches && batches.length > 0 ? batches.length : 1;
                return (
                  <>
                    <tr key={c.id} className="hover:bg-emerald-50/30">
                      <td rowSpan={rowSpan} className="border p-1 text-center">{idx + 1}</td>
                      <td rowSpan={rowSpan} className="border p-1" style={styleForCell(c.cellFormat, "costCategory")}>{c.categoryKey ?? c.costCategory ?? "—"}</td>
                      <td rowSpan={rowSpan} className="border p-1" style={styleForCell(c.cellFormat, "description")}>{c.description ?? "—"}</td>
                      <td rowSpan={rowSpan} className="border p-1 text-right" style={styleForCell(c.cellFormat, "budgetQty")}>{num(c.budgetQty)}</td>
                      <td rowSpan={rowSpan} className="border p-1 text-right" style={styleForCell(c.cellFormat, "budgetRate")}>{num(c.budgetRate)}</td>
                      <td rowSpan={rowSpan} className="border p-1 text-right" style={styleForCell(c.cellFormat, "budgetTotal")}>{money(c.budgetTotal)}</td>
                      <td rowSpan={rowSpan} className="border p-1" style={styleForCell(c.cellFormat, "forecastPaymentDate")}>{fmtDate(c.forecastPaymentDate)}</td>
                      <td rowSpan={rowSpan} className="border p-1 text-right" style={styleForCell(c.cellFormat, "budgetCos")}>{money(c.budgetCos)}</td>
                      <td rowSpan={rowSpan} className="border p-1 text-right">—</td>
                      {renderActualPrimary ? (
                        <>
                          <td className="border p-1 text-center">1</td>
                          <td className="border p-1" style={styleForCell(c.cellFormat, "costCategory")}>{c.categoryKey ?? c.costCategory ?? "—"}</td>
                          <td className="border p-1" style={styleForCell(c.cellFormat, "description")}>{c.description ?? "—"}</td>
                          <td className="border p-1 text-right" style={styleForCell(c.cellFormat, "actualQty")}>{num(c.actualQty)}</td>
                          <td className="border p-1 text-right" style={styleForCell(c.cellFormat, "actualRate")}>{num(c.actualRate)}</td>
                          <td className="border p-1 text-right" style={styleForCell(c.cellFormat, "amountExVat")}>{money(c.amountExVat)}</td>
                          <td className={`border p-1 ${!!c.invoiceNumber && !c.poNumber ? "bg-red-50" : ""}`} style={styleForCell(c.cellFormat, "poNumber")}>
                            <div className="flex flex-col gap-0.5">
                              <span className="inline-flex items-center gap-1">
                                {c.poNumber ?? "—"}
                                {!!c.invoiceNumber && !c.poNumber && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex"><AlertTriangle className="h-3 w-3 text-red-500 shrink-0" aria-hidden="true" /></span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <p className="text-xs">Invoice recorded but no PO number — check with your finance team.</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </span>
                              {!!c.invoiceNumber && !c.poNumber && (
                                <span className="text-[9px] text-red-600 font-medium leading-none">Missing PO</span>
                              )}
                            </div>
                          </td>
                          <td className="border p-1" style={styleForCell(c.cellFormat, "invoiceNumber")}>{c.invoiceNumber ?? "—"}</td>
                          <td className="border p-1" style={styleForCell(c.cellFormat, "invoiceDate")}>{fmtDate(c.invoiceDate)}</td>
                          <td className="border p-1 text-right" style={styleForCell(c.cellFormat, "revenueRecognitionAmount")}>{money(c.revenueRecognitionAmount)}</td>
                          <td className="border p-1 text-center" style={styleForCell(c.cellFormat, "checkFlag")}>{c.checkFlag ?? "—"}</td>
                          <td className="border p-1" style={styleForCell(c.cellFormat, "paidDate")}>{fmtDate(c.paidDate)}</td>
                          <td className="border p-1 text-right" style={styleForCell(c.cellFormat, "savingOverrun")}>{money(c.savingOverrun)}</td>
                          <td className="border p-1 max-w-xs truncate" style={styleForCell(c.cellFormat, "comments")}>{c.comments ?? "—"}</td>
                        </>
                      ) : (
                        <>
                          <td className="border p-1 text-center">{batches[0].actualNo}</td>
                          <td className="border p-1" style={styleForCell(batches[0].cellFormat, "costCategory")}>{c.categoryKey ?? c.costCategory ?? "—"}</td>
                          <td className="border p-1" style={styleForCell(batches[0].cellFormat, "description")}>{batches[0].description ?? "—"}</td>
                          <td className="border p-1 text-right" style={styleForCell(batches[0].cellFormat, "qty")}>{num(batches[0].qty)}</td>
                          <td className="border p-1 text-right" style={styleForCell(batches[0].cellFormat, "rate")}>{num(batches[0].rate)}</td>
                          <td className="border p-1 text-right" style={styleForCell(batches[0].cellFormat, "actualTotal")}>{money(batches[0].actualTotal)}</td>
                          <td className={`border p-1 ${!!batches[0].invoiceNumber && !batches[0].poNumber ? "bg-red-50" : ""}`} style={styleForCell(batches[0].cellFormat, "poNumber")}>
                            <div className="flex flex-col gap-0.5">
                              <span className="inline-flex items-center gap-1">
                                {batches[0].poNumber ?? "—"}
                                {!!batches[0].invoiceNumber && !batches[0].poNumber && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex"><AlertTriangle className="h-3 w-3 text-red-500 shrink-0" aria-hidden="true" /></span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <p className="text-xs">Invoice recorded but no PO number — check with your finance team.</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </span>
                              {!!batches[0].invoiceNumber && !batches[0].poNumber && (
                                <span className="text-[9px] text-red-600 font-medium leading-none">Missing PO</span>
                              )}
                            </div>
                          </td>
                          <td className="border p-1" style={styleForCell(batches[0].cellFormat, "invoiceNumber")}>{batches[0].invoiceNumber ?? "—"}</td>
                          <td className="border p-1" style={styleForCell(batches[0].cellFormat, "invoiceDate")}>{fmtDate(batches[0].invoiceDate)}</td>
                          <td className="border p-1 text-right" style={styleForCell(batches[0].cellFormat, "revenueRecognitionAmount")}>{money(batches[0].revenueRecognitionAmount)}</td>
                          <td className="border p-1 text-center" style={styleForCell(batches[0].cellFormat, "checkFlag")}>{batches[0].checkFlag ?? "—"}</td>
                          <td className="border p-1" style={styleForCell(batches[0].cellFormat, "financePaymentDate")}>{fmtDate(batches[0].financePaymentDate)}</td>
                          <td className="border p-1 text-right" style={styleForCell(batches[0].cellFormat, "savingOverrun")}>{money(batches[0].savingOverrun)}</td>
                          <td className="border p-1 max-w-xs truncate" style={styleForCell(batches[0].cellFormat, "comments")}>{batches[0].comments ?? "—"}</td>
                        </>
                      )}
                    </tr>
                    {batches && batches.length > 1 && batches.slice(1).map((b) => (
                      <tr key={`${c.id}-batch-${b.id}`}>
                        <td className="border p-1 text-center">{b.actualNo}</td>
                        <td className="border p-1" style={styleForCell(b.cellFormat, "costCategory")}>{c.categoryKey ?? c.costCategory ?? "—"}</td>
                        <td className="border p-1" style={styleForCell(b.cellFormat, "description")}>{b.description ?? "—"}</td>
                        <td className="border p-1 text-right" style={styleForCell(b.cellFormat, "qty")}>{num(b.qty)}</td>
                        <td className="border p-1 text-right" style={styleForCell(b.cellFormat, "rate")}>{num(b.rate)}</td>
                        <td className="border p-1 text-right" style={styleForCell(b.cellFormat, "actualTotal")}>{money(b.actualTotal)}</td>
                        <td className={`border p-1 ${!!b.invoiceNumber && !b.poNumber ? "bg-red-50" : ""}`} style={styleForCell(b.cellFormat, "poNumber")}>
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1">
                              {b.poNumber ?? "—"}
                              {!!b.invoiceNumber && !b.poNumber && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex"><AlertTriangle className="h-3 w-3 text-red-500 shrink-0" aria-hidden="true" /></span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      <p className="text-xs">Invoice recorded but no PO number — check with your finance team.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </span>
                            {!!b.invoiceNumber && !b.poNumber && (
                              <span className="text-[9px] text-red-600 font-medium leading-none">Missing PO</span>
                            )}
                          </div>
                        </td>
                        <td className="border p-1" style={styleForCell(b.cellFormat, "invoiceNumber")}>{b.invoiceNumber ?? "—"}</td>
                        <td className="border p-1" style={styleForCell(b.cellFormat, "invoiceDate")}>{fmtDate(b.invoiceDate)}</td>
                        <td className="border p-1 text-right" style={styleForCell(b.cellFormat, "revenueRecognitionAmount")}>{money(b.revenueRecognitionAmount)}</td>
                        <td className="border p-1 text-center" style={styleForCell(b.cellFormat, "checkFlag")}>{b.checkFlag ?? "—"}</td>
                        <td className="border p-1" style={styleForCell(b.cellFormat, "financePaymentDate")}>{fmtDate(b.financePaymentDate)}</td>
                        <td className="border p-1 text-right" style={styleForCell(b.cellFormat, "savingOverrun")}>{money(b.savingOverrun)}</td>
                        <td className="border p-1 max-w-xs truncate" style={styleForCell(b.cellFormat, "comments")}>{b.comments ?? "—"}</td>
                      </tr>
                    ))}
                  </>
                );
              })}
              {data.costLines.length === 0 && (
                <tr><td colSpan={24} className="text-center p-3 text-muted-foreground">No expenditure data yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ExpenditureBreakdownPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  return (
    <div className="p-6 space-y-6" data-testid="expenditure-breakdown-page">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Expenditure Breakdown</h1>
        <Badge variant="outline">Tracker replica · Project #{projectId}</Badge>
      </header>
      <ExpenditureBreakdownContent projectId={projectId} />
    </div>
  );
}
