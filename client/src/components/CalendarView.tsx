import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  addMonths,
  subMonths,
  isSameDay,
  isToday,
  startOfWeek,
  endOfWeek,
  isSameMonth,
} from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Calendar, Flag, Clock, AlertCircle } from "lucide-react";

interface CalendarViewProps {
  projectName: string;
  onTaskClick: (taskId: number) => void;
}

const PRIORITY_DOT: Record<string, string> = {
  Urgent: "bg-red-500",
  High: "bg-orange-500",
  Normal: "bg-gray-400",
  Low: "bg-blue-400",
};

const STATUS_COLOR: Record<string, string> = {
  "Not Started": "text-gray-600",
  "In Progress": "text-blue-600",
  Blocked: "text-red-600",
  Done: "text-green-600",
  Complete: "text-green-600",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseTaskDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

export default function CalendarView({ projectName, onTaskClick }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const { data: tasks = [], isLoading } = useQuery<any[]>({
    queryKey: ["operational-tasks", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/operational-tasks/${encodeURIComponent(projectName)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [currentMonth]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const task of tasks) {
      const date = parseTaskDate(task.dueDate);
      if (date) {
        const key = format(date, "yyyy-MM-dd");
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(task);
      }
    }
    return map;
  }, [tasks]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="calendar-loading">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="calendar-view">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          data-testid="calendar-prev-month"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold" data-testid="calendar-month-label">
            {format(currentMonth, "MMMM yyyy")}
          </h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          data-testid="calendar-next-month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/50">
          {WEEKDAYS.map((day) => (
            <div key={day} className="py-2 text-center text-xs font-medium text-muted-foreground border-b">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {calendarDays.map((day, idx) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const dayTasks = tasksByDate.get(dateKey) || [];
            const inCurrentMonth = isSameMonth(day, currentMonth);
            const today = isToday(day);

            return (
              <div
                key={idx}
                className={`min-h-[90px] border-b border-r p-1 ${
                  !inCurrentMonth ? "bg-muted/20" : "bg-background"
                } ${today ? "ring-2 ring-blue-500 ring-inset" : ""}`}
                data-testid={`calendar-day-${dateKey}`}
              >
                <div className={`text-xs font-medium mb-0.5 ${
                  !inCurrentMonth ? "text-muted-foreground/50" : today ? "text-blue-600 font-bold" : "text-foreground"
                }`}>
                  {format(day, "d")}
                </div>

                <div className="space-y-0.5 max-h-[60px] overflow-y-auto">
                  {dayTasks.length <= 3 ? (
                    dayTasks.map((task: any) => (
                      <button
                        key={task.id}
                        onClick={() => onTaskClick(task.id)}
                        className={`w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded truncate hover:bg-accent transition-colors ${
                          PRIORITY_DOT[task.priority] ? "" : ""
                        }`}
                        data-testid={`calendar-task-${task.id}`}
                      >
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${PRIORITY_DOT[task.priority] || PRIORITY_DOT.Normal}`} />
                        <span className="truncate">{task.title}</span>
                      </button>
                    ))
                  ) : (
                    <>
                      {dayTasks.slice(0, 2).map((task: any) => (
                        <button
                          key={task.id}
                          onClick={() => onTaskClick(task.id)}
                          className="w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded truncate hover:bg-accent transition-colors"
                          data-testid={`calendar-task-${task.id}`}
                        >
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${PRIORITY_DOT[task.priority] || PRIORITY_DOT.Normal}`} />
                          <span className="truncate">{task.title}</span>
                        </button>
                      ))}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className="w-full text-left text-[10px] text-blue-600 hover:text-blue-800 px-1 py-0.5"
                            data-testid={`calendar-more-${dateKey}`}
                          >
                            +{dayTasks.length - 2} more
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2" align="start">
                          <div className="text-xs font-semibold mb-2">
                            {format(day, "EEEE, MMM d")}
                          </div>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {dayTasks.map((task: any) => (
                              <button
                                key={task.id}
                                onClick={() => onTaskClick(task.id)}
                                className="w-full text-left p-2 rounded hover:bg-accent transition-colors border"
                                data-testid={`popover-task-${task.id}`}
                              >
                                <div className="text-xs font-medium truncate">{task.title}</div>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge className={`text-[9px] px-1 py-0 ${
                                    task.priority === "Urgent" ? "bg-red-100 text-red-800" :
                                    task.priority === "High" ? "bg-orange-100 text-orange-800" :
                                    task.priority === "Low" ? "bg-blue-100 text-blue-800" :
                                    "bg-gray-100 text-gray-800"
                                  }`}>
                                    <Flag className="h-2 w-2 mr-0.5" />
                                    {task.priority}
                                  </Badge>
                                  <span className={`text-[9px] ${STATUS_COLOR[task.status] || "text-gray-600"}`}>
                                    {task.status}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {tasks.length === 0 && (
        <div className="text-center py-12 text-muted-foreground" data-testid="calendar-empty">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No tasks found for this project</p>
        </div>
      )}
    </div>
  );
}
