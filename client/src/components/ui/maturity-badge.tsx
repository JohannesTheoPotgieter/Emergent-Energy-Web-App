import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * MaturityBadge — small, consistent pill that tells a user a surface is
 * not production-finished yet.
 *
 * Use this anywhere we ship a UI that is useful but not complete, rather
 * than letting it sit in the app pretending to be finished. This is NOT
 * an "AI"/"Smart"/"Pro" marker — those words overstate maturity and are
 * explicitly banned from the codebase.
 *
 * Levels
 * ------
 * - `internal`   — internal tooling / not yet ready for general users.
 *                  Rendered as a subdued grey pill so it does not shout.
 * - `preview`    — early access, no guarantees on data or UX stability.
 * - `beta`       — feature is close to done but still collecting feedback.
 *
 * All variants render with a calm, factual tone (no scary red, no green
 * "LIVE" celebration). Pair with a tooltip or helper text when the user
 * needs more context.
 */
export type MaturityLevel = "internal" | "preview" | "beta";

interface MaturityBadgeProps {
  level: MaturityLevel;
  className?: string;
  label?: string; // optional override if the default word is not precise
}

const LABELS: Record<MaturityLevel, string> = {
  internal: "Internal",
  preview: "Preview",
  beta: "Beta",
};

const VARIANTS: Record<MaturityLevel, "secondary" | "info" | "warning"> = {
  internal: "secondary",
  preview: "info",
  beta: "warning",
};

export function MaturityBadge({ level, className, label }: MaturityBadgeProps) {
  return (
    <Badge
      variant={VARIANTS[level]}
      className={cn("uppercase tracking-wide text-[9px] font-semibold", className)}
      data-testid={`maturity-badge-${level}`}
    >
      {label ?? LABELS[level]}
    </Badge>
  );
}
