import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { PageShell, SectionHeader, FilterBar } from "@/components/layout/page-shell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import {
  Milestone, Search, Calendar, CheckCircle2, Clock, AlertTriangle,
  ArrowRight, ChevronRight, Flag, Target, BarChart3, Filter,
} from "lucide-react";

// ── API helper ──────────────────────────────────────────────────────────────

async function apiFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to load data");
  return res.json();
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ProjectMilestone {
  projectId: number;
  projectName: string;
  phase: string | null;
  pm: string | null;
  constructionManager: string | null;
  milestones: {
    name: string;
    targetDate: string | null;
    actualDate: string | null;
    status: "completed" | "on_track" | "at_risk" | "overdue" | "upcoming";
    percentComplete: number;
  }[];
  overallProgress: number;
}

// ── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-800", icon: CheckCircle2 },
  on_track: { label: "On Track", color: "bg-blue-100 text-blue-800", icon: ArrowRight },
  at_risk: { label: "At Risk", color: "bg-amber-100 text-amber-800", icon: AlertTriangle },
  overdue: { label: "Overdue", color: "bg-red-100 text-red-800", icon: Clock },
  upcoming: { label: "Upcoming", color: "bg-gray-100 text-gray-600", icon: Calendar },
};

// ── Standard construction milestones ────────────────────────────────────────

const MILESTONE_COLUMNS = [
  "Site Access",
  "Foundation Complete",
  "Structure Complete",
  "Electrical Rough-In",
  "Mechanical Complete",
  "Commissioning Start",
  "Commissioning Complete",
  "Client Handover",
];

// ── Components ──────────────────────────────────────────────────────────────

function MilestoneStatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.upcoming;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${config.color}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold tracking-tight mt-1 ${color || ""}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Wireframe page using real project data ──────────────────────────────────

