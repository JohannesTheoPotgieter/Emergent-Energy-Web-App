import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
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
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  ExternalLink,
  Circle,
  CheckCircle2,
  AlertTriangle,
  GripVertical,
  ListTodo,
  X,
  RefreshCw,
} from "lucide-react";
import { useLocation } from "wouter";
import { PageShell, SectionHeader, WorkspaceNotice } from "@/components/layout/page-shell";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function isExternalHref(value?: string | null) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
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

interface CalendarTask {
  id: number | string;
  taskType: "mytool" | "operational" | "plan" | "engineering" | "quality" | "tr_register" | "deliverable" | "approval" | "ms_object";
  title: string;
  status: string;
  priority: string;
  projectName: string | null;
  plannedForDate: string | null;
  dueDate: string | null;
  startDate: string | null;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  pctComplete?: number | null;
  phase?: string | null;
  owner?: string | null;
  lifecyclePhase?: string | null;
  ragStatus?: string | null;
  department?: string | null;
  sourceHref?: string | null;
  projectHref?: string | null;
  externalHref?: string | null;
  sourceContextLabel?: string | null;
  sourceTypeLabel?: string | null;
}

const TASK_TYPE_COLORS: Record<string, { bg: string; border: string; text: string; subText: string; hoverBg: string; bgLight: string; hoverLight: string; legendBg: string; legendBorder: string }> = {
  mytool: { bg: "bg-emerald-100", border: "border-emerald-300", text: "text-emerald-900", subText: "text-emerald-700", hoverBg: "hover:bg-emerald-200", bgLight: "bg-emerald-50", hoverLight: "hover:bg-emerald-100", legendBg: "bg-emerald-100", legendBorder: "border-emerald-200" },
  operational: { bg: "bg-amber-100", border: "border-amber-300", text: "text-amber-900", subText: "text-amber-700", hoverBg: "hover:bg-amber-200", bgLight: "bg-amber-50", hoverLight: "hover:bg-amber-100", legendBg: "bg-amber-100", legendBorder: "border-amber-200" },
  plan: { bg: "bg-violet-100", border: "border-violet-300", text: "text-violet-900", subText: "text-violet-700", hoverBg: "hover:bg-violet-200", bgLight: "bg-violet-50", hoverLight: "hover:bg-violet-100", legendBg: "bg-violet-100", legendBorder: "border-violet-200" },
  engineering: { bg: "bg-cyan-100", border: "border-cyan-300", text: "text-cyan-900", subText: "text-cyan-700", hoverBg: "hover:bg-cyan-200", bgLight: "bg-cyan-50", hoverLight: "hover:bg-cyan-100", legendBg: "bg-cyan-100", legendBorder: "border-cyan-200" },
  quality: { bg: "bg-rose-100", border: "border-rose-300", text: "text-rose-900", subText: "text-rose-700", hoverBg: "hover:bg-rose-200", bgLight: "bg-rose-50", hoverLight: "hover:bg-rose-100", legendBg: "bg-rose-100", legendBorder: "border-rose-200" },
  tr_register: { bg: "bg-purple-100", border: "border-purple-300", text: "text-purple-900", subText: "text-purple-700", hoverBg: "hover:bg-purple-200", bgLight: "bg-purple-50", hoverLight: "hover:bg-purple-100", legendBg: "bg-purple-100", legendBorder: "border-purple-200" },
  deliverable: { bg: "bg-pink-100", border: "border-pink-300", text: "text-pink-900", subText: "text-pink-700", hoverBg: "hover:bg-pink-200", bgLight: "bg-pink-50", hoverLight: "hover:bg-pink-100", legendBg: "bg-pink-100", legendBorder: "border-pink-200" },
  approval: { bg: "bg-orange-100", border: "border-orange-300", text: "text-orange-900", subText: "text-orange-700", hoverBg: "hover:bg-orange-200", bgLight: "bg-orange-50", hoverLight: "hover:bg-orange-100", legendBg: "bg-orange-100", legendBorder: "border-orange-200" },
  ms_object: { bg: "bg-indigo-100", border: "border-indigo-300", text: "text-indigo-900", subText: "text-indigo-700", hoverBg: "hover:bg-indigo-200", bgLight: "bg-indigo-50", hoverLight: "hover:bg-indigo-100", legendBg: "bg-indigo-100", legendBorder: "border-indigo-200" },
};

