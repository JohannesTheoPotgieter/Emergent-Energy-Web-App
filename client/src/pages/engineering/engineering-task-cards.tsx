/**
 * Engineering task card cluster — extracted verbatim from EngineeringTasksPage
 * (UI/UX audit module split). Behaviour-preserving mechanical move.
 *
 * Contains the cohesive card/column unit:
 *   QuickStatusSelect, QuickEditPopover, getTaskContextBadges,
 *   MoveCardMenu, TaskCard, KanbanColumn.
 *
 * These are self-contained, prop-driven components with no dependency on
 * EngineeringTasksPage orchestrator state.
 */
import { useState, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import {
  Loader2,
  Calendar,
  AlertTriangle,
  Clock,
  Circle,
  Send,
  Check,
  Edit3,
  Eye,
  EyeOff,
  Pencil,
  PauseCircle,
  ArrowRightLeft,
  CornerDownRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  TASK_STATUSES,
  getTaskStatusColumnClass,
  getTaskStatusLabel,
  getVisibleStatusesForView,
  isTaskComplete,
} from "@/lib/task-status";
import type { Task } from "@/components/tasks/types";
import { formatDateShort, isOverdue, isDueThisWeek, daysLabel, getAvatarColor, getInitials, sortTasksForColumn } from "@/lib/task-formatters";
import { invalidateEngineeringTicketCaches } from "@/lib/task-cache";
import { canonicalizeTaskStatus } from "@/lib/task-status-compat";
import {
  TASK_PRIORITY_LABELS,
  normalizeTaskPriority,
  taskPriorityLabel,
  taskPriorityBadgeClass,
  taskPriorityBorderClass,
} from "@shared/task-priorities";
import { engFetch } from "@/lib/eng-fetch";
import { PRIORITIES } from "./task-filter-config";
import { SubtaskChip } from "./spine/task-list-affordances";

export function QuickStatusSelect({ task, onStatusChange }: { task: Task; onStatusChange: (id: number, status: string) => void }) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <SearchableSelect
        value={task.status}
        onValueChange={(v) => {
          if (v !== task.status) onStatusChange(task.id, v);
        }}
        placeholder="Status"
        triggerClassName="h-6 text-[9px] px-1.5 w-auto min-w-0 border-none shadow-none bg-transparent hover:bg-muted/40"
        options={TASK_STATUSES.map(s => ({ value: s, label: getTaskStatusLabel(s) }))}
        data-testid={`quick-status-${task.id}`}
      />
    </div>
  );
}

