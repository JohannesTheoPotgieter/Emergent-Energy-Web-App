/**
 * Smart Import v2 — "Needs your decision" step
 *
 * Shows conflicts where both the app and spreadsheet changed differently.
 * For each conflict, the user chooses: Keep current app value OR Use uploaded value.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, ArrowLeft, AlertTriangle, ChevronDown, ChevronUp, Check,
} from "lucide-react";
import { useState, useMemo } from "react";
import { SECTION_LABELS, CONFLICT_ACTIONS, fieldLabel } from "./labels";

interface DecisionStepProps {
  planning: any;
  decisions: Record<string, "keep_app" | "accept_file">;
  onDecision: (key: string, value: "keep_app" | "accept_file") => void;
  onBulkDecision: (value: "keep_app" | "accept_file") => void;
  onContinue: () => void;
  onBack: () => void;
}

interface ConflictField {
  fieldName: string;
  baselineValue: string | null;
  currentAppValue: string | null;
  uploadedValue: string | null;
  mergeCase: string;
  requiresDecision: boolean;
}

interface ConflictRow {
  rowKey: string;
  displayLabel: string;
  section: string;
  fields: ConflictField[];
}

function ValueDisplay({ label, value, accent }: { label: string; value: unknown; accent?: string }) {
  const displayValue = value != null && value !== "" ? (typeof value === "object" ? JSON.stringify(value) : String(value)) : "\u2014 (empty)";
  return (
    <div className={`px-3 py-2 rounded-lg border text-sm ${accent || "bg-white border-slate-200"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
      <div className="font-medium">{displayValue}</div>
    </div>
  );
}

function ConflictCard({
  row,
  decisions,
  onDecision,
}: {
  row: ConflictRow;
  decisions: Record<string, "keep_app" | "accept_file">;
  onDecision: (key: string, value: "keep_app" | "accept_file") => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const conflictFields = row.fields.filter(f => f.requiresDecision);
  const allResolved = conflictFields.every(f => decisions[`${row.rowKey}::${f.fieldName}`]);

  return (
    <div className={`border rounded-lg overflow-hidden ${allResolved ? "border-emerald-300 bg-emerald-50/30" : "border-amber-300"}`} data-testid={`conflict-row-${row.rowKey}`}>
      <div className="px-4 py-3 flex items-center justify-between bg-white border-b">
        <div className="flex items-center gap-2">
          {allResolved
            ? <Check className="w-4 h-4 text-emerald-600" />
            : <AlertTriangle className="w-4 h-4 text-amber-600" />
          }
          <span className="text-sm font-semibold">{String(row.displayLabel || "")}</span>
          <Badge variant="outline" className="text-[10px]">
            {SECTION_LABELS[row.section] || String(row.section || "")}
          </Badge>
          {allResolved && (
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
              Resolved
            </Badge>
          )}
        </div>
        <button
          className="text-xs text-muted-foreground hover:text-slate-700 flex items-center gap-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {expanded && (
        <div className="divide-y">
          {conflictFields.map((field) => {
            const decisionKey = `${row.rowKey}::${field.fieldName}`;
            const current = decisions[decisionKey];

            return (
              <div key={field.fieldName} className="px-4 py-3 space-y-2" data-testid={`conflict-field-${decisionKey}`}>
                <div className="text-sm font-medium text-slate-700">
                  {fieldLabel(field.fieldName)}
                </div>

                {/* Three-value comparison */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  <ValueDisplay label="Last import" value={field.baselineValue} accent="bg-slate-50 border-slate-200" />
                  <ValueDisplay label="Current app value" value={field.currentAppValue} accent="bg-blue-50 border-blue-200" />
                  <ValueDisplay label="Uploaded value" value={field.uploadedValue} accent="bg-amber-50 border-amber-200" />
                </div>

                {/* Decision buttons */}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant={current === "keep_app" ? "default" : "outline"}
                    className={`text-xs h-8 ${current === "keep_app" ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                    onClick={() => onDecision(decisionKey, "keep_app")}
                    data-testid={`decision-keep-${decisionKey}`}
                  >
                    {current === "keep_app" && <Check className="w-3 h-3 mr-1" />}
                    {CONFLICT_ACTIONS.KEEP_APP}
                  </Button>
                  <Button
                    size="sm"
                    variant={current === "accept_file" ? "default" : "outline"}
                    className={`text-xs h-8 ${current === "accept_file" ? "bg-amber-600 hover:bg-amber-700" : ""}`}
                    onClick={() => onDecision(decisionKey, "accept_file")}
                    data-testid={`decision-accept-${decisionKey}`}
                  >
                    {current === "accept_file" && <Check className="w-3 h-3 mr-1" />}
                    {CONFLICT_ACTIONS.ACCEPT_FILE}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SmartImportDecisionStep({
  planning, decisions, onDecision, onBulkDecision, onContinue, onBack,
}: DecisionStepProps) {
  // Extract all conflict rows from the planning output
  const conflictRows: ConflictRow[] = useMemo(() => {
    if (!planning?.conflicts?.allRows) return [];
    return planning.conflicts.allRows
      .filter((r: any) => r.conflictStatus === "HAS_CONFLICTS")
      .map((r: any) => ({
        rowKey: r.rowKey,
        displayLabel: r.displayLabel,
        section: r.section,
        fields: r.fields.filter((f: any) => f.requiresDecision),
      }));
  }, [planning]);

  // Count total fields needing decisions
  const totalDecisions = conflictRows.reduce((sum, r) => sum + r.fields.length, 0);
  const resolvedCount = Object.keys(decisions).length;
  const allResolved = resolvedCount >= totalDecisions;

  if (conflictRows.length === 0) {
    return (
      <Card data-testid="decision-step">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Check className="w-5 h-5 text-emerald-600" />
            No decisions needed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            All changes can be applied automatically. No conflicts were found between your spreadsheet and the current app data.
          </p>
          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={onBack} data-testid="decision-back-btn">
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back
            </Button>
            <Button size="sm" onClick={onContinue} data-testid="decision-continue-btn">
              Continue <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="decision-step">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          Needs your decision
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          We found {conflictRows.length} item{conflictRows.length > 1 ? "s" : ""} where
          both the app and your spreadsheet changed differently since the last import.
          Please choose which value to keep for each.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress */}
        <div className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-2 border" data-testid="decision-progress">
          <span className="text-sm">
            {allResolved
              ? <span className="text-emerald-700 font-medium">All decisions made</span>
              : <span>{resolvedCount} of {totalDecisions} decisions made</span>
            }
          </span>
          {/* Bulk actions */}
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm" className="text-xs h-7"
              onClick={() => onBulkDecision("keep_app")}
              data-testid="decision-bulk-keep"
            >
              Keep all app values
            </Button>
            <Button
              variant="outline" size="sm" className="text-xs h-7"
              onClick={() => onBulkDecision("accept_file")}
              data-testid="decision-bulk-accept"
            >
              Use all uploaded values
            </Button>
          </div>
        </div>

        {/* Conflict cards */}
        {conflictRows.map(row => (
          <ConflictCard
            key={row.rowKey}
            row={row}
            decisions={decisions}
            onDecision={onDecision}
          />
        ))}

        {/* Navigation */}
        <div className="flex justify-between pt-2">
          <Button variant="outline" size="sm" onClick={onBack} data-testid="decision-back-btn">
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back
          </Button>
          <Button
            size="sm"
            onClick={onContinue}
            disabled={!allResolved}
            data-testid="decision-continue-btn"
          >
            {allResolved ? "Continue" : `${totalDecisions - resolvedCount} decision${totalDecisions - resolvedCount > 1 ? "s" : ""} remaining`}
            {allResolved && <ArrowRight className="w-3.5 h-3.5 ml-1.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
