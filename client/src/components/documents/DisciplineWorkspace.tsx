/**
 * DisciplineWorkspace — the reworked Engineering / Quality document surface.
 *
 * A three-pane, Drive-like workspace for a SINGLE discipline of one project:
 *   LEFT   DocumentRail        — project selector, "Connected to SharePoint",
 *                                smart views (All documents / Needs my approval),
 *                                and a mirror of the real SharePoint subfolders.
 *   CENTER DisciplinePanel     — breadcrumb toolbar (search / sort / list-grid /
 *          (workspace variant)   new folder / upload), a slim approvals banner,
 *                                and the file list/grid; opens the detail drawer.
 *                              — OR the project's approval queue when the
 *                                "Needs my approval" smart view is active.
 *                              — OR the connect empty-state when no folder bound.
 *   RIGHT  (detail drawer)     — owned by DisciplinePanel (shared
 *                                DocumentDetailDrawer).
 *
 * The plumbing (bind / change / disconnect) is hidden in the rail's connection
 * row + menu; there is no prominent binder card and no duplicate file list.
 *
 * State owned here: project selection, active smart view, active rail folder
 * (drives the center breadcrumb), search, sort, and the persisted list/grid
 * preference. Discipline-generic so Engineering and Quality both use it.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentRail, type RailFolder } from "@/components/documents/DocumentRail";
import { DisciplinePanel } from "@/components/documents/DisciplinePanel";
import { DisciplineConnectEmptyState } from "@/components/documents/DisciplineFolderBinder";
import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import { type Crumb } from "@/components/documents/Breadcrumb";
import {
  type DocumentSortKey, type DocumentViewMode,
} from "@/components/documents/DocumentBrowserToolbar";
import { useDisciplineFolders } from "@/hooks/use-discipline-folders";
import { useManagedDocumentApprovalQueue } from "@/hooks/use-managed-document-approvals";

const VIEW_MODE_KEY = "ee.docman.viewMode";

function readViewMode(): DocumentViewMode {
  if (typeof window === "undefined") return "list";
  return window.localStorage.getItem(VIEW_MODE_KEY) === "grid" ? "grid" : "list";
}

export interface DisciplineWorkspaceProps {
  discipline: string;
  projectScope: "active-window" | "all";
  projectOptions: { id: number; name: string }[];
  projectsLoading: boolean;
  projectId: number | null;
  onProjectChange: (id: number) => void;
}

export function DisciplineWorkspace({
  discipline,
  // projectScope is part of the page contract (Engineering = active-window,
  // Quality = all) and informs the picker options the caller supplies; the
  // workspace itself is scope-agnostic once it has the options.
  projectOptions,
  projectsLoading,
  projectId,
  onProjectChange,
}: DisciplineWorkspaceProps) {
  const [activeView, setActiveView] = useState<"all" | "approvals">("all");
  // Crumbs are the canonical center-pane path; activeFolderId mirrors the rail
  // selection (the first crumb when a rail folder is chosen).
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DocumentSortKey>("modified");
  const [view, setView] = useState<DocumentViewMode>(readViewMode);

  const foldersQuery = useDisciplineFolders(projectId);
  const boundFolder = useMemo(
    () => (foldersQuery.data?.folders ?? []).find((f) => f.discipline === discipline) ?? null,
    [foldersQuery.data, discipline],
  );

  // Per-project approval count for this user (the rail badge + the slim banner).
  const queue = useManagedDocumentApprovalQueue(projectId != null);
  const approvalsCount = useMemo(() => {
    if (projectId == null) return 0;
    return (queue.data?.rows ?? []).filter((r) => r.approval.projectId === projectId).length;
  }, [queue.data, projectId]);

  // Reset navigation when the project or discipline (folder root) changes.
  useEffect(() => {
    setCrumbs([]);
    setSearch("");
    setActiveView("all");
  }, [projectId, discipline]);

  function persistView(next: DocumentViewMode) {
    setView(next);
    if (typeof window !== "undefined") window.localStorage.setItem(VIEW_MODE_KEY, next);
  }

  function selectAllDocuments() {
    setActiveView("all");
    setCrumbs([]);
  }

  function selectApprovals() {
    setActiveView("approvals");
  }

  function selectRailFolder(folder: RailFolder | null) {
    setActiveView("all");
    setCrumbs(folder ? [{ id: folder.id, name: folder.name }] : []);
  }

  // The rail highlights a folder only when it is the sole crumb (top-level).
  const activeFolderId = crumbs.length === 1 ? crumbs[0].id : null;

  return (
    <Card className="overflow-hidden" data-testid={`discipline-workspace-${discipline}`}>
      <CardContent className="p-0">
        <div className="flex h-[640px] min-h-0">
          <DocumentRail
            discipline={discipline}
            projectOptions={projectOptions}
            projectsLoading={projectsLoading}
            projectId={projectId}
            onProjectChange={onProjectChange}
            activeView={activeView}
            onSelectAllDocuments={selectAllDocuments}
            onSelectApprovals={selectApprovals}
            approvalsCount={approvalsCount}
            activeFolderId={activeFolderId}
            onSelectFolder={selectRailFolder}
          />

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {projectId == null ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                Pick a project to see its {discipline.toLowerCase()} documents.
              </div>
            ) : activeView === "approvals" ? (
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <ManagedDocumentApprovalQueue
                  projectId={projectId}
                  title="Documents needing your approval"
                />
              </div>
            ) : foldersQuery.isLoading ? (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
                Loading…
              </div>
            ) : !boundFolder ? (
              <DisciplineConnectEmptyState projectId={projectId} discipline={discipline} />
            ) : (
              <DisciplinePanel
                variant="workspace"
                projectId={projectId}
                discipline={discipline}
                crumbs={crumbs}
                onCrumbsChange={setCrumbs}
                search={search}
                onSearchChange={setSearch}
                sort={sort}
                onSortChange={setSort}
                view={view}
                onViewChange={persistView}
                approvalsCount={approvalsCount}
                onReviewApprovals={selectApprovals}
              />
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
