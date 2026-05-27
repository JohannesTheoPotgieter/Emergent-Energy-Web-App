import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout";
import { PageHeader } from "@/components/ui/page-header";
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, Eye, Loader2, ChevronDown, ChevronUp, Download,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { formatZar as formatZarCanonical } from "@/lib/currency";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface POReviewer { id: number; reviewerUserId: number; reviewerRole: string; decision: string; decidedAt: string | null; reviewerName: string; notes?: string | null; }
interface PurchaseOrder { id: number; po_ref: string; project_name: string; project_id: number | null; supplier_name: string; total: string; status: string; created_at: string; submitted_at: string | null; project_manager: string | null; submitted_by_name: string | null; created_by: number | null; reviewers: POReviewer[] | null; line_items?: Array<{ description?: string; qty?: number | string; pricePerUnit?: number | string; unit?: string; partNumber?: string }>; comments?: string | null; pdf_data?: string | null; }
interface EligibleApprover { id: number; name: string; email: string; role: string; }

type FilterKey = "my-reviews" | "all-active" | "requires-info" | "approved" | "blocked-cancelled";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "my-reviews", label: "My Reviews" },
  { key: "all-active", label: "All Active" },
  { key: "requires-info", label: "Requires Info" },
  { key: "approved", label: "Approved" },
  { key: "blocked-cancelled", label: "Blocked / Cancelled" },
];
const ACTIVE_STATUSES = new Set(["submitted", "in_review", "requires_info"]);
const DELEGATE_ADMIN_ROLES = new Set(["COO_ADMIN", "CFO", "CEO_ADMIN"]);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = (v?: string | null) => !v ? "—" : `${new Date(v).getUTCDate()} ${MONTHS[new Date(v).getUTCMonth()]} ${new Date(v).getUTCFullYear()}`;
// TF-16 (audit V3) — migrated to canonical formatZar.
const fmtZAR = (v?: string | number | null) => formatZarCanonical(v, { cents: true });
const ageDays = (createdAt: string) => Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000));

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { draft: "bg-slate-100", submitted: "bg-sky-100", in_review: "bg-amber-100", requires_info: "bg-orange-100", blocked: "bg-rose-100", approved: "bg-emerald-100", cancelled: "bg-slate-100" };
  return <Badge variant="outline" className={`${map[status] || "bg-slate-100"} text-xs`}>{status.replace("_", " ")}</Badge>;
}

function ReviewerHistory({ reviewers }: { reviewers: POReviewer[] | null }) {
  if (!reviewers?.length) return <p className="text-xs text-muted-foreground">No reviewer history yet.</p>;
  return <div className="space-y-1">{reviewers.map((r) => <div key={r.id} className="text-xs"><span className="font-medium">{r.reviewerName || r.reviewerRole}</span>: {r.decision}{r.decidedAt ? ` · ${fmtDate(r.decidedAt)}` : ""}{r.notes ? ` · ${r.notes}` : ""}</div>)}</div>;
}

