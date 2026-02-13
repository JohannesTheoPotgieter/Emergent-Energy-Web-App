import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Play,
  CheckCircle2,
  Ban,
  GripVertical,
  Clock,
  Target,
  Inbox,
  Loader2,
  CalendarDays,
  Settings,
  ListTodo,
  ArrowRight,
  ExternalLink,
  Unlock,
  Save,
  AlertCircle,
  Filter,
  X,
} from "lucide-react";

type Priority = "critical" | "important" | "normal" | "low";
type TaskStatus = "inbox" | "planned" | "in_progress" | "blocked" | "waiting" | "done" | "cancelled";
type Horizon = "today" | "week" | "month" | "quarter";

interface MyToolTask {
  id: number;
  title: string;
  status: TaskStatus;
  priority: Priority;
  plannedForDate: string | null;
  sortOrder: number;
  projectName: string | null;
  tag: string | null;
  blockedReason: string | null;
  companyPriorityId: number | null;
}

interface TimeBlock {
  id: number;
  startTime: string;
  endTime: string;
  label: string;
  taskId: number | null;
}

interface CompanyPriority {
  id: number;
  title: string;
  severity: "critical" | "important" | "normal";
  horizon: Horizon;
  linkedProjectName: string | null;
  isActive: boolean;
}

interface DailyReview {
  id: number;
  date: string;
  wentWell: string;
  movedForward: string;
  blocked: string;
  notes: string;
}

const today = format(new Date(), "yyyy-MM-dd");
const todayDisplay = format(new Date(), "EEEE, d MMMM yyyy");

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  important: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  normal: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  low: { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" },
};

