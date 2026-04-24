import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderPlus, Upload } from "lucide-react";
import { RootSelector } from "@/components/documents/RootSelector";
import { FileListTable } from "@/components/documents/FileListTable";
import { DocumentsBreadcrumb, type Crumb } from "@/components/documents/Breadcrumb";
import { UploadDialog } from "@/components/documents/UploadDialog";
import { NewFolderDialog } from "@/components/documents/NewFolderDialog";
import { RenameDialog } from "@/components/documents/RenameDialog";
import { DocumentDetailDrawer } from "@/components/documents/DocumentDetailDrawer";
import { useDocumentChildren, useDocumentRoots } from "@/components/documents/use-documents";
import type { DocumentRootScope, GraphItem } from "@/components/documents/types";

/**
 * /documents — generic SharePoint browser.
 *
 * Phase 1 (browse + download) ships today. Upload / new folder / rename /
 * check-in/out + comments are behind the same surface and are enabled
 * where server ACL permits.
 */
export default function DocumentsPage() {
  const roots = useDocumentRoots();
  const [scope, setScope] = useState<DocumentRootScope>("project");
  const [rootId, setRootId] = useState<number | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);

  const parentItemId = crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null;
  const children = useDocumentChildren(scope, rootId, parentItemId);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<GraphItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  const rootLabel = useMemo(() => {
    if (!rootId || !roots.data) return "Root";
    if (scope === "project") {
      const r = roots.data.project.find((p) => p.id === rootId);
      return r?.name ?? "Project";
    }
    const r = roots.data.company.find((c) => c.id === rootId);
    return r?.displayName ?? "Company";
  }, [rootId, roots.data, scope]);

  function onScopeChange(next: DocumentRootScope) {
    setScope(next);
    setRootId(null);
    setCrumbs([]);
  }

  function onRootSelect(id: number) {
    setRootId(id);
    setCrumbs([]);
  }

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

  async function onDownload(item: GraphItem) {
    if (!scope || !rootId) return;
    const url = `/api/documents/${scope}/${rootId}/item/${encodeURIComponent(item.id)}/download`;
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { credentials: "include", headers });
    if (!res.ok) return;
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

  function onRenameRequest(item: GraphItem) {
    setRenameTarget(item);
    setRenameOpen(true);
  }

  if (roots.isLoading) return <PageSkeleton />;
  if (roots.error) return <PageError message="Failed to load document roots" />;

  return (
    <PageLayout
      data-testid="documents-page"
      header={<PageHeader title="Documents" subtitle="Browse project and company SharePoint libraries." />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="lg:col-span-1">
          <CardContent className="pt-4">
            <RootSelector
              scope={scope}
              onScopeChange={onScopeChange}
              projects={roots.data?.project ?? []}
              company={roots.data?.company ?? []}
              selectedRootId={rootId}
              onRootSelect={onRootSelect}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardContent className="pt-4 space-y-3">
            {!rootId && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Pick a library on the left to start browsing.
              </p>
            )}
            {rootId && (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <DocumentsBreadcrumb rootLabel={rootLabel} crumbs={crumbs} onNavigate={onNavigateCrumb} />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setFolderOpen(true)}
                      data-testid="documents-new-folder"
                    >
                      <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
                      New folder
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setUploadOpen(true)}
                      data-testid="documents-upload"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Upload
                    </Button>
                  </div>
                </div>
                <FileListTable
                  items={children.data?.items ?? []}
                  isLoading={children.isLoading}
                  onOpen={onOpen}
                  onDownload={onDownload}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {rootId && (
        <UploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          scope={scope}
          rootId={rootId}
          parentItemId={parentItemId}
        />
      )}
      {rootId && (
        <NewFolderDialog
          open={folderOpen}
          onOpenChange={setFolderOpen}
          scope={scope}
          rootId={rootId}
          parentItemId={parentItemId}
        />
      )}
      {rootId && (
        <RenameDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          scope={scope}
          rootId={rootId}
          item={renameTarget}
        />
      )}
      {rootId && (
        <DocumentDetailDrawer
          open={detailOpen}
          onOpenChange={setDetailOpen}
          scope={scope}
          rootId={rootId}
          itemId={detailItemId}
          onRename={onRenameRequest}
        />
      )}
    </PageLayout>
  );
}
