import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { PageShell, SectionHeader, FilterBar } from "@/components/layout/page-shell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useLocation } from "wouter";
import {
  Milestone, Search, Calendar, CheckCircle2, Clock, AlertTriangle,
  ArrowRight, Target, BarChart3, Filter, DollarSign, TrendingUp,
  Pencil, Loader2,
} from "lucide-react";

// ── Construction-to-Client-Handover phase filter ───────────────────────────

const MILESTONE_PHASES = [
  "Construction",
  "Commissioning",
  "O&M Handover",
  "Client Handover",
];

function isInMilestonePhase(phase: string | null): boolean {
  if (!phase) return false;
  const normalized = phase.trim().toLowerCase();
  return MILESTONE_PHASES.some(p => p.toLowerCase() === normalized) ||
    /^(P4|P5|P6|S06|S07|S08|S09)/i.test(normalized) ||
    /construction|commissioning|handover/i.test(normalized);
}

// ── API helper ──────────────────────────────────────────────────────────────

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
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
  projectPctComplete: number;
  constructionStartDate: string | null;
  commissioningDate: string | null;
  clientHandoverDate: string | null;
  latestUpdate: string | null;
  latestUpdateAt: string | null;
  latestUpdateBy: string | null;
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

// ── Revenue milestones (construction onwards) ──────────────────────────────

