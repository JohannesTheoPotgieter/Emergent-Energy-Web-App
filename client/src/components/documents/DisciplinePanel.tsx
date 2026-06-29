/**
 * DisciplinePanel — per-discipline document browser.
 *
 * Two render modes share one data path (discipline-scoped BrowseTarget hitting
 * /api/projects/:projectId/discipline-folders/:discipline/*):
 *
 *  - variant="card" (default) — the self-contained card used by the full-project
 *    Documents view (standalone /projects/:id/documents page + project-detail
 *    Documents tab). Owns its own breadcrumb / toolbar / drawer state. This is
 *    the legacy shape; props/exports stay stable for those consumers.
 *
 *  - variant="workspace" — the CENTER pane of the reworked Engineering / Quality
 *    document workspace (DisciplineWorkspace). Chrome-free: the breadcrumb,
 *    search, sort, list/grid toggle and selection are CONTROLLED by the parent
 *    workspace; this just renders the toolbar + slim approvals banner + the
 *    file list/grid and opens the shared detail drawer.
 *
 * It reuses the generic /documents browser components (FileListTable, the grid,
 * DocumentDetailDrawer, UploadDialog, NewFolderDialog, RenameDialog,
 * Breadcrumb). SharePoint stays the source of truth; this only renders metadata
 * + Graph deep links and orchestrates the tracked-document workflow.
 */

import { useEffect, useMemo, useState } from "react";
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
  CheckCircle2, FolderTree, FolderX, ExternalLink, FolderPlus, Upload, ShieldCheck, Clock,
} from "lucide-react";
import { FileListTable } from "@/components/documents/FileListTable";
import { DocumentGrid } from "@/components/documents/DocumentGrid";
import { DocumentsBreadcrumb, type Crumb } from "@/components/documents/Breadcrumb";
import {
  DocumentBrowserToolbar, type DocumentSortKey, type DocumentViewMode,
} from "@/components/documents/DocumentBrowserToolbar";
import { UploadDialog } from "@/components/documents/UploadDialog";
import { NewFolderDialog } from "@/components/documents/NewFolderDialog";
import { RenameDialog } from "@/components/documents/RenameDialog";
import { DocumentDetailDrawer } from "@/components/documents/DocumentDetailDrawer";
import type { ManagedDocState } from "@/components/documents/document-display";
import {
  useDocumentChildren,
  useDocumentDetail,
  documentDownloadUrl,
  type BrowseTarget,
} from "@/components/documents/use-documents";
import { useDisciplineFolders, useDisciplineFolderDocuments } from "@/hooks/use-discipline-folders";
import {
  useApproverCandidates,
  useRequestManagedDocApproval,
} from "@/hooks/use-managed-document-approvals";
import type { GraphItem } from "@/components/documents/types";

export interface DisciplinePanelProps {
  projectId: number;
  /** LIFECYCLE_DEPARTMENTS code, e.g. "ENGINEERING". */
  discipline: string;
  /** Optional title override (defaults to "{discipline} documents"). card mode only. */
  title?: string;
  /** Retained for API compatibility; no longer used (shared rows are gone). */
  includeShared?: boolean;
  /**
   * "card" (default) = standalone card; "workspace" = controlled center pane.
   */
  variant?: "card" | "workspace";

  // ---- Controlled props (workspace variant) ----
  crumbs?: Crumb[];
  onCrumbsChange?: (next: Crumb[]) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  sort?: DocumentSortKey;
  onSortChange?: (sort: DocumentSortKey) => void;
  view?: DocumentViewMode;
  onViewChange?: (view: DocumentViewMode) => void;
  /** Slim banner: number of approvals waiting on the user in this project. */
  approvalsCount?: number;
  onReviewApprovals?: () => void;
}

function sortItems(items: GraphItem[], sort: DocumentSortKey): GraphItem[] {
  const folders = items.filter((i) => i.isFolder);
  const files = items.filter((i) => !i.isFolder);
  const cmp =
    sort === "name"
      ? (a: GraphItem, b: GraphItem) => a.name.localeCompare(b.name)
      : (a: GraphItem, b: GraphItem) =>
          (b.lastModifiedDateTime ?? "").localeCompare(a.lastModifiedDateTime ?? "");
  return [...folders.sort(cmp), ...files.sort(cmp)];
}

export function DisciplinePanel(props: DisciplinePanelProps) {
  const { variant = "card" } = props;
  if (variant === "workspace") return <WorkspacePane {...props} />;
  return <CardPane {...props} />;
}

// =====================================================================
// Shared internal browser hook — children listing + status overlay + handlers.
// =====================================================================

function useDisciplineBrowser(
  projectId: number,
  discipline: string,
  folder: { webUrl?: string | null; sharepointPath?: string | null } | null,
  crumbs: Crumb[],
) {
  const target: BrowseTarget | null = useMemo(
    () => (folder ? { kind: "discipline", projectId, discipline } : null),
    [folder, projectId, discipline],
  );

  const parentItemId = crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null;
  const children = useDocumentChildren(target, parentItemId);

  // Tracked workflow state is only resolvable at the bound-folder root (the
  // /documents endpoint overlays managed_documents there). Subfolders fall back
  // to no chip — see DisciplineWorkspace follow-up note.
  const isAtRoot = parentItemId == null;
  const rootDocs = useDisciplineFolderDocuments(projectId, discipline, !!folder && isAtRoot);

  const statusByItemId = useMemo<Record<string, ManagedDocState | null>>(() => {
    if (!isAtRoot) return {};
    const map: Record<string, ManagedDocState | null> = {};
    for (const it of rootDocs.data?.items ?? []) {
      map[it.itemId] = (it.state as ManagedDocState | null) ?? null;
    }
    return map;
  }, [isAtRoot, rootDocs.data]);

  return { target, parentItemId, children, statusByItemId };
}

