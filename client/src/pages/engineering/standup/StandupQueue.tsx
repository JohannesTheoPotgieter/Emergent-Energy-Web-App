import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, SkipForward, Shuffle, User } from "lucide-react";
import { type Participant, formatTime, timerColor, initials } from "./types";

interface StandupQueueProps {
  queue: Participant[];
  activeIndex: number;
  completedIndices: Set<number>;
  skippedIndices: Set<number>;
  speakerTimings: Map<number, number>;
  activeSpeakerSeconds: number;
  totalBlockers: number;
  onSkip: () => void;
  onShuffle: () => void;
  isRunning: boolean;
}

export function StandupQueue({
  queue,
  activeIndex,
  completedIndices,
  skippedIndices,
  speakerTimings,
  activeSpeakerSeconds,
  totalBlockers,
  onSkip,
  onShuffle,
  isRunning,
}: StandupQueueProps) {
  const doneCount = completedIndices.size;
  const remaining = queue.filter((_, i) => !completedIndices.has(i) && !skippedIndices.has(i) && i !== activeIndex);
  const avgTime = doneCount > 0
    ? Math.round([...speakerTimings.values()].reduce((a, b) => a + b, 0) / doneCount)
    : 0;

  return (
    <div className="flex flex-col gap-3 min-w-[200px] max-w-[220px]">
      {/* Queue list */}
      <div className="space-y-1">
        {queue.map((p, i) => {
          const isDone = completedIndices.has(i);
          const isSkipped = skippedIndices.has(i);
          const isActive = i === activeIndex && isRunning;
          const time = isActive ? activeSpeakerSeconds : speakerTimings.get(p.userId);

          return (
            <div
              key={p.userId}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-primary/10 border border-primary/30 font-medium"
                  : isDone
                    ? "opacity-60"
                    : isSkipped
                      ? "opacity-30 line-through"
                      : ""
              }`}
            >
              {/* Status icon */}
              {isDone ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              ) : isActive ? (
                <div className="h-4 w-4 rounded-full bg-primary animate-pulse shrink-0" />
              ) : isSkipped ? (
                <SkipForward className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}

              {/* Name */}
              <span className="truncate flex-1">{p.userName}</span>

              {/* Timer */}
              {time != null && (
                <span className={`text-xs tabular-nums ${isActive ? timerColor(time) : "text-muted-foreground"}`}>
                  {formatTime(time)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div className="border-t pt-3 space-y-1.5 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Blockers</span>
          <span className={totalBlockers > 0 ? "text-red-600 font-medium" : ""}>{totalBlockers}</span>
        </div>
        <div className="flex justify-between">
          <span>Avg time</span>
          <span>{avgTime > 0 ? formatTime(avgTime) : "—"}</span>
        </div>
      </div>

      {/* Actions */}
      {isRunning && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 text-xs gap-1" onClick={onSkip}>
            <SkipForward className="h-3.5 w-3.5" /> Skip
          </Button>
          <Button variant="outline" size="sm" className="flex-1 text-xs gap-1" onClick={onShuffle}>
            <Shuffle className="h-3.5 w-3.5" /> Shuffle
          </Button>
        </div>
      )}
    </div>
  );
}
