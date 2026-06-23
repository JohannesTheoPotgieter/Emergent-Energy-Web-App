/**
 * SettlementStatusBadge — a compact, business-facing status chip for an
 * invoice/payment line (Paid / Invoiced / Planned, split by the tracker's
 * colour-confirmation signal). Presentation only; see
 * `@/lib/finance/settlement-status` for the derivation.
 */
import { Badge } from "@/components/ui/badge";
import { deriveSettlementStatus, type SettlementStatusInput, type SettlementTone } from "@/lib/finance/settlement-status";

const TONE_CLASS: Record<SettlementTone, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-300",
  invoiced: "bg-sky-50 text-sky-700 border-sky-300",
  pending: "bg-amber-50 text-amber-700 border-amber-300",
  planned: "bg-slate-50 text-slate-600 border-slate-300",
};

export function SettlementStatusBadge({ line }: { line: SettlementStatusInput }) {
  const status = deriveSettlementStatus(line);
  return (
    <Badge
      variant="outline"
      className={`text-[10px] whitespace-nowrap cursor-default ${TONE_CLASS[status.tone]}`}
      title={status.title}
      aria-label={status.title}
      data-testid={`settlement-status-${status.key}`}
    >
      {status.label}
    </Badge>
  );
}
