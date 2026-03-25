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
import {
  Users, Calendar, BarChart3, Plus, Loader2, Send, Clock,
  CheckCircle2, AlertTriangle, MessageSquare,
  Smile, Meh, Frown, ThumbsUp, XCircle, History, TrendingUp,
  Settings, UserPlus, UserMinus, Copy, Download, Flame, Star, ClipboardCopy,
  ChevronLeft, ChevronRight, Play, Pause, Target, Flag,
  Timer, ArrowRight, Circle,
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

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

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

// ── PLACEHOLDER: More components below ───────────────────────────────────────

export default function StandupsPage() {
  return (
    <PageShell>
      <SectionHeader
        icon={<Users className="h-5 w-5" />}
        title="Standups"
        description="Interactive engineering standup meeting mode."
      />
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Building new meeting mode...</span>
      </div>
    </PageShell>
  );
}
