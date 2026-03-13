import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Entry = { userId: number; name: string; role: string; points: number; pointsEarned: number; pointsPenalty: number; badges: Array<{ name: string }> };
type Response = { leaderboard: Entry[]; pointValues: Record<string, number> };

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function KnowledgeGamePage() {
  const { data, error, isLoading } = useQuery<Response>({
    queryKey: ["knowledge-game-data"],
    queryFn: async () => {
      const res = await fetch("/api/gamification/leaderboard", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Could not load challenge data. Refresh and retry. If this continues, contact your admin.");
      return res.json();
    },
  });

  const leaderboard = data?.leaderboard || [];
  const challenges = useMemo(() => Object.entries(data?.pointValues || {}).slice(0, 6), [data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Knowledge Game</h1>
        <p className="text-sm text-slate-600">Active learning challenges tied to real operational activity.</p>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Could not load game data. Likely reason: API or network issue. How to fix: refresh and retry; if it persists contact your admin.</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader><CardTitle className="text-base">Active Challenges</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? <p className="text-sm text-slate-500">Loading challenges...</p> : challenges.length === 0 ? <p className="text-sm text-slate-500">No active challenge rules are available yet. Ask an admin to configure gamification point values.</p> : challenges.map(([key, value]) => (
              <div key={key} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">{key.replaceAll("_", " ")}</p>
                <p className="text-xs text-slate-500">{value} points available this round.</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader><CardTitle className="text-base">Participation</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {leaderboard.slice(0, 5).map((p, idx) => (
              <div key={p.userId} className="rounded-lg border border-slate-200 p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">#{idx + 1} {p.name}</p>
                  <p className="text-xs text-slate-500">{p.role} · {p.badges.length} badges</p>
                </div>
                <p className="text-sm font-semibold">{p.points} pts</p>
              </div>
            ))}
            {leaderboard.length === 0 && !isLoading ? <p className="text-sm text-slate-500">No participation data yet. Encourage teams to complete tasks and approvals to generate scores.</p> : null}
            <Button asChild className="w-full bg-emerald-600 hover:bg-emerald-700"><Link href="/leaderboard">Open full leaderboard</Link></Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
