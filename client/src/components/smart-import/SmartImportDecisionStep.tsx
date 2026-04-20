import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, ArrowLeft, AlertTriangle, Check,
} from "lucide-react";
import { useMemo } from "react";
import { SECTION_LABELS, CONFLICT_ACTIONS, fieldLabel } from "./labels";
import { SmartImportDecisionIntro } from "./SmartImportDecisionIntro";

interface DecisionStepProps {
  planning: any;
  decisions: Record<string, "keep_app" | "accept_file">;
  onDecision: (key: string, value: "keep_app" | "accept_file") => void;
  onBulkDecision: (value: "keep_app" | "accept_file") => void;
  onContinue: () => void;
  onBack: () => void;
}

interface FlatDecisionRow {
  decisionKey: string;
  displayLabel: string;
  section: string;
  fieldName: string;
  currentAppValue: string | null;
  uploadedValue: string | null;
}

function formatVal(value: unknown): string {
  if (value == null || value === "") return "\u2014";
  const s = String(value);
  return s.length > 40 ? s.slice(0, 37) + "\u2026" : s;
}

export function SmartImportDecisionStep({
  planning, decisions, onDecision, onBulkDecision, onContinue, onBack,
}: DecisionStepProps) {
  const flatRows: FlatDecisionRow[] = useMemo(() => {
    if (!planning?.conflicts?.allRows) return [];
    const rows: FlatDecisionRow[] = [];
    for (const r of planning.conflicts.allRows) {
      if (r.conflictStatus !== "HAS_CONFLICTS") continue;
      for (const f of r.fields) {
        if (!f.requiresDecision) continue;
        rows.push({
          decisionKey: `${r.rowKey}::${f.fieldName}`,
          displayLabel: r.displayLabel || "",
          section: r.section || "",
          fieldName: f.fieldName,
          currentAppValue: f.currentAppValue,
          uploadedValue: f.uploadedValue,
        });
      }
    }
    return rows;
  }, [planning]);

  const totalDecisions = flatRows.length;
  const resolvedCount = flatRows.filter(r => decisions[r.decisionKey]).length;
  const allResolved = resolvedCount >= totalDecisions;
  const pendingRows = flatRows.filter(r => !decisions[r.decisionKey]);
  const resolvedRows = flatRows.filter(r => decisions[r.decisionKey]);
  const sortedRows = [...pendingRows, ...resolvedRows];

  if (flatRows.length === 0) {
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
            All changes can be applied automatically. No conflicts were found.
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
    <div className="space-y-3" data-testid="decision-step">
      {/* UX-3: plain-English intro card for non-technical users. */}
      <SmartImportDecisionIntro
        pendingCount={totalDecisions - resolvedCount}
        totalCount={totalDecisions}
      />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            {totalDecisions} decision{totalDecisions > 1 ? "s" : ""} needed
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Both the app and your spreadsheet changed differently. Pick which value to keep.
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline" size="sm" className="text-[10px] h-6 px-2"
            onClick={() => onBulkDecision("keep_app")}
            data-testid="decision-bulk-keep"
          >
            Keep all app
          </Button>
          <Button
            variant="outline" size="sm" className="text-[10px] h-6 px-2"
            onClick={() => onBulkDecision("accept_file")}
            data-testid="decision-bulk-accept"
          >
            Use all uploaded
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-emerald-500 h-full rounded-full transition-all duration-300"
            style={{ width: `${totalDecisions ? (resolvedCount / totalDecisions) * 100 : 0}%` }}
          />
        </div>
        <span className="text-slate-500 tabular-nums flex-shrink-0">
          {resolvedCount}/{totalDecisions}
        </span>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="hidden md:grid grid-cols-[minmax(140px,2fr)_minmax(60px,0.8fr)_minmax(60px,0.8fr)_minmax(80px,1.2fr)_minmax(80px,1.2fr)_auto] gap-x-1 px-2 py-1 bg-slate-100 text-[9px] uppercase tracking-wider text-slate-500 font-semibold border-b">
          <span>Item</span>
          <span>Section</span>
          <span>Field</span>
          <span className="text-blue-600">App value</span>
          <span className="text-amber-600">Uploaded</span>
          <span className="w-[120px] text-center">Decision</span>
        </div>

        <div className="hidden md:block divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
          {sortedRows.map((row, idx) => {
            const current = decisions[row.decisionKey];
            const isResolved = !!current;

            return (
              <div
                key={`${row.decisionKey}-${idx}`}
                className={`grid grid-cols-[minmax(140px,2fr)_minmax(60px,0.8fr)_minmax(60px,0.8fr)_minmax(80px,1.2fr)_minmax(80px,1.2fr)_auto] gap-x-1 px-2 items-center text-[11px] transition-colors ${
                  isResolved ? "py-0.5 bg-emerald-50/40 opacity-60" : "py-1 hover:bg-slate-50"
                }`}
                data-testid={`decision-row-${row.decisionKey}`}
              >
                <span className="truncate font-medium text-slate-700" title={String(row.displayLabel)}>
                  {isResolved && <Check className="w-3 h-3 text-emerald-500 inline mr-0.5 -mt-px" />}
                  {String(row.displayLabel)}
                </span>
                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 w-fit truncate">
                  {SECTION_LABELS[row.section] || String(row.section)}
                </Badge>
                <span className="text-slate-500 truncate" title={fieldLabel(row.fieldName)}>
                  {fieldLabel(row.fieldName)}
                </span>
                <span className="text-blue-700 font-mono text-[10px] truncate" title={formatVal(row.currentAppValue)}>
                  {formatVal(row.currentAppValue)}
                </span>
                <span className="text-amber-700 font-mono text-[10px] truncate" title={formatVal(row.uploadedValue)}>
                  {formatVal(row.uploadedValue)}
                </span>
                <span className="flex gap-0.5 flex-shrink-0 w-[120px] justify-center">
                  <button
                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors ${
                      current === "keep_app"
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-slate-500 border-slate-200 hover:border-blue-400 hover:text-blue-600"
                    }`}
                    onClick={() => onDecision(row.decisionKey, "keep_app")}
                    data-testid={`decision-keep-${row.decisionKey}`}
                    title={CONFLICT_ACTIONS.KEEP_APP}
                  >
                    Keep app
                  </button>
                  <button
                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors ${
                      current === "accept_file"
                        ? "bg-amber-600 text-white border-amber-600"
                        : "bg-white text-slate-500 border-slate-200 hover:border-amber-400 hover:text-amber-600"
                    }`}
                    onClick={() => onDecision(row.decisionKey, "accept_file")}
                    data-testid={`decision-accept-${row.decisionKey}`}
                    title={CONFLICT_ACTIONS.ACCEPT_FILE}
                  >
                    Use upload
                  </button>
                </span>
              </div>
            );
          })}
        </div>

        <div className="md:hidden divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
          {sortedRows.map((row, idx) => {
            const current = decisions[row.decisionKey];
            const isResolved = !!current;

            return (
              <div
                key={`${row.decisionKey}-m-${idx}`}
                className={`px-2 py-1.5 text-[11px] ${isResolved ? "bg-emerald-50/40 opacity-60" : ""}`}
                data-testid={`decision-row-mobile-${row.decisionKey}`}
              >
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="font-medium text-slate-700 truncate flex-1">
                    {isResolved && <Check className="w-3 h-3 text-emerald-500 inline mr-0.5 -mt-px" />}
                    {String(row.displayLabel)}
                    <span className="text-slate-400 ml-1">{"\u00b7"} {fieldLabel(row.fieldName)}</span>
                  </span>
                  <span className="flex gap-0.5 flex-shrink-0">
                    <button
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                        current === "keep_app"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-500 border-slate-200"
                      }`}
                      onClick={() => onDecision(row.decisionKey, "keep_app")}
                    >
                      App
                    </button>
                    <button
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                        current === "accept_file"
                          ? "bg-amber-600 text-white border-amber-600"
                          : "bg-white text-slate-500 border-slate-200"
                      }`}
                      onClick={() => onDecision(row.decisionKey, "accept_file")}
                    >
                      Upload
                    </button>
                  </span>
                </div>
                <div className="flex gap-3 text-[9px]">
                  <span><span className="text-blue-500">App:</span> <span className="font-mono text-blue-700">{formatVal(row.currentAppValue)}</span></span>
                  <span><span className="text-amber-500">Upload:</span> <span className="font-mono text-amber-700">{formatVal(row.uploadedValue)}</span></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
          {allResolved ? "Continue" : `${totalDecisions - resolvedCount} remaining`}
          {allResolved && <ArrowRight className="w-3.5 h-3.5 ml-1.5" />}
        </Button>
      </div>
    </div>
  );
}
