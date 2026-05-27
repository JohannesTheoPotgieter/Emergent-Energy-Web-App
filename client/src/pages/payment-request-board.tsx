import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout";
import { PageHeader } from "@/components/ui/page-header";
import {
  CreditCard, Clock, CheckCircle2, AlertTriangle, Loader2, Paperclip, FileWarning,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { statusBadgeClasses } from "@/lib/design-tokens";

interface PaymentRequest {
  id: number;
  project_id: number;
  project_name: string;
  counterparty_name: string | null;
  submitted_by_name: string | null;
  po_ref: string | null;
  invoice_number: string | null;
  amount: string;
  due_date: string | null;
  status: string;
  cutoff_date: string | null;
  notes: string | null;
  created_at: string;
  proof_count: number;
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

// PR-A redesign (2026-05-27): only the label survives here — the
// colour classes are routed through statusBadgeClasses so we can
// retire the sky/violet/orange/rose off-palette colours. Five of
// the seven statuses were outside the 4-token palette.
const STATUS_LABELS: Record<string, string> = {
  new:                "New",
  in_review:          "In Review",
  loaded_for_payment: "Loaded",
  proof_attached:     "Proof Attached",
  complete:           "Complete",
  requires_info:      "Requires Info",
  blocked:            "Blocked",
};

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  return (
    <Badge variant="outline" className={`${statusBadgeClasses(status)} text-xs whitespace-nowrap`}>
      {label}
    </Badge>
  );
}

// ── Filter tabs ─────────────────────────────────────────────────────────────

type FilterKey = "all" | "open" | "loaded" | "complete" | "blocked";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "open",     label: "Open" },
  { key: "loaded",   label: "Loaded for Payment" },
  { key: "complete", label: "Complete" },
  { key: "blocked",  label: "Blocked / Info" },
];

const OPEN_STATUSES   = new Set(["new", "in_review"]);
const LOADED_STATUSES = new Set(["loaded_for_payment", "proof_attached"]);
const BLOCKED_STATUSES = new Set(["requires_info", "blocked"]);

function filterRequests(all: PaymentRequest[], key: FilterKey): PaymentRequest[] {
  switch (key) {
    case "open":     return all.filter(r => OPEN_STATUSES.has(r.status));
    case "loaded":   return all.filter(r => LOADED_STATUSES.has(r.status));
    case "complete": return all.filter(r => r.status === "complete");
    case "blocked":  return all.filter(r => BLOCKED_STATUSES.has(r.status));
    default:         return all;
  }
}

// ── Confirm "Load for Payment" dialog ──────────────────────────────────────

