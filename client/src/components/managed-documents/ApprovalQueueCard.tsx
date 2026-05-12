import { useState } from "react";
import { useApprovalQueue, type ApprovalQueueRow } from "@/hooks/use-controlled-documents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileCheck, Inbox, ExternalLink, Clock } from "lucide-react";
import { DocumentApprovalDialog } from "./DocumentApprovalDialog";
import { formatDistanceToNow } from "date-fns";

/**
 * "Waiting on me" — surfaced on CEO and COO home screens. Each row is
 * actionable: clicking Approve / Reject opens the approval dialog for
 * that specific document. Clicking the filename opens the SharePoint
 * preview (deep link).
 */
export function ApprovalQueueCard() {
  const { data, isLoading, error } = useApprovalQueue();
  const [activeRow, setActiveRow] = useState<ApprovalQueueRow | null>(null);

  const rows = data?.rows ?? [];

  return (
    <>
      <Card data-testid="approval-queue-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-primary" />
              Waiting on me
              <Badge variant="outline" className="text-[10px]" data-testid="approval-queue-count">
                {rows.length}
              </Badge>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Loading approvals…</p>
          ) : error ? (
            <p className="text-xs text-destructive py-4 text-center">Failed to load queue</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-6 text-muted-foreground">
              <Inbox className="h-6 w-6 opacity-40" />
              <p className="text-xs">No approvals waiting on you</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {rows.map((row) => (
                <ApprovalRow key={row.approvalId} row={row} onAction={() => setActiveRow(row)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {activeRow && (
        <DocumentApprovalDialog
          open={activeRow !== null}
          onOpenChange={(open) => { if (!open) setActiveRow(null); }}
          row={activeRow}
          onClosed={() => setActiveRow(null)}
        />
      )}
    </>
  );
}

function ApprovalRow({ row, onAction }: { row: ApprovalQueueRow; onAction: () => void }) {
  const ageLabel = row.requestedAt
    ? formatDistanceToNow(new Date(row.requestedAt), { addSuffix: true })
    : null;

  return (
    <li className="py-3 flex items-start gap-3" data-testid={`approval-row-${row.approvalId}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">
            {row.typeDisplayName}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {row.projectName || `Project #${row.projectId}`}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">{row.fileName}</p>
        {row.submitComment && (
          <p className="text-xs text-muted-foreground italic truncate">“{row.submitComment}”</p>
        )}
        {ageLabel && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> submitted {ageLabel}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onAction}
          data-testid={`approval-action-${row.approvalId}`}
        >
          Review
          <ExternalLink className="h-3 w-3 ml-1" />
        </Button>
      </div>
    </li>
  );
}
