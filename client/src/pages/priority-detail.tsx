import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Flag, ArrowLeft, Clock, AlertTriangle, Plus, X, Search, DollarSign, ListTodo, MessageSquare, FolderOpen, CheckCircle2, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

const token = () => localStorage.getItem("auth_token") || "";

const HEALTH_DOT: Record<string, string> = {
  critical: "bg-red-500",
  at_risk: "bg-amber-500",
  healthy: "bg-emerald-500",
};

const SEVERITY_BADGE: Record<string, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-red-100 text-red-700" },
  important: { label: "High", className: "bg-amber-100 text-amber-700" },
  normal: { label: "Normal", className: "bg-gray-100 text-gray-600" },
};

const RAG_BADGE: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  orange: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
};

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `R ${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `R ${(value / 1_000).toFixed(0)}K`;
  return `R ${value.toFixed(0)}`;
}

function daysRemaining(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const now = new Date();
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function ProjectLinker({ priorityId, existingProjectIds, onDone }: { priorityId: number; existingProjectIds: number[]; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const queryClient = useQueryClient();

  const { data: allProjects = [] } = useQuery<any[]>({
    queryKey: ["/api/v2/projects", "linker"],
    queryFn: async () => {
      const res = await fetch("/api/v2/projects?pageSize=100", { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) return [];
      const data = await res.json();
      return data.data?.rows || [];
    },
  });

  const available = useMemo(() => {
    const existingSet = new Set(existingProjectIds);
    return allProjects
      .filter(p => !existingSet.has(p.id))
      .filter(p => !search || p.projectName?.toLowerCase().includes(search.toLowerCase()));
  }, [allProjects, existingProjectIds, search]);

  const linkMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/priorities/${priorityId}/projects`, { project_ids: selected });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}`] });
      onDone();
    },
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
      </div>
      <div className="max-h-60 overflow-y-auto space-y-1">
        {available.map(p => (
          <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={e => {
                if (e.target.checked) setSelected([...selected, p.id]);
                else setSelected(selected.filter(id => id !== p.id));
              }}
              className="rounded"
            />
            <span>{p.projectName}</span>
          </label>
        ))}
        {available.length === 0 && <p className="text-sm text-muted-foreground py-2 text-center">No available projects</p>}
      </div>
      <Button size="sm" disabled={selected.length === 0 || linkMutation.isPending} onClick={() => linkMutation.mutate()}>
        Link {selected.length} project{selected.length !== 1 ? "s" : ""}
      </Button>
    </div>
  );
}

export default function PriorityDetailPage() {
  const [, params] = useRoute("/priorities/:id");
  const priorityId = params?.id ? parseInt(params.id) : 0;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const isAdmin = user?.role && ["admin", "COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"].includes(user.role);

  const { data: priority, isLoading } = useQuery<any>({
    queryKey: [`/api/priorities/${priorityId}`],
    queryFn: async () => {
      const res = await fetch(`/api/priorities/${priorityId}`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: priorityId > 0,
  });

  const { data: tasks = [] } = useQuery<any[]>({
    queryKey: [`/api/priorities/${priorityId}/tasks`],
    queryFn: async () => {
      const res = await fetch(`/api/priorities/${priorityId}/tasks`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: priorityId > 0 && !!priority?.hasProjects,
  });

  const { data: pendingApprovals = [] } = useQuery<any[]>({
    queryKey: [`/api/priorities/${priorityId}/approvals`],
    queryFn: async () => {
      const res = await fetch(`/api/priorities/${priorityId}/approvals`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: priorityId > 0 && !!priority?.hasProjects,
  });

  const { data: updates = [] } = useQuery<any[]>({
    queryKey: [`/api/priorities/${priorityId}/updates`],
    queryFn: async () => {
      const res = await fetch(`/api/priorities/${priorityId}/updates`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: priorityId > 0 && !!priority?.hasProjects,
  });

  const unlinkMutation = useMutation({
    mutationFn: async (projectId: number) => {
      await apiRequest("DELETE", `/api/priorities/${priorityId}/projects/${projectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}`] });
    },
  });

  if (isLoading) {
    return <PageShell><div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div></PageShell>;
  }

  if (!priority) {
    return <PageShell><p className="text-muted-foreground">Priority not found</p></PageShell>;
  }

  const sev = SEVERITY_BADGE[priority.severity] || SEVERITY_BADGE.normal;
  const days = daysRemaining(priority.dueDate);
  const linkedProjects = priority.linkedProjects || [];
  const gpMargin = priority.totalRevenue > 0 ? ((priority.totalGp / priority.totalRevenue) * 100).toFixed(1) : "0.0";

  // Merged tasks + approvals
  const mergedItems = [
    ...tasks.map((t: any) => ({ ...t, itemType: "task" })),
    ...pendingApprovals.map((a: any) => ({ ...a, itemType: "approval" })),
  ].sort((a, b) => {
    const aBlocked = a.status?.toLowerCase().includes("block") ? 0 : 1;
    const bBlocked = b.status?.toLowerCase().includes("block") ? 0 : 1;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    const aDate = a.dueDate || a.endDate || "";
    const bDate = b.dueDate || b.endDate || "";
    return aDate.localeCompare(bDate);
  });

  return (
    <PageShell>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-4">
        <Link href="/"><span className="hover:underline cursor-pointer">Home</span></Link>
        <span>/</span>
        <Link href="/priorities"><span className="hover:underline cursor-pointer">Priorities</span></Link>
        <span>/</span>
        <span className="text-foreground">{priority.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-3 h-3 rounded-full ${HEALTH_DOT[priority.effectiveHealth] || HEALTH_DOT.healthy}`} />
          <h1 className="text-xl font-semibold text-foreground">{priority.title}</h1>
          <Badge variant="secondary" className={`text-[10px] ${sev.className}`}>{sev.label}</Badge>
        </div>

        {priority.description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{priority.description}</p>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2 flex-wrap">
          {priority.owner && <span>Owner: <span className="text-foreground font-medium">{priority.owner.name}</span></span>}
          {priority.accountableExec && <span>Exec: <span className="text-foreground font-medium">{priority.accountableExec.name}</span></span>}
          {priority.dueDate && (
            <span className={days != null && days <= 7 ? "text-red-600" : days != null && days <= 14 ? "text-amber-600" : ""}>
              Due: {priority.dueDate} {days != null && `(${days < 0 ? `${Math.abs(days)}d overdue` : `${days}d remaining`})`}
            </span>
          )}
          <span>Progress: {priority.effectiveProgress}%</span>
        </div>

        {/* Progress bar */}
        <div className="mt-3 max-w-md">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                priority.effectiveHealth === "critical" ? "bg-red-500" :
                priority.effectiveHealth === "at_risk" ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(priority.effectiveProgress, 100)}%` }}
            />
          </div>
        </div>

        {/* Financial summary cards (only when has projects) */}
        {priority.hasProjects && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Revenue</p>
              <p className="text-lg font-semibold">{formatCurrency(priority.totalRevenue)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Cost of Sales</p>
              <p className="text-lg font-semibold">{formatCurrency(priority.totalCos)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Gross Profit</p>
              <p className="text-lg font-semibold">{formatCurrency(priority.totalGp)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">GP Margin</p>
              <p className="text-lg font-semibold">{gpMargin}%</p>
            </CardContent></Card>
          </div>
        )}

        {!priority.hasProjects && (
          <Card className="mt-4 border-dashed">
            <CardContent className="p-4 text-sm text-muted-foreground">
              This is a standalone priority. Link projects to see derived metrics and financial data.
              {isAdmin && (
                <Button variant="outline" size="sm" className="ml-2" onClick={() => setLinkDialogOpen(true)}>
                  <Plus className="w-3 h-3 mr-1" /> Link projects
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue={priority.hasProjects ? "projects" : "details"}>
        <TabsList>
          {priority.hasProjects ? (
            <>
              <TabsTrigger value="projects"><FolderOpen className="w-3.5 h-3.5 mr-1" />Projects</TabsTrigger>
              <TabsTrigger value="financials"><DollarSign className="w-3.5 h-3.5 mr-1" />Financials</TabsTrigger>
              <TabsTrigger value="tasks"><ListTodo className="w-3.5 h-3.5 mr-1" />Tasks & Approvals</TabsTrigger>
              <TabsTrigger value="updates"><MessageSquare className="w-3.5 h-3.5 mr-1" />Updates</TabsTrigger>
            </>
          ) : (
            <>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="updates"><MessageSquare className="w-3.5 h-3.5 mr-1" />Updates</TabsTrigger>
            </>
          )}
        </TabsList>

        {/* Details tab (standalone) */}
        <TabsContent value="details" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              {priority.description && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Description</h3>
                  <p className="text-sm">{priority.description}</p>
                </div>
              )}
              {priority.targetOutcome && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Target Outcome</h3>
                  <p className="text-sm">{priority.targetOutcome}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Status</span>
                  <p className="font-medium">{priority.status}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Health</span>
                  <p className="font-medium flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[priority.effectiveHealth] || HEALTH_DOT.healthy}`} />
                    {priority.effectiveHealth}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Projects tab */}
        <TabsContent value="projects" className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 font-medium">Phase</th>
                  <th className="pb-2 font-medium">PM</th>
                  <th className="pb-2 font-medium">RAG</th>
                  <th className="pb-2 font-medium">% Complete</th>
                  {isAdmin && <th className="pb-2 font-medium w-8" />}
                </tr>
              </thead>
              <tbody>
                {linkedProjects.map((p: any) => (
                  <tr key={p.id} className="border-b hover:bg-muted/50">
                    <td className="py-2">
                      <Link href={`/project/${encodeURIComponent(p.name)}`}>
                        <span className="text-primary hover:underline cursor-pointer font-medium">{p.name}</span>
                      </Link>
                    </td>
                    <td className="py-2">{p.phase || "—"}</td>
                    <td className="py-2">{p.pm?.name || "—"}</td>
                    <td className="py-2">
                      {p.ragStatus ? (
                        <Badge variant="secondary" className={`text-[10px] ${RAG_BADGE[p.ragStatus?.toLowerCase()] || ""}`}>
                          {p.ragStatus}
                        </Badge>
                      ) : "—"}
                    </td>
                    <td className="py-2">{p.percentComplete}%</td>
                    {isAdmin && (
                      <td className="py-2">
                        <button
                          onClick={() => { if (confirm("Unlink this project?")) unlinkMutation.mutate(p.id); }}
                          className="text-muted-foreground hover:text-red-600"
                          title="Unlink project"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isAdmin && (
            <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="mt-3">
                  <Plus className="w-3 h-3 mr-1" /> Link project
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Link projects to {priority.title}</DialogTitle>
                </DialogHeader>
                <ProjectLinker
                  priorityId={priorityId}
                  existingProjectIds={linkedProjects.map((p: any) => p.id)}
                  onDone={() => setLinkDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
          )}
        </TabsContent>

        {/* Financials tab */}
        <TabsContent value="financials" className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Revenue</p>
              <p className="text-lg font-semibold">{formatCurrency(priority.totalRevenue)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Cost of Sales</p>
              <p className="text-lg font-semibold">{formatCurrency(priority.totalCos)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">Gross Profit</p>
              <p className="text-lg font-semibold">{formatCurrency(priority.totalGp)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase">GP Margin</p>
              <p className="text-lg font-semibold">{gpMargin}%</p>
            </CardContent></Card>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 font-medium text-right">Revenue</th>
                  <th className="pb-2 font-medium text-right">COS</th>
                  <th className="pb-2 font-medium text-right">GP</th>
                  <th className="pb-2 font-medium text-right">GP%</th>
                  <th className="pb-2 font-medium text-right">Revenue Realised</th>
                  <th className="pb-2 font-medium text-right">COS Realised</th>
                </tr>
              </thead>
              <tbody>
                {linkedProjects.map((p: any) => (
                  <tr key={p.id} className="border-b hover:bg-muted/50">
                    <td className="py-2 font-medium">{p.name}</td>
                    <td className="py-2 text-right">{p.totalRevenue ? formatCurrency(p.totalRevenue) : "—"}</td>
                    <td className="py-2 text-right">{p.totalCos ? formatCurrency(p.totalCos) : "—"}</td>
                    <td className="py-2 text-right">{p.grossProfit ? formatCurrency(p.grossProfit) : "—"}</td>
                    <td className="py-2 text-right">{p.grossMarginPct ? `${(p.grossMarginPct * 100).toFixed(1)}%` : "—"}</td>
                    <td className="py-2 text-right">{p.revenueRealised ? formatCurrency(p.revenueRealised) : "—"}</td>
                    <td className="py-2 text-right">{p.cosRealised ? formatCurrency(p.cosRealised) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Tasks & Approvals tab */}
        <TabsContent value="tasks" className="mt-4">
          {mergedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No tasks or approvals for linked projects</p>
          ) : (
            <div className="space-y-1">
              {mergedItems.slice(0, 50).map((item: any, i: number) => (
                <div key={`${item.itemType}-${item.id}`} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-muted text-sm border-b">
                  {item.itemType === "task" ? (
                    <ListTodo className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate block">{item.title}</span>
                    <span className="text-xs text-muted-foreground">{item.projectName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{item.assignee || ""}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">{item.status}</Badge>
                  <span className="text-xs text-muted-foreground shrink-0">{item.dueDate || ""}</span>
                </div>
              ))}
              {mergedItems.length > 50 && (
                <p className="text-xs text-muted-foreground text-center py-2">Showing first 50 of {mergedItems.length} items</p>
              )}
            </div>
          )}
        </TabsContent>

        {/* Updates tab */}
        <TabsContent value="updates" className="mt-4">
          {updates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {priority.hasProjects ? "No updates from linked projects" : "Link projects to see updates"}
            </p>
          ) : (
            <div className="space-y-3">
              {updates.map((u: any, i: number) => (
                <Card key={i}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{u.projectName}</span>
                      {u.ragStatus && (
                        <Badge variant="secondary" className={`text-[10px] ${RAG_BADGE[u.ragStatus?.toLowerCase()] || ""}`}>
                          {u.ragStatus}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {u.date ? new Date(u.date).toLocaleDateString() : ""}
                      </span>
                    </div>
                    {u.ragComment && <p className="text-sm">{u.ragComment}</p>}
                    {u.phaseNotes && <p className="text-sm text-muted-foreground mt-1">{u.phaseNotes}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
