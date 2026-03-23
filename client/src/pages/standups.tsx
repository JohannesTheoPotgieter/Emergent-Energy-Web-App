import { useState, useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { PageShell, SectionHeader, WorkspaceNotice } from "@/components/layout/page-shell";
import {
  Users, Calendar, BarChart3, Plus, Loader2, Send, Clock,
  CheckCircle2, AlertTriangle, MessageSquare,
  Smile, Meh, Frown, ThumbsUp, XCircle, History, TrendingUp,
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

interface Suggestions {
  whatIDid: string[];
  whatImDoing: string[];
}

// ── Mood helpers (strict color alignment with eng dashboard) ─────────────────

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

  // Reset form when schedule or existing entry changes
  useEffect(() => {
    setWhatIDid(existing?.whatIDid || "");
    setWhatImDoing(existing?.whatImDoing || "");
    setBlockers(existing?.blockers || "");
    setMood(existing?.mood || "");
  }, [scheduleId, existing?.id]);

  const { data: suggestions } = useQuery<Suggestions>({
    queryKey: ["standup-suggestions"],
    queryFn: () => apiFetch("/api/standups/suggestions"),
    staleTime: 60000,
  });

  const queryClient = useQueryClient();
  const submitMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/standups/entries", {
        method: "POST",
        body: JSON.stringify({ scheduleId, whatIDid, whatImDoing, blockers, mood: mood || null }),
      }),
    onSuccess: () => {
      toast({ title: existing ? "Standup updated" : "Standup submitted" });
      queryClient.invalidateQueries({ queryKey: ["standup-entries", scheduleId] });
      queryClient.invalidateQueries({ queryKey: ["standups-today"] });
      onSubmitted();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          What I completed
        </Label>
        <Textarea
          value={whatIDid}
          onChange={(e) => setWhatIDid(e.target.value)}
          placeholder="What did you accomplish since last standup?"
          rows={3}
        />
        {suggestions?.whatIDid && suggestions.whatIDid.length > 0 && !whatIDid && (
          <div className="space-y-1 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Suggestions from recent activity</p>
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

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-blue-600" />
          What I am working on
        </Label>
        <Textarea
          value={whatImDoing}
          onChange={(e) => setWhatImDoing(e.target.value)}
          placeholder="What are you working on today?"
          rows={3}
        />
        {suggestions?.whatImDoing && suggestions.whatImDoing.length > 0 && !whatImDoing && (
          <div className="space-y-1 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Current in-progress tasks</p>
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

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
          Blockers
        </Label>
        <Textarea
          value={blockers}
          onChange={(e) => setBlockers(e.target.value)}
          placeholder="Any blockers or impediments? Leave empty if none."
          rows={2}
        />
      </div>

      <div className="space-y-1.5">
        <Label>How are you feeling?</Label>
        <div className="flex gap-2">
          {MOOD_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={mood === opt.value ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setMood(mood === opt.value ? "" : opt.value)}
            >
              {opt.icon}
              {opt.label}
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
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-[180px]"
        />
        <span className="text-sm text-muted-foreground">
          {entries?.length || 0} of {participants?.length || 0} submitted
        </span>
      </div>

      <div className="space-y-2">
        {(entries || []).map((entry) => (
          <Card key={entry.id}>
            <CardContent className="px-4 py-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px] font-semibold">
                      {getInitials(entry.userName || "?")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold">{entry.userName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(entry.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {entry.isLate && (
                        <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0 border-orange-200 bg-orange-50 text-orange-700">
                          Late
                        </Badge>
                      )}
                    </p>
                  </div>
                </div>
                <MoodBadge mood={entry.mood} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Completed
                  </p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{entry.whatIDid || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Working On
                  </p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{entry.whatImDoing || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Blockers
                  </p>
                  <p className={`text-sm whitespace-pre-line ${entry.blockers ? "text-orange-700 font-medium" : "text-muted-foreground"}`}>
                    {entry.blockers || "None"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {missingParticipants.length > 0 && (
          <Card className="border-dashed">
            <CardContent className="px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Awaiting submission</p>
              <div className="flex flex-wrap gap-2">
                {missingParticipants.map((p) => (
                  <Badge key={p.userId} variant="outline" className="gap-1 text-xs">
                    <Users className="h-3 w-3" />
                    {p.userName || p.userEmail || `User ${p.userId}`}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {(!entries || entries.length === 0) && missingParticipants.length === 0 && (
          <div className="ee-empty-state">
            <Calendar className="h-8 w-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm font-medium">No standup scheduled for this date</p>
            <p className="text-xs text-muted-foreground mt-1">Select a different date to view entries</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── History View ─────────────────────────────────────────────────────────────

interface HistoryResponse {
  entries: Record<string, StandupEntry[]>;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

function HistoryView({ scheduleId }: { scheduleId: number }) {
  const PAGE_SIZE = 20;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [allEntries, setAllEntries] = useState<Record<string, StandupEntry[]>>({});
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
      setAllEntries({});
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isFetching } = useQuery<HistoryResponse>({
    queryKey: ["standup-history", scheduleId, debouncedSearch, offset],
    queryFn: () => apiFetch(`/api/standups/entries/${scheduleId}/history?limit=${PAGE_SIZE}&offset=${offset}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ""}`),
  });

  // Merge new page data into accumulated entries
  useEffect(() => {
    if (!data) return;
    setHasMore(data.hasMore);
    if (offset === 0) {
      setAllEntries(data.entries);
    } else {
      setAllEntries((prev) => {
        const merged = { ...prev };
        for (const [date, entries] of Object.entries(data.entries)) {
          merged[date] = [...(merged[date] || []), ...entries];
        }
        return merged;
      });
    }
  }, [data, offset]);

  const dates = Object.keys(allEntries).sort().reverse();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search standup history..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm h-8 text-xs"
        />
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {data && <span className="text-xs text-muted-foreground">{data.total} total entries</span>}
      </div>

      <ScrollArea className="h-[calc(100vh-440px)] min-h-[300px]">
        <div className="space-y-4">
          {isLoading && offset === 0 ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : dates.length === 0 ? (
            <div className="ee-empty-state">
              <History className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm font-medium">{debouncedSearch ? "No matching entries" : "No standup history yet"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {debouncedSearch ? "Try a different search term" : "History will appear after the first standup submission"}
              </p>
            </div>
          ) : (
            <>
              {dates.map((date) => {
                const entries = allEntries[date];
                return (
                  <div key={date}>
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-semibold tracking-tight">
                        {new Date(date + "T00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                      </span>
                      <Badge variant="outline" className="text-[10px] font-semibold">{entries.length} entries</Badge>
                    </div>
                    <div className="space-y-1.5 pl-6">
                      {entries.map((entry) => (
                        <Card key={entry.id}>
                          <CardContent className="px-3 py-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-semibold">{entry.userName}</span>
                              <MoodBadge mood={entry.mood} />
                            </div>
                            {entry.whatIDid && (
                              <p className="text-xs text-muted-foreground">
                                <span className="text-emerald-600 font-semibold">Completed:</span> {entry.whatIDid}
                              </p>
                            )}
                            {entry.whatImDoing && (
                              <p className="text-xs text-muted-foreground">
                                <span className="text-blue-600 font-semibold">Working on:</span> {entry.whatImDoing}
                              </p>
                            )}
                            {entry.blockers && (
                              <p className="text-xs text-orange-700 font-medium">
                                <span className="font-semibold">Blocker:</span> {entry.blockers}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <Separator className="mt-3" />
                  </div>
                );
              })}

              {hasMore && (
                <div className="flex justify-center pt-2 pb-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    disabled={isFetching}
                    onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
                  >
                    {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
                    Load More
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Analytics View ───────────────────────────────────────────────────────────

function formatDateShort(dateStr: string) {
  return new Date(dateStr + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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
        <Card>
          <CardContent className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Entries</p>
            <p className="text-2xl font-bold tracking-tight mt-1">{analytics.totalEntries}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Participants</p>
            <p className="text-2xl font-bold tracking-tight mt-1">{analytics.totalParticipants}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">On-Time Rate</p>
            <p className="text-2xl font-bold tracking-tight mt-1">{onTimeRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-600">Late Entries</p>
            <p className="text-2xl font-bold tracking-tight mt-1">{analytics.lateEntries}</p>
          </CardContent>
        </Card>
      </div>

      {/* Participation Rate Trend */}
      {trendData.length > 1 && (
        <Card>
          <CardHeader className="px-4 py-3 pb-2">
            <CardTitle className="ee-section-title flex items-center gap-1.5">
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

      {/* Mood Score + Blockers Trend */}
      {trendData.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="px-4 py-3 pb-2">
              <CardTitle className="ee-section-title">Team Mood Score</CardTitle>
              <p className="text-[10px] text-muted-foreground">5 = Great, 1 = Blocked</p>
            </CardHeader>
            <CardContent className="px-2 pb-3">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trendData.filter((d) => d.avgMoodScore !== null)}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
                  <YAxis domain={[1, 5]} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(value: number) => [value.toFixed(1), "Avg Mood"]}
                  />
                  <Line type="monotone" dataKey="avgMoodScore" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 py-3 pb-2">
              <CardTitle className="ee-section-title">Blockers Over Time</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-3">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(value: number) => [value, "Blockers"]}
                  />
                  <Bar dataKey="blockers" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {analytics.moodDistribution.length > 0 && (
        <Card>
          <CardHeader className="px-4 py-3 pb-2"><CardTitle className="ee-section-title">Mood Distribution</CardTitle></CardHeader>
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
          <CardHeader className="px-4 py-3 pb-2"><CardTitle className="ee-section-title">Recent Blockers</CardTitle></CardHeader>
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

export default function StandupsPage() {
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [tab, setTab] = useState("today");
  const queryClient = useQueryClient();

  const { data: schedules, isLoading: schedulesLoading } = useQuery<StandupSchedule[]>({
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
        description="Async bi-daily standups. Share progress, flag blockers, and maintain team alignment across departments."
        actions={<CreateScheduleDialog onCreated={handleRefresh} />}
      />

      {schedulesLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : displaySchedules.length === 0 ? (
        <div className="ee-empty-state">
          <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-semibold">No standup schedules configured</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Create your first standup schedule to begin bi-daily check-ins.</p>
          <CreateScheduleDialog onCreated={handleRefresh} />
        </div>
      ) : (
        <div className="space-y-4">
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

          {todayStandups && todayStandups.filter((t) => !t.hasSubmitted).length > 0 && (
            <WorkspaceNotice
              tone="warning"
              icon={<MessageSquare className="h-4 w-4" />}
              title="Standup submission pending"
              description={`You have ${todayStandups.filter((t) => !t.hasSubmitted).length} standup(s) due today.`}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const pending = todayStandups!.find((t) => !t.hasSubmitted);
                    if (pending) { setSelectedScheduleId(pending.schedule.id); setTab("today"); }
                  }}
                >
                  Submit Now
                </Button>
              }
            />
          )}

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
                  <CardHeader className="px-4 py-3">
                    <CardTitle className="ee-section-title">
                      {todayStandups?.find((t) => t.schedule.id === selectedScheduleId)?.hasSubmitted
                        ? "Update Your Standup"
                        : "Submit Your Standup"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <StandupForm
                      scheduleId={selectedScheduleId}
                      existing={todayStandups?.find((t) => t.schedule.id === selectedScheduleId)?.entry || null}
                      onSubmitted={handleRefresh}
                    />
                  </CardContent>
                </Card>
              ) : (
                <div className="ee-empty-state">
                  <p className="text-sm font-medium">Select a schedule to submit your standup</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="team" className="mt-4">
              {selectedScheduleId ? (
                <TeamView scheduleId={selectedScheduleId} />
              ) : (
                <div className="ee-empty-state">
                  <p className="text-sm font-medium">Select a schedule to view team entries</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              {selectedScheduleId ? (
                <HistoryView scheduleId={selectedScheduleId} />
              ) : (
                <div className="ee-empty-state">
                  <p className="text-sm font-medium">Select a schedule to view history</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="analytics" className="mt-4">
              {selectedScheduleId ? (
                <AnalyticsView scheduleId={selectedScheduleId} />
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
