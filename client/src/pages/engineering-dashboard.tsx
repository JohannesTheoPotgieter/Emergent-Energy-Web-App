import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
import { TASK_PRIORITIES } from "@shared/schema";
import { TASK_STATUSES, getTaskStatusBadgeClass, getTaskStatusBarClass, getTaskStatusLabel, isTaskComplete } from "@shared/task-status";
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
  MoreHorizontal,
  ArrowRightLeft,
} from "lucide-react";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { ApprovalQueueCard } from "@/components/controlled-documents";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { engFetch, engPatch, engPost } from "@/lib/eng-fetch";
import { PHASE_COLORS } from "@/lib/phase-colors";
import { AttentionBadges, type AttentionItem } from "@/components/dashboard/AttentionBadges";
import UserAssignmentPicker from "@/components/UserAssignmentPicker";
import { useToast } from "@/hooks/use-toast";
import { copyTeamsMessage, escapeHtml } from "@/lib/teams-clipboard";
import { normalizeTaskPriority } from "@shared/task-priorities";

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
  otherActive: StandupTask[];
  workload: WorkloadEntry[];
  projectHealth: ProjectHealth[];
  statusPipeline: Record<string, number>;
}

// PHASE_COLORS imported from @/lib/phase-colors


const priorityBorderDash: Record<string, string> = {
  Urgent: "border-l-red-500",
  High: "border-l-orange-500",
  Med: "border-l-amber-400",
  Low: "border-l-gray-300",
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
      className={`flex items-center gap-2.5 px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/40 transition-all text-xs group cursor-pointer border-l-3 ${priorityBorderDash[normalizeTaskPriority(task.priority)]} ${isOverdue ? "bg-red-50/30" : ""}`}
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
        {task.trackingRag && (
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              task.trackingRag.toLowerCase() === "red" ? "bg-red-500" :
              task.trackingRag.toLowerCase() === "amber" ? "bg-amber-500" :
              task.trackingRag.toLowerCase() === "green" ? "bg-emerald-500" :
              "bg-gray-300"
            }`}
            title={`RAG: ${task.trackingRag}`}
          />
        )}
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
    { label: "Projects", value: summary.totalProjects, icon: <Layers className="w-4 h-4" />, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", pulse: false, scrollTo: "section-project-health", href: null },
    { label: "Active", value: summary.activeTasks, icon: <ListTodo className="w-4 h-4" />, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", pulse: false, scrollTo: "section-in-progress", href: "/engineering/tasks?status=in_progress" },
    { label: "Overdue", value: summary.overdueTasks, icon: <AlertTriangle className="w-4 h-4" />, color: summary.overdueTasks > 0 ? "text-red-600" : "text-muted-foreground", bg: summary.overdueTasks > 0 ? "bg-red-50" : "bg-muted", border: summary.overdueTasks > 0 ? "border-red-200" : "", pulse: summary.overdueTasks > 0, scrollTo: "section-blockers", href: "/engineering/tasks?dueDate=overdue" },
    { label: "On Hold", value: summary.holdTasks, icon: <PauseCircle className="w-4 h-4" />, color: summary.holdTasks > 0 ? "text-amber-600" : "text-muted-foreground", bg: summary.holdTasks > 0 ? "bg-amber-50" : "bg-muted", border: summary.holdTasks > 0 ? "border-amber-200" : "", pulse: false, scrollTo: "section-blockers", href: "/engineering/tasks?status=hold" },
    { label: "Approvals", value: summary.needsApprovalCount, icon: <ShieldAlert className="w-4 h-4" />, color: summary.needsApprovalCount > 0 ? "text-purple-600" : "text-muted-foreground", bg: summary.needsApprovalCount > 0 ? "bg-purple-50" : "bg-muted", border: summary.needsApprovalCount > 0 ? "border-purple-200" : "", pulse: false, scrollTo: "section-approvals", href: "/engineering/tasks?status=needs_approval" },
    { label: "Due This Week", value: summary.upcomingThisWeekCount, icon: <Timer className="w-4 h-4" />, color: "text-indigo-600", bg: "bg-indigo-50", border: "border-indigo-200", pulse: false, scrollTo: "section-due-this-week", href: "/engineering/tasks?dueDate=this_week" },
    { label: "Done (24h)", value: summary.recentlyCompletedCount, icon: <CheckCircle2 className="w-4 h-4" />, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", pulse: false, scrollTo: "section-recently-completed", href: "/engineering/tasks?status=complete" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" data-testid="standup-kpi-strip">
      {stats.map(s => (
        <Card
          key={s.label}
          className={`overflow-hidden shadow-sm ${s.border} transition-all hover:shadow-md cursor-pointer`}
          onClick={() => s.href ? (window.location.href = s.href) : document.querySelector(`[data-testid="${s.scrollTo}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
        >
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
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md cursor-help ${ragBg[p.rag]} ${ragText[p.rag]}`}
                  title={p.rag === "RED" ? "High risk: overdue tasks or >2 on hold" : p.rag === "AMBER" ? "At risk: tasks on hold or >3 due this week" : "On track: no overdue, minimal holds"}
                >
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
            <tr
              key={w.name}
              className="border-b last:border-b-0 hover:bg-blue-50 transition-colors cursor-pointer"
              onClick={() => window.location.href = `/engineering/tasks?assignee=${encodeURIComponent(w.name)}`}
              title={`View ${w.name}'s tasks`}
              data-testid={`workload-row-${w.name}`}
            >
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

// engPatch, engPost imported from @/lib/eng-fetch

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
  // Enriched strategic fields
  effectiveHealth?: string;
  effectiveProgress?: number;
  projectCount?: number;
  hasProjects?: boolean;
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
    const sevDiff = sevOrder(a.severity) - sevOrder(b.severity);
    if (sevDiff !== 0) return sevDiff;
    const healthOrder = (s?: string) => s === "critical" ? 0 : s === "at_risk" ? 1 : 2;
    return healthOrder(a.effectiveHealth) - healthOrder(b.effectiveHealth);
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
                {p.effectiveHealth && (
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className={`inline-block h-2 w-2 rounded-full ${
                      p.effectiveHealth === "critical" ? "bg-red-500" :
                      p.effectiveHealth === "at_risk" ? "bg-amber-500" :
                      "bg-green-500"
                    }`} />
                    <span className="text-muted-foreground capitalize">{p.effectiveHealth.replace("_", " ")}</span>
                    {p.effectiveProgress != null && p.effectiveProgress > 0 && (
                      <span className="text-muted-foreground ml-auto">{p.effectiveProgress}%</span>
                    )}
                    {(p.projectCount ?? 0) > 0 && (
                      <span className="text-muted-foreground">{p.projectCount} proj</span>
                    )}
                  </div>
                )}
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

function ActivityFeed() {
  const { data: auditData } = useQuery<{ entries: any[] }>({
    queryKey: ["eng-activity-feed"],
    queryFn: () => engFetch("/api/eng/audit-log?limit=15"),
    refetchInterval: 60000,
  });

  const entries = auditData?.entries || [];

  if (entries.length === 0) return null;

  return (
    <Card className="shadow-sm" data-testid="section-activity-feed">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
          <Activity className="h-4 w-4 text-indigo-600" />
        </div>
        <span className="font-semibold text-sm">Recent Activity</span>
        <span className="text-[10px] text-muted-foreground ml-auto">Live</span>
      </div>
      <CardContent className="p-0">
        <div className="max-h-[280px] overflow-y-auto divide-y">
          {entries.map((entry: any, i: number) => (
            <div key={entry.id || i} className="px-4 py-2.5 flex items-start gap-2.5 hover:bg-muted/30 transition-colors text-xs">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0 mt-0.5 ${
                entry.actionType?.includes("status") ? "bg-blue-500" :
                entry.actionType?.includes("comment") ? "bg-emerald-500" :
                entry.actionType?.includes("created") ? "bg-purple-500" :
                "bg-gray-400"
              }`}>
                {(entry.actorName || "?")[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="leading-snug">
                  <span className="font-semibold">{entry.actorName || "System"}</span>
                  {" "}
                  <span className="text-muted-foreground">
                    {entry.actionType === "field_changed" && entry.fieldName === "status"
                      ? `changed status → ${entry.newValue}`
                      : entry.actionType === "comment_added"
                      ? "added a comment"
                      : entry.actionType === "created"
                      ? "created a task"
                      : `${entry.actionType?.replace(/_/g, " ")}`}
                  </span>
                </p>
                {entry.taskTitle && <p className="text-muted-foreground truncate mt-0.5">{entry.taskTitle}</p>}
              </div>
              <span className="text-[9px] text-muted-foreground shrink-0 mt-0.5">
                {entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : ""}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function EngineeringDashboard() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const userRole = (user as any)?.role || "";
  const managerRoles = ["admin", "eng_program_manager", "CEO_ADMIN", "COO_ADMIN", "CCO", "PROGRAM_MANAGER", "CONSTRUCTION_MANAGER"];
  const isManagerRole = isAdmin || managerRoles.includes(userRole);
  const [showAllTasks, setShowAllTasks] = useState(isManagerRole);
  const fullName = user?.name || "";
  const firstName = fullName.split(/\s+/)[0];

  const assigneeParam = (!showAllTasks && firstName) ? `?assignee=${encodeURIComponent(firstName)}` : "";

  const { data, isLoading, isError, error, refetch } = useQuery<StandupData>({
    queryKey: ["eng-overview", assigneeParam],
    queryFn: () => engFetch(`/api/eng/dashboard/overview${assigneeParam}`),
    refetchOnMount: "always",
    staleTime: 10_000,
  });

  const engAttentionItems = useMemo((): AttentionItem[] => {
    if (!data?.summary) return [];
    const s = data.summary;
    const items: AttentionItem[] = [];
    if (s.overdueTasks > 0) items.push({ label: "Overdue Tasks", value: s.overdueTasks, color: "text-red-600 bg-red-50 border-red-200", href: "/engineering/tasks?dueDate=overdue" });
    if (s.holdTasks > 0) items.push({ label: "On Hold", value: s.holdTasks, color: "text-amber-700 bg-amber-50 border-amber-200", href: "/engineering/tasks?status=hold" });
    if (s.needsApprovalCount > 0) items.push({ label: "Needs Approval", value: s.needsApprovalCount, color: "text-violet-700 bg-violet-50 border-violet-200", href: "/engineering/tasks?status=needs_approval" });
    if (s.upcomingThisWeekCount > 0) items.push({ label: "Due This Week", value: s.upcomingThisWeekCount, color: "text-blue-700 bg-blue-50 border-blue-200", href: "/engineering/tasks?dueDate=this_week" });
    return items;
  }, [data?.summary]);

  const summary = data?.summary;
  const blockers = data?.blockers;
  const recentlyCompleted = data?.recentlyCompleted ?? [];
  const upcomingThisWeek = data?.upcomingThisWeek ?? [];
  const needsApproval = data?.needsApproval ?? [];
  const inProgressHighlights = data?.inProgressHighlights ?? [];
  const otherActive = data?.otherActive ?? [];
  const workload = data?.workload ?? [];
  const projectHealth = data?.projectHealth ?? [];
  const statusPipeline = data?.statusPipeline ?? {};
  const totalBlockers = (blockers?.hold?.length ?? 0) + (blockers?.overdue?.length ?? 0);

  const todayFormatted = new Date().toLocaleDateString("en-ZA", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  const handleCopyDailyForTeams = useCallback(async () => {
    const lines: string[] = [];
    const htmlSections: string[] = [];

    lines.push(`🛠️ Engineering Daily — ${todayFormatted}`);
    htmlSections.push(`<p><strong>🛠️ Engineering Daily — ${escapeHtml(todayFormatted)}</strong></p>`);

    const s = summary;
    if (s) {
      const stat = `Active ${s.activeTasks} · Overdue ${s.overdueTasks} · On hold ${s.holdTasks} · Needs approval ${s.needsApprovalCount} · Due this week ${s.upcomingThisWeekCount}`;
      lines.push(stat);
      htmlSections.push(`<p><em>${escapeHtml(stat)}</em></p>`);
    }

    if ((blockers?.overdue?.length ?? 0) > 0) {
      lines.push("");
      lines.push("🚨 Overdue:");
      const overdueItems = (blockers?.overdue || []).slice(0, 10);
      for (const t of overdueItems) {
        const owner = t.assignees?.[0] || "Unassigned";
        lines.push(`  • ${owner} — ${t.title} (${displayProject(t.projectName)})`);
      }
      const overdueHtml = overdueItems
        .map((t) => {
          const owner = t.assignees?.[0] || "Unassigned";
          return `<li><strong>${escapeHtml(owner)}</strong> — ${escapeHtml(t.title)} <em>(${escapeHtml(displayProject(t.projectName))})</em></li>`;
        })
        .join("");
      htmlSections.push(`<p><strong>🚨 Overdue</strong></p><ul>${overdueHtml}</ul>`);
    }

    if ((blockers?.hold?.length ?? 0) > 0) {
      lines.push("");
      lines.push("🚧 On hold:");
      const holdItems = (blockers?.hold || []).slice(0, 10);
      for (const t of holdItems) {
        const owner = t.assignees?.[0] || "Unassigned";
        const reason = t.holdReason || t.blockerReason || "";
        lines.push(`  • ${owner} — ${t.title}${reason ? ` (${reason})` : ""}`);
      }
      const holdHtml = holdItems
        .map((t) => {
          const owner = t.assignees?.[0] || "Unassigned";
          const reason = t.holdReason || t.blockerReason || "";
          return `<li><strong>${escapeHtml(owner)}</strong> — ${escapeHtml(t.title)}${reason ? ` <em>(${escapeHtml(reason)})</em>` : ""}</li>`;
        })
        .join("");
      htmlSections.push(`<p><strong>🚧 On hold</strong></p><ul>${holdHtml}</ul>`);
    }

    if (needsApproval.length > 0) {
      lines.push("");
      lines.push("✅ Needs approval:");
      const items = needsApproval.slice(0, 10);
      for (const t of items) {
        const owner = t.assignees?.[0] || "Unassigned";
        lines.push(`  • ${owner} — ${t.title} (${displayProject(t.projectName)})`);
      }
      const html = items
        .map((t) => `<li><strong>${escapeHtml(t.assignees?.[0] || "Unassigned")}</strong> — ${escapeHtml(t.title)} <em>(${escapeHtml(displayProject(t.projectName))})</em></li>`)
        .join("");
      htmlSections.push(`<p><strong>✅ Needs approval</strong></p><ul>${html}</ul>`);
    }

    try {
      await copyTeamsMessage({ html: htmlSections.join("\n"), plain: lines.join("\n") });
      toast({ title: "Copied for Teams", description: "Paste into the Engineering chat." });
    } catch (err: any) {
      toast({ title: "Copy failed", description: err?.message || "Clipboard unavailable.", variant: "destructive" });
    }
  }, [blockers, needsApproval, summary, todayFormatted, toast]);

  if (isLoading) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="eng-dashboard">
        <SectionHeader
          icon={<Wrench className="h-5 w-5" />}
          title="Engineering Overview & Team Ops"
          description="Loading team operations data..."
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

  if (isError || !data || !summary) {
    return (
      <PageShell className="p-4 md:p-6" data-testid="eng-dashboard">
        <PageError title="Unable to load Engineering Dashboard" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} />
      </PageShell>
    );
  }

  return (
    <ErrorBoundary>
    <PageShell className="p-4 md:p-6" data-testid="eng-dashboard">
      <SectionHeader
        icon={<Wrench className="h-5 w-5" />}
        title={showAllTasks ? "Engineering Overview & Team Ops" : `${firstName}'s Dashboard`}
        description={todayFormatted}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-md">
            <Wrench className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-heading font-bold tracking-tight" data-testid="text-standup-title">
              {showAllTasks ? "Engineering Overview & Team Ops" : `${firstName}'s Dashboard`}
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
          {isAdmin && (
            <Link href="/engineering/audit">
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="btn-audit-log">
                <Activity className="h-3.5 w-3.5" />
                Audit Log
              </Button>
            </Link>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 border-[#5059C9] text-[#5059C9] hover:bg-[#5059C9]/10 hover:text-[#464EB8]"
            onClick={handleCopyDailyForTeams}
            data-testid="btn-copy-daily-for-teams"
            title="Copy today's blockers, overdue, and approvals as a Teams-friendly message"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Copy for Teams
          </Button>
          {totalBlockers > 0 && (
            <div className="flex items-center gap-1.5 text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg text-xs font-bold" data-testid="blocker-alert">
              <ShieldAlert className="h-3.5 w-3.5" />
              {totalBlockers} blocker{totalBlockers !== 1 ? "s" : ""}
            </div>
          )}
          {firstName && isManagerRole && (
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

      <AttentionBadges items={engAttentionItems} threshold={5} testId="eng-attention-needed" />
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
          {blockers && blockers.overdue.length > 0 && (
            <div>
              <div className="px-3 py-2 bg-gradient-to-r from-red-50 to-transparent text-[10px] font-bold text-red-700 uppercase tracking-wider flex items-center gap-1.5 border-b">
                <AlertTriangle className="h-3 w-3" />
                Overdue ({blockers.overdue.length})
              </div>
              {blockers.overdue.map(t => <TaskRow key={t.id} task={t} />)}
            </div>
          )}
          {blockers && blockers.hold.length > 0 && (
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
          <p className="text-xs text-muted-foreground p-4">No tasks due this week — all clear for the next 7 days.</p>
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
          <p className="text-xs text-muted-foreground p-4">No tasks currently in progress. Check the task board for items to pick up.</p>
        )}
      </CollapsibleSection>

      {otherActive.length > 0 && (
        <CollapsibleSection
          title="Other Active Tasks"
          icon={<ListTodo className="h-4 w-4" />}
          count={otherActive.length}
          color="text-slate-600"
          defaultOpen={true}
          testId="section-other-active"
        >
          {otherActive.map(t => <TaskRow key={t.id} task={t} />)}
        </CollapsibleSection>
      )}

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
                return Object.entries(statusPipeline)
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

      <ActivityFeed />

      {/* Stages Progress Matrix (#8) */}
      {projectHealth.length > 0 && (
        <Card className="shadow-sm" data-testid="section-stages-matrix">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
              <LayoutGrid className="h-4 w-4 text-violet-600" />
            </div>
            <span className="font-semibold text-sm">Stages Progress Matrix</span>
            <span className="text-[10px] text-muted-foreground ml-auto">{projectHealth.length} projects</span>
          </div>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/20">
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground min-w-[150px]">Project</th>
                    <th className="text-center px-2 py-2 font-semibold text-muted-foreground">Phase</th>
                    <th className="text-center px-2 py-2 font-semibold text-muted-foreground min-w-[120px]">Progress</th>
                    <th className="text-center px-2 py-2 font-semibold text-muted-foreground">Active</th>
                    <th className="text-center px-2 py-2 font-semibold text-muted-foreground">Hold</th>
                    <th className="text-center px-2 py-2 font-semibold text-muted-foreground">Overdue</th>
                    <th className="text-center px-2 py-2 font-semibold text-muted-foreground">RAG</th>
                  </tr>
                </thead>
                <tbody>
                  {projectHealth
                    .sort((a, b) => {
                      const ragOrder: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2 };
                      return (ragOrder[a.rag] ?? 3) - (ragOrder[b.rag] ?? 3) || b.completion - a.completion;
                    })
                    .map(p => (
                    <tr key={p.projectName} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 font-medium truncate max-w-[180px]">{p.displayName}</td>
                      <td className="px-2 py-2 text-center">
                        <span className="px-2 py-0.5 rounded-full bg-muted text-[9px] font-medium">{p.phaseLabel || p.phase || "—"}</span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted/60 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${p.rag === "RED" ? "bg-red-400" : p.rag === "AMBER" ? "bg-amber-400" : "bg-emerald-400"}`}
                              style={{ width: `${p.completion}%` }}
                            />
                          </div>
                          <span className="font-mono text-[10px] w-8 text-right font-bold">{p.completion}%</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center font-mono font-bold">{p.active}</td>
                      <td className="px-2 py-2 text-center font-mono font-bold">{p.hold > 0 ? <span className="text-amber-600">{p.hold}</span> : "—"}</td>
                      <td className="px-2 py-2 text-center font-mono font-bold">{p.overdue > 0 ? <span className="text-red-600">{p.overdue}</span> : "—"}</td>
                      <td className="px-2 py-2 text-center">
                        <span className={`w-3 h-3 rounded-full inline-block ${p.rag === "RED" ? "bg-red-500" : p.rag === "AMBER" ? "bg-amber-500" : "bg-emerald-500"}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* D3 controlled-document approvals waiting on this Engineering Manager */}
      <div className="mt-6">
        <ApprovalQueueCard />
      </div>
    </PageShell>
    </ErrorBoundary>
  );
}
