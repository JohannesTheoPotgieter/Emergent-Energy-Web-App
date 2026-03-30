import { useMemo, useState } from "react";
import { useGatesExceptions, useGatesExceptionCounts } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Search, AlertTriangle, Clock, CheckCircle, XCircle, RotateCcw, ArrowUpRight,
  MessageSquare, Shield,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

const STAGE_LABELS: Record<string, string> = {
  S01_FIRST_ASSESSMENT: "First Assessment",
  S02_DESIGN_COST_PROPOSAL: "Design & Cost Proposal",
  S03_SIGNATURE_FINANCIAL_CLOSE: "Financial Close",
  S04_PD_PM_HANDOVER: "PD-PM Handover",
  S05_FINANCIAL_REVIEW: "Financial Review",
  S06_CONSTRUCTION: "Construction",
  S07_COMMISSIONING: "Commissioning",
  S08_OM_HANDOVER: "O&M Handover",
  S09_CLIENT_HANDOVER: "Client Handover",
  S10_POST_HANDOVER_REVIEW: "Post-Handover",
};

function riskBadge(level: string) {
  switch (level) {
    case "CRITICAL": return "bg-red-100 text-red-800";
    case "HIGH": return "bg-orange-100 text-orange-800";
    case "MEDIUM": return "bg-amber-100 text-amber-800";
    case "LOW": return "bg-green-100 text-green-800";
    default: return "bg-gray-100 text-gray-600";
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "REQUESTED": return "bg-blue-100 text-blue-800";
    case "APPROVED": return "bg-green-100 text-green-800";
    case "APPROVED_WITH_CONDITIONS": return "bg-amber-100 text-amber-800";
    case "REJECTED": return "bg-red-100 text-red-800";
    case "CLOSED": return "bg-gray-100 text-gray-600";
    case "RE_OPENED": return "bg-violet-100 text-violet-800";
    default: return "bg-gray-100 text-gray-600";
  }
}

type ViewTab = "all" | "pending_my_approval" | "overdue";

const VIEW_TABS: { key: ViewTab; label: string }[] = [
  { key: "all", label: "All Exceptions" },
  { key: "pending_my_approval", label: "Pending My Approval" },
  { key: "overdue", label: "Overdue" },
];

