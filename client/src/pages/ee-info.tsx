import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Search, Network, FileText, GitBranch, ChevronRight, ChevronDown, ArrowRight, ArrowLeft,
  Edit2, Save, X, Plus, Trash2, Loader2, BookOpen, Users, Wrench,
  FileCheck, HelpCircle, RefreshCw, Shield, Zap, GraduationCap,
  Clock, ExternalLink, CheckCircle2, CircleDot, Lightbulb,
  Building2, Factory, Layers, ChevronUp, MapPin, Target, AlertCircle,
  Briefcase, Scale, Cog, HardHat, Truck, UserCheck, ClipboardList,
  FolderOpen, Link2, Hash, Play, CircleDot as StepIcon,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import CompanyOverviewMap from "@/components/CompanyOverviewMap";
import { WALKTHROUGHS, WALKTHROUGH_CATEGORIES, type Walkthrough } from "@/data/walkthroughs";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...opts,
    credentials: "include",
    headers: { ...authHeaders(), ...(opts.headers || {}) },
  });
}

const DEPT_ICONS: Record<string, React.ReactNode> = {
  "os-dept-exco": <Target className="h-4 w-4" />,
  "os-dept-engineering": <Wrench className="h-4 w-4" />,
  "os-dept-finance": <Scale className="h-4 w-4" />,
  "os-dept-project-management": <HardHat className="h-4 w-4" />,
  "os-dept-project-development": <Briefcase className="h-4 w-4" />,
  "os-dept-quality": <ClipboardList className="h-4 w-4" />,
  "os-dept-operations": <Cog className="h-4 w-4" />,
  "os-dept-sales": <Briefcase className="h-4 w-4" />,
  "os-dept-procurement": <Truck className="h-4 w-4" />,
  "os-dept-legal": <Shield className="h-4 w-4" />,
  "os-dept-hr": <Users className="h-4 w-4" />,
  "os-dept-project-delivery": <HardHat className="h-4 w-4" />,
  "os-dept-om": <Factory className="h-4 w-4" />,
};

