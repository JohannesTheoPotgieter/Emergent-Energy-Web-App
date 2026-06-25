/**
 * DisciplinePanel — full per-discipline document WORKSPACE (browse-and-bind).
 *
 * The SharePoint folder bound to one discipline (ENGINEERING, QUALITY, HSE, …)
 * for a project is the workspace root. From it the user can:
 *   - drill into subfolders (breadcrumb stack),
 *   - open a file detail drawer (revisions / comments / checkout / check-in)
 *     and request approval inline,
 *   - upload files, create folders, and rename items (gated on
 *     documents_provision).
 *
 * It reuses the generic /documents browser components (FileListTable,
 * DocumentDetailDrawer, UploadDialog, NewFolderDialog, RenameDialog,
 * Breadcrumb) via a discipline-scoped BrowseTarget, hitting the discipline
 * browser endpoints under /api/projects/:projectId/discipline-folders/:discipline/*.
 *
 * SharePoint stays the source of truth; this only renders metadata + Graph
 * deep links and orchestrates the tracked-document workflow.
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permissions";
import {
  CheckCircle2, FolderTree, FolderX, ExternalLink, FolderPlus, Upload, ShieldCheck,
} from "lucide-react";
import { FileListTable } from "@/components/documents/FileListTable";
import { DocumentsBreadcrumb, type Crumb } from "@/components/documents/Breadcrumb";
import { UploadDialog } from "@/components/documents/UploadDialog";
import { NewFolderDialog } from "@/components/documents/NewFolderDialog";
import { RenameDialog } from "@/components/documents/RenameDialog";
import { DocumentDetailDrawer } from "@/components/documents/DocumentDetailDrawer";
import {
  useDocumentChildren,
  useDocumentDetail,
  documentDownloadUrl,
  type BrowseTarget,
} from "@/components/documents/use-documents";
import { useDisciplineFolders } from "@/hooks/use-discipline-folders";
import {
  useApproverCandidates,
  useRequestManagedDocApproval,
} from "@/hooks/use-managed-document-approvals";
import type { GraphItem } from "@/components/documents/types";

export interface DisciplinePanelProps {
  projectId: number;
  /** LIFECYCLE_DEPARTMENTS code, e.g. "ENGINEERING". */
  discipline: string;
  /** Optional title override (defaults to "{discipline} documents"). */
  title?: string;
  /** Retained for API compatibility; no longer used (shared rows are gone). */
  includeShared?: boolean;
}

export function DisciplinePanel({ projectId, discipline, title }: DisciplinePanelProps) {
  const foldersQuery = useDisciplineFolders(projectId);
  const { allowed: canProvision } = usePermission("documents_provision", "edit");

  const folder = useMemo(
    () => (foldersQuery.data?.folders ?? []).find((f) => f.discipline === discipline) ?? null,
    [foldersQuery.data, discipline],
  );

  const target: BrowseTarget | null = useMemo(
    () => (folder ? { kind: "discipline", projectId, discipline } : null),
    [folder, projectId, discipline],
  );

  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const parentItemId = crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null;
  const children = useDocumentChildren(target, parentItemId);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<GraphItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);

  const heading = title ?? `${discipline} documents`;
  const isLoading = foldersQuery.isLoading;
  const hasError = Boolean(foldersQuery.error);

  function onOpen(item: GraphItem) {
    if (item.isFolder) {
      setCrumbs((c) => [...c, { id: item.id, name: item.name }]);
      return;
    }
    setDetailItemId(item.id);
    setDetailOpen(true);
  }

  function onNavigateCrumb(index: number) {
    if (index < 0) {
      setCrumbs([]);
      return;
    }
    setCrumbs((c) => c.slice(0, index + 1));
  }

  function onRenameRequest(item: GraphItem) {
    setRenameTarget(item);
    setRenameOpen(true);
  }

  async function onDownload(item: GraphItem) {
    if (!target) return;
    const url = documentDownloadUrl(target, item.id);
    const tokenHeader = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    if (tokenHeader) headers["Authorization"] = `Bearer ${tokenHeader}`;
    const res = await fetch(url, { credentials: "include", headers });
    if (!res.ok) {
      toast({
        title: "Download failed",
        description: `${res.status} — ${res.statusText || "Could not download the file."}`,
        variant: "destructive",
      });
      return;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }

  if (hasError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          Failed to load discipline folders.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid={`discipline-panel-${discipline}`}>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{heading}</h3>
          <div className="ml-auto flex flex-wrap gap-1">
            {isLoading ? (
              <Skeleton className="h-5 w-32" />
            ) : folder ? (
              <Badge
                variant="outline"
                className="text-[10px] bg-emerald-50 text-emerald-700"
                data-testid={`discipline-summary-bound-${discipline}`}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Folder bound
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] bg-amber-50 text-amber-800"
                data-testid={`discipline-summary-unbound-${discipline}`}
              >
                <FolderX className="h-3 w-3 mr-1" />
                No folder bound
              </Badge>
            )}
          </div>
        </div>

        {folder?.sharepointPath && (
          <div className="text-xs">
            {folder.webUrl ? (
              <a
                href={folder.webUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-emerald-700 hover:underline"
                data-testid={`discipline-link-${discipline}`}
              >
                <ExternalLink className="h-3 w-3" />
                {folder.sharepointPath}
              </a>
            ) : (
              <span className="font-mono text-muted-foreground">{folder.sharepointPath}</span>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !folder || !target ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            No SharePoint folder bound to <strong>{discipline}</strong> yet. Use the binder above to
            connect this project's <em>{discipline.toLowerCase()}</em> folder.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <DocumentsBreadcrumb
                rootLabel={discipline}
                crumbs={crumbs}
                onNavigate={onNavigateCrumb}
              />
              {canProvision && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setFolderOpen(true)}
                    data-testid={`discipline-new-folder-${discipline}`}
                  >
                    <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
                    New folder
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setUploadOpen(true)}
                    data-testid={`discipline-upload-${discipline}`}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                    Upload
                  </Button>
                </div>
              )}
            </div>

            {children.isError ? (
              <div className="rounded-md border p-4 text-sm text-destructive">
                Couldn't load this folder's contents.
              </div>
            ) : (
              <FileListTable
                items={children.data?.items ?? []}
                isLoading={children.isLoading}
                onOpen={onOpen}
                onDownload={onDownload}
              />
            )}
          </>
        )}
      </CardContent>

      {target && (
        <>
          <UploadDialog
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            target={target}
            parentItemId={parentItemId}
          />
          <NewFolderDialog
            open={folderOpen}
            onOpenChange={setFolderOpen}
            target={target}
            parentItemId={parentItemId}
          />
          <RenameDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            target={target}
            item={renameTarget}
          />
          <DocumentDetailDrawer
            open={detailOpen}
            onOpenChange={setDetailOpen}
            target={target}
            itemId={detailItemId}
            onRename={onRenameRequest}
          />
          <RequestApprovalAction
            target={target}
            itemId={detailItemId}
            visible={detailOpen}
            open={approvalOpen}
            onOpenChange={setApprovalOpen}
          />
        </>
      )}
    </Card>
  );
}

