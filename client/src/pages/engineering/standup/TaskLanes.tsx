import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowRight, AlertTriangle, Calendar, GripVertical } from "lucide-react";
import { type EngTask, STANDUP_LANES } from "./types";

interface TaskLanesProps {
  tasks: EngTask[];
  onMoveTask: (taskId: number, newStatus: string, holdReason?: string, blockedType?: string) => void;
  isLoading: boolean;
}

function priorityBadge(priority: string | null) {
  if (!priority) return null;
  const colors: Record<string, string> = {
    Urgent: "bg-red-100 text-red-700 border-red-200",
    High: "bg-orange-100 text-orange-700 border-orange-200",
    Med: "bg-amber-100 text-amber-700 border-amber-200",
    Low: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return <Badge variant="outline" className={`text-[9px] px-1 py-0 ${colors[priority] || ""}`}>{priority}</Badge>;
}

function TaskCard({ task, onMove }: { task: EngTask; onMove: (status: string) => void }) {
  const isOverdue = task.endDate && new Date(task.endDate) < new Date() && task.status !== "COMPLETE";
  const daysHeld = task.holdReason ? "held" : null;

  return (
    <Card className="hover:shadow-sm transition-shadow group cursor-pointer">
      <CardContent className="p-2.5 space-y-1.5">
        <div className="flex items-start gap-1.5">
          <span className="text-xs font-medium leading-tight flex-1">{task.title}</span>
          {priorityBadge(task.priority)}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-[9px] px-1 py-0">{task.workstream}</Badge>
          {task.projectName && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{task.projectName}</span>
          )}
          {isOverdue && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-600 border-red-200">
              <Calendar className="h-2.5 w-2.5 mr-0.5" /> Overdue
            </Badge>
          )}
          {task.status === "HOLD" && task.holdReason && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-600 border-red-200">
              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> {task.holdReason.slice(0, 30)}
            </Badge>
          )}
        </div>
        {/* Quick-move buttons on hover */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
          {STANDUP_LANES.filter(l => l.key !== task.status).map(lane => (
            <button
              key={lane.key}
              onClick={(e) => { e.stopPropagation(); onMove(lane.key); }}
              className="text-[9px] px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors flex items-center gap-0.5"
            >
              <ArrowRight className="h-2.5 w-2.5" /> {lane.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function TaskLanes({ tasks, onMoveTask, isLoading }: TaskLanesProps) {
  const [holdDialog, setHoldDialog] = useState<{ taskId: number; taskTitle: string } | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [blockedType, setBlockedType] = useState("External");

  function handleMove(taskId: number, newStatus: string) {
    if (newStatus === "HOLD") {
      const task = tasks.find(t => t.id === taskId);
      setHoldDialog({ taskId, taskTitle: task?.title || "" });
      setHoldReason("");
      setBlockedType("External");
      return;
    }
    onMoveTask(taskId, newStatus);
  }

  function confirmHold() {
    if (!holdDialog || !holdReason.trim()) return;
    onMoveTask(holdDialog.taskId, "HOLD", holdReason, blockedType);
    setHoldDialog(null);
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-3 flex-1">
        {STANDUP_LANES.map(lane => (
          <div key={lane.key} className={`rounded-lg border ${lane.border} ${lane.color} p-3`}>
            <div className="text-xs font-medium text-muted-foreground mb-2">{lane.label}</div>
            <div className="space-y-2">
              {[1, 2].map(i => (
                <div key={i} className="h-16 rounded bg-muted/50 animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-4 gap-3 flex-1 min-h-0">
        {STANDUP_LANES.map(lane => {
          const laneTasks = tasks.filter(t => t.status === lane.key);
          return (
            <div key={lane.key} className={`rounded-lg border ${lane.border} ${lane.color} p-2.5 flex flex-col`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide">{lane.label}</span>
                <Badge variant="secondary" className="text-[10px] h-5 min-w-[20px] justify-center">
                  {laneTasks.length}
                </Badge>
              </div>
              <div className="space-y-2 flex-1 overflow-y-auto max-h-[340px]">
                {laneTasks.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-4">No tasks</p>
                ) : laneTasks.map(task => (
                  <TaskCard key={task.id} task={task} onMove={(status) => handleMove(task.id, status)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hold reason dialog */}
      <Dialog open={!!holdDialog} onOpenChange={(v) => { if (!v) setHoldDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Move to Hold</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{holdDialog?.taskTitle}</p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Blocker Reason *</Label>
              <Input
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="e.g., Waiting on Eskom approval letter"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Blocked By</Label>
              <Select value={blockedType} onValueChange={setBlockedType}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="External">External (client, authority, supplier)</SelectItem>
                  <SelectItem value="Internal">Internal (team, resource, dependency)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldDialog(null)}>Cancel</Button>
            <Button onClick={confirmHold} disabled={!holdReason.trim()} variant="destructive">
              Move to Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
