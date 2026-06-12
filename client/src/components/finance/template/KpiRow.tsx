/**
 * <KpiRow> — the ONE KPI strip for the compact finance template.
 *
 * A responsive grid holding up to FOUR <KpiTile>s (the answer-first numbers
 * at the top of each finance screen). Caps at four by design: more than four
 * headline numbers stops being a headline. Pass <KpiTile> children.
 *
 *   <KpiRow>
 *     <KpiTile label="Revenue (FY)" value={<MoneyValue value={rev} />} />
 *     <KpiTile label="COS (FY)"     value={<MoneyValue value={cos} />} />
 *     <KpiTile label="GP (FY)"      value={<MoneyValue value={gp} />} />
 *     <KpiTile label="GP %"         value={`${pct}%`} />
 *   </KpiRow>
 */
import * as React from "react";
import { cn } from "@/lib/utils";

const COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

export interface KpiRowProps {
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function KpiRow({ children, className, "data-testid": testId }: KpiRowProps) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (process.env.NODE_ENV !== "production" && items.length > 4) {
    console.warn(
      `[KpiRow] received ${items.length} tiles; the compact template caps a KPI row at 4. ` +
        "Split into sections or move secondary numbers into the drill table.",
    );
  }
  const cols = COLS[Math.min(Math.max(items.length, 1), 4)] ?? COLS[4];
  return (
    <div
      className={cn("grid gap-3", cols, className)}
      data-testid={testId ?? "kpi-row"}
    >
      {items}
    </div>
  );
}
