import { useState, useEffect, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const STORAGE_KEY = "ee_nav_tour_seen";

interface TourStep {
  targetLabel: string;
  title: string;
  description: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    targetLabel: "Projects",
    title: "Projects",
    description: "Project Lifecycle and related pages are now here.",
  },
  {
    targetLabel: "Operations",
    title: "Operations",
    description: "Engineering and Quality are combined under Operations.",
  },
  {
    targetLabel: "Insights",
    title: "Insights",
    description: "Priorities, Reports, and Knowledge are now grouped under Insights.",
  },
];

export function NavOnboardingTour() {
  const [currentStep, setCurrentStep] = useState(-1);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setDismissed(false);
      setCurrentStep(0);
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setCurrentStep(-1);
    localStorage.setItem(STORAGE_KEY, "true");
  }, []);

  const next = useCallback(() => {
    if (currentStep >= TOUR_STEPS.length - 1) {
      dismiss();
    } else {
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep, dismiss]);

  if (dismissed || currentStep < 0 || currentStep >= TOUR_STEPS.length) {
    return null;
  }

  const step = TOUR_STEPS[currentStep];

  return (
    <NavTourPopover
      key={currentStep}
      targetLabel={step.targetLabel}
      title={step.title}
      description={step.description}
      stepIndex={currentStep}
      totalSteps={TOUR_STEPS.length}
      onNext={next}
      onSkip={dismiss}
    />
  );
}

function NavTourPopover({
  targetLabel,
  title,
  description,
  stepIndex,
  totalSteps,
  onNext,
  onSkip,
}: {
  targetLabel: string;
  title: string;
  description: string;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Find the nav tab link by text content
    const navLinks = document.querySelectorAll("header nav a");
    for (const link of navLinks) {
      if (link.textContent?.trim() === targetLabel) {
        setAnchorEl(link as HTMLElement);
        return;
      }
    }
    // If tab not found (user doesn't have permission), skip to next
    onNext();
  }, [targetLabel, onNext]);

  if (!anchorEl) return null;

  return (
    <Popover open>
      <PopoverTrigger asChild>
        <span
          style={{
            position: "fixed",
            top: anchorEl.getBoundingClientRect().bottom + 2,
            left: anchorEl.getBoundingClientRect().left + anchorEl.getBoundingClientRect().width / 2,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-4"
        side="bottom"
        align="center"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <button onClick={onSkip} className="text-muted-foreground hover:text-foreground -mt-1 -mr-1">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{description}</p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {stepIndex + 1} of {totalSteps}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground">
              Skip tour
            </button>
            <Button size="sm" className="h-7 text-xs" onClick={onNext}>
              {stepIndex === totalSteps - 1 ? "Got it" : "Next"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
