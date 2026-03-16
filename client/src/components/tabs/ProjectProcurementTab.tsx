import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { POGenerator } from "@/components/POGenerator";
import CaptureDeliverable from "@/components/CaptureDeliverable";
import {
  Loader2,
  Plus,
  Package,
  DollarSign,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Trash2,
  AlertCircle,
  Truck,
  FileText,
  Link2,
  Clock,
  ShoppingCart,
  Receipt,
  TrendingUp,
  Download,
  CheckCircle,
  Wallet,
} from "lucide-react";

interface ProjectProcurementTabProps {
  projectId: number;
  projectName: string;
}

const CATEGORIES = ["material", "equipment", "service", "subcontract", "other"] as const;
const STATUSES = ["requested", "quoted", "approved", "ordered", "partially_received", "received", "invoiced", "closed"] as const;

const CATEGORY_COLORS: Record<string, string> = {
  material: "bg-slate-100 text-slate-700 border-slate-200",
  equipment: "bg-blue-100 text-blue-700 border-blue-200",
  service: "bg-purple-100 text-purple-700 border-purple-200",
  subcontract: "bg-orange-100 text-orange-700 border-orange-200",
  other: "bg-gray-100 text-gray-700 border-gray-200",
};

const STATUS_COLORS: Record<string, string> = {
  requested: "bg-gray-100 text-gray-700 border-gray-200",
  quoted: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  ordered: "bg-sky-100 text-sky-700 border-sky-200",
  partially_received: "bg-amber-100 text-amber-700 border-amber-200",
  received: "bg-emerald-100 text-emerald-700 border-emerald-200",
  invoiced: "bg-violet-100 text-violet-700 border-violet-200",
  closed: "bg-slate-100 text-slate-700 border-slate-200",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  requested: ["quoted", "approved", "closed"],
  quoted: ["approved", "rejected", "closed"],
  approved: ["ordered", "closed"],
  ordered: ["partially_received", "received", "closed"],
  partially_received: ["received", "closed"],
  received: ["invoiced", "closed"],
  invoiced: ["closed"],
};

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function formatRand(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "R 0";
  return "R " + Math.round(n).toLocaleString("en-ZA");
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

function formatDateInput(d: string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toISOString().split("T")[0];
  } catch {
    return "";
  }
}

type ProcurementSubTab = "overview" | "commercial-control" | "items" | "purchase-orders" | "deliveries" | "invoices" | "traceability";

const SUB_TABS: { key: ProcurementSubTab; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "commercial-control", label: "Commercial Control", icon: Wallet },
  { key: "items", label: "Items", icon: Package },
  { key: "purchase-orders", label: "Purchase Orders", icon: ShoppingCart },
  { key: "deliveries", label: "Deliveries", icon: Truck },
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "traceability", label: "Traceability", icon: Link2 },
];

