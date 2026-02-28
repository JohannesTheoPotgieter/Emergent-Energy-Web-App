import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useWalkthroughCompleted } from "@/hooks/use-guidance";
import {
  X, ChevronRight, ChevronLeft, Sparkles, Search,
  BarChart3, Bell, ListTodo, ShieldCheck,
  Trophy, Layout, Compass,
} from "lucide-react";

interface TutorialStep {
  targetSelector?: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right" | "center";
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: "Welcome to Emergent Energy",
    description: "Let's take a quick tour of the dashboard. This will only take a minute and will help you get the most out of the platform. You can skip at any time.",
    icon: <Sparkles className="h-6 w-6" />,
    position: "center",
  },
  {
    targetSelector: '[data-testid="project-quick-search"]',
    title: "Project Quick Search",
    description: "Jump to any project instantly. Type a project name, PM, or PD to find and navigate to a specific site tracker.",
    icon: <Search className="h-5 w-5" />,
    position: "bottom",
  },
  {
    targetSelector: '[data-testid="card-my-projects"]',
    title: "My Projects",
    description: "Your assigned projects appear here. You'll see progress bars, phase badges, and stale data warnings for projects where you're the PM or PD.",
    icon: <Layout className="h-5 w-5" />,
    position: "bottom",
  },
  {
    targetSelector: '[data-testid="priority-queue"]',
    title: "Priority Queue",
    description: "Your top 5 most urgent items — overdue tasks, required actions, and pending approvals — all in one place, sorted by urgency.",
    icon: <ListTodo className="h-5 w-5" />,
    position: "bottom",
  },
  {
    targetSelector: '[data-testid="stat-cards"]',
    title: "At-a-Glance Stats",
    description: "Quick overview of your workload: unread notifications, open tasks, pending approvals, and overdue items. Click any card to jump to that section.",
    icon: <BarChart3 className="h-5 w-5" />,
    position: "top",
  },
  {
    targetSelector: '[data-testid="card-my-tasks"]',
    title: "My Tasks",
    description: "All tasks assigned to you across projects. Overdue tasks are highlighted in red with a days-overdue badge. Click a task to see its details.",
    icon: <ShieldCheck className="h-5 w-5" />,
    position: "top",
  },
  {
    targetSelector: '[data-testid="card-notifications"]',
    title: "Notifications",
    description: "Stay on top of updates, approvals, and action-required items. Amber items need your attention. Mark them as read when done.",
    icon: <Bell className="h-5 w-5" />,
    position: "top",
  },
  {
    targetSelector: "nav",
    title: "Sidebar Navigation",
    description: "Access all areas from the sidebar: Execution Board, Portfolios, COS Tracker, Engineering, Quality, Teams Chat, and more. Sections are organised by department.",
    icon: <Compass className="h-5 w-5" />,
    position: "right",
  },
  {
    title: "You're All Set!",
    description: "That's the basics covered. Explore the EE Info page for 37 detailed walkthroughs on every feature. You can replay this tour anytime from the home page.",
    icon: <Trophy className="h-6 w-6" />,
    position: "center",
  },
];

const WALKTHROUGH_SCREEN_ID = "onboarding-dashboard-tour";

function getRect(el: Element | null): DOMRect | null {
  if (!el) return null;
  return el.getBoundingClientRect();
}

export function useInteractiveTutorial() {
  const { completed, markCompleted, reset } = useWalkthroughCompleted(WALKTHROUGH_SCREEN_ID);
  const [active, setActive] = useState(false);

  const hasCompleted = useCallback(() => completed, [completed]);
  const start = useCallback(() => setActive(true), []);
  const stop = useCallback(() => {
    markCompleted();
    setActive(false);
  }, [markCompleted]);

  return { active, start, stop, hasCompleted, completed, reset };
}

interface Props {
  active: boolean;
  onComplete: () => void;
}

