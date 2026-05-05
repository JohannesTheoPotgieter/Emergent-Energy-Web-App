import { useMemo, useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FolderPlus, Upload, FolderTree, Server, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { RootSelector } from "@/components/documents/RootSelector";
import { FileListTable } from "@/components/documents/FileListTable";
import { DocumentsBreadcrumb, type Crumb } from "@/components/documents/Breadcrumb";
import { UploadDialog } from "@/components/documents/UploadDialog";
import { NewFolderDialog } from "@/components/documents/NewFolderDialog";
import { RenameDialog } from "@/components/documents/RenameDialog";
import { DocumentDetailDrawer } from "@/components/documents/DocumentDetailDrawer";
import { useDocumentChildren, useDocumentRoots } from "@/components/documents/use-documents";
import { FolderFiles } from "@/components/documents/FolderFiles";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
import {
  useProjectFolders,
  usePublicFolderTaxonomy,
} from "@/hooks/use-document-management-admin";
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

  function onRenameRequest(item: GraphItem) {
    setRenameTarget(item);
    setRenameOpen(true);
  }

  if (roots.isLoading) return <PageSkeleton />;
  if (roots.error) return <PageError message="Failed to load document roots" />;

  return (
    <PageLayout
      data-testid="documents-page"
      header={
        <PageHeader
          title="Documents"
          subtitle="Active Clients project view + generic SharePoint browser."
        />
      }
    >
      <Tabs defaultValue="active-clients" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md mb-4">
          <TabsTrigger value="active-clients" data-testid="tab-documents-active-clients">
            <FolderTree className="h-4 w-4 mr-2" />
            Active Clients
          </TabsTrigger>
          <TabsTrigger value="library" data-testid="tab-documents-library">
            <Server className="h-4 w-4 mr-2" />
            SharePoint browser
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active-clients">
          <ActiveClientsView />
        </TabsContent>

        <TabsContent value="library">
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
        </TabsContent>
      </Tabs>

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

// =========================================================================
// D6 Phase 7 — Active Clients project view.
//
// Drives the new taxonomy-aware flow from /documents:
//   pick a project → see its provisioned folders → expand a folder to
//   see managed_documents inline (with request-approval actions).
// =========================================================================

function ActiveClientsView() {
  const { projectsSummary, isLoading: projectsLoading } = useProjectsSummary();
  const taxonomy = usePublicFolderTaxonomy();
  const roots = useDocumentRoots();
  const [projectId, setProjectId] = useState<number | null>(null);
  const folders = useProjectFolders(projectId);
  const [expandedFolderId, setExpandedFolderId] = useState<number | null>(null);
  const [uploadFolderId, setUploadFolderId] = useState<number | null>(null);
  const [uploadFolderItemId, setUploadFolderItemId] = useState<string | null>(null);

  const projectRootId = useMemo(() => {
    if (!projectId || !roots.data) return null;
    const root = roots.data.project.find((r) => r.projectId === projectId);
    return root?.id ?? null;
  }, [projectId, roots.data]);

  const projectOptions = (projectsSummary ?? []).filter(
    (p) => typeof p.project_info_id === "number",
  );

  const taxByKey = useMemo(() => {
    const m = new Map<string, { displayName: string; lifecycleMode: string }>();
    for (const t of taxonomy.data?.taxonomy ?? []) {
      m.set(t.internalKey, {
        displayName: t.displayName,
        lifecycleMode: t.lifecycleMode,
      });
    }
    return m;
  }, [taxonomy.data]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-[280px]">
              <label className="text-xs font-medium">Project</label>
              <Select
                value={projectId ? String(projectId) : ""}
                onValueChange={(v) => {
                  setProjectId(Number(v));
                  setExpandedFolderId(null);
                }}
                disabled={projectsLoading}
              >
                <SelectTrigger data-testid="select-active-clients-project">
                  <SelectValue
                    placeholder={projectsLoading ? "Loading…" : "Choose a project"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {projectOptions.map((p) => (
                    <SelectItem
                      key={p.project_info_id as number}
                      value={String(p.project_info_id)}
                    >
                      {p.project_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {projectId && (
              <Link
                href={`/projects/${projectId}/documents`}
                className="text-xs text-emerald-700 hover:underline ml-auto"
                data-testid="link-active-clients-project-page"
              >
                Open the full project documents page →
              </Link>
            )}
          </div>

          {!projectId ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Pick a project to see its Active Clients folder tree.
            </p>
          ) : folders.isLoading ? (
            <p className="text-xs text-muted-foreground py-4">Loading folders…</p>
          ) : (folders.data?.folders ?? []).length === 0 ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">
              No folders provisioned for this project yet. A super-user with the
              <em> documents_provision </em> permission can trigger provisioning from
              <em> /admin/document-management</em>.
            </div>
          ) : (
            <div className="space-y-2" data-testid="active-clients-folder-list">
              {(folders.data?.folders ?? [])
                .filter((f) => f.taxonomyKey !== "_project_root_")
                .sort((a, b) => a.taxonomyKey.localeCompare(b.taxonomyKey))
                .map((f) => {
                  const tax = taxByKey.get(f.taxonomyKey);
                  const isExpanded = expandedFolderId === f.id;
                  return (
                    <div
                      key={f.id}
                      className="rounded-md border"
                      data-testid={`active-clients-folder-${f.taxonomyKey}`}
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button
                          type="button"
                          className="flex-1 flex items-center gap-2 text-left hover:bg-muted/30 min-w-0"
                          onClick={() => setExpandedFolderId(isExpanded ? null : f.id)}
                          data-testid={`btn-active-clients-folder-toggle-${f.taxonomyKey}`}
                        >
                          <FolderTree className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium">
                            {tax?.displayName ?? f.taxonomyKey}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {f.taxonomyKey}
                          </span>
                          {f.itemId ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-emerald-50 text-emerald-700"
                            >
                              Provisioned
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800">
                              Not provisioned
                            </Badge>
                          )}
                        </button>
                        {f.webUrl && (
                          <a
                            href={f.webUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1 shrink-0"
                            data-testid={`link-active-clients-folder-open-${f.taxonomyKey}`}
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </a>
                        )}
                        {f.itemId && projectRootId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs px-2 shrink-0"
                            onClick={() => {
                              setUploadFolderId(f.id);
                              setUploadFolderItemId(f.itemId);
                            }}
                            data-testid={`btn-active-clients-upload-${f.taxonomyKey}`}
                          >
                            <Upload className="h-3 w-3 mr-1" />
                            Upload
                          </Button>
                        )}
                      </div>
                      {isExpanded && f.itemId && projectId && (
                        <div className="border-t bg-muted/10">
                          <FolderFiles
                            projectId={projectId}
                            folderId={f.id}
                            testIdSuffix={`active-clients-${f.taxonomyKey}`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {projectRootId !== null && (
        <UploadDialog
          open={uploadFolderId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setUploadFolderId(null);
              setUploadFolderItemId(null);
            }
          }}
          scope="project"
          rootId={projectRootId}
          parentItemId={uploadFolderItemId}
        />
      )}
    </div>
  );
}
