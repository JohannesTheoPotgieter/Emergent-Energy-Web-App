/**
 * ImportsNeedingAttention — a card listing every project whose latest Smart
 * Import needs a human (needs review / failed / in progress).
 *
 * Reads /api/import-config/attention and renders one row per item with the
 * project name, source file, state badge, reason, relative time, and a link
 * into the Smart Import area to action it. Empty state reads
 * "All imports up to date".
 */

import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { formatRelativeWithAbsoluteZA } from "@/lib/datetime";
import { useImportsNeedingAttention } from "@/hooks/use-import-config";
import { ImportStateBadge } from "@/components/import/import-state-badge";

const SMART_IMPORT_PATH = "/admin/smart-import";

export function ImportsNeedingAttention() {
  const { data, isLoading, error } = useImportsNeedingAttention();
  const items = data?.items ?? [];

  return (
    <Card data-testid="imports-needing-attention">
      <CardContent className="pt-6">
        {isLoading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading imports…
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-rose-700">
            Could not load imports needing attention.
          </div>
        ) : items.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-10 text-center"
            data-testid="imports-attention-empty"
          >
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-2" />
            <p className="text-sm font-medium">All imports up to date</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Nothing needs review right now.
            </p>
          </div>
        ) : (
          <Table data-testid="imports-attention-table">
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>File</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.runId} data-testid={`imports-attention-row-${item.runId}`}>
                  <TableCell className="text-sm font-medium">{item.projectName}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.sourceFileName}
                  </TableCell>
                  <TableCell>
                    <ImportStateBadge state={item.state} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                    {item.reason ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatRelativeWithAbsoluteZA(item.lastImportedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={SMART_IMPORT_PATH}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        data-testid={`btn-review-${item.runId}`}
                      >
                        Review
                        <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
