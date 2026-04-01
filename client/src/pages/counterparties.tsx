import { useEffect, useMemo, useState } from "react";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { usePermission } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Loader2, Merge, Pencil, PlayCircle, Save, Search, Users } from "lucide-react";
import {
  canEditCounterparties,
  COUNTERPARTIES_ROUTE,
  type CounterpartyContact,
  type CounterpartyDetail,
  CounterpartySummary,
  deriveCounterpartyStatus,
  filterCounterparties,
} from "@/lib/counterparty-utils";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
    return headers;
}

type EditableCounterpartyFields = Pick<
  CounterpartySummary,
  | "nameCanonical"
  | "typeDefault"
  | "contactPerson"
  | "contactPhone"
  | "contactEmail"
  | "address"
  | "vatNumber"
  | "registrationNumber"
  | "paymentTerms"
  | "notes"
  | "isCore"
> & {
  isActive: boolean;
  roleTagsText: string;
};

type EditableContactFields = {
  name: string;
  email: string;
  phone: string;
  title: string;
  roleTagsText: string;
  isActive: boolean;
  notes: string;
};

const EMPTY_FORM: EditableCounterpartyFields = {
  nameCanonical: "",
  typeDefault: "OTHER",
  contactPerson: "",
  contactPhone: "",
  contactEmail: "",
  address: "",
  vatNumber: "",
  registrationNumber: "",
  paymentTerms: "",
  notes: "",
  isCore: false,
  isActive: true,
  roleTagsText: "",
};

const EMPTY_CONTACT_FORM: EditableContactFields = {
  name: "",
  email: "",
  phone: "",
  title: "",
  roleTagsText: "",
  isActive: true,
  notes: "",
};

