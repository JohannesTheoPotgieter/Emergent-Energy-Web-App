/**
 * MyWorkTasksList renders the task-management half of the unified My Work feed
 * served by GET /api/priorities/my-work.
 *
 * The component is intentionally wired to the existing task APIs through its
 * callbacks: status updates, personal-task deletes, and promotion to a priority
 * remain owned by the parent page. This keeps the command center a real control
 * surface rather than a disconnected dashboard.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowUp,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Circle,
  Filter,
  KanbanSquare,
  LayoutList,
  ListChecks,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

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
  /** Canonical red/amber/green health signal from work_items.trackingRag. */
  trackingRag: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskLevel = "critical" | "important" | "normal";
export type TaskHealth = "critical" | "at_risk" | "healthy";
export type TaskFocusKey =
  | "all"
  | "today_overdue"
  | "blocked"
  | "project"
  | "personal"
  | "completed";
export type TaskSortKey = "dueDate" | "project" | "status" | "progress";
type TaskViewMode = "list" | "board" | "calendar";

export interface TaskCommandCenterOptions {
  today: string;
  query: string;
  focus: TaskFocusKey;
  sort: TaskSortKey;
}

export interface TaskCommandCenterMetrics {
  total: number;
  open: number;
  overdue: number;
  dueThisWeek: number;
  inProgress: number;
  blocked: number;
  completed: number;
  personal: number;
  project: number;
}

export interface TaskFocusBucket {
  key: Exclude<TaskFocusKey, "all">;
  label: string;
  detail: string;
  count: number;
}

export interface TaskCommandCenterModel {
  metrics: TaskCommandCenterMetrics;
  focusBuckets: TaskFocusBucket[];
  visibleTasks: MyWorkTaskRow[];
}

const TASK_STATUSES = [
  "Not Started",
  "In Progress",
  "Complete",
  "Blocked",
  "Cancelled",
] as const;

const STATUS_BADGE_CLASS: Record<string, string> = {
  "not started": "bg-slate-100 text-slate-700 border-slate-200",
  "in progress": "bg-blue-50 text-blue-700 border-blue-200",
  complete: "bg-emerald-50 text-emerald-700 border-emerald-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  blocked: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200 line-through",
};

const SORT_LABEL: Record<TaskSortKey, string> = {
  dueDate: "Due date",
  project: "Project",
  status: "Status",
  progress: "Progress",
};

export function taskLevel(task: { priority: string | null }): TaskLevel {
  const p = (task.priority ?? "").toLowerCase();
  if (p === "critical") return "critical";
  if (p === "high") return "important";
  return "normal";
}

export function taskHealth(task: {
  trackingRag: string | null;
  status: string;
  dueDate: string | null;
}): TaskHealth {
  const rag = (task.trackingRag ?? "").toLowerCase();
  if (rag === "red") return "critical";
  const status = normalizeStatus(task.status);
  if (status === "blocked" || status === "block") return "critical";
  if (rag === "amber" || rag === "yellow") return "at_risk";
  if (task.dueDate) {
    const due = parseDayStamp(task.dueDate);
    const today = parseDayStamp(new Date().toISOString().slice(0, 10));
    if (due !== null && today !== null && due < today && !isDoneStatus(status)) {
      return "at_risk";
    }
  }
  return "healthy";
}

/** True when a task is personal: no project, or explicitly personal bucket/workstream. */
export function isPersonalTask(t: MyWorkTaskRow): boolean {
  return (
    t.bucket === "personal" ||
    t.workstream === "PERSONAL" ||
    (!t.projectId && !t.projectName)
  );
}

export function taskProgressPercent(task: Pick<MyWorkTaskRow, "percentComplete" | "status">): number {
  const raw = Number(task.percentComplete ?? 0);
  if (!Number.isFinite(raw)) return 0;
  const normalized = raw > 0 && raw <= 1 ? raw * 100 : raw;
  const rounded = Math.round(Math.max(0, Math.min(100, normalized)));
  if (rounded === 0 && isDoneStatus(task.status)) return 100;
  return rounded;
}

