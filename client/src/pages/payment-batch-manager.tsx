import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { Wallet, CheckCircle, ShieldCheck, ArrowRight, Upload } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface PaymentBatch {
  id: number;
  batch_number: string;
  cutoff_date: string;
  total_amount: string;
  item_count: number;
  status: string;
  prepared_by_name: string | null;
  approved_by_name: string | null;
  released_by_name: string | null;
  created_at: string;
  approved_at: string | null;
  released_at: string | null;
  confirmed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  preparing: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-yellow-100 text-yellow-700",
  released: "bg-purple-100 text-purple-700",
  confirmed: "bg-green-100 text-green-700",
};

function formatCurrency(val: string | number): string {
  return `R ${Number(val).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function BatchActions({ batch, onRefresh }: { batch: PaymentBatch; onRefresh: () => void }) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bankRef, setBankRef] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [confirmNotes, setConfirmNotes] = useState("");

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payment-batches/${batch.id}/submit`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Batch submitted for ManCo approval" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payment-batches/${batch.id}/approve`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Batch approved by ManCo" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const releaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payment-batches/${batch.id}/release`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Batch released to bank" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payment-batches/${batch.id}/confirm`, {
        bankReference: bankRef, documentUrl: docUrl, notes: confirmNotes,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Batch confirmed with proof of payment" }); setConfirmOpen(false); onRefresh(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex gap-2">
      {batch.status === "preparing" && (
        <Button size="sm" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
          <ArrowRight className="h-4 w-4 mr-1" /> Submit for Approval
        </Button>
      )}
      {batch.status === "submitted" && (
        <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
          <ShieldCheck className="h-4 w-4 mr-1" /> ManCo Approve
        </Button>
      )}
      {batch.status === "approved" && (
        <Button size="sm" onClick={() => releaseMutation.mutate()} disabled={releaseMutation.isPending}>
          <ArrowRight className="h-4 w-4 mr-1" /> Release to Bank
        </Button>
      )}
      {batch.status === "released" && (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Upload className="h-4 w-4 mr-1" /> Upload Proof
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Confirm Batch {batch.batch_number}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Bank Reference</Label>
                <Input value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder="ABSA ref..." />
              </div>
              <div>
                <Label>Document URL</Label>
                <Input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="SharePoint link..." />
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea value={confirmNotes} onChange={(e) => setConfirmNotes(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                <CheckCircle className="h-4 w-4 mr-1" /> Confirm Payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {batch.status === "confirmed" && (
        <Badge className="bg-green-100 text-green-700">
          <CheckCircle className="h-3 w-3 mr-1" /> Confirmed
        </Badge>
      )}
    </div>
  );
}

export default function PaymentBatchManagerPage() {
  const queryClient = useQueryClient();

  const { data: batches = [], isLoading, isError, error } = useQuery<PaymentBatch[]>({
    queryKey: ["/api/payment-batches"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/payment-batches");
      if (!res.ok) throw new Error("Failed to fetch payment batches");
      return res.json();
    },
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/payment-batches"] });
  };

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell className="p-4"><PageError title="Unable to load Payment Batches" message={error instanceof Error ? error.message : "Failed"} onRetry={handleRefresh} /></PageShell>;

  const activeBatches = batches.filter(b => b.status !== "confirmed");
  const completedBatches = batches.filter(b => b.status === "confirmed");

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-payment-batch-manager">
      <SectionHeader
        icon={<Wallet className="h-5 w-5" />}
        eyebrow="Finance"
        title="Payment Batches"
        description="Manage weekly pay runs — ManCo approval, bank release, proof of payment"
      />

      {activeBatches.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-3">Active Batches</h3>
          <div className="space-y-3">
            {activeBatches.map((batch) => (
              <Card key={batch.id}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-semibold">{batch.batch_number}</p>
                      <p className="text-sm text-muted-foreground">
                        Cutoff: {new Date(batch.cutoff_date).toLocaleDateString("en-ZA")} |
                        {batch.item_count} item(s) |
                        Prepared by: {batch.prepared_by_name || "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge className={STATUS_COLORS[batch.status]}>{batch.status}</Badge>
                      <p className="font-bold text-lg mt-1">{formatCurrency(batch.total_amount)}</p>
                    </div>
                  </div>
                  {batch.approved_by_name && <p className="text-xs text-muted-foreground">Approved by: {batch.approved_by_name} ({batch.approved_at ? new Date(batch.approved_at).toLocaleDateString("en-ZA") : ""})</p>}
                  {batch.released_by_name && <p className="text-xs text-muted-foreground">Released by: {batch.released_by_name} ({batch.released_at ? new Date(batch.released_at).toLocaleDateString("en-ZA") : ""})</p>}
                  <div className="mt-3">
                    <BatchActions batch={batch} onRefresh={handleRefresh} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeBatches.length === 0 && (
        <Card className="mb-6">
          <CardContent className="p-6 text-center text-muted-foreground">
            No active payment batches. Create one from loaded payment requests.
          </CardContent>
        </Card>
      )}

      {completedBatches.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Completed Batches</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Cutoff</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Confirmed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {completedBatches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">{batch.batch_number}</TableCell>
                  <TableCell>{new Date(batch.cutoff_date).toLocaleDateString("en-ZA")}</TableCell>
                  <TableCell>{batch.item_count}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(batch.total_amount)}</TableCell>
                  <TableCell>{batch.confirmed_at ? new Date(batch.confirmed_at).toLocaleDateString("en-ZA") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageShell>
  );
}
