import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";

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

function authHeaders(): Record<string, string> {
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
    <PageLayout
      data-testid="department-scores-page"
      header={
        <PageHeader
          title="Department Scores"
          subtitle="Ranked department performance with trend signals from real gamification data"
        />
      }
    >
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Could not load department scores. Likely reason: network/API issue. How to fix: refresh and retry. If this keeps happening, contact your admin.</div> : null}
      <Card>
        <CardContent className="p-4 space-y-2">
          <h2 className="text-base font-semibold">Department Ranking</h2>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading scores...</p> : departments.length === 0 ? <p className="text-sm text-muted-foreground">No department scoring data yet. Ask leadership to enable gamification feeds for each team role.</p> : departments.map((d, idx) => (
            <div key={d.name} className="rounded-lg border border-border p-3" data-testid={`department-${d.name}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">#{idx + 1} {d.name}</p>
                <p className="text-sm font-semibold tabular-nums">Avg {d.avg} pts</p>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">Members: {d.members} · Earned: {d.earned} · Penalties: {d.penalty}</p>
            </div>
          ))}
          <Button asChild variant="outline" className="w-full mt-3"><Link href="/leaderboard">View leadership leaderboard detail</Link></Button>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
