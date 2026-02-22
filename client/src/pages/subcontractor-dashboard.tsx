import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  DollarSign, Users, Clock, TrendingUp, Search, Filter,
  Loader2, ArrowUpDown, ChevronRight, AlertCircle, Calendar,
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
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [coreOnly, setCoreOnly] = useState(false);
  const [sortField, setSortField] = useState<SortField>("totalSpendExVat");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedCp, setSelectedCp] = useState<string | null>(null);

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

      <Sheet open={!!selectedCp} onOpenChange={(open) => { if (!open) setSelectedCp(null); }}>
        <SheetContent className="w-[500px] sm:w-[600px] overflow-y-auto" data-testid="cp-detail-drawer">
          <SheetHeader>
            <SheetTitle className="text-lg">{selectedCp}</SheetTitle>
          </SheetHeader>
          {detailLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : detailData ? (
            <div className="space-y-4 mt-4">
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
                      <div key={p.projectName} className="flex justify-between items-center bg-slate-50 rounded px-3 py-2">
                        <span className="text-xs font-medium">{p.projectName}</span>
                        <span className="text-xs text-slate-500">{formatCurrency(p.totalSpend)} ({p.lineCount} lines)</span>
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
                          <span className="text-xs font-medium">{u.projectName}</span>
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

              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">All Cost Lines ({detailData.lines?.length || 0})</p>
                <div className="border border-slate-200 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="border-b border-slate-200">
                        <th className="text-left px-2 py-1 font-medium text-slate-600">Project</th>
                        <th className="text-left px-2 py-1 font-medium text-slate-600">Invoice #</th>
                        <th className="text-left px-2 py-1 font-medium text-slate-600">Amount</th>
                        <th className="text-left px-2 py-1 font-medium text-slate-600">Date</th>
                        <th className="text-left px-2 py-1 font-medium text-slate-600">Paid</th>
                        <th className="text-left px-2 py-1 font-medium text-slate-600">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailData.lines || []).map((l: any) => (
                        <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-2 py-1">{l.projectName}</td>
                          <td className="px-2 py-1 font-mono">{l.invoiceNumber || "\u2014"}</td>
                          <td className="px-2 py-1 font-mono">{formatCurrency(parseFloat(l.amountExVat || "0"))}</td>
                          <td className="px-2 py-1 text-slate-500">{formatDate(l.invoiceDate)}</td>
                          <td className="px-2 py-1 text-slate-500">{formatDate(l.paidDate)}</td>
                          <td className="px-2 py-1">
                            <Badge variant={l.status === "PAID" ? "default" : "outline"} className="text-[9px]">
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