const TASK_TYPE_LABELS: Record<string, string> = {
  mytool: "Personal",
  operational: "Operational",
  plan: "Project Plan",
  engineering: "Engineering",
  quality: "Quality",
  tr_register: "Action Item",
  deliverable: "Deliverable",
  approval: "Approval",
  ms_object: "MS 365",
};

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
    case "DONE":
    case "Complete":
      return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
    case "in_progress":
    case "IN PROGRESS":
      return <Clock className="h-3 w-3 text-blue-500" />;
    case "blocked":
    case "BLOCKED":
      return <AlertTriangle className="h-3 w-3 text-red-500" />;
    default:
      return <Circle className="h-3 w-3 text-muted-foreground" />;
  }
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  Critical: "bg-red-500",
  high: "bg-orange-500",
  High: "bg-orange-500",
  normal: "bg-blue-500",
  Med: "bg-blue-500",
  low: "bg-gray-400",
  Low: "bg-gray-400",
};

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7);

function hourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function formatTimeDisplay(t: string): string {
  const mins = timeToMinutes(t);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const CAL_SOURCE_FILTERS = [
  { key: "all", label: "All" },
  { key: "mytool", label: "Personal" },
  { key: "operational", label: "Operational" },
  { key: "plan", label: "Plan" },
  { key: "engineering", label: "Engineering" },
  { key: "quality", label: "Quality" },
  { key: "approval", label: "Approvals" },
  { key: "deliverable", label: "Deliverables" },
  { key: "tr_register", label: "Action Items" },
  { key: "ms_object", label: "MS 365" },
];

export default function MyWorkCalendarPage() {
  const [, navigate] = useLocation();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"week" | "day">("week");
  const [showUnscheduled, setShowUnscheduled] = useState(true);
  const [draggedTask, setDraggedTask] = useState<CalendarTask | null>(null);
  const [dropTarget, setDropTarget] = useState<{ dayKey: string; hour: number } | null>(null);
  const [calSourceFilter, setCalSourceFilter] = useState<string>("all");
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    queryClient.removeQueries({ queryKey: ["outlook-status"] });
    queryClient.removeQueries({ queryKey: ["outlook-events-calendar"] });
  }, []);

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
    staleTime: 0,
    gcTime: 0,
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
    enabled: connectionStatus !== undefined,
    staleTime: 0,
    gcTime: 0,
  });

  const { data: allTaskData, isLoading: tasksLoading } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/my-work/all-tasks", {
        headers: authHeaders(),
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 0,
    gcTime: 0,
  });

  const { data: msActionItems = [] } = useQuery<Array<{ id: number; type: string; subject_or_title: string; preview: string | null; web_link: string | null; received_or_start_datetime: string | null; action_required: boolean }>>({
    queryKey: ["/api/ms-objects/mine", "action_required"],
    queryFn: async () => {
      const res = await fetch("/api/ms-objects/mine?action_required=true", {
        credentials: "include",
        headers: authHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const microsoftItems = useMemo(() => {
    if (Array.isArray(allTaskData?.microsoftItems) && allTaskData.microsoftItems.length > 0) {
      return allTaskData.microsoftItems;
    }
    return msActionItems;
  }, [allTaskData?.microsoftItems, msActionItems]);

  const calendarTasks: CalendarTask[] = useMemo(() => {
    if (!allTaskData) return [];
    const tasks: CalendarTask[] = [];
    const withSourceContext = (task: CalendarTask, raw?: Record<string, any> | null): CalendarTask => ({
      ...task,
      sourceHref: raw?.sourceHref || null,
      projectHref: raw?.projectHref || null,
      externalHref: raw?.externalHref || null,
      sourceContextLabel: raw?.sourceContextLabel || null,
      sourceTypeLabel: raw?.sourceTypeLabel || null,
    });

    for (const t of (allTaskData.personal || [])) {
      tasks.push(withSourceContext({
        id: t.id,
        taskType: "mytool",
        title: t.title || "",
        status: t.status || "inbox",
        priority: t.priority || "normal",
        projectName: t.projectName || null,
        plannedForDate: t.plannedForDate || null,
        dueDate: t.dueAt ? (typeof t.dueAt === "string" ? t.dueAt.split("T")[0] : null) : null,
        startDate: t.startDate || null,
        scheduledDate: t.scheduledDate || null,
        scheduledStartTime: t.scheduledStartTime || null,
        scheduledEndTime: t.scheduledEndTime || null,
      }, t));
    }

    for (const t of (allTaskData.operational || [])) {
      tasks.push(withSourceContext({
        id: t.id,
        taskType: "operational",
        title: t.title || "",
        status: t.status || "TO DO",
        priority: t.priority || "normal",
        projectName: t.projectName || null,
        plannedForDate: null,
        dueDate: t.dueDate || null,
        startDate: t.startDate || null,
        scheduledDate: t.scheduledDate || null,
        scheduledStartTime: t.scheduledStartTime || null,
        scheduledEndTime: t.scheduledEndTime || null,
      }, t));
    }

    for (const t of (allTaskData.planTasks || [])) {
      tasks.push(withSourceContext({
        id: t.id,
        taskType: "plan",
        title: t.title || "",
        status: t.status || "active",
        priority: "Medium",
        projectName: t.projectName || null,
        plannedForDate: t.startDate || null,
        dueDate: t.endDate || null,
        startDate: t.startDate || null,
        scheduledDate: t.scheduledDate || null,
        scheduledStartTime: t.scheduledStartTime || null,
        scheduledEndTime: t.scheduledEndTime || null,
        pctComplete: t.pctComplete,
        phase: t.phase,
        owner: t.owner,
      }, t));
    }

    for (const t of (allTaskData.engineeringTasks || [])) {
      tasks.push(withSourceContext({
        id: t.id,
        taskType: "engineering",
        title: t.title || "",
        status: t.status || "open",
        priority: "Medium",
        projectName: t.projectName || null,
        plannedForDate: null,
        dueDate: null,
        startDate: null,
        scheduledDate: t.scheduledDate || null,
        scheduledStartTime: t.scheduledStartTime || null,
        scheduledEndTime: t.scheduledEndTime || null,
        lifecyclePhase: t.lifecyclePhase,
      }, t));
    }

    for (const t of (allTaskData.qualityTasks || [])) {
      tasks.push(withSourceContext({
        id: t.id,
        taskType: "quality",
        title: t.title || "",
        status: t.status || "not_started",
        priority: "Medium",
        projectName: t.projectName || null,
        plannedForDate: t.startDate || null,
        dueDate: t.endDate || null,
        startDate: t.startDate || null,
        scheduledDate: t.scheduledDate || null,
        scheduledStartTime: t.scheduledStartTime || null,
        scheduledEndTime: t.scheduledEndTime || null,
      }, t));
    }

    for (const t of (allTaskData.trRegister || [])) {
      const dueDateStr = t.dueDate ? (typeof t.dueDate === "string" ? t.dueDate.split("T")[0] : null) : null;
      tasks.push(withSourceContext({
        id: t.id,
        taskType: "tr_register",
        title: t.actionDescription || "",
        status: t.status || "Active",
        priority: t.ragStatus === "Red" ? "Critical" : t.ragStatus === "Amber" ? "High" : "Medium",
        projectName: null,
        plannedForDate: null,
        dueDate: dueDateStr,
        startDate: null,
        scheduledDate: t.scheduledDate || null,
        scheduledStartTime: t.scheduledStartTime || null,
        scheduledEndTime: t.scheduledEndTime || null,
        ragStatus: t.ragStatus || null,
        department: t.department || null,
      }, t));
    }

    for (const d of (allTaskData.deliverables || [])) {
      tasks.push(withSourceContext({
        id: d.id,
        taskType: "deliverable",
        title: d.title || "",
        status: d.status || "TO DO",
        priority: "Medium",
        projectName: d.projectName || d.project_name || null,
        plannedForDate: null,
        dueDate: null,
        startDate: null,
        scheduledDate: d.scheduledDate || d.scheduled_date || null,
        scheduledStartTime: d.scheduledStartTime || d.scheduled_start_time || null,
        scheduledEndTime: d.scheduledEndTime || d.scheduled_end_time || null,
      }, d));
    }

    for (const a of (allTaskData.approvals?.engineering || [])) {
      tasks.push(withSourceContext({
        id: a.id,
        taskType: "approval",
        title: a.title || "",
        status: a.status || "pending",
        priority: "High",
        projectName: a.projectName || null,
        plannedForDate: null,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
      }, a));
    }
    for (const a of (allTaskData.approvals?.quality || [])) {
      tasks.push(withSourceContext({
        id: a.id,
        taskType: "approval",
        title: a.title || "",
        status: a.status || "review",
        priority: "High",
        projectName: a.projectName || null,
        plannedForDate: null,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
      }, a));
    }
    for (const a of (allTaskData.approvals?.general || [])) {
      tasks.push(withSourceContext({
        id: a.id,
        taskType: "approval",
        title: a.title || "",
        status: a.status || "pending",
        priority: "High",
        projectName: a.projectName || null,
        plannedForDate: null,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
      }, a));
    }

    for (const item of microsoftItems) {
      tasks.push(withSourceContext({
        id: `ms-${item.id}`,
        taskType: "ms_object",
        title: item.subjectOrTitle || item.subject_or_title || "",
        status: "action_required",
        priority: "Medium",
        projectName: item.linkedProjectName || null,
        plannedForDate: null,
        dueDate: (item.receivedOrStartDatetime || item.received_or_start_datetime)?.split("T")[0] || null,
        startDate: null,
        scheduledDate: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
      }, item));
    }

    return tasks;
  }, [allTaskData, microsoftItems]);

  const scheduleMutation = useMutation({
    mutationFn: async (payload: {
      taskType: string;
      taskId: number;
      scheduledDate: string | null;
      scheduledStartTime: string | null;
      scheduledEndTime: string | null;
    }) => {
      const res = await fetch("/api/calendar/schedule-task", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to schedule task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-work/all-tasks"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Scheduling failed",
        description: err.message || "Could not schedule the task. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleOpenTaskContext = useCallback((task: CalendarTask) => {
    const href = task.sourceHref || task.projectHref || task.externalHref || "/my-work/tasks";
    if (isExternalHref(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    navigate(href);
  }, [navigate]);

  const days = viewMode === "week"
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    : [currentDate];

  const toggleSource = useCallback((source: string) => {
    setHiddenSources(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source); else next.add(source);
      return next;
    });
  }, []);

  const scheduledTasksByDay = useMemo(() => {
    const map: Record<string, CalendarTask[]> = {};
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      map[key] = calendarTasks.filter((t) => t.scheduledDate === key && t.scheduledStartTime && !hiddenSources.has(t.taskType));
    }
    return map;
  }, [calendarTasks, days, hiddenSources]);

  const completedStatuses = new Set(["done", "DONE", "Complete", "Completed", "COMPLETED", "cancelled", "CANCELLED", "closed", "resolved", "approved"]);

  const unscheduledTasks = useMemo(() => {
    return calendarTasks.filter(
      (t) => !t.scheduledDate && !completedStatuses.has(t.status)
    );
  }, [calendarTasks]);

  const filteredUnscheduled = useMemo(() => {
    let result = unscheduledTasks;
    if (calSourceFilter !== "all") result = result.filter(t => t.taskType === calSourceFilter);
    if (hiddenSources.size > 0) result = result.filter(t => !hiddenSources.has(t.taskType));
    return result;
  }, [unscheduledTasks, calSourceFilter, hiddenSources]);

  const calSourceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: unscheduledTasks.length };
    for (const t of unscheduledTasks) {
      counts[t.taskType] = (counts[t.taskType] || 0) + 1;
    }
    return counts;
  }, [unscheduledTasks]);

  const outlookByDay = useMemo(() => {
    const isOutlookHidden = hiddenSources.has("outlook");
    const map: Record<string, OutlookEvent[]> = {};
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd");
      if (isOutlookHidden) {
        map[key] = [];
      } else {
        map[key] = outlookEvents.filter((ev) => {
          const s = getStartStr(ev);
          if (!s) return false;
          try { return format(parseISO(s), "yyyy-MM-dd") === key; } catch { return false; }
        });
      }
    }
    return map;
  }, [outlookEvents, days, hiddenSources]);

  const handleDragStart = useCallback((task: CalendarTask) => {
    setDraggedTask(task);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, dayKey: string, hour: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ dayKey, hour });
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dayKey: string, hour: number) => {
    e.preventDefault();
    setDropTarget(null);

    if (!draggedTask) return;
    if (typeof draggedTask.id !== "number") return;

    let durationMins = 60;
    if (draggedTask.scheduledStartTime && draggedTask.scheduledEndTime) {
      durationMins = timeToMinutes(draggedTask.scheduledEndTime) - timeToMinutes(draggedTask.scheduledStartTime);
      if (durationMins <= 0) durationMins = 60;
    }

    const startMins = hour * 60;
    const startTime = minutesToTime(startMins);
    const endTime = minutesToTime(startMins + durationMins);

    scheduleMutation.mutate({
      taskType: draggedTask.taskType,
      taskId: draggedTask.id,
      scheduledDate: dayKey,
      scheduledStartTime: startTime,
      scheduledEndTime: endTime,
    });

    setDraggedTask(null);
  }, [draggedTask, scheduleMutation]);

  const handleUnschedule = useCallback((task: CalendarTask) => {
    if (typeof task.id !== "number") return;
    scheduleMutation.mutate({
      taskType: task.taskType,
      taskId: task.id,
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
    });
  }, [scheduleMutation]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ms-sync/trigger", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "calendar" }),
      });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["outlook-events-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["outlook-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-work/all-tasks"] });
      if (data?.success === false && data?.error === "ms_sso_required") {
        toast({
          title: "Microsoft Sign-In Required",
          description: "Please sign in with Microsoft 365 SSO to sync your calendar events.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Calendar Synced",
          description: "Your Outlook calendar events have been refreshed.",
        });
      }
    },
    onError: () => {
      toast({
        title: "Sync Failed",
        description: "Could not refresh calendar data. Please try again.",
        variant: "destructive",
      });
    },
  });

  const isLoading = outlookLoading || tasksLoading;

  return (
    <PageShell className="space-y-4 h-full flex flex-col" data-testid="my-work-calendar">
      <SectionHeader
        icon={<CalendarDays className="h-5 w-5" />}
        title="Calendar"
        eyebrow="My Work"
        description="One planning view for Outlook events and your app work so day-to-day scheduling stays practical."
        badges={[
          { label: `${outlookEvents.length} Outlook item${outlookEvents.length === 1 ? "" : "s"}`, variant: "outline" },
          { label: `${unscheduledTasks.length} unscheduled task${unscheduledTasks.length === 1 ? "" : "s"}`, variant: "secondary" },
          { label: viewMode === "week" ? "Week view" : "Day view", variant: "outline" },
        ]}
        actions={(
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-refresh-connection"
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Refresh Connection"}
          </Button>
        )}
      />

      <WorkspaceNotice
        title="Microsoft-linked scheduling"
        description="Outlook remains the source for meetings while app tasks can be scheduled alongside it. Drag work into time slots without leaving My Work."
        tone="microsoft"
        icon={<Clock className="h-4 w-4" />}
      >
        <Badge variant="outline">Outlook events</Badge>
        <Badge variant="outline">My Work tasks</Badge>
        <Badge variant="outline">Drag to schedule</Badge>
      </WorkspaceNotice>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="pb-3 shrink-0">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
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
              <h3 className="text-sm sm:text-lg font-semibold min-w-0 sm:min-w-[220px] text-center truncate" data-testid="text-calendar-range">
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
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
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
                className="hidden sm:inline-flex"
                data-testid="calendar-week-view"
              >
                Week
              </Button>
              <Button
                variant={showUnscheduled ? "default" : "outline"}
                size="sm"
                onClick={() => setShowUnscheduled(!showUnscheduled)}
                data-testid="calendar-toggle-unscheduled"
              >
                <ListTodo className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">My Tasks</span> ({unscheduledTasks.length})
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 mt-3 text-xs flex-wrap" data-testid="calendar-source-toggles">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mr-0.5">Show:</span>
            <button
              onClick={() => toggleSource("outlook")}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium transition-all cursor-pointer ${
                hiddenSources.has("outlook")
                  ? "opacity-40 bg-muted/30 border-border/30 text-muted-foreground line-through"
                  : "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
              }`}
              data-testid="toggle-source-outlook"
            >
              <span className="w-2 h-2 rounded-sm bg-blue-100 border border-blue-200" />
              Outlook
            </button>
            {Object.entries(TASK_TYPE_LABELS).map(([type, label]) => {
              const isHidden = hiddenSources.has(type);
              const colors = TASK_TYPE_COLORS[type];
              return (
                <button
                  key={type}
                  onClick={() => toggleSource(type)}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium transition-all cursor-pointer ${
                    isHidden
                      ? "opacity-40 bg-muted/30 border-border/30 text-muted-foreground line-through"
                      : `${colors.legendBg} ${colors.legendBorder} ${colors.text} hover:opacity-80`
                  }`}
                  data-testid={`toggle-source-${type}`}
                >
                  <span className={`w-2 h-2 rounded-sm ${colors.legendBg} border ${colors.legendBorder}`} />
                  {label}
                </button>
              );
            })}
            {hiddenSources.size > 0 && (
              <button
                onClick={() => setHiddenSources(new Set())}
                className="text-[10px] text-red-500 hover:underline ml-1"
                data-testid="calendar-show-all"
              >
                Show all
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col sm:flex-row min-h-0 gap-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 flex-1">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-auto">
                <TimeGridView
                  days={days}
                  viewMode={viewMode}
                  outlookByDay={outlookByDay}
                  scheduledTasksByDay={scheduledTasksByDay}
                  dropTarget={dropTarget}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onUnschedule={handleUnschedule}
                  onDragStartScheduled={handleDragStart}
                  onOpenTask={handleOpenTaskContext}
                />
              </div>

              {showUnscheduled && (
                <div className="w-full sm:w-72 shrink-0 border-t sm:border-t-0 sm:border-l pt-3 sm:pt-0 sm:pl-3 flex flex-col min-h-0 max-h-[200px] sm:max-h-none">
                  <div className="flex items-center justify-between mb-1.5 shrink-0">
                    <h4 className="text-sm font-semibold text-foreground">My Tasks</h4>
                    <Badge variant="secondary" className="text-xs" data-testid="badge-unscheduled-count">
                      {filteredUnscheduled.length}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2 shrink-0">
                    {CAL_SOURCE_FILTERS.filter(f => f.key === "all" || (calSourceCounts[f.key] || 0) > 0).map(f => (
                      <button
                        key={f.key}
                        onClick={() => setCalSourceFilter(f.key)}
                        className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap transition-colors border ${
                          calSourceFilter === f.key
                            ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                            : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                        }`}
                        data-testid={`cal-filter-${f.key}`}
                      >
                        {f.label} ({calSourceCounts[f.key] || 0})
                      </button>
                    ))}
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="space-y-1.5 pr-2">
                      {filteredUnscheduled.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic py-4 text-center">
                          {calSourceFilter === "all" ? "All tasks are scheduled" : "No tasks in this category"}
                        </p>
                      ) : (
                        filteredUnscheduled.map((task) => (
                          <DraggableTaskCard
                            key={`${task.taskType}-${task.id}`}
                            task={task}
                            onDragStart={handleDragStart}
                            onOpen={handleOpenTaskContext}
                          />
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

const NON_SCHEDULABLE_TYPES = new Set(["approval", "ms_object"]);

function DraggableTaskCard({
  task,
  onDragStart,
  onOpen,
}: {
  task: CalendarTask;
  onDragStart: (task: CalendarTask) => void;
  onOpen: (task: CalendarTask) => void;
}) {
  const colors = TASK_TYPE_COLORS[task.taskType] || TASK_TYPE_COLORS.mytool;
  const borderColor = colors.border.replace("border-", "border-").replace("-300", "-200");
  const bgColor = colors.bgLight;
  const hoverColor = colors.hoverLight;
  const textColor = colors.text;
  const subTextColor = colors.subText;
  const canSchedule = !NON_SCHEDULABLE_TYPES.has(task.taskType);

  return (
    <div
      draggable={canSchedule}
      onDragStart={canSchedule ? (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `${task.taskType}:${task.id}`);
        onDragStart(task);
      } : undefined}
      onClick={() => onOpen(task)}
      className={`rounded border ${borderColor} ${bgColor} ${hoverColor} px-2 py-1.5 text-xs ${canSchedule ? "cursor-grab active:cursor-grabbing" : "cursor-default opacity-80"} transition-colors group`}
      data-testid={`unscheduled-task-${task.taskType}-${task.id}`}
    >
      <div className="flex items-center gap-1">
        <GripVertical className="h-3 w-3 text-muted-foreground opacity-50 group-hover:opacity-100 shrink-0" />
        <StatusIcon status={task.status} />
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.normal}`}
        />
        <span className={`font-medium ${textColor} truncate flex-1`}>
          {task.title}
        </span>
        {(task.sourceHref || task.externalHref) && (
          <ExternalLink className="h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100" />
        )}
      </div>
      <div className="flex items-center gap-1 ml-5">
        <span className={`${subTextColor} text-[9px] font-medium uppercase`}>
          {task.sourceTypeLabel || TASK_TYPE_LABELS[task.taskType]}
        </span>
        {task.projectName && (
          <span className={`${subTextColor} text-[10px] truncate`}>
            · {task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
          </span>
        )}
      </div>
      {(task.dueDate || task.plannedForDate) && (
        <div className={`${subTextColor} text-[10px] ml-5`}>
          Due: {task.dueDate || task.plannedForDate}
        </div>
      )}
    </div>
  );
}

function TimeGridView({
  days,
  viewMode,
  outlookByDay,
  scheduledTasksByDay,
  dropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  onUnschedule,
  onDragStartScheduled,
  onOpenTask,
}: {
  days: Date[];
  viewMode: "week" | "day";
  outlookByDay: Record<string, OutlookEvent[]>;
  scheduledTasksByDay: Record<string, CalendarTask[]>;
  dropTarget: { dayKey: string; hour: number } | null;
  onDragOver: (e: React.DragEvent, dayKey: string, hour: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, dayKey: string, hour: number) => void;
  onUnschedule: (task: CalendarTask) => void;
  onDragStartScheduled: (task: CalendarTask) => void;
  onOpenTask: (task: CalendarTask) => void;
}) {
  const slotHeight = viewMode === "day" ? 64 : 48;

  return (
    <div className="flex min-w-0">
      <div className="w-14 shrink-0">
        <div className="h-10" />
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="text-[10px] text-muted-foreground text-right pr-2 flex items-start justify-end"
            style={{ height: slotHeight }}
          >
            {hourLabel(hour)}
          </div>
        ))}
      </div>

      <div className={`flex-1 grid min-w-0 ${viewMode === "week" ? "grid-cols-7" : "grid-cols-1"} divide-x`}>
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const today = isToday(day);
          const dayOutlookEvents = outlookByDay[key] || [];
          const dayScheduledTasks = scheduledTasksByDay[key] || [];

          return (
            <div key={key} className="relative flex flex-col min-w-0">
              <div
                className={`h-10 text-xs font-medium flex items-center justify-center border-b sticky top-0 z-10 bg-background ${today ? "text-blue-600 bg-blue-50/50" : "text-muted-foreground"}`}
              >
                {format(day, viewMode === "week" ? "EEE d" : "EEEE, MMM d")}
              </div>

              <div className="relative">
                {HOURS.map((hour) => {
                  const isTarget = dropTarget?.dayKey === key && dropTarget?.hour === hour;
                  return (
                    <div
                      key={hour}
                      className={`border-b border-dashed border-border/50 transition-colors ${isTarget ? "bg-emerald-100/60" : ""}`}
                      style={{ height: slotHeight }}
                      onDragOver={(e) => onDragOver(e, key, hour)}
                      onDragLeave={onDragLeave}
                      onDrop={(e) => onDrop(e, key, hour)}
                      data-testid={`timeslot-${key}-${hour}`}
                    />
                  );
                })}

                {dayOutlookEvents.map((ev, i) => {
                  const startStr = getStartStr(ev);
                  const endStr = getEndStr(ev);
                  if (!startStr) return null;

                  let startMins: number, endMins: number;
                  try {
                    const startDate = parseISO(startStr);
                    const endDate = endStr ? parseISO(endStr) : null;
                    startMins = startDate.getHours() * 60 + startDate.getMinutes();
                    endMins = endDate ? endDate.getHours() * 60 + endDate.getMinutes() : startMins + 60;
                  } catch {
                    return null;
                  }

                  if (ev.isAllDay) {
                    startMins = 7 * 60;
                    endMins = 7 * 60 + 30;
                  }

                  const topOffset = ((startMins - 7 * 60) / 60) * slotHeight;
                  const height = Math.max(((endMins - startMins) / 60) * slotHeight, 20);

                  if (topOffset < 0) return null;

                  let timeLabel = "";
                  try {
                    if (ev.isAllDay) {
                      timeLabel = "All day";
                    } else if (startStr) {
                      timeLabel = format(parseISO(startStr), "h:mm a");
                      if (endStr) timeLabel += ` – ${format(parseISO(endStr), "h:mm a")}`;
                    }
                  } catch {}

                  return (
                    <div
                      key={`outlook-${ev.id || i}`}
                      className="absolute left-0.5 right-0.5 rounded bg-blue-100 border border-blue-200 px-1.5 py-0.5 text-[10px] cursor-pointer hover:bg-blue-200 transition-colors overflow-hidden z-20"
                      style={{ top: topOffset, height, minHeight: 20 }}
                      title={`${ev.subject}\n${timeLabel}\n${getLocationStr(ev)}`}
                      onClick={() => {
                        if (ev.webLink) window.open(ev.webLink, "_blank", "noopener,noreferrer");
                      }}
                      data-testid={`calendar-outlook-event-${ev.id || i}`}
                    >
                      <div className="flex items-center gap-0.5">
                        <span className="font-medium text-blue-900 truncate flex-1 leading-tight">
                          {ev.subject || "No Subject"}
                        </span>
                        {ev.webLink && (
                          <ExternalLink className="h-2.5 w-2.5 text-blue-600 shrink-0" />
                        )}
                      </div>
                      {height > 24 && timeLabel && (
                        <div className="text-blue-700 text-[9px] leading-tight truncate">{timeLabel}</div>
                      )}
                      {height > 36 && getLocationStr(ev) && (
                        <div className="text-blue-600 text-[9px] leading-tight truncate">{getLocationStr(ev)}</div>
                      )}
                    </div>
                  );
                })}

                {dayScheduledTasks.map((task) => {
                  if (!task.scheduledStartTime) return null;
                  const startMins = timeToMinutes(task.scheduledStartTime);
                  const endMins = task.scheduledEndTime
                    ? timeToMinutes(task.scheduledEndTime)
                    : startMins + 60;

                  const topOffset = ((startMins - 7 * 60) / 60) * slotHeight;
                  const height = Math.max(((endMins - startMins) / 60) * slotHeight, 20);

                  if (topOffset < 0) return null;

                  const tc = TASK_TYPE_COLORS[task.taskType] || TASK_TYPE_COLORS.mytool;
                  const bg = tc.bg;
                  const border = tc.border;
                  const textColor = tc.text;
                  const subColor = tc.subText;
                  const hoverBg = tc.hoverBg;

                  return (
                    <div
                      key={`task-${task.taskType}-${task.id}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", `${task.taskType}:${task.id}`);
                        onDragStartScheduled(task);
                      }}
                      onClick={() => onOpenTask(task)}
                      className={`absolute left-0.5 right-0.5 rounded ${bg} border ${border} px-1.5 py-0.5 text-[10px] cursor-grab active:cursor-grabbing ${hoverBg} transition-colors overflow-hidden z-20 group`}
                      style={{ top: topOffset, height, minHeight: 20 }}
                      title={`${task.title}\n${formatTimeDisplay(task.scheduledStartTime)} – ${task.scheduledEndTime ? formatTimeDisplay(task.scheduledEndTime) : ""}`}
                      data-testid={`calendar-task-${task.taskType}-${task.id}`}
                    >
                      <div className="flex items-center gap-0.5">
                        <StatusIcon status={task.status} />
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.normal}`}
                        />
                        <span className={`font-medium ${textColor} truncate flex-1 leading-tight`}>
                          {task.title}
                        </span>
                        {(task.sourceHref || task.externalHref) && (
                          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-40 group-hover:opacity-100" />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUnschedule(task);
                          }}
                          className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-black/10 transition-opacity"
                          title="Remove from calendar"
                          data-testid={`unschedule-task-${task.taskType}-${task.id}`}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      {height > 24 && (
                        <div className={`${subColor} text-[9px] leading-tight`}>
                          {formatTimeDisplay(task.scheduledStartTime)}
                          {task.scheduledEndTime ? ` – ${formatTimeDisplay(task.scheduledEndTime)}` : ""}
                        </div>
                      )}
                      {height > 36 && task.projectName && (
                        <div className={`${subColor} text-[9px] leading-tight truncate`}>
                          {task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
