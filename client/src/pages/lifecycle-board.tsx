import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { useLocation } from "wouter";
import { Loader2, Search, Zap, User, Wrench, FileSpreadsheet, GripVertical, CheckCircle2, ClipboardList, Link2, Merge, ArrowRight, X, Save, AlertTriangle, ShieldCheck, ExternalLink, Calendar, Clock, AlertCircle, Users } from "lucide-react";
import { ActionBar } from "@/components/guidance/ActionBar";
import { InlineTip } from "@/components/guidance/InlineTip";
import { MicroWalkthrough, ReplayWalkthrough } from "@/components/guidance/MicroWalkthrough";
import type { NextAction, BlockerInfo, OwnerInfo } from "@/hooks/use-guidance";

interface ProjectInfo {
  id: number | null;
  projectName: string;
  sizeKwp: string | null;
  pd: string | null;
  pm: string | null;
  contractValue: string | null;
  phase: string | null;
  isActive: boolean;
  escalationLevel: string | null;
  ragStatus: string | null;
  source: "excel" | "engineering" | "both" | "none";
  engTotal: number;
  engDone: number;
  engOverdue: number;
  engHighPriority: number;
  engAssignees: string[];
  planTotal: number;
  planAvgPct: number;
  projectPctComplete: number | null;
  qmTotal: number;
  qmApproved: number;
  executionEnabled: boolean;
  executionGateStatus: string;
  signedStatus: string;
  executionPhase: string | null;
  archivedStatus: string;
  phaseUpdatedAt: string | null;
  updatedAt: string | null;
  constructionStartDate: string | null;
  commissioningDate: string | null;
  clientHandoverDate: string | null;
}

const PRE_PM_PHASES = ["first_assessment", "cost_proposal"];

function phaseShowsPM(phaseKey: string): boolean {
  return !PRE_PM_PHASES.includes(phaseKey);
}

function phaseShowsEng(_phaseKey: string): boolean {
  return true;
}

function phaseShowsQM(_phaseKey: string): boolean {
  return true;
}

const PHASE_GROUPS = [
  {
    key: "first_assessment",
    label: "First Assessment",
    phaseValue: "First Assessment",
    matches: ["First Assessment", "P0_FIRST_ASSESSMENT", "P0"],
    color: "bg-slate-100 border-slate-300",
    headerBg: "bg-slate-500",
  },
  {
    key: "cost_proposal",
    label: "Cost Proposal",
    phaseValue: "Cost Proposal",
    matches: ["Cost Proposal", "P1_COST_PROPOSAL_DESIGN", "P1"],
    color: "bg-blue-50 border-blue-300",
    headerBg: "bg-blue-500",
  },
  {
    key: "planning",
    label: "Planning",
    phaseValue: "Planning",
    matches: ["Planning", "P2_PD_PM_HANDOVER", "P2", "Financial Close", "P3_FINANCIAL_CLOSE", "P3"],
    color: "bg-indigo-50 border-indigo-300",
    headerBg: "bg-indigo-500",
  },
  {
    key: "construction",
    label: "Construction",
    phaseValue: "Construction",
    matches: ["Construction", "P4_CONSTRUCTION_INSTALLATION", "P4"],
    color: "bg-orange-50 border-orange-300",
    headerBg: "bg-orange-500",
  },
  {
    key: "qa",
    label: "QA",
    phaseValue: "QA",
    matches: ["QA", "Commissioning", "P5_COMMISSIONING_QA", "P5"],
    color: "bg-violet-50 border-violet-300",
    headerBg: "bg-violet-500",
  },
  {
    key: "handover",
    label: "Handover",
    phaseValue: "Handover",
    matches: ["Handover", "P6_HANDOVER_DLP", "P6"],
    color: "bg-teal-50 border-teal-300",
    headerBg: "bg-teal-500",
  },
  {
    key: "compliance_handover",
    label: "Compliance Handover",
    phaseValue: "Compliance Handover",
    matches: ["Compliance Handover"],
    color: "bg-cyan-50 border-cyan-300",
    headerBg: "bg-cyan-600",
  },
  {
    key: "closeout",
    label: "Closeout",
    phaseValue: "Commercial Close Out",
    matches: ["DLP", "Commercial Close Out", "Commercial Close out", "Closeout", "P7_CLOSEOUT_POSTMORTEM", "P7"],
    color: "bg-emerald-50 border-emerald-300",
    headerBg: "bg-emerald-500",
  },
  {
    key: "internal",
    label: "Internal",
    phaseValue: "Internal",
    matches: ["Internal", "INTERNAL"],
    color: "bg-purple-50 border-purple-300",
    headerBg: "bg-purple-600",
  },
  {
    key: "hold",
    label: "Hold",
    phaseValue: "Hold",
    matches: ["Hold", "On Hold", "HOLD"],
    color: "bg-gray-100 border-gray-300",
    headerBg: "bg-gray-500",
  },
];

function mapPhaseToGroup(phase: string | null, source?: string): string {
  if (source === "engineering" && !phase) {
    return "internal";
  }

  if (source === "engineering" && phase) {
    const normalized = phase.trim();
    for (const g of PHASE_GROUPS) {
      if (g.matches.some((m) => m.toLowerCase() === normalized.toLowerCase())) {
        return g.key;
      }
    }
    return "internal";
  }

  let group = "first_assessment";
  if (phase) {
    const normalized = phase.trim();
    let found = false;
    for (const g of PHASE_GROUPS) {
      if (g.matches.some((m) => m.toLowerCase() === normalized.toLowerCase())) {
        group = g.key;
        found = true;
        break;
      }
    }
    if (!found) {
      if (normalized.startsWith("P0")) group = "first_assessment";
      else if (normalized.startsWith("P1")) group = "cost_proposal";
      else if (normalized.startsWith("P2") || normalized.startsWith("P3")) group = "planning";
      else if (normalized.startsWith("P4")) group = "construction";
      else if (normalized.startsWith("P5")) group = "qa";
      else if (normalized.startsWith("P6")) group = "handover";
      else if (normalized.startsWith("P7")) group = "closeout";
    }
  }
  return group;
}

