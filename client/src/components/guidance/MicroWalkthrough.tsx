import { useState, useEffect } from "react";
import { X, ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWalkthroughCompleted } from "@/hooks/use-guidance";

export interface WalkthroughStep {
  target?: string;
  title: string;
  description: string;
}

interface MicroWalkthroughProps {
  screenId: string;
  steps: WalkthroughStep[];
  className?: string;
}

export function MicroWalkthrough({ screenId, steps, className = "" }: MicroWalkthroughProps) {
  const { completed, markCompleted, reset } = useWalkthroughCompleted(screenId);
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(!completed);

  useEffect(() => {
    setVisible(!completed);
    setCurrentStep(0);
  }, [completed]);

  if (!visible || steps.length === 0) return null;

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;

  return (
    <div className={`rounded-lg border border-blue-200 bg-blue-50 p-3 ${className}`} data-testid="walkthrough">
      <div className="flex items-start gap-2">
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold shrink-0 mt-0.5">
          {currentStep + 1}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-800" data-testid="walkthrough-title">{step.title}</p>
          <p className="text-xs text-blue-600 mt-0.5" data-testid="walkthrough-desc">{step.description}</p>
          <div className="flex items-center gap-2 mt-2">
            {!isLast ? (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
                onClick={() => setCurrentStep(currentStep + 1)}
                data-testid="walkthrough-next"
              >
                Next <ChevronRight className="w-3 h-3 ml-0.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
                onClick={() => { markCompleted(); setVisible(false); }}
                data-testid="walkthrough-done"
              >
                Got it
              </Button>
            )}
            <span className="text-[10px] text-blue-600">{currentStep + 1} of {steps.length}</span>
            <button
              onClick={() => { markCompleted(); setVisible(false); }}
              className="ml-auto text-blue-600 hover:text-blue-600"
              data-testid="walkthrough-skip"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReplayWalkthrough({ screenId, label = "Replay guide" }: { screenId: string; label?: string }) {
  const { completed, reset } = useWalkthroughCompleted(screenId);
  if (!completed) return null;
  return (
    <button
      onClick={reset}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      data-testid="walkthrough-replay"
    >
      <RotateCcw className="w-3 h-3" />
      {label}
    </button>
  );
}
