import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  useApproveDocument,
  useRejectDocument,
  type ApprovalQueueRow,
} from "@/hooks/use-controlled-documents";
import { CheckCircle2, XCircle, FileText, ExternalLink, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api-error";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ApprovalQueueRow;
  onClosed?: () => void;
}

/**
 * Approve or reject a pending document submission. Opened from the
 * ApprovalQueueCard or from any DocumentStrip row in "submitted" state.
 *
 * Approver sees:
 *  - Document type + file name
 *  - Submitter's comment (if any)
 *  - Link to open the file in SharePoint (preview)
 *  - Approve button — optional comment
 *  - Reject button — reason required
 */
export function DocumentApprovalDialog({ open, onOpenChange, row, onClosed }: Props) {
  const [comment, setComment] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [mode, setMode] = useState<"approve" | "reject">("approve");

  const approveMut = useApproveDocument();
  const rejectMut = useRejectDocument();

  const busy = approveMut.isPending || rejectMut.isPending;

  const handleApprove = async () => {
    try {
      await approveMut.mutateAsync({ documentId: row.documentId, comment: comment.trim() || undefined, projectId: row.projectId });
      toast({ title: "Approved", description: `${row.typeDisplayName} approved.` });
      onOpenChange(false);
      onClosed?.();
    } catch (err) {
      toast({
        title: "Approval failed",
        description: err instanceof ApiError ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast({ title: "Reason required", description: "Please enter a rejection reason.", variant: "destructive" });
      return;
    }
    try {
      await rejectMut.mutateAsync({ documentId: row.documentId, reason: rejectReason.trim(), projectId: row.projectId });
      toast({ title: "Rejected", description: "The submitter has been notified." });
      onOpenChange(false);
      onClosed?.();
    } catch (err) {
      toast({
        title: "Rejection failed",
        description: err instanceof ApiError ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="document-approval-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> Review submission
          </DialogTitle>
          <DialogDescription>
            {row.typeDisplayName} for {row.projectName || `Project #${row.projectId}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{row.fileName}</span>
              <Badge variant="outline" className="text-[10px]">{row.typeKey}</Badge>
            </div>
            {row.sharepointPath && (
              <p className="text-xs text-muted-foreground truncate" title={row.sharepointPath}>
                {row.sharepointPath}
              </p>
            )}
            {row.submitComment && (
              <p className="text-xs italic text-muted-foreground">“{row.submitComment}”</p>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
              <a
                href={row.sharepointPath.startsWith("http") ? row.sharepointPath : "#"}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="approval-open-sharepoint"
              >
                Open in SharePoint <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "approve" ? "default" : "outline"}
              onClick={() => setMode("approve")}
              data-testid="tab-approve"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
            </Button>
            <Button
              size="sm"
              variant={mode === "reject" ? "destructive" : "outline"}
              onClick={() => setMode("reject")}
              data-testid="tab-reject"
            >
              <XCircle className="h-4 w-4 mr-1" /> Reject
            </Button>
          </div>

          {mode === "approve" ? (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Optional comment</label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Note for the audit trail (optional)"
                rows={3}
                data-testid="input-approval-comment"
              />
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-xs text-destructive">Rejection reason (required)</label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why is this being rejected? The submitter will see this."
                rows={3}
                data-testid="input-rejection-reason"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {mode === "approve" ? (
            <Button onClick={handleApprove} disabled={busy} data-testid="btn-confirm-approve">
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Approve
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={busy || !rejectReason.trim()}
              data-testid="btn-confirm-reject"
            >
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <XCircle className="h-4 w-4 mr-1" />}
              Reject
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
