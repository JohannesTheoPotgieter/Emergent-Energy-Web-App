/**
 * Visual redesign foundation — SectionCard.
 *
 * Hairline-bordered card wrapping a section of the page (a table, a
 * list, a chart). Renders with a header row carrying a title +
 * supporting metadata (`metaLeft`) on the left and actions / status
 * (`metaRight`) on the right. The body is whatever you pass as children.
 *
 *   <SectionCard
 *     title="Weekly ledger · 52 weeks"
 *     description="Showing 8 weeks · scroll for full year"
 *     metaRight={<LegendDot label="Actual" />}
 *   >
 *     <table>…</table>
 *   </SectionCard>
 *
 * Consistent header height + hairline border + no shadows. Replaces the
 * ad-hoc Card / CardHeader / CardContent combinations on the finance
 * surface.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionCardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Left side of the header — typically a short description. */
  metaLeft?: React.ReactNode;
  /** Right side of the header — legend, status, button(s). */
  metaRight?: React.ReactNode;
  /** Render the header at all. Default true. */
  withHeader?: boolean;
  /** Pad the body content. Default true. */
  padded?: boolean;
  /** Footer slot — renders below the body separated by a hairline. */
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  "data-testid"?: string;
  children: React.ReactNode;
}

export function SectionCard({
  title,
  description,
  metaLeft,
  metaRight,
  withHeader = true,
  padded = true,
  footer,
  className,
  bodyClassName,
  "data-testid": testId,
  children,
}: SectionCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-white overflow-hidden",
        className,
      )}
      data-testid={testId}
    >
      {withHeader && (title || description || metaLeft || metaRight) && (
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            {title && <p className="text-sm font-semibold">{title}</p>}
            {(description || metaLeft) && (
              <p className="text-[11px] text-slate-500 mt-0.5">{description ?? metaLeft}</p>
            )}
          </div>
          {metaRight && <div className="flex items-center gap-2 shrink-0">{metaRight}</div>}
        </div>
      )}
      <div className={cn(padded ? "p-4" : "", bodyClassName)}>{children}</div>
      {footer && (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5">{footer}</div>
      )}
    </div>
  );
}