export function InteractiveTutorial({ active, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const currentStep = TUTORIAL_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TUTORIAL_STEPS.length - 1;

  const updateTargetRect = useCallback(() => {
    if (!currentStep?.targetSelector) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(currentStep.targetSelector);
    const rect = getRect(el);
    setTargetRect(rect);
  }, [currentStep]);

  useEffect(() => {
    if (!active) return;
    updateTargetRect();
    const interval = setInterval(updateTargetRect, 300);
    window.addEventListener("resize", updateTargetRect);
    window.addEventListener("scroll", updateTargetRect, true);
    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", updateTargetRect);
      window.removeEventListener("scroll", updateTargetRect, true);
    };
  }, [active, step, updateTargetRect]);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleComplete();
      if (e.key === "ArrowRight" && !isLast) setStep(s => s + 1);
      if (e.key === "ArrowLeft" && !isFirst) setStep(s => s - 1);
      if (e.key === "Enter") handleNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, isFirst, isLast]);

  useEffect(() => {
    if (active && currentStep?.targetSelector) {
      const el = document.querySelector(currentStep.targetSelector);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(updateTargetRect, 400);
      }
    }
  }, [step, active]);

  useEffect(() => {
    if (active && tooltipRef.current) {
      const firstButton = tooltipRef.current.querySelector("button, [role='button']") as HTMLElement;
      firstButton?.focus();
    }
  }, [active, step]);

  const handleComplete = () => {
    setStep(0);
    onComplete();
  };

  const handleNext = () => {
    if (isLast) {
      handleComplete();
    } else {
      setStep(s => s + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) setStep(s => s - 1);
  };

  if (!active) return null;

  const isCentered = !targetRect || currentStep.position === "center";
  const padding = 12;

  const getTooltipStyle = (): React.CSSProperties => {
    if (isCentered) {
      return {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 10002,
      };
    }

    const r = targetRect!;
    const pos = currentStep.position || "bottom";
    const style: React.CSSProperties = {
      position: "fixed",
      zIndex: 10002,
      maxWidth: "380px",
    };

    if (pos === "bottom") {
      style.top = r.bottom + padding;
      style.left = Math.max(16, Math.min(r.left + r.width / 2 - 190, window.innerWidth - 396));
    } else if (pos === "top") {
      style.bottom = window.innerHeight - r.top + padding;
      style.left = Math.max(16, Math.min(r.left + r.width / 2 - 190, window.innerWidth - 396));
    } else if (pos === "right") {
      style.top = Math.max(16, r.top + r.height / 2 - 80);
      style.left = r.right + padding;
    } else if (pos === "left") {
      style.top = Math.max(16, r.top + r.height / 2 - 80);
      style.right = window.innerWidth - r.left + padding;
    }

    return style;
  };

  return (
    <div data-testid="interactive-tutorial">
      <div
        className="fixed inset-0 bg-black/60 transition-opacity duration-300"
        style={{ zIndex: 10000 }}
        aria-hidden="true"
      />

      {targetRect && !isCentered && (
        <div
          className="fixed rounded-lg ring-4 ring-blue-400 ring-offset-2 transition-all duration-300 pointer-events-none"
          style={{
            zIndex: 10001,
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            background: "transparent",
          }}
          aria-hidden="true"
        />
      )}

      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Tutorial step ${step + 1} of ${TUTORIAL_STEPS.length}: ${currentStep.title}`}
        className={`rounded-xl bg-white shadow-2xl border ${isCentered ? "w-[420px] max-w-[90vw]" : ""}`}
        style={getTooltipStyle()}
        data-testid="tutorial-tooltip"
      >
        <div className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className={`flex items-center justify-center rounded-lg ${isCentered && (isFirst || isLast) ? "w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 text-white" : "w-9 h-9 bg-blue-100 text-blue-600"}`}>
              {currentStep.icon}
            </div>
            <button
              onClick={handleComplete}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close tutorial"
              data-testid="tutorial-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <h3 className={`font-semibold mb-1.5 ${isCentered && isFirst ? "text-lg" : "text-base"}`} data-testid="tutorial-step-title">
            {currentStep.title}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed" data-testid="tutorial-step-desc">
            {currentStep.description}
          </p>

          <div className="flex items-center justify-between mt-5">
            <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${TUTORIAL_STEPS.length}`}>
              {TUTORIAL_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step ? "w-6 bg-blue-500" : i < step ? "w-1.5 bg-blue-300" : "w-1.5 bg-gray-200"
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              {!isFirst && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={handlePrev}
                  aria-label="Previous step"
                  data-testid="tutorial-prev"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
              )}
              {isFirst && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground"
                  onClick={handleComplete}
                  data-testid="tutorial-skip"
                >
                  Skip tour
                </Button>
              )}
              <Button
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={handleNext}
                aria-label={isLast ? "Finish tutorial" : "Next step"}
                data-testid="tutorial-next"
              >
                {isLast ? "Finish" : isFirst ? "Start Tour" : "Next"}
                {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
