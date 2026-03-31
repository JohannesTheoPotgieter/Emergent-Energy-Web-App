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
import {
  Users, Play, Pause, Square, CheckCircle2, Timer, Rocket,
} from "lucide-react";

import { StandupQueue } from "./StandupQueue";
import { TaskLanes } from "./TaskLanes";
import { BlockerStrip } from "./BlockerStrip";
import { StandupSummary } from "./StandupSummary";
import {
  type Participant, type EngTask, type TaskMovement, type StandupPhase,
  MOODS, formatTime, timerColor, initials,
} from "./types";

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
    const validStatuses = ["TO DO", "IN PROGRESS", "HOLD", "COMPLETE"];
    return speakerTasksRaw.filter(t => validStatuses.includes(t.status));
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
    // Fisher-Yates on remaining indices
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      // Swap the actual queue entries
      const newQueue = [...queue];
      const [a, b] = [remaining[i], remaining[j]];
      [newQueue[a], newQueue[b]] = [newQueue[b], newQueue[a]];
      setQueue(newQueue);
    }
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
      const body: Record<string, unknown> = { status };
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
    await editTaskMutation.mutateAsync({ taskId, updates });
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
            <div className="flex items-center gap-1.5 text-sm tabular-nums">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono font-medium">{formatTime(totalSeconds)}</span>
            </div>
          )}

          {/* Phase controls */}
          {phase === "running" && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPaused(p => !p)}
                className="gap-1"
              >
                {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {isPaused ? "Resume" : "Pause"}
              </Button>
              <Button variant="destructive" size="sm" onClick={endStandup} className="gap-1">
                <Square className="h-3.5 w-3.5" /> End
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── WAITING PHASE — Simple Initiate Button ─────────────────────── */}
      {phase === "waiting" && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center justify-center text-center">
            <div className="rounded-full bg-primary/10 p-4 mb-4">
              <Rocket className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Ready to Stand Up?</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              Start the engineering standup session. Only team members with active tasks will participate, shuffled into a random order.
            </p>
            <Button
              size="lg"
              onClick={schedules.length > 0 && participants.length > 0 ? () => startStandup() : initiateStandup}
              disabled={isInitiating}
              className="gap-2 px-8"
            >
              {isInitiating ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Setting up...
                </>
              ) : (
                <>
                  <Play className="h-5 w-5" />
                  Initiate Standup
                </>
              )}
            </Button>
            {participants.length > 0 ? (
              <p className="text-xs text-muted-foreground mt-4">
                {participants.length} team member{participants.length !== 1 ? "s" : ""} with active tasks will participate
              </p>
            ) : allParticipants.length > 0 && allEngTasks.length > 0 ? (
              <p className="text-xs text-amber-600 mt-4">
                No team members have active engineering tasks right now.
              </p>
            ) : null}
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback>{initials(activeSpeaker.userName)}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold text-lg">{activeSpeaker.userName}</div>
                  <div className="text-xs text-muted-foreground">
                    {speakerTasks.length} active tasks
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-2xl font-mono font-bold tabular-nums ${timerColor(speakerSeconds)}`}>
                  {formatTime(speakerSeconds)}
                </span>
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
