import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Plus, Trash2, Download, Send, Package, Loader2,
  ChevronDown, ChevronUp, Eye, Copy, ArrowUp, ArrowDown, GripVertical,
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface LineItem {
  description: string;
  partNumber: string;
  qty: number;
  unit: string;
  pricePerUnit: number;
}

const emptyLine: LineItem = { description: "", partNumber: "", qty: 1, unit: "", pricePerUnit: 0 };

interface POGeneratorProps {
  projectName: string;
  projectManager?: string;
}

export function POGenerator({ projectName, projectManager }: POGeneratorProps) {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [supplierVat, setSupplierVat] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [supplierContact, setSupplierContact] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ ...emptyLine }]);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [siteContact, setSiteContact] = useState("");
  const [comments, setComments] = useState("");
  const [expandedPo, setExpandedPo] = useState<number | null>(null);

  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: supplierList = [] } = useQuery<any[]>({
    queryKey: ["supplier-list"],
    queryFn: async () => {
      const res = await fetch("/api/subcontractor-dashboard/supplier-list", { headers: authHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && showForm,
  });

  async function loadSupplierDetails(name: string) {
    try {
      const res = await fetch(`/api/subcontractor-dashboard/supplier-details/${encodeURIComponent(name)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.exists) {
        setSupplierName(data.name_canonical || name);
        if (data.vat_number) setSupplierVat(data.vat_number);
        if (data.address) setSupplierAddress(data.address);
        if (data.contact_person) {
          const contact = [data.contact_person, data.contact_phone].filter(Boolean).join(" — ");
          setSupplierContact(contact);
        }
        if (data.payment_terms) setPaymentTerms(data.payment_terms);
      }
    } catch {}
  }

  const { data: poList = [], isLoading: loadingList } = useQuery<any[]>({
    queryKey: ["po-list", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/po/${encodeURIComponent(projectName)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/po/generate", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName,
          supplierName,
          supplierVat,
          supplierAddress,
          supplierContact,
          lineItems,
          paymentTerms,
          deliveryDate,
          deliveryAddress,
          siteContact,
          comments,
          projectManager,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `PO Generated: ${data.poRef}` });
      qc.invalidateQueries({ queryKey: ["po-list", projectName] });
      resetForm();

      if (data.pdfBase64) {
        const byteCharacters = atob(data.pdfBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${data.poRef}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    },
    onError: (err: any) => toast({ title: "Failed to generate PO", description: err.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ poId, status }: { poId: number; status: string }) => {
      const res = await fetch(`/api/po/${poId}/status`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["po-list", projectName] });
      toast({ title: "PO status updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (poId: number) => {
      const res = await fetch(`/api/po/${poId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["po-list", projectName] });
      toast({ title: "PO deleted" });
    },
  });

  function resetForm() {
    setShowForm(false);
    setSupplierName("");
    setSupplierVat("");
    setSupplierAddress("");
    setSupplierContact("");
    setLineItems([{ ...emptyLine }]);
    setPaymentTerms("");
    setDeliveryDate("");
    setDeliveryAddress("");
    setSiteContact("");
    setComments("");
  }

  function updateLineItem(idx: number, field: keyof LineItem, value: any) {
    setLineItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function addLineItem() {
    setLineItems(prev => [...prev, { ...emptyLine }]);
  }

  function removeLineItem(idx: number) {
    if (lineItems.length <= 1) return;
    setLineItems(prev => prev.filter((_, i) => i !== idx));
  }

  function duplicateLineItem(idx: number) {
    setLineItems(prev => {
      const copy = [...prev];
      copy.splice(idx + 1, 0, { ...prev[idx] });
      return copy;
    });
  }

  function moveLineItem(idx: number, direction: "up" | "down") {
    setLineItems(prev => {
      const copy = [...prev];
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= copy.length) return prev;
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  }

  function handleLineKeyDown(e: React.KeyboardEvent, idx: number, field: string) {
    if (e.key === "Enter" && idx === lineItems.length - 1 && field === "pricePerUnit") {
      e.preventDefault();
      addLineItem();
      setTimeout(() => {
        const nextDesc = document.querySelector(`[data-testid="input-line-desc-${idx + 1}"]`) as HTMLInputElement;
        nextDesc?.focus();
      }, 50);
    }
  }

  const subtotal = lineItems.reduce((s, item) => s + (item.qty || 0) * (item.pricePerUnit || 0), 0);
  const vatAmount = Math.round(subtotal * 0.15 * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;

  const canGenerate = supplierName.trim() && lineItems.some(li => li.description.trim() && li.qty > 0 && li.pricePerUnit > 0);

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
      .catch(() => toast({ title: "Failed to download PDF", variant: "destructive" }));
  }

  const statusColor: Record<string, string> = {
    draft: "bg-muted text-foreground",
    sent: "bg-blue-100 text-blue-700",
    approved: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="btn-open-po-generator">
          <Package className="h-4 w-4 mr-1.5" />
          Purchase Orders
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Purchase Orders — {projectName}
          </DialogTitle>
        </DialogHeader>

        {!showForm && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {poList.length} purchase order{poList.length !== 1 ? "s" : ""}
              </p>
              <Button size="sm" onClick={() => setShowForm(true)} data-testid="btn-new-po">
                <Plus className="h-4 w-4 mr-1" /> New PO
              </Button>
            </div>

            {loadingList ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : poList.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No purchase orders yet</p>
                <p className="text-xs mt-1">Click "New PO" to create one</p>
              </div>
            ) : (
              <div className="space-y-2">
                {poList.map((po: any) => (
                  <div key={po.id} className="border rounded-lg" data-testid={`po-card-${po.id}`}>
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30"
                      onClick={() => setExpandedPo(expandedPo === po.id ? null : po.id)}
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm font-medium">{po.po_ref}</span>
                          <span className="text-xs text-muted-foreground ml-2">{po.supplier_name}</span>
                        </div>
                        <Badge className={statusColor[po.status] || ""} variant="secondary">
                          {po.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold">
                          R {parseFloat(po.total).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                        </span>
                        {expandedPo === po.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                    {expandedPo === po.id && (
                      <div className="px-4 pb-3 pt-1 border-t space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div>Supplier VAT: {po.supplier_vat || "N/A"}</div>
                          <div>Created: {new Date(po.created_at).toLocaleDateString()}</div>
                          <div>Address: {po.supplier_address || "N/A"}</div>
                          <div>Contact: {po.supplier_contact || "N/A"}</div>
                        </div>
                        {po.line_items?.length > 0 && (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">#</TableHead>
                                <TableHead className="text-xs">Description</TableHead>
                                <TableHead className="text-xs text-right">Qty</TableHead>
                                <TableHead className="text-xs text-right">Unit Price</TableHead>
                                <TableHead className="text-xs text-right">Subtotal</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(typeof po.line_items === "string" ? JSON.parse(po.line_items) : po.line_items).map((item: any, idx: number) => (
                                <TableRow key={idx}>
                                  <TableCell className="text-xs">{idx + 1}</TableCell>
                                  <TableCell className="text-xs">{item.description}</TableCell>
                                  <TableCell className="text-xs text-right">{item.qty}</TableCell>
                                  <TableCell className="text-xs text-right">R {parseFloat(item.pricePerUnit).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</TableCell>
                                  <TableCell className="text-xs text-right">R {(item.qty * item.pricePerUnit).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadPdf(po.id, po.po_ref)}
                            data-testid={`btn-download-po-${po.id}`}
                          >
                            <Download className="h-3.5 w-3.5 mr-1" /> PDF
                          </Button>
                          {po.status === "draft" && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => statusMutation.mutate({ poId: po.id, status: "sent" })}
                                data-testid={`btn-mark-sent-${po.id}`}
                              >
                                <Send className="h-3.5 w-3.5 mr-1" /> Mark Sent
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => { if (confirm("Delete this draft PO?")) deleteMutation.mutate(po.id); }}
                                data-testid={`btn-delete-po-${po.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          {po.status === "sent" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => statusMutation.mutate({ poId: po.id, status: "approved" })}
                              data-testid={`btn-approve-po-${po.id}`}
                            >
                              Approve
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showForm && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">New Purchase Order</h3>
              <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Supplier Details</h4>
              {supplierList.length > 0 && !supplierName && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs text-blue-700 font-medium mb-2">Select an existing supplier to auto-fill details:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {supplierList.filter((s: any) => s.name_canonical).slice(0, 20).map((s: any) => (
                      <Button
                        key={s.id}
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px] px-2"
                        onClick={() => loadSupplierDetails(s.name_canonical)}
                        data-testid={`btn-select-supplier-${s.id}`}
                      >
                        {s.name_canonical}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Supplier Name *</Label>
                  <Input
                    value={supplierName}
                    onChange={e => setSupplierName(e.target.value)}
                    placeholder="e.g. Menlo — or select above"
                    data-testid="input-supplier-name"
                  />
                </div>
                <div>
                  <Label className="text-xs">VAT Number</Label>
                  <Input
                    value={supplierVat}
                    onChange={e => setSupplierVat(e.target.value)}
                    placeholder="e.g. 4210308138"
                    data-testid="input-supplier-vat"
                  />
                </div>
                <div>
                  <Label className="text-xs">Address</Label>
                  <Input
                    value={supplierAddress}
                    onChange={e => setSupplierAddress(e.target.value)}
                    placeholder="Full address"
                    data-testid="input-supplier-address"
                  />
                </div>
                <div>
                  <Label className="text-xs">Contact</Label>
                  <Input
                    value={supplierContact}
                    onChange={e => setSupplierContact(e.target.value)}
                    placeholder="Name and phone"
                    data-testid="input-supplier-contact"
                  />
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Line Items
                  <Badge variant="secondary" className="ml-2 text-[10px]">{lineItems.length} item{lineItems.length !== 1 ? "s" : ""}</Badge>
                </h4>
                <Button variant="outline" size="sm" onClick={addLineItem} data-testid="btn-add-line-item">
                  <Plus className="h-3 w-3 mr-1" /> Add Item
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Press Enter on the last row's price field to quickly add another item.</p>
              <div className="overflow-x-auto -mx-4 px-4">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-8">#</TableHead>
                    <TableHead className="text-xs">Description *</TableHead>
                    <TableHead className="text-xs">Part Number</TableHead>
                    <TableHead className="text-xs w-16">Qty *</TableHead>
                    <TableHead className="text-xs w-16">Unit</TableHead>
                    <TableHead className="text-xs w-28">Price/Unit *</TableHead>
                    <TableHead className="text-xs w-28 text-right">Subtotal</TableHead>
                    <TableHead className="text-xs w-24 text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((item, idx) => (
                    <TableRow key={idx} className="group">
                      <TableCell className="text-xs font-medium text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs"
                          value={item.description}
                          onChange={e => updateLineItem(idx, "description", e.target.value)}
                          placeholder="Item description"
                          data-testid={`input-line-desc-${idx}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs"
                          value={item.partNumber}
                          onChange={e => updateLineItem(idx, "partNumber", e.target.value)}
                          placeholder="Part #"
                          data-testid={`input-line-part-${idx}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          min={0}
                          value={item.qty || ""}
                          onChange={e => updateLineItem(idx, "qty", parseFloat(e.target.value) || 0)}
                          data-testid={`input-line-qty-${idx}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs"
                          value={item.unit}
                          onChange={e => updateLineItem(idx, "unit", e.target.value)}
                          placeholder="ea"
                          data-testid={`input-line-unit-${idx}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          min={0}
                          step={0.01}
                          value={item.pricePerUnit || ""}
                          onChange={e => updateLineItem(idx, "pricePerUnit", parseFloat(e.target.value) || 0)}
                          onKeyDown={e => handleLineKeyDown(e, idx, "pricePerUnit")}
                          data-testid={`input-line-price-${idx}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-right font-medium">
                        R {((item.qty || 0) * (item.pricePerUnit || 0)).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                            onClick={() => moveLineItem(idx, "up")}
                            disabled={idx === 0}
                            title="Move up"
                            data-testid={`btn-move-up-${idx}`}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                            onClick={() => moveLineItem(idx, "down")}
                            disabled={idx === lineItems.length - 1}
                            title="Move down"
                            data-testid={`btn-move-down-${idx}`}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                            onClick={() => duplicateLineItem(idx)}
                            title="Duplicate row"
                            data-testid={`btn-duplicate-line-${idx}`}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          {lineItems.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                              onClick={() => removeLineItem(idx)}
                              title="Remove row"
                              data-testid={`btn-remove-line-${idx}`}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={addLineItem} className="text-xs text-muted-foreground" data-testid="btn-add-line-item-bottom">
                  <Plus className="h-3 w-3 mr-1" /> Add another item
                </Button>
                <div className="text-right space-y-1">
                  <div className="text-xs text-muted-foreground">Sub-Total: <span className="font-medium text-foreground">R {subtotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span></div>
                  <div className="text-xs text-muted-foreground">VAT (15%): <span className="font-medium text-foreground">R {vatAmount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span></div>
                  <div className="text-sm font-semibold">Total: R {total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</div>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Delivery & Terms</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Payment Terms</Label>
                  <Input
                    value={paymentTerms}
                    onChange={e => setPaymentTerms(e.target.value)}
                    placeholder="Default: All invoicing sent to accounts@emergy.co.za"
                    data-testid="input-payment-terms"
                  />
                </div>
                <div>
                  <Label className="text-xs">Delivery Date</Label>
                  <Input
                    type="date"
                    value={deliveryDate}
                    onChange={e => setDeliveryDate(e.target.value)}
                    data-testid="input-delivery-date"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Delivery Address</Label>
                  <Input
                    value={deliveryAddress}
                    onChange={e => setDeliveryAddress(e.target.value)}
                    placeholder="Full delivery address"
                    data-testid="input-delivery-address"
                  />
                </div>
                <div>
                  <Label className="text-xs">Site Contact</Label>
                  <Input
                    value={siteContact}
                    onChange={e => setSiteContact(e.target.value)}
                    placeholder="Name and phone"
                    data-testid="input-site-contact"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Comments</Label>
                <Textarea
                  value={comments}
                  onChange={e => setComments(e.target.value)}
                  placeholder="Additional notes for the supplier"
                  rows={2}
                  data-testid="input-po-comments"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={!canGenerate || generateMutation.isPending}
                data-testid="btn-generate-po"
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-1" />
                )}
                Generate PO & Download PDF
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
