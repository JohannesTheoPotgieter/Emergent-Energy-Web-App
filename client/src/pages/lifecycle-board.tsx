import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Zap, User, Wrench, FileSpreadsheet, GripVertical, CheckCircle2, ClipboardList, Link2, Merge, ArrowRight } from "lucide-react";

interface ProjectInfo {
  id: number | null;
  projectName: string;
  sizeKwp: string | null;
  pd: string | null;
  pm: string | null;
  contractValue: string | null;
  phase: string | null;
  isActive: boolean;
  source: "excel" | "engineering" | "both";
  engTotal: number;
  engDone: number;
  planTotal: number;
  planAvgPct: number;
  projectPctComplete: number | null;
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
  if (source === "engineering") {
    if (phase) {
      const normalized = phase.trim();
      for (const g of PHASE_GROUPS) {
        if (g.matches.some((m) => m.toLowerCase() === normalized.toLowerCase())) {
          return g.key;
        }
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
  const hasTracker = source === "excel" || source === "both";
  if (hasTracker && (group === "first_assessment" || group === "cost_proposal")) {
    group = "planning";
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

export default function LifecycleBoardPage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [draggedProject, setDraggedProject] = useState<ProjectInfo | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectInfo | null>(null);
  const [linkTarget, setLinkTarget] = useState<string>("");
  const [mergeTarget, setMergeTarget] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/lifecycle-board/projects", {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

    setProjects(prev =>
      prev.map(p =>
        p.id === draggedProject.id ? { ...p, phase: targetPhase.phaseValue } : p
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
        loadData();
      } else {
        toast({ title: "Phase Updated", description: `${cleanProjectName(draggedProject.projectName)} moved to ${targetPhase.label}` });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
      loadData();
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
        setLinkDialogOpen(false);
        setSelectedProject(null);
        setLinkTarget("");
        loadData();
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
        setMergeDialogOpen(false);
        setSelectedProject(null);
        setMergeTarget("");
        loadData();
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
        loadData();
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="lifecycle-board-loading">
        <Loader2 className="w-6 h-6 animate-spin text-[#16a34a]" />
      </div>
    );
  }

  const trackerCount = projects.filter(p => p.source === "excel" || p.source === "both").length;
  const preTrackerCount = projects.filter(p => p.source === "engineering").length;

  return (
    <div className="space-y-4" data-testid="lifecycle-board-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-lifecycle-title">Lifecycle Board</h1>
        <p className="text-muted-foreground text-sm">
          Drag projects between columns to change phase
          <span className="ml-2 text-xs">
            ({trackerCount} with tracker{preTrackerCount > 0 ? `, ${preTrackerCount} pre-tracker` : ""})
          </span>
        </p>
      </div>

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

      <div className="pb-4">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${PHASE_GROUPS.length}, minmax(0, 1fr))` }}>
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
                          {p.projectPctComplete != null && (
                            <div className="flex items-center gap-1 mt-0.5" data-testid={`pct-complete-${p.id}`}>
                              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    p.projectPctComplete >= 0.9 ? "bg-emerald-500" :
                                    p.projectPctComplete >= 0.5 ? "bg-blue-500" :
                                    p.projectPctComplete >= 0.2 ? "bg-amber-500" : "bg-slate-400"
                                  }`}
                                  style={{ width: `${Math.min(Math.round(p.projectPctComplete * 100), 100)}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono font-semibold text-slate-700 w-[30px] text-right">
                                {Math.round(p.projectPctComplete * 100)}%
                              </span>
                            </div>
                          )}
                          <div className="space-y-0.5">
                            {pctBar("Eng", p.engDone, p.engTotal, "bg-purple-500")}
                          </div>
                          <div className="flex gap-1 mt-1">
                            {isEngOnly && (
                              <button
                                className="flex items-center gap-0.5 text-[9px] text-blue-600 hover:text-blue-800 bg-blue-50 rounded px-1 py-0.5"
                                onClick={(e) => { e.stopPropagation(); setSelectedProject(p); setLinkTarget(""); setLinkDialogOpen(true); }}
                                data-testid={`btn-link-${p.projectName}`}
                              >
                                <Link2 className="w-2.5 h-2.5" />Link
                              </button>
                            )}
                            {isTracker && (
                              <button
                                className="flex items-center gap-0.5 text-[9px] text-orange-600 hover:text-orange-800 bg-orange-50 rounded px-1 py-0.5"
                                onClick={(e) => { e.stopPropagation(); setSelectedProject(p); setMergeTarget(""); setMergeDialogOpen(true); }}
                                data-testid={`btn-merge-${p.id}`}
                              >
                                <Merge className="w-2.5 h-2.5" />Merge
                              </button>
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

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-blue-600" />
              Link Engineering Tasks
            </DialogTitle>
            <DialogDescription>
              Link all engineering tasks from <strong>{selectedProject ? cleanProjectName(selectedProject.projectName) : ""}</strong> to an existing tracker project. The tasks will be reassigned.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Link to project:</label>
              <Select value={linkTarget} onValueChange={setLinkTarget}>
                <SelectTrigger data-testid="select-link-target">
                  <SelectValue placeholder="Select a tracker project..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {trackerProjects
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleLinkEngineering}
              disabled={!linkTarget || actionLoading}
              data-testid="btn-confirm-link"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ArrowRight className="w-4 h-4 mr-1" />}
              Link Tasks
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="w-5 h-5 text-orange-600" />
              Merge Projects
            </DialogTitle>
            <DialogDescription>
              Merge <strong>{selectedProject ? cleanProjectName(selectedProject.projectName) : ""}</strong> into another project. All tasks and plan data will be moved to the target project, and the source project will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Merge into:</label>
              <Select value={mergeTarget} onValueChange={setMergeTarget}>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleMergeProjects}
              disabled={!mergeTarget || actionLoading}
              data-testid="btn-confirm-merge"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Merge className="w-4 h-4 mr-1" />}
              Merge Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
