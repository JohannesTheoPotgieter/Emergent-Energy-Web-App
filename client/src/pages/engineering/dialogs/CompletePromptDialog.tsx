/**
 * CompletePromptDialog — required prompt when a task moves to Complete (mockup
 * dialog #4). Check in any file the task still has checked out and confirm the
 * deliverable is final. There is NO Approved-status hard gate. An escape link
 * lets non-deliverable tasks complete without a document.
 *
 * Reuse: `useCheckin` for the open file; linked docs are listed for context.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, CheckCircle2, ArrowRight, FileWarning, Plus } from "lucide-react";
import { DONE_GATE_OUTPUT_LINK_ROLE } from "@shared/engineering/delivery-task-catalog";
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
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useCheckin } from "@/components/documents/use-documents";
import { type TaskDocLink, type TaskDocCandidate } from "./task-doc-shared";

interface Props {
  open: boolean;
  taskId: number;
  /** A doc this task checked out (and may still hold), if known. */
  checkedOutDocId: number | null;
  /**
   * True when the task's type produces a document (catalog `requiresDocumentLink`).
   * When set, the server Done-gate rejects completion unless a linkRole='output'
   * document is linked — so we block here and route to the link flow rather than
   * offer a "complete anyway" escape that the server would 409.
   */
  requiresOutputDocument?: boolean;
  onProceed: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
  /** Deep-link to the document link flow (opens the task drawer's linker). */
  onNeedsDocument?: () => void;
}

export function CompletePromptDialog({
  open,
  taskId,
  checkedOutDocId,
  requiresOutputDocument,
  onProceed,
  onCancel,
  onError,
  onNeedsDocument,
}: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [escaped, setEscaped] = useState(false);
  const [checkedIn, setCheckedIn] = useState(checkedOutDocId == null);
  const checkin = useCheckin();

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

  const openDocName = useMemo(
    () => linkedDocs.find((d) => d.managedDocumentId === checkedOutDocId)?.name ?? (checkedOutDocId ? `Document #${checkedOutDocId}` : null),
    [linkedDocs, checkedOutDocId],
  );

  // Done-gate: only a linkRole='output' link satisfies the server. Until the
  // links load we optimistically assume the gate is unmet (block, don't offer a
  // false "complete anyway") so the UI never contradicts the server.
  const hasOutputLink = useMemo(
    () => (linksQuery.data?.links ?? []).some((l) => l.linkRole === DONE_GATE_OUTPUT_LINK_ROLE),
    [linksQuery.data],
  );
  const gateBlocked = requiresOutputDocument === true && !hasOutputLink;

  useEffect(() => {
    if (open) {
      setConfirmed(false);
      setEscaped(false);
      setCheckedIn(checkedOutDocId == null);
    }
  }, [open, checkedOutDocId]);

  async function checkInOpenFile() {
    if (checkedOutDocId == null) return;
    try {
      await checkin.mutateAsync({ documentId: checkedOutDocId });
      setCheckedIn(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't check in the document.");
    }
  }

  function confirm() {
    if (escaped) {
      onProceed();
      return;
    }
    if (!confirmed || !checkedIn) return;
    onProceed();
  }

  const canConfirm = escaped || (confirmed && checkedIn && !checkin.isPending);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-md" data-testid="task-complete-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Complete this task
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
              Required
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {gateBlocked
              ? "This task produces a document that must be linked before it can be completed."
              : "Check in any open file and confirm the deliverable is final."}
          </DialogDescription>
        </DialogHeader>

        {requiresOutputDocument && linksQuery.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking linked documents…
          </div>
        ) : gateBlocked ? (
          <div
            className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm"
            data-testid="task-complete-doc-required"
          >
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <span className="text-amber-800">
              Link the output document this task produces, then complete it. Only a linked output
              document satisfies the sign-off — evidence or reference links don't.
            </span>
          </div>
        ) : (
          <>
            <div className={cn("space-y-3", escaped && "pointer-events-none opacity-40")}>
              {checkedOutDocId != null && !checkedIn ? (
                <div className="flex items-center gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                  <Lock className="h-4 w-4 text-amber-600" aria-hidden />
                  <span className="flex-1 font-medium text-amber-800">
                    {openDocName} <span className="font-normal text-amber-700">— still checked out</span>
                  </span>
                  <Button
                    size="sm"
                    onClick={checkInOpenFile}
                    disabled={checkin.isPending}
                    data-testid="task-complete-checkin"
                  >
                    {checkin.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Check in"}
                  </Button>
                </div>
              ) : checkedOutDocId != null ? (
                <div className="flex items-center gap-2.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
                  <span className="flex-1 font-medium">{openDocName} — checked in</span>
                </div>
              ) : null}

              <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-2.5 py-2 text-sm">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                  data-testid="task-complete-confirm-checkbox"
                />
                <span className="font-medium">I confirm this deliverable is final.</span>
              </label>

              {linkedDocs.length > 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="task-complete-linked-summary">
                  Linked: {linkedDocs.map((d) => d.name).join(" · ")}
                </p>
              ) : null}
            </div>

            {/* Escape hatch only for tasks whose type does NOT mandate an output
                document — a document-output task can't legitimately skip it. */}
            {!requiresOutputDocument ? (
              <button
                type="button"
                onClick={() => setEscaped((v) => !v)}
                className={cn(
                  "self-start text-xs underline underline-offset-2",
                  escaped ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                data-testid="task-complete-escape"
              >
                {escaped ? "On second thought, confirm the deliverable" : "No document for this task — complete anyway"}
              </button>
            ) : null}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {gateBlocked ? (
            <Button
              onClick={() => {
                onCancel();
                onNeedsDocument?.();
              }}
              disabled={linksQuery.isLoading}
              data-testid="task-complete-link-doc"
            >
              <Plus className="h-4 w-4" />
              Link a document
            </Button>
          ) : (
            <Button onClick={confirm} disabled={!canConfirm} data-testid="task-complete-confirm">
              {escaped ? (
                <>
                  Complete anyway
                  <ArrowRight className="h-4 w-4" />
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Check in &amp; complete
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
