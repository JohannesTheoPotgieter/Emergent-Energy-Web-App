import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import {
  Folder,
  FolderOpen,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Film,
  File,
  ArrowLeft,
  Loader2,
  HardDrive,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  FolderSearch,
  Unlink,
  Check,
} from "lucide-react";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["xlsx", "xls", "xlsm", "csv"].includes(ext || "")) return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
  if (["doc", "docx"].includes(ext || "")) return <FileText className="h-5 w-5 text-blue-600" />;
  if (["pdf"].includes(ext || "")) return <FileText className="h-5 w-5 text-red-600" />;
  if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext || "")) return <ImageIcon className="h-5 w-5 text-purple-600" />;
  if (["mp4", "avi", "mov", "mkv"].includes(ext || "")) return <Film className="h-5 w-5 text-orange-600" />;
  if (["pptx", "ppt"].includes(ext || "")) return <FileText className="h-5 w-5 text-orange-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

function formatSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

const DB_NAME = "emergent_folder_handles";
const STORE_NAME = "handles";

async function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandle(key: string, handle: FileSystemDirectoryHandle) {
  const db = await openHandleDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(handle, key);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const request = tx.objectStore(STORE_NAME).get(key);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function removeHandle(key: string) {
  const db = await openHandleDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(key);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

interface FolderEntry {
  name: string;
  kind: "file" | "directory";
  size?: number;
  lastModified?: number;
}

export function LocalFolderTab({ projectName }: { projectName: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? 0;
  const handleKey = `folder_${userId}_${projectName}`;

  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [folderStack, setFolderStack] = useState<{ handle: FileSystemDirectoryHandle; name: string }[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data: savedFolder } = useQuery({
    queryKey: ["user-project-folder", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/user-project-folder/${encodeURIComponent(projectName)}`, {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const saveFolderMutation = useMutation({
    mutationFn: async (data: { folderName: string; folderPath?: string }) => {
      const res = await fetch(`/api/user-project-folder/${encodeURIComponent(projectName)}`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-project-folder", projectName] });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/user-project-folder/${encodeURIComponent(projectName)}`, {
        method: "DELETE",
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to unlink");
      return res.json();
    },
    onSuccess: async () => {
      await removeHandle(handleKey);
      setDirHandle(null);
      setEntries([]);
      setFolderStack([]);
      setPermissionGranted(false);
      queryClient.invalidateQueries({ queryKey: ["user-project-folder", projectName] });
    },
  });

  const readDirectory = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setLoading(true);
    setError(null);
    try {
      const items: FolderEntry[] = [];
      for await (const entry of (handle as any).values()) {
        const item: FolderEntry = { name: entry.name, kind: entry.kind };
        if (entry.kind === "file") {
          try {
            const file = await entry.getFile();
            item.size = file.size;
            item.lastModified = file.lastModified;
          } catch {}
        }
        items.push(item);
      }
      items.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(items);
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setPermissionGranted(false);
        setError("Folder access permission was revoked. Please grant access again.");
      } else {
        setError("Could not read folder contents. You may need to re-select the folder.");
      }
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await getHandle(handleKey);
        if (stored) {
          const perm = await (stored as any).queryPermission({ mode: "read" });
          if (perm === "granted") {
            setDirHandle(stored);
            setPermissionGranted(true);
            await readDirectory(stored);
          } else {
            setDirHandle(stored);
          }
        }
      } catch {}
      setInitializing(false);
    })();
  }, [handleKey, readDirectory]);

  const pickFolder = async () => {
    try {
      if (!("showDirectoryPicker" in window)) {
        setError("Your browser does not support folder selection. Please use Chrome or Edge.");
        return;
      }
      const handle = await (window as any).showDirectoryPicker({ mode: "read" });
      setDirHandle(handle);
      setPermissionGranted(true);
      setFolderStack([]);
      await saveHandle(handleKey, handle);
      saveFolderMutation.mutate({ folderName: handle.name });
      await readDirectory(handle);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError("Failed to select folder. Please try again.");
      }
    }
  };

  const requestPermission = async () => {
    if (!dirHandle) return;
    try {
      const perm = await (dirHandle as any).requestPermission({ mode: "read" });
      if (perm === "granted") {
        setPermissionGranted(true);
        await readDirectory(dirHandle);
      }
    } catch {
      setError("Permission denied. Please try selecting the folder again.");
    }
  };

  const navigateToSubfolder = async (name: string) => {
    const currentHandle = folderStack.length > 0 ? folderStack[folderStack.length - 1].handle : dirHandle;
    if (!currentHandle) return;
    try {
      const subHandle = await currentHandle.getDirectoryHandle(name);
      setFolderStack([...folderStack, { handle: subHandle, name }]);
      await readDirectory(subHandle);
    } catch {
      setError(`Could not open folder "${name}".`);
    }
  };

  const navigateUp = async () => {
    if (folderStack.length === 0) return;
    const newStack = folderStack.slice(0, -1);
    setFolderStack(newStack);
    const target = newStack.length > 0 ? newStack[newStack.length - 1].handle : dirHandle;
    if (target) await readDirectory(target);
  };

  const navigateToBreadcrumb = async (index: number) => {
    if (index < 0) {
      setFolderStack([]);
      if (dirHandle) await readDirectory(dirHandle);
      return;
    }
    const newStack = folderStack.slice(0, index + 1);
    setFolderStack(newStack);
    await readDirectory(newStack[newStack.length - 1].handle);
  };

  const refreshCurrent = async () => {
    const target = folderStack.length > 0 ? folderStack[folderStack.length - 1].handle : dirHandle;
    if (target) await readDirectory(target);
  };

  const supportsApi = typeof window !== "undefined" && "showDirectoryPicker" in window;

  if (initializing) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!supportsApi) {
    return (
      <Card className="border-amber-200 bg-amber-50/30">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">Browser Not Supported</p>
          <p className="text-xs text-muted-foreground">
            Local folder browsing requires Chrome, Edge, or another Chromium-based browser. Please switch browsers to use this feature.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!dirHandle && !savedFolder) {
    return (
      <Card className="border-dashed border-2 border-emerald-200 bg-emerald-50/20">
        <CardContent className="p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <FolderSearch className="h-8 w-8 text-emerald-600" />
          </div>
          <h3 className="text-base font-semibold mb-2" data-testid="text-no-folder">Link a Project Folder</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Select your local SharePoint sync folder for this project. The app will remember your choice and show the folder contents each time you open this project.
          </p>
          <Button
            onClick={pickFolder}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            data-testid="button-pick-folder"
          >
            <FolderOpen className="h-4 w-4" />
            Browse for Folder
          </Button>
          {error && (
            <p className="text-xs text-red-600 mt-3">{error}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (dirHandle && !permissionGranted) {
    return (
      <Card className="border-sky-200 bg-sky-50/20">
        <CardContent className="p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-sky-100 flex items-center justify-center mx-auto mb-4">
            <FolderOpen className="h-8 w-8 text-sky-600" />
          </div>
          <h3 className="text-base font-semibold mb-2">Re-authorize Folder Access</h3>
          <p className="text-sm text-muted-foreground mb-1">
            <span className="font-medium text-foreground">{savedFolder?.folderName || dirHandle.name}</span>
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Your browser needs permission to read this folder again. Click below to grant access.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button
              onClick={requestPermission}
              className="bg-sky-600 hover:bg-sky-700 text-white gap-2"
              data-testid="button-grant-permission"
            >
              <Check className="h-4 w-4" />
              Grant Access
            </Button>
            <Button
              variant="outline"
              onClick={pickFolder}
              className="gap-2"
              data-testid="button-change-folder"
            >
              <FolderSearch className="h-4 w-4" />
              Pick Different Folder
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const folders = entries.filter(e => e.kind === "directory");
  const files = entries.filter(e => e.kind === "file");
  const currentFolderName = folderStack.length > 0 ? folderStack[folderStack.length - 1].name : (dirHandle?.name || savedFolder?.folderName || "Root");

  return (
    <div className="border rounded-lg overflow-hidden bg-card" data-testid="local-folder-tab">
      <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-600 text-white">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4" />
          <span className="font-medium text-sm">Local Project Folder</span>
          {savedFolder && (
            <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-100 ml-1">
              Linked
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] text-emerald-100 hover:text-white hover:bg-emerald-700 gap-1"
            onClick={refreshCurrent}
            data-testid="button-refresh-local"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] text-emerald-100 hover:text-white hover:bg-emerald-700 gap-1"
            onClick={pickFolder}
            data-testid="button-change-folder-header"
          >
            <FolderSearch className="h-3 w-3" />
            Change
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] text-emerald-100 hover:text-white hover:bg-emerald-700 gap-1"
            onClick={() => unlinkMutation.mutate()}
            data-testid="button-unlink-folder"
          >
            <Unlink className="h-3 w-3" />
            Unlink
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-4 py-2 border-b bg-muted/50 text-xs overflow-x-auto">
        <button
          className="text-emerald-600 hover:underline font-medium shrink-0"
          onClick={() => navigateToBreadcrumb(-1)}
          data-testid="breadcrumb-root"
        >
          {dirHandle?.name || savedFolder?.folderName || "Root"}
        </button>
        {folderStack.map((item, idx) => (
          <span key={idx} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              className={`hover:underline ${idx === folderStack.length - 1 ? "text-foreground font-medium" : "text-emerald-600"}`}
              onClick={() => navigateToBreadcrumb(idx)}
            >
              {item.name}
            </button>
          </span>
        ))}
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="min-h-[300px] max-h-[500px] overflow-y-auto">
        {loading ? (
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
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted cursor-pointer border-b"
                onClick={navigateUp}
                data-testid="button-folder-up"
              >
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Back</span>
              </div>
            )}

            {folders.map((f) => (
              <div
                key={f.name}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-emerald-50/50 cursor-pointer border-b transition-colors"
                onClick={() => navigateToSubfolder(f.name)}
                data-testid={`local-folder-${f.name}`}
              >
                <Folder className="h-5 w-5 text-amber-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{f.name}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}

            {files.map((f) => (
              <div
                key={f.name}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 border-b transition-colors"
                data-testid={`local-file-${f.name}`}
              >
                {getFileIcon(f.name)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{f.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {f.size !== undefined && formatSize(f.size)}
                    {f.lastModified && ` · ${new Date(f.lastModified).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t bg-muted/30 text-[10px] text-muted-foreground flex items-center justify-between">
        <span>{folders.length} folders, {files.length} files</span>
        <span>Synced SharePoint folder · {currentFolderName}</span>
      </div>
    </div>
  );
}
