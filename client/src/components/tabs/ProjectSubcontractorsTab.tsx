import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, Search, Users, TrendingUp, CreditCard, Clock,
  ChevronRight, ChevronDown, ExternalLink, AlertCircle,
} from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function formatCurrency(n: number): string {
  if (n == null || isNaN(n)) return "£0";
  return "£" + Math.round(n).toLocaleString("en-GB");
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  } catch { return d; }
}

interface ProjectSubcontractorsTabProps {
  projectName: string;
}

export function ProjectSubcontractorsTab({ projectName }: ProjectSubcontractorsTabProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["project-subcontractors", projectName],
    queryFn: async () => {
      const res = await fetch(
        `/api/subcontractor-dashboard/summary?project=${encodeURIComponent(projectName)}`,
        { headers: getAuthHeaders(), credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load subcontractors");
      return res.json();
    },
    enabled: !!projectName,
  });

  const counterparties = data?.counterparties || [];
  const filtered = counterparties.filter((cp: any) =>
    !search || cp.counterpartyName?.toLowerCase().includes(search.toLowerCase())
  );

  const totalSpend = filtered.reduce((s: number, cp: any) => s + (cp.totalSpendExVat || 0), 0);
  const totalOpen = filtered.reduce((s: number, cp: any) => s + (cp.openAmount || 0), 0);
  const installerCount = filtered.filter((cp: any) => cp.counterpartyType === "INSTALLER").length;
  const supplierCount = filtered.filter((cp: any) => cp.counterpartyType === "SUPPLIER").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading subcontractors...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16 text-red-500">
        <AlertCircle className="w-5 h-5 mr-2" />
        Failed to load subcontractor data
      </div>
    );
  }

  if (counterparties.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No subcontractors linked to this project yet.</p>
          <p className="text-xs text-slate-500 mt-1">
            Run a procurement analysis from the Subcontractors page to populate supplier data.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="project-subcontractors-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-blue-500" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Linked</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="kpi-linked-count">{counterparties.length}</p>
            <div className="flex gap-2 mt-1">
              {installerCount > 0 && <Badge variant="default" className="text-[9px]">{installerCount} Installer{installerCount > 1 ? "s" : ""}</Badge>}
              {supplierCount > 0 && <Badge variant="secondary" className="text-[9px]">{supplierCount} Supplier{supplierCount > 1 ? "s" : ""}</Badge>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-emerald-500" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Total Spend</span>
            </div>
            <p className="text-xl font-bold text-foreground font-mono" data-testid="kpi-total-spend">{formatCurrency(totalSpend)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Open / Unpaid</span>
            </div>
            <p className={`text-xl font-bold font-mono ${totalOpen > 0 ? "text-amber-600" : "text-foreground"}`} data-testid="kpi-open-amount">
              {formatCurrency(totalOpen)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-purple-500" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Biggest Supplier</span>
            </div>
            <p className="text-sm font-bold text-foreground truncate" data-testid="kpi-biggest-supplier">
              {counterparties[0]?.counterpartyName || "—"}
            </p>
            <p className="text-xs text-muted-foreground font-mono">{formatCurrency(counterparties[0]?.totalSpendExVat || 0)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <Input
            placeholder="Filter subcontractors..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
            data-testid="input-filter-subcontractors"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1"
          onClick={() => window.open("/subcontractors", "_blank")}
          data-testid="btn-open-procurement"
        >
          <ExternalLink className="w-3 h-3" />
          Full Dashboard
        </Button>
      </div>

      <div className="space-y-2">
        {filtered.map((cp: any, i: number) => {
          const isExpanded = expanded === cp.counterpartyName;
          return (
            <Card
              key={cp.counterpartyName}
              className={`transition-all ${isExpanded ? "ring-1 ring-blue-200" : "hover:shadow-sm"}`}
              data-testid={`subcontractor-card-${i}`}
            >
              <CardContent className="p-0">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  onClick={() => setExpanded(isExpanded ? null : cp.counterpartyName)}
                  data-testid={`btn-expand-subcontractor-${i}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm text-foreground truncate">{cp.counterpartyName}</span>
                      <Badge
                        variant={cp.counterpartyType === "INSTALLER" ? "default" : cp.counterpartyType === "SUPPLIER" ? "secondary" : "outline"}
                        className="text-[9px] shrink-0"
                      >
                        {cp.counterpartyType || "Unclassified"}
                      </Badge>
                      {cp.isCore && <Badge className="text-[9px] bg-blue-50 text-blue-600 shrink-0">Core</Badge>}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{cp.invoiceCount} invoice{cp.invoiceCount !== 1 ? "s" : ""}</span>
                      <span className="font-mono font-medium text-foreground">{formatCurrency(cp.totalSpendExVat)}</span>
                      {cp.openAmount > 0 && (
                        <span className="text-amber-600 font-mono">{formatCurrency(cp.openAmount)} open</span>
                      )}
                      {cp.avgTurnaroundDays != null && (
                        <span>{cp.avgTurnaroundDays}d avg turnaround</span>
                      )}
                    </div>
                  </div>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
                </button>

                {isExpanded && (
                  <ExpandedDetail counterpartyName={cp.counterpartyName} />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && search && (
        <p className="text-center text-sm text-slate-500 py-6">No subcontractors match "{search}"</p>
      )}
    </div>
  );
}

function ExpandedDetail({ counterpartyName }: { counterpartyName: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["subcontractor-detail", counterpartyName],
    queryFn: async () => {
      const res = await fetch(
        `/api/subcontractor-dashboard/detail/${encodeURIComponent(counterpartyName)}`,
        { headers: getAuthHeaders(), credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load detail");
      return res.json();
    },
    enabled: !!counterpartyName,
  });

  if (isLoading) {
    return (
      <div className="px-4 pb-3 text-center">
        <Loader2 className="w-4 h-4 animate-spin text-slate-500 inline" />
      </div>
    );
  }

  const lines = data?.lines || [];
  if (lines.length === 0) {
    return <div className="px-4 pb-3 text-xs text-slate-500">No cost lines found.</div>;
  }

  return (
    <div className="px-4 pb-3 border-t border-border">
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-slate-500 border-b border-border">
              <th className="text-left py-1 px-1 font-medium">Category</th>
              <th className="text-left py-1 px-1 font-medium">Invoice #</th>
              <th className="text-right py-1 px-1 font-medium">Amount</th>
              <th className="text-left py-1 px-1 font-medium">Invoice Date</th>
              <th className="text-left py-1 px-1 font-medium">Paid Date</th>
              <th className="text-left py-1 px-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: any, idx: number) => {
              const isFuture = l.paidDate && new Date(l.paidDate) > new Date();
              return (
                <tr key={idx} className="border-b border-slate-50 hover:bg-muted/50">
                  <td className="py-1.5 px-1 text-muted-foreground">{l.costCategory || "—"}</td>
                  <td className="py-1.5 px-1 font-mono text-muted-foreground">{l.invoiceNumber || "—"}</td>
                  <td className="py-1.5 px-1 text-right font-mono font-medium">{formatCurrency(parseFloat(l.amountExVat || "0"))}</td>
                  <td className="py-1.5 px-1 text-muted-foreground">{formatDate(l.invoiceDate)}</td>
                  <td className={`py-1.5 px-1 ${isFuture ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                    {formatDate(l.paidDate)}
                    {isFuture && <span className="text-[8px] ml-0.5">(future)</span>}
                  </td>
                  <td className="py-1.5 px-1">
                    <Badge
                      variant={l.status === "PAID" ? "default" : l.status === "INVOICED" ? "secondary" : "outline"}
                      className={`text-[9px] ${
                        l.status === "PAID" ? "bg-green-100 text-green-700 border-green-200"
                        : l.status === "INVOICED" ? "bg-amber-50 text-amber-700 border-amber-200"
                        : l.status === "APPROVED" ? "bg-blue-50 text-blue-700 border-blue-200"
                        : "text-muted-foreground"
                      }`}
                    >
                      {l.status}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
