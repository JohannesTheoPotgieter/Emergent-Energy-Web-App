import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useWalkthroughCompleted } from "@/hooks/use-guidance";
import {
  X, ChevronRight, ChevronLeft, Sparkles, Search,
  BarChart3, Bell, ListTodo, ShieldCheck, DollarSign,
  Trophy, Layout, Compass, Wrench, ClipboardCheck,
  Settings, FileSpreadsheet, Users, TrendingUp,
  Briefcase, Star, Shield, Building2,
} from "lucide-react";

export interface TutorialStep {
  targetSelector?: string;
  title: string;
  description: string;
  icon?: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right" | "center";
}

const WELCOME_LABELS: Record<string, string> = {
  CEO_ADMIN: "Chief Executive",
  COO_ADMIN: "Chief Operating Officer",
  CCO: "Chief Commercial Officer",
  CFO: "Chief Financial Officer",
  PROGRAM_MANAGER: "Programme Manager",
  PROGRAM_FINANCE_MANAGER: "Programme Finance Manager",
  QUALITY_MANAGER: "Quality Manager",
  CONSTRUCTION_MANAGER: "Construction Manager",
  ENGINEER: "Engineer",
  PROJECT_MANAGER_SITE: "Site Project Manager",
  PROJECT_DEVELOPER: "Project Developer",
  ACCOUNTANT: "Accountant",
};

function getRoleLabel(role: string): string {
  return WELCOME_LABELS[role] || "team member";
}

