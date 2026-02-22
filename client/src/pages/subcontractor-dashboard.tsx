import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  DollarSign, Users, Clock, TrendingUp, Search, Filter,
  Loader2, ArrowUpDown, ChevronRight, AlertCircle, Calendar,
  CheckCircle2, CircleDot, ExternalLink, FileText, Pencil, Check, X,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("company_role_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function formatCurrency(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "R0";
  return `R${val.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(val: string | null): string {
  if (!val) return "\u2014";
  try {
    return new Date(val).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return val; }
}

type SortField = "totalSpendExVat" | "invoiceCount" | "projectCount" | "lastInvoiceDate" | "avgTurnaroundDays" | "openAmount" | "upcomingAmount30d" | "counterpartyName";

export default function SubcontractorDashboardPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [coreOnly, setCoreOnly] = useState(false);
  const [sortField, setSortField] = useState<SortField>("totalSpendExVat");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedCp, setSelectedCp] = useState<string | null>(null);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("all");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);

  const handleStartRename = () => {
    setRenameValue(selectedCp || "");
    setRenameError("");
    setIsRenaming(true);
  };

  const handleCancelRename = () => {
    setIsRenaming(false);
    setRenameError("");
  };

  const handleConfirmRename = async () => {
    if (!selectedCp || !renameValue.trim()) return;
    if (renameValue.trim() === selectedCp) { setIsRenaming(false); return; }
    setRenameLoading(true);
    setRenameError("");
    try {
      const res = await fetch("/api/subcontractor-dashboard/rename", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ oldName: selectedCp, newName: renameValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setRenameError(data.error || "Rename failed"); return; }
      setSelectedCp(data.newName);
      setIsRenaming(false);
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/detail"] });
    } catch (err: any) {
      setRenameError(err.message || "Rename failed");
    } finally {
      setRenameLoading(false);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["/api/subcontractor-dashboard/summary", typeFilter, projectFilter, coreOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (projectFilter !== "all") params.set("project", projectFilter);
      if (coreOnly) params.set("coreOnly", "true");
      const res = await fetch(`/api/subcontractor-dashboard/summary?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["/api/subcontractor-dashboard/detail", selectedCp],
    queryFn: async () => {
      if (!selectedCp) return null;
      const res = await fetch(`/api/subcontractor-dashboard/detail/${encodeURIComponent(selectedCp)}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!selectedCp,
  });

  const kpis = data?.kpis || {};
  const counterpartiesList = data?.counterparties || [];
  const availableProjects = data?.availableProjects || [];

  const filtered = counterpartiesList
    .filter((c: any) =>
      !search || c.counterpartyName.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a: any, b: any) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      if (typeof aVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  return (
    <div className="space-y-6" data-testid="subcontractor-dashboard-page">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Subcontractor Dashboard</h2>
        <p className="text-muted-foreground text-sm">
          Aggregated view of installer and supplier accounts with spend, usage, and upcoming payments.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="kpi-biggest">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <p className="text-xs text-slate-500">Biggest Account</p>
            </div>
            <p className="text-lg font-bold truncate">{kpis.biggestAccount || "—"}</p>
            <p className="text-xs text-slate-400">{formatCurrency(kpis.biggestAccountSpend)}</p>
          </CardContent>
        </Card>
        <Card data-testid="kpi-total">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-green-600" />
              <p className="text-xs text-slate-500">Total Subcontractors</p>
            </div>
            <p className="text-lg font-bold">{kpis.totalCounterparties || 0}</p>
          </CardContent>
        </Card>
        <Card data-testid="kpi-open">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-amber-600" />
              <p className="text-xs text-slate-500">Total Open Amount</p>
            </div>
            <p className="text-lg font-bold">{formatCurrency(kpis.totalOpenAmount)}</p>
          </CardContent>
        </Card>
        <Card data-testid="kpi-upcoming">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-purple-600" />
              <p className="text-xs text-slate-500">Upcoming 30d</p>
            </div>
            <p className="text-lg font-bold">{formatCurrency(kpis.totalUpcoming30d)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Search counterparties..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9" data-testid="input-search" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36" data-testid="select-type-filter">
            <Filter className="w-3 h-3 mr-1" /><SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="INSTALLER">Installer</SelectItem>
            <SelectItem value="SUPPLIER">Supplier</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-44" data-testid="select-project-filter">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {availableProjects.map((p: string) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={coreOnly} onChange={e => setCoreOnly(e.target.checked)}
            data-testid="checkbox-core-only" />
          Core only
        </label>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            No counterparty data available. Import expenditure data via Smart Import first.
          </CardContent>
        </Card>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm" data-testid="counterparty-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {[
                  { key: "counterpartyName", label: "Counterparty" },
                  { key: "counterpartyType", label: "Type" },
                  { key: "totalSpendExVat", label: "Total Spend" },
                  { key: "invoiceCount", label: "Invoices" },
                  { key: "projectCount", label: "Projects" },
                  { key: "lastInvoiceDate", label: "Last Invoice" },
                  { key: "lastPaidDate", label: "Last Paid" },
                  { key: "avgTurnaroundDays", label: "Avg Turn." },
                  { key: "openAmount", label: "Open" },
                  { key: "upcomingAmount30d", label: "Upcoming 30d" },
                ].map(col => (
                  <th key={col.key} className="text-left px-3 py-2 font-medium text-slate-600 text-xs cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort(col.key as SortField)}>
                    <span className="flex items-center gap-1">
                      {col.label}
                      {sortField === col.key && <ArrowUpDown className="w-3 h-3" />}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cp: any, i: number) => (
                <tr key={cp.counterpartyName} className={`border-b border-slate-100 hover:bg-blue-50/30 cursor-pointer ${i % 2 === 0 ? "" : "bg-slate-50/50"}`}
                  onClick={() => setSelectedCp(cp.counterpartyName)}
                  data-testid={`cp-row-${i}`}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {cp.counterpartyName}
                    {cp.isCore && <Badge className="ml-1 text-[8px] bg-blue-50 text-blue-600">Core</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={cp.counterpartyType === "INSTALLER" ? "default" : cp.counterpartyType === "SUPPLIER" ? "secondary" : "outline"}
                      className="text-[10px]">
                      {cp.counterpartyType || "—"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">{formatCurrency(cp.totalSpendExVat)}</td>
                  <td className="px-3 py-2 text-xs">{cp.invoiceCount}</td>
                  <td className="px-3 py-2 text-xs">{cp.projectCount}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{formatDate(cp.lastInvoiceDate)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{formatDate(cp.lastPaidDate)}</td>
                  <td className="px-3 py-2 text-xs">{cp.avgTurnaroundDays != null ? `${cp.avgTurnaroundDays}d` : "\u2014"}</td>
                  <td className="px-3 py-2 text-xs font-mono text-amber-600">{cp.openAmount > 0 ? formatCurrency(cp.openAmount) : "\u2014"}</td>
                  <td className="px-3 py-2 text-xs font-mono text-purple-600">{cp.upcomingAmount30d > 0 ? formatCurrency(cp.upcomingAmount30d) : "\u2014"}</td>
                  <td className="px-3 py-2"><ChevronRight className="w-4 h-4 text-slate-300" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={!!selectedCp} onOpenChange={(open) => { if (!open) { setSelectedCp(null); setInvoiceStatusFilter("all"); setIsRenaming(false); } }}>
        <SheetContent className="w-[540px] sm:w-[680px] overflow-y-auto" data-testid="cp-detail-drawer">
          <SheetHeader>
            {isRenaming ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    className="text-lg font-semibold h-9"
                    data-testid="input-rename-counterparty"
                    autoFocus
                    onKeyDown={e => { if (e.key === "Enter") handleConfirmRename(); if (e.key === "Escape") handleCancelRename(); }}
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                    onClick={handleConfirmRename} disabled={renameLoading} data-testid="btn-confirm-rename">
                    {renameLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-slate-600"
                    onClick={handleCancelRename} data-testid="btn-cancel-rename">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                {renameError && <p className="text-xs text-red-600" data-testid="text-rename-error">{renameError}</p>}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <SheetTitle className="text-lg">{selectedCp}</SheetTitle>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-blue-600"
                  onClick={handleStartRename} title="Rename subcontractor" data-testid="btn-rename-counterparty">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </SheetHeader>
          {detailLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : detailData ? (
            <div className="space-y-4 mt-4">
              {detailData.invoiceSummary && (
                <div data-testid="invoice-summary-section">
                  <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Invoice Summary
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                      <p className="text-[10px] text-slate-500 uppercase">Total Invoices</p>
                      <p className="text-lg font-bold">{detailData.invoiceSummary.totalInvoices}</p>
                      <p className="text-xs text-slate-400 font-mono">{formatCurrency(detailData.invoiceSummary.totalAmount)}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                      <p className="text-[10px] text-green-700 uppercase flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Settled / Paid
                      </p>
                      <p className="text-lg font-bold text-green-700">{detailData.invoiceSummary.settled.count}</p>
                      <p className="text-xs text-green-600 font-mono">{formatCurrency(detailData.invoiceSummary.settled.amount)}</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                      <p className="text-[10px] text-amber-700 uppercase flex items-center gap-1">
                        <CircleDot className="w-3 h-3" /> Outstanding
                      </p>
                      <p className="text-lg font-bold text-amber-700">{detailData.invoiceSummary.outstanding.count}</p>
                      <p className="text-xs text-amber-600 font-mono">{formatCurrency(detailData.invoiceSummary.outstanding.amount)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                      <div className="flex gap-3 text-[10px]">
                        <div>
                          <span className="text-slate-500">Invoiced:</span>{" "}
                          <span className="font-medium">{detailData.invoiceSummary.invoiced.count}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Approved:</span>{" "}
                          <span className="font-medium">{detailData.invoiceSummary.approved.count}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Planned:</span>{" "}
                          <span className="font-medium">{detailData.invoiceSummary.planned.count}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-500 uppercase">Last Activity</p>
                  <p className="text-sm font-medium">{formatDate(detailData.linkedDates?.lastActivity)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-500 uppercase">Oldest Open</p>
                  <p className="text-sm font-medium">{formatDate(detailData.linkedDates?.oldestOpen)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-500 uppercase">Next Due</p>
                  <p className="text-sm font-medium">{formatDate(detailData.linkedDates?.nextDue)}</p>
                </div>
              </div>

              {detailData.monthlyTrend?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-slate-600">Monthly Spend Trend</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={detailData.monthlyTrend}>
                          <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `R${(v/1000).toFixed(0)}k`} />
                          <Tooltip formatter={(v: number) => [formatCurrency(v), "Spend"]} />
                          <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {detailData.projectBreakdown?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-600 mb-2">Project Breakdown</p>
                  <div className="space-y-1">
                    {detailData.projectBreakdown.map((p: any) => (
                      <div key={p.projectName} className="flex justify-between items-center bg-slate-50 rounded px-3 py-2 group hover:bg-blue-50 transition-colors"
                        data-testid={`project-breakdown-${p.projectName}`}>
                        <button
                          className="text-xs font-medium text-blue-700 hover:underline flex items-center gap-1"
                          onClick={() => { setSelectedCp(null); navigate(`/project/${encodeURIComponent(p.projectName)}`); }}
                          data-testid={`link-project-${p.projectName}`}
                        >
                          <ExternalLink className="w-3 h-3" />
                          {p.projectName}
                        </button>
                        <div className="text-right text-[11px]">
                          <span className="font-mono">{formatCurrency(p.totalSpend)}</span>
                          <span className="text-slate-400 ml-1.5">({p.lineCount} lines)</span>
                          {p.openCount > 0 && (
                            <span className="ml-2 text-amber-600">{p.openCount} open</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detailData.upcoming?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-600 mb-2 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Upcoming Items (30d)
                  </p>
                  <div className="space-y-1">
                    {detailData.upcoming.map((u: any, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-purple-50 rounded px-3 py-2">
                        <div>
                          <button className="text-xs font-medium text-blue-700 hover:underline"
                            onClick={() => { setSelectedCp(null); navigate(`/project/${encodeURIComponent(u.projectName)}`); }}>
                            {u.projectName}
                          </button>
                          <span className="text-[10px] text-slate-500 ml-2">{u.description || ""}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-mono">{formatCurrency(parseFloat(u.amountExVat || "0"))}</span>
                          <span className="text-[10px] text-slate-400 ml-2">{formatDate(u.invoiceDate)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div data-testid="invoice-lines-section">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-slate-600">
                    All Invoices ({(() => {
                      const lines = detailData.lines || [];
                      if (invoiceStatusFilter === "all") return lines.length;
                      return lines.filter((l: any) => invoiceStatusFilter === "outstanding" ? l.status !== "PAID" : l.status === invoiceStatusFilter).length;
                    })()})
                  </p>
                </div>
                <Tabs value={invoiceStatusFilter} onValueChange={setInvoiceStatusFilter} className="mb-2">
                  <TabsList className="h-7">
                    <TabsTrigger value="all" className="text-[10px] px-2 h-6" data-testid="tab-all-invoices">All</TabsTrigger>
                    <TabsTrigger value="PAID" className="text-[10px] px-2 h-6" data-testid="tab-paid-invoices">Settled</TabsTrigger>
                    <TabsTrigger value="outstanding" className="text-[10px] px-2 h-6" data-testid="tab-outstanding-invoices">Outstanding</TabsTrigger>
                    <TabsTrigger value="INVOICED" className="text-[10px] px-2 h-6" data-testid="tab-invoiced">Invoiced</TabsTrigger>
                    <TabsTrigger value="PLANNED" className="text-[10px] px-2 h-6" data-testid="tab-planned">Planned</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="border border-slate-200 rounded-lg overflow-hidden max-h-[350px] overflow-y-auto">
                  <table className="w-full text-[11px]" data-testid="invoice-detail-table">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="border-b border-slate-200">
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">Project</th>
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">Category</th>
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">Invoice #</th>
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">Amount</th>
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">Date</th>
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">Paid</th>
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailData.lines || [])
                        .filter((l: any) => {
                          if (invoiceStatusFilter === "all") return true;
                          if (invoiceStatusFilter === "outstanding") return l.status !== "PAID";
                          return l.status === invoiceStatusFilter;
                        })
                        .map((l: any) => (
                        <tr key={l.id} className="border-b border-slate-100 hover:bg-blue-50/30 group" data-testid={`invoice-row-${l.id}`}>
                          <td className="px-2 py-1.5">
                            <button
                              className="text-blue-700 hover:underline flex items-center gap-0.5"
                              onClick={() => { setSelectedCp(null); navigate(`/project/${encodeURIComponent(l.projectName)}`); }}
                              data-testid={`nav-project-${l.id}`}
                            >
                              {l.projectName}
                              <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                          </td>
                          <td className="px-2 py-1.5 text-slate-500">{l.costCategory || "\u2014"}</td>
                          <td className="px-2 py-1.5 font-mono">{l.invoiceNumber || "\u2014"}</td>
                          <td className="px-2 py-1.5 font-mono">{formatCurrency(parseFloat(l.amountExVat || "0"))}</td>
                          <td className="px-2 py-1.5 text-slate-500">{formatDate(l.invoiceDate)}</td>
                          <td className="px-2 py-1.5 text-slate-500">{formatDate(l.paidDate)}</td>
                          <td className="px-2 py-1.5">
                            <Badge variant={l.status === "PAID" ? "default" : l.status === "INVOICED" ? "secondary" : "outline"}
                              className={`text-[9px] ${l.status === "PAID" ? "bg-green-100 text-green-700 border-green-200" : l.status !== "PLANNED" ? "" : "text-slate-500"}`}>
                              {l.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