/**
 * Inline "Request approval" affordance for the file open in the detail drawer.
 * Kept alongside the (reused, unmodified) DocumentDetailDrawer: it resolves the
 * selected item's tracked managed-document id from the same detail query, then
 * lets the user pick approver candidates and submit a request.
 */
function RequestApprovalAction({
  target,
  itemId,
  visible,
  open,
  onOpenChange,
}: {
  target: BrowseTarget;
  itemId: string | null;
  visible: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const detail = useDocumentDetail(target, itemId);
  const documentId = detail.data?.managedDocument?.id ?? null;
  const candidatesQuery = useApproverCandidates(documentId);
  const requestApproval = useRequestManagedDocApproval();

  const [selected, setSelected] = useState<number[]>([]);
  const [comment, setComment] = useState("");

  // Only show the affordance for a tracked, non-folder item with the drawer open.
  if (!visible || !documentId || detail.data?.item?.isFolder) return null;

  function toggle(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit() {
    if (!documentId || selected.length === 0) return;
    try {
      await requestApproval.mutateAsync({
        managedDocumentId: documentId,
        approverUserIds: selected,
        comment: comment.trim() || undefined,
      });
      toast({ title: "Approval requested", description: "Approvers have been notified." });
      onOpenChange(false);
      setSelected([]);
      setComment("");
    } catch (err) {
      toast({
        title: "Couldn't request approval",
        description: err instanceof Error ? err.message : "Please retry.",
        variant: "destructive",
      });
    }
  }

  const candidates = candidatesQuery.data?.candidates ?? [];

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          size="sm"
          variant="default"
          onClick={() => onOpenChange(true)}
          data-testid="discipline-request-approval-open"
        >
          <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
          Request approval
        </Button>
      </div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="discipline-request-approval-dialog">
          <DialogHeader>
            <DialogTitle>Request approval</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {candidatesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading approvers…</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No eligible approvers found for this document.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {candidates.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    data-testid={`discipline-approver-${c.id}`}
                  >
                    <Checkbox
                      checked={selected.includes(c.id)}
                      onCheckedChange={() => toggle(c.id)}
                    />
                    <span>{c.name}</span>
                    <Badge variant="outline" className="text-[10px]">{c.role}</Badge>
                  </label>
                ))}
              </div>
            )}
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a note for the approvers (optional)."
              rows={3}
              data-testid="discipline-approval-comment"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={selected.length === 0 || requestApproval.isPending}
              data-testid="discipline-request-approval-submit"
            >
              {requestApproval.isPending ? "Requesting…" : "Request approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
