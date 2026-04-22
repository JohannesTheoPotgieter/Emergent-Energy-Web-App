import { ConfirmDestructive } from "@/components/ui/confirm-destructive";
import { useDeleteImpact } from "@/hooks/use-delete-impact";

/**
 * Drop-in delete-controlled-document confirmation dialog.
 *
 * Controlled documents are normally soft-deleted (deletedAt set) via
 * the existing D3 flows. This dialog is for the rare hard-delete /
 * recall situation where a super user needs to remove a document
 * from the project entirely. Blast radius is high when the document
 * is the currently-approved version.
 */
export interface DeleteControlledDocDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: number;
  documentLabel: string;
  onDelete: () => Promise<void>;
}

export function DeleteControlledDocDialog({
  open,
  onOpenChange,
  documentId,
  documentLabel,
  onDelete,
}: DeleteControlledDocDialogProps) {
  const { data, isLoading } = useDeleteImpact("documents", documentId, open);

  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={onOpenChange}
      title="Delete controlled document?"
      subject={data?.subject ?? documentLabel}
      description="If this is the currently-approved version, the CEO home headline numbers and any handover packs referencing it will be affected. Consider recalling the approval instead of deleting."
      impact={data?.rows}
      impactLoading={isLoading}
      requireTypedConfirm
      actionVerb="Delete document"
      onConfirm={onDelete}
    />
  );
}
