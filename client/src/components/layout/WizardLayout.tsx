import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * WizardLayout — canonical W5b multi-step wizard composition.
 *
 * Additive Phase 1 primitive. Renders a step rail + step body + optional
 * help panel + footer navigation. Does NOT own form state; the caller
 * manages per-step data (typically with react-hook-form instances).
 *
 * Contract (docs/overhaul/01-design-system.md §3 L8, wireframe W5b):
 *   - steps: ordered list of { key, label, content, help?, optional? }
 *   - currentStepKey: controlled state for current step
 *   - onStepChange: called when user navigates between steps
 *   - completedSteps: set of step keys that are considered done
 *   - Clickable back to completed, never skip forward
 *   - Review step mandatory as last step (caller decides the shape)
 */

export interface WizardStep {
  /** Stable key. Used for URL persistence and completedSteps lookup. */
  key: string;
  /** Visible label in the step rail. */
  label: string;
  /** Step body content. */
  content: React.ReactNode;
  /** Optional help-panel content for this step. */
  help?: React.ReactNode;
  /** Mark this step as optional (can be skipped). */
  optional?: boolean;
}

export interface WizardLayoutProps {
  steps: WizardStep[];
  /** Key of the currently active step. */
  currentStepKey: string;
  /** Called when the user navigates to another step. */
  onStepChange: (key: string) => void;
  /**
   * Set (by step key) of steps that have been completed. Only completed
   * steps are clickable in the rail. Forward nav is always via the
   * Next button — never skip-ahead in the rail.
   */
  completedSteps?: Set<string>;
  /**
   * Footer node for the Back / Skip / Next button row. The primitive
   * does NOT render navigation buttons itself — caller owns state and
   * composes buttons to match its form-validation rules.
   */
  footer?: React.ReactNode;
  /**
   * Optional "Last saved N seconds ago" node, typically for draft
   * autosave feedback.
   */
  savedLabel?: React.ReactNode;
  className?: string;
}

export function WizardLayout({
  steps,
  currentStepKey,
  onStepChange,
  completedSteps,
  footer,
  savedLabel,
  className,
}: WizardLayoutProps) {
  const currentStep = steps.find((step) => step.key === currentStepKey) ?? steps[0];
  const currentIndex = steps.findIndex((step) => step.key === currentStepKey);

  return (
    <div
      data-testid="wizard-layout"
      className={cn("flex flex-col gap-4", className)}
    >
      <nav
        aria-label="Wizard steps"
        data-testid="wizard-layout-rail"
        className="overflow-x-auto border-b border-border"
      >
        <ol className="flex items-center gap-1 min-w-max pb-2">
          {steps.map((step, index) => {
            const done = completedSteps?.has(step.key) ?? false;
            const isCurrent = step.key === currentStepKey;
            const isReachable = done || isCurrent || index <= currentIndex;
            return (
              <li
                key={step.key}
                className="flex items-center gap-1"
                data-testid={`wizard-layout-step-${step.key}`}
              >
                <button
                  type="button"
                  onClick={() => isReachable && onStepChange(step.key)}
                  disabled={!isReachable}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
                    isCurrent && "bg-primary/10 text-primary font-medium",
                    !isCurrent && done && "text-foreground hover:bg-muted",
                    !isCurrent && !done && "text-muted-foreground",
                    !isReachable && "cursor-not-allowed opacity-60",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-semibold",
                      done && "bg-primary text-primary-foreground",
                      !done && isCurrent && "border-2 border-primary text-primary",
                      !done && !isCurrent && "border border-border text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="h-3 w-3" /> : index + 1}
                  </span>
                  <span className="whitespace-nowrap">{step.label}</span>
                  {step.optional && (
                    <span className="text-[11px] text-muted-foreground">(optional)</span>
                  )}
                </button>
                {index < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="h-px w-4 bg-border"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div
          data-testid="wizard-layout-body"
          className={cn(
            "space-y-4",
            currentStep.help ? "lg:col-span-2" : "lg:col-span-3",
          )}
        >
          {currentStep.content}
        </div>

        {currentStep.help && (
          <aside
            data-testid="wizard-layout-help"
            aria-label="Step help"
            className="lg:col-span-1"
          >
            <div className="ee-surface-muted p-4 text-sm text-muted-foreground space-y-3">
              {currentStep.help}
            </div>
          </aside>
        )}
      </div>

      {(footer || savedLabel) && (
        <footer
          data-testid="wizard-layout-footer"
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border pt-4"
        >
          <div
            data-testid="wizard-layout-saved-label"
            className="text-xs text-muted-foreground"
          >
            {savedLabel}
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            {footer}
          </div>
        </footer>
      )}
    </div>
  );
}
