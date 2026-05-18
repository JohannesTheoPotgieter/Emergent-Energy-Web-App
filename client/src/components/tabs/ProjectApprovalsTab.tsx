import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateProjectV2Queries } from "@/hooks/use-project-v2";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Wrench, ShieldCheck, FileCheck, Clock, CheckCircle2,
   ThumbsUp, ThumbsDown, Loader2, 
  Filter, Inbox, Send,
  type LucideIcon,
} from "lucide-react";

function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const companyRole = localStorage.getItem("company_role");
  if (companyRole) headers["x-company-role"] = companyRole;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

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
  meta: Record<string, unknown>;
}

interface GeneralApprovalRow {
  id: number;
  title: string;
  projectId: number | null;
  status: string;
  assignedApproverName?: string | null;
  requestedByName?: string | null;
  requestedAt: string;
  decidedAt?: string | null;
  approvalCategory?: string | null;
  dueDate?: string | null;
}

type FilterType = "all" | "engineering" | "quality" | "deliverable" | "general";

const TYPE_CONFIG: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  engineering: { icon: Wrench, color: "text-amber-600 bg-amber-50 border-amber-200", label: "Engineering Gate" },
  quality: { icon: ShieldCheck, color: "text-emerald-600 bg-emerald-50 border-emerald-200", label: "Quality Review" },
  deliverable: { icon: FileCheck, color: "text-blue-600 bg-blue-50 border-blue-200", label: "Deliverable" },
  general: { icon: Clock, color: "text-violet-600 bg-violet-50 border-violet-200", label: "General Approval" },
};

