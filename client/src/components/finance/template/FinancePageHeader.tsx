/**
 * <FinancePageHeader> — the ONE header for every compact finance screen.
 *
 * Layout (single row, wraps on narrow):
 *   [ title              ]            [ period selector ]
 *   [ question / subtitle]            [ source · as-of  ]
 *
 * - `title`     — the screen name ("Revenue", "Cost of Sales", …).
 * - `question`  — the plain-English question the screen answers
 *                 ("What have we recognised this FY vs target?").
 * - `period`    — slot for the FY / month / week selector (caller supplies the
 *                 existing FinancialYearScopeControl or a Select).
 * - `source`    — provenance line ("Canonical tracker · ex-VAT").
 * - `asOf`      — freshness ("as of 2 min ago").
 * - `actions`   — optional right-aligned actions (Export CSV, …).
 *
 * Tokens only, compact, sticky-friendly. Presentation-only — no data.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface FinancePageHeaderProps {
  title: React.ReactNode;
  question?: React.ReactNode;
  /** FY / month / week selector slot. */
  period?: React.ReactNode;
  /** Provenance line — e.g. "Canonical tracker · ex-VAT". */
  source?: React.ReactNode;
  /** Freshness — e.g. "as of 2 min ago". */
  asOf?: React.ReactNode;
  /** Optional right-aligned actions (export, etc.). */
  actions?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function FinancePageHeader({
  title,
  question,
  period,
  source,
  asOf,
  actions,
  className,
  "data-testid": testId,
}: FinancePageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-slate-200 pb-3 mb-4",
        className,
      )}
      data-testid={testId ?? "finance-page-header"}
    >
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 leading-tight">
          {title}
        </h1>
        {question && (
          <p className="text-sm text-slate-500 mt-0.5 max-w-prose">{question}</p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <div className="flex items-center gap-2">
          {period}
          {actions}
        </div>
        {(source || asOf) && (
          <p className="text-[11px] text-slate-400 text-right tabular-nums">
            {source}
            {source && asOf ? <span className="mx-1">·</span> : null}
            {asOf}
          </p>
        )}
      </div>
    </header>
  );
}