async function downloadItem(target: BrowseTarget, item: GraphItem) {
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

// =====================================================================
// Workspace variant — controlled center pane of DisciplineWorkspace.
// =====================================================================

function WorkspacePane({
  projectId,
  discipline,
  crumbs = [],
  onCrumbsChange,
  search = "",
  onSearchChange,
  sort = "modified",
  onSortChange,
  view = "list",
  onViewChange,
  approvalsCount = 0,
  onReviewApprovals,
}: DisciplinePanelProps) {
  const foldersQuery = useDisciplineFolders(projectId);
  const { allowed: canProvision } = usePermission("documents_provision", "edit");

  const folder = useMemo(
    () => (foldersQuery.data?.folders ?? []).find((f) => f.discipline === discipline) ?? null,
    [foldersQuery.data, discipline],
  );

  const { target, parentItemId, children, statusByItemId } = useDisciplineBrowser(
    projectId,
    discipline,
    folder,
    crumbs,
  );

  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<GraphItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);

  const visibleItems = useMemo(() => {
    const all = children.data?.items ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q ? all.filter((i) => i.name.toLowerCase().includes(q)) : all;
    return sortItems(filtered, sort);
  }, [children.data, search, sort]);

  function onOpen(item: GraphItem) {
    if (item.isFolder) {
      onCrumbsChange?.([...crumbs, { id: item.id, name: item.name }]);
      return;
    }
    setDetailItemId(item.id);
    setDetailOpen(true);
  }

  function onNavigateCrumb(index: number) {
    onCrumbsChange?.(index < 0 ? [] : crumbs.slice(0, index + 1));
  }

  function onRenameRequest(item: GraphItem) {
    setRenameTarget(item);
    setRenameOpen(true);
  }

  if (foldersQuery.isLoading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (!folder || !target) {
    return null; // Connect empty-state is owned by DisciplineWorkspace.
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`discipline-panel-${discipline}`}>
      <DocumentBrowserToolbar
        discipline={discipline}
        rootLabel="All documents"
        crumbs={crumbs}
        onNavigateCrumb={onNavigateCrumb}
        search={search}
        onSearchChange={(v) => onSearchChange?.(v)}
        sort={sort}
        onSortChange={(s) => onSortChange?.(s)}
        view={view}
        onViewChange={(v) => onViewChange?.(v)}
        canProvision={canProvision}
        onNewFolder={() => setFolderOpen(true)}
        onUpload={() => setUploadOpen(true)}
      />

      {approvalsCount > 0 && (
        <div
          className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800"
          data-testid={`discipline-approvals-banner-${discipline}`}
        >
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>
            {approvalsCount} document{approvalsCount === 1 ? " is" : "s are"} waiting for your
            approval in this project.
          </span>
          {onReviewApprovals && (
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={onReviewApprovals}
              data-testid={`discipline-approvals-review-${discipline}`}
            >
              Review now
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {children.isError ? (
          <div className="p-4 text-sm text-destructive">Couldn't load this folder's contents.</div>
        ) : view === "grid" ? (
          <DocumentGrid
            items={visibleItems}
            isLoading={children.isLoading}
            onOpen={onOpen}
            statusByItemId={statusByItemId}
            selectedItemId={detailItemId}
          />
        ) : (
          <FileListTable
            items={visibleItems}
            isLoading={children.isLoading}
            onOpen={onOpen}
            onDownload={(it) => downloadItem(target, it)}
            onRename={onRenameRequest}
            statusByItemId={statusByItemId}
            selectedItemId={detailItemId}
            rich
          />
        )}
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} target={target} parentItemId={parentItemId} />
      <NewFolderDialog open={folderOpen} onOpenChange={setFolderOpen} target={target} parentItemId={parentItemId} />
      <RenameDialog open={renameOpen} onOpenChange={setRenameOpen} target={target} item={renameTarget} />
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
    </div>
  );
}

// =====================================================================
// Card variant — legacy self-contained card (full-project Documents view).
// =====================================================================

function CardPane({ projectId, discipline, title }: DisciplinePanelProps) {
  const foldersQuery = useDisciplineFolders(projectId);
  const { allowed: canProvision } = usePermission("documents_provision", "edit");

  const folder = useMemo(
    () => (foldersQuery.data?.folders ?? []).find((f) => f.discipline === discipline) ?? null,
    [foldersQuery.data, discipline],
  );

  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const { target, parentItemId, children, statusByItemId } = useDisciplineBrowser(
    projectId,
    discipline,
    folder,
    crumbs,
  );

  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<GraphItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);

  // Reset the crumb stack when the discipline (and thus folder root) changes.
  useEffect(() => {
    setCrumbs([]);
  }, [discipline, folder?.itemId]);

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
    setCrumbs((c) => (index < 0 ? [] : c.slice(0, index + 1)));
  }

  function onRenameRequest(item: GraphItem) {
    setRenameTarget(item);
    setRenameOpen(true);
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
                onDownload={(it) => target && downloadItem(target, it)}
                statusByItemId={statusByItemId}
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