export default function CounterpartiesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const { allowed: canView, loading: permissionLoading } = usePermission("subcontractors", "view");
  const { allowed: canEditPermission } = usePermission("subcontractors", "edit");
  const canEdit = canEditCounterparties(canEditPermission);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "SUPPLIER" | "INSTALLER" | "OTHER">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<number>>(new Set());
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string>("");
  const [form, setForm] = useState<EditableCounterpartyFields>(EMPTY_FORM);
  const [contactForm, setContactForm] = useState<EditableContactFields>(EMPTY_CONTACT_FORM);

  const { data: counterparties = [], isLoading, isError, error, refetch } = useQuery<CounterpartySummary[]>({
    queryKey: ["/api/counterparties/summary"],
    queryFn: async () => {
      const res = await fetch("/api/counterparties/summary", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to load counterparties");
      return res.json();
    },
    enabled: canView,
  });

  const selected = useMemo(
    () => counterparties.find((cp) => cp.id === selectedId) || null,
    [counterparties, selectedId],
  );

  const { data: counterpartyDetail, isLoading: detailLoading } = useQuery<CounterpartyDetail | null>({
    queryKey: ["/api/counterparties/detail", selectedId],
    queryFn: async () => {
      if (!selectedId) return null;
      const res = await fetch(`/api/counterparties/${selectedId}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load counterparty detail");
      return res.json();
    },
    enabled: !!selectedId,
  });

  const filtered = useMemo(
    () => filterCounterparties(counterparties, search, typeFilter, statusFilter),
    [counterparties, search, typeFilter, statusFilter],
  );
  const selectedMergeRows = useMemo(
    () => counterparties.filter((cp) => selectedForMerge.has(cp.id)),
    [counterparties, selectedForMerge],
  );
  const mergeTarget = useMemo(
    () => counterparties.find((cp) => cp.id === mergeTargetId) || null,
    [counterparties, mergeTargetId],
  );
  const mergePreview = useMemo(() => {
    if (!mergeTarget) return null;
    const sourceRows = selectedMergeRows.filter((cp) => cp.id !== mergeTarget.id);
    const usageCount = sourceRows.reduce((acc, cp) => acc + (cp.usageCount || 0), mergeTarget.usageCount || 0);
    const linkedProjectCount = sourceRows.reduce((acc, cp) => acc + (cp.linkedProjectCount || 0), mergeTarget.linkedProjectCount || 0);
    const spend = sourceRows.reduce((acc, cp) => acc + Number(cp.totalSpendExVat || 0), Number(mergeTarget.totalSpendExVat || 0));
    const open = sourceRows.reduce((acc, cp) => acc + Number(cp.openAmountExVat || 0), Number(mergeTarget.openAmountExVat || 0));
    return { sourceRows, usageCount, linkedProjectCount, spend, open };
  }, [mergeTarget, selectedMergeRows]);

  const patchMutation = useMutation({
    mutationFn: async (payload: EditableCounterpartyFields) => {
      if (!selectedId) throw new Error("No counterparty selected");
      const res = await fetch(`/api/counterparties/${selectedId}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...payload,
          roleTags: payload.roleTagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to update" }));
        throw new Error(body.error || "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties/detail", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/summary"] });
      setEditing(false);
      toast({ title: "Counterparty updated", description: "Core counterparty details were saved." });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err?.message || "Could not update counterparty", variant: "destructive" });
    },
  });

  const createContactMutation = useMutation({
    mutationFn: async (payload: EditableContactFields) => {
      if (!selectedId) throw new Error("No counterparty selected");
      const res = await fetch(`/api/counterparties/${selectedId}/contacts`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...payload,
          roleTags: payload.roleTagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to add contact" }));
        throw new Error(body.error || "Failed to add contact");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties/detail", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties/summary"] });
      setContactForm(EMPTY_CONTACT_FORM);
      toast({ title: "Contact added", description: "The contact can now be reused in assignments." });
    },
    onError: (err: any) => {
      toast({ title: "Add contact failed", description: err?.message || "Could not save contact", variant: "destructive" });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async ({ contactId, payload }: { contactId: number; payload: Partial<CounterpartyContact> }) => {
      if (!selectedId) throw new Error("No counterparty selected");
      const res = await fetch(`/api/counterparties/${selectedId}/contacts/${contactId}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to update contact" }));
        throw new Error(body.error || "Failed to update contact");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties/detail", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties/summary"] });
    },
    onError: (err: any) => {
      toast({ title: "Contact update failed", description: err?.message || "Could not update contact", variant: "destructive" });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!mergeTarget) throw new Error("Select a merge target");
      const sourceNames = selectedMergeRows.map((cp) => cp.nameCanonical);
      if (sourceNames.length < 2) throw new Error("Select at least two counterparties");
      const res = await fetch("/api/subcontractor-dashboard/merge", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sourceNames, targetName: mergeTarget.nameCanonical }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to merge counterparties" }));
        throw new Error(body.error || "Failed to merge counterparties");
      }
      return res.json();
    },
    onSuccess: () => {
      setShowMergeDialog(false);
      setSelectedForMerge(new Set());
      setMergeTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/counterparties/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/detail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-patterns"] });
      toast({ title: "Counterparties merged", description: "Linked procurement, spend, and pattern aliases were reconciled." });
    },
    onError: (err: any) => {
      toast({ title: "Merge failed", description: err?.message || "Could not merge counterparties", variant: "destructive" });
    },
  });

  const runAnalysisMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/procurement-analysis/run", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to run procurement analysis" }));
        throw new Error(body.error || "Failed to run procurement analysis");
      }
      return res.json();
    },
    onSuccess: (result) => {
      const message = result?.message || "Procurement analysis completed.";
      setAnalysisResult(message);
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/detail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractor-dashboard/overdue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-analysis/pattern-stats"] });
      localStorage.setItem("procurement-analysis-last-run", String(Date.now()));
      window.dispatchEvent(new CustomEvent("procurement-analysis-complete"));
      toast({ title: "Procurement analysis finished", description: "Procurement Hub / Subcontractors has been refreshed with latest aggregates." });
    },
    onError: (err: any) => {
      toast({ title: "Analysis failed", description: err?.message || "Could not run procurement analysis", variant: "destructive" });
    },
  });

  const openDetails = (cp: CounterpartySummary) => {
    setSelectedId(cp.id);
    setEditing(false);
    setForm({
      nameCanonical: cp.nameCanonical || "",
      typeDefault: cp.typeDefault || "OTHER",
      contactPerson: cp.contactPerson || "",
      contactPhone: cp.contactPhone || "",
      contactEmail: cp.contactEmail || "",
      address: cp.address || "",
      vatNumber: cp.vatNumber || "",
      registrationNumber: cp.registrationNumber || "",
      paymentTerms: cp.paymentTerms || "",
      notes: cp.notes || "",
      isCore: !!cp.isCore,
      isActive: cp.isActive !== false,
      roleTagsText: (cp.roleTags || []).join(", "),
    });
  };

  useEffect(() => {
    if (!counterpartyDetail) return;
    setForm({
      nameCanonical: counterpartyDetail.nameCanonical || "",
      typeDefault: counterpartyDetail.typeDefault || "OTHER",
      contactPerson: counterpartyDetail.contactPerson || "",
      contactPhone: counterpartyDetail.contactPhone || "",
      contactEmail: counterpartyDetail.contactEmail || "",
      address: counterpartyDetail.address || "",
      vatNumber: counterpartyDetail.vatNumber || "",
      registrationNumber: counterpartyDetail.registrationNumber || "",
      paymentTerms: counterpartyDetail.paymentTerms || "",
      notes: counterpartyDetail.notes || "",
      isCore: !!counterpartyDetail.isCore,
      isActive: counterpartyDetail.isActive !== false,
      roleTagsText: (counterpartyDetail.roleTags || []).join(", "),
    });
  }, [counterpartyDetail]);

  if (permissionLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading permissions...</div>;
  }

  if (!canView) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">You don't have permission to view counterparties.</p>
      </div>
    );
  }

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <div className="p-4 md:p-6"><PageError title="Unable to load Counterparties" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></div>;

  return (
    <FinanceShell currentPage="counterparties"><div className="space-y-6" data-testid="counterparties-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Counterparties</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Single source of truth for Procurement / Finance counterparties used across Smart Import and Procurement Hub.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runAnalysisMutation.mutate()}
                disabled={runAnalysisMutation.isPending}
                data-testid="btn-run-procurement-analysis"
              >
                {runAnalysisMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <PlayCircle className="w-3.5 h-3.5 mr-1" />}
                Run procurement analysis
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={selectedForMerge.size < 2}
                onClick={() => {
                  const first = Array.from(selectedForMerge)[0];
                  setMergeTargetId(first || null);
                  setShowMergeDialog(true);
                }}
                data-testid="btn-open-counterparty-merge"
              >
                <Merge className="w-3.5 h-3.5 mr-1" />
                Merge selected ({selectedForMerge.size})
              </Button>
            </>
          )}
          <Button asChild variant="outline" size="sm" data-testid="btn-open-procurement-hub">
            <a href="/subcontractor-dashboard">Open Procurement Hub</a>
          </Button>
        </div>
      </div>
      {!!analysisResult && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="py-2.5 text-xs text-emerald-800">{analysisResult}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Search & filter</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 h-8 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, type, or contact"
              data-testid="input-counterparty-search"
            />
          </div>
          <SearchableSelect
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as any)}
            options={[
              { value: "all", label: "All types" },
              { value: "SUPPLIER", label: "Supplier" },
              { value: "INSTALLER", label: "Subcontractor / Installer" },
              { value: "OTHER", label: "Vendor / Other" },
            ]}
            data-testid="select-counterparty-type"
          />
          <SearchableSelect
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as any)}
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            data-testid="select-counterparty-status"
          />
        </CardContent>
      </Card>

      {isLoading ? (
        <Card><CardContent className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      ) : isError ? (
        <Card className="border-red-200 bg-red-50/40">
          <CardContent className="py-8 text-center text-red-700">
            <AlertCircle className="w-6 h-6 mx-auto mb-2" />
            {(error as Error)?.message || "Failed to load counterparties"}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground" data-testid="counterparties-empty-state">
            <Users className="w-6 h-6 mx-auto mb-2 text-slate-500" />
            {counterparties.length === 0 ? (
              <>
                <p className="font-semibold text-foreground">No counterparties exist yet</p>
                <p className="text-xs mt-1">Populate this list from Smart Import, then maintain details here in {COUNTERPARTIES_ROUTE}.</p>
                <div className="mt-3 flex justify-center gap-2">
                  <Button asChild size="sm"><a href="/admin/smart-import">Open Smart Import</a></Button>
                  <Button asChild size="sm" variant="outline"><a href="/subcontractor-dashboard">Open Procurement Hub</a></Button>
                </div>
              </>
            ) : (
              <>
                <p className="font-semibold text-foreground">No counterparties match current filters</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); }}>
                  Reset filters
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-[13px]" data-testid="counterparties-table">
            <thead>
              <tr className="bg-muted border-b">
                {isAdmin && <th className="text-left px-2 py-2 w-10" />}
                <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Name</th>
                <th className="text-left px-2 py-2 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Type</th>
                <th className="text-left px-2 py-2 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Status</th>
                <th className="text-right px-2 py-2 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Usage</th>
                <th className="text-right px-2 py-2 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Projects</th>
                <th className="text-right px-2 py-2 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Spend</th>
                <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Open</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cp) => {
                const status = deriveCounterpartyStatus(cp);
                return (
                  <tr key={cp.id} onClick={() => openDetails(cp)} className="border-b hover:bg-muted/70 cursor-pointer h-10" data-testid={`counterparty-row-${cp.id}`}>
                    {isAdmin && (
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedForMerge.has(cp.id)}
                          onChange={(e) => {
                            setSelectedForMerge((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(cp.id);
                              else next.delete(cp.id);
                              return next;
                            });
                          }}
                          aria-label={`Select ${cp.nameCanonical}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-1.5 font-medium max-w-[240px] truncate" title={cp.nameCanonical}>{cp.nameCanonical}</td>
                    <td className="px-2 py-1.5">{cp.typeDefault}</td>
                    <td className="px-2 py-1.5">
                      <Badge className="text-[10px] py-0 h-5" variant={status === "active" ? "default" : "outline"}>{status}</Badge>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{(cp.usageCount || 0).toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{(cp.linkedProjectCount || 0).toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">R {(cp.totalSpendExVat || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">R {(cp.openAmountExVat || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent data-testid="counterparty-merge-dialog">
          <DialogHeader>
            <DialogTitle>Merge counterparties (Admin only)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              Preview impact before merging. This updates linked procurement references and preserves alias patterns for historical names.
            </p>
            <Field label="Surviving master counterparty">
              <SearchableSelect
                value={mergeTargetId ? String(mergeTargetId) : ""}
                onValueChange={(v) => setMergeTargetId(Number(v))}
                options={selectedMergeRows.map((cp) => ({ value: String(cp.id), label: cp.nameCanonical }))}
              />
            </Field>
            {mergePreview && (
              <Card>
                <CardContent className="p-3 space-y-1.5 text-xs">
                  <p><span className="font-semibold">Sources:</span> {mergePreview.sourceRows.map((cp) => cp.nameCanonical).join(", ") || "—"}</p>
                  <p><span className="font-semibold">Projected usage:</span> {mergePreview.usageCount.toLocaleString()} lines</p>
                  <p><span className="font-semibold">Projected linked projects:</span> {mergePreview.linkedProjectCount.toLocaleString()}</p>
                  <p><span className="font-semibold">Projected spend/open:</span> R {mergePreview.spend.toLocaleString()} / R {mergePreview.open.toLocaleString()}</p>
                </CardContent>
              </Card>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowMergeDialog(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={mergeMutation.isPending || !mergeTarget || selectedMergeRows.length < 2}
                onClick={() => mergeMutation.mutate()}
                data-testid="btn-confirm-counterparty-merge"
              >
                {mergeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Merge className="w-3 h-3 mr-1" />}
                Confirm merge
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) { setSelectedId(null); setEditing(false); } }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="counterparty-detail-drawer">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.nameCanonical}</SheetTitle>
              </SheetHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Usage lines</div><div className="font-semibold">{counterpartyDetail?.summary?.usageCount ?? selected.usageCount ?? 0}</div></CardContent></Card>
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Linked projects</div><div className="font-semibold">{counterpartyDetail?.summary?.linkedProjectCount ?? selected.linkedProjectCount ?? 0}</div></CardContent></Card>
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total spend</div><div className="font-semibold">R {((counterpartyDetail?.summary?.totalSpendExVat ?? selected.totalSpendExVat ?? 0)).toLocaleString()}</div></CardContent></Card>
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Open amount</div><div className="font-semibold">R {((counterpartyDetail?.summary?.openAmountExVat ?? selected.openAmountExVat ?? 0)).toLocaleString()}</div></CardContent></Card>
                </div>

                <Card>
                  <CardContent className="p-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Maintenance home</span>
                      <Badge variant="outline">Canonical counterparty registry</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={form.isActive ? "default" : "secondary"}>{form.isActive ? "Active" : "Inactive"}</Badge>
                      <Badge variant="outline">Contacts: {counterpartyDetail?.contacts?.length || 0}</Badge>
                      <Badge variant="outline">Assignments: {(counterpartyDetail?.summary?.directAssignmentCount || 0) + (counterpartyDetail?.summary?.contactAssignmentCount || 0)}</Badge>
                    </div>
                    {!!counterpartyDetail?.summary?.assignmentEntityTypes?.length && (
                      <p className="text-xs text-muted-foreground">
                        Used in: {counterpartyDetail.summary.assignmentEntityTypes.join(", ")}
                      </p>
                    )}
                  </CardContent>
                </Card>

                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium">Core details</p>
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => setEditing((p) => !p)} data-testid="btn-toggle-edit-counterparty">
                      <Pencil className="w-3 h-3 mr-1" /> {editing ? "Cancel" : "Edit"}
                    </Button>
                  )}
                </div>

                {editing && canEdit ? (
                  <div className="space-y-3" data-testid="counterparty-edit-form">
                    <Field label="Name"><Input value={form.nameCanonical} onChange={(e) => setForm((p) => ({ ...p, nameCanonical: e.target.value }))} /></Field>
                    <Field label="Type">
                      <SearchableSelect
                        value={form.typeDefault}
                        onValueChange={(v) => setForm((p) => ({ ...p, typeDefault: v as any }))}
                        options={[{ value: "SUPPLIER", label: "Supplier" }, { value: "INSTALLER", label: "Subcontractor / Installer" }, { value: "OTHER", label: "Vendor / Other" }]}
                      />
                    </Field>
                    <Field label="Role tags"><Input value={form.roleTagsText} onChange={(e) => setForm((p) => ({ ...p, roleTagsText: e.target.value }))} placeholder="supplier, installer, landlord" /></Field>
                    <Field label="Contact person"><Input value={form.contactPerson || ""} onChange={(e) => setForm((p) => ({ ...p, contactPerson: e.target.value }))} /></Field>
                    <Field label="Contact phone"><Input value={form.contactPhone || ""} onChange={(e) => setForm((p) => ({ ...p, contactPhone: e.target.value }))} /></Field>
                    <Field label="Contact email"><Input value={form.contactEmail || ""} onChange={(e) => setForm((p) => ({ ...p, contactEmail: e.target.value }))} /></Field>
                    <Field label="Address"><Textarea value={form.address || ""} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} /></Field>
                    <Field label="VAT number"><Input value={form.vatNumber || ""} onChange={(e) => setForm((p) => ({ ...p, vatNumber: e.target.value }))} /></Field>
                    <Field label="Registration number"><Input value={form.registrationNumber || ""} onChange={(e) => setForm((p) => ({ ...p, registrationNumber: e.target.value }))} /></Field>
                    <Field label="Payment terms"><Input value={form.paymentTerms || ""} onChange={(e) => setForm((p) => ({ ...p, paymentTerms: e.target.value }))} /></Field>
                    <Field label="Notes"><Textarea value={form.notes || ""} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></Field>

                    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.isCore} onChange={(e) => setForm((p) => ({ ...p, isCore: e.target.checked }))} />Core counterparty</label>
                    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.isActive} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} />Active for assignment and procurement use</label>

                    <Button disabled={!form.nameCanonical.trim() || patchMutation.isPending} onClick={() => patchMutation.mutate(form)} data-testid="btn-save-counterparty-edit">
                      {patchMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}Save changes
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <Display label="Type" value={selected.typeDefault} />
                    <Display label="Status" value={form.isActive ? "active" : "inactive"} />
                    <Display label="Role tags" value={form.roleTagsText || "-"} />
                    <Display label="Contact" value={selected.contactPerson || "-"} />
                    <Display label="Email" value={selected.contactEmail || "-"} />
                    <Display label="Phone" value={selected.contactPhone || "-"} />
                    <Display label="Address" value={selected.address || "-"} />
                    <Display label="VAT" value={selected.vatNumber || "-"} />
                    <Display label="Registration" value={selected.registrationNumber || "-"} />
                    <Display label="Payment terms" value={selected.paymentTerms || "-"} />
                    <Display label="Notes" value={selected.notes || "-"} />
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Contacts</p>
                    {detailLoading && <span className="text-xs text-muted-foreground">Loading...</span>}
                  </div>
                  <div className="space-y-2">
                    {(counterpartyDetail?.contacts || []).map((contact) => (
                      <Card key={contact.id}>
                        <CardContent className="p-3 flex items-start justify-between gap-3">
                          <div className="space-y-1 text-sm">
                            <div className="font-medium">{contact.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {[contact.title, contact.email, contact.phone].filter(Boolean).join(" | ") || "No contact channels"}
                            </div>
                            {!!contact.roleTags?.length && (
                              <div className="flex flex-wrap gap-1">
                                {contact.roleTags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={contact.isActive ? "default" : "secondary"}>{contact.isActive ? "Active" : "Inactive"}</Badge>
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateContactMutation.mutate({ contactId: contact.id, payload: { isActive: !contact.isActive } })}
                              >
                                {contact.isActive ? "Deactivate" : "Activate"}
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {!counterpartyDetail?.contacts?.length && (
                      <p className="text-sm text-muted-foreground">No contacts created yet.</p>
                    )}
                  </div>

                  {canEdit && (
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <p className="text-sm font-medium">Add contact</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <Field label="Name"><Input value={contactForm.name} onChange={(e) => setContactForm((p) => ({ ...p, name: e.target.value }))} /></Field>
                          <Field label="Title"><Input value={contactForm.title} onChange={(e) => setContactForm((p) => ({ ...p, title: e.target.value }))} /></Field>
                          <Field label="Email"><Input value={contactForm.email} onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))} /></Field>
                          <Field label="Phone"><Input value={contactForm.phone} onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))} /></Field>
                          <Field label="Role tags"><Input value={contactForm.roleTagsText} onChange={(e) => setContactForm((p) => ({ ...p, roleTagsText: e.target.value }))} placeholder="approver, site contact" /></Field>
                          <Field label="Notes"><Input value={contactForm.notes} onChange={(e) => setContactForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={contactForm.isActive} onChange={(e) => setContactForm((p) => ({ ...p, isActive: e.target.checked }))} />Active contact</label>
                        <Button disabled={!contactForm.name.trim() || createContactMutation.isPending} onClick={() => createContactMutation.mutate(contactForm)}>
                          {createContactMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}Add contact
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div></FinanceShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Display({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
