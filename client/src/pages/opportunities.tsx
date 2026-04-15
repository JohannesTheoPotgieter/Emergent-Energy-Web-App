import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageEmpty, PageError, PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Sun, Plus, Search, DollarSign, Calendar, TrendingUp, Pencil } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface OpportunityRow {
  id: number;
  clientId: number | null;
  stage: string;
  contractType: string | null;
  estimatedValue: string | null;
  estimatedKwp: string | null;
  expectedCloseDate: string | null;
  handoverReadiness: string;
  status: string;
  notes: string | null;
  createdAt: string;
  /**
   * Origin flag. `'pipedrive'` means the row is managed by the sync engine
   * and CRM-owned fields will be overwritten on the next sync run.
   * `'internal'` means the row is app-owned.
   */
  source?: string | null;
  pipedriveDealId?: string | null;
}

const STAGES = [
  { value: "prospect", label: "Prospect" },
  { value: "qualification", label: "Qualification" },
  { value: "proposal", label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

const CONTRACT_TYPES = [
  { value: "PPA", label: "PPA" },
  { value: "EPC", label: "EPC" },
  { value: "lease", label: "Lease" },
  { value: "hybrid", label: "Hybrid" },
];

function stageBadge(s: string) {
  const map: Record<string, string> = {
    prospect: "bg-slate-100 text-slate-700",
    qualification: "bg-blue-50 text-blue-700",
    proposal: "bg-indigo-50 text-indigo-700",
    negotiation: "bg-amber-50 text-amber-700",
    won: "bg-green-50 text-green-700",
    lost: "bg-red-50 text-red-700",
  };
  return map[s] || "bg-muted text-muted-foreground";
}

const emptyForm = {
  stage: "prospect",
  contractType: "",
  estimatedValue: "",
  estimatedKwp: "",
  expectedCloseDate: "",
  clientId: "",
  notes: "",
};

export default function OpportunitiesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingOpp, setEditingOpp] = useState<OpportunityRow | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const { data: opportunities = [], isLoading, isError, error, refetch } = useQuery<OpportunityRow[]>({
    queryKey: ["/api/opportunities"],
    queryFn: async () => { const res = await apiRequest("GET", "/api/opportunities"); if (!res.ok) throw new Error('Failed to fetch data (' + res.status + ')'); return res.json(); },
  });

  const { data: clients = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/clients-list-opp"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/clients");
      return (await res.json() || []).map((c: any) => ({ id: c.id, name: c.name }));
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/opportunities", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      toast({ title: "Opportunity created" });
      setShowForm(false);
      setForm(emptyForm);
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/opportunities/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      toast({ title: "Opportunity updated" });
      setEditingOpp(null);
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  function openEditDialog(opp: OpportunityRow) {
    setEditingOpp(opp);
    setEditForm({
      stage: opp.stage || "prospect",
      contractType: opp.contractType || "",
      estimatedValue: opp.estimatedValue || "",
      estimatedKwp: opp.estimatedKwp || "",
      expectedCloseDate: opp.expectedCloseDate || "",
      clientId: opp.clientId ? String(opp.clientId) : "",
      notes: opp.notes || "",
    });
  }

  function handleEditSubmit() {
    if (!editingOpp) return;
    const body: Record<string, unknown> = {
      stage: editForm.stage,
      contractType: editForm.contractType || null,
      estimatedValue: editForm.estimatedValue || null,
      estimatedKwp: editForm.estimatedKwp || null,
      expectedCloseDate: editForm.expectedCloseDate || null,
      clientId: editForm.clientId ? Number(editForm.clientId) : null,
      notes: editForm.notes || null,
    };
    editMutation.mutate({ id: editingOpp.id, body });
  }

  function handleSubmit() {
    const body: Record<string, unknown> = {
      stage: form.stage,
      contractType: form.contractType || null,
      estimatedValue: form.estimatedValue || null,
      estimatedKwp: form.estimatedKwp || null,
      expectedCloseDate: form.expectedCloseDate || null,
      clientId: form.clientId ? Number(form.clientId) : null,
      notes: form.notes || null,
    };
    createMutation.mutate(body);
  }

  const filtered = opportunities.filter(o => {
    if (stageFilter !== "all" && o.stage !== stageFilter) return false;
    if (search && !JSON.stringify(o).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalValue = filtered.reduce((sum, o) => sum + (o.estimatedValue ? Number(o.estimatedValue) : 0), 0);
  const totalKwp = filtered.reduce((sum, o) => sum + (o.estimatedKwp ? Number(o.estimatedKwp) : 0), 0);

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell className="p-4 md:p-6"><PageError title="Unable to load Opportunities" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></PageShell>;

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-opportunities">
      <SectionHeader
        icon={<TrendingUp className="h-5 w-5" />}
        eyebrow="Project Development"
        title="Opportunities"
        description={`Commercial pipeline. ${opportunities.length} row${opportunities.length === 1 ? "" : "s"} total — rows marked "Pipedrive" are synced from the CRM and will be overwritten on the next sync run. "Internal" rows are app-owned.`}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => { setForm(emptyForm); setShowForm(true); }}>
            <Plus className="h-4 w-4" /> New Opportunity
          </Button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{opportunities.length}</div>
            <div className="text-xs text-muted-foreground">Total Opportunities</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{opportunities.filter(o => o.stage !== "won" && o.stage !== "lost").length}</div>
            <div className="text-xs text-muted-foreground">Active Pipeline</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">
              <DollarSign className="h-4 w-4 inline" />
              {totalValue > 0 ? `${(totalValue / 1_000_000).toFixed(1)}M` : "—"}
            </div>
            <div className="text-xs text-muted-foreground">Pipeline Value</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{totalKwp > 0 ? `${totalKwp.toFixed(0)} kWp` : "—"}</div>
            <div className="text-xs text-muted-foreground">Pipeline Capacity</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          <button onClick={() => setStageFilter("all")} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${stageFilter === "all" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>All</button>
          {STAGES.filter(s => s.value !== "lost").map(s => (
            <button key={s.value} onClick={() => setStageFilter(s.value)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${stageFilter === s.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{s.label}</button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading opportunities...</p>}

      {!isLoading && filtered.length === 0 && (
        <PageEmpty
          icon={Sun}
          title="No opportunities yet"
          description="Opportunities represent potential projects in the commercial pipeline. Create one to start tracking."
          actionLabel="New Opportunity"
          onAction={() => setShowForm(true)}
        />
      )}

      <div className="space-y-2">
        {filtered.map(opp => {
          const isPipedrive = opp.source === "pipedrive";
          return (
            <Card key={opp.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`text-[10px] ${stageBadge(opp.stage)}`}>{opp.stage}</Badge>
                  {opp.contractType && <Badge variant="outline" className="text-[10px]">{opp.contractType}</Badge>}
                  {isPipedrive ? (
                    <Badge
                      variant="info"
                      className="text-[10px]"
                      title="Synced from Pipedrive. Stage, status, estimated value, expected close date, signed date and client will be overwritten on the next sync. Notes and commercial risks are app-owned and are preserved."
                      data-testid={`opp-source-pipedrive-${opp.id}`}
                    >
                      Pipedrive
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="text-[10px]"
                      title="Internal opportunity. Not synced from Pipedrive — app-owned."
                      data-testid={`opp-source-internal-${opp.id}`}
                    >
                      Internal
                    </Badge>
                  )}
                  <span className="flex-1" />
                  {opp.estimatedValue && (
                    <span className="text-xs font-medium">
                      <DollarSign className="h-3 w-3 inline" />
                      {Number(opp.estimatedValue).toLocaleString()}
                    </span>
                  )}
                  {opp.estimatedKwp && (
                    <span className="text-xs text-muted-foreground">{Number(opp.estimatedKwp).toFixed(0)} kWp</span>
                  )}
                  {opp.expectedCloseDate && (
                    <span className="text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3 inline mr-0.5" />{opp.expectedCloseDate}
                    </span>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(opp)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {opp.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{opp.notes}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Create dialog */}
      <Dialog open={showForm} onOpenChange={(v) => { if (!v) { setShowForm(false); setForm(emptyForm); } else setShowForm(true); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Opportunity</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Client</Label>
              <SearchableSelect
                value={form.clientId || "__none__"}
                onValueChange={(v) => setForm(f => ({ ...f, clientId: v === "__none__" ? "" : v }))}
                options={[{ value: "__none__", label: "None" }, ...clients.map(c => ({ value: String(c.id), label: c.name }))]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Stage</Label>
                <SearchableSelect value={form.stage} onValueChange={(v) => setForm(f => ({ ...f, stage: v }))} options={STAGES} />
              </div>
              <div>
                <Label className="text-xs">Contract Type</Label>
                <SearchableSelect value={form.contractType || "__none__"} onValueChange={(v) => setForm(f => ({ ...f, contractType: v === "__none__" ? "" : v }))} options={[{ value: "__none__", label: "None" }, ...CONTRACT_TYPES]} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Estimated Value (R)</Label>
                <Input type="number" value={form.estimatedValue} onChange={(e) => setForm(f => ({ ...f, estimatedValue: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label className="text-xs">Estimated kWp</Label>
                <Input type="number" value={form.estimatedKwp} onChange={(e) => setForm(f => ({ ...f, estimatedKwp: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Expected Close Date</Label>
              <Input type="date" value={form.expectedCloseDate} onChange={(e) => setForm(f => ({ ...f, expectedCloseDate: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional context..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setForm(emptyForm); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editingOpp} onOpenChange={(v) => { if (!v) setEditingOpp(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Opportunity</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Client</Label>
              <SearchableSelect
                value={editForm.clientId || "__none__"}
                onValueChange={(v) => setEditForm(f => ({ ...f, clientId: v === "__none__" ? "" : v }))}
                options={[{ value: "__none__", label: "None" }, ...clients.map(c => ({ value: String(c.id), label: c.name }))]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Stage</Label>
                <SearchableSelect value={editForm.stage} onValueChange={(v) => setEditForm(f => ({ ...f, stage: v }))} options={STAGES} />
              </div>
              <div>
                <Label className="text-xs">Contract Type</Label>
                <SearchableSelect value={editForm.contractType || "__none__"} onValueChange={(v) => setEditForm(f => ({ ...f, contractType: v === "__none__" ? "" : v }))} options={[{ value: "__none__", label: "None" }, ...CONTRACT_TYPES]} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Estimated Value (R)</Label>
                <Input type="number" value={editForm.estimatedValue} onChange={(e) => setEditForm(f => ({ ...f, estimatedValue: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label className="text-xs">Estimated kWp</Label>
                <Input type="number" value={editForm.estimatedKwp} onChange={(e) => setEditForm(f => ({ ...f, estimatedKwp: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Expected Close Date</Label>
              <Input type="date" value={editForm.expectedCloseDate} onChange={(e) => setEditForm(f => ({ ...f, expectedCloseDate: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input value={editForm.notes} onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional context..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingOpp(null)}>Cancel</Button>
            <Button onClick={handleEditSubmit} disabled={editMutation.isPending}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
