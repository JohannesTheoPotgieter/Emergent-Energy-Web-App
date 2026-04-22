import { ConfirmDestructive } from "@/components/ui/confirm-destructive";
import { useDeleteImpact } from "@/hooks/use-delete-impact";

/**
 * Drop-in delete-work-item confirmation dialog.
 *
 * Work items have several cascade children (comments, checklists,
 * attachments, deliverables, assignments, dependencies). The preview
 * flags high severity when other work items depend on this one.
 */
export interface DeleteWorkItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItemId: number;
  workItemTitle: string;
  onDelete: () => Promise<void>;
}

export function DeleteWorkItemDialog({
  open,
  onOpenChange,
  workItemId,
  workItemTitle,
  onDelete,
}: DeleteWorkItemDialogProps) {
  const { data, isLoading } = useDeleteImpact("work-items", workItemId, open);

  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={onOpenChange}
      title="Delete work item?"
      subject={data?.subject ?? workItemTitle}
      description="Work items have attached comments, checklists, and assignees. Dependent items will break if you delete."
      impact={data?.rows}
      impactLoading={isLoading}
      requireTypedConfirm={false}
      actionVerb="Delete"
      onConfirm={onDelete}
    />
  );
}
