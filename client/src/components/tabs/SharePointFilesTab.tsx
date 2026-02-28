import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Folder,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Film,
  File,
  ArrowLeft,
  ExternalLink,
  Download,
  Loader2,
  HardDrive,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
} from "lucide-react";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function formatSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

function getFileIcon(name: string, mimeType?: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["xlsx", "xls", "xlsm", "csv"].includes(ext || "")) return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
  if (["doc", "docx"].includes(ext || "")) return <FileText className="h-5 w-5 text-blue-600" />;
  if (["pdf"].includes(ext || "")) return <FileText className="h-5 w-5 text-red-600" />;
  if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext || "")) return <ImageIcon className="h-5 w-5 text-purple-600" />;
  if (["mp4", "avi", "mov", "mkv"].includes(ext || "")) return <Film className="h-5 w-5 text-orange-600" />;
  if (mimeType?.startsWith("image/")) return <ImageIcon className="h-5 w-5 text-purple-600" />;
  return <File className="h-5 w-5 text-gray-500" />;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

export function SharePointFilesTab({ projectName }: { projectName: string }) {
  const [folderStack, setFolderStack] = useState<BreadcrumbItem[]>([]);
  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;

  const { data: spSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ["sp-config"],
    queryFn: async () => {
      const res = await fetch("/api/sp-config", {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const driveId = spSettings?.driveId;
  const browseFolderId = currentFolderId || spSettings?.folderItemId || undefined;

  const { data: items = [], isLoading: itemsLoading, refetch } = useQuery({
    queryKey: ["sp-project-files", driveId, browseFolderId],
    queryFn: async () => {
      const params = new URLSearchParams({ driveId });
      if (browseFolderId) params.set("folderId", browseFolderId);
      const res = await fetch(`/api/sp-project-files?${params.toString()}`, {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load files");
      return res.json();
    },
    enabled: !!driveId,
  });

  const folders = items.filter((i: any) => i.isFolder).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const files = items.filter((i: any) => !i.isFolder).sort((a: any, b: any) => a.name.localeCompare(b.name));

  const navigateToFolder = (id: string, name: string) => {
    setFolderStack([...folderStack, { id, name }]);
  };

  const navigateUp = () => {
    setFolderStack(folderStack.slice(0, -1));
  };

  const navigateToBreadcrumb = (index: number) => {
    setFolderStack(folderStack.slice(0, index + 1));
  };

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!spSettings || !driveId) {
    return (
      <Card className="border-amber-200 bg-amber-50/30">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">SharePoint Not Configured</p>
          <p className="text-xs text-muted-foreground">
            An admin needs to configure the SharePoint connection in Settings → Microsoft Integration before files can be browsed.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-white" data-testid="sharepoint-files-tab">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#292929] text-white">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-blue-400" />
          <span className="font-medium text-sm">SharePoint Files</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] text-gray-300 hover:text-white hover:bg-gray-700 gap-1"
          onClick={() => refetch()}
          data-testid="button-refresh-files"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-1 px-4 py-2 border-b bg-gray-50/50 text-xs">
        <button
          className="text-blue-600 hover:underline font-medium"
          onClick={() => setFolderStack([])}
          data-testid="breadcrumb-root"
        >
          {spSettings.folderPath || "Root"}
        </button>
        {folderStack.map((item, idx) => (
          <span key={item.id} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              className={`hover:underline ${idx === folderStack.length - 1 ? "text-foreground font-medium" : "text-blue-600"}`}
              onClick={() => navigateToBreadcrumb(idx)}
            >
              {item.name}
            </button>
          </span>
        ))}
      </div>

      <div className="min-h-[300px] max-h-[400px] overflow-y-auto">
        {itemsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Folder className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">This folder is empty</p>
          </div>
        ) : (
          <div>
            {folderStack.length > 0 && (
              <div
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer border-b"
                onClick={navigateUp}
                data-testid="button-folder-up"
              >
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Back</span>
              </div>
            )}

            {folders.map((f: any) => (
              <div
                key={f.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/50 cursor-pointer border-b transition-colors"
                onClick={() => navigateToFolder(f.id, f.name)}
                data-testid={`folder-${f.id}`}
              >
                <Folder className="h-5 w-5 text-amber-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{f.name}</p>
                  <p className="text-[10px] text-muted-foreground">{f.childCount} items</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}

            {files.map((f: any) => (
              <div
                key={f.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50 border-b transition-colors"
                data-testid={`file-${f.id}`}
              >
                {getFileIcon(f.name, f.mimeType)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{f.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatSize(f.size)}
                    {f.lastModified && ` · ${new Date(f.lastModified).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {f.webUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => window.open(f.webUrl, "_blank")}
                      data-testid={`button-open-${f.id}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )}
                  {f.downloadUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = f.downloadUrl;
                        a.download = f.name;
                        a.click();
                      }}
                      data-testid={`button-download-${f.id}`}
                    >
                      <Download className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
