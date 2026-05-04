import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout";
import { PageHeader } from "@/components/ui/page-header";
import {
  Wallet, CheckCircle2, ShieldCheck, ArrowRight, Upload, Loader2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
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

// ── Formatting helpers ──────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(val: string | null | undefined): string {
  if (!val) return "—";
  const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return val;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function fmtZAR(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  if (!Number.isFinite(n)) return "—";
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return "R " + Math.abs(n).toLocaleString("en-ZA", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
}

// ── Status configuration ────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  preparing: { label: "Preparing",         cls: "bg-slate-100 text-slate-700 border-slate-200" },
  submitted: { label: "Awaiting Approval", cls: "bg-sky-100 text-sky-700 border-sky-200" },
  approved:  { label: "ManCo Approved",    cls: "bg-amber-100 text-amber-700 border-amber-200" },
  released:  { label: "Released to Bank",  cls: "bg-violet-100 text-violet-700 border-violet-200" },
  confirmed: { label: "Confirmed",         cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

const PIPELINE_STEPS = [
  { key: "preparing", label: "Preparing" },
  { key: "submitted", label: "Submitted" },
  { key: "approved",  label: "Approved" },
  { key: "released",  label: "Released" },
  { key: "confirmed", label: "Confirmed" },
];

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: "bg-slate-100 text-slate-700 border-slate-200" };
  return <Badge variant="outline" className={`${cfg.cls} text-xs`}>{cfg.label}</Badge>;
}

function PipelineTrack({ status }: { status: string }) {
  const current = PIPELINE_STEPS.findIndex(s => s.key === status);
  return (
    <div className="flex items-center gap-0.5">
      {PIPELINE_STEPS.map((step, i) => {
        const done   = i < current;
        const active = i === current;
        return (
          <div key={step.key} className="flex items-center">
            <div className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold shrink-0 ${
              done   ? "bg-emerald-100 text-emerald-700" :
              active ? "bg-primary text-primary-foreground" :
                       "bg-slate-100 text-slate-400"
            }`}>
              {done ? <CheckCircle2 className="h-3 w-3" /> : <span>{i + 1}</span>}
            </div>
            <span className={`hidden md:block text-[10px] mx-1.5 ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}>
              {step.label}
            </span>
            {i < PIPELINE_STEPS.length - 1 && (
              <div className={`h-px w-3 mx-0.5 ${done ? "bg-emerald-200" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Batch action buttons (with confirmation dialogs) ────────────────────────

function BatchActions({ batch, onRefresh }: { batch: PaymentBatch; onRefresh: () => void }) {
  const { toast } = useToast();
  const [submitOpen,  setSubmitOpen]  = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [proofOpen,   setProofOpen]   = useState(false);
  const [bankRef,     setBankRef]     = useState("");
  const [docUrl,      setDocUrl]      = useState("");
  const [proofNotes,  setProofNotes]  = useState("");

  const submitMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payment-batches/${batch.id}/submit`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Batch submitted for ManCo approval" }); setSubmitOpen(false); onRefresh(); },
    onError: (e: Error) => toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
  });

  const approveMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payment-batches/${batch.id}/approve`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Batch approved" }); setApproveOpen(false); onRefresh(); },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const releaseMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payment-batches/${batch.id}/release`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Batch released to bank" }); setReleaseOpen(false); onRefresh(); },
    onError: (e: Error) => toast({ title: "Release failed", description: e.message, variant: "destructive" }),
  });

  const confirmMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payment-batches/${batch.id}/confirm`, {
        bankReference: bankRef, documentUrl: docUrl, notes: proofNotes,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Batch confirmed — proof of payment recorded" }); setProofOpen(false); onRefresh(); },
    onError: (e: Error) => toast({ title: "Confirm failed", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      {batch.status === "preparing" && (
        <Button size="sm" onClick={() => setSubmitOpen(true)}>
          <ArrowRight className="h-4 w-4 mr-1.5" /> Submit for Approval
        </Button>
      )}
      {batch.status === "submitted" && (
        <Button size="sm" onClick={() => setApproveOpen(true)}>
          <ShieldCheck className="h-4 w-4 mr-1.5" /> ManCo Approve
        </Button>
      )}
      {batch.status === "approved" && (
        <Button size="sm" onClick={() => setReleaseOpen(true)}>
          <ArrowRight className="h-4 w-4 mr-1.5" /> Release to Bank
        </Button>
      )}
      {batch.status === "released" && (
        <Button size="sm" onClick={() => setProofOpen(true)}>
          <Upload className="h-4 w-4 mr-1.5" /> Upload Proof
        </Button>
      )}

      {/* Submit confirmation */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit batch for approval?</DialogTitle>
            <DialogDescription>
              Batch <strong>{batch.batch_number}</strong> — {batch.item_count} payment{batch.item_count !== 1 ? "s" : ""} totalling <strong>{fmtZAR(batch.total_amount)}</strong> — will be sent to ManCo. No more items can be added after submission.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>Cancel</Button>
            <Button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}>
              {submitMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Submit for Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ManCo approve confirmation */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve payment batch?</DialogTitle>
            <DialogDescription>
              You are giving ManCo approval for <strong>{batch.batch_number}</strong> — <strong>{fmtZAR(batch.total_amount)}</strong> across {batch.item_count} payment{batch.item_count !== 1 ? "s" : ""}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button onClick={() => approveMut.mutate()} disabled={approveMut.isPending}>
              {approveMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release to bank confirmation */}
      <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release to bank?</DialogTitle>
            <DialogDescription>
              <strong>{batch.batch_number}</strong> ({fmtZAR(batch.total_amount)}) will be marked as released. Upload proof of payment once the bank confirms execution.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseOpen(false)}>Cancel</Button>
            <Button onClick={() => releaseMut.mutate()} disabled={releaseMut.isPending}>
              {releaseMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Release to Bank
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload proof dialog */}
      <Dialog open={proofOpen} onOpenChange={setProofOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload proof of payment — {batch.batch_number}</DialogTitle>
            <DialogDescription>
              Record the bank reference and SharePoint link to close this batch.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Bank Reference <span className="text-rose-500">*</span></Label>
              <Input
                value={bankRef}
                onChange={(e) => setBankRef(e.target.value)}
                placeholder="e.g. ABSA ref 123456"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Document URL (SharePoint)</Label>
              <Input
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea value={proofNotes} onChange={(e) => setProofNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProofOpen(false)}>Cancel</Button>
            <Button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending || !bankRef.trim()}>
              {confirmMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

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
  if (isError) return (
    <PageError
      title="Unable to load Payment Batches"
      message={error instanceof Error ? error.message : "Something went wrong"}
      onRetry={handleRefresh}
    />
  );

  const activeBatches    = batches.filter(b => b.status !== "confirmed");
  const completedBatches = batches.filter(b => b.status === "confirmed");

  return (
    <PageLayout
      data-testid="page-payment-batch-manager"
      header={
        <PageHeader
          title="Payment Batches"
          subtitle="Manage weekly pay runs — ManCo approval, bank release, and proof of payment."
          actions={
            <Badge variant="outline" className="gap-1.5 text-xs">
              <Wallet className="h-3.5 w-3.5" />
              {activeBatches.length} active · {completedBatches.length} completed
            </Badge>
          }
        />
      }
    >
      {batches.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No payment batches yet. Create one from loaded payment requests.
          </CardContent>
        </Card>
      )}

      {activeBatches.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Active</h2>
          {activeBatches.map((batch) => (
            <Card key={batch.id} className="border-border">
              <CardContent className="p-5 space-y-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-base font-mono">{batch.batch_number}</span>
                      <StatusBadge status={batch.status} />
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                      <span>
                        Cutoff: <span className="text-foreground font-medium">{fmtDate(batch.cutoff_date)}</span>
                      </span>
                      <span>{batch.item_count} payment{batch.item_count !== 1 ? "s" : ""}</span>
                      {batch.prepared_by_name && (
                        <span>Prepared by: <span className="text-foreground">{batch.prepared_by_name}</span></span>
                      )}
                    </div>
                    {batch.approved_by_name && (
                      <p className="text-xs text-muted-foreground">
                        ManCo approved by <span className="text-foreground">{batch.approved_by_name}</span>
                        {batch.approved_at ? ` — ${fmtDate(batch.approved_at)}` : ""}
                      </p>
                    )}
                    {batch.released_by_name && (
                      <p className="text-xs text-muted-foreground">
                        Released by <span className="text-foreground">{batch.released_by_name}</span>
                        {batch.released_at ? ` — ${fmtDate(batch.released_at)}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-semibold font-mono tabular-nums tracking-tight">
                      {fmtZAR(batch.total_amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">ex-VAT</p>
                  </div>
                </div>

                {/* Pipeline progress + actions */}
                <div className="flex items-center justify-between gap-4 pt-3 border-t border-border/60 flex-wrap">
                  <PipelineTrack status={batch.status} />
                  <BatchActions batch={batch} onRefresh={handleRefresh} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {completedBatches.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Completed</h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch #</TableHead>
                  <TableHead>Cutoff Date</TableHead>
                  <TableHead className="text-center">Payments</TableHead>
                  <TableHead className="text-right">Total ex-VAT</TableHead>
                  <TableHead>Confirmed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {completedBatches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-medium font-mono">{batch.batch_number}</TableCell>
                    <TableCell>{fmtDate(batch.cutoff_date)}</TableCell>
                    <TableCell className="text-center tabular-nums">{batch.item_count}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums font-mono">
                      {fmtZAR(batch.total_amount)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {batch.confirmed_at ? (
                        <span className="flex items-center gap-1.5 text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {fmtDate(batch.confirmed_at)}
                        </span>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </PageLayout>
  );
}
