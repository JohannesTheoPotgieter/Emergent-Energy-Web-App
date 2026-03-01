import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle, AlertCircle, Info, Link2, ShieldAlert,
  CheckCircle, XCircle, Clock, TrendingUp, DollarSign,
  FileText, ChevronDown, ChevronUp, Loader2, Settings, Plus, Trash2, ToggleLeft,
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

interface IntegrationRule {
  id: number;
  projectName: string;
  ruleType: string;
  ruleConfig: string;
  isActive: boolean;
  createdByName?: string;
  createdAt: string;
}

const RULE_TYPE_LABELS: Record<string, string> = {
  budget_threshold: "Budget Threshold Alert",
  revenue_milestone_linking: "Revenue Milestone Linking",
  expenditure_auto_flag: "Expenditure Auto-Flag",
  critical_path_protection: "Critical Path Protection",
  approval_bypass: "Approval Bypass",
  variance_alert_threshold: "Variance Alert Threshold",
};

export function FinancialIntegrationPanel({ projectName }: { projectName: string }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [reviewDialog, setReviewDialog] = useState<EditRequest | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [newRuleType, setNewRuleType] = useState("");
  const [newRuleConfig, setNewRuleConfig] = useState("");

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

  const { data: rules = [] } = useQuery<IntegrationRule[]>({
    queryKey: ["financial-rules", projectName],
    queryFn: async () => {
      const res = await engFetch(`/api/financial-integration/rules/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName && !!roleAccess?.canApprove,
    staleTime: 120000,
  });

  const createRuleMutation = useMutation({
    mutationFn: async ({ ruleType, ruleConfig }: { ruleType: string; ruleConfig: string }) => {
      const res = await engFetch("/api/financial-integration/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, ruleType, ruleConfig }),
      });
      if (!res.ok) throw new Error("Failed to create rule");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rule created" });
      queryClient.invalidateQueries({ queryKey: ["financial-rules"] });
      setNewRuleType("");
      setNewRuleConfig("");
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await engFetch(`/api/financial-integration/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to toggle rule");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["financial-rules"] }),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await engFetch(`/api/financial-integration/rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete rule");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rule deleted" });
      queryClient.invalidateQueries({ queryKey: ["financial-rules"] });
    },
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

  const hasContent = warnings.length > 0 || !!syncStatus || pendingRequests.length > 0;

  const syncColor = syncStatus?.syncStatus === "good" ? "text-emerald-600" : syncStatus?.syncStatus === "partial" ? "text-amber-600" : "text-red-600";
  const syncBg = syncStatus?.syncStatus === "good" ? "bg-emerald-50" : syncStatus?.syncStatus === "partial" ? "bg-amber-50" : "bg-red-50";

  return (
    <>
      <Card className="relative overflow-hidden border-l-4 border-l-indigo-500" data-testid="financial-integration-panel">
        <CardContent className="p-4 space-y-3">
          <button
            className="flex items-center justify-between w-full text-left cursor-pointer"
            onClick={() => setExpanded(!expanded)}
            data-testid="button-toggle-integration"
          >
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
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </button>

          {expanded && syncStatus && (
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

          {expanded && warnings.length > 0 && (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
              {warnings.map((w, i) => (
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
            </div>
          )}

          {!expanded && hasContent && (
            <p className="text-[10px] text-muted-foreground">Tap to view sync status, warnings & integration rules</p>
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

          {expanded && roleAccess?.canApprove && (
            <div className="space-y-1.5 border-t pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Settings className="h-3 w-3" />
                  Integration Rules
                </div>
                <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => setShowRules(!showRules)} data-testid="button-toggle-rules">
                  {showRules ? "Hide" : "Configure"}
                </Button>
              </div>
              {showRules && (
                <div className="space-y-1.5">
                  {rules.map(rule => (
                    <div key={rule.id} className={`flex items-center gap-2 text-[11px] py-1.5 px-2 rounded border ${rule.isActive ? "bg-emerald-50 border-emerald-100" : "bg-gray-50 border-gray-200 opacity-60"}`} data-testid={`rule-${rule.id}`}>
                      <ToggleLeft className={`h-3 w-3 shrink-0 cursor-pointer ${rule.isActive ? "text-emerald-600" : "text-gray-400"}`} onClick={() => toggleRuleMutation.mutate({ id: rule.id, isActive: !rule.isActive })} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{RULE_TYPE_LABELS[rule.ruleType] || rule.ruleType}</p>
                        <p className="text-muted-foreground truncate">{rule.ruleConfig}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-red-400 hover:text-red-600" onClick={() => deleteRuleMutation.mutate(rule.id)} data-testid={`button-delete-rule-${rule.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 pt-1">
                    <Select value={newRuleType} onValueChange={setNewRuleType}>
                      <SelectTrigger className="h-7 text-[10px] flex-1" data-testid="select-rule-type">
                        <SelectValue placeholder="Rule type" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Config (e.g. 25%)"
                      value={newRuleConfig}
                      onChange={e => setNewRuleConfig(e.target.value)}
                      className="h-7 text-[10px] flex-1"
                      data-testid="input-rule-config"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0 shrink-0"
                      disabled={!newRuleType || !newRuleConfig || createRuleMutation.isPending}
                      onClick={() => createRuleMutation.mutate({ ruleType: newRuleType, ruleConfig: newRuleConfig })}
                      data-testid="button-add-rule"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
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
