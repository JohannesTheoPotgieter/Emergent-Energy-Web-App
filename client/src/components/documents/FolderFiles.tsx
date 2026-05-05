/**
 * D6 Phase 7 — FolderFiles.
 *
 * In-place file list for one provisioned project_folder. Mounted inside
 * an expandable row of the DisciplinePanel so users can see what's
 * actually in the folder, request approval, and watch status without
 * leaving the project page.
 *
 * Renders:
 *   - one row per managed_document with state badge + open-in-SharePoint
 *   - latest approval status (pending / approved / rejected) per file
 *   - "Request approval" button (opens RequestApprovalDialog)
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useFolderFiles, type FolderFile } from "@/hooks/use-folder-files";
import {
  useRequestManagedDocApproval,
  useApproverCandidates,
} from "@/hooks/use-managed-document-approvals";
import {
  CheckCircle2, Clock, AlertTriangle, FileText, ExternalLink, Send, Loader2,
} from "lucide-react";

export interface FolderFilesProps {
  projectId: number;
  folderId: number;
  /** Optional discipline label, drives the data-testid suffix. */
  testIdSuffix?: string;
}

export function FolderFiles({ projectId, folderId, testIdSuffix }: FolderFilesProps) {
  const files = useFolderFiles(projectId, folderId);
  const [requestTarget, setRequestTarget] = useState<FolderFile | null>(null);

  const rows = files.data?.files ?? [];
  const suffix = testIdSuffix ? `-${testIdSuffix}` : "";

  if (files.isLoading) {
    return (
      <div className="space-y-2 px-4 py-3">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }
  if (files.error) {
    return (
      <div className="px-4 py-3 text-xs text-destructive">Failed to load files in this folder.</div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground" data-testid={`folder-files-empty${suffix}`}>
        No tracked files yet. Upload one from the global <em>/documents</em> browser into this
        folder, or via SharePoint — Document Management will pick it up automatically.
      </div>
    );
  }

  return (
    <>
      <Table data-testid={`folder-files-table${suffix}`}>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Approval</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <FolderFileRow
              key={row.document.id}
              row={row}
              onRequest={() => setRequestTarget(row)}
              testIdSuffix={suffix}
            />
          ))}
        </TableBody>
      </Table>

      {requestTarget && (
        <RequestApprovalDialog
          target={requestTarget}
          onClose={() => setRequestTarget(null)}
        />
      )}
    </>
  );
}

function FolderFileRow(props: {
  row: FolderFile;
  onRequest: () => void;
  testIdSuffix: string;
}) {
  const { row, onRequest, testIdSuffix } = props;
  const { document: doc, approvals } = row;

  const latestApproval = approvals[0] ?? null;
  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  return (
    <TableRow data-testid={`folder-file-row${testIdSuffix}-${doc.id}`}>
      <TableCell>
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">{doc.name}</div>
            <div className="text-[10px] font-mono text-muted-foreground truncate max-w-md">
              {doc.path}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <DocumentStateBadge state={doc.state} />
      </TableCell>
      <TableCell>
        {latestApproval ? (
          <ApprovalStatusBadge
            status={latestApproval.status}
            pendingCount={pendingCount}
          />
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {doc.state !== "approved" && doc.state !== "in_review" && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRequest}
              data-testid={`btn-request-approval${testIdSuffix}-${doc.id}`}
            >
              <Send className="h-3 w-3 mr-1" />
              Request approval
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function DocumentStateBadge({ state }: { state: string }) {
  const tone =
    state === "approved"
      ? "bg-emerald-50 text-emerald-700"
      : state === "in_review"
        ? "bg-sky-50 text-sky-700"
        : state === "superseded"
          ? "bg-muted"
          : state === "archived"
            ? "bg-muted"
            : "bg-amber-50 text-amber-800";
  return (
    <Badge variant="outline" className={`text-[10px] ${tone}`}>
      {state}
    </Badge>
  );
}

function ApprovalStatusBadge(props: { status: string; pendingCount: number }) {
  const { status, pendingCount } = props;
  if (status === "approved") {
    return (
      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Rejected — re-submit
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700">
      <Clock className="h-3 w-3 mr-1" />
      Pending ({pendingCount})
    </Badge>
  );
}

// =========================================================================
// Request approval dialog
// =========================================================================

function RequestApprovalDialog(props: { target: FolderFile; onClose: () => void }) {
  const { target, onClose } = props;
  const candidates = useApproverCandidates(target.document.id);
  const request = useRequestManagedDocApproval();
  const [selected, setSelected] = useState<number[]>([]);
  const [comment, setComment] = useState("");

  const candidateUsers = candidates.data?.candidates ?? [];
  const requiredRoles = candidates.data?.requiredRoles ?? null;

  function toggle(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit() {
    if (selected.length === 0) {
      toast({
        title: "Choose at least one approver",
        description: "Pick the people who should sign off on this document.",
        variant: "destructive",
      });
      return;
    }
    try {
      await request.mutateAsync({
        managedDocumentId: target.document.id,
        approverUserIds: selected,
        comment: comment.trim() || undefined,
      });
      toast({
        title: "Approval requested",
        description: `${selected.length} approver${selected.length === 1 ? "" : "s"} notified.`,
      });
      onClose();
    } catch (err) {
      toast({
        title: "Request failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request approval</DialogTitle>
          <DialogDescription>
            <strong>{target.document.name}</strong> — every selected approver gets a notification
            and lands in their queue. The document moves to <em>In review</em> until they decide.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>
              Approvers
              {requiredRoles && (
                <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                  ({requiredRoles.join(", ")} only)
                </span>
              )}
            </Label>
            <div className="max-h-56 overflow-y-auto rounded-md border p-2 space-y-1">
              {candidates.isLoading ? (
                <div className="text-xs text-muted-foreground">Loading eligible approvers…</div>
              ) : candidateUsers.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No eligible approvers found
                  {requiredRoles ? ` for role(s): ${requiredRoles.join(", ")}` : ""}.
                </div>
              ) : (
                candidateUsers.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={selected.includes(u.id)}
                      onCheckedChange={() => toggle(u.id)}
                      data-testid={`request-approval-approver-${u.id}`}
                    />
                    <span>{u.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Comment (optional)</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="Anything the approvers should know?"
              data-testid="request-approval-comment"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={request.isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={request.isPending}
            data-testid="btn-request-approval-submit"
          >
            {request.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helper for callers that want to deep-link into the folder's SharePoint
// location alongside the FolderFiles list.
export function SharePointDeepLink(props: { webUrl: string | null | undefined; label?: string }) {
  if (!props.webUrl) return null;
  return (
    <a
      href={props.webUrl}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1"
    >
      <ExternalLink className="h-3 w-3" />
      {props.label ?? "Open in SharePoint"}
    </a>
  );
}
