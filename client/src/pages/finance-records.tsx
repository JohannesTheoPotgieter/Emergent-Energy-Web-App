/**
 * Finance Records — Wave 5
 *
 * Unified list of all transactional finance records.
 * Reads from finance.finance_records via GET /api/finance-records.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { DollarSign, Plus, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface FinanceRecord {
  id: number;
  financial_type: string;
  direction: string;
  title: string | null;
  amount_ex_vat: string | null;
  currency: string;
  status: string;
  party_name: string | null;
  fiscal_period_name: string | null;
  created_at: string;
}

interface FinanceRecordsResponse {
  records: FinanceRecord[];
  total: number;
  limit: number;
  offset: number;
}

const TYPE_LABELS: Record<string, string> = {
  cost_line: "Cost Line",
  revenue_line: "Revenue Line",
  purchase_order: "Purchase Order",
  payment_request: "Payment Request",
  invoice_capture: "Invoice",
  procurement_item: "Procurement",
  change_request: "Variation Order",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  paid: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-muted text-muted-foreground",
};

function formatAmount(amount: string | null, currency: string): string {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return "—";
  return `${currency} ${num.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FinanceRecordsPage() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [newRecord, setNewRecord] = useState({ financialType: "purchase_order", direction: "outflow", title: "", amountExVat: "" });
  const pageSize = 50;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryParams = new URLSearchParams();
  if (typeFilter !== "all") queryParams.set("type", typeFilter);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (directionFilter !== "all") queryParams.set("direction", directionFilter);
  queryParams.set("limit", String(pageSize));
  queryParams.set("offset", String(page * pageSize));

  const { data, isLoading } = useQuery<FinanceRecordsResponse>({
    queryKey: ["finance-records", queryParams.toString()],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/finance-records?${queryParams}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async (formData: typeof newRecord) => {
      const res = await apiRequest("POST", "/api/finance-records", {
        financialType: formData.financialType,
        direction: formData.direction,
        title: formData.title,
        amountExVat: parseFloat(formData.amountExVat) || 0,
        projectInstanceId: 1, // TODO: project selector
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-records"] });
      setCreateOpen(false);
      setNewRecord({ financialType: "purchase_order", direction: "outflow", title: "", amountExVat: "" });
      toast({ title: "Finance record created" });
    },
    onError: () => {
      toast({ title: "Failed to create record", variant: "destructive" });
    },
  });

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <PageShell className="p-3 md:p-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Finance Records
              {data && <Badge variant="secondary" className="text-xs">{data.total} total</Badge>}
            </CardTitle>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New Record
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={(v) => { setDirectionFilter(v); setPage(0); }}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="All directions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="outflow">Outflow (costs)</SelectItem>
                <SelectItem value="inflow">Inflow (revenue)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}

          {data && data.records.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        {r.direction === "inflow" ? (
                          <ArrowDownRight className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4 text-red-600" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{r.title || "—"}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-xs">{TYPE_LABELS[r.financial_type] || r.financial_type}</Badge></TableCell>
                      <TableCell className="text-sm">{r.party_name || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatAmount(r.amount_ex_vat, r.currency)}</TableCell>
                      <TableCell><Badge className={cn("text-xs", STATUS_COLORS[r.status] || "bg-muted")}>{r.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next</Button>
                  </div>
                </div>
              )}
            </>
          )}

          {data && data.records.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">No finance records found.</div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Finance Record</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={newRecord.financialType} onValueChange={(v) => setNewRecord((r) => ({ ...r, financialType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="purchase_order">Purchase Order</SelectItem>
                    <SelectItem value="payment_request">Payment Request</SelectItem>
                    <SelectItem value="invoice_capture">Invoice</SelectItem>
                    <SelectItem value="change_request">Variation Order</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Direction</Label>
                <Select value={newRecord.direction} onValueChange={(v) => setNewRecord((r) => ({ ...r, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outflow">Outflow (cost)</SelectItem>
                    <SelectItem value="inflow">Inflow (revenue)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Title</Label>
              <Input value={newRecord.title} onChange={(e) => setNewRecord((r) => ({ ...r, title: e.target.value }))} />
            </div>
            <div>
              <Label>Amount (excl. VAT)</Label>
              <Input type="number" value={newRecord.amountExVat} onChange={(e) => setNewRecord((r) => ({ ...r, amountExVat: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(newRecord)} disabled={!newRecord.title || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
