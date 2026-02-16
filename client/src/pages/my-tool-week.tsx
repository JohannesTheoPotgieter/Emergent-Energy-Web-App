import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import MyToolLayout from "@/components/mytool/MyToolLayout";
import TaskCard, { type TaskItem, type TaskStatus, type TaskPriority } from "@/components/mytool/TaskCard";
import TaskDetailDrawer from "@/components/mytool/TaskDetailDrawer";
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isSameDay,
  isToday,
  parseISO,
} from "date-fns";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Calendar,
} from "lucide-react";

interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  isAllDay?: boolean;
}

function WeekSkeleton() {
  return (
    <div className="space-y-4" data-testid="mytool-week-skeleton">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-24 rounded" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
        <Skeleton className="h-5 w-32 rounded" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/40 flex flex-col">
            <div className="px-3 py-2.5 border-b border-border/30 flex items-center justify-between">
              <Skeleton className="h-3.5 w-8" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </div>
            <div className="p-2.5 flex-1 space-y-2 min-h-[120px]">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-8 w-3/4 rounded-lg" />
            </div>
            <div className="px-2.5 pb-2.5">
              <Skeleton className="h-7 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MyToolWeekPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [quickAddTexts, setQuickAddTexts] = useState<Record<string, string>>({});
  const [drawerTask, setDrawerTask] = useState<TaskItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const { toast } = useToast();

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const { data: allTasks = [], isLoading: tasksLoading } = useQuery<TaskItem[]>({
    queryKey: ["/api/mytool/tasks"],
  });

  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  const { data: calendarEvents = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/outlook/calendar-events", weekStartStr, weekEndStr],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/outlook/calendar-events?startDate=${weekStartStr}&endDate=${weekEndStr}`);
        return await res.json();
      } catch {
        return [];
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
  }, []);

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("POST", "/api/mytool/tasks", body);
    },
    onSuccess: invalidateAll,
    onError: () => {
      toast({ title: "Couldn't create task", variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => {
      await apiRequest("PATCH", `/api/mytool/tasks/${id}`, body);
    },
    onSuccess: invalidateAll,
    onError: () => {
      toast({ title: "Couldn't update task", variant: "destructive" });
    },
  });

  const handleQuickAddForDay = (dateStr: string) => {
    if (createTaskMutation.isPending) return;
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

  const handleGlobalQuickAdd = useCallback((text: string) => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    createTaskMutation.mutate({
      title: text,
      status: "planned",
      plannedForDate: todayStr,
      priority: "normal",
    });
  }, [createTaskMutation]);

  const handleStatusChange = (id: number, newStatus: TaskStatus) => {
    updateTaskMutation.mutate({ id, status: newStatus });
  };

  const handleOpenDrawer = (task: TaskItem) => {
    setDrawerTask(task);
    setDrawerOpen(true);
  };

  const handleQuickDone = (task: TaskItem) => {
    updateTaskMutation.mutate({ id: task.id, status: "done" });
  };

  const handleDragStart = (e: React.DragEvent, task: TaskItem) => {
    e.dataTransfer.setData("text/plain", String(task.id));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverDate(dateStr);
  };

  const handleDragLeave = () => {
    setDragOverDate(null);
  };

  const handleDrop = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    setDragOverDate(null);
    const taskId = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!isNaN(taskId)) {
      updateTaskMutation.mutate({ id: taskId, plannedForDate: dateStr });
    }
  };

  const goToPreviousWeek = () => setCurrentDate(subWeeks(currentDate, 1));
  const goToNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));
  const goToCurrentWeek = () => setCurrentDate(new Date());

  const tasksByDay = useMemo(() => {
    const map: Record<string, TaskItem[]> = {};
    weekDays.forEach((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      map[dateStr] = allTasks
        .filter((t) => t.plannedForDate === dateStr)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    });
    return map;
  }, [allTasks, weekDays]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    weekDays.forEach((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      map[dateStr] = calendarEvents.filter((evt) => {
        try {
          const evtDate = evt.start.slice(0, 10);
          return evtDate === dateStr;
        } catch {
          return false;
        }
      });
    });
    return map;
  }, [calendarEvents, weekDays]);

  if (tasksLoading) {
    return (
      <MyToolLayout onQuickAdd={handleGlobalQuickAdd}>
        <WeekSkeleton />
      </MyToolLayout>
    );
  }

  const totalWeekTasks = weekDays.reduce((sum, day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return sum + (tasksByDay[dateStr]?.length || 0);
  }, 0);

  return (
    <MyToolLayout onQuickAdd={handleGlobalQuickAdd}>
      <div className="space-y-4" data-testid="mytool-week-page">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={goToPreviousWeek}
              data-testid="button-prev-week"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs px-3"
              onClick={goToCurrentWeek}
              data-testid="button-current-week"
            >
              This Week
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={goToNextWeek}
              data-testid="button-next-week"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground ml-2 hidden sm:inline" data-testid="text-week-range">
              {format(weekStart, "d MMM")} – {format(weekEnd, "d MMM yyyy")}
            </span>
          </div>
          <Badge variant="secondary" className="text-xs" data-testid="badge-total-tasks">
            {totalWeekTasks} task{totalWeekTasks !== 1 ? "s" : ""} this week
          </Badge>
        </div>

        <div
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3"
          data-testid="week-grid"
        >
          {weekDays.map((day) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const dayTasks = tasksByDay[dateStr] || [];
            const dayEvents = eventsByDay[dateStr] || [];
            const todayHighlight = isToday(day);
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const isDragOver = dragOverDate === dateStr;

            return (
              <div
                key={dateStr}
                className={`rounded-xl border transition-all flex flex-col ${
                  isDragOver
                    ? "border-primary/60 bg-primary/5 shadow-md"
                    : todayHighlight
                    ? "border-primary/40 bg-primary/[0.03]"
                    : isWeekend
                    ? "border-border/30 bg-muted/20"
                    : "border-border/40 bg-background"
                }`}
                onDragOver={(e) => handleDragOver(e, dateStr)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, dateStr)}
                data-testid={`day-column-${dateStr}`}
              >
                <div
                  className={`px-3 py-2.5 border-b flex items-center justify-between ${
                    todayHighlight ? "border-primary/20" : "border-border/30"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs font-medium uppercase tracking-wide ${
                        todayHighlight
                          ? "text-primary"
                          : isWeekend
                          ? "text-muted-foreground/60"
                          : "text-muted-foreground"
                      }`}
                    >
                      {format(day, "EEE")}
                    </span>
                    <span
                      className={`text-sm font-bold ${
                        todayHighlight
                          ? "bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs"
                          : "text-foreground"
                      }`}
                    >
                      {format(day, "d")}
                    </span>
                  </div>
                  {dayTasks.length > 0 && (
                    <span
                      className="text-[10px] text-muted-foreground tabular-nums"
                      data-testid={`text-task-count-${dateStr}`}
                    >
                      {dayTasks.length}
                    </span>
                  )}
                </div>

                <div className="p-2 flex-1 space-y-1.5 min-h-[120px]">
                  {dayEvents.map((evt) => (
                    <div
                      key={evt.id}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-100/60 dark:border-violet-900/40"
                      data-testid={`calendar-event-${evt.id}`}
                    >
                      <Clock className="h-3 w-3 text-violet-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium block truncate">
                          {evt.subject}
                        </span>
                        {!evt.isAllDay && (
                          <span className="text-[9px] text-muted-foreground">
                            {(() => {
                              try {
                                return format(parseISO(evt.start), "HH:mm");
                              } catch {
                                return "";
                              }
                            })()}
                            {(() => {
                              try {
                                return " – " + format(parseISO(evt.end), "HH:mm");
                              } catch {
                                return "";
                              }
                            })()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}

                  {dayTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      compact
                      draggable
                      onStatusChange={handleStatusChange}
                      onOpenDrawer={handleOpenDrawer}
                      onQuickDone={handleQuickDone}
                      onDragStart={handleDragStart}
                    />
                  ))}

                  {dayTasks.length === 0 && dayEvents.length === 0 && (
                    <p
                      className="text-[11px] text-muted-foreground/40 text-center py-6"
                      data-testid={`empty-day-${dateStr}`}
                    >
                      No tasks
                    </p>
                  )}
                </div>

                <div className="px-2 pb-2">
                  <div className="flex gap-1">
                    <Input
                      placeholder="+ Add task"
                      value={quickAddTexts[dateStr] || ""}
                      onChange={(e) =>
                        setQuickAddTexts((prev) => ({ ...prev, [dateStr]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !createTaskMutation.isPending) {
                          handleQuickAddForDay(dateStr);
                        }
                      }}
                      disabled={createTaskMutation.isPending}
                      className="h-7 text-xs border-border/30 bg-transparent focus:bg-background"
                      data-testid={`input-quick-add-${dateStr}`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-primary"
                      onClick={() => handleQuickAddForDay(dateStr)}
                      disabled={createTaskMutation.isPending}
                      data-testid={`button-quick-add-${dateStr}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <TaskDetailDrawer
        task={drawerTask}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onInvalidate={invalidateAll}
      />
    </MyToolLayout>
  );
}
