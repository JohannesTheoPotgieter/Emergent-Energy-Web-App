/**
 * Smart Import v2 — Main flow orchestrator
 *
 * The manual flow is intentionally short so the operator can see what they're
 * about to import at a glance:
 *
 *   1. Upload
 *   2. Your decisions   (only when the planner finds genuine conflicts)
 *   3. Review & import  (one consolidated screen: at-a-glance counts, the
 *                        actual changed rows, schedule + money impact, commit)
 *
 * Reuses the existing UploadStep from v1 for file/folder upload parity. The
 * heavy "What we found" / "What changed" screens are folded into the Review
 * step. This only reorganises presentation — the plan / money / commit
 * endpoints and conflict-decision handling are unchanged.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { getAuthHeaders, UploadStep, type FileUploadResult } from "@/pages/smart-import";
import { SmartImportStepIndicator } from "./SmartImportStepIndicator";
import { SmartImportDecisionStep } from "./SmartImportDecisionStep";
import { SmartImportConfirmStep } from "./SmartImportConfirmStep";
import { FLOW_STEP_LABELS } from "./labels";

interface V2FlowProps {
  /** Called when the user enters bulk mode (multiple files uploaded) */
  onBulkMode?: () => void;
  /** If set, skip upload and start reviewing this run directly */
  initialRunId?: number | null;
  /** Called when user wants to go back (e.g., to bulk panel) */
  onBack?: () => void;
  /** Called when the active runId changes so the parent can track it */
  onRunIdChange?: (runId: number | null) => void;
}

// Step constants for the simplified flow.
const STEP_UPLOAD = 1;
const STEP_DECIDE = 2;
const STEP_REVIEW = 3;

