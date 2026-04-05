/**
 * Approvals Board V2 — Wave 4
 *
 * Unified approvals view using promoted schema.
 * Shows pending/decided approvals with approve/reject actions.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, CheckCircle, X, Clock, AlertCircle, AlertTriangle,
} from "lucide-react";

interface ApprovalInstance {
  id: number;
  status: string;
  title: string;
  entity_type: string;
  entity_id: number | null;
  project_instance_id: number | null;
  urgency: string | null;
  requested_at: string | null;
  decided_at: string | null;
  due_date: string | null;
  decision_note: string | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
  approval_type: string | null;
}

const STATUS_STYLES: Record<string, { color: string; icon: typeof CheckCircle }> = {
  pending: { color: "bg-amber-100 text-amber-700", icon: Clock },
  approved: { color: "bg-emerald-100 text-emerald-700", icon: CheckCircle },
  rejected: { color: "bg-red-100 text-red-700", icon: X },
  expired: { color: "bg-muted text-muted-foreground", icon: AlertCircle },
  cancelled: { color: "bg-muted text-muted-foreground", icon: X },
};

export default function ApprovalsBoardV2Page() {
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryParams = new URLSearchParams();
  if (statusFilter !== "all") queryParams.set("status", statusFilter);

  const { data: approvals, isLoading } = useQuery<ApprovalInstance[]>({
    queryKey: ["approvals-v2", queryParams.toString()],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/approvals-v2?${queryParams}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const decideMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/approvals-v2/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals-v2"] });
      queryClient.invalidateQueries({ queryKey: ["home-summary"] });
      toast({ title: "Approval updated" });
    },
    onError: () => {
      toast({ title: "Action failed", variant: "destructive" });
    },
  });

  const pendingCount = approvals?.filter((a) => a.status === "pending").length ?? 0;

  return (
    <PageShell className="p-3 md:p-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Approvals Board
              {pendingCount > 0 && (
                <Badge variant="destructive" className="text-xs">{pendingCount} pending</Badge>
              )}
            </CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          )}

          {approvals && approvals.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No approvals matching your filter.
            </div>
          )}

          {approvals && approvals.length > 0 && (
            <div className="space-y-2">
              {approvals.map((a) => {
                const style = STATUS_STYLES[a.status] || STATUS_STYLES.pending;
                const Icon = style.icon;
                const isOverdue = a.due_date && new Date(a.due_date) < new Date() && a.status === "pending";

                return (
                  <div key={a.id} className={cn(
                    "flex items-center gap-3 rounded-md border px-4 py-3",
                    isOverdue && "border-red-200 bg-red-50/50"
                  )}>
                    <Icon className={cn("h-5 w-5 shrink-0", a.status === "pending" ? (isOverdue ? "text-red-600" : "text-amber-600") : style.color.split(" ")[1])} />

                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{a.title}</div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        {a.approval_type && <Badge variant="secondary" className="text-xs">{a.approval_type}</Badge>}
                        {a.requested_by_name && <span>From: {a.requested_by_name}</span>}
                        {a.due_date && <span>Due: {new Date(a.due_date).toLocaleDateString()}</span>}
                        {isOverdue && <Badge variant="destructive" className="text-xs">Overdue</Badge>}
                      </div>
                      {a.decided_by_name && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Decided by {a.decided_by_name}{a.decision_note ? `: ${a.decision_note}` : ""}
                        </div>
                      )}
                    </div>

                    <Badge className={cn("text-xs shrink-0", style.color)}>{a.status}</Badge>

                    {a.status === "pending" && (
                      <div className="flex gap-1.5 shrink-0">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => decideMutation.mutate({ id: a.id, status: "approved" })}>
                          <CheckCircle className="h-3.5 w-3.5 mr-0.5 text-emerald-600" />
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => decideMutation.mutate({ id: a.id, status: "rejected" })}>
                          <X className="h-3.5 w-3.5 mr-0.5 text-red-600" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
