import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { FileText, CheckCircle, XCircle, Clock, AlertTriangle, Eye, Download } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

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

const STATUS_COLUMNS = ["draft", "submitted", "in_review", "requires_info", "blocked", "approved", "cancelled"];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In Review",
  requires_info: "Requires Info",
  blocked: "Blocked",
  approved: "Approved",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-700",
  in_review: "bg-yellow-100 text-yellow-700",
  requires_info: "bg-orange-100 text-orange-700",
  blocked: "bg-red-100 text-red-700",
  approved: "bg-green-100 text-green-700",
  cancelled: "bg-gray-200 text-gray-500",
};

function formatCurrency(val: string | number): string {
  return `R ${Number(val).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ReviewerBadges({ reviewers }: { reviewers: POReviewer[] | null }) {
  if (!reviewers?.length) return null;
  return (
    <div className="flex gap-1 mt-1 flex-wrap">
      {reviewers.map((r) => (
        <Badge key={r.id} variant="outline" className={
          r.decision === "approved" ? "border-green-400 text-green-700 text-xs" :
          r.decision === "blocked" ? "border-red-400 text-red-700 text-xs" :
          r.decision === "requires_info" ? "border-orange-400 text-orange-700 text-xs" :
          "border-gray-300 text-gray-500 text-xs"
        }>
          {r.decision === "approved" ? <CheckCircle className="h-3 w-3 mr-1" /> :
           r.decision === "blocked" ? <XCircle className="h-3 w-3 mr-1" /> :
           r.decision === "requires_info" ? <AlertTriangle className="h-3 w-3 mr-1" /> :
           <Clock className="h-3 w-3 mr-1" />}
          {r.reviewerName || r.reviewerRole}
        </Badge>
      ))}
    </div>
  );
}

function POCard({ po, onRefresh }: { po: PurchaseOrder; onRefresh: () => void }) {
  const { toast } = useToast();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/po/${po.id}/submit`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "PO submitted for approval" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async (decision: string) => {
      const res = await apiRequest("POST", `/api/po/${po.id}/review`, { decision, notes: reviewNotes });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `PO ${data.decision}` });
      setReviewOpen(false);
      setReviewNotes("");
      onRefresh();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="mb-2 shadow-sm">
      <CardContent className="p-3">
        <div className="flex justify-between items-start">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{po.po_ref}</p>
            <p className="text-xs text-muted-foreground truncate">{po.project_name}</p>
            <p className="text-xs text-muted-foreground truncate">{po.counterparty_name || po.supplier_name}</p>
          </div>
          <p className="font-semibold text-sm whitespace-nowrap ml-2">{formatCurrency(po.total)}</p>
        </div>
        <ReviewerBadges reviewers={po.reviewers} />
        <div className="flex gap-1 mt-2">
          {po.status === "draft" && (
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
              Submit
            </Button>
          )}
          {(po.status === "submitted" || po.status === "in_review") && (
            <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="text-xs h-7">
                  <Eye className="h-3 w-3 mr-1" /> Review
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Review PO {po.po_ref}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <p className="text-sm">Supplier: {po.supplier_name}</p>
                  <p className="text-sm font-semibold">Total: {formatCurrency(po.total)}</p>
                  <Textarea placeholder="Notes (optional)" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => reviewMutation.mutate("requires_info")} disabled={reviewMutation.isPending}>
                    Request Info
                  </Button>
                  <Button variant="destructive" onClick={() => reviewMutation.mutate("blocked")} disabled={reviewMutation.isPending}>
                    Block
                  </Button>
                  <Button onClick={() => reviewMutation.mutate("approved")} disabled={reviewMutation.isPending}>
                    Approve
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function POApprovalBoardPage() {
  const [filter, setFilter] = useState<"all" | "my-reviews">("all");
  const queryClient = useQueryClient();

  const { data: allPos = [], isLoading, isError, error } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/po/board/all"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/po/board/all");
      if (!res.ok) throw new Error("Failed to fetch PO board");
      return res.json();
    },
  });

  const { data: myReviews = [] } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/po/board/my-reviews"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/po/board/my-reviews");
      if (!res.ok) throw new Error("Failed to fetch my reviews");
      return res.json();
    },
    enabled: filter === "my-reviews",
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/po/board/all"] });
    queryClient.invalidateQueries({ queryKey: ["/api/po/board/my-reviews"] });
  };

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell className="p-4"><PageError title="Unable to load PO Board" message={error instanceof Error ? error.message : "Failed"} onRetry={handleRefresh} /></PageShell>;

  const pos = filter === "my-reviews" ? myReviews : allPos;
  const grouped = STATUS_COLUMNS.reduce<Record<string, PurchaseOrder[]>>((acc, status) => {
    acc[status] = pos.filter(p => p.status === status);
    return acc;
  }, {});

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-po-approval-board">
      <SectionHeader
        icon={<FileText className="h-5 w-5" />}
        eyebrow="Finance"
        title="PO Approval Board"
        subtitle="Track and review purchase order approvals"
      />

      <div className="flex gap-2 mb-4">
        <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>
          All POs ({allPos.length})
        </Button>
        <Button variant={filter === "my-reviews" ? "default" : "outline"} size="sm" onClick={() => setFilter("my-reviews")}>
          My Reviews
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 overflow-x-auto">
        {STATUS_COLUMNS.map((status) => (
          <div key={status} className="min-w-[200px]">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Badge>
              <span className="text-xs text-muted-foreground">({grouped[status]?.length || 0})</span>
            </div>
            <div className="space-y-0">
              {grouped[status]?.map((po) => (
                <POCard key={po.id} po={po} onRefresh={handleRefresh} />
              ))}
              {(!grouped[status] || grouped[status].length === 0) && (
                <p className="text-xs text-muted-foreground py-4 text-center">No POs</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
