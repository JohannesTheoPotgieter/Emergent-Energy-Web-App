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
import { useLocation } from "wouter";
import {
  Milestone, Search, Calendar, CheckCircle2, Clock, AlertTriangle,
  ArrowRight, Target, BarChart3, Filter, ExternalLink, ListChecks,
  DollarSign, TrendingUp,
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
  contractValue: string | null;
  sizeKwp: string | null;
  updatedAt: string | null;
  ragStatus: string | null;
  engTotal: number;
  engDone: number;
  planTotal: number;
  planAvgPct: number;
  projectPctComplete: number;
  constructionStartDate: string | null;
  commissioningDate: string | null;
  clientHandoverDate: string | null;
  milestones: {
    name: string;
    targetDate: string | null;
    status: "completed" | "on_track" | "at_risk" | "overdue" | "upcoming";
  }[];
}

// ── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; dotColor: string; icon: typeof CheckCircle2 }> = {
  completed: { label: "Done", color: "bg-emerald-100 text-emerald-800", dotColor: "bg-emerald-500", icon: CheckCircle2 },
  on_track: { label: "On Track", color: "bg-blue-100 text-blue-800", dotColor: "bg-blue-500", icon: ArrowRight },
  at_risk: { label: "At Risk", color: "bg-amber-100 text-amber-800", dotColor: "bg-amber-500", icon: AlertTriangle },
  overdue: { label: "Overdue", color: "bg-red-100 text-red-800", dotColor: "bg-red-500", icon: Clock },
  upcoming: { label: "Upcoming", color: "bg-gray-100 text-gray-600", dotColor: "bg-gray-300", icon: Calendar },
};

// ── Revenue milestones matching the stage lifecycle ─────────────────────────

