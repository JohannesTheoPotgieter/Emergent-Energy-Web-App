import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PermissionGate } from "@/components/PermissionGate";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign, Users, Clock, TrendingUp, Search, Filter,
  Loader2, ArrowUpDown, ChevronRight, AlertCircle, Calendar,
  CheckCircle2, CircleDot, ExternalLink, FileText, Pencil, Check, X, Trash2, Merge, Tag, Link2, ArrowLeft,
  Building2, Phone, Mail, MapPin, CreditCard, ChevronDown, ChevronUp, Save,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
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

type SortField = "totalSpendExVat" | "invoiceCount" | "projectCount" | "lastInvoiceDate" | "avgTurnaroundDays" | "openAmount" | "overdueAmount" | "upcomingAmount30d" | "counterpartyName";

function SupplierDetailsPanel({ counterpartyName }: { counterpartyName: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    vatNumber: "", registrationNumber: "", address: "", contactPerson: "",
    contactPhone: "", contactEmail: "", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", paymentTerms: "", notes: "",
  });

  const { data: supplierData, isLoading } = useQuery({
    queryKey: ["supplier-details", counterpartyName],
    queryFn: async () => {
      const res = await fetch(`/api/subcontractor-dashboard/supplier-details/${encodeURIComponent(counterpartyName)}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!counterpartyName,
  });

  useEffect(() => {
    if (supplierData && supplierData.exists) {
      setForm({
        vatNumber: supplierData.vat_number || "",
        registrationNumber: supplierData.registration_number || "",
        address: supplierData.address || "",
        contactPerson: supplierData.contact_person || "",
        contactPhone: supplierData.contact_phone || "",
        contactEmail: supplierData.contact_email || "",
        bankName: supplierData.bank_name || "",
        bankAccountNumber: supplierData.bank_account_number || "",
        bankBranchCode: supplierData.bank_branch_code || "",
        paymentTerms: supplierData.payment_terms || "",
        notes: supplierData.notes || "",
      });
    }
  }, [supplierData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/subcontractor-dashboard/supplier-details/${encodeURIComponent(counterpartyName)}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Supplier details saved" });
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["supplier-details", counterpartyName] });
    },
    onError: () => toast({ title: "Failed to save supplier details", variant: "destructive" }),
  });

  const updateField = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const hasData = supplierData?.exists && (
    supplierData.vat_number || supplierData.address || supplierData.contact_person ||
    supplierData.contact_phone || supplierData.contact_email
  );

  return (
    <Card data-testid="supplier-details-panel">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-blue-600" />
          <h4 className="text-sm font-semibold">Supplier Details</h4>
          {!hasData && !editing && (
            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">Not set</Badge>
          )}
          {hasData && !editing && (
            <Badge variant="secondary" className="text-[10px] text-green-600">Captured</Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {expanded && !editing && (
            <PermissionGate entity="procurement" action="edit">
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                data-testid="btn-edit-supplier-details"
              >
                <Pencil className="h-3 w-3 mr-1" /> Edit
              </Button>
            </PermissionGate>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>
      {expanded && (
        <CardContent className="pt-0 pb-4 px-4">
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : editing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">VAT Number</Label>
                  <Input value={form.vatNumber} onChange={e => updateField("vatNumber", e.target.value)}
                    placeholder="e.g. 4210308138" className="h-8 text-xs" data-testid="input-supplier-vat" />
                </div>
                <div>
                  <Label className="text-xs">Registration Number</Label>
                  <Input value={form.registrationNumber} onChange={e => updateField("registrationNumber", e.target.value)}
                    placeholder="Company registration" className="h-8 text-xs" data-testid="input-supplier-reg" />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <Label className="text-xs">Address</Label>
                  <Input value={form.address} onChange={e => updateField("address", e.target.value)}
                    placeholder="Full physical address" className="h-8 text-xs" data-testid="input-supplier-address" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Contact Person</Label>
                  <Input value={form.contactPerson} onChange={e => updateField("contactPerson", e.target.value)}
                    placeholder="Primary contact name" className="h-8 text-xs" data-testid="input-supplier-contact-person" />
                </div>
                <div>
                  <Label className="text-xs">Phone</Label>
                  <Input value={form.contactPhone} onChange={e => updateField("contactPhone", e.target.value)}
                    placeholder="+27..." className="h-8 text-xs" data-testid="input-supplier-phone" />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input value={form.contactEmail} onChange={e => updateField("contactEmail", e.target.value)}
                    placeholder="accounts@supplier.co.za" className="h-8 text-xs" data-testid="input-supplier-email" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Bank Name</Label>
                  <Input value={form.bankName} onChange={e => updateField("bankName", e.target.value)}
                    placeholder="e.g. FNB" className="h-8 text-xs" data-testid="input-supplier-bank" />
                </div>
                <div>
                  <Label className="text-xs">Account Number</Label>
                  <Input value={form.bankAccountNumber} onChange={e => updateField("bankAccountNumber", e.target.value)}
                    placeholder="Account number" className="h-8 text-xs" data-testid="input-supplier-account" />
                </div>
                <div>
                  <Label className="text-xs">Branch Code</Label>
                  <Input value={form.bankBranchCode} onChange={e => updateField("bankBranchCode", e.target.value)}
                    placeholder="Branch code" className="h-8 text-xs" data-testid="input-supplier-branch" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Payment Terms</Label>
                  <Input value={form.paymentTerms} onChange={e => updateField("paymentTerms", e.target.value)}
                    placeholder="e.g. 30 days net" className="h-8 text-xs" data-testid="input-supplier-payment-terms" />
                </div>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <Input value={form.notes} onChange={e => updateField("notes", e.target.value)}
                    placeholder="Additional notes" className="h-8 text-xs" data-testid="input-supplier-notes" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="h-7 text-xs" data-testid="btn-cancel-supplier-edit">
                  Cancel
                </Button>
                <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="h-7 text-xs" data-testid="btn-save-supplier-details">
                  {saveMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                  Save Details
                </Button>
              </div>
            </div>
          ) : hasData ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-xs">
              {supplierData.vat_number && (
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground w-24 shrink-0">VAT#:</span><span className="font-medium">{supplierData.vat_number}</span></div>
              )}
              {supplierData.registration_number && (
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground w-24 shrink-0">Reg#:</span><span className="font-medium">{supplierData.registration_number}</span></div>
              )}
              {supplierData.address && (
                <div className="flex items-start gap-1.5"><MapPin className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" /><span className="font-medium">{supplierData.address}</span></div>
              )}
              {supplierData.contact_person && (
                <div className="flex items-center gap-1.5"><Users className="h-3 w-3 text-muted-foreground shrink-0" /><span className="font-medium">{supplierData.contact_person}</span></div>
              )}
              {supplierData.contact_phone && (
                <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-muted-foreground shrink-0" /><span className="font-medium">{supplierData.contact_phone}</span></div>
              )}
              {supplierData.contact_email && (
                <div className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-muted-foreground shrink-0" /><span className="font-medium">{supplierData.contact_email}</span></div>
              )}
              {supplierData.bank_name && (
                <div className="flex items-center gap-1.5"><CreditCard className="h-3 w-3 text-muted-foreground shrink-0" /><span className="font-medium">{supplierData.bank_name} {supplierData.bank_account_number ? `(${supplierData.bank_account_number})` : ""}</span></div>
              )}
              {supplierData.payment_terms && (
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground w-24 shrink-0">Terms:</span><span className="font-medium">{supplierData.payment_terms}</span></div>
              )}
              {supplierData.notes && (
                <div className="sm:col-span-2 lg:col-span-3 flex items-start gap-1.5"><span className="text-muted-foreground w-24 shrink-0">Notes:</span><span className="font-medium">{supplierData.notes}</span></div>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-xs text-muted-foreground mb-2">No supplier details captured yet</p>
              <PermissionGate entity="procurement" action="edit">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid="btn-add-supplier-details">
                  <Building2 className="h-3 w-3 mr-1" /> Add Supplier Details
                </Button>
              </PermissionGate>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function SubcontractorDashboardPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
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
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState("");
  const [showMergePanel, setShowMergePanel] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [typeChangeLoading, setTypeChangeLoading] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [linkingLineIds, setLinkingLineIds] = useState<number[]>([]);
  const [linkTarget, setLinkTarget] = useState<string>("");
  const [linkCreatePattern, setLinkCreatePattern] = useState(true);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [linkIsNew, setLinkIsNew] = useState(false);
  const [linkNewName, setLinkNewName] = useState("");
  const [linkNewType, setLinkNewType] = useState("OTHER");
  const [showOverdue, setShowOverdue] = useState(false);
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
        credentials: "include",
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

  const handleDeleteCounterparty = async () => {
    if (!selectedCp) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/subcontractor-dashboard/counterparty/${encodeURIComponent(selectedCp)}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) { setRenameError(data.error || "Delete failed"); return; }
      setSelectedCp(null);
      setDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/summary"] });
    } catch (err: any) {
      setRenameError(err.message || "Delete failed");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleChangeType = async (newType: string) => {
    if (!selectedCp || !newType) return;
    setTypeChangeLoading(true);
    try {
      const res = await fetch(`/api/subcontractor-dashboard/counterparty/${encodeURIComponent(selectedCp)}/type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ type: newType }),
      });
      if (!res.ok) { const d = await res.json(); setRenameError(d.error || "Type change failed"); return; }
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/detail"] });
    } catch (err: any) {
      setRenameError(err.message || "Type change failed");
    } finally {
      setTypeChangeLoading(false);
    }
  };

  const toggleMergeSelection = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedForMerge(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const handleMerge = async () => {
    if (selectedForMerge.size < 2 || !mergeTarget.trim()) return;
    setMergeLoading(true);
    try {
      const res = await fetch("/api/subcontractor-dashboard/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ sourceNames: Array.from(selectedForMerge), targetName: mergeTarget.trim() }),
      });
      if (!res.ok) { const d = await res.json(); setRenameError(d.error || "Merge failed"); return; }
      setSelectedForMerge(new Set());
      setShowMergePanel(false);
      setMergeTarget("");
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/summary"] });
    } catch (err: any) {
      setRenameError(err.message || "Merge failed");
    } finally {
      setMergeLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedForMerge.size === 0) return;
    setBulkDeleteLoading(true);
    try {
      for (const name of Array.from(selectedForMerge)) {
        const res = await fetch(`/api/subcontractor-dashboard/counterparty/${encodeURIComponent(name)}`, {
          method: "DELETE",
          headers: getAuthHeaders(),
          credentials: "include",
        });
        if (!res.ok) { const d = await res.json(); setRenameError(d.error || `Failed to delete ${name}`); }
      }
      setSelectedForMerge(new Set());
      setBulkDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/summary"] });
    } catch (err: any) {
      setRenameError(err.message || "Bulk delete failed");
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const handleLinkCounterparty = async () => {
    const targetName = linkIsNew ? linkNewName.trim() : linkTarget;
    const targetType = linkIsNew ? linkNewType : null;
    if (linkingLineIds.length === 0 || !targetName) return;
    setLinkLoading(true);
    setLinkError("");
    try {
      const allCps = data?.counterparties || [];
      const targetCp = linkIsNew ? null : allCps.find((c: any) => c.counterpartyName === linkTarget);
      const res = await fetch("/api/subcontractor-dashboard/link-counterparty", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({
          costLineIds: linkingLineIds,
          counterpartyId: targetCp?.counterpartyId || null,
          counterpartyName: targetName,
          counterpartyType: targetType || targetCp?.counterpartyType || null,
          createPattern: linkCreatePattern,
        }),
      });
      if (!res.ok) { const d = await res.json(); setLinkError(d.error || "Link failed"); return; }
      setLinkingLineIds([]);
      setLinkTarget("");
      setLinkNewName("");
      setLinkIsNew(false);
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/detail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-patterns"] });
    } catch (err: any) {
      setLinkError(err.message || "Link failed");
    } finally {
      setLinkLoading(false);
    }
  };

  const { data: patternStats } = useQuery({
    queryKey: ["/api/procurement-analysis/pattern-stats"],
    queryFn: async () => {
      const res = await fetch("/api/procurement-analysis/pattern-stats", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["/api/subcontractor-dashboard/summary", typeFilter, projectFilter, coreOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (projectFilter !== "all") params.set("project", projectFilter);
      if (coreOnly) params.set("coreOnly", "true");
      const res = await fetch(`/api/subcontractor-dashboard/summary?${params}`, { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: overdueData, isLoading: overdueLoading } = useQuery({
    queryKey: ["/api/subcontractor-dashboard/overdue"],
    queryFn: async () => {
      const res = await fetch("/api/subcontractor-dashboard/overdue", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: showOverdue,
    staleTime: 0,
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["/api/subcontractor-dashboard/detail", selectedCp],
    queryFn: async () => {
      if (!selectedCp) return null;
      const res = await fetch(`/api/subcontractor-dashboard/detail/${encodeURIComponent(selectedCp)}`, { headers: getAuthHeaders(), credentials: "include" });
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
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Subcontractor Dashboard</h2>
          <p className="text-muted-foreground text-sm">
            Aggregated view of installer and supplier accounts with spend, usage, and upcoming payments.
          </p>
        </div>
      </div>

      {patternStats && (patternStats.taggedLines > 0 || patternStats.eligibleLines > 0) && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="pattern-stats-strip">
          <Card className="bg-card">
            <CardContent className="pt-3 pb-2 px-3">
              <div className="text-[10px] text-muted-foreground mb-0.5">Eligible Lines</div>
              <div className="text-lg font-bold" data-testid="stat-eligible">{patternStats.eligibleLines.toLocaleString()}</div>
              <div className="text-[9px] text-slate-500">with invoice & amount</div>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardContent className="pt-3 pb-2 px-3">
              <div className="text-[10px] text-muted-foreground mb-0.5">Tagged</div>
              <div className="text-lg font-bold text-green-700" data-testid="stat-tagged">{patternStats.taggedLines.toLocaleString()}</div>
              <div className="text-[9px] text-slate-500">pattern-matched</div>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardContent className="pt-3 pb-2 px-3">
              <div className="text-[10px] text-muted-foreground mb-0.5">Untagged</div>
              <div className="text-lg font-bold text-amber-600" data-testid="stat-untagged">{patternStats.untaggedLines.toLocaleString()}</div>
              <div className="text-[9px] text-slate-500">awaiting classification</div>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardContent className="pt-3 pb-2 px-3">
              <div className="text-[10px] text-muted-foreground mb-0.5">Classification Rate</div>
              <div className="text-lg font-bold" data-testid="stat-rate">{patternStats.classificationRate}%</div>
              <div className="text-[9px] text-slate-500">tagged / eligible</div>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardContent className="pt-3 pb-2 px-3">
              <div className="text-[10px] text-muted-foreground mb-0.5">Type Breakdown</div>
              <div className="flex flex-wrap gap-1 mt-1" data-testid="stat-types">
                {Object.entries(patternStats.typeCounts || {}).map(([type, count]) => (
                  <Badge key={type} variant={type === "INSTALLER" ? "default" : type === "SUPPLIER" ? "secondary" : "outline"}
                    className="text-[9px]">
                    {type}: {count as number}
                  </Badge>
                ))}
                {Object.keys(patternStats.typeCounts || {}).length === 0 && (
                  <span className="text-[9px] text-slate-500">No classified lines yet</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card data-testid="kpi-biggest">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <p className="text-xs text-muted-foreground">Biggest Account</p>
            </div>
            <p className="text-lg font-bold truncate">{kpis.biggestAccount || "—"}</p>
            <p className="text-xs text-slate-500">{formatCurrency(kpis.biggestAccountSpend)}</p>
          </CardContent>
        </Card>
        <Card data-testid="kpi-total">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-green-600" />
              <p className="text-xs text-muted-foreground">Total Subcontractors</p>
            </div>
            <p className="text-lg font-bold">{kpis.totalCounterparties || 0}</p>
          </CardContent>
        </Card>
        <Card data-testid="kpi-open">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-amber-600" />
              <p className="text-xs text-muted-foreground">Total Open Amount</p>
            </div>
            <p className="text-lg font-bold">{formatCurrency(kpis.totalOpenAmount)}</p>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${showOverdue ? "border-red-300 bg-red-50/50" : "hover:border-red-200"}`}
          onClick={() => setShowOverdue(!showOverdue)} data-testid="kpi-overdue">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-xs text-muted-foreground">Overdue</p>
            </div>
            <p className="text-lg font-bold text-red-600">{formatCurrency(kpis.totalOverdueAmount)}</p>
            <p className="text-xs text-slate-500">{kpis.totalOverdueCount || 0} items — click to view</p>
          </CardContent>
        </Card>
        <Card data-testid="kpi-upcoming">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-purple-600" />
              <p className="text-xs text-muted-foreground">Upcoming 30d</p>
            </div>
            <p className="text-lg font-bold">{formatCurrency(kpis.totalUpcoming30d)}</p>
          </CardContent>
        </Card>
      </div>

      {counterpartiesList.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="dashboard-charts">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">Top 10 by Spend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={counterpartiesList
                      .filter((c: any) => c.counterpartyName?.toLowerCase() !== "unknown")
                      .sort((a: any, b: any) => b.totalSpendExVat - a.totalSpendExVat)
                      .slice(0, 10)
                      .map((c: any) => ({ name: c.counterpartyName.length > 18 ? c.counterpartyName.slice(0, 16) + "…" : c.counterpartyName, spend: c.totalSpendExVat }))}
                    layout="vertical"
                    margin={{ left: 0, right: 12 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v: number) => `R${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 9 }} />
                    <Tooltip formatter={(v: number) => [formatCurrency(v), "Spend"]} />
                    <Bar dataKey="spend" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">Spend by Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={(() => {
                        const typeMap: Record<string, number> = {};
                        counterpartiesList.forEach((c: any) => {
                          const t = c.counterpartyType || "OTHER";
                          typeMap[t] = (typeMap[t] || 0) + c.totalSpendExVat;
                        });
                        return Object.entries(typeMap).map(([name, value]) => ({ name, value }));
                      })()}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {(() => {
                        const colors: Record<string, string> = { INSTALLER: "#22c55e", SUPPLIER: "#3b82f6", OTHER: "#94a3b8" };
                        const typeMap: Record<string, number> = {};
                        counterpartiesList.forEach((c: any) => {
                          const t = c.counterpartyType || "OTHER";
                          typeMap[t] = (typeMap[t] || 0) + c.totalSpendExVat;
                        });
                        return Object.keys(typeMap).map((key) => (
                          <Cell key={key} fill={colors[key] || "#94a3b8"} />
                        ));
                      })()}
                    </Pie>
                    <Tooltip formatter={(v: number) => [formatCurrency(v), "Spend"]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">Counterparties by Project Count</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={counterpartiesList
                      .filter((c: any) => c.counterpartyName?.toLowerCase() !== "unknown" && c.projectCount > 1)
                      .sort((a: any, b: any) => b.projectCount - a.projectCount)
                      .slice(0, 10)
                      .map((c: any) => ({ name: c.counterpartyName.length > 18 ? c.counterpartyName.slice(0, 16) + "…" : c.counterpartyName, projects: c.projectCount, spend: c.totalSpendExVat }))}
                    layout="vertical"
                    margin={{ left: 0, right: 12 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 9 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 9 }} />
                    <Tooltip formatter={(v: number, name: string) => [name === "projects" ? v : formatCurrency(v), name === "projects" ? "Projects" : "Spend"]} />
                    <Bar dataKey="projects" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showOverdue && (
        <Card className="border-red-200 bg-red-50/30" data-testid="overdue-panel">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-red-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Overdue Items
                {overdueData && <Badge variant="destructive" className="text-[10px]">{overdueData.totalItems} items — {formatCurrency(overdueData.totalOverdue)}</Badge>}
              </CardTitle>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setShowOverdue(false)} data-testid="btn-close-overdue">
                <X className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {overdueLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-red-600" /></div>
            ) : overdueData?.items?.length > 0 ? (
              <div className="border border-red-200 rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
                <table className="w-full text-[11px]" data-testid="overdue-table">
                  <thead className="sticky top-0 bg-red-50">
                    <tr className="border-b border-red-200">
                      <th className="text-left px-3 py-1.5 font-medium text-red-700">Counterparty</th>
                      <th className="text-left px-3 py-1.5 font-medium text-red-700">Project</th>
                      <th className="text-left px-3 py-1.5 font-medium text-red-700">Category</th>
                      <th className="text-left px-3 py-1.5 font-medium text-red-700">Description</th>
                      <th className="text-left px-3 py-1.5 font-medium text-red-700">Invoice #</th>
                      <th className="text-right px-3 py-1.5 font-medium text-red-700">Amount</th>
                      <th className="text-left px-3 py-1.5 font-medium text-red-700">Invoice Date</th>
                      <th className="text-left px-3 py-1.5 font-medium text-red-700">Status</th>
                      <th className="text-right px-3 py-1.5 font-medium text-red-700">Days Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueData.items.map((item: any) => (
                      <tr key={item.id} className="border-b border-red-100 hover:bg-red-50/50 cursor-pointer"
                        onClick={() => { setSelectedCp(item.counterpartyName); setShowOverdue(false); }}
                        data-testid={`overdue-row-${item.id}`}>
                        <td className="px-3 py-1.5 font-medium text-foreground">{item.counterpartyName}</td>
                        <td className="px-3 py-1.5">
                          <button className="text-blue-700 hover:underline text-left" onClick={(e) => { e.stopPropagation(); navigate(`/project/${encodeURIComponent(item.projectName)}`); }}
                            data-testid={`overdue-nav-project-${item.id}`}>
                            {item.projectName}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{item.costCategory || "—"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground max-w-[180px] truncate" title={item.description || ""}>{item.description || "—"}</td>
                        <td className="px-3 py-1.5 font-mono">{item.invoiceNumber || "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-right text-red-700">{formatCurrency(parseFloat(item.amountExVat || "0"))}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{formatDate(item.invoiceDate)}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className="text-[9px] text-amber-700 border-amber-200 bg-amber-50">{item.status}</Badge>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <span className={`font-bold ${item.daysOverdue > 60 ? "text-red-700" : item.daysOverdue > 30 ? "text-orange-600" : "text-amber-600"}`}>
                            {item.daysOverdue}d
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No overdue items found.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
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
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={coreOnly} onChange={e => setCoreOnly(e.target.checked)}
            data-testid="checkbox-core-only" />
          Core only
        </label>
      </div>

      <PermissionGate entity="procurement" action="edit">
        {selectedForMerge.size > 0 && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5" data-testid="bulk-action-bar">
            <span className="text-sm text-blue-800 font-medium">{selectedForMerge.size} selected</span>
            <div className="flex items-center gap-2 ml-auto">
              {isAdmin && selectedForMerge.size >= 2 && (
                <Button size="sm" variant="outline" className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
                  onClick={() => { setMergeTarget(Array.from(selectedForMerge)[0]); setShowMergePanel(true); }}
                  data-testid="btn-open-merge">
                  <Merge className="w-3 h-3 mr-1" /> Merge
                </Button>
              )}
              {!bulkDeleteConfirm ? (
                <Button size="sm" variant="outline" className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => setBulkDeleteConfirm(true)} data-testid="btn-bulk-delete">
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-700">Delete {selectedForMerge.size} counterpart{selectedForMerge.size > 1 ? "ies" : "y"}?</span>
                  <Button size="sm" variant="destructive" className="h-7 text-xs"
                    onClick={handleBulkDelete} disabled={bulkDeleteLoading} data-testid="btn-confirm-bulk-delete">
                    {bulkDeleteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => setBulkDeleteConfirm(false)} data-testid="btn-cancel-bulk-delete">No</Button>
                </div>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                onClick={() => { setSelectedForMerge(new Set()); setBulkDeleteConfirm(false); }}
                data-testid="btn-clear-selection">
                Clear
              </Button>
            </div>
          </div>
        )}
      </PermissionGate>

      {isAdmin && showMergePanel && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 space-y-3" data-testid="merge-panel">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-indigo-900 flex items-center gap-1.5">
                <Merge className="w-4 h-4" /> Merge Counterparties
              </p>
              <p className="text-xs text-indigo-700 mt-1">
                Merging will combine all cost lines from the selected counterparties into one. The others will be removed.
              </p>
            </div>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowMergePanel(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(selectedForMerge).map(name => (
              <Badge key={name} variant="secondary" className="text-xs">{name}</Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-indigo-800 whitespace-nowrap">Merge into:</label>
            <Select value={mergeTarget} onValueChange={setMergeTarget}>
              <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-merge-target">
                <SelectValue placeholder="Choose target name" />
              </SelectTrigger>
              <SelectContent>
                {Array.from(selectedForMerge).map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700"
              onClick={handleMerge} disabled={mergeLoading || !mergeTarget}
              data-testid="btn-confirm-merge">
              {mergeLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Merge className="w-3 h-3 mr-1" />}
              Merge {selectedForMerge.size} into 1
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => setShowMergePanel(false)} data-testid="btn-cancel-merge">Cancel</Button>
          </div>
          {renameError && <p className="text-xs text-red-600">{renameError}</p>}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-600" />
            No counterparty data available. Import expenditure data via Smart Import first.
          </CardContent>
        </Card>
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm" data-testid="counterparty-table">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="px-2 py-2 w-8">
                  <input type="checkbox" className="rounded border-border"
                    checked={filtered.length > 0 && filtered.every((c: any) => selectedForMerge.has(c.counterpartyName))}
                    onChange={e => {
                      if (e.target.checked) setSelectedForMerge(new Set(filtered.map((c: any) => c.counterpartyName)));
                      else setSelectedForMerge(new Set());
                    }}
                    data-testid="checkbox-select-all" />
                </th>
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
                  { key: "overdueAmount", label: "Overdue" },
                  { key: "upcomingAmount30d", label: "Upcoming 30d" },
                ].map(col => (
                  <th key={col.key} className="text-left px-3 py-2 font-medium text-muted-foreground text-xs cursor-pointer hover:bg-muted"
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
                <tr key={cp.counterpartyName} className={`border-b border-border hover:bg-blue-50/30 cursor-pointer ${i % 2 === 0 ? "" : "bg-muted/50"} ${selectedForMerge.has(cp.counterpartyName) ? "bg-blue-50" : ""}`}
                  onClick={() => setSelectedCp(cp.counterpartyName)}
                  data-testid={`cp-row-${i}`}>
                  <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="rounded border-border"
                      checked={selectedForMerge.has(cp.counterpartyName)}
                      onChange={() => toggleMergeSelection(cp.counterpartyName, { stopPropagation: () => {} } as any)}
                      data-testid={`checkbox-cp-${i}`} />
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">
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
                  <td className="px-3 py-2 text-xs" title={cp.projectNames?.join(", ") || ""}>
                    <span className="font-medium">{cp.projectCount}</span>
                    {cp.projectNames?.length > 0 && cp.projectNames.length <= 3 && (
                      <span className="text-[10px] text-slate-500 ml-1 block truncate max-w-[120px]">{cp.projectNames.join(", ")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(cp.lastInvoiceDate)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(cp.lastPaidDate)}</td>
                  <td className="px-3 py-2 text-xs">{cp.avgTurnaroundDays != null ? `${cp.avgTurnaroundDays}d` : "\u2014"}</td>
                  <td className="px-3 py-2 text-xs font-mono text-amber-600">{cp.openAmount > 0 ? formatCurrency(cp.openAmount) : "\u2014"}</td>
                  <td className="px-3 py-2 text-xs font-mono text-red-600">{cp.overdueAmount > 0 ? formatCurrency(cp.overdueAmount) : "\u2014"}</td>
                  <td className="px-3 py-2 text-xs font-mono text-purple-600">{cp.upcomingAmount30d > 0 ? formatCurrency(cp.upcomingAmount30d) : "\u2014"}</td>
                  <td className="px-3 py-2"><ChevronRight className="w-4 h-4 text-slate-600" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!selectedCp} onOpenChange={(open) => { if (!open) { setSelectedCp(null); setInvoiceStatusFilter("all"); setIsRenaming(false); setDeleteConfirm(false); setLinkingLineIds([]); setLinkTarget(""); setLinkError(""); setLinkIsNew(false); setLinkNewName(""); } }}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] overflow-y-auto p-0" data-testid="cp-detail-fullscreen">
          <div className="sticky top-0 z-10 bg-card border-b border-border px-6 py-4">
            <DialogHeader className="space-y-0">
              <div className="flex items-center gap-3">
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                  onClick={() => { setSelectedCp(null); setIsRenaming(false); setDeleteConfirm(false); }}
                  data-testid="btn-back-to-list">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                {isRenaming ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      className="text-lg font-semibold h-9 max-w-md"
                      data-testid="input-rename-counterparty"
                      autoFocus
                      onKeyDown={e => { if (e.key === "Enter") handleConfirmRename(); if (e.key === "Escape") handleCancelRename(); }}
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                      onClick={handleConfirmRename} disabled={renameLoading} data-testid="btn-confirm-rename">
                      {renameLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-500 hover:text-muted-foreground"
                      onClick={handleCancelRename} data-testid="btn-cancel-rename">
                      <X className="w-4 h-4" />
                    </Button>
                    {renameError && <p className="text-xs text-red-600" data-testid="text-rename-error">{renameError}</p>}
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <DialogTitle className="text-xl font-bold">{selectedCp}</DialogTitle>
                      <PermissionGate entity="procurement" action="edit">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-blue-600"
                          onClick={handleStartRename} title="Rename" data-testid="btn-rename-counterparty">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-red-600"
                          onClick={() => setDeleteConfirm(true)} title="Delete" data-testid="btn-delete-counterparty">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </PermissionGate>
                      <div className="flex items-center gap-1.5 ml-2">
                        <Tag className="w-3 h-3 text-slate-500" />
                        <Select
                          value={(() => {
                            const cpData = (data?.counterparties || []).find((c: any) => c.counterpartyName === selectedCp);
                            return cpData?.counterpartyType || "OTHER";
                          })()}
                          onValueChange={handleChangeType}
                          disabled={typeChangeLoading}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs" data-testid="select-cp-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="INSTALLER">Installer</SelectItem>
                            <SelectItem value="SUPPLIER">Supplier</SelectItem>
                            <SelectItem value="OTHER">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        {typeChangeLoading && <Loader2 className="w-3 h-3 animate-spin text-slate-500" />}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {deleteConfirm && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-2 mx-10" data-testid="delete-confirm-panel">
                  <p className="text-xs text-red-800 mb-2">
                    This will permanently delete <strong>{selectedCp}</strong> and all their associated cost line data. This cannot be undone.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="destructive" className="h-7 text-xs"
                      onClick={handleDeleteCounterparty} disabled={deleteLoading} data-testid="btn-confirm-delete">
                      {deleteLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
                      Yes, delete
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setDeleteConfirm(false)} data-testid="btn-cancel-delete">
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </DialogHeader>
          </div>

          <div className="px-6 py-4">
          {detailLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
          ) : detailData ? (
            <div className="space-y-6">
              {selectedCp?.toLowerCase() === "unknown" && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4" data-testid="unknown-assign-banner">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-900">Unassigned Cost Lines</p>
                      <p className="text-xs text-amber-700 mt-1">
                        These cost lines don't have a supplier assigned. Select lines below using the checkboxes, then use the "Link to counterparty" panel to assign them to the correct supplier.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100"
                        onClick={() => {
                          const allIds = (detailData.lines || []).map((l: any) => l.id);
                          setLinkingLineIds(allIds);
                        }}
                        data-testid="btn-select-all-unknown"
                      >
                        <Link2 className="w-3 h-3 mr-1" /> Select All Lines to Assign
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {selectedCp && selectedCp.toLowerCase() !== "unknown" && (
                <SupplierDetailsPanel counterpartyName={selectedCp} />
              )}

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {detailData.invoiceSummary && (
                  <>
                    <Card>
                      <CardContent className="p-3">
                        <p className="text-[10px] text-muted-foreground uppercase">Total Invoices</p>
                        <p className="text-2xl font-bold">{detailData.invoiceSummary.totalInvoices}</p>
                        <p className="text-xs text-slate-500 font-mono">{formatCurrency(detailData.invoiceSummary.totalAmount)}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-green-200 bg-green-50/30">
                      <CardContent className="p-3">
                        <p className="text-[10px] text-green-700 uppercase flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Settled / Paid
                        </p>
                        <p className="text-2xl font-bold text-green-700">{detailData.invoiceSummary.settled.count}</p>
                        <p className="text-xs text-green-600 font-mono">{formatCurrency(detailData.invoiceSummary.settled.amount)}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-amber-200 bg-amber-50/30">
                      <CardContent className="p-3">
                        <p className="text-[10px] text-amber-700 uppercase flex items-center gap-1">
                          <CircleDot className="w-3 h-3" /> Outstanding
                        </p>
                        <p className="text-2xl font-bold text-amber-700">{detailData.invoiceSummary.outstanding.count}</p>
                        <p className="text-xs text-amber-600 font-mono">{formatCurrency(detailData.invoiceSummary.outstanding.amount)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3">
                        <div className="flex gap-4 text-xs mt-1">
                          <div>
                            <span className="text-muted-foreground">Invoiced:</span>{" "}
                            <span className="font-bold">{detailData.invoiceSummary.invoiced.count}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Approved:</span>{" "}
                            <span className="font-bold">{detailData.invoiceSummary.approved.count}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Planned:</span>{" "}
                            <span className="font-bold">{detailData.invoiceSummary.planned.count}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Last Activity</p>
                    <p className="text-sm font-medium">{formatDate(detailData.linkedDates?.lastActivity)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Oldest Open</p>
                    <p className="text-sm font-medium">{formatDate(detailData.linkedDates?.oldestOpen)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Next Due</p>
                    <p className="text-sm font-medium">{formatDate(detailData.linkedDates?.nextDue)}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {detailData.monthlyTrend?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">Monthly Spend Trend</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-48">
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
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">Project Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      {detailData.projectBreakdown.map((p: any) => (
                        <div key={p.projectName} className="flex justify-between items-center bg-muted rounded px-3 py-2 group hover:bg-blue-50 transition-colors"
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
                            <span className="text-slate-500 ml-1.5">({p.lineCount} lines)</span>
                            {p.openCount > 0 && (
                              <span className="ml-2 text-amber-600">{p.openCount} open</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>

              {detailData.upcoming?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Upcoming Items (30d)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {detailData.upcoming.map((u: any, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-purple-50 rounded px-3 py-2">
                        <div>
                          <button className="text-xs font-medium text-blue-700 hover:underline"
                            onClick={() => { setSelectedCp(null); navigate(`/project/${encodeURIComponent(u.projectName)}`); }}>
                            {u.projectName}
                          </button>
                          <span className="text-[10px] text-muted-foreground ml-2">{u.description || ""}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-mono">{formatCurrency(parseFloat(u.amountExVat || "0"))}</span>
                          <span className="text-[10px] text-slate-500 ml-2">{formatDate(u.invoiceDate)}</span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <div data-testid="invoice-lines-section">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-foreground">
                    All Invoices ({(() => {
                      const lines = detailData.lines || [];
                      if (invoiceStatusFilter === "all") return lines.length;
                      return lines.filter((l: any) => invoiceStatusFilter === "outstanding" ? l.status !== "PAID" : l.status === invoiceStatusFilter).length;
                    })()})
                  </p>
                  {linkingLineIds.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2" data-testid="link-panel">
                      <Link2 className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="text-xs font-medium text-blue-800 shrink-0">{linkingLineIds.length} line{linkingLineIds.length > 1 ? "s" : ""} selected</span>
                      <div className="flex items-center gap-1 border border-blue-200 rounded bg-card p-0.5 shrink-0">
                        <button
                          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${!linkIsNew ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => setLinkIsNew(false)}
                          data-testid="btn-link-existing"
                        >
                          Existing
                        </button>
                        <button
                          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${linkIsNew ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => setLinkIsNew(true)}
                          data-testid="btn-link-new"
                        >
                          + New
                        </button>
                      </div>
                      {!linkIsNew ? (
                        <Select value={linkTarget} onValueChange={setLinkTarget}>
                          <SelectTrigger className="h-7 w-48 text-xs" data-testid="select-link-target">
                            <SelectValue placeholder="Link to counterparty..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(data?.counterparties || [])
                              .filter((c: any) => c.counterpartyName !== selectedCp)
                              .map((c: any) => (
                                <SelectItem key={c.counterpartyName} value={c.counterpartyName}>
                                  {c.counterpartyName} ({c.counterpartyType || "Other"})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={linkNewName}
                            onChange={(e) => setLinkNewName(e.target.value)}
                            placeholder="New counterparty name..."
                            className="h-7 w-48 text-xs"
                            data-testid="input-new-counterparty"
                          />
                          <Select value={linkNewType} onValueChange={setLinkNewType}>
                            <SelectTrigger className="h-7 w-28 text-xs" data-testid="select-new-cp-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="INSTALLER">Installer</SelectItem>
                              <SelectItem value="SUPPLIER">Supplier</SelectItem>
                              <SelectItem value="OTHER">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer shrink-0">
                        <Checkbox
                          checked={linkCreatePattern}
                          onCheckedChange={(v) => setLinkCreatePattern(!!v)}
                          className="h-3.5 w-3.5"
                          data-testid="checkbox-create-pattern"
                        />
                        Create pattern
                      </label>
                      <Button size="sm" className="h-7 text-xs shrink-0" onClick={handleLinkCounterparty}
                        disabled={linkLoading || (linkIsNew ? !linkNewName.trim() : !linkTarget)} data-testid="btn-confirm-link">
                        {linkLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                        Link
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0" onClick={() => { setLinkingLineIds([]); setLinkTarget(""); setLinkNewName(""); setLinkIsNew(false); setLinkError(""); }}
                        data-testid="btn-cancel-link">
                        <X className="w-3 h-3" />
                      </Button>
                      {linkError && <span className="text-xs text-red-600">{linkError}</span>}
                    </div>
                  )}
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
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-[11px]" data-testid="invoice-detail-table">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="border-b border-border">
                        <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-8">
                          <Checkbox
                            checked={(() => {
                              const visibleLines = (detailData.lines || []).filter((l: any) => {
                                if (invoiceStatusFilter === "all") return true;
                                if (invoiceStatusFilter === "outstanding") return l.status !== "PAID";
                                return l.status === invoiceStatusFilter;
                              });
                              return visibleLines.length > 0 && visibleLines.every((l: any) => linkingLineIds.includes(l.id));
                            })()}
                            onCheckedChange={(checked) => {
                              const visibleLines = (detailData.lines || []).filter((l: any) => {
                                if (invoiceStatusFilter === "all") return true;
                                if (invoiceStatusFilter === "outstanding") return l.status !== "PAID";
                                return l.status === invoiceStatusFilter;
                              });
                              if (checked) {
                                setLinkingLineIds(prev => [...new Set([...prev, ...visibleLines.map((l: any) => l.id)])]);
                              } else {
                                const visibleIds = new Set(visibleLines.map((l: any) => l.id));
                                setLinkingLineIds(prev => prev.filter(id => !visibleIds.has(id)));
                              }
                            }}
                            className="h-3.5 w-3.5"
                            data-testid="checkbox-select-all"
                          />
                        </th>
                        <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Project</th>
                        <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Category</th>
                        <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Description</th>
                        <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Invoice #</th>
                        <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Amount</th>
                        <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Date</th>
                        <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Paid</th>
                        <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Status</th>
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
                        <tr key={l.id} className={`border-b border-border hover:bg-blue-50/30 group ${linkingLineIds.includes(l.id) ? "bg-blue-50" : ""}`} data-testid={`invoice-row-${l.id}`}>
                          <td className="px-2 py-1.5">
                            <Checkbox
                              checked={linkingLineIds.includes(l.id)}
                              onCheckedChange={(checked) => {
                                if (checked) setLinkingLineIds(prev => [...prev, l.id]);
                                else setLinkingLineIds(prev => prev.filter(id => id !== l.id));
                              }}
                              className="h-3.5 w-3.5"
                              data-testid={`checkbox-line-${l.id}`}
                            />
                          </td>
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
                          <td className="px-2 py-1.5 text-muted-foreground">{l.costCategory || "\u2014"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground max-w-[200px] truncate" title={l.description || ""}>{l.description || "\u2014"}</td>
                          <td className="px-2 py-1.5 font-mono">{l.invoiceNumber || "\u2014"}</td>
                          <td className="px-2 py-1.5 font-mono text-right">{formatCurrency(parseFloat(l.amountExVat || "0"))}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{formatDate(l.invoiceDate)}</td>
                          <td className={`px-2 py-1.5 ${l.paidDate && new Date(l.paidDate) > new Date() ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                            {formatDate(l.paidDate)}
                            {l.paidDate && new Date(l.paidDate) > new Date() && <span className="text-[8px] ml-0.5">(future)</span>}
                          </td>
                          <td className="px-2 py-1.5">
                            <Badge variant={l.status === "PAID" ? "default" : l.status === "INVOICED" ? "secondary" : "outline"}
                              className={`text-[9px] ${l.status === "PAID" ? "bg-green-100 text-green-700 border-green-200" : l.status === "INVOICED" ? "bg-amber-50 text-amber-700 border-amber-200" : l.status === "APPROVED" ? "bg-blue-50 text-blue-700 border-blue-200" : "text-muted-foreground"}`}>
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