export default function GatesExceptionsPage() {
  const [activeView, setActiveView] = useState<ViewTab>("all");
  const { data, isLoading, error } = useGatesExceptions(activeView);
  const { data: counts } = useGatesExceptionCounts();
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  // Action dialog state
  const [actionDialog, setActionDialog] = useState<{
    open: boolean; exceptionId: number; action: string; label: string;
  }>({ open: false, exceptionId: 0, action: "", label: "" });
  const [conditionsText, setConditionsText] = useState("");

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, conditionsText: ct }: { id: number; action: string; conditionsText?: string }) => {
      const res = await apiRequest("PATCH", `/api/gates/exceptions/${id}/action`, { action, conditionsText: ct });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gates/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gates/exceptions/counts"] });
      setActionDialog({ open: false, exceptionId: 0, action: "", label: "" });
      setConditionsText("");
    },
  });

  const filtered = useMemo(() => {
    if (!data?.exceptions) return [];
    if (!search) return data.exceptions;
    const term = search.toLowerCase();
    return data.exceptions.filter((e: any) =>
      (e.project_name || "").toLowerCase().includes(term) ||
      (e.reason_text || "").toLowerCase().includes(term) ||
      (e.owner_name || "").toLowerCase().includes(term)
    );
  }, [data?.exceptions, search]);

  const handleAction = (exceptionId: number, action: string, label: string) => {
    if (action === "approve_with_conditions") {
      setActionDialog({ open: true, exceptionId, action, label });
    } else {
      actionMutation.mutate({ id: exceptionId, action });
    }
  };

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load exceptions" />;

  return (
    <div className="space-y-4">
      {/* View tabs */}
      <div className="flex items-center gap-2 border-b pb-2">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveView(tab.key)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeView === tab.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {tab.label}
            {counts && tab.key === "pending_my_approval" && counts.pendingMyApproval > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5">{counts.pendingMyApproval}</Badge>
            )}
            {counts && tab.key === "overdue" && counts.overdue > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5">{counts.overdue}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* Search and count */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search exceptions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Badge variant="outline" className="bg-orange-100 text-orange-800">
          {filtered.length} exception{filtered.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
          <p>No exceptions in this view.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-2 font-medium">Project</th>
                <th className="text-left p-2 font-medium">Stage</th>
                <th className="text-left p-2 font-medium">Blocked Item</th>
                <th className="text-left p-2 font-medium">Risk</th>
                <th className="text-left p-2 font-medium">Status</th>
                <th className="text-left p-2 font-medium">Owner</th>
                <th className="text-left p-2 font-medium">Approver</th>
                <th className="text-right p-2 font-medium">Age</th>
                <th className="text-left p-2 font-medium">Due Date</th>
                <th className="text-left p-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e: any) => {
                const isOverdue = e.age_days > 3 && e.status === "REQUESTED";
                return (
                  <tr
                    key={e.id}
                    className={`border-b hover:bg-muted/30 ${isOverdue ? "bg-red-50/50" : ""}`}
                  >
                    <td
                      className="p-2 font-medium cursor-pointer hover:underline"
                      onClick={() => navigate(`/project/${encodeURIComponent(e.project_name)}`)}
                    >
                      {e.project_name}
                    </td>
                    <td className="p-2 text-xs">{STAGE_LABELS[e.stage_code] || e.stage_code}</td>
                    <td className="p-2 text-xs text-muted-foreground max-w-[150px] truncate">
                      {e.blocked_item_name || e.requirement_code || "-"}
                    </td>
                    <td className="p-2">
                      <Badge variant="outline" className={`text-[10px] ${riskBadge(e.risk_level)}`}>
                        {e.risk_level}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <Badge variant="outline" className={`text-[10px] ${statusBadge(e.status)}`}>
                        {e.status?.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{e.owner_name || "-"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{e.approver_name || "-"}</td>
                    <td className="p-2 text-right">
                      <span className={`inline-flex items-center gap-1 text-xs ${isOverdue ? "text-red-600 font-medium" : ""}`}>
                        <Clock className="h-3 w-3" /> {e.age_days}d
                      </span>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {e.closeout_due_date ? new Date(e.closeout_due_date).toLocaleDateString() : "-"}
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-1">
                        {e.status === "REQUESTED" && (
                          <>
                            <Button
                              variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-green-700"
                              onClick={() => handleAction(e.id, "approve", "Approve")}
                              title="Approve"
                            >
                              <CheckCircle className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-amber-700"
                              onClick={() => handleAction(e.id, "approve_with_conditions", "Approve with Conditions")}
                              title="Approve with conditions"
                            >
                              <Shield className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-red-700"
                              onClick={() => handleAction(e.id, "reject", "Reject")}
                              title="Reject"
                            >
                              <XCircle className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-blue-700"
                              onClick={() => handleAction(e.id, "return", "Return")}
                              title="Return for more info"
                            >
                              <MessageSquare className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-violet-700"
                              onClick={() => handleAction(e.id, "escalate", "Escalate")}
                              title="Escalate"
                            >
                              <ArrowUpRight className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {(e.status === "APPROVED" || e.status === "APPROVED_WITH_CONDITIONS") && (
                          <Button
                            variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]"
                            onClick={() => handleAction(e.id, "close", "Close")}
                            title="Close exception"
                          >
                            <CheckCircle className="h-3 w-3" />
                          </Button>
                        )}
                        {e.status === "CLOSED" && (
                          <Button
                            variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]"
                            onClick={() => handleAction(e.id, "reopen", "Re-open")}
                            title="Re-open"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Approve with conditions dialog */}
      <Dialog open={actionDialog.open} onOpenChange={(open) => {
        if (!open) setActionDialog({ open: false, exceptionId: 0, action: "", label: "" });
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve with Conditions</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Enter conditions for this approval..."
            value={conditionsText}
            onChange={(e) => setConditionsText(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog({ open: false, exceptionId: 0, action: "", label: "" })}>
              Cancel
            </Button>
            <Button
              onClick={() => actionMutation.mutate({
                id: actionDialog.exceptionId,
                action: "approve_with_conditions",
                conditionsText,
              })}
              disabled={!conditionsText.trim()}
            >
              Approve with Conditions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
