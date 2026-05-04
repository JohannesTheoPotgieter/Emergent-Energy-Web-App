import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout";
import { PageHeader } from "@/components/ui/page-header";
import {
  FileText, CheckCircle2, XCircle, Clock, AlertTriangle, Eye, Loader2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface POReviewer {
  id: number;
  reviewerUserId: number;
  reviewerRole: string;
  decision: string;
  decidedAt: string | null;
  reviewerName: string;
}

interface PurchaseOrder {
  id: number;
  po_ref: string;
  po_number: number;
  project_name: string;
  project_id: number | null;
  supplier_name: string;
  total: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  counterparty_name: string | null;
  project_manager: string | null;
  submitted_by_name: string | null;
  reviewers: POReviewer[] | null;
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
  draft:         { label: "Draft",          cls: "bg-slate-100 text-slate-600 border-slate-200" },
  submitted:     { label: "Submitted",      cls: "bg-sky-100 text-sky-700 border-sky-200" },
  in_review:     { label: "In Review",      cls: "bg-amber-100 text-amber-700 border-amber-200" },
  requires_info: { label: "Requires Info",  cls: "bg-orange-100 text-orange-700 border-orange-200" },
  blocked:       { label: "Blocked",        cls: "bg-rose-100 text-rose-700 border-rose-200" },
  approved:      { label: "Approved",       cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  cancelled:     { label: "Cancelled",      cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: "bg-slate-100 text-slate-700 border-slate-200" };
  return <Badge variant="outline" className={`${cfg.cls} text-xs whitespace-nowrap`}>{cfg.label}</Badge>;
}

// ── Reviewer decision badges ────────────────────────────────────────────────

function ReviewerBadges({ reviewers }: { reviewers: POReviewer[] | null }) {
  if (!reviewers?.length) return null;
  return (
    <div className="flex gap-1 flex-wrap">
      {reviewers.map((r) => (
        <Badge
          key={r.id}
          variant="outline"
          className={`text-[10px] gap-1 ${
            r.decision === "approved"      ? "border-emerald-300 text-emerald-700 bg-emerald-50" :
            r.decision === "blocked"       ? "border-rose-300 text-rose-700 bg-rose-50" :
            r.decision === "requires_info" ? "border-orange-300 text-orange-700 bg-orange-50" :
                                             "border-slate-200 text-slate-500"
          }`}
        >
          {r.decision === "approved"      ? <CheckCircle2 className="h-2.5 w-2.5" /> :
           r.decision === "blocked"       ? <XCircle className="h-2.5 w-2.5" /> :
           r.decision === "requires_info" ? <AlertTriangle className="h-2.5 w-2.5" /> :
                                            <Clock className="h-2.5 w-2.5" />}
          {r.reviewerName || r.reviewerRole}
        </Badge>
      ))}
    </div>
  );
}

// ── Filter tabs ─────────────────────────────────────────────────────────────

type FilterKey = "all" | "active" | "my-reviews" | "approved" | "archived";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",        label: "All" },
  { key: "active",     label: "Active" },
  { key: "my-reviews", label: "My Reviews" },
  { key: "approved",   label: "Approved" },
  { key: "archived",   label: "Archived" },
];

const ACTIVE_STATUSES = new Set(["draft", "submitted", "in_review", "requires_info", "blocked"]);

// ── Review dialog ───────────────────────────────────────────────────────────

function ReviewDialog({
  po,
  open,
  onClose,
  onDone,
}: {
  po: PurchaseOrder;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");

  const reviewMut = useMutation({
    mutationFn: async (decision: string) => {
      const res = await apiRequest("POST", `/api/po/${po.id}/review`, { decision, notes });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `PO ${data.decision}` });
      setNotes("");
      onClose();
      onDone();
    },
    onError: (e: Error) => toast({ title: "Review failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review {po.po_ref}</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{po.counterparty_name || po.supplier_name}</span>
            {" — "}
            <span className="font-semibold font-mono">{fmtZAR(po.total)}</span>
            {" ex-VAT · "}
            {po.project_name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <Textarea
            placeholder="Notes (optional — required when requesting info or blocking)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
          {po.reviewers && po.reviewers.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">Reviewer decisions so far</p>
              <ReviewerBadges reviewers={po.reviewers} />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => reviewMut.mutate("requires_info")}
            disabled={reviewMut.isPending}
            className="text-orange-700 border-orange-300 hover:bg-orange-50"
          >
            Request Info
          </Button>
          <Button
            variant="outline"
            onClick={() => reviewMut.mutate("blocked")}
            disabled={reviewMut.isPending}
            className="text-rose-700 border-rose-300 hover:bg-rose-50"
          >
            Block
          </Button>
          <Button onClick={() => reviewMut.mutate("approved")} disabled={reviewMut.isPending}>
            {reviewMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── PO row ──────────────────────────────────────────────────────────────────

function PORow({
  po,
  onRefresh,
}: {
  po: PurchaseOrder;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [reviewOpen, setReviewOpen] = useState(false);

  const submitMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/po/${po.id}/submit`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "PO submitted for review" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <TableRow data-testid={`row-po-${po.id}`} className="align-top">
        <TableCell className="font-medium font-mono text-sm">{po.po_ref}</TableCell>
        <TableCell>
          <div className="text-sm font-medium">{po.project_name}</div>
          {po.project_manager && (
            <div className="text-xs text-muted-foreground">PM: {po.project_manager}</div>
          )}
        </TableCell>
        <TableCell>
          <div className="text-sm">{po.counterparty_name || po.supplier_name}</div>
          {po.submitted_by_name && (
            <div className="text-xs text-muted-foreground">Submitted by: {po.submitted_by_name}</div>
          )}
        </TableCell>
        <TableCell className="text-right font-semibold font-mono tabular-nums">
          {fmtZAR(po.total)}
        </TableCell>
        <TableCell>
          <StatusBadge status={po.status} />
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {fmtDate(po.submitted_at || po.created_at)}
        </TableCell>
        <TableCell>
          <div className="space-y-1.5">
            <ReviewerBadges reviewers={po.reviewers} />
            <div className="flex gap-1.5">
              {po.status === "draft" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => submitMut.mutate()}
                  disabled={submitMut.isPending}
                  data-testid={`btn-submit-po-${po.id}`}
                >
                  {submitMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Submit"}
                </Button>
              )}
              {(po.status === "submitted" || po.status === "in_review") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setReviewOpen(true)}
                  data-testid={`btn-review-po-${po.id}`}
                >
                  <Eye className="h-3 w-3 mr-1" /> Review
                </Button>
              )}
            </div>
          </div>
        </TableCell>
      </TableRow>

      <ReviewDialog
        po={po}
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onDone={onRefresh}
      />
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function POApprovalBoardPage() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("active");
  const queryClient = useQueryClient();

  const { data: allPos = [], isLoading, isError, error } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/po/board/all"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/po/board/all");
      if (!res.ok) throw new Error("Failed to fetch PO board");
      return res.json();
    },
  });

  const { data: myReviews = [], isLoading: myLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/po/board/my-reviews"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/po/board/my-reviews");
      if (!res.ok) throw new Error("Failed to fetch my reviews");
      return res.json();
    },
    enabled: activeFilter === "my-reviews",
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/po/board/all"] });
    queryClient.invalidateQueries({ queryKey: ["/api/po/board/my-reviews"] });
  };

  if (isLoading) return <PageSkeleton lines={8} />;
  if (isError) return (
    <PageError
      title="Unable to load PO Board"
      message={error instanceof Error ? error.message : "Something went wrong"}
      onRetry={handleRefresh}
    />
  );

  function filterPos(key: FilterKey): PurchaseOrder[] {
    switch (key) {
      case "active":     return allPos.filter(p => ACTIVE_STATUSES.has(p.status));
      case "my-reviews": return myReviews;
      case "approved":   return allPos.filter(p => p.status === "approved");
      case "archived":   return allPos.filter(p => p.status === "cancelled");
      default:           return allPos;
    }
  }

  const displayPos = filterPos(activeFilter);
  const activeCount   = allPos.filter(p => ACTIVE_STATUSES.has(p.status)).length;
  const approvedCount = allPos.filter(p => p.status === "approved").length;

  const subtitle = `${allPos.length} purchase order${allPos.length !== 1 ? "s" : ""} · ${activeCount} active · ${approvedCount} approved`;

  return (
    <PageLayout
      data-testid="page-po-approval-board"
      header={
        <PageHeader
          title="PO Approval Board"
          subtitle={subtitle}
        />
      }
    >
      {/* Filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {FILTERS.map((f) => {
          const count =
            f.key === "all"        ? allPos.length :
            f.key === "active"     ? activeCount :
            f.key === "my-reviews" ? myReviews.length :
            f.key === "approved"   ? approvedCount :
            f.key === "archived"   ? allPos.filter(p => p.status === "cancelled").length : 0;

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
                {f.key === "my-reviews" && myLoading ? "…" : count}
              </Badge>
            </Button>
          );
        })}
      </div>

      {/* Table */}
      <Card>
        {displayPos.length === 0 ? (
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No purchase orders match this filter.
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">PO Ref</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right w-36">Total ex-VAT</TableHead>
                <TableHead className="w-36">Status</TableHead>
                <TableHead className="w-32">Date</TableHead>
                <TableHead>Reviewers / Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayPos.map((po) => (
                <PORow key={po.id} po={po} onRefresh={handleRefresh} />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageLayout>
  );
}
