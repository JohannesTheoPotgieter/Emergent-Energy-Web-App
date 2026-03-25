import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { fetchRolloutFeatureFlags } from "@/lib/feature-flags";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { useAccessMatrix } from "@/hooks/use-access-matrix";
import { format, parseISO } from "date-fns";
import { trackFeatureUse } from "@/lib/nav-analytics";
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
  FolderOpen,
  Flag,
  ArrowRight,
  RefreshCw,
  MessageSquare,
  Bell,
  Zap,
  Sparkles,
  Bookmark,
  Save,
  Trash2,
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
  projectId?: number | null;
  projectHref?: string | null;
  externalHref?: string | null;
  sourceContextLabel?: string | null;
  sourceTypeLabel?: string | null;
  assigneeDisplay?: string | null;
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
  type?: string;
  subject_or_title?: string;
  subjectOrTitle?: string;
  preview: string | null;
  web_link?: string | null;
  webLink?: string | null;
  received_or_start_datetime?: string | null;
  receivedOrStartDatetime?: string | null;
  action_required?: boolean;
  actionRequired?: boolean;
  linked_project_id?: number | null;
  linkedProjectId?: number | null;
  linkedProjectName?: string | null;
  sourceHref?: string | null;
  projectHref?: string | null;
  externalHref?: string | null;
  sourceContextLabel?: string | null;
  sourceTypeLabel?: string | null;
}

function getToday() {
  return format(new Date(), "yyyy-MM-dd");
}

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
};

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function isExternalTarget(value?: string | null) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
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
  { key: "ms365", label: "MS 365" },
  { key: "tr_register", label: "Action Items" },
];