const DEPT_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  "os-dept-exco": { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700", badge: "bg-indigo-100 text-indigo-700" },
  "os-dept-engineering": { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", badge: "bg-orange-100 text-orange-700" },
  "os-dept-finance": { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-700" },
  "os-dept-project-management": { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", badge: "bg-amber-100 text-amber-700" },
  "os-dept-project-development": { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", badge: "bg-blue-100 text-blue-700" },
  "os-dept-quality": { bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-700", badge: "bg-cyan-100 text-cyan-700" },
  "os-dept-operations": { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-700", badge: "bg-slate-100 text-slate-700" },
  "os-dept-sales": { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", badge: "bg-blue-100 text-blue-700" },
  "os-dept-procurement": { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700", badge: "bg-violet-100 text-violet-700" },
  "os-dept-legal": { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", badge: "bg-red-100 text-red-700" },
  "os-dept-hr": { bg: "bg-pink-50", border: "border-pink-200", text: "text-pink-700", badge: "bg-pink-100 text-pink-700" },
  "os-dept-project-delivery": { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", badge: "bg-amber-100 text-amber-700" },
  "os-dept-om": { bg: "bg-teal-50", border: "border-teal-200", text: "text-teal-700", badge: "bg-teal-100 text-teal-700" },
};

const STAGE_COLORS = [
  "from-blue-500 to-blue-600",
  "from-indigo-500 to-indigo-600",
  "from-violet-500 to-violet-600",
  "from-amber-500 to-amber-600",
  "from-emerald-500 to-emerald-600",
  "from-cyan-500 to-cyan-600",
  "from-rose-500 to-rose-600",
];

interface OsProcess {
  id: string;
  slug: string;
  title: string;
  status: string;
  departmentSlug: string | null;
}

interface OsDepartment {
  id: string;
  slug: string;
  title: string;
}

interface OsStage {
  id: string;
  slug: string;
  title: string;
  contentMarkdown?: string;
  sortOrder: number;
  processes: OsProcess[];
  departments: OsDepartment[];
}

interface DeptDetail {
  department: any;
  stageGroups: { stage: { id: string; slug: string; title: string }; processes: any[] }[];
  edges: any[];
  totalProcesses: number;
}

interface ProcessDetail {
  process: any;
  steps: any[];
  department: any;
  lifecycleStages: any[];
  edges: any[];
  relatedProcesses: any[];
}

function LifecycleOverview({
  onSelectDepartment,
  onSelectProcess,
  isCOO,
}: {
  onSelectDepartment: (slug: string) => void;
  onSelectProcess: (slug: string) => void;
  isCOO: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<{ stages: OsStage[]; allDepartments: OsDepartment[]; totalProcesses: number }>({
    queryKey: ["ee-info-os-lifecycle"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/os/lifecycle");
      if (!res.ok) throw new Error("Failed to fetch lifecycle");
      return res.json();
    },
  });

  const { data: allDepts = [] } = useQuery<any[]>({
    queryKey: ["ee-info-os-departments"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/os/departments");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/ee-info/os/seed", { method: "POST" });
      if (!res.ok) throw new Error("Failed to seed");
      return res.json();
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-os-lifecycle"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-os-departments"] });
      toast({ title: "OS Data Seeded", description: `Created ${d.created?.length || 0} nodes, mapped ${d.processNodesMapped || 0} processes.` });
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const stages = data?.stages || [];
  const departments = data?.allDepartments || [];

  if (stages.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-16 text-center">
          <Network className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Operating System Data</h3>
          <p className="text-sm text-muted-foreground mb-4">Seed the lifecycle stages and departments to get started.</p>
          {isCOO && (
            <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="btn-seed-os">
              {seedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              Seed OS Data
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const filteredStages = stages.map(stage => {
    let procs = stage.processes;
    if (deptFilter !== "all") procs = procs.filter(p => p.departmentSlug === deptFilter);
    if (statusFilter !== "all") procs = procs.filter(p => statusFilter === "active" ? p.status === "published" : p.status !== "published");
    return { ...stage, processes: procs };
  });

  const toggleDept = (slug: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const allProcessCount = stages.reduce((sum, s) => sum + s.processes.length, 0);

  return (
    <div className="space-y-6" data-testid="os-lifecycle">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-lg">
            <Layers className="h-4 w-4 text-slate-600" />
            <span className="font-semibold">{stages.length}</span>
            <span className="text-muted-foreground">Stages</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-lg">
            <Building2 className="h-4 w-4 text-slate-600" />
            <span className="font-semibold">{departments.length}</span>
            <span className="text-muted-foreground">Departments</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-lg">
            <GitBranch className="h-4 w-4 text-slate-600" />
            <span className="font-semibold">{data?.totalProcesses || 0}</span>
            <span className="text-muted-foreground">Processes</span>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-8 text-xs w-[160px]" data-testid="filter-dept">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map(d => (
                <SelectItem key={d.slug} value={d.slug}>{d.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs w-[120px]" data-testid="filter-status">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
          {isCOO && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="btn-reseed">
              <RefreshCw className="h-3.5 w-3.5" /> Re-seed
            </Button>
          )}
        </div>
      </div>

      <div className="relative">
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-400 via-violet-400 to-emerald-400 hidden md:block" />

        <div className="space-y-4">
          {filteredStages.map((stage, idx) => {
            const isSelected = selectedStage === stage.slug;
            const deptSlugsInStage = [...new Set(stage.processes.map(p => p.departmentSlug).filter(Boolean))] as string[];
            const stageColor = STAGE_COLORS[idx % STAGE_COLORS.length];

            return (
              <div key={stage.slug} className="relative" data-testid={`stage-${stage.slug}`}>
                <div className="hidden md:block absolute left-4 top-6 w-4 h-4 rounded-full bg-white border-2 border-slate-300 z-10" />

                <div className="md:ml-14">
                  <button
                    className={`w-full text-left transition-all rounded-xl border ${isSelected ? "border-slate-300 shadow-md bg-white" : "border-slate-200 bg-white/80 hover:bg-white hover:shadow-sm"}`}
                    onClick={() => setSelectedStage(isSelected ? null : stage.slug)}
                    data-testid={`stage-toggle-${stage.slug}`}
                  >
                    <div className="px-5 py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${stageColor} flex items-center justify-center text-white font-bold text-sm shadow-sm`}>
                            P{idx}
                          </div>
                          <div>
                            <h3 className="font-semibold text-sm">{stage.title}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {stage.processes.length} process{stage.processes.length !== 1 ? "es" : ""} · {deptSlugsInStage.length} department{deptSlugsInStage.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="hidden sm:flex gap-1">
                            {deptSlugsInStage.slice(0, 5).map(ds => {
                              const colors = DEPT_COLORS[ds] || DEPT_COLORS["os-dept-operations"];
                              const dept = departments.find(d => d.slug === ds);
                              return (
                                <TooltipProvider key={ds}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        className={`p-1.5 rounded-md ${colors.bg} ${colors.border} border transition-colors hover:shadow-sm`}
                                        onClick={(e) => { e.stopPropagation(); onSelectDepartment(ds); }}
                                        data-testid={`stage-dept-${ds}`}
                                      >
                                        {DEPT_ICONS[ds] || <Building2 className="h-3.5 w-3.5" />}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent><p className="text-xs">{dept?.title || ds}</p></TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              );
                            })}
                            {deptSlugsInStage.length > 5 && (
                              <span className="text-xs text-muted-foreground self-center">+{deptSlugsInStage.length - 5}</span>
                            )}
                          </div>
                          {isSelected ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </div>
                    </div>
                  </button>

                  {isSelected && (
                    <div className="mt-1 border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
                      {deptSlugsInStage.length === 0 && stage.processes.length === 0 ? (
                        <div className="px-5 py-8 text-center text-sm text-muted-foreground">No processes in this stage yet.</div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {deptSlugsInStage.map(ds => {
                            const dept = departments.find(d => d.slug === ds);
                            const deptProcs = stage.processes.filter(p => p.departmentSlug === ds);
                            const colors = DEPT_COLORS[ds] || DEPT_COLORS["os-dept-operations"];
                            const isExpanded = expandedDepts.has(`${stage.slug}-${ds}`);

                            return (
                              <div key={ds}>
                                <button
                                  className={`w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors`}
                                  onClick={() => toggleDept(`${stage.slug}-${ds}`)}
                                  data-testid={`expand-dept-${ds}`}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <div className={`p-1.5 rounded-md ${colors.bg} ${colors.text}`}>
                                      {DEPT_ICONS[ds] || <Building2 className="h-4 w-4" />}
                                    </div>
                                    <span className="text-sm font-medium">{dept?.title || ds}</span>
                                    <Badge variant="outline" className="text-[10px]">{deptProcs.length}</Badge>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs gap-1 text-blue-600"
                                      onClick={(e) => { e.stopPropagation(); onSelectDepartment(ds); }}
                                      data-testid={`goto-dept-${ds}`}
                                    >
                                      View All <ArrowRight className="h-3 w-3" />
                                    </Button>
                                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                                  </div>
                                </button>
                                {isExpanded && (
                                  <div className="px-5 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {deptProcs.map(proc => (
                                      <button
                                        key={proc.id}
                                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all text-left group"
                                        onClick={() => onSelectProcess(proc.slug)}
                                        data-testid={`process-card-${proc.slug}`}
                                      >
                                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        <span className="text-xs font-medium truncate group-hover:text-blue-600 transition-colors">{proc.title}</span>
                                        <Badge variant="outline" className={`text-[9px] ml-auto shrink-0 ${proc.status === "published" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                                          {proc.status === "published" ? "Active" : "Draft"}
                                        </Badge>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {stage.processes.filter(p => !p.departmentSlug).length > 0 && (
                            <div className="px-5 py-3">
                              <p className="text-xs text-muted-foreground mb-2">Unassigned</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {stage.processes.filter(p => !p.departmentSlug).map(proc => (
                                  <button
                                    key={proc.id}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all text-left"
                                    onClick={() => onSelectProcess(proc.slug)}
                                    data-testid={`process-card-${proc.slug}`}
                                  >
                                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-xs font-medium truncate">{proc.title}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4" /> Departments
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {allDepts.map((dept: any) => {
            const colors = DEPT_COLORS[dept.slug] || DEPT_COLORS["os-dept-operations"];
            const subs = dept.subDepartments || [];
            const isExpanded = expandedDepts.has(`main-${dept.slug}`);
            return (
              <div key={dept.slug} className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden transition-all hover:shadow-md`}>
                <button
                  className="w-full flex items-center gap-3 p-4 text-left group"
                  onClick={() => onSelectDepartment(dept.slug)}
                  data-testid={`dept-card-${dept.slug}`}
                >
                  <div className={`p-2.5 rounded-lg bg-white shadow-sm ${colors.text} group-hover:scale-110 transition-transform`}>
                    {DEPT_ICONS[dept.slug] || <Building2 className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold block">{dept.title}</span>
                    <span className="text-[10px] text-muted-foreground">{dept.processCount || 0} processes</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                {subs.length > 0 && (
                  <div className="border-t border-dashed px-4 pb-3 pt-2" style={{ borderColor: "inherit" }}>
                    <button
                      className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1 hover:text-foreground transition-colors"
                      onClick={() => toggleDept(`main-${dept.slug}`)}
                      data-testid={`toggle-subs-${dept.slug}`}
                    >
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {subs.length} sub-department{subs.length > 1 ? "s" : ""}
                    </button>
                    {isExpanded && (
                      <div className="space-y-1">
                        {subs.map((sub: any) => {
                          const subColors = DEPT_COLORS[sub.slug] || colors;
                          return (
                            <button
                              key={sub.slug}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/60 border border-white hover:bg-white hover:shadow-sm transition-all text-left"
                              onClick={() => onSelectDepartment(sub.slug)}
                              data-testid={`sub-dept-${sub.slug}`}
                            >
                              <div className={`${subColors.text}`}>
                                {DEPT_ICONS[sub.slug] || <Building2 className="h-3 w-3" />}
                              </div>
                              <span className="text-xs font-medium flex-1">{sub.title}</span>
                              <Badge variant="outline" className="text-[8px]">{sub.processCount || 0}</Badge>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DepartmentDrilldown({
  slug,
  onBack,
  onSelectProcess,
  isCOO,
}: {
  slug: string;
  onBack: () => void;
  onSelectProcess: (slug: string) => void;
  isCOO: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProcessTitle, setNewProcessTitle] = useState("");
  const [newProcessStages, setNewProcessStages] = useState<string[]>([]);

  const { data, isLoading } = useQuery<DeptDetail>({
    queryKey: ["ee-info-os-dept", slug],
    queryFn: async () => {
      const res = await authFetch(`/api/ee-info/os/departments/${slug}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/ee-info/os/processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newProcessTitle, departmentSlug: slug, lifecycleStages: newProcessStages }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-os-dept", slug] });
      setShowCreateDialog(false);
      setNewProcessTitle("");
      setNewProcessStages([]);
      toast({ title: "Process Created", description: "New process shell has been created." });
    },
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-12 text-muted-foreground">Department not found</div>;

  const dept = data.department;
  const colors = DEPT_COLORS[slug] || DEPT_COLORS["os-dept-operations"];
  const allProcesses = data.stageGroups.flatMap(sg => sg.processes);
  const uniqueProcesses = Array.from(new Map(allProcesses.map(p => [p.id, p])).values());
  const activeCount = uniqueProcesses.filter(p => p.status === "published").length;

  const filteredGroups = data.stageGroups
    .filter(sg => stageFilter === "all" || sg.stage.slug === stageFilter)
    .map(sg => ({
      ...sg,
      processes: sg.processes.filter(p => {
        if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
        if (statusFilter === "active" && p.status !== "published") return false;
        if (statusFilter === "draft" && p.status === "published") return false;
        return true;
      }),
    }))
    .filter(sg => sg.processes.length > 0);

  return (
    <div className="space-y-5" data-testid="dept-drilldown">
      <div className="flex items-center gap-2 text-sm">
        <button className="text-blue-600 hover:underline flex items-center gap-1" onClick={onBack} data-testid="breadcrumb-os">
          <ArrowLeft className="h-3.5 w-3.5" /> Operating System
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{dept.title}</span>
      </div>

      <Card className={`${colors.bg} ${colors.border} border`}>
        <CardContent className="py-5 px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl bg-white shadow-sm ${colors.text}`}>
                {DEPT_ICONS[slug] || <Building2 className="h-6 w-6" />}
              </div>
              <div>
                <h2 className="text-lg font-bold">{dept.title}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{dept.contentMarkdown?.replace(/^#.*\n+/, "").slice(0, 120) || "Department overview"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-center px-3">
                <p className="text-lg font-bold">{data.totalProcesses}</p>
                <p className="text-[10px] text-muted-foreground">Total</p>
              </div>
              <div className="text-center px-3 border-l">
                <p className="text-lg font-bold text-green-600">{activeCount}</p>
                <p className="text-[10px] text-muted-foreground">Active</p>
              </div>
              <div className="text-center px-3 border-l">
                <p className="text-lg font-bold text-amber-600">{data.totalProcesses - activeCount}</p>
                <p className="text-[10px] text-muted-foreground">Draft</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search processes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-8 text-xs"
            data-testid="dept-search"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="h-8 text-xs w-[180px]" data-testid="dept-stage-filter">
            <SelectValue placeholder="All Stages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {data.stageGroups.map(sg => (
              <SelectItem key={sg.stage.slug} value={sg.stage.slug}>{sg.stage.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-[120px]" data-testid="dept-status-filter">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
        {isCOO && (
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowCreateDialog(true)} data-testid="btn-create-process">
            <Plus className="h-3.5 w-3.5" /> New Process
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {filteredGroups.map(sg => (
          <div key={sg.stage.slug} data-testid={`stage-group-${sg.stage.slug}`}>
            <div className="flex items-center gap-2 mb-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{sg.stage.title}</h3>
              <Badge variant="outline" className="text-[10px]">{sg.processes.length}</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {sg.processes.map((proc: any) => (
                <button
                  key={proc.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 transition-all text-left group"
                  onClick={() => onSelectProcess(proc.slug)}
                  data-testid={`process-${proc.slug}`}
                >
                  <GitBranch className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium group-hover:text-blue-600 transition-colors truncate">{proc.title}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge variant="outline" className={`text-[9px] ${proc.status === "published" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                        {proc.status === "published" ? "Active" : "Draft"}
                      </Badge>
                      {proc.tags?.length > 0 && (
                        <span className="text-[9px] text-muted-foreground">{proc.tags.slice(0, 2).join(", ")}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        ))}
        {filteredGroups.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">No processes match your filters.</div>
        )}
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Process Shell</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Process title"
              value={newProcessTitle}
              onChange={e => setNewProcessTitle(e.target.value)}
              data-testid="input-new-process"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!newProcessTitle || createMutation.isPending} data-testid="btn-save-process">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProcessDetailView({
  slug,
  onBack,
  onSelectDepartment,
  onSelectProcess,
  isCOO,
}: {
  slug: string;
  onBack: () => void;
  onSelectDepartment: (slug: string) => void;
  onSelectProcess: (slug: string) => void;
  isCOO: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editPurpose, setEditPurpose] = useState("");
  const [editTriggers, setEditTriggers] = useState("");
  const [editInputs, setEditInputs] = useState("");
  const [editOutputs, setEditOutputs] = useState("");
  const [editReview, setEditReview] = useState("");

  const { data, isLoading } = useQuery<ProcessDetail>({
    queryKey: ["ee-info-os-process", slug],
    queryFn: async () => {
      const res = await authFetch(`/api/ee-info/os/processes/${slug}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createSopMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/ee-info/os/processes/${slug}/sop`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-os-process", slug] });
      toast({ title: "SOP Shell Created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      const res = await authFetch(`/api/ee-info/os/nodes/${data?.process.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-os-process", slug] });
      setIsEditing(false);
      toast({ title: "Process Updated" });
    },
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-12 text-muted-foreground">Process not found</div>;

  const proc = data.process;
  const sop = proc.sopData as any;
  const dept = data.department;
  const steps = data.steps || [];
  const related = data.relatedProcesses || [];
  const lifecycleStages = data.lifecycleStages || [];

  const startEditing = () => {
    setEditPurpose(sop?.purpose || "");
    setEditTriggers(sop?.triggers?.join("\n") || "");
    setEditInputs(sop?.inputs?.join("\n") || "");
    setEditOutputs(sop?.outputs?.join("\n") || "");
    setEditReview(sop?.reviewCadence || "Quarterly");
    setIsEditing(true);
  };

  const saveEdits = () => {
    updateMutation.mutate({
      sopData: {
        ...sop,
        purpose: editPurpose,
        triggers: editTriggers.split("\n").filter(Boolean),
        inputs: editInputs.split("\n").filter(Boolean),
        outputs: editOutputs.split("\n").filter(Boolean),
        reviewCadence: editReview,
      },
    });
  };

  const renderContent = (md: string | null) => {
    if (!md) return null;
    const clean = md.replace(/^#.*\n+/, "");
    if (!clean.trim()) return null;
    return clean.split("\n").map((line, i) => {
      if (line.startsWith("## ")) return <h3 key={i} className="text-sm font-bold mt-4 mb-1">{line.replace("## ", "")}</h3>;
      if (line.startsWith("### ")) return <h4 key={i} className="text-xs font-bold mt-3 mb-1">{line.replace("### ", "")}</h4>;
      if (line.startsWith("- ") || line.startsWith("* ")) return <li key={i} className="text-xs text-slate-600 ml-4 list-disc">{line.replace(/^[-*]\s+/, "")}</li>;
      if (line.startsWith("| ")) return null;
      if (line.trim() === "") return <br key={i} />;
      return <p key={i} className="text-xs text-slate-600">{line}</p>;
    });
  };

  return (
    <div className="space-y-5" data-testid="process-detail">
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <button className="text-blue-600 hover:underline flex items-center gap-1" onClick={onBack} data-testid="breadcrumb-os">
          <ArrowLeft className="h-3.5 w-3.5" /> Operating System
        </button>
        {dept && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <button className="text-blue-600 hover:underline" onClick={() => onSelectDepartment(dept.slug)} data-testid="breadcrumb-dept">
              {dept.title}
            </button>
          </>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{proc.title}</span>
      </div>

      <Card>
        <CardContent className="py-5 px-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold">{proc.title}</h2>
                <Badge variant="outline" className={`text-[10px] ${proc.status === "published" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                  {proc.status === "published" ? "Active" : "Draft"}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {dept && (
                  <Badge variant="outline" className={`text-[10px] ${DEPT_COLORS[dept.slug]?.badge || ""}`}>
                    {DEPT_ICONS[dept.slug]} {dept.title}
                  </Badge>
                )}
                {lifecycleStages.map((s: any) => (
                  <Badge key={s.slug} variant="outline" className="text-[10px] bg-slate-50">{s.title}</Badge>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              {isCOO && !sop && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => createSopMutation.mutate()} disabled={createSopMutation.isPending} data-testid="btn-create-sop">
                  <Plus className="h-3.5 w-3.5" /> Create SOP Shell
                </Button>
              )}
              {isCOO && sop && !isEditing && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={startEditing} data-testid="btn-edit-sop">
                  <Edit2 className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
              {isEditing && (
                <>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setIsEditing(false)}>Cancel</Button>
                  <Button size="sm" className="h-8 text-xs gap-1" onClick={saveEdits} disabled={updateMutation.isPending} data-testid="btn-save-sop">
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {sop ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4 text-blue-600" /> Purpose</CardTitle></CardHeader>
            <CardContent>
              {isEditing ? (
                <Textarea value={editPurpose} onChange={e => setEditPurpose(e.target.value)} className="text-xs min-h-[80px]" data-testid="edit-purpose" />
              ) : (
                <p className="text-xs text-slate-600">{sop.purpose || "Not defined yet"}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-amber-600" /> Triggers</CardTitle></CardHeader>
            <CardContent>
              {isEditing ? (
                <Textarea value={editTriggers} onChange={e => setEditTriggers(e.target.value)} placeholder="One per line" className="text-xs min-h-[80px]" data-testid="edit-triggers" />
              ) : (
                <ul className="space-y-1">
                  {(sop.triggers || []).length > 0 ? sop.triggers.map((t: string, i: number) => (
                    <li key={i} className="text-xs text-slate-600 flex items-center gap-1.5"><Play className="h-3 w-3 text-amber-500 shrink-0" /> {t}</li>
                  )) : <li className="text-xs text-muted-foreground italic">None defined</li>}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FolderOpen className="h-4 w-4 text-green-600" /> Inputs</CardTitle></CardHeader>
            <CardContent>
              {isEditing ? (
                <Textarea value={editInputs} onChange={e => setEditInputs(e.target.value)} placeholder="One per line" className="text-xs min-h-[80px]" data-testid="edit-inputs" />
              ) : (
                <ul className="space-y-1">
                  {(sop.inputs || []).length > 0 ? sop.inputs.map((t: string, i: number) => (
                    <li key={i} className="text-xs text-slate-600 flex items-center gap-1.5"><ArrowRight className="h-3 w-3 text-green-500 shrink-0" /> {t}</li>
                  )) : <li className="text-xs text-muted-foreground italic">None defined</li>}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Outputs</CardTitle></CardHeader>
            <CardContent>
              {isEditing ? (
                <Textarea value={editOutputs} onChange={e => setEditOutputs(e.target.value)} placeholder="One per line" className="text-xs min-h-[80px]" data-testid="edit-outputs" />
              ) : (
                <ul className="space-y-1">
                  {(sop.outputs || []).length > 0 ? sop.outputs.map((t: string, i: number) => (
                    <li key={i} className="text-xs text-slate-600 flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" /> {t}</li>
                  )) : <li className="text-xs text-muted-foreground italic">None defined</li>}
                </ul>
              )}
            </CardContent>
          </Card>

          {(sop.raci || []).length > 0 && (
            <Card className="col-span-full">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><UserCheck className="h-4 w-4 text-violet-600" /> RACI Matrix</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-semibold">Role</th>
                        <th className="text-center py-2 px-3 font-semibold">R</th>
                        <th className="text-center py-2 px-3 font-semibold">A</th>
                        <th className="text-center py-2 px-3 font-semibold">C</th>
                        <th className="text-center py-2 px-3 font-semibold">I</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sop.raci.map((r: any, i: number) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-2 px-3 font-medium">{r.role}</td>
                          <td className="py-2 px-3 text-center">{r.responsible ? <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 mx-auto" /> : "—"}</td>
                          <td className="py-2 px-3 text-center">{r.accountable ? <CheckCircle2 className="h-3.5 w-3.5 text-red-600 mx-auto" /> : "—"}</td>
                          <td className="py-2 px-3 text-center">{r.consulted ? <CheckCircle2 className="h-3.5 w-3.5 text-amber-600 mx-auto" /> : "—"}</td>
                          <td className="py-2 px-3 text-center">{r.informed ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" /> : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {((sop.tools || []).length > 0 || (sop.templates || []).length > 0) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wrench className="h-4 w-4 text-purple-600" /> Tools & Templates</CardTitle></CardHeader>
              <CardContent>
                {(sop.tools || []).map((t: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    <Wrench className="h-3 w-3 text-purple-500" />
                    <span className="text-xs">{t.name}</span>
                    {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="text-blue-600"><ExternalLink className="h-3 w-3" /></a>}
                  </div>
                ))}
                {(sop.templates || []).map((t: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    <FileCheck className="h-3 w-3 text-amber-500" />
                    <span className="text-xs">{t.name}</span>
                    {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="text-blue-600"><ExternalLink className="h-3 w-3" /></a>}
                    {t.slug && <button className="text-blue-600 text-xs hover:underline" onClick={() => onSelectProcess(t.slug)}>View</button>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-cyan-600" /> Review Cadence</CardTitle></CardHeader>
            <CardContent>
              {isEditing ? (
                <Input value={editReview} onChange={e => setEditReview(e.target.value)} className="text-xs" data-testid="edit-review" />
              ) : (
                <p className="text-xs text-slate-600">{sop.reviewCadence || "Not set"}</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <ClipboardList className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-semibold mb-1">No SOP Defined</h3>
            <p className="text-xs text-muted-foreground mb-3">This process doesn't have a Standard Operating Procedure yet.</p>
            {isCOO && (
              <Button size="sm" onClick={() => createSopMutation.mutate()} disabled={createSopMutation.isPending} data-testid="btn-create-sop-empty">
                <Plus className="h-4 w-4 mr-1" /> Create SOP Shell
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {proc.contentMarkdown && !sop && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Process Documentation</CardTitle></CardHeader>
          <CardContent>{renderContent(proc.contentMarkdown)}</CardContent>
        </Card>
      )}

      {((sop?.steps || []).length > 0 || steps.length > 0) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Hash className="h-4 w-4" /> Steps ({(sop?.steps || []).length || steps.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(sop?.steps || []).length > 0
                ? (sop.steps as any[]).map((step: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                      <div className="w-7 h-7 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {i + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{step.title}</p>
                        {step.description && <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>}
                      </div>
                    </div>
                  ))
                : steps.map((step: any, i: number) => (
                    <div key={step.id} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                      <div className="w-7 h-7 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {i + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{step.title}</p>
                        {step.contentMarkdown && <p className="text-xs text-slate-500 mt-0.5">{step.contentMarkdown.slice(0, 200)}</p>}
                      </div>
                    </div>
                  ))
              }
            </div>
          </CardContent>
        </Card>
      )}

      {related.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Link2 className="h-4 w-4" /> Related Processes</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {related.map((r: any) => (
                <button
                  key={r.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all text-xs font-medium"
                  onClick={() => onSelectProcess(r.slug)}
                  data-testid={`related-${r.slug}`}
                >
                  <GitBranch className="h-3 w-3 text-muted-foreground" />
                  {r.title}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TemplatesLibrary({ onSelectProcess }: { onSelectProcess: (slug: string) => void }) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ["ee-info-os-templates", search],
    queryFn: async () => {
      const url = search ? `/api/ee-info/os/templates?search=${encodeURIComponent(search)}` : "/api/ee-info/os/templates";
      const res = await authFetch(url);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="space-y-4" data-testid="templates-library">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-8 text-xs"
          data-testid="templates-search"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : templates.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-12 text-center text-sm text-muted-foreground">No templates found.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t: any) => (
            <Card
              key={t.id}
              className={`cursor-pointer hover:shadow-md transition-all ${expandedId === t.id ? "ring-2 ring-blue-300" : ""}`}
              onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
              data-testid={`template-card-${t.slug}`}
            >
              <CardContent className="py-4 px-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileCheck className="h-4 w-4 text-amber-600 shrink-0" />
                    <h3 className="text-sm font-semibold truncate">{t.title}</h3>
                  </div>
                  {t.externalUrl && (
                    <a href={t.externalUrl} target="_blank" rel="noreferrer" className="shrink-0" onClick={e => e.stopPropagation()}>
                      <ExternalLink className="h-3.5 w-3.5 text-blue-600" />
                    </a>
                  )}
                </div>
                <Badge variant="outline" className={`text-[9px] ${t.status === "published" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                  {t.status === "published" ? "Active" : "Draft"}
                </Badge>
                {t.linkedProcesses?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.linkedProcesses.map((lp: any) => (
                      <button
                        key={lp.slug}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                        onClick={e => { e.stopPropagation(); onSelectProcess(lp.slug); }}
                        data-testid={`template-link-${lp.slug}`}
                      >
                        {lp.title}
                      </button>
                    ))}
                  </div>
                )}
                {expandedId === t.id && t.contentMarkdown && (
                  <div className="mt-3 pt-3 border-t text-xs text-slate-600 whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {t.contentMarkdown.slice(0, 1000)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

interface RoleSimConfig {
  roleKey: string;
  roleLabel: string;
  department: string;
  rhythm: { frequency: string; activity: string }[];
  nonNegotiables: string[];
  inputs: string[];
  outputs: string[];
  escalationPath: { role: string; when: string }[];
  dashboards: { label: string; path: string }[];
  topActions: { title: string; description: string; urgency: "high" | "medium" | "low" }[];
}

const ROLE_SIMULATIONS: RoleSimConfig[] = [
  {
    roleKey: "COO_ADMIN",
    roleLabel: "COO / Admin",
    department: "EXCO",
    rhythm: [
      { frequency: "Daily", activity: "Review Engineering Standup board for blockers and overdue tasks" },
      { frequency: "Daily", activity: "Check Execution Dashboard for project health across portfolio" },
      { frequency: "Weekly", activity: "Run Weekly Review wizard across all active projects" },
      { frequency: "Weekly", activity: "Review COS Control for budget variance exceptions" },
      { frequency: "Weekly", activity: "Check Lifecycle Board for phase-gate readiness" },
      { frequency: "Monthly", activity: "Review Cashflow Forecast for liquidity planning" },
    ],
    nonNegotiables: [
      "Approve all lifecycle phase transitions (gate reviews)",
      "Resolve HOLD/blocked tasks within 24 hours",
      "Complete Weekly Review for every active project",
      "Review and approve engineering stage gate overrides",
      "Sign off on quality management escalations",
    ],
    inputs: [
      "Excel tracker imports (via Smart Import)",
      "Engineering task status updates from team",
      "Quality checklist submissions from QM",
      "Cashflow actuals from Finance",
      "Subcontractor performance reports",
    ],
    outputs: [
      "Weekly Review reports with RAG status per project",
      "Phase transition approvals and audit trail",
      "Blocker resolution decisions",
      "Resource reallocation directives",
      "Exception approvals (budget overrides, gate overrides)",
    ],
    escalationPath: [
      { role: "CEO", when: "Budget overrun >25% or project at risk of cancellation" },
      { role: "CFO", when: "Cashflow shortfall or payment delays >30 days" },
      { role: "Legal", when: "Contract disputes or compliance issues" },
    ],
    dashboards: [
      { label: "Execution Dashboard", path: "/dashboard" },
      { label: "Engineering Dashboard", path: "/engineering" },
      { label: "COS Control", path: "/cos-control" },
      { label: "Lifecycle Board", path: "/lifecycle-board" },
      { label: "Weekly Reviews", path: "/weekly-reviews" },
      { label: "Cashflow Forecast", path: "/cashflow-forecast" },
      { label: "Quality Dashboard", path: "/quality" },
    ],
    topActions: [
      { title: "Review blockers in Standup Mode", description: "Check all HOLD tasks and resolve external/internal blocks", urgency: "high" },
      { title: "Run Weekly Review", description: "Assess each active project's progress and set RAG status", urgency: "high" },
      { title: "Check phase-gate readiness", description: "Review projects ready for lifecycle phase transitions", urgency: "medium" },
      { title: "Review COS exceptions", description: "Identify projects with budget variance >15%", urgency: "medium" },
      { title: "Update project priorities", description: "Re-prioritize tasks based on current portfolio needs", urgency: "low" },
    ],
  },
  {
    roleKey: "ENGINEERING_MANAGER",
    roleLabel: "Engineering Manager",
    department: "Engineering",
    rhythm: [
      { frequency: "Daily", activity: "Review My Tasks view for overdue and due-today items" },
      { frequency: "Daily", activity: "Update task statuses and add progress notes" },
      { frequency: "Daily", activity: "Check Engineering Dashboard KPIs" },
      { frequency: "Weekly", activity: "Review engineering stage checklists for active projects" },
      { frequency: "Weekly", activity: "Assign and re-prioritize team tasks" },
      { frequency: "Monthly", activity: "Review engineering deliverable completion rates" },
    ],
    nonNegotiables: [
      "Update task status daily for all assigned items",
      "Complete engineering stage checklists before gate reviews",
      "Upload deliverables with proper documentation",
      "Flag blockers immediately using HOLD workflow with reason",
      "Attend and prepare for daily standup",
    ],
    inputs: [
      "Project plans and specifications from Project Development",
      "Quality requirements from QM team",
      "Budget constraints from Finance",
      "Client feedback and change requests",
      "Subcontractor deliverables and reports",
    ],
    outputs: [
      "Engineering stage checklist completions",
      "Technical deliverables (drawings, specs, reports)",
      "Task status updates and progress notes",
      "HOLD/blocker notifications with resolution paths",
      "Stage gate readiness recommendations",
    ],
    escalationPath: [
      { role: "COO", when: "Resource constraints blocking multiple projects" },
      { role: "Project Manager", when: "Scope changes affecting timeline or budget" },
      { role: "Quality Manager", when: "Technical compliance issues or failed inspections" },
    ],
    dashboards: [
      { label: "Engineering Dashboard", path: "/engineering" },
      { label: "Engineering Tasks", path: "/engineering/tasks" },
      { label: "Lifecycle Board", path: "/lifecycle-board" },
      { label: "Engineering Sync", path: "/engineering/sync" },
    ],
    topActions: [
      { title: "Clear overdue tasks", description: "Update or reschedule all tasks past their due date", urgency: "high" },
      { title: "Complete stage checklists", description: "Fill in pending engineering stage items for active projects", urgency: "high" },
      { title: "Upload pending deliverables", description: "Attach technical documents to relevant stage tasks", urgency: "medium" },
      { title: "Review HOLD items", description: "Check if any blocked tasks can be unblocked", urgency: "medium" },
      { title: "Plan next week's priorities", description: "Assign and prioritize tasks for the upcoming week", urgency: "low" },
    ],
  },
  {
    roleKey: "PROGRAM_MANAGER",
    roleLabel: "Program / Project Manager",
    department: "Project Management",
    rhythm: [
      { frequency: "Daily", activity: "Check project progress on Execution Dashboard" },
      { frequency: "Daily", activity: "Review notifications for plan changes and approvals" },
      { frequency: "Weekly", activity: "Update project plan tasks and milestones" },
      { frequency: "Weekly", activity: "Review revenue tracking and milestone invoicing" },
      { frequency: "Weekly", activity: "Coordinate with subcontractors on deliverables" },
      { frequency: "Monthly", activity: "Run Smart Import with latest Excel trackers" },
    ],
    nonNegotiables: [
      "Keep project plans current (re-import trackers regularly)",
      "Track revenue milestones and invoice status",
      "Update project phase when milestones are met",
      "Respond to approval requests within 24 hours",
      "Maintain subcontractor delivery schedules",
    ],
    inputs: [
      "Excel tracker files from site teams",
      "Invoice confirmations from Finance",
      "Engineering stage completion updates",
      "Quality checklist results",
      "Client communications and approvals",
    ],
    outputs: [
      "Updated project plans via Smart Import",
      "Revenue milestone tracking and invoice requests",
      "Project status reports for Weekly Review",
      "Subcontractor coordination updates",
      "Phase transition requests to COO",
    ],
    escalationPath: [
      { role: "COO", when: "Project behind schedule >10% or budget overrun" },
      { role: "Finance Manager", when: "Invoice disputes or payment delays" },
      { role: "Engineering Manager", when: "Technical issues blocking construction" },
    ],
    dashboards: [
      { label: "Execution Dashboard", path: "/dashboard" },
      { label: "Projects", path: "/projects" },
      { label: "Smart Import", path: "/smart-import" },
      { label: "PM Dashboard", path: "/pm-dashboard" },
      { label: "Cashflow", path: "/cashflow" },
      { label: "Subcontractor Dashboard", path: "/subcontractor-dashboard" },
    ],
    topActions: [
      { title: "Import latest tracker files", description: "Run Smart Import with updated Excel files from site", urgency: "high" },
      { title: "Review revenue milestones", description: "Check which milestones are ready for invoicing", urgency: "high" },
      { title: "Update project statuses", description: "Ensure all project RAG statuses are current", urgency: "medium" },
      { title: "Check subcontractor deliveries", description: "Verify pending subcontractor deliverables", urgency: "medium" },
      { title: "Prepare for Weekly Review", description: "Gather project data for the upcoming review session", urgency: "low" },
    ],
  },
  {
    roleKey: "PROGRAM_FINANCE_MANAGER",
    roleLabel: "Finance Manager",
    department: "Finance",
    rhythm: [
      { frequency: "Daily", activity: "Review COS Control for new variance alerts" },
      { frequency: "Daily", activity: "Process invoice confirmations and payment dates" },
      { frequency: "Weekly", activity: "Update cashflow actuals and forecasts" },
      { frequency: "Weekly", activity: "Review revenue milestone payment status" },
      { frequency: "Monthly", activity: "Reconcile finance revenue and COS monthly tables" },
      { frequency: "Monthly", activity: "Prepare financial close reports" },
    ],
    nonNegotiables: [
      "Confirm invoice dates and payment dates promptly",
      "Flag budget overruns >15% immediately",
      "Maintain accurate cashflow forecasts",
      "Reconcile monthly revenue vs expenditure",
      "Process milestone payments within SLA",
    ],
    inputs: [
      "Expenditure breakdown data from Smart Import",
      "Revenue milestone invoices from PM",
      "PO numbers and supplier invoices",
      "Bank statements for payment confirmation",
      "Budget forecasts from project teams",
    ],
    outputs: [
      "COS variance reports and exception alerts",
      "Cashflow forecasts and liquidity reports",
      "Invoice confirmation updates in system",
      "Monthly financial close summaries",
      "Budget vs actual analysis per project",
    ],
    escalationPath: [
      { role: "CFO", when: "Cashflow shortfall or liquidity risk" },
      { role: "COO", when: "Budget overrun >25% on any project" },
      { role: "Project Manager", when: "Missing invoices or payment documentation" },
    ],
    dashboards: [
      { label: "COS Control", path: "/cos-control" },
      { label: "Cashflow", path: "/cashflow" },
      { label: "Cashflow Forecast", path: "/cashflow-forecast" },
      { label: "Revenue Tracking", path: "/revenue" },
      { label: "Budget", path: "/budget" },
    ],
    topActions: [
      { title: "Review COS exceptions", description: "Check projects with variance >15% for immediate attention", urgency: "high" },
      { title: "Confirm pending invoices", description: "Update invoice dates and payment confirmations", urgency: "high" },
      { title: "Update cashflow forecast", description: "Refresh projected inflows and outflows for next 4 weeks", urgency: "medium" },
      { title: "Reconcile monthly figures", description: "Ensure finance tables match imported tracker data", urgency: "medium" },
      { title: "Prepare financial summary", description: "Generate portfolio-level financial report", urgency: "low" },
    ],
  },
  {
    roleKey: "QUALITY_MANAGER",
    roleLabel: "Quality Manager",
    department: "Quality",
    rhythm: [
      { frequency: "Daily", activity: "Review quality approval requests in notifications" },
      { frequency: "Daily", activity: "Check QM Dashboard for overdue quality items" },
      { frequency: "Weekly", activity: "Audit quality checklists across active projects" },
      { frequency: "Weekly", activity: "Review and approve quality gate submissions" },
      { frequency: "Monthly", activity: "Analyze quality scores and trend data" },
    ],
    nonNegotiables: [
      "Review and respond to approval requests within 24 hours",
      "Maintain quality checklists for all active projects",
      "Set pass/fail status on restricted quality items",
      "Attach evidence to completed quality checks",
      "Escalate quality failures immediately",
    ],
    inputs: [
      "Quality checklist submissions from project teams",
      "Evidence documents and photos from site",
      "Engineering deliverables for quality review",
      "Subcontractor quality reports",
      "Approval requests from team members",
    ],
    outputs: [
      "Quality gate approvals/rejections",
      "QM score reports per project",
      "Quality exception notifications",
      "Corrective action requests",
      "Quality trend analysis reports",
    ],
    escalationPath: [
      { role: "COO", when: "Critical quality failure or safety concern" },
      { role: "Engineering Manager", when: "Technical non-compliance requiring redesign" },
      { role: "Project Manager", when: "Quality delays impacting project timeline" },
    ],
    dashboards: [
      { label: "QM Dashboard", path: "/quality" },
      { label: "Projects", path: "/projects" },
      { label: "Approvals", path: "/admin/approvals" },
    ],
    topActions: [
      { title: "Process approval queue", description: "Review and respond to pending quality approval requests", urgency: "high" },
      { title: "Check overdue quality items", description: "Follow up on quality checks past their due date", urgency: "high" },
      { title: "Audit active project checklists", description: "Verify quality checklists are being maintained", urgency: "medium" },
      { title: "Review evidence attachments", description: "Ensure proper documentation for completed items", urgency: "medium" },
      { title: "Update quality templates", description: "Refine checklist templates based on lessons learned", urgency: "low" },
    ],
  },
  {
    roleKey: "CONSTRUCTION_MANAGER",
    roleLabel: "Construction Manager",
    department: "Project Delivery",
    rhythm: [
      { frequency: "Daily", activity: "Update construction task progress" },
      { frequency: "Daily", activity: "Review site delivery schedules" },
      { frequency: "Weekly", activity: "Coordinate with subcontractors on site activities" },
      { frequency: "Weekly", activity: "Update project plan actuals (start/end dates)" },
      { frequency: "Monthly", activity: "Review construction stage gate progress" },
    ],
    nonNegotiables: [
      "Update actual start and end dates for construction tasks",
      "Report site issues and blockers immediately",
      "Coordinate material deliveries with procurement",
      "Ensure safety compliance on all active sites",
      "Submit quality evidence for construction milestones",
    ],
    inputs: [
      "Project plans and construction schedules",
      "Material delivery confirmations",
      "Subcontractor availability and progress",
      "Quality requirements and checklists",
      "Weather and site condition reports",
    ],
    outputs: [
      "Construction progress updates",
      "Site issue reports and blocker notifications",
      "Quality evidence (photos, test results)",
      "Material usage and wastage reports",
      "Subcontractor performance feedback",
    ],
    escalationPath: [
      { role: "COO", when: "Safety incidents or major site delays" },
      { role: "Project Manager", when: "Schedule slippage >5 days" },
      { role: "Procurement", when: "Material shortages or delivery failures" },
    ],
    dashboards: [
      { label: "Execution Dashboard", path: "/dashboard" },
      { label: "Projects", path: "/projects" },
      { label: "Engineering Tasks", path: "/engineering/tasks" },
      { label: "Subcontractor Dashboard", path: "/subcontractor-dashboard" },
    ],
    topActions: [
      { title: "Update site progress", description: "Log today's construction progress for active sites", urgency: "high" },
      { title: "Check material deliveries", description: "Verify scheduled deliveries for this week", urgency: "high" },
      { title: "Submit quality evidence", description: "Upload photos and test results for completed work", urgency: "medium" },
      { title: "Review subcontractor schedule", description: "Confirm subcontractor availability for upcoming work", urgency: "medium" },
      { title: "Flag site issues", description: "Report any blockers or safety concerns", urgency: "low" },
    ],
  },
  {
    roleKey: "PROJECT_DEVELOPER",
    roleLabel: "Project Developer",
    department: "Project Development",
    rhythm: [
      { frequency: "Daily", activity: "Review PD ticket queue and incoming requests" },
      { frequency: "Daily", activity: "Update development pipeline progress" },
      { frequency: "Weekly", activity: "Assess new project feasibility" },
      { frequency: "Weekly", activity: "Prepare cost proposals and first assessments" },
      { frequency: "Monthly", activity: "Review development pipeline metrics" },
    ],
    nonNegotiables: [
      "Complete First Assessment within SLA for new leads",
      "Prepare accurate cost proposals with supporting data",
      "Maintain development pipeline visibility",
      "Handover project packages with complete documentation",
      "Track PD tickets and respond within 24 hours",
    ],
    inputs: [
      "New project leads and client enquiries",
      "Site survey data and solar resource assessments",
      "Utility connection requirements",
      "Legal and regulatory requirements",
      "Market pricing and component costs",
    ],
    outputs: [
      "First Assessment reports",
      "Cost Proposals (CP)",
      "Feasibility studies",
      "Project handover packages to PM",
      "Development pipeline status updates",
    ],
    escalationPath: [
      { role: "COO", when: "Strategic decisions on large projects" },
      { role: "Legal", when: "Contract or regulatory complications" },
      { role: "Engineering Manager", when: "Technical feasibility questions" },
    ],
    dashboards: [
      { label: "PD Dashboard", path: "/pd-dashboard" },
      { label: "PD Tickets", path: "/pd-tickets" },
      { label: "Lifecycle Board", path: "/lifecycle-board" },
      { label: "Projects", path: "/projects" },
    ],
    topActions: [
      { title: "Process PD ticket queue", description: "Review and respond to incoming development tickets", urgency: "high" },
      { title: "Complete pending first assessments", description: "Finalize FA reports for projects in pipeline", urgency: "high" },
      { title: "Update cost proposals", description: "Refresh pricing on active proposals", urgency: "medium" },
      { title: "Prepare handover packages", description: "Document completed developments for PM transition", urgency: "medium" },
      { title: "Review pipeline metrics", description: "Analyze conversion rates and pipeline health", urgency: "low" },
    ],
  },
  {
    roleKey: "ENGINEER",
    roleLabel: "Engineer",
    department: "Engineering",
    rhythm: [
      { frequency: "Daily", activity: "Check My Tasks for assigned engineering work" },
      { frequency: "Daily", activity: "Update task progress and add notes" },
      { frequency: "Weekly", activity: "Complete engineering stage checklist items" },
      { frequency: "Weekly", activity: "Upload technical deliverables" },
      { frequency: "Monthly", activity: "Review engineering standards and templates" },
    ],
    nonNegotiables: [
      "Complete assigned tasks by due date",
      "Upload deliverables with proper naming and versioning",
      "Flag technical issues using HOLD workflow",
      "Follow engineering stage checklist requirements",
      "Attend daily standup prepared with status updates",
    ],
    inputs: [
      "Task assignments from Engineering Manager",
      "Project specifications and design requirements",
      "Client feedback and revision requests",
      "Quality standards and compliance requirements",
      "Component datasheets and technical references",
    ],
    outputs: [
      "Technical drawings and designs",
      "Engineering calculations and reports",
      "Stage checklist item completions",
      "Task status updates and progress notes",
      "Technical review comments",
    ],
    escalationPath: [
      { role: "Engineering Manager", when: "Technical challenges requiring senior input" },
      { role: "Quality Manager", when: "Compliance or standards questions" },
      { role: "Project Manager", when: "Scope clarification needed" },
    ],
    dashboards: [
      { label: "Engineering Tasks", path: "/engineering/tasks" },
      { label: "Engineering Dashboard", path: "/engineering" },
      { label: "Projects", path: "/projects" },
    ],
    topActions: [
      { title: "Complete overdue tasks", description: "Address all tasks past their due date", urgency: "high" },
      { title: "Upload pending deliverables", description: "Attach completed technical documents", urgency: "high" },
      { title: "Update task statuses", description: "Set current status on all assigned tasks", urgency: "medium" },
      { title: "Review stage checklist items", description: "Complete pending checklist items for your projects", urgency: "medium" },
      { title: "Add progress notes", description: "Document what was accomplished today", urgency: "low" },
    ],
  },
  {
    roleKey: "ACCOUNTANT",
    roleLabel: "Accountant",
    department: "Finance",
    rhythm: [
      { frequency: "Daily", activity: "Process invoice confirmations and payment updates" },
      { frequency: "Daily", activity: "Review expenditure entries for accuracy" },
      { frequency: "Weekly", activity: "Reconcile payment dates with bank records" },
      { frequency: "Weekly", activity: "Update revenue milestone payment status" },
      { frequency: "Monthly", activity: "Prepare month-end financial close entries" },
    ],
    nonNegotiables: [
      "Confirm invoice dates accurately",
      "Match PO numbers to invoices",
      "Update payment dates when funds clear",
      "Flag duplicate or suspicious entries",
      "Complete month-end reconciliation on time",
    ],
    inputs: [
      "Supplier invoices and PO numbers",
      "Bank statements and payment confirmations",
      "Revenue milestone invoice copies",
      "Expenditure data from Smart Import",
      "Budget allocation schedules",
    ],
    outputs: [
      "Confirmed invoice and payment dates",
      "Expenditure reconciliation reports",
      "Revenue collection status updates",
      "Month-end financial close entries",
      "Exception reports for Finance Manager",
    ],
    escalationPath: [
      { role: "Finance Manager", when: "Payment discrepancies or missing documentation" },
      { role: "Project Manager", when: "Invoice queries or PO mismatches" },
    ],
    dashboards: [
      { label: "COS Control", path: "/cos-control" },
      { label: "Revenue Tracking", path: "/revenue" },
      { label: "Cashflow", path: "/cashflow" },
    ],
    topActions: [
      { title: "Confirm pending invoices", description: "Update invoice date confirmations in the system", urgency: "high" },
      { title: "Process payment updates", description: "Mark payments as received based on bank records", urgency: "high" },
      { title: "Reconcile expenditure entries", description: "Verify imported data matches source documents", urgency: "medium" },
      { title: "Update revenue collections", description: "Track milestone payment receipt status", urgency: "medium" },
      { title: "Prepare close entries", description: "Compile month-end financial entries", urgency: "low" },
    ],
  },
  {
    roleKey: "KEY_ACCOUNTS_MANAGER",
    roleLabel: "Key Accounts Manager",
    department: "Sales",
    rhythm: [
      { frequency: "Daily", activity: "Monitor client communications and requests" },
      { frequency: "Weekly", activity: "Review portfolio performance for key clients" },
      { frequency: "Weekly", activity: "Coordinate with PM on client project updates" },
      { frequency: "Monthly", activity: "Prepare client reports and performance summaries" },
    ],
    nonNegotiables: [
      "Respond to client enquiries within 24 hours",
      "Maintain accurate portfolio data per client",
      "Coordinate project updates with PMs before client meetings",
      "Track client satisfaction and escalate concerns",
    ],
    inputs: [
      "Client communications and meeting notes",
      "Portfolio performance data",
      "Project status updates from PMs",
      "Revenue and billing status from Finance",
      "Quality reports for client projects",
    ],
    outputs: [
      "Client status reports and presentations",
      "Portfolio performance summaries",
      "New business referrals to PD team",
      "Client feedback to internal teams",
      "Contract renewal recommendations",
    ],
    escalationPath: [
      { role: "COO", when: "Client relationship at risk or contract disputes" },
      { role: "Project Manager", when: "Project delivery concerns from client" },
      { role: "Finance Manager", when: "Billing disputes or payment issues" },
    ],
    dashboards: [
      { label: "Portfolios", path: "/portfolios" },
      { label: "Projects", path: "/projects" },
      { label: "Execution Dashboard", path: "/dashboard" },
      { label: "Collaboration Hub", path: "/collaboration" },
    ],
    topActions: [
      { title: "Review client project statuses", description: "Check portfolio health for upcoming client meetings", urgency: "high" },
      { title: "Respond to client queries", description: "Address outstanding client communications", urgency: "high" },
      { title: "Update portfolio data", description: "Ensure portfolio groupings are current", urgency: "medium" },
      { title: "Prepare client report", description: "Compile performance data for client presentation", urgency: "medium" },
      { title: "Identify upsell opportunities", description: "Review completed projects for expansion potential", urgency: "low" },
    ],
  },
];

const URGENCY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: "bg-red-50 border-red-200", text: "text-red-700", label: "Urgent" },
  medium: { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", label: "Important" },
  low: { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", label: "Plan" },
};

function RoleBasedSimulation() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const userRole = user?.role || (user as any)?.companyRole || "";
  const defaultRole = ROLE_SIMULATIONS.find(r => r.roleKey === userRole)?.roleKey || "";
  const [selectedRole, setSelectedRole] = useState<string>(defaultRole);
  const [expandedPanel, setExpandedPanel] = useState<string | null>("rhythm");

  const config = ROLE_SIMULATIONS.find(r => r.roleKey === selectedRole);

  const togglePanel = (panel: string) => {
    setExpandedPanel(prev => prev === panel ? null : panel);
  };

  return (
    <div className="space-y-4" data-testid="role-simulation">
      <Card className="shadow-sm">
        <CardContent className="pt-5 pb-4 px-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
                <UserCheck className="h-4 w-4 text-blue-600" />
                Role-Based Simulation
              </h3>
              <p className="text-xs text-muted-foreground">Select your role to see your daily rhythm, responsibilities, and key dashboards.</p>
            </div>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger className="w-[220px] h-9" data-testid="select-simulation-role">
                <SelectValue placeholder="Select your role..." />
              </SelectTrigger>
              <SelectContent>
                {ROLE_SIMULATIONS.map(r => (
                  <SelectItem key={r.roleKey} value={r.roleKey}>{r.roleLabel}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!config && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Select a role above to see the simulation.</p>
          </CardContent>
        </Card>
      )}

      {config && (
        <div className="space-y-3" data-testid={`simulation-panels-${config.roleKey}`}>
          <div className="flex items-center gap-2 px-1">
            <Badge className="bg-slate-800 text-white text-xs">{config.roleLabel}</Badge>
            <Badge variant="outline" className="text-[10px]">{config.department}</Badge>
          </div>

          <Card className="overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
              onClick={() => togglePanel("rhythm")}
              data-testid="panel-toggle-rhythm"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-blue-50 text-blue-600"><Clock className="h-4 w-4" /></div>
                <span className="text-sm font-semibold">Your Daily/Weekly Rhythm</span>
              </div>
              {expandedPanel === "rhythm" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {expandedPanel === "rhythm" && (
              <div className="px-5 pb-4 border-t">
                <div className="space-y-2 mt-3">
                  {config.rhythm.map((r, i) => (
                    <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50">
                      <Badge variant="outline" className={`text-[9px] shrink-0 mt-0.5 ${r.frequency === "Daily" ? "bg-blue-50 text-blue-700 border-blue-200" : r.frequency === "Weekly" ? "bg-violet-50 text-violet-700 border-violet-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                        {r.frequency}
                      </Badge>
                      <span className="text-xs text-slate-700">{r.activity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
              onClick={() => togglePanel("nonneg")}
              data-testid="panel-toggle-nonneg"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-red-50 text-red-600"><Shield className="h-4 w-4" /></div>
                <span className="text-sm font-semibold">Your Non-Negotiables</span>
              </div>
              {expandedPanel === "nonneg" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {expandedPanel === "nonneg" && (
              <div className="px-5 pb-4 border-t">
                <div className="space-y-1.5 mt-3">
                  {config.nonNegotiables.map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-red-50/50">
                      <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-700">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
              onClick={() => togglePanel("io")}
              data-testid="panel-toggle-io"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600"><ArrowRight className="h-4 w-4" /></div>
                <span className="text-sm font-semibold">Your Inputs & Outputs</span>
              </div>
              {expandedPanel === "io" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {expandedPanel === "io" && (
              <div className="px-5 pb-4 border-t">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1"><ArrowLeft className="h-3 w-3" /> INPUTS</h4>
                    <div className="space-y-1.5">
                      {config.inputs.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-emerald-50/50">
                          <FolderOpen className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
                          <span className="text-xs text-slate-700">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">OUTPUTS <ArrowRight className="h-3 w-3" /></h4>
                    <div className="space-y-1.5">
                      {config.outputs.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-blue-50/50">
                          <FileText className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
                          <span className="text-xs text-slate-700">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
              onClick={() => togglePanel("escalation")}
              data-testid="panel-toggle-escalation"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-amber-50 text-amber-600"><ChevronUp className="h-4 w-4" /></div>
                <span className="text-sm font-semibold">Your Escalation Path</span>
              </div>
              {expandedPanel === "escalation" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {expandedPanel === "escalation" && (
              <div className="px-5 pb-4 border-t">
                <div className="space-y-2 mt-3">
                  {config.escalationPath.map((esc, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50/30">
                      <div className="p-1.5 rounded-full bg-amber-100">
                        <Users className="h-3.5 w-3.5 text-amber-700" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-800">{esc.role}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{esc.when}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
              onClick={() => togglePanel("dashboards")}
              data-testid="panel-toggle-dashboards"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-violet-50 text-violet-600"><Layers className="h-4 w-4" /></div>
                <span className="text-sm font-semibold">Your Dashboards</span>
              </div>
              {expandedPanel === "dashboards" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {expandedPanel === "dashboards" && (
              <div className="px-5 pb-4 border-t">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                  {config.dashboards.map((db, i) => (
                    <button
                      key={i}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all text-left group"
                      onClick={() => navigate(db.path)}
                      data-testid={`dashboard-link-${i}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600 shrink-0" />
                      <span className="text-xs font-medium text-slate-700 group-hover:text-blue-600 truncate">{db.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
              onClick={() => togglePanel("actions")}
              data-testid="panel-toggle-actions"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-slate-800 text-white"><Zap className="h-4 w-4" /></div>
                <span className="text-sm font-semibold">Top 5 Actions Right Now</span>
              </div>
              {expandedPanel === "actions" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {expandedPanel === "actions" && (
              <div className="px-5 pb-4 border-t">
                <div className="space-y-2 mt-3">
                  {config.topActions.map((action, i) => {
                    const style = URGENCY_STYLES[action.urgency];
                    return (
                      <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${style.bg}`} data-testid={`action-card-${i}`}>
                        <div className="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-semibold text-slate-800">{action.title}</span>
                            <Badge variant="outline" className={`text-[8px] ${style.text} border-current`}>{style.label}</Badge>
                          </div>
                          <p className="text-[11px] text-slate-500">{action.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function WalkthroughTab() {
  const [, navigate] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [completedSteps, setCompletedSteps] = useState<Record<string, Set<number>>>(() => {
    try {
      const saved = localStorage.getItem("walkthrough-progress");
      if (saved) {
        const parsed = JSON.parse(saved);
        const result: Record<string, Set<number>> = {};
        for (const [k, v] of Object.entries(parsed)) {
          result[k] = new Set(v as number[]);
        }
        return result;
      }
    } catch {}
    return {};
  });
  const [expandedTips, setExpandedTips] = useState<Set<string>>(new Set());

  const saveProgress = useCallback((walkthroughId: string, stepNum: number, checked: boolean) => {
    setCompletedSteps(prev => {
      const next = { ...prev };
      const steps = new Set(prev[walkthroughId] || []);
      if (checked) steps.add(stepNum);
      else steps.delete(stepNum);
      next[walkthroughId] = steps;
      const toSave: Record<string, number[]> = {};
      for (const [k, v] of Object.entries(next)) {
        toSave[k] = Array.from(v);
      }
      localStorage.setItem("walkthrough-progress", JSON.stringify(toSave));
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    let items = WALKTHROUGHS;
    if (categoryFilter !== "all") items = items.filter(w => w.category === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(w => w.title.toLowerCase().includes(q) || w.description.toLowerCase().includes(q));
    }
    return items;
  }, [categoryFilter, search]);

  const selected = selectedId ? WALKTHROUGHS.find(w => w.id === selectedId) : null;

  const toggleTip = (key: string) => {
    setExpandedTips(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (selected) {
    const stepsCompleted = completedSteps[selected.id]?.size || 0;
    const totalSteps = selected.steps.length;
    const pct = Math.round((stepsCompleted / totalSteps) * 100);
    const catConfig = WALKTHROUGH_CATEGORIES[selected.category];

    return (
      <div className="space-y-4" data-testid="walkthrough-detail">
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => setSelectedId(null)} data-testid="walkthrough-back">
          <ChevronRight className="h-3.5 w-3.5 rotate-180" /> Back to all walkthroughs
        </Button>
        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-slate-50 to-white border-b px-6 py-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className={`text-[10px] ${catConfig?.color || ""}`}>{catConfig?.label || selected.category}</Badge>
                  <span className="flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3 w-3" /> ~{selected.estimatedMinutes} min</span>
                </div>
                <CardTitle className="text-xl font-bold tracking-tight">{selected.title}</CardTitle>
                <p className="text-sm text-slate-500 mt-1">{selected.description}</p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="text-2xl font-bold font-mono text-slate-900">{pct}%</p>
                <p className="text-xs text-slate-400">{stepsCompleted}/{totalSteps} steps</p>
              </div>
            </div>
            <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              {selected.steps.map(step => {
                const isCompleted = completedSteps[selected.id]?.has(step.stepNumber) || false;
                const tipKey = `${selected.id}-${step.stepNumber}`;
                const tipExpanded = expandedTips.has(tipKey);
                return (
                  <div key={step.stepNumber} className={`px-6 py-4 transition-colors ${isCompleted ? "bg-green-50/30" : "bg-white"}`} data-testid={`walkthrough-step-${step.stepNumber}`}>
                    <div className="flex items-start gap-4">
                      <button type="button" className="mt-0.5 shrink-0" onClick={() => saveProgress(selected.id, step.stepNumber, !isCompleted)} data-testid={`walkthrough-check-${step.stepNumber}`}>
                        {isCompleted ? <CheckCircle2 className="h-6 w-6 text-green-600" /> : <CircleDot className="h-6 w-6 text-slate-300 hover:text-slate-400 transition-colors" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-slate-800 text-white text-[10px] font-bold shrink-0">{step.stepNumber}</span>
                          <h4 className={`text-sm font-semibold ${isCompleted ? "text-green-700 line-through decoration-green-300" : "text-slate-900"}`}>{step.title}</h4>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line ml-7">{step.description}</p>
                        {step.tip && (
                          <div className="ml-7 mt-2">
                            <button type="button" className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700" onClick={() => toggleTip(tipKey)} data-testid={`walkthrough-tip-toggle-${step.stepNumber}`}>
                              <Lightbulb className="h-3 w-3" /> {tipExpanded ? "Hide tip" : "Show tip"}
                            </button>
                            {tipExpanded && <div className="mt-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 leading-relaxed">{step.tip}</div>}
                          </div>
                        )}
                        {step.targetPage && (
                          <div className="ml-7 mt-2">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-blue-600 border-blue-200 hover:bg-blue-50" onClick={() => navigate(step.targetPage!)} data-testid={`walkthrough-goto-${step.stepNumber}`}>
                              <ExternalLink className="h-3 w-3" /> Go to page
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const categories = ["all", ...Object.keys(WALKTHROUGH_CATEGORIES)];

  return (
    <div className="space-y-4" data-testid="walkthrough-tab">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input placeholder="Search walkthroughs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 text-sm" data-testid="walkthrough-search" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {categories.map(cat => {
            const config = cat === "all" ? null : WALKTHROUGH_CATEGORIES[cat];
            const isActive = categoryFilter === cat;
            return (
              <Button key={cat} size="sm" variant={isActive ? "default" : "outline"} className={`h-8 text-xs ${!isActive && config ? config.color : ""}`} onClick={() => setCategoryFilter(cat)} data-testid={`walkthrough-filter-${cat}`}>
                {cat === "all" ? "All" : config?.label || cat}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(w => {
          const catConfig = WALKTHROUGH_CATEGORIES[w.category];
          const stepsCompleted = completedSteps[w.id]?.size || 0;
          const pct = Math.round((stepsCompleted / w.steps.length) * 100);
          return (
            <Card key={w.id} className="shadow-sm hover:shadow-md transition-all cursor-pointer group" onClick={() => setSelectedId(w.id)} data-testid={`walkthrough-card-${w.id}`}>
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-start justify-between mb-3">
                  <Badge variant="outline" className={`text-[10px] ${catConfig?.color || ""}`}>{catConfig?.label || w.category}</Badge>
                  <span className="flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" /> {w.estimatedMinutes} min</span>
                </div>
                <h3 className="font-semibold text-sm text-slate-900 group-hover:text-blue-600 transition-colors mb-1.5">{w.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-3">{w.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{w.steps.length} steps</span>
                  {stepsCompleted > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                      <span className="text-[10px] text-green-600 font-medium">{pct}%</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <Card><CardContent className="py-12 text-center"><p className="text-sm text-muted-foreground">No walkthroughs match your search.</p></CardContent></Card>
      )}
    </div>
  );
}

type OsView = { type: "lifecycle" } | { type: "department"; slug: string } | { type: "process"; slug: string };
type OsMode = "map" | "drilldown";

export default function EeInfoPage() {
  const [activeTab, setActiveTab] = useState("os");
  const [osView, setOsView] = useState<OsView>({ type: "lifecycle" });
  const [osMode, setOsMode] = useState<OsMode>("map");

  const { user } = useAuth();
  const userRole = user?.role || (user as any)?.companyRole || null;
  const isCOO = userRole === "COO_ADMIN" || userRole === "admin" || userRole === "CEO_ADMIN";

  const handleSelectDepartment = (slug: string) => {
    setOsView({ type: "department", slug });
    setActiveTab("os");
  };

  const handleSelectProcess = (slug: string) => {
    setOsView({ type: "process", slug });
    setActiveTab("os");
  };

  const handleBackToLifecycle = () => setOsView({ type: "lifecycle" });

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="ee-info-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Emergent Energy Info</h1>
          <p className="text-xs text-muted-foreground">Operating System, Templates & Walkthroughs</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v === "os") setOsView({ type: "lifecycle" }); }}>
        <TabsList>
          <TabsTrigger value="os" className="gap-1 text-xs" data-testid="tab-os">
            <Network className="h-3.5 w-3.5" /> Operating System
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1 text-xs" data-testid="tab-templates">
            <FileCheck className="h-3.5 w-3.5" /> Templates
          </TabsTrigger>
          <TabsTrigger value="walkthroughs" className="gap-1 text-xs" data-testid="tab-walkthroughs">
            <GraduationCap className="h-3.5 w-3.5" /> Walkthroughs
          </TabsTrigger>
          <TabsTrigger value="simulation" className="gap-1 text-xs" data-testid="tab-simulation">
            <UserCheck className="h-3.5 w-3.5" /> Role Simulation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="os" className="mt-3">
          <div className="flex items-center gap-1.5 mb-3">
            <Button size="sm" variant={osMode === "map" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => setOsMode("map")} data-testid="button-os-map">
              <Layers className="h-3 w-3" /> Overview Map
            </Button>
            <Button size="sm" variant={osMode === "drilldown" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => setOsMode("drilldown")} data-testid="button-os-drilldown">
              <Network className="h-3 w-3" /> Drill Down
            </Button>
          </div>
          {osMode === "map" && (
            <CompanyOverviewMap isCOO={isCOO} userId={user?.id} />
          )}
          {osMode === "drilldown" && (
            <>
              {osView.type === "lifecycle" && (
                <LifecycleOverview
                  onSelectDepartment={handleSelectDepartment}
                  onSelectProcess={handleSelectProcess}
                  isCOO={isCOO}
                />
              )}
              {osView.type === "department" && (
                <DepartmentDrilldown
                  slug={osView.slug}
                  onBack={handleBackToLifecycle}
                  onSelectProcess={handleSelectProcess}
                  isCOO={isCOO}
                />
              )}
              {osView.type === "process" && (
                <ProcessDetailView
                  slug={osView.slug}
                  onBack={handleBackToLifecycle}
                  onSelectDepartment={handleSelectDepartment}
                  onSelectProcess={handleSelectProcess}
                  isCOO={isCOO}
                />
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="templates" className="mt-3">
          <TemplatesLibrary onSelectProcess={(slug) => { handleSelectProcess(slug); setActiveTab("os"); }} />
        </TabsContent>

        <TabsContent value="walkthroughs" className="mt-3">
          <WalkthroughTab />
        </TabsContent>

        <TabsContent value="simulation" className="mt-3">
          <RoleBasedSimulation />
        </TabsContent>
      </Tabs>
    </div>
  );
}
