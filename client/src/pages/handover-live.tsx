import { useMemo, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useProjectDetail } from "@/hooks/use-project-v2";
import { useProjectCharter, useSaveCharter, useUpdateCharterStatus } from "@/hooks/use-stage-data";
import { CharterOverview } from "@/components/stage-workspaces/charter/CharterOverview";
import { CharterStakeholders } from "@/components/stage-workspaces/charter/CharterStakeholders";
import { CharterScope } from "@/components/stage-workspaces/charter/CharterScope";
import { CharterSchedule } from "@/components/stage-workspaces/charter/CharterSchedule";
import { CharterBudget } from "@/components/stage-workspaces/charter/CharterBudget";
import { CharterRisks } from "@/components/stage-workspaces/charter/CharterRisks";
import { DecisionLog } from "@/components/stage-workspaces/DecisionLog";
import { PageHeader } from "@/components/ui/page-header";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  CheckCircle2, XCircle, AlertTriangle, ArrowLeft, ArrowRight,
  ShieldAlert, Users, Clock, PartyPopper, Loader2, Save, Play, Save as SaveIcon,
} from "lucide-react";
import type { ProjectCharter } from "@shared/schema";

/**
 * D4 — Live handover meeting interface.
 *
 * Triggered when PD and PM are ready to hand a project over (typically
 * after cost proposal signature or financial close). Designed to be
 * screen-shared in the meeting.
 *
 * Flow:
 *   1. Attendee check-in (PD, PM, COO, CFO, HSE, Engineer, SSEG, etc.)
 *   2. Guided walk through the 6 charter sections with explicit
 *      per-section prompts
 *   3. Live decision capture via the DecisionLog panel on the right
 *   4. Acceptance decision at the end — Accept / Accept with
 *      Reservations / Reject, with reason capture
 *
 * Route: /handover/:projectId/live
 */

const STAGE_CODE = "S04_PD_PM_HANDOVER";

type AttendeeKey = "pd" | "pm" | "coo" | "cfo" | "hse" | "engineer" | "sseg" | "quality" | "construction";

const ATTENDEE_DEFS: { key: AttendeeKey; label: string }[] = [
  { key: "pd", label: "Project Developer" },
  { key: "pm", label: "Project Manager" },
  { key: "coo", label: "COO" },
  { key: "cfo", label: "CFO" },
  { key: "engineer", label: "Engineer" },
  { key: "construction", label: "Construction Mgr" },
  { key: "hse", label: "HSE Officer" },
  { key: "sseg", label: "SSEG Officer" },
  { key: "quality", label: "Quality Mgr" },
];

interface MeetingStep {
  key: string;
  title: string;
  prompt: string;
  section: (charter: Partial<ProjectCharter>, onChange: (f: string, v: any) => void) => React.ReactNode;
}

const STEPS: MeetingStep[] = [
  {
    key: "overview",
    title: "1. Overview",
    prompt: "Confirm the headline: project, site, facility type. Is anything misstated vs the signed proposal?",
    section: (charter, onChange) => <CharterOverview charter={charter} onChange={onChange} />,
  },
  {
    key: "stakeholders",
    title: "2. Stakeholders",
    prompt: "Walk the room through every named stakeholder. Are contact details current? Any new names the PM needs?",
    section: (charter, onChange) => <CharterStakeholders charter={charter} onChange={onChange} />,
  },
  {
    key: "scope",
    title: "3. Scope",
    prompt: "What's in scope, what's out. Anything the PD promised verbally that isn't in the written scope? Client-supply items clearly allocated?",
    section: (charter, onChange) => <CharterScope charter={charter} onChange={onChange} />,
  },
  {
    key: "schedule",
    title: "4. Schedule",
    prompt: "Key milestones and dates. Are all long-lead items noted? Dependencies on the client clearly flagged?",
    section: (charter, onChange) => <CharterSchedule charter={charter} onChange={onChange} />,
  },
  {
    key: "budget",
    title: "5. Budget",
    prompt: "Commercial summary. Does the PM accept the cost assumptions? Margin targets confirmed? Any PO constraints?",
    section: (charter, onChange) => <CharterBudget charter={charter} onChange={onChange} />,
  },
  {
    key: "risks",
    title: "6. Risks",
    prompt: "Walk the risk register. Anything the PD knows about that isn't listed? Owners assigned? Top 3 risks clear?",
    section: (charter, onChange) => <CharterRisks charter={charter} onChange={onChange} />,
  },
];

