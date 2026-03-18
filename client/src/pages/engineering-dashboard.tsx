import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { TASK_PRIORITIES } from "@shared/schema";
import { TASK_STATUSES, getTaskStatusBadgeClass, getTaskStatusBarClass, getTaskStatusLabel, isTaskComplete } from "@shared/task-status";
import { bucketEngineeringStandupTasks } from "@shared/engineering-standup";
import {
  AlertTriangle,
  Wrench,
  Calendar,
  ChevronDown,
  ChevronRight,
  Loader2,
  User,
  Clock,
  CheckCircle2,
  PauseCircle,
  ListTodo,
  TrendingUp,
  Layers,
  ShieldAlert,
  Zap,
  Users,
  ArrowUpRight,
  Timer,
  Flag,
  Target,
  ExternalLink,
  UserCheck,
  Eye,
  LayoutGrid,
  Send,
  Edit3,
  MessageSquare,
  Activity,
  ArrowLeft,
  X,
  MoreHorizontal,
  ArrowRightLeft,
} from "lucide-react";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";

async function engFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface StandupTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignees: string[] | null;
  trackingRag: string | null;
  projectName: string;
  holdReason: string | null;
  blockerReason: string | null;
  completedAt: string | null;
  taskTypeTag: string | null;
}

interface ProjectHealth {
  projectName: string;
  displayName: string;
  phase: string;
  phaseLabel: string;
  total: number;
  completed: number;
  active: number;
  hold: number;
  overdue: number;
  dueThisWeek: number;
  completion: number;
  rag: "GREEN" | "AMBER" | "RED";
}

interface WorkloadEntry {
  name: string;
  active: number;
  overdue: number;
  hold: number;
  dueThisWeek: number;
}

interface StandupData {
  date: string;
  summary: {
    totalProjects: number;
    totalTasks: number;
    activeTasks: number;
    completedTasks: number;
    overdueTasks: number;
    holdTasks: number;
    recentlyCompletedCount: number;
    upcomingThisWeekCount: number;
    needsApprovalCount: number;
  };
  recentlyCompleted: StandupTask[];
  blockers: {
    hold: StandupTask[];
    overdue: StandupTask[];
  };
  upcomingThisWeek: StandupTask[];
  needsApproval: StandupTask[];
  inProgressHighlights: StandupTask[];
  workload: WorkloadEntry[];
  projectHealth: ProjectHealth[];
  statusPipeline: Record<string, number>;
}

const PHASE_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  P0_FIRST_ASSESSMENT: { bg: "bg-muted", text: "text-foreground", accent: "bg-slate-500" },
  P1_COST_PROPOSAL_DESIGN: { bg: "bg-violet-50", text: "text-violet-700", accent: "bg-violet-500" },
  P2_PD_PM_HANDOVER: { bg: "bg-indigo-50", text: "text-indigo-700", accent: "bg-indigo-500" },
  P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-blue-50", text: "text-blue-700", accent: "bg-blue-500" },
  P4_CONSTRUCTION_INSTALLATION: { bg: "bg-amber-50", text: "text-amber-700", accent: "bg-amber-500" },
  P5_COMMISSIONING_TESTING: { bg: "bg-orange-50", text: "text-orange-700", accent: "bg-orange-500" },
  P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-teal-50", text: "text-teal-700", accent: "bg-teal-500" },
  P7_CLOSEOUT_POSTMORTEM: { bg: "bg-emerald-50", text: "text-emerald-700", accent: "bg-emerald-500" },
};


const priorityColors: Record<string, string> = {
  "Critical": "text-red-600",
  "Urgent": "text-red-600",
  "High": "text-orange-600",
  "Med": "text-yellow-600",
  "Medium": "text-yellow-600",
  "Low": "text-muted-foreground",
};

const priorityBorderDash: Record<string, string> = {
  "Critical": "border-l-red-600",
  "Urgent": "border-l-red-500",
  "High": "border-l-orange-500",
  "Med": "border-l-amber-400",
  "Medium": "border-l-amber-400",
  "Low": "border-l-gray-300",
};

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function getAvatarColor(name: string) {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-purple-500", "bg-amber-500",
    "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatDate(d: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
  } catch { return d; }
}