export default function MilestoneTrackerPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<"timeline" | "table">("timeline");

  // Fetch project data to build milestone overview
  const { data: projects, isLoading, isError, error } = useQuery<any[]>({
    queryKey: ["/api/project-info"],
  });

  // Transform project data into milestone structure
  const milestoneData: ProjectMilestone[] = useMemo(() => {
    if (!projects) return [];
    return projects
      .filter((p: any) => p.isActive !== false && p.phase)
      .map((p: any) => {
        const phase = (p.phase || "").toLowerCase();
        const pctComplete = p.projectPctComplete || 0;

        // Derive milestone status from project phase
        const milestones = MILESTONE_COLUMNS.map((name, idx) => {
          const threshold = ((idx + 1) / MILESTONE_COLUMNS.length) * 100;
          let status: ProjectMilestone["milestones"][0]["status"] = "upcoming";
          if (pctComplete >= threshold) status = "completed";
          else if (pctComplete >= threshold - 15) status = "on_track";
          else if (pctComplete >= threshold - 30 && idx <= 3) status = "at_risk";

          return {
            name,
            targetDate: null,
            actualDate: null,
            status,
            percentComplete: Math.min(100, Math.max(0, Math.round((pctComplete / threshold) * 100))),
          };
        });

        return {
          projectId: p.id,
          projectName: (p.projectName || p.project_name || "").replace(/_Tracker.*$/i, "").replace(/_/g, " "),
          phase: p.phase,
          pm: p.pm || null,
          constructionManager: null,
          milestones,
          overallProgress: pctComplete,
        };
      })
      .filter((p) => p.projectName)
      .sort((a, b) => a.projectName.localeCompare(b.projectName));
  }, [projects]);

  // Filter
  const filtered = useMemo(() => {
    let result = milestoneData;
    if (search) {
      const term = search.toLowerCase();
      result = result.filter((p) =>
        p.projectName.toLowerCase().includes(term) ||
        (p.pm || "").toLowerCase().includes(term)
      );
    }
    if (statusFilter !== "all") {
      result = result.filter((p) =>
        p.milestones.some((m) => m.status === statusFilter)
      );
    }
    return result;
  }, [milestoneData, search, statusFilter]);

  // KPI summary
  const totalProjects = filtered.length;
  const atRiskCount = filtered.filter((p) => p.milestones.some((m) => m.status === "at_risk")).length;
  const overdueCount = filtered.filter((p) => p.milestones.some((m) => m.status === "overdue")).length;
  const avgProgress = totalProjects > 0 ? Math.round(filtered.reduce((s, p) => s + p.overallProgress, 0) / totalProjects) : 0;

  if (isLoading) return <PageShell><PageSkeleton lines={8} /></PageShell>;
  if (isError) return <PageShell><PageError title="Failed to load milestones" message={error instanceof Error ? error.message : "Failed to fetch"} /></PageShell>;

  return (
    <PageShell>
      <SectionHeader
        icon={<Milestone className="h-5 w-5" />}
        title="Milestone Tracker"
        description="Track construction milestones across all active projects. Identify at-risk deliverables and monitor progress toward key dates."
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Active Projects" value={totalProjects} />
        <KPICard label="Average Progress" value={`${avgProgress}%`} />
        <KPICard label="At Risk" value={atRiskCount} color="text-amber-600" />
        <KPICard label="Overdue" value={overdueCount} color="text-red-600" />
      </div>

      {/* Filters */}
      <FilterBar>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="on_track">On Track</SelectItem>
              <SelectItem value="at_risk">At Risk</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-1 border rounded-md p-0.5">
            <Button size="sm" variant={view === "timeline" ? "default" : "ghost"} className="h-7 px-2" onClick={() => setView("timeline")}>
              <BarChart3 className="h-3.5 w-3.5 mr-1" /> Timeline
            </Button>
            <Button size="sm" variant={view === "table" ? "default" : "ghost"} className="h-7 px-2" onClick={() => setView("table")}>
              <Filter className="h-3.5 w-3.5 mr-1" /> Table
            </Button>
          </div>
        </div>
      </FilterBar>

      {/* Timeline / Gantt-style view */}
      {view === "timeline" ? (
        <Card className="overflow-hidden">
          {/* Column headers */}
          <div className="bg-muted px-4 py-2 grid gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
               style={{ gridTemplateColumns: `200px repeat(${MILESTONE_COLUMNS.length}, 1fr)` }}>
            <span>Project</span>
            {MILESTONE_COLUMNS.map((col) => (
              <span key={col} className="text-center truncate">{col}</span>
            ))}
          </div>

          {/* Rows */}
          <div className="max-h-[600px] overflow-y-auto">
            {filtered.map((project) => (
              <div
                key={project.projectId}
                className="px-4 py-2.5 grid gap-2 items-center border-b last:border-b-0 hover:bg-muted/40 transition-all"
                style={{ gridTemplateColumns: `200px repeat(${MILESTONE_COLUMNS.length}, 1fr)` }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{project.projectName}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {project.pm ? `PM: ${project.pm}` : ""}
                    {project.phase ? ` | ${project.phase}` : ""}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Progress value={project.overallProgress} className="h-1 flex-1" />
                    <span className="text-[10px] font-semibold tabular-nums">{project.overallProgress}%</span>
                  </div>
                </div>
                {project.milestones.map((m, idx) => (
                  <div key={idx} className="flex justify-center">
                    <MilestoneStatusBadge status={m.status} />
                  </div>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="ee-empty-state py-12">
                <Target className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-semibold">No projects match your filters</p>
              </div>
            )}
          </div>
        </Card>
      ) : (
        /* Table view */
        <Card className="overflow-hidden">
          <div className="bg-muted px-4 py-2 grid grid-cols-[1fr_120px_100px_100px_120px_80px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Project</span>
            <span>Phase</span>
            <span>Progress</span>
            <span>At Risk</span>
            <span>Next Milestone</span>
            <span>PM</span>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {filtered.map((project) => {
              const nextMilestone = project.milestones.find((m) => m.status !== "completed");
              const atRisk = project.milestones.filter((m) => m.status === "at_risk" || m.status === "overdue").length;
              return (
                <div
                  key={project.projectId}
                  className="px-4 py-2.5 grid grid-cols-[1fr_120px_100px_100px_120px_80px] gap-2 items-center border-b last:border-b-0 hover:bg-muted/40"
                >
                  <span className="text-sm font-medium truncate">{project.projectName}</span>
                  <Badge variant="outline" className="text-[10px] w-fit">{project.phase || "—"}</Badge>
                  <div className="flex items-center gap-1">
                    <Progress value={project.overallProgress} className="h-1.5 flex-1" />
                    <span className="text-[10px] tabular-nums">{project.overallProgress}%</span>
                  </div>
                  <span className={`text-xs font-semibold ${atRisk > 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {atRisk > 0 ? `${atRisk} items` : "None"}
                  </span>
                  <span className="text-xs truncate">{nextMilestone?.name || "All complete"}</span>
                  <span className="text-xs text-muted-foreground truncate">{project.pm || "—"}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </PageShell>
  );
}
