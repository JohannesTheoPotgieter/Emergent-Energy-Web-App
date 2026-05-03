/**
 * D6 Phase 6 — PortfolioReadinessTile.
 *
 * Dashboard-friendly summary listing the lowest-readiness projects so
 * COO/CCO/program managers can see at a glance which projects have a
 * documents gap. Mounts on home dashboards (caller's choice — exported
 * but not auto-mounted to avoid disturbing the home pages in this PR).
 *
 * Data source: GET /api/portfolio/document-readiness, ordered ascending
 * by percentReady on the server side.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortfolioReadiness } from "@/hooks/use-document-readiness";
import { Link } from "wouter";
import { Gauge, AlertTriangle } from "lucide-react";

export interface PortfolioReadinessTileProps {
  /** How many at-risk projects to show. Defaults to 5. */
  limit?: number;
  /** Optional title override; defaults to "Documents readiness". */
  title?: string;
}

export function PortfolioReadinessTile({ limit = 5, title }: PortfolioReadinessTileProps) {
  const data = usePortfolioReadiness();

  const heading = title ?? "Documents readiness";
  const rows = (data.data?.rows ?? []).slice(0, limit);

  return (
    <Card data-testid="portfolio-readiness-tile">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{heading}</h3>
          <Badge
            variant="outline"
            className="ml-auto text-[10px]"
            data-testid="portfolio-readiness-count"
          >
            {data.data?.rows.length ?? 0} projects
          </Badge>
        </div>

        {data.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : data.error ? (
          <div className="rounded-md border p-4 text-sm text-destructive">
            Failed to load portfolio readiness.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            No projects yet.
          </div>
        ) : (
          <ul className="space-y-2" data-testid="portfolio-readiness-list">
            {rows.map((r) => (
              <li
                key={r.projectId}
                className="rounded-md border p-2 space-y-1"
                data-testid={`portfolio-readiness-row-${r.projectId}`}
              >
                <div className="flex items-center gap-2">
                  <Link
                    href={`/projects/${r.projectId}/documents`}
                    className="text-sm font-medium hover:underline truncate"
                  >
                    {r.projectName}
                  </Link>
                  {r.hasFolderGap && (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Folder gap
                    </Badge>
                  )}
                  <span className="ml-auto text-xs font-mono">{r.percentReady}%</span>
                </div>
                <Progress value={r.percentReady} className="h-1.5" />
                <div className="text-[10px] text-muted-foreground">
                  {r.foldersProvisioned}/{r.foldersTotal} folders ·{" "}
                  {r.requirementsApproved}/{r.requirementsTotal} docs
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
