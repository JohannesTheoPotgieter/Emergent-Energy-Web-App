import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  FolderOpen, Loader2, FileText, Link2, Folder,
  ChevronRight as ChevronRightIcon, ArrowLeft,
  Download, HardDrive, Search,
  File, FileSpreadsheet, Image as ImageIcon, Film,
} from "lucide-react";
import {
  authHeaders, TagToProjectDialog, ConvertToTaskDialog, MsObjectActions,
} from "./collaboration";

function getFileIcon(name: string) {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  if (["xlsx", "xls", "csv"].includes(ext)) return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
  if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext)) return <ImageIcon className="h-4 w-4 text-purple-600" />;
  if (["mp4", "mov", "avi", "mkv"].includes(ext)) return <Film className="h-4 w-4 text-red-600" />;
  if (["pdf"].includes(ext)) return <FileText className="h-4 w-4 text-red-500" />;
  if (["doc", "docx"].includes(ext)) return <FileText className="h-4 w-4 text-blue-600" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function formatFileSize(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CollabSharePointPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<any>(null);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<any>(null);

  const [driveId, setDriveId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([]);
  const [setupMode, setSetupMode] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  useEffect(() => {
    qc.removeQueries({ queryKey: ["ms-objects-mine", "sharepoint_file"] });
    qc.removeQueries({ queryKey: ["sp-config"] });
    qc.removeQueries({ queryKey: ["sp-files"] });
  }, []);

  const { data: syncedItems = [] } = useQuery<any[]>({
    queryKey: ["ms-objects-mine", "sharepoint_file"],
    queryFn: async () => {
      const res = await fetch("/api/ms-objects/mine?type=sharepoint_file", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 0,
    gcTime: 0,
  });

  const { data: config, isLoading: loadingConfig, refetch: refetchConfig } = useQuery<any>({
    queryKey: ["sp-config"],
    queryFn: async () => {
      const res = await fetch("/api/sp-config", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 0,
    gcTime: 0,
  });

  const { data: sites, isLoading: loadingSites } = useQuery<any[]>({
    queryKey: ["sp-discover-sites"],
    queryFn: async () => {
      const res = await fetch("/api/sp-discover-sites", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: setupMode,
    staleTime: 120_000,
  });

  const { data: drives } = useQuery<any[]>({
    queryKey: ["sp-drives", selectedSiteId],
    queryFn: async () => {
      const res = await fetch(`/api/sp-site-drives/${selectedSiteId}`, { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedSiteId,
    staleTime: 120_000,
  });

  const activeDriveId = driveId || config?.driveId;

  const { data: files, isLoading: loadingFiles } = useQuery<any[]>({
    queryKey: ["sp-files", activeDriveId, folderId],
    queryFn: async () => {
      const path = folderId
        ? `/api/sp-drive/${activeDriveId}/items/${folderId}/children`
        : `/api/sp-drive/${activeDriveId}/root/children`;
      const res = await fetch(path, { headers: authHeaders(), credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!activeDriveId && !setupMode,
    staleTime: 0,
    gcTime: 0,
  });

  const navigateToFolder = (id: string, name: string) => {
    setFolderId(id);
    setBreadcrumbs(prev => [...prev, { id, name }]);
  };

  const navigateToBreadcrumb = (index: number) => {
    if (index < 0) {
      setFolderId(null);
      setBreadcrumbs([]);
    } else {
      setFolderId(breadcrumbs[index].id);
      setBreadcrumbs(prev => prev.slice(0, index + 1));
    }
  };

  const selectDrive = async (siteId: string, driveIdValue: string, driveName: string) => {
    try {
      await fetch("/api/sp-config", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ siteId, driveId: driveIdValue, driveName }),
      });
      setDriveId(driveIdValue);
      setSetupMode(false);
      setSelectedSiteId(null);
      setBreadcrumbs([]);
      setFolderId(null);
      refetchConfig();
      toast({ title: "SharePoint drive connected" });
    } catch {
      toast({ title: "Failed to save config", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="collab-sharepoint-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-sharepoint-title">
            <FolderOpen className="h-6 w-6 text-teal-600" />
            SharePoint
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Browse and manage SharePoint documents
            {user?.displayName && <span> — {user.displayName}</span>}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSetupMode(!setupMode)}
          data-testid="sp-setup-btn"
        >
          <HardDrive className="h-4 w-4 mr-1" />
          {setupMode ? "Cancel" : "Change Drive"}
        </Button>
      </div>

      {syncedItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Synced Files ({syncedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-lg border">
              {syncedItems.map((item: any) => (
                <div
                  key={item.id}
                  className="group flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors"
                  data-testid={`synced-sp-item-${item.id}`}
                >
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.subjectOrTitle || "File"}</p>
                    {item.linkedProjectId && (
                      <Badge variant="secondary" className="text-[10px] mt-0.5">
                        <Link2 className="h-3 w-3 mr-0.5" /> Tagged
                      </Badge>
                    )}
                  </div>
                  <MsObjectActions
                    item={item}
                    onTagClick={(i) => { setTagTarget(i); setTagDialogOpen(true); }}
                    onConvertClick={(i) => { setConvertTarget(i); setConvertDialogOpen(true); }}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {setupMode ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Select SharePoint Site & Drive</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingSites ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-2">
                {(sites || []).map((site: any) => (
                  <div key={site.id}>
                    <button
                      className={`w-full text-left px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-sm ${selectedSiteId === site.id ? "bg-primary/10 font-medium" : ""}`}
                      onClick={() => setSelectedSiteId(selectedSiteId === site.id ? null : site.id)}
                    >
                      <HardDrive className="h-4 w-4 inline mr-2" />
                      {site.displayName || site.name}
                    </button>
                    {selectedSiteId === site.id && drives && (
                      <div className="ml-6 mt-1 space-y-1">
                        {drives.map((drive: any) => (
                          <button
                            key={drive.id}
                            className="w-full text-left px-3 py-1.5 rounded hover:bg-muted/50 text-sm text-muted-foreground"
                            onClick={() => selectDrive(site.id, drive.id, drive.name)}
                          >
                            <Folder className="h-3.5 w-3.5 inline mr-1.5" />
                            {drive.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : loadingConfig ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !activeDriveId ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">No SharePoint drive connected</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Change Drive" to connect a SharePoint site</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
            <button className="hover:text-foreground transition-colors font-medium" onClick={() => navigateToBreadcrumb(-1)}>
              {config?.driveName || "Documents"}
            </button>
            {breadcrumbs.map((bc, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRightIcon className="h-3 w-3" />
                <button className="hover:text-foreground transition-colors" onClick={() => navigateToBreadcrumb(i)}>
                  {bc.name}
                </button>
              </span>
            ))}
          </div>

          {breadcrumbs.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => navigateToBreadcrumb(breadcrumbs.length - 2)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}

          {loadingFiles ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="divide-y rounded-lg border bg-card">
              {(files || []).length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">This folder is empty</div>
              ) : (
                (files || []).map((f: any) => (
                  <div
                    key={f.id}
                    className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => f.folder ? navigateToFolder(f.id, f.name) : f.webUrl && window.open(f.webUrl, "_blank")}
                    data-testid={`sp-file-${f.id}`}
                  >
                    {f.folder ? <Folder className="h-4 w-4 text-amber-500 flex-shrink-0" /> : getFileIcon(f.name)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{f.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {f.folder ? `${f.folder.childCount || 0} items` : formatFileSize(f.size)}
                      </p>
                    </div>
                    {f.folder ? (
                      <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
                    ) : f["@microsoft.graph.downloadUrl"] ? (
                      <a
                        href={f["@microsoft.graph.downloadUrl"]}
                        onClick={(e) => e.stopPropagation()}
                        download
                      >
                        <Download className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </a>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <TagToProjectDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        msObjectId={tagTarget?.id || null}
        currentProjectId={tagTarget?.linkedProjectId}
      />

      {convertTarget && (
        <ConvertToTaskDialog
          open={convertDialogOpen}
          onOpenChange={setConvertDialogOpen}
          item={convertTarget}
        />
      )}
    </div>
  );
}
