import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Entry = { role: string; points: number; pointsEarned: number; pointsPenalty: number };
type Response = { leaderboard: Entry[] };

const DEPARTMENT_MAP: Record<string, string> = {
  QUALITY_MANAGER: "Quality",
  ENGINEER: "Engineering",
  ENGINEERING_MANAGER: "Engineering",
  PROJECT_MANAGER_SITE: "Project Delivery",
  PROJECT_DEVELOPER: "Project Development",
  ACCOUNTANT: "Finance",
  CFO: "Finance",
  COO_ADMIN: "Leadership",
  CEO_ADMIN: "Leadership",
};

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function DepartmentScoresPage() {
  const { data, error, isLoading } = useQuery<Response>({
    queryKey: ["department-scores"],
    queryFn: async () => {
      const res = await fetch("/api/gamification/leaderboard", { headers: authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Could not load department scores. Refresh and retry. If it keeps failing, contact admin.");
      return res.json();
    },
  });

  const departments = useMemo(() => {
    const grouped: Record<string, { points: number; earned: number; penalty: number; members: number }> = {};
    for (const row of data?.leaderboard || []) {
      const dept = DEPARTMENT_MAP[row.role] || "Operations";
      grouped[dept] ||= { points: 0, earned: 0, penalty: 0, members: 0 };
      grouped[dept].points += row.points;
      grouped[dept].earned += row.pointsEarned;
      grouped[dept].penalty += row.pointsPenalty;
      grouped[dept].members += 1;
    }
    return Object.entries(grouped)
      .map(([name, m]) => ({ name, ...m, avg: m.members ? Math.round(m.points / m.members) : 0 }))
      .sort((a, b) => b.avg - a.avg);
  }, [data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Department Scores</h1>
        <p className="text-sm text-slate-600">Ranked department performance with trend signals from real gamification data.</p>
      </div>
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Could not load department scores. Likely reason: network/API issue. How to fix: refresh and retry. If this keeps happening, contact your admin.</div> : null}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader><CardTitle className="text-base">Department Ranking</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? <p className="text-sm text-slate-500">Loading scores...</p> : departments.length === 0 ? <p className="text-sm text-slate-500">No department scoring data yet. Ask leadership to enable gamification feeds for each team role.</p> : departments.map((d, idx) => (
            <div key={d.name} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">#{idx + 1} {d.name}</p>
                <p className="text-sm font-semibold">Avg {d.avg} pts</p>
              </div>
              <p className="text-xs text-slate-500">Members: {d.members} · Earned: {d.earned} · Penalties: {d.penalty}</p>
            </div>
          ))}
          <Button asChild variant="outline" className="w-full"><Link href="/leaderboard">View leadership leaderboard detail</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
