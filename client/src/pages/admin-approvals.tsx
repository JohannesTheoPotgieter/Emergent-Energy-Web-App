import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePermission } from "@/hooks/use-permissions";
import { useLocation } from "wouter";
import { format } from "date-fns";
import * as Checkbox from "@radix-ui/react-checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
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
  Check,
} from "lucide-react";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";

type ApprovalType = "all" | "engineering" | "quality" | "deliverable" | "general";

interface ApprovalItem {
  id: string;
  type: "engineering" | "quality" | "deliverable" | "general";
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
    general?: number;
    total: number;
  };
  isAdmin?: boolean;
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
  general: {
    label: "General",
    icon: Clock,
    color: "text-violet-600",
    bg: "bg-violet-50",
    badgeClass: "border-violet-300 text-violet-700 bg-violet-50",
  },
};

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

async function performApprovalAction(item: ApprovalItem, action: "approve" | "reject", comment: string) {
  if (item.type === "general") {
    const approvalId = item.meta.generalApprovalId || item.id.replace("gen-", "");
    const res = await fetch(`/api/approvals/general/${approvalId}`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        status: action === "approve" ? "approved" : "rejected",
        decisionNote: comment || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || "Failed to update general approval");
    }
    return res.json();
  }
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
  }
  if (item.type === "quality") {
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
  }
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