export function buildTaskCommandCenterModel(
  tasks: MyWorkTaskRow[],
  options: TaskCommandCenterOptions,
): TaskCommandCenterModel {
  const metrics = buildMetrics(tasks, options.today);
  const focusBuckets: TaskFocusBucket[] = [
    {
      key: "today_overdue",
      label: "Today and overdue",
      detail: "Needs action first",
      count: countMatching(tasks, (task) => isTodayOrOverdue(task, options.today)),
    },
    {
      key: "blocked",
      label: "Waiting or blocked",
      detail: "Requires owner follow-up",
      count: countMatching(tasks, (task) => !isTerminalTask(task) && isBlockedTask(task)),
    },
    {
      key: "project",
      label: "Project tasks",
      detail: "Linked to live projects",
      count: countMatching(tasks, (task) => !isPersonalTask(task)),
    },
    {
      key: "personal",
      label: "Personal tasks",
      detail: "Private owner actions",
      count: countMatching(tasks, isPersonalTask),
    },
    {
      key: "completed",
      label: "Completed",
      detail: "Shown when closed items are included",
      count: metrics.completed,
    },
  ];

  const query = options.query.trim().toLowerCase();
  const visibleTasks = tasks
    .filter((task) => matchesFocus(task, options.focus, options.today))
    .filter((task) => matchesSearch(task, query))
    .sort((a, b) => compareTasks(a, b, options.sort));

  return { metrics, focusBuckets, visibleTasks };
}

function buildMetrics(tasks: MyWorkTaskRow[], today: string): TaskCommandCenterMetrics {
  return tasks.reduce<TaskCommandCenterMetrics>(
    (acc, task) => {
      const terminal = isTerminalTask(task);
      acc.total += 1;
      if (!terminal) acc.open += 1;
      if (isDoneStatus(task.status)) acc.completed += 1;
      if (isPersonalTask(task)) acc.personal += 1;
      else acc.project += 1;
      if (!terminal && isOverdue(task, today)) acc.overdue += 1;
      if (!terminal && isDueThisWeek(task, today)) acc.dueThisWeek += 1;
      if (!terminal && normalizeStatus(task.status) === "in progress") acc.inProgress += 1;
      if (!terminal && isBlockedTask(task)) acc.blocked += 1;
      return acc;
    },
    {
      total: 0,
      open: 0,
      overdue: 0,
      dueThisWeek: 0,
      inProgress: 0,
      blocked: 0,
      completed: 0,
      personal: 0,
      project: 0,
    },
  );
}

function countMatching(tasks: MyWorkTaskRow[], predicate: (task: MyWorkTaskRow) => boolean): number {
  return tasks.filter(predicate).length;
}

