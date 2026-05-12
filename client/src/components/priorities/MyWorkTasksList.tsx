/**
 * MyWorkTasksList — renders the "tasks" half of the unified My-Work feed
 * served by GET /api/priorities/my-work.
 *
 * Used by the My tab on /priorities to surface every work_item the caller
 * owns or is assigned to. Each row exposes a "Promote to priority" action
 * that calls POST /api/priorities/from-task/:workItemId — the resulting
 * priority joins the priorities list above and the task disappears from
 * this list on the next refetch (suppressed via linkedTaskId).
 *
 * Layout mirrors PriorityCard: same card width, same left-border colour
 * convention (severity / urgency), same due-date affordance. The whole
 * unified surface should read as one feed at a glance.
 */

import { useState } from "react";
import { Link } from "wouter";
import { ArrowUp, Briefcase, CheckCircle2, Clock, ListTodo } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface MyWorkTaskRow {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  dueDate: string | null;
  startDate: string | null;
  projectId: number | null;
  projectName: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  workstream: string;
  source: string;
  taskCategory: string | null;
  bucket: string | null;
  percentComplete: number;
  createdAt: string;
  updatedAt: string;
}

const PRIORITY_BORDER: Record<string, string> = {
  critical: "border-l-red-500",
  high: "border-l-amber-500",
  normal: "border-l-slate-300",
  low: "border-l-slate-200",
};

function daysRemaining(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const due = Date.parse(dateStr + "T00:00:00Z");
  const today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(due) || Number.isNaN(today)) return null;
  return Math.ceil((due - today) / 86_400_000);
}

export interface MyWorkTasksListProps {
  tasks: MyWorkTaskRow[];
  onPromote: (taskId: number) => Promise<void> | void;
  promotingId: number | null;
  emptyMessage?: string;
}

export function MyWorkTasksList({ tasks, onPromote, promotingId, emptyMessage }: MyWorkTasksListProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-3 px-4 border rounded-lg bg-muted/20">
        {emptyMessage ?? "No outstanding tasks assigned to you."}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="my-work-tasks-list">
      {tasks.map((t) => (
        <MyWorkTaskCard
          key={t.id}
          task={t}
          onPromote={onPromote}
          isPromoting={promotingId === t.id}
        />
      ))}
    </div>
  );
}

interface MyWorkTaskCardProps {
  task: MyWorkTaskRow;
  onPromote: (taskId: number) => Promise<void> | void;
  isPromoting: boolean;
}

function MyWorkTaskCard({ task, onPromote, isPromoting }: MyWorkTaskCardProps) {
  const [hoverPromote, setHoverPromote] = useState(false);
  const days = daysRemaining(task.dueDate);
  const isOverdue = days !== null && days < 0;
  const borderClass =
    isOverdue ? "border-l-red-500"
    : PRIORITY_BORDER[String(task.priority || "normal").toLowerCase()]
    ?? "border-l-slate-300";
  const isDone = String(task.status || "").toLowerCase() === "complete"
    || String(task.status || "").toLowerCase() === "completed";

  return (
    <Card className={`border-l-4 ${borderClass}`} data-testid={`my-work-task-${task.id}`}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <ListTodo className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className={`text-sm font-medium truncate ${isDone ? "line-through text-muted-foreground" : ""}`}>
                {task.title}
              </span>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                task
              </Badge>
              {task.priority && (
                <Badge variant="outline" className="text-[10px]">
                  {task.priority}
                </Badge>
              )}
            </div>
            {task.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
            )}
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
              {task.projectName && task.projectId && (
                <Link
                  href={`/project/id/${task.projectId}`}
                  className="inline-flex items-center gap-1 hover:underline"
                  data-testid={`my-work-task-${task.id}-project`}
                >
                  <Briefcase className="h-3 w-3" />
                  {task.projectName}
                </Link>
              )}
              {task.dueDate && (
                <span className={`inline-flex items-center gap-1 ${isOverdue ? "text-red-600 font-medium" : ""}`}>
                  <Clock className="h-3 w-3" />
                  due {task.dueDate}
                  {days !== null && (
                    <span className="ml-1">
                      ({days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `${days}d`})
                    </span>
                  )}
                </span>
              )}
              {typeof task.percentComplete === "number" && task.percentComplete > 0 && (
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {Math.round(task.percentComplete)}%
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 flex flex-col gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={isPromoting}
              onClick={() => void onPromote(task.id)}
              onMouseEnter={() => setHoverPromote(true)}
              onMouseLeave={() => setHoverPromote(false)}
              title="Promote this task to a personal priority — it joins your My Priorities list and gains the escalate chain."
              data-testid={`my-work-task-${task.id}-promote`}
            >
              <ArrowUp className="h-3 w-3 mr-1" />
              {isPromoting ? "Promoting…" : hoverPromote ? "Promote" : "Make priority"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
