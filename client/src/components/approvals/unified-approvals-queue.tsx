import { useState } from "react";
import { useUnifiedApprovals, useApprovalAction } from "@/hooks/use-approvals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { CheckCircle, XCircle,   Clock, AlertTriangle } from "lucide-react";
import { PageSkeleton } from "@/components/ui/page-states";
import { PHASES } from "@shared/phases";

// Stage labels derive from the canonical lifecycle (shared/phases.ts).
// Deprecated codes are appended for historical row rendering only.
const STAGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(PHASES.map((p) => [p.code, p.label])),
  S04_PD_PM_HANDOVER: "PD-PM Handover",
  S05_FINANCIAL_REVIEW: "Financial Review",
};

const TYPE_LABELS: Record<string, string> = {
  gate: "Gate Approval",
  exception: "Exception",
  handover: "Handover",
  review: "Review Sign-off",
};

const TYPE_COLORS: Record<string, string> = {
  gate: "bg-blue-100 text-blue-800",
  exception: "bg-orange-100 text-orange-800",
  handover: "bg-green-100 text-green-800",
  review: "bg-violet-100 text-violet-800",
};

type ApprovalFilter = "all" | "gate" | "exception" | "handover";

export function UnifiedApprovalsQueue() {
  const [filter, setFilter] = useState<ApprovalFilter>("all");
  const { data, isLoading } = useUnifiedApprovals(filter === "all" ? undefined : filter);
  const actionMutation = useApprovalAction();
  const [, navigate] = useLocation();

  if (isLoading) return <PageSkeleton />;

  const approvals = data?.approvals ?? [];

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {(["all", "gate", "exception", "handover"] as ApprovalFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {f === "all" ? "All" : TYPE_LABELS[f] || f}
          </button>
        ))}
        <Badge variant="outline" className="ml-auto">{approvals.length} pending</Badge>
      </div>

      {approvals.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
          <p className="text-sm">No pending approvals. You're all caught up.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {approvals.map((a) => {
            const isOverdue = a.age_days > 3;
            return (
              <div
                key={`${a.approval_type}-${a.item_id}`}
                className={`border rounded-lg p-3 flex items-center gap-3 ${isOverdue ? "border-red-200 bg-red-50/30" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={`text-[10px] ${TYPE_COLORS[a.approval_type] || ""}`}>
                      {TYPE_LABELS[a.approval_type] || a.approval_type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {STAGE_LABELS[a.stage_code] || a.stage_code}
                    </span>
                    {isOverdue && (
                      <span className="text-[10px] text-red-600 font-medium flex items-center gap-0.5">
                        <AlertTriangle className="h-3 w-3" /> Overdue
                      </span>
                    )}
                  </div>
                  <p
                    className="text-sm font-medium truncate cursor-pointer hover:underline"
                    onClick={() => navigate(`/project/${encodeURIComponent(a.project_name)}`)}
                  >
                    {a.project_name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{a.summary}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {a.requested_by && <span>By: {a.requested_by}</span>}
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" /> {a.age_days}d ago
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost" size="sm" className="h-7 px-2 text-xs text-green-700"
                    onClick={() => actionMutation.mutate({ type: a.approval_type, id: a.item_id, action: "approve" })}
                    disabled={actionMutation.isPending}
                  >
                    <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="h-7 px-2 text-xs text-red-700"
                    onClick={() => actionMutation.mutate({ type: a.approval_type, id: a.item_id, action: "reject" })}
                    disabled={actionMutation.isPending}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
