/**
 * Smart Import schedule-impact card (UX-2)
 *
 * Displayed at the top of the "What changed" step, BEFORE the per-
 * section row counts. Answers the non-technical user's first question:
 *
 *   "Will this import shift my project's dates?"
 *
 * Inputs come from the planning payload. When the PLAN section is
 * absent (e.g. revenue-only upload) the component renders nothing —
 * the per-section summary already covers non-plan uploads.
 *
 * Cheap variant: we summarise the *new* plan's schedule window. We do
 * NOT compute critical-path deltas here — that needs backend support
 * for predecessor graphs. A future UX-2b PR can upgrade this with
 * before/after comparison once the planner exposes a diff of dates.
 */

import { CalendarDays, Flag, TrendingUp } from "lucide-react";

interface PlanRow {
  isMilestone?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  classification?: string;
}

interface ScheduleImpactProps {
  planning: any | null;
}

function safeDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export function SmartImportScheduleImpact({ planning }: ScheduleImpactProps) {
  const planRows: PlanRow[] = planning?.sections?.PLAN?.rows ?? [];
  if (!Array.isArray(planRows) || planRows.length === 0) return null;

  const startDates = planRows.map((r) => safeDate(r.startDate)).filter((d): d is Date => d != null);
  const endDates = planRows.map((r) => safeDate(r.endDate)).filter((d): d is Date => d != null);
  if (startDates.length === 0 && endDates.length === 0) return null;

  const earliest = startDates.length > 0
    ? new Date(Math.min(...startDates.map((d) => d.getTime())))
    : null;
  const latest = endDates.length > 0
    ? new Date(Math.max(...endDates.map((d) => d.getTime())))
    : null;

  const milestones = planRows.filter((r) => r.isMilestone);
  const newMilestones = milestones.filter((r) => r.classification === "NEW");
  const changedMilestones = milestones.filter((r) => r.classification === "CHANGED");

  // Flag schedule slippage when the latest end date is after the plan
  // cutoff (if available). If no cutoff is supplied we just surface the
  // new window so the user can sanity-check it.
  const cutoff = safeDate(planning?.projectSchedule?.plannedEnd);
  const slipsOut = cutoff && latest && latest.getTime() > cutoff.getTime();

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3" data-testid="schedule-impact">
      <div className="flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-blue-700" />
        <span className="text-sm font-semibold text-foreground">Schedule impact</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        {earliest && (
          <div className="rounded-md bg-card border border-border p-3" data-testid="schedule-start">
            <p className="text-xs text-muted-foreground">Earliest start</p>
            <p className="text-base font-semibold text-foreground">{fmt(earliest)}</p>
          </div>
        )}
        {latest && (
          <div
            className={`rounded-md border p-3 ${slipsOut ? "bg-amber-50 border-amber-300" : "bg-card border-border"}`}
            data-testid="schedule-end"
          >
            <p className="text-xs text-muted-foreground">Latest end</p>
            <p className="text-base font-semibold text-foreground">{fmt(latest)}</p>
            {slipsOut && cutoff && (
              <p className="text-xs text-amber-800 mt-0.5" data-testid="schedule-slip-warning">
                Shifts past planned end ({fmt(cutoff)})
              </p>
            )}
          </div>
        )}
        <div className="rounded-md bg-card border border-border p-3" data-testid="schedule-milestones">
          <div className="flex items-center gap-1.5">
            <Flag className="w-3.5 h-3.5 text-emerald-700" />
            <p className="text-xs text-muted-foreground">Milestones</p>
          </div>
          <p className="text-base font-semibold text-foreground">{milestones.length}</p>
          {(newMilestones.length > 0 || changedMilestones.length > 0) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {newMilestones.length > 0 && <>+{newMilestones.length} new</>}
              {newMilestones.length > 0 && changedMilestones.length > 0 && " · "}
              {changedMilestones.length > 0 && <>{changedMilestones.length} changed</>}
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <TrendingUp className="w-3 h-3" />
        Schedule window is computed from the uploaded plan. Predecessor ripples will be applied on commit.
      </p>
    </div>
  );
}
