import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Zap, AlertCircle, CheckCircle2, FileSpreadsheet, Info } from "lucide-react";

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
  executionEnabled: boolean;
  executionGateStatus: string;
  signedStatus: string;
  executionPhase: string | null;
  archivedStatus: string;
  source: "excel" | "engineering" | "both";
  engTotal: number;
  engDone: number;
  planTotal: number;
  planAvgPct: number;
  projectPctComplete: number | null;
}

function cleanProjectName(name: string): string {
  return name.replace(/_Tracker$/i, "").replace(/_/g, " ");
}

function ragBadge(rag: string | null) {
  if (!rag) return <span className="text-[10px] text-slate-400">—</span>;
  const colors: Record<string, string> = {
    Green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Amber: "bg-amber-50 text-amber-700 border-amber-200",
    Red: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <Badge className={`text-[10px] px-1.5 py-0 ${colors[rag] || "bg-slate-50 text-slate-600 border-slate-200"}`} data-testid={`badge-rag-${rag}`}>
      {rag}
    </Badge>
  );
}

export default function ExecutionBoard() {
  const [allProjects, setAllProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const token = localStorage.getItem("company_role_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/lifecycle-board/projects", { headers });
      if (!res.ok) {
        throw new Error(`Failed to load projects (${res.status})`);
      }
      const data: ProjectInfo[] = await res.json();
      setAllProjects(data);
    } catch (err: any) {
      setError(err.message || "Failed to load projects");
      toast({ title: "Error", description: err.message || "Failed to load projects", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const executionProjects = useMemo(
    () => allProjects.filter(p => p.executionEnabled === true && p.archivedStatus === "ACTIVE"),
    [allProjects]
  );

  const executionPhases = useMemo(() => {
    const phases = new Set<string>();
    executionProjects.forEach(p => {
      if (p.executionPhase) phases.add(p.executionPhase);
    });
    return Array.from(phases).sort();
  }, [executionProjects]);

  const filtered = useMemo(() => {
    return executionProjects.filter(p => {
      if (searchTerm) {
        const clean = cleanProjectName(p.projectName).toLowerCase();
        if (!clean.includes(searchTerm.toLowerCase())) return false;
      }
      if (phaseFilter !== "all") {
        if (phaseFilter === "awaiting") {
          if (p.executionPhase !== null) return false;
        } else {
          if (p.executionPhase !== phaseFilter) return false;
        }
      }
      return true;
    });
  }, [executionProjects, searchTerm, phaseFilter]);

  const avgCompletion = useMemo(() => {
    const withPct = executionProjects.filter(p => p.projectPctComplete !== null);
    if (withPct.length === 0) return 0;
    const sum = withPct.reduce((acc, p) => acc + (p.projectPctComplete || 0), 0);
    return Math.round(sum / withPct.length);
  }, [executionProjects]);

  const withPhaseCount = executionProjects.filter(p => p.executionPhase !== null).length;
  const withoutPhaseCount = executionProjects.filter(p => p.executionPhase === null).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="execution-board-loading">
        <Loader2 className="w-6 h-6 animate-spin text-[#16a34a]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="execution-board-error">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={loadData} className="text-sm text-blue-600 hover:underline" data-testid="btn-retry">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="execution-board-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-execution-title">Execution Board</h1>
        <p className="text-muted-foreground text-sm">Post-signing projects in active execution</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-white rounded-xl shadow-sm" data-testid="stat-total">
          <CardContent className="p-4">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Execution Projects</div>
            <div className="text-2xl font-bold mt-1">{executionProjects.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-white rounded-xl shadow-sm" data-testid="stat-avg-completion">
          <CardContent className="p-4">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Completion</div>
            <div className="text-2xl font-bold mt-1">{avgCompletion}%</div>
          </CardContent>
        </Card>
        <Card className="bg-white rounded-xl shadow-sm" data-testid="stat-with-phase">
          <CardContent className="p-4">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              With Execution Phase
            </div>
            <div className="text-2xl font-bold mt-1">{withPhaseCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-white rounded-xl shadow-sm" data-testid="stat-without-phase">
          <CardContent className="p-4">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <AlertCircle className="w-3 h-3 text-amber-500" />
              Awaiting Phase Import
            </div>
            <div className="text-2xl font-bold mt-1 text-amber-600">{withoutPhaseCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search projects..."
            className="pl-9"
            data-testid="input-search-execution"
          />
        </div>
        <Select value={phaseFilter} onValueChange={setPhaseFilter} data-testid="select-phase-filter">
          <SelectTrigger className="w-[200px]" data-testid="select-trigger-phase-filter">
            <SelectValue placeholder="All phases" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="select-item-all">All Phases</SelectItem>
            <SelectItem value="awaiting" data-testid="select-item-awaiting">Awaiting Import</SelectItem>
            {executionPhases.map(phase => (
              <SelectItem key={phase} value={phase} data-testid={`select-item-${phase}`}>{phase}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground" data-testid="text-filtered-count">
          {filtered.length} project{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {executionProjects.length === 0 ? (
        <Card className="bg-white rounded-xl shadow-sm" data-testid="empty-state">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <FileSpreadsheet className="w-10 h-10 text-slate-300" />
            <p className="text-sm text-muted-foreground text-center max-w-md">
              No projects in execution yet. Projects require signed evidence and admin approval to enter execution.
            </p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="bg-white rounded-xl shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-2">
            <Search className="w-8 h-8 text-slate-300" />
            <p className="text-sm text-muted-foreground">No projects match your filters</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="execution-table">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider sticky left-0 bg-slate-50 z-10 min-w-[160px]">Project Name</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[130px]">Execution Phase</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[110px]">Lifecycle Phase</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[70px]">Size (kWp)</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[80px]">PD</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[80px]">PM</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[90px]">Completion %</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[100px]">Signed Status</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[80px]">RAG Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => {
                  const pct = p.projectPctComplete !== null ? Math.round(p.projectPctComplete) : null;
                  return (
                    <tr
                      key={p.id ?? p.projectName}
                      className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${idx % 2 === 0 ? "" : "bg-slate-25"}`}
                      data-testid={`row-project-${p.id}`}
                    >
                      <td className="px-3 py-2 sticky left-0 bg-white z-10 font-medium text-xs" data-testid={`text-name-${p.id}`}>
                        {cleanProjectName(p.projectName)}
                      </td>
                      <td className="px-3 py-2" data-testid={`text-exec-phase-${p.id}`}>
                        {p.executionPhase ? (
                          <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0">
                            {p.executionPhase}
                          </Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                            <Info className="w-3 h-3" />
                            Awaiting Import
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-600" data-testid={`text-phase-${p.id}`}>
                        {p.phase || "—"}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-600" data-testid={`text-size-${p.id}`}>
                        {p.sizeKwp && parseFloat(p.sizeKwp) > 0 ? (
                          <span className="flex items-center gap-0.5">
                            <Zap className="w-3 h-3 text-amber-500" />
                            {parseFloat(p.sizeKwp).toFixed(0)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-600 truncate max-w-[100px]" data-testid={`text-pd-${p.id}`}>
                        {p.pd || "—"}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-600 truncate max-w-[100px]" data-testid={`text-pm-${p.id}`}>
                        {p.pm || "—"}
                      </td>
                      <td className="px-3 py-2" data-testid={`text-completion-${p.id}`}>
                        {pct !== null ? (
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden min-w-[40px] max-w-[60px]">
                              <div
                                className={`h-full rounded-full ${pct >= 90 ? "bg-emerald-500" : pct >= 60 ? "bg-blue-500" : pct >= 30 ? "bg-amber-500" : "bg-slate-400"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-600 w-[28px] text-right">{pct}%</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2" data-testid={`text-signed-${p.id}`}>
                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">
                          <CheckCircle2 className="w-3 h-3 mr-0.5" />
                          {p.signedStatus || "Signed"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2" data-testid={`text-rag-${p.id}`}>
                        {ragBadge(p.ragStatus)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}