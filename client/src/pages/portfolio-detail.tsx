import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Plus, Trash2, DollarSign, TrendingUp, TrendingDown, Users,
  ShieldCheck, Wrench, Zap, AlertTriangle, ChevronRight, Edit, Calendar,
  Briefcase, Search, ArrowRightLeft, CheckCircle2, Flag, Layers, Clock, XCircle, Activity,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";

export default function PortfolioDetailPage() {
  const [, params] = useRoute("/portfolios/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isCoo = ["COO_ADMIN", "CEO_ADMIN", "admin"].includes(user?.role || "");
  const portfolioId = parseInt(params?.id || "0");

  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [rolloutOpen, setRolloutOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [editData, setEditData] = useState<any>({});
  const [rolloutData, setRolloutData] = useState({ name: "", notes: "", phases: [{ phaseName: "", startDate: "", endDate: "" }] });

  const { data: portfolio, isLoading } = useQuery<any>({
    queryKey: ["/api/portfolios", portfolioId],
    queryFn: () => fetch(`/api/portfolios/${portfolioId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!portfolioId,
  });

  const { data: rollups } = useQuery<any>({
    queryKey: ["/api/portfolios", portfolioId, "rollups"],
    queryFn: () => fetch(`/api/portfolios/${portfolioId}/rollups`, { credentials: "include" }).then(r => r.json()),
    enabled: !!portfolioId,
  });

  const { data: availableProjects } = useQuery<any[]>({
    queryKey: ["/api/portfolios", portfolioId, "available-projects"],
    queryFn: () => fetch(`/api/portfolios/${portfolioId}/available-projects`, { credentials: "include" }).then(r => r.json()),
    enabled: assignOpen,
  });

  const { data: allProjectsSummary = [] } = useQuery<any[]>({
    queryKey: ["/api/projects-summary"],
    queryFn: () => fetch("/api/projects-summary", { credentials: "include" }).then(r => r.json()),
    enabled: !!portfolioId,
  });

  const { data: portfolioKeyDates } = useQuery<any[]>({
    queryKey: ["/api/portfolios", portfolioId, "key-dates"],
    queryFn: () => fetch(`/api/portfolios/${portfolioId}/key-dates`, { credentials: "include" }).then(r => r.json()),
    enabled: !!portfolioId,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/portfolios/${portfolioId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId] });
      setEditOpen(false);
      toast({ title: "Portfolio updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const res = await fetch(`/api/portfolios/${portfolioId}/assign-project`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId] });
      qc.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId, "rollups"] });
      qc.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId, "available-projects"] });
      toast({ title: "Project assigned" });
    },
    onError: (err: any) => toast({ title: "Cannot assign", description: err.message, variant: "destructive" }),
  });

  const moveMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const res = await fetch(`/api/portfolios/${portfolioId}/move-project`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Move failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId] });
      qc.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId, "rollups"] });
      qc.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId, "available-projects"] });
      toast({ title: "Project moved", description: "Project has been moved to this portfolio (COO action)" });
    },
    onError: (err: any) => toast({ title: "Cannot move", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const res = await fetch(`/api/portfolios/${portfolioId}/remove-project/${projectId}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId] });
      qc.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId, "rollups"] });
      toast({ title: "Project removed from portfolio" });
    },
  });

  const createRolloutMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/portfolios/${portfolioId}/rollout-plans`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId] });
      setRolloutOpen(false);
      setRolloutData({ name: "", notes: "", phases: [{ phaseName: "", startDate: "", endDate: "" }] });
      toast({ title: "Rollout plan created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const formatCurrency = (v: number) => {
    if (Math.abs(v) >= 1e6) return `R ${(v / 1e6).toFixed(2)}M`;
    if (Math.abs(v) >= 1e3) return `R ${(v / 1e3).toFixed(0)}K`;
    return `R ${v.toFixed(0)}`;
  };

  const portfolioProjectNames = useMemo(() => {
    const names = new Set((portfolio?.projects || []).map((p: any) => p.projectName));
    return names;
  }, [portfolio]);

  const portfolioProjectsSummary = useMemo(() => {
    if (!allProjectsSummary.length || !portfolioProjectNames.size) return [];
    return allProjectsSummary.filter((p: any) => portfolioProjectNames.has(p.project_name));
  }, [allProjectsSummary, portfolioProjectNames]);

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    try { return format(new Date(d), "dd MMM yy"); } catch { return d; }
  };
  const formatPct = (v: number | null) => {
    if (v == null) return "—";
    return `${(v * 100).toFixed(1)}%`;
  };
  const phaseConfig = (phase: string | null) => {
    const p = (phase || "").toLowerCase();
    if (p.includes("construction") && !p.includes("close")) return { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500" };
    if (p.includes("qa") || p.includes("quality")) return { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", dot: "bg-purple-500" };
    if (p.includes("handover")) return { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", dot: "bg-green-500" };
    if (p.includes("dlp")) return { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" };
    if (p.includes("commercial")) return { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", dot: "bg-teal-500" };
    if (p.includes("financial")) return { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", dot: "bg-indigo-500" };
    if (p.includes("hold")) return { bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-200", dot: "bg-slate-400" };
    return { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", dot: "bg-gray-500" };
  };
  const deltaColor = (val: number) => {
    if (val <= -10) return { text: "text-red-700", bg: "bg-red-50" };
    if (val < -5) return { text: "text-orange-600", bg: "bg-orange-50" };
    if (val < 0) return { text: "text-amber-600", bg: "bg-amber-50" };
    return { text: "text-emerald-600", bg: "bg-emerald-50" };
  };
  const truncateName = (name: string | null, max: number) => {
    if (!name) return "—";
    return name.length > max ? name.slice(0, max) + "…" : name;
  };
  const cleanName = (name: string) => name.replace(/_Tracker.*$/i, "").replace(/_/g, " ");

  const filteredAvailable = useMemo(() => {
    if (!availableProjects) return [];
    return availableProjects.filter(p =>
      !assignSearch || p.projectName.toLowerCase().includes(assignSearch.toLowerCase())
    );
  }, [availableProjects, assignSearch]);

  if (isLoading) return <div className="text-center py-20 text-muted-foreground">Loading portfolio...</div>;
  if (!portfolio || portfolio.error) return <div className="text-center py-20 text-red-500">Portfolio not found</div>;

  const projects = portfolio.projects || [];

  return (
    <div className="space-y-6" data-testid="page-portfolio-detail">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/portfolios")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold" data-testid="text-portfolio-name">{portfolio.name}</h1>
            <Badge variant="outline">{portfolio.status}</Badge>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
            {portfolio.clientName && <span>Client: {portfolio.clientName}</span>}
            {portfolio.ownerName && <span>Owner: {portfolio.ownerName}</span>}
            <span>{projects.length} projects</span>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setEditData({ name: portfolio.name, clientName: portfolio.clientName || "", status: portfolio.status, description: portfolio.description || "" }); setEditOpen(true); }} data-testid="button-edit-portfolio">
          <Edit className="h-3.5 w-3.5" /> Edit
        </Button>
      </div>

      {rollups && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Projects</div>
              <div className="text-2xl font-bold mt-1" data-testid="stat-project-count">{rollups.projects?.length || 0}</div>
              <div className="text-xs text-muted-foreground">{rollups.schedule?.behindCount || 0} behind schedule</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Avg Progress</div>
              <div className="text-2xl font-bold mt-1" data-testid="stat-avg-progress">{rollups.schedule?.avgActualPct || 0}%</div>
              <div className="text-xs text-muted-foreground">Expected: {rollups.schedule?.avgExpectedPct || 0}%</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Revenue</div>
              <div className="text-2xl font-bold mt-1" data-testid="stat-revenue">{formatCurrency(rollups.finance?.totalActualRevenue || 0)}</div>
              <div className="text-xs text-muted-foreground">of {formatCurrency(rollups.finance?.totalPlannedRevenue || 0)} planned</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Gross Profit</div>
              <div className={`text-2xl font-bold mt-1 ${(rollups.finance?.grossProfit || 0) >= 0 ? "text-emerald-600" : "text-red-600"}`} data-testid="stat-gross-profit">
                {formatCurrency(rollups.finance?.grossProfit || 0)}
              </div>
              <div className="text-xs text-muted-foreground">{rollups.finance?.grossMarginPct || 0}% margin</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="projects" className="space-y-4">
        <TabsList>
          <TabsTrigger value="projects" className="gap-1.5" data-testid="tab-projects">
            <Briefcase className="h-3.5 w-3.5" /> Project Management
          </TabsTrigger>
          <TabsTrigger value="finance" className="gap-1.5" data-testid="tab-finance">
            <DollarSign className="h-3.5 w-3.5" /> Finance
          </TabsTrigger>
          <TabsTrigger value="quality" className="gap-1.5" data-testid="tab-quality">
            <ShieldCheck className="h-3.5 w-3.5" /> Quality
          </TabsTrigger>
          <TabsTrigger value="engineering" className="gap-1.5" data-testid="tab-engineering">
            <Wrench className="h-3.5 w-3.5" /> Engineering
          </TabsTrigger>
          <TabsTrigger value="rollout" className="gap-1.5" data-testid="tab-rollout">
            <Calendar className="h-3.5 w-3.5" /> Project Plan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Assigned Projects</h3>
            <Button size="sm" className="gap-1.5" onClick={() => setAssignOpen(true)} data-testid="button-add-projects">
              <Plus className="h-3.5 w-3.5" /> Add Projects
            </Button>
          </div>
          {projects.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                No projects assigned yet. Click "Add Projects" to get started.
              </CardContent>
            </Card>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b bg-slate-50/80">
                    <th className="text-left px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap sticky left-0 bg-slate-50/80 z-10 min-w-[140px]">Project</th>
                    <th className="text-left px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Phase</th>
                    <th className="text-left px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">PM</th>
                    <th className="text-left px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">PD</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">kWp</th>
                    <th className="text-left px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">C.Start</th>
                    <th className="text-left px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Comm.</th>
                    <th className="text-left px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Client</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Days</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Act%</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Exp%</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Delta</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Revenue</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Expenses</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">GP%</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {(portfolioProjectsSummary.length > 0 ? portfolioProjectsSummary : (rollups?.projects || projects)).map((p: any) => {
                    const isSummaryRow = !!p.project_name;
                    const name = isSummaryRow ? p.project_name : p.projectName;
                    const phase = p.phase;
                    const pm = p.pm;
                    const pd = isSummaryRow ? p.pd : p.pd;
                    const sizeKwp = isSummaryRow ? p.size_kwp : parseFloat(p.sizeKwp || "0");
                    const constructionStart = isSummaryRow ? p.construction_start_date : null;
                    const commDate = isSummaryRow ? p.commissioning_date : null;
                    const clientDate = isSummaryRow ? p.client_handover_date : null;
                    const duration = isSummaryRow ? p.duration : null;
                    const actPct = isSummaryRow ? (p.project_pct_complete != null ? p.project_pct_complete * 100 : 0) : (p.actualPct || 0);
                    const expPct = isSummaryRow ? (p.expected_pct_complete != null ? p.expected_pct_complete * 100 : 0) : (p.expectedPct || 0);
                    const deltaVal = isSummaryRow ? (p.delta_vs_expected != null ? p.delta_vs_expected * 100 : 0) : ((p.actualPct || 0) - (p.expectedPct || 0));
                    const revenue = isSummaryRow ? p.actual_revenue : p.actualRevenue;
                    const expenses = isSummaryRow ? p.actual_expenses : p.actualExpenses;
                    const gpPct = isSummaryRow ? (p.gp_percent != null ? p.gp_percent * 100 : null) : null;
                    const projectId = isSummaryRow ? p.project_info_id : p.id;
                    const phaseCfg = phaseConfig(phase);
                    const dColor = deltaColor(deltaVal);
                    const DeltaIcon = deltaVal >= 0 ? TrendingUp : TrendingDown;
                    const fmtMoney = (v: number | null) => {
                      if (v == null || v === 0) return <span className="text-slate-400">—</span>;
                      return <span className="font-mono text-slate-700">R{v.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
                    };

                    return (
                      <tr key={projectId || name} className="border-b hover:bg-slate-50/50 transition-colors" data-testid={`row-project-${projectId}`}>
                        <td className="px-2 py-2 sticky left-0 bg-white z-10">
                          <Link href={`/project/${encodeURIComponent(name)}`}>
                            <span className="font-semibold text-blue-700 hover:text-blue-900 hover:underline truncate max-w-[140px] block" title={cleanName(name)} data-testid={`link-project-${name}`}>
                              {cleanName(name)}
                            </span>
                          </Link>
                        </td>
                        <td className="px-2 py-2">
                          <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${phaseCfg.bg} ${phaseCfg.text} ${phaseCfg.border}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${phaseCfg.dot}`} />
                            {phase || "—"}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-slate-600 whitespace-nowrap" title={pm || ""}>{truncateName(pm, 14)}</td>
                        <td className="px-2 py-2 text-slate-600 whitespace-nowrap" title={pd || ""}>{truncateName(pd, 12)}</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-700">{sizeKwp ? sizeKwp.toFixed(0) : "—"}</td>
                        <td className="px-2 py-2 text-slate-600 whitespace-nowrap">{formatDate(constructionStart)}</td>
                        <td className="px-2 py-2 text-slate-600 whitespace-nowrap">{formatDate(commDate)}</td>
                        <td className="px-2 py-2 text-slate-600 whitespace-nowrap">{formatDate(clientDate)}</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-600">{duration != null ? duration : "—"}</td>
                        <td className="px-2 py-2 text-right">
                          <span className={`font-mono font-semibold ${deltaVal < -5 ? "text-red-600" : "text-emerald-600"}`}>
                            {actPct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-slate-600">{expPct.toFixed(1)}%</td>
                        <td className="px-2 py-2 text-right">
                          {deltaVal !== 0 ? (
                            <span className={`inline-flex items-center gap-0.5 font-mono font-semibold px-1 py-0.5 rounded-md ${dColor.text} ${dColor.bg}`}>
                              <DeltaIcon className="w-3 h-3" />
                              {deltaVal >= 0 ? "+" : ""}{deltaVal.toFixed(1)}%
                            </span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right">{fmtMoney(revenue)}</td>
                        <td className="px-2 py-2 text-right">{fmtMoney(expenses)}</td>
                        <td className="px-2 py-2 text-right">
                          {gpPct != null ? (
                            <span className={`font-mono font-semibold ${gpPct >= 20 ? "text-emerald-600" : gpPct >= 0 ? "text-amber-600" : "text-red-600"}`}>
                              {gpPct.toFixed(1)}%
                            </span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600"
                            onClick={e => { e.stopPropagation(); if (projectId) removeMutation.mutate(projectId); }}
                            data-testid={`button-remove-project-${projectId}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="finance" className="space-y-4">
          <h3 className="font-semibold text-sm">Finance Rollup</h3>
          {rollups ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Card className="border-emerald-200 bg-emerald-50/40">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <DollarSign className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div className="text-xs font-medium text-emerald-700 uppercase tracking-wider">Costed Revenue</div>
                    </div>
                    <div className="text-xl font-bold mt-2 text-emerald-900" data-testid="stat-costed-revenue">{formatCurrency(rollups.finance?.totalPlannedRevenue || 0)}</div>
                  </CardContent>
                </Card>
                <Card className="border-green-200 bg-green-50/40">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-green-100 flex items-center justify-center">
                        <TrendingUp className="h-4 w-4 text-green-600" />
                      </div>
                      <div className="text-xs font-medium text-green-700 uppercase tracking-wider">Actual Revenue</div>
                    </div>
                    <div className="text-xl font-bold mt-2 text-green-900" data-testid="stat-actual-revenue">{formatCurrency(rollups.finance?.totalActualRevenue || 0)}</div>
                  </CardContent>
                </Card>
                <Card className="border-orange-200 bg-orange-50/40">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-orange-100 flex items-center justify-center">
                        <Briefcase className="h-4 w-4 text-orange-600" />
                      </div>
                      <div className="text-xs font-medium text-orange-700 uppercase tracking-wider">Costed Expenses</div>
                    </div>
                    <div className="text-xl font-bold mt-2 text-orange-900" data-testid="stat-costed-expenses">{formatCurrency(rollups.finance?.totalPlannedExpenses || 0)}</div>
                  </CardContent>
                </Card>
                <Card className="border-red-200 bg-red-50/40">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-red-100 flex items-center justify-center">
                        <TrendingDown className="h-4 w-4 text-red-600" />
                      </div>
                      <div className="text-xs font-medium text-red-700 uppercase tracking-wider">Actual Expenses</div>
                    </div>
                    <div className="text-xl font-bold mt-2 text-red-900" data-testid="stat-actual-expenses">{formatCurrency(rollups.finance?.totalActualExpenses || 0)}</div>
                  </CardContent>
                </Card>
                <Card className={`${(rollups.finance?.grossProfit || 0) >= 0 ? "border-blue-200 bg-blue-50/40" : "border-red-200 bg-red-50/40"}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${(rollups.finance?.grossProfit || 0) >= 0 ? "bg-blue-100" : "bg-red-100"}`}>
                        <Zap className={`h-4 w-4 ${(rollups.finance?.grossProfit || 0) >= 0 ? "text-blue-600" : "text-red-600"}`} />
                      </div>
                      <div className={`text-xs font-medium uppercase tracking-wider ${(rollups.finance?.grossProfit || 0) >= 0 ? "text-blue-700" : "text-red-700"}`}>Gross Profit</div>
                    </div>
                    <div className={`text-xl font-bold mt-2 ${(rollups.finance?.grossProfit || 0) >= 0 ? "text-emerald-600" : "text-red-600"}`} data-testid="stat-finance-gp">
                      {formatCurrency(rollups.finance?.grossProfit || 0)}
                    </div>
                  </CardContent>
                </Card>
                <Card className={`${(rollups.finance?.grossMarginPct || 0) >= 0 ? "border-indigo-200 bg-indigo-50/40" : "border-red-200 bg-red-50/40"}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${(rollups.finance?.grossMarginPct || 0) >= 0 ? "bg-indigo-100" : "bg-red-100"}`}>
                        <Flag className={`h-4 w-4 ${(rollups.finance?.grossMarginPct || 0) >= 0 ? "text-indigo-600" : "text-red-600"}`} />
                      </div>
                      <div className={`text-xs font-medium uppercase tracking-wider ${(rollups.finance?.grossMarginPct || 0) >= 0 ? "text-indigo-700" : "text-red-700"}`}>Gross Margin</div>
                    </div>
                    <div className={`text-xl font-bold mt-2 ${(rollups.finance?.grossMarginPct || 0) >= 20 ? "text-emerald-600" : (rollups.finance?.grossMarginPct || 0) >= 0 ? "text-amber-600" : "text-red-600"}`} data-testid="stat-finance-margin">
                      {rollups.finance?.grossMarginPct || 0}%
                    </div>
                  </CardContent>
                </Card>
              </div>

              {rollups.projects?.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80">
                        <TableHead className="font-semibold text-slate-600">Project</TableHead>
                        <TableHead className="text-right font-semibold text-emerald-700">Costed Rev</TableHead>
                        <TableHead className="text-right font-semibold text-green-700">Actual Rev</TableHead>
                        <TableHead className="text-right font-semibold text-orange-700">Costed COS</TableHead>
                        <TableHead className="text-right font-semibold text-red-700">Actual COS</TableHead>
                        <TableHead className="text-right font-semibold text-blue-700">GP</TableHead>
                        <TableHead className="text-right font-semibold text-indigo-700">GP%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rollups.projects.map((p: any) => {
                        const pGp = (p.actualRevenue || 0) - (p.actualExpenses || 0);
                        const pGpPct = (p.actualRevenue || 0) > 0 ? (pGp / (p.actualRevenue || 1)) * 100 : 0;
                        return (
                          <TableRow key={p.id} className="hover:bg-slate-50/60 transition-colors" data-testid={`row-finance-${p.id}`}>
                            <TableCell className="py-3">
                              <Link href={`/project/${encodeURIComponent(p.projectName)}`}>
                                <span className="text-blue-700 hover:text-blue-900 hover:underline font-medium">{cleanName(p.projectName)}</span>
                              </Link>
                            </TableCell>
                            <TableCell className="text-right text-sm font-mono py-3">{formatCurrency(p.plannedRevenue || 0)}</TableCell>
                            <TableCell className="text-right text-sm font-mono py-3">{formatCurrency(p.actualRevenue || 0)}</TableCell>
                            <TableCell className="text-right text-sm font-mono py-3">{formatCurrency(p.plannedExpenses || 0)}</TableCell>
                            <TableCell className="text-right text-sm font-mono py-3">{formatCurrency(p.actualExpenses || 0)}</TableCell>
                            <TableCell className={`text-right text-sm font-mono font-semibold py-3 ${pGp >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                              {formatCurrency(pGp)}
                            </TableCell>
                            <TableCell className={`text-right text-sm font-mono font-semibold py-3 ${pGpPct >= 20 ? "text-emerald-600" : pGpPct >= 0 ? "text-amber-600" : "text-red-600"}`}>
                              {pGpPct.toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          ) : (
            <Card><CardContent className="py-10 text-center text-muted-foreground">Loading finance data...</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="quality" className="space-y-4">
          <h3 className="font-semibold text-sm">Quality Rollup</h3>
          {rollups ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="border-0 shadow-sm bg-blue-50/80">
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg p-1.5 bg-blue-200/60">
                      <Layers className="h-4 w-4 text-blue-700" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total QC Items</div>
                      <div className="text-lg font-bold mt-0.5 leading-tight text-blue-700" data-testid="stat-total-qc">{rollups.quality?.totalItems || 0}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm bg-emerald-50/80">
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg p-1.5 bg-emerald-200/60">
                      <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Approved</div>
                      <div className="text-lg font-bold mt-0.5 leading-tight text-emerald-700">{rollups.quality?.approvedItems || 0}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm bg-amber-50/80">
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg p-1.5 bg-amber-200/60">
                      <Clock className="h-4 w-4 text-amber-700" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Pending</div>
                      <div className="text-lg font-bold mt-0.5 leading-tight text-amber-700">{rollups.quality?.pendingItems || 0}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm bg-red-50/80">
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg p-1.5 bg-red-200/60">
                      <XCircle className="h-4 w-4 text-red-700" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Failed / Rejected</div>
                      <div className="text-lg font-bold mt-0.5 leading-tight text-red-700">{rollups.quality?.failedItems || 0}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card><CardContent className="py-10 text-center text-muted-foreground">Loading quality data...</CardContent></Card>
          )}
          {rollups?.quality?.totalItems === 0 && (
            <Card><CardContent className="py-8 text-center text-muted-foreground">
              <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No quality checklist data available for this portfolio's projects.
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="engineering" className="space-y-4">
          <h3 className="font-semibold text-sm">Engineering Rollup</h3>
          {rollups ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card className="border-0 shadow-sm bg-blue-50/80">
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg p-1.5 bg-blue-200/60">
                      <Layers className="h-4 w-4 text-blue-700" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Stages</div>
                      <div className="text-lg font-bold mt-0.5 leading-tight text-blue-700" data-testid="stat-total-stages">{rollups.engineering?.totalStages || 0}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm bg-emerald-50/80">
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg p-1.5 bg-emerald-200/60">
                      <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Completed</div>
                      <div className="text-lg font-bold mt-0.5 leading-tight text-emerald-700">{rollups.engineering?.completedStages || 0}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm bg-indigo-50/80">
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg p-1.5 bg-indigo-200/60">
                      <Activity className="h-4 w-4 text-indigo-700" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">In Progress</div>
                      <div className="text-lg font-bold mt-0.5 leading-tight text-indigo-700">{rollups.engineering?.inProgressStages || 0}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card><CardContent className="py-10 text-center text-muted-foreground">Loading engineering data...</CardContent></Card>
          )}
          {rollups?.engineering?.totalStages === 0 && (
            <Card><CardContent className="py-8 text-center text-muted-foreground">
              <Wrench className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No engineering stage data available for this portfolio's projects.
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="rollout" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm">Portfolio Project Plan</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Key milestone dates across all projects in this portfolio</p>
            </div>
          </div>
          {!portfolioKeyDates ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">
              <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40 animate-pulse" />
              Loading project plan data...
            </CardContent></Card>
          ) : portfolioKeyDates.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">
              <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No projects assigned to this portfolio yet.
            </CardContent></Card>
          ) : (
            <>
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]" data-testid="table-portfolio-plan">
                      <thead>
                        <tr className="border-b bg-slate-50/80">
                          <th className="text-left px-3 py-2.5 font-semibold text-gray-600 sticky left-0 bg-slate-50/80 z-10 min-w-[160px]">Project</th>
                          <th className="text-center px-2 py-2.5 font-semibold text-gray-600 min-w-[60px]">Phase</th>
                          <th className="text-center px-2 py-2.5 font-semibold text-gray-600 min-w-[50px]">Act%</th>
                          <th className="text-center px-2 py-2.5 font-semibold text-gray-500 min-w-[80px]">Start</th>
                          <th className="text-center px-2 py-2.5 font-medium text-indigo-600 min-w-[80px]">PD Handover</th>
                          <th className="text-center px-2 py-2.5 font-medium text-blue-600 min-w-[80px]">Construction Start</th>
                          <th className="text-center px-2 py-2.5 font-medium text-amber-600 min-w-[80px]">Commissioning</th>
                          <th className="text-center px-2 py-2.5 font-medium text-green-600 min-w-[80px]">Practical Completion</th>
                          <th className="text-center px-2 py-2.5 font-medium text-purple-600 min-w-[80px]">O&M Handover</th>
                          <th className="text-center px-2 py-2.5 font-medium text-rose-600 min-w-[80px]">Client Handover</th>
                          <th className="text-center px-2 py-2.5 font-semibold text-gray-500 min-w-[80px]">End</th>
                        </tr>
                      </thead>
                      <tbody>
                        {portfolioKeyDates.map((proj: any, idx: number) => {
                          const kd = (name: string) => {
                            const found = proj.keyDates?.find((d: any) => d.keyDateName === name);
                            return found || null;
                          };
                          const fmtDate = (d: string | null) => {
                            if (!d) return null;
                            try {
                              return format(new Date(d + 'T00:00:00'), 'dd MMM yy');
                            } catch { return d; }
                          };
                          const isPast = (d: string | null) => {
                            if (!d) return false;
                            return d < new Date().toISOString().split('T')[0];
                          };
                          const isUpcoming = (d: string | null) => {
                            if (!d) return false;
                            const now = new Date();
                            const dateObj = new Date(d + 'T00:00:00');
                            const diff = (dateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
                            return diff >= 0 && diff <= 30;
                          };

                          const renderDateCell = (keyDateName: string, colorClass: string) => {
                            const dateInfo = kd(keyDateName);
                            const date = dateInfo?.effectiveDate;
                            const linked = dateInfo?.linked;
                            if (!date) {
                              return (
                                <td className="text-center px-2 py-2.5">
                                  <span className="text-gray-300">—</span>
                                </td>
                              );
                            }
                            const upcoming = isUpcoming(date);
                            const past = isPast(date);
                            return (
                              <td className="text-center px-2 py-2.5">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  upcoming ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300' :
                                  past ? `${colorClass} opacity-70` :
                                  colorClass
                                }`}>
                                  {fmtDate(date)}
                                </span>
                              </td>
                            );
                          };

                          const progressColor = proj.actualPct >= 90 ? 'text-green-700 bg-green-100' :
                                                proj.actualPct >= 50 ? 'text-blue-700 bg-blue-100' :
                                                proj.actualPct > 0 ? 'text-amber-700 bg-amber-100' : 'text-gray-500 bg-gray-100';

                          return (
                            <tr
                              key={proj.projectId}
                              className={`border-b ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} hover:bg-blue-50/40 transition-colors`}
                              data-testid={`plan-row-${proj.projectId}`}
                            >
                              <td className="px-3 py-2.5 sticky left-0 bg-inherit z-10">
                                <Link href={`/project/${encodeURIComponent(proj.projectName)}`} className="hover:underline">
                                  <div className="font-medium text-gray-800 text-xs">{proj.projectName}</div>
                                </Link>
                                <div className="text-[10px] text-gray-400 mt-0.5">{proj.pm || '—'} · {parseFloat(proj.sizeKwp || '0').toFixed(0)} kWp</div>
                              </td>
                              <td className="text-center px-2 py-2.5">
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0">{proj.phase || '—'}</Badge>
                              </td>
                              <td className="text-center px-2 py-2.5">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${progressColor}`}>
                                  {Math.round(proj.actualPct)}%
                                </span>
                              </td>
                              <td className="text-center px-2 py-2.5">
                                <span className="text-[10px] text-gray-500">{fmtDate(proj.projectStart)}</span>
                              </td>
                              {renderDateCell("PD Handover", "bg-indigo-50 text-indigo-700")}
                              {renderDateCell("Construction Start", "bg-blue-50 text-blue-700")}
                              {renderDateCell("Commissioning", "bg-amber-50 text-amber-700")}
                              {renderDateCell("Practical Completion", "bg-green-50 text-green-700")}
                              {renderDateCell("O&M Handover", "bg-purple-50 text-purple-700")}
                              {renderDateCell("Client Handover", "bg-rose-50 text-rose-700")}
                              <td className="text-center px-2 py-2.5">
                                <span className="text-[10px] text-gray-500">{fmtDate(proj.projectEnd)}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <div className="flex items-center gap-6 px-2 text-[10px] text-gray-400">
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded bg-amber-100 ring-1 ring-amber-300" />
                  <span>Within 30 days</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded bg-gray-100" />
                  <span>Past date</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-300">—</span>
                  <span>Not linked / no data</span>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent data-testid="dialog-edit-portfolio">
          <DialogHeader><DialogTitle>Edit Portfolio</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Portfolio Name</label>
              <Input value={editData.name || ""} onChange={e => setEditData((d: any) => ({ ...d, name: e.target.value }))} data-testid="input-edit-name" />
            </div>
            <div>
              <label className="text-sm font-medium">Client Name</label>
              <Input value={editData.clientName || ""} onChange={e => setEditData((d: any) => ({ ...d, clientName: e.target.value }))} data-testid="input-edit-client" />
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <Select value={editData.status || "Active"} onValueChange={v => setEditData((d: any) => ({ ...d, status: v }))}>
                <SelectTrigger data-testid="select-edit-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="On Hold">On Hold</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea value={editData.description || ""} onChange={e => setEditData((d: any) => ({ ...d, description: e.target.value }))} rows={3} data-testid="input-edit-description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate(editData)} disabled={updateMutation.isPending} data-testid="button-save-edit">
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" data-testid="dialog-assign-projects">
          <DialogHeader><DialogTitle>Add Projects to Portfolio</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search projects..." value={assignSearch} onChange={e => setAssignSearch(e.target.value)} className="pl-8" data-testid="input-search-assign" />
          </div>
          <div className="flex-1 overflow-y-auto max-h-[50vh] space-y-1">
            {filteredAvailable.map(p => {
              const isAssignedHere = portfolio.projects?.some((pp: any) => pp.id === p.id);
              const isAssignedElsewhere = p.assignedPortfolioId && p.assignedPortfolioId !== portfolioId;
              return (
                <div key={p.id} className={`flex items-center gap-3 p-2.5 rounded-lg border ${isAssignedHere ? "bg-emerald-50 border-emerald-200" : isAssignedElsewhere ? "bg-amber-50/50 border-amber-100" : "hover:bg-muted/50"}`} data-testid={`assign-project-${p.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.projectName}</div>
                    <div className="text-xs text-muted-foreground">{p.phase || "—"} · {p.pm || "No PM"} · {parseFloat(p.sizeKwp || "0").toFixed(0)} kWp</div>
                  </div>
                  {isAssignedHere ? (
                    <Badge variant="outline" className="bg-emerald-100 text-emerald-700 text-xs shrink-0">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Assigned
                    </Badge>
                  ) : isAssignedElsewhere ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className="bg-amber-100 text-amber-700 text-xs">
                        In: {p.assignedPortfolioName}
                      </Badge>
                      {isCoo && (
                        <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
                          onClick={() => moveMutation.mutate(p.id)}
                          disabled={moveMutation.isPending}
                          data-testid={`button-move-${p.id}`}>
                          <ArrowRightLeft className="h-3 w-3 mr-1" /> Move here
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs"
                      onClick={() => assignMutation.mutate(p.id)}
                      disabled={assignMutation.isPending}
                      data-testid={`button-assign-${p.id}`}>
                      <Plus className="h-3 w-3 mr-1" /> Add
                    </Button>
                  )}
                </div>
              );
            })}
            {filteredAvailable.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">No projects found</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rolloutOpen} onOpenChange={setRolloutOpen}>
        <DialogContent data-testid="dialog-create-rollout">
          <DialogHeader><DialogTitle>Create Rollout Plan</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Plan Name *</label>
              <Input value={rolloutData.name} onChange={e => setRolloutData(d => ({ ...d, name: e.target.value }))} placeholder="e.g., Phase 1 Rollout" data-testid="input-rollout-name" />
            </div>
            <div>
              <label className="text-sm font-medium">Notes</label>
              <Textarea value={rolloutData.notes} onChange={e => setRolloutData(d => ({ ...d, notes: e.target.value }))} rows={2} data-testid="input-rollout-notes" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Phases</label>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRolloutData(d => ({ ...d, phases: [...d.phases, { phaseName: "", startDate: "", endDate: "" }] }))} data-testid="button-add-phase">
                  <Plus className="h-3 w-3 mr-1" /> Add Phase
                </Button>
              </div>
              <div className="space-y-2">
                {rolloutData.phases.map((ph, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2">
                    <Input placeholder="Phase name" value={ph.phaseName} onChange={e => { const phases = [...rolloutData.phases]; phases[i] = { ...phases[i], phaseName: e.target.value }; setRolloutData(d => ({ ...d, phases })); }} data-testid={`input-phase-name-${i}`} />
                    <Input type="date" value={ph.startDate} onChange={e => { const phases = [...rolloutData.phases]; phases[i] = { ...phases[i], startDate: e.target.value }; setRolloutData(d => ({ ...d, phases })); }} data-testid={`input-phase-start-${i}`} />
                    <Input type="date" value={ph.endDate} onChange={e => { const phases = [...rolloutData.phases]; phases[i] = { ...phases[i], endDate: e.target.value }; setRolloutData(d => ({ ...d, phases })); }} data-testid={`input-phase-end-${i}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRolloutOpen(false)}>Cancel</Button>
            <Button onClick={() => createRolloutMutation.mutate(rolloutData)} disabled={!rolloutData.name.trim() || createRolloutMutation.isPending} data-testid="button-create-rollout">
              {createRolloutMutation.isPending ? "Creating..." : "Create Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
