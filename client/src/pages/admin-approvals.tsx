import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Wrench,
  ShieldCheck,
  FileCheck,
  Clock,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Filter,
  User,
  FolderOpen,
  ThumbsUp,
  ThumbsDown,
  Loader2,
} from "lucide-react";

type ApprovalType = "all" | "engineering" | "quality" | "deliverable";

interface ApprovalItem {
  id: string;
  type: "engineering" | "quality" | "deliverable";
  title: string;
  projectName: string;
  projectId: number | null;
  status: string;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  meta: Record<string, any>;
}

interface ApprovalsResponse {
  items: ApprovalItem[];
  counts: {
    engineering: number;
    quality: number;
    deliverable: number;
    total: number;
  };
}

const typeConfig = {
  engineering: {
    label: "Engineering Gate",
    icon: Wrench,
    color: "text-purple-600",
    bg: "bg-purple-50",
    badgeClass: "border-purple-300 text-purple-700 bg-purple-50",
  },
  quality: {
    label: "Quality Review",
    icon: ShieldCheck,
    color: "text-teal-600",
    bg: "bg-teal-50",
    badgeClass: "border-teal-300 text-teal-700 bg-teal-50",
  },
  deliverable: {
    label: "Deliverable",
    icon: FileCheck,
    color: "text-blue-600",
    bg: "bg-blue-50",
    badgeClass: "border-blue-300 text-blue-700 bg-blue-50",
  },
};

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export default function AdminApprovalsPage() {
  const { user } = useAuth();
  const { allowed: canView } = usePermission('approvals', 'view');
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<ApprovalType>("all");
  const [actionDialog, setActionDialog] = useState<{ item: ApprovalItem; action: "approve" | "reject" } | null>(null);
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<ApprovalsResponse>({
    queryKey: ["/api/approvals/pending"],
    queryFn: async () => {
      const res = await fetch("/api/approvals/pending", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch approvals");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ item, action, comment }: { item: ApprovalItem; action: "approve" | "reject"; comment: string }) => {
      if (item.type === "engineering") {
        const approvalId = item.meta.approvalId;
        const res = await fetch(`/api/eng-stages/approvals/${approvalId}`, {
          method: "PATCH",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            status: action === "approve" ? "approved" : "rejected",
            comments: comment || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || "Failed to update engineering approval");
        }
        return res.json();
      } else if (item.type === "quality") {
        const itemInstanceId = item.meta.itemInstanceId;
        const res = await fetch(`/api/quality/project/${encodeURIComponent(item.projectName)}/item/${itemInstanceId}/approve`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            approved: action === "approve",
            comment: comment || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || "Failed to update quality approval");
        }
        return res.json();
      } else if (item.type === "deliverable") {
        const deliverableId = item.meta.deliverableId;
        const newStatus = action === "approve" ? "COMPLETE" : "PROVIDE FEEDBACK";
        const res = await fetch(`/api/deliverables/${deliverableId}`, {
          method: "PATCH",
          headers: getAuthHeaders(),
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || "Failed to update deliverable");
        }
        if (action === "reject" && comment) {
          await fetch(`/api/deliverables/${deliverableId}/feedback`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ feedbackText: comment }),
          }).catch(() => {});
        }
        return res.json();
      }
    },
    onSuccess: (_data, variables) => {
      const verb = variables.action === "approve" ? "approved" : "rejected";
      toast({ title: `Item ${verb}`, description: `${variables.item.title} has been ${verb}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals/pending"] });
      setActionDialog(null);
      setReason("");
    },
    onError: (err: any) => {
      toast({ title: "Action failed", description: err.message || "Something went wrong", variant: "destructive" });
    },
  });

  const items = data?.items || [];
  const counts = data?.counts || { engineering: 0, quality: 0, deliverable: 0, total: 0 };
  const filtered = filter === "all" ? items : items.filter(i => i.type === filter);

  function openAction(item: ApprovalItem, action: "approve" | "reject", e: { stopPropagation: () => void }) {
    e.stopPropagation();
    setReason("");
    setActionDialog({ item, action });
  }

  function submitAction() {
    if (!actionDialog) return;
    if (actionDialog.action === "reject" && !reason.trim()) {
      toast({ title: "Reason required", description: "Please provide a reason for rejection.", variant: "destructive" });
      return;
    }
    actionMutation.mutate({ item: actionDialog.item, action: actionDialog.action, comment: reason.trim() });
  }

  function navigateToItem(item: ApprovalItem) {
    if (item.type === "engineering") {
      navigate(`/engineering/tasks?project=${encodeURIComponent(item.projectName)}`);
    } else if (item.type === "quality") {
      navigate(`/quality?project=${encodeURIComponent(item.projectName)}`);
    } else if (item.type === "deliverable") {
      navigate(`/project/${encodeURIComponent(item.projectName)}`);
    }
  }

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to view this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-approvals-title">Approvals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pending approvals across all projects
          </p>
        </div>
        {counts.total > 0 && (
          <Badge variant="destructive" className="text-sm px-3 py-1" data-testid="badge-total-count">
            {counts.total} pending
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card
          className={`cursor-pointer transition-colors ${filter === "engineering" ? "ring-2 ring-purple-400" : ""}`}
          onClick={() => setFilter(filter === "engineering" ? "all" : "engineering")}
          data-testid="card-eng-count"
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-50">
              <Wrench className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{counts.engineering}</div>
              <div className="text-xs text-muted-foreground">Engineering Gates</div>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${filter === "quality" ? "ring-2 ring-teal-400" : ""}`}
          onClick={() => setFilter(filter === "quality" ? "all" : "quality")}
          data-testid="card-qc-count"
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-teal-50">
              <ShieldCheck className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{counts.quality}</div>
              <div className="text-xs text-muted-foreground">Quality Reviews</div>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${filter === "deliverable" ? "ring-2 ring-blue-400" : ""}`}
          onClick={() => setFilter(filter === "deliverable" ? "all" : "deliverable")}
          data-testid="card-del-count"
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50">
              <FileCheck className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{counts.deliverable}</div>
              <div className="text-xs text-muted-foreground">Deliverables</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {filter !== "all" && (
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Showing: {typeConfig[filter].label}</span>
          <Button variant="ghost" size="sm" onClick={() => setFilter("all")} data-testid="button-clear-filter">
            Clear
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground" data-testid="text-loading">
          Loading approvals...
        </div>
      )}

      {error && (
        <div className="text-center py-12 text-destructive" data-testid="text-error">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          Failed to load approvals
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center" data-testid="text-empty">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
            <h3 className="text-lg font-medium">All caught up</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {filter === "all"
                ? "No pending approvals across any category"
                : `No pending ${typeConfig[filter].label.toLowerCase()} approvals`}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(item => {
            const config = typeConfig[item.type];
            const Icon = config.icon;

            return (
              <Card
                key={item.id}
                className="hover:shadow-md transition-shadow"
                data-testid={`card-approval-${item.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${config.bg} mt-0.5`}>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate" data-testid={`text-title-${item.id}`}>
                          {item.title}
                        </span>
                        <Badge className={`text-[10px] ${config.badgeClass}`}>
                          {config.label}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {item.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FolderOpen className="w-3 h-3" />
                          {item.projectName}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {item.assignee}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(item.createdAt), "dd MMM yyyy")}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="default"
                        size="sm"
                        className="h-7 text-xs bg-green-600 hover:bg-green-700 gap-1"
                        onClick={(e) => openAction(item, "approve", e)}
                        data-testid={`btn-approve-${item.id}`}
                      >
                        <ThumbsUp className="w-3 h-3" />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 gap-1"
                        onClick={(e) => openAction(item, "reject", e)}
                        data-testid={`btn-reject-${item.id}`}
                      >
                        <ThumbsDown className="w-3 h-3" />
                        Reject
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => navigateToItem(item)}
                        title="View in project"
                        data-testid={`btn-navigate-${item.id}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!actionDialog} onOpenChange={(open) => { if (!open) { setActionDialog(null); setReason(""); } }}>
        <DialogContent className="sm:max-w-[440px]">
          {actionDialog && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {actionDialog.action === "approve" ? (
                    <ThumbsUp className="w-5 h-5 text-green-600" />
                  ) : (
                    <ThumbsDown className="w-5 h-5 text-red-600" />
                  )}
                  {actionDialog.action === "approve" ? "Approve Item" : "Reject Item"}
                </DialogTitle>
                <DialogDescription>
                  {actionDialog.action === "approve"
                    ? "Confirm approval for this item. You can optionally add a comment."
                    : "Please provide a reason for rejecting this item."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="rounded-lg border p-3 bg-muted/30">
                  <div className="text-sm font-medium">{actionDialog.item.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {actionDialog.item.projectName} · {typeConfig[actionDialog.item.type].label}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">
                    {actionDialog.action === "approve" ? "Comment (optional)" : "Reason (required)"}
                  </label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={actionDialog.action === "approve" ? "Add a comment..." : "Why is this being rejected?"}
                    className="mt-1.5"
                    rows={3}
                    data-testid="input-reason"
                  />
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => { setActionDialog(null); setReason(""); }}
                  disabled={actionMutation.isPending}
                  data-testid="btn-cancel-action"
                >
                  Cancel
                </Button>
                <Button
                  variant={actionDialog.action === "approve" ? "default" : "destructive"}
                  className={actionDialog.action === "approve" ? "bg-green-600 hover:bg-green-700" : ""}
                  onClick={submitAction}
                  disabled={actionMutation.isPending || (actionDialog.action === "reject" && !reason.trim())}
                  data-testid="btn-confirm-action"
                >
                  {actionMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                  {actionDialog.action === "approve" ? "Confirm Approval" : "Confirm Rejection"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
