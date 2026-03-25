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
