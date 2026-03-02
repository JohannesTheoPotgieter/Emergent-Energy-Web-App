import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isToday,
  parseISO,
} from "date-fns";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  ExternalLink,
  Circle,
  CheckCircle2,
  AlertTriangle,
  Target,
} from "lucide-react";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

interface OutlookEvent {
  id: string;
  subject: string;
  start: string | { dateTime: string };
  end: string | { dateTime: string };
  isAllDay?: boolean;
  location?: string | { displayName: string };
  webLink?: string;
  organizer?: string;
  showAs?: string;
  isCancelled?: boolean;
}

interface MsObjectEvent {
  id: number;
  type: string;
  subject_or_title: string;
  preview: string | null;
  web_link: string | null;
  received_or_start_datetime: string | null;
  action_required: boolean;
}

interface TaskItem {
  id: number;
  title: string;
  status: string;
  priority: string;
  plannedForDate: string | null;
  dueAt: string | null;
  projectName: string | null;
}

function getStartStr(ev: OutlookEvent): string {
  return typeof ev.start === "string" ? ev.start : ev.start?.dateTime || "";
}

function getEndStr(ev: OutlookEvent): string {
  return typeof ev.end === "string" ? ev.end : ev.end?.dateTime || "";
}

function getLocationStr(ev: OutlookEvent): string {
  if (!ev.location) return "";
  return typeof ev.location === "string" ? ev.location : ev.location.displayName || "";
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
    case "in_progress":
      return <Clock className="h-3 w-3 text-blue-500" />;
    case "blocked":
      return <AlertTriangle className="h-3 w-3 text-red-500" />;
    default:
      return <Circle className="h-3 w-3 text-muted-foreground" />;
  }
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

