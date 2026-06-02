import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, User, Activity, TrendingUp, DollarSign,
  CalendarDays, Target, Loader2, ChevronDown, ArrowUpRight,
  AlertTriangle, ShoppingCart, Shield, GitPullRequest, Wrench, CheckCircle2,
  FileWarning, Ban, ClipboardCheck,
} from "lucide-react";
import { POGenerator } from "@/components/POGenerator";
import CaptureDeliverable from "@/components/CaptureDeliverable";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import { formatNextMilestoneSummary, type NextMilestoneSummary } from "@/lib/next-milestone";
import { buildProjectSummaryChipDestinations, type ProjectSummaryChipKey } from "@/lib/project-summary-chip-navigation";
import { summarizeImportLineage } from "@/lib/project-detail-navigation";
import { invalidateProjectV2Queries } from "@/hooks/use-project-v2";
import type { ProjectImportLineage } from "@shared/api-types/project-v2";

function getPhaseLabel(phase: string | null): string {
  if (!phase) return "Unknown";
  return PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase;
}

interface CommandHeaderProps {
  projectName: string;
  displayName: string;
  phase: string | null;
  pd: string;
  pm: string;
  sizeKwp: string;
  completion: string;
  completionNum: number;
  contractValue: number;
  revenueRealisedPct: number;
  cosRealisedPct: number;
  marginDelta: number;
  scheduleRag: "green" | "amber" | "red";
  costRag: "green" | "amber" | "red";
  qualityRag: "green" | "amber" | "red";
  ragStatus: string | null;
  nextMilestone: NextMilestoneSummary | null | unknown;
  projectInfoId: number | null;
  isAdmin: boolean;
  canSetRag: boolean;
  canViewFinance: boolean;
  canViewQuality: boolean;
  canViewProcurement: boolean;
  importLineage?: ProjectImportLineage | null;
  pdAssignableUsers: { id: number; name: string; username: string; role: string }[];
  pmAssignableUsers: { id: number; name: string; username: string; role: string }[];
}

