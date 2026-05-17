/**
 * Engineering task view components — extracted verbatim from
 * EngineeringTasksPage (UI/UX audit module split). Behaviour-preserving
 * mechanical move.
 *
 * Contains: ProjectGroup, ProjectKanbanView, PersonalKpiStrip, TimelineView,
 * InlineListView, MyTasksView. All are self-contained, prop-driven views with
 * no dependency on the orchestrator's local closures.
 */
import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ListTodo,
  Zap,
  Search,
  X,
  Calendar,
  User,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Circle,
  Timer,
  ArrowRight,
  PauseCircle,
  FolderKanban,
  UserCog,
  ExternalLink,
  Loader2,
  Send,
  CornerDownRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import {
  TASK_STATUSES,
  getTaskStatusColumnClass,
  getTaskStatusLabel,
  getVisibleStatusesForView,
  isTaskComplete,
  isTaskCompleteForReporting,
} from "@/lib/task-status";
import type { Task } from "@/components/tasks/types";
import { formatDateShort, isOverdue, isDueThisWeek, daysLabel } from "@/lib/task-formatters";
import { engFetch } from "@/lib/eng-fetch";
import { PHASE_COLORS } from "@/lib/phase-colors";
import { invalidateAllTaskCaches } from "@/lib/task-cache";
import { canonicalizeTaskStatus } from "@/lib/task-status-compat";
import {
  TASK_PRIORITY_LABELS,
  normalizeTaskPriority,
  taskPriorityLabel,
  taskPriorityBadgeClass,
  taskPrioritySortOrder,
} from "@shared/task-priorities";
import { PRIORITIES } from "./task-filter-config";
import { getTaskContextBadges } from "./engineering-task-cards";

export interface ProjectGroup {
  projectName: string;
  displayName: string;
  phase: string;
  phaseLabel: string;
  tasks: Task[];
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
}

