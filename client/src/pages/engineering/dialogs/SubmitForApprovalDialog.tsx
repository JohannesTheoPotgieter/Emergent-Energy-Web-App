/**
 * SubmitForApprovalDialog — required prompt when a task moves to Needs Approval
 * ("Send for approval", mockup dialog #3). The user checks their checked-out
 * file back IN (as the next revision), then submits THAT document for QC review
 * (approver select). An escape link lets non-deliverable tasks proceed without a
 * document.
 *
 * Reuse: `useCheckin` (records the next revision) + `useApproverCandidates` /
 * `useRequestManagedDocApproval`. The document to submit defaults to the one the
 * task checked out on its way into In Progress; when that's unknown the user
 * picks among the linked docs.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, CheckCircle2, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FileTypeIcon } from "@/components/documents/document-display";
import { useCheckin } from "@/components/documents/use-documents";
import {
  useApproverCandidates,
  useRequestManagedDocApproval,
} from "@/hooks/use-managed-document-approvals";
import { type TaskDocLink, type TaskDocCandidate } from "./task-doc-shared";

interface Props {
  open: boolean;
  taskId: number;
  /** The doc this task checked out on its way to In Progress, if known. */
  checkedOutDocId: number | null;
  onProceed: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

export function SubmitForApprovalDialog({
  open,
  taskId,
  checkedOutDocId,
  onProceed,
  onCancel,
  onError,
}: Props) {
  const [docId, setDocId] = useState<number | null>(checkedOutDocId);
  const [approverId, setApproverId] = useState<string>("");
  const [escaped, setEscaped] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);

  const checkin = useCheckin();
  const requestApproval = useRequestManagedDocApproval();
  const approversQuery = useApproverCandidates(docId);

  const linksQuery = useQuery<{ links: TaskDocLink[] }>({
    queryKey: ["/api/engineering/tasks", taskId, "documents"],
    enabled: open && taskId > 0,
  });
  const candidatesQuery = useQuery<{ candidates: TaskDocCandidate[] }>({
    queryKey: ["/api/engineering/tasks", taskId, "document-candidates"],
    enabled: open && taskId > 0,
  });

  const linkedDocs = useMemo(() => {
    const links = linksQuery.data?.links ?? [];
    const byId = new Map((candidatesQuery.data?.candidates ?? []).map((c) => [c.id, c]));
    return links
      .filter((l): l is TaskDocLink & { managedDocumentId: number } => l.managedDocumentId != null)
      .map((l) => ({
        managedDocumentId: l.managedDocumentId,
        name: byId.get(l.managedDocumentId)?.name ?? `Document #${l.managedDocumentId}`,
      }));
  }, [linksQuery.data, candidatesQuery.data]);

  const docName = useMemo(
    () => linkedDocs.find((d) => d.managedDocumentId === docId)?.name ?? (docId ? `Document #${docId}` : ""),
    [linkedDocs, docId],
  );

  // Reset on open/close; seed the target doc.
  useEffect(() => {
    if (open) {
      setDocId(checkedOutDocId ?? null);
      setApproverId("");
      setEscaped(false);
      setCheckedIn(false);
    }
  }, [open, checkedOutDocId]);

  // Default the target doc to the first linked one when none was checked out.
  useEffect(() => {
    if (open && docId == null && linkedDocs.length > 0) setDocId(linkedDocs[0].managedDocumentId);
  }, [open, docId, linkedDocs]);

  const candidates = approversQuery.data?.candidates ?? [];

  async function confirm() {
    if (escaped) {
      onProceed();
      return;
    }
    if (docId == null || approverId === "") return;
    try {
      // Check the file back in as the next revision (idempotent-ish: if it was
      // already checked in this session we skip the second call).
      if (!checkedIn) {
        await checkin.mutateAsync({ documentId: docId });
        setCheckedIn(true);
      }
      await requestApproval.mutateAsync({
        managedDocumentId: docId,
        approverUserIds: [Number(approverId)],
      });
      onProceed();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't submit the document for approval.");
    }
  }

  const busy = checkin.isPending || requestApproval.isPending;
  const canConfirm = escaped || (docId != null && approverId !== "" && !busy);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-md" data-testid="task-submit-approval-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Submit for QC review
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
              Required
            </Badge>
          </DialogTitle>
          <DialogDescription>Check your file back in, then submit it for sign-off.</DialogDescription>
        </DialogHeader>

        <div className={cn("space-y-3", escaped && "pointer-events-none opacity-40")}>
          {/* The file being checked in */}
          <div className="flex items-center gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <Lock className="h-4 w-4 text-amber-600" aria-hidden />
            <span className="flex-1 font-medium text-amber-800">
              {docName || "No document selected"}
            </span>
            <span className="text-xs text-amber-700">
              {checkedIn ? "checked in" : "checked out by you"}
            </span>
          </div>

          {/* Choose which doc to submit, if more than one is linked. */}
          {linkedDocs.length > 1 ? (
            <div className="space-y-1.5">
              <Label>Document to submit</Label>
              <Select
                value={docId != null ? String(docId) : ""}
                onValueChange={(v) => { setDocId(Number(v)); setCheckedIn(false); }}
              >
                <SelectTrigger data-testid="task-submit-doc-select">
                  <SelectValue placeholder="Pick a document" />
                </SelectTrigger>
                <SelectContent>
                  {linkedDocs.map((d) => (
                    <SelectItem key={d.managedDocumentId} value={String(d.managedDocumentId)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="flex items-center gap-2.5 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
            <FileTypeIcon name={docName || "file"} isFolder={false} />
            <span className="flex-1 font-medium">
              {docName || "—"} <span className="font-normal text-muted-foreground">(next revision on check-in)</span>
            </span>
          </div>

          <div className="space-y-1.5">
            <Label>Approver</Label>
            <Select value={approverId} onValueChange={setApproverId} disabled={docId == null}>
              <SelectTrigger data-testid="task-submit-approver-select">
                <SelectValue
                  placeholder={
                    approversQuery.isLoading
                      ? "Loading approvers…"
                      : candidates.length === 0
                        ? "No eligible approvers"
                        : "Select an approver"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name} {c.role ? `(${c.role})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!canConfirm} data-testid="task-submit-approval-confirm">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : escaped ? (
              <>
                Send anyway
                <ArrowRight className="h-4 w-4" />
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Check in &amp; submit
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </DialogFooter>

        <button
          type="button"
          onClick={() => setEscaped((v) => !v)}
          className={cn(
            "self-start text-xs underline underline-offset-2",
            escaped ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          data-testid="task-submit-approval-escape"
        >
          {escaped ? "On second thought, submit a document" : "No document for this task — send anyway"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
