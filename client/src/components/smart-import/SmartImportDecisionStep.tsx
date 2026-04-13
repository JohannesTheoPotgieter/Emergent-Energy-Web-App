/**
 * Smart Import v2 — "Needs your decision" step
 *
 * Compact list showing conflicts where both the app and spreadsheet changed
 * differently. For each conflict, the user chooses: Keep current app value OR
 * Use uploaded value.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, ArrowLeft, AlertTriangle, ChevronDown, ChevronUp, Check, Eye, EyeOff,
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

function formatValue(value: unknown): string {
  if (value == null || value === "") return "\u2014";
  return String(value);
}

/** Compact inline field row: field name | 3 values | 2 decision buttons */
function FieldRow({
  field,
  decisionKey,
  current,
  onDecision,
}: {
  field: ConflictField;
  decisionKey: string;
  current: "keep_app" | "accept_file" | undefined;
  onDecision: (key: string, value: "keep_app" | "accept_file") => void;
}) {
  return (
    <div
      className="grid grid-cols-[minmax(100px,1.2fr)_1fr_1fr_1fr_auto] items-center gap-x-2 px-3 py-1.5 text-xs border-t first:border-t-0 hover:bg-slate-50/50"
      data-testid={`conflict-field-${decisionKey}`}
    >
      {/* Field name */}
      <span className="font-medium text-slate-700 truncate" title={fieldLabel(field.fieldName)}>
        {fieldLabel(field.fieldName)}
      </span>

      {/* Last import */}
      <span className="text-slate-500 truncate font-mono text-[11px]" title={formatValue(field.baselineValue)}>
        {formatValue(field.baselineValue)}
      </span>

      {/* Current app value */}
      <span className="text-blue-700 truncate font-mono text-[11px]" title={formatValue(field.currentAppValue)}>
        {formatValue(field.currentAppValue)}
      </span>

      {/* Uploaded value */}
      <span className="text-amber-700 truncate font-mono text-[11px]" title={formatValue(field.uploadedValue)}>
        {formatValue(field.uploadedValue)}
      </span>

      {/* Decision toggle */}
      <span className="flex gap-1 flex-shrink-0">
        <button
          className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
            current === "keep_app"
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-slate-600 border-slate-300 hover:border-blue-400 hover:text-blue-600"
          }`}
          onClick={() => onDecision(decisionKey, "keep_app")}
          data-testid={`decision-keep-${decisionKey}`}
          title={CONFLICT_ACTIONS.KEEP_APP}
        >
          {current === "keep_app" && <Check className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />}
          Keep app
        </button>
        <button
          className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
            current === "accept_file"
              ? "bg-amber-600 text-white border-amber-600"
              : "bg-white text-slate-600 border-slate-300 hover:border-amber-400 hover:text-amber-600"
          }`}
          onClick={() => onDecision(decisionKey, "accept_file")}
          data-testid={`decision-accept-${decisionKey}`}
          title={CONFLICT_ACTIONS.ACCEPT_FILE}
        >
          {current === "accept_file" && <Check className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />}
          Use upload
        </button>
      </span>
    </div>
  );
}

