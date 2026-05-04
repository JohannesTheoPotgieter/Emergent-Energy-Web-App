/**
 * Edit History — per-project audit log of in-app edits that
 * diverged from the tracker workbook.
 *
 * Reads the flattened `manual_overrides` JSONB across the three
 * canonical tables (work_items, normalized_revenue_lines,
 * normalized_cost_lines). Each entry shows what was edited, what the
 * source workbook said at the time, who made the change, and when.
 *
 * Read-only — clearing an edit happens implicitly during the next
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchQueryFn } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import { FIELD_LABELS, humaniseField } from "@/lib/field-labels";

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

// Re-export so any future callers can import from this file too.
export { FIELD_LABELS, humaniseField };

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

type SectionFilter = "all" | ManualOverrideEntry["table"];

const SECTION_OPTIONS: { value: SectionFilter; label: string }[] = [
  { value: "all", label: "All sections" },
  { value: "normalized_revenue_lines", label: "Revenue" },
  { value: "normalized_cost_lines", label: "Expenditure" },
  { value: "work_items", label: "Plan" },
];

function ManualOverridesContent({ projectId }: { projectId: number }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>("all");

  const { data, isLoading, error } = useQuery<ManualOverridesResponse>({
    queryKey: [`/api/tracker-replica/${projectId}/manual-overrides`],
    queryFn: fetchQueryFn(`/api/tracker-replica/${projectId}/manual-overrides`),
    enabled: Number.isFinite(projectId),
  });

  const filteredEntries = useMemo(() => {
    const entries = data?.entries ?? [];
    return entries.filter(e => {
      if (sectionFilter !== "all" && e.table !== sectionFilter) return false;
      const at = new Date(e.editedAt);
      if (isNaN(at.getTime())) return true;
      if (fromDate) {
        const from = new Date(fromDate + "T00:00:00");
        if (at < from) return false;
      }
      if (toDate) {
        const to = new Date(toDate + "T23:59:59.999");
        if (at > to) return false;
      }
      return true;
    });
  }, [data, fromDate, toDate, sectionFilter]);

  if (isLoading) {
    return (
      <div className="p-8 flex items-center text-muted-foreground" aria-label="Loading…">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (error || !data) {
    return <div className="p-8 text-red-600">Failed to load edit history.</div>;
  }

  const hasDateOrSectionFilter = fromDate || toDate || sectionFilter !== "all";

  return (
    <div className="space-y-6" data-testid="manual-overrides-content">
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
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Section</Label>
              <Select value={sectionFilter} onValueChange={v => setSectionFilter(v as SectionFilter)}>
                <SelectTrigger className="h-8 w-40" data-testid="filter-section">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECTION_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {hasDateOrSectionFilter && (
              <button
                type="button"
                data-testid="filter-clear"
                onClick={() => { setFromDate(""); setToDate(""); setSectionFilter("all"); }}
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
          <CardTitle className="text-base">Fields changed in the app that differ from the tracker workbook</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">When</TableHead>
                <TableHead scope="col">Section</TableHead>
                <TableHead scope="col">Row</TableHead>
                <TableHead scope="col">Field</TableHead>
                <TableHead scope="col">App value</TableHead>
                <TableHead scope="col">Workbook value</TableHead>
                <TableHead scope="col">Edited by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((e, i) => (
                <TableRow key={`${e.table}-${e.rowId}-${e.fieldName}-${i}`}>
                  <TableCell className="font-mono text-xs">{fmtTs(e.editedAt)}</TableCell>
                  <TableCell>
                    <Badge role="status" aria-label={TABLE_LABEL[e.table]} variant={TABLE_VARIANT[e.table]}>
                      {TABLE_LABEL[e.table]}
                    </Badge>
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
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                    {data.entries.length === 0
                      ? "No edits recorded yet. When someone changes a value in the app that differs from the workbook, it will appear here."
                      : "No edits found between those dates. Try widening your date range or clearing the filter."}
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

export default function ManualOverridesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  return (
    <div className="p-6 space-y-6" data-testid="manual-overrides-page">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit History</h1>
        <Badge variant="outline">Project #{projectId}</Badge>
      </header>
      <ManualOverridesContent projectId={projectId} />
    </div>
  );
}
