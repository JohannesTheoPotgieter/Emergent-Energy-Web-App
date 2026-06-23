/**
 * Smart Import v2 — Step Indicator
 *
 * Shows the 5-step flow with plain-language labels.
 */

import { Check } from "lucide-react";
import { V2_STEP_LABELS } from "./labels";

interface StepIndicatorProps {
  currentStep: number;
  onStepClick?: (step: number) => void;
  /**
   * Optional replacement set of step labels. Defaults to the full five-step
   * vocabulary; the simplified manual flow passes a shorter set
   * (Upload → [Your decisions] → Review & import).
   */
  labels?: readonly string[];
}

export function SmartImportStepIndicator({ currentStep, onStepClick, labels = V2_STEP_LABELS }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-1 mb-6" data-testid="v2-step-indicator">
      {labels.map((label, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === currentStep;
        const isComplete = stepNum < currentStep;
        const isClickable = isComplete && onStepClick;
        return (
          <div key={label} className="flex items-center gap-1">
            {idx > 0 && (
              <div className={`h-0.5 w-3 md:w-6 ${isComplete ? "bg-blue-500" : "bg-slate-200"}`} />
            )}
            <div
              className={`flex items-center gap-1 ${isClickable ? "cursor-pointer group" : ""}`}
              onClick={() => { if (isClickable) onStepClick(stepNum); }}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  isActive ? "bg-blue-600 text-white" :
                  isComplete ? "bg-blue-500 text-white group-hover:bg-blue-600" :
                  "bg-slate-200 text-muted-foreground"
                }`}
                data-testid={`v2-step-circle-${stepNum}`}
              >
                {isComplete ? <Check className="w-3.5 h-3.5" /> : stepNum}
              </div>
              <span className={`text-xs hidden lg:inline transition-colors ${
                isActive ? "font-semibold text-blue-700" :
                isComplete ? "text-muted-foreground group-hover:text-blue-600" :
                "text-muted-foreground"
              }`}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