/** Compact row for mobile: stacked layout */
function FieldRowMobile({
  field,
  decisionKey,
  current,
  onDecision,
}: {
  field: ConflictField;
  decisionKey: string;
  current: "keep_app" | "accept_file" | undefined;
  onDecision: (key: string, value: "keep_app" | "accept_file") => void;
}) {
  return (
    <div
      className="px-3 py-2 text-xs border-t first:border-t-0"
      data-testid={`conflict-field-mobile-${decisionKey}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-slate-700">{fieldLabel(field.fieldName)}</span>
        <span className="flex gap-1">
          <button
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
              current === "keep_app"
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-300"
            }`}
            onClick={() => onDecision(decisionKey, "keep_app")}
            title={CONFLICT_ACTIONS.KEEP_APP}
          >
            {current === "keep_app" && <Check className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />}
            Keep app
          </button>
          <button
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
              current === "accept_file"
                ? "bg-amber-600 text-white border-amber-600"
                : "bg-white text-slate-600 border-slate-300"
            }`}
            onClick={() => onDecision(decisionKey, "accept_file")}
            title={CONFLICT_ACTIONS.ACCEPT_FILE}
          >
            {current === "accept_file" && <Check className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />}
            Use upload
          </button>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <div><span className="text-slate-400">Last: </span><span className="text-slate-600 font-mono">{formatValue(field.baselineValue)}</span></div>
        <div><span className="text-blue-400">App: </span><span className="text-blue-700 font-mono">{formatValue(field.currentAppValue)}</span></div>
        <div><span className="text-amber-400">Upload: </span><span className="text-amber-700 font-mono">{formatValue(field.uploadedValue)}</span></div>
      </div>
    </div>
  );
}

function ConflictCard({
  row,
  decisions,
  onDecision,
  defaultExpanded,
}: {
  row: ConflictRow;
  decisions: Record<string, "keep_app" | "accept_file">;
  onDecision: (key: string, value: "keep_app" | "accept_file") => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const conflictFields = row.fields.filter(f => f.requiresDecision);
  const resolvedFields = conflictFields.filter(f => decisions[`${row.rowKey}::${f.fieldName}`]);
  const allResolved = resolvedFields.length === conflictFields.length;

  return (
    <div
      className={`border rounded-md overflow-hidden ${allResolved ? "border-emerald-200 bg-emerald-50/20" : "border-amber-200"}`}
      data-testid={`conflict-row-${row.rowKey}`}
    >
      {/* Header row — always visible */}
      <button
        className="w-full px-3 py-2 flex items-center justify-between bg-white hover:bg-slate-50 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {allResolved
            ? <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
            : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          }
          <span className="text-xs font-semibold truncate">{String(row.displayLabel || "")}</span>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 flex-shrink-0">
            {SECTION_LABELS[row.section] || String(row.section || "")}
          </Badge>
          {allResolved ? (
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] px-1.5 py-0 h-4 flex-shrink-0">
              Resolved
            </Badge>
          ) : (
            <span className="text-[10px] text-amber-600 flex-shrink-0">
              {resolvedFields.length}/{conflictFields.length}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-3 h-3 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />}
      </button>

      {/* Expanded: table header + field rows */}
      {expanded && (
        <>
          {/* Column headers — desktop only */}
          <div className="hidden md:grid grid-cols-[minmax(100px,1.2fr)_1fr_1fr_1fr_auto] gap-x-2 px-3 py-1 bg-slate-100 border-t text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
            <span>Field</span>
            <span>Last import</span>
            <span className="text-blue-600">Current app value</span>
            <span className="text-amber-600">Uploaded value</span>
            <span className="w-[136px]">Decision</span>
          </div>

          {/* Desktop rows */}
          <div className="hidden md:block">
            {conflictFields.map((field) => {
              const decisionKey = `${row.rowKey}::${field.fieldName}`;
              return (
                <FieldRow
                  key={field.fieldName}
                  field={field}
                  decisionKey={decisionKey}
                  current={decisions[decisionKey]}
                  onDecision={onDecision}
                />
              );
            })}
          </div>

          {/* Mobile rows */}
          <div className="md:hidden">
            {conflictFields.map((field) => {
              const decisionKey = `${row.rowKey}::${field.fieldName}`;
              return (
                <FieldRowMobile
                  key={field.fieldName}
                  field={field}
                  decisionKey={decisionKey}
                  current={decisions[decisionKey]}
                  onDecision={onDecision}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function SmartImportDecisionStep({
  planning, decisions, onDecision, onBulkDecision, onContinue, onBack,
}: DecisionStepProps) {
  const [hideResolved, setHideResolved] = useState(false);

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

  const totalDecisions = conflictRows.reduce((sum, r) => sum + r.fields.length, 0);
  const resolvedCount = Object.keys(decisions).length;
  const allResolved = resolvedCount >= totalDecisions;

  const isRowResolved = (row: ConflictRow) =>
    row.fields
      .filter(f => f.requiresDecision)
      .every(f => decisions[`${row.rowKey}::${f.fieldName}`]);

  const sortedRows = useMemo(() => {
    return [...conflictRows].sort((a, b) => {
      const aResolved = isRowResolved(a);
      const bResolved = isRowResolved(b);
      if (aResolved === bResolved) return 0;
      return aResolved ? 1 : -1;
    });
  }, [conflictRows, decisions]);

  const resolvedRowCount = sortedRows.filter(r => isRowResolved(r)).length;
  const unresolvedRowCount = sortedRows.length - resolvedRowCount;

  const visibleRows = hideResolved ? sortedRows.filter(r => !isRowResolved(r)) : sortedRows;

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
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          Needs your decision
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {conflictRows.length} item{conflictRows.length > 1 ? "s" : ""} where
          both the app and your spreadsheet changed differently.
          Choose which value to keep for each field.
        </p>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="flex items-center justify-between bg-slate-50 rounded px-3 py-1.5 border text-xs" data-testid="decision-progress">
          <span>
            {allResolved
              ? <span className="text-emerald-700 font-medium">All {totalDecisions} decisions made</span>
              : <span className="text-slate-600"><strong>{resolvedCount}</strong> of <strong>{totalDecisions}</strong> decided</span>
            }
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline" size="sm" className="text-[10px] h-6 px-2"
              onClick={() => onBulkDecision("keep_app")}
              data-testid="decision-bulk-keep"
            >
              Keep all app values
            </Button>
            <Button
              variant="outline" size="sm" className="text-[10px] h-6 px-2"
              onClick={() => onBulkDecision("accept_file")}
              data-testid="decision-bulk-accept"
            >
              Use all uploaded values
            </Button>
          </div>
        </div>

        {resolvedRowCount > 0 && unresolvedRowCount > 0 && (
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] text-slate-500">
              {unresolvedRowCount} item{unresolvedRowCount > 1 ? "s" : ""} need decisions
              {resolvedRowCount > 0 && ` \u00b7 ${resolvedRowCount} resolved`}
            </span>
            <button
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 transition-colors"
              onClick={() => setHideResolved(!hideResolved)}
              data-testid="toggle-resolved"
            >
              {hideResolved
                ? <><Eye className="w-3 h-3" /> Show resolved ({resolvedRowCount})</>
                : <><EyeOff className="w-3 h-3" /> Hide resolved ({resolvedRowCount})</>
              }
            </button>
          </div>
        )}

        {visibleRows.map((row, idx) => {
          const rowResolved = isRowResolved(row);
          const isFirstUnresolved = !rowResolved && visibleRows.slice(0, idx).every(r => isRowResolved(r));
          const defaultExpanded = isFirstUnresolved || (idx === 0 && allResolved);

          return (
            <ConflictCard
              key={row.rowKey}
              row={row}
              decisions={decisions}
              onDecision={onDecision}
              defaultExpanded={defaultExpanded}
            />
          );
        })}

        <div className="flex justify-between pt-1">
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