export function QuickEditPopover({ task, onDueDateChange, onClose }: { task: Task; onDueDateChange: (id: number, date: string) => void; onClose: () => void }) {
  const [noteText, setNoteText] = useState("");
  const [posting, setPosting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handlePostNote = async () => {
    if (!noteText.trim()) return;
    setPosting(true);
    try {
      await engFetch(`/api/eng/tasks/${task.id}/comments`, { method: "POST", body: JSON.stringify({ body: noteText.trim() }) });
      invalidateEngineeringTicketCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
      toast({ title: "Note added" });
      setNoteText("");
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-2.5 p-1" data-testid={`quick-edit-${task.id}`}>
      <div className="flex items-center gap-2">
        <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] text-muted-foreground w-12">Due:</span>
        <input
          type="date"
          defaultValue={task.dueDate?.split("T")[0] || ""}
          onChange={(e) => onDueDateChange(task.id, e.target.value)}
          className="flex-1 h-7 text-xs border rounded px-2 bg-background"
          onClick={(e) => e.stopPropagation()}
          data-testid={`quick-edit-due-${task.id}`}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Edit3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] text-muted-foreground">Quick note:</span>
        </div>
        <div className="flex gap-1.5">
          <Input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a quick note..."
            className="h-7 text-xs flex-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Enter") handlePostNote(); }}
            data-testid={`quick-edit-note-${task.id}`}
          />
          <Button
            size="sm"
            className="h-7 px-2 text-[10px]"
            disabled={!noteText.trim() || posting}
            onClick={(e) => { e.stopPropagation(); handlePostNote(); }}
            data-testid={`quick-edit-note-send-${task.id}`}
          >
            {posting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function getTaskContextBadges(task: Task): Array<{ label: string; className: string }> {
  const badges: Array<{ label: string; className: string }> = [];
  if (task.planLinkUrgent) {
    // Plan deadline near or passed — amber for upcoming, red for overdue.
    const overdueByPlan = isOverdue(task.dueDate, task.status);
    badges.push({
      label: "Urgent · plan",
      className: overdueByPlan
        ? "bg-red-50 text-red-700 border-red-200"
        : "bg-amber-50 text-amber-700 border-amber-200",
    });
  }
  if (task.isBlocked || task.holdReason) {
    badges.push({ label: "Blocked", className: "bg-red-50 text-red-700 border-red-200" });
  }
  if (task.isReviewNeeded) {
    badges.push({ label: "Review", className: "bg-violet-50 text-violet-700 border-violet-200" });
  }
  if (task.isApprovalPending) {
    badges.push({ label: "Approval", className: "bg-amber-50 text-amber-700 border-amber-200" });
  }
  if ((task.projectLinkedDeliverableCount || 0) > 0) {
    badges.push({
      label: `${task.projectLinkedDeliverableCount} deliverable${task.projectLinkedDeliverableCount === 1 ? "" : "s"}`,
      className: "bg-blue-50 text-blue-700 border-blue-200",
    });
  }
  if ((task.microsoftActionRequiredCount || 0) > 0) {
    badges.push({
      label: `${task.microsoftActionRequiredCount} MS action${task.microsoftActionRequiredCount === 1 ? "" : "s"}`,
      className: "bg-cyan-50 text-cyan-700 border-cyan-200",
    });
  } else if (task.hasMicrosoftContext) {
    badges.push({ label: "MS linked", className: "bg-cyan-50 text-cyan-700 border-cyan-200" });
  }
  return badges;
}

/**
 * Keyboard-operable alternative to drag-and-drop (UI/UX audit X4). The board
 * is otherwise pointer-only; this menu lets any keyboard user move a card
 * between status columns. It is always rendered (not hover-gated) so it is
 * reachable by Tab. The status vocabulary is the canonical board view set.
 */
export function MoveCardMenu({
  task,
  onStatusChange,
  size = "default",
}: {
  task: Task;
  onStatusChange: (id: number, status: string) => void;
  size?: "default" | "sm";
}) {
  const currentCanonical = canonicalizeTaskStatus(task.status);
  const targets = getVisibleStatusesForView("board").filter((s) => s !== currentCanonical);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={`inline-flex items-center gap-1 rounded border border-border bg-card font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${size === "sm" ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-1"}`}
          aria-label={`Move task "${task.title}" to another status column`}
          data-testid={`btn-move-card-${task.id}`}
        >
          <ArrowRightLeft className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
          Move
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-[11px]">Move to status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {targets.map((status) => (
          <DropdownMenuItem
            key={status}
            onSelect={() => onStatusChange(task.id, status)}
            data-testid={`move-card-${task.id}-${status}`}
          >
            {getTaskStatusLabel(status)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskCard({ task, onClick, onStatusChange, onPriorityChange, onDueDateChange, compact, selected, onToggleSelect }: {
  task: Task; onClick: () => void; onStatusChange: (id: number, status: string) => void;
  onPriorityChange?: (id: number, priority: string) => void;
  onDueDateChange?: (id: number, date: string) => void;
  compact?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
}) {
  const [quickEditOpen, setQuickEditOpen] = useState(false);
  const { user } = useAuth();
  const dragStartedRef = useRef(false);

  const handleCardClick = () => {
    if (dragStartedRef.current) {
      dragStartedRef.current = false;
      return;
    }
    onClick();
  };
  // X4 a11y: the card is the primary affordance to open task detail. Make it
  // operable from the keyboard (Enter / Space) since drag-and-drop and the
  // pointer onClick alone are inaccessible. Ignore the keystroke when it
  // originates from a nested interactive control (its own handler runs).
  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };
  const overdue = isOverdue(task.dueDate, task.status);
  const dueSoon = isDueThisWeek(task.dueDate, task.status);
  const projectDisplay = task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
  const isViewingOnly = user && task.assigneeUserId && task.assigneeUserId !== user.id;
  const label = daysLabel(task.dueDate);
  const isCritical = normalizeTaskPriority(task.priority) === "Urgent";
  const assigneeNames = task.assignees || task.resolvedAssignees?.map((user) => user.name) || [];
  const contextBadges = getTaskContextBadges(task);

  if (compact) {
    return (
      <div
        draggable
        onDragStart={(e) => { dragStartedRef.current = true; e.dataTransfer.setData("taskId", String(task.id)); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setTimeout(() => { dragStartedRef.current = false; }, 0); }}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        role="button"
        tabIndex={0}
        aria-label={`Open task: ${task.title}`}
        className={`bg-card border-l-[3px] border border-b-border border-r-border border-t-border rounded px-2 py-1.5 cursor-pointer hover:shadow-sm transition-all group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          ${taskPriorityBorderClass(task.priority)}
          ${overdue ? "bg-red-50/60" : ""}
        `}
        data-testid={`kanban-card-${task.id}`}
      >
        <div className="flex items-center gap-1.5">
          <h4 className="text-[11px] font-medium leading-tight truncate flex-1 min-w-0" data-testid={`text-card-title-${task.id}`}>{task.title}</h4>
          {isViewingOnly && <span className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0 rounded text-[8px] font-medium border bg-sky-50 border-sky-200 text-sky-700"><Eye className="h-2 w-2" />Viewing</span>}
          {overdue && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />}
          {!overdue && dueSoon && <Clock className="h-3 w-3 text-amber-500 shrink-0" />}
          {assigneeNames.length > 0 && (
            <div className={`w-4 h-4 rounded-full ${getAvatarColor(assigneeNames[0])} flex items-center justify-center text-[7px] font-bold text-white shrink-0`} title={assigneeNames[0]}>
              {getInitials(assigneeNames[0])}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[9px] text-muted-foreground/60 truncate flex-1">{projectDisplay}</span>
          <SubtaskChip total={task.subtaskTotal ?? 0} done={task.subtaskDone ?? 0} />
          {task.dueDate && <span className={`text-[9px] ${overdue ? "text-red-600 font-bold" : "text-muted-foreground"}`}>{label || formatDateShort(task.dueDate)}</span>}
        </div>
        {task.parentTaskTitle && (
          <div className="flex items-center gap-1 mt-0.5">
            <CornerDownRight className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
            <span className="text-[8px] text-muted-foreground/50 truncate">Sub-task of {task.parentTaskTitle}</span>
          </div>
        )}
        {onStatusChange && (
          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <MoveCardMenu task={task} onStatusChange={onStatusChange} size="sm" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        dragStartedRef.current = true;
        e.dataTransfer.setData("taskId", String(task.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => { setTimeout(() => { dragStartedRef.current = false; }, 0); }}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open task: ${task.title}`}
      className={`bg-card border-l-[3px] border border-b-border border-r-border border-t-border rounded-md px-2.5 py-2 cursor-pointer hover:shadow-md hover:translate-y-[-1px] transition-all duration-150 group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
        ${taskPriorityBorderClass(task.priority)}
        ${overdue ? "bg-red-50/60 border-r-red-200 border-t-red-200 border-b-red-200" : ""}
        ${isCritical && !overdue ? "bg-orange-50/30" : ""}
        ${selected ? "ring-2 ring-blue-500 bg-blue-50/40" : ""}
      `}
      data-testid={`kanban-card-${task.id}`}
    >
      <div className="flex items-start gap-1.5 mb-1">
        {onToggleSelect && (
          <button
            type="button"
            role="checkbox"
            aria-checked={!!selected}
            aria-label={`Select task: ${task.title}`}
            className={`w-4 h-4 mt-0.5 rounded border shrink-0 flex items-center justify-center transition-colors focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 opacity-0 group-hover:opacity-100 hover:border-blue-400"}`}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(task.id); }}
            data-testid={`select-task-${task.id}`}
          >
            {selected && <Check className="h-2.5 w-2.5" />}
          </button>
        )}
        <h4 className="text-[13px] font-medium leading-snug line-clamp-2 flex-1 min-w-0" data-testid={`text-card-title-${task.id}`}>
          {task.title}
        </h4>
        {isViewingOnly && <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border bg-sky-50 border-sky-200 text-sky-700 mt-0.5"><Eye className="h-2.5 w-2.5" />Viewing</span>}
        <div className="flex items-center gap-0.5 shrink-0">
          {task.trackingRag && task.trackingRag !== "Green" && (
            <div className={`w-2 h-2 rounded-full mt-1.5 ${task.trackingRag === "Amber" ? "bg-amber-500" : task.trackingRag === "Red" ? "bg-red-500 animate-pulse" : "bg-gray-400"}`} title={`RAG: ${task.trackingRag}`} />
          )}
          {onDueDateChange && (
            <Popover open={quickEditOpen} onOpenChange={setQuickEditOpen}>
              <PopoverTrigger asChild>
                <button
                  className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted transition-all"
                  onClick={(e) => { e.stopPropagation(); }}
                  title="Quick edit"
                  aria-label={`Quick edit task: ${task.title}`}
                  data-testid={`btn-quick-edit-${task.id}`}
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2.5" align="end" onClick={(e) => e.stopPropagation()}>
                <QuickEditPopover task={task} onDueDateChange={onDueDateChange} onClose={() => setQuickEditOpen(false)} />
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/70 mb-0.5 truncate">{projectDisplay}</p>
      {task.parentTaskTitle && (
        <div className="flex items-center gap-1 mb-1.5">
          <CornerDownRight className="h-2.5 w-2.5 text-violet-400 shrink-0" />
          <span className="text-[10px] text-violet-600/70 truncate max-w-[200px]">{task.parentTaskTitle}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <div onClick={(e) => e.stopPropagation()}>
          {onPriorityChange ? (
            <SearchableSelect
              value={task.priority}
              onValueChange={(v) => { if (v !== task.priority) onPriorityChange(task.id, v); }}
              placeholder="Priority"
              triggerClassName="h-5 text-[9px] px-0 w-auto min-w-0 border-none shadow-none bg-transparent p-0 gap-0"
              options={PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
              data-testid={`card-priority-${task.id}`}
            />
          ) : (
            <Badge className={`text-[9px] px-1.5 py-0 leading-tight ${taskPriorityBadgeClass(task.priority)}`}>
              {taskPriorityLabel(task.priority)}
            </Badge>
          )}
        </div>
        {task.dueDate && (
          <span className={`text-[10px] flex items-center gap-0.5 font-medium px-1 py-0 rounded
            ${overdue ? "text-red-700 bg-red-100" : dueSoon ? "text-amber-700 bg-amber-50" : "text-muted-foreground"}`}
          >
            {overdue && <AlertTriangle className="h-3 w-3 shrink-0" />}
            {!overdue && dueSoon && <Clock className="h-3 w-3 shrink-0" />}
            {!overdue && !dueSoon && <Calendar className="h-2.5 w-2.5 shrink-0" />}
            {label || formatDateShort(task.dueDate)}
          </span>
        )}
        {task.percentComplete > 0 && task.percentComplete < 100 && (
          <span className="text-[9px] text-muted-foreground font-medium">{Math.round(task.percentComplete)}%</span>
        )}
        <SubtaskChip total={task.subtaskTotal ?? 0} done={task.subtaskDone ?? 0} />
      </div>

      {contextBadges.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {contextBadges.map((badge) => (
            <Badge key={badge.label} variant="outline" className={`text-[9px] px-1.5 py-0 ${badge.className}`}>
              {badge.label}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0">
          {assigneeNames.length > 0 ? (
            <div className="flex items-center gap-1 min-w-0">
              <div className="flex -space-x-1">
                {assigneeNames.slice(0, 2).map((name, i) => (
                  <div key={i} className={`w-5 h-5 rounded-full ${getAvatarColor(name)} flex items-center justify-center text-[8px] font-bold text-white ring-1 ring-card`} title={name}>
                    {getInitials(name)}
                  </div>
                ))}
                {assigneeNames.length > 2 && (
                  <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center text-[8px] font-bold text-muted-foreground ring-1 ring-card">
                    +{assigneeNames.length - 2}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground truncate max-w-[70px]">{assigneeNames[0]?.split(" ")[0]}</span>
            </div>
          ) : (
            <span className="text-[10px] text-muted-foreground/40 italic">Unassigned</span>
          )}
        </div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <QuickStatusSelect task={task} onStatusChange={onStatusChange} />
        </div>
      </div>

      {task.holdReason && (
        <div className="mt-1.5 px-1.5 py-1 bg-red-50 rounded text-[10px] text-red-600 flex items-center gap-1 border border-red-100">
          <PauseCircle className="h-3 w-3 shrink-0" />
          {task.blockedType && <span className={`px-1 py-0 rounded text-[9px] font-bold ${task.blockedType === "External" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"}`}>{task.blockedType}</span>}
          <span className="truncate">{task.holdReason}</span>
        </div>
      )}

      {/* Quick actions + keyboard column-move (X4). Always rendered (not
          hover-gated) so the move affordance is reachable by Tab — drag-and-
          drop alone was the only path to move a card between columns. */}
      {onStatusChange && (() => {
        const canonical = canonicalizeTaskStatus(task.status);
        return (
          <div className="mt-1.5 pt-1.5 border-t border-dashed flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {canonical !== "in_progress" && (
              <button type="button" className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onStatusChange(task.id, "in_progress")} data-testid={`quick-start-${task.id}`}>
                Start
              </button>
            )}
            {canonical !== "complete" && canonical !== "needs_approval" && (
              <button type="button" className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 hover:bg-purple-100 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onStatusChange(task.id, "needs_approval")} data-testid={`quick-submit-${task.id}`}>
                Submit
              </button>
            )}
            {canonical !== "complete" && (
              <button type="button" className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onStatusChange(task.id, "complete")} data-testid={`quick-done-${task.id}`}>
                Done
              </button>
            )}
            <MoveCardMenu task={task} onStatusChange={onStatusChange} size="sm" />
          </div>
        );
      })()}
    </div>
  );
}

export function KanbanColumn({
  status, tasks, onDrop, onCardClick, onStatusChange, onPriorityChange, onDueDateChange, compact, collapsed, onToggleCollapse, totalTasks, selectedTaskIds, onToggleSelect,
}: {
  status: string; tasks: Task[]; onDrop: (taskId: number, newStatus: string) => void; onCardClick: (task: Task) => void; onStatusChange: (id: number, status: string) => void; onPriorityChange?: (id: number, priority: string) => void;
  onDueDateChange?: (id: number, date: string) => void; compact?: boolean; collapsed?: boolean; onToggleCollapse?: () => void; totalTasks?: number;
  selectedTaskIds?: Set<number>; onToggleSelect?: (id: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const sorted = useMemo(() => sortTasksForColumn(tasks), [tasks]);
  const overdueCount = useMemo(() => tasks.filter(t => isOverdue(t.dueDate, t.status)).length, [tasks]);
  const criticalCount = useMemo(() => tasks.filter(t => normalizeTaskPriority(t.priority) === "Urgent").length, [tasks]);
  const pct = totalTasks ? Math.round((tasks.length / totalTasks) * 100) : 0;

  if (collapsed) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`Expand ${getTaskStatusLabel(status)} column (${tasks.length} tasks)`}
        className={`flex flex-col items-center w-10 bg-muted/20 rounded-lg border-t-4 cursor-pointer hover:bg-muted/40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${getTaskStatusColumnClass(status)} ${dragOver ? "ring-2 ring-primary/40 bg-primary/5" : ""}`}
        onClick={onToggleCollapse}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleCollapse?.(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const taskId = parseInt(e.dataTransfer.getData("taskId"));
          if (taskId) onDrop(taskId, status);
        }}
        data-testid={`kanban-column-${status.toLowerCase().replace(/\s+/g, "-")}`}
        title={`${getTaskStatusLabel(status)} (${tasks.length}) — click to expand`}
      >
        <div className="pt-3 pb-1">
          <span className="text-[10px] font-bold text-muted-foreground" style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
            {getTaskStatusLabel(status)}
          </span>
        </div>
        <span className={`text-[10px] font-bold mt-1 px-1 py-0.5 rounded-full ${tasks.length > 0 ? "bg-primary/10 text-primary" : "text-muted-foreground/40"}`}>
          {tasks.length}
        </span>
        {overdueCount > 0 && (
          <span className="mt-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col min-w-[240px] max-w-[280px] flex-1 bg-muted/20 rounded-lg border-t-4 transition-all ${getTaskStatusColumnClass(status)} ${dragOver ? "ring-2 ring-primary/40 bg-primary/5" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const taskId = parseInt(e.dataTransfer.getData("taskId"));
        if (taskId) onDrop(taskId, status);
      }}
      data-testid={`kanban-column-${status.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="px-2.5 pt-2.5 pb-1.5 sticky top-0 bg-inherit z-10 rounded-t-lg">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">{getTaskStatusLabel(status)}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0 rounded-full ${tasks.length > 0 ? "bg-primary/10 text-primary" : "text-muted-foreground/40 bg-muted"}`}>{tasks.length}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {overdueCount > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">
                <AlertTriangle className="h-2.5 w-2.5" />
                {overdueCount}
              </span>
            )}
            {criticalCount > 0 && overdueCount === 0 && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full">
                {criticalCount}
              </span>
            )}
            {onToggleCollapse && (
              <button type="button" onClick={onToggleCollapse} className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted transition-colors" title="Collapse column" aria-label={`Collapse ${getTaskStatusLabel(status)} column`} data-testid={`collapse-col-${status}`}>
                <EyeOff className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${isTaskComplete(status) ? "bg-emerald-500" : status === "hold" ? "bg-red-400" : "bg-primary/40"}`} style={{ width: `${Math.max(pct, 1)}%` }} />
        </div>
      </div>
      <ScrollArea className="flex-1 px-1.5 pb-2" style={{ maxHeight: "calc(100vh - 280px)" }}>
        <div className="space-y-1.5">
          {sorted.map(task => (
            <TaskCard key={task.id} task={task} onClick={() => onCardClick(task)} onStatusChange={onStatusChange} onPriorityChange={onPriorityChange} onDueDateChange={onDueDateChange} compact={compact} selected={selectedTaskIds?.has(task.id)} onToggleSelect={onToggleSelect} />
          ))}
          {tasks.length === 0 && (
            <div className="text-center py-8 text-xs text-muted-foreground/50">
              <Circle className="h-5 w-5 mx-auto mb-1 opacity-30" />
              No tasks in this column
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