export function ProjectKanbanView({
  tasks,
  onCardClick,
  onDrop,
  onStatusChange,
  searchTerm,
}: {
  tasks: Task[];
  onCardClick: (task: Task) => void;
  onDrop: (taskId: number, newStatus: string) => void;
  onStatusChange: (id: number, status: string) => void;
  searchTerm: string;
}) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(["all"]));

  const { data: dashboardData } = useQuery<{
    projects: { projectName: string; displayName: string; phase: string; phaseLabel: string }[];
  }>({
    queryKey: ["eng-dashboard-projects"],
    queryFn: () => engFetch("/api/eng/dashboard/projects").catch(() => ({ projects: [] })),
    staleTime: 30000,
  });

  const projectGroups: ProjectGroup[] = useMemo(() => {
    const byProject = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = t.projectName || "Unassigned";
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(t);
    }

    const dashProjects = dashboardData?.projects || [];
    const phaseMap = new Map<string, { phase: string; phaseLabel: string; displayName: string }>();
    for (const dp of dashProjects) {
      const norm = (dp.projectName || "").replace(/_Tracker$/i, "").replace(/_/g, " ").toLowerCase();
      phaseMap.set(norm, dp);
    }

    const groups: ProjectGroup[] = [];
    for (const entry of Array.from(byProject.entries())) {
      const projectName = entry[0];
      const projectTasks = entry[1];
      const norm = projectName.replace(/_Tracker$/i, "").replace(/_/g, " ").toLowerCase();
      const dashInfo = phaseMap.get(norm);
      const phase = dashInfo?.phase || "UNKNOWN";
      const phaseLabel = dashInfo?.phaseLabel || PROJECT_PHASE_LABELS[phase as ProjectPhase] || "Unknown Phase";
      const displayName = dashInfo?.displayName || projectName.replace(/_Tracker$/i, "").replace(/_/g, " ");

      const completedTasks = projectTasks.filter((t: Task) => isTaskCompleteForReporting(t.status)).length;
      const overdueTasks = projectTasks.filter((t: Task) => isOverdue(t.dueDate, t.status)).length;

      groups.push({
        projectName,
        displayName,
        phase,
        phaseLabel,
        tasks: projectTasks,
        totalTasks: projectTasks.length,
        completedTasks,
        overdueTasks,
      });
    }

    groups.sort((a, b) => {
      const phaseOrder = (a.phase || "ZZZ").localeCompare(b.phase || "ZZZ");
      if (phaseOrder !== 0) return phaseOrder;
      return a.displayName.localeCompare(b.displayName);
    });

    return groups;
  }, [tasks, dashboardData]);

  const phaseGrouped = useMemo(() => {
    const map = new Map<string, ProjectGroup[]>();
    for (const g of projectGroups) {
      const key = g.phase;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return map;
  }, [projectGroups]);

  const toggleProject = (name: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const togglePhase = (phase: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase); else next.add(phase);
      return next;
    });
  };

  useEffect(() => {
    if (searchTerm) {
      const matching = new Set<string>();
      for (const g of projectGroups) {
        const term = searchTerm.toLowerCase();
        if (g.displayName.toLowerCase().includes(term) ||
            g.tasks.some(t => t.title.toLowerCase().includes(term))) {
          matching.add(g.projectName);
        }
      }
      setExpandedProjects(matching);
      setExpandedPhases(new Set(Array.from(phaseGrouped.keys())));
    }
  }, [searchTerm]);

  const STATUS_MINI = getVisibleStatusesForView("board").filter((s) => s !== "projects_assistance" && s !== "operational_approval");

  return (
    <div className="space-y-4" data-testid="projects-view">
      {Array.from(phaseGrouped.entries()).map(([phase, groups]) => {
        const colors = PHASE_COLORS[phase] || PHASE_COLORS.P0_FIRST_ASSESSMENT;
        const phaseLabel = groups[0]?.phaseLabel || phase;
        const isPhaseExpanded = expandedPhases.has(phase) || expandedPhases.has("all");
        const totalInPhase = groups.reduce((s, g) => s + g.totalTasks, 0);
        const completedInPhase = groups.reduce((s, g) => s + g.completedTasks, 0);
        const phasePct = totalInPhase > 0 ? Math.round((completedInPhase / totalInPhase) * 100) : 0;

        return (
          <div key={phase} className="border rounded-xl overflow-hidden" data-testid={`phase-group-${phase}`}>
            <button
              className={`w-full flex items-center gap-3 px-4 py-3 ${colors.bg} hover:opacity-90 transition-opacity`}
              onClick={() => togglePhase(phase)}
              data-testid={`toggle-phase-${phase}`}
            >
              {isPhaseExpanded
                ? <ChevronDown className={`h-4 w-4 ${colors.text}`} />
                : <ChevronRight className={`h-4 w-4 ${colors.text}`} />
              }
              <div className={`w-2 h-2 rounded-full ${colors.accent}`} />
              <span className={`font-semibold text-sm ${colors.text}`}>{phaseLabel}</span>
              <Badge variant="secondary" className="text-[10px]">{groups.length} project{groups.length !== 1 ? "s" : ""}</Badge>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-black/10 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${colors.accent}`} style={{ width: `${phasePct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">{phasePct}%</span>
              </div>
            </button>

            {isPhaseExpanded && (
              <div className="divide-y">
                {groups.map(group => {
                  const isExpanded = expandedProjects.has(group.projectName);
                  const completion = group.totalTasks > 0
                    ? Math.round((group.completedTasks / group.totalTasks) * 100) : 0;

                  return (
                    <div key={group.projectName} data-testid={`project-group-${group.projectName}`}>
                      <button
                        className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-muted/40 transition-colors text-left"
                        onClick={() => toggleProject(group.projectName)}
                        data-testid={`toggle-project-${group.projectName}`}
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                        <span className="font-medium text-sm flex-1 truncate">{group.displayName}</span>
                        <a
                          href={`/projects/${encodeURIComponent(group.projectName)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] text-primary hover:underline shrink-0"
                          data-testid={`link-project-detail-${group.projectName}`}
                        >View project</a>
                        <div className="flex items-center gap-3 shrink-0">
                          {group.overdueTasks > 0 && (
                            <span className="flex items-center gap-1 text-[10px] text-red-600 font-bold">
                              <AlertTriangle className="h-3 w-3" />
                              {group.overdueTasks}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {group.completedTasks}/{group.totalTasks}
                          </span>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${completion >= 80 ? "bg-emerald-500" : completion >= 40 ? "bg-blue-500" : "bg-slate-400"}`}
                              style={{ width: `${completion}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{completion}%</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-5 pb-3">
                          <div className="flex gap-2 overflow-x-auto pb-2 pt-1" style={{ minHeight: "120px" }}>
                            {STATUS_MINI.map(status => {
                              const statusTasks = group.tasks.filter(t => {
                                if (status === "complete") return isTaskCompleteForReporting(t.status);
                                return t.status === status;
                              });
                              if (status !== "to_do" && status !== "in_progress" && statusTasks.length === 0) return null;

                              return (
                                <div
                                  key={status}
                                  className={`flex-shrink-0 w-[200px] bg-muted/20 rounded-lg border-t-2 ${getTaskStatusColumnClass(status)}`}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    const taskId = parseInt(e.dataTransfer.getData("taskId"));
                                    if (taskId) onDrop(taskId, status);
                                  }}
                                  data-testid={`mini-col-${group.projectName}-${status}`}
                                >
                                  <div className="px-2 py-1.5 flex items-center justify-between">
                                    <span className="text-[10px] font-medium text-muted-foreground truncate">{getTaskStatusLabel(status)}</span>
                                    <span className="text-[10px] text-muted-foreground">{statusTasks.length}</span>
                                  </div>
                                  <div className="px-1.5 pb-1.5 space-y-1 max-h-[250px] overflow-y-auto">
                                    {statusTasks.map(task => (
                                      <div
                                        key={task.id}
                                        draggable
                                        onDragStart={(e) => {
                                          e.dataTransfer.setData("taskId", String(task.id));
                                          e.dataTransfer.effectAllowed = "move";
                                        }}
                                        onClick={() => onCardClick(task)}
                                        className="bg-card border rounded p-2 cursor-pointer hover:shadow-sm transition-all text-xs"
                                        data-testid={`mini-card-${task.id}`}
                                      >
                                        <p className="font-medium leading-tight line-clamp-2 mb-1">{task.title}</p>
                                        <div className="flex items-center gap-1 flex-wrap">
                                          <Badge className={`text-[8px] px-1 py-0 ${taskPriorityBadgeClass(task.priority)}`}>
                                            {taskPriorityLabel(task.priority)}
                                          </Badge>
                                          {task.dueDate && (
                                            <span className={`text-[9px] flex items-center gap-0.5 ${isOverdue(task.dueDate, task.status) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                                              <Calendar className="h-2.5 w-2.5" />
                                              {formatDateShort(task.dueDate)}
                                            </span>
                                          )}
                                        </div>
                                        {task.assignees?.[0] && (
                                          <div className="mt-1 flex items-center gap-0.5 text-[9px] text-muted-foreground">
                                            <User className="h-2.5 w-2.5" />
                                            <span className="truncate">{task.assignees[0]}</span>
                                          </div>
                                        )}
                                        {task.trackingRag && (
                                          <div className="mt-0.5 flex items-center gap-0.5">
                                            <Circle className={`h-2 w-2 fill-current ${task.trackingRag === "Green" ? "text-green-500" : task.trackingRag === "Amber" ? "text-amber-500" : task.trackingRag === "Red" ? "text-red-500" : "text-gray-400"}`} />
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    {statusTasks.length === 0 && (
                                      <div className="text-center py-4 text-[10px] text-muted-foreground/40">—</div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {projectGroups.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <FolderKanban className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No projects found</p>
          <p className="text-sm mt-1">Create tasks to see them grouped by project</p>
        </div>
      )}
    </div>
  );
}

export function PersonalKpiStrip({ tasks, myTasks }: { tasks: Task[]; myTasks: Task[] }) {
  const myActive = myTasks.filter(t => !isTaskComplete(t.status)).length;
  const myOverdue = myTasks.filter(t => isOverdue(t.dueDate, t.status)).length;
  const myDueThisWeek = myTasks.filter(t => isDueThisWeek(t.dueDate, t.status)).length;
  const myHold = myTasks.filter(t => canonicalizeTaskStatus(t.status) === "hold").length;
  const myInProgress = myTasks.filter(t => canonicalizeTaskStatus(t.status) === "in_progress").length;

  const stats = [
    { label: "My Active", value: myActive, icon: <ListTodo className="w-3.5 h-3.5" />, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "In Progress", value: myInProgress, icon: <ArrowRight className="w-3.5 h-3.5" />, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Due This Week", value: myDueThisWeek, icon: <Timer className="w-3.5 h-3.5" />, color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "Overdue", value: myOverdue, icon: <AlertTriangle className="w-3.5 h-3.5" />, color: myOverdue > 0 ? "text-red-600" : "text-muted-foreground", bg: myOverdue > 0 ? "bg-red-50" : "bg-muted" },
    { label: "On Hold", value: myHold, icon: <PauseCircle className="w-3.5 h-3.5" />, color: myHold > 0 ? "text-amber-600" : "text-muted-foreground", bg: myHold > 0 ? "bg-amber-50" : "bg-muted" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2" data-testid="personal-kpi-strip">
      {stats.map(s => (
        <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card">
          <div className={`w-7 h-7 rounded-md ${s.bg} flex items-center justify-center`}>
            <span className={s.color}>{s.icon}</span>
          </div>
          <div>
            <p className={`text-base font-bold leading-none ${s.color}`} data-testid={`my-kpi-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>{s.value}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TimelineView({ tasks, onCardClick }: { tasks: Task[]; onCardClick: (task: Task) => void }) {
  const today = new Date();
  const [zoomWeeks, setZoomWeeks] = useState<4 | 8 | 12 | 26>(8);
  const [groupBy, setGroupBy] = useState<"project" | "assignee">("project");
  const [visibleCount, setVisibleCount] = useState(50);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const ZOOM_OPTIONS = [
    { value: 4 as const, label: "4 wk" },
    { value: 8 as const, label: "8 wk" },
    { value: 12 as const, label: "12 wk" },
    { value: 26 as const, label: "26 wk" },
  ];

  const timelineTasks = useMemo(() => {
    return tasks
      .filter(t => t.dueDate && !isTaskComplete(t.status))
      .sort((a, b) => {
        const aOverdue = isOverdue(a.dueDate, a.status) ? 0 : 1;
        const bOverdue = isOverdue(b.dueDate, b.status) ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        return new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime();
      });
  }, [tasks]);

  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 7);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + zoomWeeks * 7);
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const pxPerDay = zoomWeeks <= 8 ? 16 : zoomWeeks <= 12 ? 12 : 8;

  const weeks: { date: Date; label: string; isCurrent: boolean }[] = [];
  const weekStart = new Date(startDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const todayWeekStart = new Date(today);
  todayWeekStart.setDate(todayWeekStart.getDate() - todayWeekStart.getDay() + 1);
  while (weekStart <= endDate) {
    const isCurrent = weekStart.toDateString() === todayWeekStart.toDateString();
    weeks.push({ date: new Date(weekStart), label: weekStart.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" }), isCurrent });
    weekStart.setDate(weekStart.getDate() + 7);
  }

  const todayOffset = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

  // Group tasks
  const grouped = useMemo(() => {
    const groups = new Map<string, Task[]>();
    const visibleTasks = timelineTasks.slice(0, visibleCount);
    for (const t of visibleTasks) {
      const key = groupBy === "project"
        ? (t.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ") || "No Project")
        : (t.assignees?.[0] || "Unassigned");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [timelineTasks, visibleCount, groupBy]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const getBarColor = (task: Task) => {
    if (isOverdue(task.dueDate, task.status)) return "bg-red-400";
    const canonical = canonicalizeTaskStatus(task.status);
    if (canonical === "in_progress") return "bg-blue-400";
    if (canonical === "hold") return "bg-amber-400";
    return "bg-emerald-400";
  };

  if (timelineTasks.length === 0) {
    return (
      <div className="text-center py-12">
        <Calendar className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No tasks with due dates. Add due dates to see the timeline.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="timeline-view">
      {/* Toolbar: zoom + grouping */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">Zoom:</span>
          {ZOOM_OPTIONS.map(z => (
            <Button key={z.value} variant={zoomWeeks === z.value ? "default" : "outline"} size="sm" className="h-6 text-[10px] px-2" onClick={() => setZoomWeeks(z.value)}>
              {z.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">Group:</span>
          <Button variant={groupBy === "project" ? "default" : "outline"} size="sm" className="h-6 text-[10px] px-2" onClick={() => setGroupBy("project")}>Project</Button>
          <Button variant={groupBy === "assignee" ? "default" : "outline"} size="sm" className="h-6 text-[10px] px-2" onClick={() => setGroupBy("assignee")}>Assignee</Button>
        </div>
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-full bg-red-400 inline-block" /> Overdue</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-full bg-blue-400 inline-block" /> In Progress</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-full bg-amber-400 inline-block" /> On Hold</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-full bg-emerald-400 inline-block" /> On Track</span>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {/* Sticky header with week markers */}
        <div className="flex border-b bg-muted/30 sticky top-0 z-20">
          <div className="w-[220px] shrink-0 p-2 text-[10px] font-semibold text-muted-foreground border-r">Task</div>
          <div className="flex-1 relative overflow-hidden" style={{ minWidth: `${totalDays * pxPerDay}px` }}>
            <div className="flex h-full">
              {weeks.map((w, i) => (
                <div key={i} className={`text-[9px] px-1 py-2 border-r border-dashed ${w.isCurrent ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 font-bold" : "text-muted-foreground"}`} style={{ minWidth: `${7 * pxPerDay}px` }}>
                  {w.label}{w.isCurrent && " (now)"}
                </div>
              ))}
            </div>
            {/* Today marker in header */}
            <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-10" style={{ left: `${(todayOffset / totalDays) * 100}%` }}>
              <span className="absolute -top-0 -left-3 text-[7px] font-bold text-red-600 bg-red-50 dark:bg-red-950 px-1 rounded">Today</span>
            </div>
          </div>
        </div>

        {/* Task rows grouped */}
        <div className="max-h-[500px] overflow-y-auto">
          {grouped.map(([groupKey, groupTasks]) => (
            <div key={groupKey}>
              {/* Group header */}
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b cursor-pointer hover:bg-muted/70"
                onClick={() => toggleGroup(groupKey)}
              >
                {collapsedGroups.has(groupKey) ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                <span className="text-[11px] font-semibold">{groupKey}</span>
                <span className="text-[9px] text-muted-foreground">({groupTasks.length})</span>
              </div>

              {!collapsedGroups.has(groupKey) && groupTasks.map(task => {
                const due = new Date(task.dueDate!);
                const start = task.startDate ? new Date(task.startDate) : new Date(due.getTime() - 7 * 24 * 60 * 60 * 1000);
                const barStart = Math.max(0, Math.ceil((start.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
                const barEnd = Math.ceil((due.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                const barLeft = (barStart / totalDays) * 100;
                const barWidth = Math.max(1, ((barEnd - barStart) / totalDays) * 100);
                const overdue = isOverdue(task.dueDate, task.status);
                const assignee = task.assignees?.[0] || "Unassigned";

                return (
                  <div key={task.id} className="flex border-b hover:bg-muted/20 transition-colors group" onClick={() => onCardClick(task)}>
                    <div className="w-[220px] shrink-0 p-2 border-r cursor-pointer">
                      <p className="text-[11px] font-medium truncate leading-tight">{task.title}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Badge className={`text-[8px] px-1 py-0 ${taskPriorityBadgeClass(task.priority)}`}>{taskPriorityLabel(task.priority)}</Badge>
                        <span className={`text-[9px] ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{daysLabel(task.dueDate!)}</span>
                      </div>
                    </div>
                    <div className="flex-1 relative py-2" style={{ minWidth: `${totalDays * pxPerDay}px` }}>
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={`absolute h-5 rounded-full cursor-pointer transition-all ${getBarColor(task)}`}
                              style={{ left: `${barLeft}%`, width: `${barWidth}%`, top: "50%", transform: "translateY(-50%)", minWidth: "8px" }}
                            >
                              {task.assignees?.[0] && (
                                <span className="absolute -right-1 -top-1 w-4 h-4 rounded-full bg-white border flex items-center justify-center text-[7px] font-bold">
                                  {task.assignees[0][0]}
                                </span>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-[250px]">
                            <p className="font-semibold">{task.title}</p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1 text-[10px]">
                              <span className="text-muted-foreground">Status:</span><span>{task.status}</span>
                              <span className="text-muted-foreground">Priority:</span><span>{task.priority}</span>
                              <span className="text-muted-foreground">Assignee:</span><span>{assignee}</span>
                              {task.startDate && <><span className="text-muted-foreground">Start:</span><span>{formatDateShort(task.startDate)}</span></>}
                              <span className="text-muted-foreground">Due:</span><span className={overdue ? "text-red-600 font-semibold" : ""}>{formatDateShort(task.dueDate!)}</span>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {/* Week grid lines */}
                      {weeks.map((_, i) => (
                        <div key={i} className="absolute top-0 bottom-0 border-r border-dashed border-muted" style={{ left: `${((i + 1) * 7 / totalDays) * 100}%` }} />
                      ))}
                      {/* Today marker in rows */}
                      <div className="absolute top-0 bottom-0 w-[2px] bg-red-500/40 z-10" style={{ left: `${(todayOffset / totalDays) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Show more */}
      {visibleCount < timelineTasks.length && (
        <div className="text-center">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setVisibleCount(c => c + 50)}>
            Show more ({timelineTasks.length - visibleCount} remaining)
          </Button>
        </div>
      )}
    </div>
  );
}

export function InlineListView({ tasks, onCardClick, onStatusChange, onPriorityChange, onBulkStatusChange, onBulkPriorityChange }: {
  tasks: Task[];
  onCardClick: (task: Task) => void;
  onStatusChange: (id: number, status: string) => void;
  onPriorityChange: (id: number, priority: string) => void;
  onBulkStatusChange?: (taskIds: number[], status: string) => void;
  onBulkPriorityChange?: (taskIds: number[], priority: string) => void;
}) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [visibleCount, setVisibleCount] = useState(100);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const toggleAll = useCallback(() => {
    setSelectedIds(prev => prev.size === tasks.length ? new Set() : new Set(tasks.map(t => t.id)));
  }, [tasks]);

  const toggleSort = useCallback((col: string) => {
    if (sortCol === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortCol(col); setSortDir("asc"); }
  }, [sortCol]);

  const sorted = useMemo(() => {
    if (!sortCol) return tasks;
    const arr = [...tasks];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortCol) {
        case "title": return dir * (a.title || "").localeCompare(b.title || "");
        case "project": return dir * (a.projectName || "").localeCompare(b.projectName || "");
        case "status": return dir * (a.status || "").localeCompare(b.status || "");
        case "priority": return dir * (taskPrioritySortOrder(a.priority) - taskPrioritySortOrder(b.priority));
        case "assignee": return dir * ((a.assignees?.[0] || "zzz").localeCompare(b.assignees?.[0] || "zzz"));
        case "dueDate": {
          const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const db_ = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return dir * (da - db_);
        }
        default: return 0;
      }
    });
    return arr;
  }, [tasks, sortCol, sortDir]);

  const visible = sorted.slice(0, visibleCount);
  const SortHeader = ({ col, children, align }: { col: string; children: React.ReactNode; align?: string }) => (
    <th className={`${align === "center" ? "text-center" : "text-left"} p-2 ${col === "title" ? "pl-3" : ""} cursor-pointer select-none hover:text-foreground transition-colors`} onClick={() => toggleSort(col)}>
      <span className="inline-flex items-center gap-1">{children}{sortCol === col && <span className="text-[9px]">{sortDir === "asc" ? "▲" : "▼"}</span>}</span>
    </th>
  );

  return (
    <Card>
      <CardContent className="p-0">
        {selectedIds.size > 0 && onBulkStatusChange && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border-b border-blue-200" data-testid="list-bulk-bar">
            <span className="text-xs font-semibold text-blue-800">{selectedIds.size} selected</span>
            <div className="h-4 w-px bg-blue-200" />
            <SearchableSelect value="" onValueChange={(s) => { onBulkStatusChange(Array.from(selectedIds), s); setSelectedIds(new Set()); }}
              placeholder="Set status..." triggerClassName="h-7 text-[10px] min-w-[100px]"
              options={TASK_STATUSES.map(s => ({ value: s, label: getTaskStatusLabel(s) }))} />
            {onBulkPriorityChange && (
              <SearchableSelect value="" onValueChange={(p) => { onBulkPriorityChange(Array.from(selectedIds), p); setSelectedIds(new Set()); }}
                placeholder="Set priority..." triggerClassName="h-7 text-[10px] min-w-[90px]"
                options={PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))} />
            )}
            <Button variant="ghost" size="sm" className="h-7 text-[10px] text-muted-foreground" onClick={() => setSelectedIds(new Set())}>
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b bg-muted/30 text-[11px] text-muted-foreground">
                <th className="w-8 p-2 text-center">
                  <input type="checkbox" checked={selectedIds.size === tasks.length && tasks.length > 0} onChange={toggleAll} className="h-3 w-3" />
                </th>
                <SortHeader col="title">Title</SortHeader>
                <SortHeader col="project">Project</SortHeader>
                <SortHeader col="status">Status</SortHeader>
                <SortHeader col="priority">Priority</SortHeader>
                <SortHeader col="assignee">Assignee</SortHeader>
                <th className="text-left p-2">Context</th>
                <SortHeader col="dueDate">Due Date</SortHeader>
                <th className="text-center p-2">RAG</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(task => {
                const assigneeNames = task.assignees || task.resolvedAssignees?.map((user) => user.name) || [];
                const contextBadges = getTaskContextBadges(task);

                return (
                  <tr
                    key={task.id}
                    className={`border-b hover:bg-muted/10 transition-colors ${selectedIds.has(task.id) ? "bg-blue-50/50" : ""}`}
                    data-testid={`row-task-${task.id}`}
                  >
                    <td className="w-8 p-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.has(task.id)} onChange={() => toggleSelect(task.id)} className="h-3 w-3" />
                    </td>
                    <td
                      className="p-2 pl-3 font-medium max-w-[250px] truncate cursor-pointer hover:text-blue-600"
                      onClick={() => onCardClick(task)}
                      data-testid={`text-task-title-${task.id}`}
                    >
                      {task.title}
                      {task.holdReason && <p className="text-[10px] text-red-500 truncate">{task.blockedType && <span className={`px-1 py-0 rounded text-[9px] font-semibold mr-0.5 ${task.blockedType === "External" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"}`}>{task.blockedType}</span>}{task.holdReason}</p>}
                    </td>
                    <td className="p-2 text-muted-foreground text-xs">
                      {task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                    </td>
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <SearchableSelect
                        value={task.status}
                        onValueChange={(v) => onStatusChange(task.id, v)}
                        placeholder="Status"
                        triggerClassName="h-7 text-[10px] w-[130px] border-none shadow-none p-0"
                        options={TASK_STATUSES.map(s => ({ value: s, label: getTaskStatusLabel(s) }))}
                        data-testid={`inline-status-${task.id}`}
                      />
                    </td>
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <SearchableSelect
                        value={task.priority}
                        onValueChange={(v) => onPriorityChange(task.id, v)}
                        placeholder="Priority"
                        triggerClassName="h-7 text-[10px] w-[90px] border-none shadow-none p-0"
                        options={PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
                        data-testid={`inline-priority-${task.id}`}
                      />
                    </td>
                    <td className="p-2 text-xs text-muted-foreground truncate max-w-[120px]">
                      {assigneeNames[0] || "—"}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {task.isUnassigned && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-slate-50 text-slate-700 border-slate-200">
                            Unassigned
                          </Badge>
                        )}
                        {contextBadges.length > 0 ? contextBadges.map((badge) => (
                          <Badge key={badge.label} variant="outline" className={`text-[9px] px-1.5 py-0 ${badge.className}`}>
                            {badge.label}
                          </Badge>
                        )) : (
                          <span className="text-[10px] text-muted-foreground">Stable</span>
                        )}
                      </div>
                    </td>
                    <td className={`p-2 text-xs ${isOverdue(task.dueDate, task.status) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                      <div className="flex items-center gap-1">
                        {formatDateShort(task.dueDate)}
                        {isOverdue(task.dueDate, task.status) && <AlertTriangle className="h-3 w-3" />}
                      </div>
                    </td>
                    <td className="p-2 text-center">
                      {task.trackingRag && (
                        <div className={`w-3 h-3 rounded-full mx-auto ${task.trackingRag === "Green" ? "bg-green-500" : task.trackingRag === "Amber" ? "bg-amber-500" : task.trackingRag === "Red" ? "bg-red-500" : "bg-gray-400"}`} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length < sorted.length && (
            <div className="text-center py-3 border-t">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setVisibleCount(c => c + 100)}>
                Show more ({sorted.length - visible.length} remaining)
              </Button>
            </div>
          )}
          {tasks.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <ListTodo className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No tasks found</p>
              <p className="text-sm mt-1">Create a new task or adjust your filters</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function MyTasksView({
  tasks,
  myName,
  onCardClick,
  onStatusChange,
  onPriorityChange,
  filterStatuses = [],
}: {
  tasks: Task[];
  myName: string;
  onCardClick: (task: Task) => void;
  onStatusChange: (id: number, status: string) => void;
  onPriorityChange: (id: number, priority: string) => void;
  filterStatuses?: string[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(new Set());
  const [quickNotes, setQuickNotes] = useState<Record<number, string>>({});
  const [postingNote, setPostingNote] = useState<Record<number, boolean>>({});
  const [dueDates, setDueDates] = useState<Record<number, string>>({});
  const [myStatusFilter, setMyStatusFilter] = useState<string>("all");
  const [myPriorityFilter, setMyPriorityFilter] = useState<string>("all");
  const [myProjectFilter, setMyProjectFilter] = useState<string>("all");
  const [myDueFilter, setMyDueFilter] = useState<string>("all");
  const [mySearch, setMySearch] = useState("");

  const nameLower = myName.toLowerCase();
  const myTasks = useMemo(() => {
    return tasks.filter(t =>
      (t.assignees || []).some(a => a && a.toLowerCase().startsWith(nameLower))
    );
  }, [tasks, nameLower]);

  const filteredMyTasks = useMemo(() => {
    return myTasks.filter(t => {
      if (myStatusFilter !== "all" && t.status !== myStatusFilter) return false;
      if (myPriorityFilter !== "all" && t.priority !== myPriorityFilter) return false;
      if (myProjectFilter !== "all" && t.projectName !== myProjectFilter) return false;
      if (myDueFilter === "overdue" && !isOverdue(t.dueDate, t.status)) return false;
      if (myDueFilter === "today") {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate).toDateString();
        if (d !== new Date().toDateString()) return false;
      }
      if (myDueFilter === "week" && !isDueThisWeek(t.dueDate, t.status) && !isOverdue(t.dueDate, t.status)) return false;
      if (mySearch) {
        const term = mySearch.toLowerCase();
        return t.title.toLowerCase().includes(term) || (t.projectName || "").toLowerCase().includes(term);
      }
      return true;
    });
  }, [myTasks, myStatusFilter, myPriorityFilter, myProjectFilter, myDueFilter, mySearch]);

  const uniqueProjects = useMemo(() => {
    return Array.from(new Set(myTasks.map(t => t.projectName).filter(Boolean))).sort();
  }, [myTasks]);

  const buckets = useMemo(() => {
    const overdue: Task[] = [];
    const dueSoon: Task[] = [];
    const hold: Task[] = [];
    const inProgress: Task[] = [];
    const rest: Task[] = [];

    for (const t of filteredMyTasks) {
      const canonical = canonicalizeTaskStatus(t.status);
      if (isOverdue(t.dueDate, t.status)) {
        overdue.push(t);
      } else if (isDueThisWeek(t.dueDate, t.status) || (t.dueDate && new Date(t.dueDate).toDateString() === new Date().toDateString())) {
        dueSoon.push(t);
      } else if (canonical === "hold") {
        hold.push(t);
      } else if (canonical === "in_progress") {
        inProgress.push(t);
      } else if (!isTaskComplete(t.status)) {
        rest.push(t);
      }
    }

    const sortByPriority = (a: Task, b: Task) => taskPrioritySortOrder(a.priority) - taskPrioritySortOrder(b.priority);
    overdue.sort((a, b) => {
      const aDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const bDate = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return aDate - bDate || sortByPriority(a, b);
    });
    dueSoon.sort((a, b) => {
      const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return aDate - bDate || sortByPriority(a, b);
    });
    hold.sort(sortByPriority);
    inProgress.sort(sortByPriority);
    rest.sort(sortByPriority);

    return [
      { key: "overdue", label: "Overdue", icon: <AlertTriangle className="h-4 w-4 text-red-500" />, tasks: overdue, color: "border-l-red-500 bg-red-50/30" },
      { key: "due-soon", label: "Due Today / Due Soon", icon: <Timer className="h-4 w-4 text-amber-500" />, tasks: dueSoon, color: "border-l-amber-500 bg-amber-50/30" },
      { key: "hold", label: "On Hold", icon: <PauseCircle className="h-4 w-4 text-red-600" />, tasks: hold, color: "border-l-red-400 bg-red-50/20" },
      { key: "in-progress", label: "In Progress", icon: <ArrowRight className="h-4 w-4 text-blue-500" />, tasks: inProgress, color: "border-l-blue-500 bg-blue-50/30" },
      { key: "everything-else", label: "Everything Else", icon: <Circle className="h-4 w-4 text-gray-400" />, tasks: rest, color: "border-l-gray-400 bg-muted/30" },
    ];
  }, [filteredMyTasks]);

  const toggleBucket = (key: string) => {
    setCollapsedBuckets(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const updateDueDateMutation = useMutation({
    mutationFn: ({ taskId, dueDate }: { taskId: number; dueDate: string }) =>
      engFetch(`/api/eng/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ dueDate: dueDate || null }) }),
    onSuccess: () => {
      invalidateAllTaskCaches(queryClient);
      toast({ title: "Due date updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const postQuickNote = async (taskId: number) => {
    const note = quickNotes[taskId]?.trim();
    if (!note) return;
    setPostingNote(prev => ({ ...prev, [taskId]: true }));
    try {
      await engFetch(`/api/eng/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: note }),
      });
      invalidateAllTaskCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ["task-comments", taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-activity", taskId] });
      setQuickNotes(prev => ({ ...prev, [taskId]: "" }));
      toast({ title: "Note posted" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setPostingNote(prev => ({ ...prev, [taskId]: false }));
    }
  };

  return (
    <div className="space-y-4" data-testid="my-tasks-view">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[150px] max-w-xs">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="my-tasks-search"
            placeholder="Search my tasks..."
            className="pl-9 h-8 text-xs"
            value={mySearch}
            onChange={e => setMySearch(e.target.value)}
          />
        </div>
        <SearchableSelect
          value={myStatusFilter}
          onValueChange={setMyStatusFilter}
          placeholder="Status"
          triggerClassName="w-[130px] h-8 text-xs"
          options={[
            { value: "all", label: "All Statuses" },
            ...filterStatuses.map(s => ({ value: s, label: getTaskStatusLabel(s) })),
          ]}
          data-testid="my-tasks-filter-status"
        />
        <SearchableSelect
          value={myPriorityFilter}
          onValueChange={setMyPriorityFilter}
          placeholder="Priority"
          triggerClassName="w-[110px] h-8 text-xs"
          options={[
            { value: "all", label: "All Priorities" },
            ...PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] })),
          ]}
          data-testid="my-tasks-filter-priority"
        />
        {uniqueProjects.length > 0 && (
          <SearchableSelect
            value={myProjectFilter}
            onValueChange={setMyProjectFilter}
            placeholder="Project"
            triggerClassName="w-[140px] h-8 text-xs"
            options={[
              { value: "all", label: "All Projects" },
              ...uniqueProjects.filter((p): p is string => !!p).map(p => ({ value: p, label: p.replace(/_Tracker.*$/i, "").replace(/_/g, " ") })),
            ]}
            data-testid="my-tasks-filter-project"
          />
        )}
        <SearchableSelect
          value={myDueFilter}
          onValueChange={setMyDueFilter}
          placeholder="Due"
          triggerClassName="w-[120px] h-8 text-xs"
          options={[
            { value: "all", label: "All Due Dates" },
            { value: "overdue", label: "Overdue" },
            { value: "today", label: "Due Today" },
            { value: "week", label: "Due This Week" },
          ]}
          data-testid="my-tasks-filter-due"
        />
      </div>

      {(() => {
        const todayFocus = filteredMyTasks.filter(t => {
          if (isTaskComplete(t.status)) return false;
          if (isOverdue(t.dueDate, t.status)) return true;
          if (t.dueDate && new Date(t.dueDate).toDateString() === new Date().toDateString()) return true;
          if (canonicalizeTaskStatus(t.status) === "in_progress" && normalizeTaskPriority(t.priority) === "Urgent") return true;
          return false;
        }).slice(0, 7);
        if (todayFocus.length === 0) return null;
        return (
          <div className="border-2 border-blue-300 rounded-lg bg-blue-50/40 p-3 mb-2" data-testid="today-focus">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                <Zap className="h-4 w-4 text-blue-600" />
              </div>
              <span className="font-semibold text-sm text-blue-900">Today's Focus</span>
              <span className="text-[10px] text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full font-bold">{todayFocus.length}</span>
            </div>
            <div className="space-y-1">
              {todayFocus.map(t => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 text-xs p-2 bg-white rounded border hover:bg-blue-50 cursor-pointer transition-colors"
                  onClick={() => onCardClick(t)}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isOverdue(t.dueDate, t.status) ? "bg-red-500" : normalizeTaskPriority(t.priority) === "Urgent" ? "bg-red-500" : "bg-blue-500"}`} />
                  <span className="flex-1 font-medium truncate">{t.title}</span>
                  {t.projectName && <span className="text-muted-foreground truncate max-w-[120px]">{t.projectName.replace(/_Tracker.*$/, "").replace(/_/g, " ")}</span>}
                  {t.dueDate && <span className={`text-[10px] font-semibold shrink-0 ${isOverdue(t.dueDate, t.status) ? "text-red-600" : "text-muted-foreground"}`}>{daysLabel(t.dueDate)}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {buckets.map(bucket => {
        if (bucket.tasks.length === 0) return null;
        const isCollapsed = collapsedBuckets.has(bucket.key);

        return (
          <div key={bucket.key} className={`border-l-4 rounded-lg border ${bucket.color}`} data-testid={`bucket-${bucket.key}`}>
            <button
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/20 transition-colors"
              onClick={() => toggleBucket(bucket.key)}
              data-testid={`toggle-bucket-${bucket.key}`}
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              {bucket.icon}
              <span className="font-semibold text-sm">{bucket.label}</span>
              <Badge variant="secondary" className="text-[10px] ml-1">{bucket.tasks.length}</Badge>
            </button>
            {!isCollapsed && (
              <div className="px-2 pb-2">
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead>
                      <tr className="text-[10px] text-muted-foreground border-b">
                        <th className="text-left p-2 pl-3 w-[30%]">Task</th>
                        <th className="text-left p-2 w-[14%]">Project</th>
                        <th className="text-left p-2 w-[12%]">Status</th>
                        <th className="text-left p-2 w-[10%]">Priority</th>
                        <th className="text-left p-2 w-[10%]">Due Date</th>
                        <th className="text-left p-2 w-[20%]">Quick Note</th>
                        <th className="text-center p-2 w-[4%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucket.tasks.map(task => {
                        const projectDisplay = task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
                        const overdue = isOverdue(task.dueDate, task.status);
                        return (
                          <tr key={task.id} className="border-b hover:bg-muted/10 transition-colors" data-testid={`my-task-row-${task.id}`}>
                            <td className="p-2 pl-3">
                              <div className="flex flex-col">
                                <span className="font-medium text-sm truncate max-w-[280px]" data-testid={`my-task-title-${task.id}`}>{task.title}</span>
                                {task.parentTaskTitle && (
                                  <span className="text-[10px] text-violet-600/70 flex items-center gap-0.5 mt-0.5">
                                    <CornerDownRight className="h-2.5 w-2.5 shrink-0" />
                                    <span className="truncate max-w-[220px]">{task.parentTaskTitle}</span>
                                  </span>
                                )}
                                {task.holdReason && (
                                  <span className="text-[10px] text-red-500 flex items-center gap-0.5 mt-0.5">
                                    <PauseCircle className="h-3 w-3 shrink-0" />
                                    {task.blockedType && <span className={`px-1 py-0 rounded text-[9px] font-semibold mr-0.5 ${task.blockedType === "External" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"}`}>{task.blockedType}</span>}
                                    {task.holdReason}
                                  </span>
                                )}
                                {task.dueDate && overdue && (
                                  <span className="text-[10px] text-red-600 font-semibold">{daysLabel(task.dueDate)}</span>
                                )}
                              </div>
                            </td>
                            <td className="p-2 text-xs text-muted-foreground truncate max-w-[120px]">{projectDisplay}</td>
                            <td className="p-2" onClick={e => e.stopPropagation()}>
                              <SearchableSelect
                                value={task.status}
                                onValueChange={v => { if (v !== task.status) onStatusChange(task.id, v); }}
                                placeholder="Status"
                                triggerClassName="h-7 text-[10px] w-[130px] border-none shadow-none p-0"
                                options={TASK_STATUSES.map(s => ({ value: s, label: getTaskStatusLabel(s) }))}
                                data-testid={`my-task-status-${task.id}`}
                              />
                            </td>
                            <td className="p-2" onClick={e => e.stopPropagation()}>
                              <SearchableSelect
                                value={task.priority}
                                onValueChange={v => { if (v !== task.priority) onPriorityChange(task.id, v); }}
                                placeholder="Priority"
                                triggerClassName="h-7 text-[10px] w-[90px] border-none shadow-none p-0"
                                options={PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
                                data-testid={`my-task-priority-${task.id}`}
                              />
                            </td>
                            <td className="p-2" onClick={e => e.stopPropagation()}>
                              <Input
                                type="date"
                                className="h-7 text-[10px] w-[120px] border-dashed"
                                value={dueDates[task.id] ?? (task.dueDate ? task.dueDate.split("T")[0] : "")}
                                onChange={e => setDueDates(prev => ({ ...prev, [task.id]: e.target.value }))}
                                onBlur={() => {
                                  const val = dueDates[task.id];
                                  if (val !== undefined && val !== (task.dueDate ? task.dueDate.split("T")[0] : "")) {
                                    updateDueDateMutation.mutate({ taskId: task.id, dueDate: val });
                                  }
                                }}
                                data-testid={`my-task-due-${task.id}`}
                              />
                            </td>
                            <td className="p-2" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                <Input
                                  placeholder="Add note..."
                                  className="h-7 text-[10px] flex-1 min-w-0"
                                  value={quickNotes[task.id] || ""}
                                  onChange={e => setQuickNotes(prev => ({ ...prev, [task.id]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === "Enter" && quickNotes[task.id]?.trim()) postQuickNote(task.id); }}
                                  data-testid={`my-task-note-${task.id}`}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0"
                                  disabled={!quickNotes[task.id]?.trim() || postingNote[task.id]}
                                  onClick={() => postQuickNote(task.id)}
                                  data-testid={`my-task-note-send-${task.id}`}
                                >
                                  {postingNote[task.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                </Button>
                              </div>
                            </td>
                            <td className="p-2 text-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => onCardClick(task)}
                                title="Open details"
                                data-testid={`my-task-open-${task.id}`}
                              >
                                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="sm:hidden space-y-2">
                  {bucket.tasks.map(task => {
                    const projectDisplay = task.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ");
                    const overdue = isOverdue(task.dueDate, task.status);
                    return (
                      <div
                        key={task.id}
                        className={`border rounded-lg p-3 bg-card space-y-2 ${overdue ? "border-red-200 bg-red-50/30" : ""}`}
                        data-testid={`my-task-card-${task.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm leading-snug" data-testid={`my-task-title-${task.id}`}>{task.title}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{projectDisplay}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => onCardClick(task)}
                            data-testid={`my-task-open-${task.id}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                        {task.holdReason && (
                          <div className="text-[10px] text-red-500 flex items-center gap-0.5">
                            <PauseCircle className="h-3 w-3 shrink-0" />
                            {task.blockedType && <span className={`px-1 py-0 rounded text-[9px] font-semibold mr-0.5 ${task.blockedType === "External" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"}`}>{task.blockedType}</span>}
                            <span className="truncate">{task.holdReason}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <SearchableSelect
                            value={task.status}
                            onValueChange={v => { if (v !== task.status) onStatusChange(task.id, v); }}
                            placeholder="Status"
                            triggerClassName="h-6 text-[10px] w-auto min-w-0 border-none shadow-none p-0"
                            options={TASK_STATUSES.map(s => ({ value: s, label: getTaskStatusLabel(s) }))}
                            data-testid={`my-task-status-${task.id}`}
                          />
                          <SearchableSelect
                            value={task.priority}
                            onValueChange={v => { if (v !== task.priority) onPriorityChange(task.id, v); }}
                            placeholder="Priority"
                            triggerClassName="h-6 text-[10px] w-auto min-w-0 border-none shadow-none p-0"
                            options={PRIORITIES.map(p => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
                            data-testid={`my-task-priority-${task.id}`}
                          />
                          {task.dueDate && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${overdue ? "text-red-700 bg-red-100 font-bold" : "text-muted-foreground"}`}>
                              {daysLabel(task.dueDate) || formatDateShort(task.dueDate)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Input
                            placeholder="Add note..."
                            className="h-7 text-[10px] flex-1 min-w-0"
                            value={quickNotes[task.id] || ""}
                            onChange={e => setQuickNotes(prev => ({ ...prev, [task.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter" && quickNotes[task.id]?.trim()) postQuickNote(task.id); }}
                            data-testid={`my-task-note-${task.id}`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            disabled={!quickNotes[task.id]?.trim() || postingNote[task.id]}
                            onClick={() => postQuickNote(task.id)}
                            data-testid={`my-task-note-send-${task.id}`}
                          >
                            {postingNote[task.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {filteredMyTasks.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <UserCog className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No tasks found</p>
          <p className="text-sm mt-1">{myTasks.length === 0 ? "You have no assigned tasks" : "Adjust your filters to see tasks"}</p>
        </div>
      )}
    </div>
  );
}
