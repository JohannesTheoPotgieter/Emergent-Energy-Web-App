/**
 * Discipline folder connect controls (browse-and-bind, reworked UX).
 *
 * The old prominent "binder card + duplicate file list" is gone. What remains
 * are two quiet, plumbing-hiding affordances that reuse the same bind/unbind
 * mutations + SharepointRootPicker:
 *
 *  - <DisciplineConnectEmptyState>  — centered empty state shown in the CENTER
 *    pane when no folder is bound for this discipline. Admin-gated
 *    (documents_provision); non-admins just see an explanatory message.
 *  - <DisciplineFolderMenu>         — compact "⋯" menu (Change folder /
 *    Disconnect) tucked in the left rail when a folder IS bound. Admin-gated.
 *
 * Both share the picker dialog via the internal usePicker hook. SharePoint
 * stays the source of truth — we only persist Graph references (driveId /
 * itemId / path / webUrl), never file bytes.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ExternalLink, FolderSymlink, MoreHorizontal, Plug, Unlink,
} from "lucide-react";
import { SharepointRootPicker, type PickedRoot } from "@/components/admin/SharepointRootPicker";
import { usePermission } from "@/hooks/use-permissions";
import { toast } from "@/hooks/use-toast";
import {
  useDisciplineFolders,
  useBindDisciplineFolder, useUnbindDisciplineFolder,
} from "@/hooks/use-discipline-folders";

/** Shared bind/unbind + picker wiring for the connect affordances. */
function useDisciplineConnect(projectId: number, discipline: string) {
  const bind = useBindDisciplineFolder();
  const unbind = useUnbindDisciplineFolder();
  const [pickerOpen, setPickerOpen] = useState(false);

  function handlePicked(picked: PickedRoot) {
    if (!picked.rootItemId) {
      toast({
        title: "Open the specific folder",
        description: "Navigate into the folder for this discipline, then choose “Use this folder”.",
        variant: "destructive",
      });
      return;
    }
    // Success / error toasts are handled by useApiMutation in the hook.
    bind.mutate({
      projectId,
      discipline,
      driveId: picked.driveId,
      itemId: picked.rootItemId,
      sharepointPath: picked.rootPath || null,
      webUrl: null,
    });
  }

  function handleUnbind() {
    unbind.mutate({ projectId, discipline });
  }

  return { bind, unbind, pickerOpen, setPickerOpen, handlePicked, handleUnbind };
}

/**
 * Centered empty state for an unbound discipline. Admin (documents_provision)
 * sees a Connect action that opens the SharePoint picker; everyone else sees a
 * plain "ask an admin" message.
 */
export function DisciplineConnectEmptyState({
  projectId,
  discipline,
}: {
  projectId: number;
  discipline: string;
}) {
  const { allowed: canProvision } = usePermission("documents_provision", "edit");
  const { bind, pickerOpen, setPickerOpen, handlePicked } = useDisciplineConnect(projectId, discipline);
  const label = discipline.toLowerCase();

  return (
    <div
      className="flex flex-1 items-center justify-center p-8"
      data-testid={`discipline-connect-empty-${discipline}`}
    >
      <div className="w-full max-w-md">
        <EmptyState
          icon={Plug}
          title="Connect this discipline's SharePoint folder"
          description={
            canProvision
              ? `Bind the SharePoint folder that holds this project's ${label} documents. SharePoint stays the source of truth — files are never copied here.`
              : `No SharePoint folder is connected for ${label} documents yet. Ask a document administrator to connect one.`
          }
          action={
            canProvision
              ? {
                  label: bind.isPending ? "Connecting…" : "Connect SharePoint folder",
                  onClick: () => setPickerOpen(true),
                }
              : undefined
          }
        />
      </div>
      {canProvision && (
        <SharepointRootPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={handlePicked} />
      )}
    </div>
  );
}

/**
 * Compact rail control for a bound discipline: "⋯" menu with Open in SharePoint,
 * Change folder, and Disconnect. Admin-gated; renders nothing for non-admins.
 */
export function DisciplineFolderMenu({
  projectId,
  discipline,
}: {
  projectId: number;
  discipline: string;
}) {
  const { allowed: canProvision } = usePermission("documents_provision", "edit");
  const foldersQuery = useDisciplineFolders(projectId);
  const { bind, unbind, pickerOpen, setPickerOpen, handlePicked, handleUnbind } =
    useDisciplineConnect(projectId, discipline);

  const current = useMemo(
    () => (foldersQuery.data?.folders ?? []).find((f) => f.discipline === discipline) ?? null,
    [foldersQuery.data, discipline],
  );

  if (!canProvision || !current) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            aria-label="Folder connection settings"
            disabled={bind.isPending || unbind.isPending}
            data-testid={`discipline-folder-menu-${discipline}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {current.webUrl && (
            <DropdownMenuItem asChild>
              <a href={current.webUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                Open in SharePoint
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => setPickerOpen(true)}
            data-testid={`bind-${discipline}-folder`}
          >
            <FolderSymlink className="mr-2 h-3.5 w-3.5" />
            Change folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={handleUnbind}
            data-testid={`unbind-${discipline}-folder`}
          >
            <Unlink className="mr-2 h-3.5 w-3.5" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SharepointRootPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={handlePicked} />
    </>
  );
}