function RagIndicator({ color, label }: { color: "green" | "amber" | "red"; label: string }) {
  const cls = color === "green" ? "bg-[var(--cmd-green)]" : color === "amber" ? "bg-[var(--cmd-amber)]" : "bg-[var(--cmd-red)]";
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${color}`}>
      <span className={`w-2 h-2 rounded-full ${cls}`} />
      <span className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase">{label}</span>
    </div>
  );
}

// One KPI cell in the headline metric strip. Keeps the strip readable
// with a small uppercase label over a bold value, and a single muted
// "Restricted" state when the viewer can't see finance numbers.
function KpiCell({
  testid, label, children, span,
}: {
  testid: string;
  label: string;
  children: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div className={`px-3 py-2.5 text-center ${span ? "col-span-2 sm:col-span-1" : ""}`} data-testid={testid}>
      <p className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase tracking-wider mb-0.5">{label}</p>
      {children}
    </div>
  );
}

function RestrictedValue() {
  return <p className="text-xs font-semibold text-[var(--cmd-text-muted)] leading-none">Restricted</p>;
}

function useAlertStripData(projectInfoId: number | null, projectName: string | undefined, gates: { quality: boolean; procurement: boolean }) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const fetchOpts = { headers, credentials: "include" as RequestCredentials };
  const enabled = !!projectInfoId;

  const procurement = useQuery({
    queryKey: ["alert-procurement", projectInfoId],
    queryFn: async () => {
      const res = await fetch(`/api/procurement/project/${projectInfoId}`, fetchOpts);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: enabled && gates.procurement,
    staleTime: 60000,
    retry: false,
  });

  const raid = useQuery({
    queryKey: ["alert-raid", projectInfoId],
    queryFn: async () => {
      const res = await fetch(`/api/raid/project/${projectInfoId}`, fetchOpts);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled,
    staleTime: 60000,
    retry: false,
  });

  const changes = useQuery({
    queryKey: ["alert-changes", projectInfoId],
    queryFn: async () => {
      const res = await fetch(`/api/change-requests/project/${projectInfoId}`, fetchOpts);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled,
    staleTime: 60000,
    retry: false,
  });

  const commissioning = useQuery({
    queryKey: ["alert-commissioning", projectInfoId],
    queryFn: async () => {
      const res = await fetch(`/api/commissioning/project/${projectInfoId}`, fetchOpts);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled,
    staleTime: 60000,
    retry: false,
  });

  const qualityEnabled = !!projectName && gates.quality;
  const qualitySummary = useQuery<{
    governance?: {
      evidenceGapCount?: number;
      blockedHandover?: boolean;
      riskLevel?: string;
      pendingReviewCount?: number;
      overdueCount?: number;
      handoverBlockingItemCount?: number;
      criticalContributorItemCount?: number;
    };
  }>({
    queryKey: ["alert-quality-summary", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/quality/project/${encodeURIComponent(projectName!)}/summary`, fetchOpts);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: qualityEnabled,
    staleTime: 60000,
    retry: false,
  });

  const today = new Date().toISOString().split("T")[0];
  const closedProcStatuses = ["received", "invoiced", "closed"];
  const overdueProcurement = (procurement.data as any[] || []).filter(
    (item: any) => item.required_date && item.required_date < today && !closedProcStatuses.includes(item.status)
  ).length;

  const openRaid = (raid.data as any[] || []).filter(
    (item: any) => item.status === "open" || item.status === "in_progress" || item.status === "mitigating"
  ).length;

  const activeChanges = (changes.data as any[] || []).filter(
    (item: any) => item.status !== "closed" && item.status !== "rejected"
  ).length;

  const incompleteCommissioning = (commissioning.data as any[] || []).filter(
    (item: any) => item.status !== "approved" && item.status !== "closed"
  ).length;

  const gov = qualitySummary.data?.governance;
  const evidenceGaps = gov?.evidenceGapCount ?? 0;
  // Use item-level counts that exactly match the QualityTab drill-down sets
  // so badge counts equal the number of rows shown after click-through.
  const handoverBlockingItems = gov?.handoverBlockingItemCount ?? 0;
  const criticalContributorItems = gov?.criticalContributorItemCount ?? 0;
  // A "Handover Blocked" badge only appears when there is at least one item
  // contributing to the block; the underlying handover may also be blocked
  // for non-item reasons but those have their own indicators elsewhere.
  const handoverBlockedBadgeCount = (gov?.blockedHandover === true) ? handoverBlockingItems : 0;
  // A "Quality CRITICAL" badge only appears when the risk level is critical
  // AND there is at least one item-level contributor to drill into; this
  // keeps the badge count and drill-down list in sync.
  const qualityCriticalBadgeCount = (gov?.riskLevel === "critical") ? criticalContributorItems : 0;
  const pendingApprovals = gov?.pendingReviewCount ?? 0;
  const qualityAlertCount =
    evidenceGaps +
    (handoverBlockedBadgeCount > 0 ? 1 : 0) +
    (qualityCriticalBadgeCount > 0 ? 1 : 0) +
    (pendingApprovals > 0 ? 1 : 0);

  const allLoading = procurement.isLoading && raid.isLoading && changes.isLoading && commissioning.isLoading && qualitySummary.isLoading;
  const allFailed = procurement.isError && raid.isError && changes.isError && commissioning.isError && qualitySummary.isError;
  const anyLoaded = procurement.isSuccess || raid.isSuccess || changes.isSuccess || commissioning.isSuccess || qualitySummary.isSuccess;

  return {
    overdueProcurement,
    openRaid,
    activeChanges,
    incompleteCommissioning,
    evidenceGaps,
    handoverBlockedBadgeCount,
    qualityCriticalBadgeCount,
    pendingApprovals,
    qualityAlertCount,
    allLoading,
    allFailed,
    anyLoaded,
  };
}

