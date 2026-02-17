import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import DOMPurify from "dompurify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { format, addDays, parse } from "date-fns";
import MyToolLayout from "@/components/mytool/MyToolLayout";
import { TaskItem, TaskStatus } from "@/components/mytool/TaskCard";
import TaskDetailDrawer from "@/components/mytool/TaskDetailDrawer";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  CheckCircle2,
  Clock,
  Target,
  Inbox,
  Loader2,
  X,
  Flag,
  Mail,
  Search,
  ExternalLink,
  Calendar,
  Send,
  Reply,
  ReplyAll,
  Forward,
  ArrowLeft,
  FolderOpen,
  Paperclip,
  Pen,
} from "lucide-react";

type Horizon = "today" | "week" | "month" | "quarter";
type PriorityStatus = "active" | "monitoring" | "closed";

interface OutlookEmail {
  id: string;
  subject: string;
  sender: string | null;
  senderEmail: string | null;
  receivedAt: string;
  snippet: string | null;
  webLink: string | null;
  isRead: boolean;
  hasAttachments: boolean;
}

interface MailFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
  parentFolderId: string | null;
}

interface EmailDetail {
  id: string;
  subject: string;
  sender: string | null;
  senderEmail: string | null;
  to: Array<{ name: string; email: string }>;
  cc: Array<{ name: string; email: string }>;
  receivedAt: string;
  snippet: string | null;
  body: string | null;
  bodyType: string;
  webLink: string | null;
  isRead: boolean;
  hasAttachments: boolean;
}

interface CompanyPriority {
  id: number;
  title: string;
  severity: "critical" | "important" | "normal";
  horizon: Horizon;
  department: string | null;
  linkedProjectName: string | null;
  status: PriorityStatus;
}

interface TimeBlock {
  id: number;
  startTime: string;
  endTime: string;
  label: string;
  taskId: number | null;
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
  isRecurring: boolean;
  source: "outlook";
}

const DEPARTMENTS = [
  "Engineering", "Finance", "Operations", "Sales",
  "Procurement", "Legal", "HR", "Executive",
  "Project Delivery", "O&M",
] as const;

const today = format(new Date(), "yyyy-MM-dd");

