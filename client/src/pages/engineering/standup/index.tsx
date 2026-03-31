import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageSkeleton, PageError } from "@/components/ui/page-states";
import {
  Users, Send, AlertTriangle, CheckCircle2, Clock,
  Smile, Meh, Frown, ThumbsUp, XCircle, BarChart3,
} from "lucide-react";

async function api(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}

interface Schedule {
  id: number;
  name: string;
  teamLabel: string | null;
  cadence: string;
  cadenceDays: number;
  isActive: boolean;
}

interface TodayStandup {
  schedule: Schedule;
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

const MOODS = [
  { value: "great", label: "Great", icon: ThumbsUp, color: "text-green-600" },
  { value: "good", label: "Good", icon: Smile, color: "text-blue-600" },
  { value: "okay", label: "Okay", icon: Meh, color: "text-amber-600" },
  { value: "struggling", label: "Struggling", icon: Frown, color: "text-orange-600" },
  { value: "blocked", label: "Blocked", icon: XCircle, color: "text-red-600" },
];

function moodBadge(mood: string | null) {
  const m = MOODS.find(x => x.value === mood);
  if (!m) return null;
  const Icon = m.icon;
  return <Badge variant="outline" className={`text-[10px] gap-1 ${m.color}`}><Icon className="h-3 w-3" />{m.label}</Badge>;
}

function initials(name?: string) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

export default function EngineeringStandupPage() {
  const queryClient = useQueryClient();
  const [whatIDid, setWhatIDid] = useState("");
  const [whatImDoing, setWhatImDoing] = useState("");
  const [blockers, setBlockers] = useState("");
  const [mood, setMood] = useState("good");
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("");

  // Fetch today's standup status
  const { data: todayData, isLoading, isError, error, refetch } = useQuery<TodayStandup[]>({
    queryKey: ["/api/standups/today"],
    queryFn: () => api("/api/standups/today"),
  });

  // Fetch all schedules
  const { data: schedules = [] } = useQuery<Schedule[]>({
    queryKey: ["/api/standups/schedules"],
    queryFn: () => api("/api/standups/schedules"),
  });

  // Auto-select first schedule
  const activeScheduleId = selectedScheduleId || (schedules[0]?.id ? String(schedules[0].id) : "");

  // Fetch team entries for the selected schedule
  const { data: teamEntries = [] } = useQuery<StandupEntry[]>({
    queryKey: ["/api/standups/entries", activeScheduleId],
    queryFn: () => api(`/api/standups/entries/${activeScheduleId}`),
    enabled: !!activeScheduleId,
  });

  // Fetch analytics
  const { data: analytics } = useQuery<any>({
    queryKey: ["/api/standups/analytics", activeScheduleId],
    queryFn: () => api(`/api/standups/analytics/${activeScheduleId}`),
    enabled: !!activeScheduleId,
  });

  // Submit standup entry
  const submitMutation = useMutation({
    mutationFn: () =>
      api("/api/standups/entries", {
        method: "POST",
        body: JSON.stringify({
          scheduleId: Number(activeScheduleId),
          whatIDid,
          whatImDoing,
          blockers: blockers || null,
          mood,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/standups/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/standups/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/standups/analytics"] });
      setWhatIDid(whatImDoing);
      setWhatImDoing("");
      setBlockers("");
    },
  });

  const todayStandups = todayData || [];
  const currentStandup = todayStandups.find(s => String(s.schedule.id) === activeScheduleId);
  const hasSubmitted = currentStandup?.hasSubmitted || false;
  const blockersCount = useMemo(() => teamEntries.filter(e => e.blockers && e.blockers.trim()).length, [teamEntries]);
  const submittedCount = teamEntries.length;

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return (
    <PageShell className="p-4 md:p-6">
      <PageError title="Unable to load standup" message={error instanceof Error ? error.message : "Failed to load"} onRetry={() => refetch()} />
    </PageShell>
  );

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-engineering-standup">
      <SectionHeader
        icon={<Users className="h-5 w-5" />}
        eyebrow="Engineering"
        title="Engineering Standup"
        description="Daily team check-in and blocker tracking"
      />

      {/* Schedule selector */}
      {schedules.length > 1 && (
        <div className="max-w-xs">
          <Select value={activeScheduleId} onValueChange={setSelectedScheduleId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select standup" />
            </SelectTrigger>
            <SelectContent>
              {schedules.map(s => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}{s.teamLabel ? ` — ${s.teamLabel}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{submittedCount}</div>
            <div className="text-xs text-muted-foreground">Submitted Today</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5">
              {hasSubmitted
                ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                : <Clock className="h-5 w-5 text-amber-600" />}
              <span className="text-sm font-medium">{hasSubmitted ? "Submitted" : "Pending"}</span>
            </div>
            <div className="text-xs text-muted-foreground">Your Status</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-red-600">{blockersCount}</div>
            <div className="text-xs text-muted-foreground">Blockers Flagged</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{analytics?.completionRate ?? "—"}%</div>
            <div className="text-xs text-muted-foreground">Completion Rate</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue={hasSubmitted ? "team" : "entry"} className="space-y-4">
        <TabsList>
          <TabsTrigger value="entry">My Entry</TabsTrigger>
          <TabsTrigger value="team">Team Board</TabsTrigger>
          <TabsTrigger value="blockers">Blockers ({blockersCount})</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* My Entry Tab */}
        <TabsContent value="entry">
          {hasSubmitted ? (
            <Card>
              <CardContent className="py-8 text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto" />
                <p className="text-sm font-medium">You've submitted today's standup</p>
                <p className="text-xs text-muted-foreground">Your entry is visible on the Team Board tab</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily Standup Entry</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs font-medium">What I did (yesterday)</Label>
                  <Textarea value={whatIDid} onChange={(e) => setWhatIDid(e.target.value)} rows={3} placeholder="Completed design review for Project X..." />
                </div>
                <div>
                  <Label className="text-xs font-medium">What I'm doing (today)</Label>
                  <Textarea value={whatImDoing} onChange={(e) => setWhatImDoing(e.target.value)} rows={3} placeholder="Starting electrical layout for Building A..." />
                </div>
                <div>
                  <Label className="text-xs font-medium">Blockers / Risks</Label>
                  <Textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} rows={2} placeholder="Waiting on client sign-off before proceeding..." />
                </div>
                <div>
                  <Label className="text-xs font-medium mb-2 block">How are you feeling?</Label>
                  <div className="flex items-center gap-2">
                    {MOODS.map(m => {
                      const Icon = m.icon;
                      return (
                        <button
                          key={m.value}
                          onClick={() => setMood(m.value)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                            mood === m.value
                              ? `${m.color} border-current bg-current/5`
                              : "text-muted-foreground border-transparent hover:border-border"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" /> {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Button
                  onClick={() => submitMutation.mutate()}
                  disabled={submitMutation.isPending || (!whatIDid.trim() && !whatImDoing.trim())}
                  className="gap-1.5"
                >
                  <Send className="h-4 w-4" /> Submit Entry
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Team Board Tab */}
        <TabsContent value="team">
          <div className="space-y-3">
            {teamEntries.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No entries submitted yet today.</p>
                </CardContent>
              </Card>
            ) : teamEntries.map(entry => (
              <Card key={entry.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">{initials(entry.userName)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{entry.userName || `User #${entry.userId}`}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {new Date(entry.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {moodBadge(entry.mood)}
                    {entry.isLate && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">Late</Badge>}
                  </div>
                  <div className="grid md:grid-cols-3 gap-3 text-sm pl-11">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-0.5">Yesterday</div>
                      <p className="text-sm">{entry.whatIDid || "—"}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-0.5">Today</div>
                      <p className="text-sm">{entry.whatImDoing || "—"}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-0.5">Blockers</div>
                      <p className={`text-sm ${entry.blockers ? "text-red-600 font-medium" : ""}`}>
                        {entry.blockers || "None"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Blockers Tab */}
        <TabsContent value="blockers">
          <div className="space-y-3">
            {blockersCount === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No active blockers. Team is unblocked!</p>
                </CardContent>
              </Card>
            ) : teamEntries.filter(e => e.blockers && e.blockers.trim()).map(entry => (
              <Card key={entry.id} className="border-red-100 dark:border-red-900/30">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                    <span className="text-sm font-medium">{entry.userName || `User #${entry.userId}`}</span>
                    {moodBadge(entry.mood)}
                  </div>
                  <p className="text-sm text-red-700 dark:text-red-400 pl-7">{entry.blockers}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics">
          <div className="grid md:grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <BarChart3 className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                <div className="text-2xl font-bold">{analytics?.completionRate ?? "—"}%</div>
                <div className="text-xs text-muted-foreground">30-day Completion Rate</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Clock className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                <div className="text-2xl font-bold">{analytics?.avgSubmissionTime ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Avg Submission Time</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <AlertTriangle className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                <div className="text-2xl font-bold">{analytics?.blockerRate ?? "—"}%</div>
                <div className="text-xs text-muted-foreground">Blocker Frequency</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
