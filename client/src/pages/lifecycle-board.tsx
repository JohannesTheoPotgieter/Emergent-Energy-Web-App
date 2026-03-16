import { useState, useMemo, useEffect } from "react";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { useLocation } from "wouter";
import { Loader2, Search, Zap, User, Wrench, FileSpreadsheet, GripVertical, CheckCircle2, ClipboardList, Link2, Merge, ArrowRight, X, Save, AlertTriangle, ShieldCheck, ExternalLink, Calendar, Clock, AlertCircle, Users, Trash2, Plus } from "lucide-react";
import { ActionBar } from "@/components/guidance/ActionBar";
import { InlineTip } from "@/components/guidance/InlineTip";
import { MicroWalkthrough, ReplayWalkthrough } from "@/components/guidance/MicroWalkthrough";
import type { NextAction, BlockerInfo, OwnerInfo } from "@/hooks/use-guidance";
import { usePermission } from "@/hooks/use-permissions";

interface StageGateBlock {
  projectId: number;
  projectName: string;
  gateName: string;
  fromStage: string | null;
  targetStage: string;
  missingItems: Array<{ requirementType: string; requirementKey: string; message: string }>;
  canOverride: boolean;
}

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
  ragComment: string | null;
  ragUpdatedAt: string | null;
  ragUpdatedByUserId: number | null;
  ragUpdatedByName: string | null;
  source: "excel" | "engineering" | "both" | "none";
  engTotal: number;
  engDone: number;
  engOverdue: number;
  engHighPriority: number;
  engAssignees: string[];
  planTotal: number;
  planAvgPct: number;
  projectPctComplete: number | null;
  expectedPctComplete: number | null;
  qmTotal: number;
  qmApproved: number;
  executionEnabled: boolean;
  executionGateStatus: string;
  signedStatus: string;
  executionPhase: string | null;
  archivedStatus: string;
  hasTracker: boolean;
  phaseUpdatedAt: string | null;
  updatedAt: string | null;
  constructionStartDate: string | null;
  commissioningDate: string | null;
  clientHandoverDate: string | null;
  lastEngineer: { name: string; at: string } | null;
  pdPercent: number | null;
  engPercent: number | null;
  qmPercent: number | null;
  pmPercent: number | null;
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
    color: "bg-muted border-border",
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
    color: "bg-muted border-border",
    headerBg: "bg-gray-500",
  },
  {
    key: "gone",
    label: "Gone",
    phaseValue: "Gone",
    matches: ["Gone", "GONE"],
    color: "bg-red-50 border-red-300",
    headerBg: "bg-red-800",
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

function compactBar(label: string, pct: number | null, color: string, id?: number | null) {
  if (pct === null || pct === undefined) return null;
  const display = Math.round(pct * 100);
  return (
    <div className="flex items-center gap-1.5 text-[10px]" data-testid={`pct-${label}-${id}`}>
      <span className="text-muted-foreground w-[24px] shrink-0 font-semibold text-[9px]">{label}</span>
      <div className="flex-1 h-[6px] bg-gray-200 rounded-full overflow-hidden min-w-[40px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(display, 100)}%` }} />
      </div>
      <span className="text-muted-foreground w-[30px] text-right text-[9px] font-medium">{display}%</span>
    </div>
  );
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

function ragDot(status: string | null) {
  const colorMap: Record<string, string> = {
    Green: "bg-green-500",
    GREEN: "bg-green-500",
    green: "bg-green-500",
    Amber: "bg-amber-500",
    AMBER: "bg-amber-500",
    amber: "bg-amber-500",
    Red: "bg-red-500",
    RED: "bg-red-500",
    red: "bg-red-500",
  };
  const color = status ? colorMap[status] || "bg-gray-300" : "bg-gray-300";
  return <div className={`w-2.5 h-2.5 rounded-full ${color} shrink-0 ring-1 ring-black/10`} />;
}

function trackerBadge(hasTracker: boolean) {
  if (hasTracker) {
    return (
      <span className="text-[8px] font-bold px-1 py-0 rounded bg-green-100 text-green-700 border border-green-200 leading-tight">
        Linked
      </span>
    );
  }
  return (
    <span className="text-[8px] font-bold px-1 py-0 rounded bg-red-50 text-red-500 border border-red-200 leading-tight">
      No tracker
    </span>
  );
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
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

  const { data: pmUsers = [] } = useQuery<{ id: number; name: string; username: string; role: string }[]>({
    queryKey: ["/api/pm-assignable-users"],
    queryFn: async () => {
      const res = await fetch("/api/pm-assignable-users", { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: pdUsers = [] } = useQuery<{ id: number; name: string; username: string; role: string }[]>({
    queryKey: ["/api/pd-assignable-users"],
    queryFn: async () => {
      const res = await fetch("/api/pd-assignable-users", { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
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
    pmUserId: number | null;
    contractValue: string;
    phase: string;
    escalationLevel: string;
    ragStatus: string;
  }>({ projectName: "", sizeKwp: "", pd: "", pm: "", pmUserId: null, contractValue: "", phase: "", escalationLevel: "", ragStatus: "" });
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
  const [gateBlock, setGateBlock] = useState<StageGateBlock | null>(null);
  const [gateOverrideReason, setGateOverrideReason] = useState("");
  const [gateOverrideNote, setGateOverrideNote] = useState("");
  const [gateOverrideExpiryDate, setGateOverrideExpiryDate] = useState("");
  const [gateOverrideBusy, setGateOverrideBusy] = useState(false);
  const [ragModalOpen, setRagModalOpen] = useState(false);
  const [ragModalProject, setRagModalProject] = useState<ProjectInfo | null>(null);
  const [ragForm, setRagForm] = useState({ rag: "", comment: "" });
  const [ragSaving, setRagSaving] = useState(false);
  const [ragHistory, setRagHistory] = useState<any[]>([]);
  const [ragHistoryLoading, setRagHistoryLoading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [addProjectSaving, setAddProjectSaving] = useState(false);
  const [addProjectForm, setAddProjectForm] = useState({
    projectName: "",
    clientName: "",
    projectCode: "",
    location: "",
    initialPhase: "P0_FIRST_ASSESSMENT",
  });
  const [addProjectResult, setAddProjectResult] = useState<any>(null);
  const [phaseConstants, setPhaseConstants] = useState<{ projectPhases: string[]; projectPhaseLabels: Record<string, string> } | null>(null);
  const { allowed: canCreateProject } = usePermission('create_project', 'edit');
  const { toast } = useToast();

  useEffect(() => {
    if (addProjectOpen && !phaseConstants) {
      fetch("/api/template-constants", { credentials: "include", headers: getAuthHeaders() })
        .then(r => r.ok ? r.json() : null)
        .then(d => d && setPhaseConstants(d));
    }
  }, [addProjectOpen]);

  const role = localStorage.getItem("company_role") || "";
  const isExec = ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "ENGINEERING_MANAGER"].includes(role);
  const canOverrideStageGate = ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO", "PROGRAM_MANAGER", "ENGINEERING_MANAGER", "admin"].includes(role);

  function getGateAuthHeaders(): HeadersInit {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  const invalidateProjects = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/lifecycle-board/projects"] });
  };

  const canEditRag = ["COO_ADMIN", "CEO_ADMIN", "CCO"].includes(role);

  const openRagModal = async (p: ProjectInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    setRagModalProject(p);
    setRagForm({ rag: (p.ragStatus || "").toUpperCase(), comment: "" });
    setRagModalOpen(true);
    setRagHistory([]);
    if (p.id) {
      setRagHistoryLoading(true);
      try {
        const res = await fetch(`/api/lifecycle-board/projects/${p.id}/rag-history`, { credentials: "include", headers: getAuthHeaders() });
        if (res.ok) setRagHistory(await res.json());
      } catch {} finally { setRagHistoryLoading(false); }
    }
  };

  const handleSaveRag = async () => {
    if (!ragModalProject?.id) return;
    setRagSaving(true);
    try {
      const res = await fetch(`/api/lifecycle-board/projects/${ragModalProject.id}/rag`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ rag: ragForm.rag, comment: ragForm.comment }),
      });
      if (res.ok) {
        toast({ title: "RAG Updated", description: `RAG status set to ${ragForm.rag}` });
        setRagModalOpen(false);
        invalidateProjects();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error || "Failed to update RAG", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally { setRagSaving(false); }
  };

  const openProjectDialog = (p: ProjectInfo) => {
    setSelectedProject(p);
    const matchedPm = p.pm ? pmUsers.find(u => u.name === p.pm) : null;
    setEditForm({
      projectName: p.projectName || "",
      sizeKwp: p.sizeKwp || "",
      pd: p.pd || "",
      pm: p.pm || "",
      pmUserId: matchedPm?.id ?? null,
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
      if (editForm.pm !== (selectedProject.pm || "")) {
        body.pm = editForm.pm;
        body.pmUserId = editForm.pmUserId;
      }
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

  const handleDeleteProject = async () => {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/lifecycle-board/projects/${deleteTarget.id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "Project Deleted", description: `${cleanProjectName(deleteTarget.projectName)} and all related data have been permanently removed` });
        setDeleteConfirmOpen(false);
        setDeleteTarget(null);
        setProjectDialogOpen(false);
        setSelectedProject(null);
        invalidateProjects();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error || "Failed to delete project", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setDeleting(false);
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
        if (res.status === 409 && err?.error === "stage_gate_failed" && err?.gate) {
          setGateBlock({
            projectId: Number(draggedProject.id),
            projectName: draggedProject.projectName,
            gateName: err.gate.gateName,
            fromStage: err.gate.fromStage || null,
            targetStage: err.gate.targetStage,
            missingItems: err.gate.missingItems || [],
            canOverride: Boolean(err.gate.canOverride),
          });
          toast({ title: "Stage gate blocked", description: "Complete blockers or submit a formal override.", variant: "destructive" });
        } else {
          toast({ title: "Error", description: err.error || "Failed to move project", variant: "destructive" });
        }
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

  const submitStageGateOverride = async () => {
    if (!gateBlock) return;
    if (!gateOverrideReason.trim() || gateOverrideReason.trim().length < 8) {
      toast({ title: "Reason required", description: "Override reason must be at least 8 characters.", variant: "destructive" });
      return;
    }
    setGateOverrideBusy(true);
    try {
      const res = await fetch(`/api/lifecycle-board/projects/${gateBlock.projectId}/stage-gates/override`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          gateName: gateBlock.gateName,
          targetStage: gateBlock.targetStage,
          overrideReason: gateOverrideReason.trim(),
          note: gateOverrideNote.trim() || null,
          expiryDate: gateOverrideExpiryDate || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Override failed", description: err.message || err.error || "Failed to save override", variant: "destructive" });
        return;
      }
      const moveRes = await fetch(`/api/lifecycle-board/projects/${gateBlock.projectId}/phase`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ phase: gateBlock.targetStage }),
      });
      if (!moveRes.ok) {
        const err = await moveRes.json();
        toast({ title: "Override saved", description: `Override logged, but move is still blocked: ${err.message || err.error || 'unknown reason'}.`, variant: "destructive" });
      } else {
        toast({ title: "Override applied", description: "Override recorded and stage movement completed." });
        setGateBlock(null);
        setGateOverrideReason("");
        setGateOverrideNote("");
        setGateOverrideExpiryDate("");
      }
      invalidateProjects();
    } catch {
      toast({ title: "Network error", description: "Could not submit gate override", variant: "destructive" });
    } finally {
      setGateOverrideBusy(false);
    }
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

  const handleAddProject = async () => {
    if (!addProjectForm.projectName.trim()) {
      toast({ title: "Project name is required", variant: "destructive" });
      return;
    }
    setAddProjectSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
        body: JSON.stringify(addProjectForm),
      });
      const data = await res.json();
      if (res.ok) {
        setAddProjectResult(data);
        invalidateProjects();
        toast({ title: "Project created", description: `${data.project?.projectName || addProjectForm.projectName} has been added` });
      } else {
        toast({ title: "Error", description: data.error || "Failed to create project", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setAddProjectSaving(false);
  };

  const resetAddProjectDialog = () => {
    setAddProjectForm({ projectName: "", clientName: "", projectCode: "", location: "", initialPhase: "P0_FIRST_ASSESSMENT" });
    setAddProjectResult(null);
    setAddProjectOpen(false);
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
          <h1 className="text-2xl font-bold" data-testid="text-lifecycle-title">Lifecycle</h1>
          <p className="text-muted-foreground text-sm">
            Existing lifecycle board for stage movement, history, and gate visibility
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
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground" data-testid="text-project-count">
            {filtered.length} project{filtered.length !== 1 ? "s" : ""}
          </span>
          {canCreateProject && (
            <Button
              size="sm"
              onClick={() => { setAddProjectResult(null); setAddProjectForm({ projectName: "", clientName: "", projectCode: "", location: "", initialPhase: "P0_FIRST_ASSESSMENT" }); setAddProjectOpen(true); }}
              data-testid="button-add-project"
            >
              <Plus className="w-4 h-4 mr-1" /> Add Project
            </Button>
          )}
        </div>
      </div>

      <div className="pb-4 overflow-x-auto -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${PHASE_GROUPS.length}, minmax(200px, 1fr))`, minWidth: `${PHASE_GROUPS.length * 200}px` }}>
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
                <div className={`${group.headerBg} text-white rounded-t-lg px-3 py-2.5 flex items-center justify-between gap-1`}>
                  <span className="font-semibold text-xs leading-tight truncate">{group.label}</span>
                  <Badge variant="secondary" className="bg-card/25 text-white text-[10px] px-1.5 py-0 shrink-0 font-bold" data-testid={`badge-count-${group.key}`}>
                    {items.length}
                  </Badge>
                </div>
                <div className="p-1.5 space-y-1.5 flex-1 max-h-[calc(100vh-240px)] overflow-y-auto">
                  {items.length === 0 && (
                    <p className="text-[10px] text-muted-foreground text-center py-3">
                      {isOver ? "Drop here" : "No projects"}
                    </p>
                  )}
                  {items.map((p) => {
                    const isGone = p.phase?.toLowerCase() === "gone";
                    return (
                      <Card
                        key={p.id ?? p.projectName}
                        className={`shadow-sm hover:shadow-md transition-all border-l-[3px] ${
                          p.ragStatus?.toUpperCase() === "RED" ? "border-l-red-500" :
                          p.ragStatus?.toUpperCase() === "AMBER" ? "border-l-amber-500" :
                          p.ragStatus?.toUpperCase() === "GREEN" ? "border-l-green-500" :
                          "border-l-slate-300"
                        } ${isGone ? "opacity-60 cursor-not-allowed" : "cursor-grab active:cursor-grabbing"} ${draggedProject?.projectName === p.projectName ? "opacity-40" : ""}`}
                        draggable={!isGone}
                        onDragStart={(e) => !isGone && handleDragStart(e, p)}
                        onDragEnd={handleDragEnd}
                        onClick={() => openProjectDialog(p)}
                        data-testid={`card-project-${p.id}`}
                      >
                        <CardContent className="p-2.5 space-y-1.5">
                          <div className="flex items-start gap-1.5">
                            <button
                              type="button"
                              className="shrink-0 hover:scale-125 transition-transform mt-0.5"
                              onClick={(e) => openRagModal(p, e)}
                              title={p.ragStatus ? `RAG: ${p.ragStatus}` : "Set RAG"}
                              data-testid={`rag-dot-${p.id}`}
                            >
                              {ragDot(p.ragStatus)}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-1">
                                <span className="font-semibold text-[11px] leading-snug break-words" data-testid={`text-project-name-${p.id}`}>
                                  {cleanProjectName(p.projectName)}
                                </span>
                                {trackerBadge(p.hasTracker)}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                            {p.sizeKwp && parseFloat(p.sizeKwp) > 0 && (
                              <span className="flex items-center gap-0.5 font-medium" data-testid={`text-size-${p.id}`}>
                                <Zap className="w-3 h-3 text-amber-500" />
                                {parseFloat(p.sizeKwp).toFixed(0)} kWp
                              </span>
                            )}
                            {formatZAR(p.contractValue) && (
                              <span className="font-medium" data-testid={`text-value-${p.id}`}>
                                {formatZAR(p.contractValue)}
                              </span>
                            )}
                          </div>

                          <div className="space-y-0.5 text-[10px] text-muted-foreground">
                            {p.pd && (
                              <div className="flex items-center gap-1" data-testid={`text-pd-${p.id}`}>
                                <span className="font-semibold text-blue-600 w-[20px] shrink-0">PD</span>
                                <span className="break-words">{p.pd}</span>
                              </div>
                            )}
                            {p.pm && (
                              <div className="flex items-center gap-1" data-testid={`text-pm-${p.id}`}>
                                <span className="font-semibold text-indigo-600 w-[20px] shrink-0">PM</span>
                                <span className="break-words">{p.pm}</span>
                              </div>
                            )}
                            {p.lastEngineer && (
                              <div className="flex items-center gap-1 italic" data-testid={`text-last-eng-${p.id}`} title={`Last eng activity: ${p.lastEngineer.name}`}>
                                <Wrench className="w-3 h-3 text-purple-600 shrink-0" />
                                <span className="break-words">{p.lastEngineer.name}</span>
                                <span className="text-[8px] opacity-60 shrink-0">{timeAgo(p.lastEngineer.at)}</span>
                              </div>
                            )}
                          </div>

                          <div className="space-y-0.5 pt-0.5">
                            {compactBar("PD", p.pdPercent, "bg-blue-500", p.id)}
                            {compactBar("Eng", p.engPercent, "bg-purple-500", p.id)}
                            {compactBar("QA", p.qmPercent, "bg-teal-500", p.id)}
                            {compactBar("PM", p.pmPercent, "bg-emerald-500", p.id)}
                            {p.engOverdue > 0 && (
                              <div className="flex items-center gap-0.5 text-[9px] text-red-600 font-medium">
                                <AlertCircle className="w-3 h-3" />
                                {p.engOverdue} overdue
                              </div>
                            )}
                          </div>
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
                          <Button
                            variant="default"
                            size="sm"
                            className="w-full text-xs justify-start mb-1"
                            onClick={() => {
                              setProjectDialogOpen(false);
                              navigate(`/project/${encodeURIComponent(cleanProjectName(p.projectName))}`);
                            }}
                            data-testid="link-project-home"
                          >
                            <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
                            Project Home
                            <ExternalLink className="w-3 h-3 ml-auto opacity-70" />
                          </Button>
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
                    <SearchableSelect
                      value={editForm.phase}
                      onValueChange={(val) => setEditForm(f => ({ ...f, phase: val }))}
                      disabled={!selectedProject.id || selectedProject.id <= 0}
                      placeholder="Select phase..."
                      options={PHASE_GROUPS.map(g => ({ value: g.phaseValue, label: g.label }))}
                      data-testid="select-edit-phase"
                    />
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
                      <SearchableSelect
                        value={editForm.pd || "__unassigned"}
                        onValueChange={(val) => {
                          if (val === "__unassigned") {
                            setEditForm(f => ({ ...f, pd: "" }));
                          } else {
                            setEditForm(f => ({ ...f, pd: val }));
                          }
                        }}
                        disabled={!selectedProject.id || selectedProject.id <= 0}
                        placeholder="Unassigned"
                        options={[
                          { value: "__unassigned", label: "Unassigned" },
                          ...pdUsers.map((u) => ({ value: u.name, label: u.name })),
                        ]}
                        data-testid="select-edit-pd"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Project Manager (PM)</Label>
                      <SearchableSelect
                        value={editForm.pm || "__unassigned"}
                        onValueChange={(val) => {
                          if (val === "__unassigned") {
                            setEditForm(f => ({ ...f, pm: "", pmUserId: null }));
                          } else {
                            const matched = pmUsers.find(u => u.name === val);
                            setEditForm(f => ({ ...f, pm: val, pmUserId: matched?.id ?? null }));
                          }
                        }}
                        disabled={!selectedProject.id || selectedProject.id <= 0}
                        placeholder="Unassigned"
                        options={[
                          { value: "__unassigned", label: "Unassigned" },
                          ...pmUsers.map((u) => ({ value: u.name, label: u.name })),
                        ]}
                        data-testid="select-edit-pm"
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 grid-cols-2">
                    <div>
                      <Label className="text-xs">Escalation Level</Label>
                      <SearchableSelect
                        value={editForm.escalationLevel}
                        onValueChange={(val) => setEditForm(f => ({ ...f, escalationLevel: val }))}
                        disabled={!selectedProject.id || selectedProject.id <= 0}
                        placeholder="None"
                        options={ESCALATION_LEVELS.map(level => ({
                          value: level || "none",
                          label: level || "None",
                        }))}
                        data-testid="select-edit-escalation"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">RAG Status</Label>
                      <SearchableSelect
                        value={editForm.ragStatus}
                        onValueChange={(val) => setEditForm(f => ({ ...f, ragStatus: val }))}
                        disabled={!selectedProject.id || selectedProject.id <= 0}
                        placeholder="None"
                        options={RAG_STATUSES.map(rag => ({
                          value: rag || "none",
                          label: rag || "None",
                        }))}
                        data-testid="select-edit-rag"
                      />
                    </div>
                  </div>
                  <DialogFooter className="flex justify-between sm:justify-between">
                    {isExec && selectedProject?.id && selectedProject.id > 0 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => { setDeleteTarget(selectedProject); setDeleteConfirmOpen(true); }}
                        data-testid="btn-delete-project"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Delete
                      </Button>
                    ) : <div />}
                    <div className="flex gap-2">
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
                    </div>
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
                    <SearchableSelect
                      value={linkTarget}
                      onValueChange={setLinkTarget}
                      placeholder="Select a tracker project..."
                      options={trackerProjects
                        .filter(p => p.id !== selectedProject?.id)
                        .sort((a, b) => cleanProjectName(a.projectName).localeCompare(cleanProjectName(b.projectName)))
                        .map(p => ({
                          value: String(p.id),
                          label: `${cleanProjectName(p.projectName)}${p.phase ? ` (${p.phase})` : ""}`,
                        }))}
                      data-testid="select-link-target"
                    />
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
                    <SearchableSelect
                      value={mergeTarget}
                      onValueChange={setMergeTarget}
                      disabled={!selectedProject.id || selectedProject.id <= 0}
                      placeholder="Select target project..."
                      options={trackerProjects
                        .filter(p => p.id !== selectedProject?.id)
                        .sort((a, b) => cleanProjectName(a.projectName).localeCompare(cleanProjectName(b.projectName)))
                        .map(p => ({
                          value: String(p.id),
                          label: `${cleanProjectName(p.projectName)}${p.phase ? ` (${p.phase})` : ""}`,
                        }))}
                      data-testid="select-merge-target"
                    />
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
                          <SearchableSelect
                            value={gateForm.signedStatus}
                            onValueChange={(val) => setGateForm(f => ({ ...f, signedStatus: val }))}
                            placeholder="Select status..."
                            options={[
                              { value: "NONE", label: "None" },
                              { value: "COST_PROPOSAL_SIGNED", label: "Cost Proposal Signed" },
                              { value: "EPC_SIGNED", label: "EPC Signed" },
                              { value: "DEAL_SIGNED", label: "Deal Signed" },
                            ]}
                            data-testid="select-gate-signed-status"
                          />
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
                          <Badge className={gateForm.executionEnabled ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"} data-testid="badge-gate-execution-status">
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

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600" data-testid="text-delete-title">
              <Trash2 className="w-5 h-5" />
              Delete Project
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <span>Are you sure you want to permanently delete <strong>{deleteTarget ? cleanProjectName(deleteTarget.projectName) : ""}</strong>?</span>
              <span className="block text-red-600 font-medium">This will permanently remove ALL project data including financial records, engineering tasks, quality checklists, plan tasks, deliverables, and all related data. This action cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setDeleteConfirmOpen(false); setDeleteTarget(null); }} data-testid="btn-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteProject}
              disabled={deleting}
              data-testid="btn-confirm-delete"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Permanently Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addProjectOpen} onOpenChange={(open) => { if (!open) resetAddProjectDialog(); else setAddProjectOpen(true); }}>
        <DialogContent className="max-w-md" data-testid="dialog-add-project">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-add-project-title">
              <Plus className="w-5 h-5 text-[#16a34a]" />
              {addProjectResult ? "Project Created" : "Add Project"}
            </DialogTitle>
            <DialogDescription>
              {addProjectResult
                ? "Your new project has been added to the lifecycle board."
                : "Create a new project and place it on the lifecycle board. Phase templates will be applied automatically."}
            </DialogDescription>
          </DialogHeader>

          {addProjectResult ? (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-center">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
              </div>
              <p className="text-center text-sm">
                <strong>{addProjectResult.project?.projectName}</strong> has been created at <strong>{addProjectResult.phaseLabel}</strong>
              </p>
              {addProjectResult.templateApplied && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800" data-testid="text-template-applied">
                  Phase template applied: {addProjectResult.applyResult?.tasksCreated || 0} tasks,
                  {" "}{addProjectResult.applyResult?.deliverablesCreated || 0} deliverables
                </div>
              )}
              {addProjectResult.engStagesGenerated && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800" data-testid="text-eng-stages-generated">
                  Engineering stages: {addProjectResult.engStagesResult?.stagesCreated || 0} stage(s),
                  {" "}{addProjectResult.engStagesResult?.tasksCreated || 0} task(s)
                  {addProjectResult.engStagesResult?.stageDetails?.length > 0 && (
                    <span> — {addProjectResult.engStagesResult.stageDetails.join(", ")}</span>
                  )}
                </div>
              )}
              <DialogFooter className="gap-2 pt-2">
                <Button variant="outline" onClick={() => { setAddProjectResult(null); setAddProjectForm({ projectName: "", clientName: "", projectCode: "", location: "", initialPhase: "P0_FIRST_ASSESSMENT" }); }} data-testid="button-add-another">
                  <Plus className="w-4 h-4 mr-1" /> Add Another
                </Button>
                <Button onClick={resetAddProjectDialog} data-testid="button-close-add-dialog">
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div>
                <Label className="text-sm font-medium">Project Name *</Label>
                <Input
                  value={addProjectForm.projectName}
                  onChange={(e) => setAddProjectForm(f => ({ ...f, projectName: e.target.value }))}
                  placeholder="e.g. Acme Solar Park"
                  data-testid="input-add-project-name"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Client Name</Label>
                <Input
                  value={addProjectForm.clientName}
                  onChange={(e) => setAddProjectForm(f => ({ ...f, clientName: e.target.value }))}
                  placeholder="e.g. Acme Corp"
                  data-testid="input-add-client-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">Project Code</Label>
                  <Input
                    value={addProjectForm.projectCode}
                    onChange={(e) => setAddProjectForm(f => ({ ...f, projectCode: e.target.value }))}
                    placeholder="e.g. PRJ-042"
                    data-testid="input-add-project-code"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">Location</Label>
                  <Input
                    value={addProjectForm.location}
                    onChange={(e) => setAddProjectForm(f => ({ ...f, location: e.target.value }))}
                    placeholder="e.g. Gauteng"
                    data-testid="input-add-location"
                  />
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">Initial Phase</Label>
                <SearchableSelect
                  value={addProjectForm.initialPhase}
                  onValueChange={(v) => setAddProjectForm(f => ({ ...f, initialPhase: v }))}
                  options={(phaseConstants?.projectPhases || ["P0_FIRST_ASSESSMENT"]).map((p) => ({
                    value: p,
                    label: phaseConstants?.projectPhaseLabels?.[p] || p,
                  }))}
                  data-testid="select-add-initial-phase"
                />
              </div>
              <DialogFooter className="gap-2 pt-2">
                <Button variant="outline" onClick={resetAddProjectDialog} data-testid="button-cancel-add">
                  Cancel
                </Button>
                <Button
                  onClick={handleAddProject}
                  disabled={addProjectSaving || !addProjectForm.projectName.trim()}
                  data-testid="button-submit-add-project"
                >
                  {addProjectSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                  Create Project
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>



      <Dialog open={!!gateBlock} onOpenChange={(open) => { if (!open) setGateBlock(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Stage move blocked by gate</DialogTitle>
            <DialogDescription>
              {gateBlock ? `${cleanProjectName(gateBlock.projectName)} cannot move to ${gateBlock.targetStage} until the blockers below are resolved.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded border p-3 bg-amber-50">
              <p className="text-xs font-semibold text-amber-900">Missing requirements</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
                {gateBlock?.missingItems.map((item, idx) => (
                  <li key={`${item.requirementKey}-${idx}`}>{item.message}</li>
                ))}
              </ul>
            </div>
            {gateBlock?.canOverride && canOverrideStageGate ? (
              <div className="rounded border p-3 bg-red-50 space-y-2">
                <p className="text-xs font-semibold text-red-900">Exception override (audited)</p>
                <Textarea value={gateOverrideReason} onChange={(e) => setGateOverrideReason(e.target.value)} placeholder="Why this move must proceed despite missing requirements" />
                <Input type="date" value={gateOverrideExpiryDate} onChange={(e) => setGateOverrideExpiryDate(e.target.value)} />
                <Input value={gateOverrideNote} onChange={(e) => setGateOverrideNote(e.target.value)} placeholder="Optional supporting note" />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGateBlock(null)}>Close</Button>
            {gateBlock?.canOverride && canOverrideStageGate ? (
              <Button onClick={submitStageGateOverride} disabled={gateOverrideBusy || gateOverrideReason.trim().length < 8}>
                {gateOverrideBusy ? "Submitting..." : "Submit override and continue"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ragModalOpen} onOpenChange={setRagModalOpen}>
        <DialogContent className="max-w-md w-[95vw] sm:w-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="rag-modal-title">
              {ragModalProject && ragDot(ragModalProject.ragStatus)}
              RAG Status — {ragModalProject ? cleanProjectName(ragModalProject.projectName) : ""}
            </DialogTitle>
            <DialogDescription>
              <span className="block text-xs mt-1">
                Current: <span className="font-medium">{ragModalProject?.ragStatus || "Not set"}</span>
                {ragModalProject?.ragUpdatedByName && <span> by {ragModalProject.ragUpdatedByName}</span>}
                {ragModalProject?.ragUpdatedAt && <span> ({timeAgo(ragModalProject.ragUpdatedAt)})</span>}
              </span>
              {ragModalProject?.ragComment && (
                <span className="block text-xs italic mt-0.5 text-muted-foreground">"{ragModalProject.ragComment}"</span>
              )}
            </DialogDescription>
          </DialogHeader>

          {canEditRag ? (
            <div className="space-y-3" data-testid="rag-edit-form">
              <div>
                <Label className="text-sm font-medium">RAG Status</Label>
                <SearchableSelect
                  value={ragForm.rag}
                  onValueChange={(v) => setRagForm(f => ({ ...f, rag: v }))}
                  placeholder="Select RAG"
                  options={[
                    { value: "GREEN", label: "Green" },
                    { value: "AMBER", label: "Amber" },
                    { value: "RED", label: "Red" },
                  ]}
                  data-testid="select-rag-status"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Comment (min 5 chars)</Label>
                <Textarea
                  value={ragForm.comment}
                  onChange={(e) => setRagForm(f => ({ ...f, comment: e.target.value }))}
                  placeholder="Reason for this RAG status..."
                  rows={3}
                  data-testid="input-rag-comment"
                />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setRagModalOpen(false)} data-testid="button-cancel-rag">Cancel</Button>
                <Button
                  onClick={handleSaveRag}
                  disabled={ragSaving || !ragForm.rag || ragForm.comment.trim().length < 5}
                  data-testid="button-save-rag"
                >
                  {ragSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Update RAG
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-2" data-testid="rag-readonly">
              RAG updates are restricted to COO, CEO, and CCO roles.
            </div>
          )}

          {ragHistory.length > 0 && (
            <div className="border-t pt-3 mt-2">
              <h4 className="text-xs font-semibold mb-2">History</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {ragHistory.map((h: any) => (
                  <div key={h.id} className="flex items-start gap-2 text-[11px]">
                    <div className="flex items-center gap-1 shrink-0">
                      {ragDot(h.fromRag)}
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      {ragDot(h.toRag)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-muted-foreground">
                        <span className="font-medium text-foreground">{h.changedByName}</span> — {timeAgo(h.changedAt)}
                      </div>
                      <div className="text-muted-foreground italic truncate" title={h.comment}>{h.comment}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {ragHistoryLoading && <div className="text-xs text-muted-foreground text-center py-2">Loading history...</div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
