/**
 * CheckoutPromptDialog — required prompt when a task moves to In Progress
 * (mockup dialog #2). The user radio-picks a linked document (or links a
 * different one via the browse modal) and checks it out; checking out locks the
 * file so the team sees it's being worked on. An escape link lets non-deliverable
 * tasks start without a document.
 *
 * Reuse: GET …/documents (+ …/document-candidates) for the linked list,
 * `useCheckout` for the lock, and LinkDocumentDialog for "link a different one".
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, Plus, ArrowRight } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { FileTypeIcon } from "@/components/documents/document-display";
import { useCheckout } from "@/components/documents/use-documents";
import { LinkDocumentDialog } from "./LinkDocumentDialog";
import { type TaskDocLink, type TaskDocCandidate } from "./task-doc-shared";

interface Props {
  open: boolean;
  taskId: number;
  taskTitle: string;
  projectId: number | null;
  onProceed: (checkedOutDocId: number | null) => void;
  onCancel: () => void;
  onError: (message: string) => void;
  onLinked: (count: number) => void;
}

export function CheckoutPromptDialog({
  open,
  taskId,
  taskTitle,
  projectId,
  onProceed,
  onCancel,
  onError,
  onLinked,
}: Props) {
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [escaped, setEscaped] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const checkout = useCheckout();

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
        linkId: l.id,
        managedDocumentId: l.managedDocumentId,
        name: byId.get(l.managedDocumentId)?.name ?? `Document #${l.managedDocumentId}`,
      }));
  }, [linksQuery.data, candidatesQuery.data]);

  const linkedDocIds = useMemo(() => new Set(linkedDocs.map((d) => d.managedDocumentId)), [linkedDocs]);

  // Default the radio to the first linked doc when the list resolves.
  useEffect(() => {
    if (!open) return;
    if (selectedDocId == null && linkedDocs.length > 0) setSelectedDocId(linkedDocs[0].managedDocumentId);
  }, [open, linkedDocs, selectedDocId]);

  // Reset transient state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setSelectedDocId(null);
      setEscaped(false);
      setBrowseOpen(false);
    }
  }, [open]);

  async function confirm() {
    if (escaped) {
      onProceed(null);
      return;
    }
    if (selectedDocId == null) return;
    try {
      await checkout.mutateAsync(selectedDocId);
      onProceed(selectedDocId);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't check out the document.");
    }
  }

  const loading = linksQuery.isLoading || candidatesQuery.isLoading;
  const canConfirm = escaped || (selectedDocId != null && !checkout.isPending);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
        <DialogContent className="max-w-md" data-testid="task-checkout-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Start work — check out a document
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                Required
              </Badge>
            </DialogTitle>
            <DialogDescription>
              Checking out locks the file so the team sees it's being worked on.
            </DialogDescription>
          </DialogHeader>

          <div className={cn("space-y-1.5", escaped && "pointer-events-none opacity-40")}>
            {loading ? (
              <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading linked documents…
              </div>
            ) : linkedDocs.length === 0 ? (
              <p className="px-1 py-3 text-sm text-muted-foreground">
                No documents linked yet. Link one to check it out.
              </p>
            ) : (
              linkedDocs.map((doc) => {
                const active = selectedDocId === doc.managedDocumentId;
                return (
                  <label
                    key={doc.managedDocumentId}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md border px-2 py-2 text-sm",
                      active ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50",
                    )}
                    data-testid={`task-checkout-doc-${doc.managedDocumentId}`}
                  >
                    <input
                      type="radio"
                      name="checkout-doc"
                      className="h-4 w-4 accent-emerald-600"
                      checked={active}
                      onChange={() => setSelectedDocId(doc.managedDocumentId)}
                      aria-label={`Check out ${doc.name}`}
                    />
                    <FileTypeIcon name={doc.name} isFolder={false} />
                    <span className="flex-1 font-medium">
                      {doc.name} <span className="font-normal text-muted-foreground">linked</span>
                    </span>
                  </label>
                );
              })
            )}

            <button
              type="button"
              onClick={() => setBrowseOpen(true)}
              className="flex w-full items-center justify-between rounded-md border border-border px-2.5 py-2 text-sm text-foreground hover:bg-muted/50"
              data-testid="task-checkout-link-different"
            >
              <span className="flex items-center gap-1.5">
                <Plus className="h-4 w-4" />
                Link a different document…
              </span>
              <span className="text-xs text-muted-foreground">Browse</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setEscaped((v) => !v)}
            className={cn(
              "self-start text-xs underline underline-offset-2",
              escaped ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            data-testid="task-checkout-escape"
          >
            {escaped ? "On second thought, check out a document" : "No document for this task — start anyway"}
          </button>

          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={!canConfirm} data-testid="task-checkout-confirm">
              {checkout.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking out…
                </>
              ) : escaped ? (
                <>
                  Start anyway
                  <ArrowRight className="h-4 w-4" />
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Check out &amp; start
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LinkDocumentDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        taskId={taskId}
        taskTitle={taskTitle}
        projectId={projectId}
        linkedDocIds={linkedDocIds}
        onLinked={(count) => onLinked(count)}
        onError={onError}
      />
    </>
  );
}
