import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowRight, AlertTriangle, Calendar, Pencil, X } from "lucide-react";
import { type EngTask, STANDUP_LANES } from "./types";

interface TaskLanesProps {
  tasks: EngTask[];
  onMoveTask: (taskId: number, newStatus: string, holdReason?: string, blockedType?: string) => void;
  onEditTask?: (taskId: number, updates: Partial<EngTask>) => Promise<void>;
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

function TaskCard({ task, onMove, onEdit }: { task: EngTask; onMove: (status: string) => void; onEdit: () => void }) {
  const isOverdue = task.endDate && new Date(task.endDate) < new Date() && task.status !== "COMPLETE";

  return (
    <Card
      className="hover:shadow-sm transition-shadow group cursor-pointer"
      onClick={onEdit}
      data-testid={`task-card-${task.id}`}
    >
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
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
          {STANDUP_LANES.filter(l => l.key !== task.status).map(lane => (
            <button
              key={lane.key}
              onClick={(e) => { e.stopPropagation(); onMove(lane.key); }}
              className="text-[9px] px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors flex items-center gap-0.5"
              data-testid={`move-task-${task.id}-${lane.key}`}
            >
              <ArrowRight className="h-2.5 w-2.5" /> {lane.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const PRIORITIES = ["Urgent", "High", "Med", "Low"];
const STATUSES = ["TO DO", "IN PROGRESS", "HOLD", "COMPLETE"];

function TaskEditDialog({
  task,
  open,
  onClose,
  onSave,
}: {
  task: EngTask;
  open: boolean;
  onClose: () => void;
  onSave: (updates: Partial<EngTask>) => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [priority, setPriority] = useState(task.priority || "Med");
  const [status, setStatus] = useState(task.status);
  const [endDate, setEndDate] = useState(task.endDate || "");
  const [percentComplete, setPercentComplete] = useState<number>(task.percentComplete ?? 0);
  const [holdReason, setHoldReason] = useState(task.holdReason || "");
  const [blockedType, setBlockedType] = useState(task.blockedType || "External");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const updates: Record<string, unknown> = {};
    if (title !== task.title) updates.title = title;
    if (description !== (task.description || "")) updates.description = description;
    if (priority !== task.priority) updates.priority = priority;
    if (status !== task.status) updates.status = status;
    if (endDate !== (task.endDate || "")) updates.endDate = endDate || null;
    if (percentComplete !== (task.percentComplete ?? 0)) updates.percentComplete = percentComplete;
    if (status === "HOLD") {
      updates.holdReason = holdReason;
      updates.blockedType = blockedType;
    }
    if (status !== "HOLD" && task.status === "HOLD") {
      updates.holdReason = null;
      updates.blockedType = null;
    }
    try {
      await onSave(updates as Partial<EngTask>);
      onClose();
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Edit Task
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs font-medium">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1"
              data-testid="input-task-title"
            />
          </div>
          <div>
            <Label className="text-xs font-medium">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 min-h-[60px]"
              placeholder="Task description..."
              data-testid="input-task-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1 h-9" data-testid="select-task-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="mt-1 h-9" data-testid="select-task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium">Due Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1"
                data-testid="input-task-due-date"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">% Complete</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={percentComplete}
                onChange={(e) => setPercentComplete(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                className="mt-1"
                data-testid="input-task-percent"
              />
            </div>
          </div>
          {status === "HOLD" && (
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3 space-y-3">
              <div>
                <Label className="text-xs font-medium text-red-700">Blocker Reason *</Label>
                <Input
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  placeholder="e.g., Waiting on Eskom approval letter"
                  className="mt-1"
                  data-testid="input-task-hold-reason"
                />
              </div>
              <div>
                <Label className="text-xs font-medium text-red-700">Blocked By</Label>
                <Select value={blockedType} onValueChange={setBlockedType}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="External">External (client, authority, supplier)</SelectItem>
                    <SelectItem value="Internal">Internal (team, resource, dependency)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {task.projectName && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">Project:</span> {task.projectName}
            </div>
          )}
        </div>
        {saveError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{saveError}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} data-testid="button-cancel-edit">Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !title.trim() || (status === "HOLD" && !holdReason.trim())}
            data-testid="button-save-task"
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaskLanes({ tasks, onMoveTask, onEditTask, isLoading }: TaskLanesProps) {
  const [holdDialog, setHoldDialog] = useState<{ taskId: number; taskTitle: string } | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [blockedType, setBlockedType] = useState("External");
  const [editingTask, setEditingTask] = useState<EngTask | null>(null);

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

  async function handleEditSave(updates: Partial<EngTask>) {
    if (!editingTask || !onEditTask) return;
    await onEditTask(editingTask.id, updates);
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
                  <TaskCard
                    key={task.id}
                    task={task}
                    onMove={(status) => handleMove(task.id, status)}
                    onEdit={() => setEditingTask(task)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {holdDialog && (
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
      )}

      {editingTask && (
        <TaskEditDialog
          task={editingTask}
          open={!!editingTask}
          onClose={() => setEditingTask(null)}
          onSave={handleEditSave}
        />
      )}
    </>
  );
}
