/**
 * <MoneyValue> — the ONE money renderer for the compact finance template.
 *
 * Presentation-only wrapper over the canonical `<Money>` (`formatZar`): R,
 * thousands separators, whole-Rand ex-VAT by default, screen-reader aria-label.
 * Adds the template's house rules:
 *   - tabular figures + right-alignment (so columns line up),
 *   - negatives rendered in a MUTED red (token `text-rose-600`, not alarm-red),
 *   - absent / non-numeric → em dash (inherited from formatZar).
 *
 * It changes NO value — identical digits to `<Money>` / `formatZar`
 * (locked by qa/tests/unit/finance-money-format.test.ts).
 */
import * as React from "react";
import { Money, type MoneyProps } from "@/components/ui/money";
import { cn } from "@/lib/utils";

export interface MoneyValueProps extends MoneyProps {
  /** Right-align for table cells / KPI columns. Default true. */
  align?: "left" | "right";
  /** Mute negatives in red. Default true. */
  muteNegative?: boolean;
}

function isNegative(value: unknown): boolean {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n < 0;
}

export function MoneyValue({
  value,
  align = "right",
  muteNegative = true,
  className,
  ...rest
}: MoneyValueProps) {
  return (
    <Money
      value={value}
      className={cn(
        "tabular-nums",
        align === "right" ? "text-right" : "text-left",
        muteNegative && isNegative(value) && "text-rose-600",
        className,
      )}
      {...rest}
    />
  );
}
