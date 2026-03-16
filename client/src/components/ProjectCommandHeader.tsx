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
  CalendarDays, Target, Loader2, ChevronDown,
  AlertTriangle, ShoppingCart, Shield, GitPullRequest, Wrench, CheckCircle2,
} from "lucide-react";
import { POGenerator } from "@/components/POGenerator";
import CaptureDeliverable from "@/components/CaptureDeliverable";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";
import { formatNextMilestoneSummary, type NextMilestoneSummary } from "@/lib/next-milestone";

function getPhaseLabel(phase: string | null): string {
  if (!phase) return "Unknown";
  return PROJECT_PHASE_LABELS[phase as ProjectPhase] || phase;
}

const PHASE_ACCENT: Record<string, string> = {
  P0_FIRST_ASSESSMENT: "border-slate-400",
  P1_COST_PROPOSAL_DESIGN: "border-violet-400",
  P2_PD_PM_HANDOVER: "border-indigo-400",
  P3_DETAILED_DESIGN_PROC_RELEASE: "border-blue-400",
  P4_CONSTRUCTION_INSTALLATION: "border-amber-400",
  P5_COMMISSIONING_TESTING: "border-orange-400",
  P6_HANDOVER_CLIENT_MATRIARCH: "border-teal-400",
  P7_CLOSEOUT_POSTMORTEM: "border-emerald-400",
};

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
  pdAssignableUsers: { id: number; name: string; username: string; role: string }[];
  pmAssignableUsers: { id: number; name: string; username: string; role: string }[];
  onPhaseChangeClick: () => void;
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

function StatBlock({ label, value, color, suffix }: { label: string; value: string; color?: string; suffix?: string }) {
  return (
    <div className="text-center px-3 py-1">
      <p className="text-[10px] font-semibold text-[var(--cmd-text-muted)] uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg sm:text-xl font-bold leading-none ${color || "text-[var(--cmd-text)]"}`}>
        {value}{suffix && <span className="text-xs font-normal text-[var(--cmd-text-muted)] ml-0.5">{suffix}</span>}
      </p>
    </div>
  );
}

function useAlertStripData(projectInfoId: number | null) {
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
    enabled,
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

  const allLoading = procurement.isLoading && raid.isLoading && changes.isLoading && commissioning.isLoading;
  const allFailed = procurement.isError && raid.isError && changes.isError && commissioning.isError;
  const anyLoaded = procurement.isSuccess || raid.isSuccess || changes.isSuccess || commissioning.isSuccess;

  return {
    overdueProcurement,
    openRaid,
    activeChanges,
    incompleteCommissioning,
    allLoading,
    allFailed,
    anyLoaded,
  };
}