const REVENUE_MILESTONES = [
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

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
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

function LatestUpdateCell({ project, onSaved }: { project: ProjectMilestone; onSaved: () => void }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [value, setValue] = useState(project.latestUpdate || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(project.latestUpdate || "");
  }, [project.latestUpdate]);

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed === (project.latestUpdate || "")) { setDialogOpen(false); return; }
    setSaving(true);
    try {
      await fetch(`/api/projects-summary/${encodeURIComponent(project.projectName)}/latest-update`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ latestUpdate: trimmed || null }),
      });
      onSaved();
    } catch {
      // Silent failure
    }
    setSaving(false);
    setDialogOpen(false);
  };

  const metaLine = [
    project.latestUpdateBy,
    project.latestUpdateAt ? formatRelativeTime(project.latestUpdateAt) : null,
  ].filter(Boolean).join(", ");

  return (
    <>
      <div
        className="cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 group min-w-0"
        onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}
        data-interactive="true"
      >
        {project.latestUpdate ? (
          <>
            <p className="text-[10px] text-foreground leading-snug line-clamp-2 whitespace-pre-line">
              {project.latestUpdate}
            </p>
            {metaLine && (
              <p className="text-[9px] text-muted-foreground mt-0.5">{metaLine}</p>
            )}
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground italic">No update</span>
        )}
        <Pencil className="inline-block ml-1 h-2.5 w-2.5 opacity-0 group-hover:opacity-60 text-muted-foreground" />
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setValue(project.latestUpdate || ""); setDialogOpen(false); } }}>
        <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="h-4 w-4" />
              Update Status — {project.projectName.replace(/_Tracker$/i, "").replace(/_/g, " ")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Write a status update for this project..."
              className="min-h-[160px] text-sm"
              autoFocus
            />
            {metaLine && (
              <p className="text-xs text-muted-foreground">Last updated: {metaLine}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setValue(project.latestUpdate || ""); setDialogOpen(false); }}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function MilestoneTrackerPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<"timeline" | "table">("timeline");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: projects, isLoading, isError, error } = useQuery<any[]>({
    queryKey: ["/api/project-info"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/project-info"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
  };

  // Transform project data — only include Construction to Client Handover
  const milestoneData: ProjectMilestone[] = useMemo(() => {
    if (!projects) return [];
    return projects
      .filter((p: any) => p.isActive !== false && isInMilestonePhase(p.phase))
      .map((p: any) => {
        const pctComplete = p.projectPctComplete || 0;

        const milestones = REVENUE_MILESTONES.map((rm, idx) => {
          const threshold = ((idx + 1) / REVENUE_MILESTONES.length) * 100;
          let status: ProjectMilestone["milestones"][0]["status"] = "upcoming";
          if (pctComplete >= threshold) status = "completed";
          else if (pctComplete >= threshold - 12) status = "on_track";
          else if (pctComplete >= threshold - 25 && pctComplete > 0) status = "at_risk";

          let targetDate: string | null = null;
          if (rm.key === "construction_start") targetDate = p.constructionStartDate || null;
          if (rm.key === "commissioning") targetDate = p.commissioningDate || null;
          if (rm.key === "client_handover") targetDate = p.clientHandoverDate || null;

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
          projectPctComplete: pctComplete,
          constructionStartDate: p.constructionStartDate || null,
          commissioningDate: p.commissioningDate || null,
          clientHandoverDate: p.clientHandoverDate || null,
          latestUpdate: p.latestUpdate || null,
          latestUpdateAt: p.latestUpdateAt || null,
          latestUpdateBy: p.latestUpdateBy || null,
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
        description="Construction through Client Handover — track milestones and capture latest project updates."
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
               style={{ gridTemplateColumns: `220px repeat(${REVENUE_MILESTONES.length}, 1fr) 200px` }}>
            <span>Project</span>
            {REVENUE_MILESTONES.map((rm) => (
              <span key={rm.key} className="text-center">
                <div>{rm.name}</div>
                <div className="font-normal text-[8px] opacity-70">{rm.revenueLabel}</div>
              </span>
            ))}
            <span>Last Update</span>
          </div>

          {/* Rows */}
          <div className="max-h-[600px] overflow-y-auto">
            {filtered.map((project) => (
              <div
                key={project.projectId}
                className="px-3 py-2 grid gap-1 items-center border-b last:border-b-0 hover:bg-muted/40 transition-all min-w-[1100px]"
                style={{ gridTemplateColumns: `220px repeat(${REVENUE_MILESTONES.length}, 1fr) 200px` }}
              >
                {/* Project info column */}
                <div
                  className="min-w-0 space-y-0.5 cursor-pointer"
                  onClick={() => navigate(`/project/${encodeURIComponent(project.projectName.replace(/ /g, "_"))}`)}
                >
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
                  <Badge variant="outline" className="text-[9px] px-1 py-0">{project.phase}</Badge>
                </div>

                {/* Revenue milestone dots */}
                {project.milestones.map((m, idx) => (
                  <div key={idx} className="flex justify-center">
                    <MilestoneDot status={m.status} />
                  </div>
                ))}

                {/* Last Update column */}
                <LatestUpdateCell project={project} onSaved={invalidate} />
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="ee-empty-state py-12">
                <Target className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-semibold">No projects in Construction — Client Handover match your filters</p>
              </div>
            )}
          </div>
        </Card>
      ) : (
        /* Table view */
        <Card className="overflow-x-auto">
          <div className="bg-muted px-3 py-2 grid grid-cols-[1fr_100px_100px_90px_100px_200px_80px] gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground min-w-[900px]">
            <span>Project</span>
            <span>Phase</span>
            <span>Contract Value</span>
            <span>Progress</span>
            <span>At Risk</span>
            <span>Last Update</span>
            <span>PM</span>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {filtered.map((project) => {
              const atRisk = project.milestones.filter((m) => m.status === "at_risk" || m.status === "overdue").length;
              return (
                <div
                  key={project.projectId}
                  className="px-3 py-2 grid grid-cols-[1fr_100px_100px_90px_100px_200px_80px] gap-2 items-center border-b last:border-b-0 hover:bg-muted/40 min-w-[900px]"
                >
                  <div
                    className="min-w-0 cursor-pointer"
                    onClick={() => navigate(`/project/${encodeURIComponent(project.projectName.replace(/ /g, "_"))}`)}
                  >
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
                  <LatestUpdateCell project={project} onSaved={invalidate} />
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
