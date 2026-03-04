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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Shield,
  ShieldCheck,
  AlertTriangle,
  Search,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
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
  ArrowUp,
  ArrowDown,
  FileText,
  User,
  Calendar,
  TrendingUp,
  XCircle,
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
type ItemSortKey = "itemName" | "projectName" | "phaseName" | "groupName" | "qmStatus" | "assigneeName" | "endDate" | "evidenceCount";

function CircularProgress({ value, size = 48, strokeWidth = 4, className = "" }: { value: number; size?: number; strokeWidth?: number; className?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 80 ? "text-emerald-500" : value >= 50 ? "text-amber-500" : "text-red-400";
  return (
    <svg width={size} height={size} className={className}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-muted/20" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        className={`${color} transition-all duration-700`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="fill-current text-foreground font-bold" fontSize={size * 0.24}>
        {value}%
      </text>
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string; dot: string }> = {
    pass: { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", label: "Pass", dot: "bg-emerald-500" },
    fail: { bg: "bg-red-500/15", text: "text-red-600 dark:text-red-400", label: "Fail", dot: "bg-red-500" },
    review: { bg: "bg-amber-500/15", text: "text-amber-600 dark:text-amber-400", label: "Review", dot: "bg-amber-500" },
    na: { bg: "bg-gray-500/15", text: "text-muted-foreground", label: "N/A", dot: "bg-gray-400" },
    pending: { bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400", label: "Pending", dot: "bg-blue-500" },
  };
  const c = config[status] || config.pending;
  return (
    <Badge variant="outline" className={`${c.bg} ${c.text} border-0 text-xs gap-1.5`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </Badge>
  );
}

function SortHeader({ label, sortKey, currentSort, currentDir, onSort, className = "" }: {
  label: string; sortKey: string; currentSort: string; currentDir: ProjectSortDir;
  onSort: (key: string) => void; className?: string;
}) {
  const active = currentSort === sortKey;
  return (
    <button
      className={`flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground font-semibold" : "text-muted-foreground font-medium"} ${className}`}
      onClick={() => onSort(sortKey)}
      data-testid={`sort-col-${sortKey}`}
    >
      {label}
      {active ? (
        currentDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
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
  const [itemSort, setItemSort] = useState<ItemSortKey>("itemName");
  const [itemSortDir, setItemSortDir] = useState<ProjectSortDir>("asc");
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
  const totalItemsAll = useMemo(() => {
    return checklists.reduce((sum, c) => {
      if (!c.phases) return sum;
      return sum + c.phases.reduce((t, p) => t + p.total, 0);
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

    list.sort((a, b) => {
      let cmp = 0;
      switch (itemSort) {
        case "itemName": cmp = (a.itemName || "").localeCompare(b.itemName || ""); break;
        case "projectName": cmp = (a.projectName || "").localeCompare(b.projectName || ""); break;
        case "phaseName": cmp = (a.phaseName || "").localeCompare(b.phaseName || ""); break;
        case "groupName": cmp = (a.groupName || "").localeCompare(b.groupName || ""); break;
        case "qmStatus": cmp = (a.qmStatus || "").localeCompare(b.qmStatus || ""); break;
        case "assigneeName": cmp = (a.assigneeName || "").localeCompare(b.assigneeName || ""); break;
        case "endDate": cmp = (a.endDate || "").localeCompare(b.endDate || ""); break;
        case "evidenceCount": cmp = a.evidenceCount - b.evidenceCount; break;
      }
      return itemSortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [allItems, itemsSearch, itemsStatusFilter, itemsProjectFilter, itemsPhaseFilter, itemSort, itemSortDir]);

  const itemProjects = useMemo(() => Array.from(new Set(allItems.map(i => i.projectName))).sort(), [allItems]);
  const itemPhases = useMemo(() => Array.from(new Set(allItems.map(i => i.phaseName))).sort(), [allItems]);

  const highSeverityWarnings = useMemo(() => warnings.filter(w => w.severity === "High"), [warnings]);
  const mediumWarnings = useMemo(() => warnings.filter(w => w.severity === "Medium"), [warnings]);
  const lowWarnings = useMemo(() => warnings.filter(w => w.severity !== "High" && w.severity !== "Medium"), [warnings]);

  const toggleSort = (key: ProjectSortKey) => {
    if (projectSort === key) {
      setProjectSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setProjectSort(key);
      setProjectSortDir("asc");
    }
  };

  const toggleItemSort = (key: string) => {
    if (itemSort === key) {
      setItemSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setItemSort(key as ItemSortKey);
      setItemSortDir("asc");
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

  const activeFiltersCount = [
    searchTerm ? 1 : 0,
    statusFilter !== "all" ? 1 : 0,
    warningFilter ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const activeItemFiltersCount = [
    itemsSearch ? 1 : 0,
    itemsStatusFilter !== "all" ? 1 : 0,
    itemsProjectFilter !== "all" ? 1 : 0,
    itemsPhaseFilter !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6 pb-8" data-testid="qm-dashboard-page">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="p-2.5 rounded-xl bg-emerald-500/10">
          <ShieldCheck className="h-7 w-7 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg sm:text-xl md:text-2xl font-heading font-bold tracking-tight" data-testid="text-qm-title">Quality Management</h2>
          <p className="text-sm text-muted-foreground">Monitor quality checklists, track items, and manage warnings across all projects</p>
        </div>
        <div className="flex items-center gap-2">
          <ReplayWalkthrough screenId="qm-dashboard" />
          <Button
            onClick={() => setStartQmOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            data-testid="btn-start-quality-process"
          >
            <Plus className="h-4 w-4 mr-2" />
            Start Quality Process
          </Button>
        </div>
      </div>

      <MicroWalkthrough screenId="qm-dashboard" steps={qmWalkthroughSteps} />
      <ActionBar nextAction={qmNextAction} blockers={qmBlockers} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="relative overflow-hidden border-blue-200/50 dark:border-blue-800/40" data-testid="kpi-total-projects">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-blue-100/30 dark:from-blue-950/30 dark:to-blue-900/10" />
          <CardContent className="relative p-4 sm:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Projects</p>
                <p className="text-3xl font-bold tabular-nums" data-testid="stat-total-projects">{totalProjects}</p>
                <p className="text-xs text-muted-foreground mt-1">With quality checklists</p>
              </div>
              <div className="p-2 rounded-lg bg-blue-500/10">
                <ClipboardCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-emerald-200/50 dark:border-emerald-800/40" data-testid="kpi-items-passed">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 to-emerald-100/30 dark:from-emerald-950/30 dark:to-emerald-900/10" />
          <CardContent className="relative p-4 sm:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Items Passed</p>
                <p className="text-3xl font-bold tabular-nums" data-testid="stat-items-passed">{totalItemsPassed}</p>
                <p className="text-xs text-muted-foreground mt-1">of {totalItemsAll} total items</p>
              </div>
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            {totalItemsAll > 0 && (
              <Progress value={(totalItemsPassed / totalItemsAll) * 100} className="h-1 mt-3" />
            )}
          </CardContent>
        </Card>

        <Card
          className="relative overflow-hidden border-amber-200/50 dark:border-amber-800/40 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => setWarningFilter(!warningFilter)}
          data-testid="kpi-active-warnings"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-amber-50 to-amber-100/30 dark:from-amber-950/30 dark:to-amber-900/10" />
          <CardContent className="relative p-4 sm:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Warnings</p>
                <p className="text-3xl font-bold tabular-nums" data-testid="stat-warnings">{activeWarnings}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {activeWarnings === 0 ? "All clear" : `${highSeverityWarnings.length} high severity`}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
            {warningFilter && (
              <Badge variant="outline" className="absolute top-2 right-2 text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-600">
                Filtering
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-indigo-200/50 dark:border-indigo-800/40" data-testid="kpi-avg-score">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 to-indigo-100/30 dark:from-indigo-950/30 dark:to-indigo-900/10" />
          <CardContent className="relative p-4 sm:p-5">
            <div className="flex items-center gap-4">
              <CircularProgress value={avgQmScore} size={56} strokeWidth={5} />
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Avg QM Score</p>
                <p className="text-sm font-semibold" data-testid="stat-avg-completion">
                  {avgQmScore >= 80 ? "On Track" : avgQmScore >= 50 ? "Needs Attention" : avgQmScore > 0 ? "At Risk" : "No Data"}
                </p>
                <p className="text-xs text-muted-foreground">Across all projects</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "projects" | "items")}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList className="h-10" data-testid="view-mode-toggle">
            <TabsTrigger value="projects" data-testid="tab-projects-view" className="gap-1.5 px-4">
              <LayoutGrid className="h-4 w-4" /> Projects
            </TabsTrigger>
            <TabsTrigger value="items" data-testid="tab-items-view" className="gap-1.5 px-4">
              <Table2 className="h-4 w-4" /> Items
            </TabsTrigger>
          </TabsList>
          {viewMode === "projects" && activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => { setSearchTerm(""); setStatusFilter("all"); setWarningFilter(false); }}
              data-testid="btn-clear-all-filters"
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Clear {activeFiltersCount} filter{activeFiltersCount > 1 ? "s" : ""}
            </Button>
          )}
          {viewMode === "items" && activeItemFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => { setItemsSearch(""); setItemsStatusFilter("all"); setItemsProjectFilter("all"); setItemsPhaseFilter("all"); }}
              data-testid="btn-clear-all-item-filters"
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Clear {activeItemFiltersCount} filter{activeItemFiltersCount > 1 ? "s" : ""}
            </Button>
          )}
        </div>

        <TabsContent value="projects" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base font-semibold">Project Checklists</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search projects..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 h-9 w-[200px] sm:w-[240px]"
                      data-testid="input-qm-search"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                    <SelectTrigger className="w-[120px] h-9" data-testid="select-status-filter">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center border rounded-md bg-muted/30">
                    {(["name", "completion", "warnings", "updated"] as ProjectSortKey[]).map(key => (
                      <Button
                        key={key}
                        variant="ghost"
                        size="sm"
                        className={`h-9 px-2.5 text-xs rounded-none first:rounded-l-md last:rounded-r-md ${projectSort === key ? "bg-background shadow-sm" : ""}`}
                        onClick={() => toggleSort(key)}
                        data-testid={`sort-${key}`}
                      >
                        {key === "name" ? "Name" : key === "completion" ? "%" : key === "warnings" ? "⚠" : "Date"}
                        {projectSort === key && (
                          projectSortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
                        )}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {checklistsLoading ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="h-8 w-8 mb-3 animate-spin text-emerald-500" />
                  <p className="text-sm">Loading checklists...</p>
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Shield className="h-16 w-16 mb-4 opacity-20" />
                  <p className="font-medium">No checklists found</p>
                  <p className="text-xs mt-1">
                    {activeFiltersCount > 0 ? "Try adjusting your filters" : "Start a quality process for a project"}
                  </p>
                  {activeFiltersCount > 0 && (
                    <Button variant="link" size="sm" className="mt-2" onClick={() => { setSearchTerm(""); setStatusFilter("all"); setWarningFilter(false); }} data-testid="btn-clear-filters">
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredProjects.map((checklist) => {
                      const completion = getProjectCompletion(checklist);
                      const warnCount = getProjectWarnings(checklist);
                      const totalItems = checklist.phases?.reduce((t, p) => t + p.total, 0) ?? 0;
                      const passedItems = checklist.phases?.reduce((t, p) => t + p.completed, 0) ?? 0;
                      return (
                        <Card
                          key={checklist.id}
                          data-testid={`qm-project-card-${checklist.id}`}
                          className="cursor-pointer hover:shadow-md hover:border-emerald-400/50 transition-all group"
                          onClick={() => setLocation(`/project/${encodeURIComponent(checklist.projectName)}?tab=quality`)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-sm truncate group-hover:text-emerald-600 transition-colors" data-testid={`text-project-name-${checklist.id}`}>
                                  {checklist.projectName}
                                </h3>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] ${
                                      checklist.status === "completed"
                                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                        : "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30"
                                    }`}
                                  >
                                    {checklist.status}
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground">
                                    {passedItems}/{totalItems} items
                                  </span>
                                </div>
                              </div>
                              <CircularProgress value={completion} size={48} strokeWidth={4} />
                            </div>

                            {checklist.phases && checklist.phases.length > 0 && (
                              <div className="mb-3 space-y-1.5">
                                {checklist.phases.map((phase) => {
                                  const pct = phase.total > 0 ? Math.round((phase.completed / phase.total) * 100) : 0;
                                  const hasFailed = (phase.failed ?? 0) > 0;
                                  const hasReview = (phase.inReview ?? 0) > 0;
                                  return (
                                    <div key={phase.phaseId} className="flex items-center gap-2" title={`${phase.phaseName}: ${phase.completed}/${phase.total}${hasFailed ? ` (${phase.failed} failed)` : ""}${hasReview ? ` (${phase.inReview} in review)` : ""}`}>
                                      <span className="text-[10px] text-muted-foreground w-16 truncate">{phase.phaseName}</span>
                                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full transition-all ${hasFailed ? "bg-red-400" : hasReview ? "bg-amber-500" : "bg-emerald-500"}`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                      <span className="text-[10px] text-muted-foreground w-8 text-right tabular-nums">{pct}%</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            <div className="flex items-center justify-between text-xs text-muted-foreground pt-2.5 border-t">
                              <div className="flex items-center gap-1.5">
                                {warnCount > 0 ? (
                                  <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px] gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    {warnCount} warning{warnCount !== 1 ? "s" : ""}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px] gap-1">
                                    <ShieldCheck className="h-3 w-3" />
                                    Clear
                                  </Badge>
                                )}
                              </div>
                              <span className="tabular-nums">
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
                  <p className="text-xs text-muted-foreground text-right mt-3">
                    Showing {filteredProjects.length} of {checklists.length} projects
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="items" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base font-semibold">All Quality Items</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search items..."
                      value={itemsSearch}
                      onChange={(e) => setItemsSearch(e.target.value)}
                      className="pl-9 h-9 w-[200px] sm:w-[240px]"
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
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="h-8 w-8 mb-3 animate-spin text-emerald-500" />
                  <p className="text-sm">Loading items...</p>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <ListFilter className="h-16 w-16 mb-4 opacity-20" />
                  <p className="font-medium">No quality items found</p>
                  <p className="text-xs mt-1">
                    {activeItemFiltersCount > 0 ? "Try adjusting your filters" : "Quality items will appear when checklists are created"}
                  </p>
                  {activeItemFiltersCount > 0 && (
                    <Button variant="link" size="sm" className="mt-2" onClick={() => { setItemsSearch(""); setItemsStatusFilter("all"); setItemsProjectFilter("all"); setItemsPhaseFilter("all"); }} data-testid="btn-clear-items-filters">
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto -mx-6">
                  <table className="w-full min-w-[800px]">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left py-2.5 px-4">
                          <SortHeader label="Item Name" sortKey="itemName" currentSort={itemSort} currentDir={itemSortDir} onSort={toggleItemSort} className="text-xs" />
                        </th>
                        <th className="text-left py-2.5 px-4 hidden md:table-cell">
                          <SortHeader label="Project" sortKey="projectName" currentSort={itemSort} currentDir={itemSortDir} onSort={toggleItemSort} className="text-xs" />
                        </th>
                        <th className="text-left py-2.5 px-4 hidden lg:table-cell">
                          <SortHeader label="Phase" sortKey="phaseName" currentSort={itemSort} currentDir={itemSortDir} onSort={toggleItemSort} className="text-xs" />
                        </th>
                        <th className="text-left py-2.5 px-4 hidden lg:table-cell">
                          <SortHeader label="Group" sortKey="groupName" currentSort={itemSort} currentDir={itemSortDir} onSort={toggleItemSort} className="text-xs" />
                        </th>
                        <th className="text-center py-2.5 px-4">
                          <SortHeader label="Status" sortKey="qmStatus" currentSort={itemSort} currentDir={itemSortDir} onSort={toggleItemSort} className="text-xs justify-center" />
                        </th>
                        <th className="text-left py-2.5 px-4 hidden md:table-cell">
                          <SortHeader label="Assignee" sortKey="assigneeName" currentSort={itemSort} currentDir={itemSortDir} onSort={toggleItemSort} className="text-xs" />
                        </th>
                        <th className="text-center py-2.5 px-4 hidden sm:table-cell">
                          <SortHeader label="Evidence" sortKey="evidenceCount" currentSort={itemSort} currentDir={itemSortDir} onSort={toggleItemSort} className="text-xs justify-center" />
                        </th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item) => (
                        <tr
                          key={item.id}
                          data-testid={`item-row-${item.id}`}
                          className="border-b border-border/40 hover:bg-muted/30 cursor-pointer transition-colors group"
                          onClick={() => setLocation(`/project/${encodeURIComponent(item.projectName)}?tab=quality`)}
                        >
                          <td className="py-3 px-4">
                            <div className="font-medium text-sm truncate max-w-[220px]">{item.itemName}</div>
                            <div className="text-[10px] text-muted-foreground truncate max-w-[220px] md:hidden mt-0.5">
                              {item.projectName}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-sm hidden md:table-cell">
                            <span className="truncate max-w-[150px] inline-block">{item.projectName}</span>
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground hidden lg:table-cell">{item.phaseName}</td>
                          <td className="py-3 px-4 text-xs text-muted-foreground hidden lg:table-cell">{item.groupName}</td>
                          <td className="py-3 px-4 text-center">
                            <StatusBadge status={item.qmStatus || "pending"} />
                          </td>
                          <td className="py-3 px-4 text-sm hidden md:table-cell">
                            {item.assigneeName ? (
                              <div className="flex items-center gap-1.5">
                                <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center">
                                  <User className="h-3 w-3 text-muted-foreground" />
                                </div>
                                <span className="truncate max-w-[100px] text-xs">{item.assigneeName}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center hidden sm:table-cell">
                            {item.evidenceCount > 0 ? (
                              <Badge variant="outline" className="text-[10px] gap-1">
                                <FileText className="h-3 w-3" />
                                {item.evidenceCount}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-xs text-muted-foreground text-right pt-3 px-4">
                    Showing {filteredItems.length} of {allItems.length} items
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {!warningsLoading && warnings.length > 0 && (
        <Collapsible open={warningsExpanded} onOpenChange={setWarningsExpanded}>
          <Card className="border-amber-200/50 dark:border-amber-800/40">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg" data-testid="warnings-section-header">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/10">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    </div>
                    Active Warnings
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 ml-1">
                      {warnings.length}
                    </Badge>
                  </CardTitle>
                  {warningsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {highSeverityWarnings.length > 0 && (
                  <div className="mb-5">
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">High Severity ({highSeverityWarnings.length})</p>
                    </div>
                    <div className="space-y-2">
                      {highSeverityWarnings.map((warning) => (
                        <WarningRow key={warning.id} warning={warning} severity="high"
                          onView={() => setSelectedWarning(warning)}
                          onOverride={() => { setSelectedWarning(warning); setActionType("override"); }}
                          onResolve={() => { setSelectedWarning(warning); setActionType("resolve"); }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {mediumWarnings.length > 0 && (
                  <div className="mb-5">
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Medium Severity ({mediumWarnings.length})</p>
                    </div>
                    <div className="space-y-2">
                      {mediumWarnings.map((warning) => (
                        <WarningRow key={warning.id} warning={warning} severity="medium"
                          onView={() => setSelectedWarning(warning)}
                          onOverride={() => { setSelectedWarning(warning); setActionType("override"); }}
                          onResolve={() => { setSelectedWarning(warning); setActionType("resolve"); }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {lowWarnings.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="h-2 w-2 rounded-full bg-blue-400" />
                      <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Low / Other ({lowWarnings.length})</p>
                    </div>
                    <div className="space-y-2">
                      {lowWarnings.map((warning) => (
                        <WarningRow key={warning.id} warning={warning} severity="low"
                          onView={() => setSelectedWarning(warning)}
                          onOverride={() => { setSelectedWarning(warning); setActionType("override"); }}
                          onResolve={() => { setSelectedWarning(warning); setActionType("resolve"); }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
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
                <div className="flex items-center gap-2 mt-1.5">
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

              <div className="space-y-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-16">Project</span>
                  <span className="font-medium">{selectedWarning.projectName}</span>
                </div>
                {selectedWarning.description && (
                  <div>
                    <span className="text-muted-foreground text-xs">Description</span>
                    <p className="mt-1 text-sm bg-muted/50 p-2.5 rounded-lg">{selectedWarning.description}</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-16">Created</span>
                  <span className="tabular-nums">{new Date(selectedWarning.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-3 border-t">
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
                  className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
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
                  Resolve
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
                  {actionType === "override" && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <Textarea
                  placeholder={actionType === "override"
                    ? "Provide justification for overriding this warning..."
                    : "Describe how this warning was resolved (optional)..."
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

function WarningRow({ warning, severity, onView, onOverride, onResolve }: {
  warning: Warning;
  severity: "high" | "medium" | "low";
  onView: () => void;
  onOverride: () => void;
  onResolve: () => void;
}) {
  const borderClass = severity === "high"
    ? "border-red-200/50 dark:border-red-800/40 bg-red-50/30 dark:bg-red-950/10 hover:bg-red-50/60 dark:hover:bg-red-950/20"
    : severity === "medium"
    ? "border-amber-200/50 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10 hover:bg-amber-50/60 dark:hover:bg-amber-950/20"
    : "border-border/50 hover:bg-muted/30";

  const iconClass = severity === "high" ? "text-red-500" : severity === "medium" ? "text-amber-500" : "text-blue-400";

  const badgeClass = severity === "high"
    ? "bg-red-500/10 text-red-500 border-red-500/30"
    : severity === "medium"
    ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
    : "bg-blue-500/10 text-blue-500 border-blue-500/30";

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${borderClass} cursor-pointer transition-colors`}
      onClick={onView}
      data-testid={`warning-row-${warning.id}`}
    >
      <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${iconClass}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{warning.title}</span>
          <Badge variant="outline" className={`${badgeClass} text-[10px]`}>{warning.severity}</Badge>
          <Badge variant="outline" className="text-[10px]">{warning.warningType}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{warning.projectName}</p>
        {warning.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{warning.description}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs hover:bg-amber-500/10"
          onClick={(e) => { e.stopPropagation(); onOverride(); }}
          data-testid={`btn-override-${warning.id}`}
        >
          Override
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-emerald-600 hover:bg-emerald-500/10"
          onClick={(e) => { e.stopPropagation(); onResolve(); }}
          data-testid={`btn-resolve-${warning.id}`}
        >
          Resolve
        </Button>
      </div>
    </div>
  );
}