function getTutorialSteps(role: string): TutorialStep[] {
  const label = getRoleLabel(role);
  const isExco = ["CEO_ADMIN", "COO_ADMIN", "CCO", "CFO"].includes(role);
  const isFinance = ["CFO", "PROGRAM_FINANCE_MANAGER", "ACCOUNTANT"].includes(role);
  const isEngineering = ["ENGINEER"].includes(role);
  const isQuality = ["QUALITY_MANAGER"].includes(role);
  const isPM = ["PROGRAM_MANAGER", "PROJECT_MANAGER_SITE", "CONSTRUCTION_MANAGER"].includes(role);
  const isPD = ["PROJECT_DEVELOPER", "CCO"].includes(role);

  const steps: TutorialStep[] = [];

  steps.push({
    title: `Welcome, ${label}!`,
    description: isExco
      ? "Let's walk through your executive dashboard. You have full oversight of all projects, financials, and team performance. This will only take a minute."
      : isPM
      ? "Let's walk through your project management dashboard. You'll find your assigned projects, tasks, and key actions here. This tour takes about a minute."
      : isFinance
      ? "Let's walk through your finance dashboard. You'll see cost tracking, revenue, and cashflow tools tailored to your role. Quick tour ahead."
      : isEngineering
      ? "Let's walk through your engineering dashboard. You'll find your tasks, deliverables, and stage checklists here. A quick tour to get you started."
      : isPD
      ? "Let's walk through your project development dashboard. You'll see your PD tickets, project pipeline, and assigned projects. Quick tour ahead."
      : isQuality
      ? "Let's walk through your quality management dashboard. You'll find checklists, gate approvals, and quality tracking here."
      : "Let's take a quick tour of the dashboard. This will only take a minute and help you get the most out of the platform.",
    icon: <Sparkles className="h-6 w-6" />,
    position: "center",
  });

  steps.push({
    targetSelector: '[data-testid="project-quick-search"]',
    title: "Project Quick Search",
    description: isPM
      ? "Jump to any of your projects instantly. Type a name to find a site tracker — you'll land on its full detail page with tasks, plan, and financials."
      : isExco
      ? "Search across all projects in the portfolio. Jump directly to any project for a full breakdown of progress, finances, and team performance."
      : "Jump to any project instantly. Type a project name to find and navigate to its detail page.",
    icon: <Search className="h-5 w-5" />,
    position: "bottom",
  });

  if (isPM || isExco || isPD) {
    steps.push({
      targetSelector: '[data-testid="card-my-projects"]',
      title: isPM ? "Your Assigned Projects" : isExco ? "Portfolio Overview" : "Your PD Projects",
      description: isPM
        ? "All projects where you're the PM appear here. Watch for progress bars (actual vs expected), phase badges, and stale data warnings when an import is overdue."
        : isExco
        ? "Your full project portfolio at a glance. Track progress vs targets, identify projects falling behind, and spot stale data that needs a fresh import."
        : "Projects you're developing appear here. Track their progress through phases and keep an eye on completion targets.",
      icon: <Layout className="h-5 w-5" />,
      position: "bottom",
    });
  }

  steps.push({
    targetSelector: '[data-testid="priority-queue"]',
    title: "Priority Queue",
    description: isPM
      ? "Your top 5 most urgent items — overdue plan tasks, pending approvals for your projects, and actions you need to take. Sorted by urgency so you know what to tackle first."
      : isExco
      ? "The most urgent items across the business — overdue tasks, pending approvals, and action-required notifications. A quick way to see what needs attention right now."
      : "Your top 5 most urgent items sorted by urgency. Overdue tasks come first, then actions needed, then approvals.",
    icon: <ListTodo className="h-5 w-5" />,
    position: "bottom",
  });

  steps.push({
    targetSelector: '[data-testid="stat-cards"]',
    title: "At-a-Glance Stats",
    description: "Quick overview of your workload: unread notifications, open tasks, pending approvals, and overdue items. Click any card to jump to that section.",
    icon: <BarChart3 className="h-5 w-5" />,
    position: "top",
  });

  if (isPM || isEngineering || isExco) {
    steps.push({
      targetSelector: '[data-testid="card-my-tasks"]',
      title: isEngineering ? "Your Engineering Tasks" : "My Tasks",
      description: isEngineering
        ? "All engineering tasks assigned to you — deliverables, stage checklist items, and project tasks. Overdue items are highlighted in red. Click to see full details."
        : "All tasks assigned to you across projects. Overdue tasks are highlighted in red with a days-overdue badge. Click a task to open its detail drawer.",
      icon: <ShieldCheck className="h-5 w-5" />,
      position: "top",
    });
  }

  steps.push({
    targetSelector: '[data-testid="card-notifications"]',
    title: "Notifications",
    description: isExco
      ? "Updates on project movements, approval requests, and team actions. Amber items are action-required — they need your decision before work can proceed."
      : "Stay on top of updates, approvals, and action-required items. Amber items need your attention. Mark them as read when done.",
    icon: <Bell className="h-5 w-5" />,
    position: "top",
  });

  steps.push({
    targetSelector: "nav",
    title: "Sidebar Navigation",
    description: isExco
      ? "Your command centre: Execution Board for company overview, Portfolios for grouped projects, COS Tracker and Cashflow for financials, Quality dashboard, and Admin settings for roles and permissions."
      : isFinance
      ? "Quick access to your finance tools: COS Tracker for cost of sales, Cashflow Forecasting, Invoice Patterns, and the Execution Board for project financials at a glance."
      : isEngineering
      ? "Find your key areas: Engineering Tasks board for your assignments, the Lifecycle Board for project stages, and the EE Info page for SOPs and process guides."
      : isPM
      ? "Navigate to: Execution Board for all project tracking, Smart Import for uploading trackers, Project Plans (Gantt), and the Teams Chat for project communication."
      : isPD
      ? "Quick links to: PD Dashboard and Tickets, Project Pipeline, Portfolio overviews, and the Lifecycle Board to track project phases."
      : isQuality
      ? "Access your areas: Quality Dashboard for checklists and gate approvals, the TR Register for action items, and project-level quality tabs."
      : "Access all areas from the sidebar: Execution Board, Portfolios, COS Tracker, Engineering, Quality, Teams Chat, and more.",
    icon: <Compass className="h-5 w-5" />,
    position: "right",
  });

  steps.push({
    title: "You're All Set!",
    description: isExco
      ? "That's the essentials covered. For detailed guides on any feature — from Smart Import to Weekly Reviews — visit the EE Info page. You can replay this tour anytime."
      : `That's the basics covered. Explore the EE Info page for ${isEngineering ? "engineering-specific" : isFinance ? "finance-focused" : isPM ? "project management" : "detailed"} walkthroughs on every feature. Replay this tour anytime from the home page.`,
    icon: <Trophy className="h-6 w-6" />,
    position: "center",
  });

  return steps;
}

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
  role?: string;
  externalSteps?: TutorialStep[];
}

export function InteractiveTutorial({ active, onComplete, role = "", externalSteps }: Props) {
  const steps = useMemo(() => externalSteps || getTutorialSteps(role), [role, externalSteps]);
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const currentStep = steps[step];
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;

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
        aria-label={`Tutorial step ${step + 1} of ${steps.length}: ${currentStep.title}`}
        className={`rounded-xl bg-white shadow-2xl border ${isCentered ? "w-[420px] max-w-[90vw]" : ""}`}
        style={getTooltipStyle()}
        data-testid="tutorial-tooltip"
      >
        <div className="p-5">
          <div className="flex items-start justify-between mb-3">
            {currentStep.icon ? (
              <div className={`flex items-center justify-center rounded-lg ${isCentered && (isFirst || isLast) ? "w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 text-white" : "w-9 h-9 bg-blue-100 text-blue-600"}`}>
                {currentStep.icon}
              </div>
            ) : (
              <div className={`flex items-center justify-center rounded-lg ${isCentered && isFirst ? "w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 text-white" : "w-9 h-9 bg-blue-100 text-blue-600"}`}>
                <Sparkles className={isCentered && isFirst ? "h-6 w-6" : "h-5 w-5"} />
              </div>
            )}
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
            <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
              {steps.map((_, i) => (
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
