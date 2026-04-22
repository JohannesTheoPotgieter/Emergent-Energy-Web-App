import { resolveCanonicalPhase } from "@shared/phases";
import { cn } from "@/lib/utils";

interface StageProgressProps {
  currentStage: string;
  stages: string[];
}

export function StageProgress({ currentStage, stages }: StageProgressProps) {
  const canonicalCurrent = resolveCanonicalPhase(currentStage);
  const currentLabel = canonicalCurrent?.label ?? currentStage;
  const currentIndex = stages.findIndex((stage) => stage === currentLabel);

  return (
    <div className="flex items-center gap-1.5" aria-label={`Stage progress: ${currentLabel}`}>
      {stages.map((stage, index) => {
        const isCompleted = currentIndex >= 0 && index < currentIndex;
        const isCurrent = index === currentIndex;
        const isFuture = !isCompleted && !isCurrent;

        return (
          <div
            key={stage}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              isCompleted && "bg-blue-600",
              isCurrent && "bg-emerald-500",
              isFuture && "bg-gray-300",
            )}
            title={stage}
            aria-current={isCurrent ? "step" : undefined}
          />
        );
      })}
    </div>
  );
}
