/**
 * Smart Import v2 — Main flow orchestrator
 *
 * Replaces the v1 5-step wizard (Upload → Sections → Mapping → Issues → Commit)
 * with a plain-language 5-step flow:
 *   1. Upload
 *   2. What we found
 *   3. What changed
 *   4. Needs your decision
 *   5. Confirm import
 *
 * Reuses the existing UploadStep from v1 for file/folder upload parity.
 * Steps 2-5 use new v2 components driven by planner/conflict data.
 */

import { useState, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { getAuthHeaders, UploadStep, type FileUploadResult } from "@/pages/smart-import";
import { SmartImportStepIndicator } from "./SmartImportStepIndicator";
import { SmartImportFoundStep } from "./SmartImportFoundStep";
import { SmartImportChangesStep } from "./SmartImportChangesStep";
import { SmartImportDecisionStep } from "./SmartImportDecisionStep";
import { SmartImportConfirmStep } from "./SmartImportConfirmStep";

interface V2FlowProps {
  /** Called when the user enters bulk mode (multiple files uploaded) */
  onBulkMode?: () => void;
}

export function SmartImportV2Flow({ onBulkMode }: V2FlowProps) {
  const [step, setStep] = useState(1);
  const [runId, setRunId] = useState<number | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [planning, setPlanning] = useState<any>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, "keep_app" | "accept_file">>({});

  // Load planner data for the current run
  const loadPlannerData = useCallback(async (id: number) => {
    setLoadingPlan(true);
    try {
      // Load run data (includes preview) and planner data in parallel
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
      }
    } catch (err) {
      console.error("[SmartImportV2] Failed to load planner data:", err);
    } finally {
      setLoadingPlan(false);
    }
  }, []);

  // Handle single file upload completion
  const handleUploaded = useCallback((newRunId: number, newPreview: any) => {
    setRunId(newRunId);
    setPreview(newPreview);
    setDecisions({});
    setStep(2);
    loadPlannerData(newRunId);
  }, [loadPlannerData]);

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

  // Determine if we should skip the decision step (no conflicts)
  const hasConflicts = planning?.conflicts?.hasBlockingConflicts === true;

  return (
    <div className="space-y-4" data-testid="v2-flow">
      <SmartImportStepIndicator
        currentStep={step}
        onStepClick={(s) => { if (s < step) setStep(s); }}
      />

      {/* Step 1: Upload */}
      {step === 1 && (
        <UploadStep
          onUploaded={handleUploaded}
          onBatchUploaded={handleBatchUploaded}
          onResumeBatch={onBulkMode}
        />
      )}

      {/* Loading state between steps */}
      {loadingPlan && step > 1 && (
        <div className="flex items-center justify-center py-8" data-testid="v2-loading">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mr-2" />
          <span className="text-sm text-muted-foreground">Analyzing your spreadsheet...</span>
        </div>
      )}

      {/* Step 2: What we found */}
      {step === 2 && !loadingPlan && preview && (
        <SmartImportFoundStep
          preview={preview}
          planning={planning}
          onContinue={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}

      {/* Step 3: What changed */}
      {step === 3 && !loadingPlan && (
        <SmartImportChangesStep
          planning={planning}
          onContinue={() => setStep(hasConflicts ? 4 : 5)}
          onBack={() => setStep(2)}
        />
      )}

      {/* Step 4: Needs your decision (skip if no conflicts) */}
      {step === 4 && !loadingPlan && (
        <SmartImportDecisionStep
          planning={planning}
          decisions={decisions}
          onDecision={handleDecision}
          onBulkDecision={handleBulkDecision}
          onContinue={() => setStep(5)}
          onBack={() => setStep(3)}
        />
      )}

      {/* Step 5: Confirm import */}
      {step === 5 && runId && !loadingPlan && (
        <SmartImportConfirmStep
          runId={runId}
          planning={planning}
          decisions={decisions}
          onBack={() => setStep(hasConflicts ? 4 : 3)}
        />
      )}
    </div>
  );
}
