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
  FileText, ChevronDown, ChevronUp, Loader2, Settings, Plus, Trash2, ToggleLeft, ArrowRight,
} from "lucide-react";
import { Link } from "wouter";

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
    <Link href={`/project/${encodeURIComponent(projectName)}/financial-linking`}>
      <Card className="relative overflow-hidden border-l-4 border-l-indigo-500 cursor-pointer hover:shadow-md hover:border-l-indigo-600 transition-all" data-testid="financial-integration-panel">
        <CardContent className="p-4">
          <div className="flex items-center justify-between w-full">
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
              {syncStatus && (
                <span className={`text-[10px] font-bold ${syncColor}`} data-testid="text-sync-percent">
                  {syncStatus.overallSyncPercent}% linked
                </span>
              )}
              {criticalCount > 0 && <Badge variant="destructive" className="text-[9px]" data-testid="badge-critical-count">{criticalCount} critical</Badge>}
              {warningCount > 0 && <Badge className="text-[9px] bg-amber-100 text-amber-700 hover:bg-amber-100" data-testid="badge-warning-count">{warningCount} warning{warningCount !== 1 ? "s" : ""}</Badge>}
              {pendingRequests.length > 0 && <Badge variant="outline" className="text-[9px] border-blue-300 text-blue-600" data-testid="badge-pending-edits">{pendingRequests.length} pending</Badge>}
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
