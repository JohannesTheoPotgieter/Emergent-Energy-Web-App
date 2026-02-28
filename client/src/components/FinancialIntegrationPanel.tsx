import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import {
  AlertTriangle, AlertCircle, Info, Link2, ShieldAlert,
  CheckCircle, XCircle, Clock, TrendingUp, DollarSign,
  FileText, ChevronDown, ChevronUp, Loader2,
} from "lucide-react";

const engFetch = (url: string, opts?: RequestInit) =>
  fetch(url, { credentials: "include", ...opts });

interface IntegrationWarning {
  type: string;
  severity: "critical" | "warning" | "info";
  message: string;
  details?: any;
}

interface EditRequest {
  id: number;
  projectName: string;
  requestedByUserId: number;
  requestedByName: string;
  requestedByRole: string;
  editType: string;
  editTarget: string;
  editPayload: string;
  editSummary: string;
  isCriticalPath: boolean;
  affectsRevenue: boolean;
  affectsExpenditure: boolean;
  affectsQuality: boolean;
  status: string;
  reviewComment?: string;
  createdAt: string;
}

interface SyncStatus {
  plan: { totalTasks: number };
  expenditure: { total: number; linked: number; linkPercent: number };
  revenue: { total: number; linked: number; linkPercent: number };
  overallSyncPercent: number;
  syncStatus: "good" | "partial" | "low";
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />;
  if (severity === "warning") return <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />;
  return <Info className="h-3.5 w-3.5 text-blue-600 shrink-0" />;
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "critical") return <Badge variant="destructive" className="text-[9px] px-1 py-0">Critical</Badge>;
  if (severity === "warning") return <Badge className="text-[9px] px-1 py-0 bg-amber-100 text-amber-700 hover:bg-amber-100">Warning</Badge>;
  return <Badge variant="outline" className="text-[9px] px-1 py-0">Info</Badge>;
}