export default function MyWorkCalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"week" | "day">("week");

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });

  const startStr = format(viewMode === "week" ? weekStart : currentDate, "yyyy-MM-dd");
  const endStr = format(viewMode === "week" ? weekEnd : currentDate, "yyyy-MM-dd");

  const { data: connectionStatus } = useQuery<{ configured: boolean; connected: boolean }>({
    queryKey: ["outlook-status"],
    queryFn: async () => {
      const res = await fetch("/api/outlook/status", { headers: authHeaders(), credentials: "include" });
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: outlookEvents = [], isLoading: outlookLoading } = useQuery<OutlookEvent[]>({
    queryKey: ["outlook-events-calendar", startStr, endStr],
    queryFn: async () => {
      const res = await fetch(`/api/outlook/events?start=${startStr}&end=${endStr}`, {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.filter((e: OutlookEvent) => !e.isCancelled) : [];
    },
    enabled: connectionStatus?.connected === true,
    staleTime: 30_000,
  });

  const { data: msObjectEvents = [], isLoading: msLoading } = useQuery<MsObjectEvent[]>({
    queryKey: ["/api/ms-objects/mine", "event", startStr, endStr],
    queryFn: async () => {
      const res = await fetch(`/api/ms-objects/mine?type=event`, {
        credentials: "include",
        headers: authHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: rawTasks = [], isLoading: tasksLoading } = useQuery<any[]>({
    queryKey: ["/api/mytool/tasks"],
  });

  const tasks: TaskItem[] = useMemo(() =>
    rawTasks.map((t: any) => ({
      id: t.id,
      title: t.title || "",
      status: t.status || "inbox",
      priority: t.priority || "normal",
      plannedForDate: t.plannedForDate || t.planned_for_date || null,
      dueAt: t.dueAt || t.due_at || null,
      projectName: t.projectName || t.project_name || null,
    })),
  [rawTasks]);

  const days = viewMode === "week"
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    : [currentDate];

  const outlookByDay = useMemo(() => {
    const map: Record<string, OutlookEvent[]> = {};
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      map[key] = outlookEvents.filter((ev) => {
        const s = getStartStr(ev);
        if (!s) return false;
        try {
          return format(parseISO(s), "yyyy-MM-dd") === key;
        } catch {
          return false;
        }
      });
    }
    return map;
  }, [outlookEvents, days]);

  const msEventsByDay = useMemo(() => {
    const map: Record<string, MsObjectEvent[]> = {};
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      map[key] = msObjectEvents.filter((ev) => {
        if (!ev.received_or_start_datetime) return false;
        try {
          return format(parseISO(ev.received_or_start_datetime), "yyyy-MM-dd") === key;
        } catch {
          return false;
        }
      });
    }
    return map;
  }, [msObjectEvents, days]);

  const tasksByDay = useMemo(() => {
    const map: Record<string, TaskItem[]> = {};
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      map[key] = tasks.filter((t) => {
        const d = t.plannedForDate || t.dueAt;
        if (!d) return false;
        try {
          return format(parseISO(d), "yyyy-MM-dd") === key;
        } catch {
          return false;
        }
      });
    }
    return map;
  }, [tasks, days]);

  const isLoading = outlookLoading || msLoading || tasksLoading;

  return (
    <div className="space-y-4 h-full flex flex-col" data-testid="my-work-calendar">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-calendar-title">
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Outlook events and tasks combined
          </p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  if (viewMode === "week") setCurrentDate(subWeeks(currentDate, 1));
                  else setCurrentDate(addDays(currentDate, -1));
                }}
                data-testid="calendar-prev"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h3 className="text-lg font-semibold min-w-[220px] text-center" data-testid="text-calendar-range">
                {viewMode === "week"
                  ? `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`
                  : format(currentDate, "EEEE, MMMM d, yyyy")}
              </h3>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  if (viewMode === "week") setCurrentDate(addWeeks(currentDate, 1));
                  else setCurrentDate(addDays(currentDate, 1));
                }}
                data-testid="calendar-next"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentDate(new Date())}
                data-testid="calendar-today"
              >
                Today
              </Button>
              <Button
                variant={viewMode === "day" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("day")}
                data-testid="calendar-day-view"
              >
                Day
              </Button>
              <Button
                variant={viewMode === "week" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("week")}
                data-testid="calendar-week-view"
              >
                Week
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-100 border border-blue-200" />
              Outlook Events
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-100 border border-emerald-200" />
              Tasks
            </div>
            {msObjectEvents.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-purple-100 border border-purple-200" />
                Synced Events
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className={viewMode === "week" ? "grid grid-cols-7 gap-2 flex-1" : "flex-1"}>
              {days.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayOutlookEvents = outlookByDay[key] || [];
                const dayMsEvents = msEventsByDay[key] || [];
                const dayTasks = tasksByDay[key] || [];
                const today = isToday(day);
                const hasContent = dayOutlookEvents.length > 0 || dayMsEvents.length > 0 || dayTasks.length > 0;

                return (
                  <div
                    key={key}
                    className={`${viewMode === "week" ? "min-h-[400px]" : "min-h-[500px]"} rounded-lg border p-2 ${today ? "border-blue-500 bg-blue-50/50" : "border-border"}`}
                    data-testid={`calendar-day-${key}`}
                  >
                    <div className={`text-xs font-medium mb-2 ${today ? "text-blue-600" : "text-muted-foreground"}`}>
                      {format(day, viewMode === "week" ? "EEE d" : "EEEE, MMM d")}
                    </div>

                    {!hasContent ? (
                      <p className="text-xs text-muted-foreground/50 italic">No events</p>
                    ) : (
                      <ScrollArea className={viewMode === "week" ? "max-h-[370px]" : "max-h-[470px]"}>
                        <div className="space-y-1">
                          {dayOutlookEvents
                            .sort((a, b) => getStartStr(a).localeCompare(getStartStr(b)))
                            .map((ev, i) => {
                              const start = getStartStr(ev);
                              const end = getEndStr(ev);
                              let timeLabel = "";
                              try {
                                if (ev.isAllDay) {
                                  timeLabel = "All day";
                                } else if (start) {
                                  timeLabel = format(parseISO(start), "h:mm a");
                                  if (end) timeLabel += ` – ${format(parseISO(end), "h:mm a")}`;
                                }
                              } catch {}

                              return (
                                <div
                                  key={`outlook-${ev.id || i}`}
                                  className="rounded bg-blue-100 border border-blue-200 px-2 py-1 text-xs cursor-pointer hover:bg-blue-200 transition-colors group"
                                  title={ev.subject}
                                  onClick={() => {
                                    if (ev.webLink) window.open(ev.webLink, "_blank", "noopener,noreferrer");
                                  }}
                                  data-testid={`calendar-outlook-event-${ev.id || i}`}
                                >
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-blue-900 truncate flex-1">
                                      {ev.subject || "No Subject"}
                                    </span>
                                    {ev.webLink && (
                                      <ExternalLink className="h-3 w-3 text-blue-600 opacity-0 group-hover:opacity-100 shrink-0" />
                                    )}
                                  </div>
                                  {timeLabel && (
                                    <div className="text-blue-700 text-[10px]">{timeLabel}</div>
                                  )}
                                  {getLocationStr(ev) && (
                                    <div className="text-blue-600 text-[10px] truncate">{getLocationStr(ev)}</div>
                                  )}
                                </div>
                              );
                            })}

                          {dayMsEvents.map((ev) => (
                            <div
                              key={`ms-${ev.id}`}
                              className="rounded bg-purple-100 border border-purple-200 px-2 py-1 text-xs cursor-pointer hover:bg-purple-200 transition-colors group"
                              title={ev.subject_or_title}
                              onClick={() => {
                                if (ev.web_link) window.open(ev.web_link, "_blank", "noopener,noreferrer");
                              }}
                              data-testid={`calendar-ms-event-${ev.id}`}
                            >
                              <div className="flex items-center gap-1">
                                <span className="font-medium text-purple-900 truncate flex-1">
                                  {ev.subject_or_title || "No Title"}
                                </span>
                                {ev.web_link && (
                                  <ExternalLink className="h-3 w-3 text-purple-600 opacity-0 group-hover:opacity-100 shrink-0" />
                                )}
                              </div>
                              {ev.received_or_start_datetime && (
                                <div className="text-purple-700 text-[10px]">
                                  {(() => {
                                    try {
                                      return format(parseISO(ev.received_or_start_datetime), "h:mm a");
                                    } catch {
                                      return "";
                                    }
                                  })()}
                                </div>
                              )}
                            </div>
                          ))}

                          {dayTasks.map((task) => (
                            <div
                              key={`task-${task.id}`}
                              className="rounded bg-emerald-50 border border-emerald-200 px-2 py-1 text-xs hover:bg-emerald-100 transition-colors"
                              data-testid={`calendar-task-${task.id}`}
                            >
                              <div className="flex items-center gap-1">
                                <StatusIcon status={task.status} />
                                <span
                                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.normal}`}
                                />
                                <span className="font-medium text-emerald-900 truncate flex-1">
                                  {task.title}
                                </span>
                              </div>
                              {task.projectName && (
                                <div className="text-emerald-700 text-[10px] truncate">
                                  {task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
