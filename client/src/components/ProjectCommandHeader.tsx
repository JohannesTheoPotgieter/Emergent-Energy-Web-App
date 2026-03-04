import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, User, Activity, TrendingUp, DollarSign,
  CalendarDays, Target, Loader2, ChevronDown,
} from "lucide-react";
import { POGenerator } from "@/components/POGenerator";
import CaptureDeliverable from "@/components/CaptureDeliverable";
import { PROJECT_PHASE_LABELS, type ProjectPhase } from "@shared/schema";

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
  nextMilestone: { name: string; date: string | null; allPaid: boolean } | null;
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
      <span className={`w-2 h-2 rounded-full ${cls} shadow-sm shadow-current`} />
      <span className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase">{label}</span>
    </div>
  );
}

function StatBlock({ label, value, color, suffix }: { label: string; value: string; color?: string; suffix?: string }) {
  return (
    <div className="text-center px-2">
      <p className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-lg font-bold leading-tight ${color || "text-[var(--cmd-text)]"}`}>
        {value}{suffix && <span className="text-xs font-normal text-[var(--cmd-text-muted)]">{suffix}</span>}
      </p>
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

  return (
    <div className="command-header" data-testid="project-command-header">
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/projects")} className="gap-1.5 text-[var(--cmd-text-muted)] hover:text-[var(--cmd-text)] hover:bg-card/5 h-7 px-2" data-testid="button-back">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="text-xs">Projects</span>
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
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-[var(--cmd-border)] bg-[var(--cmd-bg-card)] text-[var(--cmd-text-secondary)] hover:bg-[var(--cmd-bg-panel)] transition-colors ${isAdmin ? "cursor-pointer" : "cursor-default"}`}
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
                      <Select
                        value={pd === "—" ? "__unassigned" : pd}
                        onValueChange={(val) => {
                          const newPd = val === "__unassigned" ? "" : val;
                          if (projectInfoId) {
                            engFetchPatch(`/api/lifecycle-board/projects/${projectInfoId}`, { pd: newPd })
                              .then(() => { queryClient.invalidateQueries({ queryKey: ["projects-summary"] }); queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] }); });
                          }
                        }}
                      >
                        <SelectTrigger className="h-6 text-[11px] w-auto min-w-[90px] border-[var(--cmd-border)] bg-transparent text-[var(--cmd-text-secondary)] border-dashed" data-testid="select-detail-pd">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unassigned">Unassigned</SelectItem>
                          {pdAssignableUsers.map((u) => (
                            <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[var(--cmd-text-secondary)]">
                      <User className="h-3.5 w-3.5 text-[var(--cmd-text-muted)]" /> PD: <span className="font-medium">{pd}</span>
                    </span>
                  )}

                  {isAdmin ? (
                    <span className="flex items-center gap-1.5 text-[var(--cmd-text-secondary)]">
                      <User className="h-3.5 w-3.5 text-[var(--cmd-text-muted)]" /> PM:
                      <Select
                        value={pm === "—" ? "__unassigned" : pm}
                        onValueChange={(val) => {
                          const newPm = val === "__unassigned" ? "" : val;
                          const matched = pmAssignableUsers.find((u) => u.name === newPm);
                          if (projectInfoId) {
                            engFetchPatch(`/api/lifecycle-board/projects/${projectInfoId}`, { pm: newPm, pmUserId: matched?.id ?? null })
                              .then(() => { queryClient.invalidateQueries({ queryKey: ["projects-summary"] }); queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] }); });
                          }
                        }}
                      >
                        <SelectTrigger className="h-6 text-[11px] w-auto min-w-[90px] border-[var(--cmd-border)] bg-transparent text-[var(--cmd-text-secondary)] border-dashed" data-testid="select-detail-pm">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unassigned">Unassigned</SelectItem>
                          {pmAssignableUsers.map((u) => (
                            <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--cmd-border)] bg-[var(--cmd-bg-card)] transition-colors ${canSetRag ? "hover:bg-[var(--cmd-bg-panel)] cursor-pointer" : "cursor-default"}`}
                    data-testid="button-rag-status"
                  >
                    <span className={`w-3 h-3 rounded-full ${ragDotClass} shadow-sm`} />
                    <span className="text-xs font-semibold text-[var(--cmd-text)]">{ragLabel}</span>
                    {canSetRag && <ChevronDown className="h-3 w-3 text-[var(--cmd-text-muted)]" />}
                  </button>
                </div>

                <div className="flex items-center gap-3 bg-[var(--cmd-bg-card)] rounded-lg border border-[var(--cmd-border)] px-3 py-2">
                  <RagIndicator color={scheduleRag} label="Sch" />
                  <RagIndicator color={costRag} label="Cost" />
                  <RagIndicator color={qualityRag} label="Qual" />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--cmd-border)] bg-[var(--cmd-bg-panel)]">
            <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-[var(--cmd-border)]">
              <div className="p-3 text-center" data-testid="kpi-contract">
                <p className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase tracking-wider mb-0.5">Contract</p>
                <p className="text-base sm:text-lg font-bold text-[var(--cmd-text)]">R{(contractValue / 1000000).toFixed(1)}M</p>
              </div>
              <div className="p-3 text-center" data-testid="kpi-revenue">
                <p className="text-[10px] font-medium text-[var(--cmd-text-muted)] uppercase tracking-wider mb-0.5">Rev Realised</p>
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
                <p className={`text-xs font-semibold truncate ${nextMilestone?.allPaid ? "text-[var(--cmd-green)]" : "text-[var(--cmd-text-secondary)]"}`}>
                  {nextMilestone
                    ? nextMilestone.allPaid
                      ? "All Paid ✓"
                      : `${nextMilestone.name.length > 18 ? nextMilestone.name.substring(0, 18) + "…" : nextMilestone.name}`
                    : "—"}
                </p>
                {nextMilestone && !nextMilestone.allPaid && nextMilestone.date && (
                  <p className="text-[10px] text-[var(--cmd-text-muted)] mt-0.5">
                    {new Date(nextMilestone.date).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--cmd-border)] bg-[var(--cmd-bg)]">
            <div className="h-1 bg-[var(--cmd-bg-card)] overflow-hidden">
              <div
                className="h-full transition-all duration-700 ease-out"
                style={{
                  width: `${completionNum}%`,
                  background: `linear-gradient(90deg, var(--cmd-brand) 0%, var(--cmd-brand-light) 100%)`,
                }}
              />
            </div>
          </div>
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
              <Select value={newRag} onValueChange={setNewRag}>
                <SelectTrigger data-testid="select-rag-status">
                  <SelectValue placeholder="Select status..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GREEN">
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Green — Healthy</span>
                  </SelectItem>
                  <SelectItem value="AMBER">
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Amber — At Risk</span>
                  </SelectItem>
                  <SelectItem value="RED">
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Red — Critical</span>
                  </SelectItem>
                </SelectContent>
              </Select>
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
