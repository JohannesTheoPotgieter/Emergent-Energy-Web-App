/**
 * Smart Import plan narrative (UX-2)
 *
 * Renders a one-paragraph plain-English summary at the top of the
 * "What we found" step for the project-plan case. Answers:
 *   - How many rows did we read?
 *   - Across how many phases / milestones?
 *   - What date range does the plan span?
 *   - Are there any tasks missing an owner?
 *
 * Degrades gracefully: if the upload has no PLAN section, the component
 * renders a generic non-plan narrative so the step still opens with
 * prose instead of a table.
 */

import { BookOpen } from "lucide-react";
import { SECTION_LABELS } from "./labels";

interface PlanRow {
  isMilestone?: boolean;
  parentTaskNo?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  owner?: string | null;
  pctComplete?: number | null;
}

interface SmartImportPlanNarrativeProps {
  planning: any | null;
  preview?: any | null;
}

function safeDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function approximateSpanMonths(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24 * 30));
}

export function SmartImportPlanNarrative({ planning, preview }: SmartImportPlanNarrativeProps) {
  const planRows: PlanRow[] = planning?.sections?.PLAN?.rows ?? preview?.normalization?.planTasks ?? [];
  const hasPlan = Array.isArray(planRows) && planRows.length > 0;

  if (!hasPlan) {
    // Generic fallback narrative when there's no plan section (e.g. a
    // revenue-only or expenditure-only upload).
    const sectionNames = planning?.sections
      ? Object.keys(planning.sections).filter((k) => planning.sections[k])
      : [];
    const labels = sectionNames.map((k) => SECTION_LABELS[k] || k);
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex gap-3" data-testid="plan-narrative">
        <BookOpen className="w-4 h-4 mt-0.5 text-blue-700 flex-shrink-0" />
        <p className="text-sm text-blue-900">
          Here's what we read from your file:
          {" "}
          {labels.length > 0
            ? <>you have <strong>{labels.join(" and ")}</strong> data in this upload.</>
            : <>nothing recognisable yet — open the advanced details below to see what we tried.</>
          }
        </p>
      </div>
    );
  }

  const totalRows = planRows.length;
  const milestones = planRows.filter((r) => r.isMilestone);
  const subtasks = planRows.filter((r) => r.parentTaskNo);
  const phases = totalRows - subtasks.length; // top-level items (not indented under a parent)
  const noOwner = planRows.filter((r) => !r.owner).length;
  const allCompleted = planRows.filter((r) => (r.pctComplete ?? 0) >= 100).length;

  const startDates = planRows.map((r) => safeDate(r.startDate)).filter((d): d is Date => d != null);
  const endDates = planRows.map((r) => safeDate(r.endDate)).filter((d): d is Date => d != null);
  const earliest = startDates.length > 0
    ? new Date(Math.min(...startDates.map((d) => d.getTime())))
    : null;
  const latest = endDates.length > 0
    ? new Date(Math.max(...endDates.map((d) => d.getTime())))
    : null;
  const spanMonths = earliest && latest ? approximateSpanMonths(earliest, latest) : null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-1.5" data-testid="plan-narrative">
      <div className="flex items-start gap-2">
        <BookOpen className="w-4 h-4 mt-0.5 text-blue-700 flex-shrink-0" />
        <p className="text-sm text-blue-900 leading-relaxed">
          We found{" "}
          <strong>{phases} phase{phases === 1 ? "" : "s"}</strong>
          {milestones.length > 0 && (
            <>, <strong>{milestones.length} milestone{milestones.length === 1 ? "" : "s"}</strong></>
          )}
          {", "}
          <strong>{totalRows} row{totalRows === 1 ? "" : "s"}</strong>
          {earliest && latest && (
            <>
              {" — spanning "}
              <strong>{formatDate(earliest)}</strong>
              {" to "}
              <strong>{formatDate(latest)}</strong>
              {spanMonths != null && spanMonths > 0 && ` (~${spanMonths} months)`}
            </>
          )}
          .
        </p>
      </div>
      {(allCompleted > 0 || noOwner > 0) && (
        <ul className="pl-9 text-xs text-blue-900/90 space-y-0.5">
          {allCompleted > 0 && (
            <li data-testid="plan-narrative-completed">
              {allCompleted} task{allCompleted === 1 ? " is" : "s are"} already marked 100% complete.
            </li>
          )}
          {noOwner > 0 && (
            <li data-testid="plan-narrative-no-owner">
              {noOwner} task{noOwner === 1 ? " is" : "s are"} missing an owner.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
