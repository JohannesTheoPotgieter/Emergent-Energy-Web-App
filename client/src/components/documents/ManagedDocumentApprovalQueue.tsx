/**
 * D6 Phase 5 — current user's managed-document approval queue.
 *
 * Replaces the legacy controlled-documents `ApprovalQueueCard`. Lists
 * `approvals` rows where the current user is the assignedApprover and
 * status='pending', and lets them approve or reject inline.
 *
 * Optionally filters to one project — useful for the project-documents
 * page so users only see queue items for the project they're looking at.
 * Without `projectId`, shows the user's full queue across all projects
 * (used by the home page in a future iteration).
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  useManagedDocumentApprovalQueue,
  useApproveManagedDoc,
  useRejectManagedDoc,
  type ApprovalQueueRow,
} from "@/hooks/use-managed-document-approvals";
import { CheckCircle2, XCircle, ClipboardCheck, Loader2 } from "lucide-react";

export interface ManagedDocumentApprovalQueueProps {
  /** Filter to one project. Omit to show the user's full queue. */
  projectId?: number;
  /** Custom title; defaults to "Pending approvals". */
  title?: string;
}

export function ManagedDocumentApprovalQueue({ projectId, title }: ManagedDocumentApprovalQueueProps) {
  const queue = useManagedDocumentApprovalQueue();
  const [decideTarget, setDecideTarget] = useState<{
    row: ApprovalQueueRow;
    mode: "approve" | "reject";
  } | null>(null);

  const rows = useMemo(() => {
    const all = queue.data?.rows ?? [];
    if (typeof projectId !== "number") return all;
    return all.filter((r) => r.approval.projectId === projectId);
  }, [queue.data, projectId]);

  const heading = title ?? "Pending approvals";

  return (
    <Card data-testid="managed-document-approval-queue">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{heading}</h3>
          <Badge
            variant="outline"
            className="ml-auto text-[10px]"
            data-testid="approval-queue-count"
          >
            {rows.length} pending
          </Badge>
        </div>

        {queue.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : queue.error ? (
          <div className="rounded-md border p-4 text-sm text-destructive">
            Failed to load approval queue.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            Nothing waiting on you.
          </div>
        ) : (
          <Table data-testid="approval-queue-table">
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.approval.id}
                  data-testid={`approval-queue-row-${row.approval.id}`}
                >
                  <TableCell>
                    <div className="text-sm font-medium">
                      {row.document?.name ?? row.approval.title}
                    </div>
                    {row.document?.path && (
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {row.document.path}
                      </div>
                    )}
                    {row.approval.description && (
                      <div className="text-[11px] text-muted-foreground italic mt-1">
                        “{row.approval.description}”
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.requestedBy?.name ?? row.requestedBy?.email ?? `User ${row.approval.requestedBy}`}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(row.approval.requestedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                        onClick={() => setDecideTarget({ row, mode: "approve" })}
                        data-testid={`btn-approval-approve-${row.approval.id}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-rose-700 border-rose-300 hover:bg-rose-50"
                        onClick={() => setDecideTarget({ row, mode: "reject" })}
                        data-testid={`btn-approval-reject-${row.approval.id}`}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {decideTarget && (
        <DecideDialog
          target={decideTarget}
          onClose={() => setDecideTarget(null)}
        />
      )}
    </Card>
  );
}

function DecideDialog(props: {
  target: { row: ApprovalQueueRow; mode: "approve" | "reject" };
  onClose: () => void;
}) {
  const { target, onClose } = props;
  const approve = useApproveManagedDoc();
  const reject = useRejectManagedDoc();
  const [text, setText] = useState("");

  const isReject = target.mode === "reject";
  const isPending = approve.isPending || reject.isPending;

  async function handleSubmit() {
    if (isReject && !text.trim()) {
      toast({
        title: "Reason required",
        description: "Rejection requires a short explanation.",
        variant: "destructive",
      });
      return;
    }
    try {
      if (isReject) {
        await reject.mutateAsync({ approvalId: target.row.approval.id, reason: text.trim() });
        toast({ title: "Rejected", description: target.row.document?.name ?? target.row.approval.title });
      } else {
        await approve.mutateAsync({ approvalId: target.row.approval.id, comment: text.trim() || undefined });
        toast({ title: "Approved", description: target.row.document?.name ?? target.row.approval.title });
      }
      onClose();
    } catch (err) {
      toast({
        title: isReject ? "Reject failed" : "Approve failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isReject ? "Reject document" : "Approve document"}
          </DialogTitle>
          <DialogDescription>
            <strong>{target.row.document?.name ?? target.row.approval.title}</strong>
            {isReject ? (
              <span> — provide a reason so the submitter knows what to fix.</span>
            ) : (
              <span> — optional comment will be saved on the audit trail.</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>{isReject ? "Reason" : "Comment (optional)"}</Label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            data-testid="textarea-approval-decision"
            placeholder={
              isReject ? "What needs to change?" : "Anything the submitter should know?"
            }
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
            variant={isReject ? "destructive" : "default"}
            data-testid="btn-approval-decision-submit"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            {isReject ? "Reject" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
