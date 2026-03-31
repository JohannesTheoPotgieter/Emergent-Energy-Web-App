import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocation } from "wouter";
import {
  Milestone, Search, CheckCircle2, Clock, AlertTriangle,
  Target, DollarSign, TrendingUp,
  Pencil, Loader2, BanknoteIcon, FileText, CircleDot, ChevronDown, ChevronRight,
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

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

async function apiFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, { ...options, headers: getAuthHeaders(), credentials: "include" });
  if (!res.ok) throw new Error("Failed to load data");
  return res.json();
}

// ── Types ───────────────────────────────────────────────────────────────────

interface RevenueMilestone {
  id: number;
  rowNumber: number;
  milestoneNo: string;
  milestoneName: string;
  milestonePercent: string;
  milestoneAmount: string;
  date: string | null;
  isRed: boolean;
  milestoneInvoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  inBank: boolean;
  status: "planned" | "invoiced" | "overdue" | "inBank";
  flags: string[];
  hasOverride: boolean;
  milestoneNotes: string | null;
}

interface RevenueTabData {
  milestones: RevenueMilestone[];
  summary: {
    totalContract: number;
    invoiced: number;
    inBank: number;
    pending: number;
    overdue: number;
    milestoneCount: number;
    issueCount: number;
  };
}

interface ProjectRow {
  projectId: number;
  projectName: string;
  projectNameRaw: string;
  phase: string | null;
  pm: string | null;
  contractValue: string | null;
  sizeKwp: string | null;
  ragStatus: string | null;
  projectPctComplete: number;
  latestUpdate: string | null;
  latestUpdateAt: string | null;
  latestUpdateBy: string | null;
  milestones: RevenueMilestone[];
  revenueSummary: RevenueTabData["summary"] | null;
  /** Sorting category: 0 = overdue, 1 = upcoming 14 days, 2 = rest */
  urgencyGroup: 0 | 1 | 2;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatZAR(value: string | number | null, showZero = false): string {
  if (value == null) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  if (num === 0 && !showZero) return "—";
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

/** Determine urgency group: 0=overdue, 1=upcoming 14 days, 2=rest */
function computeUrgencyGroup(milestones: RevenueMilestone[]): 0 | 1 | 2 {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const in14 = new Date(now);
  in14.setDate(in14.getDate() + 14);

  let hasOverdue = false;
  let hasUpcoming = false;

  for (const m of milestones) {
    if (m.status === "overdue") { hasOverdue = true; break; }
    if ((m.status === "planned" || m.status === "invoiced") && m.date) {
      const d = new Date(m.date);
      if (!isNaN(d.getTime()) && d >= now && d <= in14) hasUpcoming = true;
    }
  }

  if (hasOverdue) return 0;
  if (hasUpcoming) return 1;
  return 2;
}

function ragDotClass(status: string | null): string {
  switch ((status || "").toUpperCase()) {
    case "GREEN": return "bg-emerald-500";
    case "AMBER": return "bg-amber-500";
    case "RED": return "bg-red-500";
    default: return "bg-gray-300";
  }
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "2-digit" });
}

