/**
 * Finance Health — the single on-demand status the owner checks during the
 * freeze. Reads GET /api/finance/health (jobs / errors / freshness / integrity
 * / integrations + recent alerts) and exposes admin actions to run the
 * integrity guard, run the watchdog sweeps, or send the digest on demand.
 *
 * Read-only display. The admin actions are server-gated (requireAdmin).
 */

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FinanceLoading, FinanceError } from "@/components/finance/template/states";
import { RefreshCw, ShieldCheck, Activity, Play } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatRelativeWithAbsoluteZA } from "@/lib/datetime";

type Level = "healthy" | "warn" | "critical" | "unknown";

interface JobStatus {
  job: { key: string; displayName: string; impact: string; critical: boolean };
  state: "healthy" | "stale" | "failing" | "unknown";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}
interface FreshnessSignal {
  key: string;
  breached: boolean;
  detail: string;
}
interface IntegrityRun {
  status: string;
  driftCount: number;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}
interface FinanceHealth {
  generatedAt: string;
  overall: Level;
  components: { jobs: Level; errors: Level; freshness: Level; integrity: Level; integrations: Level };
  jobs: JobStatus[];
  errors: { windowMs: number; threshold: number; countInWindow: number; breached: boolean };
  freshness: { signals: FreshnessSignal[]; anyBreached: boolean };
  integrity: { lastRun: IntegrityRun | null; level: Level };
  integrations: { overallHealth: string; integrations: Array<{ displayName: string; health: string; warning: string | null }> };
  recentAlerts: Array<{ eventType: string; title: string; body: string | null; at: string }>;
}

const LEVEL_STYLE: Record<string, string> = {
  healthy: "ee-status-success",
  warn: "ee-status-warning",
  critical: "ee-status-danger",
  unknown: "ee-status-neutral",
};
const STATE_TO_LEVEL: Record<string, Level> = { healthy: "healthy", stale: "warn", failing: "critical", unknown: "unknown" };

function LevelBadge({ level, label }: { level: string; label?: string }) {
  const cls = LEVEL_STYLE[level] ?? LEVEL_STYLE.unknown;
  return <Badge variant="outline" className={cls} data-testid={`badge-level-${level}`}>{label ?? level}</Badge>;
}