function cleanProjectName(name: string): string {
  return name.replace(/_Tracker$/i, "").replace(/_/g, " ");
}

function formatZAR(value: string | number | null): string | null {
  if (value == null) return null;
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return null;
  return `R ${num.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pctBar(label: string, done: number, total: number, color: string) {
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-1.5 text-[10px]" data-testid={`pct-${label}`}>
      <span className="text-muted-foreground w-[28px] shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden min-w-[40px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-muted-foreground w-[28px] text-right">{pct}%</span>
    </div>
  );
}


function sourceBadge(source: string) {
  if (source === "both") {
    return (
      <Badge className="bg-green-50 text-green-700 text-[9px] px-1 py-0 border-green-200" data-testid="badge-source-both">
        <FileSpreadsheet className="w-2.5 h-2.5 mr-0.5" />Tracker
      </Badge>
    );
  }
  if (source === "excel") {
    return (
      <Badge className="bg-green-50 text-green-700 text-[9px] px-1 py-0 border-green-200" data-testid="badge-source-excel">
        <FileSpreadsheet className="w-2.5 h-2.5 mr-0.5" />Tracker
      </Badge>
    );
  }
  if (source === "engineering") {
    return (
      <Badge className="bg-purple-50 text-purple-700 text-[9px] px-1 py-0 border-purple-200" data-testid="badge-source-eng">
        <Wrench className="w-2.5 h-2.5 mr-0.5" />Pre-tracker
      </Badge>
    );
  }
  return null;
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const ESCALATION_LEVELS = ["", "Low", "Medium", "High", "Highest"];
const RAG_STATUSES = ["", "Green", "Amber", "Red"];

export default function LifecycleBoardPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: projects = [], isLoading: loading } = useQuery<ProjectInfo[]>({
    queryKey: ["/api/lifecycle-board/projects"],
    queryFn: async () => {
      const res = await fetch("/api/lifecycle-board/projects", {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [draggedProject, setDraggedProject] = useState<ProjectInfo | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectInfo | null>(null);
  const [linkTarget, setLinkTarget] = useState<string>("");
  const [mergeTarget, setMergeTarget] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<"summary" | "edit" | "link" | "merge" | "gate">("summary");
  const [editForm, setEditForm] = useState<{
    projectName: string;
    sizeKwp: string;
    pd: string;
    pm: string;
    contractValue: string;
    phase: string;
    escalationLevel: string;
    ragStatus: string;
  }>({ projectName: "", sizeKwp: "", pd: "", pm: "", contractValue: "", phase: "", escalationLevel: "", ragStatus: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [gateData, setGateData] = useState<{
    signedStatus: string;
    signedDate: string | null;
    signedDocLink: string | null;
    executionEnabled: boolean;
    executionGateStatus: string;
    executionPhase: string | null;
    overrideReason: string | null;
    eligibilityReasons: string[];
  } | null>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateSaving, setGateSaving] = useState(false);
  const [gateForm, setGateForm] = useState({
    signedStatus: "NONE",
    signedDate: "",
    signedDocLink: "",
    executionEnabled: false,
    overrideReason: "",
  });
  const [showOverrideReason, setShowOverrideReason] = useState(false);
  const { toast } = useToast();

  const role = localStorage.getItem("company_role") || "";
  const isExec = ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "ENGINEERING_MANAGER"].includes(role);

  function getGateAuthHeaders(): HeadersInit {
    const token = localStorage.getItem("company_role_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  const invalidateProjects = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/lifecycle-board/projects"] });
  };

  const openProjectDialog = (p: ProjectInfo) => {
    setSelectedProject(p);
    setEditForm({
      projectName: p.projectName || "",
      sizeKwp: p.sizeKwp || "",
      pd: p.pd || "",
      pm: p.pm || "",
      contractValue: p.contractValue || "",
      phase: p.phase || "",
      escalationLevel: p.escalationLevel || "",
      ragStatus: p.ragStatus || "",
    });
    setLinkTarget("");
    setMergeTarget("");
    setDialogTab("summary");
    setGateData(null);
    setShowOverrideReason(false);
    setProjectDialogOpen(true);
  };

  const loadGateData = async (projectId: number) => {
    setGateLoading(true);
    try {
      const res = await fetch(`/api/lifecycle-board/projects/${projectId}/execution-gate`, {
        credentials: "include",
        headers: getGateAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setGateData(data);
        setGateForm({
          signedStatus: data.signedStatus || "NONE",
          signedDate: data.signedDate || "",
          signedDocLink: data.signedDocLink || "",
          executionEnabled: data.executionEnabled || false,
          overrideReason: data.overrideReason || "",
        });
        setShowOverrideReason(false);
      }
    } catch {
      setGateData(null);
    } finally {
      setGateLoading(false);
    }
  };

  const handleSaveGate = async () => {
    if (!selectedProject?.id) return;
    setGateSaving(true);
    try {
      const res = await fetch(`/api/lifecycle-board/projects/${selectedProject.id}/execution-gate`, {
        method: "PATCH",
        headers: getGateAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({
          signedStatus: gateForm.signedStatus,
          signedDate: gateForm.signedDate || null,
          signedDocLink: gateForm.signedDocLink || null,
          executionEnabled: gateForm.executionEnabled,
          overrideReason: gateForm.overrideReason || null,
        }),
      });
      if (res.ok) {
        toast({ title: "Gate Updated", description: "Execution gate settings saved" });
        invalidateProjects();
        loadGateData(selectedProject.id);
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error || "Failed to save gate", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setGateSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedProject?.id) return;
    setEditSaving(true);
    try {
      const body: Record<string, any> = {};
      if (editForm.projectName.trim() !== (selectedProject.projectName || "")) body.projectName = editForm.projectName.trim();
      if (editForm.sizeKwp !== (selectedProject.sizeKwp || "")) body.sizeKwp = editForm.sizeKwp;
      if (editForm.pd !== (selectedProject.pd || "")) body.pd = editForm.pd;
      if (editForm.pm !== (selectedProject.pm || "")) body.pm = editForm.pm;
      if (editForm.contractValue !== (selectedProject.contractValue || "")) body.contractValue = editForm.contractValue;
      if (editForm.phase !== (selectedProject.phase || "")) body.phase = editForm.phase;
      if (editForm.escalationLevel !== (selectedProject.escalationLevel || "")) body.escalationLevel = editForm.escalationLevel || "none";
      if (editForm.ragStatus !== (selectedProject.ragStatus || "")) body.ragStatus = editForm.ragStatus || "none";

      const res = await fetch(`/api/lifecycle-board/projects/${selectedProject.id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast({ title: "Saved", description: `${cleanProjectName(selectedProject.projectName)} updated` });
        setProjectDialogOpen(false);
        setSelectedProject(null);
        invalidateProjects();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error || "Failed to save", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, project: ProjectInfo) => {
    setDraggedProject(project);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", project.id ? String(project.id) : project.projectName);
  };

  const handleDragOver = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnKey);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, targetColumnKey: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedProject) return;

    const currentGroup = mapPhaseToGroup(draggedProject.phase, draggedProject.source);
    if (currentGroup === targetColumnKey) {
      setDraggedProject(null);
      return;
    }

    const targetPhase = PHASE_GROUPS.find(g => g.key === targetColumnKey);
    if (!targetPhase) return;

    if (!draggedProject.id || draggedProject.id < 0) {
      await handlePromoteEngineering(draggedProject, targetPhase.phaseValue);
      setDraggedProject(null);
      return;
    }

    queryClient.setQueryData<ProjectInfo[]>(["/api/lifecycle-board/projects"], (prev) =>
      (prev || []).map(p =>
        p.id === draggedProject.id ? { ...p, phase: targetPhase.phaseValue, source: p.source === "engineering" ? "both" : p.source } : p
      )
    );

    try {
      const res = await fetch(`/api/lifecycle-board/projects/${draggedProject.id}/phase`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ phase: targetPhase.phaseValue }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Error", description: err.error || "Failed to move project", variant: "destructive" });
        invalidateProjects();
      } else {
        toast({ title: "Phase Updated", description: `${cleanProjectName(draggedProject.projectName)} moved to ${targetPhase.label}` });
        invalidateProjects();
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
      invalidateProjects();
    }

    setDraggedProject(null);
  };

  const handleDragEnd = () => {
    setDraggedProject(null);
    setDragOverColumn(null);
  };

  const trackerProjects = useMemo(() =>
    projects.filter(p => p.id !== null && p.id > 0 && (p.source === "excel" || p.source === "both")),
    [projects]
  );

  const handleLinkEngineering = async () => {
    if (!selectedProject || !linkTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/lifecycle-board/projects/link-engineering", {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          engineeringProjectName: selectedProject.projectName,
          targetProjectId: parseInt(linkTarget),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Linked", description: `${data.linked} task(s) linked to ${cleanProjectName(data.targetProject)}` });
        setProjectDialogOpen(false);
        setSelectedProject(null);
        setLinkTarget("");
        invalidateProjects();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to link project", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleMergeProjects = async () => {
    if (!selectedProject?.id || !mergeTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/lifecycle-board/projects/merge", {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          sourceProjectId: selectedProject.id,
          targetProjectId: parseInt(mergeTarget),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Merged", description: `${data.movedTasks} task(s) and ${data.movedPlanEntries} plan entries moved to ${cleanProjectName(data.target)}` });
        setProjectDialogOpen(false);
        setSelectedProject(null);
        setMergeTarget("");
        invalidateProjects();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to merge projects", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePromoteEngineering = async (project: ProjectInfo, phase: string) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/lifecycle-board/projects/promote-engineering", {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          engineeringProjectName: project.projectName,
          phase,
        }),
      });
      if (res.ok) {
        toast({ title: "Project Created", description: `${cleanProjectName(project.projectName)} is now a tracked project` });
        invalidateProjects();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to create project", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = projects.filter((p) => {
    if (p.archivedStatus === 'ARCHIVED_MERGED') return false;
    if (p.archivedStatus && p.archivedStatus !== 'ACTIVE') return false;
    if (showActiveOnly && !p.isActive) return false;
    if (searchTerm) {
      const clean = cleanProjectName(p.projectName).toLowerCase();
      const term = searchTerm.toLowerCase();
      if (!clean.includes(term) && !(p.pm || "").toLowerCase().includes(term)) return false;
    }
    return true;
  });

  const grouped: Record<string, ProjectInfo[]> = {};
  for (const group of PHASE_GROUPS) {
    grouped[group.key] = [];
  }
  for (const p of filtered) {
    const key = mapPhaseToGroup(p.phase, p.source);
    if (grouped[key]) {
      grouped[key].push(p);
    } else {
      grouped["first_assessment"].push(p);
    }
  }

  const trackerCount = projects.filter(p => p.source === "excel" || p.source === "both").length;
  const preTrackerCount = projects.filter(p => p.source === "engineering").length;

  const totalOverdue = useMemo(() => filtered.reduce((sum, p) => sum + (p.engOverdue || 0), 0), [filtered]);
  const totalHighPri = useMemo(() => filtered.reduce((sum, p) => sum + (p.engHighPriority || 0), 0), [filtered]);
  const missingPmProjects = useMemo(() => filtered.filter(p => {
    const key = mapPhaseToGroup(p.phase, p.source);
    return phaseShowsPM(key) && !p.pm;
  }), [filtered]);

  const lifecycleNextAction = useMemo((): NextAction | null => {
    if (totalOverdue > 0) return { label: `${totalOverdue} overdue task${totalOverdue !== 1 ? "s" : ""} need attention`, severity: "urgent" };
    if (totalHighPri > 0) return { label: `${totalHighPri} high-priority task${totalHighPri !== 1 ? "s" : ""} to review`, severity: "warning" };
    if (missingPmProjects.length > 0) return { label: `${missingPmProjects.length} project${missingPmProjects.length !== 1 ? "s" : ""} missing a Project Manager`, severity: "warning" };
    if (preTrackerCount > 0) return { label: `${preTrackerCount} pre-tracker project${preTrackerCount !== 1 ? "s" : ""} ready for promotion`, severity: "info" };
    return { label: "All projects on track — review phase progress below", severity: "info" };
  }, [totalOverdue, totalHighPri, missingPmProjects, preTrackerCount]);

  const lifecycleBlockers = useMemo((): BlockerInfo[] => {
    const b: BlockerInfo[] = [];
    if (totalOverdue > 0) b.push({ label: "Overdue engineering tasks", count: totalOverdue, severity: "urgent" });
    if (missingPmProjects.length > 0) b.push({ label: "Projects without PM assigned", count: missingPmProjects.length, severity: "warning" });
    return b;
  }, [totalOverdue, missingPmProjects]);

  const lifecycleWalkthroughSteps = useMemo(() => [
    { title: "Phase columns", description: "Projects are organized by lifecycle phase. Each column shows projects in that stage." },
    { title: "Drag to move", description: "Drag any project card to another column to change its phase. Changes save automatically." },
    { title: "Click for details", description: "Click a project card to see its summary, edit details, link records, or manage gate status." },
  ], []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="lifecycle-board-loading">
        <Loader2 className="w-6 h-6 animate-spin text-[#16a34a]" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="lifecycle-board-page">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-lifecycle-title">Company Life Cycle</h1>
          <p className="text-muted-foreground text-sm">
            Drag projects between columns to change phase
            <span className="ml-2 text-xs">
              ({trackerCount} with tracker{preTrackerCount > 0 ? `, ${preTrackerCount} pre-tracker` : ""})
            </span>
          </p>
        </div>
        <ReplayWalkthrough screenId="lifecycle-board" label="Replay guide" />
      </div>

      <MicroWalkthrough screenId="lifecycle-board" steps={lifecycleWalkthroughSteps} />
      <ActionBar nextAction={lifecycleNextAction} blockers={lifecycleBlockers} />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search projects or PM..."
            className="pl-9"
            data-testid="input-search-lifecycle"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={showActiveOnly}
            onCheckedChange={setShowActiveOnly}
            data-testid="switch-active-only"
          />
          <span className="text-sm text-muted-foreground">Active only</span>
        </div>
        <div className="ml-auto text-sm text-muted-foreground" data-testid="text-project-count">
          {filtered.length} project{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="pb-4 overflow-x-auto -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${PHASE_GROUPS.length}, minmax(140px, 1fr))`, minWidth: `${PHASE_GROUPS.length * 140}px` }}>
          {PHASE_GROUPS.map((group) => {
            const items = grouped[group.key] || [];
            const isOver = dragOverColumn === group.key;
            return (
              <div
                key={group.key}
                className={`rounded-lg border ${group.color} flex flex-col transition-all min-w-0 ${isOver ? "ring-2 ring-[#16a34a] scale-[1.01]" : ""}`}
                data-testid={`column-${group.key}`}
                onDragOver={(e) => handleDragOver(e, group.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, group.key)}
              >
                <div className={`${group.headerBg} text-white rounded-t-lg px-2 py-2 flex items-center justify-between gap-1`}>
                  <span className="font-semibold text-[11px] leading-tight truncate">{group.label}</span>
                  <Badge variant="secondary" className="bg-white/20 text-white text-[10px] px-1 py-0 shrink-0" data-testid={`badge-count-${group.key}`}>
                    {items.length}
                  </Badge>
                </div>
                <div className="p-1 space-y-1 flex-1 max-h-[calc(100vh-240px)] overflow-y-auto">
                  {items.length === 0 && (
                    <p className="text-[10px] text-muted-foreground text-center py-3">
                      {isOver ? "Drop here" : "No projects"}
                    </p>
                  )}
                  {items.map((p) => {
                    const isTracker = p.id !== null && p.id > 0;
                    const isEngOnly = p.source === "engineering" && !isTracker;
                    return (
                      <Card
                        key={p.id ?? p.projectName}
                        className={`shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${draggedProject?.projectName === p.projectName ? "opacity-40" : ""}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, p)}
                        onDragEnd={handleDragEnd}
                        onClick={() => openProjectDialog(p)}
                        data-testid={`card-project-${p.id}`}
                      >
                        <CardContent className="p-2 space-y-1">
                          <div className="flex items-start justify-between gap-0.5">
                            <div className="flex items-center gap-0.5 min-w-0">
                              <GripVertical className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                              <div className="font-medium text-[11px] leading-tight truncate" data-testid={`text-project-name-${p.id}`}>
                                {cleanProjectName(p.projectName)}
                              </div>
                            </div>
                            {sourceBadge(p.source)}
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {p.sizeKwp && parseFloat(p.sizeKwp) > 0 && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5" data-testid={`text-size-${p.id}`}>
                                <Zap className="w-2.5 h-2.5" />
                                {parseFloat(p.sizeKwp).toFixed(0)} kWp
                              </span>
                            )}
                            {p.executionEnabled && (
                              <Badge className="bg-green-100 text-green-700 text-[9px] px-1 py-0 border-green-300" data-testid={`badge-execution-${p.id}`}>
                                <ShieldCheck className="w-2.5 h-2.5 mr-0.5" />Execution
                              </Badge>
                            )}
                            {!p.executionEnabled && p.executionGateStatus === "ELIGIBLE" && (
                              <Badge className="bg-yellow-100 text-yellow-700 text-[9px] px-1 py-0 border-yellow-300" data-testid={`badge-eligible-${p.id}`}>
                                Eligible
                              </Badge>
                            )}
                          </div>
                          {formatZAR(p.contractValue) && (
                            <div className="text-[10px] text-muted-foreground truncate" data-testid={`text-value-${p.id}`}>
                              {formatZAR(p.contractValue)}
                            </div>
                          )}
                          {p.pm && (
                            <div className="text-[10px] text-muted-foreground flex items-center gap-0.5 truncate" data-testid={`text-pm-${p.id}`}>
                              <User className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">{p.pm}</span>
                            </div>
                          )}
                          {(() => {
                            const phaseKey = mapPhaseToGroup(p.phase, p.source);
                            const showPM = phaseShowsPM(phaseKey);
                            const showEng = phaseShowsEng(phaseKey);
                            const showQM = phaseShowsQM(phaseKey);
                            const hasAnyBar = (showPM && p.projectPctComplete != null) || (showEng && p.engTotal > 0) || (showQM && p.qmTotal > 0);
                            if (!hasAnyBar) return null;
                            return (
                              <div className="space-y-0.5 mt-0.5">
                                {showEng && pctBar("Eng", p.engDone, p.engTotal, "bg-purple-500")}
                                {showQM && pctBar("QM", p.qmApproved, p.qmTotal, "bg-teal-500")}
                                {showPM && p.projectPctComplete != null && (
                                  <div className="flex items-center gap-1.5 text-[10px]" data-testid={`pct-complete-${p.id}`}>
                                    <span className="text-muted-foreground w-[28px] shrink-0">PM</span>
                                    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden min-w-[40px]">
                                      <div
                                        className={`h-full rounded-full ${
                                          p.projectPctComplete >= 0.9 ? "bg-emerald-500" :
                                          p.projectPctComplete >= 0.5 ? "bg-blue-500" :
                                          p.projectPctComplete >= 0.2 ? "bg-amber-500" : "bg-slate-400"
                                        }`}
                                        style={{ width: `${Math.min(Math.round(p.projectPctComplete * 100), 100)}%` }}
                                      />
                                    </div>
                                    <span className="text-muted-foreground w-[28px] text-right">{Math.round(p.projectPctComplete * 100)}%</span>
                                  </div>
                                )}
                                {p.engOverdue > 0 && (
                                  <div className="flex items-center gap-1 text-[9px] text-red-600">
                                    <AlertCircle className="w-2.5 h-2.5" />
                                    {p.engOverdue} overdue
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto w-[95vw] sm:w-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-edit-project-title">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
              {selectedProject ? cleanProjectName(selectedProject.projectName) : "Project"}
            </DialogTitle>
            <DialogDescription>
              {selectedProject?.source === "engineering" ? "Pre-tracker project" : selectedProject?.source === "both" ? "Tracker + Engineering" : "Tracker project"}
              {selectedProject?.phase && ` \u2022 ${selectedProject.phase}`}
            </DialogDescription>
          </DialogHeader>

          {selectedProject && (
            <>
              <div className="flex border-b overflow-x-auto">
                <button
                  type="button"
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${dialogTab === "summary" ? "border-blue-600 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setDialogTab("summary")}
                  data-testid="tab-summary"
                >
                  <ClipboardList className="w-3.5 h-3.5 inline mr-1" />
                  Summary
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${dialogTab === "edit" ? "border-blue-600 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setDialogTab("edit"); setLinkTarget(""); setMergeTarget(""); }}
                  data-testid="tab-edit"
                >
                  <Save className="w-3.5 h-3.5 inline mr-1" />
                  Edit
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${dialogTab === "link" ? "border-blue-600 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setDialogTab("link"); setMergeTarget(""); }}
                  data-testid="tab-link"
                >
                  <Link2 className="w-3.5 h-3.5 inline mr-1" />
                  Link
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${dialogTab === "merge" ? "border-orange-600 text-orange-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setDialogTab("merge"); setLinkTarget(""); }}
                  data-testid="tab-merge"
                >
                  <Merge className="w-3.5 h-3.5 inline mr-1" />
                  Merge
                </button>
                {selectedProject.id && selectedProject.id > 0 && (
                  <button
                    type="button"
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${dialogTab === "gate" ? "border-green-600 text-green-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                    onClick={() => { setDialogTab("gate"); setLinkTarget(""); setMergeTarget(""); if (selectedProject.id) loadGateData(selectedProject.id); }}
                    data-testid="tab-gate"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 inline mr-1" />
                    Gate
                  </button>
                )}
              </div>

              {dialogTab === "summary" && (
                <div className="space-y-4" data-testid="summary-panel">
                  {(() => {
                    const p = selectedProject;
                    const phaseKey = mapPhaseToGroup(p.phase, p.source);
                    const showPM = phaseShowsPM(phaseKey);
                    const phaseLabel = PHASE_GROUPS.find(g => g.key === phaseKey)?.label || p.phase || "Unknown";

                    return (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5" />
                              Project Info
                            </div>
                            <div className="space-y-1.5 text-xs">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Phase</span>
                                <span className="font-medium">{phaseLabel}</span>
                              </div>
                              {p.sizeKwp && parseFloat(p.sizeKwp) > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Size</span>
                                  <span className="font-medium">{parseFloat(p.sizeKwp).toFixed(0)} kWp</span>
                                </div>
                              )}
                              {formatZAR(p.contractValue) && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Value</span>
                                  <span className="font-medium">{formatZAR(p.contractValue)}</span>
                                </div>
                              )}
                              {p.ragStatus && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">RAG</span>
                                  <Badge className={`text-[10px] px-1.5 py-0 ${p.ragStatus === "Green" ? "bg-green-100 text-green-700" : p.ragStatus === "Amber" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                                    {p.ragStatus}
                                  </Badge>
                                </div>
                              )}
                              {p.escalationLevel && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Escalation</span>
                                  <span className="font-medium">{p.escalationLevel}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <Users className="w-3.5 h-3.5" />
                              People & Dates
                            </div>
                            <div className="space-y-1.5 text-xs">
                              {p.pd && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">PD</span>
                                  <span className="font-medium truncate ml-2">{p.pd}</span>
                                </div>
                              )}
                              {p.pm && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">PM</span>
                                  <span className="font-medium truncate ml-2">{p.pm}</span>
                                </div>
                              )}
                              {p.phaseUpdatedAt && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Phase changed</span>
                                  <span className="font-medium">{new Date(p.phaseUpdatedAt).toLocaleDateString("en-ZA")}</span>
                                </div>
                              )}
                              {p.updatedAt && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Last updated</span>
                                  <span className="font-medium">{new Date(p.updatedAt).toLocaleDateString("en-ZA")}</span>
                                </div>
                              )}
                              {p.constructionStartDate && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Construction</span>
                                  <span className="font-medium">{p.constructionStartDate}</span>
                                </div>
                              )}
                              {p.commissioningDate && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Commissioning</span>
                                  <span className="font-medium">{p.commissioningDate}</span>
                                </div>
                              )}
                              {p.clientHandoverDate && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Handover</span>
                                  <span className="font-medium">{p.clientHandoverDate}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="bg-muted/50 rounded-lg p-3 space-y-3">
                          <div className="text-xs font-medium text-muted-foreground">Phase Completion</div>
                          <div className="space-y-2">
                            {p.engTotal > 0 && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Engineering Tasks</span>
                                  <span className="font-medium">{p.engDone}/{p.engTotal} done ({p.engTotal > 0 ? Math.round((p.engDone / p.engTotal) * 100) : 0}%)</span>
                                </div>
                                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-purple-500" style={{ width: `${p.engTotal > 0 ? (p.engDone / p.engTotal) * 100 : 0}%` }} />
                                </div>
                              </div>
                            )}
                            {p.qmTotal > 0 && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Quality Items</span>
                                  <span className="font-medium">{p.qmApproved}/{p.qmTotal} approved ({p.qmTotal > 0 ? Math.round((p.qmApproved / p.qmTotal) * 100) : 0}%)</span>
                                </div>
                                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-teal-500" style={{ width: `${p.qmTotal > 0 ? (p.qmApproved / p.qmTotal) * 100 : 0}%` }} />
                                </div>
                              </div>
                            )}
                            {showPM && p.projectPctComplete != null && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Project Management</span>
                                  <span className="font-medium">{Math.round(p.projectPctComplete * 100)}%</span>
                                </div>
                                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${p.projectPctComplete >= 0.9 ? "bg-emerald-500" : p.projectPctComplete >= 0.5 ? "bg-blue-500" : "bg-amber-500"}`} style={{ width: `${Math.min(Math.round(p.projectPctComplete * 100), 100)}%` }} />
                                </div>
                              </div>
                            )}
                            {p.engTotal === 0 && p.qmTotal === 0 && p.projectPctComplete == null && (
                              <div className="text-xs text-muted-foreground text-center py-2">No completion data yet</div>
                            )}
                          </div>
                        </div>

                        {(p.engOverdue > 0 || p.engHighPriority > 0) && (
                          <div className="space-y-1.5">
                            {p.engOverdue > 0 && (
                              <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2" data-testid="alert-overdue">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                {p.engOverdue} overdue engineering task{p.engOverdue !== 1 ? "s" : ""}
                              </div>
                            )}
                            {p.engHighPriority > 0 && (
                              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2" data-testid="alert-high-priority">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                {p.engHighPriority} high priority task{p.engHighPriority !== 1 ? "s" : ""}
                              </div>
                            )}
                          </div>
                        )}

                        {p.engAssignees && p.engAssignees.length > 0 && (
                          <div className="bg-muted/50 rounded-lg p-3">
                            <div className="text-xs font-medium text-muted-foreground mb-1.5">Team Members</div>
                            <div className="flex flex-wrap gap-1">
                              {p.engAssignees.map((name, i) => (
                                <Badge key={i} variant="secondary" className="text-[10px]">{name}</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="border-t pt-3 space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">View Details</div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs justify-start"
                              onClick={() => {
                                setProjectDialogOpen(false);
                                navigate(`/engineering/tasks?project=${encodeURIComponent(cleanProjectName(p.projectName))}`);
                              }}
                              data-testid="link-eng-tasks"
                            >
                              <Wrench className="w-3.5 h-3.5 mr-1.5 text-purple-600" />
                              Engineering Tasks
                              <ExternalLink className="w-3 h-3 ml-auto text-muted-foreground" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs justify-start"
                              onClick={() => {
                                setProjectDialogOpen(false);
                                navigate(`/quality?project=${encodeURIComponent(cleanProjectName(p.projectName))}`);
                              }}
                              data-testid="link-quality"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-teal-600" />
                              Quality Checklist
                              <ExternalLink className="w-3 h-3 ml-auto text-muted-foreground" />
                            </Button>
                            {showPM && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs justify-start"
                                onClick={() => {
                                  setProjectDialogOpen(false);
                                  navigate(`/projects?project=${encodeURIComponent(cleanProjectName(p.projectName))}`);
                                }}
                                data-testid="link-project-plan"
                              >
                                <ClipboardList className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                                Project Plan
                                <ExternalLink className="w-3 h-3 ml-auto text-muted-foreground" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {dialogTab === "edit" && (
                <div className="space-y-3">
                  {(!selectedProject.id || selectedProject.id <= 0) && (
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      This is a pre-tracker project. Editing is available once it is promoted to a tracked project.
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Project Name</Label>
                    <Input
                      value={editForm.projectName}
                      onChange={(e) => setEditForm(f => ({ ...f, projectName: e.target.value }))}
                      placeholder="Project name"
                      disabled={!selectedProject.id || selectedProject.id <= 0}
                      data-testid="input-edit-project-name"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Phase</Label>
                    <Select
                      value={editForm.phase}
                      onValueChange={(val) => setEditForm(f => ({ ...f, phase: val }))}
                      disabled={!selectedProject.id || selectedProject.id <= 0}
                    >
                      <SelectTrigger data-testid="select-edit-phase">
                        <SelectValue placeholder="Select phase..." />
                      </SelectTrigger>
                      <SelectContent>
                        {PHASE_GROUPS.map(g => (
                          <SelectItem key={g.key} value={g.phaseValue} data-testid={`edit-phase-option-${g.key}`}>
                            {g.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-3 grid-cols-2">
                    <div>
                      <Label className="text-xs">Size (kWp)</Label>
                      <Input
                        value={editForm.sizeKwp}
                        onChange={(e) => setEditForm(f => ({ ...f, sizeKwp: e.target.value }))}
                        placeholder="e.g. 500"
                        disabled={!selectedProject.id || selectedProject.id <= 0}
                        data-testid="input-edit-size"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Contract Value</Label>
                      <Input
                        value={editForm.contractValue}
                        onChange={(e) => setEditForm(f => ({ ...f, contractValue: e.target.value }))}
                        placeholder="e.g. 5000000"
                        disabled={!selectedProject.id || selectedProject.id <= 0}
                        data-testid="input-edit-contract"
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 grid-cols-2">
                    <div>
                      <Label className="text-xs">Project Developer (PD)</Label>
                      <Input
                        value={editForm.pd}
                        onChange={(e) => setEditForm(f => ({ ...f, pd: e.target.value }))}
                        placeholder="PD name"
                        disabled={!selectedProject.id || selectedProject.id <= 0}
                        data-testid="input-edit-pd"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Project Manager (PM)</Label>
                      <Input
                        value={editForm.pm}
                        onChange={(e) => setEditForm(f => ({ ...f, pm: e.target.value }))}
                        placeholder="PM name"
                        disabled={!selectedProject.id || selectedProject.id <= 0}
                        data-testid="input-edit-pm"
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 grid-cols-2">
                    <div>
                      <Label className="text-xs">Escalation Level</Label>
                      <Select
                        value={editForm.escalationLevel}
                        onValueChange={(val) => setEditForm(f => ({ ...f, escalationLevel: val }))}
                        disabled={!selectedProject.id || selectedProject.id <= 0}
                      >
                        <SelectTrigger data-testid="select-edit-escalation">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          {ESCALATION_LEVELS.map(level => (
                            <SelectItem key={level || "none"} value={level || "none"} data-testid={`edit-esc-${level || "none"}`}>
                              {level || "None"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">RAG Status</Label>
                      <Select
                        value={editForm.ragStatus}
                        onValueChange={(val) => setEditForm(f => ({ ...f, ragStatus: val }))}
                        disabled={!selectedProject.id || selectedProject.id <= 0}
                      >
                        <SelectTrigger data-testid="select-edit-rag">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          {RAG_STATUSES.map(rag => (
                            <SelectItem key={rag || "none"} value={rag || "none"} data-testid={`edit-rag-${rag || "none"}`}>
                              {rag || "None"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setProjectDialogOpen(false)} data-testid="btn-cancel-edit-project">
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSaveEdit}
                      disabled={editSaving || !selectedProject?.id || selectedProject.id <= 0}
                      data-testid="btn-save-edit-project"
                    >
                      {editSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                      Save
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {dialogTab === "link" && (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Link engineering tasks from <strong>{cleanProjectName(selectedProject.projectName)}</strong> to an existing tracker project. All tasks will be reassigned to the selected project.
                  </div>
                  {selectedProject.source !== "engineering" && (
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      This project already has a tracker. Linking is typically used for pre-tracker (engineering-only) projects.
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Link to project</Label>
                    <Select value={linkTarget} onValueChange={setLinkTarget}>
                      <SelectTrigger data-testid="select-link-target">
                        <SelectValue placeholder="Select a tracker project..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {trackerProjects
                          .filter(p => p.id !== selectedProject?.id)
                          .sort((a, b) => cleanProjectName(a.projectName).localeCompare(cleanProjectName(b.projectName)))
                          .map(p => (
                            <SelectItem key={p.id} value={String(p.id)} data-testid={`link-option-${p.id}`}>
                              {cleanProjectName(p.projectName)}
                              {p.phase && <span className="text-muted-foreground ml-1">({p.phase})</span>}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setProjectDialogOpen(false)}>Cancel</Button>
                    <Button
                      onClick={handleLinkEngineering}
                      disabled={!linkTarget || actionLoading}
                      data-testid="btn-confirm-link"
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Link2 className="w-4 h-4 mr-1" />}
                      Link Tasks
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {dialogTab === "merge" && (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Merge <strong>{cleanProjectName(selectedProject.projectName)}</strong> into another project. All tasks and plan data will be moved, and this project will be permanently removed.
                  </div>
                  {(!selectedProject.id || selectedProject.id <= 0) && (
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      Pre-tracker projects cannot be merged. Use Link to associate engineering tasks with a tracker project instead.
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Merge into</Label>
                    <Select value={mergeTarget} onValueChange={setMergeTarget} disabled={!selectedProject.id || selectedProject.id <= 0}>
                      <SelectTrigger data-testid="select-merge-target">
                        <SelectValue placeholder="Select target project..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {trackerProjects
                          .filter(p => p.id !== selectedProject?.id)
                          .sort((a, b) => cleanProjectName(a.projectName).localeCompare(cleanProjectName(b.projectName)))
                          .map(p => (
                            <SelectItem key={p.id} value={String(p.id)} data-testid={`merge-option-${p.id}`}>
                              {cleanProjectName(p.projectName)}
                              {p.phase && <span className="text-muted-foreground ml-1">({p.phase})</span>}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setProjectDialogOpen(false)}>Cancel</Button>
                    <Button
                      variant="destructive"
                      onClick={handleMergeProjects}
                      disabled={!mergeTarget || actionLoading || !selectedProject.id || selectedProject.id <= 0}
                      data-testid="btn-confirm-merge"
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Merge className="w-4 h-4 mr-1" />}
                      Merge Project
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {dialogTab === "gate" && (
                <div className="space-y-3" data-testid="gate-panel">
                  {gateLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : gateData ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Eligibility Status</span>
                        {gateData.executionGateStatus === "ELIGIBLE" ? (
                          <Badge className="bg-green-100 text-green-700 border-green-300 text-xs" data-testid="badge-eligible">
                            <CheckCircle2 className="w-3 h-3 mr-1" />Eligible
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-700 border-red-300 text-xs" data-testid="badge-not-eligible">
                            <AlertTriangle className="w-3 h-3 mr-1" />Not Eligible
                          </Badge>
                        )}
                      </div>
                      {gateData.executionGateStatus !== "ELIGIBLE" && gateData.eligibilityReasons && gateData.eligibilityReasons.length > 0 && (
                        <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 space-y-0.5" data-testid="gate-eligibility-reasons">
                          {gateData.eligibilityReasons.map((r, i) => (
                            <div key={i}>• {r}</div>
                          ))}
                        </div>
                      )}

                      <div>
                        <Label className="text-xs">Signed Status</Label>
                        {isExec ? (
                          <Select
                            value={gateForm.signedStatus}
                            onValueChange={(val) => setGateForm(f => ({ ...f, signedStatus: val }))}
                          >
                            <SelectTrigger data-testid="select-gate-signed-status">
                              <SelectValue placeholder="Select status..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NONE" data-testid="gate-signed-none">None</SelectItem>
                              <SelectItem value="COST_PROPOSAL_SIGNED" data-testid="gate-signed-cost">Cost Proposal Signed</SelectItem>
                              <SelectItem value="EPC_SIGNED" data-testid="gate-signed-epc">EPC Signed</SelectItem>
                              <SelectItem value="DEAL_SIGNED" data-testid="gate-signed-deal">Deal Signed</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="text-sm mt-1 font-medium" data-testid="text-gate-signed-status">
                            {gateData.signedStatus === "NONE" ? "None" :
                             gateData.signedStatus === "COST_PROPOSAL_SIGNED" ? "Cost Proposal Signed" :
                             gateData.signedStatus === "EPC_SIGNED" ? "EPC Signed" :
                             gateData.signedStatus === "DEAL_SIGNED" ? "Deal Signed" : gateData.signedStatus}
                          </div>
                        )}
                      </div>

                      <div className="grid gap-3 grid-cols-2">
                        <div>
                          <Label className="text-xs">Signed Date</Label>
                          {isExec ? (
                            <Input
                              type="date"
                              value={gateForm.signedDate}
                              onChange={(e) => setGateForm(f => ({ ...f, signedDate: e.target.value }))}
                              data-testid="input-gate-signed-date"
                            />
                          ) : (
                            <div className="text-sm mt-1 font-medium" data-testid="text-gate-signed-date">
                              {gateData.signedDate || "—"}
                            </div>
                          )}
                        </div>
                        <div>
                          <Label className="text-xs">Signed Document Link</Label>
                          {isExec ? (
                            <Input
                              value={gateForm.signedDocLink}
                              onChange={(e) => setGateForm(f => ({ ...f, signedDocLink: e.target.value }))}
                              placeholder="https://..."
                              data-testid="input-gate-signed-doc-link"
                            />
                          ) : (
                            <div className="text-sm mt-1 font-medium truncate" data-testid="text-gate-signed-doc-link">
                              {gateData.signedDocLink ? (
                                <a href={gateData.signedDocLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{gateData.signedDocLink}</a>
                              ) : "—"}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between py-2 border-t border-b">
                        <div>
                          <Label className="text-xs">Enable Execution</Label>
                          <div className="text-[10px] text-muted-foreground">
                            {gateForm.executionEnabled ? "Execution is enabled" : "Execution is disabled"}
                          </div>
                        </div>
                        {isExec ? (
                          <Switch
                            checked={gateForm.executionEnabled}
                            onCheckedChange={(checked) => {
                              if (checked && gateData.executionGateStatus !== "ELIGIBLE") {
                                setShowOverrideReason(true);
                              } else {
                                setShowOverrideReason(false);
                                setGateForm(f => ({ ...f, overrideReason: "" }));
                              }
                              setGateForm(f => ({ ...f, executionEnabled: checked }));
                            }}
                            data-testid="switch-gate-execution-enabled"
                          />
                        ) : (
                          <Badge className={gateForm.executionEnabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"} data-testid="badge-gate-execution-status">
                            {gateForm.executionEnabled ? "Enabled" : "Disabled"}
                          </Badge>
                        )}
                      </div>

                      {showOverrideReason && isExec && (
                        <div data-testid="gate-override-section">
                          <Label className="text-xs text-amber-700">Override Reason (required)</Label>
                          <Textarea
                            value={gateForm.overrideReason}
                            onChange={(e) => setGateForm(f => ({ ...f, overrideReason: e.target.value }))}
                            placeholder="Explain why execution is being enabled without full eligibility..."
                            className="mt-1 text-sm"
                            rows={3}
                            data-testid="textarea-gate-override-reason"
                          />
                        </div>
                      )}

                      <div>
                        <Label className="text-xs">Execution Phase</Label>
                        <div className="text-sm mt-1 font-medium" data-testid="text-gate-execution-phase">
                          {gateData.executionPhase || "Not yet imported"}
                        </div>
                      </div>

                      {isExec && (
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setProjectDialogOpen(false)} data-testid="btn-cancel-gate">
                            Cancel
                          </Button>
                          <Button
                            onClick={handleSaveGate}
                            disabled={gateSaving || (showOverrideReason && !gateForm.overrideReason.trim())}
                            data-testid="btn-save-gate"
                          >
                            {gateSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
                            Save Gate
                          </Button>
                        </DialogFooter>
                      )}
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground text-center py-4" data-testid="gate-no-data">
                      No execution gate data available for this project.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