const REVENUE_MILESTONES = [
  { key: "cp_signed", name: "CP Signed", revenueLabel: "Contract Value" },
  { key: "financial_close", name: "Financial Close", revenueLabel: "Deposit / Advance" },
  { key: "construction_start", name: "Construction Start", revenueLabel: "1st Progress Claim" },
  { key: "50pct_complete", name: "50% Complete", revenueLabel: "Mid-stage Claim" },
  { key: "commissioning", name: "Commissioning", revenueLabel: "Commissioning Claim" },
  { key: "client_handover", name: "Client Handover", revenueLabel: "Final Invoice" },
  { key: "dlp_close", name: "DLP Close", revenueLabel: "Retention Release" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatZAR(value: string | number | null): string {
  if (value == null) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return "—";
  return `R ${num.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
}

function ragDotClass(status: string | null): string {
  switch ((status || "").toUpperCase()) {
    case "GREEN": return "bg-emerald-500";
    case "AMBER": return "bg-amber-500";
    case "RED": return "bg-red-500";
    default: return "bg-gray-300";
  }
}

// ── Components ──────────────────────────────────────────────────────────────

function MilestoneDot({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.upcoming;
  return (
    <div className="flex flex-col items-center gap-0.5" title={config.label}>
      <div className={`w-3.5 h-3.5 rounded-full ${config.dotColor} ring-2 ring-white shadow-sm`} />
      <span className="text-[8px] font-semibold text-muted-foreground">{config.label}</span>
    </div>
  );
}

function KPICard({ label, value, sub, color, icon: Icon }: { label: string; value: string | number; sub?: string; color?: string; icon?: typeof CheckCircle2 }) {
  return (
    <Card>
      <CardContent className="px-4 py-3 flex items-center gap-3">
        {Icon && (
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Icon className={`h-5 w-5 ${color || "text-muted-foreground"}`} />
          </div>
        )}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={`text-xl font-bold tracking-tight ${color || ""}`}>{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function MilestoneTrackerPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<"timeline" | "table">("timeline");
  const [, navigate] = useLocation();

  // Fetch project data
  const { data: projects, isLoading, isError, error } = useQuery<any[]>({
    queryKey: ["/api/project-info"],
  });

  // Also fetch task counts per project
  const { data: taskSummary } = useQuery<Record<number, { total: number; done: number; overdue: number }>>({
    queryKey: ["milestone-task-summary"],
    queryFn: async () => {
      try {
        const data = await apiFetch("/api/tasks/board");
        // Aggregate from board data
        const summary: Record<number, { total: number; done: number; overdue: number }> = {};
        for (const [status, items] of Object.entries(data as Record<string, any[]>)) {
          for (const item of items) {
            if (!summary[item.projectId]) summary[item.projectId] = { total: 0, done: 0, overdue: 0 };
            summary[item.projectId].total++;
            if (status === "Complete") summary[item.projectId].done++;
            if (status === "Delayed") summary[item.projectId].overdue++;
          }
        }
        return summary;
      } catch {
        return {};
      }
    },
  });

  // Transform project data into milestone structure
  const milestoneData: ProjectMilestone[] = useMemo(() => {
    if (!projects) return [];
    return projects
      .filter((p: any) => p.isActive !== false && p.phase)
      .map((p: any) => {
        const pctComplete = p.projectPctComplete || 0;

        // Derive revenue milestone statuses from project progress
        const milestones = REVENUE_MILESTONES.map((rm, idx) => {
          const threshold = ((idx + 1) / REVENUE_MILESTONES.length) * 100;
          let status: ProjectMilestone["milestones"][0]["status"] = "upcoming";
          if (pctComplete >= threshold) status = "completed";
          else if (pctComplete >= threshold - 12) status = "on_track";
          else if (pctComplete >= threshold - 25 && pctComplete > 0) status = "at_risk";

          // Override with real dates if available
          let targetDate: string | null = null;
          if (rm.key === "construction_start") targetDate = p.constructionStartDate || null;
          if (rm.key === "commissioning") targetDate = p.commissioningDate || null;
          if (rm.key === "client_handover") targetDate = p.clientHandoverDate || null;

          // Check if target date is past and milestone not completed
          if (targetDate && status !== "completed") {
            const target = new Date(targetDate);
            if (target < new Date()) status = "overdue";
          }

          return { name: rm.name, targetDate, status };
        });

        return {
          projectId: p.id,
          projectName: (p.projectName || p.project_name || "").replace(/_Tracker.*$/i, "").replace(/_/g, " "),
          phase: p.phase,
          pm: p.pm || null,
          contractValue: p.contractValue || null,
          sizeKwp: p.sizeKwp || null,
          updatedAt: p.updatedAt || null,
          ragStatus: p.ragStatus || null,
          engTotal: p.engTotal || 0,
          engDone: p.engDone || 0,
          planTotal: p.planTotal || 0,
          planAvgPct: p.planAvgPct || 0,
          projectPctComplete: pctComplete,
          constructionStartDate: p.constructionStartDate || null,
          commissioningDate: p.commissioningDate || null,
          clientHandoverDate: p.clientHandoverDate || null,
          milestones,
        };
      })
      .filter((p) => p.projectName)
      .sort((a, b) => a.projectName.localeCompare(b.projectName));
  }, [projects]);

  // Filters
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
  const totalContractValue = filtered.reduce((sum, p) => {
    const val = parseFloat(p.contractValue || "0");
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
  const avgProgress = totalProjects > 0 ? Math.round(filtered.reduce((s, p) => s + p.projectPctComplete, 0) / totalProjects) : 0;

  if (isLoading) return <PageShell><PageSkeleton lines={8} /></PageShell>;
  if (isError) return <PageShell><PageError title="Failed to load milestones" message={error instanceof Error ? error.message : "Failed to fetch"} /></PageShell>;

  return (
    <PageShell>
      <SectionHeader
        icon={<Milestone className="h-5 w-5" />}
        title="Milestone Tracker"
        description="Track revenue milestones, construction progress, and task execution across all active projects."
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard label="Active Projects" value={totalProjects} icon={Target} />
        <KPICard label="Portfolio Value" value={formatZAR(totalContractValue)} icon={DollarSign} color="text-emerald-600" />
        <KPICard label="Avg Progress" value={`${avgProgress}%`} icon={TrendingUp} color="text-blue-600" />
        <KPICard label="At Risk" value={atRiskCount} icon={AlertTriangle} color="text-amber-600" />
        <KPICard label="Overdue" value={overdueCount} icon={Clock} color="text-red-600" />
      </div>

      {/* Filters */}
      <FilterBar>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects or PM..." className="pl-9" />
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

      {/* Timeline view — revenue milestones as swim lane dots */}
      {view === "timeline" ? (
        <Card className="overflow-x-auto">
          {/* Column headers */}
          <div className="bg-muted px-3 py-2 grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground min-w-[1100px]"
               style={{ gridTemplateColumns: `220px repeat(${REVENUE_MILESTONES.length}, 1fr) 90px` }}>
            <span>Project</span>
            {REVENUE_MILESTONES.map((rm) => (
              <span key={rm.key} className="text-center">
                <div>{rm.name}</div>
                <div className="font-normal text-[8px] opacity-70">{rm.revenueLabel}</div>
              </span>
            ))}
            <span className="text-center">Tasks</span>
          </div>

          {/* Rows */}
          <div className="max-h-[600px] overflow-y-auto">
            {filtered.map((project) => {
              const tasks = taskSummary?.[project.projectId];
              return (
                <div
                  key={project.projectId}
                  className="px-3 py-2 grid gap-1 items-center border-b last:border-b-0 hover:bg-muted/40 transition-all cursor-pointer min-w-[1100px]"
                  style={{ gridTemplateColumns: `220px repeat(${REVENUE_MILESTONES.length}, 1fr) 90px` }}
                  onClick={() => navigate(`/project/${encodeURIComponent(project.projectName.replace(/ /g, "_"))}`)}
                >
                  {/* Project info column */}
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${ragDotClass(project.ragStatus)} shrink-0`} />
                      <p className="text-sm font-medium truncate">{project.projectName}</p>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{project.pm || "No PM"}</span>
                      <span className="opacity-50">|</span>
                      <span>{formatZAR(project.contractValue)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Progress value={project.projectPctComplete} className="h-1 flex-1" />
                      <span className="text-[9px] font-semibold tabular-nums w-[30px] text-right">{project.projectPctComplete}%</span>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      Updated: {timeAgo(project.updatedAt)}
                    </div>
                  </div>

                  {/* Revenue milestone dots */}
                  {project.milestones.map((m, idx) => (
                    <div key={idx} className="flex justify-center">
                      <MilestoneDot status={m.status} />
                    </div>
                  ))}

                  {/* Task tracking column */}
                  <div className="flex flex-col items-center gap-0.5">
                    {tasks ? (
                      <>
                        <div className="flex items-center gap-1 text-[10px]">
                          <ListChecks className="h-3 w-3 text-muted-foreground" />
                          <span className="font-semibold">{tasks.done}/{tasks.total}</span>
                        </div>
                        {tasks.overdue > 0 && (
                          <span className="text-[9px] text-red-600 font-semibold">{tasks.overdue} overdue</span>
                        )}
                        <Progress value={tasks.total > 0 ? (tasks.done / tasks.total) * 100 : 0} className="h-1 w-14" />
                      </>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="ee-empty-state py-12">
                <Target className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-semibold">No projects match your filters</p>
              </div>
            )}
          </div>
        </Card>
      ) : (
        /* Table view — detailed with amounts, last update, tasks */
        <Card className="overflow-x-auto">
          <div className="bg-muted px-3 py-2 grid grid-cols-[1fr_100px_100px_90px_100px_80px_80px_100px] gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground min-w-[900px]">
            <span>Project</span>
            <span>Phase</span>
            <span>Contract Value</span>
            <span>Progress</span>
            <span>At Risk</span>
            <span>Tasks</span>
            <span>Last Update</span>
            <span>PM</span>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {filtered.map((project) => {
              const nextMilestone = project.milestones.find((m) => m.status !== "completed");
              const atRisk = project.milestones.filter((m) => m.status === "at_risk" || m.status === "overdue").length;
              const tasks = taskSummary?.[project.projectId];
              return (
                <div
                  key={project.projectId}
                  className="px-3 py-2 grid grid-cols-[1fr_100px_100px_90px_100px_80px_80px_100px] gap-2 items-center border-b last:border-b-0 hover:bg-muted/40 cursor-pointer min-w-[900px]"
                  onClick={() => navigate(`/project/${encodeURIComponent(project.projectName.replace(/ /g, "_"))}`)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${ragDotClass(project.ragStatus)} shrink-0`} />
                      <span className="text-sm font-medium truncate">{project.projectName}</span>
                    </div>
                    {project.sizeKwp && <span className="text-[9px] text-muted-foreground">{project.sizeKwp} kWp</span>}
                  </div>
                  <Badge variant="outline" className="text-[10px] w-fit">{project.phase || "—"}</Badge>
                  <span className="text-xs font-medium tabular-nums">{formatZAR(project.contractValue)}</span>
                  <div className="flex items-center gap-1">
                    <Progress value={project.projectPctComplete} className="h-1.5 flex-1" />
                    <span className="text-[10px] tabular-nums">{project.projectPctComplete}%</span>
                  </div>
                  <span className={`text-xs font-semibold ${atRisk > 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {atRisk > 0 ? `${atRisk} milestones` : "On track"}
                  </span>
                  <span className="text-xs tabular-nums">
                    {tasks ? `${tasks.done}/${tasks.total}` : "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(project.updatedAt)}</span>
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
