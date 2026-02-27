import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Briefcase, Plus, FolderOpen, TrendingUp, TrendingDown, AlertTriangle,
  Users, Zap, DollarSign, ShieldCheck, Search, ChevronRight,
} from "lucide-react";

type ViewMode = "management" | "finance" | "quality";

export default function PortfoliosPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [viewMode, setViewMode] = useState<ViewMode>("management");
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [formData, setFormData] = useState({ name: "", clientName: "", description: "", status: "Active" });

  const { data: dashboard, isLoading } = useQuery<any>({
    queryKey: ["/api/portfolio-dashboard", viewMode],
    queryFn: () => fetch(`/api/portfolio-dashboard?view=${viewMode}`, { credentials: "include" }).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["/api/portfolio-dashboard"] });
      setCreateOpen(false);
      setFormData({ name: "", clientName: "", description: "", status: "Active" });
      toast({ title: "Portfolio created", description: `"${created.name}" has been created` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const portfoliosList = (dashboard?.portfolios || []).filter((p: any) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.clientName || "").toLowerCase().includes(search.toLowerCase())
  );

  const formatCurrency = (v: number) => {
    if (Math.abs(v) >= 1e6) return `R ${(v / 1e6).toFixed(1)}M`;
    if (Math.abs(v) >= 1e3) return `R ${(v / 1e3).toFixed(0)}K`;
    return `R ${v.toFixed(0)}`;
  };

  const healthColor = (h: string) => {
    if (h === "At Risk") return "bg-red-100 text-red-700 border-red-200";
    if (h === "Behind") return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  };

  return (
    <div className="space-y-6" data-testid="page-portfolios">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Portfolio Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {dashboard?.totalPortfolios || 0} portfolios · {dashboard?.unassignedProjectCount || 0} unassigned projects
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5" data-testid="button-create-portfolio">
          <Plus className="h-4 w-4" /> New Portfolio
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
          {([
            { key: "management", label: "Project Management", icon: Briefcase },
            { key: "finance", label: "Finance", icon: DollarSign },
            { key: "quality", label: "Quality", icon: ShieldCheck },
          ] as const).map(tab => (
            <button key={tab.key}
              onClick={() => setViewMode(tab.key)}
              data-testid={`tab-${tab.key}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === tab.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search portfolios..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9"
            data-testid="input-search-portfolios"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground">Loading portfolios...</div>
      ) : portfoliosList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FolderOpen className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <h3 className="font-semibold text-lg">No portfolios yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Create your first portfolio to group and manage related projects together.</p>
            <Button className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)} data-testid="button-create-portfolio-empty">
              <Plus className="h-4 w-4" /> Create Portfolio
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {portfoliosList.map((p: any) => (
            <Card
              key={p.id}
              className="hover:shadow-md transition-shadow cursor-pointer group"
              onClick={() => navigate(`/portfolios/${p.id}`)}
              data-testid={`card-portfolio-${p.id}`}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors" data-testid={`text-portfolio-name-${p.id}`}>
                        {p.name}
                      </h3>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${healthColor(p.overallHealth)}`} data-testid={`badge-health-${p.id}`}>
                        {p.overallHealth}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {p.status}
                      </Badge>
                    </div>
                    {p.clientName && (
                      <p className="text-sm text-muted-foreground mb-2" data-testid={`text-client-${p.id}`}>
                        Client: {p.clientName}
                      </p>
                    )}

                    {viewMode === "management" && (
                      <div className="flex items-center gap-4 text-sm flex-wrap">
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          {p.projectCount} projects
                        </span>
                        {p.ownerName && (
                          <span className="text-muted-foreground">Owner: {p.ownerName}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                          {p.totalKwp?.toFixed(0) || 0} kWp
                        </span>
                        <span className="flex items-center gap-1">
                          Act: <span className={p.avgActualPct < p.avgExpectedPct - 5 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>
                            {p.avgActualPct}%
                          </span>
                          <span className="text-muted-foreground">/ Exp: {p.avgExpectedPct}%</span>
                        </span>
                        {p.behindCount > 0 && (
                          <span className="flex items-center gap-1 text-red-600">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {p.behindCount} behind
                          </span>
                        )}
                      </div>
                    )}

                    {viewMode === "finance" && (
                      <div className="flex items-center gap-4 text-sm flex-wrap">
                        <span>Revenue: <span className="font-medium">{formatCurrency(p.finance?.revenueRealised || 0)}</span>
                          <span className="text-muted-foreground"> / {formatCurrency(p.finance?.totalPlannedRevenue || 0)}</span>
                        </span>
                        <span>COS: <span className="font-medium">{formatCurrency(p.finance?.cosRealised || 0)}</span>
                          <span className="text-muted-foreground"> / {formatCurrency(p.finance?.totalPlannedExpenses || 0)}</span>
                        </span>
                        <span className={`font-medium ${(p.finance?.grossProfit || 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          GP: {formatCurrency(p.finance?.grossProfit || 0)}
                        </span>
                      </div>
                    )}

                    {viewMode === "quality" && (
                      <div className="flex items-center gap-4 text-sm flex-wrap">
                        <span>{p.projectCount} projects</span>
                        <span>{p.totalKwp?.toFixed(0) || 0} kWp</span>
                        <Badge variant="outline" className={healthColor(p.overallHealth)}>
                          {p.overallHealth}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="dialog-create-portfolio">
          <DialogHeader>
            <DialogTitle>Create New Portfolio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Portfolio Name *</label>
              <Input
                value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g., Mondi Rollout"
                data-testid="input-portfolio-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Client Name</label>
              <Input
                value={formData.clientName}
                onChange={e => setFormData(f => ({ ...f, clientName: e.target.value }))}
                placeholder="e.g., Mondi Group"
                data-testid="input-portfolio-client"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <Select value={formData.status} onValueChange={v => setFormData(f => ({ ...f, status: v }))}>
                <SelectTrigger data-testid="select-portfolio-status">
                  <SelectValue />
                </SelectTrigger>
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
              <Textarea
                value={formData.description}
                onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description of this portfolio..."
                rows={3}
                data-testid="input-portfolio-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(formData)}
              disabled={!formData.name.trim() || createMutation.isPending}
              data-testid="button-confirm-create"
            >
              {createMutation.isPending ? "Creating..." : "Create Portfolio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
