import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import MyToolNav from "@/components/my-tool-nav";
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
  Loader2,
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

const statusStyles: Record<string, { bg: string; text: string }> = {
  inbox: { bg: "bg-gray-100", text: "text-gray-600" },
  planned: { bg: "bg-blue-100", text: "text-blue-700" },
  in_progress: { bg: "bg-amber-100", text: "text-amber-700" },
  blocked: { bg: "bg-red-100", text: "text-red-700" },
  waiting: { bg: "bg-orange-100", text: "text-orange-700" },
  done: { bg: "bg-emerald-100", text: "text-emerald-700" },
  cancelled: { bg: "bg-gray-200", text: "text-gray-500" },
};

function PriorityDot({ priority }: { priority: Priority }) {
  return <div className={`w-1.5 h-1.5 rounded-full ${priorityColors[priority] || priorityColors.normal} shrink-0`} />;
}

export default function MyToolWeekPage() {
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
    <div className="max-w-[1400px] mx-auto space-y-5" data-testid="mytool-week-page">
      <MyToolNav subtitle={`${format(weekStart, "d MMM")} - ${format(weekEnd, "d MMM yyyy")}`} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={goToPreviousWeek} data-testid="button-prev-week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs px-3" onClick={goToCurrentWeek} data-testid="button-current-week">
            This Week
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={goToNextWeek} data-testid="button-next-week">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Badge variant="secondary" className="text-xs" data-testid="badge-total-tasks">
          {tasks.length} tasks this week
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2" data-testid="week-grid">
        {weekDays.map((day) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const dayTasks = tasksByDay[dateStr] || [];
          const dayBlocks = timeBlocksByDay[dateStr] || [];
          const todayHighlight = isToday(day);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          return (
            <div
              key={dateStr}
              className={`rounded-lg border ${
                todayHighlight
                  ? "border-blue-300 bg-blue-50/30 dark:bg-blue-950/20 dark:border-blue-700"
                  : isWeekend
                  ? "border-gray-100 bg-gray-50/50 dark:bg-gray-900/30 dark:border-gray-800"
                  : "border-gray-200 dark:border-gray-800"
              } flex flex-col`}
              data-testid={`day-column-${dateStr}`}
            >
              {/* Day header */}
              <div className={`px-2.5 py-2 border-b ${todayHighlight ? "border-blue-200 dark:border-blue-800" : "border-gray-100 dark:border-gray-800"} flex items-center justify-between`}>
                <span className={`text-xs font-medium ${todayHighlight ? "text-blue-600" : isWeekend ? "text-gray-400" : "text-gray-500"}`}>
                  {format(day, "EEE")}
                </span>
                <span className={`text-sm font-bold ${todayHighlight ? "text-blue-600" : "text-gray-800 dark:text-gray-200"}`}>
                  {format(day, "d")}
                </span>
              </div>

              {/* Day content */}
              <div className="p-2 flex-1 space-y-1 min-h-[100px]">
                {dayTasks.map((task) => {
                  const st = statusStyles[task.status] || statusStyles.inbox;
                  return (
                    <div
                      key={task.id}
                      className={`p-1.5 rounded-md ${st.bg} group transition-colors relative`}
                      data-testid={`week-task-${task.id}`}
                    >
                      <div className="flex items-start gap-1">
                        <PriorityDot priority={task.priority} />
                        <span
                          className={`flex-1 text-[11px] leading-tight font-medium ${
                            task.status === "done" ? "line-through text-gray-400" : st.text
                          }`}
                          data-testid={`text-task-title-${task.id}`}
                        >
                          {task.title}
                        </span>
                      </div>
                      <div className="flex gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {task.status !== "done" && (
                          <>
                            <button
                              className="h-4 w-4 rounded flex items-center justify-center text-amber-600 hover:bg-amber-200/50"
                              onClick={() => handleStatusChange(task.id, "in_progress")}
                              title="Start"
                              data-testid={`button-start-${task.id}`}
                            >
                              <Play className="h-2.5 w-2.5" />
                            </button>
                            <button
                              className="h-4 w-4 rounded flex items-center justify-center text-emerald-600 hover:bg-emerald-200/50"
                              onClick={() => handleStatusChange(task.id, "done")}
                              title="Done"
                              data-testid={`button-done-${task.id}`}
                            >
                              <CheckCircle2 className="h-2.5 w-2.5" />
                            </button>
                          </>
                        )}
                        <button
                          className="h-4 w-4 rounded flex items-center justify-center text-blue-600 hover:bg-blue-200/50"
                          onClick={() => setMovingTaskId(movingTaskId === task.id ? null : task.id)}
                          title="Move"
                          data-testid={`button-move-${task.id}`}
                        >
                          <MoveRight className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      {movingTaskId === task.id && (
                        <div className="flex flex-wrap gap-0.5 mt-1 pt-1 border-t border-gray-200/50" data-testid={`move-picker-${task.id}`}>
                          {weekDays
                            .filter((d) => !isSameDay(d, day))
                            .map((d) => {
                              const targetDate = format(d, "yyyy-MM-dd");
                              return (
                                <button
                                  key={targetDate}
                                  className="text-[9px] px-1 py-0.5 rounded bg-white/80 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-blue-50 hover:border-blue-300 font-medium"
                                  onClick={() => handleMoveTask(task.id, targetDate)}
                                  data-testid={`move-to-${targetDate}-${task.id}`}
                                >
                                  {format(d, "EEE")}
                                </button>
                              );
                            })}
                          <button
                            className="text-[9px] px-1 py-0.5 text-gray-400 hover:text-gray-600"
                            onClick={() => setMovingTaskId(null)}
                            data-testid={`cancel-move-${task.id}`}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {dayBlocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-violet-50 dark:bg-violet-950/20 border border-violet-100/50 dark:border-violet-900/50"
                    data-testid={`timeblock-${block.id}`}
                  >
                    <Clock className="h-2.5 w-2.5 text-violet-500 shrink-0" />
                    <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium shrink-0">
                      {block.startTime}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{block.label}</span>
                  </div>
                ))}

                {dayTasks.length === 0 && dayBlocks.length === 0 && (
                  <p className="text-[10px] text-gray-300 text-center py-3">-</p>
                )}
              </div>

              {/* Quick add */}
              <div className="px-2 pb-2">
                <div className="flex gap-0.5">
                  <Input
                    id={`quick-add-${dateStr}`}
                    placeholder="+"
                    value={quickAddTexts[dateStr] || ""}
                    onChange={(e) =>
                      setQuickAddTexts((prev) => ({ ...prev, [dateStr]: e.target.value }))
                    }
                    onKeyDown={(e) => e.key === "Enter" && handleQuickAdd(dateStr)}
                    className="h-6 text-[11px] px-1.5 border-gray-100"
                    data-testid={`input-quick-add-${dateStr}`}
                  />
                  <button
                    className="h-6 w-6 shrink-0 rounded flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    onClick={() => handleQuickAdd(dateStr)}
                    data-testid={`button-quick-add-${dateStr}`}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
