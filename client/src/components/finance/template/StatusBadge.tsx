/**
 * <StatusBadge> — the ONE status chip for the compact finance template.
 *
 * Always pairs a colour with an ICON + WORD, never colour-only (a11y /
 * colour-blind safe). Tones map to brand/status tokens — no raw hex.
 *
 *   <StatusBadge tone="ties" label="Ties" />
 *   <StatusBadge tone="warning" label="3 need review" />
 *   <StatusBadge tone="neutral" icon={Lock} label="Locked" />
 *
 * For the specific tracker-vs-source trust marker keep using <TrustBadge>
 * (ties / drift / locked); this is the general-purpose chip for everything
 * else (status columns, match coverage, AR/AP buckets, …).
 */
import * as React from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone =
  | "neutral"
  | "positive"
  | "ties"
  | "warning"
  | "critical"
  | "info"
  | "pending";

const TONE_META: Record<StatusTone, { chip: string; icon: LucideIcon }> = {
  neutral: { chip: "border-slate-200 bg-slate-50 text-slate-600", icon: Info },
  positive: { chip: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  ties: { chip: "border-status-ties/30 bg-status-ties/10 text-status-ties", icon: CheckCircle2 },
  warning: { chip: "border-amber-200 bg-amber-50 text-amber-700", icon: AlertTriangle },
  critical: { chip: "border-rose-200 bg-rose-50 text-rose-700", icon: XCircle },
  info: { chip: "border-sky-200 bg-sky-50 text-sky-700", icon: Info },
  pending: { chip: "border-slate-200 bg-slate-50 text-slate-500", icon: Clock },
};

export interface StatusBadgeProps {
  tone: StatusTone;
  label: React.ReactNode;
  /** Override the default tone icon. Pass null to hide the icon (rare). */
  icon?: LucideIcon | null;
  title?: string;
  className?: string;
  "data-testid"?: string;
}

export function StatusBadge({
  tone,
  label,
  icon,
  title,
  className,
  "data-testid": testId,
}: StatusBadgeProps) {
  const meta = TONE_META[tone];
  const Icon = icon === null ? null : (icon ?? meta.icon);
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-[10px] font-medium", meta.chip, className)}
      title={title}
      data-testid={testId ?? `status-badge-${tone}`}
    >
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {label}
    </Badge>
  );
}