export default function FinanceHealthPage() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const healthQuery = useQuery<FinanceHealth>({
    queryKey: ["/api/finance/health"],
    queryFn: async () => {
      const res = await fetch("/api/finance/health", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load finance health (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const runAction = async (path: string, label: string) => {
    setBusy(path);
    try {
      const res = await apiRequest("POST", path);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      toast({ title: `${label} complete`, description: JSON.stringify(body).slice(0, 200) });
      await healthQuery.refetch();
    } catch (err) {
      toast({ title: `${label} failed`, description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const data = healthQuery.data;

  return (
    <PageLayout>
      <PageHeader
        title="Finance Health"
        subtitle="Freeze-monitoring at a glance: scheduled jobs, error rate, data freshness, the weekly integrity guard, and finance integrations."
        actions={
          <Button variant="outline" size="sm" onClick={() => healthQuery.refetch()} disabled={healthQuery.isFetching} data-testid="button-refresh-health">
            <RefreshCw className={`h-4 w-4 mr-2 ${healthQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {healthQuery.isLoading && <FinanceLoading label="Loading finance health…" />}
      {healthQuery.isError && (
        <FinanceError title="Could not load finance health." onRetry={() => healthQuery.refetch()} />
      )}

      {data && (
        <div className="space-y-6">
          {/* Overall + component levels */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Overall</CardTitle>
              <LevelBadge level={data.overall} label={`Overall: ${data.overall}`} />
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {(["jobs", "errors", "freshness", "integrity", "integrations"] as const).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-sm capitalize text-muted-foreground">{k}</span>
                  <LevelBadge level={data.components[k]} />
                </div>
              ))}
              <span className="text-xs text-muted-foreground ml-auto self-center">
                Updated {formatRelativeWithAbsoluteZA(data.generatedAt)}
              </span>
            </CardContent>
          </Card>

          {/* Scheduled jobs — dead-man's switch */}
          <Card>
            <CardHeader><CardTitle>Scheduled finance jobs</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Last success</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.jobs.map((j) => (
                    <TableRow key={j.job.key} data-testid={`row-job-${j.job.key}`}>
                      <TableCell className="font-medium">{j.job.displayName}{j.job.critical && <span className="ml-1 text-status-adverse" title="critical">*</span>}</TableCell>
                      <TableCell><LevelBadge level={STATE_TO_LEVEL[j.state] ?? "unknown"} label={j.state} /></TableCell>
                      <TableCell>{j.lastSuccessAt ? formatRelativeWithAbsoluteZA(j.lastSuccessAt) : "never"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {j.state === "failing" && j.lastError ? j.lastError : j.state !== "healthy" ? j.job.impact : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Freshness + errors */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Data freshness &amp; drift</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.freshness.signals.map((s) => (
                  <div key={s.key} className="flex items-start gap-2 text-sm">
                    <LevelBadge level={s.breached ? "critical" : "healthy"} label={s.breached ? "breach" : "ok"} />
                    <span className={s.breached ? "text-status-adverse" : "text-muted-foreground"}>{s.detail}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Finance error rate</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <LevelBadge level={data.errors.breached ? "critical" : "healthy"} />
                  <span>
                    {data.errors.countInWindow} finance 5xx in the last {Math.round(data.errors.windowMs / 60000)} min
                    (threshold {data.errors.threshold}).
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Integrity guard */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Weekly integrity guard</CardTitle>
              <LevelBadge level={data.integrity.level} />
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              {data.integrity.lastRun ? (
                <>
                  <p>{data.integrity.lastRun.summary}</p>
                  <p className="text-muted-foreground">
                    Last run {data.integrity.lastRun.startedAt ? formatRelativeWithAbsoluteZA(data.integrity.lastRun.startedAt) : "—"} ·
                    status {data.integrity.lastRun.status} · drift {data.integrity.lastRun.driftCount}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">No integrity-guard run recorded yet.</p>
              )}
            </CardContent>
          </Card>

          {/* Integrations */}
          <Card>
            <CardHeader><CardTitle>Finance integrations</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.integrations.integrations.map((i) => (
                <div key={i.displayName} className="flex items-center gap-2">
                  <LevelBadge level={STATE_TO_LEVEL[i.health] ?? "unknown"} label={i.health} />
                  <span className="font-medium">{i.displayName}</span>
                  {i.warning && <span className="text-status-drift">— {i.warning}</span>}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recent alerts */}
          <Card>
            <CardHeader><CardTitle>Recent finance alerts</CardTitle></CardHeader>
            <CardContent>
              {data.recentAlerts.length === 0 ? (
                <p className="text-muted-foreground text-sm">No finance alerts recently.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.recentAlerts.map((a, idx) => (
                    <li key={`${a.eventType}-${idx}`} className="border-b border-border pb-2 last:border-0">
                      <span className="font-medium">{a.title}</span>
                      <span className="text-muted-foreground"> · {formatRelativeWithAbsoluteZA(a.at)}</span>
                      {a.body && <p className="text-muted-foreground">{a.body}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Admin actions */}
          <Card>
            <CardHeader><CardTitle>Admin actions</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" disabled={busy !== null}
                onClick={() => runAction("/api/admin/finance/observability/run-integrity", "Integrity guard")}
                data-testid="button-run-integrity">
                <ShieldCheck className="h-4 w-4 mr-2" /> Run integrity guard now
              </Button>
              <Button variant="outline" size="sm" disabled={busy !== null}
                onClick={() => runAction("/api/admin/finance/observability/sweep", "Watchdog sweep")}
                data-testid="button-run-sweep">
                <Play className="h-4 w-4 mr-2" /> Run watchdog sweep
              </Button>
              <Button variant="outline" size="sm" disabled={busy !== null}
                onClick={() => runAction("/api/admin/finance/observability/digest", "Digest")}
                data-testid="button-send-digest">
                <Activity className="h-4 w-4 mr-2" /> Send digest now
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </PageLayout>
  );
}
