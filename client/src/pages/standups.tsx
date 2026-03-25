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
