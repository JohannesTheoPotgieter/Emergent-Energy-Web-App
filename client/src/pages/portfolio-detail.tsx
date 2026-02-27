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
  Briefcase, Search, ArrowRightLeft, CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

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
            <Calendar className="h-3.5 w-3.5" /> Rollout Plan
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
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Phase</TableHead>
                    <TableHead>PM</TableHead>
                    <TableHead className="text-right">Size (kWp)</TableHead>
                    <TableHead className="text-right">Act%</TableHead>
                    <TableHead className="text-right">Exp%</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rollups?.projects || projects).map((p: any) => {
                    const delta = (p.actualPct || 0) - (p.expectedPct || 0);
                    return (
                      <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" data-testid={`row-project-${p.id}`}>
                        <TableCell>
                          <Link href={`/project/${encodeURIComponent(p.projectName)}`}>
                            <span className="font-medium text-primary hover:underline">{p.projectName}</span>
                          </Link>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{p.phase || "—"}</Badge></TableCell>
                        <TableCell className="text-sm">{p.pm || "—"}</TableCell>
                        <TableCell className="text-right text-sm">{parseFloat(p.sizeKwp || "0").toFixed(0)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm font-medium ${delta < -5 ? "text-red-600" : "text-emerald-600"}`}>
                            {(p.actualPct || 0).toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {(p.expectedPct || 0).toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600"
                            onClick={e => { e.stopPropagation(); removeMutation.mutate(p.id); }}
                            data-testid={`button-remove-project-${p.id}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="finance" className="space-y-4">
          <h3 className="font-semibold text-sm">Finance Rollup</h3>
          {rollups ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Card><CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Planned Revenue</div>
                  <div className="text-xl font-bold mt-1">{formatCurrency(rollups.finance?.totalPlannedRevenue || 0)}</div>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Revenue Realised</div>
                  <div className="text-xl font-bold mt-1">{formatCurrency(rollups.finance?.totalActualRevenue || 0)}</div>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Planned Expenses</div>
                  <div className="text-xl font-bold mt-1">{formatCurrency(rollups.finance?.totalPlannedExpenses || 0)}</div>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">COS Realised</div>
                  <div className="text-xl font-bold mt-1">{formatCurrency(rollups.finance?.totalActualExpenses || 0)}</div>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Gross Profit</div>
                  <div className={`text-xl font-bold mt-1 ${(rollups.finance?.grossProfit || 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {formatCurrency(rollups.finance?.grossProfit || 0)}
                  </div>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Gross Margin</div>
                  <div className="text-xl font-bold mt-1">{rollups.finance?.grossMarginPct || 0}%</div>
                </CardContent></Card>
              </div>

              {rollups.projects?.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead className="text-right">Planned Rev</TableHead>
                        <TableHead className="text-right">Actual Rev</TableHead>
                        <TableHead className="text-right">Planned COS</TableHead>
                        <TableHead className="text-right">Actual COS</TableHead>
                        <TableHead className="text-right">GP</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rollups.projects.map((p: any) => (
                        <TableRow key={p.id} data-testid={`row-finance-${p.id}`}>
                          <TableCell>
                            <Link href={`/project/${encodeURIComponent(p.projectName)}`}>
                              <span className="text-primary hover:underline font-medium">{p.projectName}</span>
                            </Link>
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(p.plannedRevenue || 0)}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(p.actualRevenue || 0)}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(p.plannedExpenses || 0)}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(p.actualExpenses || 0)}</TableCell>
                          <TableCell className={`text-right text-sm font-medium ${(p.grossProfit || 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {formatCurrency(p.grossProfit || 0)}
                          </TableCell>
                        </TableRow>
                      ))}
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
              <Card><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Total QC Items</div>
                <div className="text-2xl font-bold mt-1" data-testid="stat-total-qc">{rollups.quality?.totalItems || 0}</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Approved</div>
                <div className="text-2xl font-bold mt-1 text-emerald-600">{rollups.quality?.approvedItems || 0}</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Pending</div>
                <div className="text-2xl font-bold mt-1 text-amber-600">{rollups.quality?.pendingItems || 0}</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Failed / Rejected</div>
                <div className="text-2xl font-bold mt-1 text-red-600">{rollups.quality?.failedItems || 0}</div>
              </CardContent></Card>
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
              <Card><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Total Stages</div>
                <div className="text-2xl font-bold mt-1" data-testid="stat-total-stages">{rollups.engineering?.totalStages || 0}</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Completed</div>
                <div className="text-2xl font-bold mt-1 text-emerald-600">{rollups.engineering?.completedStages || 0}</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">In Progress</div>
                <div className="text-2xl font-bold mt-1 text-blue-600">{rollups.engineering?.inProgressStages || 0}</div>
              </CardContent></Card>
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
            <h3 className="font-semibold text-sm">Rollout Plans</h3>
            <Button size="sm" className="gap-1.5" onClick={() => setRolloutOpen(true)} data-testid="button-add-rollout">
              <Plus className="h-3.5 w-3.5" /> New Rollout Plan
            </Button>
          </div>
          {(portfolio.rolloutPlans || []).length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">
              <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No rollout plans yet. Create one to plan your portfolio phases.
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {portfolio.rolloutPlans.map((rp: any) => (
                <Card key={rp.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{rp.name}</CardTitle>
                    {rp.notes && <p className="text-xs text-muted-foreground">{rp.notes}</p>}
                  </CardHeader>
                  <CardContent>
                    {rp.phases?.length > 0 ? (
                      <div className="space-y-2">
                        {rp.phases.map((ph: any, i: number) => (
                          <div key={ph.id || i} className="flex items-center gap-3 p-2 bg-muted/30 rounded">
                            <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">
                              {i + 1}
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium">{ph.phaseName}</div>
                              {(ph.startDate || ph.endDate) && (
                                <div className="text-xs text-muted-foreground">
                                  {ph.startDate || "TBD"} — {ph.endDate || "TBD"}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No phases defined</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
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