export function ProjectApprovalsTab({
  projectName,
  projectInfoId,
  onNavigateSubTab,
}: {
  projectName: string;
  projectInfoId: number | null;
  onNavigateSubTab?: (sub: string) => void;
}) {
  const { user: _user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedApproval, setSelectedApproval] = useState<ApprovalItem | null>(null);
  const [comment, setComment] = useState("");

  const openCreateFromQualityFlow = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("dept", "quality");
    url.searchParams.set("sub", "checklist");
    url.searchParams.set("qualityFilter", "actionable_for_approval");
    url.searchParams.set("chip", "create-from-quality");
    setLocation(url.pathname + url.search);
    if (onNavigateSubTab) onNavigateSubTab("checklist");
  };

  const { data: approvals = [], isLoading } = useQuery<ApprovalItem[]>({
    queryKey: ["project-approvals", projectName, projectInfoId],
    queryFn: async () => {
      const [pendingRes, generalRes] = await Promise.all([
        engFetch(`/api/approvals/pending?showAll=true`),
        projectInfoId ? engFetch(`/api/approvals/general?projectId=${projectInfoId}`) : Promise.resolve(null),
      ]);

      const pendingItems: ApprovalItem[] = [];
      if (pendingRes.ok) {
        const data = await pendingRes.json();
        pendingItems.push(...((data.items || []) as ApprovalItem[]).filter((a) => a.projectName === projectName));
      }

      if (generalRes && generalRes.ok) {
        const gData = await generalRes.json();
        const generalItems: ApprovalItem[] = ((gData.approvals || []) as GeneralApprovalRow[]).map((g) => ({
          id: `gen-${g.id}`,
          type: "general" as const,
          title: g.title,
          projectName: projectName,
          projectId: g.projectId,
          status: g.status,
          assignee: g.assignedApproverName || g.requestedByName || "Unassigned",
          createdAt: g.requestedAt,
          updatedAt: g.decidedAt || g.requestedAt,
          meta: { generalApprovalId: g.id, category: g.approvalCategory, dueDate: g.dueDate },
        }));
        pendingItems.push(...generalItems);
      }

      return pendingItems;
    },
    enabled: !!projectName,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, type }: { id: string; type: string }) => {
      let res: Response;
      if (type === "general" && id.startsWith("gen-")) {
        const realId = id.replace("gen-", "");
        res = await engFetch(`/api/approvals/general/${realId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "approved", decisionNote: comment }),
        });
      } else if (type === "engineering" && id.startsWith("eng-")) {
        const realId = id.replace("eng-", "");
        res = await engFetch(`/api/eng-stages/approvals/${realId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "approved", comments: comment }),
        });
      } else if (type === "quality" && id.startsWith("qc-")) {
        const realId = id.replace("qc-", "");
        const projName = selectedApproval?.projectName || "";
        res = await engFetch(`/api/quality/project/${encodeURIComponent(projName)}/item/${realId}/approve`, {
          method: "POST",
          body: JSON.stringify({ approved: true, comment }),
        });
      } else if (type === "deliverable" && id.startsWith("del-")) {
        const realId = id.replace("del-", "");
        const currentStatus = selectedApproval?.status || "";
        const nextStatus = currentStatus === "NEEDS APPROVAL" ? "QC APPROVED"
          : currentStatus === "QC APPROVED" ? "OPERATIONAL APPROVAL"
          : currentStatus === "OPERATIONAL APPROVAL" ? "COMPLETE"
          : "COMPLETE";
        res = await engFetch(`/api/deliverables/${realId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        });
      } else {
        throw new Error("Unknown approval type");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || "Failed to approve");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Approved successfully" });
      queryClient.invalidateQueries({ queryKey: ["project-approvals"] });
      invalidateProjectV2Queries(queryClient, projectInfoId);
      setSelectedApproval(null);
      setComment("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, type }: { id: string; type: string }) => {
      let res: Response;
      if (type === "general" && id.startsWith("gen-")) {
        const realId = id.replace("gen-", "");
        res = await engFetch(`/api/approvals/general/${realId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "rejected", decisionNote: comment }),
        });
      } else if (type === "engineering" && id.startsWith("eng-")) {
        const realId = id.replace("eng-", "");
        res = await engFetch(`/api/eng-stages/approvals/${realId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "rejected", comments: comment }),
        });
      } else if (type === "quality" && id.startsWith("qc-")) {
        const realId = id.replace("qc-", "");
        const projName = selectedApproval?.projectName || "";
        res = await engFetch(`/api/quality/project/${encodeURIComponent(projName)}/item/${realId}/approve`, {
          method: "POST",
          body: JSON.stringify({ approved: false, comment }),
        });
      } else if (type === "deliverable" && id.startsWith("del-")) {
        const realId = id.replace("del-", "");
        res = await engFetch(`/api/deliverables/${realId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "PROVIDE FEEDBACK" }),
        });
      } else {
        throw new Error("Unknown approval type");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || "Failed to reject");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rejected" });
      queryClient.invalidateQueries({ queryKey: ["project-approvals"] });
      invalidateProjectV2Queries(queryClient, projectInfoId);
      setSelectedApproval(null);
      setComment("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = approvals.filter(a => filter === "all" || a.type === filter);
  const pending = filtered.filter(a => a.status === "pending" || a.status === "NEEDS APPROVAL" || a.status === "submitted");
  const resolved = filtered.filter(a => a.status !== "pending" && a.status !== "NEEDS APPROVAL" && a.status !== "submitted");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="project-approvals-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {(["all", "engineering", "quality", "deliverable", "general"] as FilterType[]).map(f => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            className="h-7 text-xs capitalize"
            onClick={() => setFilter(f)}
            data-testid={`filter-${f}`}
          >
            {f === "all" ? "All" : TYPE_CONFIG[f].label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 ml-2"
          onClick={openCreateFromQualityFlow}
          data-testid="btn-create-from-quality"
        >
          <Send className="h-3 w-3" /> Create from Quality items
        </Button>
        <Badge variant="secondary" className="ml-auto text-xs" data-testid="badge-pending-count">
          {pending.length} pending
        </Badge>
      </div>

      {pending.length === 0 && resolved.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <Inbox className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">No approvals or deliverables for this project</p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 mx-auto border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              onClick={openCreateFromQualityFlow}
              data-testid="btn-create-from-quality-empty"
            >
              <Send className="h-3 w-3" /> Create from Quality items
            </Button>
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            Pending Approval ({pending.length})
          </h3>
          {pending.map(item => {
            const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.general;
            const Icon = config.icon;
            return (
              <Card
                key={item.id}
                className={`border-l-4 cursor-pointer hover:shadow-md transition-shadow ${config.color.split(" ").map((c: string) => c.startsWith("border") ? c : "").join(" ").trim() || "border-l-amber-400"}`}
                onClick={() => { setSelectedApproval(item); setComment(""); }}
                data-testid={`approval-item-${item.id}`}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <Icon className={`h-5 w-5 shrink-0 ${config.color.split(" ")[0]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {config.label} · {item.assignee || "Unassigned"} · {new Date(item.createdAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                    </p>
                  </div>
                  <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100 shrink-0">Pending</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Resolved ({resolved.length})
          </h3>
          {resolved.slice(0, 10).map(item => {
            const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.general;
            const Icon = config.icon;
            const isApproved = item.status === "approved" || item.status === "COMPLETE" || item.status === "QC APPROVED";
            return (
              <Card key={item.id} className="opacity-70" data-testid={`approval-resolved-${item.id}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {config.label} · {new Date(item.updatedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                    </p>
                  </div>
                  <Badge className={`text-[10px] shrink-0 ${isApproved ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-red-100 text-red-700 hover:bg-red-100"}`}>
                    {isApproved ? "Approved" : "Rejected"}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedApproval} onOpenChange={(open) => { if (!open) setSelectedApproval(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedApproval && (() => { const config = TYPE_CONFIG[selectedApproval.type] || TYPE_CONFIG.general; const Icon = config.icon; return <Icon className="h-5 w-5" />; })()}
              Review Approval
            </DialogTitle>
          </DialogHeader>
          {selectedApproval && (
            <div className="space-y-3">
              <div className="text-sm space-y-2 bg-muted/50 p-3 rounded-lg">
                <div><span className="font-medium">Title:</span> {selectedApproval.title}</div>
                <div><span className="font-medium">Type:</span> {TYPE_CONFIG[selectedApproval.type].label}</div>
                <div><span className="font-medium">Project:</span> {selectedApproval.projectName}</div>
                <div><span className="font-medium">Assignee:</span> {selectedApproval.assignee || "Unassigned"}</div>
                <div><span className="font-medium">Created:</span> {new Date(selectedApproval.createdAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}</div>
              </div>
              <Textarea
                placeholder="Comment (required for rejection)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="text-sm"
                data-testid="input-approval-comment"
              />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={!comment.trim() || rejectMutation.isPending}
              onClick={() => selectedApproval && rejectMutation.mutate({ id: selectedApproval.id, type: selectedApproval.type })}
              data-testid="button-reject-approval"
            >
              {rejectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ThumbsDown className="h-3 w-3 mr-1" />}
              Reject
            </Button>
            <Button
              size="sm"
              disabled={approveMutation.isPending}
              onClick={() => selectedApproval && approveMutation.mutate({ id: selectedApproval.id, type: selectedApproval.type })}
              data-testid="button-approve-approval"
            >
              {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ThumbsUp className="h-3 w-3 mr-1" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