export default function HandoverLive() {
  const { projectId: projectIdStr } = useParams<{ projectId: string }>();
  const projectId = Number(projectIdStr);
  const isValidId = Number.isFinite(projectId) && projectId > 0;
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data: project, isLoading, error } = useProjectDetail(isValidId ? projectId : undefined);
  const { data: charterResult } = useProjectCharter(isValidId ? projectId : undefined);
  const saveCharterMutation = useSaveCharter(isValidId ? projectId : undefined);
  const updateCharterStatusMutation = useUpdateCharterStatus(isValidId ? projectId : undefined);

  const [meetingStarted, setMeetingStarted] = useState(false);
  const [attendees, setAttendees] = useState<Set<AttendeeKey>>(new Set());
  const [stepIdx, setStepIdx] = useState(0);
  const [stepNotes, setStepNotes] = useState<Record<string, string>>({});
  const [acceptanceDecision, setAcceptanceDecision] = useState<"accepted" | "accepted_with_reservations" | "rejected" | null>(null);
  const [acceptanceReason, setAcceptanceReason] = useState("");
  const [charterDraft, setCharterDraft] = useState<Partial<ProjectCharter>>({});
  const [charterDirty, setCharterDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCharterChange = useCallback((field: string, value: any) => {
    setCharterDraft((prev) => ({ ...prev, [field]: value }));
    setCharterDirty(true);
  }, []);

  const charter = useMemo(
    () => ({ ...(charterResult?.charter || {}), ...charterDraft }),
    [charterResult?.charter, charterDraft],
  );

  const toggleAttendee = (key: AttendeeKey) => {
    setAttendees((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSaveCharter = () => {
    saveCharterMutation.mutate(charterDraft, {
      onSuccess: () => {
        setCharterDraft({});
        setCharterDirty(false);
        toast({ title: "Charter saved", description: "All edits persisted." });
      },
      onError: () => {
        toast({ title: "Save failed", description: "Retry in a moment.", variant: "destructive" });
      },
    });
  };

  const recordAcceptance = async () => {
    if (!acceptanceDecision) return;
    setSaving(true);
    try {
      // Post to the existing collaboration-workflow acceptance endpoint;
      // downstream Stage4PdPmHandover surfaces the record via
      // AcceptanceWorkflow.
      await apiRequest("POST", `/api/projects/${projectId}/acceptances`, {
        stageCode: STAGE_CODE,
        decision: acceptanceDecision,
        reason: acceptanceReason.trim() || undefined,
        attendees: Array.from(attendees),
        sectionNotes: stepNotes,
      });
      if (acceptanceDecision === "accepted") {
        await updateCharterStatusMutation.mutateAsync("accepted");
      }
      toast({
        title: acceptanceDecision === "rejected" ? "Handover rejected" : "Handover recorded",
        description: "Decision captured. PM workspace updated.",
      });
      qc.invalidateQueries({ queryKey: [`v2-project-detail`, projectId] });
      navigate(`/project/${encodeURIComponent(project?.project?.projectName || String(projectId))}`);
    } catch (err) {
      toast({
        title: "Couldn't record decision",
        description: err instanceof Error ? err.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isValidId) return <PageError message="Invalid project id" />;
  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load project" />;

  const projectName = project?.project?.projectName ?? `Project #${projectId}`;
  const currentStep = STEPS[stepIdx];
  const atLastStep = stepIdx === STEPS.length - 1;
  const isFinalDecision = meetingStarted && atLastStep;

  return (
    <PageLayout
      data-testid="handover-live-page"
      header={
        <PageHeader
          title={`Handover: ${projectName}`}
          subtitle="Live meeting workspace — guided walkthrough of the project charter."
          actions={
            <Button variant="outline" size="sm" onClick={() => navigate(`/project/${encodeURIComponent(projectName)}`)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Leave meeting
            </Button>
          }
        />
      }
    >
      {/* Room bar — attendees + meeting state */}
      <Card data-testid="handover-room-bar">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Room — check attendees in
            <Badge variant="outline" className="text-[10px]">
              {attendees.size} / {ATTENDEE_DEFS.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-1.5">
            {ATTENDEE_DEFS.map(({ key, label }) => {
              const checked = attendees.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleAttendee(key)}
                  data-testid={`attendee-${key}`}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    checked
                      ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                      : "bg-card text-muted-foreground border-border hover:bg-[hsl(var(--surface-tint))]"
                  }`}
                >
                  {checked ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3 opacity-50" />}
                  {label}
                </button>
              );
            })}
          </div>
          {!meetingStarted && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Tick each role as the person joins (in-person or on Teams). Start when the room is ready.
              </p>
              <Button
                size="sm"
                onClick={() => setMeetingStarted(true)}
                disabled={attendees.size === 0}
                data-testid="btn-start-meeting"
              >
                <Play className="h-3.5 w-3.5 mr-1" /> Start meeting
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {meetingStarted && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          {/* Left: guided steps */}
          <div className="xl:col-span-3 space-y-4">
            {/* Step indicator */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  {currentStep.title}
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    Step {stepIdx + 1} of {STEPS.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="rounded-md border bg-[hsl(var(--surface-tint))]/60 p-3">
                  <p className="text-sm font-medium text-foreground">Facilitator prompt</p>
                  <p className="text-sm text-muted-foreground mt-1">{currentStep.prompt}</p>
                </div>
                {currentStep.section(charter, handleCharterChange)}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Notes captured this section</label>
                  <Textarea
                    value={stepNotes[currentStep.key] ?? ""}
                    onChange={(e) => setStepNotes((prev) => ({ ...prev, [currentStep.key]: e.target.value }))}
                    placeholder="Anything raised by the room. Becomes part of the meeting minutes."
                    rows={3}
                    data-testid={`notes-${currentStep.key}`}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Step navigation */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                disabled={stepIdx === 0}
                data-testid="btn-prev-step"
              >
                <ArrowLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              {charterDirty && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveCharter}
                  disabled={saveCharterMutation.isPending}
                  data-testid="btn-save-charter"
                >
                  {saveCharterMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Save edits
                </Button>
              )}
              <div className="flex-1" />
              {!atLastStep ? (
                <Button size="sm" onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))} data-testid="btn-next-step">
                  Next <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  Final step — record decision below
                </Badge>
              )}
            </div>

            {/* Final acceptance decision */}
            {isFinalDecision && (
              <Card data-testid="handover-acceptance">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <PartyPopper className="h-4 w-4 text-primary" />
                    PM acceptance decision
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Handover is NOT done when the meeting is held — it's done when the PM confirms readiness and all reserved items are closed. Capture the decision and any reservations here.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <AcceptanceOption
                      active={acceptanceDecision === "accepted"}
                      onClick={() => setAcceptanceDecision("accepted")}
                      icon={<CheckCircle2 className="h-5 w-5" />}
                      tone="emerald"
                      label="Accept"
                      sub="PM accepts fully"
                      dataKey="decision-accept"
                    />
                    <AcceptanceOption
                      active={acceptanceDecision === "accepted_with_reservations"}
                      onClick={() => setAcceptanceDecision("accepted_with_reservations")}
                      icon={<AlertTriangle className="h-5 w-5" />}
                      tone="amber"
                      label="Accept w/ reservations"
                      sub="PM accepts, needs items closed"
                      dataKey="decision-reserve"
                    />
                    <AcceptanceOption
                      active={acceptanceDecision === "rejected"}
                      onClick={() => setAcceptanceDecision("rejected")}
                      icon={<XCircle className="h-5 w-5" />}
                      tone="red"
                      label="Reject"
                      sub="PM rejects — return to PD"
                      dataKey="decision-reject"
                    />
                  </div>
                  {acceptanceDecision && acceptanceDecision !== "accepted" && (
                    <div className="space-y-1">
                      <label className="text-xs">
                        {acceptanceDecision === "rejected" ? "Rejection reason (required)" : "Reservations / items to close"}
                      </label>
                      <Textarea
                        value={acceptanceReason}
                        onChange={(e) => setAcceptanceReason(e.target.value)}
                        rows={3}
                        placeholder="The PD will see this on return."
                        data-testid="input-acceptance-reason"
                      />
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button
                      onClick={recordAcceptance}
                      disabled={
                        saving ||
                        !acceptanceDecision ||
                        (acceptanceDecision !== "accepted" && !acceptanceReason.trim())
                      }
                      data-testid="btn-record-acceptance"
                    >
                      {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <SaveIcon className="h-4 w-4 mr-1" />}
                      Record decision
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: live decision log */}
          <div className="xl:col-span-1">
            <DecisionLog projectId={projectId} stageCode={STAGE_CODE} showUpstream={false} />
          </div>
        </div>
      )}
    </PageLayout>
  );
}

function AcceptanceOption({
  active, onClick, icon, tone, label, sub, dataKey,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  tone: "emerald" | "amber" | "red";
  label: string;
  sub: string;
  dataKey: string;
}) {
  const toneClasses = {
    emerald: active ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "hover:border-emerald-200",
    amber: active ? "border-amber-400 bg-amber-50 text-amber-800" : "hover:border-amber-200",
    red: active ? "border-red-400 bg-red-50 text-red-800" : "hover:border-red-200",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`btn-${dataKey}`}
      className={`flex flex-col items-start p-3 rounded-md border bg-card transition-colors ${toneClasses}`}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <span className="text-[11px] text-muted-foreground mt-0.5">{sub}</span>
    </button>
  );
}
