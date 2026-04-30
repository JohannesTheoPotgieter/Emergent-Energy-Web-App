/**
 * Revenue Tracking — per-project replica of the Tracker workbook's
 * Revenue Tracking sheet (rows 2–25 of the source).
 *
 * Two sections, top to bottom:
 *   1. High-level summary card: Planned Revenue / Expenditure / Profit /
 *      Margin × Costed / Actual (from `tracker_revenue_summary`).
 *   2. Contract Milestones table with all 9 columns from the source
 *      sheet's milestone block (from `normalized_revenue_lines`).
 *
 * Per-cell font + fill colour from `cell_format` is rendered via the
 * `styleForCell` helper. Tracker conventions:
 *   - red font = unconfirmed value or negative number
 *   - yellow fill = concern / risk
 *   - black / no fill = confirmed (default)
 */
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fetchQueryFn } from "@/lib/queryClient";
import { styleForCell } from "@/lib/tracker-cell-format";
import { Loader2 } from "lucide-react";

interface RevenueTrackingResponse {
  projectId: number;
  summary: {
    plannedRevenueCosted: string | null;
    plannedRevenueActual: string | null;
    plannedExpenditureCosted: string | null;
    plannedExpenditureActual: string | null;
    plannedProfitCosted: string | null;
    plannedProfitActual: string | null;
    plannedMarginCosted: string | null;
    plannedMarginActual: string | null;
    cellFormat: unknown;
  } | null;
  milestones: Array<{
    id: number;
    milestoneNo: string | null;
    milestoneName: string | null;
    milestonePercent: string | null;
    amountExVat: string | null;
    expectedPaymentDate: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    paidDate: string | null;
    milestoneNotes: string | null;
    cellFormat: unknown;
  }>;
}

const ZAR = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: 2 });
function money(v: string | null): string {
  if (!v) return "—";
  const n = Number(v);
  return isFinite(n) ? ZAR.format(n) : v;
}
function pct(v: string | null): string {
  if (!v) return "—";
  const n = Number(v);
  return isFinite(n) ? `${(n * 100).toFixed(2)}%` : v;
}
function fmtDate(v: string | null): string {
  if (!v) return "—";
  return v.length >= 10 ? v.slice(0, 10) : v;
}

export default function RevenueTrackingPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);

  const { data, isLoading, error } = useQuery<RevenueTrackingResponse>({
    queryKey: [`/api/tracker-replica/${projectId}/revenue-tracking`],
    queryFn: fetchQueryFn(`/api/tracker-replica/${projectId}/revenue-tracking`),
    enabled: Number.isFinite(projectId),
  });

  if (isLoading) {
    return <div className="p-8 flex items-center text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</div>;
  }
  if (error || !data) {
    return <div className="p-8 text-red-600">Failed to load revenue tracking.</div>;
  }

  const s = data.summary;
  const summaryCells = [
    { label: "Planned Revenue", costed: s ? money(s.plannedRevenueCosted) : "—", actual: s ? money(s.plannedRevenueActual) : "—", fields: ["plannedRevenueCosted", "plannedRevenueActual"] },
    { label: "Planned Expenditure", costed: s ? money(s.plannedExpenditureCosted) : "—", actual: s ? money(s.plannedExpenditureActual) : "—", fields: ["plannedExpenditureCosted", "plannedExpenditureActual"] },
    { label: "Planned Profit", costed: s ? money(s.plannedProfitCosted) : "—", actual: s ? money(s.plannedProfitActual) : "—", fields: ["plannedProfitCosted", "plannedProfitActual"] },
    { label: "Planned Margin", costed: s ? pct(s.plannedMarginCosted) : "—", actual: s ? pct(s.plannedMarginActual) : "—", fields: ["plannedMarginCosted", "plannedMarginActual"] },
  ];

  return (
    <div className="p-6 space-y-6" data-testid="revenue-tracking-page">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Revenue Tracking</h1>
        <Badge variant="outline">Tracker replica · Project #{projectId}</Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">High-level Project Revenue Tracking</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead></TableHead>
                <TableHead>Costed</TableHead>
                <TableHead>Actual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryCells.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell style={s ? styleForCell(s.cellFormat, row.fields[0]) : {}}>{row.costed}</TableCell>
                  <TableCell style={s ? styleForCell(s.cellFormat, row.fields[1]) : {}}>{row.actual}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!s && <p className="text-xs text-muted-foreground mt-2">No summary data yet — run a Smart Import for this project to populate.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contract Milestones</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No.</TableHead>
                <TableHead>Payment Milestone</TableHead>
                <TableHead>%</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Planned Payment Date</TableHead>
                <TableHead>Invoice Number</TableHead>
                <TableHead>Invoice Raised Date</TableHead>
                <TableHead>Payment Received Date</TableHead>
                <TableHead>Milestone Notes &amp; Comments</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.milestones.map((m) => (
                <TableRow key={m.id}>
                  <TableCell style={styleForCell(m.cellFormat, "milestoneNo")}>{m.milestoneNo ?? "—"}</TableCell>
                  <TableCell style={styleForCell(m.cellFormat, "milestoneName")}>{m.milestoneName ?? "—"}</TableCell>
                  <TableCell style={styleForCell(m.cellFormat, "milestonePercent")}>{pct(m.milestonePercent)}</TableCell>
                  <TableCell style={styleForCell(m.cellFormat, "amountExVat")}>{money(m.amountExVat)}</TableCell>
                  <TableCell style={styleForCell(m.cellFormat, "expectedPaymentDate")}>{fmtDate(m.expectedPaymentDate)}</TableCell>
                  <TableCell style={styleForCell(m.cellFormat, "invoiceNumber")}>{m.invoiceNumber ?? "—"}</TableCell>
                  <TableCell style={styleForCell(m.cellFormat, "invoiceDate")}>{fmtDate(m.invoiceDate)}</TableCell>
                  <TableCell style={styleForCell(m.cellFormat, "paidDate")}>{fmtDate(m.paidDate)}</TableCell>
                  <TableCell style={styleForCell(m.cellFormat, "milestoneNotes")} className="max-w-xs truncate">{m.milestoneNotes ?? "—"}</TableCell>
                </TableRow>
              ))}
              {data.milestones.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground">No milestones yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
