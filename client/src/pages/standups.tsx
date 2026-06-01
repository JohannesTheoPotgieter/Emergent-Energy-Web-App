import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { PageShell, SectionHeader, WorkspaceNotice } from "@/components/layout/page-shell";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { useAuth } from "@/hooks/use-auth";
import { normalizeRoleForPermissions } from "@shared/schema";
import { getInitials } from "@/lib/task-formatters";

const ADMIN_ROLES = ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER"];
import {
  Users, BarChart3, Plus, Loader2, Send, Clock,
  CheckCircle2, AlertTriangle, MessageSquare,
  Smile, Meh, Frown, ThumbsUp, XCircle, TrendingUp,
  Settings, UserPlus, UserMinus, Copy, Download, Flame, Star, ClipboardCopy,
  ChevronLeft, ChevronRight, Play, Pause, Target, Flag,
} from "lucide-react";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

interface StandupSchedule {
  id: number;
  name: string;
  teamLabel: string | null;
  projectId: number | null;
  cadence: string;
  cadenceDays: number;
  anchorDate: string;
  deadlineTime: string | null;
  deadlineTimezone: string;
  isActive: boolean;
  createdAt: string;
}

interface TodayStandup {
  schedule: StandupSchedule;
  isRequired: boolean;
  hasSubmitted: boolean;
  entry: StandupEntry | null;
}

interface StandupEntry {
  id: number;
  scheduleId: number;
  userId: number;
  standupDate: string;
  whatIDid: string | null;
  whatImDoing: string | null;
  blockers: string | null;
  mood: string | null;
  isLate: boolean;
  submittedAt: string;
  userName?: string;
  userEmail?: string;
}

interface LinkedPriority {
  id: number;
  title: string;
  severity: string;
}

interface TaskItem {
  id: number;
  title: string;
  status: string;
  priority: string | null;
  endDate: string | null;
  percentComplete: number | null;
  projectId: number;
  projectName: string | null;
  linkedPriority: LinkedPriority | null;
}

interface MeetingParticipant {
  userId: number;
  userName: string | null;
  userEmail: string | null;
  isRequired: boolean;
  entry: StandupEntry | null;
  hasSubmitted: boolean;
  tasks: {
    total: number;
    overdue: TaskItem[];
    dueSoon: TaskItem[];
    inProgress: TaskItem[];
    onHold: TaskItem[];
    byPriority: {
      urgent: TaskItem[];
      high: TaskItem[];
      med: TaskItem[];
      low: TaskItem[];
    };
  };
}

interface MeetingBlocker {
  userId: number;
  userName: string | null;
  blockers: string;
  mood: string | null;
}

interface MeetingData {
  date: string;
  participants: MeetingParticipant[];
  summary: {
    total: number;
    submitted: number;
    blockerCount: number;
    blockers: MeetingBlocker[];
  };
}

interface Participant {
  id: number;
  scheduleId: number;
  userId: number;
  isRequired: boolean;
  userName: string | null;
  userEmail: string | null;
}

interface StandupAnalytics {
  totalEntries: number;
  lateEntries: number;
  totalParticipants: number;
  recentBlockers: { standupDate: string; blockers: string; userName: string }[];
  moodDistribution: { mood: string; count: number }[];
  participationRate: number;
}

interface TrendDataPoint {
  date: string;
  submissions: number;
  participationRate: number;
  blockers: number;
  avgMoodScore: number | null;
}

interface StandupTrends {
  series: TrendDataPoint[];
  totalParticipants: number;
}

interface PersonStat {
  userId: number;
  userName: string | null;
  userEmail: string | null;
  isRequired: boolean;
  totalSubmissions: number;
  participationRate: number;
  lateCount: number;
  onTimeRate: number;
  blockerCount: number;
  avgMoodScore: number | null;
  currentStreak: number;
}

interface PerPersonAnalytics {
  members: PersonStat[];
  totalStandups: number;
}

interface DigestResponse {
  text: string;
  markdown: string;
  date: string;
  scheduleName: string;
  submissionCount: number;
  participantCount: number;
  blockerCount: number;
  missingCount: number;
}

interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: string;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

const MOOD_OPTIONS = [
  { value: "great", label: "Great", icon: <ThumbsUp className="h-4 w-4" />, color: "text-emerald-600" },
  { value: "good", label: "Good", icon: <Smile className="h-4 w-4" />, color: "text-emerald-500" },
  { value: "okay", label: "Okay", icon: <Meh className="h-4 w-4" />, color: "text-amber-500" },
  { value: "struggling", label: "Struggling", icon: <Frown className="h-4 w-4" />, color: "text-orange-600" },
  { value: "blocked", label: "Blocked", icon: <XCircle className="h-4 w-4" />, color: "text-red-600" },
];

function MoodBadge({ mood }: { mood: string | null }) {
  if (!mood) return null;
  const opt = MOOD_OPTIONS.find((m) => m.value === mood);
  return opt ? (
    <span className={`flex items-center gap-1 text-xs font-medium ${opt.color}`}>
      {opt.icon} {opt.label}
    </span>
  ) : null;
}

// getInitials moved to client/src/lib/task-formatters.ts so
// the Engineering Standup avatar matches what the Engineering Board /
// My Work / Opportunity drawer Tickets section show for the same user.

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: "bg-red-100 text-red-700 border-red-200",
  High: "bg-orange-100 text-orange-700 border-orange-200",
  Med: "bg-amber-100 text-amber-700 border-amber-200",
  Low: "bg-slate-100 text-slate-600 border-slate-200",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  important: "bg-orange-100 text-orange-700 border-orange-200",
  normal: "bg-blue-100 text-blue-700 border-blue-200",
};

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const cls = PRIORITY_COLORS[priority] || "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 font-semibold ${cls}`}>
      {priority}
    </Badge>
  );
}

