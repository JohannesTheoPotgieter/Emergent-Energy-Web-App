import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Search, Zap, User, Wrench, FileSpreadsheet } from "lucide-react";

interface ProjectInfo {
  id: number;
  projectName: string;
  sizeKwp: string | null;
  pd: string | null;
  pm: string | null;
  contractValue: string | null;
  phase: string | null;
  isActive: boolean;
  ragStatus: string | null;
  source: "excel" | "engineering" | "both";
  engTaskCount?: number;
  engStatus?: string | null;
}

interface EngTask {
  id: number;
  projectName: string;
  title: string;
  status: string;
  priority: string | null;
  phase: string | null;
  trackingRag: string | null;
}

const PHASE_GROUPS = [
  {
    key: "first_assessment",
    label: "First Assessment",
    matches: ["First Assessment", "P0_FIRST_ASSESSMENT", "P0"],
    color: "bg-slate-100 border-slate-300",
    headerBg: "bg-slate-500",
  },
  {
    key: "cost_proposal",
    label: "Cost Proposal",
    matches: ["Cost Proposal", "P1_COST_PROPOSAL_DESIGN", "P1"],
    color: "bg-blue-50 border-blue-300",
    headerBg: "bg-blue-500",
  },
  {
    key: "planning",
    label: "Planning",
    matches: ["Planning", "P2_PD_PM_HANDOVER", "P2", "Financial Close", "P3_FINANCIAL_CLOSE", "P3"],
    color: "bg-indigo-50 border-indigo-300",
    headerBg: "bg-indigo-500",
  },
  {
    key: "construction",
    label: "Construction",
    matches: ["Construction", "P4_CONSTRUCTION_INSTALLATION", "P4"],
    color: "bg-orange-50 border-orange-300",
    headerBg: "bg-orange-500",
  },
  {
    key: "qa",
    label: "QA",
    matches: ["QA", "Commissioning", "P5_COMMISSIONING_QA", "P5"],
    color: "bg-violet-50 border-violet-300",
    headerBg: "bg-violet-500",
  },
  {
    key: "handover",
    label: "Compliance Handover",
    matches: ["Compliance Handover", "Handover", "P6_HANDOVER_DLP", "P6"],
    color: "bg-teal-50 border-teal-300",
    headerBg: "bg-teal-500",
  },
  {
    key: "closeout",
    label: "Closeout",
    matches: ["DLP", "Commercial Close Out", "Commercial Close out", "Closeout", "P7_CLOSEOUT_POSTMORTEM", "P7"],
    color: "bg-emerald-50 border-emerald-300",
    headerBg: "bg-emerald-500",
  },
  {
    key: "hold",
    label: "Hold",
    matches: ["Hold", "On Hold", "HOLD"],
    color: "bg-gray-100 border-gray-300",
    headerBg: "bg-gray-500",
  },
];

function mapPhaseToGroup(phase: string | null): string {
  if (!phase) return "first_assessment";
  const normalized = phase.trim();
  for (const group of PHASE_GROUPS) {
    if (group.matches.some((m) => m.toLowerCase() === normalized.toLowerCase())) {
      return group.key;
    }
  }
  if (normalized.startsWith("P0")) return "first_assessment";
  if (normalized.startsWith("P1")) return "cost_proposal";
  if (normalized.startsWith("P2") || normalized.startsWith("P3")) return "planning";
  if (normalized.startsWith("P4")) return "construction";
  if (normalized.startsWith("P5")) return "qa";
  if (normalized.startsWith("P6")) return "handover";
  if (normalized.startsWith("P7")) return "closeout";
  return "first_assessment";
}

function cleanProjectName(name: string): string {
  return name.replace(/_Tracker$/i, "").replace(/_/g, " ");
}

function normalizeNameForMatch(name: string): string {
  return cleanProjectName(name).toLowerCase().trim().replace(/\s+/g, " ");
}

