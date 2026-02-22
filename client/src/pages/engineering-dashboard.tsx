import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
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

export default function EngineeringDashboard() {
  const { data, isLoading, error } = useQuery<StandupData>({
    queryKey: ["eng-standup"],
    queryFn: () => engFetch("/api/eng/dashboard/standup"),
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
            <h2 className="text-xl sm:text-2xl font-heading font-bold">Engineering Standup</h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading standup data...
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
          <p className="font-medium">Failed to load standup data</p>
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
              Engineering Standup
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              {todayFormatted}
            </p>
          </div>
        </div>
        {totalBlockers > 0 && (
          <div className="flex items-center gap-1.5 text-red-600 bg-red-50 px-3 py-1.5 rounded-lg text-xs font-semibold" data-testid="blocker-alert">
            <ShieldAlert className="h-4 w-4" />
            {totalBlockers} blocker{totalBlockers !== 1 ? "s" : ""} need attention
          </div>
        )}
      </div>

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
              {Object.entries(data.statusPipeline)
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => {
                  const total = summary.totalTasks || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={status} className="flex items-center gap-2 text-xs">
                      <span className="w-[90px] sm:w-[130px] truncate text-muted-foreground">{status}</span>
                      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            status === "COMPLETE" ? "bg-emerald-400" :
                            status === "HOLD" ? "bg-red-400" :
                            status === "IN PROGRESS" ? "bg-blue-400" :
                            status === "NEEDS APPROVAL" ? "bg-amber-400" :
                            "bg-slate-300"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono w-8 text-right font-semibold">{count}</span>
                    </div>
                  );
                })}
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
    </div>
  );
}