function RowActions({ po, onRefresh, eligibleApprovers, canDelegate }: { po: PurchaseOrder; onRefresh: () => void; eligibleApprovers: EligibleApprover[]; canDelegate: boolean; }) {
  const { toast } = useToast();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [toUserId, setToUserId] = useState("");

  const actMut = useMutation({
    mutationFn: async (decision: string) => {
      const res = await apiRequest("POST", `/api/po/${po.id}/review`, { decision, notes });
      if (!res.ok) throw new Error((await res.json()).error || "Action failed");
      return res.json();
    },
    onSuccess: () => { toast({ title: "Decision submitted" }); setReviewOpen(false); setNotes(""); onRefresh(); },
    onError: (e: Error) => toast({ title: "Decision failed", description: e.message, variant: "destructive" }),
  });

  const delegateMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/po/${po.id}/delegate`, { toUserId: Number(toUserId), reason: notes || null });
      if (!res.ok) throw new Error((await res.json()).error || "Delegation failed");
      return res.json();
    },
    onSuccess: () => { toast({ title: "Delegated" }); setDelegateOpen(false); setToUserId(""); onRefresh(); },
    onError: (e: Error) => toast({ title: "Delegation failed", description: e.message, variant: "destructive" }),
  });

  return <>
    <div className="flex gap-1.5 flex-wrap">
      {(po.status === "submitted" || po.status === "in_review") && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewOpen(true)}><Eye className="h-3 w-3 mr-1" />Review</Button>}
      {canDelegate && (po.status === "submitted" || po.status === "in_review") && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDelegateOpen(true)}>Delegate</Button>}
    </div>

    <Dialog open={reviewOpen} onOpenChange={setReviewOpen}><DialogContent><DialogHeader><DialogTitle>Review {po.po_ref}</DialogTitle><DialogDescription>{po.project_name} · {fmtZAR(po.total)}</DialogDescription></DialogHeader><Textarea placeholder="Decision notes (required for Reject / Request Info)" value={notes} onChange={(e) => setNotes(e.target.value)} /><DialogFooter className="gap-2 flex-wrap"><Button variant="outline" onClick={() => actMut.mutate("requires_info")} disabled={actMut.isPending}>Request Info</Button><Button variant="destructive" onClick={() => actMut.mutate("blocked")} disabled={actMut.isPending} title="Sets status to Blocked — equivalent to Reject; the PO is no longer in the active review queue.">Reject</Button><Button onClick={() => actMut.mutate("approved")} disabled={actMut.isPending}>{actMut.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Approve</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={delegateOpen} onOpenChange={setDelegateOpen}><DialogContent><DialogHeader><DialogTitle>Delegate {po.po_ref}</DialogTitle><DialogDescription>Delegate to an eligible approver per backend rules.</DialogDescription></DialogHeader><Select value={toUserId} onValueChange={setToUserId}><SelectTrigger><SelectValue placeholder="Select approver" /></SelectTrigger><SelectContent>{eligibleApprovers.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.role})</SelectItem>)}</SelectContent></Select><DialogFooter><Button onClick={() => delegateMut.mutate()} disabled={!toUserId || delegateMut.isPending}>Confirm Delegate</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

export default function POApprovalBoardPage() {
  const { user } = useAuth();
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all-active");
  const [expanded, setExpanded] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: allPos = [], isLoading, isError, error } = useQuery<PurchaseOrder[]>({ queryKey: ["/api/po/board/all"], queryFn: async () => { const res = await apiRequest("GET", "/api/po/board/all"); if (!res.ok) throw new Error("Failed to fetch PO board"); return res.json(); } });
  const { data: myReviews = [] } = useQuery<PurchaseOrder[]>({ queryKey: ["/api/po/board/my-reviews"], queryFn: async () => { const res = await apiRequest("GET", "/api/po/board/my-reviews"); if (!res.ok) throw new Error("Failed to fetch my reviews"); return res.json(); } });
  const { data: eligibleApprovers = [] } = useQuery<EligibleApprover[]>({ queryKey: ["/api/po/eligible-approvers"], queryFn: async () => { const res = await apiRequest("GET", "/api/po/eligible-approvers"); if (!res.ok) throw new Error("Failed to fetch eligible approvers"); const data = await res.json(); return Array.isArray(data?.approvers) ? data.approvers : []; } });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/po/board/all"] });
    queryClient.invalidateQueries({ queryKey: ["/api/po/board/my-reviews"] });
  };

  const displayPos = useMemo(() => {
    switch (activeFilter) {
      case "my-reviews": return myReviews;
      case "all-active": return allPos.filter((p) => ACTIVE_STATUSES.has(p.status));
      case "requires-info": return allPos.filter((p) => p.status === "requires_info");
      case "approved": return allPos.filter((p) => p.status === "approved");
      case "blocked-cancelled": return allPos.filter((p) => p.status === "blocked" || p.status === "cancelled");
    }
  }, [activeFilter, allPos, myReviews]);

  if (isLoading) return <PageSkeleton lines={8} />;
  if (isError) return <PageError title="Unable to load PO Board" message={error instanceof Error ? error.message : "Something went wrong"} onRetry={handleRefresh} />;

  return <PageLayout header={<PageHeader title="PO Approval Board" subtitle={`${allPos.length} purchase orders`} />}>
    <div className="flex items-center gap-1 flex-wrap">{FILTERS.map((f) => <Button key={f.key} size="sm" variant={activeFilter === f.key ? "default" : "outline"} onClick={() => setActiveFilter(f.key)} className="text-xs h-8">{f.label}</Button>)}</div>
    <Card>
      {displayPos.length === 0 ? <CardContent className="p-8 text-center text-sm text-muted-foreground">No purchase orders match this filter.</CardContent> :
      <Table><TableHeader><TableRow><TableHead>PO reference</TableHead><TableHead>Project</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Requested by</TableHead><TableHead>Assigned approver</TableHead><TableHead>Status</TableHead><TableHead>Age</TableHead><TableHead>Reviewer decision history</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>
        {displayPos.map((po) => {
          const assigned = po.reviewers?.find((r) => r.decision === "pending") || po.reviewers?.[po.reviewers.length - 1];
          const canDelegate = !!user && (!!assigned && assigned.reviewerUserId === user.id || DELEGATE_ADMIN_ROLES.has(String(user.role ?? "")));
          return <>
            <TableRow key={po.id} className="align-top"><TableCell className="font-medium font-mono text-sm">{po.po_ref}</TableCell><TableCell>{po.project_name}</TableCell><TableCell>{po.supplier_name}</TableCell><TableCell className="text-right font-semibold font-mono tabular-nums">{fmtZAR(po.total)}</TableCell><TableCell>{po.submitted_by_name || "—"}</TableCell><TableCell>{assigned?.reviewerName || assigned?.reviewerRole || "—"}</TableCell><TableCell><StatusBadge status={po.status} /></TableCell><TableCell>{ageDays(po.created_at)}d</TableCell><TableCell><ReviewerHistory reviewers={po.reviewers} /></TableCell><TableCell><div className="flex gap-1"><RowActions po={po} onRefresh={handleRefresh} eligibleApprovers={eligibleApprovers} canDelegate={canDelegate} /><Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === po.id ? null : po.id)}>{expanded === po.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button></div></TableCell></TableRow>
            {expanded === po.id && <TableRow><TableCell colSpan={10}><div className="grid gap-2 text-sm"><p><span className="font-medium">Notes:</span> {po.comments || "—"}</p><div><p className="font-medium">Line items</p>{po.line_items?.length ? <ul className="list-disc pl-5">{po.line_items.map((li, i) => <li key={i}>{li.description || "Item"}{li.partNumber ? ` · ${li.partNumber}` : ""} · {li.qty || 0}{li.unit ? ` ${li.unit}` : ""} × {fmtZAR(li.pricePerUnit || 0)}</li>)}</ul> : <p className="text-muted-foreground">No line items recorded on this PO.</p>}</div><div className="flex gap-2 flex-wrap"><Button size="sm" variant="outline" onClick={() => window.open(`/api/po/${encodeURIComponent(po.project_name)}/${po.id}/pdf`, "_blank")}> <Download className="h-3 w-3 mr-1" /> PDF download </Button>{po.project_id ? <Button size="sm" variant="outline" onClick={() => window.location.href = `/project/id/${po.project_id}?dept=procurement`}>Budget / procurement link</Button> : <span className="text-xs text-muted-foreground">Budget/procurement link unavailable.</span>}</div></div></TableCell></TableRow>}
          </>;
        })}
      </TableBody></Table>}
    </Card>
  </PageLayout>;
}
