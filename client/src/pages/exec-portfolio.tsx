import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, AlertTriangle, CheckCircle, ArrowRight, Eye, Clock,
  ChevronDown, ChevronRight, Search, Plus, Zap, Shield, BarChart3
} from "lucide-react";
import { useLocation } from "wouter";

interface PortfolioProject {
  id: number;
  projectName: string;
  rawProjectName: string;
  phase: string;
  phaseLabel: string;
  phaseAge: number | null;
  contractValue: number | null;
  sizeKwp: number | null;
  pd: string | null;
  pm: string | null;
  ragStatus: string | null;
  totalTasks: number;
  completeTasks: number;
  readinessPercent: number | null;
  pendingApprovals: number;
  highWarnings: number;
  medWarnings: number;
  totalWarnings: number;
}

interface ProjectDetail {
  project: any;
  phaseHistory: any[];
  templateApplications: any[];
  openWarnings: any[];
  pendingApprovals: any[];
  taskSummary: { total: number; complete: number; inProgress: number; todo: number };
}

interface PhasePreview {
  hasTemplate: boolean;
  templateId?: number;
  templateName?: string;
  templateVersion?: number;
  items_to_create: any[];
  items_to_skip: any[];
  warnings: string[];
  message?: string;
}

const authFetch = async (url: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as any || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...opts, headers, credentials: "include" });
};

const ragColor = (rag: string | null) => {
  if (!rag) return "bg-gray-100 text-gray-600";
  const r = rag.toUpperCase();
  if (r === "RED") return "bg-red-100 text-red-800";
  if (r === "AMBER" || r === "ORANGE") return "bg-amber-100 text-amber-800";
  if (r === "GREEN") return "bg-green-100 text-green-800";
  return "bg-gray-100 text-gray-600";
};

const phaseColor = (phase: string) => {
  if (phase?.startsWith("P0")) return "bg-slate-100 text-slate-700";
  if (phase?.startsWith("P1")) return "bg-blue-100 text-blue-700";
  if (phase?.startsWith("P2")) return "bg-indigo-100 text-indigo-700";
  if (phase?.startsWith("P3")) return "bg-violet-100 text-violet-700";
  if (phase?.startsWith("P4")) return "bg-orange-100 text-orange-700";
  if (phase?.startsWith("P5")) return "bg-teal-100 text-teal-700";
  if (phase?.startsWith("P6")) return "bg-emerald-100 text-emerald-700";
  if (phase?.startsWith("P7")) return "bg-gray-100 text-gray-700";
  return "bg-gray-100 text-gray-600";
};

