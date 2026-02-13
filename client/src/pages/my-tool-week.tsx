import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useLocation } from "wouter";
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isSameDay,
  isToday,
} from "date-fns";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Target,
  Loader2,
  CalendarDays,
  Settings,
  ListTodo,
  MoveRight,
  CheckCircle2,
  Play,
  X,
} from "lucide-react";

type Priority = "critical" | "important" | "normal" | "low";
type TaskStatus = "inbox" | "planned" | "in_progress" | "blocked" | "waiting" | "done" | "cancelled";

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

const priorityColors: Record<string, string> = {
  critical: "bg-red-500",
  important: "bg-amber-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

const statusColors: Record<string, string> = {
  inbox: "bg-gray-100 text-gray-700",
  planned: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  blocked: "bg-red-100 text-red-700",
  waiting: "bg-orange-100 text-orange-700",
  done: "bg-emerald-100 text-emerald-700",
};

function PriorityDot({ priority }: { priority: Priority }) {
  return <div className={`w-2 h-2 rounded-full ${priorityColors[priority] || priorityColors.normal} shrink-0`} />;
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

const navTabs = [
  { label: "Today", path: "/my-tool", icon: Target },
  { label: "Week", path: "/my-tool/week", icon: CalendarDays },
  { label: "Backlog", path: "/my-tool/backlog", icon: ListTodo },
  { label: "Settings", path: "/my-tool/settings", icon: Settings },
];

export default function MyToolWeekPage() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [quickAddTexts, setQuickAddTexts] = useState<Record<string, string>>({});
  const [movingTaskId, setMovingTaskId] = useState<number | null>(null);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<MyToolTask[]>({
    queryKey: [`/api/mytool/tasks?from=${weekStartStr}&to=${weekEndStr}`],
  });

  const timeBlockQueries = weekDays.map((day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return useQuery<TimeBlock[]>({
      queryKey: [`/api/mytool/timeblocks?date=${dateStr}`],
    });
  });

  const blocksLoading = timeBlockQueries.some((q) => q.isLoading);

  const timeBlocksByDay = useMemo(() => {
    const map: Record<string, TimeBlock[]> = {};
    weekDays.forEach((day, i) => {
      map[format(day, "yyyy-MM-dd")] = timeBlockQueries[i].data || [];
    });
    return map;
  }, [weekDays, timeBlockQueries]);

  const invalidateWeek = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/tasks?from=${weekStartStr}&to=${weekEndStr}`] });
    weekDays.forEach((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      queryClient.invalidateQueries({ queryKey: [`/api/mytool/timeblocks?date=${dateStr}`] });
    });
  }, [weekStartStr, weekEndStr]);

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/tasks", body);
    },
    onSuccess: () => invalidateWeek(),
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => {
      await apiRequest("PATCH", `/api/mytool/tasks/${id}`, body);
    },
    onSuccess: () => invalidateWeek(),
  });

  const handleQuickAdd = (dateStr: string) => {
    const title = (quickAddTexts[dateStr] || "").trim();
    if (!title) return;
    createTaskMutation.mutate({
      title,
      status: "planned",
      plannedForDate: dateStr,
      priority: "normal",
    });
    setQuickAddTexts((prev) => ({ ...prev, [dateStr]: "" }));
  };

  const handleMoveTask = (taskId: number, newDate: string) => {
    updateTaskMutation.mutate({ id: taskId, plannedForDate: newDate });
    setMovingTaskId(null);
  };

  const handleStatusChange = (taskId: number, newStatus: TaskStatus) => {
    updateTaskMutation.mutate({ id: taskId, status: newStatus });
  };

  const goToPreviousWeek = () => setCurrentDate(subWeeks(currentDate, 1));
  const goToNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));
  const goToCurrentWeek = () => setCurrentDate(new Date());

  const tasksByDay = useMemo(() => {
    const map: Record<string, MyToolTask[]> = {};
    weekDays.forEach((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      map[dateStr] = tasks
        .filter((t) => t.plannedForDate === dateStr)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    });
    return map;
  }, [tasks, weekDays]);

  const isLoading = tasksLoading || blocksLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto" data-testid="mytool-week-page">
      <header className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50" data-testid="text-page-title">
              My Tool
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1" data-testid="text-week-range">
              {format(weekStart, "d MMM")} – {format(weekEnd, "d MMM yyyy")}
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
            const isActive = location === tab.path;
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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPreviousWeek}
            data-testid="button-prev-week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goToCurrentWeek}
            data-testid="button-current-week"
          >
            This Week
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goToNextWeek}
            data-testid="button-next-week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Badge variant="secondary" className="text-xs" data-testid="badge-total-tasks">
          {tasks.length} tasks
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3" data-testid="week-grid">
        {weekDays.map((day) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const dayTasks = tasksByDay[dateStr] || [];
          const dayBlocks = timeBlocksByDay[dateStr] || [];
          const todayHighlight = isToday(day);

          return (
            <Card
              key={dateStr}
              className={`flex flex-col ${todayHighlight ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
              data-testid={`day-column-${dateStr}`}
            >
              <CardHeader className="pb-2 px-3 pt-3">
                <CardTitle className="text-xs font-semibold flex items-center justify-between">
                  <span className={todayHighlight ? "text-blue-600" : "text-gray-600 dark:text-gray-400"}>
                    {format(day, "EEE")}
                  </span>
                  <span className={`text-lg font-bold ${todayHighlight ? "text-blue-600" : "text-gray-900 dark:text-gray-100"}`}>
                    {format(day, "d")}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 px-3 pb-3 space-y-2">
                {dayTasks.length === 0 && dayBlocks.length === 0 ? (
                  <div className="text-center py-4" data-testid={`empty-day-${dateStr}`}>
                    <p className="text-xs text-gray-400 mb-2">Nothing planned</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-blue-600"
                      onClick={() => {
                        const el = document.getElementById(`quick-add-${dateStr}`);
                        el?.focus();
                      }}
                      data-testid={`button-add-day-${dateStr}`}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add
                    </Button>
                  </div>
                ) : (
                  <>
                    {dayTasks.map((task) => (
                      <div
                        key={task.id}
                        className="p-2 rounded-md border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 group transition-colors space-y-1"
                        data-testid={`week-task-${task.id}`}
                      >
                        <div className="flex items-start gap-1.5">
                          <PriorityDot priority={task.priority} />
                          <span className={`flex-1 text-xs leading-tight ${task.status === "done" ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`} data-testid={`text-task-title-${task.id}`}>
                            {task.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <StatusBadge status={task.status} />
                        </div>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-amber-600 hover:text-amber-700"
                            onClick={() => handleStatusChange(task.id, "in_progress")}
                            title="Start"
                            data-testid={`button-start-${task.id}`}
                          >
                            <Play className="h-2.5 w-2.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-emerald-600 hover:text-emerald-700"
                            onClick={() => handleStatusChange(task.id, "done")}
                            title="Done"
                            data-testid={`button-done-${task.id}`}
                          >
                            <CheckCircle2 className="h-2.5 w-2.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-blue-600 hover:text-blue-700"
                            onClick={() => setMovingTaskId(movingTaskId === task.id ? null : task.id)}
                            title="Move"
                            data-testid={`button-move-${task.id}`}
                          >
                            <MoveRight className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                        {movingTaskId === task.id && (
                          <div className="flex flex-wrap gap-1 pt-1 border-t border-gray-100 dark:border-gray-700" data-testid={`move-picker-${task.id}`}>
                            {weekDays
                              .filter((d) => !isSameDay(d, day))
                              .map((d) => {
                                const targetDate = format(d, "yyyy-MM-dd");
                                return (
                                  <Button
                                    key={targetDate}
                                    variant="outline"
                                    size="sm"
                                    className="h-5 text-[10px] px-1.5"
                                    onClick={() => handleMoveTask(task.id, targetDate)}
                                    data-testid={`move-to-${targetDate}-${task.id}`}
                                  >
                                    {format(d, "EEE")}
                                  </Button>
                                );
                              })}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0"
                              onClick={() => setMovingTaskId(null)}
                              data-testid={`cancel-move-${task.id}`}
                            >
                              <X className="h-2.5 w-2.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}

                    {dayBlocks.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-gray-100 dark:border-gray-800">
                        {dayBlocks.map((block) => (
                          <div
                            key={block.id}
                            className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-violet-50 dark:bg-violet-900/20 text-[10px]"
                            data-testid={`timeblock-${block.id}`}
                          >
                            <Clock className="h-2.5 w-2.5 text-violet-500 shrink-0" />
                            <span className="text-violet-700 dark:text-violet-300 font-medium">
                              {block.startTime}–{block.endTime}
                            </span>
                            <span className="text-gray-600 dark:text-gray-400 truncate">{block.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div className="pt-1">
                  <div className="flex gap-1">
                    <Input
                      id={`quick-add-${dateStr}`}
                      placeholder="+ Add"
                      value={quickAddTexts[dateStr] || ""}
                      onChange={(e) =>
                        setQuickAddTexts((prev) => ({ ...prev, [dateStr]: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === "Enter" && handleQuickAdd(dateStr)}
                      className="h-7 text-xs"
                      data-testid={`input-quick-add-${dateStr}`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => handleQuickAdd(dateStr)}
                      disabled={!(quickAddTexts[dateStr] || "").trim() || createTaskMutation.isPending}
                      data-testid={`button-quick-add-${dateStr}`}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
