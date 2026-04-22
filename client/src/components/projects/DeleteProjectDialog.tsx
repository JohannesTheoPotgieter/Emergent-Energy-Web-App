import { ConfirmDestructive } from "@/components/ui/confirm-destructive";
import { useDeleteImpact } from "@/hooks/use-delete-impact";

/**
 * Drop-in delete-project confirmation dialog.
 *
 * Pairs the D3/R3 foundations: calls /api/projects/:id/delete-impact
 * to fetch the cascade preview, then hands off to ConfirmDestructive
 * for the typed-confirmation UX. The caller supplies the actual
 * delete mutation via `onDelete`.
 *
 * Any list or detail page that exposes a project-delete button can
 * wrap this component without reimplementing the blast-radius logic.
 */
export interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectName: string;
  onDelete: () => Promise<void>;
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  onDelete,
}: DeleteProjectDialogProps) {
  const { data, isLoading } = useDeleteImpact("projects", projectId, open);

  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={onOpenChange}
      title="Delete project?"
      subject={data?.subject ?? projectName}
      description="This soft-deletes the project and cascades to its work items, approvals and controlled documents."
      impact={data?.rows}
      impactLoading={isLoading}
      requireTypedConfirm
      actionVerb="Delete project"
      onConfirm={onDelete}
    />
  );
}
