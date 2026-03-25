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

// ── PLACEHOLDER: Components below ────────────────────────────────────────────

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
