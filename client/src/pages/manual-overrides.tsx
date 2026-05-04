/**
 * Manual Overrides — per-project audit log of in-app edits that
 * diverged from the source workbook.
 *
 * Reads the flattened `manual_overrides` JSONB across the three
 * canonical tables (work_items, normalized_revenue_lines,
 * normalized_cost_lines). Each entry shows what was edited, what the
 * source workbook said at the time, who made the change, and when.
 *
 * Read-only — clearing an override happens implicitly during the next
 * Smart Import (when the user resolves the conflict in the wizard).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchQueryFn } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

interface ManualOverrideEntry {
  table: "normalized_revenue_lines" | "normalized_cost_lines" | "work_items";
  rowId: number;
  sourceRow: number | null;
  displayLabel: string;
  fieldName: string;
  value: string | number | boolean | null;
  fromValue: string | number | boolean | null;
  editedBy: number | null;
  editedByName: string | null;
  editedAt: string;
}

interface ManualOverridesResponse {
  projectId: number;
  entries: ManualOverrideEntry[];
}

const TABLE_LABEL: Record<ManualOverrideEntry["table"], string> = {
  normalized_revenue_lines: "Revenue",
  normalized_cost_lines: "Expenditure",
  work_items: "Plan",
};

const TABLE_VARIANT: Record<ManualOverrideEntry["table"], "default" | "secondary" | "outline"> = {
  normalized_revenue_lines: "default",
  normalized_cost_lines: "secondary",
  work_items: "outline",
};

/** Human-readable labels for DB column names surfaced in manual_overrides JSONB. */
const FIELD_LABELS: Record<string, string> = {
  // Cost lines
  expense_po_number: "PO Number",
  expense_invoice_number: "Invoice Number",
  expense_invoiced_date: "Invoice Date",
  expense_payment_date: "Payment Date",
  expense_actual_total: "Actual Total",
  expense_category: "Expense Category",
  expense_line_item: "Line Item",
  budget_total: "Budget Total",
  budget_qty: "Budget Qty",
  budget_rate_unit: "Budget Rate / Unit",
  forecast_payment_date: "Forecast Payment Date",
  line_status: "Line Status",
  actual_qty: "Actual Qty",
  actual_rate: "Actual Rate",
  comments: "Comments",
  check_flag: "Check Flag",
  saving_overrun: "Saving / Overrun",
  usd_exchange_rate: "USD Exchange Rate",
  price_per_watt: "R/W Price",
  // Revenue lines
  milestone_name: "Milestone Name",
  milestone_amount: "Milestone Amount",
  milestone_percent: "Milestone %",
  milestone_invoice_number: "Invoice Number",
  invoice_raised_date: "Invoice Raised Date",
  in_bank: "In Bank",
  milestone_notes: "Notes",
  date: "Date",
  // Work items
  title: "Task Title",
  start_date: "Start Date",
  end_date: "End Date",
  duration: "Duration",
  percent_complete: "% Complete",
  expected_pct_complete: "% Expected",
  work_days: "Work Days",
  owner_name: "Owner",
  lead: "Lead",
  tracker_comments: "Comments",
  resource1: "Resource 1",
  resource2: "Resource 2",
};

function humaniseField(fieldName: string): string {
  if (FIELD_LABELS[fieldName]) return FIELD_LABELS[fieldName];
  // Camel-case fields (from manualOverrides keys that mirror JS property names).
  return fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function fmtTs(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

function fmtVal(v: ManualOverrideEntry["value"]): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export default function ManualOverridesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { data, isLoading, error } = useQuery<ManualOverridesResponse>({
    queryKey: [`/api/tracker-replica/${projectId}/manual-overrides`],
    queryFn: fetchQueryFn(`/api/tracker-replica/${projectId}/manual-overrides`),
    enabled: Number.isFinite(projectId),
  });

  const filteredEntries = useMemo(() => {
    const entries = data?.entries ?? [];
    return entries.filter(e => {
      const at = new Date(e.editedAt);
      if (isNaN(at.getTime())) return true; // don't drop unparseable entries
      if (fromDate) {
        // "T00:00:00" (no Z) → local midnight so the boundary matches the
        // user's wall-clock date rather than UTC midnight.
        const from = new Date(fromDate + "T00:00:00");
        if (at < from) return false;
      }
      if (toDate) {
        const to = new Date(toDate + "T23:59:59.999");
        if (at > to) return false;
      }
      return true;
    });
  }, [data, fromDate, toDate]);

  if (isLoading) {
    return <div className="p-8 flex items-center text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</div>;
  }
  if (error || !data) {
    return <div className="p-8 text-red-600">Failed to load manual override log.</div>;
  }

  return (
    <div className="p-6 space-y-6" data-testid="manual-overrides-page">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Manual Edit Log</h1>
        <Badge variant="outline">Project #{projectId}</Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex flex-col gap-1">
              <Label htmlFor="from-date" className="text-xs text-muted-foreground">From</Label>
              <Input
                id="from-date"
                data-testid="filter-from-date"
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="to-date" className="text-xs text-muted-foreground">To</Label>
              <Input
                id="to-date"
                data-testid="filter-to-date"
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            {(fromDate || toDate) && (
              <button
                type="button"
                data-testid="filter-clear"
                onClick={() => { setFromDate(""); setToDate(""); }}
                className="text-xs text-muted-foreground hover:text-foreground underline pb-1"
              >
                Clear
              </button>
            )}
            <span data-testid="filter-entry-count" className="text-xs text-muted-foreground pb-1">
              {filteredEntries.length} of {data.entries.length} entries
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">In-app edits that diverged from the source workbook</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Row</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>App value (kept)</TableHead>
                <TableHead>Source value (overridden)</TableHead>
                <TableHead>Edited by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((e, i) => (
                <TableRow key={`${e.table}-${e.rowId}-${e.fieldName}-${i}`}>
                  <TableCell className="font-mono text-xs">{fmtTs(e.editedAt)}</TableCell>
                  <TableCell>
                    <Badge variant={TABLE_VARIANT[e.table]}>{TABLE_LABEL[e.table]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate" title={e.displayLabel}>{e.displayLabel}</TableCell>
                  <TableCell>
                    <span className="font-medium text-sm">{humaniseField(e.fieldName)}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">({e.fieldName})</span>
                  </TableCell>
                  <TableCell>{fmtVal(e.value)}</TableCell>
                  <TableCell className="text-muted-foreground line-through">{fmtVal(e.fromValue)}</TableCell>
                  <TableCell>
                    {e.editedByName ?? (e.editedBy !== null ? `User #${e.editedBy}` : "—")}
                  </TableCell>
                </TableRow>
              ))}
              {filteredEntries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    {data.entries.length === 0
                      ? "No manual overrides on record. The source workbook is the only writer for every field."
                      : "No entries match the current date filter."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
