import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { fetchRolloutFeatureFlags } from "@/lib/feature-flags";
import { PageShell, SectionHeader, KPIStrip } from "@/components/layout/page-shell";
import { useAccessMatrix } from "@/hooks/use-access-matrix";
import { format, parseISO } from "date-fns";
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
  const [, navigate] = useLocation();
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
      { label: "Personal Email", path: "/my-work/email" },
      { label: "Personal Teams", path: "/my-work/teams" },
      { label: "Personal Calendar", path: "/my-work/calendar" },
      { label: "Meetings", path: "/my-work/meetings" },
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
  }, [actionItems.length, escalatedItems.length, openTasks, sortedEvents]);

  return (
    <PageShell className="p-4 md:p-6" data-testid="my-work-home">
      <SectionHeader
        icon={<Target className="h-5 w-5" />}
        title="My Work"
        description={format(new Date(), "EEEE, MMMM d, yyyy")}
        actions={<Link href="/my-work/tasks"><Button variant="outline" size="sm" data-testid="link-all-tasks">All Tasks <ArrowRight className="h-3 w-3 ml-1" /></Button></Link>}
      />

      <Card className="mb-4 border-emerald-200/70 bg-gradient-to-r from-emerald-50/60 via-background to-background" data-testid="my-work-focus-summary">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-800">What matters now</p>
              <p className="text-xs text-muted-foreground">Your personal priorities for today across tasks, timeline, and action surfaces.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Badge variant="outline" className="justify-center bg-background/80">{myDaySummary.urgentActions} action now</Badge>
              <Badge variant="outline" className="justify-center bg-background/80">{myDaySummary.dueToday} due today</Badge>
              <Badge variant="outline" className="justify-center bg-background/80">{myDaySummary.upcomingMeetings} meetings</Badge>
              <Badge variant="outline" className="justify-center bg-background/80">{myDaySummary.openTasks} open tasks</Badge>
              <Badge variant="outline" className="justify-center bg-background/80">{myDaySummary.escalatedCount} alerts</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <KPIStrip className="grid-cols-1 lg:grid-cols-3" data-testid="my-work-grid">
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
                  <p className="text-sm text-muted-foreground">{sourceFilter === "all" ? "No open tasks right now" : `No ${SOURCE_FILTERS.find(f => f.key === sourceFilter)?.label || ""} tasks`}</p>
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
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-emerald-50/60 transition-colors cursor-pointer group"
                              onClick={() => handleTaskClick(task)}
                              data-testid={`task-item-${task.id}`}
                            >
                              <StatusIcon status={task.status} />
                              <PriorityDot priority={task.priority} />
                              <span className="text-sm truncate flex-1 group-hover:text-emerald-700">{task.title}</span>
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
                              <ChevronRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-emerald-600 transition-colors shrink-0" />
                            </div>
                          ))}
                          {projectTasks.length > 5 && (
                            <p
                              className="text-[10px] text-emerald-600 pl-2 cursor-pointer hover:underline"
                              onClick={() => navigate("/my-work/tasks")}
                            >
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
                  <p className="text-sm text-muted-foreground">No meetings on your calendar today</p>
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
          {contextualMsSurfacesEnabled && personalMicrosoftTools.length > 0 && (
            <Card data-testid="card-my-work-personal-ms-tools">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-600" />
                  Personal Microsoft Tools
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {personalMicrosoftTools.map((tool) => (
                    <Link key={tool.path} href={tool.path}><Button variant="outline" size="sm" className="justify-start h-8">{tool.label}</Button></Link>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className={outlookStatus?.connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-600 border-slate-200"}>
                    Outlook {outlookStatus?.connected ? "Connected" : "Not Connected"}
                  </Badge>
                  <Badge variant="outline" className={teamsStatus?.connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-600 border-slate-200"}>
                    Teams {teamsStatus?.connected ? "Connected" : "Not Connected"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

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
                        className="flex items-start gap-2 p-2 rounded-md border border-amber-200/50 bg-amber-50/30 text-xs cursor-pointer hover:border-amber-300 hover:bg-amber-50/60 transition-colors group"
                        onClick={() => item.projectName ? navigate(`/project/${encodeURIComponent(item.projectName)}`) : navigate("/my-work/tasks")}
                        data-testid={`alert-item-${item.id}`}
                      >
                        <AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate group-hover:text-amber-800">{item.title}</p>
                          <p className="text-muted-foreground truncate">{item.projectName}</p>
                        </div>
                        <Badge variant="outline" className="text-[9px] shrink-0 ml-auto border-amber-300 text-amber-700">
                          {item.escalationLevel}
                        </Badge>
                        <ChevronRight className="h-3 w-3 text-amber-400/0 group-hover:text-amber-600 mt-0.5 shrink-0 transition-colors" />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-meetings">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-indigo-600" />
                  Meetings
                </CardTitle>
                <Link href="/my-work/meetings">
                  <Button variant="ghost" size="sm" className="h-6 text-xs" data-testid="link-all-meetings">
                    View All <ChevronRight className="h-3 w-3 ml-0.5" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {calLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              ) : sortedEvents.length === 0 ? (
                <div className="flex flex-col items-center py-6 text-center" data-testid="empty-meetings">
                  <Calendar className="h-6 w-6 text-muted-foreground/50 mb-2" />
                  <p className="text-xs text-muted-foreground">No upcoming meetings today</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {sortedEvents.slice(0, 4).map((ev, idx) => {
                    let timeLabel = "";
                    try {
                      if (ev.isAllDay) {
                        timeLabel = "All day";
                      } else if (ev.start) {
                        timeLabel = format(parseISO(ev.start), "h:mm a");
                      }
                    } catch {}
                    return (
                      <div
                        key={ev.id || idx}
                        className="flex items-center gap-2 p-2 rounded-md border border-indigo-100 hover:bg-indigo-50/40 transition-colors"
                        data-testid={`meeting-item-${ev.id || idx}`}
                      >
                        <div className="w-1 h-8 rounded-full bg-indigo-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{ev.subject || "No Subject"}</p>
                          <p className="text-[10px] text-muted-foreground">{timeLabel}</p>
                        </div>
                        {ev.webLink && (
                          <a href={ev.webLink} target="_blank" rel="noopener noreferrer" className="shrink-0">
                            <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-indigo-600" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                  {sortedEvents.length > 4 && (
                    <Link href="/my-work/meetings">
                      <p className="text-[10px] text-indigo-600 pl-2 cursor-pointer hover:underline">
                        +{sortedEvents.length - 4} more meetings
                      </p>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-chat">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-600" />
                  Chat & Messages
                </CardTitle>
                <Link href="/my-work/teams">
                  <Button variant="ghost" size="sm" className="h-6 text-xs" data-testid="link-chat">
                    Open <ChevronRight className="h-3 w-3 ml-0.5" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className={teamsStatus?.connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-600 border-slate-200"}>
                    Teams {teamsStatus?.connected ? "Connected" : "Not Connected"}
                  </Badge>
                  <Badge variant="outline" className={outlookStatus?.connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-600 border-slate-200"}>
                    Outlook {outlookStatus?.connected ? "Connected" : "Not Connected"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Link href="/my-work/email">
                    <Button variant="outline" size="sm" className="w-full justify-start h-8 text-xs" data-testid="link-email">
                      <Mail className="h-3 w-3 mr-1.5" /> Email
                    </Button>
                  </Link>
                  <Link href="/my-work/teams">
                    <Button variant="outline" size="sm" className="w-full justify-start h-8 text-xs" data-testid="link-teams">
                      <ExternalLink className="h-3 w-3 mr-1.5" /> Teams
                    </Button>
                  </Link>
                </div>
                {microsoftItems.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    {microsoftItems.length} item{microsoftItems.length !== 1 ? "s" : ""} needing attention from email & Teams
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="h-4 w-4 text-purple-600" />
                  Action Required
                </CardTitle>
                <Badge variant="destructive" className="text-xs" data-testid="badge-action-count">
                  {actionItems.length}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Items waiting on your response from approvals and Microsoft tools.</p>
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
                  <p className="text-xs text-muted-foreground">You're clear — no immediate action required.</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[300px]">
                  <div className="space-y-1.5">
                    {actionItems.slice(0, 20).map(item => (
                      <div
                        key={item.id}
                        className="flex items-start gap-2 p-2 rounded-md border border-purple-200/60 bg-purple-50/30 hover:bg-purple-50/60 hover:border-purple-300 transition-colors cursor-pointer group"
                        onClick={() => handleActionClick(item)}
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
                          <p className="text-xs font-medium truncate mt-0.5 group-hover:text-purple-700">{item.title}</p>
                          {item.subtitle && (
                            <p className="text-[10px] text-muted-foreground truncate">{item.subtitle}</p>
                          )}
                        </div>
                        {isExternalTarget(item.link) ? (
                          <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-purple-600 shrink-0 mt-0.5" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-purple-600 shrink-0 mt-0.5 transition-colors" />
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </KPIStrip>
    </PageShell>
  );
}
