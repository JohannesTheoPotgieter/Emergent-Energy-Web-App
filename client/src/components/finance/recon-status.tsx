/**
 * Reconciliation status presentation — shared by the Reconciliation Board
 * (finance-reconciliation-board.tsx) and the Finance Home per-project health
 * list. One definition, colour-blind-safe (icon + word always paired).
 *
 * Colours come from the centralised brand/status tokens — no hardcoded hex.
 * `accent` (a CSS-var string) is for the few inline-style needs (left border,
 * delta text colour); `chip` is the Tailwind utility set for the badge.
 */
import { CheckCircle2, AlertTriangle, AlertOctagon, HelpCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { figureStatus, brand } from "@/design/tokens";
import { cn } from "@/lib/utils";

export type ReconDisplayStatus = "green" | "amber" | "red" | "unknown";

export interface ReconStatusMeta {
  label: string;
  icon: LucideIcon;
  /** Tailwind utility classes for the badge (border + bg + text). */
  chip: string;
  /** CSS-var colour string for inline styles (left border / delta text). */
  accent: string;
  meaning: string;
}

export const RECON_STATUS_META: Record<ReconDisplayStatus, ReconStatusMeta> = {
  green: {
    label: "Ties",
    icon: CheckCircle2,
    chip: "border-status-ties/30 bg-status-ties/10 text-status-ties",
    accent: figureStatus.ties,
    meaning: "App ties to the tracker within R1.",
  },
  amber: {
    label: "Drift",
    icon: AlertTriangle,
    chip: "border-amber-300 bg-amber-50 text-amber-800",
    accent: figureStatus.drift,
    meaning: "Pasted tracker value drifts from the §3.3 formula.",
  },
  red: {
    label: "Structural",
    icon: AlertOctagon,
    chip: "border-red-300 bg-red-50 text-red-700",
    accent: figureStatus.adverse,
    meaning: "A line cannot be reconciled (missing/invalid allocation).",
  },
  unknown: {
    label: "No data",
    icon: HelpCircle,
    chip: "border-brand-muted/40 bg-brand-muted/10 text-brand-text",
    accent: brand.lightSlate,
    meaning: "No reconciliation has been computed for this project yet.",
  },
};

/** Attention rank — lower sorts first (red → amber → unknown → green). */
export const RECON_STATUS_RANK: Record<ReconDisplayStatus, number> = {
  red: 0,
  amber: 1,
  unknown: 2,
  green: 3,
};

export function ReconStatusChip({
  status,
  className,
}: {
  status: ReconDisplayStatus;
  className?: string;
}) {
  const m = RECON_STATUS_META[status];
  const Icon = m.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-xs font-medium", m.chip, className)}
      data-testid={`recon-status-${status}`}
      title={m.meaning}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {m.label}
    </Badge>
  );
}