function CompanyPriorityBadge({ priority }: { priority: LinkedPriority }) {
  const cls = SEVERITY_COLORS[priority.severity] || SEVERITY_COLORS.normal;
  return (
    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 font-semibold gap-1 ${cls}`}>
      <Target className="h-2.5 w-2.5" />
      {priority.title}
    </Badge>
  );
}

function TaskStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  let cls = "bg-slate-100 text-slate-600";
  if (["IN PROGRESS", "NEEDS APPROVAL", "PROVIDE FEEDBACK"].includes(s)) cls = "bg-blue-100 text-blue-700";
  else if (["HOLD", "ON HOLD"].includes(s)) cls = "bg-amber-100 text-amber-700";
  else if (s === "NOT STARTED") cls = "bg-slate-100 text-slate-500";
  return (
    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 font-medium border-0 ${cls}`}>
      {status}
    </Badge>
  );
}

function formatDateShort(dateStr: string) {
  return new Date(dateStr + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00");
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Meeting Timer ────────────────────────────────────────────────────────────

function MeetingTimer({ durationSec = 120, running, onToggle, onExpired }: {
  durationSec?: number;
  running: boolean;
  onToggle: () => void;
  onExpired: () => void;
}) {
  const [remaining, setRemaining] = useState(durationSec);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset when duration changes (e.g. navigating to next person)
  useEffect(() => {
    setRemaining(durationSec);
  }, [durationSec]);

  useEffect(() => {
    if (running && remaining > 0) {
      intervalRef.current = setInterval(() => {
        setRemaining((prev) => {
          if (prev <= 1) {
            onExpired();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, remaining > 0]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const pct = (remaining / durationSec) * 100;
  const isLow = remaining <= 30;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={onToggle}
      >
        {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <div className="flex items-center gap-2 min-w-[120px]">
        <Progress
          value={pct}
          className={`h-2 flex-1 ${isLow ? "[&>div]:bg-red-500" : "[&>div]:bg-emerald-500"}`}
        />
        <span className={`text-xs font-mono font-semibold tabular-nums ${isLow ? "text-red-600" : "text-muted-foreground"}`}>
          {mins}:{secs.toString().padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

// ── Quick Submit Form (inline, compact) ──────────────────────────────────────

function QuickSubmitForm({ scheduleId, onSubmitted }: {
  scheduleId: number;
  onSubmitted: () => void;
}) {
  const [whatIDid, setWhatIDid] = useState("");
  const [whatImDoing, setWhatImDoing] = useState("");
  const [blockers, setBlockers] = useState("");
  const [mood, setMood] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const submitMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/standups/entries", {
        method: "POST",
        body: JSON.stringify({ scheduleId, whatIDid, whatImDoing, blockers, mood: mood || null }),
      }),
    onSuccess: () => {
      toast({ title: "Standup submitted" });
      queryClient.invalidateQueries({ queryKey: ["standup-meeting"] });
      queryClient.invalidateQueries({ queryKey: ["standups-today"] });
      onSubmitted();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3 p-4 rounded-lg border-2 border-dashed border-amber-200 bg-amber-50/30">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 flex items-center gap-1.5">
        <Send className="h-3 w-3" /> Quick Submit — No entry yet
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px] flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Completed
          </Label>
          <Textarea
            value={whatIDid}
            onChange={(e) => setWhatIDid(e.target.value)}
            placeholder="What did you accomplish?"
            rows={2}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] flex items-center gap-1">
            <Clock className="h-3 w-3 text-blue-600" /> Working On
          </Label>
          <Textarea
            value={whatImDoing}
            onChange={(e) => setWhatImDoing(e.target.value)}
            placeholder="What are you working on?"
            rows={2}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-orange-500" /> Blockers
          </Label>
          <Textarea
            value={blockers}
            onChange={(e) => setBlockers(e.target.value)}
            placeholder="Any blockers?"
            rows={2}
            className="text-xs"
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {MOOD_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={mood === opt.value ? "default" : "outline"}
              size="sm"
              className="gap-1 h-7 text-[10px] px-2"
              onClick={() => setMood(mood === opt.value ? "" : opt.value)}
            >
              {opt.icon}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          className="gap-1.5 h-7"
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending}
        >
          {submitMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Submit
        </Button>
      </div>
    </div>
  );
}

// ── Task Priority Panel ──────────────────────────────────────────────────────

function TaskCard({ task, todayStr }: { task: TaskItem; todayStr: string }) {
  const isOverdue = task.endDate ? task.endDate < todayStr : false;
  const days = task.endDate ? daysUntil(task.endDate) : null;
  const isDueSoon = days !== null && days >= 0 && days <= 7 && !isOverdue;

  return (
    <div className="flex items-start gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs font-medium truncate max-w-[240px]">{task.title}</p>
          <PriorityBadge priority={task.priority} />
          {isOverdue && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 bg-red-100 text-red-700 border-red-200 font-bold">
              OVERDUE
            </Badge>
          )}
          {isDueSoon && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 bg-amber-100 text-amber-700 border-amber-200 font-bold">
              DUE {days}d
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <TaskStatusBadge status={task.status} />
          {task.endDate && (
            <span className={`text-[10px] ${isOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
              Due {formatDateShort(task.endDate)}
            </span>
          )}
          {task.projectName && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
              {task.projectName}
            </span>
          )}
          {task.percentComplete != null && task.percentComplete > 0 && (
            <span className="text-[10px] text-muted-foreground font-mono">{Math.round(task.percentComplete)}%</span>
          )}
        </div>
        {task.linkedPriority && (
          <div className="mt-0.5">
            <CompanyPriorityBadge priority={task.linkedPriority} />
          </div>
        )}
      </div>
    </div>
  );
}

function TaskPriorityPanel({ tasks }: { tasks: MeetingParticipant["tasks"] }) {
  const todayStr = new Date().toISOString().split("T")[0];

  // Collect all tasks that are linked to company priorities
  const allTasks = [
    ...tasks.byPriority.urgent,
    ...tasks.byPriority.high,
    ...tasks.byPriority.med,
    ...tasks.byPriority.low,
  ];
  const priorityLinked = allTasks.filter((t) => t.linkedPriority);

  // Group priority-linked tasks by priority
  const byCompanyPriority = new Map<number, { priority: LinkedPriority; tasks: TaskItem[] }>();
  for (const t of priorityLinked) {
    const lp = t.linkedPriority!;
    const existing = byCompanyPriority.get(lp.id);
    if (existing) {
      existing.tasks.push(t);
    } else {
      byCompanyPriority.set(lp.id, { priority: lp, tasks: [t] });
    }
  }

  const groups = [
    { key: "urgent" as const, label: "Urgent", items: tasks.byPriority.urgent, color: "border-l-red-500" },
    { key: "high" as const, label: "High", items: tasks.byPriority.high, color: "border-l-orange-500" },
    { key: "med" as const, label: "Medium", items: tasks.byPriority.med, color: "border-l-amber-500" },
    { key: "low" as const, label: "Low", items: tasks.byPriority.low, color: "border-l-slate-400" },
  ];

  return (
    <div className="space-y-3">
      {/* Summary counters */}
      <div className="flex items-center gap-3 text-xs">
        <span className="font-semibold text-muted-foreground">{tasks.total} tasks</span>
        {tasks.overdue.length > 0 && (
          <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200 gap-1">
            <AlertTriangle className="h-2.5 w-2.5" /> {tasks.overdue.length} overdue
          </Badge>
        )}
        {tasks.dueSoon.length > 0 && (
          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 gap-1">
            <Clock className="h-2.5 w-2.5" /> {tasks.dueSoon.length} due soon
          </Badge>
        )}
        {tasks.onHold.length > 0 && (
          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 gap-1">
            <Pause className="h-2.5 w-2.5" /> {tasks.onHold.length} on hold
          </Badge>
        )}
      </div>

      {/* Company priority alignment section */}
      {byCompanyPriority.size > 0 && (
        <Card className="border-purple-200 bg-purple-50/30">
          <CardContent className="px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-purple-700 mb-1.5 flex items-center gap-1">
              <Target className="h-3 w-3" /> Linked to Company Priorities
            </p>
            {Array.from(byCompanyPriority.values()).map(({ priority, tasks: pTasks }) => (
              <div key={priority.id} className="mb-1.5 last:mb-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 font-semibold gap-1 ${SEVERITY_COLORS[priority.severity] || SEVERITY_COLORS.normal}`}>
                    <Flag className="h-2 w-2" />
                    {priority.severity}
                  </Badge>
                  <span className="text-[11px] font-semibold text-purple-900">{priority.title}</span>
                  <span className="text-[10px] text-purple-600">({pTasks.length} task{pTasks.length !== 1 ? "s" : ""})</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Task groups by priority */}
      <ScrollArea className="max-h-[320px]">
        <div className="space-y-2">
          {groups.map(({ key, label, items, color }) => (
            items.length > 0 && (
              <div key={key} className={`border-l-3 ${color} pl-2`}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-0.5">
                  {label} ({items.length})
                </p>
                {items.map((task) => (
                  <TaskCard key={task.id} task={task} todayStr={todayStr} />
                ))}
              </div>
            )
          ))}
          {tasks.total === 0 && (
            <div className="text-center py-4 text-xs text-muted-foreground">
              No active tasks assigned
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Participant Spotlight ─────────────────────────────────────────────────────

function ParticipantSpotlight({ participant, scheduleId, onSubmitted }: {
  participant: MeetingParticipant;
  scheduleId: number;
  onSubmitted: () => void;
}) {
  const entry = participant.entry;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="text-sm font-bold">
              {getInitials(participant.userName || "?")}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold">{participant.userName}</h3>
              <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${participant.isRequired ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
                {participant.isRequired ? "Required" : "Optional"}
              </Badge>
            </div>
            {entry ? (
              <p className="text-[11px] text-muted-foreground">
                Submitted {new Date(entry.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {entry.isLate && (
                  <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0 border-orange-200 bg-orange-50 text-orange-700">
                    Late
                  </Badge>
                )}
              </p>
            ) : (
              <p className="text-[11px] text-amber-600 font-medium">Not submitted yet</p>
            )}
          </div>
        </div>
        {entry && <MoodBadge mood={entry.mood} />}
      </div>

      {/* Two-column layout: Entry + Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Standup Entry or Quick Submit */}
        <Card>
          <CardHeader className="px-4 py-3 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Standup Update
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {entry ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Completed
                  </p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{entry.whatIDid || "—"}</p>
                </div>
                <Separator />
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Working On
                  </p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{entry.whatImDoing || "—"}</p>
                </div>
                <Separator />
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Blockers
                  </p>
                  <p className={`text-sm whitespace-pre-line ${entry.blockers ? "text-orange-700 font-medium" : "text-muted-foreground"}`}>
                    {entry.blockers || "None"}
                  </p>
                </div>
              </div>
            ) : (
              <QuickSubmitForm scheduleId={scheduleId} onSubmitted={onSubmitted} />
            )}
          </CardContent>
        </Card>

        {/* Right: Tasks */}
        <Card>
          <CardHeader className="px-4 py-3 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Flag className="h-3.5 w-3.5" /> Assigned Work
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <TaskPriorityPanel tasks={participant.tasks} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Meeting View (Carousel) ──────────────────────────────────────────────────

function MeetingView({ scheduleId }: { scheduleId: number }) {
  // Track the current speaker by stable userId, not by array position. The
  // roster refetches every 30s; if someone joins/leaves mid-standup a plain
  // index would silently point at a different person (skip/repeat). Deriving
  // the index from the current userId keeps the spotlight on the same person
  // across roster changes.
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerKey, setTimerKey] = useState(0); // forces timer reset on navigate
  const queryClient = useQueryClient();

  const { data: meeting, isLoading } = useQuery<MeetingData>({
    queryKey: ["standup-meeting", scheduleId],
    queryFn: () => apiFetch(`/api/standups/meeting/${scheduleId}`),
    refetchInterval: 30000, // refresh every 30s for live updates
  });

  const participants = meeting?.participants || [];

  // Resolve the current index from the tracked userId. Falls back to the
  // first participant when nobody is selected yet or the tracked person has
  // left the roster.
  const resolvedIdx = (() => {
    if (currentUserId == null) return 0;
    const idx = participants.findIndex((p) => p.userId === currentUserId);
    return idx >= 0 ? idx : 0;
  })();
  const current = participants[resolvedIdx];

  // Keep the tracked userId in sync once participants load / change.
  useEffect(() => {
    if (participants.length === 0) return;
    if (currentUserId == null || !participants.some((p) => p.userId === currentUserId)) {
      setCurrentUserId(participants[resolvedIdx]?.userId ?? participants[0].userId);
    }
  }, [participants, currentUserId, resolvedIdx]);

  const goTo = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, participants.length - 1));
    const target = participants[clamped];
    if (target) setCurrentUserId(target.userId);
    setTimerRunning(false);
    setTimerKey((k) => k + 1); // reset timer
  }, [participants]);

  const goNext = useCallback(() => {
    if (resolvedIdx < participants.length - 1) goTo(resolvedIdx + 1);
  }, [resolvedIdx, participants.length, goTo]);

  const goPrev = useCallback(() => {
    if (resolvedIdx > 0) goTo(resolvedIdx - 1);
  }, [resolvedIdx, goTo]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === " ") { e.preventDefault(); setTimerRunning((r) => !r); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["standup-meeting", scheduleId] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!meeting || participants.length === 0) {
    return (
      <div className="ee-empty-state">
        <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-semibold">No participants in this schedule</p>
        <p className="text-xs text-muted-foreground mt-1">Add team members to start using meeting mode.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pre-meeting summary bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="gap-1.5 text-xs font-semibold">
            <Users className="h-3.5 w-3.5" />
            {meeting.summary.submitted}/{meeting.summary.total} submitted
          </Badge>
          {meeting.summary.blockerCount > 0 && (
            <Badge variant="outline" className="gap-1.5 text-xs font-semibold bg-orange-50 text-orange-700 border-orange-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              {meeting.summary.blockerCount} blocker{meeting.summary.blockerCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MeetingTimer
            key={timerKey}
            durationSec={120}
            running={timerRunning}
            onToggle={() => setTimerRunning((r) => !r)}
            onExpired={goNext}
          />
        </div>
      </div>

      {/* Navigation + Current person */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={resolvedIdx === 0}
          onClick={goPrev}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs font-semibold text-muted-foreground flex-1 text-center">
          {resolvedIdx + 1} of {participants.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={resolvedIdx === participants.length - 1}
          onClick={goNext}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Spotlight */}
      {current && (
        <ParticipantSpotlight
          participant={current}
          scheduleId={scheduleId}
          onSubmitted={handleRefresh}
        />
      )}

      {/* Dot navigation */}
      <div className="flex items-center justify-center gap-1.5 pt-2">
        {participants.map((p, idx) => (
          <button
            key={p.userId}
            onClick={() => goTo(idx)}
            className={`w-3 h-3 rounded-full transition-all border-2 ${
              idx === resolvedIdx
                ? "border-primary bg-primary scale-110"
                : p.hasSubmitted
                  ? "border-emerald-400 bg-emerald-400"
                  : "border-slate-300 bg-slate-300"
            }`}
            title={`${p.userName || "?"} ${p.hasSubmitted ? "(submitted)" : "(pending)"}`}
          />
        ))}
      </div>
      <p className="text-[10px] text-center text-muted-foreground">
        Use <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">←</kbd> <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">→</kbd> to navigate, <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">Space</kbd> to pause/resume timer
      </p>
    </div>
  );
}

// ── Blocker Board ────────────────────────────────────────────────────────────

function BlockerBoard({ scheduleId }: { scheduleId: number }) {
  const { data: meeting, isLoading } = useQuery<MeetingData>({
    queryKey: ["standup-meeting", scheduleId],
    queryFn: () => apiFetch(`/api/standups/meeting/${scheduleId}`),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const blockers = meeting?.summary.blockers || [];

  if (blockers.length === 0) {
    return (
      <div className="ee-empty-state">
        <CheckCircle2 className="h-10 w-10 text-emerald-500/30 mb-3" />
        <p className="text-sm font-semibold">No blockers today</p>
        <p className="text-xs text-muted-foreground mt-1">The team is unblocked and moving forward.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1.5 text-xs font-semibold bg-orange-50 text-orange-700 border-orange-200">
          <AlertTriangle className="h-3.5 w-3.5" />
          {blockers.length} blocker{blockers.length !== 1 ? "s" : ""} reported today
        </Badge>
      </div>
      <div className="space-y-2">
        {blockers.map((b, i) => {
          const borderColor = b.mood === "blocked" ? "border-l-red-500" : b.mood === "struggling" ? "border-l-orange-500" : "border-l-amber-400";
          return (
            <Card key={i} className={`border-l-4 ${borderColor}`}>
              <CardContent className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className="text-[8px] font-bold">
                          {getInitials(b.userName || "?")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-semibold">{b.userName}</span>
                      <MoodBadge mood={b.mood} />
                    </div>
                    <p className="text-sm text-orange-800 whitespace-pre-line">{b.blockers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── Digest View ──────────────────────────────────────────────────────────────

function DigestView({ scheduleId }: { scheduleId: number }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(todayStr);
  const { toast } = useToast();

  const { data: digest, isLoading } = useQuery<DigestResponse>({
    queryKey: ["standup-digest", scheduleId, date],
    queryFn: () => apiFetch(`/api/standups/digest/${scheduleId}?date=${date}`),
  });

  const copyText = () => {
    if (digest) {
      navigator.clipboard.writeText(digest.text);
      toast({ title: "Copied to clipboard", description: "Plain text digest copied" });
    }
  };

  const copyMarkdown = () => {
    if (digest) {
      navigator.clipboard.writeText(digest.markdown);
      toast({ title: "Copied to clipboard", description: "Markdown digest copied" });
    }
  };

  const downloadCsv = () => {
    if (!digest) return;
    apiFetch(`/api/standups/entries/${scheduleId}?date=${date}`).then((entries: StandupEntry[]) => {
      const rows = [["Name", "Completed", "Working On", "Blockers", "Mood", "Late"].join(",")];
      for (const e of entries) {
        rows.push([
          `"${e.userName || ""}"`,
          `"${(e.whatIDid || "").replace(/"/g, '""')}"`,
          `"${(e.whatImDoing || "").replace(/"/g, '""')}"`,
          `"${(e.blockers || "").replace(/"/g, '""')}"`,
          `"${e.mood || ""}"`,
          e.isLate ? "Yes" : "No",
        ].join(","));
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `standup-${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "CSV downloaded" });
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[180px] h-8 text-xs" />
        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={copyText} disabled={!digest}>
          <ClipboardCopy className="h-3.5 w-3.5" /> Copy Text
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={copyMarkdown} disabled={!digest}>
          <Copy className="h-3.5 w-3.5" /> Copy Markdown
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={downloadCsv} disabled={!digest}>
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : digest ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="px-3 py-2 text-center">
              <p className="text-xl font-bold">{digest.submissionCount}/{digest.participantCount}</p>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase">Submitted</p>
            </CardContent></Card>
            <Card><CardContent className="px-3 py-2 text-center">
              <p className="text-xl font-bold text-orange-600">{digest.blockerCount}</p>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase">Blockers</p>
            </CardContent></Card>
            <Card><CardContent className="px-3 py-2 text-center">
              <p className="text-xl font-bold text-red-600">{digest.missingCount}</p>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase">Missing</p>
            </CardContent></Card>
            <Card><CardContent className="px-3 py-2 text-center">
              <p className="text-xl font-bold text-emerald-600">{digest.participantCount > 0 ? Math.round((digest.submissionCount / digest.participantCount) * 100) : 0}%</p>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase">Rate</p>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader className="px-4 py-3 pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Preview</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/50 rounded-lg p-3 max-h-[400px] overflow-y-auto">{digest.text}</pre>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="ee-empty-state">
          <p className="text-sm font-medium">No entries for this date</p>
        </div>
      )}
    </div>
  );
}

// ── Analytics View ───────────────────────────────────────────────────────────

function AnalyticsView({ scheduleId }: { scheduleId: number }) {
  const { data: analytics, isLoading } = useQuery<StandupAnalytics>({
    queryKey: ["standup-analytics", scheduleId],
    queryFn: () => apiFetch(`/api/standups/analytics/${scheduleId}`),
  });

  const { data: trends } = useQuery<StandupTrends>({
    queryKey: ["standup-trends", scheduleId],
    queryFn: () => apiFetch(`/api/standups/analytics/${scheduleId}/trends?days=30`),
  });

  if (isLoading || !analytics) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const onTimeRate = analytics.totalEntries > 0
    ? Math.round(((analytics.totalEntries - analytics.lateEntries) / analytics.totalEntries) * 100)
    : 0;

  const trendData = (trends?.series || []).map((d) => ({
    ...d,
    dateLabel: formatDateShort(d.date),
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Entries</p>
          <p className="text-2xl font-bold tracking-tight mt-1">{analytics.totalEntries}</p>
        </CardContent></Card>
        <Card><CardContent className="px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Participants</p>
          <p className="text-2xl font-bold tracking-tight mt-1">{analytics.totalParticipants}</p>
        </CardContent></Card>
        <Card><CardContent className="px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">On-Time Rate</p>
          <p className="text-2xl font-bold tracking-tight mt-1">{onTimeRate}%</p>
        </CardContent></Card>
        <Card><CardContent className="px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-600">Late Entries</p>
          <p className="text-2xl font-bold tracking-tight mt-1">{analytics.lateEntries}</p>
        </CardContent></Card>
      </div>

      {trendData.length > 1 && (
        <Card>
          <CardHeader className="px-4 py-3 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4" /> Participation Trend (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="participationGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(value: number) => [`${value}%`, "Participation"]}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Area type="monotone" dataKey="participationRate" stroke="#10b981" fill="url(#participationGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {trendData.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="px-4 py-3 pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Team Mood Score</CardTitle>
              <p className="text-[10px] text-muted-foreground">5 = Great, 1 = Blocked</p>
            </CardHeader>
            <CardContent className="px-2 pb-3">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trendData.filter((d) => d.avgMoodScore !== null)}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
                  <YAxis domain={[1, 5]} tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(value: number) => [value.toFixed(1), "Avg Mood"]} />
                  <Line type="monotone" dataKey="avgMoodScore" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 py-3 pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Blockers Over Time</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-3">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(value: number) => [value, "Blockers"]} />
                  <Bar dataKey="blockers" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {analytics.moodDistribution.length > 0 && (
        <Card>
          <CardHeader className="px-4 py-3 pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Mood Distribution</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex flex-wrap gap-4">
              {analytics.moodDistribution.map((m) => {
                const opt = MOOD_OPTIONS.find((o) => o.value === m.mood);
                return (
                  <div key={m.mood} className="flex items-center gap-2 text-sm">
                    <span className={opt?.color || ""}>{opt?.icon}</span>
                    <span className="font-semibold tabular-nums">{m.count}</span>
                    <span className="text-muted-foreground">{opt?.label || m.mood}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {analytics.recentBlockers.length > 0 && (
        <Card>
          <CardHeader className="px-4 py-3 pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Recent Blockers</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="space-y-2">
              {analytics.recentBlockers.map((b, i) => (
                <div key={i} className="flex items-start gap-2 border-l-3 border-l-orange-500 pl-3 py-1">
                  <div>
                    <p className="text-sm text-orange-700 font-medium">{b.blockers}</p>
                    <p className="text-[11px] text-muted-foreground">{b.userName} &middot; {b.standupDate}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Per-Person Analytics ─────────────────────────────────────────────────────

function PersonAnalyticsView({ scheduleId }: { scheduleId: number }) {
  const { data, isLoading } = useQuery<PerPersonAnalytics>({
    queryKey: ["standup-per-person", scheduleId],
    queryFn: () => apiFetch(`/api/standups/analytics/${scheduleId}/per-person`),
  });

  if (isLoading || !data) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const sorted = [...data.members].sort((a, b) => b.participationRate - a.participationRate);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{data.totalStandups} standup sessions tracked</p>
      <div className="space-y-2">
        {sorted.map((m) => {
          const moodLabel = m.avgMoodScore !== null
            ? m.avgMoodScore >= 4.5 ? "Great" : m.avgMoodScore >= 3.5 ? "Good" : m.avgMoodScore >= 2.5 ? "Okay" : m.avgMoodScore >= 1.5 ? "Low" : "Critical"
            : "—";
          const moodColor = m.avgMoodScore !== null
            ? m.avgMoodScore >= 4.5 ? "text-emerald-600" : m.avgMoodScore >= 3.5 ? "text-emerald-500" : m.avgMoodScore >= 2.5 ? "text-amber-500" : m.avgMoodScore >= 1.5 ? "text-orange-600" : "text-red-600"
            : "text-muted-foreground";

          return (
            <Card key={m.userId}>
              <CardContent className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px] font-semibold">
                        {getInitials(m.userName || "?")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-semibold">{m.userName}</p>
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 ${m.isRequired ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
                        {m.isRequired ? "Required" : "Optional"}
                      </Badge>
                    </div>
                  </div>
                  {m.currentStreak > 0 && (
                    <div className="flex items-center gap-1 text-xs font-semibold text-orange-500">
                      <Flame className="h-3.5 w-3.5" />
                      {m.currentStreak} streak
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                  <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                    <p className="text-lg font-bold tracking-tight">{m.participationRate}%</p>
                    <p className="text-[9px] text-muted-foreground font-semibold uppercase">Participation</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                    <p className="text-lg font-bold tracking-tight">{m.onTimeRate}%</p>
                    <p className="text-[9px] text-muted-foreground font-semibold uppercase">On-Time</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                    <p className="text-lg font-bold tracking-tight">{m.totalSubmissions}</p>
                    <p className="text-[9px] text-muted-foreground font-semibold uppercase">Submitted</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                    <p className="text-lg font-bold tracking-tight">{m.blockerCount}</p>
                    <p className="text-[9px] text-muted-foreground font-semibold uppercase">Blockers</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                    <p className={`text-lg font-bold tracking-tight ${moodColor}`}>{moodLabel}</p>
                    <p className="text-[9px] text-muted-foreground font-semibold uppercase">Avg Mood</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {sorted.length === 0 && (
          <div className="ee-empty-state">
            <Users className="h-8 w-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm font-medium">No participants yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Manage Participants Dialog ────────────────────────────────────────────────

function ManageParticipantsDialog({ scheduleId }: { scheduleId: number }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: participants, isLoading } = useQuery<Participant[]>({
    queryKey: ["standup-participants", scheduleId],
    queryFn: () => apiFetch(`/api/standups/schedules/${scheduleId}/participants`),
    enabled: open,
  });

  const { data: allUsers } = useQuery<TeamMember[]>({
    queryKey: ["team-members"],
    queryFn: () => apiFetch("/api/eng/team-members"),
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: ({ userId, isRequired }: { userId: number; isRequired: boolean }) =>
      apiFetch(`/api/standups/schedules/${scheduleId}/participants`, {
        method: "POST",
        body: JSON.stringify({ userId, isRequired }),
      }),
    onSuccess: () => {
      toast({ title: "Participant added" });
      queryClient.invalidateQueries({ queryKey: ["standup-participants", scheduleId] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: number) =>
      apiFetch(`/api/standups/schedules/${scheduleId}/participants/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Participant removed" });
      queryClient.invalidateQueries({ queryKey: ["standup-participants", scheduleId] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const participantUserIds = new Set((participants || []).map((p) => p.userId));
  const availableUsers = (allUsers || []).filter((u) => !participantUserIds.has(u.id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
          <Settings className="h-3.5 w-3.5" />
          Manage Team
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Participants</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Members ({participants?.length || 0})</Label>
            {isLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {(participants || []).map((p) => (
                  <div key={p.userId} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px] font-semibold">
                          {getInitials(p.userName || "?")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{p.userName || p.userEmail}</p>
                        <Badge variant="outline" className={`text-[9px] px-1 py-0 ${p.isRequired ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
                          {p.isRequired ? "Required" : "Optional"}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                      onClick={() => removeMutation.mutate(p.userId)}
                      disabled={removeMutation.isPending}
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {availableUsers.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add Member</Label>
              <ScrollArea className="max-h-[180px]">
                <div className="space-y-1">
                  {availableUsers.map((u) => (
                    <div key={u.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/50">
                      <div>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-[10px] text-muted-foreground">{u.role}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px] gap-1"
                          onClick={() => addMutation.mutate({ userId: u.id, isRequired: true })}
                          disabled={addMutation.isPending}
                        >
                          <UserPlus className="h-3 w-3" /> Required
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[10px] gap-1"
                          onClick={() => addMutation.mutate({ userId: u.id, isRequired: false })}
                          disabled={addMutation.isPending}
                        >
                          <UserPlus className="h-3 w-3" /> Optional
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Schedule Dialog ───────────────────────────────────────────────────

function CreateScheduleDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [teamLabel, setTeamLabel] = useState("");
  const [cadenceDays, setCadenceDays] = useState("2");
  const [deadlineTime, setDeadlineTime] = useState("10:00");
  const [deadlineTimezone, setDeadlineTimezone] = useState("Africa/Johannesburg");
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/standups/schedules", {
        method: "POST",
        body: JSON.stringify({
          name,
          teamLabel: teamLabel || null,
          cadenceDays: parseInt(cadenceDays),
          cadence: cadenceDays === "1" ? "DAILY" : cadenceDays === "2" ? "EVERY_2_DAYS" : cadenceDays === "3" ? "EVERY_3_DAYS" : "WEEKLY",
          deadlineTime,
          deadlineTimezone,
          anchorDate: new Date().toISOString().split("T")[0],
        }),
      }),
    onSuccess: () => {
      toast({ title: "Standup schedule created" });
      setOpen(false);
      setName("");
      setTeamLabel("");
      onCreated();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Schedule
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Standup Schedule</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Schedule Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering Bi-Daily" />
          </div>
          <div className="space-y-1.5">
            <Label>Team / Department</Label>
            <Input value={teamLabel} onChange={(e) => setTeamLabel(e.target.value)} placeholder="e.g. Engineering, PM, Quality" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={cadenceDays} onValueChange={setCadenceDays}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Daily</SelectItem>
                  <SelectItem value="2">Every 2 days</SelectItem>
                  <SelectItem value="3">Every 3 days</SelectItem>
                  <SelectItem value="7">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Submission Deadline</Label>
              <Input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Deadline Timezone</Label>
            <Select value={deadlineTimezone} onValueChange={setDeadlineTimezone}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Africa/Johannesburg">Africa/Johannesburg (SAST)</SelectItem>
                <SelectItem value="Europe/London">Europe/London (GMT/BST)</SelectItem>
                <SelectItem value="America/New_York">America/New York (EST/EDT)</SelectItem>
                <SelectItem value="America/Chicago">America/Chicago (CST/CDT)</SelectItem>
                <SelectItem value="America/Los_Angeles">America/Los Angeles (PST/PDT)</SelectItem>
                <SelectItem value="Asia/Dubai">Asia/Dubai (GST)</SelectItem>
                <SelectItem value="Asia/Kolkata">Asia/Kolkata (IST)</SelectItem>
                <SelectItem value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending} className="w-full">
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Schedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

function useIsAdminRole() {
  const { user } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const effectiveRole = normalizeRoleForPermissions(user?.role || companyRole);
  return ADMIN_ROLES.includes(effectiveRole);
}

export default function StandupsPage() {
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [tab, setTab] = useState("meeting");
  const queryClient = useQueryClient();
  const isAdmin = useIsAdminRole();

  const { data: schedules, isLoading: schedulesLoading, isError, error, refetch } = useQuery<StandupSchedule[]>({
    queryKey: ["standup-schedules"],
    queryFn: () => apiFetch("/api/standups/schedules"),
  });

  const { data: allSchedules } = useQuery<StandupSchedule[]>({
    queryKey: ["standup-schedules-all"],
    queryFn: () => apiFetch("/api/standups/schedules/all"),
  });

  const { data: todayStandups } = useQuery<TodayStandup[]>({
    queryKey: ["standups-today"],
    queryFn: () => apiFetch("/api/standups/today"),
  });

  // Auto-seed default Mon/Wed/Fri standup if none exist
  useEffect(() => {
    if (allSchedules && allSchedules.length === 0) {
      apiFetch("/api/standups/seed-default", { method: "POST" })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["standup-schedules"] });
          queryClient.invalidateQueries({ queryKey: ["standup-schedules-all"] });
        })
        .catch(() => { /* silent */ });
    }
  }, [allSchedules]);

  useEffect(() => {
    if (!selectedScheduleId && schedules && schedules.length > 0) {
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedScheduleId]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["standups-today"] });
    queryClient.invalidateQueries({ queryKey: ["standup-schedules"] });
    queryClient.invalidateQueries({ queryKey: ["standup-meeting"] });
    queryClient.invalidateQueries({ queryKey: ["standup-analytics"] });
    queryClient.invalidateQueries({ queryKey: ["standup-trends"] });
    queryClient.invalidateQueries({ queryKey: ["standup-per-person"] });
  };

  const displaySchedules = allSchedules || schedules || [];

  // Deadline countdown
  const pendingStandups = todayStandups?.filter((t) => !t.hasSubmitted) || [];
  const firstPending = pendingStandups[0];
  let timeRemaining = "";
  if (firstPending?.schedule.deadlineTime) {
    const tz = firstPending.schedule.deadlineTimezone || "Africa/Johannesburg";
    const nowStr = new Date().toLocaleString("en-US", { timeZone: tz });
    const nowLocal = new Date(nowStr);
    const [dh, dm] = firstPending.schedule.deadlineTime.split(":").map(Number);
    const deadline = new Date(nowLocal);
    deadline.setHours(dh, dm, 0, 0);
    const diffMs = deadline.getTime() - nowLocal.getTime();
    if (diffMs > 0) {
      const hrs = Math.floor(diffMs / 3600000);
      const mins = Math.floor((diffMs % 3600000) / 60000);
      timeRemaining = hrs > 0 ? ` (${hrs}h ${mins}m remaining)` : ` (${mins}m remaining)`;
    } else {
      timeRemaining = " (overdue!)";
    }
  }

  if (schedulesLoading) return <PageShell><PageSkeleton lines={5} /></PageShell>;
  if (isError) return <PageShell><PageError title="Unable to load Standups" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></PageShell>;

  return (
    <PageShell>
      <SectionHeader
        icon={<Users className="h-5 w-5" />}
        title="Standups"
        description="Interactive engineering standup meeting mode. Cycle through each team member, review tasks and priorities, and flag blockers."
        actions={isAdmin ? <CreateScheduleDialog onCreated={handleRefresh} /> : undefined}
      />

      {displaySchedules.length === 0 ? (
        <div className="ee-empty-state">
          <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-semibold">No standup schedules configured</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            {isAdmin ? "Create your first standup schedule to begin." : "Contact an admin to create a standup schedule."}
          </p>
          {isAdmin && <CreateScheduleDialog onCreated={handleRefresh} />}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Schedule selector */}
          {displaySchedules.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {displaySchedules.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedScheduleId(s.id)}
                  className={`ee-subnav-pill shrink-0 ${selectedScheduleId === s.id ? "ee-subnav-pill-active" : ""}`}
                >
                  {s.name}
                  {s.teamLabel && <span className="text-[10px] ml-1 opacity-70">({s.teamLabel})</span>}
                </button>
              ))}
            </div>
          )}

          {/* Pending submission banner */}
          {pendingStandups.length > 0 && (
            <WorkspaceNotice
              tone="warning"
              icon={<MessageSquare className="h-4 w-4" />}
              title="Standup submission pending"
              description={`You have ${pendingStandups.length} standup(s) due today${timeRemaining}`}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (firstPending) { setSelectedScheduleId(firstPending.schedule.id); setTab("meeting"); }
                  }}
                >
                  Go to Meeting
                </Button>
              }
            />
          )}

          {/* Tabs */}
          <Tabs value={tab} onValueChange={setTab}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TabsList>
                <TabsTrigger value="meeting" className="gap-1.5">
                  <Users className="h-4 w-4" />
                  Meeting
                </TabsTrigger>
                <TabsTrigger value="blockers" className="gap-1.5">
                  <AlertTriangle className="h-4 w-4" />
                  Blockers
                </TabsTrigger>
                <TabsTrigger value="digest" className="gap-1.5">
                  <ClipboardCopy className="h-4 w-4" />
                  Digest
                </TabsTrigger>
                <TabsTrigger value="analytics" className="gap-1.5">
                  <BarChart3 className="h-4 w-4" />
                  Analytics
                </TabsTrigger>
              </TabsList>
              {selectedScheduleId && (
                <ManageParticipantsDialog scheduleId={selectedScheduleId} />
              )}
            </div>

            <TabsContent value="meeting" className="mt-4">
              {selectedScheduleId ? (
                <MeetingView scheduleId={selectedScheduleId} />
              ) : (
                <div className="ee-empty-state">
                  <p className="text-sm font-medium">Select a schedule to start the meeting</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="blockers" className="mt-4">
              {selectedScheduleId ? (
                <BlockerBoard scheduleId={selectedScheduleId} />
              ) : (
                <div className="ee-empty-state">
                  <p className="text-sm font-medium">Select a schedule to view blockers</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="digest" className="mt-4">
              {selectedScheduleId ? (
                <DigestView scheduleId={selectedScheduleId} />
              ) : (
                <div className="ee-empty-state">
                  <p className="text-sm font-medium">Select a schedule to generate digest</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="analytics" className="mt-4">
              {selectedScheduleId ? (
                <div className="space-y-8">
                  <AnalyticsView scheduleId={selectedScheduleId} />
                  <Separator />
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                      <Star className="h-4 w-4" /> Per-Person Stats
                    </h3>
                    <PersonAnalyticsView scheduleId={selectedScheduleId} />
                  </div>
                </div>
              ) : (
                <div className="ee-empty-state">
                  <p className="text-sm font-medium">Select a schedule to view analytics</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </PageShell>
  );
}
