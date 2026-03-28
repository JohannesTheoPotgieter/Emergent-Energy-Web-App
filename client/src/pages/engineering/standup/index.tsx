import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

async function api(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}

export default function EngineeringStandupPage() {
  const queryClient = useQueryClient();
  const [teamId, setTeamId] = useState("1");
  const [projectId, setProjectId] = useState("");
  const [yesterday, setYesterday] = useState("");
  const [today, setToday] = useState("");
  const [blockers, setBlockers] = useState("");
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const { data: todayEntries } = useQuery<{ items: any[] }>({
    queryKey: ["standup-v2-today", teamId],
    queryFn: () => api(`/api/standups/today?team_id=${teamId}`),
  });

  const { data: history } = useQuery<{ items: any[] }>({
    queryKey: ["standup-v2-history", teamId, from, to],
    queryFn: () => api(`/api/standups/history?team_id=${teamId}&from=${from}&to=${to}`),
  });

  const { data: blockersData } = useQuery<{ items: any[] }>({
    queryKey: ["standup-v2-blockers"],
    queryFn: () => api("/api/standups/blockers/active"),
  });

  const submit = useMutation({
    mutationFn: () =>
      api("/api/standups/entry", {
        method: "POST",
        body: JSON.stringify({ yesterday, today, blockers, team_id: Number(teamId), project_id: projectId ? Number(projectId) : null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["standup-v2-today"] });
      queryClient.invalidateQueries({ queryKey: ["standup-v2-history"] });
      queryClient.invalidateQueries({ queryKey: ["standup-v2-blockers"] });
      setYesterday(today);
      setToday("");
      setBlockers("");
    },
  });

  const blockersCount = useMemo(() => (todayEntries?.items || []).filter((x) => x.blockers).length, [todayEntries]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">Engineering Standup Workflow</h1>
      <Tabs defaultValue="entry" className="space-y-4">
        <TabsList>
          <TabsTrigger value="entry">Standup Entry</TabsTrigger>
          <TabsTrigger value="team">Team Standup</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="blockers">Blockers Dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="entry">
          <Card><CardHeader><CardTitle>Daily Entry</CardTitle></CardHeader><CardContent className="space-y-3">
            <div className="grid md:grid-cols-3 grid-cols-1 gap-3">
              <div><Label>Team ID</Label><Input value={teamId} onChange={(e) => setTeamId(e.target.value)} /></div>
              <div><Label>Project ID</Label><Input value={projectId} onChange={(e) => setProjectId(e.target.value)} /></div>
            </div>
            <div><Label>Yesterday</Label><Textarea value={yesterday} onChange={(e) => setYesterday(e.target.value)} rows={3} /></div>
            <div><Label>Today</Label><Textarea value={today} onChange={(e) => setToday(e.target.value)} rows={3} /></div>
            <div><Label>Blockers</Label><Textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} rows={3} /></div>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>Submit Entry</Button>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="team">
          <Card><CardHeader><CardTitle>Today's Team Entries • Blockers: {blockersCount}</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 grid-cols-1">
            {(todayEntries?.items || []).map((entry) => (
              <Card key={entry.id}><CardContent className="pt-4 space-y-1 text-sm">
                <div className="font-medium">{entry.user_name || `User #${entry.user_id}`}</div>
                <div><strong>Yesterday:</strong> {entry.yesterday || "-"}</div>
                <div><strong>Today:</strong> {entry.today || "-"}</div>
                <div className={entry.blockers ? "text-red-600" : ""}><strong>Blockers:</strong> {entry.blockers || "None"}</div>
              </CardContent></Card>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="history">
          <Card><CardHeader><CardTitle>Standup History</CardTitle></CardHeader><CardContent className="space-y-3">
            <div className="grid md:grid-cols-3 grid-cols-1 gap-3">
              <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            <div className="space-y-2">
              {(history?.items || []).map((row) => (
                <div key={row.id} className="rounded border p-2 text-sm">
                  <div className="font-medium">{row.date} — {row.user_name || row.user_id}</div>
                  <div>Today: {row.today || "-"}</div>
                </div>
              ))}
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="blockers">
          <Card><CardHeader><CardTitle>Active Blockers</CardTitle></CardHeader><CardContent className="space-y-2">
            {(blockersData?.items || []).map((b) => (
              <div key={b.id} className="rounded border p-2 text-sm">
                <div className="font-medium">{b.owner_name || `User #${b.user_id}`} • {b.age_days} days old</div>
                <div>{b.blockers}</div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
