import { ConfirmDestructive } from "@/components/ui/confirm-destructive";
import { useDeleteImpact } from "@/hooks/use-delete-impact";

/**
 * Drop-in delete-invoice confirmation dialog. Invoices sit at the
 * centre of the finance reconciliation chain — if a payment request
 * has been raised from the invoice, the cascade preview flags that as
 * high severity before the user commits.
 */
export interface DeleteInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: number;
  invoiceLabel: string; // e.g. "Invoice INV-001 — R 12,500"
  onDelete: () => Promise<void>;
}

export function DeleteInvoiceDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceLabel,
  onDelete,
}: DeleteInvoiceDialogProps) {
  const { data, isLoading } = useDeleteImpact("invoices", invoiceId, open);

  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={onOpenChange}
      title="Delete invoice?"
      subject={data?.subject ?? invoiceLabel}
      description="Invoices connect POs, payment requests and QuickBooks. Review the cascade — a payment already raised against this invoice will break if you delete."
      impact={data?.rows}
      impactLoading={isLoading}
      requireTypedConfirm
      actionVerb="Delete invoice"
      onConfirm={onDelete}
    />
  );
}