export function SmartImportV2Flow({ onBulkMode, initialRunId, onBack, onRunIdChange }: V2FlowProps) {
  const [step, setStep] = useState(initialRunId ? STEP_REVIEW : STEP_UPLOAD);
  const [runId, setRunId] = useState<number | null>(initialRunId || null);
  const [preview, setPreview] = useState<any>(null);
  const [planning, setPlanning] = useState<any>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "keep_app" | "accept_file">>({});

  // Load planner data for the current run
  const loadPlannerData = useCallback(async (id: number) => {
    setLoadingPlan(true);
    setPlanError(null);
    setPlanning(null);
    try {
      const [runRes, planRes] = await Promise.all([
        fetch(`/api/smart-import/${id}`, { headers: getAuthHeaders() }),
        fetch(`/api/smart-import/${id}/plan`, { headers: getAuthHeaders() }),
      ]);

      if (runRes.ok) {
        const runData = await runRes.json();
        if (runData.preview) setPreview(runData.preview);
      }

      if (planRes.ok) {
        const planData = await planRes.json();
        setPlanning(planData.planning);
      } else {
        const errData = await planRes.json().catch(() => ({ error: "Unknown error" }));
        setPlanError(errData.error || `Plan request failed (${planRes.status})`);
      }
    } catch (err) {
      console.error("[SmartImportV2] Failed to load planner data:", err);
      setPlanError(err instanceof Error ? err.message : "Failed to load plan data");
    } finally {
      setLoadingPlan(false);
    }
  }, []);

  // If opened with an initialRunId (e.g., from bulk panel "Review"), load it
  useEffect(() => {
    if (initialRunId) {
      setRunId(initialRunId);
      loadPlannerData(initialRunId);
      onRunIdChange?.(initialRunId);
    }
  }, [initialRunId, loadPlannerData, onRunIdChange]);

  // Handle single file upload completion — land straight on the review screen.
  const handleUploaded = useCallback((newRunId: number, newPreview: any) => {
    setRunId(newRunId);
    setPreview(newPreview);
    setDecisions({});
    setStep(STEP_REVIEW);
    loadPlannerData(newRunId);
    onRunIdChange?.(newRunId);
  }, [loadPlannerData, onRunIdChange]);

  // Handle batch upload completion
  const handleBatchUploaded = useCallback((results: FileUploadResult[]) => {
    const successful = results.filter(r => r.status === "success");
    if (successful.length === 1) {
      handleUploaded(successful[0].runId!, successful[0].preview);
    } else if (successful.length > 1 && onBulkMode) {
      onBulkMode();
    }
  }, [handleUploaded, onBulkMode]);

  // Handle a single conflict decision
  const handleDecision = useCallback((key: string, value: "keep_app" | "accept_file") => {
    setDecisions(prev => ({ ...prev, [key]: value }));
  }, []);

  // Handle bulk conflict decision (apply same choice to all)
  const handleBulkDecision = useCallback((value: "keep_app" | "accept_file") => {
    if (!planning?.conflicts?.allRows) return;
    const newDecisions: Record<string, "keep_app" | "accept_file"> = {};
    for (const row of planning.conflicts.allRows) {
      if (row.conflictStatus !== "HAS_CONFLICTS") continue;
      for (const field of row.fields) {
        if (field.requiresDecision) {
          newDecisions[`${row.rowKey}::${field.fieldName}`] = value;
        }
      }
    }
    setDecisions(newDecisions);
  }, [planning]);

  // Required conflict decisions + how many are still outstanding.
  const requiredDecisionKeys = useMemo(() => {
    const keys: string[] = [];
    const allRows = planning?.conflicts?.allRows ?? [];
    for (const r of allRows) {
      if (r.conflictStatus !== "HAS_CONFLICTS") continue;
      for (const f of (r.fields ?? [])) {
        if (f.requiresDecision) keys.push(`${r.rowKey}::${f.fieldName}`);
      }
    }
    return keys;
  }, [planning]);

  const hasConflicts = planning?.conflicts?.hasBlockingConflicts === true;
  const unresolvedConflictCount = requiredDecisionKeys.filter((k) => !decisions[k]).length;

  // Reset the entire flow for a new import
  const handleStartNew = useCallback(() => {
    setStep(STEP_UPLOAD);
    setRunId(null);
    setPreview(null);
    setPlanning(null);
    setDecisions({});
    setPlanError(null);
    onRunIdChange?.(null);
  }, [onRunIdChange]);

  // Indicator: 2 stops normally, 3 when conflicts need a decision step.
  const indicatorLabels = hasConflicts
    ? [FLOW_STEP_LABELS.upload, FLOW_STEP_LABELS.decisions, FLOW_STEP_LABELS.review]
    : [FLOW_STEP_LABELS.upload, FLOW_STEP_LABELS.review];
  const indicatorStep = hasConflicts ? step : (step <= STEP_UPLOAD ? 1 : 2);

  return (
    <div className="space-y-4" data-testid="v2-flow">
      <SmartImportStepIndicator
        currentStep={indicatorStep}
        labels={indicatorLabels}
        onStepClick={(s) => {
          if (s === 1) setStep(STEP_UPLOAD);
          else if (hasConflicts && s === 2) setStep(STEP_DECIDE);
        }}
      />

      {/* Step 1: Upload (skipped when initialRunId is provided) */}
      {step === STEP_UPLOAD && !initialRunId && (
        <UploadStep
          onUploaded={handleUploaded}
          onBatchUploaded={handleBatchUploaded}
          onResumeBatch={onBulkMode}
        />
      )}

      {/* Loading state while the plan is fetched */}
      {loadingPlan && step > STEP_UPLOAD && (
        <div className="flex items-center justify-center py-8" data-testid="v2-loading">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mr-2" />
          <span className="text-sm text-muted-foreground">Analyzing your spreadsheet...</span>
        </div>
      )}

      {/* Plan load error */}
      {planError && !loadingPlan && step > STEP_UPLOAD && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="v2-plan-error">
          <p className="font-medium">We couldn't read this file's changes.</p>
          <p className="text-xs mt-0.5">{planError}</p>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              className="text-xs font-medium text-red-700 underline"
              onClick={() => runId && loadPlannerData(runId)}
            >
              Try again
            </button>
            <button
              type="button"
              className="text-xs font-medium text-slate-600 underline"
              onClick={() => (onBack ? onBack() : setStep(STEP_UPLOAD))}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Your decisions (only when there are conflicts to resolve) */}
      {step === STEP_DECIDE && !loadingPlan && (
        <SmartImportDecisionStep
          planning={planning}
          decisions={decisions}
          onDecision={handleDecision}
          onBulkDecision={handleBulkDecision}
          onContinue={() => setStep(STEP_REVIEW)}
          onBack={() => setStep(STEP_REVIEW)}
        />
      )}

      {/* Step 3: Review & import — the consolidated review screen */}
      {step === STEP_REVIEW && runId && !loadingPlan && !planError && (
        <SmartImportConfirmStep
          runId={runId}
          planning={planning}
          preview={preview}
          decisions={decisions}
          unresolvedConflictCount={unresolvedConflictCount}
          onResolveConflicts={() => setStep(STEP_DECIDE)}
          onBack={() => (onBack ? onBack() : setStep(STEP_UPLOAD))}
          onStartNew={handleStartNew}
        />
      )}
    </div>
  );
}
