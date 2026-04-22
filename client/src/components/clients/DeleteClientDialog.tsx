import { ConfirmDestructive } from "@/components/ui/confirm-destructive";
import { useDeleteImpact } from "@/hooks/use-delete-impact";

/**
 * Drop-in delete-client confirmation dialog.
 *
 * Same pattern as DeleteProjectDialog — pairs useDeleteImpact + the
 * ConfirmDestructive primitive. Client deletes are especially sensitive
 * because orphaned projects/sites/opportunities are a mess to recover
 * from, so the dialog shows each cascade with high severity.
 */
export interface DeleteClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  clientName: string;
  onDelete: () => Promise<void>;
}

export function DeleteClientDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  onDelete,
}: DeleteClientDialogProps) {
  const { data, isLoading } = useDeleteImpact("clients", clientId, open);

  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={onOpenChange}
      title="Delete client?"
      subject={data?.subject ?? clientName}
      description="Clients are referenced by projects, sites, and sales opportunities. Consider archiving instead — deleting breaks links."
      impact={data?.rows}
      impactLoading={isLoading}
      requireTypedConfirm
      actionVerb="Delete client"
      onConfirm={onDelete}
    />
  );
}