function LoadConfirmDialog({
  pr,
  open,
  onClose,
  onDone,
}: {
  pr: PaymentRequest;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();

  const loadMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payment-requests/${pr.id}/review`, { decision: "loaded_for_payment" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Loaded for payment" }); onClose(); onDone(); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Load for payment?</DialogTitle>
          <DialogDescription>
            Invoice <strong className="font-mono">{pr.invoice_number ?? "—"}</strong>
            {" from "}
            <strong>{pr.counterparty_name ?? "—"}</strong>
            {" — "}
            <strong>{fmtZAR(pr.amount)}</strong>
            {" ex-VAT — will be marked as loaded into the payment run. This will include it in the next batch."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => loadMut.mutate()} disabled={loadMut.isPending}>
            {loadMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Load for Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Request row ─────────────────────────────────────────────────────────────

function RequestRow({
  pr,
  onRefresh,
}: {
  pr: PaymentRequest;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [loadOpen, setLoadOpen] = useState(false);

  const statusMut = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await apiRequest("PATCH", `/api/payment-requests/${pr.id}/status`, { status: newStatus });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Status updated" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const reviewMut = useMutation({
    mutationFn: async (decision: string) => {
      const res = await apiRequest("POST", `/api/payment-requests/${pr.id}/review`, { decision });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Updated" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const anyPending = statusMut.isPending || reviewMut.isPending;
  const isOverdue  = pr.due_date && new Date(pr.due_date) < new Date() && pr.status !== "complete";

  return (
    <>
      <TableRow data-testid={`row-pr-${pr.id}`} className="align-top">
        {/* Invoice # */}
        <TableCell>
          <div className="font-medium font-mono text-sm">{pr.invoice_number ?? "—"}</div>
          {pr.po_ref ? (
            <div className="text-xs text-muted-foreground">PO: {pr.po_ref}</div>
          ) : (
            <Badge variant="outline" className="mt-0.5 bg-amber-50 text-amber-700 border-amber-200 text-[9px] px-1.5 py-0 gap-1">
              <FileWarning className="h-2.5 w-2.5" />No PO
            </Badge>
          )}
          {!pr.invoice_number && (
            <Badge variant="outline" className="mt-0.5 ml-1 bg-amber-50 text-amber-700 border-amber-200 text-[9px] px-1.5 py-0 gap-1">
              <FileWarning className="h-2.5 w-2.5" />No invoice
            </Badge>
          )}
        </TableCell>

        {/* Project / Supplier */}
        <TableCell>
          <div className="text-sm font-medium">{pr.project_name}</div>
          <div className="text-xs text-muted-foreground">{pr.counterparty_name ?? "—"}</div>
          {pr.submitted_by_name && (
            <div className="text-xs text-muted-foreground">By: {pr.submitted_by_name}</div>
          )}
        </TableCell>

        {/* Amount */}
        <TableCell className="text-right font-semibold font-mono tabular-nums">
          {fmtZAR(pr.amount)}
        </TableCell>

        {/* Due date */}
        <TableCell>
          {pr.due_date ? (
            <span className={`text-sm ${isOverdue ? "text-rose-600 font-medium" : "text-foreground"}`}>
              {isOverdue && <AlertTriangle className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />}
              {fmtDate(pr.due_date)}
            </span>
          ) : <span className="text-muted-foreground text-sm">—</span>}
          {pr.cutoff_date && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
              <Clock className="h-2.5 w-2.5" />
              Cutoff {fmtDate(pr.cutoff_date)}
            </div>
          )}
        </TableCell>

        {/* Status */}
        <TableCell>
          <StatusBadge status={pr.status} />
          {pr.proof_count > 0 && (
            <div className="text-[10px] text-muted-foreground mt-1">
              {pr.proof_count} proof{pr.proof_count !== 1 ? "s" : ""} attached
            </div>
          )}
        </TableCell>

        {/* Actions */}
        <TableCell>
          <div className="flex gap-1.5 flex-wrap">
            {pr.status === "new" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => statusMut.mutate("in_review")}
                disabled={anyPending}
                data-testid={`btn-start-review-${pr.id}`}
              >
                {anyPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Start Review"}
              </Button>
            )}
            {pr.status === "in_review" && (
              <>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setLoadOpen(true)}
                  disabled={anyPending}
                  data-testid={`btn-load-payment-${pr.id}`}
                >
                  Load for Payment
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => reviewMut.mutate("requires_info")}
                  disabled={anyPending}
                  data-testid={`btn-request-info-${pr.id}`}
                >
                  Request Info
                </Button>
              </>
            )}
            {(pr.status === "requires_info" || pr.status === "blocked") && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => statusMut.mutate("new")}
                disabled={anyPending}
                data-testid={`btn-resubmit-${pr.id}`}
              >
                Resubmit
              </Button>
            )}
            {pr.status === "loaded_for_payment" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => statusMut.mutate("proof_attached")}
                disabled={anyPending}
                title="Mark this payment as having proof of payment attached. Upload the proof document via the project Procurement tab; this button records that the proof exists."
                data-testid={`btn-attach-proof-${pr.id}`}
              >
                {anyPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3 mr-1" />}
                Attach proof
              </Button>
            )}
            {pr.status === "proof_attached" && (
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => statusMut.mutate("complete")}
                disabled={anyPending}
                data-testid={`btn-complete-${pr.id}`}
              >
                {anyPending
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Complete
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      <LoadConfirmDialog
        pr={pr}
        open={loadOpen}
        onClose={() => setLoadOpen(false)}
        onDone={onRefresh}
      />
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function PaymentRequestBoardPage() {
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<FilterKey>("open");

  const { data, isLoading, isError, error } = useQuery<{ requests: PaymentRequest[]; currentCutoff: string }>({
    queryKey: ["/api/payment-requests/board"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/payment-requests/board");
      if (!res.ok) throw new Error("Failed to fetch payment request board");
      return res.json();
    },
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/payment-requests/board"] });
  };

  if (isLoading) return <PageSkeleton lines={8} />;
  if (isError) return (
    <PageError
      title="Unable to load Payment Request Board"
      message={error instanceof Error ? error.message : "Something went wrong"}
      onRetry={handleRefresh}
    />
  );

  const requests = data?.requests ?? [];
  const cutoff   = data?.currentCutoff;

  const openCount    = requests.filter(r => OPEN_STATUSES.has(r.status)).length;
  const loadedCount  = requests.filter(r => LOADED_STATUSES.has(r.status)).length;
  const blockedCount = requests.filter(r => BLOCKED_STATUSES.has(r.status)).length;
  const doneCount    = requests.filter(r => r.status === "complete").length;

  const pendingTotal = requests
    .filter(r => !["complete", "blocked"].includes(r.status))
    .reduce((sum, r) => sum + Number(r.amount), 0);

  const displayed = filterRequests(requests, activeFilter);

  const subtitle = [
    `${requests.length} request${requests.length !== 1 ? "s" : ""}`,
    `${openCount} open`,
    `${loadedCount} loaded`,
    blockedCount > 0 ? `${blockedCount} need attention` : null,
  ].filter(Boolean).join(" · ");

  return (
    <PageLayout
      data-testid="page-payment-request-board"
      header={
        <PageHeader
          title="Payment Requests"
          subtitle={subtitle}
          actions={
            <div className="flex items-center gap-3 flex-wrap">
              {cutoff && (
                <Badge variant="outline" className="gap-1.5 text-xs">
                  <Clock className="h-3.5 w-3.5" />
                  Cutoff: {fmtDate(cutoff)}
                </Badge>
              )}
              <Badge variant="secondary" className="gap-1.5 text-xs font-mono">
                <CreditCard className="h-3.5 w-3.5" />
                Pending: {fmtZAR(pendingTotal)}
              </Badge>
            </div>
          }
        />
      }
    >
      {/* Filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {FILTERS.map((f) => {
          const count =
            f.key === "all"      ? requests.length :
            f.key === "open"     ? openCount :
            f.key === "loaded"   ? loadedCount :
            f.key === "complete" ? doneCount :
            f.key === "blocked"  ? blockedCount : 0;

          return (
            <Button
              key={f.key}
              size="sm"
              variant={activeFilter === f.key ? "default" : "outline"}
              onClick={() => setActiveFilter(f.key)}
              className="text-xs h-8"
            >
              {f.label}
              <Badge
                variant="secondary"
                className={`ml-1.5 text-[10px] h-4 px-1.5 ${activeFilter === f.key ? "bg-primary-foreground/20 text-primary-foreground" : ""}`}
              >
                {count}
              </Badge>
            </Button>
          );
        })}
      </div>

      {/* Table */}
      <Card>
        {displayed.length === 0 ? (
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No payment requests match this filter.
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Invoice #</TableHead>
                <TableHead>Project / Supplier</TableHead>
                <TableHead className="text-right w-36">Amount ex-VAT</TableHead>
                <TableHead className="w-36">Due Date</TableHead>
                <TableHead className="w-36">Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((pr) => (
                <RequestRow key={pr.id} pr={pr} onRefresh={handleRefresh} />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageLayout>
  );
}
