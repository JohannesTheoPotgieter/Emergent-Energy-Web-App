import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import {
  Play,
  CheckCircle2,
  Circle,
  Ban,
  Clock,
  Inbox,
  X,
  GripVertical,
  Repeat,
  ArrowRight,
  AlertCircle,
  ChevronRight,
} from "lucide-react";

export type TaskStatus = "inbox" | "planned" | "in_progress" | "blocked" | "waiting" | "done" | "cancelled";
export type TaskPriority = "critical" | "high" | "normal" | "low";

export interface TaskItem {
  id: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  plannedForDate: string | null;
  dueAt: string | null;
  sortOrder: number;
  bucket: string | null;
  projectName: string | null;
  department: string | null;
  tag: string | null;
  sourceEmailId?: string | null;
  sourceEmailSubject?: string | null;
  blockedReason: string | null;
  nextStep: string | null;
  definitionOfDone: string | null;
  pinnedToday: boolean;
  pinnedWeek: boolean;
  isRecurring?: boolean;
  recurrenceFrequency?: string | null;
  notes?: string | null;
  completionNote?: string | null;
  createdAt?: string | null;
}

const priorityConfig: Record<string, { label: string; color: string; dot: string }> = {
  critical: { label: "P1", color: "text-red-600 bg-red-50 border-red-200", dot: "bg-red-500" },
  high: { label: "P2", color: "text-orange-600 bg-orange-50 border-orange-200", dot: "bg-orange-500" },
  normal: { label: "P3", color: "text-blue-600 bg-blue-50 border-blue-200", dot: "bg-blue-500" },
  low: { label: "P4", color: "text-slate-500 bg-slate-50 border-slate-200", dot: "bg-slate-400" },
};

const statusConfig: Record<string, { label: string; icon: typeof Circle; color: string }> = {
  inbox: { label: "Inbox", icon: Inbox, color: "text-muted-foreground" },
  planned: { label: "Planned", icon: Circle, color: "text-blue-600" },
  in_progress: { label: "In Progress", icon: Play, color: "text-amber-600" },
  blocked: { label: "Blocked", icon: Ban, color: "text-red-600" },
  waiting: { label: "Waiting", icon: Clock, color: "text-orange-600" },
  done: { label: "Done", icon: CheckCircle2, color: "text-emerald-600" },
  cancelled: { label: "Cancelled", icon: X, color: "text-muted-foreground" },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const cfg = priorityConfig[priority] || priorityConfig.normal;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg.color}`}
      data-testid={`badge-priority-${priority}`}
    >
      {cfg.label}
    </span>
  );
}

export function PriorityDot({ priority }: { priority: string }) {
  const cfg = priorityConfig[priority] || priorityConfig.normal;
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />;
}

export function StatusIcon({ status }: { status: string }) {
  const cfg = statusConfig[status] || statusConfig.inbox;
  const Icon = cfg.icon;
  return <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />;
}

export function StatusLabel({ status }: { status: string }) {
  const cfg = statusConfig[status] || statusConfig.inbox;
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wider ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

interface TaskCardProps {
  task: TaskItem;
  onStatusChange?: (id: number, status: TaskStatus) => void;
  onOpenDrawer?: (task: TaskItem) => void;
  onQuickDone?: (task: TaskItem) => void;
  showProject?: boolean;
  showNextStep?: boolean;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, task: TaskItem) => void;
}

export default function TaskCard({
  task,
  onStatusChange,
  onOpenDrawer,
  onQuickDone,
  showProject = true,
  showNextStep = false,
  compact = false,
  draggable = false,
  onDragStart,
}: TaskCardProps) {
  const isDone = task.status === "done";
  const isBlocked = task.status === "blocked" || task.status === "waiting";
  const pCfg = priorityConfig[task.priority] || priorityConfig.normal;

  return (
    <div
      className={`group flex items-start gap-2 px-3 py-2 rounded-lg border transition-all cursor-pointer
        ${isDone ? "border-border/30 bg-muted/30 opacity-70" : "border-border/50 bg-background hover:border-border hover:shadow-sm"}
        ${isBlocked ? "border-l-2 border-l-red-400" : ""}
        ${task.status === "in_progress" ? "border-l-2 border-l-amber-400" : ""}
      `}
      onClick={() => onOpenDrawer?.(task)}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, task)}
      data-testid={`task-card-${task.id}`}
    >
      <button
        className={`mt-0.5 shrink-0 transition-colors ${isDone ? "text-emerald-500" : "text-muted-foreground/40 hover:text-emerald-500"}`}
        onClick={(e) => {
          e.stopPropagation();
          if (isDone) {
            onStatusChange?.(task.id, "planned");
          } else {
            onQuickDone?.(task);
          }
        }}
        data-testid={`button-toggle-done-${task.id}`}
      >
        {isDone ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-sm leading-tight flex-1 ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}
            data-testid={`text-task-title-${task.id}`}
          >
            {task.title}
          </span>
        </div>

        {(showNextStep && task.nextStep) && (
          <p className="text-[11px] text-primary mt-0.5 truncate" data-testid={`text-next-step-${task.id}`}>
            → {task.nextStep}
          </p>
        )}

        {!compact && (
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <PriorityBadge priority={task.priority} />
            {task.status !== "done" && <StatusLabel status={task.status} />}
            {task.isRecurring && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-purple-600">
                <Repeat className="h-2.5 w-2.5" />
              </span>
            )}
            {showProject && task.projectName && (
              <Link
                href={`/project/${encodeURIComponent(task.projectName)}`}
                className="text-[10px] text-primary hover:underline truncate max-w-[100px]"
                onClick={(e) => e.stopPropagation()}
                data-testid={`link-task-project-${task.id}`}
              >
                {task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
              </Link>
            )}
            {task.department && (
              <span className="text-[10px] text-muted-foreground">{task.department}</span>
            )}
            {isBlocked && task.blockedReason && (
              <span className="text-[10px] text-red-500 truncate max-w-[120px]" title={task.blockedReason}>
                <AlertCircle className="h-2.5 w-2.5 inline mr-0.5" />
                {task.blockedReason}
              </span>
            )}
          </div>
        )}

        {compact && (
          <div className="flex items-center gap-1 mt-0.5">
            <PriorityDot priority={task.priority} />
            {task.isRecurring && <Repeat className="h-2.5 w-2.5 text-purple-500" />}
          </div>
        )}
      </div>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {task.status !== "in_progress" && !isDone && task.status !== "cancelled" && (
          <Button
            variant="ghost" size="sm"
            className="h-6 w-6 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
            onClick={(e) => { e.stopPropagation(); onStatusChange?.(task.id, "in_progress"); }}
            title="Start"
            data-testid={`button-start-${task.id}`}
          >
            <Play className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost" size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); onOpenDrawer?.(task); }}
          title="Details"
          data-testid={`button-details-${task.id}`}
        >
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
