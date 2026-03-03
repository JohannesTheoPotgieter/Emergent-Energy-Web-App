import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  ShieldCheck,
  AlertTriangle,
  Search,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  BarChart3,
  CheckCircle2,
  Eye,
  Plus,
  ChevronsUpDown,
  Check,
  Loader2,
  ListFilter,
  LayoutGrid,
  Table2,
  ArrowUpDown,
  FileText,
  User,
  Calendar,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ActionBar } from "@/components/guidance/ActionBar";
import { MicroWalkthrough, ReplayWalkthrough } from "@/components/guidance/MicroWalkthrough";
import type { NextAction, BlockerInfo } from "@/hooks/use-guidance";

async function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface ChecklistPhase {
  phaseId: number;
  phaseName: string;
  total: number;
  completed: number;
  failed?: number;
  inReview?: number;
}

interface Checklist {
  id: number;
  projectName: string;
  templateId: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  phases?: ChecklistPhase[];
  warningCount?: number;
}

interface Warning {
  id: number;
  projectName: string;
  severity: string;
  warningType: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
}

interface QualityItem {
  id: number;
  itemName: string;
  description: string;
  projectName: string;
  phaseName: string;
  groupName: string;
  qmStatus: string;
  assigneeName: string | null;
  startDate: string | null;
  endDate: string | null;
  evidenceCount: number;
  approved: boolean;
  approvedAt: string | null;
}

type ProjectSortKey = "name" | "completion" | "warnings" | "updated";
type ProjectSortDir = "asc" | "desc";