function parseQuickAdd(text: string): { title: string; priority?: string; project?: string; department?: string; dueAt?: string; plannedForDate?: string } {
  let title = text;
  let priority: string | undefined;
  let project: string | undefined;
  let department: string | undefined;
  let dueAt: string | undefined;
  let plannedForDate = today;

  const p1Match = title.match(/\bp1\b/i);
  const p2Match = title.match(/\bp2\b/i);
  const p3Match = title.match(/\bp3\b/i);
  if (p1Match) { priority = "critical"; title = title.replace(p1Match[0], "").trim(); }
  else if (p2Match) { priority = "high"; title = title.replace(p2Match[0], "").trim(); }
  else if (p3Match) { priority = "normal"; title = title.replace(p3Match[0], "").trim(); }

  const hashMatch = title.match(/#(\w+)/);
  if (hashMatch) {
    const dept = DEPARTMENTS.find(d => d.toLowerCase().startsWith(hashMatch[1].toLowerCase()));
    if (dept) { department = dept; title = title.replace(hashMatch[0], "").trim(); }
  }

  const tomorrowMatch = title.match(/\btomorrow\b/i);
  if (tomorrowMatch) {
    plannedForDate = format(addDays(new Date(), 1), "yyyy-MM-dd");
    title = title.replace(tomorrowMatch[0], "").trim();
  }

  const dueFriMatch = title.match(/\bdue\s+(mon|tue|wed|thu|fri|sat|sun)\w*/i);
  if (dueFriMatch) {
    title = title.replace(dueFriMatch[0], "").trim();
  }

  title = title.replace(/\s+/g, " ").trim();
  return { title, priority, project, department, dueAt, plannedForDate };
}

export default function MyToolTodayPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [quickAddText, setQuickAddText] = useState("");
  const [drawerTask, setDrawerTask] = useState<TaskItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [doneCollapsed, setDoneCollapsed] = useState(true);
  const [emailInboxOpen, setEmailInboxOpen] = useState(true);
  const [emailInboxSearch, setEmailInboxSearch] = useState("");
  const [debouncedInboxSearch, setDebouncedInboxSearch] = useState("");
  const [emailFolder, setEmailFolder] = useState("inbox");
  const [showFolders, setShowFolders] = useState(false);
  const [emailDetailId, setEmailDetailId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [replyMode, setReplyMode] = useState<"reply" | "replyAll" | "forward" | null>(null);
  const [replyText, setReplyText] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockLabel, setBlockLabel] = useState("");
  const [blockTaskId, setBlockTaskId] = useState<number | null>(null);
  const plannerStartHour = 6;
  const plannerEndHour = 21;
  const [prioritiesOpen, setPrioritiesOpen] = useState(true);
  const [horizon, setHorizon] = useState<Horizon>("week");
  const [addPriorityOpen, setAddPriorityOpen] = useState(false);
  const [newPriority, setNewPriority] = useState({ title: "", department: "", severity: "normal" as string, linkedProjectName: "" });
  const [dodPromptTask, setDodPromptTask] = useState<TaskItem | null>(null);
  const [dodPromptText, setDodPromptText] = useState("");
  const [projectCollapsed, setProjectCollapsed] = useState<Record<string, boolean>>({});
  const [plannerDropHour, setPlannerDropHour] = useState<number | null>(null);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<TaskItem[]>({
    queryKey: [`/api/mytool/tasks?date=${today}`],
    select: (data: any[]) => data.map((t: any) => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority,
      plannedForDate: t.plannedForDate || t.planned_for_date || null,
      dueAt: t.dueAt || t.due_at || null,
      sortOrder: t.sortOrder || t.sort_order || 0,
      projectName: t.projectName || t.project_name || null,
      department: t.department || null,
      tag: t.tag || null,
      blockedReason: t.blockedReason || t.blocked_reason || null,
      nextStep: t.nextStep || t.next_step || null,
      definitionOfDone: t.definitionOfDone || t.definition_of_done || null,
      completionNote: t.completionNote || t.completion_note || null,
      pinnedToday: t.pinnedToday || t.pinned_today || false,
      pinnedWeek: t.pinnedWeek || t.pinned_week || false,
      isRecurring: t.isRecurring || t.is_recurring || false,
      recurrenceFrequency: t.recurrenceFrequency || t.recurrence_frequency || null,
      notes: t.notes || null,
      createdAt: t.createdAt || t.created_at || null,
    })),
  });

  const { data: timeblocks = [] } = useQuery<TimeBlock[]>({
    queryKey: [`/api/mytool/timeblocks?date=${today}`],
  });

  const { data: calendarEvents = [] } = useQuery<CalendarEvent[]>({
    queryKey: [`/api/outlook/events`, today],
    queryFn: async () => {
      const res = await fetch(`/api/outlook/events?start=${today}&end=${today}`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.filter((e: CalendarEvent) => !e.isCancelled) : [];
    },
  });

  const { data: priorities = [] } = useQuery<CompanyPriority[]>({
    queryKey: [`/api/mytool/company-priorities?horizon=${horizon}`],
  });

  const { data: escalatedItems = [] } = useQuery<Array<{
    id: string; type: string; title: string; projectName: string;
    escalationLevel: string; status: string | null; priority: string | null;
  }>>({
    queryKey: ["/api/mytool/escalated-priorities"],
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInboxSearch(emailInboxSearch), 400);
    return () => clearTimeout(timer);
  }, [emailInboxSearch]);

  const { data: inboxEmails = [], isLoading: inboxEmailsLoading } = useQuery<OutlookEmail[]>({
    queryKey: ["/api/outlook/messages", emailFolder, debouncedInboxSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ top: "20", folder: emailFolder });
      if (debouncedInboxSearch.trim()) params.set("search", debouncedInboxSearch.trim());
      const res = await fetch(`/api/outlook/messages?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.value || [];
    },
  });

  const { data: mailFolders = [] } = useQuery<MailFolder[]>({
    queryKey: ["/api/outlook/folders"],
    queryFn: async () => {
      const res = await fetch("/api/outlook/folders", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: emailDetail, isLoading: emailDetailLoading } = useQuery<EmailDetail>({
    queryKey: ["/api/outlook/messages", emailDetailId],
    queryFn: async () => {
      const res = await fetch(`/api/outlook/messages/${emailDetailId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch email");
      return res.json();
    },
    enabled: !!emailDetailId,
  });

  const sendMailMutation = useMutation({
    mutationFn: (data: { to: string[]; cc?: string[]; subject: string; body: string }) =>
      apiRequest("POST", "/api/outlook/send", data),
    onSuccess: () => {
      toast({ title: "Email sent" });
      setComposeOpen(false);
      setComposeTo("");
      setComposeCc("");
      setComposeSubject("");
      setComposeBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/outlook/messages"] });
    },
    onError: (err: any) => toast({ title: "Failed to send email", description: err.message, variant: "destructive" }),
  });

  const replyMutation = useMutation({
    mutationFn: (data: { id: string; comment: string; replyAll: boolean }) =>
      apiRequest("POST", `/api/outlook/messages/${data.id}/reply`, { comment: data.comment, replyAll: data.replyAll }),
    onSuccess: () => {
      toast({ title: "Reply sent" });
      setReplyMode(null);
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["/api/outlook/messages"] });
    },
    onError: (err: any) => toast({ title: "Failed to send reply", description: err.message, variant: "destructive" }),
  });

  const forwardMutation = useMutation({
    mutationFn: (data: { id: string; comment: string; to: string[] }) =>
      apiRequest("POST", `/api/outlook/messages/${data.id}/forward`, { comment: data.comment, to: data.to }),
    onSuccess: () => {
      toast({ title: "Email forwarded" });
      setReplyMode(null);
      setReplyText("");
      setForwardTo("");
      queryClient.invalidateQueries({ queryKey: ["/api/outlook/messages"] });
    },
    onError: (err: any) => toast({ title: "Failed to forward email", description: err.message, variant: "destructive" }),
  });

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/tasks?date=${today}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/timeblocks?date=${today}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/mytool/company-priorities?horizon=${horizon}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/mytool/tasks"] });
  }, [horizon]);

  const errHandler = {
    onError: (error: Error) => {
      toast({ title: "Couldn't save", description: error.message || "Please try again.", variant: "destructive" });
    },
  };

  const createTaskMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => apiRequest("POST", "/api/mytool/tasks", body),
    onSuccess: () => invalidateAll(),
    ...errHandler,
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: number }) => apiRequest("PATCH", `/api/mytool/tasks/${id}`, body),
    onSuccess: () => invalidateAll(),
    onError: (error: any) => {
      const msg = error?.message || "";
      if (msg.includes("Definition of Done")) {
        toast({ title: "Can't close yet", description: "Add a Definition of Done first.", variant: "destructive" });
      } else {
        toast({ title: "Couldn't save", description: msg, variant: "destructive" });
      }
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/mytool/tasks/${id}`),
    onSuccess: () => invalidateAll(),
    ...errHandler,
  });

  const createBlockMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => apiRequest("POST", "/api/mytool/timeblocks", body),
    onSuccess: () => { invalidateAll(); setAddBlockOpen(false); setBlockStart(""); setBlockEnd(""); setBlockLabel(""); setBlockTaskId(null); },
    ...errHandler,
  });

  const deleteBlockMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/mytool/timeblocks/${id}`),
    onSuccess: () => invalidateAll(),
    ...errHandler,
  });

  const createPriorityMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => apiRequest("POST", "/api/mytool/company-priorities", body),
    onSuccess: () => { invalidateAll(); setAddPriorityOpen(false); setNewPriority({ title: "", department: "", severity: "normal", linkedProjectName: "" }); },
    ...errHandler,
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async ({ id, ...body }: { id: number } & Record<string, unknown>) => apiRequest("PATCH", `/api/mytool/company-priorities/${id}`, body),
    onSuccess: () => invalidateAll(),
    ...errHandler,
  });

  const deletePriorityMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/mytool/company-priorities/${id}`),
    onSuccess: () => invalidateAll(),
    ...errHandler,
  });

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["/api/projects-summary"],
    select: (data: any[]) => data.map((p: any) => ({ project_name: p.project_name })),
  });

  const handleQuickAdd = useCallback((text?: string) => {
    const raw = text || quickAddText.trim();
    if (!raw) return;
    const parsed = parseQuickAdd(raw);
    createTaskMutation.mutate({
      title: parsed.title,
      status: "planned",
      plannedForDate: parsed.plannedForDate || today,
      priority: parsed.priority || "normal",
      department: parsed.department || null,
    });
    setQuickAddText("");
  }, [quickAddText]);

  const handleStatusChange = (taskId: number, newStatus: TaskStatus) => {
    updateTaskMutation.mutate({ id: taskId, status: newStatus });
  };

  const handleQuickDone = (task: TaskItem) => {
    if (!task.definitionOfDone?.trim()) {
      setDodPromptTask(task);
      setDodPromptText("");
      return;
    }
    updateTaskMutation.mutate({ id: task.id, status: "done" });
  };

  const handleDodPromptSave = () => {
    if (!dodPromptTask || !dodPromptText.trim()) return;
    updateTaskMutation.mutate({
      id: dodPromptTask.id,
      status: "done",
      definitionOfDone: dodPromptText.trim(),
    });
    setDodPromptTask(null);
    setDodPromptText("");
  };

  const handleDropEmail = async (email: OutlookEmail) => {
    try {
      await apiRequest("POST", "/api/mytool/tasks", {
        title: email.subject || "(No subject)",
        status: "planned",
        plannedForDate: today,
        priority: "normal",
        notes: `Email from: ${email.sender || email.senderEmail || "unknown"}\n\n${email.snippet || ""}`,
      });
      await apiRequest("POST", "/api/outlook/email-to-task", {
        outlookMessageId: email.id,
        subject: email.subject,
        sender: email.sender || email.senderEmail || "",
        receivedAt: email.receivedAt,
        snippet: email.snippet?.slice(0, 200) || "",
        webLink: email.webLink || "",
        targetType: "new",
      });
      invalidateAll();
      toast({ title: "Task created from email" });
    } catch {
      toast({ title: "Failed to create task from email", variant: "destructive" });
    }
  };

  const handleDropTaskOnPlanner = (taskId: number, hour: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const startTime = `${String(hour).padStart(2, "0")}:00`;
    const endTime = `${String(hour + 1).padStart(2, "0")}:00`;
    createBlockMutation.mutate({
      date: today,
      startTime,
      endTime,
      label: task.title,
      taskId: task.id,
    });
  };

  const pinnedTasks = tasks.filter(t => t.pinnedToday && t.status !== "done" && t.status !== "cancelled");
  const inProgressTasks = tasks.filter(t => t.status === "in_progress" && !t.pinnedToday);
  const plannedTasks = tasks.filter(t => t.status === "planned" && t.plannedForDate === today && !t.pinnedToday).sort((a, b) => a.sortOrder - b.sortOrder);
  const blockedWaitingTasks = tasks.filter(t => (t.status === "blocked" || t.status === "waiting") && !t.pinnedToday);
  const inboxTasks = tasks.filter(t => t.status === "inbox");
  const doneTasks = tasks.filter(t => t.status === "done");

  const activePriorities = priorities.filter(p => p.status !== "closed");

  const openTasks = tasks.filter(t => t.status !== "done" && t.status !== "cancelled");
  const tasksByProject = useMemo(() => {
    const groups: Record<string, TaskItem[]> = {};
    openTasks.forEach(t => {
      const key = t.projectName || "No Project";
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return Object.entries(groups).sort(([a], [b]) => a === "No Project" ? 1 : b === "No Project" ? -1 : a.localeCompare(b));
  }, [openTasks]);

  if (tasksLoading) {
    return (
      <MyToolLayout onQuickAdd={handleQuickAdd}>
        <div className="space-y-4 max-w-3xl" data-testid="mytool-today-skeleton">
          <div className="flex gap-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-5 w-20" />)}
          </div>
          <Skeleton className="h-10 w-full" />
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      </MyToolLayout>
    );
  }

  return (
    <MyToolLayout onQuickAdd={handleQuickAdd}>
      <div className="space-y-4" data-testid="mytool-today-page">
        {/* Stats strip */}
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="stats-strip">
          {[
            { label: "Pinned", count: pinnedTasks.length, color: "bg-violet-500" },
            { label: "In Progress", count: inProgressTasks.length, color: "bg-amber-500" },
            { label: "Planned", count: plannedTasks.length, color: "bg-blue-500" },
            { label: "Blocked", count: blockedWaitingTasks.length, color: "bg-red-500" },
            { label: "Done", count: doneTasks.length, color: "bg-emerald-500" },
          ].map((s, i) => (
            <div key={s.label} className="flex items-center gap-1.5">
              {i > 0 && <span className="w-px h-3.5 bg-border" />}
              <span className={`w-1.5 h-1.5 rounded-full ${s.color}`} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-semibold text-foreground">{s.count}</span>
            </div>
          ))}
        </div>

        {/* Quick Add (mobile) */}
        <div className="sm:hidden">
          <div className="flex gap-2" data-testid="quick-add-mobile">
            <Input
              placeholder="Quick add task... (Enter)"
              value={quickAddText}
              onChange={(e) => setQuickAddText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
              className="h-9 text-sm"
              data-testid="input-quick-add"
            />
            <Button onClick={() => handleQuickAdd()} disabled={!quickAddText.trim()} className="h-9 px-3" data-testid="button-quick-add">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Three-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* LEFT COLUMN: Open Tasks & Projects */}
          <div className="lg:col-span-3 space-y-3" data-testid="column-tasks">
            <div className="border border-border/50 rounded-lg">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/30">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-violet-600" />
                  <span className="text-sm font-medium">Open Tasks</span>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">{openTasks.length}</Badge>
                </div>
              </div>
              <div className="overflow-y-auto max-h-[calc(100vh-220px)]">
                {openTasks.length === 0 ? (
                  <div className="text-center py-8 px-3" data-testid="empty-tasks">
                    <Target className="h-6 w-6 text-muted-foreground/20 mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">No open tasks.</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Use Quick Add (⌘K)</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {tasksByProject.map(([projectName, projectTasks]) => {
                      const isCollapsed = projectCollapsed[projectName] ?? false;
                      return (
                        <div key={projectName} className="rounded-md border border-border/40" data-testid={`project-group-${projectName}`}>
                          <button
                            className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-muted/30 transition-colors rounded-t-md"
                            onClick={() => setProjectCollapsed(prev => ({ ...prev, [projectName]: !isCollapsed }))}
                            data-testid={`toggle-project-${projectName}`}
                          >
                            {isCollapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
                            <span className="text-[11px] font-medium text-foreground truncate flex-1">{projectName}</span>
                            <Badge variant="secondary" className="text-[9px] h-3.5 px-1 shrink-0">{projectTasks.length}</Badge>
                          </button>
                          {!isCollapsed && (
                            <div className="px-1 pb-1 space-y-0.5">
                              {projectTasks.map(task => (
                                <div
                                  key={task.id}
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData("text/plain", String(task.id));
                                    e.dataTransfer.setData("application/x-task", JSON.stringify(task));
                                    e.dataTransfer.effectAllowed = "copy";
                                  }}
                                  className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] hover:bg-muted/40 cursor-grab active:cursor-grabbing transition-colors group/task border border-transparent hover:border-border/30"
                                  data-testid={`task-drag-${task.id}`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                    task.status === "in_progress" ? "bg-amber-500" :
                                    task.status === "blocked" || task.status === "waiting" ? "bg-red-500" :
                                    task.pinnedToday ? "bg-violet-500" : "bg-blue-500"
                                  }`} />
                                  <span
                                    className="flex-1 truncate text-foreground cursor-pointer hover:text-primary"
                                    onClick={() => { setDrawerTask(task); setDrawerOpen(true); }}
                                  >
                                    {task.title}
                                  </span>
                                  {task.priority === "critical" && <span className="text-[8px] text-red-500 font-bold shrink-0">P1</span>}
                                  {task.priority === "high" && <span className="text-[8px] text-amber-500 font-bold shrink-0">P2</span>}
                                  <button
                                    className="opacity-0 group-hover/task:opacity-100 shrink-0 text-emerald-500 hover:text-emerald-600"
                                    onClick={(e) => { e.stopPropagation(); handleQuickDone(task); }}
                                    data-testid={`done-task-${task.id}`}
                                  >
                                    <CheckCircle2 className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Done section (collapsed by default) */}
                    {doneTasks.length > 0 && (
                      <div className="mt-1 rounded-md border border-border/40">
                        <button className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-muted/30 transition-colors" onClick={() => setDoneCollapsed(!doneCollapsed)} data-testid="toggle-done-lane">
                          {doneCollapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          <span className="text-[11px] font-medium text-muted-foreground">Done</span>
                          <Badge variant="secondary" className="text-[9px] h-3.5 px-1">{doneTasks.length}</Badge>
                        </button>
                        {!doneCollapsed && (
                          <div className="px-1 pb-1 space-y-0.5">
                            {doneTasks.map(task => (
                              <div key={task.id} className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-muted-foreground" data-testid={`done-task-item-${task.id}`}>
                                <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                                <span className="flex-1 truncate line-through cursor-pointer hover:text-foreground" onClick={() => { setDrawerTask(task); setDrawerOpen(true); }}>{task.title}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* CENTER COLUMN: Daily Planner */}
          <div className="lg:col-span-5 space-y-3" data-testid="column-planner">
            {/* Daily Planner */}
            <section
              className="border border-border/50 rounded-lg"
              data-testid="card-daily-planner"
            >
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-violet-600" />
                  <span className="text-sm font-medium">Daily Planner</span>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">
                    {timeblocks.length + calendarEvents.filter(e => !e.isAllDay).length}
                  </Badge>
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => {
                  setAddBlockOpen(!addBlockOpen);
                  if (!addBlockOpen) { setBlockStart(""); setBlockEnd(""); setBlockLabel(""); setBlockTaskId(null); }
                }} data-testid="button-add-block">
                  {addBlockOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {/* All-day events banner */}
              {calendarEvents.filter(e => e.isAllDay).length > 0 && (
                <div className="px-4 pb-2 space-y-1">
                  {calendarEvents.filter(e => e.isAllDay).map(evt => (
                    <div key={evt.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30" data-testid={`allday-event-${evt.id}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <span className="text-[11px] text-blue-700 dark:text-blue-300 truncate flex-1">{evt.subject}</span>
                      <span className="text-[9px] text-blue-500 uppercase shrink-0">All day</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Add block form */}
              {addBlockOpen && (
                <div className="mx-4 mb-3 space-y-2 p-3 bg-muted/30 rounded-lg border border-border/50" data-testid="form-add-block">
                  <div className="flex gap-2">
                    <Input type="time" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} className="text-xs h-8" data-testid="input-block-start" />
                    <Input type="time" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} className="text-xs h-8" data-testid="input-block-end" />
                  </div>
                  <Input value={blockLabel} onChange={(e) => setBlockLabel(e.target.value)} className="text-xs h-8" placeholder="What are you working on?" onKeyDown={(e) => e.key === "Enter" && blockStart && blockEnd && blockLabel.trim() && createBlockMutation.mutate({ date: today, startTime: blockStart, endTime: blockEnd, label: blockLabel.trim(), taskId: blockTaskId })} data-testid="input-block-label" />
                  <select value={blockTaskId ?? ""} onChange={(e) => setBlockTaskId(e.target.value ? Number(e.target.value) : null)} className="w-full h-8 text-xs border border-border rounded px-2 bg-background" data-testid="select-block-task">
                    <option value="">Link a task (optional)</option>
                    {tasks.filter(t => t.status !== "done" && t.status !== "cancelled").map(t => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                  </select>
                  <Button size="sm" className="w-full h-7 text-xs" onClick={() => createBlockMutation.mutate({ date: today, startTime: blockStart, endTime: blockEnd, label: blockLabel.trim(), taskId: blockTaskId })} disabled={!blockStart || !blockEnd || !blockLabel.trim()} data-testid="button-save-block">
                    Add Block
                  </Button>
                </div>
              )}

              {/* Timeline view */}
              <div className="px-2 pb-3 overflow-y-auto max-h-[600px]" data-testid="planner-timeline">
                {(() => {
                  const SLOT_HEIGHT = 48;
                  const hours = Array.from({ length: plannerEndHour - plannerStartHour }, (_, i) => plannerStartHour + i);

                  const timeToMinutes = (t: string) => {
                    const [h, m] = t.split(":").map(Number);
                    return h * 60 + (m || 0);
                  };

                  const eventToMinutes = (dt: string) => {
                    try {
                      const d = new Date(dt);
                      return d.getHours() * 60 + d.getMinutes();
                    } catch { return 0; }
                  };

                  const minToTop = (mins: number) => {
                    const offset = mins - plannerStartHour * 60;
                    return Math.max(0, (offset / 60) * SLOT_HEIGHT);
                  };

                  const minToHeight = (startMins: number, endMins: number) => {
                    const dur = Math.max(endMins - startMins, 15);
                    return (dur / 60) * SLOT_HEIGHT;
                  };

                  const timedEvents = calendarEvents.filter(e => !e.isAllDay && !e.isCancelled);
                  const sortedBlocks = [...timeblocks].sort((a, b) => a.startTime.localeCompare(b.startTime));

                  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
                  const nowTop = minToTop(nowMinutes);
                  const showNowLine = nowMinutes >= plannerStartHour * 60 && nowMinutes <= plannerEndHour * 60;

                  return (
                    <div className="relative" style={{ height: hours.length * SLOT_HEIGHT }}>
                      {/* Hour grid lines */}
                      {hours.map((hour) => (
                        <div
                          key={hour}
                          className={`absolute left-0 right-0 border-t border-border/30 group/slot cursor-pointer transition-colors ${plannerDropHour === hour ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/20"}`}
                          style={{ top: (hour - plannerStartHour) * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                          onClick={() => {
                            if (!addBlockOpen) {
                              setAddBlockOpen(true);
                              setBlockStart(`${String(hour).padStart(2, "0")}:00`);
                              setBlockEnd(`${String(hour + 1).padStart(2, "0")}:00`);
                              setBlockLabel("");
                              setBlockTaskId(null);
                            }
                          }}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setPlannerDropHour(hour); }}
                          onDragLeave={() => setPlannerDropHour(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setPlannerDropHour(null);
                            const taskIdStr = e.dataTransfer.getData("text/plain");
                            const taskId = parseInt(taskIdStr, 10);
                            if (!isNaN(taskId)) {
                              handleDropTaskOnPlanner(taskId, hour);
                            } else {
                              try {
                                const emailData = JSON.parse(e.dataTransfer.getData("application/json"));
                                if (emailData?.id && emailData?.subject !== undefined) {
                                  handleDropEmail(emailData);
                                }
                              } catch {}
                            }
                          }}
                          data-testid={`slot-hour-${hour}`}
                        >
                          <span className="absolute -top-2.5 left-1 text-[10px] font-mono text-muted-foreground/60 select-none">
                            {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                          </span>
                          {plannerDropHour === hour ? (
                            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-primary font-medium select-none">Drop here</span>
                          ) : (
                            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-primary/0 group-hover/slot:text-primary/60 transition-colors select-none">
                              + Add
                            </span>
                          )}
                        </div>
                      ))}

                      {/* Now indicator */}
                      {showNowLine && (
                        <div className="absolute left-8 right-1 z-30 pointer-events-none flex items-center" style={{ top: nowTop }} data-testid="now-indicator">
                          <span className="w-2 h-2 rounded-full bg-red-500 -ml-1 shrink-0" />
                          <div className="flex-1 h-[1.5px] bg-red-500" />
                        </div>
                      )}

                      {/* Calendar events (Outlook) */}
                      {timedEvents.map((evt) => {
                        const startMins = eventToMinutes(evt.start);
                        const endMins = eventToMinutes(evt.end);
                        const top = minToTop(startMins);
                        const height = minToHeight(startMins, endMins);
                        const startFmt = `${String(Math.floor(startMins / 60)).padStart(2, "0")}:${String(startMins % 60).padStart(2, "0")}`;
                        const endFmt = `${String(Math.floor(endMins / 60)).padStart(2, "0")}:${String(endMins % 60).padStart(2, "0")}`;
                        return (
                          <div
                            key={evt.id}
                            className="absolute left-10 right-1 z-10 rounded-md bg-blue-100/80 dark:bg-blue-900/30 border border-blue-300/60 dark:border-blue-700/40 px-2 py-1 overflow-hidden cursor-default"
                            style={{ top, height: Math.max(height, 20) }}
                            title={`${evt.subject}\n${startFmt} – ${endFmt}${evt.location ? `\n${evt.location}` : ""}`}
                            data-testid={`calendar-event-${evt.id}`}
                          >
                            <div className="flex items-start gap-1">
                              <Mail className="h-3 w-3 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-medium text-blue-800 dark:text-blue-200 truncate leading-tight">{evt.subject}</p>
                                <p className="text-[9px] text-blue-600 dark:text-blue-400">{startFmt} – {endFmt}</p>
                                {evt.location && height > 40 && <p className="text-[9px] text-blue-500 truncate">{evt.location}</p>}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* Time blocks */}
                      {sortedBlocks.map((block) => {
                        const startMins = timeToMinutes(block.startTime);
                        const endMins = timeToMinutes(block.endTime);
                        const top = minToTop(startMins);
                        const height = minToHeight(startMins, endMins);
                        const linkedTask = block.taskId ? tasks.find(t => t.id === block.taskId) : null;
                        return (
                          <div
                            key={block.id}
                            className="absolute left-10 z-20 rounded-md bg-violet-100/80 dark:bg-violet-900/30 border border-violet-300/60 dark:border-violet-700/40 px-2 py-1 overflow-hidden group/block"
                            style={{
                              top, height: Math.max(height, 20),
                              right: timedEvents.some(e => {
                                const es = eventToMinutes(e.start);
                                const ee = eventToMinutes(e.end);
                                return startMins < ee && endMins > es;
                              }) ? "calc(50% + 2px)" : "4px"
                            }}
                            title={`${block.label}\n${block.startTime} – ${block.endTime}`}
                            data-testid={`timeblock-${block.id}`}
                          >
                            <div className="flex items-start gap-1">
                              <Clock className="h-3 w-3 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-medium text-violet-800 dark:text-violet-200 truncate leading-tight">{block.label}</p>
                                <p className="text-[9px] text-violet-600 dark:text-violet-400">{block.startTime} – {block.endTime}</p>
                                {linkedTask && height > 35 && (
                                  <p className="text-[9px] text-violet-500 truncate mt-0.5">
                                    <span className={`inline-block w-1 h-1 rounded-full mr-0.5 ${linkedTask.status === "done" ? "bg-emerald-500" : linkedTask.status === "in_progress" ? "bg-amber-500" : "bg-blue-500"}`} />
                                    {linkedTask.title}
                                  </p>
                                )}
                              </div>
                              <Button variant="ghost" size="sm" className="h-4 w-4 p-0 opacity-0 group-hover/block:opacity-100 text-violet-400 hover:text-destructive shrink-0" onClick={(e) => { e.stopPropagation(); deleteBlockMutation.mutate(block.id); }} data-testid={`button-delete-block-${block.id}`}>
                                <X className="h-2.5 w-2.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 px-4 pb-3 border-t border-border/30 pt-2">
                <div className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-violet-200 dark:bg-violet-800 border border-violet-300" />
                  <span className="text-[10px] text-muted-foreground">Tasks</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-blue-200 dark:bg-blue-800 border border-blue-300" />
                  <span className="text-[10px] text-muted-foreground">Meetings</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2.5 h-[2px] bg-red-500" />
                  <span className="text-[10px] text-muted-foreground">Now</span>
                </div>
              </div>
            </section>
          </div>

          {/* RIGHT COLUMN: Email & Priorities */}
          <div className="lg:col-span-4 space-y-3" data-testid="column-context">
            {/* Email Inbox */}
            <section className="border border-border/50 rounded-lg" data-testid="card-email-inbox">
              <div className="flex items-center justify-between px-4 py-3">
                <button className="flex items-center gap-2 text-left" onClick={() => setEmailInboxOpen(!emailInboxOpen)} data-testid="toggle-email-inbox">
                  {emailInboxOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <Mail className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium">Email</span>
                </button>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowFolders(!showFolders)} title="Browse folders" data-testid="button-show-folders">
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setComposeOpen(true); setEmailDetailId(null); setReplyMode(null); }} title="Compose email" data-testid="button-compose-email">
                      <Pen className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              {emailInboxOpen && (
                <div className="px-4 pb-4 space-y-2">
                  {/* Folder list */}
                  {showFolders && (
                    <div className="border border-border/40 rounded-md p-2 space-y-0.5 max-h-[200px] overflow-y-auto bg-muted/10" data-testid="email-folder-list">
                      {mailFolders.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground text-center py-2">No folders available</p>
                      ) : mailFolders.map(folder => (
                        <button
                          key={folder.id}
                          className={`w-full flex items-center justify-between px-2 py-1 rounded text-left text-xs transition-colors ${emailFolder === folder.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/30 text-foreground"}`}
                          onClick={() => { setEmailFolder(folder.id); setEmailDetailId(null); setShowFolders(false); }}
                          data-testid={`folder-${folder.id}`}
                        >
                          <span className="truncate">{folder.displayName}</span>
                          {folder.unreadItemCount > 0 && (
                            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-1 shrink-0">{folder.unreadItemCount}</Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Compose form */}
                  {composeOpen && !emailDetailId && (
                    <div className="border border-primary/20 rounded-lg p-3 space-y-2 bg-primary/5" data-testid="compose-email-form">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">New Email</span>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setComposeOpen(false)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <Input placeholder="To (comma-separated)" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} className="h-7 text-xs" data-testid="input-compose-to" />
                      <Input placeholder="Cc (optional)" value={composeCc} onChange={(e) => setComposeCc(e.target.value)} className="h-7 text-xs" data-testid="input-compose-cc" />
                      <Input placeholder="Subject" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} className="h-7 text-xs" data-testid="input-compose-subject" />
                      <Textarea placeholder="Write your message..." value={composeBody} onChange={(e) => setComposeBody(e.target.value)} className="text-xs min-h-[80px]" data-testid="textarea-compose-body" />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={!composeTo.trim() || !composeSubject.trim() || sendMailMutation.isPending}
                          onClick={() => {
                            const toList = composeTo.split(",").map(s => s.trim()).filter(Boolean);
                            const ccList = composeCc ? composeCc.split(",").map(s => s.trim()).filter(Boolean) : [];
                            sendMailMutation.mutate({ to: toList, cc: ccList, subject: composeSubject, body: composeBody });
                          }}
                          data-testid="button-send-compose"
                        >
                          {sendMailMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                          Send
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Email detail view */}
                  {emailDetailId && !composeOpen && (
                    <div className="space-y-2" data-testid="email-detail-view">
                      <button className="flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => { setEmailDetailId(null); setReplyMode(null); setReplyText(""); }} data-testid="button-back-to-list">
                        <ArrowLeft className="h-3 w-3" /> Back to list
                      </button>
                      {emailDetailLoading ? (
                        <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                      ) : emailDetail ? (
                        <div className="space-y-2">
                          <div>
                            <p className="text-xs font-semibold">{emailDetail.subject}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">From: {emailDetail.sender || emailDetail.senderEmail}</p>
                            {emailDetail.to.length > 0 && <p className="text-[10px] text-muted-foreground">To: {emailDetail.to.map(r => r.name || r.email).join(", ")}</p>}
                            {emailDetail.cc.length > 0 && <p className="text-[10px] text-muted-foreground">Cc: {emailDetail.cc.map(r => r.name || r.email).join(", ")}</p>}
                            <p className="text-[10px] text-muted-foreground">{emailDetail.receivedAt ? format(new Date(emailDetail.receivedAt), "d MMM yyyy, h:mm a") : ""}</p>
                          </div>
                          <div className="border border-border/30 rounded-md p-2 max-h-[250px] overflow-y-auto bg-background">
                            {emailDetail.bodyType === "html" || emailDetail.bodyType === "HTML" ? (
                              <div className="text-xs prose prose-sm max-w-none [&_*]:text-xs" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailDetail.body || "", { ALLOWED_TAGS: ["p", "br", "b", "i", "strong", "em", "a", "ul", "ol", "li", "div", "span", "table", "tr", "td", "th", "thead", "tbody", "h1", "h2", "h3", "h4", "h5", "h6", "img", "blockquote", "pre", "code", "hr"], ALLOWED_ATTR: ["href", "src", "alt", "style", "class", "target", "rel", "width", "height", "colspan", "rowspan"], ALLOW_DATA_ATTR: false }) }} />
                            ) : (
                              <pre className="text-xs whitespace-pre-wrap text-foreground">{emailDetail.body || emailDetail.snippet || ""}</pre>
                            )}
                          </div>
                          {/* Action buttons */}
                          <div className="flex items-center gap-1 flex-wrap">
                            {isAdmin && (
                              <>
                                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { setReplyMode("reply"); setReplyText(""); }} data-testid="button-reply">
                                  <Reply className="h-3 w-3" /> Reply
                                </Button>
                                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { setReplyMode("replyAll"); setReplyText(""); }} data-testid="button-reply-all">
                                  <ReplyAll className="h-3 w-3" /> Reply All
                                </Button>
                                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { setReplyMode("forward"); setReplyText(""); setForwardTo(""); }} data-testid="button-forward">
                                  <Forward className="h-3 w-3" /> Forward
                                </Button>
                              </>
                            )}
                            {emailDetail.webLink && (
                              <a href={emailDetail.webLink} target="_blank" rel="noopener noreferrer" className="ml-auto">
                                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid="button-open-in-outlook">
                                  <ExternalLink className="h-3 w-3" /> Open
                                </Button>
                              </a>
                            )}
                          </div>
                          {/* Reply/Forward form */}
                          {replyMode && (
                            <div className="border border-primary/20 rounded-lg p-2.5 space-y-2 bg-primary/5" data-testid="reply-form">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase">
                                {replyMode === "reply" ? "Reply" : replyMode === "replyAll" ? "Reply All" : "Forward"}
                              </span>
                              {replyMode === "forward" && (
                                <Input placeholder="Forward to (comma-separated)" value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} className="h-7 text-xs" data-testid="input-forward-to" />
                              )}
                              <Textarea
                                placeholder="Type your message..."
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                className="text-xs min-h-[60px]"
                                autoFocus
                                data-testid="textarea-reply-body"
                              />
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setReplyMode(null); setReplyText(""); }}>Cancel</Button>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  disabled={!replyText.trim() || (replyMode === "forward" && !forwardTo.trim()) || replyMutation.isPending || forwardMutation.isPending}
                                  onClick={() => {
                                    if (replyMode === "forward") {
                                      const toList = forwardTo.split(",").map(s => s.trim()).filter(Boolean);
                                      forwardMutation.mutate({ id: emailDetailId!, comment: replyText, to: toList });
                                    } else {
                                      replyMutation.mutate({ id: emailDetailId!, comment: replyText, replyAll: replyMode === "replyAll" });
                                    }
                                  }}
                                  data-testid="button-send-reply"
                                >
                                  {(replyMutation.isPending || forwardMutation.isPending) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                  Send
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground text-center py-4">Email not found</p>
                      )}
                    </div>
                  )}

                  {/* Email list (when not viewing detail or composing) */}
                  {!emailDetailId && !composeOpen && (
                    <>
                      <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input placeholder="Search emails..." value={emailInboxSearch} onChange={(e) => setEmailInboxSearch(e.target.value)} className="pl-8 text-xs h-8" data-testid="input-inbox-search" />
                        </div>
                        {emailFolder !== "inbox" && (
                          <Button variant="ghost" size="sm" className="h-8 text-[10px] px-2" onClick={() => setEmailFolder("inbox")} data-testid="button-back-to-inbox">
                            <Inbox className="h-3 w-3 mr-1" /> Inbox
                          </Button>
                        )}
                      </div>
                      {emailFolder !== "inbox" && (
                        <p className="text-[10px] text-muted-foreground px-1">
                          Folder: {mailFolders.find(f => f.id === emailFolder)?.displayName || emailFolder}
                        </p>
                      )}
                      {inboxEmailsLoading ? (
                        <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                      ) : inboxEmails.length === 0 ? (
                        <div className="text-center py-4" data-testid="inbox-empty">
                          <Mail className="h-6 w-6 text-muted-foreground/20 mx-auto mb-1" />
                          <p className="text-xs text-muted-foreground">{emailInboxSearch ? "No emails found" : "No emails in this folder."}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">Connect Outlook in <Link href="/my-tool/settings" className="text-primary hover:underline">Settings</Link></p>
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-[400px] overflow-y-auto" data-testid="inbox-email-list">
                          {inboxEmails.map(email => (
                            <div
                              key={email.id}
                              draggable
                              onDragStart={(e) => { e.dataTransfer.setData("application/json", JSON.stringify(email)); e.dataTransfer.effectAllowed = "copy"; }}
                              className={`px-2.5 py-2 rounded-md border border-border/50 hover:bg-muted/30 cursor-pointer transition-colors group/email ${!email.isRead ? "bg-blue-50/30 dark:bg-blue-950/10 border-blue-200/30" : ""}`}
                              onClick={() => { setEmailDetailId(email.id); setReplyMode(null); setReplyText(""); }}
                              data-testid={`inbox-email-${email.id}`}
                            >
                              <div className="flex items-start gap-2">
                                <Mail className={`h-3 w-3 mt-0.5 shrink-0 ${!email.isRead ? "text-blue-600" : "text-muted-foreground/40"}`} />
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs truncate ${!email.isRead ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>{email.subject || "(No subject)"}</p>
                                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <span className="truncate">{email.sender || email.senderEmail || "Unknown"}</span>
                                    <span>·</span>
                                    <span className="shrink-0">{email.receivedAt ? format(new Date(email.receivedAt), "d MMM") : ""}</span>
                                    {email.hasAttachments && <Paperclip className="h-2.5 w-2.5 ml-0.5 shrink-0" />}
                                  </div>
                                  {email.snippet && <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">{email.snippet}</p>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>

            {/* Company Priorities */}
            <section className="border border-border/50 rounded-lg" data-testid="card-company-priorities">
              <div className="flex items-center justify-between px-4 py-3">
                <button className="flex items-center gap-2" onClick={() => setPrioritiesOpen(!prioritiesOpen)} data-testid="toggle-company-priorities">
                  {prioritiesOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <Flag className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">Priorities</span>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">{activePriorities.length + escalatedItems.length}</Badge>
                </button>
                <div className="flex items-center gap-1">
                  <select value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)} className="text-[11px] border border-border rounded px-1.5 py-0.5 bg-background" data-testid="select-horizon">
                    <option value="today">Today</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                    <option value="quarter">Quarter</option>
                  </select>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setAddPriorityOpen(!addPriorityOpen)} data-testid="button-add-priority">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {prioritiesOpen && (
                <div className="px-4 pb-4 space-y-1.5">
                  {addPriorityOpen && (
                    <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2 mb-2" data-testid="add-priority-form">
                      <Input placeholder="Priority title..." value={newPriority.title} onChange={(e) => setNewPriority(p => ({ ...p, title: e.target.value }))} className="h-8 text-xs" data-testid="input-priority-title" onKeyDown={(e) => { if (e.key === "Enter" && newPriority.title.trim()) createPriorityMutation.mutate({ title: newPriority.title.trim(), department: newPriority.department || null, severity: newPriority.severity, horizon, linkedProjectName: newPriority.linkedProjectName || null, status: "active" }); }} />
                      <div className="flex gap-2">
                        <select value={newPriority.severity} onChange={(e) => setNewPriority(p => ({ ...p, severity: e.target.value }))} className="h-7 text-[11px] border border-border rounded px-1.5 bg-background flex-1" data-testid="select-priority-severity">
                          <option value="normal">Normal</option>
                          <option value="important">Important</option>
                          <option value="critical">Critical</option>
                        </select>
                        <select value={newPriority.department} onChange={(e) => setNewPriority(p => ({ ...p, department: e.target.value }))} className="h-7 text-[11px] border border-border rounded px-1.5 bg-background flex-1" data-testid="select-priority-department">
                          <option value="">Dept...</option>
                          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setAddPriorityOpen(false); setNewPriority({ title: "", department: "", severity: "normal", linkedProjectName: "" }); }}>Cancel</Button>
                        <Button size="sm" className="h-7 text-xs" onClick={() => createPriorityMutation.mutate({ title: newPriority.title.trim(), department: newPriority.department || null, severity: newPriority.severity, horizon, linkedProjectName: newPriority.linkedProjectName || null, status: "active" })} disabled={!newPriority.title.trim()} data-testid="button-save-priority">Add</Button>
                      </div>
                    </div>
                  )}

                  {escalatedItems.map(item => (
                    <div key={item.id} className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-destructive/5 border border-destructive/20" data-testid={`escalated-item-${item.id}`}>
                      <Flag className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{item.title}</p>
                        <span className="text-[10px] text-red-600 uppercase">{item.type}</span>
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => setLocation(`/project/${encodeURIComponent(item.projectName)}`)}>
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}

                  {activePriorities.map(p => (
                    <div key={p.id} className="flex items-start gap-2 px-2.5 py-2 rounded-md border border-border/50 hover:bg-muted/30 transition-colors group" data-testid={`priority-item-${p.id}`}>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${p.severity === "critical" ? "bg-red-500" : p.severity === "important" ? "bg-amber-500" : "bg-blue-500"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{p.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <select value={p.status} onChange={(e) => updatePriorityMutation.mutate({ id: p.id, status: e.target.value })} className="text-[10px] uppercase tracking-wider px-1 py-0 rounded bg-transparent border-0 cursor-pointer text-muted-foreground" data-testid={`select-priority-status-${p.id}`}>
                            <option value="active">Active</option>
                            <option value="monitoring">Monitoring</option>
                            <option value="closed">Closed</option>
                          </select>
                          {p.department && <span className="text-[10px] text-indigo-600">{p.department}</span>}
                        </div>
                      </div>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-primary" onClick={() => createTaskMutation.mutate({ title: p.title, status: "planned", plannedForDate: today, priority: p.severity === "critical" ? "critical" : p.severity === "important" ? "high" : "normal", projectName: p.linkedProjectName })} title="Create task" data-testid={`button-convert-task-${p.id}`}>
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => deletePriorityMutation.mutate(p.id)} data-testid={`button-delete-priority-${p.id}`}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {activePriorities.length === 0 && escalatedItems.length === 0 && !addPriorityOpen && (
                    <p className="text-xs text-muted-foreground text-center py-3" data-testid="empty-priorities">No priorities set.</p>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* DoD Prompt Modal */}
      {dodPromptTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="dod-prompt-overlay">
          <div className="bg-background rounded-lg shadow-lg p-6 max-w-sm w-full mx-4 space-y-4" data-testid="dod-prompt-modal">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Can't close yet</h3>
              <p className="text-xs text-muted-foreground">Add a Definition of Done to close "{dodPromptTask.title}" 100%.</p>
            </div>
            <Textarea
              value={dodPromptText}
              onChange={(e) => setDodPromptText(e.target.value)}
              placeholder="What does 'done done' look like?"
              className="text-sm min-h-[60px]"
              autoFocus
              data-testid="textarea-dod-prompt"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setDodPromptTask(null); setDodPromptText(""); }}>Cancel</Button>
              <Button size="sm" onClick={handleDodPromptSave} disabled={!dodPromptText.trim() || updateTaskMutation.isPending} data-testid="button-dod-prompt-save">
                {updateTaskMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Mark Done
              </Button>
            </div>
          </div>
        </div>
      )}

      <TaskDetailDrawer
        task={drawerTask}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onInvalidate={invalidateAll}
      />
    </MyToolLayout>
  );
}
