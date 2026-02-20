import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
import CooLens from "@/components/mytool/CooLens";
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
  ListPlus,
  Trash2,
  Edit,
  Settings,
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

function parseQuickAdd(text: string): { title: string; priority?: string; project?: string; department?: string; dueAt?: string; plannedForDate?: string; owner?: string } {
  let title = text;
  let priority: string | undefined;
  let project: string | undefined;
  let department: string | undefined;
  let dueAt: string | undefined;
  let owner: string | undefined;
  let plannedForDate = today;

  const prefix = title.match(/^([tpe])\s+/i);
  if (prefix) {
    title = title.slice(prefix[0].length);
  }

  const p1Match = title.match(/\bp1\b/i);
  const p2Match = title.match(/\bp2\b/i);
  const p3Match = title.match(/\bp3\b/i);
  const p4Match = title.match(/\bp4\b/i);
  if (p1Match) { priority = "critical"; title = title.replace(p1Match[0], "").trim(); }
  else if (p2Match) { priority = "high"; title = title.replace(p2Match[0], "").trim(); }
  else if (p3Match) { priority = "normal"; title = title.replace(p3Match[0], "").trim(); }
  else if (p4Match) { priority = "low"; title = title.replace(p4Match[0], "").trim(); }

  const projectMatch = title.match(/#project:([^\s]+)/i);
  if (projectMatch) {
    project = projectMatch[1].replace(/_/g, " ");
    title = title.replace(projectMatch[0], "").trim();
  } else {
    const hashMatch = title.match(/#(\w+)/);
    if (hashMatch) {
      const dept = DEPARTMENTS.find(d => d.toLowerCase().startsWith(hashMatch[1].toLowerCase()));
      if (dept) { department = dept; title = title.replace(hashMatch[0], "").trim(); }
    }
  }

  const dueMatch = title.match(/\bdue:(\S+)/i);
  if (dueMatch) {
    const val = dueMatch[1].toLowerCase();
    title = title.replace(dueMatch[0], "").trim();
    if (val === "today") {
      dueAt = today;
    } else if (val === "tomorrow") {
      dueAt = format(addDays(new Date(), 1), "yyyy-MM-dd");
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      dueAt = val;
    }
  }

  const ownerMatch = title.match(/\bowner:(\S+)/i);
  if (ownerMatch) {
    owner = ownerMatch[1].replace(/_/g, " ");
    title = title.replace(ownerMatch[0], "").trim();
  }

  const deptMatch = title.match(/\bdept:(\S+)/i);
  if (deptMatch && !department) {
    const dept = DEPARTMENTS.find(d => d.toLowerCase().startsWith(deptMatch[1].toLowerCase()));
    if (dept) department = dept;
    title = title.replace(deptMatch[0], "").trim();
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
  return { title, priority, project, department, dueAt, plannedForDate, owner };
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
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editBlockStart, setEditBlockStart] = useState("");
  const [editBlockEnd, setEditBlockEnd] = useState("");
  const [resizingBlock, setResizingBlock] = useState<{ id: number; edge: "top" | "bottom"; startY: number; origStartMins: number; origEndMins: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: number; startMins: number; endMins: number } | null>(null);
  const plannerContainerRef = useRef<HTMLDivElement | null>(null);
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem("mytool_focus_mode") === "true");
  const [contextSelection, setContextSelection] = useState<{ type: "task" | "email" | "priority"; id: string | number } | null>(null);
  const [emailConvertForm, setEmailConvertForm] = useState<{ email: OutlookEmail; title: string; project: string; module: string; dueAt: string; priority: string } | null>(null);
  const [bundleWizard, setBundleWizard] = useState<{ priority: CompanyPriority; tasks: Array<{ title: string; owner: string; dueAt: string }> } | null>(null);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"tasks" | "planner" | "email">("tasks");
  const [windowWidth, setWindowWidth] = useState(() => typeof window !== "undefined" ? window.innerWidth : 1400);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isCompact = windowWidth < 1200;
  const isMobile = windowWidth < 900;

  useEffect(() => {
    const handler = () => setFocusMode(localStorage.getItem("mytool_focus_mode") === "true");
    window.addEventListener("storage", handler);
    const interval = setInterval(handler, 500);
    return () => { window.removeEventListener("storage", handler); clearInterval(interval); };
  }, []);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<TaskItem[]>({
    queryKey: [`/api/mytool/tasks?date=${today}`],
    select: (data: any[]) => data.map((t: any) => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority,
      plannedForDate: t.plannedForDate || t.planned_for_date || null,
      dueAt: t.dueAt || t.due_at || null,
      sortOrder: t.sortOrder || t.sort_order || 0,
      bucket: t.bucket || null,
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
      const headers: Record<string, string> = {};
      const token = localStorage.getItem('auth_token');
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/outlook/events?start=${today}&end=${today}`, { credentials: "include", headers });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.filter((e: CalendarEvent) => !e.isCancelled) : [];
    },
  });

  const { data: meetingImportStatus } = useQuery<{
    connected: boolean;
    totalMeetings: number;
    webhookMeetings: number;
    lastWebhookAt: string | null;
    totalActionItems: number;
    pendingItems: number;
    convertedItems: number;
  }>({
    queryKey: ["/api/meetings/webhook-status"],
    refetchInterval: 120_000,
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
      const hdrs: Record<string, string> = {};
      const tk = localStorage.getItem('auth_token');
      if (tk) hdrs["Authorization"] = `Bearer ${tk}`;
      const res = await fetch(`/api/outlook/messages?${params.toString()}`, { credentials: "include", headers: hdrs });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.value || [];
    },
  });

  const { data: mailFolders = [] } = useQuery<MailFolder[]>({
    queryKey: ["/api/outlook/folders"],
    queryFn: async () => {
      const fh: Record<string, string> = {};
      const ft = localStorage.getItem('auth_token');
      if (ft) fh["Authorization"] = `Bearer ${ft}`;
      const res = await fetch("/api/outlook/folders", { credentials: "include", headers: fh });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: emailDetail, isLoading: emailDetailLoading } = useQuery<EmailDetail>({
    queryKey: ["/api/outlook/messages", emailDetailId],
    queryFn: async () => {
      const dh: Record<string, string> = {};
      const dt = localStorage.getItem('auth_token');
      if (dt) dh["Authorization"] = `Bearer ${dt}`;
      const res = await fetch(`/api/outlook/messages/${emailDetailId}`, { credentials: "include", headers: dh });
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

  const updateBlockMutation = useMutation({
    mutationFn: async ({ id, ...body }: { id: number } & Record<string, unknown>) => apiRequest("PATCH", `/api/mytool/timeblocks/${id}`, body),
    onSuccess: () => { invalidateAll(); setEditingBlockId(null); },
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
    if (parsed.prefix === "p") {
      createPriorityMutation.mutate({
        title: parsed.title,
        department: parsed.department || null,
        severity: parsed.priority === "critical" ? "critical" : parsed.priority === "high" ? "important" : "normal",
        horizon,
        linkedProjectName: parsed.project || null,
        status: "active",
      });
    } else {
      createTaskMutation.mutate({
        title: parsed.title,
        status: "planned",
        plannedForDate: parsed.plannedForDate || today,
        priority: parsed.priority || "normal",
        department: parsed.department || null,
        projectName: parsed.project || null,
        dueAt: parsed.dueAt || null,
      });
    }
    setQuickAddText("");
  }, [quickAddText, horizon]);

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

  const handleEmailConvertOpen = (email: OutlookEmail) => {
    setEmailConvertForm({
      email,
      title: email.subject || "(No subject)",
      project: "",
      module: "",
      dueAt: "",
      priority: "normal",
    });
  };

  const handleEmailConvertSubmit = async () => {
    if (!emailConvertForm) return;
    const { email, title, project, module, dueAt, priority } = emailConvertForm;
    try {
      await apiRequest("POST", "/api/mytool/tasks", {
        title,
        status: "planned",
        plannedForDate: today,
        priority,
        projectName: project || null,
        department: module || null,
        dueAt: dueAt || null,
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
      setEmailConvertForm(null);
      toast({ title: "Task created from email", description: "Open task in your list" });
    } catch {
      toast({ title: "Failed to create task", variant: "destructive" });
    }
  };

  const handleBundleOpen = (p: CompanyPriority) => {
    const suggestedTasks = [
      { title: `Review: ${p.title}`, owner: "", dueAt: "" },
      { title: `Plan approach for: ${p.title}`, owner: "", dueAt: "" },
      { title: `Execute: ${p.title}`, owner: "", dueAt: "" },
    ];
    setBundleWizard({ priority: p, tasks: suggestedTasks });
  };

  const handleBundleSubmit = async () => {
    if (!bundleWizard) return;
    try {
      for (const t of bundleWizard.tasks) {
        if (!t.title.trim()) continue;
        await apiRequest("POST", "/api/mytool/tasks", {
          title: t.title.trim(),
          status: "planned",
          plannedForDate: today,
          priority: bundleWizard.priority.severity === "critical" ? "critical" : bundleWizard.priority.severity === "important" ? "high" : "normal",
          projectName: bundleWizard.priority.linkedProjectName || null,
          department: bundleWizard.priority.department || null,
          dueAt: t.dueAt || null,
          notes: `From priority: ${bundleWizard.priority.title}`,
        });
      }
      invalidateAll();
      setBundleWizard(null);
      toast({ title: `${bundleWizard.tasks.filter(t => t.title.trim()).length} tasks created from priority` });
    } catch {
      toast({ title: "Failed to create tasks", variant: "destructive" });
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

  const SLOT_HEIGHT_CONST = 48;
  const handleResizeStart = useCallback((e: React.MouseEvent, blockId: number, edge: "top" | "bottom", startMins: number, endMins: number) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingBlock({ id: blockId, edge, startY: e.clientY, origStartMins: startMins, origEndMins: endMins });
    setResizePreview({ id: blockId, startMins, endMins });
  }, []);

  useEffect(() => {
    if (!resizingBlock) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizingBlock.startY;
      const deltaMins = Math.round((deltaY / SLOT_HEIGHT_CONST) * 60 / 15) * 15;
      let newStart = resizingBlock.origStartMins;
      let newEnd = resizingBlock.origEndMins;
      if (resizingBlock.edge === "bottom") {
        newEnd = Math.max(resizingBlock.origStartMins + 15, resizingBlock.origEndMins + deltaMins);
        newEnd = Math.min(newEnd, plannerEndHour * 60);
      } else {
        newStart = Math.min(resizingBlock.origEndMins - 15, resizingBlock.origStartMins + deltaMins);
        newStart = Math.max(newStart, plannerStartHour * 60);
      }
      setResizePreview({ id: resizingBlock.id, startMins: newStart, endMins: newEnd });
    };
    const handleMouseUp = () => {
      if (resizePreview && resizingBlock) {
        const startH = Math.floor(resizePreview.startMins / 60);
        const startM = resizePreview.startMins % 60;
        const endH = Math.floor(resizePreview.endMins / 60);
        const endM = resizePreview.endMins % 60;
        const newStartTime = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;
        const newEndTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
        updateBlockMutation.mutate({ id: resizingBlock.id, startTime: newStartTime, endTime: newEndTime });
      }
      setResizingBlock(null);
      setResizePreview(null);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingBlock, resizePreview, plannerEndHour, plannerStartHour, updateBlockMutation]);

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
      <MyToolLayout onQuickAdd={handleQuickAdd} onTaskSelect={(taskId) => {
        const t = tasks.find(tk => tk.id === taskId);
        if (t) { setDrawerTask(t); setDrawerOpen(true); setContextSelection({ type: "task", id: taskId }); }
      }}>
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
    <MyToolLayout onQuickAdd={handleQuickAdd} onTaskSelect={(taskId) => {
      const t = tasks.find(tk => tk.id === taskId);
      if (t) { setDrawerTask(t); setDrawerOpen(true); setContextSelection({ type: "task", id: taskId }); }
    }}>
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

        {/* Mobile Tab Bar */}
        {isMobile && (
          <div className="flex gap-1 mb-3 bg-muted/50 rounded-lg p-1" data-testid="mobile-tab-bar">
            {(["tasks", "planner", "email"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setMobileTab(tab)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mobileTab === tab ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-testid={`mobile-tab-${tab}`}
              >
                {tab === "tasks" ? "Tasks" : tab === "planner" ? "Planner" : "Email"}
              </button>
            ))}
          </div>
        )}

        {/* Context Drawer Toggle (compact mode, not mobile) */}
        {isCompact && !isMobile && !focusMode && (
          <div className="flex justify-end mb-2">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setContextDrawerOpen(true)} data-testid="button-open-context-drawer">
              <Mail className="h-3 w-3" />
              Email & Context
            </Button>
          </div>
        )}

        {/* Three-column layout */}
        <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : isCompact ? "grid-cols-2" : "grid-cols-1 lg:grid-cols-12"}`}>

          {/* LEFT COLUMN: Open Tasks & Projects */}
          <div className={`${isCompact ? "col-span-1" : focusMode ? "lg:col-span-4" : "lg:col-span-3"} space-y-3 ${isMobile && mobileTab !== "tasks" ? "hidden" : ""}`} data-testid="column-tasks">
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
                                    onClick={() => { setDrawerTask(task); setDrawerOpen(true); setContextSelection({ type: "task", id: task.id }); }}
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
                                <span className="flex-1 truncate line-through cursor-pointer hover:text-foreground" onClick={() => { setDrawerTask(task); setDrawerOpen(true); setContextSelection({ type: "task", id: task.id }); }}>{task.title}</span>
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
          <div className={`${isCompact ? "col-span-1" : focusMode ? "lg:col-span-8" : "lg:col-span-5"} space-y-3 ${isMobile && mobileTab !== "planner" ? "hidden" : ""}`} data-testid="column-planner">
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

                      {/* Calendar events & time blocks — per-cluster overlap layout */}
                      {(() => {
                        type PlannerItem = { type: "event"; data: typeof timedEvents[0]; startMins: number; endMins: number } | { type: "block"; data: typeof sortedBlocks[0]; startMins: number; endMins: number };
                        const allItems: PlannerItem[] = [
                          ...timedEvents.map(e => ({ type: "event" as const, data: e, startMins: eventToMinutes(e.start), endMins: eventToMinutes(e.end) })),
                          ...sortedBlocks.map(b => ({ type: "block" as const, data: b, startMins: timeToMinutes(b.startTime), endMins: timeToMinutes(b.endTime) })),
                        ].sort((a, b) => a.startMins - b.startMins || a.endMins - b.endMins);

                        const clusters: PlannerItem[][] = [];
                        let clusterEnd = -1;
                        allItems.forEach(item => {
                          if (item.startMins >= clusterEnd) {
                            clusters.push([item]);
                            clusterEnd = item.endMins;
                          } else {
                            clusters[clusters.length - 1].push(item);
                            clusterEnd = Math.max(clusterEnd, item.endMins);
                          }
                        });

                        type Positioned = PlannerItem & { col: number; totalCols: number };
                        const positioned: Positioned[] = [];
                        clusters.forEach(cluster => {
                          const cols: PlannerItem[][] = [];
                          cluster.forEach(item => {
                            let placed = false;
                            for (const col of cols) {
                              if (col[col.length - 1].endMins <= item.startMins) {
                                col.push(item);
                                placed = true;
                                break;
                              }
                            }
                            if (!placed) cols.push([item]);
                          });
                          const totalCols = cols.length;
                          cols.forEach((col, colIdx) => {
                            col.forEach(item => positioned.push({ ...item, col: colIdx, totalCols }));
                          });
                        });

                        return positioned.map(item => {
                          const top = minToTop(item.startMins);
                          const height = minToHeight(item.startMins, item.endMins);
                          const isSingle = item.totalCols === 1;
                          const colWidth = isSingle ? undefined : `calc((100% - 44px) / ${item.totalCols} - 2px)`;
                          const colLeft = `calc(40px + ${item.col} * ((100% - 44px) / ${item.totalCols}))`;

                          if (item.type === "event") {
                            const evt = item.data;
                            const startFmt = `${String(Math.floor(item.startMins / 60)).padStart(2, "0")}:${String(item.startMins % 60).padStart(2, "0")}`;
                            const endFmt = `${String(Math.floor(item.endMins / 60)).padStart(2, "0")}:${String(item.endMins % 60).padStart(2, "0")}`;
                            return (
                              <div
                                key={`evt-${evt.id}`}
                                className="absolute z-10 rounded-md bg-blue-100/80 dark:bg-blue-900/30 border border-blue-300/60 dark:border-blue-700/40 px-2 py-1 overflow-hidden cursor-default"
                                style={{ top, height: Math.max(height, 20), left: colLeft, width: colWidth, right: isSingle ? "4px" : undefined }}
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
                          } else {
                            const block = item.data;
                            const linkedTask = block.taskId ? tasks.find(t => t.id === block.taskId) : null;
                            const isEditing = editingBlockId === block.id;
                            const isResizing = resizePreview?.id === block.id;
                            const displayTop = isResizing ? minToTop(resizePreview!.startMins) : top;
                            const displayHeight = isResizing ? minToHeight(resizePreview!.startMins, resizePreview!.endMins) : height;
                            const displayStartFmt = isResizing ? `${String(Math.floor(resizePreview!.startMins / 60)).padStart(2, "0")}:${String(resizePreview!.startMins % 60).padStart(2, "0")}` : block.startTime;
                            const displayEndFmt = isResizing ? `${String(Math.floor(resizePreview!.endMins / 60)).padStart(2, "0")}:${String(resizePreview!.endMins % 60).padStart(2, "0")}` : block.endTime;
                            return (
                              <div
                                key={`blk-${block.id}`}
                                className={`absolute z-20 rounded-md bg-violet-100/80 dark:bg-violet-900/30 border border-violet-300/60 dark:border-violet-700/40 px-2 py-1 overflow-hidden group/block ${isResizing ? "ring-2 ring-violet-400/60 shadow-lg" : ""}`}
                                style={{ top: displayTop, height: Math.max(displayHeight, 20), left: colLeft, width: colWidth, right: isSingle ? "4px" : undefined, userSelect: isResizing ? "none" : undefined }}
                                title={`${block.label}\n${displayStartFmt} – ${displayEndFmt}`}
                                data-testid={`timeblock-${block.id}`}
                              >
                                {/* Top resize handle */}
                                {!isEditing && (
                                  <div
                                    className="absolute top-0 left-0 right-0 h-2 cursor-n-resize z-30 hover:bg-violet-400/20 transition-colors"
                                    onMouseDown={(e) => handleResizeStart(e, block.id, "top", item.startMins, item.endMins)}
                                    data-testid={`resize-top-${block.id}`}
                                  >
                                    <div className="absolute top-0.5 left-1/2 -translate-x-1/2 w-6 h-[2px] rounded bg-violet-400/0 group-hover/block:bg-violet-400/60 transition-colors" />
                                  </div>
                                )}
                                {isEditing ? (
                                  <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                                    <div className="flex gap-1">
                                      <input type="time" value={editBlockStart} onChange={e => setEditBlockStart(e.target.value)} className="text-[10px] h-5 w-[70px] border border-violet-300 rounded px-1 bg-background" data-testid={`input-edit-block-start-${block.id}`} />
                                      <span className="text-[10px] text-violet-500">–</span>
                                      <input type="time" value={editBlockEnd} onChange={e => setEditBlockEnd(e.target.value)} className="text-[10px] h-5 w-[70px] border border-violet-300 rounded px-1 bg-background" data-testid={`input-edit-block-end-${block.id}`} />
                                    </div>
                                    <div className="flex gap-1 justify-end">
                                      <Button variant="ghost" size="sm" className="h-4 px-1 text-[9px]" onClick={() => setEditingBlockId(null)}>Cancel</Button>
                                      <Button size="sm" className="h-4 px-1.5 text-[9px]" onClick={() => updateBlockMutation.mutate({ id: block.id, startTime: editBlockStart, endTime: editBlockEnd })} disabled={!editBlockStart || !editBlockEnd} data-testid={`button-save-edit-block-${block.id}`}>Save</Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-start gap-1">
                                    <Clock className="h-3 w-3 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[11px] font-medium text-violet-800 dark:text-violet-200 truncate leading-tight">{block.label}</p>
                                      <p className="text-[9px] text-violet-600 dark:text-violet-400">{displayStartFmt} – {displayEndFmt}</p>
                                      {linkedTask && displayHeight > 35 && (
                                        <p className="text-[9px] text-violet-500 truncate mt-0.5">
                                          <span className={`inline-block w-1 h-1 rounded-full mr-0.5 ${linkedTask.status === "done" ? "bg-emerald-500" : linkedTask.status === "in_progress" ? "bg-amber-500" : "bg-blue-500"}`} />
                                          {linkedTask.title}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex flex-col gap-0.5 opacity-0 group-hover/block:opacity-100 shrink-0">
                                      <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-violet-400 hover:text-violet-600" onClick={(e) => { e.stopPropagation(); setEditingBlockId(block.id); setEditBlockStart(block.startTime); setEditBlockEnd(block.endTime); }} data-testid={`button-edit-block-${block.id}`}>
                                        <Edit className="h-2.5 w-2.5" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-violet-400 hover:text-destructive" onClick={(e) => { e.stopPropagation(); deleteBlockMutation.mutate(block.id); }} data-testid={`button-delete-block-${block.id}`}>
                                        <Trash2 className="h-2.5 w-2.5" />
                                      </Button>
                                    </div>
                                  </div>
                                )}
                                {/* Bottom resize handle */}
                                {!isEditing && (
                                  <div
                                    className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize z-30 hover:bg-violet-400/20 transition-colors"
                                    onMouseDown={(e) => handleResizeStart(e, block.id, "bottom", item.startMins, item.endMins)}
                                    data-testid={`resize-bottom-${block.id}`}
                                  >
                                    <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-6 h-[2px] rounded bg-violet-400/0 group-hover/block:bg-violet-400/60 transition-colors" />
                                  </div>
                                )}
                              </div>
                            );
                          }
                        });
                      })()}
                    </div>
                  );
                })()}
              </div>

              {/* Legend + Meeting Import Status */}
              <div className="flex items-center justify-between px-4 pb-3 border-t border-border/30 pt-2">
                <div className="flex items-center gap-4">
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
                {meetingImportStatus && (
                  <Link href="/my-tool/meetings" data-testid="link-meeting-import-status">
                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] cursor-pointer transition-colors ${
                      meetingImportStatus.connected 
                        ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200' 
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200'
                    }`}>
                      {meetingImportStatus.connected ? (
                        <>
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                          </span>
                          Read.ai {meetingImportStatus.pendingItems > 0 ? `· ${meetingImportStatus.pendingItems} pending` : '· synced'}
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300"></span>
                          Read.ai · not connected
                        </>
                      )}
                    </div>
                  </Link>
                )}
              </div>
            </section>
          </div>

          {/* RIGHT COLUMN: Email & Priorities */}
          <div className={`lg:col-span-4 space-y-3 ${(isMobile && mobileTab === "email") ? "" : (focusMode || isCompact) ? "hidden" : ""}`} data-testid="column-context">
            {/* COO Lens */}
            <section className="border border-border/50 rounded-lg py-2" data-testid="card-coo-lens">
              <CooLens />
            </section>

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
                              onClick={() => { setEmailDetailId(email.id); setReplyMode(null); setReplyText(""); setContextSelection({ type: "email", id: email.id }); }}
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
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 opacity-0 group-hover/email:opacity-100 shrink-0 text-muted-foreground hover:text-primary"
                                  title="Quick add as task"
                                  onClick={(e) => { e.stopPropagation(); handleDropEmail(email); }}
                                  data-testid={`button-email-to-task-${email.id}`}
                                >
                                  <ListPlus className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 opacity-0 group-hover/email:opacity-100 shrink-0 text-muted-foreground hover:text-blue-600"
                                  title="Add as task with details"
                                  onClick={(e) => { e.stopPropagation(); handleEmailConvertOpen(email); }}
                                  data-testid={`button-email-convert-${email.id}`}
                                >
                                  <Settings className="h-3 w-3" />
                                </Button>
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
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-blue-600" onClick={() => handleBundleOpen(p)} title="Break into tasks" data-testid={`button-bundle-priority-${p.id}`}>
                          <ListPlus className="h-3 w-3" />
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

      {/* Context Drawer (compact/mobile screens) */}
      {isCompact && contextDrawerOpen && (
        <div className="fixed inset-0 z-40" data-testid="context-drawer-overlay">
          <div className="absolute inset-0 bg-black/30" onClick={() => setContextDrawerOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-[380px] max-w-[90vw] bg-background border-l border-border shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 sticky top-0 bg-background z-10">
              <span className="text-sm font-semibold">Email & Context</span>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setContextDrawerOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-3 space-y-3">
              <section className="border border-border/50 rounded-lg py-2">
                <CooLens />
              </section>
              <section className="border border-border/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Mail className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium">Email</span>
                </div>
                {emailsLoading ? (
                  <div className="flex items-center gap-2 py-4 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-xs text-muted-foreground">Loading...</span>
                  </div>
                ) : emails.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">No emails found</p>
                ) : (
                  <div className="space-y-1">
                    {emails.slice(0, 10).map(email => (
                      <div key={email.id} className="flex items-start gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer group/email" onClick={() => { setEmailDetailId(email.id); setContextDrawerOpen(false); }}>
                        <Mail className={`h-3 w-3 mt-0.5 shrink-0 ${!email.isRead ? "text-blue-600" : "text-muted-foreground/40"}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs truncate ${!email.isRead ? "font-semibold" : "font-medium text-foreground/80"}`}>{email.subject || "(No subject)"}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{email.sender || email.senderEmail}</p>
                        </div>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover/email:opacity-100 shrink-0" onClick={(e) => { e.stopPropagation(); handleEmailConvertOpen(email); }}>
                          <ListPlus className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

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

      {/* Email → Task Conversion Form */}
      {emailConvertForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="email-convert-overlay">
          <div className="bg-background rounded-lg shadow-lg p-6 max-w-md w-full mx-4 space-y-4" data-testid="email-convert-modal">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Create Task from Email</h3>
              <p className="text-[11px] text-muted-foreground">From: {emailConvertForm.email.sender || emailConvertForm.email.senderEmail}</p>
            </div>
            <div className="space-y-3">
              <Input
                value={emailConvertForm.title}
                onChange={(e) => setEmailConvertForm(f => f ? { ...f, title: e.target.value } : f)}
                placeholder="Task title"
                className="h-8 text-sm"
                autoFocus
                data-testid="input-email-convert-title"
              />
              <div className="flex gap-2">
                <select
                  value={emailConvertForm.project}
                  onChange={(e) => setEmailConvertForm(f => f ? { ...f, project: e.target.value } : f)}
                  className="flex-1 h-8 text-xs border border-border rounded px-2 bg-background"
                  data-testid="select-email-convert-project"
                >
                  <option value="">Project (optional)</option>
                  {allProjects.map(p => (
                    <option key={p.project_name} value={p.project_name}>
                      {p.project_name.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <select
                  value={emailConvertForm.module}
                  onChange={(e) => setEmailConvertForm(f => f ? { ...f, module: e.target.value } : f)}
                  className="flex-1 h-8 text-xs border border-border rounded px-2 bg-background"
                  data-testid="select-email-convert-module"
                >
                  <option value="">Module</option>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <select
                  value={emailConvertForm.priority}
                  onChange={(e) => setEmailConvertForm(f => f ? { ...f, priority: e.target.value } : f)}
                  className="flex-1 h-8 text-xs border border-border rounded px-2 bg-background"
                  data-testid="select-email-convert-priority"
                >
                  <option value="normal">P3 — Normal</option>
                  <option value="critical">P1 — Critical</option>
                  <option value="high">P2 — High</option>
                  <option value="low">P4 — Low</option>
                </select>
                <Input
                  type="date"
                  value={emailConvertForm.dueAt}
                  onChange={(e) => setEmailConvertForm(f => f ? { ...f, dueAt: e.target.value } : f)}
                  className="flex-1 h-8 text-xs"
                  data-testid="input-email-convert-due"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEmailConvertForm(null)}>Cancel</Button>
              <Button size="sm" onClick={handleEmailConvertSubmit} disabled={!emailConvertForm.title.trim()} data-testid="button-email-convert-submit">
                <Plus className="h-3 w-3 mr-1" />
                Create Task
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Priority → Task Bundle Wizard */}
      {bundleWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="bundle-wizard-overlay">
          <div className="bg-background rounded-lg shadow-lg p-6 max-w-lg w-full mx-4 space-y-4" data-testid="bundle-wizard-modal">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Break into Tasks</h3>
              <p className="text-[11px] text-muted-foreground">Priority: {bundleWizard.priority.title}</p>
            </div>
            <div className="space-y-2">
              {bundleWizard.tasks.map((t, i) => (
                <div key={i} className="flex items-center gap-2" data-testid={`bundle-task-${i}`}>
                  <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                  <Input
                    value={t.title}
                    onChange={(e) => setBundleWizard(w => {
                      if (!w) return w;
                      const tasks = [...w.tasks];
                      tasks[i] = { ...tasks[i], title: e.target.value };
                      return { ...w, tasks };
                    })}
                    className="flex-1 h-7 text-xs"
                    placeholder="Task title"
                    data-testid={`input-bundle-title-${i}`}
                  />
                  <Input
                    type="date"
                    value={t.dueAt}
                    onChange={(e) => setBundleWizard(w => {
                      if (!w) return w;
                      const tasks = [...w.tasks];
                      tasks[i] = { ...tasks[i], dueAt: e.target.value };
                      return { ...w, tasks };
                    })}
                    className="w-32 h-7 text-xs"
                    data-testid={`input-bundle-due-${i}`}
                  />
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setBundleWizard(w => {
                      if (!w) return w;
                      return { ...w, tasks: w.tasks.filter((_, j) => j !== i) };
                    })}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline" size="sm"
                className="w-full h-7 text-xs"
                onClick={() => setBundleWizard(w => {
                  if (!w) return w;
                  return { ...w, tasks: [...w.tasks, { title: "", owner: "", dueAt: "" }] };
                })}
                data-testid="button-bundle-add-task"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add another task
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setBundleWizard(null)}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleBundleSubmit}
                disabled={bundleWizard.tasks.filter(t => t.title.trim()).length === 0}
                data-testid="button-bundle-submit"
              >
                <Plus className="h-3 w-3 mr-1" />
                Create {bundleWizard.tasks.filter(t => t.title.trim()).length} Tasks
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
