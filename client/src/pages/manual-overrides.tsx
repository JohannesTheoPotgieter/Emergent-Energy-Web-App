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
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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

  const { data, isLoading, error } = useQuery<ManualOverridesResponse>({
    queryKey: [`/api/tracker-replica/${projectId}/manual-overrides`],
    queryFn: fetchQueryFn(`/api/tracker-replica/${projectId}/manual-overrides`),
    enabled: Number.isFinite(projectId),
  });

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
              {data.entries.map((e, i) => (
                <TableRow key={`${e.table}-${e.rowId}-${e.fieldName}-${i}`}>
                  <TableCell className="font-mono text-xs">{fmtTs(e.editedAt)}</TableCell>
                  <TableCell>
                    <Badge variant={TABLE_VARIANT[e.table]}>{TABLE_LABEL[e.table]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate" title={e.displayLabel}>{e.displayLabel}</TableCell>
                  <TableCell className="font-mono text-xs">{e.fieldName}</TableCell>
                  <TableCell>{fmtVal(e.value)}</TableCell>
                  <TableCell className="text-muted-foreground line-through">{fmtVal(e.fromValue)}</TableCell>
                  <TableCell>{e.editedBy !== null ? `User #${e.editedBy}` : "—"}</TableCell>
                </TableRow>
              ))}
              {data.entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No manual overrides on record. The source workbook is the only writer for every field.
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
