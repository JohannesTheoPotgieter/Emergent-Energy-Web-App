/**
 * Budget-progress card for the finance tracker pages (Revenue / COS / GP).
 *
 * Shows the FY budget target and, for each supplied pipeline figure (typically
 * Planned and Realised), a labelled progress bar of that figure against budget
 * with the % consumed. Presentation only — every value is passed in already
 * computed; no finance figure is derived here.
 *
 * `overIsGood` flips the over-budget colour: for COS, spending over budget is
 * adverse (amber); for Revenue / GP, exceeding the target is favourable (the
 * bar stays emerald).
 */
import { MoneyValue } from "@/components/finance/template";
import { cn } from "@/lib/utils";

export interface BudgetProgressRow {
  label: string;
  value: number;
}

export interface BudgetProgressCardProps {
  budget: number;
  rows: BudgetProgressRow[];
  /** When true, a figure exceeding budget is favourable (Revenue/GP). Default false (COS). */
  overIsGood?: boolean;
  title?: string;
  "data-testid"?: string;
}

export function BudgetProgressCard({
  budget,
  rows,
  overIsGood = false,
  title = "Budget tracking · FY",
  "data-testid": testId,
}: BudgetProgressCardProps) {
  const hasBudget = budget > 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid={testId ?? "budget-progress"}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{title}</p>
        <p className="text-sm font-semibold tabular-nums text-slate-900">
          Budget <MoneyValue value={budget} />
        </p>
      </div>
      {!hasBudget ? (
        <p className="mt-2 text-xs text-slate-500">No budget captured for this period yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {rows.map((r) => {
            const pct = (r.value / budget) * 100;
            const over = pct > 100;
            return (
              <div key={r.label} data-testid={`budget-progress-${r.label.toLowerCase()}`}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-slate-700">{r.label} vs Budget</span>
                  <span className="tabular-nums text-slate-500">
                    <MoneyValue value={r.value} /> · {Math.round(pct)}%
                  </span>
                </div>
                <div className="mt-1 h-2 rounded bg-slate-100">
                  <div
                    className={cn("h-2 rounded", over && !overIsGood ? "bg-amber-500" : "bg-emerald-600")}
                    style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