export default function MyWorkHomePage() {
  const { user } = useAuth();
  const { canViewPath } = useAccessMatrix();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Recompute on each render so it stays current past midnight
  const today = getToday();
  const [, navigate] = useLocation();
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  type GroupingMode = "source" | "priority" | "status" | "due_date";
  const [groupingMode, setGroupingMode] = useState<GroupingMode>(
    () => (localStorage.getItem("ee_mywork_grouping") as GroupingMode) || "source"
  );

  // Saved views
  const [savedViews, setSavedViews] = useState<Array<{ name: string; sourceFilter: string; grouping: GroupingMode }>>(() => {
    try {
      const raw = localStorage.getItem("ee_mywork_saved_views");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const saveCurrentView = (name: string) => {
    const updated = [...savedViews.filter(v => v.name !== name), { name, sourceFilter, grouping: groupingMode }];
    setSavedViews(updated);
    localStorage.setItem("ee_mywork_saved_views", JSON.stringify(updated));
    toast({ title: "View saved", description: `"${name}" saved with current filters.` });
  };

  const loadView = (view: { name: string; sourceFilter: string; grouping: GroupingMode }) => {
    setSourceFilter(view.sourceFilter);
    setGroupingMode(view.grouping);
    localStorage.setItem("ee_mywork_grouping", view.grouping);
    toast({ title: "View loaded", description: `Loaded "${view.name}"` });
  };

  const deleteView = (name: string) => {
    const updated = savedViews.filter(v => v.name !== name);
    setSavedViews(updated);
    localStorage.setItem("ee_mywork_saved_views", JSON.stringify(updated));
  };

  const handleGroupingChange = (value: string) => {
    const mode = value as GroupingMode;
    setGroupingMode(mode);
    localStorage.setItem("ee_mywork_grouping", mode);
    trackFeatureUse("mywork_grouping_toggle");
  };

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

  const { data: rolloutFlags } = useQuery({
    queryKey: ["rollout-feature-flags"],
    queryFn: fetchRolloutFeatureFlags,
    staleTime: 60_000,
  });
  const contextualMsSurfacesEnabled = rolloutFlags?.find((flag) => flag.key === "contextual_ms_surfaces")?.value === true;

  const { data: outlookStatus } = useQuery<{ configured: boolean; connected: boolean }>({
    queryKey: ["outlook-status", "my-work-home"],
    queryFn: async () => {
      const res = await fetch("/api/outlook/status", { credentials: "include", headers: authHeaders() });
      if (!res.ok) return { configured: false, connected: false };
      return res.json();
    },
  });

  const { data: teamsStatus } = useQuery<{ connected: boolean; ssoRequired?: boolean }>({
    queryKey: ["teams-status", "my-work-home"],
    queryFn: async () => {
      const res = await fetch("/api/ms-teams/chats", { credentials: "include", headers: authHeaders() });
      if (!res.ok) return { connected: false };
      const data = await res.json();
      if (Array.isArray(data)) return { connected: true };
      if (data?.ssoRequired) return { connected: false, ssoRequired: true };
      if (Array.isArray(data?.data)) return { connected: true };
      return { connected: false };
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

  const microsoftItems = useMemo<MsObject[]>(() => {
    if (Array.isArray(allTaskData?.microsoftItems) && allTaskData.microsoftItems.length > 0) {
      return allTaskData.microsoftItems;
    }
    return msActionItems;
  }, [allTaskData?.microsoftItems, msActionItems]);
  const personalMicrosoftTools = useMemo(() => {
    return [
      { label: "Email", path: "/my-work/email", icon: Mail },
      { label: "Teams", path: "/my-work/teams", icon: MessageSquare },
      { label: "Calendar", path: "/my-work/calendar", icon: Calendar },
    ].filter((item) => canViewPath(item.path));
  }, [canViewPath]);

  interface ActionItem {
    id: string;
    title: string;
    subtitle?: string;
    source: "approval" | "deliverable" | "tr_register" | "ms_object";
    sourceLabel: string;
    sourceColor: string;
    projectName?: string;
    link?: string;
    projectHref?: string | null;
    externalHref?: string | null;
    sourceContextLabel?: string | null;
    sourceTypeLabel?: string | null;
    assigneeDisplay?: string | null;
    createdAt?: string;
  }

  const actionItems: ActionItem[] = useMemo(() => {
    const items: ActionItem[] = [];
    const withActionSource = (item: ActionItem, raw?: Record<string, any> | null): ActionItem => ({
      ...item,
      link: raw?.sourceHref || item.link,
      projectHref: raw?.projectHref || null,
      externalHref: raw?.externalHref || null,
      sourceContextLabel: raw?.sourceContextLabel || null,
      sourceTypeLabel: raw?.sourceTypeLabel || null,
      assigneeDisplay: raw?.assigneeDisplay || null,
    });

    for (const a of (allTaskData?.approvals?.engineering || [])) {
      items.push(withActionSource({
        id: `eng-${a.id}`,
        title: a.title,
        subtitle: a.projectName,
        source: "approval",
        sourceLabel: a.sourceTypeLabel || "Approval",
        sourceColor: "bg-amber-50 text-amber-700 border-amber-200",
        projectName: a.projectName,
        createdAt: a.createdAt,
      }, a));
    }
    for (const a of (allTaskData?.approvals?.quality || [])) {
      items.push(withActionSource({
        id: `qc-${a.id}`,
        title: a.title,
        subtitle: a.projectName,
        source: "approval",
        sourceLabel: a.sourceTypeLabel || "QC Review",
        sourceColor: "bg-amber-50 text-amber-700 border-amber-200",
        projectName: a.projectName,
        createdAt: a.createdAt,
      }, a));
    }
    for (const a of (allTaskData?.approvals?.general || [])) {
      items.push(withActionSource({
        id: `approval-gen-${a.id}`,
        title: a.title,
        subtitle: a.projectName || a.approvalCategory || undefined,
        source: "approval",
        sourceLabel: a.sourceTypeLabel || "Approval",
        sourceColor: "bg-amber-50 text-amber-700 border-amber-200",
        projectName: a.projectName,
        createdAt: a.createdAt || a.requestedAt,
      }, a));
    }

    for (const d of (allTaskData?.deliverables || [])) {
      const status = d.status || "";
      if (["NEEDS APPROVAL", "QC APPROVED", "OPERATIONAL APPROVAL", "IN REVIEW"].includes(status)) {
        items.push(withActionSource({
          id: `del-${d.id}`,
          title: d.title,
          subtitle: `${d.deliverableType || "Deliverable"} — ${status}`,
          source: "deliverable",
          sourceLabel: d.sourceTypeLabel || "Deliverable",
          sourceColor: "bg-rose-50 text-rose-700 border-rose-200",
          projectName: d.projectName || d.project_name,
          createdAt: d.createdAt || d.created_at,
        }, d));
      }
    }

    for (const tr of (allTaskData?.trRegister || [])) {
      if (tr.status !== "Completed" && tr.status !== "Closed") {
        items.push(withActionSource({
          id: `tr-${tr.id}`,
          title: tr.actionDescription,
          subtitle: `${tr.department || ""} — ${tr.ragStatus || ""}`,
          source: "tr_register",
          sourceLabel: tr.sourceTypeLabel || "TR Register",
          sourceColor: "bg-purple-50 text-purple-700 border-purple-200",
          createdAt: tr.createdAt || tr.created_at,
        }, tr));
      }
    }

    for (const item of microsoftItems) {
      items.push(withActionSource({
        id: `ms-${item.id}`,
        title: item.subjectOrTitle || item.subject_or_title || "",
        subtitle: item.preview || undefined,
        source: "ms_object",
        sourceLabel: item.sourceTypeLabel || "MS 365",
        sourceColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
        projectName: item.linkedProjectName || undefined,
        link: item.sourceHref || item.webLink || item.web_link || undefined,
        createdAt: item.receivedOrStartDatetime || item.received_or_start_datetime || undefined,
      }, item));
    }

    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return items;
  }, [allTaskData, microsoftItems]);

  const actionsLoading = allTasksLoading || (!Array.isArray(allTaskData?.microsoftItems) && msActionsLoading);

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
    const withTaskSource = (item: TaskItem, raw?: Record<string, any> | null): TaskItem => ({
      ...item,
      projectId: raw?.projectId ?? raw?.project_id ?? null,
      link: raw?.sourceHref || item.link,
      projectHref: raw?.projectHref || null,
      externalHref: raw?.externalHref || null,
      sourceContextLabel: raw?.sourceContextLabel || null,
      sourceTypeLabel: raw?.sourceTypeLabel || null,
      assigneeDisplay: raw?.assigneeDisplay || null,
    });

    if (allTaskData) {
      for (const t of (allTaskData.personal || [])) {
        const key = `personal-${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(withTaskSource({
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
        }, t));
      }

      for (const t of (allTaskData.operational || [])) {
        const key = `op-${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(withTaskSource({
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
        }, t));
      }

      for (const t of (allTaskData.planTasks || [])) {
        const key = `plan-${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pct = t.pctComplete != null ? Number(t.pctComplete) : 0;
        items.push(withTaskSource({
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
        }, t));
      }

      for (const t of (allTaskData.engineeringTasks || [])) {
        const key = `eng-${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(withTaskSource({
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
        }, t));
      }

      for (const t of (allTaskData.qualityTasks || [])) {
        const key = `qc-${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(withTaskSource({
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
        }, t));
      }

      for (const a of (allTaskData.approvals?.engineering || [])) {
        const key = `approval-eng-${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(withTaskSource({
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
          sourceLabel: a.sourceTypeLabel || "Approval",
        }, a));
      }
      for (const a of (allTaskData.approvals?.quality || [])) {
        const key = `approval-qc-${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(withTaskSource({
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
          sourceLabel: a.sourceTypeLabel || "QC Review",
        }, a));
      }
      for (const a of (allTaskData.approvals?.general || [])) {
        const key = `approval-gen-${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(withTaskSource({
          id: `approval-gen-${a.id}`,
          title: a.title || "",
          status: (a.status || "pending").toLowerCase(),
          priority: "high",
          plannedForDate: null,
          dueAt: a.createdAt || a.requestedAt || null,
          sortOrder: 0,
          projectName: a.projectName || null,
          department: null,
          source: "approval",
          sourceLabel: a.sourceTypeLabel || "Approval",
          assigneeDisplay: a.assigneeDisplay || null,
        }, a));
      }

      for (const d of (allTaskData.deliverables || [])) {
        const key = `del-${d.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const status = (d.status || "TO DO").toLowerCase().replace(/\s+/g, "_");
        items.push(withTaskSource({
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
          sourceLabel: d.sourceTypeLabel || "Deliverable",
        }, d));
      }

      for (const tr of (allTaskData.trRegister || [])) {
        const key = `tr-${tr.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(withTaskSource({
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
        }, tr));
      }
    }

    for (const item of microsoftItems) {
      const key = `ms-${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(withTaskSource({
        id: `ms-${item.id}`,
        title: item.subjectOrTitle || item.subject_or_title || "",
        status: "action_required",
        priority: "normal",
        plannedForDate: null,
        dueAt: item.receivedOrStartDatetime || item.received_or_start_datetime || null,
        sortOrder: 999,
        projectName: item.linkedProjectName || null,
        department: null,
        source: "ms365",
        sourceLabel: item.sourceTypeLabel || "MS 365",
        link: item.sourceHref || item.webLink || item.web_link || undefined,
      }, item));
    }

    return items;
  }, [allTaskData, microsoftItems]);

  const tasksLoading = allTasksLoading;
  const openTarget = (href?: string | null, fallback?: string) => {
    const target = href || fallback;
    if (!target) return;
    if (isExternalTarget(target)) {
      window.open(target, "_blank", "noopener,noreferrer");
      return;
    }
    navigate(target);
  };

  const handleTaskClick = (task: TaskItem) => {
    openTarget(task.link, "/my-work/tasks");
  };

  const handleActionClick = (item: ActionItem) => {
    openTarget(item.link || item.projectHref || item.externalHref, "/my-work/tasks");
  };

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

  const doneToday = useMemo(() => {
    return tasks.filter(t => {
      if (!DONE_STATUSES.includes(t.status)) return false;
      const due = t.dueAt || t.plannedForDate;
      if (!due) return false;
      return due.startsWith(today);
    }).length;
  }, [tasks, today]);

  const focusNowItems = useMemo(() => {
    const now = new Date();
    const urgent = openTasks
      .map(t => {
        let urgencyScore = 0;
        if (t.dueAt) {
          const due = new Date(t.dueAt);
          if (due < now) urgencyScore = 3; // overdue
          else if (t.dueAt.startsWith(today)) urgencyScore = 2; // due today
        }
        if (t.priority === "critical") urgencyScore = Math.max(urgencyScore, 2.5);
        if (t.priority === "high") urgencyScore = Math.max(urgencyScore, 1.5);
        return { task: t, urgencyScore };
      })
      .filter(x => x.urgencyScore > 0)
      .sort((a, b) => b.urgencyScore - a.urgencyScore)
      .slice(0, 3)
      .map(x => x.task);
    return urgent;
  }, [openTasks, today]);

  const groupedByProject = useMemo(() => {
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

  const groupedByPriority = useMemo(() => {
    const priorityOrder = ["critical", "high", "normal", "low"];
    const priorityLabels: Record<string, string> = { critical: "Critical", high: "High", normal: "Normal", low: "Low" };
    const groups: Record<string, TaskItem[]> = {};
    filteredTasks.forEach(t => {
      const key = t.priority || "normal";
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    const sortedGroups: Record<string, TaskItem[]> = {};
    for (const p of priorityOrder) {
      if (groups[p]) sortedGroups[priorityLabels[p] || p] = groups[p];
    }
    return sortedGroups;
  }, [filteredTasks]);

  const groupedByStatus = useMemo(() => {
    const statusLabels: Record<string, string> = {
      inbox: "Inbox", todo: "To Do", in_progress: "In Progress",
      review: "In Review", blocked: "Blocked", waiting: "Waiting",
      action_required: "Action Required",
    };
    const statusOrder = ["blocked", "action_required", "in_progress", "review", "waiting", "todo", "inbox"];
    const groups: Record<string, TaskItem[]> = {};
    filteredTasks.forEach(t => {
      const key = t.status || "inbox";
      const label = statusLabels[key] || key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      if (!groups[label]) groups[label] = [];
      groups[label].push(t);
    });
    const sorted: Record<string, TaskItem[]> = {};
    for (const s of statusOrder) {
      const label = statusLabels[s];
      if (label && groups[label]) sorted[label] = groups[label];
    }
    // Add any remaining groups not in the predefined order
    for (const [label, tasks] of Object.entries(groups)) {
      if (!sorted[label]) sorted[label] = tasks;
    }
    return sorted;
  }, [filteredTasks]);

  const groupedByDueDate = useMemo(() => {
    const now = new Date();
    const todayStr = format(now, "yyyy-MM-dd");
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = format(tomorrow, "yyyy-MM-dd");
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = format(weekEnd, "yyyy-MM-dd");

    const groups: Record<string, TaskItem[]> = {
      "Overdue": [],
      "Today": [],
      "Tomorrow": [],
      "This Week": [],
      "Later": [],
      "No Due Date": [],
    };

    filteredTasks.forEach(t => {
      const due = t.dueAt;
      if (!due) { groups["No Due Date"].push(t); return; }
      const dueDate = due.split("T")[0];
      if (dueDate < todayStr) groups["Overdue"].push(t);
      else if (dueDate === todayStr) groups["Today"].push(t);
      else if (dueDate === tomorrowStr) groups["Tomorrow"].push(t);
      else if (dueDate <= weekEndStr) groups["This Week"].push(t);
      else groups["Later"].push(t);
    });

    // Remove empty groups
    const result: Record<string, TaskItem[]> = {};
    for (const [k, v] of Object.entries(groups)) {
      if (v.length > 0) result[k] = v;
    }
    return result;
  }, [filteredTasks]);

  const groupedTasks = useMemo(() => {
    switch (groupingMode) {
      case "priority": return groupedByPriority;
      case "status": return groupedByStatus;
      case "due_date": return groupedByDueDate;
      default: return groupedByProject;
    }
  }, [groupingMode, groupedByProject, groupedByPriority, groupedByStatus, groupedByDueDate]);

  const sortedEvents = useMemo(() =>
    [...calendarEvents].sort((a, b) => {
      const aStart = typeof a.start === "string" ? a.start : "";
      const bStart = typeof b.start === "string" ? b.start : "";
      return aStart.localeCompare(bStart);
    }),
  [calendarEvents]);

  const myDaySummary = useMemo(() => {
    const urgentActions = actionItems.length;
    const dueToday = openTasks.filter((task) => {
      if (!task.dueAt) return false;
      return task.dueAt.startsWith(today);
    }).length;
    const upcomingMeetings = sortedEvents.filter((event) => {
      if (event.isAllDay || !event.start) return false;
      return event.start.startsWith(today);
    }).length;

    return {
      urgentActions,
      dueToday,
      upcomingMeetings,
      openTasks: openTasks.length,
      escalatedCount: escalatedItems.length,
    };
  }, [actionItems.length, escalatedItems.length, openTasks, sortedEvents, today]);

  return (
    <PageShell className="p-4 md:p-6 max-w-[1400px] mx-auto" data-testid="my-work-home">
      <SectionHeader
        icon={<Target className="h-5 w-5" />}
        title="My Work"
        description={format(new Date(), "EEEE, MMMM d, yyyy")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              data-testid="button-sync-all"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              Sync
            </Button>
            <Link href="/my-work/tasks">
              <Button variant="outline" size="sm" data-testid="link-all-tasks">
                All Tasks <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5" data-testid="my-work-focus-summary">
        {[
          { label: "Actions", value: myDaySummary.urgentActions, icon: Zap, color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
          { label: "Due Today", value: myDaySummary.dueToday, icon: Target, color: "text-red-600", bg: "bg-red-50 border-red-200" },
          { label: "Meetings", value: myDaySummary.upcomingMeetings, icon: Calendar, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
          { label: "Open Tasks", value: myDaySummary.openTasks, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
          { label: "Done Today", value: doneToday, icon: Sparkles, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-300" },
          { label: "Alerts", value: myDaySummary.escalatedCount, icon: Bell, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 ${bg}`}>
            <Icon className={`h-4 w-4 ${color} shrink-0`} />
            <div className="min-w-0">
              <p className={`text-lg font-bold leading-none ${color}`}>{value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Focus Now — urgent items highlight */}
      {!tasksLoading && (
        <div className="mb-5" data-testid="focus-now-section">
          {focusNowItems.length > 0 ? (
            <div className="space-y-1.5">
              <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                Focus Now
              </h2>
              {focusNowItems.map(task => {
                const isOverdue = task.dueAt ? new Date(task.dueAt) < new Date() : false;
                return (
                  <div
                    key={task.id}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg border cursor-pointer transition-all touch-manipulation active:scale-[0.98] group ${
                      isOverdue
                        ? "border-l-4 border-l-red-400 border-red-200 bg-red-50/40 hover:bg-red-50/70 active:bg-red-50"
                        : "border-l-4 border-l-amber-400 border-amber-200 bg-amber-50/40 hover:bg-amber-50/70 active:bg-amber-50"
                    }`}
                    onClick={() => handleTaskClick(task)}
                    data-testid={`focus-item-${task.id}`}
                  >
                    <StatusIcon status={task.status} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate group-hover:text-foreground">{task.title}</p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {task.projectName && <span>{task.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}</span>}
                        {task.dueAt && (
                          <span className={isOverdue ? "text-red-600 font-medium" : "text-amber-600"}>
                            {isOverdue ? "Overdue" : "Due today"}
                          </span>
                        )}
                      </div>
                    </div>
                    {task.sourceLabel && (
                      <Badge variant="outline" className={`text-[9px] h-4 px-1 shrink-0 ${SOURCE_BADGE_COLORS[task.source || ""] || ""}`}>
                        {task.sourceLabel}
                      </Badge>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-foreground shrink-0" />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50/40">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <p className="text-sm text-emerald-700">You're caught up — no urgent items right now.</p>
            </div>
          )}
        </div>
      )}

      {/* Main 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5" data-testid="my-work-grid">

        {/* LEFT: Tasks — takes 3/5 width */}
        <div className="lg:col-span-3 space-y-5" data-testid="my-work-tasks-column">
          <Card className="border-border/60">
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
              <div className="flex items-center gap-3 pt-1 pb-0.5">
                <ScrollArea className="flex-1">
                  <div className="flex gap-1">
                    {SOURCE_FILTERS.filter(f => f.key === "all" || (sourceCounts[f.key] || 0) > 0).map(f => (
                      <button
                        key={f.key}
                        onClick={() => setSourceFilter(f.key)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors border ${
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
                <Tabs value={groupingMode} onValueChange={handleGroupingChange}>
                  <TabsList className="h-7">
                    <TabsTrigger value="source" className="text-[10px] px-1.5 py-0.5 h-5" data-testid="group-by-source">Source</TabsTrigger>
                    <TabsTrigger value="priority" className="text-[10px] px-1.5 py-0.5 h-5" data-testid="group-by-priority">Priority</TabsTrigger>
                    <TabsTrigger value="status" className="text-[10px] px-1.5 py-0.5 h-5" data-testid="group-by-status">Status</TabsTrigger>
                    <TabsTrigger value="due_date" className="text-[10px] px-1.5 py-0.5 h-5" data-testid="group-by-due-date">Due Date</TabsTrigger>
                  </TabsList>
                </Tabs>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Saved views">
                      <Bookmark className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {savedViews.length > 0 ? (
                      <>
                        {savedViews.map(v => (
                          <DropdownMenuItem key={v.name} className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs cursor-pointer flex-1" onClick={() => loadView(v)}>{v.name}</span>
                            <button onClick={(e) => { e.stopPropagation(); deleteView(v.name); }} className="text-muted-foreground hover:text-destructive shrink-0">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    <DropdownMenuItem onClick={() => {
                      const name = prompt("View name:");
                      if (name?.trim()) saveCurrentView(name.trim());
                    }}>
                      <Save className="h-3.5 w-3.5 mr-2" />
                      <span className="text-xs">Save current view</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {tasksLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map(i => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="flex items-center gap-3 py-6 px-2 text-muted-foreground" data-testid="empty-tasks">
                  <Inbox className="h-5 w-5 shrink-0" />
                  <p className="text-sm">{sourceFilter === "all" ? "No open tasks right now" : `No ${SOURCE_FILTERS.find(f => f.key === sourceFilter)?.label || ""} tasks`}</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[520px]">
                  <div className="space-y-3">
                    {Object.entries(groupedTasks).map(([projectName, projectTasks]) => (
                      <div key={projectName} data-testid={`task-group-${projectName}`}>
                        <div className="flex items-center gap-1.5 mb-1.5 px-1">
                          <FolderOpen className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                          </span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto">
                            {projectTasks.length}
                          </Badge>
                        </div>
                        <div className="space-y-0.5">
                          {projectTasks.slice(0, 8).map(task => (
                            <div
                              key={task.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-emerald-50/60 active:bg-emerald-50/80 active:scale-[0.99] transition-all cursor-pointer group touch-manipulation"
                              onClick={() => handleTaskClick(task)}
                              data-testid={`task-item-${task.id}`}
                            >
                              <StatusIcon status={task.status} />
                              <PriorityDot priority={task.priority} />
                              <span className="text-sm truncate flex-1 group-hover:text-emerald-700">{task.title}</span>
                              {task.sourceLabel && (
                                <Badge variant="outline" className={`text-[9px] h-4 px-1 shrink-0 hidden sm:inline-flex ${SOURCE_BADGE_COLORS[task.source || ""] || "bg-gray-50 text-gray-600 border-gray-200"}`}>
                                  {task.sourceLabel}
                                </Badge>
                              )}
                              {task.dueAt && (
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {format(parseISO(task.dueAt), "MMM d")}
                                </span>
                              )}
                              <ChevronRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-emerald-600 transition-colors shrink-0" />
                            </div>
                          ))}
                          {projectTasks.length > 8 && (
                            <p
                              className="text-[10px] text-emerald-600 pl-2 cursor-pointer hover:underline"
                              onClick={() => navigate("/my-work/tasks")}
                            >
                              +{projectTasks.length - 8} more
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

        {/* RIGHT: Timeline + Sidebar — takes 2/5 width */}
        <div className="lg:col-span-2 space-y-5" data-testid="my-work-sidebar">

          {/* Action Required — promoted to sidebar top */}
          {(actionItems.length > 0 || actionsLoading) && (
            <Card className="border-border/60" data-testid="card-action-required">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="h-4 w-4 text-orange-600" />
                    Action Required
                  </CardTitle>
                  {actionItems.length > 0 && (
                    <Badge className="bg-orange-100 text-orange-700 border-orange-300 hover:bg-orange-100" data-testid="badge-action-count">
                      {actionItems.length}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {actionsLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {actionItems.slice(0, 5).map(item => (
                      <div
                        key={item.id}
                        className="flex items-start gap-2.5 p-2.5 rounded-lg border border-border/60 hover:border-orange-200 hover:bg-orange-50/30 active:bg-orange-50/50 active:scale-[0.99] transition-all cursor-pointer touch-manipulation group"
                        onClick={() => handleActionClick(item)}
                        data-testid={`action-item-${item.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border ${item.sourceColor}`}>
                              {item.sourceLabel}
                            </span>
                            {item.projectName && (
                              <span className="text-[10px] text-muted-foreground truncate">
                                {item.projectName.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-medium truncate group-hover:text-orange-700">{item.title}</p>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-orange-600 shrink-0 mt-1 transition-colors" />
                      </div>
                    ))}
                  </div>
                )}
                {actionItems.length > 5 && (
                  <p className="text-[11px] text-orange-600 mt-2 cursor-pointer hover:underline" onClick={() => navigate("/my-work/tasks")}>
                    +{actionItems.length - 5} more items needing attention
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Today's Schedule */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-600" />
                  Today's Schedule
                </CardTitle>
                <Link href="/my-work/calendar">
                  <Button variant="ghost" size="sm" className="h-6 text-xs" data-testid="link-full-calendar">
                    Full Calendar <ChevronRight className="h-3 w-3 ml-0.5" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {calLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : sortedEvents.length === 0 ? (
                <div className="flex items-center gap-3 py-4 px-1 text-muted-foreground" data-testid="empty-calendar">
                  <Calendar className="h-5 w-5 shrink-0 text-muted-foreground/50" />
                  <p className="text-sm">No meetings on your calendar today</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {sortedEvents.map((ev, idx) => {
                    let timeLabel = "";
                    try {
                      if (ev.isAllDay) {
                        timeLabel = "All day";
                      } else if (ev.start) {
                        timeLabel = format(parseISO(ev.start), "h:mm a");
                        if (ev.end) timeLabel += ` – ${format(parseISO(ev.end), "h:mm a")}`;
                      }
                    } catch {}

                    return (
                      <div
                        key={ev.id || idx}
                        className="flex items-start gap-2.5 p-2.5 rounded-lg border border-border/40 hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
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
              )}
            </CardContent>
          </Card>

          {/* Risks & Alerts */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Risks & Alerts
                </CardTitle>
                {escalatedItems.length > 0 && (
                  <Badge className="bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-100">
                    {escalatedItems.length}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {escalatedItems.length === 0 ? (
                <div className="flex items-center gap-3 py-3 px-1 text-muted-foreground" data-testid="empty-alerts">
                  <Flag className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  <p className="text-sm">No escalated items</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {escalatedItems.slice(0, 5).map(item => (
                    <div
                      key={item.id}
                      className="flex items-start gap-2 p-2 rounded-md border border-amber-200/50 bg-amber-50/30 text-xs cursor-pointer hover:border-amber-300 hover:bg-amber-50/60 transition-colors group"
                      onClick={() => item.projectName ? navigate(`/project/${encodeURIComponent(item.projectName)}`) : navigate("/my-work/tasks")}
                      data-testid={`alert-item-${item.id}`}
                    >
                      <AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate group-hover:text-amber-800">{item.title}</p>
                        <p className="text-muted-foreground truncate">{item.projectName}</p>
                      </div>
                      <Badge variant="outline" className="text-[9px] shrink-0 ml-auto border-amber-300 text-amber-700">
                        {item.escalationLevel}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Links: Chat & Messages */}
          <Card className="border-border/60" data-testid="card-chat">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-blue-600" />
                  Communication
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className={outlookStatus?.connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-600 border-slate-200"}>
                    Outlook {outlookStatus?.connected ? "Connected" : "Not Connected"}
                  </Badge>
                  <Badge variant="outline" className={teamsStatus?.connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-600 border-slate-200"}>
                    Teams {teamsStatus?.connected ? "Connected" : "Not Connected"}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {personalMicrosoftTools.map(({ label, path, icon: ToolIcon }) => (
                    <Link key={path} href={path}>
                      <Button variant="outline" size="sm" className="w-full justify-center h-8 text-xs gap-1.5" data-testid={`link-${label.toLowerCase()}`}>
                        <ToolIcon className="h-3 w-3" />
                        {label}
                      </Button>
                    </Link>
                  ))}
                </div>
                {microsoftItems.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    {microsoftItems.length} item{microsoftItems.length !== 1 ? "s" : ""} needing attention
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
