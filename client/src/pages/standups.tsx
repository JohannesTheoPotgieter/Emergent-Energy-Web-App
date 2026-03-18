import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import {
  Users, Calendar, BarChart3, Settings, Plus, Loader2, Send, Clock,
  CheckCircle2, AlertTriangle, MessageSquare, TrendingUp, Search,
  Smile, Meh, Frown, ThumbsUp, XCircle, History,
} from "lucide-react";

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

interface Suggestions {
  whatIDid: string[];
  whatImDoing: string[];
}

// ── Mood helpers ─────────────────────────────────────────────────────────────

const MOOD_OPTIONS = [
  { value: "great", label: "Great", icon: <ThumbsUp className="h-4 w-4" />, color: "text-emerald-600" },
  { value: "good", label: "Good", icon: <Smile className="h-4 w-4" />, color: "text-green-600" },
  { value: "okay", label: "Okay", icon: <Meh className="h-4 w-4" />, color: "text-yellow-600" },
  { value: "struggling", label: "Struggling", icon: <Frown className="h-4 w-4" />, color: "text-orange-600" },
  { value: "blocked", label: "Blocked", icon: <XCircle className="h-4 w-4" />, color: "text-red-600" },
];

function MoodBadge({ mood }: { mood: string | null }) {
  if (!mood) return null;
  const opt = MOOD_OPTIONS.find((m) => m.value === mood);
  return opt ? (
    <span className={`flex items-center gap-1 text-xs ${opt.color}`}>
      {opt.icon} {opt.label}
    </span>
  ) : null;
}

// ── Standup Form ─────────────────────────────────────────────────────────────

