import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import type { TaskMovement, EngTask } from "./types";

interface BlockerStripProps {
  /** Tasks currently in HOLD from all speakers seen so far */
  heldTasks: Array<{ taskTitle: string; userName: string; holdReason: string; blockedType?: string }>;
  /** Tasks moved to HOLD during this standup session */
  newHolds: TaskMovement[];
}

export function BlockerStrip({ heldTasks, newHolds }: BlockerStripProps) {
  // Merge: existing holds + newly moved to hold
  const allBlockers = [
    ...heldTasks.map(t => ({
      key: `held-${t.taskTitle}`,
      owner: t.userName,
      reason: t.holdReason,
      type: t.blockedType || "External",
      isNew: false,
    })),
    ...newHolds.map(m => ({
      key: `new-${m.taskId}`,
      owner: m.userName,
      reason: m.holdReason || "Moved to hold",
      type: "flagged",
      isNew: true,
    })),
  ];

  // Deduplicate by reason+owner
  const unique = allBlockers.filter((b, i, arr) =>
    arr.findIndex(x => x.owner === b.owner && x.reason === b.reason) === i
  );

  if (unique.length === 0) return null;

  return (
    <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 px-4 py-2.5">
      <div className="flex items-center gap-2 overflow-x-auto">
        <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
        <span className="text-xs font-semibold text-red-700 dark:text-red-400 shrink-0">BLOCKERS</span>
        <div className="flex items-center gap-3 overflow-x-auto">
          {unique.map(b => (
            <div key={b.key} className="flex items-center gap-1.5 shrink-0">
              {b.isNew && <Badge className="text-[8px] px-1 py-0 bg-red-600 text-white">NEW</Badge>}
              <span className="text-xs">
                <span className="font-medium">{b.owner}:</span>{" "}
                <span className="text-muted-foreground">{b.reason}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
