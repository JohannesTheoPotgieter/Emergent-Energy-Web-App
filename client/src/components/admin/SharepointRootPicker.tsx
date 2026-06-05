/**
 * SharepointRootPicker — browse-and-pick the Active Projects SharePoint root.
 *
 * Pick a site -> a document library -> browse to the folder, and we capture
 * the Graph drive id + item id + path for you. No pasting opaque `b!…` ids.
 * Read-only browse via the admin SharePoint picker endpoints.
 */

import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronRight, Folder, FolderTree, Loader2, Home, CheckCircle2 } from "lucide-react";
import {
  useSharepointSites,
  useSharepointSiteDrives,
  useSharepointDriveFolders,
} from "@/hooks/use-document-management-admin";

export interface PickedRoot {
  driveId: string;
  driveName: string;
  /** "" when the library root itself is chosen. */
  rootItemId: string;
  /** Folder path under the library root ("" at the root). */
  rootPath: string;
  /** Suggested display name (the folder, or the library at root). */
  displayName: string;
}

export function SharepointRootPicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (picked: PickedRoot) => void;
}) {
  const sites = useSharepointSites(open);
  const [siteId, setSiteId] = useState<string | null>(null);
  const drives = useSharepointSiteDrives(siteId);
  const [drive, setDrive] = useState<{ id: string; name: string } | null>(null);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);

  const currentParentId = trail.length ? trail[trail.length - 1].id : null;
  const folders = useSharepointDriveFolders(drive?.id ?? null, currentParentId);
  const currentPath = useMemo(() => trail.map((t) => t.name).join("/"), [trail]);

  function handleUseThisFolder() {
    if (!drive) return;
    const current = trail[trail.length - 1] ?? null;
    onSelect({
      driveId: drive.id,
      driveName: drive.name,
      rootItemId: current?.id ?? "",
      rootPath: currentPath,
      displayName: current?.name ?? drive.name,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="sharepoint-root-picker">
        <DialogHeader>
          <DialogTitle>Browse SharePoint</DialogTitle>
          <DialogDescription>
            Pick the site, the document library, then open the folder that holds your active
            projects. The drive and folder IDs are captured automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Site */}
          <div className="space-y-1">
            <label className="text-xs font-medium">SharePoint site</label>
            <Select
              value={siteId ?? ""}
              onValueChange={(v) => { setSiteId(v); setDrive(null); setTrail([]); }}
              disabled={sites.isLoading}
            >
              <SelectTrigger data-testid="picker-select-site">
                <SelectValue placeholder={sites.isLoading ? "Loading sites…" : "Choose a site"} />
              </SelectTrigger>
              <SelectContent>
                {(sites.data?.sites ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Library */}
          {siteId && (
            <div className="space-y-1">
              <label className="text-xs font-medium">Document library</label>
              <Select
                value={drive?.id ?? ""}
                onValueChange={(v) => {
                  const d = (drives.data?.drives ?? []).find((x) => x.id === v) ?? null;
                  setDrive(d ? { id: d.id, name: d.name } : null);
                  setTrail([]);
                }}
                disabled={drives.isLoading}
              >
                <SelectTrigger data-testid="picker-select-drive">
                  <SelectValue placeholder={drives.isLoading ? "Loading libraries…" : "Choose a library"} />
                </SelectTrigger>
                <SelectContent>
                  {(drives.data?.drives ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Folder browser */}
          {drive && (
            <div className="rounded-md border">
              <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-1.5 text-xs">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                  onClick={() => setTrail([])}
                  data-testid="picker-breadcrumb-root"
                >
                  <Home className="h-3 w-3" /> {drive.name}
                </button>
                {trail.map((t, idx) => (
                  <span key={t.id} className="inline-flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <button
                      type="button"
                      className={idx === trail.length - 1 ? "font-medium" : "text-emerald-700 hover:underline"}
                      onClick={() => setTrail(trail.slice(0, idx + 1))}
                    >
                      {t.name}
                    </button>
                  </span>
                ))}
              </div>

              <div className="max-h-64 overflow-y-auto">
                {folders.isLoading ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (folders.data?.folders ?? []).length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No sub-folders here — you can select this folder as the root below.
                  </div>
                ) : (
                  (folders.data?.folders ?? []).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted/50"
                      onClick={() => setTrail([...trail, { id: f.id, name: f.name }])}
                      data-testid={`picker-folder-${f.name}`}
                    >
                      <Folder className="h-4 w-4 text-amber-500" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>

              <div className="flex items-center gap-1.5 border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <FolderTree className="h-3.5 w-3.5 shrink-0" />
                Selected root:&nbsp;
                <span className="truncate font-mono">
                  {drive.name}{currentPath ? `/${currentPath}` : ""}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleUseThisFolder} disabled={!drive} data-testid="picker-use-folder">
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            Use this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