function formatZAR(value: string | number | null): string | null {
  if (value == null) return null;
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return null;
  return `R ${num.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function ragBadge(rag: string | null) {
  if (!rag) return null;
  const r = rag.toUpperCase();
  if (r === "GREEN") return <Badge className="bg-green-100 text-green-800 text-[10px] px-1.5" data-testid="badge-rag-green">GREEN</Badge>;
  if (r === "AMBER" || r === "ORANGE") return <Badge className="bg-amber-100 text-amber-800 text-[10px] px-1.5" data-testid="badge-rag-amber">AMBER</Badge>;
  if (r === "RED") return <Badge className="bg-red-100 text-red-800 text-[10px] px-1.5" data-testid="badge-rag-red">RED</Badge>;
  return null;
}

function sourceBadge(source: string) {
  if (source === "both") {
    return (
      <span className="flex items-center gap-0.5">
        <Badge className="bg-green-50 text-green-700 text-[9px] px-1 py-0 border-green-200" data-testid="badge-source-both">
          <FileSpreadsheet className="w-2.5 h-2.5 mr-0.5" />
          <Wrench className="w-2.5 h-2.5" />
        </Badge>
      </span>
    );
  }
  if (source === "engineering") {
    return (
      <Badge className="bg-purple-50 text-purple-700 text-[9px] px-1 py-0 border-purple-200" data-testid="badge-source-eng">
        <Wrench className="w-2.5 h-2.5 mr-0.5" />Eng
      </Badge>
    );
  }
  return null;
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function LifecycleBoardPage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [excelRes, engRes] = await Promise.all([
          fetch("/api/project-info", { credentials: "include" }),
          fetch("/api/eng/tasks", { credentials: "include", headers: getAuthHeaders() }),
        ]);

        const excelProjects: any[] = excelRes.ok ? await excelRes.json() : [];
        const engTasks: EngTask[] = engRes.ok ? await engRes.json() : [];

        const merged: ProjectInfo[] = [];
        const nameMap = new Map<string, ProjectInfo>();

        for (const p of excelProjects) {
          const normalized = normalizeNameForMatch(p.projectName);
          const proj: ProjectInfo = {
            id: p.id,
            projectName: p.projectName,
            sizeKwp: p.sizeKwp,
            pd: p.pd,
            pm: p.pm,
            contractValue: p.contractValue,
            phase: p.phase,
            isActive: p.isActive !== false,
            ragStatus: p.ragStatus,
            source: "excel",
            engTaskCount: 0,
          };
          nameMap.set(normalized, proj);
          merged.push(proj);
        }

        for (const t of engTasks) {
          if (!t.projectName) continue;
          const normalized = normalizeNameForMatch(t.projectName);

          const existing = nameMap.get(normalized);
          if (existing) {
            existing.source = "both";
            existing.engTaskCount = (existing.engTaskCount || 0) + 1;
            if (!existing.ragStatus && t.trackingRag) {
              existing.ragStatus = t.trackingRag;
            }
          } else {
            let found = false;
            const entries = Array.from(nameMap.entries());
            for (let i = 0; i < entries.length; i++) {
              const [key, val] = entries[i];
              if (key.includes(normalized) || normalized.includes(key)) {
                val.source = "both";
                val.engTaskCount = (val.engTaskCount || 0) + 1;
                if (!val.ragStatus && t.trackingRag) {
                  val.ragStatus = t.trackingRag;
                }
                found = true;
                break;
              }
            }

            if (!found) {
              const newProj: ProjectInfo = {
                id: -t.id,
                projectName: t.projectName,
                sizeKwp: null,
                pd: null,
                pm: null,
                contractValue: null,
                phase: t.phase,
                isActive: true,
                ragStatus: t.trackingRag,
                source: "engineering",
                engTaskCount: 1,
                engStatus: t.status,
              };
              nameMap.set(normalized, newProj);
              merged.push(newProj);
            }
          }
        }

        setProjects(merged);
      } catch {
        setProjects([]);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

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
    const key = mapPhaseToGroup(p.phase);
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

  const excelCount = projects.filter(p => p.source === "excel" || p.source === "both").length;
  const engOnlyCount = projects.filter(p => p.source === "engineering").length;

  return (
    <div className="space-y-4" data-testid="lifecycle-board-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-lifecycle-title">Lifecycle Board</h1>
        <p className="text-muted-foreground text-sm">
          All projects grouped by lifecycle phase
          <span className="ml-2 text-xs">
            ({excelCount} from Excel{engOnlyCount > 0 ? `, ${engOnlyCount} from Engineering` : ""})
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

      <div className="overflow-x-auto pb-4 -mx-3 px-3 sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
        <div className="flex gap-3 min-w-max">
          {PHASE_GROUPS.map((group) => {
            const items = grouped[group.key] || [];
            return (
              <div
                key={group.key}
                className={`w-[260px] shrink-0 rounded-lg border ${group.color} flex flex-col`}
                data-testid={`column-${group.key}`}
              >
                <div className={`${group.headerBg} text-white rounded-t-lg px-3 py-2.5 flex items-center justify-between`}>
                  <span className="font-semibold text-sm">{group.label}</span>
                  <Badge variant="secondary" className="bg-white/20 text-white text-xs" data-testid={`badge-count-${group.key}`}>
                    {items.length}
                  </Badge>
                </div>
                <div className="p-2 space-y-2 flex-1 max-h-[calc(100vh-280px)] overflow-y-auto">
                  {items.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No projects</p>
                  )}
                  {items.map((p) => (
                    <Card
                      key={p.id}
                      className="shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                      data-testid={`card-project-${p.id}`}
                    >
                      <CardContent className="p-3 space-y-1.5">
                        <div className="flex items-start justify-between gap-1">
                          <div className="font-medium text-sm leading-tight" data-testid={`text-project-name-${p.id}`}>
                            {cleanProjectName(p.projectName)}
                          </div>
                          {sourceBadge(p.source)}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {p.sizeKwp && parseFloat(p.sizeKwp) > 0 && (
                            <span className="text-[11px] text-muted-foreground flex items-center gap-0.5" data-testid={`text-size-${p.id}`}>
                              <Zap className="w-3 h-3" />
                              {parseFloat(p.sizeKwp).toFixed(0)} kWp
                            </span>
                          )}
                          {ragBadge(p.ragStatus)}
                          {p.engTaskCount && p.engTaskCount > 0 && (
                            <span className="text-[10px] text-purple-600" data-testid={`text-eng-tasks-${p.id}`}>
                              {p.engTaskCount} eng task{p.engTaskCount > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        {formatZAR(p.contractValue) && (
                          <div className="text-xs text-muted-foreground" data-testid={`text-value-${p.id}`}>
                            {formatZAR(p.contractValue)}
                          </div>
                        )}
                        {p.pm && (
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1" data-testid={`text-pm-${p.id}`}>
                            <User className="w-3 h-3" />
                            {p.pm}
                          </div>
                        )}
                        {p.source === "engineering" && p.engStatus && (
                          <div className="text-[10px] text-purple-500" data-testid={`text-eng-status-${p.id}`}>
                            Status: {p.engStatus}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