function daysFromNow(d: string | null) {
  if (!d) return null;
  const diff = Math.round((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${diff}d`;
}

function displayProject(name: string | null | undefined) {
  if (!name) return "Unassigned Project";
  return name.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
}

function TaskRow({ task, showProject = true }: { task: StandupTask; showProject?: boolean }) {
  const [, setLocation] = useLocation();
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isTaskComplete(task.status);
  const isDueSoon = task.dueDate && !isOverdue && (() => {
    const diff = Math.round((new Date(task.dueDate!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff <= 2;
  })();
  const assignee = task.assignees?.[0];

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/40 transition-all text-xs group cursor-pointer border-l-3 ${priorityBorderDash[task.priority] || "border-l-gray-200"} ${isOverdue ? "bg-red-50/30" : ""}`}
      onClick={() => setLocation(`/engineering/tasks?taskId=${task.id}`)}
      data-testid={`standup-task-${task.id}`}
    >
      {assignee && (
        <div className={`w-6 h-6 rounded-full ${getAvatarColor(assignee)} flex items-center justify-center shrink-0`} title={assignee}>
          <span className="text-[8px] font-bold text-white leading-none">{getInitials(assignee)}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium truncate text-foreground">
            {task.title}
          </span>
          {task.taskTypeTag && (
            <span className="text-[8px] px-1 py-0 bg-muted text-muted-foreground rounded shrink-0">{task.taskTypeTag}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {showProject && (
            <span className="text-[10px] text-muted-foreground truncate">{displayProject(task.projectName)}</span>
          )}
          {(task.holdReason || task.blockerReason) && (
            <span className="text-[10px] text-red-500 truncate max-w-[200px]">
              {task.holdReason || task.blockerReason}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {task.dueDate && (
          <span className={`text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 rounded-md ${
            isOverdue ? "text-red-700 bg-red-100 font-bold" :
            isDueSoon ? "text-amber-700 bg-amber-100 font-semibold" :
            "text-muted-foreground"
          }`}>
            <Calendar className="h-3 w-3 shrink-0" />
            {daysFromNow(task.dueDate)}
          </span>
        )}
        <Badge className={`text-[9px] px-1.5 py-0 ${getTaskStatusBadgeClass(task.status)}`}>
          {getTaskStatusLabel(task.status)}
        </Badge>
        <ChevronRight className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

function CollapsibleSection({
  title, icon, count, color, badge, children, defaultOpen = true, testId,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  color: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  testId: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const countBg = color.includes("red") ? "bg-red-100 text-red-700" :
    color.includes("purple") ? "bg-purple-100 text-purple-700" :
    color.includes("indigo") ? "bg-indigo-100 text-indigo-700" :
    color.includes("blue") ? "bg-blue-100 text-blue-700" :
    color.includes("emerald") ? "bg-emerald-100 text-emerald-700" :
    "bg-muted text-muted-foreground";

  return (
    <Card className="overflow-hidden shadow-sm" data-testid={testId}>
      <button
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/30 transition-all"
        onClick={() => setOpen(!open)}
        data-testid={`toggle-${testId}`}
      >
        <div className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <span className={`shrink-0 ${color}`}>{icon}</span>
        <span className="font-semibold text-sm flex-1">{title}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${countBg}`}>{count}</span>
        {badge}
      </button>
      {open && <div className="border-t">{children}</div>}
    </Card>
  );
}

function KpiStrip({ summary }: { summary: StandupData["summary"] }) {
  const stats = [
    { label: "Projects", value: summary.totalProjects, icon: <Layers className="w-4 h-4" />, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", pulse: false },
    { label: "Active", value: summary.activeTasks, icon: <ListTodo className="w-4 h-4" />, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", pulse: false },
    { label: "Overdue", value: summary.overdueTasks, icon: <AlertTriangle className="w-4 h-4" />, color: summary.overdueTasks > 0 ? "text-red-600" : "text-muted-foreground", bg: summary.overdueTasks > 0 ? "bg-red-50" : "bg-muted", border: summary.overdueTasks > 0 ? "border-red-200" : "", pulse: summary.overdueTasks > 0 },
    { label: "On Hold", value: summary.holdTasks, icon: <PauseCircle className="w-4 h-4" />, color: summary.holdTasks > 0 ? "text-amber-600" : "text-muted-foreground", bg: summary.holdTasks > 0 ? "bg-amber-50" : "bg-muted", border: summary.holdTasks > 0 ? "border-amber-200" : "", pulse: false },
    { label: "Approvals", value: summary.needsApprovalCount, icon: <ShieldAlert className="w-4 h-4" />, color: summary.needsApprovalCount > 0 ? "text-purple-600" : "text-muted-foreground", bg: summary.needsApprovalCount > 0 ? "bg-purple-50" : "bg-muted", border: summary.needsApprovalCount > 0 ? "border-purple-200" : "", pulse: false },
    { label: "Due This Week", value: summary.upcomingThisWeekCount, icon: <Timer className="w-4 h-4" />, color: "text-indigo-600", bg: "bg-indigo-50", border: "border-indigo-200", pulse: false },
    { label: "Done (24h)", value: summary.recentlyCompletedCount, icon: <CheckCircle2 className="w-4 h-4" />, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", pulse: false },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" data-testid="standup-kpi-strip">
      {stats.map(s => (
        <Card key={s.label} className={`overflow-hidden shadow-sm ${s.border} transition-all hover:shadow-md`}>
          <CardContent className="p-3 flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center shrink-0 ${s.pulse ? "animate-pulse" : ""}`}>
              <span className={s.color}>{s.icon}</span>
            </div>
            <div className="min-w-0">
              <p className={`text-xl font-bold leading-tight ${s.color}`} data-testid={`kpi-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>{s.value}</p>
              <p className="text-[8px] text-muted-foreground uppercase tracking-wider font-medium truncate">{s.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProjectHealthGrid({ projects }: { projects: ProjectHealth[] }) {
  const [, setLocation] = useLocation();

  const ragBorder = { RED: "border-l-red-500", AMBER: "border-l-amber-400", GREEN: "border-l-emerald-400" };
  const ragBg = { RED: "bg-red-50", AMBER: "bg-amber-50", GREEN: "bg-emerald-50" };
  const ragText = { RED: "text-red-700", AMBER: "text-amber-700", GREEN: "text-emerald-700" };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5" data-testid="project-health-grid">
      {projects.map(p => {
        const colors = PHASE_COLORS[p.phase] || PHASE_COLORS.P0_FIRST_ASSESSMENT;
        return (
          <Card
            key={p.projectName}
            className={`overflow-hidden border-l-4 ${ragBorder[p.rag]} hover:shadow-lg transition-all cursor-pointer group shadow-sm`}
            onClick={() => {
              const name = p.projectName.replace(/ /g, "_");
              const trackerName = name.endsWith("_Tracker") ? name : name + "_Tracker";
              setLocation(`/project/${encodeURIComponent(trackerName)}`);
            }}
            data-testid={`health-card-${p.projectName}`}
          >
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate group-hover:text-blue-600 transition-colors">{p.displayName}</p>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${colors.bg} ${colors.text} mt-0.5`}>
                    {p.phaseLabel}
                  </span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${ragBg[p.rag]} ${ragText[p.rag]}`}>
                  {p.rag}
                </span>
              </div>

              <div className="flex items-center gap-2 mb-2.5">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${p.completion >= 80 ? "bg-emerald-500" : p.completion >= 40 ? "bg-blue-500" : "bg-slate-400"}`}
                    style={{ width: `${Math.min(p.completion, 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono font-bold text-muted-foreground">{p.completion}%</span>
              </div>

              <div className="flex gap-2 text-[10px] flex-wrap">
                <span className="text-muted-foreground">{p.active} active</span>
                {p.overdue > 0 && <span className="text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full font-bold">{p.overdue} overdue</span>}
                {p.hold > 0 && <span className="text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full font-semibold">{p.hold} hold</span>}
                {p.dueThisWeek > 0 && <span className="text-indigo-600">{p.dueThisWeek} due this wk</span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function WorkloadTable({ workload }: { workload: WorkloadEntry[] }) {
  if (workload.length === 0) return <p className="text-xs text-muted-foreground p-4">No workload data</p>;

  const maxActive = Math.max(...workload.map(w => w.active), 1);

  return (
    <div className="overflow-x-auto" data-testid="workload-table">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/40 text-[9px] uppercase text-muted-foreground tracking-wider">
            <th className="text-left px-3 py-2.5 font-semibold">Person</th>
            <th className="text-center px-2 py-2.5 font-semibold">Active</th>
            <th className="text-center px-2 py-2.5 font-semibold">Due This Wk</th>
            <th className="text-center px-2 py-2.5 font-semibold">Overdue</th>
            <th className="text-center px-2 py-2.5 font-semibold">On Hold</th>
          </tr>
        </thead>
        <tbody>
          {workload.map(w => (
            <tr key={w.name} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`workload-row-${w.name}`}>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full ${getAvatarColor(w.name)} flex items-center justify-center shrink-0`}>
                    <span className="text-[8px] font-bold text-white">{getInitials(w.name)}</span>
                  </div>
                  <span className="font-medium">{w.name}</span>
                </div>
              </td>
              <td className="text-center px-2 py-2.5">
                <div className="flex items-center justify-center gap-1.5">
                  <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
                    <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(w.active / maxActive) * 100}%` }} />
                  </div>
                  <span className="font-semibold">{w.active}</span>
                </div>
              </td>
              <td className="text-center px-2 py-2.5">
                <span className={`font-semibold ${w.dueThisWeek > 0 ? "text-indigo-600" : "text-muted-foreground"}`}>{w.dueThisWeek}</span>
              </td>
              <td className="text-center px-2 py-2.5">
                {w.overdue > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full font-bold text-[10px]">
                    {w.overdue}
                  </span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </td>
              <td className="text-center px-2 py-2.5">
                {w.hold > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full font-bold text-[10px]">
                    {w.hold}
                  </span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function engPatch(url: string, body: Record<string, any>) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(body), credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

async function engPost(url: string, body: Record<string, any>) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

interface FullTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignees: string[] | null;
  trackingRag: string | null;
  projectName: string;
  holdReason: string | null;
  blockerReason: string | null;
  blockedType: string | null;
  completedAt: string | null;
  taskTypeTag: string | null;
  primaryWorkstream: string | null;
  description: string | null;
  ownerUserId?: number | null;
  assigneeUserIds?: number[] | null;
  resolvedOwner?: { id: number; name: string } | null;
  resolvedAssignees?: Array<{ id: number; name: string }> | null;
}

function getTaskAssigneeLabel(task: FullTask): string {
  const resolvedAssigneeName = task.resolvedAssignees?.find((u) => !!u?.name)?.name?.trim();
  if (resolvedAssigneeName) return resolvedAssigneeName;

  const textAssignee = task.assignees?.find((name) => !!name?.trim())?.trim();
  if (textAssignee) return textAssignee;

  const resolvedOwnerName = task.resolvedOwner?.name?.trim();
  if (resolvedOwnerName) return resolvedOwnerName;

  if ((task.assigneeUserIds?.length || 0) > 0 || !!task.ownerUserId) return "Assigned (unknown user)";
  return "Unassigned";
}

interface TaskComment {
  id: number;
  body: string;
  authorName: string;
  createdAt: string;
}

interface TaskActivity {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  createdAt: string;
}

function StandupTaskDrawer({
  task,
  onClose,
  onUpdate,
}: {
  task: FullTask;
  onClose: () => void;
  onUpdate: (id: number, updates: Record<string, any>) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [activeTab, setActiveTab] = useState<"updates" | "activity">("updates");

  const { data: comments = [] } = useQuery<TaskComment[]>({
    queryKey: ["standup-task-comments", task.id],
    queryFn: () => engFetch(`/api/eng/tasks/${task.id}/comments`),
  });

  const { data: activity = [] } = useQuery<TaskActivity[]>({
    queryKey: ["standup-task-activity", task.id],
    queryFn: () => engFetch(`/api/eng/tasks/${task.id}/activity`),
  });

  const { data: teamMembers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["team-members"],
    queryFn: () => engFetch("/api/eng/team-members"),
  });

  const addComment = async () => {
    if (!commentText.trim()) return;
    try {
      await engPost(`/api/eng/tasks/${task.id}/comments`, { body: commentText.trim() });
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: ["standup-task-comments", task.id] });
      toast({ title: "Comment posted" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleFieldUpdate = (updates: Record<string, any>) => {
    onUpdate(task.id, updates);
    queryClient.invalidateQueries({ queryKey: ["standup-task-activity", task.id] });
  };

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isTaskComplete(task.status);

  return (
    <div className="flex flex-col h-full" data-testid="standup-task-drawer">
      <div className="flex items-center gap-3 pb-4 border-b">
        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0 shrink-0" data-testid="btn-drawer-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate" data-testid="text-drawer-title">{task.title}</h3>
          <p className="text-[10px] text-muted-foreground truncate">{displayProject(task.projectName)}</p>
        </div>
        {isOverdue && (
          <Badge className="bg-red-100 text-red-700 text-[9px] shrink-0">Overdue</Badge>
        )}
      </div>

      <ScrollArea className="flex-1 -mx-6 px-6">
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Status</label>
              <SearchableSelect
                value={task.status}
                onValueChange={(val) => handleFieldUpdate({ status: val })}
                triggerClassName="h-8 text-xs mt-1"
                options={TASK_STATUSES.map(s => ({ value: s, label: getTaskStatusLabel(s) }))}
                data-testid="drawer-status-select"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Priority</label>
              <SearchableSelect
                value={task.priority}
                onValueChange={(val) => handleFieldUpdate({ priority: val })}
                triggerClassName="h-8 text-xs mt-1"
                options={TASK_PRIORITIES.map(p => ({ value: p, label: p }))}
                data-testid="drawer-priority-select"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Due Date</label>
              <Input
                type="date"
                value={task.dueDate || ""}
                onChange={(e) => handleFieldUpdate({ dueDate: e.target.value || null })}
                className="h-8 text-xs mt-1"
                data-testid="drawer-due-date"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Assignee</label>
              <SearchableSelect
                value={task.assignees?.[0] || "__unassigned"}
                onValueChange={(val) => handleFieldUpdate({ assignees: val === "__unassigned" ? [] : [val] })}
                triggerClassName="h-8 text-xs mt-1"
                placeholder="Unassigned"
                options={[
                  { value: "__unassigned", label: "Unassigned" },
                  ...teamMembers.map((m: any) => ({ value: m.name, label: m.name })),
                ]}
                data-testid="drawer-assignee-select"
              />
            </div>
          </div>

          {(task.holdReason || task.blockerReason) && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5">
              <p className="text-[10px] font-medium text-red-700 uppercase tracking-wider mb-1">
                {task.holdReason ? "Hold Reason" : "Blocker"}
              </p>
              <p className="text-xs text-red-600">{task.holdReason || task.blockerReason}</p>
              {task.blockedType && (
                <Badge className="mt-1 text-[8px] bg-orange-100 text-orange-700">{task.blockedType}</Badge>
              )}
            </div>
          )}

          {task.description && (
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Description</label>
              <p className="text-xs text-foreground mt-1 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          <Separator />

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "updates" | "activity")}>
            <TabsList className="h-7 w-full">
              <TabsTrigger value="updates" className="text-[10px] flex-1 gap-1 h-6">
                <MessageSquare className="h-3 w-3" />
                Updates ({comments.length})
              </TabsTrigger>
              <TabsTrigger value="activity" className="text-[10px] flex-1 gap-1 h-6">
                <Activity className="h-3 w-3" />
                Activity ({activity.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="updates" className="mt-3 space-y-3">
              <div className="flex gap-2">
                <Textarea
                  placeholder="Add a standup note..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addComment(); } }}
                  className="text-xs min-h-[60px] resize-none"
                  data-testid="drawer-comment-input"
                />
              </div>
              <Button
                size="sm"
                className="h-7 text-[10px] gap-1"
                onClick={addComment}
                disabled={!commentText.trim()}
                data-testid="drawer-comment-send"
              >
                <Send className="h-3 w-3" /> Post
              </Button>

              {comments.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-4">No updates yet</p>
              ) : (
                <div className="space-y-2">
                  {[...comments].reverse().map((c: TaskComment) => (
                    <div key={c.id} className="bg-muted/40 rounded-lg p-2.5" data-testid={`drawer-comment-${c.id}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className={`w-4 h-4 rounded-full ${getAvatarColor(c.authorName)} flex items-center justify-center`}>
                          <span className="text-[6px] font-bold text-white">{getInitials(c.authorName)}</span>
                        </div>
                        <span className="text-[10px] font-medium">{c.authorName}</span>
                        <span className="text-[9px] text-muted-foreground ml-auto">
                          {new Date(c.createdAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-xs whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="activity" className="mt-3">
              {activity.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-4">No activity recorded</p>
              ) : (
                <div className="space-y-1.5">
                  {[...activity].reverse().slice(0, 20).map((a: TaskActivity) => (
                    <div key={a.id} className="flex items-start gap-2 text-[10px]" data-testid={`drawer-activity-${a.id}`}>
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{a.changedBy}</span>
                        <span className="text-muted-foreground"> changed </span>
                        <span className="font-medium">{a.field}</span>
                        {a.oldValue && <span className="text-muted-foreground"> from {a.oldValue}</span>}
                        <span className="text-muted-foreground"> to </span>
                        <span className="font-medium">{a.newValue}</span>
                      </div>
                      <span className="text-[9px] text-muted-foreground shrink-0">
                        {new Date(a.createdAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}

const PRIORITY_ORDER: Record<string, number> = { "Urgent": 0, "High": 1, "Med": 2, "Low": 3 };

function sortByPriorityThenDue(a: FullTask, b: FullTask) {
  const pa = PRIORITY_ORDER[a.priority] ?? 4;
  const pb = PRIORITY_ORDER[b.priority] ?? 4;
  if (pa !== pb) return pa - pb;
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return 0;
}

function groupByAssignee(tasks: FullTask[]): Map<string, FullTask[]> {
  const map = new Map<string, FullTask[]>();
  for (const t of tasks) {
    const assigneeLabel = getTaskAssigneeLabel(t);
    if (!map.has(assigneeLabel)) map.set(assigneeLabel, []);
    map.get(assigneeLabel)!.push(t);
  }
  const sorted = new Map([...map.entries()].sort(([a], [b]) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    if (a === "Assigned (unknown user)") return 1;
    if (b === "Assigned (unknown user)") return -1;
    return a.localeCompare(b);
  }));
  return sorted;
}

function InlineTaskRow({ task, onUpdate, onOpenTask }: { task: FullTask; onUpdate: (id: number, updates: Record<string, any>) => void; onOpenTask?: (task: FullTask) => void }) {
  const [, setLocation] = useLocation();
  const [quickNote, setQuickNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isTaskComplete(task.status);
  const isDueSoon = task.dueDate && !isOverdue && (() => {
    const diff = Math.round((new Date(task.dueDate!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff <= 2;
  })();
  const { toast } = useToast();
  const assignee = getTaskAssigneeLabel(task);

  const handleQuickNote = async () => {
    if (!quickNote.trim()) return;
    try {
      await engPost(`/api/eng/tasks/${task.id}/comments`, { body: `[Quick Note] ${quickNote.trim()}` });
      setQuickNote("");
      setShowNote(false);
      toast({ title: "Note posted" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div
      className={`border-b last:border-b-0 hover:bg-muted/30 transition-all text-xs border-l-3 ${priorityBorderDash[task.priority] || "border-l-gray-200"} ${isOverdue ? "bg-red-50/30" : ""}`}
      data-testid={`standup-inline-task-${task.id}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {assignee && assignee !== "Unassigned" && assignee !== "Assigned (unknown user)" && (
          <div className={`w-6 h-6 rounded-full ${getAvatarColor(assignee)} flex items-center justify-center shrink-0`} title={assignee}>
            <span className="text-[8px] font-bold text-white leading-none">{getInitials(assignee)}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium truncate text-foreground">
              {task.title}
            </span>
            {task.blockedType && (
              <Badge className={`text-[8px] px-1 py-0 shrink-0 ${task.blockedType === "External" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"}`}>
                {task.blockedType}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground truncate">{displayProject(task.projectName)}</span>
            {(task.holdReason || task.blockerReason) && (
              <span className="text-[10px] text-red-500 truncate max-w-[120px] sm:max-w-[180px]">{task.holdReason || task.blockerReason}</span>
            )}
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <SearchableSelect
            value={task.priority}
            onValueChange={(val) => onUpdate(task.id, { priority: val })}
            triggerClassName="h-6 w-[60px] text-[10px] px-1.5 border-dashed"
            options={TASK_PRIORITIES.map(p => ({ value: p, label: p }))}
            data-testid={`priority-select-${task.id}`}
          />

          <SearchableSelect
            value={task.status}
            onValueChange={(val) => onUpdate(task.id, { status: val })}
            triggerClassName="h-6 w-[100px] text-[10px] px-1.5 border-dashed"
            options={TASK_STATUSES.map(s => ({ value: s, label: getTaskStatusLabel(s) }))}
            data-testid={`status-select-${task.id}`}
          />

          <Input
            type="date"
            value={task.dueDate || ""}
            onChange={(e) => onUpdate(task.id, { dueDate: e.target.value || null })}
            className="h-6 w-[110px] text-[10px] px-1.5 border-dashed"
            data-testid={`due-date-input-${task.id}`}
          />

          {task.dueDate && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-md min-w-[44px] text-center ${
              isOverdue ? "text-red-700 bg-red-100 font-bold" :
              isDueSoon ? "text-amber-700 bg-amber-100 font-semibold" :
              "text-muted-foreground"
            }`}>
              {daysFromNow(task.dueDate)}
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); setShowNote(!showNote); }}
            title="Add note"
            data-testid={`toggle-note-${task.id}`}
          >
            <Edit3 className="h-3 w-3" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); if (onOpenTask) onOpenTask(task); else setLocation(`/engineering/tasks?taskId=${task.id}`); }}
            data-testid={`open-detail-${task.id}`}
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>

        <div className="flex sm:hidden items-center gap-1 shrink-0">
          {task.dueDate && (
            <span className={`text-[9px] px-1 py-0.5 rounded ${
              isOverdue ? "text-red-700 bg-red-100 font-bold" :
              isDueSoon ? "text-amber-700 bg-amber-100 font-semibold" :
              "text-muted-foreground"
            }`}>
              {daysFromNow(task.dueDate)}
            </span>
          )}
          <Badge className={`text-[8px] px-1 py-0 ${getTaskStatusBadgeClass(task.status)}`}>
            {getTaskStatusLabel(task.status)}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={(e) => { e.stopPropagation(); if (onOpenTask) onOpenTask(task); else setLocation(`/engineering/tasks?taskId=${task.id}`); }}
            data-testid={`open-detail-mobile-${task.id}`}
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {showNote && (
        <div className="flex items-center gap-1.5 px-3 pb-2 sm:pl-11">
          <Input
            placeholder="Add a quick note..."
            value={quickNote}
            onChange={(e) => setQuickNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleQuickNote(); if (e.key === "Escape") setShowNote(false); }}
            className="h-6 text-[10px] flex-1 border-dashed"
            autoFocus
            data-testid={`quick-note-input-${task.id}`}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] gap-1"
            onClick={handleQuickNote}
            disabled={!quickNote.trim()}
            data-testid={`quick-note-send-${task.id}`}
          >
            <Send className="h-3 w-3" />
            Post
          </Button>
        </div>
      )}
    </div>
  );
}

function AssigneeGroup({ name, tasks, onUpdate, defaultOpen, onOpenTask }: { name: string; tasks: FullTask[]; onUpdate: (id: number, updates: Record<string, any>) => void; defaultOpen: boolean; onOpenTask?: (task: FullTask) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const overdueCount = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && !isTaskComplete(t.status)).length;

  return (
    <div data-testid={`assignee-group-${name}`}>
      <button
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-muted/30 transition-colors bg-muted/10 border-b"
        onClick={() => setOpen(!open)}
        data-testid={`toggle-assignee-${name}`}
      >
        <div className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className={`w-5 h-5 rounded-full ${name === "Unassigned" ? "bg-gray-400" : getAvatarColor(name)} flex items-center justify-center shrink-0`}>
          <span className="text-[7px] font-bold text-white leading-none">{name === "Unassigned" ? "?" : getInitials(name)}</span>
        </div>
        <span className="font-medium text-xs">{name}</span>
        {overdueCount > 0 && (
          <span className="text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">{overdueCount} overdue</span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">{tasks.length}</span>
      </button>
      {open && (
        <div>
          {tasks.sort(sortByPriorityThenDue).map(t => (
            <InlineTaskRow key={t.id} task={t} onUpdate={onUpdate} onOpenTask={onOpenTask} />
          ))}
        </div>
      )}
    </div>
  );
}

function StandupBucket({
  title, icon, tasks, color, open, onToggle, testId, onUpdate, onOpenTask, assigneeCount,
}: {
  title: string;
  icon: React.ReactNode;
  tasks: FullTask[];
  color: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
  onUpdate: (id: number, updates: Record<string, any>) => void;
  onOpenTask?: (task: FullTask) => void;
  assigneeCount?: number;
}) {
  const grouped = groupByAssignee(tasks);

  const countBg = color.includes("red") ? "bg-red-100 text-red-700" :
    color.includes("amber") ? "bg-amber-100 text-amber-700" :
    color.includes("indigo") ? "bg-indigo-100 text-indigo-700" :
    color.includes("blue") ? "bg-blue-100 text-blue-700" :
    "bg-muted text-muted-foreground";

  return (
    <Card className="overflow-hidden shadow-sm" data-testid={testId}>
      <button
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/30 transition-all"
        onClick={onToggle}
        data-testid={`toggle-${testId}`}
      >
        <div className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <span className={`shrink-0 ${color}`}>{icon}</span>
        <span className="font-semibold text-sm flex-1">{title}</span>
        <span className="text-[10px] text-muted-foreground mr-1">{(assigneeCount ?? grouped.size)} assignee{(assigneeCount ?? grouped.size) !== 1 ? "s" : ""}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${countBg}`}>{tasks.length}</span>
      </button>
      {open && (
        <div className="border-t min-h-14">
          {tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4">No standup items in this group</p>
          ) : (
            [...grouped.entries()].map(([name, assigneeTasks]) => (
              <AssigneeGroup
                key={name}
                name={name}
                tasks={assigneeTasks}
                onUpdate={onUpdate}
                onOpenTask={onOpenTask}
                defaultOpen={grouped.size <= 5}
              />
            ))
          )}
        </div>
      )}
    </Card>
  );
}

function StandupModeView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const blockersRef = useRef<HTMLDivElement>(null);
  const [selectedTask, setSelectedTask] = useState<FullTask | null>(null);

  const { data: allTasks = [], isLoading, isError, error, refetch, isFetching } = useQuery<FullTask[]>({
    queryKey: ["eng-standup-all-tasks"],
    queryFn: () => engFetch("/api/eng/tasks"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const [openBuckets, setOpenBuckets] = useState<Record<string, boolean>>({});

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Record<string, any> }) =>
      engPatch(`/api/eng/tasks/${id}`, updates),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["eng-standup-all-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["eng-standup"] });
      if (selectedTask && selectedTask.id === variables.id) {
        const updatedTask = allTasks.find(t => t.id === variables.id);
        if (updatedTask) {
          setSelectedTask({ ...updatedTask, ...variables.updates });
        }
      }
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const handleUpdate = useCallback((id: number, updates: Record<string, any>) => {
    updateMutation.mutate({ id, updates });
  }, [updateMutation]);

  const handleOpenTask = useCallback((task: FullTask) => {
    setSelectedTask(task);
  }, []);

  const today = new Date().toISOString().split("T")[0];
  const { groups: bucketedGroups, assigneeCounts } = useMemo(() => bucketEngineeringStandupTasks(allTasks, today, 7), [allTasks, today]);

  const overdueTasks = bucketedGroups.overdue;
  const dueSoonTasks = bucketedGroups.dueSoon;
  const holdTasks = bucketedGroups.onHold;
  const inProgressTasks = bucketedGroups.inProgress;
  const unassignedTasks = bucketedGroups.unassigned;
  const everythingElse = bucketedGroups.everythingElse;
  const nonComplete = [...overdueTasks, ...dueSoonTasks, ...holdTasks, ...inProgressTasks, ...unassignedTasks, ...everythingElse];

  const blockerCount = overdueTasks.length + holdTasks.length;

  const groups = useMemo(() => ([
    { key: "overdue", title: "Overdue", icon: <AlertTriangle className="h-4 w-4" />, tasks: overdueTasks, color: "text-red-600", defaultOpen: true, testId: "standup-bucket-overdue" },
    { key: "dueSoon", title: "Due Soon (7 days)", icon: <Timer className="h-4 w-4" />, tasks: dueSoonTasks, color: "text-indigo-600", defaultOpen: true, testId: "standup-bucket-due-soon" },
    { key: "hold", title: "On Hold", icon: <PauseCircle className="h-4 w-4" />, tasks: holdTasks, color: "text-amber-600", defaultOpen: true, testId: "standup-bucket-hold" },
    { key: "inProgress", title: "In Progress", icon: <Zap className="h-4 w-4" />, tasks: inProgressTasks, color: "text-blue-600", defaultOpen: false, testId: "standup-bucket-in-progress" },
    { key: "unassigned", title: "Unassigned / Needs Triage", icon: <User className="h-4 w-4" />, tasks: unassignedTasks, color: "text-slate-600", defaultOpen: true, testId: "standup-bucket-unassigned" },
    { key: "everythingElse", title: "Everything Else", icon: <ListTodo className="h-4 w-4" />, tasks: everythingElse, color: "text-muted-foreground", defaultOpen: false, testId: "standup-bucket-everything-else" },
  ]), [dueSoonTasks, everythingElse, holdTasks, inProgressTasks, overdueTasks, unassignedTasks]);

  useEffect(() => {
    if (Object.keys(openBuckets).length > 0) return;
    const firstNonEmpty = groups.find((group) => group.tasks.length > 0)?.key;
    const nextState: Record<string, boolean> = {};
    for (const group of groups) {
      nextState[group.key] = firstNonEmpty ? group.key === firstNonEmpty : group.defaultOpen;
    }
    setOpenBuckets(nextState);
  }, [groups, openBuckets]);

  const scrollToBlockers = () => {
    blockersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const currentTask = selectedTask ? allTasks.find(t => t.id === selectedTask.id) || selectedTask : null;

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="standup-body-loading">
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading standup task groups...
        </div>
        {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="border-red-200" data-testid="standup-body-error">
        <CardContent className="py-8 px-4 space-y-3 text-center">
          <AlertTriangle className="h-8 w-8 text-red-600 mx-auto" />
          <p className="text-sm font-semibold">Could not load standup task details</p>
          <p className="text-xs text-muted-foreground">{(error as Error)?.message || "Unknown error"}</p>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => refetch()} data-testid="retry-standup-body">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (nonComplete.length === 0) {
    return (
      <Card data-testid="standup-body-empty">
        <CardContent className="py-8 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
          <p className="text-sm font-semibold">No open standup tasks</p>
          <p className="text-xs text-muted-foreground">All engineering tasks are complete.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {blockerCount > 0 && (
        <button
          onClick={scrollToBlockers}
          className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-100 transition-all w-fit shadow-sm"
          data-testid="standup-blocker-badge"
        >
          <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center">
            <ShieldAlert className="h-3.5 w-3.5" />
          </div>
          {blockerCount} blocker{blockerCount !== 1 ? "s" : ""} need attention
          <ChevronDown className="h-3.5 w-3.5 ml-1 animate-bounce" />
        </button>
      )}

      <div className="space-y-4" data-testid="standup-body-groups">
        {groups.map((group, index) => {
          const bucket = (
            <StandupBucket
              key={group.key}
              title={group.title}
              icon={group.icon}
              tasks={group.tasks}
              color={group.color}
              open={!!openBuckets[group.key]}
              onToggle={() => setOpenBuckets((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
              testId={group.testId}
              onUpdate={handleUpdate}
              onOpenTask={handleOpenTask}
              assigneeCount={assigneeCounts[group.key as keyof typeof assigneeCounts]}
            />
          );
          if (index === 0) {
            return <div key={group.key} ref={blockersRef}>{bucket}</div>;
          }
          return bucket;
        })}
      </div>

      {isFetching && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Refreshing standup task details...
        </div>
      )}

      <Sheet open={!!selectedTask} onOpenChange={(open) => { if (!open) setSelectedTask(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-6" data-testid="standup-sheet-drawer">
          {currentTask && (
            <StandupTaskDrawer
              task={currentTask}
              onClose={() => setSelectedTask(null)}
              onUpdate={handleUpdate}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface CompanyPriority {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  severity: string;
  status: string;
  assignedTo: string | null;
  nextAction: string | null;
  dueDate: string | null;
  linkedProjectName: string | null;
  links?: { id: number; linkType: string; projectName: string | null; taskId: number | null }[];
}

function severityBorder(s: string) {
  if (s === "critical") return "border-l-red-500";
  if (s === "important") return "border-l-amber-400";
  return "border-l-blue-400";
}

function CompanyPrioritiesSection() {
  const { data: priorities = [], isLoading } = useQuery<CompanyPriority[]>({
    queryKey: ["/api/mytool/company-priorities"],
    queryFn: () => engFetch("/api/mytool/company-priorities"),
  });

  const active = priorities.filter((p: CompanyPriority) => p.status !== "completed" && p.status !== "cancelled");
  const sorted = [...active].sort((a, b) => {
    const sevOrder = (s: string) => s === "critical" ? 0 : s === "important" ? 1 : 2;
    return sevOrder(a.severity) - sevOrder(b.severity);
  });

  if (isLoading) {
    return (
      <Card>
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Flag className="h-4 w-4 text-red-500" />
          <span className="font-semibold text-sm">Company Priorities</span>
        </div>
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (sorted.length === 0) return null;

  return (
    <Card data-testid="section-company-priorities">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <Flag className="h-4 w-4 text-red-500" />
        <span className="font-semibold text-sm">Company Priorities</span>
        <span className="text-xs text-muted-foreground ml-auto">{sorted.length} active</span>
      </div>
      <CardContent className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(p => {
            const overdue = p.dueDate && new Date(p.dueDate) < new Date();
            return (
              <div
                key={p.id}
                className={`border-l-4 ${severityBorder(p.severity)} border rounded-lg bg-card p-3 space-y-1.5 ${overdue ? "ring-1 ring-red-300" : ""}`}
                data-testid={`priority-card-${p.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold text-xs leading-snug">{p.title}</h4>
                  <Badge className={`text-[9px] px-1.5 py-0 shrink-0 ${
                    p.severity === "critical" ? "bg-red-100 text-red-700" :
                    p.severity === "important" ? "bg-amber-100 text-amber-700" :
                    "bg-blue-100 text-blue-700"
                  }`}>{p.severity}</Badge>
                </div>
                {p.assignedTo && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Users className="h-3 w-3" /> {p.assignedTo}
                  </div>
                )}
                {p.nextAction && (
                  <div className="flex items-start gap-1 text-[10px] text-muted-foreground">
                    <Target className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{p.nextAction}</span>
                  </div>
                )}
                {p.dueDate && (
                  <div className={`text-[10px] flex items-center gap-1 ${overdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                    <Calendar className="h-3 w-3" /> {p.dueDate}
                    {overdue && <AlertTriangle className="h-3 w-3" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function EngineeringDashboard() {
  const { user, isAdmin } = useAuth();
  const userRole = (user as any)?.role || "";
  const managerRoles = ["admin", "eng_program_manager", "CEO_ADMIN", "COO_ADMIN", "CCO", "PROGRAM_MANAGER", "CONSTRUCTION_MANAGER"];
  const isManagerRole = isAdmin || managerRoles.includes(userRole);
  const [showAllTasks, setShowAllTasks] = useState(isManagerRole);
  const [standupMode, setStandupMode] = useState(false);
  const fullName = user?.name || "";
  const firstName = fullName.split(/\s+/)[0];

  const assigneeParam = (!showAllTasks && firstName) ? `?assignee=${encodeURIComponent(firstName)}` : "";

  const { data, isLoading, error } = useQuery<StandupData>({
    queryKey: ["eng-standup", assigneeParam],
    queryFn: () => engFetch(`/api/eng/dashboard/standup${assigneeParam}`),
    refetchOnMount: "always",
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="eng-dashboard">
        <SectionHeader
          icon={<Wrench className="h-5 w-5" />}
          title="Engineering Overview & Team Ops"
          description="Loading standup and team operations data..."
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          {[1,2,3,4,5,6,7].map(i => <div key={i} className="h-[72px] bg-muted animate-pulse rounded-xl" />)}
        </div>
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
        </div>
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="eng-dashboard">
        <SectionHeader
          icon={<Wrench className="h-5 w-5" />}
          title="Engineering Overview & Team Ops"
          description="Engineering standup and task coordination"
        />
        <Card className="border border-red-200 bg-red-50/40">
          <CardContent className="py-10 px-6 text-center">
            <AlertTriangle className="h-10 w-10 text-red-600 mx-auto mb-2" />
            <p className="font-medium">Failed to load engineering overview data</p>
            <p className="text-sm text-muted-foreground mt-1">{(error as Error)?.message || "Unknown error"}</p>
            <p className="text-xs text-muted-foreground mt-1">Try refreshing this page. Core task execution remains available in /engineering/tasks.</p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const { summary, blockers, recentlyCompleted, upcomingThisWeek, needsApproval, inProgressHighlights, workload, projectHealth } = data;
  const totalBlockers = blockers.hold.length + blockers.overdue.length;

  const todayFormatted = new Date().toLocaleDateString("en-ZA", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  return (
    <PageShell className="p-4 md:p-6" data-testid="eng-dashboard">
      {!standupMode && (
        <SectionHeader
          icon={<Wrench className="h-5 w-5" />}
          title={showAllTasks ? "Engineering Overview & Team Ops" : `${firstName}'s Dashboard`}
          description={todayFormatted}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-md">
            <Wrench className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-heading font-bold tracking-tight" data-testid="text-standup-title">
              {standupMode ? "Engineering Standup & Team Triage" : showAllTasks ? "Engineering Overview & Team Ops" : `${firstName}'s Dashboard`}
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              {todayFormatted}
              {!showAllTasks && firstName && (
                <span className="ml-1 flex items-center gap-1 text-blue-600 font-medium">
                  <UserCheck className="h-3 w-3" />
                  Filtered to your tasks
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isManagerRole && (
            <Button
              variant={standupMode ? "default" : "outline"}
              size="sm"
              className={`h-8 text-xs gap-1.5 font-semibold ${standupMode ? "bg-orange-600 hover:bg-orange-700 shadow-sm" : ""}`}
              onClick={() => setStandupMode(!standupMode)}
              data-testid="toggle-standup-mode"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {standupMode ? "Exit Standup" : "Standup Mode"}
            </Button>
          )}
          {!standupMode && totalBlockers > 0 && (
            <div className="flex items-center gap-1.5 text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg text-xs font-bold" data-testid="blocker-alert">
              <ShieldAlert className="h-3.5 w-3.5" />
              {totalBlockers} blocker{totalBlockers !== 1 ? "s" : ""}
            </div>
          )}
          {!standupMode && firstName && isManagerRole && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="eng-more-controls">
                  <MoreHorizontal className="h-3.5 w-3.5" /> More
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => setShowAllTasks(!showAllTasks)}
                  data-testid="toggle-all-tasks"
                >
                  {showAllTasks ? (
                    <><UserCheck className="h-3.5 w-3.5 mr-1.5" /> My Tasks</>
                  ) : (
                    <><Eye className="h-3.5 w-3.5 mr-1.5" /> All Tasks</>
                  )}
                </Button>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {!standupMode && (
        <Card className="shadow-sm border-blue-200/70 bg-gradient-to-r from-blue-50/70 to-transparent" data-testid="engineering-workspace-handoff">
          <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Workspace intent</p>
              <p className="text-sm font-medium">This page is for standup, blockers, approvals and team coordination.</p>
              <p className="text-xs text-muted-foreground">Use the task board for active execution, detailed updates, and delivery flow.</p>
            </div>
            <Link href="/engineering/tasks">
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="btn-open-task-execution-board">
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Go to Task Execution Board
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {standupMode ? (
        <>
        <Card className="mb-4 border-primary/30 bg-primary/5">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">New: Unified Standup System</span>
              <span className="text-xs text-muted-foreground">Bi-daily async standups with team views and analytics</span>
            </div>
            <Link href="/standups">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                <ArrowUpRight className="h-3.5 w-3.5" />
                Go to Standups
              </Button>
            </Link>
          </CardContent>
        </Card>
        <StandupModeView />
        </>
      ) : (
      <>
      <KpiStrip summary={summary} />

      {totalBlockers > 0 && (
        <CollapsibleSection
          title="Blockers & Escalations"
          icon={<ShieldAlert className="h-4 w-4" />}
          count={totalBlockers}
          color="text-red-600"
          badge={
            <Badge className="bg-red-100 text-red-700 text-[9px] px-1.5">DISCUSS</Badge>
          }
          defaultOpen={true}
          testId="section-blockers"
        >
          {blockers.overdue.length > 0 && (
            <div>
              <div className="px-3 py-2 bg-gradient-to-r from-red-50 to-transparent text-[10px] font-bold text-red-700 uppercase tracking-wider flex items-center gap-1.5 border-b">
                <AlertTriangle className="h-3 w-3" />
                Overdue ({blockers.overdue.length})
              </div>
              {blockers.overdue.map(t => <TaskRow key={t.id} task={t} />)}
            </div>
          )}
          {blockers.hold.length > 0 && (
            <div>
              <div className="px-3 py-2 bg-gradient-to-r from-amber-50 to-transparent text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1.5 border-b">
                <PauseCircle className="h-3 w-3" />
                On Hold ({blockers.hold.length})
              </div>
              {blockers.hold.map(t => <TaskRow key={t.id} task={t} />)}
            </div>
          )}
        </CollapsibleSection>
      )}

      {needsApproval.length > 0 && (
        <CollapsibleSection
          title="Needs Approval / Feedback"
          icon={<ShieldAlert className="h-4 w-4" />}
          count={needsApproval.length}
          color="text-purple-600"
          defaultOpen={needsApproval.length <= 5}
          testId="section-approvals"
        >
          {needsApproval.map(t => <TaskRow key={t.id} task={t} />)}
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Due This Week"
        icon={<Timer className="h-4 w-4" />}
        count={upcomingThisWeek.length}
        color="text-indigo-600"
        defaultOpen={true}
        testId="section-upcoming"
      >
        {upcomingThisWeek.length > 0 ? (
          upcomingThisWeek.map(t => <TaskRow key={t.id} task={t} />)
        ) : (
          <p className="text-xs text-muted-foreground p-4">No tasks due this week</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="In Progress"
        icon={<Zap className="h-4 w-4" />}
        count={inProgressHighlights.length}
        color="text-blue-600"
        defaultOpen={false}
        testId="section-in-progress"
      >
        {inProgressHighlights.length > 0 ? (
          inProgressHighlights.map(t => <TaskRow key={t.id} task={t} />)
        ) : (
          <p className="text-xs text-muted-foreground p-4">No tasks in progress</p>
        )}
      </CollapsibleSection>

      {recentlyCompleted.length > 0 && (
        <CollapsibleSection
          title="Recently Completed (24h)"
          icon={<CheckCircle2 className="h-4 w-4" />}
          count={recentlyCompleted.length}
          color="text-emerald-600"
          defaultOpen={false}
          testId="section-completed"
        >
          {recentlyCompleted.map(t => <TaskRow key={t.id} task={t} />)}
        </CollapsibleSection>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-sm" data-testid="section-workload">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Users className="h-4 w-4 text-indigo-600" />
            </div>
            <span className="font-semibold text-sm">Team Workload</span>
            <span className="text-[10px] text-muted-foreground ml-auto bg-muted px-1.5 py-0.5 rounded-full font-medium">{workload.length} members</span>
          </div>
          <WorkloadTable workload={workload} />
        </Card>

        <Card className="shadow-sm" data-testid="section-pipeline">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <span className="font-semibold text-sm">Status Pipeline</span>
          </div>
          <CardContent className="p-4">
            <div className="space-y-2.5">
              {(() => {
                const statusOrder = ["TO DO", "IN PROGRESS", "NEEDS APPROVAL", "QC APPROVED", "PROVIDE FEEDBACK", "PROJECTS ASSISTANCE", "HOLD", "COMPLETE"];
                                const total = summary.totalTasks || 1;
                return Object.entries(data.statusPipeline)
                  .sort(([a], [b]) => {
                    const ai = statusOrder.indexOf(a);
                    const bi = statusOrder.indexOf(b);
                    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                  })
                  .map(([status, count]) => {
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={status} className="flex items-center gap-2 text-xs group">
                        <span className="w-[90px] sm:w-[130px] truncate text-muted-foreground group-hover:text-foreground transition-colors">{status}</span>
                        <div className="flex-1 h-4 bg-muted/60 rounded-md overflow-hidden">
                          <div
                            className={`h-full rounded-md transition-all duration-500 ${getTaskStatusBarClass(status)}`}
                            style={{ width: `${Math.max(pct, 2)}%` }}
                          />
                        </div>
                        <span className="font-mono w-8 text-right font-bold">{count}</span>
                      </div>
                    );
                  });
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-sm">Project Health</h3>
          <div className="flex items-center gap-2 ml-auto text-[10px]">
            <span className="flex items-center gap-1 text-red-600 font-bold">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {projectHealth.filter(p => p.rag === "RED").length}
            </span>
            <span className="flex items-center gap-1 text-amber-600 font-bold">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              {projectHealth.filter(p => p.rag === "AMBER").length}
            </span>
            <span className="flex items-center gap-1 text-emerald-600 font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {projectHealth.filter(p => p.rag === "GREEN").length}
            </span>
          </div>
        </div>
        <ProjectHealthGrid projects={projectHealth} />
      </div>
      </>
      )}
    </PageShell>
  );
}
