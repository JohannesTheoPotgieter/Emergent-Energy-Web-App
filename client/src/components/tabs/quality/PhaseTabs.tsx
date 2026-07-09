/**
 * Phase tab strip with per-phase progress (Task 3.3 extraction from
 * QualityTab). Presentational — the parent supplies the phases, the progress
 * + colour lookups, and the selection callback.
 */
export function PhaseTabs({
  phases,
  selectedPhaseId,
  onSelect,
  getPhaseProgress,
  getPhaseColor,
}: {
  phases: any[];
  selectedPhaseId: number | null;
  onSelect: (phaseId: number) => void;
  getPhaseProgress: (phaseId: number) => { percent: number; completed: number; applicable: number; failed: number };
  getPhaseColor: (phaseKey: string) => { text: string; progress: string };
}) {
  return (
    <div className="bg-card rounded-lg border" data-testid="phase-tabs">
      <div className="flex items-stretch overflow-x-auto">
        {phases.map((phase: any, idx: number) => {
          const progress = getPhaseProgress(phase.id);
          const colors = getPhaseColor(phase.phaseKey);
          const isActive = selectedPhaseId === phase.id;
          return (
            <button
              key={phase.id}
              onClick={() => onSelect(phase.id)}
              className={`relative flex-1 min-w-[140px] flex flex-col items-center gap-1.5 px-4 py-3 text-sm font-medium transition-all border-b-2 ${
                isActive
                  ? `${colors.text} border-current bg-card`
                  : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/30"
              } ${idx > 0 ? "border-l border-l-slate-100" : ""}`}
              data-testid={`phase-tab-${phase.id}`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${isActive ? colors.progress : "bg-slate-300"}`} />
                <span className="whitespace-nowrap">{phase.phaseName}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${colors.progress} transition-all`} style={{ width: `${progress.percent}%` }} />
                </div>
                <span className={`text-[10px] font-mono ${isActive ? colors.text : "text-muted-foreground"}`}>
                  {progress.completed}/{progress.applicable}
                </span>
              </div>
              {progress.failed > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
