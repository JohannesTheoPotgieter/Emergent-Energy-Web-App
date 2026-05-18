/**
 * Smart Import downstream-impact card (UX-3)
 *
 * Rendered on the Confirm step just before the commit button. Answers
 * the question "who else will see this change?" so a non-technical
 * user knows whether to flag it to anyone downstream before they click.
 *
 * We derive the affected surfaces from counts on the planning payload:
 *   - PLAN rows > 0           → Program dashboard + Engineering Today list
 *   - REVENUE rows > 0        → Finance Revenue view
 *   - EXPENDITURE rows > 0    → Finance Costs view, QB reconciliation
 * Construction Teams ping stays amber/noop by design — the flow
 * deliberately does not fire Teams notifications automatically.
 */

import { Users, Bell, ShieldAlert } from "lucide-react";
import { SECTION_LABELS } from "./labels";
import type { PlanningData } from "./types";

interface SmartImportDownstreamImpactProps {
  planning: PlanningData | null;
  projectName?: string | null;
}

interface SurfaceLine {
  key: string;
  testId: string;
  label: string;
  note?: string;
  tone: "active" | "passive";
}

export function SmartImportDownstreamImpact({
  planning,
  projectName,
}: SmartImportDownstreamImpactProps) {
  const sections = planning?.sections ?? {};
  const lines: SurfaceLine[] = [];

  const planTotal =
    (sections.PLAN?.newCount || 0) +
    (sections.PLAN?.changedCount || 0) +
    (sections.PLAN?.missingFromUploadCount || 0);
  const revTotal =
    (sections.REVENUE?.newCount || 0) +
    (sections.REVENUE?.changedCount || 0) +
    (sections.REVENUE?.missingFromUploadCount || 0);
  const costTotal =
    (sections.EXPENDITURE?.newCount || 0) +
    (sections.EXPENDITURE?.changedCount || 0) +
    (sections.EXPENDITURE?.missingFromUploadCount || 0);

  if (planTotal > 0) {
    lines.push({
      key: "plan-dashboard",
      testId: "downstream-plan-dashboard",
      label: "Program Manager dashboard",
      note: "Refreshes within ~30 seconds of commit.",
      tone: "active",
    });
    lines.push({
      key: "plan-today",
      testId: "downstream-plan-today",
      label: "Engineering Today list",
      note: "Task-owner notifications fire after commit.",
      tone: "active",
    });
  }
  if (revTotal > 0) {
    lines.push({
      key: "revenue-finance",
      testId: "downstream-revenue",
      label: `${SECTION_LABELS.REVENUE} view in Finance`,
      tone: "active",
    });
  }
  if (costTotal > 0) {
    lines.push({
      key: "cost-finance",
      testId: "downstream-costs",
      label: `${SECTION_LABELS.EXPENDITURE} view in Finance`,
      note: "QuickBooks reconciliation runs on next scheduled sync.",
      tone: "active",
    });
  }
  lines.push({
    key: "construction-teams",
    testId: "downstream-construction",
    label: "Construction team Teams channel",
    note: "No automatic ping — share manually if needed.",
    tone: "passive",
  });

  return (
    <div
      className="rounded-lg border border-border bg-muted/30 p-4 space-y-2"
      data-testid="downstream-impact"
    >
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-blue-700" />
        <span className="text-sm font-semibold text-foreground">
          Who else will see this change
        </span>
      </div>
      {projectName && (
        <p className="text-xs text-muted-foreground">
          Applies to <strong>{projectName}</strong>.
        </p>
      )}
      <ul className="space-y-1.5 text-sm">
        {lines.map((line) => (
          <li
            key={line.key}
            data-testid={line.testId}
            className="flex items-start gap-2"
          >
            {line.tone === "active" ? (
              <Bell className="w-3.5 h-3.5 mt-0.5 text-emerald-600 flex-shrink-0" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 mt-0.5 text-amber-600 flex-shrink-0" />
            )}
            <div className="flex-1">
              <div className="text-foreground">{line.label}</div>
              {line.note && (
                <div className="text-xs text-muted-foreground">{line.note}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
