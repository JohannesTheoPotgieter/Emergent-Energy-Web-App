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
import {
  useDocumentChildren,
  useDocumentRoots,
  documentDownloadUrl,
  type BrowseTarget,
} from "@/components/documents/use-documents";
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
 * Company scope browses a company_sharepoint_roots root. Project scope is
 * folder-keyed: pick a project, then one of its provisioned project_folders,
 * and browse/upload/rename within it via the canonical
 * /api/projects/:projectId/folders/:folderId/* endpoints (the cutover off the
 * deprecated project_sharepoint_roots table).
 */
export default function DocumentsPage() {
  const roots = useDocumentRoots();
  const { projectsSummary, isLoading: projectsLoading } = useProjectsSummary();
  const taxonomy = usePublicFolderTaxonomy();

  const [scope, setScope] = useState<DocumentRootScope>("project");
  const [companyRootId, setCompanyRootId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);

  const projectFolders = useProjectFolders(scope === "project" ? projectId : null);

  const target: BrowseTarget | null = useMemo(() => {
    if (scope === "company") {
      return companyRootId != null ? { kind: "company", rootId: companyRootId } : null;
    }
    return projectId != null && folderId != null
      ? { kind: "folder", projectId, folderId }
      : null;
  }, [scope, companyRootId, projectId, folderId]);

  const parentItemId = crumbs.length > 0 ? crumbs[crumbs.length - 1].id : null;
  const children = useDocumentChildren(target, parentItemId);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<GraphItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  const projectOptions = useMemo(
    () =>
      (projectsSummary ?? [])
        .filter((p) => typeof p.project_info_id === "number")
        .map((p) => ({ projectId: p.project_info_id as number, name: p.project_name })),
    [projectsSummary],
  );

  const taxByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of taxonomy.data?.taxonomy ?? []) m.set(t.internalKey, t.displayName);
    return m;
  }, [taxonomy.data]);

  // Only provisioned (browsable) folders appear as browse anchors; the
  // project-root pseudo-folder is hidden.
  const folderOptions = useMemo(
    () =>
      (projectFolders.data?.folders ?? [])
        .filter((f) => f.taxonomyKey !== "_project_root_" && !!f.itemId)
        .sort((a, b) => a.taxonomyKey.localeCompare(b.taxonomyKey))
        .map((f) => ({
          id: f.id,
          taxonomyKey: f.taxonomyKey,
          label: taxByKey.get(f.taxonomyKey) ?? f.taxonomyKey,
        })),
    [projectFolders.data, taxByKey],
  );

  const rootLabel = useMemo(() => {
    if (scope === "company") {
      if (companyRootId == null) return "Company";
      return roots.data?.company.find((c) => c.id === companyRootId)?.displayName ?? "Company";
    }
    if (folderId == null) return "Folder";
    return folderOptions.find((f) => f.id === folderId)?.label ?? "Folder";
  }, [scope, companyRootId, folderId, roots.data, folderOptions]);

  function onScopeChange(next: DocumentRootScope) {
    setScope(next);
    setCompanyRootId(null);
    setProjectId(null);
    setFolderId(null);
    setCrumbs([]);
  }

  function onCompanyRootSelect(id: number) {
    setCompanyRootId(id);
    setCrumbs([]);
  }

  function onProjectSelect(id: number) {
    setProjectId(id);
    setFolderId(null);
    setCrumbs([]);
  }

  function onFolderSelect(id: number) {
    setFolderId(id);
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
    if (!target) return;
    const url = documentDownloadUrl(target, item.id);
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
              company={roots.data?.company ?? []}
              selectedCompanyRootId={companyRootId}
              onCompanyRootSelect={onCompanyRootSelect}
              projects={projectOptions}
              projectsLoading={projectsLoading}
              selectedProjectId={projectId}
              onProjectSelect={onProjectSelect}
              folders={folderOptions}
              foldersLoading={scope === "project" && projectId != null && projectFolders.isLoading}
              selectedFolderId={folderId}
              onFolderSelect={onFolderSelect}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardContent className="pt-4 space-y-3">
            {!target && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {scope === "project"
                  ? "Pick a project and a folder on the left to start browsing."
                  : "Pick a library on the left to start browsing."}
              </p>
            )}
            {target && (
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

      {target && (
        <UploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          target={target}
          parentItemId={parentItemId}
        />
      )}
      {target && (
        <NewFolderDialog
          open={folderOpen}
          onOpenChange={setFolderOpen}
          target={target}
          parentItemId={parentItemId}
        />
      )}
      {target && (
        <RenameDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          target={target}
          item={renameTarget}
        />
      )}
      {target && (
        <DocumentDetailDrawer
          open={detailOpen}
          onOpenChange={setDetailOpen}
          target={target}
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
//
// Uploads go through the canonical folder-keyed endpoint
// (/api/projects/:projectId/folders/:folderId/upload).
// =========================================================================

function ActiveClientsView() {
  const { projectsSummary, isLoading: projectsLoading } = useProjectsSummary();
  const taxonomy = usePublicFolderTaxonomy();
  const [projectId, setProjectId] = useState<number | null>(null);
  const folders = useProjectFolders(projectId);
  const [expandedFolderId, setExpandedFolderId] = useState<number | null>(null);
  const [uploadFolderId, setUploadFolderId] = useState<number | null>(null);

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
                        {f.itemId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs px-2 shrink-0"
                            onClick={() => setUploadFolderId(f.id)}
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

      {uploadFolderId !== null && projectId !== null && (
        <UploadDialog
          open={uploadFolderId !== null}
          onOpenChange={(open) => {
            if (!open) setUploadFolderId(null);
          }}
          target={{ kind: "folder", projectId, folderId: uploadFolderId }}
          parentItemId={null}
        />
      )}
    </div>
  );
}
