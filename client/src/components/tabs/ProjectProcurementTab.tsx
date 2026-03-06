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

export function ProjectProcurementTab({ projectId, projectName }: ProjectProcurementTabProps) {
  const queryClient = useQueryClient();
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

  return (
    <div className="space-y-4" data-testid="project-procurement-tab">
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
          <Label className="text-[10px] uppercase text-muted-foreground">Invoice Ref</Label>
          <Input
            className="h-8 w-40 text-xs"
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="Invoice reference"
            data-testid={`input-invoice-ref-${item.id}`}
          />
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
      setForm({ title: "", description: "", category: "", supplierId: "", quantity: "", unit: "", expectedCost: "", requiredDate: "", ownerUserId: "", notes: "" });
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