function AlertStrip({ projectInfoId }: { projectInfoId: number | null }) {
  const {
    overdueProcurement,
    openRaid,
    activeChanges,
    incompleteCommissioning,
    allLoading,
    allFailed,
    anyLoaded,
  } = useAlertStripData(projectInfoId);

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

  const totalAlerts = overdueProcurement + openRaid + activeChanges + incompleteCommissioning;
  const hasAlerts = totalAlerts > 0;

  const badges: { key: string; count: number; label: string; icon: React.ReactNode; color: "red" | "amber" }[] = [];

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
      className={`border-t border-[var(--cmd-border)] px-4 py-1.5 ${hasAlerts ? "bg-amber-50/50" : "bg-green-50/50"}`}
      data-testid="alert-strip"
    >
      <div className="flex items-center gap-2 flex-wrap">
        {hasAlerts ? (
          <>
            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
            {badges.map((b) => (
              <span
                key={b.key}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-default ${
                  b.color === "red"
                    ? "bg-red-100 text-red-700 border border-red-200"
                    : "bg-amber-100 text-amber-700 border border-amber-200"
                }`}
                data-testid={`alert-badge-${b.key}`}
                title={`${b.count} ${b.label}`}
              >
                {b.icon}
                <span>{b.count}</span>
                <span className="hidden sm:inline">{b.label}</span>
              </span>
            ))}
          </>
        ) : anyLoaded ? (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200 cursor-default"
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
  pdAssignableUsers, pmAssignableUsers, onPhaseChangeClick,
}: CommandHeaderProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [ragDialogOpen, setRagDialogOpen] = useState(false);
  const [newRag, setNewRag] = useState<string>(ragStatus || "");
  const [ragComment, setRagComment] = useState("");

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
      queryClient.invalidateQueries({ queryKey: ["projects-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
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

  const phaseAccent = phase ? PHASE_ACCENT[phase] || "border-slate-400" : "border-slate-400";
  const nextMilestoneDisplay = formatNextMilestoneSummary(nextMilestone, { truncateAt: 18 });

  return (
    <div className="command-header" data-testid="project-command-header">
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/projects")} className="gap-1.5 text-[var(--cmd-text-muted)] hover:text-[var(--cmd-text)] hover:bg-gray-100 h-7 px-2" data-testid="button-back">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="text-xs">Project List</span>
        </Button>
      </div>

      <div className="rounded-xl border border-[var(--cmd-border)] bg-[var(--cmd-bg)] overflow-hidden" style={{ borderRadius: '12px' }}>
        <div className={`border-l-4 ${phaseAccent}`}>
          <div className="p-4 sm:p-5">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div className="space-y-3 min-w-0 flex-1">
                <div className="flex items-start gap-3 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-heading font-bold text-[var(--cmd-text)] leading-tight" data-testid="text-project-name">
                    {displayName}
                  </h1>
                  <button
                    onClick={onPhaseChangeClick}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-[var(--cmd-border)] bg-white text-[var(--cmd-text-secondary)] hover:bg-gray-50 transition-colors ${isAdmin ? "cursor-pointer" : "cursor-default"}`}
                    disabled={!isAdmin}
                    data-testid="badge-project-phase"
                  >
                    {getPhaseLabel(phase)}
                    {isAdmin && <ChevronDown className="h-3 w-3 opacity-50" />}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
                  {isAdmin ? (
                    <span className="flex items-center gap-1.5 text-[var(--cmd-text-secondary)]">
                      <User className="h-3.5 w-3.5 text-[var(--cmd-text-muted)]" /> PD:
                      <SearchableSelect
                        value={pd === "—" ? "__unassigned" : pd}
                        onValueChange={(val) => {
                          const newPd = val === "__unassigned" ? "" : val;
                          if (projectInfoId) {
                            engFetchPatch(`/api/lifecycle-board/projects/${projectInfoId}`, { pd: newPd })
                              .then(() => { queryClient.invalidateQueries({ queryKey: ["projects-summary"] }); queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] }); });
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
                              .then(() => { queryClient.invalidateQueries({ queryKey: ["projects-summary"] }); queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] }); });
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
                    <span className="font-medium">{completion}</span>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <CaptureDeliverable projectId={projectInfoId ?? undefined} projectName={projectName} />
                  <POGenerator projectName={projectName} projectManager={pm !== "—" ? pm : undefined} />
                </div>
              </div>

              <div className="flex flex-col items-end gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { if (canSetRag && projectInfoId) { setNewRag(ragStatus || ""); setRagDialogOpen(true); } }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--cmd-border)] bg-white transition-colors ${canSetRag ? "hover:bg-gray-50 cursor-pointer" : "cursor-default"}`}
                    data-testid="button-rag-status"
                  >
                    <span className={`w-3 h-3 rounded-full ${ragDotClass} shadow-sm`} />
                    <span className="text-xs font-semibold text-[var(--cmd-text)]">{ragLabel}</span>
                    {canSetRag && <ChevronDown className="h-3 w-3 text-[var(--cmd-text-muted)]" />}
                  </button>
                </div>

                <div className="flex items-center gap-3 bg-white rounded-lg border border-[var(--cmd-border)] px-3 py-2">
                  <RagIndicator color={scheduleRag} label="Sch" />
                  <RagIndicator color={costRag} label="Cost" />
                  <RagIndicator color={qualityRag} label="Qual" />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--cmd-border)]" style={{ background: 'var(--cmd-bg-panel)' }}>
            <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-[var(--cmd-border)]">
              <div className="p-3 text-center" data-testid="kpi-contract">
                <p className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase tracking-wider mb-0.5">Contract</p>
                <p className="text-base sm:text-lg font-bold text-[var(--cmd-text)]">R{(contractValue / 1000000).toFixed(1)}M</p>
              </div>
              <div className="p-3 text-center" data-testid="kpi-revenue">
                <p className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase tracking-wider mb-0.5">Inflows Realised</p>
                <p className={`text-base sm:text-lg font-bold ${revenueRealisedPct >= 80 ? "text-[var(--cmd-green)]" : revenueRealisedPct >= 40 ? "text-[var(--cmd-amber)]" : "text-[var(--cmd-text)]"}`}>{revenueRealisedPct.toFixed(1)}%</p>
              </div>
              <div className="p-3 text-center" data-testid="kpi-cos">
                <p className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase tracking-wider mb-0.5">COS Realised</p>
                <p className="text-base sm:text-lg font-bold text-[var(--cmd-text)]">{cosRealisedPct.toFixed(1)}%</p>
              </div>
              <div className="p-3 text-center" data-testid="kpi-margin">
                <p className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase tracking-wider mb-0.5">Margin Δ</p>
                <p className={`text-base sm:text-lg font-bold ${marginDelta >= 0 ? "text-[var(--cmd-green)]" : "text-[var(--cmd-red)]"}`}>
                  {marginDelta >= 0 ? "+" : ""}{marginDelta.toFixed(1)}%
                </p>
              </div>
              <div className="p-3 text-center col-span-2 sm:col-span-1" data-testid="kpi-milestone">
                <p className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase tracking-wider mb-0.5">Next Milestone</p>
                <p className={`text-xs font-semibold truncate ${nextMilestoneDisplay.allPaid ? "text-[var(--cmd-green)]" : "text-[var(--cmd-text-secondary)]"}`}>
                  {nextMilestoneDisplay.label}
                </p>
                {nextMilestoneDisplay.dateLabel && (
                  <p className="text-[10px] text-[var(--cmd-text-muted)] mt-0.5">{nextMilestoneDisplay.dateLabel}</p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--cmd-border)] bg-[var(--cmd-bg)]">
            <div className="h-1 bg-gray-200 overflow-hidden">
              <div
                className="h-full transition-all duration-700 ease-out"
                style={{
                  width: `${completionNum}%`,
                  background: `linear-gradient(90deg, var(--cmd-brand) 0%, var(--cmd-brand-light) 100%)`,
                }}
              />
            </div>
          </div>

          <AlertStrip projectInfoId={projectInfoId} />
        </div>
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