const MILESTONE_STATUS_CONFIG = {
  inBank: { label: "In Bank", bg: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500", icon: BanknoteIcon },
  invoiced: { label: "Invoiced", bg: "bg-blue-100 text-blue-800", dot: "bg-blue-500", icon: FileText },
  overdue: { label: "Overdue", bg: "bg-red-100 text-red-800", dot: "bg-red-500", icon: Clock },
  planned: { label: "Planned", bg: "bg-gray-100 text-gray-600", dot: "bg-gray-300", icon: CircleDot },
};

// ── Components ──────────────────────────────────────────────────────────────

function MilestoneStatusBadge({ status }: { status: RevenueMilestone["status"] }) {
  const config = MILESTONE_STATUS_CONFIG[status] || MILESTONE_STATUS_CONFIG.planned;
  const Icon = config.icon;
  return (
    <Badge className={`${config.bg} text-[9px] px-1.5 py-0 gap-0.5 font-semibold`}>
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </Badge>
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

function LatestUpdateCell({ project, onSaved }: { project: ProjectRow; onSaved: () => void }) {
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
      await apiFetch(`/api/projects-summary/${encodeURIComponent(project.projectNameRaw)}/latest-update`, {
        method: "PATCH",
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
              Update Status — {project.projectName}
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
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const toggleProject = (id: number) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (projectIds: number[]) => {
    setExpandedProjects((prev) => {
      const allExpanded = projectIds.every((id) => prev.has(id));
      return allExpanded ? new Set() : new Set(projectIds);
    });
  };

  // 1. Fetch all projects
  const { data: allProjects, isLoading: projectsLoading, isError, error } = useQuery<any[]>({
    queryKey: ["/api/project-info"],
  });

  // 2. Filter to Construction-Client Handover
  const eligibleProjects = useMemo(() => {
    if (!allProjects) return [];
    return allProjects.filter((p: any) => p.isActive !== false && isInMilestonePhase(p.phase));
  }, [allProjects]);

  // 3. Fetch revenue milestones for each eligible project
  const revenueQueries = useQueries({
    queries: eligibleProjects.map((p: any) => ({
      queryKey: ["revenue-tab", p.projectName || p.project_name],
      queryFn: () => apiFetch(`/api/revenue-tab/${encodeURIComponent(p.projectName || p.project_name)}`),
      enabled: !!(p.projectName || p.project_name),
      staleTime: 60_000,
      retry: 1,
    })),
  });

  const revenueLoading = revenueQueries.some(q => q.isLoading);

  // 4. Merge project info with revenue milestones
  const projectRows: ProjectRow[] = useMemo(() => {
    return eligibleProjects.map((p: any, idx: number) => {
      const rawName = p.projectName || p.project_name || "";
      const revenueData = revenueQueries[idx]?.data as RevenueTabData | undefined;
      const milestones = revenueData?.milestones || [];
      const summary = revenueData?.summary || null;

      // Calculate milestone revenue completion % from inBank / totalContract
      let pctComplete = 0;
      if (summary && summary.totalContract > 0) {
        pctComplete = Math.round((summary.inBank / summary.totalContract) * 100);
      }

      return {
        projectId: p.id,
        projectName: rawName.replace(/_Tracker.*$/i, "").replace(/_/g, " "),
        projectNameRaw: rawName,
        phase: p.phase,
        pm: p.pm || null,
        contractValue: p.contractValue || null,
        sizeKwp: p.sizeKwp || null,
        ragStatus: p.ragStatus || null,
        projectPctComplete: pctComplete,
        latestUpdate: p.latestUpdate || null,
        latestUpdateAt: p.latestUpdateAt || null,
        latestUpdateBy: p.latestUpdateBy || null,
        milestones,
        revenueSummary: summary,
        urgencyGroup: computeUrgencyGroup(milestones),
      };
    })
    .filter((p) => p.projectName)
    .sort((a, b) => {
      // Primary: urgency group (overdue first, then upcoming, then rest)
      if (a.urgencyGroup !== b.urgencyGroup) return a.urgencyGroup - b.urgencyGroup;
      // Secondary: alphabetical
      return a.projectName.localeCompare(b.projectName);
    });
  }, [eligibleProjects, revenueQueries]);

  // Filters
  const filtered = useMemo(() => {
    let result = projectRows;
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
  }, [projectRows, search, statusFilter]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/project-info"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
  };

  // KPI summary — from actual revenue data, with contractValue fallback
  const totalProjects = filtered.length;
  const totalContract = filtered.reduce((sum, p) => {
    const revTotal = p.revenueSummary?.totalContract || 0;
    if (revTotal > 0) return sum + revTotal;
    // Fallback to project_info contractValue when revenue data unavailable
    return sum + (p.contractValue ? parseFloat(p.contractValue) || 0 : 0);
  }, 0);
  const totalInBank = filtered.reduce((sum, p) => sum + (p.revenueSummary?.inBank || 0), 0);
  const totalOverdue = filtered.reduce((sum, p) => sum + (p.revenueSummary?.overdue || 0), 0);
  const totalPending = filtered.reduce((sum, p) => sum + (p.revenueSummary?.pending || 0), 0);
  const overdueProjects = filtered.filter(p => (p.revenueSummary?.overdue || 0) > 0).length;

  if (projectsLoading) return <PageShell><PageSkeleton lines={8} /></PageShell>;
  if (isError) return <PageShell><PageError title="Failed to load milestones" message={error instanceof Error ? error.message : "Failed to fetch"} /></PageShell>;

  return (
    <PageShell>
      <SectionHeader
        icon={<Milestone className="h-5 w-5" />}
        title="Milestone Tracker"
        description="Construction through Client Handover — revenue milestones mapped from each project's inflows."
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard label="Projects" value={totalProjects} icon={Target} />
        <KPICard label="Total Contract" value={formatZAR(totalContract, true)} icon={DollarSign} color="text-emerald-600" />
        <KPICard label="In Bank" value={formatZAR(totalInBank, true)} icon={BanknoteIcon} color="text-green-600" />
        <KPICard label="Pending" value={formatZAR(totalPending, true)} icon={TrendingUp} color="text-blue-600" />
        <KPICard
          label="Overdue"
          value={overdueProjects}
          sub={totalOverdue > 0 ? formatZAR(totalOverdue) : undefined}
          icon={AlertTriangle}
          color="text-red-600"
        />
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
              <SelectItem value="inBank">In Bank</SelectItem>
              <SelectItem value="invoiced">Invoiced</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="planned">Planned</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-8"
            onClick={() => toggleAll(filtered.map((p) => p.projectId))}
          >
            {filtered.length > 0 && filtered.every((p) => expandedProjects.has(p.projectId))
              ? "Collapse All"
              : "Expand All"}
          </Button>
          {revenueLoading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading milestones...
            </div>
          )}
        </div>
      </FilterBar>

      {/* Project rows with their revenue milestones */}
      <div className="space-y-1.5">
        {filtered.map((project, idx) => {
          const isExpanded = expandedProjects.has(project.projectId);
          const prevGroup = idx > 0 ? filtered[idx - 1].urgencyGroup : -1;
          const showGroupHeader = project.urgencyGroup !== prevGroup;
          const headerBg = project.urgencyGroup === 0
            ? "bg-red-50 border-l-2 border-l-red-400"
            : project.urgencyGroup === 1
            ? "bg-amber-50 border-l-2 border-l-amber-400"
            : "bg-muted/30";
          return (
          <div key={project.projectId}>
            {showGroupHeader && (
              <div className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 mt-2 ${
                project.urgencyGroup === 0 ? "text-red-700" :
                project.urgencyGroup === 1 ? "text-amber-700" : "text-muted-foreground"
              }`}>
                {project.urgencyGroup === 0 ? "Overdue" :
                 project.urgencyGroup === 1 ? "Upcoming (Next 14 Days)" : "Other Projects"}
              </div>
            )}
          <Card className="overflow-hidden">
            {/* Project header row — click to expand/collapse */}
            <div
              className={`px-3 py-2 flex items-center gap-3 flex-wrap cursor-pointer select-none hover:bg-muted/50 transition-colors ${headerBg}`}
              onClick={() => toggleProject(project.projectId)}
            >
              {/* Chevron */}
              {isExpanded
                ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              }

              {/* RAG dot + name + phase */}
              <div className="flex items-center gap-2 min-w-[180px]">
                <div className={`w-2 h-2 rounded-full ${ragDotClass(project.ragStatus)} shrink-0`} />
                <span
                  className="text-sm font-semibold hover:underline"
                  onClick={(e) => { e.stopPropagation(); navigate(`/project/${encodeURIComponent(project.projectNameRaw)}`); }}
                >
                  {project.projectName}
                </span>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0">{project.phase}</Badge>
              </div>

              {/* Compact info */}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>{project.pm || "No PM"}</span>
                <span>{formatZAR(project.contractValue)}</span>
                {project.sizeKwp && <span>{parseFloat(project.sizeKwp).toFixed(0)} kWp</span>}
              </div>

              {/* Revenue summary badges */}
              {project.revenueSummary && (
                <div className="flex items-center gap-2 text-[10px] ml-auto">
                  <span className="text-emerald-700 font-semibold">
                    In Bank: {formatZAR(project.revenueSummary.inBank)}
                  </span>
                  {project.revenueSummary.overdue > 0 && (
                    <span className="text-red-600 font-semibold">
                      Overdue: {formatZAR(project.revenueSummary.overdue)}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {project.revenueSummary.milestoneCount} milestones
                  </span>
                </div>
              )}

              {/* Progress bar */}
              <div className="flex items-center gap-1.5 w-[80px] shrink-0">
                <Progress value={project.projectPctComplete} className="h-1.5 flex-1" />
                <span className="text-[9px] font-semibold tabular-nums">{project.projectPctComplete}%</span>
              </div>

              {/* Last update */}
              <div className="w-[160px] shrink-0" onClick={(e) => e.stopPropagation()}>
                <LatestUpdateCell project={project} onSaved={invalidate} />
              </div>
            </div>

            {/* Milestone table — only shown when expanded */}
            {isExpanded && (
              <>
                {project.milestones.length > 0 ? (
                  <div className="overflow-x-auto border-t">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b bg-muted/20 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-1.5 text-left w-[40px]">#</th>
                          <th className="px-3 py-1.5 text-left">Milestone</th>
                          <th className="px-3 py-1.5 text-right w-[120px]">Amount</th>
                          <th className="px-3 py-1.5 text-center w-[90px]">Date</th>
                          <th className="px-3 py-1.5 text-center w-[100px]">Invoice</th>
                          <th className="px-3 py-1.5 text-center w-[80px]">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {project.milestones.map((m) => {
                          const amt = parseFloat(m.milestoneAmount || "0");
                          return (
                            <tr key={m.id} className="border-b last:border-b-0 hover:bg-muted/20">
                              <td className="px-3 py-1.5 text-muted-foreground">{m.milestoneNo || m.rowNumber}</td>
                              <td className="px-3 py-1.5 font-medium">
                                {m.milestoneName || "—"}
                                {m.milestoneNotes && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="ml-1 text-muted-foreground cursor-help">*</span>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs text-xs">
                                        {m.milestoneNotes}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                                {isNaN(amt) || amt === 0 ? "—" : formatZAR(amt)}
                              </td>
                              <td className={`px-3 py-1.5 text-center tabular-nums ${m.isRed ? "text-red-600 font-semibold" : ""}`}>
                                {formatDate(m.date)}
                              </td>
                              <td className="px-3 py-1.5 text-center text-muted-foreground">
                                {m.milestoneInvoiceNumber || "—"}
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                <MilestoneStatusBadge status={m.status} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-3 text-center text-[11px] text-muted-foreground italic border-t">
                    {revenueLoading ? "Loading milestones..." : "No revenue milestones found for this project"}
                  </div>
                )}
              </>
            )}
          </Card>
          </div>
          );
        })}

        {filtered.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <Target className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-semibold">No projects in Construction — Client Handover match your filters</p>
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
