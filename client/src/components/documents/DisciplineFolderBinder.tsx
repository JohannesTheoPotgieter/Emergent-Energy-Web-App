/**
 * DisciplineFolderBinder — browse-and-bind a project's SharePoint folder for a
 * discipline. Shows the currently-bound folder (if any) and, for users with
 * documents_provision rights, a Bind/Change control that opens the existing
 * SharePoint browser (SharepointRootPicker). Reusable across disciplines.
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, ExternalLink, FolderSymlink, FolderTree, Link2, Loader2, Unlink,
} from "lucide-react";
import { SharepointRootPicker, type PickedRoot } from "@/components/admin/SharepointRootPicker";
import { usePermission } from "@/hooks/use-permissions";
import { toast } from "@/hooks/use-toast";
import {
  useDisciplineFolders, useBindDisciplineFolder, useUnbindDisciplineFolder,
} from "@/hooks/use-discipline-folders";

export function DisciplineFolderBinder({
  projectId,
  discipline,
}: {
  projectId: number;
  discipline: string;
}) {
  const { allowed: canBind } = usePermission("documents_provision", "create");
  const { allowed: canUnbind } = usePermission("documents_provision", "delete");
  const foldersQuery = useDisciplineFolders(projectId);
  const bind = useBindDisciplineFolder();
  const unbind = useUnbindDisciplineFolder();
  const [pickerOpen, setPickerOpen] = useState(false);

  const current = useMemo(
    () => (foldersQuery.data?.folders ?? []).find((f) => f.discipline === discipline) ?? null,
    [foldersQuery.data, discipline],
  );

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

  // No binding and no rights to create one → render nothing (keep the page clean).
  if (!canBind && !current) return null;

  return (
    <Card data-testid={`discipline-folder-binder-${discipline}`}>
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        <FolderTree className="h-4 w-4 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">{discipline} document folder</div>
          {foldersQuery.isLoading ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          ) : current ? (
            <div
              className="truncate font-mono text-xs text-muted-foreground"
              title={current.sharepointPath ?? undefined}
            >
              {current.sharepointPath || "(folder bound)"}
            </div>
          ) : (
            <div className="flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle className="h-3 w-3" /> No folder bound yet.
            </div>
          )}
        </div>

        {current?.webUrl ? (
          <a
            href={current.webUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </a>
        ) : null}

        {canBind && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPickerOpen(true)}
            disabled={bind.isPending}
            data-testid={`bind-${discipline}-folder`}
          >
            {current ? (
              <><FolderSymlink className="mr-1.5 h-3.5 w-3.5" /> Change folder</>
            ) : (
              <><Link2 className="mr-1.5 h-3.5 w-3.5" /> Bind folder</>
            )}
          </Button>
        )}

        {current && canUnbind && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleUnbind}
            disabled={unbind.isPending}
            data-testid={`unbind-${discipline}-folder`}
          >
            <Unlink className="mr-1.5 h-3.5 w-3.5" /> Unbind
          </Button>
        )}
      </CardContent>

      <SharepointRootPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={handlePicked} />
    </Card>
  );
}
