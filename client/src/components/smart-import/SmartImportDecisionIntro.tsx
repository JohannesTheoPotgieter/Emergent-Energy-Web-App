/**
 * Smart Import decision intro (UX-3)
 *
 * Plain-English intro card rendered at the top of the Decision step.
 * The existing decision grid is a dense table built for operators;
 * this card re-frames the work for non-technical users with a short
 * sentence pattern and a tally of how many decisions involve
 * protected / predecessor-impacting rows.
 */

import { AlertTriangle, Shield, GitBranch } from "lucide-react";

interface SmartImportDecisionIntroProps {
  pendingCount: number;
  totalCount: number;
  /** Count of conflicts on rows that are linked to QuickBooks. */
  qbLinkedCount?: number;
  /** Count of conflicts on tasks that have downstream predecessors. */
  predecessorImpactCount?: number;
}

export function SmartImportDecisionIntro({
  pendingCount,
  totalCount,
  qbLinkedCount = 0,
  predecessorImpactCount = 0,
}: SmartImportDecisionIntroProps) {
  if (totalCount === 0) return null;
  const resolvedCount = totalCount - pendingCount;

  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2"
      data-testid="decision-intro"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-900 leading-relaxed">
          <p>
            We found <strong>{totalCount} item{totalCount === 1 ? "" : "s"}</strong>{" "}
            where your spreadsheet and the app disagree. For each one, tell us
            which value is right — or pick &ldquo;Keep all app&rdquo; /
            &ldquo;Use all uploaded&rdquo; to apply the same choice to everything.
          </p>
          {resolvedCount > 0 && (
            <p className="text-xs text-amber-800 mt-1">
              <strong>{resolvedCount}</strong> already decided,
              {" "}<strong>{pendingCount}</strong> to go.
            </p>
          )}
        </div>
      </div>

      {(qbLinkedCount > 0 || predecessorImpactCount > 0) && (
        <ul className="text-xs text-amber-900 pl-6 space-y-1">
          {qbLinkedCount > 0 && (
            <li className="flex items-start gap-1.5" data-testid="decision-intro-qb">
              <Shield className="w-3 h-3 mt-0.5 text-amber-700 flex-shrink-0" />
              <span>
                {qbLinkedCount} of these are on rows linked to QuickBooks — your
                choice here won&rsquo;t override the QuickBooks value on commit.
              </span>
            </li>
          )}
          {predecessorImpactCount > 0 && (
            <li className="flex items-start gap-1.5" data-testid="decision-intro-predecessor">
              <GitBranch className="w-3 h-3 mt-0.5 text-amber-700 flex-shrink-0" />
              <span>
                {predecessorImpactCount} of these are on tasks that other tasks
                depend on — dates may re-ripple after commit.
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
