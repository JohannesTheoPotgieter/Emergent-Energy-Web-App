/**
 * Visual redesign foundation — PageHero.
 *
 * The single-answer card at the top of every redesigned finance page.
 * One headline label, one big number, one supporting line, and an
 * optional trust-facts column on the right that pins provenance
 * (last updated, source layer, drift, exceptions).
 *
 * Philosophy: TRUTH means every headline carries its provenance;
 * CLEAR means there is one number the eye lands on; SIMPLE means a
 * single layout regardless of the page.
 *
 *   <PageHero
 *     label="Forecast end-of-FY bank position"
 *     value={<Money value={8240000} />}
 *     supporting={<>vs. budget R 7.5M · <span className="text-emerald-700">+9.9%</span></>}
 *     trust={[
 *       { label: "Updated", value: "2 min ago" },
 *       { label: "Source", value: "canonical layer" },
 *       { label: "Drift vs QB", value: "±R 12" },
 *     ]}
 *   />
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type PageHeroTone = "default" | "positive" | "warning" | "critical";

const TONE_VALUE: Record<PageHeroTone, string> = {
  default: "text-slate-900",
  positive: "text-emerald-700",
  warning: "text-amber-700",
  critical: "text-rose-700",
};

export interface PageHeroTrustFact {
  label: string;
  value: React.ReactNode;
  /** Optional tone override per fact (e.g. an exception count rendered amber). */
  tone?: PageHeroTone;
}

export interface PageHeroProps {
  /** Eyebrow / breadcrumb label above the title — small, uppercase. */
  eyebrow?: React.ReactNode;
  /** Caption above the value — small, uppercase tracking. */
  label: React.ReactNode;
  /** The single number — typically a <Money> or a JSX expression. */
  value: React.ReactNode;
  /** Supporting line below the value — vs. budget / vs. prior / 62% of plan etc. */
  supporting?: React.ReactNode;
  /** Tone for the value text. Use sparingly — keep most pages "default". */
  tone?: PageHeroTone;
  /** Optional trust column — label / value pairs pinned to the right. */
  trust?: PageHeroTrustFact[];
  /** Optional action(s) — e.g. "Export CSV" — top-right. */
  actions?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function PageHero({
  eyebrow,
  label,
  value,
  supporting,
  tone = "default",
  trust,
  actions,
  className,
  "data-testid": testId,
}: PageHeroProps) {
  return (
    <div
      className={cn("rounded-lg border border-slate-200 bg-white p-6", className)}
      data-testid={testId ?? "page-hero"}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[11px] uppercase tracking-wider text-emerald-700 font-medium">
              {eyebrow}
            </p>
          )}
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mt-1">
            {label}
          </p>
          <p className={cn("mt-2 text-4xl font-bold tracking-tight tabular-nums leading-none", TONE_VALUE[tone])}>
            {value}
          </p>
          {supporting && (
            <p className="mt-2 text-sm text-slate-500">{supporting}</p>
          )}
        </div>
        <div className="flex items-start gap-4 shrink-0">
          {trust && trust.length > 0 && (
            <div className="text-right text-[12px] text-slate-600 space-y-0.5" data-testid="page-hero-trust">
              {trust.map((fact, i) => (
                <p key={i} className="flex items-baseline justify-end gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400">{fact.label}</span>
                  <span className={cn(fact.tone ? TONE_VALUE[fact.tone] : "text-slate-700")}>{fact.value}</span>
                </p>
              ))}
            </div>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
