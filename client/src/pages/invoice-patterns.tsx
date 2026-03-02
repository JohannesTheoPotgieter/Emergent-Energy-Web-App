import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePermission } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  FileSpreadsheet, Plus, Trash2, Loader2, Search,
  ToggleLeft, ToggleRight, Pencil, Play, BarChart3,
  CheckCircle2, AlertCircle, TrendingUp, AlertTriangle,
  Users, X, Star,
} from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("company_role_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function CounterpartiesSection() {
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ nameCanonical: "", typeDefault: "OTHER", isCore: false, aliasInput: "" });
  const [aliases, setAliases] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: counterparties = [], isLoading } = useQuery({
    queryKey: ["/api/counterparties"],
    queryFn: async () => {
      const res = await fetch("/api/counterparties", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const startEdit = (cp: any) => {
    setEditingId(cp.id);
    setForm({
      nameCanonical: cp.nameCanonical,
      typeDefault: cp.typeDefault || "OTHER",
      isCore: cp.isCore || false,
      aliasInput: "",
    });
    setAliases(Array.isArray(cp.nameAliases) ? cp.nameAliases : []);
    setShowAdd(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowAdd(false);
    setForm({ nameCanonical: "", typeDefault: "OTHER", isCore: false, aliasInput: "" });
    setAliases([]);
  };

  const addAlias = () => {
    const a = form.aliasInput.trim();
    if (a && !aliases.includes(a)) {
      setAliases(prev => [...prev, a]);
      setForm(prev => ({ ...prev, aliasInput: "" }));
    }
  };

  const removeAlias = (idx: number) => {
    setAliases(prev => prev.filter((_, i) => i !== idx));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        nameCanonical: form.nameCanonical.trim(),
        typeDefault: form.typeDefault,
        isCore: form.isCore,
        nameAliases: aliases,
      };
      if (editingId) {
        const res = await fetch(`/api/counterparties/${editingId}`, {
          method: "PATCH",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Failed to update");
        return res.json();
      }
      const res = await fetch("/api/counterparties", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-patterns"] });
      cancelEdit();
      const rulesMsg = data?.autoCreatedRules ? ` — ${data.autoCreatedRules} pattern rule${data.autoCreatedRules === 1 ? '' : 's'} auto-created from aliases` : '';
      toast({ title: editingId ? "Counterparty updated" : "Counterparty added", description: editingId ? "Patterns synced with updated aliases" : rulesMsg || undefined });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/counterparties/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties"] });
      toast({ title: "Counterparty removed" });
    },
  });

  const filtered = counterparties.filter((cp: any) =>
    !search ||
    cp.nameCanonical.toLowerCase().includes(search.toLowerCase()) ||
    (cp.typeDefault || "").toLowerCase().includes(search.toLowerCase()) ||
    (Array.isArray(cp.nameAliases) && cp.nameAliases.some((a: string) => a.toLowerCase().includes(search.toLowerCase())))
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search counterparties..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-counterparties"
          />
        </div>
        <Button onClick={() => { if (showAdd) cancelEdit(); else setShowAdd(true); }} data-testid="btn-add-counterparty">
          <Plus className="w-4 h-4 mr-2" /> {editingId ? "Editing" : "Add Counterparty"}
        </Button>
      </div>

      {showAdd && (
        <Card className="bg-white" data-testid="counterparty-form">
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Name</label>
                <Input
                  value={form.nameCanonical}
                  onChange={e => setForm(p => ({ ...p, nameCanonical: e.target.value }))}
                  placeholder="e.g. Schletter SA"
                  data-testid="input-cp-name"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Default Type</label>
                <Select value={form.typeDefault} onValueChange={v => setForm(p => ({ ...p, typeDefault: v }))}>
                  <SelectTrigger data-testid="select-cp-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INSTALLER">Installer</SelectItem>
                    <SelectItem value="SUPPLIER">Supplier</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={form.isCore}
                    onChange={e => setForm(p => ({ ...p, isCore: e.target.checked }))}
                    className="rounded border-slate-300"
                    data-testid="checkbox-cp-core"
                  />
                  <span className="text-xs font-medium text-slate-600">Core Vendor</span>
                </label>
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium text-slate-600 mb-1 block">Aliases (alternate names)</label>
              <div className="flex gap-2 items-center">
                <Input
                  value={form.aliasInput}
                  onChange={e => setForm(p => ({ ...p, aliasInput: e.target.value }))}
                  placeholder="Add alias name..."
                  className="max-w-xs"
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
                  data-testid="input-cp-alias"
                />
                <Button size="sm" variant="outline" onClick={addAlias} type="button" data-testid="btn-add-alias">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
              {aliases.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {aliases.map((a, i) => (
                    <Badge key={i} variant="secondary" className="text-xs gap-1 pr-1">
                      {a}
                      <button onClick={() => removeAlias(i)} className="ml-0.5 hover:text-red-600" data-testid={`btn-remove-alias-${i}`}>
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={() => saveMutation.mutate()}
                disabled={!form.nameCanonical.trim() || saveMutation.isPending}
                data-testid="btn-save-counterparty">
                {saveMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                {editingId ? "Update" : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : filtered.length === 0 ? (
        <Card className="bg-white">
          <CardContent className="py-8 text-center text-slate-500" data-testid="text-no-counterparties">
            No counterparties found. Add one to start tracking vendors and suppliers.
          </CardContent>
        </Card>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm" data-testid="counterparties-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Type</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Aliases</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Core</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Last Seen</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cp: any) => (
                <tr key={cp.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`cp-row-${cp.id}`}>
                  <td className="px-4 py-2 font-medium text-slate-800">{cp.nameCanonical}</td>
                  <td className="px-4 py-2">
                    <Badge
                      variant={cp.typeDefault === "INSTALLER" ? "default" : cp.typeDefault === "SUPPLIER" ? "secondary" : "outline"}
                      className="text-[10px]"
                    >
                      {cp.typeDefault}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {Array.isArray(cp.nameAliases) && cp.nameAliases.length > 0
                        ? cp.nameAliases.map((a: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px] text-slate-500">{a}</Badge>
                          ))
                        : <span className="text-xs text-slate-400">--</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {cp.isCore ? <Star className="w-4 h-4 text-amber-500 fill-amber-500" /> : <span className="text-xs text-slate-400">--</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {cp.lastSeenAt ? new Date(cp.lastSeenAt).toLocaleDateString() : "--"}
                  </td>
                  <td className="px-4 py-2 flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-500 hover:text-blue-700"
                      onClick={() => startEdit(cp)}
                      data-testid={`btn-edit-cp-${cp.id}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                      onClick={() => deleteMutation.mutate(cp.id)}
                      data-testid={`btn-delete-cp-${cp.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function InvoicePatternsPage() {
  const { allowed: canView } = usePermission('invoice_patterns', 'view');
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newRule, setNewRule] = useState({
    patternType: "PREFIX",
    patternValue: "",
    inferredType: "INSTALLER",
    confidenceWeight: 70,
    counterpartyName: "",
    normalizedExample: "",
  });
  const [lastRunResult, setLastRunResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("patterns");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const startEdit = (rule: any) => {
    setEditingId(rule.id);
    setNewRule({
      patternType: rule.patternType,
      patternValue: rule.patternValue,
      inferredType: rule.inferredType,
      confidenceWeight: rule.confidenceWeight,
      counterpartyName: rule.counterpartyName || "",
      normalizedExample: rule.normalizedExample || "",
    });
    setShowAdd(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowAdd(false);
    setNewRule({ patternType: "PREFIX", patternValue: "", inferredType: "INSTALLER", confidenceWeight: 70, counterpartyName: "", normalizedExample: "" });
  };

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["/api/invoice-patterns"],
    queryFn: async () => {
      const res = await fetch("/api/invoice-patterns", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: patternStats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/procurement-analysis/pattern-stats"],
    queryFn: async () => {
      const res = await fetch("/api/procurement-analysis/pattern-stats", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const createMutation = useMutation({
    mutationFn: async (rule: any) => {
      if (editingId) {
        const res = await fetch(`/api/invoice-patterns/${editingId}`, {
          method: "PATCH",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(rule),
        });
        if (!res.ok) throw new Error("Failed to update");
        return res.json();
      }
      const res = await fetch("/api/invoice-patterns", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(rule),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-patterns"] });
      cancelEdit();
      toast({ title: editingId ? "Rule updated" : "Rule created" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await fetch(`/api/invoice-patterns/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-patterns"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/invoice-patterns/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-patterns"] });
      toast({ title: "Rule deleted" });
    },
  });

  const classifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/procurement-analysis/classify", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to run classification");
      return res.json();
    },
    onSuccess: (data) => {
      setLastRunResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-patterns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-analysis/pattern-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/summary"] });
      toast({
        title: "Pattern Analysis Complete",
        description: data.message,
      });
    },
    onError: (err: any) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const filtered = rules.filter((r: any) =>
    !search || r.patternValue.toLowerCase().includes(search.toLowerCase()) ||
    r.inferredType.toLowerCase().includes(search.toLowerCase()) ||
    (r.counterpartyName || "").toLowerCase().includes(search.toLowerCase())
  );

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to view this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="invoice-patterns-page">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Invoice Pattern Dictionary</h2>
        <p className="text-muted-foreground text-sm">
          Manage invoice number pattern rules and counterparties used to auto-classify expenditure lines.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="patterns" className="gap-1.5" data-testid="tab-patterns">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Patterns
          </TabsTrigger>
          <TabsTrigger value="counterparties" className="gap-1.5" data-testid="tab-counterparties">
            <Users className="w-3.5 h-3.5" /> Counterparties
          </TabsTrigger>
        </TabsList>

        <TabsContent value="patterns" className="space-y-4 mt-4">
          {patternStats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="pattern-stats-panel">
              <Card className="bg-white">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-xs text-slate-500 mb-1">Eligible Lines</div>
                  <div className="text-xl font-bold" data-testid="stat-eligible">{patternStats.eligibleLines}</div>
                  <div className="text-[10px] text-slate-400">with invoice & amount</div>
                </CardContent>
              </Card>
              <Card className="bg-white">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-xs text-slate-500 mb-1">Tagged</div>
                  <div className="text-xl font-bold text-green-600" data-testid="stat-tagged">{patternStats.taggedLines}</div>
                  <div className="text-[10px] text-slate-400">pattern matched</div>
                </CardContent>
              </Card>
              <Card className="bg-white">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-xs text-slate-500 mb-1">Untagged</div>
                  <div className="text-xl font-bold text-amber-600" data-testid="stat-untagged">{patternStats.untaggedLines}</div>
                  <div className="text-[10px] text-slate-400">awaiting classification</div>
                </CardContent>
              </Card>
              <Card className="bg-white">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-xs text-slate-500 mb-1">Classification Rate</div>
                  <div className="text-xl font-bold" data-testid="stat-rate">{patternStats.classificationRate}%</div>
                  <div className="text-[10px] text-slate-400">tagged / eligible</div>
                </CardContent>
              </Card>
              <Card className="bg-white">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="text-xs text-slate-500 mb-1">Type Breakdown</div>
                  <div className="flex flex-wrap gap-1 mt-1" data-testid="stat-types">
                    {Object.entries(patternStats.typeCounts || {}).map(([type, count]) => (
                      <Badge key={type} variant={type === "INSTALLER" ? "default" : type === "SUPPLIER" ? "secondary" : "outline"}
                        className="text-[9px]">
                        {type}: {count as number}
                      </Badge>
                    ))}
                    {Object.keys(patternStats.typeCounts || {}).length === 0 && (
                      <span className="text-[10px] text-slate-400">No classified lines yet</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search patterns..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-patterns"
              />
            </div>
            <Button onClick={() => { if (showAdd) cancelEdit(); else setShowAdd(true); }} data-testid="btn-add-rule">
              <Plus className="w-4 h-4 mr-2" /> {editingId ? "Editing Rule" : "Add Rule"}
            </Button>
            <Button
              onClick={() => classifyMutation.mutate()}
              disabled={classifyMutation.isPending}
              variant="default"
              className="bg-emerald-600 hover:bg-emerald-700"
              data-testid="btn-run-pattern-analysis"
            >
              {classifyMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Run Pattern Analysis
            </Button>
          </div>

          {lastRunResult && (
            <Card className="bg-emerald-50 border-emerald-200" data-testid="analysis-result-card">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium text-emerald-800 text-sm mb-1">Analysis Complete</div>
                    <div className="text-xs text-emerald-700">{lastRunResult.message}</div>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs">
                      <span className="text-slate-600">Eligible: <strong>{lastRunResult.totalEligible}</strong></span>
                      <span className="text-slate-600">Already tagged: <strong>{lastRunResult.alreadyTagged}</strong></span>
                      <span className="text-green-700">Newly classified: <strong>{lastRunResult.newlyClassified}</strong></span>
                      <span className="text-blue-700">Auto-applied: <strong>{lastRunResult.autoApplied}</strong></span>
                      <span className="text-amber-700">Unresolved: <strong>{lastRunResult.unresolved}</strong></span>
                      <span className="text-purple-700">Rules updated: <strong>{lastRunResult.rulesUpdated}</strong></span>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
                    onClick={() => setLastRunResult(null)}>
                    Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {showAdd && (
            <Card className="bg-white" data-testid="add-rule-form">
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Pattern Type</label>
                    <Select value={newRule.patternType} onValueChange={v => setNewRule(p => ({ ...p, patternType: v }))}>
                      <SelectTrigger data-testid="select-pattern-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PREFIX">Prefix</SelectItem>
                        <SelectItem value="REGEX">Regex</SelectItem>
                        <SelectItem value="TOKEN_SHAPE">Token Shape</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Pattern Value</label>
                    <Input value={newRule.patternValue} onChange={e => setNewRule(p => ({ ...p, patternValue: e.target.value }))}
                      placeholder="e.g. NRG-" data-testid="input-pattern-value" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Inferred Type</label>
                    <Select value={newRule.inferredType} onValueChange={v => setNewRule(p => ({ ...p, inferredType: v }))}>
                      <SelectTrigger data-testid="select-inferred-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="INSTALLER">Installer</SelectItem>
                        <SelectItem value="SUPPLIER">Supplier</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Confidence Weight</label>
                    <Input type="number" value={newRule.confidenceWeight}
                      onChange={e => setNewRule(p => ({ ...p, confidenceWeight: parseInt(e.target.value) || 50 }))}
                      data-testid="input-confidence-weight" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Counterparty (optional)</label>
                    <Input value={newRule.counterpartyName} onChange={e => setNewRule(p => ({ ...p, counterpartyName: e.target.value }))}
                      placeholder="Vendor name" data-testid="input-counterparty-name" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Example Invoice #</label>
                    <Input value={newRule.normalizedExample} onChange={e => setNewRule(p => ({ ...p, normalizedExample: e.target.value }))}
                      placeholder="e.g. NRG-2024-001" data-testid="input-example" />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={() => createMutation.mutate(newRule)}
                    disabled={!newRule.patternValue || createMutation.isPending}
                    data-testid="btn-save-rule">
                    {createMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                    {editingId ? "Update Rule" : "Save Rule"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : filtered.length === 0 ? (
            <Card className="bg-white">
              <CardContent className="py-8 text-center text-slate-500">
                No pattern rules found. Create one to start auto-classifying invoices.
              </CardContent>
            </Card>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm" data-testid="patterns-table">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Pattern</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Type</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Inferred</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Counterparty</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Weight</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Matched</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Confirmed</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Overridden</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Active</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: any) => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`pattern-row-${r.id}`}>
                      <td className="px-4 py-2 font-mono text-xs">
                        {r.patternValue}
                        {r.normalizedExample && (
                          <span className="text-slate-400 ml-2 text-[10px]">e.g. {r.normalizedExample}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className="text-[10px]">{r.patternType}</Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={r.inferredType === "INSTALLER" ? "default" : r.inferredType === "SUPPLIER" ? "secondary" : "outline"}
                          className="text-[10px]">
                          {r.inferredType}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-600">{r.counterpartyName || "\u2014"}</td>
                      <td className="px-4 py-2 text-xs">{r.confidenceWeight}</td>
                      <td className="px-4 py-2 text-xs font-semibold">{r.timesMatched}</td>
                      <td className="px-4 py-2 text-xs text-green-600">{r.timesConfirmed}</td>
                      <td className="px-4 py-2 text-xs text-red-600">{r.timesOverridden}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                          data-testid={`btn-toggle-${r.id}`}>
                          {r.isActive ? (
                            <ToggleRight className="w-5 h-5 text-green-600" />
                          ) : (
                            <ToggleLeft className="w-5 h-5 text-slate-400" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-2 flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-500 hover:text-blue-700"
                          onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                          data-testid={`btn-edit-${r.id}`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                          onClick={() => deleteMutation.mutate(r.id)}
                          data-testid={`btn-delete-${r.id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="counterparties" className="mt-4">
          <CounterpartiesSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
