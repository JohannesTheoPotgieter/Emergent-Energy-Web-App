/**
 * Smart Import v2 — "What changed" step
 *
 * Shows the user a plain-language summary of what the planner found:
 * - New data count
 * - Updated data count
 * - No change count
 * - Missing from upload count
 *
 * Works identically for file and folder uploads.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, ArrowLeft, ChevronDown, ChevronUp,
  Plus, RefreshCw, Minus, Check,
} from "lucide-react";
import { useState } from "react";
import { SECTION_LABELS, CLASSIFICATION_LABELS } from "./labels";
import { SmartImportQbProtectionsCallout } from "./SmartImportQbProtectionsCallout";
import { SmartImportScheduleImpact } from "./SmartImportScheduleImpact";

interface ChangesStepProps {
  planning: any;
  planError?: string | null;
  /** Run id is needed to fetch QuickBooks protection summary (compact form). */
  runId?: number | null;
  loadingPlan?: boolean;
  onRetryPlan?: () => void;
  onContinue: () => void;
  onBack: () => void;
}

interface SectionSummaryCardProps {
  sectionKey: string;
  plan: any;
}

function SectionSummaryCard({ sectionKey, plan }: SectionSummaryCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (!plan) return null;

  const { newCount = 0, changedCount = 0, unchangedCount = 0, missingFromUploadCount = 0 } = plan;
  const total = newCount + changedCount + unchangedCount + missingFromUploadCount;

  return (
    <div className="border rounded-lg overflow-hidden" data-testid={`changes-section-${sectionKey}`}>
      <div className="bg-slate-50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{SECTION_LABELS[sectionKey] || sectionKey}</span>
          <Badge variant="outline" className="text-xs">{total} rows</Badge>
        </div>
        <button
          className="text-xs text-muted-foreground hover:text-slate-700 flex items-center gap-1"
          onClick={() => setExpanded(!expanded)}
          data-testid={`changes-section-${sectionKey}-toggle`}
        >
          {expanded ? "Hide" : "Show"} details
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        {newCount > 0 && (
          <div className="flex items-center gap-2 bg-emerald-50 text-emerald-800 rounded-lg px-3 py-2 border border-emerald-200" data-testid={`changes-${sectionKey}-new`}>
            <Plus className="w-4 h-4" />
            <div>
              <div className="text-lg font-bold">{newCount}</div>
              <div className="text-xs">{CLASSIFICATION_LABELS.NEW}</div>
            </div>
          </div>
        )}
        {changedCount > 0 && (
          <div className="flex items-center gap-2 bg-blue-50 text-blue-800 rounded-lg px-3 py-2 border border-blue-200" data-testid={`changes-${sectionKey}-changed`}>
            <RefreshCw className="w-4 h-4" />
            <div>
              <div className="text-lg font-bold">{changedCount}</div>
              <div className="text-xs">{CLASSIFICATION_LABELS.CHANGED}</div>
            </div>
          </div>
        )}
        {unchangedCount > 0 && (
          <div className="flex items-center gap-2 bg-slate-50 text-slate-600 rounded-lg px-3 py-2 border border-slate-200" data-testid={`changes-${sectionKey}-unchanged`}>
            <Check className="w-4 h-4" />
            <div>
              <div className="text-lg font-bold">{unchangedCount}</div>
              <div className="text-xs">{CLASSIFICATION_LABELS.UNCHANGED}</div>
            </div>
          </div>
        )}
        {missingFromUploadCount > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 text-amber-800 rounded-lg px-3 py-2 border border-amber-200" data-testid={`changes-${sectionKey}-missing`}>
            <Minus className="w-4 h-4" />
            <div>
              <div className="text-lg font-bold">{missingFromUploadCount}</div>
              <div className="text-xs">{CLASSIFICATION_LABELS.MISSING_FROM_UPLOAD}</div>
            </div>
          </div>
        )}
        {total === 0 && (
          <div className="col-span-full text-sm text-muted-foreground italic py-1">
            No rows found for this section
          </div>
        )}
      </div>

      {/* Expanded row-level details */}
      {expanded && plan.rows && (
        <div className="border-t px-4 py-2 max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2">Item</th>
                <th className="py-1">Details</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.slice(0, 50).map((row: any, idx: number) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="py-1 pr-2">
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                      row.classification === "NEW" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                      row.classification === "CHANGED" ? "bg-blue-50 text-blue-700 border-blue-200" :
                      row.classification === "UNCHANGED" ? "bg-slate-50 text-slate-500 border-slate-200" :
                      "bg-amber-50 text-amber-700 border-amber-200"
                    }`}>
                      {CLASSIFICATION_LABELS[row.classification] || row.classification}
                    </Badge>
                  </td>
                  <td className="py-1 pr-2 font-medium">{String(row.rowLabel || `Row ${idx + 1}`)}</td>
                  <td className="py-1 text-muted-foreground">
                    {row.changedFields?.length > 0 && (
                      <span>{row.changedFields.length} field{row.changedFields.length > 1 ? "s" : ""} changed</span>
                    )}
                  </td>
                </tr>
              ))}
              {plan.rows.length > 50 && (
                <tr><td colSpan={3} className="py-1 text-muted-foreground italic">...and {plan.rows.length - 50} more rows</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SmartImportChangesStep({ planning, planError, loadingPlan, onRetryPlan, onContinue, onBack, runId }: ChangesStepProps) {
  if (planError) {
    return (
      <Card data-testid="changes-step">
        <CardContent className="py-8 text-center space-y-3">
          <p className="text-red-600 font-medium">Failed to load plan</p>
          <p className="text-sm text-muted-foreground">{planError}</p>
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="outline" onClick={onBack} data-testid="button-back">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            {onRetryPlan && (
              <Button onClick={onRetryPlan} data-testid="button-retry-plan">
                <RefreshCw className="w-4 h-4 mr-1" /> Retry
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!planning) {
    return (
      <Card data-testid="changes-step">
        <CardContent className="py-8 text-center text-muted-foreground">
          {loadingPlan ? "Loading plan..." : "Waiting for plan data..."}
        </CardContent>
      </Card>
    );
  }

  const sections = planning.sections || {};
  const importMode = planning.importMode;
  const hasConflicts = planning.conflicts?.hasBlockingConflicts;

  return (
    <Card data-testid="changes-step">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-blue-600" />
          {importMode === "BASELINE" ? "What will be imported" : "What changed"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {importMode === "BASELINE"
            ? "This is a first-time import. All data will be added as new."
            : "We compared your spreadsheet with the current app data. Here\u2019s what\u2019s different."
          }
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* UX-2: schedule impact card, always above QB + section counts. */}
        <SmartImportScheduleImpact planning={planning} />

        {/* QuickBooks protections — compact form so it sits above the section
            summaries without dominating the page. */}
        {runId && (
          <SmartImportQbProtectionsCallout runId={runId} compact />
        )}

        {/* Section summaries */}
        {(["PLAN", "REVENUE", "EXPENDITURE"] as const).map(key => (
          <SectionSummaryCard key={key} sectionKey={key} plan={sections[key]} />
        ))}

        {/* Conflict notice */}
        {hasConflicts && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-900" data-testid="changes-conflict-notice">
            <p className="font-semibold">Some items need your decision</p>
            <p className="text-xs mt-1">
              There are rows where both the app and your spreadsheet changed differently.
              You'll be asked to choose which value to keep on the next step.
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-2">
          <Button variant="outline" size="sm" onClick={onBack} data-testid="changes-back-btn">
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            Back
          </Button>
          <Button size="sm" onClick={onContinue} data-testid="changes-continue-btn">
            {hasConflicts ? "Review decisions" : "Continue"}
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
