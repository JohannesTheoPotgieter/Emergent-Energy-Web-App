/**
 * Variation Order — Financial Impact panel (finance side).
 *
 * Per-project VO view: each VO's revenue delta, cost delta and GP impact, with
 * the BR-025/026 5%-of-GP gate. Sourced from GET /api/finance/projects/:id/
 * vo-impact, which derives every figure from change_requests + the canonical
 * (§3.3) line engine — the same source the execution change-control surface
 * reads, so the numbers cannot diverge. Read-only and defensive: a missing /
 * empty / failed response renders a quiet state, never a crash.
 */
import { useQuery } from "@tanstack/react-query";

import { fetchQueryFn } from "@/lib/queryClient";
import { formatZar } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck } from "lucide-react";

interface VoImpactRow {
  id: number;
  title: string;
  changeType: string;
  status: string;
  revenueDelta: number;
  costDelta: number;
  gpImpact: number;
  gpImpactPct: number | null;
  exceedsThreshold: boolean;
  requiresManagementReview: boolean | null;
  gpImpactPctAtSubmit: number | null;
  finalDecision: string | null;
}

interface ProjectVoImpactResponse {
  projectId: number;
  projectGp: number;
  thresholdPct: number;
  vos: VoImpactRow[];
  totals: {
    revenueDelta: number;
    costDelta: number;
    gpImpact: number;
    count: number;
    flaggedCount: number;
  };
}

function pct(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function VoImpactPanel({ projectId }: { projectId: number }) {
  const enabled = Number.isInteger(projectId) && projectId > 0;
  const query = useQuery<ProjectVoImpactResponse>({
    queryKey: ["/api/finance/projects", projectId, "vo-impact"],
    queryFn: fetchQueryFn(`/api/finance/projects/${projectId}/vo-impact`),
    enabled,
    retry: 1,
  });

  const data = query.data;

  return (
    <Card data-testid="vo-impact-panel">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span>Variation Orders — Financial Impact</span>
          {data ? (
            <span className="text-xs font-normal text-muted-foreground">
              Project GP {formatZar(data.projectGp)} · gate {(data.thresholdPct * 100).toFixed(0)}% of GP
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading variation orders…</p>
        ) : query.isError ? (
          <p className="text-sm text-muted-foreground">Variation order impact is unavailable right now.</p>
        ) : !data || data.vos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No variation orders captured for this project.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="vo-impact-table">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Variation order</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">Revenue Δ</th>
                  <th className="py-2 pr-3 text-right font-medium">Cost Δ</th>
                  <th className="py-2 pr-3 text-right font-medium">GP impact</th>
                  <th className="py-2 pr-3 text-right font-medium">% of GP</th>
                  <th className="py-2 pr-3 font-medium">Approval</th>
                </tr>
              </thead>
              <tbody>
                {data.vos.map((vo) => {
                  // Frozen-at-submit flag wins; fall back to the live check for
                  // VOs that pre-date the gate or were never submitted.
                  const flagged = vo.requiresManagementReview ?? vo.exceedsThreshold;
                  return (
                    <tr key={vo.id} className="border-b last:border-0 align-top" data-testid={`vo-impact-row-${vo.id}`}>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-foreground">{vo.title}</div>
                        <div className="text-xs capitalize text-muted-foreground">{vo.changeType}</div>
                      </td>
                      <td className="py-2 pr-3 capitalize text-muted-foreground">{vo.status.replace(/_/g, " ")}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatZar(vo.revenueDelta)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatZar(vo.costDelta)}</td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">{formatZar(vo.gpImpact)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1">
                          {pct(vo.gpImpactPct)}
                          {flagged ? (
                            <Badge variant="destructive" className="gap-1" data-testid={`vo-flag-${vo.id}`}>
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Mgmt review
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <ShieldCheck className="h-3 w-3" aria-hidden="true" /> PM
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {vo.finalDecision ? <span className="capitalize">{vo.finalDecision}</span> : "Pending"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="py-2 pr-3" colSpan={2}>
                    Total ({data.totals.count}) · {data.totals.flaggedCount} need management review
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatZar(data.totals.revenueDelta)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatZar(data.totals.costDelta)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatZar(data.totals.gpImpact)}</td>
                  <td className="py-2 pr-3" colSpan={2} />
                </tr>
              </tfoot>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">
              GP impact = revenue Δ − COS Δ. A VO whose GP impact exceeds {(data.thresholdPct * 100).toFixed(0)}% of project
              GP needs management review + RCA (BR-026); at or below is PM-approvable (BR-025).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