export function ProjectProcurementTab({ projectId, projectName }: ProjectProcurementTabProps) {
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState<ProcurementSubTab>("overview");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: items = [], isLoading, error } = useQuery<any[]>({
    queryKey: ["procurement", projectId, statusFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      const res = await fetch(
        `/api/procurement/project/${projectId}?${params.toString()}`,
        { headers: getAuthHeaders(), credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load procurement items");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ["supplier-list"],
    queryFn: async () => {
      const res = await fetch("/api/subcontractor-dashboard/supplier-list", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load suppliers");
      return res.json();
    },
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["users-list"],
    queryFn: async () => {
      const res = await fetch("/api/users", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/procurement/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["procurement", projectId] }),
  });

  const totalExpected = items.reduce((s: number, i: any) => s + (parseFloat(i.expected_cost) || 0), 0);
  const totalActual = items.reduce((s: number, i: any) => s + (parseFloat(i.actual_cost) || 0), 0);
  const totalCommitted = items.reduce((s: number, i: any) => {
    const committedStatuses = ["approved", "ordered", "partially_received", "received", "invoiced", "closed"];
    return s + (committedStatuses.includes(i.status) ? (parseFloat(i.expected_cost) || 0) : 0);
  }, 0);

  const statusCounts: Record<string, number> = {};
  items.forEach((i: any) => {
    statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500" data-testid="procurement-loading">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading procurement items...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16 text-red-500" data-testid="procurement-error">
        <AlertCircle className="w-5 h-5 mr-2" />
        Failed to load procurement data
      </div>
    );
  }

  const supplierOptions = suppliers.map((s: any) => ({
    value: String(s.id),
    label: s.name_canonical || s.name || `Supplier ${s.id}`,
  }));

  const userOptions = users.map((u: any) => ({
    value: String(u.id),
    label: u.fullName || u.full_name || u.username || `User ${u.id}`,
  }));

  const categoryOptions = [
    { value: "", label: "All Categories" },
    ...CATEGORIES.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
  ];

  const statusOptions = [
    { value: "", label: "All Statuses" },
    ...STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) })),
  ];

  const overdueItems = items.filter((i: any) => {
    if (!i.required_date) return false;
    const completedStatuses = ["received", "invoiced", "closed"];
    if (completedStatuses.includes(i.status)) return false;
    return new Date(i.required_date) < new Date();
  });

  const orderedNotReceived = items.filter((i: any) =>
    i.status === "ordered" || i.status === "partially_received"
  );

  const receivedNotInvoiced = items.filter((i: any) =>
    i.status === "received"
  );

  return (
    <div className="space-y-4" data-testid="project-procurement-tab">
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto" data-testid="procurement-sub-tabs">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.key;
          return (
        <Button
              key={tab.key}
              size="sm"
              variant={isActive ? "default" : "ghost"}
              className={`h-8 text-xs gap-1.5 whitespace-nowrap ${
                isActive
                  ? "bg-[#16A34A] hover:bg-[#15803d] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
              }`}
              onClick={() => setActiveSubTab(tab.key)}
              data-testid={`subtab-${tab.key}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {activeSubTab === "overview" && (
        <div className="space-y-4" data-testid="procurement-overview">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="bg-white">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-[#16A34A]" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Total Items</span>
                </div>
                <p className="text-xl font-bold text-foreground" data-testid="overview-total-items">{items.length}</p>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-[#16A34A]" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Expected Cost</span>
                </div>
                <p className="text-xl font-bold text-foreground font-mono" data-testid="overview-expected-cost">{formatRand(totalExpected)}</p>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-emerald-500" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Actual Cost</span>
                </div>
                <p className="text-xl font-bold text-foreground font-mono" data-testid="overview-actual-cost">{formatRand(totalActual)}</p>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-red-500" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Overdue</span>
                </div>
                <p className={`text-xl font-bold ${overdueItems.length > 0 ? "text-red-600" : "text-foreground"}`} data-testid="overview-overdue">{overdueItems.length}</p>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Truck className="w-4 h-4 text-sky-500" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Awaiting Delivery</span>
                </div>
                <p className="text-xl font-bold text-foreground" data-testid="overview-ordered-not-received">{orderedNotReceived.length}</p>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Receipt className="w-4 h-4 text-violet-500" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Awaiting Invoice</span>
                </div>
                <p className="text-xl font-bold text-foreground" data-testid="overview-received-not-invoiced">{receivedNotInvoiced.length}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-white">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#16A34A]" />
                  Items by Status
                </h3>
                <div className="space-y-2" data-testid="overview-status-breakdown">
                  {STATUSES.map((s) => {
                    const count = statusCounts[s] || 0;
                    const pct = items.length > 0 ? (count / items.length) * 100 : 0;
                    return (
                      <div key={s} className="flex items-center gap-2">
                        <Badge variant="outline" className={`text-[9px] w-28 justify-center ${STATUS_COLORS[s]}`}>
                          {s.replace(/_/g, " ")}
                        </Badge>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#16A34A] rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-muted-foreground w-8 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#16A34A]" />
                  Cost Summary
                </h3>
                <div className="space-y-3" data-testid="overview-cost-summary">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Expected Total</span>
                    <span className="text-sm font-bold font-mono">{formatRand(totalExpected)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Actual Total</span>
                    <span className="text-sm font-bold font-mono">{formatRand(totalActual)}</span>
                  </div>
                  <div className="border-t border-slate-200 pt-2 flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Variance</span>
                    <span className={`text-sm font-bold font-mono ${totalActual > totalExpected ? "text-red-600" : "text-[#16A34A]"}`}>
                      {formatRand(totalExpected - totalActual)}
                    </span>
                  </div>
                  {items.length > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Avg per item</span>
                      <span className="text-sm font-mono text-muted-foreground">{formatRand(totalExpected / items.length)}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {overdueItems.length > 0 && (
            <Card className="bg-white border-red-200">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold text-red-600 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Overdue Items
                </h3>
                <div className="space-y-1" data-testid="overview-overdue-list">
                  {overdueItems.map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{item.title}</span>
                        <Badge variant="outline" className={`text-[9px] ${STATUS_COLORS[item.status]}`}>
                          {item.status?.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <span className="text-xs text-red-500 font-mono">{formatDate(item.required_date)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}


      {activeSubTab === "commercial-control" && (
        <Card className="bg-white" data-testid="procurement-commercial-control">
          <CardContent className="p-4 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-[#16A34A]" />Project Commercial Control</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="border rounded-md p-3 bg-slate-50">
                <p className="text-[10px] uppercase text-muted-foreground">Planned</p>
                <p className="text-lg font-bold font-mono">{formatRand(totalExpected)}</p>
              </div>
              <div className="border rounded-md p-3 bg-blue-50">
                <p className="text-[10px] uppercase text-muted-foreground">Committed</p>
                <p className="text-lg font-bold font-mono">{formatRand(totalCommitted)}</p>
              </div>
              <div className="border rounded-md p-3 bg-emerald-50">
                <p className="text-[10px] uppercase text-muted-foreground">Actual</p>
                <p className="text-lg font-bold font-mono">{formatRand(totalActual)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Status flow: Request → PO → Delivery → Invoice → Approval → Payment. Use Item detail fields to link budget line, deliverable, receipt, invoice, and payment status without duplicate capture.</p>
          </CardContent>
        </Card>
      )}

      {activeSubTab === "items" && (
        <div className="space-y-4" data-testid="procurement-items-tab">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="bg-white">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-[#16A34A]" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Total Items</span>
                </div>
                <p className="text-xl font-bold text-foreground" data-testid="kpi-total-items">{items.length}</p>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-[#16A34A]" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Expected Cost</span>
                </div>
                <p className="text-xl font-bold text-foreground font-mono" data-testid="kpi-expected-cost">{formatRand(totalExpected)}</p>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-emerald-500" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Actual Cost</span>
                </div>
                <p className="text-xl font-bold text-foreground font-mono" data-testid="kpi-actual-cost">{formatRand(totalActual)}</p>
              </CardContent>
            </Card>
            <Card className="bg-white">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-4 h-4 text-[#16A34A]" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Pipeline</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1" data-testid="kpi-pipeline">
                  {STATUSES.map((s) =>
                    statusCounts[s] ? (
                      <Badge key={s} variant="outline" className={`text-[9px] ${STATUS_COLORS[s]}`} data-testid={`pipeline-${s}`}>
                        {s.replace(/_/g, " ")} ({statusCounts[s]})
                      </Badge>
                    ) : null
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <SearchableSelect
              options={categoryOptions}
              value={categoryFilter}
              onValueChange={setCategoryFilter}
              placeholder="Category"
              triggerClassName="h-8 text-xs w-[160px]"
              data-testid="filter-category"
            />
            <SearchableSelect
              options={statusOptions}
              value={statusFilter}
              onValueChange={setStatusFilter}
              placeholder="Status"
              triggerClassName="h-8 text-xs w-[160px]"
              data-testid="filter-status"
            />
            <div className="flex-1" />
            <Button
              size="sm"
              className="h-8 text-xs gap-1 bg-[#16A34A] hover:bg-[#15803d] text-white"
              onClick={() => setCreateOpen(true)}
              data-testid="btn-create-procurement"
            >
              <Plus className="w-3 h-3" />
              New Item
            </Button>
          </div>

          <Card className="bg-white">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs">Category</TableHead>
                    <TableHead className="text-xs">Supplier</TableHead>
                    <TableHead className="text-xs text-right">Expected Cost</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Required Date</TableHead>
                    <TableHead className="text-xs w-16">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground" data-testid="empty-procurement">
                        No procurement items found. Click "New Item" to create one.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item: any) => {
                      const isExpanded = expandedId === item.id;
                      return (
                        <ProcurementRow
                          key={item.id}
                          item={item}
                          isExpanded={isExpanded}
                          onToggle={() => setExpandedId(isExpanded ? null : item.id)}
                          onDelete={() => deleteMutation.mutate(item.id)}
                          projectId={projectId}
                          supplierOptions={supplierOptions}
                          userOptions={userOptions}
                        />
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          <CreateProcurementDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            projectId={projectId}
            supplierOptions={supplierOptions}
            userOptions={userOptions}
          />
        </div>
      )}

      {activeSubTab === "purchase-orders" && (
        <PurchaseOrdersSubTab projectName={projectName} projectId={projectId} />
      )}

      {activeSubTab === "deliveries" && (
        <DeliveriesSubTab items={items} projectId={projectId} projectName={projectName} />
      )}

      {activeSubTab === "invoices" && (
        <InvoicesSubTab projectId={projectId} projectName={projectName} items={items} supplierOptions={supplierOptions} />
      )}

      {activeSubTab === "traceability" && (
        <TraceabilitySubTab projectId={projectId} projectName={projectName} items={items} />
      )}
    </div>
  );
}

function ProcurementRow({
  item,
  isExpanded,
  onToggle,
  onDelete,
  projectId,
  supplierOptions,
  userOptions,
}: {
  item: any;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  projectId: number;
  supplierOptions: { value: string; label: string }[];
  userOptions: { value: string; label: string }[];
}) {
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-slate-50"
        onClick={onToggle}
        data-testid={`row-procurement-${item.id}`}
      >
        <TableCell className="px-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
        </TableCell>
        <TableCell className="text-sm font-medium" data-testid={`text-title-${item.id}`}>{item.title}</TableCell>
        <TableCell>
          <Badge variant="outline" className={`text-[10px] ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.other}`} data-testid={`badge-category-${item.id}`}>
            {item.category}
          </Badge>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground" data-testid={`text-supplier-${item.id}`}>
          {item.supplier_name || "—"}
        </TableCell>
        <TableCell className="text-sm font-mono text-right" data-testid={`text-expected-cost-${item.id}`}>
          {formatRand(parseFloat(item.expected_cost))}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[item.status] || STATUS_COLORS.requested}`} data-testid={`badge-status-${item.id}`}>
            {item.status?.replace(/_/g, " ")}
          </Badge>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground" data-testid={`text-date-${item.id}`}>
          {formatDate(item.required_date)}
        </TableCell>
        <TableCell>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            data-testid={`btn-delete-${item.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={8} className="p-0 bg-slate-50/50">
            <ExpandedProcurementDetail
              item={item}
              projectId={projectId}
              supplierOptions={supplierOptions}
              userOptions={userOptions}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ExpandedProcurementDetail({
  item,
  projectId,
  supplierOptions,
  userOptions,
}: {
  item: any;
  projectId: number;
  supplierOptions: { value: string; label: string }[];
  userOptions: { value: string; label: string }[];
}) {
  const queryClient = useQueryClient();
  const [actualCost, setActualCost] = useState(item.actual_cost?.toString() || "");
  const [poId, setPoId] = useState(item.po_id || "");
  const [invoiceRef, setInvoiceRef] = useState(item.invoice_ref || "");
  const [budgetLine, setBudgetLine] = useState(item.budget_line || "");
  const [linkedMilestone, setLinkedMilestone] = useState(item.linked_milestone || "");
  const [receiptRef, setReceiptRef] = useState(item.receipt_ref || "");
  const [progressPercent, setProgressPercent] = useState(item.progress_percent?.toString() || "");
  const [paymentStatus, setPaymentStatus] = useState(item.payment_status || "not_applicable");

  const patchMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const res = await fetch(`/api/procurement/${item.id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["procurement", projectId] }),
  });

  const transitions = VALID_TRANSITIONS[item.status] || [];

  return (
    <div className="p-4 space-y-4 border-t border-slate-200" data-testid={`detail-procurement-${item.id}`}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase block">Description</span>
          <p className="text-foreground mt-0.5" data-testid={`text-description-${item.id}`}>{item.description || "—"}</p>
        </div>
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase block">Quantity</span>
          <p className="text-foreground mt-0.5 font-mono" data-testid={`text-quantity-${item.id}`}>
            {item.quantity || "—"} {item.unit || ""}
          </p>
        </div>
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase block">Requested By</span>
          <p className="text-foreground mt-0.5" data-testid={`text-requested-by-${item.id}`}>{item.requested_by_name || "—"}</p>
        </div>
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase block">Owner</span>
          <p className="text-foreground mt-0.5" data-testid={`text-owner-${item.id}`}>{item.owner_name || "—"}</p>
        </div>
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase block">Notes</span>
          <p className="text-foreground mt-0.5" data-testid={`text-notes-${item.id}`}>{item.notes || "—"}</p>
        </div>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Actual Cost (R)</Label>
          <Input
            className="h-8 w-32 text-xs font-mono"
            value={actualCost}
            onChange={(e) => setActualCost(e.target.value)}
            placeholder="0"
            data-testid={`input-actual-cost-${item.id}`}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">PO Reference</Label>
          <Input
            className="h-8 w-40 text-xs"
            value={poId}
            onChange={(e) => setPoId(e.target.value)}
            placeholder="PO number"
            data-testid={`input-po-${item.id}`}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Budget Line</Label>
          <Input className="h-8 w-40 text-xs" value={budgetLine} onChange={(e) => setBudgetLine(e.target.value)} placeholder="Budget line" data-testid={`input-budget-line-${item.id}`} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Invoice Ref</Label>
          <Input
            className="h-8 w-40 text-xs"
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="Invoice reference"
            data-testid={`input-invoice-ref-${item.id}`}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Milestone</Label>
          <Input className="h-8 w-40 text-xs" value={linkedMilestone} onChange={(e) => setLinkedMilestone(e.target.value)} placeholder="Milestone" data-testid={`input-linked-milestone-${item.id}`} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Receipt Ref</Label>
          <Input className="h-8 w-40 text-xs" value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} placeholder="GRN / receipt" data-testid={`input-receipt-ref-${item.id}`} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Progress %</Label>
          <Input className="h-8 w-24 text-xs font-mono" value={progressPercent} onChange={(e) => setProgressPercent(e.target.value)} placeholder="0-100" data-testid={`input-progress-${item.id}`} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Payment</Label>
          <SearchableSelect options={[{ value: "not_applicable", label: "Not Applicable" }, { value: "pending_approval", label: "Pending Approval" }, { value: "approved", label: "Approved" }, { value: "scheduled", label: "Scheduled" }, { value: "paid", label: "Paid" }, { value: "on_hold", label: "On Hold" }]} value={paymentStatus} onValueChange={setPaymentStatus} triggerClassName="h-8 text-xs w-40" data-testid={`select-payment-status-${item.id}`} />
        </div>
        <Button
          size="sm"
          className="h-8 text-xs bg-[#16A34A] hover:bg-[#15803d] text-white"
          disabled={patchMutation.isPending}
          onClick={() =>
            patchMutation.mutate({
              actualCost: actualCost ? parseFloat(actualCost) : undefined,
              poId: poId || undefined,
              invoiceRef: invoiceRef || undefined,
              budgetLine: budgetLine || undefined,
              linkedMilestone: linkedMilestone || undefined,
              receiptRef: receiptRef || undefined,
              progressPercent: progressPercent ? parseFloat(progressPercent) : undefined,
              paymentStatus,
            })
          }
          data-testid={`btn-save-detail-${item.id}`}
        >
          {patchMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
        </Button>
      </div>

      {transitions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-slate-200">
          <span className="text-[10px] font-medium text-muted-foreground uppercase">Transition to:</span>
          {transitions.map((t) => (
            <Button
              key={t}
              size="sm"
              variant="outline"
              className={`h-7 text-[11px] ${STATUS_COLORS[t] || ""}`}
              disabled={patchMutation.isPending}
              onClick={() => patchMutation.mutate({ status: t })}
              data-testid={`btn-transition-${t}-${item.id}`}
            >
              {t.replace(/_/g, " ")}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateProcurementDialog({
  open,
  onOpenChange,
  projectId,
  supplierOptions,
  userOptions,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  supplierOptions: { value: string; label: string }[];
  userOptions: { value: string; label: string }[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    supplierId: "",
    quantity: "",
    unit: "",
    expectedCost: "",
    requiredDate: "",
    ownerUserId: "",
    notes: "",
    budgetLine: "",
    linkedDeliverableId: "",
    linkedMilestone: "",
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/procurement", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create procurement item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procurement", projectId] });
      onOpenChange(false);
      setForm({ title: "", description: "", category: "", supplierId: "", quantity: "", unit: "", expectedCost: "", requiredDate: "", ownerUserId: "", notes: "", budgetLine: "", linkedDeliverableId: "", linkedMilestone: "" });
    },
  });

  const handleSubmit = () => {
    createMutation.mutate({
      projectId,
      title: form.title,
      description: form.description || undefined,
      category: form.category || undefined,
      quantity: form.quantity ? parseFloat(form.quantity) : undefined,
      unit: form.unit || undefined,
      expectedCost: form.expectedCost ? parseFloat(form.expectedCost) : undefined,
      supplierId: form.supplierId ? parseInt(form.supplierId) : undefined,
      ownerUserId: form.ownerUserId ? parseInt(form.ownerUserId) : undefined,
      requiredDate: form.requiredDate || undefined,
      notes: form.notes || undefined,
      budgetLine: form.budgetLine || undefined,
      linkedDeliverableId: form.linkedDeliverableId ? parseInt(form.linkedDeliverableId) : undefined,
      linkedMilestone: form.linkedMilestone || undefined,
    });
  };

  const categorySelectOptions = CATEGORIES.map((c) => ({
    value: c,
    label: c.charAt(0).toUpperCase() + c.slice(1),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-white" data-testid="dialog-create-procurement">
        <DialogHeader>
          <DialogTitle>New Procurement Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Title *</Label>
            <Input
              className="h-8 text-sm"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Item title"
              data-testid="input-create-title"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea
              className="text-sm min-h-[60px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description"
              data-testid="input-create-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <SearchableSelect
                options={categorySelectOptions}
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v })}
                placeholder="Select category"
                triggerClassName="h-8 text-xs w-full"
                data-testid="select-create-category"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Supplier</Label>
              <SearchableSelect
                options={supplierOptions}
                value={form.supplierId}
                onValueChange={(v) => setForm({ ...form, supplierId: v })}
                placeholder="Select supplier"
                searchPlaceholder="Search suppliers..."
                triggerClassName="h-8 text-xs w-full"
                data-testid="select-create-supplier"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Quantity</Label>
              <Input
                type="number"
                className="h-8 text-sm"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                placeholder="0"
                data-testid="input-create-quantity"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Unit</Label>
              <Input
                className="h-8 text-sm"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="e.g. m, kg, units"
                data-testid="input-create-unit"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Expected Cost (R)</Label>
              <Input
                type="number"
                className="h-8 text-sm"
                value={form.expectedCost}
                onChange={(e) => setForm({ ...form, expectedCost: e.target.value })}
                placeholder="0"
                data-testid="input-create-expected-cost"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Required Date</Label>
              <Input
                type="date"
                className="h-8 text-sm"
                value={form.requiredDate}
                onChange={(e) => setForm({ ...form, requiredDate: e.target.value })}
                data-testid="input-create-required-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Owner</Label>
              <SearchableSelect
                options={userOptions}
                value={form.ownerUserId}
                onValueChange={(v) => setForm({ ...form, ownerUserId: v })}
                placeholder="Select owner"
                searchPlaceholder="Search users..."
                triggerClassName="h-8 text-xs w-full"
                data-testid="select-create-owner"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Budget Line</Label>
              <Input className="h-8 text-sm" value={form.budgetLine} onChange={(e) => setForm({ ...form, budgetLine: e.target.value })} placeholder="e.g. BOS-Electrical" data-testid="input-create-budget-line" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Milestone</Label>
              <Input className="h-8 text-sm" value={form.linkedMilestone} onChange={(e) => setForm({ ...form, linkedMilestone: e.target.value })} placeholder="Milestone ref" data-testid="input-create-milestone" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              className="text-sm min-h-[50px]"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Additional notes"
              data-testid="input-create-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid="btn-cancel-create">
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-[#16A34A] hover:bg-[#15803d] text-white"
            disabled={!form.title || createMutation.isPending}
            onClick={handleSubmit}
            data-testid="btn-submit-create"
          >
            {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PO_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  sent: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

type TraceFilter = "all" | "complete" | "partial" | "issues";

function getTraceStatus(item: any, poList: any[], invoices: any[]) {
  const hasPo = !!item.po_id || poList.some((po: any) => po.id === item.po_id);
  const deliveryStatuses = ["ordered", "partially_received", "received", "invoiced", "closed"];
  const deliveredStatuses = ["received", "invoiced", "closed"];
  const hasDelivery = deliveredStatuses.includes(item.status);
  const deliveryInProgress = item.status === "ordered" || item.status === "partially_received";
  const linkedInvoice = invoices.find((inv: any) => inv.linked_procurement_item_id === item.id);
  const hasInvoice = !!linkedInvoice;
  const hasFinancial = (parseFloat(item.actual_cost) || 0) > 0;

  const steps = {
    need: { status: "complete" as const, label: "Need" },
    po: { status: hasPo ? "complete" as const : (deliveryStatuses.includes(item.status) ? "issue" as const : "pending" as const), label: "PO" },
    delivery: { status: hasDelivery ? "complete" as const : (deliveryInProgress ? "in-progress" as const : "pending" as const), label: "Delivery" },
    invoice: { status: hasInvoice ? "complete" as const : (hasDelivery && !hasInvoice ? "issue" as const : "pending" as const), label: "Invoice" },
    financial: { status: hasFinancial ? "complete" as const : "pending" as const, label: "Cost Impact" },
  };

  const completedCount = Object.values(steps).filter(s => s.status === "complete").length;
  const issueCount = Object.values(steps).filter(s => s.status === "issue").length;
  const traceLevel: TraceFilter = completedCount === 5 ? "complete" : issueCount > 0 ? "issues" : completedCount > 1 ? "partial" : "all";

  return { steps, completedCount, issueCount, traceLevel, linkedInvoice };
}

function TraceabilitySubTab({ projectId, projectName, items }: { projectId: number; projectName: string; items: any[] }) {
  const [filter, setFilter] = useState<TraceFilter>("all");

  const { data: poList = [] } = useQuery<any[]>({
    queryKey: ["po-list", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/po/${encodeURIComponent(projectName)}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const { data: invoices = [] } = useQuery<any[]>({
    queryKey: ["invoice-captures", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/invoice-captures/project/${projectId}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectId,
  });

  const tracedItems = items.map((item: any) => {
    const trace = getTraceStatus(item, poList, invoices);
    return { ...item, trace };
  });

  const completeCount = tracedItems.filter(i => i.trace.traceLevel === "complete").length;
  const partialCount = tracedItems.filter(i => i.trace.traceLevel === "partial").length;
  const issueCount = tracedItems.filter(i => i.trace.traceLevel === "issues").length;
  const unstartedCount = tracedItems.filter(i => i.trace.completedCount <= 1).length;

  const filtered = filter === "all"
    ? tracedItems
    : filter === "complete"
    ? tracedItems.filter(i => i.trace.traceLevel === "complete")
    : filter === "partial"
    ? tracedItems.filter(i => i.trace.traceLevel === "partial")
    : tracedItems.filter(i => i.trace.traceLevel === "issues");

  const FILTER_OPTIONS: { key: TraceFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: items.length },
    { key: "complete", label: "Complete", count: completeCount },
    { key: "partial", label: "Partial", count: partialCount },
    { key: "issues", label: "Issues", count: issueCount },
  ];

  const stepIcon = (status: "complete" | "in-progress" | "pending" | "issue") => {
    if (status === "complete") return <CheckCircle className="w-4 h-4 text-[#16A34A]" />;
    if (status === "in-progress") return <Clock className="w-4 h-4 text-amber-500" />;
    if (status === "issue") return <AlertCircle className="w-4 h-4 text-red-500" />;
    return <div className="w-4 h-4 rounded-full border-2 border-slate-300" />;
  };

  const stepBg = (status: "complete" | "in-progress" | "pending" | "issue") => {
    if (status === "complete") return "bg-green-50 border-green-200";
    if (status === "in-progress") return "bg-amber-50 border-amber-200";
    if (status === "issue") return "bg-red-50 border-red-200";
    return "bg-slate-50 border-slate-200";
  };

  return (
    <div className="space-y-4" data-testid="procurement-traceability-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-[#16A34A]" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Fully Traced</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="trace-complete-count">{completeCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Partial</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="trace-partial-count">{partialCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Issues</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="trace-issues-count">{issueCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-slate-400" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Unstarted</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="trace-unstarted-count">{unstartedCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" data-testid="trace-filter-bar">
        {FILTER_OPTIONS.map(opt => (
          <Button
            key={opt.key}
            size="sm"
            variant={filter === opt.key ? "default" : "ghost"}
            className={`h-7 text-xs gap-1 ${
              filter === opt.key
                ? "bg-[#16A34A] hover:bg-[#15803d] text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
            }`}
            onClick={() => setFilter(opt.key)}
            data-testid={`btn-trace-filter-${opt.key}`}
          >
            {opt.label}
            <Badge variant="outline" className={`text-[9px] ml-0.5 ${filter === opt.key ? "border-white/40 text-white" : "border-slate-300 text-slate-500"}`}>
              {opt.count}
            </Badge>
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="bg-white">
          <CardContent className="p-8 text-center">
            <Link2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground" data-testid="trace-empty">No items match the selected filter.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((item: any) => {
            const { steps, completedCount: sc, issueCount: ic, linkedInvoice } = item.trace;
            const expectedCost = parseFloat(item.expected_cost) || 0;
            const actualCost = parseFloat(item.actual_cost) || 0;
            const invoiceAmount = linkedInvoice ? (parseFloat(linkedInvoice.amount) || 0) : 0;
            const variance = expectedCost - (actualCost || invoiceAmount);
            const linkedPo = poList.find((po: any) => po.id === item.po_id);

            return (
              <Card
                key={item.id}
                className={`bg-white ${ic > 0 ? "border-red-200" : ""}`}
                data-testid={`trace-card-${item.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground" data-testid={`trace-title-${item.id}`}>{item.title}</span>
                      <Badge variant="outline" className={`text-[9px] ${CATEGORY_COLORS[item.category] || ""}`}>
                        {item.category}
                      </Badge>
                      <Badge variant="outline" className={`text-[9px] ${STATUS_COLORS[item.status] || ""}`}>
                        {item.status?.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">{sc}/5 steps</span>
                      {ic > 0 && (
                        <Badge variant="outline" className="text-[9px] bg-red-50 text-red-600 border-red-200">
                          {ic} issue{ic > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-stretch gap-0 overflow-x-auto" data-testid={`trace-flow-${item.id}`}>
                    <div className={`flex-1 min-w-[120px] border rounded-l-lg p-2.5 ${stepBg(steps.need.status)}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        {stepIcon(steps.need.status)}
                        <span className="text-[10px] font-semibold uppercase text-slate-600">Need</span>
                      </div>
                      <p className="text-xs font-medium truncate">{item.title}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{formatRand(expectedCost)}</p>
                    </div>

                    <div className="flex items-center text-slate-300 px-0.5">→</div>

                    <div className={`flex-1 min-w-[120px] border p-2.5 ${stepBg(steps.po.status)}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        {stepIcon(steps.po.status)}
                        <span className="text-[10px] font-semibold uppercase text-slate-600">PO</span>
                      </div>
                      {linkedPo ? (
                        <>
                          <p className="text-xs font-medium font-mono truncate">{linkedPo.po_ref}</p>
                          <p className="text-[10px] text-muted-foreground">{linkedPo.supplier_name}</p>
                        </>
                      ) : item.po_id ? (
                        <p className="text-xs text-muted-foreground font-mono">PO #{item.po_id}</p>
                      ) : (
                        <p className="text-[10px] text-muted-foreground italic">No PO linked</p>
                      )}
                    </div>

                    <div className="flex items-center text-slate-300 px-0.5">→</div>

                    <div className={`flex-1 min-w-[120px] border p-2.5 ${stepBg(steps.delivery.status)}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        {stepIcon(steps.delivery.status)}
                        <span className="text-[10px] font-semibold uppercase text-slate-600">Delivery</span>
                      </div>
                      <p className="text-xs font-medium">
                        {steps.delivery.status === "complete" ? "Received" : steps.delivery.status === "in-progress" ? (item.status === "partially_received" ? "Partial" : "Ordered") : "Pending"}
                      </p>
                      {item.required_date && (
                        <p className="text-[10px] text-muted-foreground">Due: {formatDate(item.required_date)}</p>
                      )}
                    </div>

                    <div className="flex items-center text-slate-300 px-0.5">→</div>

                    <div className={`flex-1 min-w-[120px] border p-2.5 ${stepBg(steps.invoice.status)}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        {stepIcon(steps.invoice.status)}
                        <span className="text-[10px] font-semibold uppercase text-slate-600">Invoice</span>
                      </div>
                      {linkedInvoice ? (
                        <>
                          <p className="text-xs font-medium font-mono truncate">{linkedInvoice.invoice_number || "Captured"}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{formatRand(invoiceAmount)}</p>
                        </>
                      ) : (
                        <p className="text-[10px] text-muted-foreground italic">
                          {steps.invoice.status === "issue" ? "Missing invoice" : "Not yet"}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center text-slate-300 px-0.5">→</div>

                    <div className={`flex-1 min-w-[120px] border rounded-r-lg p-2.5 ${stepBg(steps.financial.status)}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        {stepIcon(steps.financial.status)}
                        <span className="text-[10px] font-semibold uppercase text-slate-600">Cost Impact</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">Exp:</span>
                        <span className="text-xs font-mono">{formatRand(expectedCost)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">Act:</span>
                        <span className="text-xs font-mono">{formatRand(actualCost || invoiceAmount)}</span>
                      </div>
                      {(actualCost > 0 || invoiceAmount > 0) && (
                        <p className={`text-[10px] font-bold font-mono ${variance >= 0 ? "text-[#16A34A]" : "text-red-600"}`}>
                          {variance >= 0 ? "▼" : "▲"} {formatRand(Math.abs(variance))}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PurchaseOrdersSubTab({ projectName, projectId }: { projectName: string; projectId: number }) {
  const { data: poList = [], isLoading } = useQuery<any[]>({
    queryKey: ["po-list", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/po/${encodeURIComponent(projectName)}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load POs");
      return res.json();
    },
    enabled: !!projectName,
  });

  function downloadPdf(poId: number, poRef: string) {
    const token = localStorage.getItem("auth_token");
    fetch(`/api/po/${encodeURIComponent(projectName)}/${poId}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${poRef}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {});
  }

  const totalValue = poList.reduce((s: number, po: any) => s + (parseFloat(po.total) || 0), 0);

  return (
    <div className="space-y-4" data-testid="procurement-purchase-orders-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingCart className="w-4 h-4 text-[#16A34A]" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Total POs</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="po-total-count">{poList.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-[#16A34A]" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Total Value</span>
            </div>
            <p className="text-xl font-bold text-foreground font-mono" data-testid="po-total-value">{formatRand(totalValue)}</p>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-gray-500" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Drafts</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="po-draft-count">{poList.filter((p: any) => p.status === "draft").length}</p>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Approved</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="po-approved-count">{poList.filter((p: any) => p.status === "approved").length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{poList.length} purchase order{poList.length !== 1 ? "s" : ""}</span>
        <POGenerator projectName={projectName} />
      </div>

      <Card className="bg-white">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">PO Reference</TableHead>
                  <TableHead className="text-xs">Supplier</TableHead>
                  <TableHead className="text-xs text-right">Value</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Issue Date</TableHead>
                  <TableHead className="text-xs">Expected Delivery</TableHead>
                  <TableHead className="text-xs w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground" data-testid="empty-purchase-orders">
                      No purchase orders found. Click "Purchase Orders" to generate one.
                    </TableCell>
                  </TableRow>
                ) : (
                  poList.map((po: any) => (
                    <TableRow key={po.id} data-testid={`row-po-${po.id}`}>
                      <TableCell className="text-sm font-medium font-mono" data-testid={`text-po-ref-${po.id}`}>{po.po_ref}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-po-supplier-${po.id}`}>{po.supplier_name || "—"}</TableCell>
                      <TableCell className="text-sm font-mono text-right" data-testid={`text-po-value-${po.id}`}>
                        {formatRand(parseFloat(po.total))}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${PO_STATUS_COLORS[po.status] || PO_STATUS_COLORS.draft}`} data-testid={`badge-po-status-${po.id}`}>
                          {po.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-po-date-${po.id}`}>
                        {formatDate(po.created_at)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-po-delivery-${po.id}`}>
                        {formatDate(po.delivery_date)}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] gap-1"
                          onClick={() => downloadPdf(po.id, po.po_ref)}
                          data-testid={`btn-download-po-pdf-${po.id}`}
                        >
                          <Download className="w-3 h-3" />
                          PDF
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}

function DeliveriesSubTab({ items, projectId, projectName }: { items: any[]; projectId: number; projectName: string }) {
  const queryClient = useQueryClient();

  const patchMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/procurement/${id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["procurement", projectId] }),
  });

  const awaitingDelivery = items.filter((i: any) => i.status === "ordered");
  const partiallyReceived = items.filter((i: any) => i.status === "partially_received");
  const received = items.filter((i: any) => ["received", "invoiced", "closed"].includes(i.status));

  const totalOrdered = awaitingDelivery.length + partiallyReceived.length + received.length;

  function renderDeliveryGroup(title: string, groupItems: any[], badgeColor: string) {
    if (groupItems.length === 0) return null;
    return (
      <Card className="bg-white">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            {title}
            <Badge variant="outline" className={`text-[10px] ${badgeColor}`}>{groupItems.length}</Badge>
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Title</TableHead>
                <TableHead className="text-xs">Supplier</TableHead>
                <TableHead className="text-xs">PO Ref</TableHead>
                <TableHead className="text-xs">Required Date</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Expected Cost</TableHead>
                <TableHead className="text-xs text-right">Actual Cost</TableHead>
                <TableHead className="text-xs w-40">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupItems.map((item: any) => (
                <TableRow key={item.id} data-testid={`row-delivery-${item.id}`}>
                  <TableCell className="text-sm font-medium" data-testid={`text-delivery-title-${item.id}`}>{item.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground" data-testid={`text-delivery-supplier-${item.id}`}>{item.supplier_name || "—"}</TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground" data-testid={`text-delivery-po-${item.id}`}>{item.po_id || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground" data-testid={`text-delivery-date-${item.id}`}>{formatDate(item.required_date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[item.status] || ""}`} data-testid={`badge-delivery-status-${item.id}`}>
                      {item.status?.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-mono text-right" data-testid={`text-delivery-expected-${item.id}`}>{formatRand(parseFloat(item.expected_cost))}</TableCell>
                  <TableCell className="text-sm font-mono text-right" data-testid={`text-delivery-actual-${item.id}`}>{formatRand(parseFloat(item.actual_cost))}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {item.status === "ordered" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] gap-1"
                            disabled={patchMutation.isPending}
                            onClick={() => patchMutation.mutate({ id: item.id, status: "partially_received" })}
                            data-testid={`btn-partial-receive-${item.id}`}
                          >
                            Partial
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-[10px] gap-1 bg-[#16A34A] hover:bg-[#15803d] text-white"
                            disabled={patchMutation.isPending}
                            onClick={() => patchMutation.mutate({ id: item.id, status: "received" })}
                            data-testid={`btn-mark-received-${item.id}`}
                          >
                            <CheckCircle className="w-3 h-3" />
                            Received
                          </Button>
                        </>
                      )}
                      {item.status === "partially_received" && (
                        <Button
                          size="sm"
                          className="h-7 text-[10px] gap-1 bg-[#16A34A] hover:bg-[#15803d] text-white"
                          disabled={patchMutation.isPending}
                          onClick={() => patchMutation.mutate({ id: item.id, status: "received" })}
                          data-testid={`btn-mark-received-${item.id}`}
                        >
                          <CheckCircle className="w-3 h-3" />
                          Mark Received
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="procurement-deliveries-tab">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground">Delivery Tracking</h3>
        <CaptureDeliverable projectId={projectId} projectName={projectName} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-[#16A34A]" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Total Ordered</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="delivery-total-ordered">{totalOrdered}</p>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Truck className="w-4 h-4 text-amber-500" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Pending Delivery</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="delivery-pending">{awaitingDelivery.length + partiallyReceived.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Received</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="delivery-received">{received.length}</p>
          </CardContent>
        </Card>
      </div>

      {renderDeliveryGroup("Awaiting Delivery", awaitingDelivery, "bg-sky-100 text-sky-700 border-sky-200")}
      {renderDeliveryGroup("Partially Received", partiallyReceived, "bg-amber-100 text-amber-700 border-amber-200")}
      {renderDeliveryGroup("Received", received, "bg-emerald-100 text-emerald-700 border-emerald-200")}

      {totalOrdered === 0 && (
        <Card className="bg-white">
          <CardContent className="p-8 text-center">
            <Truck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No items have been ordered yet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const INVOICE_STATUS_COLORS: Record<string, string> = {
  captured: "bg-gray-100 text-gray-700 border-gray-200",
  submitted: "bg-blue-100 text-blue-700 border-blue-200",
  verified: "bg-sky-100 text-sky-700 border-sky-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
};

function InvoicesSubTab({
  projectId,
  projectName,
  items,
  supplierOptions,
}: {
  projectId: number;
  projectName: string;
  items: any[];
  supplierOptions: { value: string; label: string }[];
}) {
  const queryClient = useQueryClient();
  const [captureOpen, setCaptureOpen] = useState(false);

  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ["invoice-captures", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/invoice-captures/project/${projectId}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load invoices");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: poList = [] } = useQuery<any[]>({
    queryKey: ["po-list", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/po/${encodeURIComponent(projectName)}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const totalInvoiced = invoices.reduce((s: number, inv: any) => s + (parseFloat(inv.amount) || 0), 0);
  const invoiceStatusCounts: Record<string, number> = {};
  invoices.forEach((inv: any) => {
    invoiceStatusCounts[inv.status] = (invoiceStatusCounts[inv.status] || 0) + 1;
  });

  const poOptions = poList.map((po: any) => ({
    value: String(po.id),
    label: `${po.po_ref} — ${po.supplier_name}`,
  }));

  const itemOptions = items.map((i: any) => ({
    value: String(i.id),
    label: `${i.title}${i.supplier_name ? ` (${i.supplier_name})` : ""}`,
  }));

  return (
    <div className="space-y-4" data-testid="procurement-invoices-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="w-4 h-4 text-[#16A34A]" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Total Invoices</span>
            </div>
            <p className="text-xl font-bold text-foreground" data-testid="invoice-total-count">{invoices.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-[#16A34A]" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Total Invoiced</span>
            </div>
            <p className="text-xl font-bold text-foreground font-mono" data-testid="invoice-total-amount">{formatRand(totalInvoiced)}</p>
          </CardContent>
        </Card>
        {Object.entries(invoiceStatusCounts).map(([status, count]) => (
          <Card className="bg-white" key={status}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className={`text-[9px] ${INVOICE_STATUS_COLORS[status] || ""}`}>{status}</Badge>
              </div>
              <p className="text-xl font-bold text-foreground" data-testid={`invoice-count-${status}`}>{count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{invoices.length} invoice{invoices.length !== 1 ? "s" : ""}</span>
        <Button
          size="sm"
          className="h-8 text-xs gap-1 bg-[#16A34A] hover:bg-[#15803d] text-white"
          onClick={() => setCaptureOpen(true)}
          data-testid="btn-capture-invoice"
        >
          <Plus className="w-3 h-3" />
          Capture Invoice
        </Button>
      </div>

      <Card className="bg-white">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Invoice Number</TableHead>
                  <TableHead className="text-xs">Supplier</TableHead>
                  <TableHead className="text-xs text-right">Amount</TableHead>
                  <TableHead className="text-xs text-right">VAT</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Linked PO</TableHead>
                  <TableHead className="text-xs">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground" data-testid="empty-invoices">
                      No invoices captured yet. Click "Capture Invoice" to add one.
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map((inv: any) => {
                    const linkedPo = poList.find((po: any) => po.id === inv.linked_po_id);
                    return (
                      <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                        <TableCell className="text-sm font-mono" data-testid={`text-invoice-number-${inv.id}`}>{inv.invoice_number || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground" data-testid={`text-invoice-supplier-${inv.id}`}>{inv.supplier_name || "—"}</TableCell>
                        <TableCell className="text-sm font-mono text-right" data-testid={`text-invoice-amount-${inv.id}`}>{formatRand(parseFloat(inv.amount))}</TableCell>
                        <TableCell className="text-sm font-mono text-right" data-testid={`text-invoice-vat-${inv.id}`}>{formatRand(parseFloat(inv.vat_amount))}</TableCell>
                        <TableCell className="text-sm text-muted-foreground" data-testid={`text-invoice-date-${inv.id}`}>{formatDate(inv.invoice_date)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${INVOICE_STATUS_COLORS[inv.status] || ""}`} data-testid={`badge-invoice-status-${inv.id}`}>
                            {inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-mono text-muted-foreground" data-testid={`text-invoice-po-${inv.id}`}>
                          {linkedPo?.po_ref || (inv.linked_po_id ? `PO #${inv.linked_po_id}` : "—")}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate" data-testid={`text-invoice-notes-${inv.id}`}>{inv.notes || "—"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      <CaptureInvoiceDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        projectId={projectId}
        supplierOptions={supplierOptions}
        poOptions={poOptions}
        itemOptions={itemOptions}
      />
    </div>
  );
}

function CaptureInvoiceDialog({
  open,
  onOpenChange,
  projectId,
  supplierOptions,
  poOptions,
  itemOptions,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
  supplierOptions: { value: string; label: string }[];
  poOptions: { value: string; label: string }[];
  itemOptions: { value: string; label: string }[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    invoiceNumber: "",
    invoiceDate: "",
    amount: "",
    vatAmount: "",
    supplierId: "",
    linkedPoId: "",
    linkedProcurementItemId: "",
    notes: "",
    budgetLine: "",
    linkedDeliverableId: "",
    linkedMilestone: "",
  });
  const [file, setFile] = useState<File | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("projectId", String(projectId));
      if (form.invoiceNumber) formData.append("invoiceNumber", form.invoiceNumber);
      if (form.invoiceDate) formData.append("invoiceDate", form.invoiceDate);
      if (form.amount) formData.append("amount", form.amount);
      if (form.vatAmount) formData.append("vatAmount", form.vatAmount);
      if (form.supplierId) formData.append("supplierId", form.supplierId);
      if (form.linkedPoId) formData.append("linkedPoId", form.linkedPoId);
      if (form.linkedProcurementItemId) formData.append("linkedProcurementItemId", form.linkedProcurementItemId);
      if (form.notes) formData.append("notes", form.notes);
      if (file) formData.append("document", file);

      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch("/api/invoice-captures", {
        method: "POST",
        headers,
        credentials: "include",
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to capture invoice");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-captures", projectId] });
      onOpenChange(false);
      setForm({ invoiceNumber: "", invoiceDate: "", amount: "", vatAmount: "", supplierId: "", linkedPoId: "", linkedProcurementItemId: "", notes: "" });
      setFile(null);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-white" data-testid="dialog-capture-invoice">
        <DialogHeader>
          <DialogTitle>Capture Invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Invoice Number</Label>
              <Input
                className="h-8 text-sm"
                value={form.invoiceNumber}
                onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
                placeholder="INV-001"
                data-testid="input-invoice-number"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Invoice Date</Label>
              <Input
                type="date"
                className="h-8 text-sm"
                value={form.invoiceDate}
                onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
                data-testid="input-invoice-date"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Amount (R)</Label>
              <Input
                type="number"
                className="h-8 text-sm"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0"
                data-testid="input-invoice-amount"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">VAT Amount (R)</Label>
              <Input
                type="number"
                className="h-8 text-sm"
                value={form.vatAmount}
                onChange={(e) => setForm({ ...form, vatAmount: e.target.value })}
                placeholder="0"
                data-testid="input-invoice-vat"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Supplier</Label>
            <SearchableSelect
              options={supplierOptions}
              value={form.supplierId}
              onValueChange={(v) => setForm({ ...form, supplierId: v })}
              placeholder="Select supplier"
              searchPlaceholder="Search suppliers..."
              triggerClassName="h-8 text-xs w-full"
              data-testid="select-invoice-supplier"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Linked PO</Label>
              <SearchableSelect
                options={[{ value: "", label: "None" }, ...poOptions]}
                value={form.linkedPoId}
                onValueChange={(v) => setForm({ ...form, linkedPoId: v })}
                placeholder="Select PO"
                searchPlaceholder="Search POs..."
                triggerClassName="h-8 text-xs w-full"
                data-testid="select-invoice-po"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Linked Item</Label>
              <SearchableSelect
                options={[{ value: "", label: "None" }, ...itemOptions]}
                value={form.linkedProcurementItemId}
                onValueChange={(v) => setForm({ ...form, linkedProcurementItemId: v })}
                placeholder="Select item"
                searchPlaceholder="Search items..."
                triggerClassName="h-8 text-xs w-full"
                data-testid="select-invoice-item"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Document</Label>
            <Input
              type="file"
              className="h-8 text-sm"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              data-testid="input-invoice-document"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              className="text-sm min-h-[50px]"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Additional notes"
              data-testid="input-invoice-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid="btn-cancel-invoice">
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-[#16A34A] hover:bg-[#15803d] text-white"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
            data-testid="btn-submit-invoice"
          >
            {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Capture
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
