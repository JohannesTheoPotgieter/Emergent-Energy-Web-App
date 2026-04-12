import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { CreditCard, Clock, AlertTriangle, CheckCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

const STATUS_COLUMNS = ["new", "in_review", "loaded_for_payment", "proof_attached", "complete", "requires_info", "blocked"];

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  in_review: "In Review",
  loaded_for_payment: "Loaded for Payment",
  proof_attached: "Proof of Payment",
  complete: "Complete",
  requires_info: "Requires Info",
  blocked: "Blocked",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  in_review: "bg-yellow-100 text-yellow-700",
  loaded_for_payment: "bg-indigo-100 text-indigo-700",
  proof_attached: "bg-purple-100 text-purple-700",
  complete: "bg-green-100 text-green-700",
  requires_info: "bg-orange-100 text-orange-700",
  blocked: "bg-red-100 text-red-700",
};

function formatCurrency(val: string | number): string {
  return `R ${Number(val).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PaymentRequestCard({ pr, onRefresh }: { pr: PaymentRequest; onRefresh: () => void }) {
  const { toast } = useToast();

  const statusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await apiRequest("PATCH", `/api/payment-requests/${pr.id}/status`, { status: newStatus });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Status updated" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async (decision: string) => {
      const res = await apiRequest("POST", `/api/payment-requests/${pr.id}/review`, { decision });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Review recorded" }); onRefresh(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="mb-2 shadow-sm">
      <CardContent className="p-3">
        <div className="flex justify-between items-start">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{pr.project_name}</p>
            <p className="text-xs text-muted-foreground truncate">{pr.counterparty_name || "—"}</p>
            {pr.po_ref && <p className="text-xs text-muted-foreground">PO: {pr.po_ref}</p>}
            {pr.invoice_number && <p className="text-xs text-muted-foreground">INV: {pr.invoice_number}</p>}
          </div>
          <p className="font-semibold text-sm whitespace-nowrap ml-2">{formatCurrency(pr.amount)}</p>
        </div>
        {pr.due_date && (
          <p className="text-xs text-muted-foreground mt-1">
            Due: {new Date(pr.due_date).toLocaleDateString("en-ZA")}
          </p>
        )}
        {pr.cutoff_date && (
          <Badge variant="outline" className="text-xs mt-1">
            <Clock className="h-3 w-3 mr-1" />
            Cutoff: {new Date(pr.cutoff_date).toLocaleDateString("en-ZA")}
          </Badge>
        )}
        <div className="flex gap-1 mt-2 flex-wrap">
          {pr.status === "new" && (
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => statusMutation.mutate("in_review")} disabled={statusMutation.isPending}>
              Start Review
            </Button>
          )}
          {pr.status === "in_review" && (
            <>
              <Button size="sm" className="text-xs h-7" onClick={() => reviewMutation.mutate("loaded_for_payment")} disabled={reviewMutation.isPending}>
                Load for Payment
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => reviewMutation.mutate("requires_info")} disabled={reviewMutation.isPending}>
                Request Info
              </Button>
            </>
          )}
          {pr.status === "requires_info" && (
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => statusMutation.mutate("new")} disabled={statusMutation.isPending}>
              Resubmit
            </Button>
          )}
          {pr.status === "blocked" && (
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => statusMutation.mutate("new")} disabled={statusMutation.isPending}>
              Resubmit
            </Button>
          )}
          {pr.status === "proof_attached" && (
            <Button size="sm" className="text-xs h-7" onClick={() => statusMutation.mutate("complete")} disabled={statusMutation.isPending}>
              <CheckCircle className="h-3 w-3 mr-1" /> Complete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PaymentRequestBoardPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

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

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell className="p-4"><PageError title="Unable to load Payment Request Board" message={error instanceof Error ? error.message : "Failed"} onRetry={handleRefresh} /></PageShell>;

  const requests = data?.requests || [];
  const cutoff = data?.currentCutoff;
  const grouped = STATUS_COLUMNS.reduce<Record<string, PaymentRequest[]>>((acc, status) => {
    acc[status] = requests.filter(r => r.status === status);
    return acc;
  }, {});

  const totalPending = requests.filter(r => !["complete", "blocked"].includes(r.status)).reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-payment-request-board">
      <SectionHeader
        icon={<CreditCard className="h-5 w-5" />}
        eyebrow="Finance"
        title="Payment Requests"
        description="Track supplier payment request lifecycle"
      />

      <div className="flex items-center gap-4 mb-4 flex-wrap">
        {cutoff && (
          <Badge variant="outline" className="text-sm">
            <Clock className="h-4 w-4 mr-1" />
            Tuesday cutoff: {new Date(cutoff).toLocaleDateString("en-ZA")}
          </Badge>
        )}
        <Badge variant="secondary" className="text-sm">
          Pending total: {formatCurrency(totalPending)}
        </Badge>
        <span className="text-sm text-muted-foreground">{requests.length} request(s)</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 overflow-x-auto">
        {STATUS_COLUMNS.map((status) => (
          <div key={status} className="min-w-[200px]">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Badge>
              <span className="text-xs text-muted-foreground">({grouped[status]?.length || 0})</span>
            </div>
            <div className="space-y-0">
              {grouped[status]?.map((pr) => (
                <PaymentRequestCard key={pr.id} pr={pr} onRefresh={handleRefresh} />
              ))}
              {(!grouped[status] || grouped[status].length === 0) && (
                <p className="text-xs text-muted-foreground py-4 text-center">None</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
