/**
 * Shared KPI card — the single KPI tile (UI/UX audit X5).
 *
 * Calm, on-brand by default: neutral emerald-primary icon tile, foreground
 * value. Semantic tone (danger / warning / success) is opt-in and should
 * encode state, not decorate. Interactive cards render as a real, keyboard-
 * operable <button> (X4). Compact currency callers should pass `title` with
 * the exact figure (X2).
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export type KpiTone = "default" | "danger" | "warning" | "success";

const TONE_TILE: Record<KpiTone, string> = {
  default: "bg-primary/8 text-primary",
  danger: "bg-red-50 text-red-600",
  warning: "bg-amber-50 text-amber-600",
  success: "bg-emerald-50 text-emerald-600",
};
const TONE_VALUE: Record<KpiTone, string> = {
  default: "text-foreground",
  danger: "text-red-600",
  warning: "text-amber-700",
  success: "text-emerald-700",
};
const TONE_BORDER: Record<KpiTone, string> = {
  default: "",
  danger: "border-red-200",
  warning: "border-amber-200",
  success: "border-emerald-200",
};

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: KpiTone;
  /** Escape hatch for RAG-threshold value colouring; overrides tone's value colour. */
  valueClass?: string;
  /** Tooltip — use to expose the exact figure behind a compact currency value. */
  title?: string;
  /**
   * Screen-reader label for the value — TF-6 (audit V3). When value is a
   * pre-formatted money string ("R 1 234 567"), the visual contains
   * non-breaking spaces that most screen readers spell out digit-by-digit.
   * Pass `formatZarAriaLabel(rawNumber)` here so the spoken form is
   * "one million two hundred thirty-four thousand five hundred sixty-seven rand".
   * Falls back to silent value rendering when absent.
   */
  valueAriaLabel?: string;
  onClick?: () => void;
  className?: string;
  "data-testid"?: string;
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "default",
  valueClass,
  title,
  valueAriaLabel,
  onClick,
  className,
  "data-testid": testId,
}: KpiCardProps) {
  const interactive = typeof onClick === "function";

  return (
    <Card
      className={cn(
        "overflow-hidden shadow-sm transition-all",
        TONE_BORDER[tone],
        interactive && "hover:shadow-md focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
      data-testid={testId}
    >
      <CardContent className="p-0">
        {React.createElement(
          interactive ? "button" : "div",
          {
            ...(interactive
              ? { type: "button", onClick, "aria-label": `${label}: view details` }
              : {}),
            title,
            className: cn(
              "w-full text-left p-4 flex items-start gap-3",
              interactive && "cursor-pointer outline-none",
            ),
          },
          <>
            {icon && (
              <div
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                  TONE_TILE[tone],
                )}
              >
                {icon}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground truncate">
                {label}
              </p>
              <p
                className={cn("text-2xl font-bold tabular-nums leading-tight mt-0.5", valueClass || TONE_VALUE[tone])}
                {...(valueAriaLabel ? { "aria-label": valueAriaLabel } : {})}
              >
                {value}
              </p>
              {sub && <p className="text-xs text-muted-foreground mt-1 leading-snug">{sub}</p>}
            </div>
          </>,
        )}
      </CardContent>
    </Card>
  );
}