function matchesSearch(task: MyWorkTaskRow, query: string): boolean {
  if (!query) return true;
  return [
    task.title,
    task.description,
    task.projectName,
    task.ownerName,
    task.status,
    task.priority,
    task.taskCategory,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function matchesFocus(task: MyWorkTaskRow, focus: TaskFocusKey, today: string): boolean {
  if (focus === "all") return true;
  if (focus === "today_overdue") return isTodayOrOverdue(task, today);
  if (focus === "blocked") return !isTerminalTask(task) && isBlockedTask(task);
  if (focus === "project") return !isPersonalTask(task);
  if (focus === "personal") return isPersonalTask(task);
  if (focus === "completed") return isDoneStatus(task.status);
  return true;
}

function compareTasks(a: MyWorkTaskRow, b: MyWorkTaskRow, sort: TaskSortKey): number {
  if (sort === "project") {
    return compareText(a.projectName ?? "Personal", b.projectName ?? "Personal") || compareByDueDate(a, b);
  }
  if (sort === "status") {
    return compareText(a.status ?? "", b.status ?? "") || compareByDueDate(a, b);
  }
  if (sort === "progress") {
    return taskProgressPercent(b) - taskProgressPercent(a) || compareByDueDate(a, b);
  }
  return compareByDueDate(a, b);
}

function compareByDueDate(a: MyWorkTaskRow, b: MyWorkTaskRow): number {
  const aStamp = parseDayStamp(a.dueDate);
  const bStamp = parseDayStamp(b.dueDate);
  if (aStamp !== null && bStamp !== null && aStamp !== bStamp) return aStamp - bStamp;
  if (aStamp !== null && bStamp === null) return -1;
  if (aStamp === null && bStamp !== null) return 1;
  return compareText(a.title, b.title);
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function normalizeStatus(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

function isDoneStatus(status: string | null | undefined): boolean {
  const normalized = normalizeStatus(status);
  return normalized === "complete" || normalized === "completed" || normalized === "done";
}

function isCancelledStatus(status: string | null | undefined): boolean {
  return normalizeStatus(status) === "cancelled";
}

function isTerminalTask(task: Pick<MyWorkTaskRow, "status">): boolean {
  return isDoneStatus(task.status) || isCancelledStatus(task.status);
}

function isBlockedTask(task: Pick<MyWorkTaskRow, "status" | "trackingRag">): boolean {
  const status = normalizeStatus(task.status);
  const rag = String(task.trackingRag ?? "").toLowerCase();
  return status === "blocked" || status === "block" || rag === "red";
}

function isOverdue(task: MyWorkTaskRow, today: string): boolean {
  const days = daysRemaining(task.dueDate, today);
  return days !== null && days < 0;
}

function isTodayOrOverdue(task: MyWorkTaskRow, today: string): boolean {
  const days = daysRemaining(task.dueDate, today);
  return !isTerminalTask(task) && days !== null && days <= 0;
}

function isDueThisWeek(task: MyWorkTaskRow, today: string): boolean {
  const days = daysRemaining(task.dueDate, today);
  return days !== null && days <= 7;
}

function daysRemaining(dateStr: string | null, today: string): number | null {
  const due = parseDayStamp(dateStr);
  const now = parseDayStamp(today);
  if (due === null || now === null) return null;
  return Math.ceil((due - now) / 86_400_000);
}

function parseDayStamp(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const value = Date.parse(`${dateStr.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(value) ? null : value;
}

function currentDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface MyWorkTasksListProps {
  tasks: MyWorkTaskRow[];
  onPromote: (taskId: number) => Promise<void> | void;
  promotingId: number | null;
  onUpdateStatus?: (id: number, status: string) => Promise<void> | void;
  onDelete?: (id: number) => Promise<void> | void;
  onAddTask?: () => void;
  updatingId?: number | null;
  deletingId?: number | null;
  emptyMessage?: string;
}

export function MyWorkTasksList({
  tasks,
  onPromote,
  promotingId,
  onUpdateStatus,
  onDelete,
  onAddTask,
  updatingId,
  deletingId,
  emptyMessage,
}: MyWorkTasksListProps) {
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<TaskFocusKey>("all");
  const [sort, setSort] = useState<TaskSortKey>("dueDate");
  const [view, setView] = useState<TaskViewMode>("list");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const today = useMemo(currentDay, []);
  const model = useMemo(
    () => buildTaskCommandCenterModel(tasks, { today, query, focus, sort }),
    [tasks, today, query, focus, sort],
  );
  const selectedVisibleTasks = model.visibleTasks.filter((task) => selectedIds.has(task.id));

  const toggleSelected = (taskId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const bulkUpdateStatus = async (status: string) => {
    if (!onUpdateStatus || selectedVisibleTasks.length === 0) return;
    for (const task of selectedVisibleTasks) {
      await onUpdateStatus(task.id, status);
    }
    setSelectedIds(new Set());
  };

  return (
    <section
      className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      data-testid="task-command-center"
    >
      <div className="grid gap-4 border-b border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ListChecks className="h-5 w-5 text-emerald-700" />
            <h3 className="text-base font-semibold text-slate-950">Task Command Center</h3>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              {model.metrics.open} open
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Project tasks and personal follow-ups assigned to you.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-[240px] sm:w-[300px]">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks, projects, owners..."
              className="h-9 pl-8 text-xs"
              data-testid="input-task-command-search"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs"
                disabled={!onUpdateStatus || selectedVisibleTasks.length === 0}
              >
                <Filter className="mr-1.5 h-3.5 w-3.5" />
                Bulk update
                {selectedVisibleTasks.length > 0 ? ` (${selectedVisibleTasks.length})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuLabel className="text-xs">Set selected status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs" onSelect={() => void bulkUpdateStatus("In Progress")}>
                Mark in progress
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onSelect={() => void bulkUpdateStatus("Complete")}>
                Mark complete
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onSelect={() => void bulkUpdateStatus("Blocked")}>
                Mark blocked
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {onAddTask && (
            <Button size="sm" className="h-9 text-xs" onClick={onAddTask}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Task
            </Button>
          )}
        </div>
      </div>

      <MetricsStrip metrics={model.metrics} />

      <div className="grid min-h-[390px] xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-slate-50/80 p-4 xl:border-b-0 xl:border-r">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Focus queue
          </p>
          <FocusButton
            active={focus === "all"}
            label="All tasks"
            detail="Everything assigned to you"
            count={tasks.length}
            onClick={() => setFocus("all")}
          />
          {model.focusBuckets.map((bucket) => (
            <FocusButton
              key={bucket.key}
              active={focus === bucket.key}
              label={bucket.label}
              detail={bucket.detail}
              count={bucket.count}
              onClick={() => setFocus(bucket.key)}
            />
          ))}
        </aside>

        <div className="min-w-0">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
            <ViewSwitcher value={view} onChange={setView} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {model.visibleTasks.length}
                {model.visibleTasks.length === 1 ? " task" : " tasks"}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 min-w-[110px] justify-between text-xs">
                    {SORT_LABEL[sort]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[150px]">
                  {(Object.keys(SORT_LABEL) as TaskSortKey[]).map((key) => (
                    <DropdownMenuItem
                      key={key}
                      className={cn("text-xs", sort === key && "font-semibold")}
                      onSelect={() => setSort(key)}
                    >
                      {SORT_LABEL[key]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {model.visibleTasks.length === 0 ? (
            <EmptyTaskState
              message={
                tasks.length === 0
                  ? emptyMessage ?? "No outstanding tasks assigned to you."
                  : "No tasks match the current task search or focus queue."
              }
              onAddTask={onAddTask}
            />
          ) : view === "board" ? (
            <BoardView
              tasks={model.visibleTasks}
              today={today}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onPromote={onPromote}
              promotingId={promotingId}
              onUpdateStatus={onUpdateStatus}
              onDelete={onDelete}
              updatingId={updatingId}
              deletingId={deletingId}
            />
          ) : view === "calendar" ? (
            <CalendarView
              tasks={model.visibleTasks}
              today={today}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onPromote={onPromote}
              promotingId={promotingId}
              onUpdateStatus={onUpdateStatus}
              onDelete={onDelete}
              updatingId={updatingId}
              deletingId={deletingId}
            />
          ) : (
            <ListView
              tasks={model.visibleTasks}
              today={today}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onPromote={onPromote}
              promotingId={promotingId}
              onUpdateStatus={onUpdateStatus}
              onDelete={onDelete}
              updatingId={updatingId}
              deletingId={deletingId}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function MetricsStrip({ metrics }: { metrics: TaskCommandCenterMetrics }) {
  const items = [
    { label: "Overdue", value: metrics.overdue, className: "border-red-200 bg-red-50 text-red-700" },
    { label: "Due this week", value: metrics.dueThisWeek, className: "border-amber-200 bg-amber-50 text-amber-700" },
    { label: "In progress", value: metrics.inProgress, className: "border-slate-200 bg-white text-slate-950" },
    { label: "Blocked", value: metrics.blocked, className: "border-red-200 bg-white text-red-700" },
    { label: "Completed", value: metrics.completed, className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  ];

  return (
    <div className="grid gap-2 border-b border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className={cn("rounded-md border p-3", item.className)}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {item.label}
          </p>
          <p className="mt-1 text-2xl font-bold leading-none">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function FocusButton({
  active,
  label,
  detail,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  detail: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mb-2 flex w-full items-center justify-between rounded-md border bg-white px-3 py-2 text-left text-xs transition",
        active
          ? "border-emerald-300 shadow-sm shadow-emerald-900/5 ring-1 ring-emerald-100"
          : "border-slate-200 hover:border-slate-300",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold text-slate-950">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>
      </span>
      <span className="ml-3 font-semibold text-slate-950">{count}</span>
    </button>
  );
}

function ViewSwitcher({
  value,
  onChange,
}: {
  value: TaskViewMode;
  onChange: (value: TaskViewMode) => void;
}) {
  const options: Array<{ key: TaskViewMode; label: string; icon: typeof LayoutList }> = [
    { key: "list", label: "List", icon: LayoutList },
    { key: "board", label: "Board", icon: KanbanSquare },
    { key: "calendar", label: "Calendar", icon: CalendarDays },
  ];

  return (
    <div className="inline-flex w-fit rounded-md border border-slate-200 bg-slate-100 p-1">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition",
              value === option.key
                ? "bg-white font-semibold text-emerald-700 shadow-sm"
                : "text-slate-600 hover:text-slate-950",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface TaskViewProps {
  tasks: MyWorkTaskRow[];
  today: string;
  selectedIds: Set<number>;
  onToggleSelected: (taskId: number) => void;
  onPromote: (taskId: number) => Promise<void> | void;
  promotingId: number | null;
  onUpdateStatus?: (id: number, status: string) => Promise<void> | void;
  onDelete?: (id: number) => Promise<void> | void;
  updatingId?: number | null;
  deletingId?: number | null;
}

function ListView(props: TaskViewProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] table-fixed border-collapse">
        <colgroup>
          <col className="w-[36%]" />
          <col className="w-[14%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3 font-semibold">Task</th>
            <th className="px-3 py-3 font-semibold">Project</th>
            <th className="px-3 py-3 font-semibold">Status</th>
            <th className="px-3 py-3 font-semibold">Due</th>
            <th className="px-3 py-3 font-semibold">Progress</th>
            <th className="px-3 py-3 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {props.tasks.map((task) => (
            <TaskRow key={task.id} task={task} {...props} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ task, ...props }: TaskViewProps & { task: MyWorkTaskRow }) {
  const due = duePresentation(task, props.today);
  const progress = taskProgressPercent(task);
  const disabled = props.updatingId === task.id || props.deletingId === task.id;

  return (
    <tr
      className={cn("border-b border-slate-100 align-top", props.deletingId === task.id && "opacity-50")}
      data-testid={`task-command-row-${task.id}`}
    >
      <td className="px-4 py-3">
        <div className="flex min-w-0 gap-3">
          <SelectionAndComplete
            task={task}
            selected={props.selectedIds.has(task.id)}
            disabled={disabled}
            onToggleSelected={props.onToggleSelected}
            onUpdateStatus={props.onUpdateStatus}
          />
          <TaskTitleBlock task={task} />
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground">
        <ProjectLink task={task} />
      </td>
      <td className="px-3 py-3">
        <StatusMenu task={task} disabled={disabled} onUpdateStatus={props.onUpdateStatus} />
      </td>
      <td className="px-3 py-3">
        <Badge variant="outline" className={cn("whitespace-nowrap text-[11px]", due.className)}>
          {due.label}
        </Badge>
      </td>
      <td className="px-3 py-3">
        <ProgressWithLabel progress={progress} />
      </td>
      <td className="px-3 py-3">
        <TaskActions task={task} {...props} />
      </td>
    </tr>
  );
}

function BoardView(props: TaskViewProps) {
  const groups = [
    {
      key: "due",
      label: "Today and overdue",
      tasks: props.tasks.filter((task) => isTodayOrOverdue(task, props.today)),
    },
    {
      key: "in-progress",
      label: "In progress",
      tasks: props.tasks.filter((task) => !isTerminalTask(task) && normalizeStatus(task.status) === "in progress"),
    },
    {
      key: "blocked",
      label: "Blocked",
      tasks: props.tasks.filter((task) => !isTerminalTask(task) && isBlockedTask(task)),
    },
    {
      key: "backlog",
      label: "Backlog",
      tasks: props.tasks.filter(
        (task) =>
          !isTerminalTask(task) &&
          !isTodayOrOverdue(task, props.today) &&
          normalizeStatus(task.status) !== "in progress" &&
          !isBlockedTask(task),
      ),
    },
    {
      key: "done",
      label: "Complete",
      tasks: props.tasks.filter((task) => isDoneStatus(task.status)),
    },
  ];

  return (
    <div className="grid gap-3 p-4 lg:grid-cols-2 2xl:grid-cols-5">
      {groups.map((group) => (
        <section key={group.key} className="min-w-0 rounded-md border border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <h4 className="text-xs font-semibold text-slate-800">{group.label}</h4>
            <Badge variant="outline" className="bg-white text-[10px]">
              {group.tasks.length}
            </Badge>
          </div>
          <div className="space-y-2 p-2">
            {group.tasks.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">No tasks</p>
            ) : (
              group.tasks.map((task) => (
                <TaskMiniCard key={task.id} task={task} {...props} />
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function CalendarView(props: TaskViewProps) {
  const sections = [
    {
      key: "overdue",
      label: "Overdue",
      tasks: props.tasks.filter((task) => !isTerminalTask(task) && isOverdue(task, props.today)),
    },
    {
      key: "today",
      label: "Today",
      tasks: props.tasks.filter((task) => daysRemaining(task.dueDate, props.today) === 0),
    },
    {
      key: "upcoming",
      label: "Upcoming",
      tasks: props.tasks.filter((task) => {
        const days = daysRemaining(task.dueDate, props.today);
        return days !== null && days > 0;
      }),
    },
    {
      key: "no-date",
      label: "No due date",
      tasks: props.tasks.filter((task) => !task.dueDate),
    },
  ];

  return (
    <div className="space-y-3 p-4">
      {sections.map((section) => (
        <section key={section.key} className="rounded-md border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
            <h4 className="text-xs font-semibold text-slate-800">{section.label}</h4>
            <Badge variant="outline" className="bg-white text-[10px]">
              {section.tasks.length}
            </Badge>
          </div>
          <div className="divide-y divide-slate-100">
            {section.tasks.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No tasks</p>
            ) : (
              section.tasks.map((task) => (
                <div key={task.id} className="p-3">
                  <TaskMiniCard task={task} {...props} />
                </div>
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskMiniCard({ task, ...props }: TaskViewProps & { task: MyWorkTaskRow }) {
  const due = duePresentation(task, props.today);
  const progress = taskProgressPercent(task);
  const disabled = props.updatingId === task.id || props.deletingId === task.id;

  return (
    <div
      className={cn(
        "rounded-md border border-slate-200 bg-white p-3 shadow-sm",
        props.deletingId === task.id && "opacity-50",
      )}
    >
      <div className="flex items-start gap-2">
        <SelectionAndComplete
          task={task}
          selected={props.selectedIds.has(task.id)}
          disabled={disabled}
          onToggleSelected={props.onToggleSelected}
          onUpdateStatus={props.onUpdateStatus}
        />
        <div className="min-w-0 flex-1">
          <TaskTitleBlock task={task} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusMenu task={task} disabled={disabled} onUpdateStatus={props.onUpdateStatus} />
            <Badge variant="outline" className={cn("text-[11px]", due.className)}>
              {due.label}
            </Badge>
          </div>
          <div className="mt-3">
            <ProgressWithLabel progress={progress} />
          </div>
        </div>
        <TaskActions task={task} {...props} />
      </div>
    </div>
  );
}

function SelectionAndComplete({
  task,
  selected,
  disabled,
  onToggleSelected,
  onUpdateStatus,
}: {
  task: MyWorkTaskRow;
  selected: boolean;
  disabled: boolean;
  onToggleSelected: (taskId: number) => void;
  onUpdateStatus?: (id: number, status: string) => Promise<void> | void;
}) {
  const done = isDoneStatus(task.status);

  return (
    <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
      <button
        type="button"
        className={cn(
          "grid h-4 w-4 place-items-center rounded border transition",
          selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white",
        )}
        onClick={() => onToggleSelected(task.id)}
        aria-label={selected ? "Remove task from bulk selection" : "Select task for bulk update"}
      >
        {selected && <CheckCircle2 className="h-3 w-3" />}
      </button>
      <button
        type="button"
        className="text-muted-foreground transition hover:text-emerald-700 disabled:opacity-40"
        title={done ? "Mark incomplete" : "Mark complete"}
        disabled={disabled || !onUpdateStatus}
        onClick={() => onUpdateStatus?.(task.id, done ? "Not Started" : "Complete")}
        aria-label={done ? "Mark incomplete" : "Mark complete"}
      >
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

function TaskTitleBlock({ task }: { task: MyWorkTaskRow }) {
  const done = isDoneStatus(task.status);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          className={cn(
            "min-w-0 truncate text-sm font-semibold text-slate-950",
            done && "text-muted-foreground line-through",
          )}
          title={task.title}
        >
          {task.title}
        </span>
        {isPersonalTask(task) && (
          <Badge variant="outline" className="border-sky-200 bg-sky-50 text-[10px] uppercase text-sky-700">
            Personal
          </Badge>
        )}
        {task.priority && task.priority !== "normal" && (
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] uppercase text-amber-700">
            {task.priority}
          </Badge>
        )}
      </div>
      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {task.description}
        </p>
      )}
    </div>
  );
}

function ProjectLink({ task }: { task: MyWorkTaskRow }) {
  if (task.projectName && task.projectId) {
    return (
      <Link
        href={`/project/id/${task.projectId}`}
        className="inline-flex min-w-0 max-w-full items-center gap-1 hover:underline"
        data-testid={`task-command-${task.id}-project`}
      >
        <Briefcase className="h-3 w-3 shrink-0" />
        <span className="truncate">{task.projectName}</span>
      </Link>
    );
  }
  return <span className="text-xs text-muted-foreground">Personal</span>;
}

function StatusMenu({
  task,
  disabled,
  onUpdateStatus,
}: {
  task: MyWorkTaskRow;
  disabled: boolean;
  onUpdateStatus?: (id: number, status: string) => Promise<void> | void;
}) {
  const statusKey = normalizeStatus(task.status);
  const statusClass = STATUS_BADGE_CLASS[statusKey] ?? STATUS_BADGE_CLASS["not started"];

  if (!onUpdateStatus) {
    return (
      <Badge variant="outline" className={cn("whitespace-nowrap text-[11px]", statusClass)}>
        {task.status || "Not Started"}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex min-h-[24px] items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40",
            statusClass,
          )}
          aria-label="Change task status"
        >
          {disabled ? "Updating" : task.status || "Not Started"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[150px]">
        {TASK_STATUSES.map((status) => (
          <DropdownMenuItem
            key={status}
            className={cn("text-xs", normalizeStatus(status) === statusKey && "font-semibold")}
            onSelect={() => onUpdateStatus(task.id, status)}
          >
            {status}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProgressWithLabel({ progress }: { progress: number }) {
  return (
    <div className="grid min-w-[92px] grid-cols-[34px_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="tabular-nums text-slate-700">{progress}%</span>
      <Progress value={progress} className="h-1.5 bg-slate-100" />
    </div>
  );
}

function TaskActions({
  task,
  onPromote,
  promotingId,
  onUpdateStatus,
  onDelete,
  updatingId,
  deletingId,
}: TaskViewProps & { task: MyWorkTaskRow }) {
  const isPromoting = promotingId === task.id;
  const disabled = isPromoting || updatingId === task.id || deletingId === task.id;
  const isPersonal = isPersonalTask(task);
  const isDone = isDoneStatus(task.status);

  return (
    <div className="flex items-center justify-end gap-1.5">
      {isDone && onUpdateStatus ? (
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2 text-xs"
          disabled={disabled}
          onClick={() => void onUpdateStatus(task.id, "Not Started")}
          title="Reopen this task"
          data-testid={`task-command-${task.id}-reopen`}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Reopen
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2 text-xs"
          disabled={disabled}
          onClick={() => void onPromote(task.id)}
          title="Promote this task to a priority"
          data-testid={`task-command-${task.id}-promote`}
        >
          <ArrowUp className="mr-1 h-3.5 w-3.5" />
          {isPromoting ? "Promoting" : "Make priority"}
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={disabled}
            aria-label="Task actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuLabel className="text-xs">Task actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {onUpdateStatus && (
            <>
              <DropdownMenuItem className="text-xs" onSelect={() => onUpdateStatus(task.id, "Not Started")}>
                Mark not started
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onSelect={() => onUpdateStatus(task.id, "In Progress")}>
                Mark in progress
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onSelect={() => onUpdateStatus(task.id, "Blocked")}>
                Mark blocked
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onSelect={() => onUpdateStatus(task.id, "Complete")}>
                Mark complete
              </DropdownMenuItem>
            </>
          )}
          {isPersonal && onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs text-red-700 focus:text-red-700"
                onSelect={() => onDelete(task.id)}
                data-testid={`task-command-${task.id}-delete`}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete personal task
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function duePresentation(task: MyWorkTaskRow, today: string): { label: string; className: string } {
  const days = daysRemaining(task.dueDate, today);
  if (days === null) {
    return { label: "No due date", className: "border-slate-200 bg-slate-50 text-slate-600" };
  }
  if (isTerminalTask(task)) {
    return { label: task.dueDate ?? "Complete", className: "border-slate-200 bg-slate-50 text-slate-600" };
  }
  if (days < 0) {
    return { label: `${Math.abs(days)}d overdue`, className: "border-red-200 bg-red-50 text-red-700" };
  }
  if (days === 0) {
    return { label: "Today", className: "border-amber-200 bg-amber-50 text-amber-700" };
  }
  if (days <= 7) {
    return { label: `${days}d`, className: "border-amber-200 bg-amber-50 text-amber-700" };
  }
  return { label: task.dueDate ?? "No due date", className: "border-slate-200 bg-white text-slate-700" };
}

function EmptyTaskState({
  message,
  onAddTask,
}: {
  message: string;
  onAddTask?: () => void;
}) {
  return (
    <div className="grid min-h-[280px] place-items-center p-8 text-center">
      <div>
        <AlertCircle className="mx-auto h-8 w-8 text-slate-400" />
        <p className="mt-3 text-sm font-medium text-slate-900">{message}</p>
        {onAddTask && (
          <Button size="sm" className="mt-4" onClick={onAddTask}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Task
          </Button>
        )}
      </div>
    </div>
  );
}
