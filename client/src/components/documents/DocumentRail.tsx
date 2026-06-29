/**
 * DocumentRail — the left rail of the discipline document workspace.
 *
 * Top-to-bottom: project selector · quiet "Connected to SharePoint" indicator
 * (+ a tucked-away Change/Disconnect menu, admin-gated) · smart views
 * ("All documents" = bound-folder root, "Needs my approval" with a count badge)
 * · "Folders" = a MIRROR of the real SharePoint subfolders of the bound folder
 * (we never invent fixed buckets). Clicking a folder navigates the center
 * browser into it.
 *
 * It does not own browse data beyond the rail's own needs; selection state
 * (active smart view + active folder) is controlled by DisciplineWorkspace.
 */

import { useMemo } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, FileStack, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDisciplineFolders } from "@/hooks/use-discipline-folders";
import { useDocumentChildren, type BrowseTarget } from "@/components/documents/use-documents";
import { DisciplineFolderMenu } from "@/components/documents/DisciplineFolderBinder";

export interface RailFolder {
  id: string;
  name: string;
}

interface Props {
  discipline: string;
  projectOptions: { id: number; name: string }[];
  projectsLoading: boolean;
  projectId: number | null;
  onProjectChange: (id: number) => void;

  /** "all" = root smart view; "approvals" = needs-my-approval. */
  activeView: "all" | "approvals";
  onSelectAllDocuments: () => void;
  onSelectApprovals: () => void;
  approvalsCount: number;

  /** Selected rail folder id (null = bound-folder root / "All documents"). */
  activeFolderId: string | null;
  onSelectFolder: (folder: RailFolder | null) => void;
}

export function DocumentRail({
  discipline,
  projectOptions,
  projectsLoading,
  projectId,
  onProjectChange,
  activeView,
  onSelectAllDocuments,
  onSelectApprovals,
  approvalsCount,
  activeFolderId,
  onSelectFolder,
}: Props) {
  const foldersQuery = useDisciplineFolders(projectId);

  const boundFolder = useMemo(
    () => (foldersQuery.data?.folders ?? []).find((f) => f.discipline === discipline) ?? null,
    [foldersQuery.data, discipline],
  );

  const target: BrowseTarget | null = useMemo(
    () => (projectId && boundFolder ? { kind: "discipline", projectId, discipline } : null),
    [projectId, boundFolder, discipline],
  );

  // The rail's folder list mirrors the real top-level SharePoint subfolders of
  // the bound folder root — not a fixed taxonomy.
  const rootChildren = useDocumentChildren(target, null);
  const subFolders = useMemo<RailFolder[]>(
    () =>
      (rootChildren.data?.items ?? [])
        .filter((i) => i.isFolder)
        .map((i) => ({ id: i.id, name: i.name })),
    [rootChildren.data],
  );

  const connected = !!boundFolder;

  return (
    <aside
      className="flex w-60 shrink-0 flex-col gap-1.5 border-r bg-muted/30 p-3"
      data-testid={`document-rail-${discipline}`}
    >
      {/* Project selector */}
      <Select
        value={projectId ? String(projectId) : ""}
        onValueChange={(v) => onProjectChange(Number(v))}
        disabled={projectsLoading}
      >
        <SelectTrigger
          className="h-9 bg-background font-medium"
          data-testid={`select-${discipline}-documents-project`}
        >
          <SelectValue placeholder={projectsLoading ? "Loading…" : "Choose a project"} />
        </SelectTrigger>
        <SelectContent>
          {projectOptions.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Connection indicator + tucked-away change/disconnect */}
      {projectId && (
        <div className="flex items-center gap-1.5 px-1 pb-1 pt-0.5 text-[11px]">
          {foldersQuery.isLoading ? (
            <Skeleton className="h-3 w-32" />
          ) : connected ? (
            <>
              <span className="flex items-center gap-1.5 text-emerald-700" data-testid="rail-connected">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Connected to SharePoint
              </span>
              <span className="ml-auto">
                <DisciplineFolderMenu projectId={projectId} discipline={discipline} />
              </span>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground" data-testid="rail-disconnected">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
              Not connected
            </span>
          )}
        </div>
      )}

      {/* Smart views */}
      <nav className="flex flex-col gap-0.5">
        <RailItem
          icon={<FileStack className="h-4 w-4" />}
          label="All documents"
          active={activeView === "all" && activeFolderId == null}
          onClick={onSelectAllDocuments}
          testId={`rail-view-all-${discipline}`}
        />
        <RailItem
          icon={<Clock className="h-4 w-4" />}
          label="Needs my approval"
          active={activeView === "approvals"}
          onClick={onSelectApprovals}
          badge={approvalsCount > 0 ? approvalsCount : undefined}
          testId={`rail-view-approvals-${discipline}`}
        />
      </nav>

      {/* Folders — mirror of real SharePoint subfolders */}
      {connected && (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Folders
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {rootChildren.isLoading ? (
              <div className="space-y-1 px-2">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
              </div>
            ) : subFolders.length === 0 ? (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">No subfolders.</div>
            ) : (
              subFolders.map((f) => (
                <RailItem
                  key={f.id}
                  icon={<Folder className="h-4 w-4" />}
                  label={f.name}
                  active={activeView === "all" && activeFolderId === f.id}
                  onClick={() => onSelectFolder(f)}
                  testId={`rail-folder-${f.id}`}
                  indent
                />
              ))
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function RailItem({
  icon,
  label,
  active,
  onClick,
  badge,
  testId,
  indent,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  testId?: string;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
        indent && "pl-3",
        active
          ? "bg-emerald-50 font-semibold text-emerald-700"
          : "text-foreground/80 hover:bg-muted",
      )}
      data-testid={testId}
    >
      <span className={cn("shrink-0", active ? "text-emerald-700" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge != null && (
        <span className="ml-auto rounded-full bg-amber-500 px-1.5 py-px text-[10.5px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
