import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  AlertTriangle, ThumbsUp, ThumbsDown, Loader2, ExternalLink,
  Filter, Inbox,
} from "lucide-react";

function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
}

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

type FilterType = "all" | "engineering" | "quality" | "deliverable";

const TYPE_CONFIG = {
  engineering: { icon: Wrench, color: "text-amber-600 bg-amber-50 border-amber-200", label: "Engineering Gate" },
  quality: { icon: ShieldCheck, color: "text-emerald-600 bg-emerald-50 border-emerald-200", label: "Quality Review" },
  deliverable: { icon: FileCheck, color: "text-blue-600 bg-blue-50 border-blue-200", label: "Deliverable" },
};

export function ProjectApprovalsTab({ projectName, projectInfoId }: { projectName: string; projectInfoId: number | null }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedApproval, setSelectedApproval] = useState<ApprovalItem | null>(null);
  const [comment, setComment] = useState("");

  const { data: approvals = [], isLoading } = useQuery<ApprovalItem[]>({
    queryKey: ["project-approvals", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/approvals/pending?showAll=true`);
      if (!res.ok) return [];
      const data = await res.json();
      const items: ApprovalItem[] = data.items || [];
      return items.filter(a => a.projectName === projectName);
    },
    enabled: !!projectName,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, type }: { id: string; type: string }) => {
      const res = await engFetch(`/api/approvals/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ type, comment }),
      });
      if (!res.ok) throw new Error("Failed to approve");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Approved successfully" });
      queryClient.invalidateQueries({ queryKey: ["project-approvals"] });
      setSelectedApproval(null);
      setComment("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, type }: { id: string; type: string }) => {
      const res = await engFetch(`/api/approvals/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ type, comment }),
      });
      if (!res.ok) throw new Error("Failed to reject");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rejected" });
      queryClient.invalidateQueries({ queryKey: ["project-approvals"] });
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
        {(["all", "engineering", "quality", "deliverable"] as FilterType[]).map(f => (
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
        <Badge variant="secondary" className="ml-auto text-xs" data-testid="badge-pending-count">
          {pending.length} pending
        </Badge>
      </div>

      {pending.length === 0 && resolved.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No approvals or deliverables for this project</p>
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
            const config = TYPE_CONFIG[item.type];
            const Icon = config.icon;
            return (
              <Card
                key={item.id}
                className={`border-l-4 cursor-pointer hover:shadow-md transition-shadow ${config.color.split(" ").map(c => c.startsWith("border") ? c : "").join(" ").trim() || "border-l-amber-400"}`}
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
            const config = TYPE_CONFIG[item.type];
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
              {selectedApproval && (() => { const Icon = TYPE_CONFIG[selectedApproval.type].icon; return <Icon className="h-5 w-5" />; })()}
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
