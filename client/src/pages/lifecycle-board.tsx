import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Zap, User, Wrench, FileSpreadsheet, GripVertical, CheckCircle2, ClipboardList } from "lucide-react";

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
    key: "hold",
    label: "Hold",
    phaseValue: "Hold",
    matches: ["Hold", "On Hold", "HOLD"],
    color: "bg-gray-100 border-gray-300",
    headerBg: "bg-gray-500",
  },
];

function mapPhaseToGroup(phase: string | null, source?: string): string {
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

function pctBarAvg(label: string, avgPct: number, total: number, color: string) {
  if (total === 0) return null;
  const pct = Math.round(avgPct);
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
    if (!project.id || project.id < 0) {
      e.preventDefault();
      return;
    }
    setDraggedProject(project);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(project.id));
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

    if (!draggedProject || !draggedProject.id || draggedProject.id < 0) return;

    const currentGroup = mapPhaseToGroup(draggedProject.phase, draggedProject.source);
    if (currentGroup === targetColumnKey) {
      setDraggedProject(null);
      return;
    }

    const targetPhase = PHASE_GROUPS.find(g => g.key === targetColumnKey);
    if (!targetPhase) return;

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
                    const canDrag = p.id !== null && p.id > 0;
                    return (
                      <Card
                        key={p.id ?? p.projectName}
                        className={`shadow-sm hover:shadow-md transition-all ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${draggedProject?.id === p.id ? "opacity-40" : ""}`}
                        draggable={canDrag}
                        onDragStart={(e) => handleDragStart(e, p)}
                        onDragEnd={handleDragEnd}
                        data-testid={`card-project-${p.id}`}
                      >
                        <CardContent className="p-2 space-y-1">
                          <div className="flex items-start justify-between gap-0.5">
                            <div className="flex items-center gap-0.5 min-w-0">
                              {canDrag && <GripVertical className="w-2.5 h-2.5 text-muted-foreground shrink-0" />}
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
                            {pctBarAvg("Plan", p.planAvgPct, p.planTotal, "bg-blue-500")}
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
    </div>
  );
}
