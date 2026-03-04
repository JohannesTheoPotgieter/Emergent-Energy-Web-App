import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isToday } from "date-fns";
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Calendar,
  Mail,
  ExternalLink,
  ChevronRight,
  Inbox,
  Target,
  Loader2,
  FolderOpen,
  Flag,
  ArrowRight,
  RefreshCw,
} from "lucide-react";

interface TaskItem {
  id: number | string;
  title: string;
  status: string;
  priority: string;
  plannedForDate: string | null;
  dueAt: string | null;
  projectName: string | null;
  department: string | null;
  sortOrder: number;
  source?: string;
  sourceLabel?: string;
  link?: string;
}

interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string | null;
  organizer: string | null;
  showAs: string;
  isCancelled: boolean;
  webLink?: string;
}

interface MsObject {
  id: number;
  type: string;
  subject_or_title: string;
  preview: string | null;
  web_link: string | null;
  received_or_start_datetime: string | null;
  action_required: boolean;
  linked_project_id: number | null;
}

const today = format(new Date(), "yyyy-MM-dd");

const SOURCE_BADGE_COLORS: Record<string, string> = {
  personal: "bg-emerald-50 text-emerald-700 border-emerald-200",
  operational: "bg-amber-50 text-amber-700 border-amber-200",
  plan: "bg-violet-50 text-violet-700 border-violet-200",
  engineering: "bg-cyan-50 text-cyan-700 border-cyan-200",
  quality: "bg-rose-50 text-rose-700 border-rose-200",
  approval: "bg-orange-50 text-orange-700 border-orange-200",
  deliverable: "bg-pink-50 text-pink-700 border-pink-200",
  tr_register: "bg-purple-50 text-purple-700 border-purple-200",
  ms365: "bg-indigo-50 text-indigo-700 border-indigo-200",
  notification: "bg-blue-50 text-blue-700 border-blue-200",
};

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    normal: "bg-blue-500",
    low: "bg-gray-400",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[priority] || colors.normal}`} />;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "in_progress":
      return <Clock className="h-4 w-4 text-blue-500" />;
    case "blocked":
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case "waiting":
      return <Clock className="h-4 w-4 text-amber-500" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

const SOURCE_FILTERS = [
  { key: "all", label: "All" },
  { key: "personal", label: "Personal" },
  { key: "operational", label: "Operational" },
  { key: "plan", label: "Plan" },
  { key: "engineering", label: "Engineering" },
  { key: "quality", label: "Quality" },
  { key: "approval", label: "Approvals" },
  { key: "deliverable", label: "Deliverables" },
  { key: "notification", label: "Notifications" },
  { key: "ms365", label: "MS 365" },
  { key: "tr_register", label: "Action Items" },
];

export default function MyWorkHomePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ms-sync/trigger", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["outlook-events-mywork"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-work/all-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ms-objects/mine"] });
      if (data?.success === false && data?.error === "ms_sso_required") {
        toast({
          title: "Microsoft Sign-In Required",
          description: "Please sign in with Microsoft 365 SSO to sync your data.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Data Synced",
          description: "Your tasks, calendar, and email data have been refreshed.",
        });
      }
    },
    onError: () => {
      toast({
        title: "Sync Failed",
        description: "Could not refresh data. Please try again.",
        variant: "destructive",
      });
    },
  });

  const { data: calendarEvents = [], isLoading: calLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["outlook-events-mywork", today],
    queryFn: async () => {
      const res = await fetch(`/api/outlook/events?start=${today}&end=${today}`, {
        credentials: "include",
        headers: authHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.filter((e: CalendarEvent) => !e.isCancelled) : [];
    },
  });

  const { data: msActionItems = [], isLoading: msActionsLoading } = useQuery<MsObject[]>({
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

  const { data: allTaskData, isLoading: allTasksLoading } = useQuery<any>({
    queryKey: ["/api/my-work/all-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/my-work/all-tasks", {
        credentials: "include",
        headers: authHeaders(),
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: unreadNotifs = { items: [], total: 0 } } = useQuery<{ items: any[]; total: number }>({
    queryKey: ["/api/notifications", "unread"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?unreadOnly=true&limit=20", {
        credentials: "include",
        headers: authHeaders(),
      });
      if (!res.ok) return { items: [], total: 0 };
      return res.json();
    },
  });

  interface ActionItem {
    id: string;
    title: string;
    subtitle?: string;
    source: "approval" | "deliverable" | "notification" | "tr_register" | "ms_object";
    sourceLabel: string;
    sourceColor: string;
    projectName?: string;
    link?: string;
    createdAt?: string;
  }

  const actionItems: ActionItem[] = useMemo(() => {
    const items: ActionItem[] = [];

    for (const a of (allTaskData?.approvals?.engineering || [])) {
      items.push({
        id: `eng-${a.id}`,
        title: a.title,
        subtitle: a.projectName,
        source: "approval",
        sourceLabel: "Approval",
        sourceColor: "bg-amber-50 text-amber-700 border-amber-200",
        projectName: a.projectName,
        createdAt: a.createdAt,
      });
    }
    for (const a of (allTaskData?.approvals?.quality || [])) {
      items.push({
        id: `qc-${a.id}`,
        title: a.title,
        subtitle: a.projectName,
        source: "approval",
        sourceLabel: "QC Review",
        sourceColor: "bg-amber-50 text-amber-700 border-amber-200",
        projectName: a.projectName,
        createdAt: a.createdAt,
      });
    }

    for (const d of (allTaskData?.deliverables || [])) {
      const status = d.status || "";
      if (["NEEDS APPROVAL", "QC APPROVED", "OPERATIONAL APPROVAL", "IN REVIEW"].includes(status)) {
        items.push({
          id: `del-${d.id}`,
          title: d.title,
          subtitle: `${d.deliverableType || "Deliverable"} — ${status}`,
          source: "deliverable",
          sourceLabel: "Deliverable",
          sourceColor: "bg-rose-50 text-rose-700 border-rose-200",
          projectName: d.projectName || d.project_name,
          createdAt: d.createdAt || d.created_at,
        });
      }
    }

    for (const tr of (allTaskData?.trRegister || [])) {
      if (tr.status !== "Completed" && tr.status !== "Closed") {
        items.push({
          id: `tr-${tr.id}`,
          title: tr.actionDescription,
          subtitle: `${tr.department || ""} — ${tr.ragStatus || ""}`,
          source: "tr_register",
          sourceLabel: "TR Register",
          sourceColor: "bg-purple-50 text-purple-700 border-purple-200",
          createdAt: tr.createdAt || tr.created_at,
        });
      }
    }

    for (const n of (unreadNotifs.items || [])) {
      items.push({
        id: `notif-${n.id}`,
        title: n.title,
        subtitle: n.body || n.projectName || "",
        source: "notification",
        sourceLabel: "Notification",
        sourceColor: "bg-blue-50 text-blue-700 border-blue-200",
        projectName: n.projectName || n.project_name,
        createdAt: n.createdAt || n.created_at,
      });
    }

    for (const item of msActionItems) {
      items.push({
        id: `ms-${item.id}`,
        title: item.subject_or_title,
        subtitle: item.preview || undefined,
        source: "ms_object",
        sourceLabel: "MS 365",
        sourceColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
        link: item.web_link || undefined,
        createdAt: item.received_or_start_datetime || undefined,
      });
    }

    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return items;
  }, [allTaskData, unreadNotifs, msActionItems]);

  const actionsLoading = msActionsLoading;

  const { data: escalatedItems = [] } = useQuery<Array<{
    id: string; type: string; title: string; projectName: string;
    escalationLevel: string; status: string | null; priority: string | null;
  }>>({
    queryKey: ["/api/mytool/escalated-priorities"],
  });

  const DONE_STATUSES = ["done", "cancelled", "completed", "closed", "COMPLETE", "DONE", "CANCELLED", "resolved", "approved"];

  const tasks: TaskItem[] = useMemo(() => {
    const items: TaskItem[] = [];
    const seen = new Set<string>();

    if (allTaskData) {
      for (const t of (allTaskData.personal || [])) {
        const key = `personal-${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: t.id,
          title: t.title || "",
          status: t.status || "inbox",
          priority: t.priority || "normal",
          plannedForDate: t.plannedForDate || t.planned_for_date || null,
          dueAt: t.dueAt || t.due_at || null,
          sortOrder: t.sortOrder || t.sort_order || 0,
          projectName: t.projectName || t.project_name || null,
          department: t.department || null,
          source: "personal",
          sourceLabel: "Personal",
        });
      }

      for (const t of (allTaskData.operational || [])) {
        const key = `op-${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: t.id,
          title: t.title || "",
          status: (t.status || "TO DO").toLowerCase().replace(/\s+/g, "_"),
          priority: (t.priority || "normal").toLowerCase(),
          plannedForDate: null,
          dueAt: t.dueDate || t.due_date || null,
          sortOrder: t.sortOrder || 0,
          projectName: t.projectName || t.project_name || null,
          department: null,
          source: "operational",
          sourceLabel: "Operational",
        });
      }

      for (const t of (allTaskData.planTasks || [])) {
        const key = `plan-${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pct = t.pctComplete != null ? Number(t.pctComplete) : 0;
        items.push({
          id: t.id,
          title: t.title || "",
          status: pct >= 100 ? "done" : pct > 0 ? "in_progress" : "inbox",
          priority: "normal",
          plannedForDate: null,
          dueAt: t.endDate || null,
          sortOrder: 0,
          projectName: t.projectName || null,
          department: null,
          source: "plan",
          sourceLabel: "Plan",
        });
      }

      for (const t of (allTaskData.engineeringTasks || [])) {
        const key = `eng-${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: t.id,
          title: t.title || "",
          status: (t.status || "open").toLowerCase().replace(/\s+/g, "_"),
          priority: "normal",
          plannedForDate: null,
          dueAt: null,
          sortOrder: 0,
          projectName: t.projectName || null,
          department: null,
          source: "engineering",
          sourceLabel: "Engineering",
        });
      }

      for (const t of (allTaskData.qualityTasks || [])) {
        const key = `qc-${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: t.id,
          title: t.title || "",
          status: (t.status || "not_started").toLowerCase().replace(/\s+/g, "_"),
          priority: "normal",
          plannedForDate: null,
          dueAt: t.endDate || null,
          sortOrder: 0,
          projectName: t.projectName || null,
          department: null,
          source: "quality",
          sourceLabel: "Quality",
        });
      }

      for (const a of (allTaskData.approvals?.engineering || [])) {
        const key = `approval-eng-${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: `approval-eng-${a.id}`,
          title: a.title || "",
          status: (a.status || "pending").toLowerCase(),
          priority: "high",
          plannedForDate: null,
          dueAt: a.createdAt || null,
          sortOrder: 0,
          projectName: a.projectName || null,
          department: null,
          source: "approval",
          sourceLabel: "Approval",
        });
      }
      for (const a of (allTaskData.approvals?.quality || [])) {
        const key = `approval-qc-${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: `approval-qc-${a.id}`,
          title: a.title || "",
          status: (a.status || "review").toLowerCase(),
          priority: "high",
          plannedForDate: null,
          dueAt: a.createdAt || null,
          sortOrder: 0,
          projectName: a.projectName || null,
          department: null,
          source: "approval",
          sourceLabel: "QC Review",
        });
      }

      for (const d of (allTaskData.deliverables || [])) {
        const key = `del-${d.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const status = (d.status || "TO DO").toLowerCase().replace(/\s+/g, "_");
        items.push({
          id: `del-${d.id}`,
          title: d.title || "",
          status,
          priority: "normal",
          plannedForDate: null,
          dueAt: d.createdAt || d.created_at || null,
          sortOrder: 0,
          projectName: d.projectName || d.project_name || null,
          department: null,
          source: "deliverable",
          sourceLabel: "Deliverable",
        });
      }

      for (const tr of (allTaskData.trRegister || [])) {
        const key = `tr-${tr.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: `tr-${tr.id}`,
          title: tr.actionDescription || tr.title || "",
          status: (tr.status || "Active").toLowerCase().replace(/\s+/g, "_"),
          priority: tr.ragStatus === "Red" ? "critical" : tr.ragStatus === "Amber" ? "high" : "normal",
          plannedForDate: null,
          dueAt: tr.dueDate ? (typeof tr.dueDate === "string" ? tr.dueDate.split("T")[0] : null) : null,
          sortOrder: 0,
          projectName: null,
          department: tr.department || null,
          source: "tr_register",
          sourceLabel: "Action Item",
        });
      }
    }

    for (const item of msActionItems) {
      const key = `ms-${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `ms-${item.id}`,
        title: item.subject_or_title || "",
        status: "action_required",
        priority: "normal",
        plannedForDate: null,
        dueAt: item.received_or_start_datetime || null,
        sortOrder: 999,
        projectName: null,
        department: null,
        source: "ms365",
        sourceLabel: "MS 365",
        link: item.web_link || undefined,
      });
    }

    for (const n of (unreadNotifs.items || [])) {
      const key = `notif-${n.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `notif-${n.id}`,
        title: n.title || "",
        status: "unread",
        priority: "normal",
        plannedForDate: null,
        dueAt: n.createdAt || n.created_at || null,
        sortOrder: 999,
        projectName: n.projectName || n.project_name || null,
        department: null,
        source: "notification",
        sourceLabel: "Notification",
      });
    }

    return items;
  }, [allTaskData, msActionItems, unreadNotifs]);

  const tasksLoading = allTasksLoading;

  const openTasks = useMemo(() =>
    tasks.filter(t => !DONE_STATUSES.includes(t.status)),
  [tasks]);

  const filteredTasks = useMemo(() => {
    if (sourceFilter === "all") return openTasks;
    return openTasks.filter(t => t.source === sourceFilter);
  }, [openTasks, sourceFilter]);

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: openTasks.length };
    for (const t of openTasks) {
      if (t.source) {
        counts[t.source] = (counts[t.source] || 0) + 1;
      }
    }
    return counts;
  }, [openTasks]);

  const groupedTasks = useMemo(() => {
    const groups: Record<string, TaskItem[]> = {};
    filteredTasks.forEach(t => {
      const key = t.projectName || "No Project";
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    const sortedGroups: Record<string, TaskItem[]> = {};
    const noProject = groups["No Project"];
    const projectKeys = Object.keys(groups).filter(k => k !== "No Project").sort();
    if (noProject) sortedGroups["No Project"] = noProject;
    for (const k of projectKeys) sortedGroups[k] = groups[k];
    Object.values(sortedGroups).forEach(arr =>
      arr.sort((a, b) => {
        const po: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
        return (po[a.priority] ?? 2) - (po[b.priority] ?? 2);
      })
    );
    return sortedGroups;
  }, [filteredTasks]);

  const sortedEvents = useMemo(() =>
    [...calendarEvents].sort((a, b) => {
      const aStart = typeof a.start === "string" ? a.start : "";
      const bStart = typeof b.start === "string" ? b.start : "";
      return aStart.localeCompare(bStart);
    }),
  [calendarEvents]);

  return (
    <div className="space-y-6" data-testid="my-work-home">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-my-work-title">
            My Work
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/my-work/tasks">
            <Button variant="outline" size="sm" data-testid="link-all-tasks">
              All Tasks <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="my-work-grid">
        <div className="lg:col-span-1 space-y-4" data-testid="my-work-tasks-column">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-emerald-600" />
                  My Tasks
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      queryClient.invalidateQueries({ queryKey: ["/api/my-work/all-tasks"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/ms-objects/mine"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
                      toast({ title: "Refreshing tasks...", description: "Fetching latest task data." });
                    }}
                    data-testid="button-refresh-tasks"
                    title="Refresh tasks"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                  <Badge variant="secondary" className="text-xs" data-testid="badge-open-tasks-count">
                    {filteredTasks.length}
                  </Badge>
                </div>
              </div>
              <ScrollArea className="w-full">
                <div className="flex gap-1 pt-1 pb-0.5">
                  {SOURCE_FILTERS.filter(f => f.key === "all" || (sourceCounts[f.key] || 0) > 0).map(f => (
                    <button
                      key={f.key}
                      onClick={() => setSourceFilter(f.key)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors border ${
                        sourceFilter === f.key
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                          : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                      }`}
                      data-testid={`filter-${f.key}`}
                    >
                      {f.label} {(sourceCounts[f.key] || 0) > 0 ? `(${sourceCounts[f.key]})` : ""}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardHeader>
            <CardContent className="pt-0">
              {tasksLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map(i => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center" data-testid="empty-tasks">
                  <Inbox className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">{sourceFilter === "all" ? "No open tasks" : `No ${SOURCE_FILTERS.find(f => f.key === sourceFilter)?.label || ""} tasks`}</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[500px]">
                  <div className="space-y-4">
                    {Object.entries(groupedTasks).map(([projectName, projectTasks]) => (
                      <div key={projectName} data-testid={`task-group-${projectName}`}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <FolderOpen className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                          </span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto">
                            {projectTasks.length}
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          {projectTasks.slice(0, 5).map(task => (
                            <div
                              key={task.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors cursor-pointer group"
                              data-testid={`task-item-${task.id}`}
                            >
                              <StatusIcon status={task.status} />
                              <PriorityDot priority={task.priority} />
                              <span className="text-sm truncate flex-1">{task.title}</span>
                              {task.sourceLabel && (
                                <Badge variant="outline" className={`text-[9px] h-4 px-1 shrink-0 ${SOURCE_BADGE_COLORS[task.source || ""] || "bg-gray-50 text-gray-600 border-gray-200"}`}>
                                  {task.sourceLabel}
                                </Badge>
                              )}
                              {task.dueAt && (
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {format(parseISO(task.dueAt), "MMM d")}
                                </span>
                              )}
                            </div>
                          ))}
                          {projectTasks.length > 5 && (
                            <p className="text-[10px] text-muted-foreground pl-2">
                              +{projectTasks.length - 5} more
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-4" data-testid="my-work-timeline-column">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-600" />
                  Today's Timeline
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    data-testid="button-refresh-timeline"
                    title="Refresh connection"
                  >
                    <RefreshCw className={`h-3 w-3 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  </Button>
                  <Link href="/my-work/calendar">
                    <Button variant="ghost" size="sm" className="h-6 text-xs" data-testid="link-full-calendar">
                      Full Calendar <ChevronRight className="h-3 w-3 ml-0.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {calLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : sortedEvents.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center" data-testid="empty-calendar">
                  <Calendar className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">No events today</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[500px]">
                  <div className="space-y-2">
                    {sortedEvents.map((ev, idx) => {
                      const startStr = typeof ev.start === "string" ? ev.start : "";
                      const endStr = typeof ev.end === "string" ? ev.end : "";
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
                          key={ev.id || idx}
                          className="flex items-start gap-3 p-2.5 rounded-lg border border-border/50 hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
                          data-testid={`calendar-event-${ev.id || idx}`}
                        >
                          <div className="w-1 self-stretch rounded-full bg-blue-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{ev.subject || "No Subject"}</p>
                            <p className="text-[11px] text-muted-foreground">{timeLabel}</p>
                            {ev.location && (
                              <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                                {typeof ev.location === "string" ? ev.location : ""}
                              </p>
                            )}
                          </div>
                          {ev.webLink && (
                            <a href={ev.webLink} target="_blank" rel="noopener noreferrer" className="shrink-0 mt-0.5">
                              <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-blue-600" />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-4" data-testid="my-work-alerts-column">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Risks & Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {escalatedItems.length === 0 ? (
                <div className="flex flex-col items-center py-6 text-center" data-testid="empty-alerts">
                  <Flag className="h-6 w-6 text-muted-foreground/50 mb-2" />
                  <p className="text-xs text-muted-foreground">No escalated items</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[200px]">
                  <div className="space-y-1.5">
                    {escalatedItems.slice(0, 8).map(item => (
                      <div
                        key={item.id}
                        className="flex items-start gap-2 p-2 rounded-md border border-amber-200/50 bg-amber-50/30 text-xs"
                        data-testid={`alert-item-${item.id}`}
                      >
                        <AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{item.title}</p>
                          <p className="text-muted-foreground truncate">{item.projectName}</p>
                        </div>
                        <Badge variant="outline" className="text-[9px] shrink-0 ml-auto border-amber-300 text-amber-700">
                          {item.escalationLevel}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="h-4 w-4 text-purple-600" />
                  Action Required
                </CardTitle>
                <Badge variant="secondary" className="text-xs" data-testid="badge-action-count">
                  {actionItems.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {actionsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              ) : actionItems.length === 0 ? (
                <div className="flex flex-col items-center py-6 text-center" data-testid="empty-actions">
                  <Inbox className="h-6 w-6 text-muted-foreground/50 mb-2" />
                  <p className="text-xs text-muted-foreground">No action required items</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[300px]">
                  <div className="space-y-1.5">
                    {actionItems.slice(0, 20).map(item => (
                      <div
                        key={item.id}
                        className="flex items-start gap-2 p-2 rounded-md border border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                        data-testid={`action-item-${item.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border ${item.sourceColor}`}>
                              {item.sourceLabel}
                            </span>
                            {item.projectName && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                                {item.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-medium truncate mt-0.5">{item.title}</p>
                          {item.subtitle && (
                            <p className="text-[10px] text-muted-foreground truncate">{item.subtitle}</p>
                          )}
                        </div>
                        {item.link && (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0"
                            onClick={e => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-purple-600" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
