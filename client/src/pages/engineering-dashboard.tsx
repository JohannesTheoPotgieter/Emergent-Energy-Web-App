import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  Wrench,
  Search,
  Calendar,
  ChevronDown,
  ChevronRight,
  Loader2,
  User,
  Circle,
  BarChart3,
  Clock,
  CheckCircle2,
  PauseCircle,
  ArrowRight,
  ListTodo,
  TrendingUp,
  Layers,
} from "lucide-react";
import { PROJECT_PHASES, PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";

async function engFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface ProjectTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignees: string[] | null;
  trackingRag: string | null;
}

interface ProjectData {
  projectName: string;
  displayName: string;
  phase: string;
  phaseLabel: string;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  overdueTasks: number;
  holdTasks: number;
  tasks: ProjectTask[];
}

const statusDot: Record<string, string> = {
  "TO DO": "text-gray-400",
  "IN PROGRESS": "text-blue-500",
  "HOLD": "text-red-500",
  "NEEDS APPROVAL": "text-amber-500",
  "QC APPROVED": "text-emerald-500",
  "PROVIDE FEEDBACK": "text-purple-500",
  "OPERATIONAL APPROVAL": "text-indigo-500",
  "PROJECTS ASSISTANCE": "text-cyan-500",
  "COMPLETE": "text-green-500",
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

const PHASE_COLORS: Record<string, { bg: string; text: string; accent: string; ring: string }> = {
  P0_FIRST_ASSESSMENT: { bg: "bg-slate-50", text: "text-slate-700", accent: "bg-slate-500", ring: "ring-slate-200" },
  P1_COST_PROPOSAL_DESIGN: { bg: "bg-violet-50", text: "text-violet-700", accent: "bg-violet-500", ring: "ring-violet-200" },
  P2_PD_PM_HANDOVER: { bg: "bg-indigo-50", text: "text-indigo-700", accent: "bg-indigo-500", ring: "ring-indigo-200" },
  P3_DETAILED_DESIGN_PROC_RELEASE: { bg: "bg-blue-50", text: "text-blue-700", accent: "bg-blue-500", ring: "ring-blue-200" },
  P4_CONSTRUCTION_INSTALLATION: { bg: "bg-amber-50", text: "text-amber-700", accent: "bg-amber-500", ring: "ring-amber-200" },
  P5_COMMISSIONING_TESTING: { bg: "bg-orange-50", text: "text-orange-700", accent: "bg-orange-500", ring: "ring-orange-200" },
  P6_HANDOVER_CLIENT_MATRIARCH: { bg: "bg-teal-50", text: "text-teal-700", accent: "bg-teal-500", ring: "ring-teal-200" },
  P7_CLOSEOUT_POSTMORTEM: { bg: "bg-emerald-50", text: "text-emerald-700", accent: "bg-emerald-500", ring: "ring-emerald-200" },
};

function getPhaseShort(phase: string): string {
  const label = PROJECT_PHASE_LABELS[phase as ProjectPhase];
  if (!label) return phase;
  const match = label.match(/^Phase (\d)/);
  return match ? `P${match[1]}` : label;
}

function formatDate(d: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
  } catch { return d; }
}

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function ProjectCard({ project }: { project: ProjectData }) {
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();
  const hasOverdue = project.overdueTasks > 0;
  const colors = PHASE_COLORS[project.phase] || PHASE_COLORS.P0_FIRST_ASSESSMENT;
  const completion = project.totalTasks > 0
    ? Math.round((project.completedTasks / project.totalTasks) * 100)
    : 0;

  return (
    <Card
      className={`overflow-hidden transition-all hover:shadow-md ${hasOverdue ? "ring-1 ring-red-200" : ""}`}
      data-testid={`project-card-${project.projectName}`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="font-semibold text-sm hover:text-blue-600 hover:underline truncate text-left"
                onClick={() => {
                  const name = project.projectName.replace(/ /g, "_");
                  const trackerName = name.endsWith("_Tracker") ? name : name + "_Tracker";
                  setLocation(`/project/${encodeURIComponent(trackerName)}`);
                }}
                data-testid={`link-project-${project.projectName}`}
              >
                {project.displayName}
              </button>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
                {getPhaseShort(project.phase)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasOverdue && (
              <span className="flex items-center gap-1 text-[10px] text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded-md">
                <AlertTriangle className="h-3 w-3" />
                {project.overdueTasks}
              </span>
            )}
            {project.holdTasks > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded-md">
                <PauseCircle className="h-3 w-3" />
                {project.holdTasks}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${completion >= 80 ? "bg-emerald-500" : completion >= 40 ? "bg-blue-500" : "bg-slate-400"}`}
              style={{ width: `${Math.min(completion, 100)}%` }}
            />
          </div>
          <span className="text-xs font-mono text-muted-foreground w-8 text-right">{completion}%</span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="rounded-md bg-muted/40 py-1.5">
            <p className="font-bold text-sm text-foreground">{project.activeTasks}</p>
            <p className="text-muted-foreground">Active</p>
          </div>
          <div className="rounded-md bg-muted/40 py-1.5">
            <p className="font-bold text-sm text-emerald-600">{project.completedTasks}</p>
            <p className="text-muted-foreground">Done</p>
          </div>
          <div className="rounded-md bg-muted/40 py-1.5">
            <p className="font-bold text-sm text-foreground">{project.totalTasks}</p>
            <p className="text-muted-foreground">Total</p>
          </div>
        </div>

        {project.tasks.length > 0 && (
          <button
            className="flex items-center gap-1 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            onClick={() => setExpanded(!expanded)}
            data-testid={`toggle-tasks-${project.projectName}`}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {project.tasks.length} open task{project.tasks.length !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {expanded && project.tasks.length > 0 && (
        <div className="border-t bg-muted/5">
          {project.tasks.slice(0, 10).map(task => (
            <div
              key={task.id}
              className="flex items-center gap-2.5 px-4 py-2 border-b last:border-b-0 hover:bg-muted/20 transition-colors text-xs"
              data-testid={`task-row-${task.id}`}
            >
              <Circle className={`h-2 w-2 fill-current shrink-0 ${statusDot[task.status] || "text-gray-400"}`} />
              <span className="flex-1 min-w-0 truncate">{task.title}</span>
              <Badge className={`text-[9px] px-1.5 py-0 shrink-0 ${statusBadge[task.status] || "bg-gray-100"}`}>
                {task.status}
              </Badge>
              {task.dueDate && (
                <span className={`text-[10px] flex items-center gap-0.5 shrink-0 ${isOverdue(task.dueDate) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                  <Calendar className="h-3 w-3" />
                  {formatDate(task.dueDate)}
                </span>
              )}
              {task.assignees && task.assignees[0] && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0 max-w-[80px] truncate">
                  <User className="h-3 w-3" />
                  {task.assignees[0]}
                </span>
              )}
            </div>
          ))}
          {project.tasks.length > 10 && (
            <div className="px-4 py-2 text-[10px] text-muted-foreground text-center border-t">
              +{project.tasks.length - 10} more tasks
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function PhasePipeline({ projects, phaseFilter, onPhaseClick }: {
  projects: ProjectData[];
  phaseFilter: string;
  onPhaseClick: (phase: string) => void;
}) {
  const phaseCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      counts.set(p.phase, (counts.get(p.phase) || 0) + 1);
    }
    return counts;
  }, [projects]);

  return (
    <div className="flex flex-wrap gap-1" data-testid="phase-pipeline">
      <button
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
          phaseFilter === "all"
            ? "bg-primary text-primary-foreground border-primary shadow-sm"
            : "bg-background hover:bg-muted border-border"
        }`}
        onClick={() => onPhaseClick("all")}
        data-testid="filter-phase-all"
      >
        All ({projects.length})
      </button>
      {PROJECT_PHASES.map(phase => {
        const count = phaseCounts.get(phase) || 0;
        if (count === 0) return null;
        const colors = PHASE_COLORS[phase] || PHASE_COLORS.P0_FIRST_ASSESSMENT;
        const isActive = phaseFilter === phase;
        return (
          <button
            key={phase}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
              isActive
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : `${colors.bg} ${colors.text} border-transparent hover:ring-1 ${colors.ring}`
            }`}
            onClick={() => onPhaseClick(phase)}
            data-testid={`filter-phase-${phase}`}
          >
            <span className={`w-2 h-2 rounded-full ${isActive ? "bg-primary-foreground" : colors.accent}`} />
            {getPhaseShort(phase)}
            <span className="opacity-70">({count})</span>
          </button>
        );
      })}
    </div>
  );
}

