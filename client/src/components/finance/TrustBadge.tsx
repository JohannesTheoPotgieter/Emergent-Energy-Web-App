/**
 * TrustBadge — a small, reusable trust marker for any figure.
 *
 *   ties   → the figure reconciles to its source of truth (green).
 *   drift  → the figure differs from its source and needs review (amber).
 *   locked → the figure sits in a locked / signed accounting period (slate).
 *
 * Colour-blind-safe: every variant pairs a colour with an icon + word.
 * Colours come from the centralised status tokens (no hardcoded hex), so the
 * badge stays on-brand wherever it is dropped — KPI tiles, table rows, headers.
 *
 *   <TrustBadge status="ties" />
 *   <TrustBadge status="drift" label="3 need review" />
 *   <TrustBadge status="locked" />
 */
import { CheckCircle2, AlertTriangle, Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TrustStatus = "ties" | "drift" | "locked";

const TRUST_META: Record<TrustStatus, { label: string; icon: LucideIcon; chip: string; title: string }> = {
  ties: {
    label: "Ties",
    icon: CheckCircle2,
    chip: "border-status-ties/30 bg-status-ties/10 text-status-ties",
    title: "Reconciles to the source of truth.",
  },
  drift: {
    label: "Drift",
    icon: AlertTriangle,
    chip: "border-status-drift/40 bg-status-drift/10 text-status-drift",
    title: "Differs from the source of truth — needs review.",
  },
  locked: {
    label: "Locked",
    icon: Lock,
    chip: "border-status-locked/30 bg-status-locked/10 text-status-locked",
    title: "Figure sits in a locked / signed period.",
  },
};

export interface TrustBadgeProps {
  status: TrustStatus;
  /** Override the default word (e.g. "3 need review"). */
  label?: string;
  /** Override the hover title. */
  title?: string;
  className?: string;
}

export function TrustBadge({ status, label, title, className }: TrustBadgeProps) {
  const m = TRUST_META[status];
  const Icon = m.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-[10px] font-medium", m.chip, className)}
      data-testid={`trust-badge-${status}`}
      title={title ?? m.title}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label ?? m.label}
    </Badge>
  );
}