export default function AdminApprovalsPage() {
  const { allowed: canView } = usePermission('approvals', 'view');
  const { allowed: canApprove } = usePermission('approvals', 'edit');
  const [location, navigate] = useLocation();
  const [filter, setFilter] = useState<ApprovalType>("all");
  const [showAll, setShowAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectOpenById, setRejectOpenById] = useState<Record<string, boolean>>({});
  const [rejectReasonById, setRejectReasonById] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<ApprovalsResponse>({
    queryKey: ["/api/approvals/pending", showAll],
    queryFn: async () => {
      const url = showAll ? "/api/approvals/pending?showAll=true" : "/api/approvals/pending";
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch approvals");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const isAdmin = data?.isAdmin ?? false;

  const applyApprovalAction = async ({ item, action, comment }: { item: ApprovalItem; action: "approve" | "reject"; comment: string }) => {
      if (item.type === "general") {
        const approvalId = item.meta.generalApprovalId || item.id.replace("gen-", "");
        const res = await fetch(`/api/approvals/general/${approvalId}`, {
          method: "PATCH",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            status: action === "approve" ? "approved" : "rejected",
            decisionNote: comment || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || "Failed to update general approval");
        }
        return res.json();
      }
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
  };

  const approveMutation = useMutation({
    mutationFn: ({ item }: { item: ApprovalItem }) => applyApprovalAction({ item, action: "approve", comment: "" }),
    onMutate: async ({ item }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/approvals/pending"] });
      const previous = queryClient.getQueryData<ApprovalsResponse>(["/api/approvals/pending", showAll]);
      queryClient.setQueryData<ApprovalsResponse>(["/api/approvals/pending", showAll], (current) => {
        if (!current) return current;
        return {
          ...current,
          items: current.items.map((row) => row.id === item.id ? { ...row, status: "approved" } : row),
        };
      });
      return { previous };
    },
    onSuccess: (_data, variables) => {
      toast.success(`${variables.item.title} approved`);
    },
    onError: (err: any, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/approvals/pending", showAll], context.previous);
      }
      toast.error(err.message || "Failed to approve");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals/pending"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ item, comment }: { item: ApprovalItem; comment: string }) =>
      applyApprovalAction({ item, action: "reject", comment }),
    onMutate: async ({ item }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/approvals/pending"] });
      const previous = queryClient.getQueryData<ApprovalsResponse>(["/api/approvals/pending", showAll]);
      queryClient.setQueryData<ApprovalsResponse>(["/api/approvals/pending", showAll], (current) => {
        if (!current) return current;
        return {
          ...current,
          items: current.items.map((row) => row.id === item.id ? { ...row, status: "rejected" } : row),
        };
      });
      return { previous };
    },
    onSuccess: (_data, variables) => {
      setRejectOpenById((prev) => ({ ...prev, [variables.item.id]: false }));
      setRejectReasonById((prev) => ({ ...prev, [variables.item.id]: "" }));
      toast.success(`${variables.item.title} rejected`);
    },
    onError: (err: any, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/approvals/pending", showAll], context.previous);
      }
      toast.error(err.message || "Failed to reject");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals/pending"] });
    },
  });

  const items = data?.items || [];
  const counts = data?.counts || { engineering: 0, quality: 0, deliverable: 0, general: 0, total: 0 };
  const filtered = filter === "all" ? items : items.filter(i => i.type === filter);
  const filteredIds = useMemo(() => new Set(filtered.map((item) => item.id)), [filtered]);
  const selectedItems = useMemo(
    () => filtered.filter((item) => selectedIds.has(item.id)),
    [filtered, selectedIds],
  );
  const allRowsSelected = filtered.length > 0 && selectedItems.length === filtered.length;
  const someRowsSelected = selectedItems.length > 0 && selectedItems.length < filtered.length;
  const isPmWorkspace = location.startsWith("/pm/");
  const subtitle = isPmWorkspace
    ? "Execution approvals queue for post-handover delivery work. Approval-required items must use Send for Approval only."
    : showAll
      ? "All pending approvals across all projects"
      : "Your pending approvals";

  // A6: Group by urgency
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const urgencyGroups = (() => {
    const overdue: ApprovalItem[] = [];
    const dueToday: ApprovalItem[] = [];
    const thisWeek: ApprovalItem[] = [];
    const later: ApprovalItem[] = [];

    for (const item of filtered) {
      const created = new Date(item.createdAt);
      const ageDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));

      if (ageDays > 3) overdue.push(item);
      else if (ageDays >= 1) dueToday.push(item);
      else if (created >= today && created < weekEnd) thisWeek.push(item);
      else later.push(item);
    }

    return [
      { label: "Overdue (>3 days)", items: overdue, color: "text-red-600" },
      { label: "Aging (1-3 days)", items: dueToday, color: "text-amber-600" },
      { label: "Recent", items: thisWeek, color: "text-blue-600" },
      { label: "New Today", items: later, color: "text-muted-foreground" },
    ].filter(g => g.items.length > 0);
  })();

  function isPendingStatus(status: string) {
    return status.toLowerCase() === "pending";
  }

  function navigateToItem(item: ApprovalItem) {
    if (item.type === "engineering") {
      navigate(`/engineering/tasks?project=${encodeURIComponent(item.projectName)}`);
    } else if (item.type === "quality") {
      navigate(`/quality?project=${encodeURIComponent(item.projectName)}`);
    } else if (item.type === "deliverable") {
      navigate(`/project/${encodeURIComponent(item.projectName)}`);
    } else if (item.type === "general") {
      navigate(`/project/${encodeURIComponent(item.projectName)}`);
    }
  }

  function toggleSelected(itemId: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      if (!checked) {
        const next = new Set(prev);
        filtered.forEach((item) => next.delete(item.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((item) => next.add(item.id));
      return next;
    });
  }

  async function approveSelected() {
    if (selectedItems.length === 0) return;
    if (!canApprove) {
      toast.error("Permission required: You do not have approval permission for this queue.");
      return;
    }
    try {
      await Promise.all(selectedItems.map((item) => performApprovalAction(item, "approve", "")));
      setSelectedIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ["/api/approvals/pending"] });
      toast.success(`Approved ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}.`);
    } catch (err: any) {
      toast.error(err?.message || "Bulk approve failed.");
    }
  }

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (filteredIds.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [filteredIds]);

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
    <>
      <PageShell className="p-4 sm:p-6">
        <div className="max-w-5xl mx-auto space-y-6">
        <SectionHeader
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Approvals"
          description={subtitle}
          actions={
            <div className="flex items-center gap-3">
              {isAdmin && (
                <Button
                  variant={showAll ? "default" : "outline"}
                  size="sm"
                  className="text-xs gap-1.5"
                  onClick={() => setShowAll(!showAll)}
                  data-testid="btn-toggle-show-all"
                >
                  <User className="w-3.5 h-3.5" />
                  {showAll ? "Show Mine" : "Show All"}
                </Button>
              )}
              {counts.total > 0 && (
                <Badge variant="destructive" className="text-sm px-3 py-1" data-testid="badge-total-count">
                  {counts.total} pending
                </Badge>
              )}
            </div>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
        <Card
          className={`cursor-pointer transition-colors ${filter === "general" ? "ring-2 ring-violet-400" : ""}`}
          onClick={() => setFilter(filter === "general" ? "all" : "general")}
          data-testid="card-general-count"
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-50">
              <Clock className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{counts.general || 0}</div>
              <div className="text-xs text-muted-foreground">General Approvals</div>
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
                  ? (showAll ? "No pending approvals across any category" : "No approvals assigned to you right now")
                  : `No pending ${typeConfig[filter].label.toLowerCase()} approvals`}
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <div className="space-y-4">
            {/* A6: Urgency-grouped approval cards */}
            {urgencyGroups.map(group => (
              <div key={group.label} className="space-y-2">
                <h3 className={`text-xs font-semibold uppercase tracking-wide ${group.color}`}>
                  {group.label} ({group.items.length})
                </h3>
                {group.items.map(item => {
                  const config = typeConfig[item.type];
                  const Icon = config.icon;
                  const ageDays = Math.floor((now.getTime() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                  return (
                    <Card
                      key={item.id}
                      className="hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => navigateToItem(item)}
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
                                {ageDays === 0 ? "today" : `${ageDays}d ago`}
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
                            </div>
                          </div>
                          {canApprove && isPendingStatus(item.status) ? (
                            <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="outline" size="sm" className="h-7 text-xs gap-1 text-emerald-700 border-emerald-300 hover:text-emerald-800"
                                onClick={() => approveMutation.mutate({ item })}
                                disabled={approveMutation.isPending || rejectMutation.isPending}
                                data-testid={`btn-approve-${item.id}`}
                              >
                                {approveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
                                Approve
                              </Button>
                              <Button
                                variant="outline" size="sm" className="h-7 text-xs gap-1 text-red-600 hover:text-red-700"
                                onClick={() => setRejectOpenById((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
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
                          ) : (
                            <Badge variant="outline" className="text-[10px]">View only</Badge>
                          )}
                        </div>
                        {canApprove && isPendingStatus(item.status) && rejectOpenById[item.id] && (
                          <div className="mt-3 pl-11 space-y-2" onClick={(e) => e.stopPropagation()}>
                            <Textarea
                              rows={2}
                              placeholder="Enter rejection reason"
                              value={rejectReasonById[item.id] || ""}
                              onChange={(e) => setRejectReasonById((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              data-testid={`input-reject-reason-${item.id}`}
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={!String(rejectReasonById[item.id] || "").trim() || rejectMutation.isPending || approveMutation.isPending}
                                onClick={() => {
                                  const reason = String(rejectReasonById[item.id] || "").trim();
                                  if (!reason) {
                                    toast.error("Please provide a reason for rejection.");
                                    return;
                                  }
                                  rejectMutation.mutate({ item, comment: reason });
                                }}
                                data-testid={`btn-confirm-reject-${item.id}`}
                              >
                                {rejectMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                                Submit rejection
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setRejectOpenById((prev) => ({ ...prev, [item.id]: false }));
                                  setRejectReasonById((prev) => ({ ...prev, [item.id]: "" }));
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ))}
            {/* Legacy flat list fallback — hidden when urgency groups render */}
            {urgencyGroups.length === 0 && filtered.map(item => {
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
                        {canApprove && isPendingStatus(item.status) ? (
                          <>
                            <Button
                              variant="default"
                              size="sm"
                              className="h-7 text-xs bg-green-600 hover:bg-green-700 gap-1"
                              onClick={() => approveMutation.mutate({ item })}
                              disabled={approveMutation.isPending || rejectMutation.isPending}
                              data-testid={`btn-approve-${item.id}`}
                            >
                              {approveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
                              Approve
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 gap-1"
                              onClick={() => setRejectOpenById((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                              data-testid={`btn-reject-${item.id}`}
                            >
                              <ThumbsDown className="w-3 h-3" />
                              Reject
                            </Button>
                          </>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">View only</Badge>
                        )}
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
                    {canApprove && isPendingStatus(item.status) && rejectOpenById[item.id] && (
                      <div className="mt-3 pl-11 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <Textarea
                          rows={2}
                          placeholder="Enter rejection reason"
                          value={rejectReasonById[item.id] || ""}
                          onChange={(e) => setRejectReasonById((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          data-testid={`input-reject-reason-${item.id}`}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={!String(rejectReasonById[item.id] || "").trim() || rejectMutation.isPending || approveMutation.isPending}
                            onClick={() => {
                              const reason = String(rejectReasonById[item.id] || "").trim();
                              if (!reason) {
                                toast.error("Please provide a reason for rejection.");
                                return;
                              }
                              rejectMutation.mutate({ item, comment: reason });
                            }}
                            data-testid={`btn-confirm-reject-${item.id}`}
                          >
                            {rejectMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                            Submit rejection
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setRejectOpenById((prev) => ({ ...prev, [item.id]: false }));
                              setRejectReasonById((prev) => ({ ...prev, [item.id]: "" }));
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        </div>
      </PageShell>
    </>
  );
}
