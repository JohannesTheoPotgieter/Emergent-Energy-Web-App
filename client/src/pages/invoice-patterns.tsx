import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  FileSpreadsheet, Plus, Trash2, Loader2, Search,
  ToggleLeft, ToggleRight, Pencil,
} from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("company_role_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export default function InvoicePatternsPage() {
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

  const filtered = rules.filter((r: any) =>
    !search || r.patternValue.toLowerCase().includes(search.toLowerCase()) ||
    r.inferredType.toLowerCase().includes(search.toLowerCase()) ||
    (r.counterpartyName || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6" data-testid="invoice-patterns-page">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Invoice Pattern Dictionary</h2>
        <p className="text-muted-foreground text-sm">
          Manage invoice number pattern rules used to auto-classify expenditure lines as Installer, Supplier, or Other.
        </p>
      </div>

      <div className="flex items-center gap-3">
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
      </div>

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
                  <td className="px-4 py-2 text-xs text-slate-600">{r.counterpartyName || "—"}</td>
                  <td className="px-4 py-2 text-xs">{r.confidenceWeight}</td>
                  <td className="px-4 py-2 text-xs">{r.timesMatched}</td>
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
    </div>
  );
}