function CircularProgress({ value, size = 48, strokeWidth = 4, className = "" }: { value: number; size?: number; strokeWidth?: number; className?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;
  return (
    <svg width={size} height={size} className={className}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-muted/20" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        className="text-emerald-500 transition-all duration-700" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="fill-current text-foreground font-bold" fontSize={size * 0.24}>
        {value}%
      </text>
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    pass: { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", label: "Pass" },
    fail: { bg: "bg-red-500/15", text: "text-red-600 dark:text-red-400", label: "Fail" },
    review: { bg: "bg-amber-500/15", text: "text-amber-600 dark:text-amber-400", label: "Review" },
    na: { bg: "bg-gray-500/15", text: "text-gray-500", label: "N/A" },
    pending: { bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400", label: "Pending" },
  };
  const c = config[status] || config.pending;
  return <Badge variant="outline" className={`${c.bg} ${c.text} border-0 text-xs`}>{c.label}</Badge>;
}

export default function QmDashboardPage() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("project") || "";
  });
  const [viewMode, setViewMode] = useState<"projects" | "items">("projects");
  const [projectSort, setProjectSort] = useState<ProjectSortKey>("name");
  const [projectSortDir, setProjectSortDir] = useState<ProjectSortDir>("asc");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const [warningFilter, setWarningFilter] = useState(false);
  const [warningsExpanded, setWarningsExpanded] = useState(true);
  const [selectedWarning, setSelectedWarning] = useState<Warning | null>(null);
  const [actionType, setActionType] = useState<"override" | "resolve" | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [startQmOpen, setStartQmOpen] = useState(false);
  const [startQmProject, setStartQmProject] = useState("");
  const [startQmPopoverOpen, setStartQmPopoverOpen] = useState(false);
  const [itemsStatusFilter, setItemsStatusFilter] = useState<string>("all");
  const [itemsProjectFilter, setItemsProjectFilter] = useState<string>("all");
  const [itemsPhaseFilter, setItemsPhaseFilter] = useState<string>("all");
  const [itemsSearch, setItemsSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: checklists = [], isLoading: checklistsLoading } = useQuery<Checklist[]>({
    queryKey: ["quality-checklists"],
    queryFn: () => qFetch("/api/quality/checklists"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: warnings = [], isLoading: warningsLoading } = useQuery<Warning[]>({
    queryKey: ["quality-warnings-all"],
    queryFn: () => qFetch("/api/quality/warnings?status=open"),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: allItems = [], isLoading: itemsLoading } = useQuery<QualityItem[]>({
    queryKey: ["quality-all-items"],
    queryFn: () => qFetch("/api/quality/all-items"),
    refetchOnMount: "always",
    staleTime: 0,
    enabled: viewMode === "items",
  });

  const { data: allProjects = [] } = useQuery<Array<{ project_name: string }>>({
    queryKey: ["projects-summary-names"],
    queryFn: () => qFetch("/api/projects-summary").then((data: any[]) =>
      data.map((p: any) => ({ project_name: p.project_name }))
        .sort((a: any, b: any) => a.project_name.localeCompare(b.project_name))
    ),
    enabled: startQmOpen,
  });

  const existingQmProjects = useMemo(() => {
    return new Set(checklists.map(c => c.projectName));
  }, [checklists]);

  const availableProjects = useMemo(() => {
    return allProjects.filter(p => !existingQmProjects.has(p.project_name));
  }, [allProjects, existingQmProjects]);

  const startQmMutation = useMutation({
    mutationFn: (projectName: string) =>
      qFetch(`/api/quality/project/${encodeURIComponent(projectName)}/checklist`),
    onSuccess: (_data, projectName) => {
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
      toast({ title: "Quality process started", description: `Quality checklist created for ${projectName}.` });
      setStartQmOpen(false);
      setStartQmProject("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to start quality process.", variant: "destructive" });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (data: { warningId: number; note: string }) =>
      qFetch(`/api/quality/warning/${data.warningId}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ note: data.note }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
      toast({ title: "Warning overridden", description: "The warning has been acknowledged and overridden." });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to override warning.", variant: "destructive" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (data: { warningId: number; note: string }) =>
      qFetch(`/api/quality/warning/${data.warningId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ note: data.note }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-warnings-all"] });
      queryClient.invalidateQueries({ queryKey: ["quality-checklists"] });
      toast({ title: "Warning resolved", description: "The warning has been closed." });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to resolve warning.", variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setSelectedWarning(null);
    setActionType(null);
    setReasonText("");
  };

  const handleAction = () => {
    if (!selectedWarning || !actionType) return;
    if (actionType === "override") {
      acknowledgeMutation.mutate({ warningId: selectedWarning.id, note: reasonText });
    } else {
      resolveMutation.mutate({ warningId: selectedWarning.id, note: reasonText });
    }
  };

  const totalProjects = checklists.length;
  const totalItemsPassed = useMemo(() => {
    return checklists.reduce((sum, c) => {
      if (!c.phases) return sum;
      return sum + c.phases.reduce((t, p) => t + p.completed, 0);
    }, 0);
  }, [checklists]);
  const activeWarnings = warnings.length;
  const avgQmScore = checklists.length > 0
    ? Math.round(
        checklists.reduce((sum, c) => {
          if (!c.phases || c.phases.length === 0) return sum;
          const total = c.phases.reduce((t, p) => t + p.total, 0);
          const passed = c.phases.reduce((t, p) => t + p.completed, 0);
          return sum + (total > 0 ? (passed / total) * 100 : 0);
        }, 0) / checklists.length
      )
    : 0;

  const getProjectCompletion = (c: Checklist) => {
    if (!c.phases || c.phases.length === 0) return 0;
    const total = c.phases.reduce((t, p) => t + p.total, 0);
    const passed = c.phases.reduce((t, p) => t + p.completed, 0);
    return total > 0 ? Math.round((passed / total) * 100) : 0;
  };

  const getProjectWarnings = (c: Checklist) => {
    return c.warningCount ?? warnings.filter(w => w.projectName === c.projectName).length;
  };

  const getProjectUpdated = (c: Checklist) => {
    return c.updatedAt || c.createdAt || "";
  };

  const filteredProjects = useMemo(() => {
    let list = checklists.filter(c =>
      c.projectName.toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (statusFilter === "active") list = list.filter(c => c.status === "active");
    if (statusFilter === "completed") list = list.filter(c => c.status === "completed");
    if (warningFilter) list = list.filter(c => getProjectWarnings(c) > 0);

    list.sort((a, b) => {
      let cmp = 0;
      switch (projectSort) {
        case "name": cmp = a.projectName.localeCompare(b.projectName); break;
        case "completion": cmp = getProjectCompletion(a) - getProjectCompletion(b); break;
        case "warnings": cmp = getProjectWarnings(a) - getProjectWarnings(b); break;
        case "updated": cmp = getProjectUpdated(a).localeCompare(getProjectUpdated(b)); break;
      }
      return projectSortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [checklists, searchTerm, statusFilter, warningFilter, projectSort, projectSortDir, warnings]);

  const filteredItems = useMemo(() => {
    let list = [...allItems];
    if (itemsSearch) list = list.filter(i => i.itemName.toLowerCase().includes(itemsSearch.toLowerCase()) || i.projectName.toLowerCase().includes(itemsSearch.toLowerCase()));
    if (itemsStatusFilter !== "all") list = list.filter(i => i.qmStatus === itemsStatusFilter);
    if (itemsProjectFilter !== "all") list = list.filter(i => i.projectName === itemsProjectFilter);
    if (itemsPhaseFilter !== "all") list = list.filter(i => i.phaseName === itemsPhaseFilter);
    return list;
  }, [allItems, itemsSearch, itemsStatusFilter, itemsProjectFilter, itemsPhaseFilter]);

  const itemProjects = useMemo(() => Array.from(new Set(allItems.map(i => i.projectName))).sort(), [allItems]);
  const itemPhases = useMemo(() => Array.from(new Set(allItems.map(i => i.phaseName))).sort(), [allItems]);

  const highSeverityWarnings = useMemo(() => warnings.filter(w => w.severity === "High"), [warnings]);
  const otherWarnings = useMemo(() => warnings.filter(w => w.severity !== "High"), [warnings]);

  const toggleSort = (key: ProjectSortKey) => {
    if (projectSort === key) {
      setProjectSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setProjectSort(key);
      setProjectSortDir("asc");
    }
  };

  const qmNextAction = useMemo((): NextAction | null => {
    if (activeWarnings > 0) return { label: `${activeWarnings} quality warning${activeWarnings !== 1 ? "s" : ""} to review`, severity: "warning" };
    const incomplete = checklists.filter(c => c.status !== "completed").length;
    if (incomplete > 0) return { label: `${incomplete} checklist${incomplete !== 1 ? "s" : ""} still in progress`, severity: "info" };
    return { label: "All quality checklists complete", severity: "info" };
  }, [activeWarnings, checklists]);

  const qmBlockers = useMemo((): BlockerInfo[] => {
    const b: BlockerInfo[] = [];
    if (activeWarnings > 0) b.push({ label: "Active quality warnings", count: activeWarnings, severity: "warning" });
    return b;
  }, [activeWarnings]);

  const qmWalkthroughSteps = useMemo(() => [
    { title: "Quality overview", description: "KPI cards at the top show total projects, items passed, warnings, and average QM score." },
    { title: "View modes", description: "Toggle between Projects view (top-down by project) and Items view (bottom-up by individual checklist item)." },
    { title: "Warnings", description: "Active warnings are shown below. Override or resolve them with a reason." },
  ], []);

  return (
    <div className="space-y-6" data-testid="qm-dashboard-page">
      <div className="flex items-center gap-3 flex-wrap">
        <ShieldCheck className="h-8 w-8 text-emerald-500" />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg sm:text-xl md:text-2xl font-heading font-bold" data-testid="text-qm-title">Quality Management</h2>
          <p className="text-sm text-muted-foreground">Overview of all project quality checklists</p>
        </div>
        <ReplayWalkthrough screenId="qm-dashboard" />
        <Button
          onClick={() => setStartQmOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
          data-testid="btn-start-quality-process"
        >
          <Plus className="h-4 w-4 mr-2" />
          Start Quality Process
        </Button>
      </div>

      <MicroWalkthrough screenId="qm-dashboard" steps={qmWalkthroughSteps} />
      <ActionBar nextAction={qmNextAction} blockers={qmBlockers} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/40 dark:to-blue-900/20 border-blue-200/50 dark:border-blue-800/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="stat-total-projects">{totalProjects}</p>
              <p className="text-xs text-muted-foreground">Projects with Checklists</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20 border-emerald-200/50 dark:border-emerald-800/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="stat-items-passed">{totalItemsPassed}</p>
              <p className="text-xs text-muted-foreground">Items Passed</p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/40 dark:to-amber-900/20 border-amber-200/50 dark:border-amber-800/50 cursor-pointer"
          onClick={() => setWarningFilter(!warningFilter)}
          data-testid="kpi-active-warnings"
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="stat-warnings">{activeWarnings}</p>
              <p className="text-xs text-muted-foreground">Active Warnings</p>
            </div>
            {warningFilter && <Badge variant="outline" className="ml-auto text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-600">Filtering</Badge>}
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 dark:from-indigo-950/40 dark:to-indigo-900/20 border-indigo-200/50 dark:border-indigo-800/50">
          <CardContent className="p-4 flex items-center gap-3">
            <CircularProgress value={avgQmScore} size={52} strokeWidth={5} />
            <div>
              <p className="text-sm font-semibold" data-testid="stat-avg-completion">Avg QM Score</p>
              <p className="text-xs text-muted-foreground">Across all projects</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "projects" | "items")}>
        <div className="flex items-center gap-3 flex-wrap">
          <TabsList data-testid="view-mode-toggle">
            <TabsTrigger value="projects" data-testid="tab-projects-view" className="gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5" /> Projects
            </TabsTrigger>
            <TabsTrigger value="items" data-testid="tab-items-view" className="gap-1.5">
              <Table2 className="h-3.5 w-3.5" /> Items
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="projects">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-lg">Project Checklists</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative w-full max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search projects..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 h-9"
                      data-testid="input-qm-search"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                    <SelectTrigger className="w-[130px] h-9" data-testid="select-status-filter">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center border rounded-md">
                    {(["name", "completion", "warnings", "updated"] as ProjectSortKey[]).map(key => (
                      <Button
                        key={key}
                        variant="ghost"
                        size="sm"
                        className={`h-9 px-2.5 text-xs rounded-none first:rounded-l-md last:rounded-r-md ${projectSort === key ? "bg-muted" : ""}`}
                        onClick={() => toggleSort(key)}
                        data-testid={`sort-${key}`}
                      >
                        {key === "name" ? "Name" : key === "completion" ? "%" : key === "warnings" ? "⚠" : "Date"}
                        {projectSort === key && (
                          <ArrowUpDown className="h-3 w-3 ml-1" />
                        )}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {checklistsLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
                  Loading checklists...
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>No checklists found</p>
                  {(searchTerm || statusFilter !== "all" || warningFilter) && (
                    <Button variant="link" size="sm" className="mt-2" onClick={() => { setSearchTerm(""); setStatusFilter("all"); setWarningFilter(false); }} data-testid="btn-clear-filters">
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filteredProjects.map((checklist) => {
                    const completion = getProjectCompletion(checklist);
                    const warnCount = getProjectWarnings(checklist);
                    return (
                      <Card
                        key={checklist.id}
                        data-testid={`qm-project-card-${checklist.id}`}
                        className="cursor-pointer hover:border-emerald-400/50 transition-all group"
                        onClick={() => setLocation(`/project/${encodeURIComponent(checklist.projectName)}?tab=quality`)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-sm truncate group-hover:text-emerald-600 transition-colors" data-testid={`text-project-name-${checklist.id}`}>
                                {checklist.projectName}
                              </h3>
                              <Badge
                                variant="outline"
                                className={`mt-1 text-[10px] ${
                                  checklist.status === "completed"
                                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                    : checklist.status === "active"
                                    ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30"
                                    : ""
                                }`}
                              >
                                {checklist.status}
                              </Badge>
                            </div>
                            <CircularProgress value={completion} size={44} strokeWidth={4} />
                          </div>

                          {checklist.phases && checklist.phases.length > 0 && (
                            <div className="mb-3 space-y-1.5">
                              {checklist.phases.map((phase) => {
                                const pct = phase.total > 0 ? Math.round((phase.completed / phase.total) * 100) : 0;
                                return (
                                  <div key={phase.phaseId} className="flex items-center gap-2" title={`${phase.phaseName}: ${phase.completed}/${phase.total}`}>
                                    <span className="text-[10px] text-muted-foreground w-16 truncate">{phase.phaseName}</span>
                                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${(phase.failed ?? 0) > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                            <div className="flex items-center gap-1">
                              {warnCount > 0 ? (
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30 text-[10px]">
                                  <AlertTriangle className="h-3 w-3 mr-0.5" />
                                  {warnCount} warning{warnCount !== 1 ? "s" : ""}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-[10px]">
                                  <ShieldCheck className="h-3 w-3 mr-0.5" />
                                  Clear
                                </Badge>
                              )}
                            </div>
                            <span>
                              {checklist.updatedAt
                                ? new Date(checklist.updatedAt).toLocaleDateString()
                                : checklist.createdAt
                                ? new Date(checklist.createdAt).toLocaleDateString()
                                : "—"}
                            </span>
                            <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="items">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-lg">All Quality Items</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative w-full max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search items..."
                      value={itemsSearch}
                      onChange={(e) => setItemsSearch(e.target.value)}
                      className="pl-10 h-9"
                      data-testid="input-items-search"
                    />
                  </div>
                  <Select value={itemsStatusFilter} onValueChange={setItemsStatusFilter}>
                    <SelectTrigger className="w-[120px] h-9" data-testid="select-items-status">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="pass">Pass</SelectItem>
                      <SelectItem value="fail">Fail</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                      <SelectItem value="na">N/A</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={itemsProjectFilter} onValueChange={setItemsProjectFilter}>
                    <SelectTrigger className="w-[150px] h-9" data-testid="select-items-project">
                      <SelectValue placeholder="Project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Projects</SelectItem>
                      {itemProjects.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={itemsPhaseFilter} onValueChange={setItemsPhaseFilter}>
                    <SelectTrigger className="w-[140px] h-9" data-testid="select-items-phase">
                      <SelectValue placeholder="Phase" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Phases</SelectItem>
                      {itemPhases.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {itemsLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
                  Loading items...
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <ListFilter className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>No quality items found</p>
                  {(itemsSearch || itemsStatusFilter !== "all" || itemsProjectFilter !== "all" || itemsPhaseFilter !== "all") && (
                    <Button variant="link" size="sm" className="mt-2" onClick={() => { setItemsSearch(""); setItemsStatusFilter("all"); setItemsProjectFilter("all"); setItemsPhaseFilter("all"); }} data-testid="btn-clear-items-filters">
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b text-sm text-muted-foreground">
                        <th className="text-left py-2 px-3 font-medium">Item Name</th>
                        <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Project</th>
                        <th className="text-left py-2 px-3 font-medium hidden lg:table-cell">Phase</th>
                        <th className="text-left py-2 px-3 font-medium hidden lg:table-cell">Group</th>
                        <th className="text-center py-2 px-3 font-medium">Status</th>
                        <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Assignee</th>
                        <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">Due Date</th>
                        <th className="text-center py-2 px-3 font-medium hidden sm:table-cell">Evidence</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item) => (
                        <tr
                          key={item.id}
                          data-testid={`item-row-${item.id}`}
                          className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => setLocation(`/project/${encodeURIComponent(item.projectName)}?tab=quality`)}
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-sm truncate max-w-[200px]">{item.itemName}</div>
                            <div className="text-[10px] text-muted-foreground truncate max-w-[200px] md:hidden">
                              {item.projectName}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-sm hidden md:table-cell">
                            <span className="truncate max-w-[150px] inline-block">{item.projectName}</span>
                          </td>
                          <td className="py-2.5 px-3 text-xs text-muted-foreground hidden lg:table-cell">{item.phaseName}</td>
                          <td className="py-2.5 px-3 text-xs text-muted-foreground hidden lg:table-cell">{item.groupName}</td>
                          <td className="py-2.5 px-3 text-center">
                            <StatusBadge status={item.qmStatus || "pending"} />
                          </td>
                          <td className="py-2.5 px-3 text-sm hidden md:table-cell">
                            {item.assigneeName ? (
                              <div className="flex items-center gap-1.5">
                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="truncate max-w-[100px]">{item.assigneeName}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">
                            {item.endDate ? (
                              <div className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(item.endDate).toLocaleDateString()}
                              </div>
                            ) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-center hidden sm:table-cell">
                            {item.evidenceCount > 0 ? (
                              <Badge variant="outline" className="text-[10px]">
                                <FileText className="h-3 w-3 mr-0.5" />
                                {item.evidenceCount}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-xs text-muted-foreground text-right pt-2">
                    Showing {filteredItems.length} of {allItems.length} items
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {!warningsLoading && warnings.length > 0 && (
        <Card>
          <CardHeader className="pb-3 cursor-pointer" onClick={() => setWarningsExpanded(!warningsExpanded)} data-testid="warnings-section-header">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Active Warnings ({warnings.length})
              </CardTitle>
              {warningsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
          {warningsExpanded && (
            <CardContent>
              {highSeverityWarnings.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">High Severity</p>
                  <div className="space-y-2">
                    {highSeverityWarnings.map((warning) => (
                      <div
                        key={warning.id}
                        className="flex items-start gap-3 p-3 rounded-lg border border-red-200/50 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer transition-colors"
                        onClick={() => setSelectedWarning(warning)}
                        data-testid={`warning-row-${warning.id}`}
                      >
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{warning.title}</span>
                            <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30 text-[10px]">High</Badge>
                            <Badge variant="outline" className="text-[10px]">{warning.warningType}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{warning.projectName}</p>
                          {warning.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{warning.description}</p>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => { e.stopPropagation(); setSelectedWarning(warning); setActionType("override"); }}
                            data-testid={`btn-override-${warning.id}`}
                          >
                            Override
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-emerald-600"
                            onClick={(e) => { e.stopPropagation(); setSelectedWarning(warning); setActionType("resolve"); }}
                            data-testid={`btn-resolve-${warning.id}`}
                          >
                            Resolve
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {otherWarnings.length > 0 && (
                <div>
                  {highSeverityWarnings.length > 0 && (
                    <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-2">Other Warnings</p>
                  )}
                  <div className="space-y-2">
                    {otherWarnings.map((warning) => (
                      <div
                        key={warning.id}
                        className="flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setSelectedWarning(warning)}
                        data-testid={`warning-row-${warning.id}`}
                      >
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{warning.title}</span>
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30 text-[10px]">{warning.severity}</Badge>
                            <Badge variant="outline" className="text-[10px]">{warning.warningType}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{warning.projectName}</p>
                          {warning.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{warning.description}</p>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => { e.stopPropagation(); setSelectedWarning(warning); setActionType("override"); }}
                            data-testid={`btn-override-${warning.id}`}
                          >
                            Override
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-emerald-600"
                            onClick={(e) => { e.stopPropagation(); setSelectedWarning(warning); setActionType("resolve"); }}
                            data-testid={`btn-resolve-${warning.id}`}
                          >
                            Resolve
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      <Dialog open={!!selectedWarning && !actionType} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className={`h-5 w-5 ${selectedWarning?.severity === "High" ? "text-red-500" : "text-amber-500"}`} />
              Warning Details
            </DialogTitle>
          </DialogHeader>
          {selectedWarning && (
            <div className="space-y-4">
              <div>
                <p className="font-semibold text-sm">{selectedWarning.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className={
                    selectedWarning.severity === "High"
                      ? "bg-red-500/10 text-red-500 border-red-500/30 text-xs"
                      : "bg-amber-500/10 text-amber-500 border-amber-500/30 text-xs"
                  }>
                    {selectedWarning.severity}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {selectedWarning.warningType}
                  </Badge>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Project:</span>{" "}
                  <span className="font-medium">{selectedWarning.projectName}</span>
                </div>
                {selectedWarning.description && (
                  <div>
                    <span className="text-muted-foreground">Description:</span>
                    <p className="mt-1 text-sm bg-muted/50 p-2 rounded">{selectedWarning.description}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  <span>{new Date(selectedWarning.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    setLocation(`/project/${encodeURIComponent(selectedWarning.projectName)}?tab=quality`);
                    closeDialog();
                  }}
                  data-testid="btn-go-to-project"
                >
                  <Eye className="h-4 w-4 mr-1" />
                  View Project
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                  onClick={() => setActionType("override")}
                  data-testid="btn-override-warning"
                >
                  <ShieldCheck className="h-4 w-4 mr-1" />
                  Override
                </Button>
                <Button
                  size="sm"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => setActionType("resolve")}
                  data-testid="btn-resolve-warning"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Close / Resolve
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionType} onOpenChange={(open) => { if (!open) { setActionType(null); setReasonText(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionType === "override" ? (
                <>
                  <ShieldCheck className="h-5 w-5 text-amber-500" />
                  Override Warning
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  Close / Resolve Warning
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedWarning && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-3 rounded-lg text-sm">
                <p className="font-medium">{selectedWarning.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{selectedWarning.projectName}</p>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">
                  {actionType === "override" ? "Override reason" : "Resolution notes"}
                  {actionType === "resolve" && <span className="text-muted-foreground font-normal"> (optional)</span>}
                </label>
                <Textarea
                  placeholder={actionType === "override"
                    ? "Explain why this warning is being overridden..."
                    : "Describe how this issue was resolved..."
                  }
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  rows={3}
                  data-testid="input-warning-reason"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setActionType(null); setReasonText(""); }} data-testid="btn-cancel-action">
              Cancel
            </Button>
            <Button
              onClick={handleAction}
              disabled={actionType === "override" && !reasonText.trim()}
              className={actionType === "override"
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
              }
              data-testid="btn-confirm-action"
            >
              {(acknowledgeMutation.isPending || resolveMutation.isPending) ? "Saving..." :
                actionType === "override" ? "Confirm Override" : "Confirm Resolve"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={startQmOpen} onOpenChange={(open) => { if (!open) { setStartQmOpen(false); setStartQmProject(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Start Quality Process
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select a project to start the quality management process. Only projects without an existing quality checklist are shown.
            </p>
            <div>
              <label className="text-sm font-medium block mb-1.5">Project</label>
              <Popover open={startQmPopoverOpen} onOpenChange={setStartQmPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={startQmPopoverOpen}
                    className="w-full justify-between font-normal"
                    data-testid="select-qm-project"
                  >
                    {startQmProject || "Search and select a project..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search projects..." data-testid="input-qm-project-search" />
                    <CommandList>
                      <CommandEmpty>No projects available</CommandEmpty>
                      <CommandGroup>
                        {availableProjects.map((project) => {
                          const name = project.project_name;
                          return (
                            <CommandItem
                              key={name}
                              onSelect={() => {
                                setStartQmProject(name);
                                setStartQmPopoverOpen(false);
                              }}
                              data-testid={`qm-project-option-${name}`}
                            >
                              <Check className={`mr-2 h-4 w-4 ${startQmProject === name ? "opacity-100" : "opacity-0"}`} />
                              {name}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            {availableProjects.length === 0 && allProjects.length > 0 && (
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                All projects already have quality checklists.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setStartQmOpen(false); setStartQmProject(""); }} data-testid="btn-cancel-start-qm">
              Cancel
            </Button>
            <Button
              onClick={() => { if (startQmProject) startQmMutation.mutate(startQmProject); }}
              disabled={!startQmProject || startQmMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="btn-confirm-start-qm"
            >
              {startQmMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Starting...</>
              ) : (
                <><ShieldCheck className="h-4 w-4 mr-2" />Start Quality Process</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
