/**
 * Cashflow drill-down — week ▸ line item ▸ invoice.
 *
 * Groups the per-week `/api/weekly-cashflow/detail` leaves (produced by the
 * FROZEN weekly cashflow engine, bucketed on the §3.4 cash-event date) into
 * line-item nodes that expand to invoice leaves. No cash number is computed
 * here — `sum(invoices) === line item === week total` by construction (see
 * `@/lib/cashflow-drill`). Inflow = cash in, outflow = cash out; realised
 * (BLACK = received/paid) vs forecast (RED). All amounts ex-VAT.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, Download, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { formatZar } from "@/lib/currency";
import { exportToCSV, type ExportColumn } from "@/lib/export-table";
import {
  buildCashflowWeekDrill,
  cashflowDrillLeaves,
  type CashInflowInput,
  type CashOutflowInput,
  type CashLineItemGroup,
} from "@/lib/cashflow-drill";

const money = (n: number | null | undefined): string => formatZar(n);

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "direction", header: "Direction" },
  { key: "projectName", header: "Project" },
  { key: "lineItem", header: "Line item" },
  { key: "category", header: "Category" },
  { key: "invoiceNumber", header: "Invoice No" },
  { key: "paymentDate", header: "Payment Date (col W)" },
  { key: "amount", header: "Amount ex-VAT" },
  { key: "paidState", header: "Paid state" },
  { key: "sourceRow", header: "Source Row" },
];

function StateBadge({ realised }: { realised: boolean }) {
  return (
    <Badge
      variant={realised ? "default" : "destructive"}
      className={realised ? "" : "bg-red-600 hover:bg-red-600"}
    >
      {realised ? "Paid / received" : "Forecast"}
    </Badge>
  );
}

export function CashflowDrillView({
  weekStart,
  inflows,
  outflows,
}: {
  weekStart: string;
  inflows: readonly CashInflowInput[];
  outflows: readonly CashOutflowInput[];
}) {
  const drill = useMemo(
    () => buildCashflowWeekDrill(weekStart, inflows, outflows),
    [weekStart, inflows, outflows],
  );
  const [focus, setFocus] = useState<CashLineItemGroup | null>(null);

  const handleExport = () => {
    const leaves = focus ? focus.invoices : cashflowDrillLeaves(drill);
    const scope = focus ? focus.lineItem.replace(/\W+/g, "_") : "week";
    exportToCSV(leaves, EXPORT_COLUMNS, `cashflow-drill-${weekStart}-${scope}`);
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 mb-4" data-testid="cashflow-drill">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {focus ? (
                <BreadcrumbLink asChild>
                  <button type="button" onClick={() => setFocus(null)} data-testid="cf-crumb-week">
                    Week of {weekStart}
                  </button>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>Week of {weekStart}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {focus && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{focus.lineItem}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <ArrowUpRight className="h-3 w-3" /> In {money(drill.inflowTotal)}
          </span>
          <span className="inline-flex items-center gap-1 text-red-700">
            <ArrowDownRight className="h-3 w-3" /> Out {money(drill.outflowTotal)}
          </span>
          <span className="text-muted-foreground">· Net {money(drill.net)} (ex-VAT)</span>
          <Button size="sm" variant="outline" onClick={handleExport} data-testid="cf-drill-export">
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </div>

      {focus ? (
        <>
          <Button size="sm" variant="ghost" className="mb-2" onClick={() => setFocus(null)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back to week
          </Button>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Payment date (W)</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Source row</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {focus.invoices.map((leaf) => (
                <TableRow
                  key={`${leaf.direction}-${leaf.id}`}
                  className={leaf.paidState === "realised" ? "" : "text-red-700"}
                  data-testid={`cf-leaf-${leaf.direction}-${leaf.id}`}
                >
                  <TableCell className="font-medium">{leaf.invoiceNumber ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{leaf.paymentDate ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(leaf.amount)}</TableCell>
                  <TableCell><StateBadge realised={leaf.paidState === "realised"} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{leaf.projectName}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {leaf.sourceRow ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GroupTable
            title="Inflows"
            direction="inflow"
            groups={drill.inflowGroups}
            onFocus={setFocus}
          />
          <GroupTable
            title="Outflows"
            direction="outflow"
            groups={drill.outflowGroups}
            onFocus={setFocus}
          />
        </div>
      )}
    </div>
  );
}

function GroupTable({
  title,
  direction,
  groups,
  onFocus,
}: {
  title: string;
  direction: "inflow" | "outflow";
  groups: CashLineItemGroup[];
  onFocus: (g: CashLineItemGroup) => void;
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className={`px-3 py-2 text-sm font-semibold ${direction === "inflow" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
        {title}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project · line item</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Realised / Forecast</TableHead>
            <TableHead className="text-right">#</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground text-sm">
                None this week.
              </TableCell>
            </TableRow>
          )}
          {groups.map((g) => (
            <TableRow
              key={g.key}
              className="cursor-pointer hover:bg-muted/40"
              onClick={() => onFocus(g)}
              data-testid={`cf-group-${g.key}`}
            >
              <TableCell>
                <div className="font-medium">{g.lineItem}</div>
                <div className="text-xs text-muted-foreground">
                  {g.projectName}
                  {g.category ? ` · ${g.category}` : ""}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(g.amount)}</TableCell>
              <TableCell className="text-right tabular-nums leading-tight">
                <span className="text-foreground font-semibold">{money(g.realisedAmount)}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="text-red-600">{money(g.forecastAmount)}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{g.count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default CashflowDrillView;
