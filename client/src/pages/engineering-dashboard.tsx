import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { TASK_STATUSES, TASK_PRIORITIES } from "@shared/schema";
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
} from "lucide-react";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";

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
  P0_FIRST_ASSESSMENT: { bg: "bg-slate-50", text: "text-slate-700", accent: "bg-slate-500" },
  P1_COST_PROPOSAL_DESIGN: { bg: "bg-violet-50", text: "text-violet-700", accent: "bg-violet-500" },
  P2_PD_PM_HANDOVER: { bg: "bg-indigo-50", text: "text-indigo-700", accent: "bg-indigo-500" },
  P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-blue-50", text: "text-blue-700", accent: "bg-blue-500" },
  P4_CONSTRUCTION_INSTALLATION: { bg: "bg-amber-50", text: "text-amber-700", accent: "bg-amber-500" },
  P5_COMMISSIONING_TESTING: { bg: "bg-orange-50", text: "text-orange-700", accent: "bg-orange-500" },
  P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-teal-50", text: "text-teal-700", accent: "bg-teal-500" },
  P7_CLOSEOUT_POSTMORTEM: { bg: "bg-emerald-50", text: "text-emerald-700", accent: "bg-emerald-500" },
};

const statusBadge: Record<string, string> = {
  "TO DO": "bg-gray-100 text-gray-700",
  "IN PROGRESS": "bg-blue-100 text-blue-700",
  "HOLD": "bg-red-100 text-red-700",
  "NEEDS APPROVAL": "bg-amber-100 text-amber-700",
  "QC APPROVED": "bg-emerald-100 text-emerald-700",
  "PROVIDE FEEDBACK": "bg-purple-100 text-purple-700",
  "OPERATIONAL APPROVAL": "bg-indigo-100 text-indigo-700",
  "PROJECTS ASSISTANCE": "bg-cyan-100 text-cyan-700",
  "COMPLETE": "bg-green-100 text-green-700",
};

const priorityColors: Record<string, string> = {
  "Urgent": "text-red-600",
  "High": "text-orange-600",
  "Med": "text-yellow-600",
  "Low": "text-gray-500",
};

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

function displayProject(name: string) {
  return name.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
}

function TaskRow({ task, showProject = true }: { task: StandupTask; showProject?: boolean }) {
  const [, setLocation] = useLocation();
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "COMPLETE";

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 hover:bg-muted/30 transition-colors text-xs group cursor-pointer"
      onClick={() => setLocation(`/engineering/tasks?taskId=${task.id}`)}
      data-testid={`standup-task-${task.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`font-medium truncate ${priorityColors[task.priority] || ""}`}>
            {task.title}
          </span>
        </div>
        {showProject && (
          <span className="text-[10px] text-muted-foreground">{displayProject(task.projectName)}</span>
        )}
        {(task.holdReason || task.blockerReason) && (
          <p className="text-[10px] text-red-500 mt-0.5 truncate">
            {task.holdReason || task.blockerReason}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {task.assignees?.[0] && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 max-w-[70px] truncate">
            <User className="h-3 w-3 shrink-0" />
            {task.assignees[0]}
          </span>
        )}
        {task.dueDate && (
          <span className={`text-[10px] flex items-center gap-0.5 ${isOverdue ? "text-red-600 font-bold" : "text-muted-foreground"}`}>
            <Calendar className="h-3 w-3 shrink-0" />
            {daysFromNow(task.dueDate)}
          </span>
        )}
        <Badge className={`text-[9px] px-1.5 py-0 ${statusBadge[task.status] || "bg-gray-100"}`}>
          {task.status}
        </Badge>
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

  return (
    <Card className="overflow-hidden" data-testid={testId}>
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setOpen(!open)}
        data-testid={`toggle-${testId}`}
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <span className={`shrink-0 ${color}`}>{icon}</span>
        <span className="font-semibold text-sm flex-1">{title}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color} bg-opacity-10`}>{count}</span>
        {badge}
      </button>
      {open && <div className="border-t">{children}</div>}
    </Card>
  );
}