const statusColors: Record<string, string> = {
  inbox: "bg-gray-100 text-gray-700",
  planned: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  blocked: "bg-red-100 text-red-700",
  waiting: "bg-orange-100 text-orange-700",
  done: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-gray-200 text-gray-500",
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = severityColors[severity] || severityColors.normal;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cfg.bg} ${cfg.text} ${cfg.border} border`}
      data-testid={`badge-severity-${severity}`}
    >
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${statusColors[status] || statusColors.inbox}`}
      data-testid={`badge-status-${status}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function PriorityDot({ priority }: { priority: Priority }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500",
    important: "bg-amber-500",
    normal: "bg-blue-500",
    low: "bg-gray-400",
  };
  return <div className={`w-2 h-2 rounded-full ${colors[priority] || colors.normal} shrink-0`} />;
}

const navTabs = [
  { label: "Today", path: "/my-tool", icon: Target },
  { label: "Week", path: "/my-tool/week", icon: CalendarDays },
  { label: "Backlog", path: "/my-tool/backlog", icon: ListTodo },
  { label: "Settings", path: "/my-tool/settings", icon: Settings },
];

export default function MyToolTodayPage() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [, setLocation] = useLocation();

  const [prioritiesOpen, setPrioritiesOpen] = useState(true);
  const [horizon, setHorizon] = useState<Horizon>("week");
  const [quickAddText, setQuickAddText] = useState("");
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockLabel, setBlockLabel] = useState("");
  const [doneCollapsed, setDoneCollapsed] = useState(true);
  const [wrapOpen, setWrapOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [reviewForm, setReviewForm] = useState({
    wentWell: "",
    movedForward: "",
    blocked: "",
    notes: "",
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<MyToolTask[]>({
    queryKey: [`/api/mytool/tasks?date=${today}`],
  });

  const { data: timeblocks = [], isLoading: blocksLoading } = useQuery<TimeBlock[]>({
    queryKey: [`/api/mytool/timeblocks?date=${today}`],
  });

  const { data: priorities = [], isLoading: prioritiesLoading } = useQuery<CompanyPriority[]>({
    queryKey: [`/api/mytool/company-priorities?horizon=${horizon}`],
  });

  const { data: dailyReview } = useQuery<DailyReview | null>({
    queryKey: [`/api/mytool/daily-review?date=${today}`],
  });

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/tasks?date=${today}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/timeblocks?date=${today}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/company-priorities?horizon=${horizon}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/daily-review?date=${today}`] });
  }, [horizon]);

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/tasks", body);
    },
    onSuccess: () => invalidateAll(),
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => {
      await apiRequest("PATCH", `/api/mytool/tasks/${id}`, body);
    },
    onSuccess: () => invalidateAll(),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mytool/tasks/${id}`);
    },
    onSuccess: () => invalidateAll(),
  });

  const createBlockMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/timeblocks", body);
    },
    onSuccess: () => {
      invalidateAll();
      setAddBlockOpen(false);
      setBlockStart("");
      setBlockEnd("");
      setBlockLabel("");
    },
  });

  const saveReviewMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/daily-review", body);
    },
    onSuccess: () => invalidateAll(),
  });

  const handleQuickAdd = () => {
    const title = quickAddText.trim();
    if (!title) return;
    createTaskMutation.mutate({
      title,
      status: "planned",
      plannedForDate: today,
      priority: "normal",
    });
    setQuickAddText("");
  };

  const handleStatusChange = (taskId: number, newStatus: TaskStatus) => {
    updateTaskMutation.mutate({ id: taskId, status: newStatus });
  };

  const handleUnblock = (taskId: number) => {
    updateTaskMutation.mutate({ id: taskId, status: "in_progress", blockedReason: null });
  };

  const handleInlineEdit = (taskId: number) => {
    if (editingTitle.trim()) {
      updateTaskMutation.mutate({ id: taskId, title: editingTitle.trim() });
    }
    setEditingTaskId(null);
  };

  const handleConvertToTask = (priority: CompanyPriority) => {
    createTaskMutation.mutate({
      title: priority.title,
      status: "planned",
      plannedForDate: today,
      priority: priority.severity === "critical" ? "critical" : priority.severity === "important" ? "important" : "normal",
      projectName: priority.linkedProjectName,
      companyPriorityId: priority.id,
    });
  };

  const handleAddBlock = () => {
    if (!blockStart || !blockEnd || !blockLabel.trim()) return;
    createBlockMutation.mutate({
      date: today,
      startTime: blockStart,
      endTime: blockEnd,
      label: blockLabel.trim(),
    });
  };

  const handleSaveReview = () => {
    saveReviewMutation.mutate({
      date: today,
      ...reviewForm,
    });
  };

  const plannedTasks = tasks
    .filter((t) => t.status === "planned" && t.plannedForDate === today)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const inboxTasks = tasks.filter((t) => t.status === "inbox");
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
  const blockedWaitingTasks = tasks.filter((t) => t.status === "blocked" || t.status === "waiting");
  const doneTasks = tasks.filter((t) => t.status === "done");
  const cancelledTasks = tasks.filter((t) => t.status === "cancelled");

  const activePriorities = priorities.filter((p) => p.isActive);

  const isLoading = tasksLoading || blocksLoading || prioritiesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto" data-testid="mytool-today-page">
      {/* 1. Header */}
      <header className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50" data-testid="text-page-title">
              My Tool
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1" data-testid="text-today-date">
              {todayDisplay}
            </p>
          </div>
          {user && (
            <p className="text-sm text-gray-400" data-testid="text-user-greeting">
              Hey, {user.name}
            </p>
          )}
        </div>
        <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-700" data-testid="nav-tabs">
          {navTabs.map((tab) => {
            const isActive = location === tab.path || (tab.path === "/my-tool" && location === "/my-tool");
            return (
              <Link
                key={tab.path}
                href={tab.path}
                data-testid={`nav-tab-${tab.label.toLowerCase()}`}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* 2. Company Priorities */}
      <Card data-testid="card-company-priorities">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-2 text-left"
              onClick={() => setPrioritiesOpen(!prioritiesOpen)}
              data-testid="toggle-company-priorities"
            >
              {prioritiesOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
              <CardTitle className="text-base">Company Priorities</CardTitle>
              <Badge variant="secondary" className="text-xs" data-testid="badge-priorities-count">
                {activePriorities.length}
              </Badge>
            </button>
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-gray-400" />
              <select
                value={horizon}
                onChange={(e) => setHorizon(e.target.value as Horizon)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white dark:bg-gray-900 dark:border-gray-700"
                data-testid="select-horizon"
              >
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="quarter">This Quarter</option>
              </select>
            </div>
          </div>
        </CardHeader>
        {prioritiesOpen && (
          <CardContent className="pt-0">
            {activePriorities.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center" data-testid="empty-priorities">
                No priorities for this horizon. Adjust the filter or add priorities in Settings.
              </p>
            ) : (
              <div className="space-y-2">
                {activePriorities.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    data-testid={`priority-item-${p.id}`}
                  >
                    <SeverityBadge severity={p.severity} />
                    <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {p.title}
                    </span>
                    {p.linkedProjectName && (
                      <Link
                        href={`/project/${encodeURIComponent(p.linkedProjectName)}`}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 shrink-0"
                        data-testid={`link-priority-project-${p.id}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {p.linkedProjectName.replace(/_/g, " ")}
                      </Link>
                    )}
                    <div className="flex gap-1 shrink-0">
                      {p.linkedProjectName && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2"
                          onClick={() => setLocation(`/project/${encodeURIComponent(p.linkedProjectName!)}`)}
                          data-testid={`button-open-project-${p.id}`}
                        >
                          Open
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={() => handleConvertToTask(p)}
                        disabled={createTaskMutation.isPending}
                        data-testid={`button-convert-task-${p.id}`}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Task
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* 3. Today's Plan */}
      <Card data-testid="card-todays-plan">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-blue-600" />
            Today's Plan
            <Badge variant="secondary" className="text-xs" data-testid="badge-planned-count">
              {plannedTasks.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Quick add a task for today… (press Enter)"
              value={quickAddText}
              onChange={(e) => setQuickAddText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
              className="text-sm"
              data-testid="input-quick-add"
            />
            <Button
              variant="default"
              size="sm"
              onClick={handleQuickAdd}
              disabled={!quickAddText.trim() || createTaskMutation.isPending}
              data-testid="button-quick-add"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {plannedTasks.length === 0 ? (
            <div className="text-center py-6" data-testid="empty-planned">
              <ListTodo className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No tasks planned for today.</p>
              <p className="text-xs text-gray-400 mt-1">Add your first task above to get started.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {plannedTasks.map((task, i) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 group transition-colors"
                  data-testid={`planned-task-${task.id}`}
                >
                  <GripVertical className="h-4 w-4 text-gray-300 cursor-grab shrink-0" data-testid={`drag-handle-${task.id}`} />
                  <span className="text-xs text-gray-400 font-mono w-5 shrink-0">{i + 1}</span>
                  <PriorityDot priority={task.priority} />
                  {editingTaskId === task.id ? (
                    <Input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={() => handleInlineEdit(task.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleInlineEdit(task.id);
                        if (e.key === "Escape") setEditingTaskId(null);
                      }}
                      className="h-7 text-sm flex-1"
                      autoFocus
                      data-testid={`input-edit-task-${task.id}`}
                    />
                  ) : (
                    <span
                      className={`flex-1 text-sm cursor-pointer ${task.status === "done" ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`}
                      onClick={() => {
                        setEditingTaskId(task.id);
                        setEditingTitle(task.title);
                      }}
                      data-testid={`text-task-title-${task.id}`}
                    >
                      {task.title}
                    </span>
                  )}
                  <StatusBadge status={task.status} />
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                      onClick={() => handleStatusChange(task.id, "in_progress")}
                      title="Start"
                      data-testid={`button-start-${task.id}`}
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                      onClick={() => handleStatusChange(task.id, "done")}
                      title="Done"
                      data-testid={`button-done-${task.id}`}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleStatusChange(task.id, "blocked")}
                      title="Block"
                      data-testid={`button-block-${task.id}`}
                    >
                      <Ban className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Time Blocks */}
      <Card data-testid="card-time-blocks">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-violet-600" />
              Time Blocks
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setAddBlockOpen(!addBlockOpen)}
              data-testid="button-add-block"
            >
              {addBlockOpen ? <X className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
              {addBlockOpen ? "Cancel" : "Add Block"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {addBlockOpen && (
            <div className="flex flex-col sm:flex-row gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg" data-testid="form-add-block">
              <Input
                type="time"
                value={blockStart}
                onChange={(e) => setBlockStart(e.target.value)}
                className="text-sm w-full sm:w-28"
                placeholder="Start"
                data-testid="input-block-start"
              />
              <Input
                type="time"
                value={blockEnd}
                onChange={(e) => setBlockEnd(e.target.value)}
                className="text-sm w-full sm:w-28"
                placeholder="End"
                data-testid="input-block-end"
              />
              <Input
                value={blockLabel}
                onChange={(e) => setBlockLabel(e.target.value)}
                className="text-sm flex-1"
                placeholder="What are you working on?"
                onKeyDown={(e) => e.key === "Enter" && handleAddBlock()}
                data-testid="input-block-label"
              />
              <Button
                size="sm"
                onClick={handleAddBlock}
                disabled={!blockStart || !blockEnd || !blockLabel.trim() || createBlockMutation.isPending}
                data-testid="button-save-block"
              >
                Add
              </Button>
            </div>
          )}

          {timeblocks.length === 0 ? (
            <div className="text-center py-6" data-testid="empty-timeblocks">
              <Clock className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No time blocks scheduled.</p>
              <p className="text-xs text-gray-400 mt-1">
                <button
                  onClick={() => setAddBlockOpen(true)}
                  className="text-blue-600 hover:underline"
                  data-testid="link-add-first-block"
                >
                  Add your first time block
                </button>{" "}
                to plan your day.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {timeblocks
                .sort((a, b) => a.startTime.localeCompare(b.startTime))
                .map((block) => {
                  const linkedTask = block.taskId ? tasks.find((t) => t.id === block.taskId) : null;
                  return (
                    <div
                      key={block.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-violet-50/50 dark:hover:bg-violet-900/10 transition-colors"
                      data-testid={`timeblock-${block.id}`}
                    >
                      <div className="flex items-center gap-1 text-xs font-mono text-violet-600 dark:text-violet-400 shrink-0 w-24">
                        <Clock className="h-3 w-3" />
                        {block.startTime} – {block.endTime}
                      </div>
                      <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{block.label}</span>
                      {linkedTask && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          {linkedTask.title}
                        </Badge>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. Task Lanes */}
      <section data-testid="section-task-lanes">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <Inbox className="h-4 w-4" />
          Task Lanes
        </h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {/* Inbox */}
          <TaskLaneCard
            title="Inbox"
            icon={<Inbox className="h-4 w-4 text-gray-500" />}
            tasks={inboxTasks}
            emptyMessage="Inbox zero — nicely done!"
            emptyCta="Capture something"
            onEmptyCta={() => {
              setQuickAddText("");
              document.querySelector<HTMLInputElement>('[data-testid="input-quick-add"]')?.focus();
            }}
            onStatusChange={handleStatusChange}
            onEdit={(task) => {
              setEditingTaskId(task.id);
              setEditingTitle(task.title);
            }}
            testPrefix="inbox"
          />

          {/* In Progress */}
          <TaskLaneCard
            title="In Progress"
            icon={<Play className="h-4 w-4 text-amber-500" />}
            tasks={inProgressTasks}
            emptyMessage="Nothing in progress."
            emptyCta="Start a task"
            onStatusChange={handleStatusChange}
            onEdit={(task) => {
              setEditingTaskId(task.id);
              setEditingTitle(task.title);
            }}
            testPrefix="in-progress"
          />

          {/* Blocked + Waiting */}
          <TaskLaneCard
            title="Blocked / Waiting"
            icon={<AlertCircle className="h-4 w-4 text-red-500" />}
            tasks={blockedWaitingTasks}
            emptyMessage="Nothing blocked. Smooth sailing!"
            onStatusChange={handleStatusChange}
            onUnblock={handleUnblock}
            onEdit={(task) => {
              setEditingTaskId(task.id);
              setEditingTitle(task.title);
            }}
            testPrefix="blocked"
          />

          {/* Done */}
          <div>
            <button
              className="flex items-center gap-2 w-full text-left mb-2"
              onClick={() => setDoneCollapsed(!doneCollapsed)}
              data-testid="toggle-done-lane"
            >
              {doneCollapsed ? <ChevronRight className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Done</span>
              <Badge variant="secondary" className="text-xs ml-auto" data-testid="badge-done-count">
                {doneTasks.length}
              </Badge>
            </button>
            {!doneCollapsed && (
              <div className="space-y-1">
                {doneTasks.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4" data-testid="empty-done">
                    Complete a task to see it here.
                  </p>
                ) : (
                  doneTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onStatusChange={handleStatusChange}
                      onEdit={() => {
                        setEditingTaskId(task.id);
                        setEditingTitle(task.title);
                      }}
                      testPrefix="done"
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {cancelledTasks.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-900/30 rounded-lg p-3">
              <button
                className="flex items-center gap-2 w-full text-left mb-2"
                onClick={() => setDoneCollapsed(!doneCollapsed)}
                data-testid="toggle-cancelled-lane"
              >
                <ChevronRight className="h-4 w-4 text-gray-400" />
                <X className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-500">Cancelled</span>
                <Badge variant="secondary" className="text-xs ml-auto" data-testid="badge-cancelled-count">
                  {cancelledTasks.length}
                </Badge>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 6. End-of-Day Wrap */}
      <Card data-testid="card-daily-wrap">
        <CardHeader className="pb-2">
          <button
            className="flex items-center gap-2 text-left w-full"
            onClick={() => {
              setWrapOpen(!wrapOpen);
              if (!wrapOpen && dailyReview) {
                setReviewForm({
                  wentWell: dailyReview.wentWell || "",
                  movedForward: dailyReview.movedForward || "",
                  blocked: dailyReview.blocked || "",
                  notes: dailyReview.notes || "",
                });
              }
            }}
            data-testid="toggle-daily-wrap"
          >
            {wrapOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            <CardTitle className="text-base">End-of-Day Wrap</CardTitle>
            {dailyReview && (
              <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300 ml-2">
                Saved
              </Badge>
            )}
          </button>
        </CardHeader>
        {wrapOpen && (
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">What went well?</label>
              <Textarea
                value={reviewForm.wentWell}
                onChange={(e) => setReviewForm((p) => ({ ...p, wentWell: e.target.value }))}
                placeholder="Wins, progress, things that clicked…"
                className="text-sm min-h-[60px]"
                data-testid="textarea-went-well"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">What moved forward?</label>
              <Textarea
                value={reviewForm.movedForward}
                onChange={(e) => setReviewForm((p) => ({ ...p, movedForward: e.target.value }))}
                placeholder="Projects advanced, decisions made…"
                className="text-sm min-h-[60px]"
                data-testid="textarea-moved-forward"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">What's blocked?</label>
              <Textarea
                value={reviewForm.blocked}
                onChange={(e) => setReviewForm((p) => ({ ...p, blocked: e.target.value }))}
                placeholder="Blockers, waiting on, stuck on…"
                className="text-sm min-h-[60px]"
                data-testid="textarea-blocked"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Notes</label>
              <Textarea
                value={reviewForm.notes}
                onChange={(e) => setReviewForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Anything else on your mind…"
                className="text-sm min-h-[60px]"
                data-testid="textarea-notes"
              />
            </div>
            <Button
              onClick={handleSaveReview}
              disabled={saveReviewMutation.isPending}
              className="w-full sm:w-auto"
              data-testid="button-save-review"
            >
              {saveReviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Daily Review
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function TaskLaneCard({
  title,
  icon,
  tasks,
  emptyMessage,
  emptyCta,
  onEmptyCta,
  onStatusChange,
  onUnblock,
  onEdit,
  testPrefix,
}: {
  title: string;
  icon: React.ReactNode;
  tasks: MyToolTask[];
  emptyMessage: string;
  emptyCta?: string;
  onEmptyCta?: () => void;
  onStatusChange: (id: number, status: TaskStatus) => void;
  onUnblock?: (id: number) => void;
  onEdit: (task: MyToolTask) => void;
  testPrefix: string;
}) {
  return (
    <div data-testid={`lane-${testPrefix}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</span>
        <Badge variant="secondary" className="text-xs ml-auto" data-testid={`badge-${testPrefix}-count`}>
          {tasks.length}
        </Badge>
      </div>
      <div className="space-y-1 min-h-[60px]">
        {tasks.length === 0 ? (
          <div className="text-center py-4" data-testid={`empty-${testPrefix}`}>
            <p className="text-xs text-gray-400">{emptyMessage}</p>
            {emptyCta && onEmptyCta && (
              <button onClick={onEmptyCta} className="text-xs text-blue-600 hover:underline mt-1" data-testid={`cta-${testPrefix}`}>
                {emptyCta}
              </button>
            )}
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onStatusChange={onStatusChange}
              onUnblock={onUnblock}
              onEdit={() => onEdit(task)}
              testPrefix={testPrefix}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  onStatusChange,
  onUnblock,
  onEdit,
  testPrefix,
}: {
  task: MyToolTask;
  onStatusChange: (id: number, status: TaskStatus) => void;
  onUnblock?: (id: number) => void;
  onEdit: () => void;
  testPrefix: string;
}) {
  return (
    <div
      className="p-2.5 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer group"
      onClick={onEdit}
      data-testid={`task-card-${testPrefix}-${task.id}`}
    >
      <div className="flex items-start gap-2">
        <PriorityDot priority={task.priority} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${task.status === "done" ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`}>
            {task.title}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {task.projectName && (
              <Link
                href={`/project/${encodeURIComponent(task.projectName)}`}
                className="text-[10px] text-blue-600 hover:underline"
                onClick={(e) => e.stopPropagation()}
                data-testid={`link-task-project-${task.id}`}
              >
                {task.projectName.replace(/_/g, " ")}
              </Link>
            )}
            {task.tag && (
              <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
                {task.tag}
              </span>
            )}
          </div>
          {(task.status === "blocked" || task.status === "waiting") && task.blockedReason && (
            <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {task.blockedReason}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        {task.status !== "in_progress" && task.status !== "done" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-1.5 text-amber-600"
            onClick={() => onStatusChange(task.id, "in_progress")}
            data-testid={`button-lane-start-${task.id}`}
          >
            <Play className="h-3 w-3 mr-0.5" />
            Start
          </Button>
        )}
        {task.status !== "done" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-1.5 text-emerald-600"
            onClick={() => onStatusChange(task.id, "done")}
            data-testid={`button-lane-done-${task.id}`}
          >
            <CheckCircle2 className="h-3 w-3 mr-0.5" />
            Done
          </Button>
        )}
        {(task.status === "blocked" || task.status === "waiting") && onUnblock && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-1.5 text-blue-600"
            onClick={() => onUnblock(task.id)}
            data-testid={`button-unblock-${task.id}`}
          >
            <Unlock className="h-3 w-3 mr-0.5" />
            Unblock
          </Button>
        )}
        {task.status === "done" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-1.5 text-gray-500"
            onClick={() => onStatusChange(task.id, "inbox")}
            data-testid={`button-reopen-${task.id}`}
          >
            Reopen
          </Button>
        )}
        {task.status !== "done" && task.status !== "cancelled" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-1.5 text-gray-400"
            onClick={() => onStatusChange(task.id, "cancelled")}
            data-testid={`button-cancel-${task.id}`}
          >
            <X className="h-3 w-3 mr-0.5" />
            Cancel
          </Button>
        )}
        {task.status === "cancelled" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-1.5 text-blue-500"
            onClick={() => onStatusChange(task.id, "inbox")}
            data-testid={`button-restore-${task.id}`}
          >
            Restore
          </Button>
        )}
      </div>
    </div>
  );
}