export default function ExecPortfolioPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [projects, setProjects] = useState<PortfolioProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [selectedProject, setSelectedProject] = useState<PortfolioProject | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showPhaseDialog, setShowPhaseDialog] = useState(false);
  const [phasePreview, setPhasePreview] = useState<PhasePreview | null>(null);
  const [phaseForm, setPhaseForm] = useState({ toPhase: "", reason: "" });
  const [phaseChanging, setPhaseChanging] = useState(false);
  const [constants, setConstants] = useState<{ projectPhases: string[]; projectPhaseLabels: Record<string, string> } | null>(null);

  const loadPortfolio = useCallback(async () => {
    try {
      const [pRes, cRes] = await Promise.all([
        authFetch("/api/exec/portfolio"),
        authFetch("/api/template-constants"),
      ]);
      if (pRes.ok) setProjects(await pRes.json());
      if (cRes.ok) setConstants(await cRes.json());
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPortfolio(); }, [loadPortfolio]);

  const loadDetail = async (p: PortfolioProject) => {
    setSelectedProject(p);
    setDetailLoading(true);
    try {
      const res = await authFetch(`/api/exec/portfolio/${p.id}`);
      if (res.ok) setDetail(await res.json());
    } catch { } finally { setDetailLoading(false); }
  };

  const openPhaseChange = async (p: PortfolioProject) => {
    setSelectedProject(p);
    setPhaseForm({ toPhase: "", reason: "" });
    setPhasePreview(null);
    setShowPhaseDialog(true);
  };

  const loadPhasePreview = async () => {
    if (!selectedProject || !phaseForm.toPhase) return;
    const res = await authFetch(`/api/projects/${selectedProject.id}/phase-preview`, {
      method: "POST", body: JSON.stringify({ toPhase: phaseForm.toPhase }),
    });
    if (res.ok) setPhasePreview(await res.json());
  };

  useEffect(() => {
    if (phaseForm.toPhase && selectedProject) loadPhasePreview();
  }, [phaseForm.toPhase]);

  const executePhaseChange = async () => {
    if (!selectedProject || !phaseForm.toPhase || !phaseForm.reason.trim()) return;
    setPhaseChanging(true);
    try {
      const res = await authFetch(`/api/projects/${selectedProject.id}/phase`, {
        method: "PATCH",
        body: JSON.stringify({ toPhase: phaseForm.toPhase, reason: phaseForm.reason.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Phase changed", description: `Moved to ${data.phaseLabel}. ${data.tasksCreated || 0} tasks created.` });
        setShowPhaseDialog(false);
        loadPortfolio();
        if (detail) loadDetail(selectedProject);
      } else {
        toast({ title: "Error", description: data.error || data.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setPhaseChanging(false);
  };

  if (!isAdmin) return <div className="p-8 text-center text-muted-foreground">Admin access required</div>;

  const phaseLabels = constants?.projectPhaseLabels || {};
  const phases = constants?.projectPhases || [];

  const filtered = projects.filter(p => {
    if (searchTerm && !p.projectName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (phaseFilter !== "all" && p.phase !== phaseFilter) return false;
    return true;
  });

  const totalValue = filtered.reduce((s, p) => s + (p.contractValue || 0), 0);
  const totalKwp = filtered.reduce((s, p) => s + (p.sizeKwp || 0), 0);
  const avgReadiness = filtered.filter(p => p.readinessPercent != null).reduce((s, p) => s + (p.readinessPercent || 0), 0) / (filtered.filter(p => p.readinessPercent != null).length || 1);
  const totalHighWarns = filtered.reduce((s, p) => s + p.highWarnings, 0);

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6" data-testid="exec-portfolio-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-portfolio-title">Executive Portfolio Board</h1>
          <p className="text-muted-foreground">Project-centric lifecycle view with phase management and readiness tracking</p>
        </div>
        <Button onClick={() => setLocation("/project-create")} data-testid="button-new-project">
          <Plus className="w-4 h-4 mr-2" /> New Project
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold" data-testid="text-total-projects">{filtered.length}</div>
            <div className="text-xs text-muted-foreground">Active Projects</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold" data-testid="text-total-value">R{(totalValue / 1_000_000).toFixed(1)}M</div>
            <div className="text-xs text-muted-foreground">Portfolio Value</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold" data-testid="text-total-kwp">{(totalKwp / 1000).toFixed(1)} MWp</div>
            <div className="text-xs text-muted-foreground">Total Capacity</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold" data-testid="text-high-warnings">{totalHighWarns}</div>
              {totalHighWarns > 0 && <AlertTriangle className="w-5 h-5 text-red-500" />}
            </div>
            <div className="text-xs text-muted-foreground">High Warnings</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search projects..." className="pl-9" data-testid="input-search-projects" />
        </div>
        <Select value={phaseFilter} onValueChange={setPhaseFilter}>
          <SelectTrigger className="w-48" data-testid="select-phase-filter"><SelectValue placeholder="All phases" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Phases</SelectItem>
            {phases.map((p) => <SelectItem key={p} value={p}>{phaseLabels[p] || p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8">
            <div className="space-y-3">
              {filtered.map((p) => (
                <Card key={p.id} className={`hover:shadow-md transition-shadow cursor-pointer ${selectedProject?.id === p.id ? "ring-2 ring-primary" : ""}`} data-testid={`card-project-${p.id}`}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="min-w-0 flex-1" onClick={() => loadDetail(p)}>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold truncate" data-testid={`text-project-name-${p.id}`}>{p.projectName}</span>
                            <Badge className={phaseColor(p.phase)} data-testid={`badge-phase-${p.id}`}>{p.phaseLabel}</Badge>
                            {p.ragStatus && <Badge className={ragColor(p.ragStatus)}>{p.ragStatus}</Badge>}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            {p.pm && <span>PM: {p.pm}</span>}
                            {p.sizeKwp && <span>{p.sizeKwp} kWp</span>}
                            {p.phaseAge != null && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {p.phaseAge}d in phase
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {p.readinessPercent != null && (
                          <div className="w-20 text-center">
                            <div className="text-xs font-semibold">{p.readinessPercent}%</div>
                            <Progress value={p.readinessPercent} className="h-1.5" />
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-xs">
                          {p.highWarnings > 0 && <Badge variant="destructive" className="text-xs px-1.5">{p.highWarnings} High</Badge>}
                          {p.pendingApprovals > 0 && <Badge variant="outline" className="text-xs px-1.5">{p.pendingApprovals} Approvals</Badge>}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => openPhaseChange(p)} data-testid={`button-phase-change-${p.id}`}>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filtered.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">No projects match your filters</div>
              )}
            </div>
          </div>

          <div className="col-span-4">
            {detailLoading ? (
              <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
            ) : detail ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{detail.project.cleanName}</CardTitle>
                    <CardDescription>
                      <Badge className={phaseColor(detail.project.phase)}>{detail.project.phaseLabel}</Badge>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="border rounded p-2">
                        <div className="font-bold text-sm">{detail.taskSummary.complete}</div>
                        <div className="text-xs text-muted-foreground">Done</div>
                      </div>
                      <div className="border rounded p-2">
                        <div className="font-bold text-sm">{detail.taskSummary.inProgress}</div>
                        <div className="text-xs text-muted-foreground">In Progress</div>
                      </div>
                      <div className="border rounded p-2">
                        <div className="font-bold text-sm">{detail.taskSummary.todo}</div>
                        <div className="text-xs text-muted-foreground">To Do</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {detail.openWarnings.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" /> Open Warnings ({detail.openWarnings.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      {detail.openWarnings.slice(0, 5).map((w: any) => (
                        <div key={w.id} className="text-xs border rounded px-2 py-1 flex items-center gap-2">
                          <Badge variant={w.severity === "High" ? "destructive" : "secondary"} className="text-xs px-1">{w.severity}</Badge>
                          <span className="truncate">{w.title}</span>
                        </div>
                      ))}
                      {detail.openWarnings.length > 5 && (
                        <p className="text-xs text-muted-foreground">+{detail.openWarnings.length - 5} more</p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {detail.pendingApprovals.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Shield className="w-4 h-4 text-blue-500" /> Pending Approvals ({detail.pendingApprovals.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      {detail.pendingApprovals.slice(0, 5).map((t: any) => (
                        <div key={t.id} className="text-xs border rounded px-2 py-1 truncate">{t.title}</div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Clock className="w-4 h-4" /> Phase History
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {detail.phaseHistory.slice(0, 8).map((h: any) => (
                      <div key={h.id} className="text-xs border rounded px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          {h.fromPhase && <Badge variant="outline" className="text-xs px-1">{phaseLabels[h.fromPhase] || h.fromPhase}</Badge>}
                          <ArrowRight className="w-3 h-3" />
                          <Badge className={`text-xs px-1 ${phaseColor(h.toPhase)}`}>{phaseLabels[h.toPhase] || h.toPhase}</Badge>
                        </div>
                        <div className="text-muted-foreground mt-0.5">{h.changedByName} &middot; {new Date(h.changedAt).toLocaleDateString()}</div>
                        {h.reason && <div className="italic mt-0.5">{h.reason}</div>}
                      </div>
                    ))}
                    {detail.phaseHistory.length === 0 && <p className="text-xs text-muted-foreground">No phase changes yet</p>}
                  </CardContent>
                </Card>

                {detail.templateApplications.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Zap className="w-4 h-4" /> Template Applications
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      {detail.templateApplications.map((a: any) => (
                        <div key={a.id} className="text-xs border rounded px-2 py-1.5">
                          <div className="font-medium">{a.templateName} v{a.templateVersion}</div>
                          <div className="text-muted-foreground">{phaseLabels[a.phase] || a.phase} &middot; {new Date(a.appliedAt).toLocaleDateString()}</div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Click a project to view details</CardContent></Card>
            )}
          </div>
        </div>
      )}

      <Dialog open={showPhaseDialog} onOpenChange={setShowPhaseDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Change Phase: {selectedProject?.projectName}</DialogTitle>
            <DialogDescription>
              Current phase: <Badge className={phaseColor(selectedProject?.phase || "")}>{selectedProject?.phaseLabel}</Badge>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Target Phase</label>
              <Select value={phaseForm.toPhase} onValueChange={(v) => setPhaseForm(f => ({ ...f, toPhase: v }))}>
                <SelectTrigger data-testid="select-target-phase"><SelectValue placeholder="Select phase" /></SelectTrigger>
                <SelectContent>
                  {phases.filter(p => p !== selectedProject?.phase).map((p) => (
                    <SelectItem key={p} value={p}>{phaseLabels[p] || p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {phasePreview && (
              <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                {phasePreview.hasTemplate ? (
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Zap className="w-4 h-4 text-amber-500" /> Template: {phasePreview.templateName} v{phasePreview.templateVersion}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {phasePreview.items_to_create.length} items will be created, {phasePreview.items_to_skip.length} will be skipped
                    </div>
                    {phasePreview.warnings.length > 0 && (
                      <div className="text-xs text-amber-600">{phasePreview.warnings.join("; ")}</div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {phasePreview.message}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Reason for Phase Change *</label>
              <Textarea
                value={phaseForm.reason}
                onChange={(e) => setPhaseForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Explain why this project is advancing..."
                rows={3}
                data-testid="input-phase-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPhaseDialog(false)}>Cancel</Button>
            <Button
              onClick={executePhaseChange}
              disabled={phaseChanging || !phaseForm.toPhase || !phaseForm.reason.trim()}
              data-testid="button-confirm-phase-change"
            >
              {phaseChanging ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
              Change Phase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