function KpiStrip({ summary }: { summary: StandupData["summary"] }) {
  const stats = [
    { label: "Projects", value: summary.totalProjects, icon: <Layers className="w-4 h-4" />, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Active", value: summary.activeTasks, icon: <ListTodo className="w-4 h-4" />, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Overdue", value: summary.overdueTasks, icon: <AlertTriangle className="w-4 h-4" />, color: summary.overdueTasks > 0 ? "text-red-600" : "text-muted-foreground", bg: summary.overdueTasks > 0 ? "bg-red-50" : "bg-muted" },
    { label: "On Hold", value: summary.holdTasks, icon: <PauseCircle className="w-4 h-4" />, color: summary.holdTasks > 0 ? "text-amber-600" : "text-muted-foreground", bg: summary.holdTasks > 0 ? "bg-amber-50" : "bg-muted" },
    { label: "Approvals", value: summary.needsApprovalCount, icon: <ShieldAlert className="w-4 h-4" />, color: summary.needsApprovalCount > 0 ? "text-purple-600" : "text-muted-foreground", bg: summary.needsApprovalCount > 0 ? "bg-purple-50" : "bg-muted" },
    { label: "Due This Week", value: summary.upcomingThisWeekCount, icon: <Timer className="w-4 h-4" />, color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "Done (24h)", value: summary.recentlyCompletedCount, icon: <CheckCircle2 className="w-4 h-4" />, color: "text-emerald-600", bg: "bg-emerald-50" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2" data-testid="standup-kpi-strip">
      {stats.map(s => (
        <Card key={s.label} className="overflow-hidden">
          <CardContent className="p-3 flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
              <span className={s.color}>{s.icon}</span>
            </div>
            <div className="min-w-0">
              <p className={`text-lg font-bold leading-tight ${s.color}`} data-testid={`kpi-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>{s.value}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide truncate">{s.label}</p>
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" data-testid="project-health-grid">
      {projects.map(p => {
        const colors = PHASE_COLORS[p.phase] || PHASE_COLORS.P0_FIRST_ASSESSMENT;
        return (
          <Card
            key={p.projectName}
            className={`overflow-hidden border-l-4 ${ragBorder[p.rag]} hover:shadow-md transition-all cursor-pointer`}
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
                  <p className="font-semibold text-sm truncate">{p.displayName}</p>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${colors.bg} ${colors.text}`}>
                    {p.phaseLabel}
                  </span>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ragBg[p.rag]} ${ragText[p.rag]}`}>
                  {p.rag}
                </span>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${p.completion >= 80 ? "bg-emerald-500" : p.completion >= 40 ? "bg-blue-500" : "bg-slate-400"}`}
                    style={{ width: `${Math.min(p.completion, 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">{p.completion}%</span>
              </div>

              <div className="flex gap-3 text-[10px]">
                <span className="text-muted-foreground">{p.active} active</span>
                {p.overdue > 0 && <span className="text-red-600 font-bold">{p.overdue} overdue</span>}
                {p.hold > 0 && <span className="text-amber-600 font-semibold">{p.hold} hold</span>}
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

  return (
    <div className="overflow-x-auto" data-testid="workload-table">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
            <th className="text-left px-3 py-2 font-medium">Person</th>
            <th className="text-center px-2 py-2 font-medium">Active</th>
            <th className="text-center px-2 py-2 font-medium">Due This Wk</th>
            <th className="text-center px-2 py-2 font-medium">Overdue</th>
            <th className="text-center px-2 py-2 font-medium">On Hold</th>
          </tr>
        </thead>
        <tbody>
          {workload.map(w => (
            <tr key={w.name} className="border-b last:border-b-0 hover:bg-muted/20" data-testid={`workload-row-${w.name}`}>
              <td className="px-3 py-2 font-medium flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {w.name}
              </td>
              <td className="text-center px-2 py-2">{w.active}</td>
              <td className="text-center px-2 py-2 text-indigo-600 font-semibold">{w.dueThisWeek}</td>
              <td className={`text-center px-2 py-2 ${w.overdue > 0 ? "text-red-600 font-bold" : ""}`}>{w.overdue}</td>
              <td className={`text-center px-2 py-2 ${w.hold > 0 ? "text-amber-600 font-semibold" : ""}`}>{w.hold}</td>
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
    const names = t.assignees && t.assignees.length > 0 ? t.assignees.filter(Boolean) : ["Unassigned"];
    for (const name of names) {
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(t);
    }
  }
  const sorted = new Map([...map.entries()].sort(([a], [b]) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  }));
  return sorted;
}

function InlineTaskRow({ task, onUpdate }: { task: FullTask; onUpdate: (id: number, updates: Record<string, any>) => void }) {
  const [, setLocation] = useLocation();
  const [quickNote, setQuickNote] = useState("");
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "COMPLETE";
  const { toast } = useToast();

  const handleQuickNote = async () => {
    if (!quickNote.trim()) return;
    try {
      await engPost(`/api/eng/tasks/${task.id}/comments`, { body: `[Quick Note] ${quickNote.trim()}` });
      setQuickNote("");
      toast({ title: "Note posted" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div
      className="border-b last:border-b-0 hover:bg-muted/30 transition-colors text-xs"
      data-testid={`standup-inline-task-${task.id}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`font-medium truncate ${priorityColors[task.priority] || ""}`}>
              {task.title}
            </span>
            {task.blockedType && (
              <Badge className={`text-[8px] px-1 py-0 ${task.blockedType === "External" ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-700"}`}>
                {task.blockedType}
              </Badge>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">{displayProject(task.projectName)}</span>
          {(task.holdReason || task.blockerReason) && (
            <p className="text-[10px] text-red-500 mt-0.5 truncate">{task.holdReason || task.blockerReason}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Select
            value={task.priority}
            onValueChange={(val) => onUpdate(task.id, { priority: val })}
          >
            <SelectTrigger className="h-6 w-[60px] text-[10px] px-1.5" data-testid={`priority-select-${task.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map(p => (
                <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={task.status}
            onValueChange={(val) => onUpdate(task.id, { status: val })}
          >
            <SelectTrigger className="h-6 w-[100px] text-[10px] px-1.5" data-testid={`status-select-${task.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map(s => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="date"
            value={task.dueDate || ""}
            onChange={(e) => onUpdate(task.id, { dueDate: e.target.value || null })}
            className="h-6 w-[110px] text-[10px] px-1.5"
            data-testid={`due-date-input-${task.id}`}
          />

          {task.dueDate && (
            <span className={`text-[10px] w-[50px] text-right ${isOverdue ? "text-red-600 font-bold" : "text-muted-foreground"}`}>
              {daysFromNow(task.dueDate)}
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={(e) => { e.stopPropagation(); setLocation(`/engineering/tasks?taskId=${task.id}`); }}
            data-testid={`open-detail-${task.id}`}
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3 pb-2">
        <Input
          placeholder="Quick note..."
          value={quickNote}
          onChange={(e) => setQuickNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleQuickNote(); }}
          className="h-5 text-[10px] flex-1"
          data-testid={`quick-note-input-${task.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={handleQuickNote}
          disabled={!quickNote.trim()}
          data-testid={`quick-note-send-${task.id}`}
        >
          <Send className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function AssigneeGroup({ name, tasks, onUpdate, defaultOpen }: { name: string; tasks: FullTask[]; onUpdate: (id: number, updates: Record<string, any>) => void; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div data-testid={`assignee-group-${name}`}>
      <button
        className="w-full flex items-center gap-2 px-4 py-1.5 text-left hover:bg-muted/20 transition-colors bg-muted/10"
        onClick={() => setOpen(!open)}
        data-testid={`toggle-assignee-${name}`}
      >
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        <User className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium text-xs">{name}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{tasks.length} task{tasks.length !== 1 ? "s" : ""}</span>
      </button>
      {open && (
        <div>
          {tasks.sort(sortByPriorityThenDue).map(t => (
            <InlineTaskRow key={t.id} task={t} onUpdate={onUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}

function StandupBucket({
  title, icon, tasks, color, defaultOpen, testId, onUpdate,
}: {
  title: string;
  icon: React.ReactNode;
  tasks: FullTask[];
  color: string;
  defaultOpen: boolean;
  testId: string;
  onUpdate: (id: number, updates: Record<string, any>) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const grouped = groupByAssignee(tasks);

  if (tasks.length === 0) return null;

  return (
    <Card className="overflow-hidden" data-testid={testId}>
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setOpen(!open)}
        data-testid={`toggle-${testId}`}
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <span className={`shrink-0 ${color}`}>{icon}</span>
        <span className="font-semibold text-sm flex-1">{title}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color} bg-opacity-10`}>{tasks.length}</span>
      </button>
      {open && (
        <div className="border-t">
          {[...grouped.entries()].map(([name, assigneeTasks]) => (
            <AssigneeGroup
              key={name}
              name={name}
              tasks={assigneeTasks}
              onUpdate={onUpdate}
              defaultOpen={grouped.size <= 5}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function StandupModeView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const blockersRef = useRef<HTMLDivElement>(null);

  const { data: allTasks = [], isLoading } = useQuery<FullTask[]>({
    queryKey: ["eng-standup-all-tasks"],
    queryFn: () => engFetch("/api/eng/tasks"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Record<string, any> }) =>
      engPatch(`/api/eng/tasks/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-standup-all-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["eng-standup"] });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const handleUpdate = useCallback((id: number, updates: Record<string, any>) => {
    updateMutation.mutate({ id, updates });
  }, [updateMutation]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
      </div>
    );
  }

  const today = new Date().toISOString().split("T")[0];
  const sevenDays = new Date();
  sevenDays.setDate(sevenDays.getDate() + 7);
  const weekEnd = sevenDays.toISOString().split("T")[0];

  const nonComplete = allTasks.filter(t => t.status !== "COMPLETE");

  const overdueTasks = nonComplete.filter(t => t.dueDate && t.dueDate < today);
  const overduIds = new Set(overdueTasks.map(t => t.id));

  const dueSoonTasks = nonComplete.filter(t =>
    t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd && !overduIds.has(t.id)
  );
  const dueSoonIds = new Set(dueSoonTasks.map(t => t.id));

  const holdTasks = nonComplete.filter(t => t.status === "HOLD" && !overduIds.has(t.id));
  const holdIds = new Set(holdTasks.map(t => t.id));

  const inProgressTasks = nonComplete.filter(t =>
    t.status === "IN PROGRESS" && !overduIds.has(t.id) && !dueSoonIds.has(t.id) && !holdIds.has(t.id)
  );
  const inProgressIds = new Set(inProgressTasks.map(t => t.id));

  const everythingElse = nonComplete.filter(t =>
    !overduIds.has(t.id) && !dueSoonIds.has(t.id) && !holdIds.has(t.id) && !inProgressIds.has(t.id)
  );

  const blockerCount = overdueTasks.length + holdTasks.length;

  const scrollToBlockers = () => {
    blockersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-4">
      {blockerCount > 0 && (
        <button
          onClick={scrollToBlockers}
          className="flex items-center gap-1.5 text-red-600 bg-red-50 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors w-fit"
          data-testid="standup-blocker-badge"
        >
          <ShieldAlert className="h-4 w-4" />
          {blockerCount} blocker{blockerCount !== 1 ? "s" : ""} need attention
        </button>
      )}

      <div ref={blockersRef}>
        <StandupBucket
          title="Overdue"
          icon={<AlertTriangle className="h-4 w-4" />}
          tasks={overdueTasks}
          color="text-red-600"
          defaultOpen={true}
          testId="standup-bucket-overdue"
          onUpdate={handleUpdate}
        />
      </div>

      <StandupBucket
        title="Due Soon (7 days)"
        icon={<Timer className="h-4 w-4" />}
        tasks={dueSoonTasks}
        color="text-indigo-600"
        defaultOpen={true}
        testId="standup-bucket-due-soon"
        onUpdate={handleUpdate}
      />

      <StandupBucket
        title="On Hold"
        icon={<PauseCircle className="h-4 w-4" />}
        tasks={holdTasks}
        color="text-amber-600"
        defaultOpen={true}
        testId="standup-bucket-hold"
        onUpdate={handleUpdate}
      />

      <StandupBucket
        title="In Progress"
        icon={<Zap className="h-4 w-4" />}
        tasks={inProgressTasks}
        color="text-blue-600"
        defaultOpen={false}
        testId="standup-bucket-in-progress"
        onUpdate={handleUpdate}
      />

      <StandupBucket
        title="Everything Else"
        icon={<ListTodo className="h-4 w-4" />}
        tasks={everythingElse}
        color="text-gray-600"
        defaultOpen={false}
        testId="standup-bucket-everything-else"
        onUpdate={handleUpdate}
      />
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
      <div data-testid="eng-dashboard" className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center">
            <Wrench className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-heading font-bold">Engineering Dashboard</h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading your tasks...
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          {[1,2,3,4,5,6,7].map(i => <div key={i} className="h-[72px] bg-muted animate-pulse rounded-xl" />)}
        </div>
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div data-testid="eng-dashboard" className="flex items-center justify-center py-20">
        <div className="text-center">
          <AlertTriangle className="h-10 w-10 text-red-400 mx-auto mb-2" />
          <p className="font-medium">Failed to load dashboard data</p>
          <p className="text-sm text-muted-foreground mt-1">{(error as Error)?.message || "Unknown error"}</p>
        </div>
      </div>
    );
  }

  const { summary, blockers, recentlyCompleted, upcomingThisWeek, needsApproval, inProgressHighlights, workload, projectHealth } = data;
  const totalBlockers = blockers.hold.length + blockers.overdue.length;

  const todayFormatted = new Date().toLocaleDateString("en-ZA", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  return (
    <div data-testid="eng-dashboard" className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-sm">
            <Wrench className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-heading font-bold" data-testid="text-standup-title">
              {standupMode ? "Engineering Standup Mode" : showAllTasks ? "Engineering Standup" : `${firstName}'s Dashboard`}
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              {todayFormatted}
              {!showAllTasks && firstName && (
                <span className="ml-1 flex items-center gap-1 text-blue-600">
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
              className={`h-7 text-xs gap-1 ${standupMode ? "bg-orange-600 hover:bg-orange-700" : ""}`}
              onClick={() => setStandupMode(!standupMode)}
              data-testid="toggle-standup-mode"
            >
              <LayoutGrid className="h-3 w-3" />
              {standupMode ? "Exit Standup" : "Standup Mode"}
            </Button>
          )}
          {!standupMode && firstName && isManagerRole && (
            <Button
              variant={showAllTasks ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowAllTasks(!showAllTasks)}
              data-testid="toggle-all-tasks"
            >
              {showAllTasks ? (
                <><UserCheck className="h-3 w-3" /> My Tasks</>
              ) : (
                <><Eye className="h-3 w-3" /> All Tasks</>
              )}
            </Button>
          )}
          {!standupMode && totalBlockers > 0 && (
            <div className="flex items-center gap-1.5 text-red-600 bg-red-50 px-3 py-1.5 rounded-lg text-xs font-semibold" data-testid="blocker-alert">
              <ShieldAlert className="h-4 w-4" />
              {totalBlockers} blocker{totalBlockers !== 1 ? "s" : ""} need attention
            </div>
          )}
        </div>
      </div>

      {standupMode ? (
        <StandupModeView />
      ) : (
      <>
      <CompanyPrioritiesSection />

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
          {blockers.hold.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-red-50/50 text-[10px] font-semibold text-red-700 uppercase tracking-wider flex items-center gap-1">
                <PauseCircle className="h-3 w-3" />
                On Hold ({blockers.hold.length})
              </div>
              {blockers.hold.map(t => <TaskRow key={t.id} task={t} />)}
            </div>
          )}
          {blockers.overdue.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-amber-50/50 text-[10px] font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Overdue ({blockers.overdue.length})
              </div>
              {blockers.overdue.map(t => <TaskRow key={t.id} task={t} />)}
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
        <Card data-testid="section-workload">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <Users className="h-4 w-4 text-indigo-600" />
            <span className="font-semibold text-sm">Team Workload</span>
            <span className="text-xs text-muted-foreground ml-auto">{workload.length} members</span>
          </div>
          <WorkloadTable workload={workload} />
        </Card>

        <Card data-testid="section-pipeline">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <span className="font-semibold text-sm">Status Pipeline</span>
          </div>
          <CardContent className="p-4">
            <div className="space-y-2">
              {(() => {
                const statusOrder = ["TO DO", "IN PROGRESS", "NEEDS APPROVAL", "QC APPROVED", "PROVIDE FEEDBACK", "PROJECTS ASSISTANCE", "HOLD", "COMPLETE"];
                const statusColors: Record<string, string> = {
                  "COMPLETE": "bg-emerald-400",
                  "HOLD": "bg-red-400",
                  "IN PROGRESS": "bg-blue-400",
                  "NEEDS APPROVAL": "bg-amber-400",
                  "QC APPROVED": "bg-teal-400",
                  "PROVIDE FEEDBACK": "bg-orange-400",
                  "TO DO": "bg-slate-400",
                  "PROJECTS ASSISTANCE": "bg-purple-400",
                };
                return Object.entries(data.statusPipeline)
                  .sort(([a], [b]) => {
                    const ai = statusOrder.indexOf(a);
                    const bi = statusOrder.indexOf(b);
                    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                  })
                  .map(([status, count]) => {
                    const total = summary.totalTasks || 1;
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={status} className="flex items-center gap-2 text-xs">
                        <span className="w-[90px] sm:w-[130px] truncate text-muted-foreground">{status}</span>
                        <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${statusColors[status] || "bg-slate-300"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="font-mono w-8 text-right font-semibold">{count}</span>
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
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Project Health</h3>
          <span className="text-xs text-muted-foreground">
            {projectHealth.filter(p => p.rag === "RED").length} red
            {" / "}
            {projectHealth.filter(p => p.rag === "AMBER").length} amber
            {" / "}
            {projectHealth.filter(p => p.rag === "GREEN").length} green
          </span>
        </div>
        <ProjectHealthGrid projects={projectHealth} />
      </div>
      </>
      )}
    </div>
  );
}