function SyncBar({ label, linked, total, percent }: { label: string; linked: number; total: number; percent: number }) {
  const color = percent >= 80 ? "bg-emerald-500" : percent >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{linked}/{total} linked ({percent}%)</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function FinancialIntegrationPanel({ projectName }: { projectName: string }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [reviewDialog, setReviewDialog] = useState<EditRequest | null>(null);
  const [reviewComment, setReviewComment] = useState("");

  const { data: warnings = [] } = useQuery<IntegrationWarning[]>({
    queryKey: ["financial-warnings", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/financial-integration/warnings/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.warnings || [];
    },
    enabled: !!projectName,
    staleTime: 60000,
  });

  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ["financial-sync", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/financial-integration/sync-status/${encodeURIComponent(projectName)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectName,
    staleTime: 60000,
  });

  const { data: roleAccess } = useQuery({
    queryKey: ["financial-role-access"],
    queryFn: async () => {
      const res = await engFetch("/api/financial-integration/role-access");
      if (!res.ok) return { canEditDirectly: false, canSubmitForApproval: false, canApprove: false };
      return res.json();
    },
    staleTime: 300000,
  });

  const { data: pendingRequests = [] } = useQuery<EditRequest[]>({
    queryKey: ["financial-edit-requests", projectName, "pending"],
    queryFn: async () => {
      const res = await engFetch(`/api/financial-edit-requests?projectName=${encodeURIComponent(projectName)}&status=pending`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName && roleAccess?.canApprove,
    staleTime: 30000,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: number; comment: string }) => {
      const res = await engFetch(`/api/financial-edit-requests/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error("Failed to approve");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Edit approved" });
      queryClient.invalidateQueries({ queryKey: ["financial-edit-requests"] });
      queryClient.invalidateQueries({ queryKey: ["financial-warnings"] });
      setReviewDialog(null);
      setReviewComment("");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: number; comment: string }) => {
      const res = await engFetch(`/api/financial-edit-requests/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error("Failed to reject");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Edit rejected" });
      queryClient.invalidateQueries({ queryKey: ["financial-edit-requests"] });
      setReviewDialog(null);
      setReviewComment("");
    },
  });

  const criticalCount = warnings.filter(w => w.severity === "critical").length;
  const warningCount = warnings.filter(w => w.severity === "warning").length;
  const infoCount = warnings.filter(w => w.severity === "info").length;

  if (warnings.length === 0 && !syncStatus && pendingRequests.length === 0) return null;

  const syncColor = syncStatus?.syncStatus === "good" ? "text-emerald-600" : syncStatus?.syncStatus === "partial" ? "text-amber-600" : "text-red-600";
  const syncBg = syncStatus?.syncStatus === "good" ? "bg-emerald-50" : syncStatus?.syncStatus === "partial" ? "bg-amber-50" : "bg-red-50";

  return (
    <>
      <Card className="relative overflow-hidden border-l-4 border-l-indigo-500" data-testid="financial-integration-panel">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                <Link2 className="h-4 w-4 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Financial Integration</h3>
                <p className="text-[10px] text-muted-foreground">Plan · Revenue · Expenditure sync</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {criticalCount > 0 && <Badge variant="destructive" className="text-[9px]" data-testid="badge-critical-count">{criticalCount} critical</Badge>}
              {warningCount > 0 && <Badge className="text-[9px] bg-amber-100 text-amber-700 hover:bg-amber-100" data-testid="badge-warning-count">{warningCount} warning{warningCount !== 1 ? "s" : ""}</Badge>}
              {pendingRequests.length > 0 && <Badge variant="outline" className="text-[9px] border-blue-300 text-blue-600" data-testid="badge-pending-edits">{pendingRequests.length} pending</Badge>}
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)} data-testid="button-toggle-integration">
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {syncStatus && (
            <div className={`rounded-lg ${syncBg} p-3 space-y-2`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Sync Status</span>
                <span className={`text-xs font-bold ${syncColor}`} data-testid="text-sync-percent">
                  {syncStatus.overallSyncPercent}% linked
                </span>
              </div>
              <SyncBar label="Expenditure → Plan" linked={syncStatus.expenditure.linked} total={syncStatus.expenditure.total} percent={syncStatus.expenditure.linkPercent} />
              <SyncBar label="Revenue → Plan" linked={syncStatus.revenue.linked} total={syncStatus.revenue.total} percent={syncStatus.revenue.linkPercent} />
            </div>
          )}

          {warnings.length > 0 && (
            <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
              {(expanded ? warnings : warnings.slice(0, 3)).map((w, i) => (
                <div key={i} className={`flex items-start gap-2 text-[11px] py-1.5 px-2 rounded ${
                  w.severity === "critical" ? "bg-red-50 border border-red-100" :
                  w.severity === "warning" ? "bg-amber-50 border border-amber-100" :
                  "bg-blue-50 border border-blue-100"
                }`} data-testid={`warning-${w.type}-${i}`}>
                  <SeverityIcon severity={w.severity} />
                  <span className="flex-1">{w.message}</span>
                  <SeverityBadge severity={w.severity} />
                </div>
              ))}
              {!expanded && warnings.length > 3 && (
                <button className="text-[10px] text-blue-600 hover:underline w-full text-center py-1" onClick={() => setExpanded(true)} data-testid="button-show-more-warnings">
                  +{warnings.length - 3} more
                </button>
              )}
            </div>
          )}

          {expanded && pendingRequests.length > 0 && roleAccess?.canApprove && (
            <div className="space-y-1.5 border-t pt-2">
              <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Clock className="h-3 w-3" />
                Pending Edit Requests
              </div>
              {pendingRequests.map((req) => (
                <div key={req.id} className="flex items-center gap-2 text-[11px] py-1.5 px-2 rounded bg-blue-50 border border-blue-100" data-testid={`edit-request-${req.id}`}>
                  <FileText className="h-3 w-3 text-blue-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{req.editSummary}</p>
                    <p className="text-muted-foreground">by {req.requestedByName} · {new Date(req.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {req.isCriticalPath && <Badge variant="destructive" className="text-[8px] px-0.5 py-0">CP</Badge>}
                    {req.affectsRevenue && <Badge className="text-[8px] px-0.5 py-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Rev</Badge>}
                    {req.affectsExpenditure && <Badge className="text-[8px] px-0.5 py-0 bg-violet-100 text-violet-700 hover:bg-violet-100">Exp</Badge>}
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-blue-600" onClick={() => { setReviewDialog(req); setReviewComment(""); }} data-testid={`button-review-${req.id}`}>
                      <FileText className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!roleAccess?.canEditDirectly && roleAccess?.canSubmitForApproval && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-1 border-t">
              <ShieldAlert className="h-3 w-3" />
              Your edits require approval from COO, Programme Manager, Finance Manager, or Construction Manager
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reviewDialog} onOpenChange={(open) => { if (!open) setReviewDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Review Edit Request</DialogTitle>
          </DialogHeader>
          {reviewDialog && (
            <div className="space-y-3">
              <div className="text-sm space-y-2 bg-muted/50 p-3 rounded-lg">
                <div><span className="font-medium">Project:</span> {reviewDialog.projectName}</div>
                <div><span className="font-medium">Requested by:</span> {reviewDialog.requestedByName} ({reviewDialog.requestedByRole})</div>
                <div><span className="font-medium">Type:</span> {reviewDialog.editType} → {reviewDialog.editTarget}</div>
                <div><span className="font-medium">Summary:</span> {reviewDialog.editSummary}</div>
                <div className="flex gap-1.5 flex-wrap">
                  {reviewDialog.isCriticalPath && <Badge variant="destructive" className="text-[10px]">Critical Path</Badge>}
                  {reviewDialog.affectsRevenue && <Badge className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Revenue Impact</Badge>}
                  {reviewDialog.affectsExpenditure && <Badge className="text-[10px] bg-violet-100 text-violet-700 hover:bg-violet-100">Expenditure Impact</Badge>}
                  {reviewDialog.affectsQuality && <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100">Quality Impact</Badge>}
                </div>
              </div>
              <Textarea
                placeholder="Review comment (required for rejection)"
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                className="text-sm"
                data-testid="input-review-comment"
              />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={!reviewComment.trim() || reviewComment.trim().length < 3 || rejectMutation.isPending}
              onClick={() => reviewDialog && rejectMutation.mutate({ id: reviewDialog.id, comment: reviewComment })}
              data-testid="button-reject-edit"
            >
              {rejectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
              Reject
            </Button>
            <Button
              size="sm"
              disabled={approveMutation.isPending}
              onClick={() => reviewDialog && approveMutation.mutate({ id: reviewDialog.id, comment: reviewComment })}
              data-testid="button-approve-edit"
            >
              {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
