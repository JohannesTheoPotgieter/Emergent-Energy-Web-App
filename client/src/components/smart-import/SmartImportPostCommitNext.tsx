/**
 * Smart Import post-commit "what happens next" card (UX-3)
 *
 * Rendered on the result screen after a successful commit. Shows the
 * non-technical user the downstream effects their import just triggered
 * — stage readiness recalculating, finance syncing, task-owner
 * notifications fanning out. Kept deliberately short so it doesn't
 * crowd out the existing summary counts.
 */

import { Sparkles, Clock, RefreshCw, MailCheck } from "lucide-react";
import type { PlanningData, CommitResult } from "./types";

interface SmartImportPostCommitNextProps {
  planning?: PlanningData | null;
  commitResult?: CommitResult | null;
}

interface NextLine {
  key: string;
  testId: string;
  label: string;
  eta?: string;
  icon: React.ReactNode;
}

export function SmartImportPostCommitNext({
  planning,
  commitResult,
}: SmartImportPostCommitNextProps) {
  const counts = commitResult?.counts ?? {};
  const sections = planning?.sections ?? {};

  const planTouched =
    (counts.planTasks ?? 0) > 0 ||
    (sections.PLAN?.newCount ?? 0) + (sections.PLAN?.changedCount ?? 0) > 0;
  const revTouched =
    (counts.revenueLines ?? 0) > 0 ||
    (sections.REVENUE?.newCount ?? 0) + (sections.REVENUE?.changedCount ?? 0) > 0;
  const costTouched =
    (counts.costLines ?? 0) > 0 ||
    (sections.EXPENDITURE?.newCount ?? 0) + (sections.EXPENDITURE?.changedCount ?? 0) > 0;

  const lines: NextLine[] = [];
  if (planTouched) {
    lines.push({
      key: "stage-readiness",
      testId: "next-stage-readiness",
      label: "Stage readiness is being recalculated across this project.",
      eta: "Usually <1 minute",
      icon: <RefreshCw className="w-3.5 h-3.5 text-blue-700" />,
    });
    lines.push({
      key: "task-owner-notifications",
      testId: "next-task-notifications",
      label: "Task owners will see new date notifications in their inbox.",
      eta: "On next page load",
      icon: <MailCheck className="w-3.5 h-3.5 text-emerald-700" />,
    });
  }
  if (revTouched || costTouched) {
    lines.push({
      key: "quickbooks-sync",
      testId: "next-quickbooks-sync",
      label: "Finance values will sync with QuickBooks on the next scheduled run.",
      eta: "Within the hour",
      icon: <Clock className="w-3.5 h-3.5 text-blue-700" />,
    });
  }

  // Always-on reversibility note so the user knows they're still safe.
  lines.push({
    key: "undo-window",
    testId: "next-undo-window",
    label: "This import is logged. Contact the app owner within 7 days to roll it back.",
    icon: <Sparkles className="w-3.5 h-3.5 text-emerald-700" />,
  });

  return (
    <div
      className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 space-y-2"
      data-testid="post-commit-next"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-emerald-700" />
        <span className="text-sm font-semibold text-emerald-900">
          What happens next
        </span>
      </div>
      <ul className="space-y-1.5 text-sm text-emerald-900">
        {lines.map((line) => (
          <li
            key={line.key}
            data-testid={line.testId}
            className="flex items-start gap-2"
          >
            <span className="mt-0.5 flex-shrink-0">{line.icon}</span>
            <div className="flex-1">
              <div>{line.label}</div>
              {line.eta && (
                <div className="text-xs text-emerald-800/80">{line.eta}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