function StandupForm({ scheduleId, existing, onSubmitted }: {
  scheduleId: number;
  existing: StandupEntry | null;
  onSubmitted: () => void;
}) {
  const [whatIDid, setWhatIDid] = useState(existing?.whatIDid || "");
  const [whatImDoing, setWhatImDoing] = useState(existing?.whatImDoing || "");
  const [blockers, setBlockers] = useState(existing?.blockers || "");
  const [mood, setMood] = useState(existing?.mood || "");
  const { toast } = useToast();

  // Load suggestions
  const { data: suggestions } = useQuery<Suggestions>({
    queryKey: ["standup-suggestions"],
    queryFn: () => apiFetch("/api/standups/suggestions"),
    staleTime: 60000,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/standups/entries", {
        method: "POST",
        body: JSON.stringify({ scheduleId, whatIDid, whatImDoing, blockers, mood: mood || null }),
      }),
    onSuccess: () => {
      toast({ title: existing ? "Standup updated" : "Standup submitted" });
      onSubmitted();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* What I did */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          What I did
        </label>
        <Textarea
          value={whatIDid}
          onChange={(e) => setWhatIDid(e.target.value)}
          placeholder="What did you accomplish since last standup?"
          rows={3}
        />
        {suggestions?.whatIDid && suggestions.whatIDid.length > 0 && !whatIDid && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Suggestions from recent activity:</p>
            {suggestions.whatIDid.map((s, i) => (
              <button
                key={i}
                className="block text-xs text-primary hover:underline"
                onClick={() => setWhatIDid((prev) => (prev ? prev + "\n" : "") + s)}
              >
                + {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* What I'm doing */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-blue-600" />
          What I'm doing
        </label>
        <Textarea
          value={whatImDoing}
          onChange={(e) => setWhatImDoing(e.target.value)}
          placeholder="What are you working on today?"
          rows={3}
        />
        {suggestions?.whatImDoing && suggestions.whatImDoing.length > 0 && !whatImDoing && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Current tasks:</p>
            {suggestions.whatImDoing.map((s, i) => (
              <button
                key={i}
                className="block text-xs text-primary hover:underline"
                onClick={() => setWhatImDoing((prev) => (prev ? prev + "\n" : "") + s)}
              >
                + {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Blockers */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          Blockers
        </label>
        <Textarea
          value={blockers}
          onChange={(e) => setBlockers(e.target.value)}
          placeholder="Any blockers or impediments? Leave empty if none."
          rows={2}
        />
      </div>

      {/* Mood */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">How are you feeling?</label>
        <div className="flex gap-2">
          {MOOD_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={mood === opt.value ? "default" : "outline"}
              size="sm"
              className="gap-1"
              onClick={() => setMood(mood === opt.value ? "" : opt.value)}
            >
              {opt.icon}
              <span className="hidden sm:inline">{opt.label}</span>
            </Button>
          ))}
        </div>
      </div>

      <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending} className="w-full gap-1.5">
        {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {existing ? "Update Standup" : "Submit Standup"}
      </Button>
    </div>
  );
}

// ── Team View ────────────────────────────────────────────────────────────────

function TeamView({ scheduleId }: { scheduleId: number }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(todayStr);

  const { data: entries, isLoading } = useQuery<StandupEntry[]>({
    queryKey: ["standup-entries", scheduleId, date],
    queryFn: () => apiFetch(`/api/standups/entries/${scheduleId}?date=${date}`),
  });

  const { data: participants } = useQuery<Participant[]>({
    queryKey: ["standup-participants", scheduleId],
    queryFn: () => apiFetch(`/api/standups/schedules/${scheduleId}/participants`),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const submittedUserIds = new Set((entries || []).map((e) => e.userId));
  const missingParticipants = (participants || []).filter((p) => !submittedUserIds.has(p.userId));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-[180px] h-8"
        />
        <span className="text-sm text-muted-foreground">
          {entries?.length || 0} / {participants?.length || 0} submitted
        </span>
      </div>

      <div className="space-y-3">
        {(entries || []).map((entry) => (
          <Card key={entry.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs">
                      {(entry.userName || "?").split(" ").map((n) => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{entry.userName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(entry.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {entry.isLate && <Badge variant="destructive" className="ml-1.5 text-[9px] px-1 py-0">Late</Badge>}
                    </p>
                  </div>
                </div>
                <MoodBadge mood={entry.mood} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Done
                  </p>
                  <p className="text-muted-foreground whitespace-pre-line">{entry.whatIDid || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-blue-700 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Doing
                  </p>
                  <p className="text-muted-foreground whitespace-pre-line">{entry.whatImDoing || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-orange-700 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Blockers
                  </p>
                  <p className={`whitespace-pre-line ${entry.blockers ? "text-orange-700" : "text-muted-foreground"}`}>
                    {entry.blockers || "None"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {missingParticipants.length > 0 && (
          <Card className="border-dashed">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground mb-2">Awaiting submission:</p>
              <div className="flex flex-wrap gap-2">
                {missingParticipants.map((p) => (
                  <Badge key={p.userId} variant="outline" className="gap-1">
                    <Users className="h-3 w-3" />
                    {p.userName || p.userEmail || `User ${p.userId}`}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {(!entries || entries.length === 0) && missingParticipants.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No standup scheduled for this date</p>
        )}
      </div>
    </div>
  );
}

// ── History View ─────────────────────────────────────────────────────────────

function HistoryView({ scheduleId }: { scheduleId: number }) {
  const { data, isLoading } = useQuery<{
    entries: Record<string, StandupEntry[]>;
    total: number;
  }>({
    queryKey: ["standup-history", scheduleId],
    queryFn: () => apiFetch(`/api/standups/entries/${scheduleId}/history?limit=50`),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const dates = Object.keys(data?.entries || {}).sort().reverse();

  return (
    <ScrollArea className="max-h-[600px]">
      <div className="space-y-4">
        {dates.map((date) => {
          const entries = data!.entries[date];
          return (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {new Date(date + "T00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                </span>
                <Badge variant="secondary" className="text-[10px]">{entries.length} entries</Badge>
              </div>
              <div className="space-y-2 pl-6">
                {entries.map((entry) => (
                  <div key={entry.id} className="text-sm border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{entry.userName}</span>
                      <MoodBadge mood={entry.mood} />
                    </div>
                    {entry.whatIDid && <p className="text-muted-foreground text-xs"><span className="text-emerald-600 font-medium">Done:</span> {entry.whatIDid}</p>}
                    {entry.whatImDoing && <p className="text-muted-foreground text-xs"><span className="text-blue-600 font-medium">Doing:</span> {entry.whatImDoing}</p>}
                    {entry.blockers && <p className="text-orange-700 text-xs"><span className="font-medium">Blocker:</span> {entry.blockers}</p>}
                  </div>
                ))}
              </div>
              <Separator className="mt-3" />
            </div>
          );
        })}
        {dates.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No standup history yet</p>
        )}
      </div>
    </ScrollArea>
  );
}

// ── Analytics View ───────────────────────────────────────────────────────────

function AnalyticsView({ scheduleId }: { scheduleId: number }) {
  const { data: analytics, isLoading } = useQuery<StandupAnalytics>({
    queryKey: ["standup-analytics", scheduleId],
    queryFn: () => apiFetch(`/api/standups/analytics/${scheduleId}`),
  });

  if (isLoading || !analytics) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Entries</p>
            <p className="text-2xl font-bold">{analytics.totalEntries}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Participants</p>
            <p className="text-2xl font-bold">{analytics.totalParticipants}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">On-Time Rate</p>
            <p className="text-2xl font-bold">
              {analytics.totalEntries > 0
                ? Math.round(((analytics.totalEntries - analytics.lateEntries) / analytics.totalEntries) * 100)
                : 0}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Late Entries</p>
            <p className="text-2xl font-bold text-orange-600">{analytics.lateEntries}</p>
          </CardContent>
        </Card>
      </div>

      {/* Mood distribution */}
      {analytics.moodDistribution.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Mood Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-4">
              {analytics.moodDistribution.map((m) => {
                const opt = MOOD_OPTIONS.find((o) => o.value === m.mood);
                return (
                  <div key={m.mood} className="flex items-center gap-2 text-sm">
                    <span className={opt?.color || ""}>{opt?.icon}</span>
                    <span className="font-medium">{m.count}</span>
                    <span className="text-muted-foreground">{opt?.label || m.mood}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent blockers */}
      {analytics.recentBlockers.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Blockers</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {analytics.recentBlockers.map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-orange-700">{b.blockers}</p>
                    <p className="text-xs text-muted-foreground">{b.userName} - {b.standupDate}</p>
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

// ── Create Schedule Dialog ───────────────────────────────────────────────────

function CreateScheduleDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [teamLabel, setTeamLabel] = useState("");
  const [cadenceDays, setCadenceDays] = useState("2");
  const [deadlineTime, setDeadlineTime] = useState("10:00");
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
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering Bi-Daily" />
          </div>
          <div>
            <label className="text-sm font-medium">Team / Department</label>
            <Input value={teamLabel} onChange={(e) => setTeamLabel(e.target.value)} placeholder="e.g. Engineering, PM, Quality" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Frequency</label>
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
            <div>
              <label className="text-sm font-medium">Deadline</label>
              <Input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
            </div>
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

export default function StandupsPage() {
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [tab, setTab] = useState("today");
  const queryClient = useQueryClient();

  // Load user's schedules
  const { data: schedules, isLoading: schedulesLoading } = useQuery<StandupSchedule[]>({
    queryKey: ["standup-schedules"],
    queryFn: () => apiFetch("/api/standups/schedules"),
  });

  // Load all schedules for admin
  const { data: allSchedules } = useQuery<StandupSchedule[]>({
    queryKey: ["standup-schedules-all"],
    queryFn: () => apiFetch("/api/standups/schedules/all"),
  });

  // Load today's standups
  const { data: todayStandups, isLoading: todayLoading } = useQuery<TodayStandup[]>({
    queryKey: ["standups-today"],
    queryFn: () => apiFetch("/api/standups/today"),
  });

  // Auto-select first schedule
  useEffect(() => {
    if (!selectedScheduleId && schedules && schedules.length > 0) {
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedScheduleId]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["standups-today"] });
    queryClient.invalidateQueries({ queryKey: ["standup-schedules"] });
    queryClient.invalidateQueries({ queryKey: ["standup-entries"] });
    queryClient.invalidateQueries({ queryKey: ["standup-history"] });
    queryClient.invalidateQueries({ queryKey: ["standup-analytics"] });
  };

  const displaySchedules = allSchedules || schedules || [];

  return (
    <PageShell>
      <SectionHeader
        icon={<Users className="h-5 w-5" />}
        title="Standups"
        eyebrow="Team Coordination"
        description="Bi-daily async standups — share progress, flag blockers, stay aligned."
        actions={<CreateScheduleDialog onCreated={handleRefresh} />}
      />

      {schedulesLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : displaySchedules.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="font-medium mb-1">No standup schedules yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create your first standup schedule to get started with bi-daily check-ins.</p>
            <CreateScheduleDialog onCreated={handleRefresh} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Schedule selector */}
          {displaySchedules.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {displaySchedules.map((s) => (
                <Button
                  key={s.id}
                  variant={selectedScheduleId === s.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedScheduleId(s.id)}
                  className="shrink-0"
                >
                  {s.name}
                  {s.teamLabel && <span className="text-xs ml-1 opacity-70">({s.teamLabel})</span>}
                </Button>
              ))}
            </div>
          )}

          {/* Today's standup alert */}
          {todayStandups && todayStandups.length > 0 && (
            <div className="space-y-2">
              {todayStandups.filter((t) => !t.hasSubmitted).map((t) => (
                <Card key={t.schedule.id} className="border-primary/30 bg-primary/5">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Standup due: {t.schedule.name}</span>
                      {t.schedule.deadlineTime && (
                        <span className="text-xs text-muted-foreground">before {t.schedule.deadlineTime}</span>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => { setSelectedScheduleId(t.schedule.id); setTab("today"); }}>
                      Submit Now
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Main tabs */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="today" className="gap-1.5">
                <Send className="h-4 w-4" />
                Submit
              </TabsTrigger>
              <TabsTrigger value="team" className="gap-1.5">
                <Users className="h-4 w-4" />
                Team View
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="h-4 w-4" />
                History
              </TabsTrigger>
              <TabsTrigger value="analytics" className="gap-1.5">
                <BarChart3 className="h-4 w-4" />
                Analytics
              </TabsTrigger>
            </TabsList>

            <TabsContent value="today" className="mt-4">
              {selectedScheduleId ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {todayStandups?.find((t) => t.schedule.id === selectedScheduleId)?.hasSubmitted
                        ? "Update Your Standup"
                        : "Submit Your Standup"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <StandupForm
                      scheduleId={selectedScheduleId}
                      existing={todayStandups?.find((t) => t.schedule.id === selectedScheduleId)?.entry || null}
                      onSubmitted={handleRefresh}
                    />
                  </CardContent>
                </Card>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">Select a schedule to submit your standup</p>
              )}
            </TabsContent>

            <TabsContent value="team" className="mt-4">
              {selectedScheduleId ? (
                <TeamView scheduleId={selectedScheduleId} />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">Select a schedule</p>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              {selectedScheduleId ? (
                <HistoryView scheduleId={selectedScheduleId} />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">Select a schedule</p>
              )}
            </TabsContent>

            <TabsContent value="analytics" className="mt-4">
              {selectedScheduleId ? (
                <AnalyticsView scheduleId={selectedScheduleId} />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">Select a schedule</p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </PageShell>
  );
}
