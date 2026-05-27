/**
 * <Money> — accessibility-aware ZAR money display. TF-6 (audit V3).
 *
 * Renders the canonical `formatZar` visual form and pairs it with a
 * screen-reader-friendly `aria-label` so blind users hear
 * "one million two hundred thirty-four thousand five hundred sixty-seven rand"
 * instead of "R one two three four five six seven".
 *
 * Use for every money value on a finance dashboard / tile / table cell
 * unless the surrounding element already exposes the value through a
 * different a11y channel (e.g. a chart that supplies its own aria-label).
 */
import * as React from "react";
import { formatZar, formatZarAriaLabel, type FormatZarOptions } from "@/lib/currency";

export interface MoneyProps extends FormatZarOptions {
  value: unknown;
  /** Optional className forwarded to the rendered <span>. */
  className?: string;
  /** Optional aria-label override; defaults to the spoken form. */
  ariaLabel?: string;
  /** Optional title attribute. Defaults to the precise formatZar value. */
  title?: string;
  "data-testid"?: string;
}

export function Money({
  value,
  cents,
  showSign,
  placeholder,
  className,
  ariaLabel,
  title,
  "data-testid": testId,
}: MoneyProps) {
  const visual = formatZar(value, { cents, showSign, placeholder });
  const spoken = ariaLabel ?? formatZarAriaLabel(value, { cents });
  return (
    <span
      className={className}
      aria-label={spoken}
      title={title ?? visual}
      data-testid={testId}
    >
      {visual}
    </span>
  );
}