function AlertStrip({
  projectInfoId,
  projectName,
  canViewQuality,
  canViewProcurement,
}: {
  projectInfoId: number | null;
  projectName?: string;
  canViewQuality: boolean;
  canViewProcurement: boolean;
}) {
  const [, setLocation] = useLocation();
  const {
    overdueProcurement,
    openRaid,
    activeChanges,
    incompleteCommissioning,
    evidenceGaps,
    handoverBlockedBadgeCount,
    qualityCriticalBadgeCount,
    pendingApprovals,
    qualityAlertCount,
    allLoading,
    allFailed,
    anyLoaded,
  } = useAlertStripData(projectInfoId, projectName, { quality: canViewQuality, procurement: canViewProcurement });

  if (!projectInfoId) return null;
  if (allFailed) return null;

  if (allLoading) {
    return (
      <div className="border-t border-[var(--cmd-border)] bg-gray-50 px-4 py-1.5" data-testid="alert-strip-loading">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
          <span className="text-[10px] text-gray-400">Checking cross-module alerts...</span>
        </div>
      </div>
    );
  }

  const totalAlerts = overdueProcurement + openRaid + activeChanges + incompleteCommissioning + qualityAlertCount;
  const hasAlerts = totalAlerts > 0;

  const badges: { key: ProjectSummaryChipKey; count: number; label: string; icon: React.ReactNode; color: "red" | "amber" }[] = [];
  const destinations = projectName ? buildProjectSummaryChipDestinations(projectName) : {};

  if (handoverBlockedBadgeCount > 0) {
    badges.push({ key: "handover-blocked", count: handoverBlockedBadgeCount, label: "Handover Blocked", icon: <Ban className="h-3 w-3" />, color: "red" });
  }
  if (qualityCriticalBadgeCount > 0) {
    badges.push({ key: "quality-risk", count: qualityCriticalBadgeCount, label: "Quality CRITICAL", icon: <AlertTriangle className="h-3 w-3" />, color: "red" });
  }
  if (evidenceGaps > 0) {
    badges.push({ key: "evidence-gaps", count: evidenceGaps, label: "Evidence Gaps", icon: <FileWarning className="h-3 w-3" />, color: "red" });
  }
  if (pendingApprovals > 0) {
    badges.push({ key: "pending-approvals", count: pendingApprovals, label: "Pending Approvals", icon: <ClipboardCheck className="h-3 w-3" />, color: "amber" });
  }
  if (overdueProcurement > 0) {
    badges.push({ key: "procurement", count: overdueProcurement, label: "Overdue Procurement", icon: <ShoppingCart className="h-3 w-3" />, color: "red" });
  }
  if (openRaid > 0) {
    badges.push({ key: "raid", count: openRaid, label: "Open RAID", icon: <Shield className="h-3 w-3" />, color: "amber" });
  }
  if (activeChanges > 0) {
    badges.push({ key: "changes", count: activeChanges, label: "Active Changes", icon: <GitPullRequest className="h-3 w-3" />, color: "amber" });
  }
  if (incompleteCommissioning > 0) {
    badges.push({ key: "commissioning", count: incompleteCommissioning, label: "Incomplete Commissioning", icon: <Wrench className="h-3 w-3" />, color: "amber" });
  }

  return (
    <div
      className={`border-t border-[var(--cmd-border)] px-4 py-1.5 ${hasAlerts ? "bg-amber-50/50" : "bg-emerald-50/40"}`}
      data-testid="alert-strip"
    >
      <div className="flex items-center gap-2 flex-wrap">
        {hasAlerts ? (
          <>
            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
            {badges.map((b) => (
              (() => {
                const destination = destinations[b.key];
                const isClickable = !!destination;
                return (
              <button
                key={b.key}
                type="button"
                onClick={() => destination && setLocation(destination.path)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                  b.color === "red"
                    ? "bg-red-100 text-red-700 border-red-200"
                    : "bg-amber-100 text-amber-700 border-amber-200"
                } ${
                  isClickable
                    ? "cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    : "cursor-default"
                }`}
                data-testid={`alert-badge-${b.key}`}
                title={destination?.title || `${b.count} ${b.label}`}
                aria-label={destination?.ariaLabel || `${b.count} ${b.label}`}
                disabled={!isClickable}
              >
                {b.icon}
                <span>{b.count}</span>
                <span className="hidden sm:inline">{b.label}</span>
              </button>
                );
              })()
            ))}
          </>
        ) : anyLoaded ? (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 cursor-default"
            data-testid="alert-badge-all-clear"
          >
            <CheckCircle2 className="h-3 w-3" />
            All Clear
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectCommandHeader({
  projectName, displayName, phase, pd, pm, sizeKwp, completion, completionNum,
  contractValue, revenueRealisedPct, cosRealisedPct, marginDelta,
  scheduleRag, costRag, qualityRag, ragStatus,
  nextMilestone, projectInfoId, isAdmin, canSetRag,
  canViewFinance, canViewQuality, canViewProcurement, importLineage,
  pdAssignableUsers, pmAssignableUsers,
}: CommandHeaderProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [ragDialogOpen, setRagDialogOpen] = useState(false);
  const [newRag, setNewRag] = useState<string>(ragStatus || "");
  const [ragComment, setRagComment] = useState("");
  // Secondary identity (PD/PM, size, completion, health breakdown, import
  // detail) is tucked behind this toggle so the resting header stays a
  // single compact bar. Closed by default — the strong-declutter default.
  const [detailsOpen, setDetailsOpen] = useState(false);

  const ragMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/lifecycle-board/projects/${projectInfoId}/rag`, {
        method: "POST", headers, credentials: "include",
        body: JSON.stringify({ ragStatus: newRag, comment: ragComment }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Failed to update RAG"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Health status updated" });
      invalidateProjectV2Queries(queryClient, projectInfoId, projectName);
      setRagDialogOpen(false);
      setRagComment("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const engFetchPatch = async (url: string, body: any) => {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(url, { method: "PATCH", headers, credentials: "include", body: JSON.stringify(body) });
  };

  const overallRag = ragStatus?.toUpperCase() || null;
  const ragDotClass = overallRag === "GREEN" ? "bg-[var(--cmd-green)]"
    : overallRag === "AMBER" ? "bg-[var(--cmd-amber)]"
    : overallRag === "RED" ? "bg-[var(--cmd-red)]"
    : "bg-[var(--cmd-text-muted)]";

  const ragLabel = overallRag === "GREEN" ? "Healthy"
    : overallRag === "AMBER" ? "At Risk"
    : overallRag === "RED" ? "Critical"
    : "Not Set";

  const nextMilestoneDisplay = formatNextMilestoneSummary(nextMilestone, { truncateAt: 18 });
  const importStatus = summarizeImportLineage(importLineage);

  return (
    <div className="command-header" data-testid="project-command-header">
      <div className="rounded-xl border border-[var(--cmd-border)] bg-[var(--cmd-bg)] shadow-sm overflow-hidden">
        {/* ── Identity bar — always visible. Back · name · phase · import ·
              health · primary actions · details toggle. One clean row. ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/projects")}
            className="gap-1.5 text-[var(--cmd-text-muted)] hover:text-[var(--cmd-text)] hover:bg-gray-100 h-7 px-2 shrink-0"
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-xs hidden sm:inline">Projects</span>
          </Button>

          <h1
            className="text-lg sm:text-xl font-heading font-bold text-[var(--cmd-text)] leading-tight truncate min-w-0"
            data-testid="text-project-name"
            title={displayName}
          >
            {displayName}
          </h1>

          <button
            onClick={() => isAdmin && setLocation("/lifecycle-board")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[var(--cmd-border)] bg-white text-[var(--cmd-text-secondary)] hover:bg-gray-50 transition-colors shrink-0 ${isAdmin ? "cursor-pointer" : "cursor-default"}`}
            disabled={!isAdmin}
            title={isAdmin ? "Manage phase on Lifecycle Board" : "Project phase"}
            data-testid="badge-project-phase"
          >
            {getPhaseLabel(phase)}
            {isAdmin && <ArrowUpRight className="h-3 w-3 opacity-50" />}
          </button>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] shrink-0 ${
              importStatus.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : importStatus.tone === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-gray-200 bg-gray-50 text-gray-700"
            }`}
            data-testid="project-import-lineage"
            title={importStatus.detail}
          >
            Tracker import: <span className="font-semibold">{importStatus.label}</span>
          </span>

          <div className="flex-1 min-w-[0.5rem]" />

          <button
            onClick={() => { if (canSetRag && projectInfoId) { setNewRag(ragStatus || ""); setRagDialogOpen(true); } }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--cmd-border)] bg-white transition-colors shrink-0 ${canSetRag ? "hover:bg-gray-50 cursor-pointer" : "cursor-default"}`}
            data-testid="button-rag-status"
            title={canSetRag ? "Set project health" : `Project health: ${ragLabel}`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${ragDotClass} shadow-sm`} />
            <span className="text-xs font-semibold text-[var(--cmd-text)]">{ragLabel}</span>
            {canSetRag && <ChevronDown className="h-3 w-3 text-[var(--cmd-text-muted)]" />}
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <CaptureDeliverable projectId={projectInfoId ?? undefined} projectName={projectName} />
            {canViewProcurement && <POGenerator projectName={projectName} projectManager={pm !== "—" ? pm : undefined} />}
          </div>

          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--cmd-border)] bg-white text-xs font-medium text-[var(--cmd-text-secondary)] hover:bg-gray-50 transition-colors shrink-0"
            aria-expanded={detailsOpen}
            data-testid="toggle-command-details"
          >
            Details
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* ── Headline KPIs — always visible. Finance values mask to
              "Restricted" for viewers without finance access. ── */}
        <div className="grid grid-cols-2 sm:grid-cols-5 border-t border-[var(--cmd-border)] divide-x divide-[var(--cmd-border)]">
          <KpiCell testid="kpi-contract" label="Contract">
            {canViewFinance ? (
              <p className="text-base sm:text-lg font-bold text-[var(--cmd-text)] leading-none">R{(contractValue / 1000000).toFixed(1)}M</p>
            ) : <RestrictedValue />}
          </KpiCell>
          <KpiCell testid="kpi-revenue" label="Inflows Realised">
            {canViewFinance ? (
              <p className={`text-base sm:text-lg font-bold leading-none ${revenueRealisedPct >= 80 ? "text-[var(--cmd-green)]" : revenueRealisedPct >= 40 ? "text-[var(--cmd-amber)]" : "text-[var(--cmd-text)]"}`}>{revenueRealisedPct.toFixed(1)}%</p>
            ) : <RestrictedValue />}
          </KpiCell>
          <KpiCell testid="kpi-cos" label="COS Realised">
            {canViewFinance ? (
              <p className="text-base sm:text-lg font-bold text-[var(--cmd-text)] leading-none">{cosRealisedPct.toFixed(1)}%</p>
            ) : <RestrictedValue />}
          </KpiCell>
          <KpiCell testid="kpi-margin" label="Margin Δ">
            {canViewFinance ? (
              <p className={`text-base sm:text-lg font-bold leading-none ${marginDelta >= 0 ? "text-[var(--cmd-green)]" : "text-[var(--cmd-red)]"}`}>
                {marginDelta >= 0 ? "+" : ""}{marginDelta.toFixed(1)}%
              </p>
            ) : <RestrictedValue />}
          </KpiCell>
          <KpiCell testid="kpi-milestone" label="Next Milestone" span>
            {canViewFinance ? (
              <>
                <p className={`text-xs font-semibold truncate leading-tight ${nextMilestoneDisplay.allPaid ? "text-[var(--cmd-green)]" : "text-[var(--cmd-text-secondary)]"}`}>
                  {nextMilestoneDisplay.label}
                </p>
                {nextMilestoneDisplay.dateLabel && (
                  <p className="text-[10px] text-[var(--cmd-text-muted)] mt-0.5">{nextMilestoneDisplay.dateLabel}</p>
                )}
              </>
            ) : <RestrictedValue />}
          </KpiCell>
        </div>

        {/* completion ribbon */}
        <div className="h-1 bg-gray-200 overflow-hidden">
          <div
            className="h-full transition-all duration-700 ease-out"
            style={{
              width: `${completionNum}%`,
              background: `linear-gradient(90deg, var(--cmd-brand) 0%, var(--cmd-brand-light) 100%)`,
            }}
          />
        </div>

        {/* ── Details panel — collapsible. PD/PM, size, completion, the
              Sch/Cost/Qual health breakdown, and full import lineage. ── */}
        {detailsOpen && (
          <div className="border-t border-[var(--cmd-border)] bg-gray-50/60 px-4 py-3" data-testid="command-details-panel">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
              {isAdmin ? (
                <span className="flex items-center gap-1.5 text-[var(--cmd-text-secondary)]">
                  <User className="h-3.5 w-3.5 text-[var(--cmd-text-muted)]" /> PD:
                  <SearchableSelect
                    value={pd === "—" ? "__unassigned" : pd}
                    onValueChange={(val) => {
                      const newPd = val === "__unassigned" ? "" : val;
                      if (projectInfoId) {
                        engFetchPatch(`/api/lifecycle-board/projects/${projectInfoId}`, { pd: newPd })
                          .then(() => { invalidateProjectV2Queries(queryClient, projectInfoId, projectName); });
                      }
                    }}
                    triggerClassName="h-6 text-[11px] w-auto min-w-[90px] border-[var(--cmd-border)] bg-transparent text-[var(--cmd-text-secondary)] border-dashed"
                    placeholder="Unassigned"
                    data-testid="select-detail-pd"
                    options={[
                      { value: "__unassigned", label: "Unassigned" },
                      ...pdAssignableUsers.map((u) => ({ value: u.name, label: u.name })),
                    ]}
                  />
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[var(--cmd-text-secondary)]">
                  <User className="h-3.5 w-3.5 text-[var(--cmd-text-muted)]" /> PD: <span className="font-medium">{pd}</span>
                </span>
              )}

              {isAdmin ? (
                <span className="flex items-center gap-1.5 text-[var(--cmd-text-secondary)]">
                  <User className="h-3.5 w-3.5 text-[var(--cmd-text-muted)]" /> PM:
                  <SearchableSelect
                    value={pm === "—" ? "__unassigned" : pm}
                    onValueChange={(val) => {
                      const newPm = val === "__unassigned" ? "" : val;
                      const matched = pmAssignableUsers.find((u) => u.name === newPm);
                      if (projectInfoId) {
                        engFetchPatch(`/api/lifecycle-board/projects/${projectInfoId}`, { pm: newPm, pmUserId: matched?.id ?? null })
                          .then(() => { invalidateProjectV2Queries(queryClient, projectInfoId, projectName); });
                      }
                    }}
                    triggerClassName="h-6 text-[11px] w-auto min-w-[90px] border-[var(--cmd-border)] bg-transparent text-[var(--cmd-text-secondary)] border-dashed"
                    placeholder="Unassigned"
                    data-testid="select-detail-pm"
                    options={[
                      { value: "__unassigned", label: "Unassigned" },
                      ...pmAssignableUsers.map((u) => ({ value: u.name, label: u.name })),
                    ]}
                  />
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[var(--cmd-text-secondary)]">
                  <User className="h-3.5 w-3.5 text-[var(--cmd-text-muted)]" /> PM: <span className="font-medium">{pm}</span>
                </span>
              )}

              <span className="flex items-center gap-1.5 text-[var(--cmd-text-secondary)]">
                <Activity className="h-3.5 w-3.5 text-[var(--cmd-text-muted)]" />
                <span className="font-medium">{sizeKwp}</span>
              </span>

              <span className="flex items-center gap-1.5 text-[var(--cmd-text-secondary)]">
                <TrendingUp className="h-3.5 w-3.5 text-[var(--cmd-text-muted)]" />
                <span className="font-medium">{completion} complete</span>
              </span>

              <span className="flex items-center gap-3 sm:ml-auto bg-white rounded-lg border border-[var(--cmd-border)] px-3 py-1.5">
                <RagIndicator color={scheduleRag} label="Sch" />
                <RagIndicator color={costRag} label="Cost" />
                <RagIndicator color={qualityRag} label="Qual" />
              </span>
            </div>
            <p className="mt-2 text-[11px] text-[var(--cmd-text-muted)]" title={importStatus.detail}>{importStatus.detail}</p>
          </div>
        )}

        <AlertStrip
          projectInfoId={projectInfoId}
          projectName={projectName}
          canViewQuality={canViewQuality}
          canViewProcurement={canViewProcurement}
        />
      </div>

      <Dialog open={ragDialogOpen} onOpenChange={setRagDialogOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-rag-update">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Set Project Health
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Health Status</Label>
              <SearchableSelect
                value={newRag}
                onValueChange={setNewRag}
                placeholder="Select status..."
                data-testid="select-rag-status"
                options={[
                  { value: "GREEN", label: "Green — Healthy" },
                  { value: "AMBER", label: "Amber — At Risk" },
                  { value: "RED", label: "Red — Critical" },
                ]}
              />
            </div>
            <div>
              <Label className="text-xs">Comment (optional)</Label>
              <Textarea
                value={ragComment}
                onChange={(e) => setRagComment(e.target.value)}
                placeholder="Reason for status change..."
                className="mt-1"
                data-testid="input-rag-comment"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRagDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => ragMutation.mutate()}
              disabled={!newRag || ragMutation.isPending}
              data-testid="button-save-rag"
            >
              {ragMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
