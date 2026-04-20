import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageSkeleton, PageError } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import { invalidateAllTaskCaches } from "@/lib/task-cache";
import { standupLaneToCanonicalStatus, toStandupLaneStatus } from "@/lib/task-status-compat";
import {
  Users, Play, Pause, Square, CheckCircle2, Timer, Rocket, Keyboard, ShieldCheck,
} from "lucide-react";

import { StandupQueue } from "./StandupQueue";
import { TaskLanes } from "./TaskLanes";
import { BlockerStrip } from "./BlockerStrip";
import { StandupSummary } from "./StandupSummary";
import {
  type Participant, type EngTask, type TaskMovement, type StandupPhase,
  MOODS, formatTime, timerColor, initials, STANDUP_ATTENDEE_ROLE_LABELS,
} from "./types";

// Target time for a single speaker — used to size the progress ring.
const SPEAKER_TARGET_SECONDS = 120;

function SpeakerProgressRing({ seconds }: { seconds: number }) {
  const clamped = Math.min(seconds, SPEAKER_TARGET_SECONDS);
  const pct = clamped / SPEAKER_TARGET_SECONDS;
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);
  const stroke = seconds >= 180 ? "stroke-red-600" : seconds >= 120 ? "stroke-amber-500" : "stroke-primary";
  return (
    <svg width={72} height={72} viewBox="0 0 72 72" className="shrink-0" aria-hidden>
      <circle cx="36" cy="36" r={radius} className="stroke-muted" strokeWidth={5} fill="none" />
      <circle
        cx="36"
        cy="36"
        r={radius}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        className={`${stroke} transition-all duration-500`}
        style={{ strokeDasharray: circumference, strokeDashoffset: dashOffset, transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}

// ── API helper ──────────────────────────────────────────────────────────

async function api(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const method = (options?.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = document.cookie
      .split("; ")
      .find((c) => c.startsWith("csrf-token="))
      ?.split("=")[1];
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const message = err?.error || err?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return res.json();
}

// ── Main Component ──────────────────────────────────────────────────────

export default function EngineeringStandupPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Session state
  const [phase, setPhase] = useState<StandupPhase>("waiting");
  const [isPaused, setIsPaused] = useState(false);
  const [queue, setQueue] = useState<Participant[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [completedIndices, setCompletedIndices] = useState<Set<number>>(new Set());
  const [skippedIndices, setSkippedIndices] = useState<Set<number>>(new Set());
  const [speakerTimings, setSpeakerTimings] = useState<Map<number, number>>(new Map());
  const [speakerSeconds, setSpeakerSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [taskMovements, setTaskMovements] = useState<TaskMovement[]>([]);
  const [moods, setMoods] = useState<Map<number, string>>(new Map());
  const [facilitatorNotes, setFacilitatorNotes] = useState<Map<number, string>>(new Map());
  const [isInitiating, setIsInitiating] = useState(false);

  // Blocker tracking across all speakers
  const [heldTasks, setHeldTasks] = useState<Array<{ taskTitle: string; userName: string; holdReason: string; blockedType?: string }>>([]);

  // Shortcuts help overlay
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Timer ref
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data fetching ─────────────────────────────────────────────────────

  const { data: schedules = [], isLoading: schedulesLoading, refetch: refetchSchedules } = useQuery<any[]>({
    queryKey: ["/api/standups/schedules"],
    queryFn: () => api("/api/standups/schedules"),
  });

  const activeScheduleId = schedules[0]?.id ? String(schedules[0].id) : "";

  const { data: allParticipants = [], isLoading: participantsLoading, refetch: refetchParticipants } = useQuery<Participant[]>({
    queryKey: ["/api/standups/schedules", activeScheduleId, "participants"],
    queryFn: () => api(`/api/standups/schedules/${activeScheduleId}/participants`),
    enabled: !!activeScheduleId,
  });

  const { data: allEngTasks = [], isLoading: allTasksLoading } = useQuery<EngTask[]>({
    queryKey: ["eng-tasks-all-standup"],
    queryFn: async () => {
      const data = await api("/api/eng/tasks");
      return Array.isArray(data) ? data : data.items || [];
    },
  });

  const taskCountByUser = useMemo(() => {
    const counts = new Map<number, number>();
    const activeStatuses = ["TO DO", "IN PROGRESS", "HOLD"];
    for (const t of allEngTasks) {
      if (activeStatuses.includes(t.status) && t.ownerUserId != null) {
        counts.set(t.ownerUserId, (counts.get(t.ownerUserId) || 0) + 1);
      }
    }
    return counts;
  }, [allEngTasks]);

  const participants = useMemo(() => {
    if (allEngTasks.length === 0) return allParticipants;
    const filtered = allParticipants.filter(p => (taskCountByUser.get(p.userId) || 0) > 0);
    return filtered.length > 0 ? filtered : allParticipants;
  }, [allParticipants, allEngTasks, taskCountByUser]);

  // Active speaker's engineering tasks
  const activeSpeaker = phase === "running" ? queue[activeIndex] : null;
  const {
    data: speakerTasksRaw = [],
    isLoading: tasksLoading,
  } = useQuery<EngTask[]>({
    queryKey: ["eng-tasks-standup", activeSpeaker?.userId],
    queryFn: async () => {
      const data = await api(`/api/eng/tasks?ownerUserId=${activeSpeaker!.userId}`);
      // API may return array or { items: [] }
      return Array.isArray(data) ? data : data.items || [];
    },
    enabled: !!activeSpeaker,
  });

  // Filter to only the 4 standup lanes and add project name
  const speakerTasks = useMemo(() => {
    return speakerTasksRaw
      .map((t) => ({
        ...t,
        status: toStandupLaneStatus(t.status) || t.status,
      }))
      .filter((t) => ["TO DO", "IN PROGRESS", "HOLD", "COMPLETE"].includes(t.status));
  }, [speakerTasksRaw]);

  // ── Timer logic ───────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "running" && !isPaused) {
      timerRef.current = setInterval(() => {
        setSpeakerSeconds(s => s + 1);
        setTotalSeconds(s => s + 1);
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, isPaused, activeIndex]);

  // ── Session controls ──────────────────────────────────────────────────

  async function initiateStandup() {
    setIsInitiating(true);
    try {
      let pList = participants;
      // Auto-seed a default schedule if none exists, then refresh data
      if (schedules.length === 0) {
        await api("/api/standups/seed-default", { method: "POST", body: JSON.stringify({}) });
        const newSchedules = await refetchSchedules();
        const newScheduleId = newSchedules.data?.[0]?.id;
        if (newScheduleId) {
          // Fetch participants directly since activeScheduleId hasn't updated yet
          const freshParticipants = await api(`/api/standups/schedules/${newScheduleId}/participants`);
          pList = freshParticipants;
          // Also update the query cache so React state catches up
          queryClient.setQueryData(
            ["/api/standups/schedules", String(newScheduleId), "participants"],
            freshParticipants,
          );
        }
        toast({ title: "Standup initiated", description: "Schedule created with all team members." });
      }
      // Start with the resolved participant list
      startStandup(pList);
      setIsInitiating(false);
    } catch (err: any) {
      toast({ title: "Failed to initiate standup", description: err.message, variant: "destructive" });
      setIsInitiating(false);
    }
  }

  function startStandup(overrideParticipants?: Participant[]) {
    let pList = overrideParticipants ?? (participants.length > 0 ? participants : []);
    if (allEngTasks.length > 0 && overrideParticipants) {
      const activeStatuses = ["TO DO", "IN PROGRESS", "HOLD"];
      const ownerIds = new Set(
        allEngTasks.filter(t => activeStatuses.includes(t.status) && t.ownerUserId != null).map(t => t.ownerUserId!)
      );
      const filtered = pList.filter(p => ownerIds.has(p.userId));
      if (filtered.length > 0) pList = filtered;
    }
    if (pList.length === 0) return;
    const q = [...pList];
    // Shuffle for fairness
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    setQueue(q);
    setActiveIndex(0);
    setCompletedIndices(new Set());
    setSkippedIndices(new Set());
    setSpeakerTimings(new Map());
    setSpeakerSeconds(0);
    setTotalSeconds(0);
    setTaskMovements([]);
    setMoods(new Map());
    setFacilitatorNotes(new Map());
    setHeldTasks([]);
    setPhase("running");
    setIsPaused(false);
  }

  function nextSpeaker() {
    if (!activeSpeaker) return;

    // Save current speaker's timing
    setSpeakerTimings(prev => {
      const next = new Map(prev);
      next.set(activeSpeaker.userId, speakerSeconds);
      return next;
    });
    setCompletedIndices(prev => new Set(prev).add(activeIndex));

    // Collect any held tasks from this speaker for the blocker strip
    const currentHolds = speakerTasks
      .filter(t => t.status === "HOLD" && t.holdReason)
      .map(t => ({
        taskTitle: t.title,
        userName: activeSpeaker.userName,
        holdReason: t.holdReason!,
        blockedType: t.blockedType || undefined,
      }));
    if (currentHolds.length > 0) {
      setHeldTasks(prev => [...prev, ...currentHolds]);
    }

    // Find next uncompleted, unskipped
    let next = activeIndex + 1;
    while (next < queue.length && (completedIndices.has(next) || skippedIndices.has(next))) {
      next++;
    }

    if (next >= queue.length) {
      // All done
      setPhase("ended");
    } else {
      setActiveIndex(next);
      setSpeakerSeconds(0);
    }
  }

  function skipSpeaker() {
    setSkippedIndices(prev => new Set(prev).add(activeIndex));

    let next = activeIndex + 1;
    while (next < queue.length && (completedIndices.has(next) || skippedIndices.has(next))) {
      next++;
    }
    if (next >= queue.length) {
      setPhase("ended");
    } else {
      setActiveIndex(next);
      setSpeakerSeconds(0);
    }
  }

  function shuffleRemaining() {
    const remaining: number[] = [];
    for (let i = activeIndex + 1; i < queue.length; i++) {
      if (!completedIndices.has(i) && !skippedIndices.has(i)) {
        remaining.push(i);
      }
    }
    if (remaining.length < 2) return;

    // Fisher-Yates shuffle over the remaining slots — build one new queue and
    // commit a single setQueue so we don't stomp on intermediate state.
    const newQueue = [...queue];
    const shuffledSlots = [...remaining];
    for (let i = shuffledSlots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledSlots[i], shuffledSlots[j]] = [shuffledSlots[j], shuffledSlots[i]];
    }
    remaining.forEach((originalSlot, idx) => {
      newQueue[originalSlot] = queue[shuffledSlots[idx]];
    });
    setQueue(newQueue);
  }

  function endStandup() {
    // Save current speaker timing if still active
    if (activeSpeaker && phase === "running") {
      setSpeakerTimings(prev => {
        const next = new Map(prev);
        next.set(activeSpeaker.userId, speakerSeconds);
        return next;
      });
      setCompletedIndices(prev => new Set(prev).add(activeIndex));
    }
    setPhase("ended");
  }

  // ── Task mutation ─────────────────────────────────────────────────────

  const moveTaskMutation = useMutation({
    mutationFn: async ({ taskId, status, holdReason, blockedType }: {
      taskId: number; status: string; holdReason?: string; blockedType?: string;
    }) => {
      const body: Record<string, unknown> = { status: standupLaneToCanonicalStatus(status) };
      if (holdReason) body.holdReason = holdReason;
      if (blockedType) body.blockedType = blockedType;
      return api(`/api/eng/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks-standup", activeSpeaker?.userId] });
      queryClient.invalidateQueries({ queryKey: ["eng-tasks-all-standup"] });
      invalidateAllTaskCaches(queryClient);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update task", description: err.message, variant: "destructive" });
    },
  });

  function handleMoveTask(taskId: number, newStatus: string, holdReason?: string, blockedType?: string) {
    const task = speakerTasks.find(t => t.id === taskId);
    if (!task || !activeSpeaker) return;

    const fromStatus = task.status;

    setTaskMovements(prev => [...prev, {
      taskId,
      taskTitle: task.title,
      userId: activeSpeaker.userId,
      userName: activeSpeaker.userName,
      fromStatus,
      toStatus: newStatus,
      holdReason,
    }]);

    moveTaskMutation.mutate({ taskId, status: newStatus, holdReason, blockedType });
  }

  const editTaskMutation = useMutation({
    mutationFn: async ({ taskId, updates }: { taskId: number; updates: Record<string, unknown> }) => {
      return api(`/api/eng/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-tasks-standup", activeSpeaker?.userId] });
      queryClient.invalidateQueries({ queryKey: ["eng-tasks-all-standup"] });
      invalidateAllTaskCaches(queryClient);
      toast({ title: "Task updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update task", description: err.message, variant: "destructive" });
    },
  });

  async function handleEditTask(taskId: number, updates: Partial<EngTask>) {
    if (Object.keys(updates).length === 0) return;
    if (updates.status && updates.status !== speakerTasks.find(t => t.id === taskId)?.status) {
      const task = speakerTasks.find(t => t.id === taskId);
      if (task && activeSpeaker) {
        setTaskMovements(prev => [...prev, {
          taskId,
          taskTitle: task.title,
          userId: activeSpeaker.userId,
          userName: activeSpeaker.userName,
          fromStatus: task.status,
          toStatus: updates.status!,
          holdReason: updates.holdReason as string | undefined,
        }]);
      }
    }
    const normalizedUpdates = { ...updates } as Partial<EngTask>;
    if (normalizedUpdates.status) {
      normalizedUpdates.status = standupLaneToCanonicalStatus(normalizedUpdates.status);
    }
    await editTaskMutation.mutateAsync({ taskId, updates: normalizedUpdates as Record<string, unknown> });
  }

  // ── Mood selection ────────────────────────────────────────────────────

  function setMood(mood: string) {
    if (!activeSpeaker) return;
    setMoods(prev => {
      const next = new Map(prev);
      next.set(activeSpeaker.userId, mood);
      return next;
    });
  }

  function setNote(note: string) {
    if (!activeSpeaker) return;
    setFacilitatorNotes(prev => {
      const next = new Map(prev);
      next.set(activeSpeaker.userId, note);
      return next;
    });
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't trigger while typing in inputs/textareas.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "?") {
        setShowShortcuts((v) => !v);
        return;
      }

      if (phase !== "running") return;

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        nextSpeaker();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        skipSpeaker();
      } else if (e.key === " ") {
        e.preventDefault();
        setIsPaused((p) => !p);
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        endStandup();
      } else if (e.key === "Escape") {
        setShowShortcuts(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, activeIndex, queue, completedIndices, skippedIndices, speakerTasks]);

  // ── Blocker count for queue ───────────────────────────────────────────
  const holdMovements = taskMovements.filter(m => m.toStatus === "HOLD");
  const totalBlockers = heldTasks.length + holdMovements.length;

  // ── Loading / error states ────────────────────────────────────────────

  const isLoading = schedulesLoading || (!!activeScheduleId && participantsLoading) || allTasksLoading;

  if (isLoading) return <PageSkeleton lines={5} />;

  // ── RENDER ────────────────────────────────────────────────────────────

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-engineering-standup">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <SectionHeader
            icon={<Users className="h-5 w-5" />}
            eyebrow="Engineering"
            title="Engineering Standup"
            description={phase === "running"
              ? `${completedIndices.size} of ${queue.length} done`
              : phase === "ended"
                ? "Standup complete"
                : "Live standup facilitator"}
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Global timer */}
          {phase === "running" && (
            <div className="flex items-center gap-1.5 text-sm tabular-nums" aria-live="polite">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono font-medium">{formatTime(totalSeconds)}</span>
            </div>
          )}

          {/* Shortcuts toggle — always available */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowShortcuts(v => !v)}
            className="gap-1.5 text-xs"
            data-testid="btn-standup-shortcuts"
            title="Keyboard shortcuts (press ?)"
          >
            <Keyboard className="h-3.5 w-3.5" />
            Shortcuts
          </Button>

          {/* Phase controls */}
          {phase === "running" && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPaused(p => !p)}
                className="gap-1"
                data-testid="btn-standup-pause"
              >
                {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {isPaused ? "Resume" : "Pause"}
              </Button>
              <Button variant="destructive" size="sm" onClick={endStandup} className="gap-1" data-testid="btn-standup-end">
                <Square className="h-3.5 w-3.5" /> End
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Keyboard shortcut help overlay */}
      {showShortcuts && (
        <div
          className="rounded-lg border bg-card shadow-sm px-4 py-3 text-xs flex flex-wrap items-center gap-x-5 gap-y-2"
          role="dialog"
          aria-label="Standup keyboard shortcuts"
          data-testid="standup-shortcut-overlay"
        >
          <span className="font-semibold text-muted-foreground uppercase tracking-wider">Shortcuts</span>
          <span><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">N</kbd> Next speaker</span>
          <span><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">S</kbd> Skip</span>
          <span><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">Space</kbd> Pause / resume</span>
          <span><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">E</kbd> End standup</span>
          <span><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">?</kbd> Toggle this help</span>
        </div>
      )}

      {/* ── WAITING PHASE — Modern launch card with attendee roster ─────── */}
      {phase === "waiting" && (
        <Card className="overflow-hidden border-primary/20">
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 py-5 flex items-center gap-4">
            <div className="rounded-full bg-primary/15 p-3">
              <Rocket className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold">Ready to stand up?</h3>
              <p className="text-xs text-muted-foreground">
                The standup cycles through attendees in a shuffled order, times each speaker, and captures blockers in real time.
              </p>
            </div>
            <Button
              size="lg"
              onClick={schedules.length > 0 && participants.length > 0 ? () => startStandup() : initiateStandup}
              disabled={isInitiating}
              className="gap-2 px-6 shrink-0"
              data-testid="btn-initiate-standup"
            >
              {isInitiating ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Setting up…
                </>
              ) : (
                <>
                  <Play className="h-5 w-5" />
                  Start standup
                </>
              )}
            </Button>
          </div>

          <CardContent className="px-6 py-4 space-y-4">
            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-xs">
              <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-foreground">Who attends this standup</div>
                <div className="text-muted-foreground mt-0.5">
                  Only the following roles are auto-invited:
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5" data-testid="standup-attendee-roles">
                  {STANDUP_ATTENDEE_ROLE_LABELS.map((r) => (
                    <Badge key={r.role} variant="outline" className="text-[10px]">{r.label}</Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border bg-card p-3">
                <div className="text-2xl font-semibold tabular-nums">{participants.length}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Eligible attendees</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-2xl font-semibold tabular-nums">{allEngTasks.filter(t => ["TO DO", "IN PROGRESS", "HOLD"].includes(t.status)).length}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active eng tasks</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-2xl font-semibold tabular-nums text-red-600">{allEngTasks.filter(t => t.status === "HOLD").length}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">On hold</div>
              </div>
            </div>

            {participants.length === 0 && allParticipants.length > 0 && allEngTasks.length > 0 && (
              <p className="text-xs text-amber-600">
                No eligible team members have active engineering tasks right now. You can still start — everyone with an active task will be queued.
              </p>
            )}
            {allParticipants.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No schedule yet — pressing <strong>Start standup</strong> creates the default Mon/Wed/Fri schedule and invites engineers, the engineering manager, the quality manager, and the COO/CEO.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── RUNNING PHASE ──────────────────────────────────────────────── */}
      {phase === "running" && activeSpeaker && (
        <div className="flex gap-4">
          {/* Left rail — queue */}
          <StandupQueue
            queue={queue}
            activeIndex={activeIndex}
            completedIndices={completedIndices}
            skippedIndices={skippedIndices}
            speakerTimings={speakerTimings}
            activeSpeakerSeconds={speakerSeconds}
            totalBlockers={totalBlockers}
            taskCounts={taskCountByUser}
            onSkip={skipSpeaker}
            onShuffle={shuffleRemaining}
            isRunning={true}
          />

          {/* Center — active speaker card + task lanes */}
          <div className="flex-1 space-y-3 min-w-0">
            {/* Speaker header */}
            <div className="flex items-center justify-between rounded-lg border bg-gradient-to-r from-primary/5 via-transparent to-transparent px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="h-12 w-12 border-2 border-primary/30">
                  <AvatarFallback className="text-sm font-semibold">{initials(activeSpeaker.userName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="font-semibold text-lg truncate">{activeSpeaker.userName}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{speakerTasks.length} active task{speakerTasks.length !== 1 ? "s" : ""}</span>
                    {activeSpeaker.userRole && (
                      <Badge variant="outline" className="text-[9px] py-0 h-4">{activeSpeaker.userRole}</Badge>
                    )}
                    <span className="text-muted-foreground">· speaker {activeIndex + 1} of {queue.length}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="relative flex items-center justify-center">
                  <SpeakerProgressRing seconds={speakerSeconds} />
                  <span className={`absolute text-sm font-mono font-bold tabular-nums ${timerColor(speakerSeconds)}`}>
                    {formatTime(speakerSeconds)}
                  </span>
                </div>
              </div>
            </div>

            {/* Task lanes */}
            <TaskLanes
              tasks={speakerTasks}
              onMoveTask={handleMoveTask}
              onEditTask={handleEditTask}
              isLoading={tasksLoading}
            />

            {/* Facilitator note + mood + next */}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Textarea
                  placeholder="Facilitator note (optional)..."
                  value={facilitatorNotes.get(activeSpeaker.userId) || ""}
                  onChange={(e) => setNote(e.target.value)}
                  className="min-h-[44px] h-11 text-sm resize-none"
                />
              </div>
              <div className="flex items-center gap-1.5">
                {MOODS.map(m => (
                  <button
                    key={m.value}
                    onClick={() => setMood(m.value)}
                    className={`text-lg p-1.5 rounded-md border transition-all ${
                      moods.get(activeSpeaker.userId) === m.value
                        ? m.color + " scale-110"
                        : "border-transparent opacity-50 hover:opacity-100"
                    }`}
                    title={m.label}
                  >
                    {m.emoji}
                  </button>
                ))}
              </div>
              <Button onClick={nextSpeaker} className="gap-1.5 h-11">
                <CheckCircle2 className="h-4 w-4" /> Next
              </Button>
            </div>

            {/* Blocker strip */}
            <BlockerStrip
              heldTasks={heldTasks}
              newHolds={holdMovements}
            />
          </div>
        </div>
      )}

      {/* ── ENDED PHASE ────────────────────────────────────────────────── */}
      {phase === "ended" && (
        <StandupSummary
          totalSeconds={totalSeconds}
          participants={queue.length > 0 ? queue : participants}
          completedCount={completedIndices.size}
          skippedCount={skippedIndices.size}
          speakerTimings={speakerTimings}
          taskMovements={taskMovements}
          moods={moods}
          facilitatorNotes={facilitatorNotes}
          onClose={() => setPhase("waiting")}
        />
      )}
    </PageShell>
  );
}
