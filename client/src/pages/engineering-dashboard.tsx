import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  Wrench,
  Search,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  User,
  Circle,
} from "lucide-react";

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
  "TO DO": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  "IN PROGRESS": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "HOLD": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  "NEEDS APPROVAL": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "QC APPROVED": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "PROVIDE FEEDBACK": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "OPERATIONAL APPROVAL": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  "PROJECTS ASSISTANCE": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "COMPLETE": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const phaseColors: Record<string, string> = {
  "Prospecting": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "First Assessment": "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  "Cost Proposal": "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "Design": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "Procurement": "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  "Construction": "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "Commissioning": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "Handover": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "Operational": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "In Progress": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

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

function ProjectRow({ project, defaultExpanded }: { project: ProjectData; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasOverdue = project.overdueTasks > 0;
  const hasHold = project.holdTasks > 0;

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-all ${hasOverdue ? "border-red-200 dark:border-red-800/50" : "border-border"}`}
      data-testid={`project-row-${project.projectName}`}
    >
      <div
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors ${hasOverdue ? "bg-red-50/30 dark:bg-red-950/10" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate" data-testid={`text-project-name-${project.projectName}`}>
              {project.displayName}
            </h3>
            <Badge className={`text-[10px] px-1.5 py-0 ${phaseColors[project.phase] || phaseColors["In Progress"]}`}>
              {project.phase}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {hasOverdue && (
            <span className="flex items-center gap-1 text-[11px] text-red-600 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              {project.overdueTasks} overdue
            </span>
          )}
          {hasHold && (
            <span className="flex items-center gap-1 text-[11px] text-red-500">
              {project.holdTasks} on hold
            </span>
          )}
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {project.activeTasks} open
            {project.completedTasks > 0 && ` · ${project.completedTasks} done`}
          </span>
        </div>
      </div>

      {expanded && project.tasks.length > 0 && (
        <div className="border-t bg-muted/10">
          {project.tasks.map(task => (
            <div
              key={task.id}
              className="flex items-center gap-3 px-4 py-2 pl-11 border-b last:border-b-0 hover:bg-muted/20 transition-colors text-sm"
              data-testid={`task-row-${task.id}`}
            >
              <Circle className={`h-2.5 w-2.5 fill-current shrink-0 ${statusDot[task.status] || "text-gray-400"}`} />

              <span className="flex-1 min-w-0 truncate" data-testid={`text-task-title-${task.id}`}>
                {task.title}
              </span>

              <Badge className={`text-[9px] px-1.5 py-0 shrink-0 ${statusBadge[task.status] || "bg-gray-100"}`}>
                {task.status}
              </Badge>

              {task.dueDate && (
                <span className={`text-[11px] flex items-center gap-0.5 shrink-0 ${isOverdue(task.dueDate) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                  <Calendar className="h-3 w-3" />
                  {formatDate(task.dueDate)}
                  {isOverdue(task.dueDate) && <AlertTriangle className="h-3 w-3" />}
                </span>
              )}

              {task.assignees && task.assignees[0] && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-0.5 shrink-0 max-w-[100px] truncate">
                  <User className="h-3 w-3" />
                  {task.assignees[0]}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {expanded && project.tasks.length === 0 && (
        <div className="border-t px-4 py-3 text-xs text-muted-foreground text-center">
          All tasks complete
        </div>
      )}
    </div>
  );
}

export default function EngineeringDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<{ projects: ProjectData[]; lifecyclePhases: string[] }>({
    queryKey: ["eng-dashboard-projects"],
    queryFn: () => engFetch("/api/eng/dashboard/projects"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const projects = data?.projects || [];
  const lifecyclePhases = data?.lifecyclePhases || [];

  const filtered = projects.filter(p => {
    if (phaseFilter !== "all" && p.phase !== phaseFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return p.displayName.toLowerCase().includes(term) ||
        p.tasks.some(t => t.title.toLowerCase().includes(term));
    }
    return true;
  });

  const totalActive = filtered.reduce((s, p) => s + p.activeTasks, 0);
  const totalOverdue = filtered.reduce((s, p) => s + p.overdueTasks, 0);
  const totalHold = filtered.reduce((s, p) => s + p.holdTasks, 0);

  const phaseCounts = new Map<string, number>();
  for (const p of projects) {
    phaseCounts.set(p.phase, (phaseCounts.get(p.phase) || 0) + 1);
  }

  return (
    <div data-testid="eng-dashboard" className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Wrench className="h-7 w-7 text-orange-500" />
          <div>
            <h2 className="text-2xl font-heading font-bold" data-testid="text-eng-dashboard-title">
              Engineering Dashboard
            </h2>
            <p className="text-xs text-muted-foreground">
              {projects.length} projects · {totalActive} active tasks · {totalOverdue} overdue
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Projects</p>
          <p className="text-2xl font-bold mt-1" data-testid="stat-total-projects">{projects.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Tasks</p>
          <p className="text-2xl font-bold mt-1" data-testid="stat-active-tasks">{totalActive}</p>
        </Card>
        <Card className="p-3 border-red-200 dark:border-red-800/50">
          <p className="text-[10px] text-red-600 uppercase tracking-wider">Overdue</p>
          <p className="text-2xl font-bold mt-1 text-red-600" data-testid="stat-overdue">{totalOverdue}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">On Hold</p>
          <p className="text-2xl font-bold mt-1 text-amber-600" data-testid="stat-hold">{totalHold}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-project-search"
            placeholder="Search projects or tasks..."
            className="pl-9 h-8 text-xs"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${phaseFilter === "all" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            onClick={() => setPhaseFilter("all")}
            data-testid="filter-phase-all"
          >
            All Phases
          </button>
          {lifecyclePhases.map(phase => {
            const count = phaseCounts.get(phase) || 0;
            if (count === 0) return null;
            return (
              <button
                key={phase}
                className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${phaseFilter === phase ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                onClick={() => setPhaseFilter(phase)}
                data-testid={`filter-phase-${phase.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {phase} ({count})
              </button>
            );
          })}
          {phaseCounts.has("In Progress") && (
            <button
              className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${phaseFilter === "In Progress" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              onClick={() => setPhaseFilter("In Progress")}
              data-testid="filter-phase-in-progress"
            >
              In Progress ({phaseCounts.get("In Progress") || 0})
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Wrench className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No projects found</p>
          <p className="text-sm mt-1">Adjust your filters or search term</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((project, i) => (
            <ProjectRow
              key={project.projectName}
              project={project}
              defaultExpanded={i < 5}
            />
          ))}
        </div>
      )}
    </div>
  );
}
