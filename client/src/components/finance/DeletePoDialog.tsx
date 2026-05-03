import { ConfirmDestructive } from "@/components/ui/confirm-destructive";
import { useDeleteImpact } from "@/hooks/use-delete-impact";

/**
 * Drop-in delete-PO confirmation dialog.
 *
 * Same shape as DeleteProjectDialog / DeleteClientDialog. Especially
 * important here because deleting a PO with a raised payment request
 * is high-risk (supplier expecting money) — the ConfirmDestructive
 * blast-radius display makes that immediately obvious.
 */
export interface DeletePoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poId: number;
  poLabel: string; // e.g. "PO-1234 — Supplier Co"
  onDelete: () => Promise<void>;
}

export function DeletePoDialog({
  open,
  onOpenChange,
  poId,
  poLabel,
  onDelete,
}: DeletePoDialogProps) {
  const { data, isLoading } = useDeleteImpact("purchase-orders", poId, open);

  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={onOpenChange}
      title="Delete purchase order?"
      subject={data?.subject ?? poLabel}
      description="Review the cascade carefully — if a supplier has already raised a payment request against this PO, deletion can break the reconciliation chain."
      impact={data?.rows}
      impactLoading={isLoading}
      requireTypedConfirm
      actionVerb="Delete PO"
      onConfirm={onDelete}
    />
  );
}