export default function EngineeringDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<{
    projects: ProjectData[];
    lifecyclePhases: string[];
    phaseLabels: Record<string, string>;
  }>({
    queryKey: ["eng-dashboard-projects"],
    queryFn: () => engFetch("/api/eng/dashboard/projects"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const projects = data?.projects || [];

  const filtered = useMemo(() => {
    return projects.filter(p => {
      if (phaseFilter !== "all" && p.phase !== phaseFilter) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return p.displayName.toLowerCase().includes(term) ||
          p.tasks.some(t => t.title.toLowerCase().includes(term));
      }
      return true;
    });
  }, [projects, phaseFilter, searchTerm]);

  const totalActive = projects.reduce((s, p) => s + p.activeTasks, 0);
  const totalOverdue = projects.reduce((s, p) => s + p.overdueTasks, 0);
  const totalHold = projects.reduce((s, p) => s + p.holdTasks, 0);
  const totalCompleted = projects.reduce((s, p) => s + p.completedTasks, 0);
  const totalTasks = projects.reduce((s, p) => s + p.totalTasks, 0);
  const completionRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

  const phaseDistribution = useMemo(() => {
    const dist: { phase: string; label: string; count: number; color: string }[] = [];
    const counts = new Map<string, number>();
    for (const p of projects) counts.set(p.phase, (counts.get(p.phase) || 0) + 1);
    for (const phase of PROJECT_PHASES) {
      const count = counts.get(phase) || 0;
      if (count > 0) {
        dist.push({
          phase,
          label: getPhaseShort(phase),
          count,
          color: PHASE_COLORS[phase]?.accent || "bg-slate-500",
        });
      }
    }
    return dist;
  }, [projects]);

  if (isLoading) {
    return (
      <div data-testid="eng-dashboard" className="space-y-5">
        <div className="flex items-center gap-3">
          <Wrench className="h-7 w-7 text-orange-500" />
          <div>
            <h2 className="text-2xl font-heading font-bold">Engineering Dashboard</h2>
            <p className="text-xs text-muted-foreground">Loading...</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[1,2,3,4,5].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-48 bg-muted animate-pulse rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="eng-dashboard" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-sm">
            <Wrench className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold" data-testid="text-eng-dashboard-title">
              Engineering Dashboard
            </h2>
            <p className="text-xs text-muted-foreground">
              {projects.length} projects &middot; {totalActive} active tasks &middot; {totalOverdue} overdue
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Projects</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Layers className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <p className="text-2xl font-bold" data-testid="stat-total-projects">{projects.length}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{filtered.length} visible</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Active Tasks</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <ListTodo className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <p className="text-2xl font-bold" data-testid="stat-active-tasks">{totalActive}</p>
            <p className="text-[10px] text-muted-foreground mt-1">of {totalTasks} total</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-red-600 uppercase tracking-wide">Overdue</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${totalOverdue > 0 ? "bg-red-50" : "bg-muted"}`}>
                <AlertTriangle className={`w-4 h-4 ${totalOverdue > 0 ? "text-red-600" : "text-muted-foreground"}`} />
              </div>
            </div>
            <p className={`text-2xl font-bold ${totalOverdue > 0 ? "text-red-600" : ""}`} data-testid="stat-overdue">{totalOverdue}</p>
            <p className="text-[10px] text-muted-foreground mt-1">needs attention</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">On Hold</span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                <PauseCircle className="w-4 h-4 text-amber-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-amber-600" data-testid="stat-hold">{totalHold}</p>
            <p className="text-[10px] text-muted-foreground mt-1">blocked tasks</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Completion</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-emerald-600" data-testid="stat-completion">{completionRate}%</p>
            <div className="w-full h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${completionRate >= 80 ? "bg-emerald-500" : completionRate >= 40 ? "bg-blue-500" : "bg-slate-400"}`}
                style={{ width: `${completionRate}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {phaseDistribution.length > 1 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Phase Distribution</h3>
            <div className="flex h-5 rounded-full overflow-hidden gap-0.5" data-testid="phase-distribution-bar">
              {phaseDistribution.map(d => (
                <div
                  key={d.phase}
                  className={`${d.color} transition-all cursor-pointer hover:opacity-80 relative group`}
                  style={{ width: `${(d.count / projects.length) * 100}%`, minWidth: "16px" }}
                  onClick={() => setPhaseFilter(d.phase === phaseFilter ? "all" : d.phase)}
                  title={`${PROJECT_PHASE_LABELS[d.phase as ProjectPhase] || d.phase}: ${d.count} projects`}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    {d.count}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-3">
              {phaseDistribution.map(d => (
                <div key={d.phase} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className={`w-2.5 h-2.5 rounded-sm ${d.color}`} />
                  <span>{d.label}</span>
                  <span className="font-semibold text-foreground">{d.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-project-search"
            placeholder="Search projects or tasks..."
            className="pl-9 h-9 text-sm"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <PhasePipeline
          projects={projects}
          phaseFilter={phaseFilter}
          onPhaseClick={setPhaseFilter}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Wrench className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No projects found</p>
          <p className="text-sm mt-1">Adjust your filters or search term</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="project-cards-grid">
          {filtered.map(project => (
            <ProjectCard key={project.projectName} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
