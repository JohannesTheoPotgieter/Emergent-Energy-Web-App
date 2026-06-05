/**
 * ProjectImportStatusCard — the one-glance "is this project's Smart Import
 * up to date?" surface, given a `projectId`.
 *
 * Reads /api/projects/:projectId/import-status and renders a compact status
 * banner with:
 *   - a state badge (up to date = emerald, needs review = amber,
 *     failed = red, in progress = neutral)
 *   - last imported (relative time) + records changed
 *   - the reason, when the import is not up to date
 *   - a "Review" link into the Smart Import area when the latest run
 *     needs review or failed
 *
 * Handles the never-imported case (latest === null) gracefully.
 */

import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, ArrowRight } from "lucide-react";
import { formatRelativeWithAbsoluteZA } from "@/lib/datetime";
import { useProjectImportStatus } from "@/hooks/use-import-config";
import {
  ImportStateBadge,
  ImportStateIcon,
  getImportStateMeta,
} from "@/components/import/import-state-badge";

const SMART_IMPORT_PATH = "/admin/smart-import";

export function ProjectImportStatusCard({ projectId }: { projectId: number }) {
  const { data, isLoading } = useProjectImportStatus(projectId);
  const latest = data?.latest ?? null;

  if (isLoading) {
    return (
      <Card data-testid="project-import-status-card">
        <CardContent className="pt-5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileSpreadsheet className="h-4 w-4" />
            Checking import status…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!latest) {
    return (
      <Card className="border-muted bg-muted/30" data-testid="project-import-status-card">
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold" data-testid="import-status-headline">
                No import yet
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                This project has never had a Smart Import. Upload a workbook to start tracking it.
              </div>
            </div>
            <Link href={SMART_IMPORT_PATH} className="ml-auto shrink-0">
              <Button size="sm" variant="outline" className="h-8" data-testid="btn-import-open">
                Open Smart Import
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const meta = getImportStateMeta(latest.state);
  const isUpToDate = latest.state === "up_to_date";
  const showReview = latest.state === "needs_review" || latest.state === "failed";

  return (
    <Card className={`${meta.tone.border} ${meta.tone.bg}`} data-testid="project-import-status-card">
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <ImportStateIcon state={latest.state} className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-sm font-semibold ${meta.tone.text}`}
                  data-testid="import-status-headline"
                >
                  Smart Import
                </span>
                <ImportStateBadge state={latest.state} />
              </div>
              <div className="text-xs text-muted-foreground mt-0.5" data-testid="import-status-detail">
                <span className="font-mono">{latest.sourceFileName}</span>
                <span> · last imported {formatRelativeWithAbsoluteZA(latest.lastImportedAt)}</span>
                {typeof latest.recordsChanged === "number" && (
                  <span>
                    {" "}· {latest.recordsChanged} record{latest.recordsChanged === 1 ? "" : "s"} changed
                  </span>
                )}
              </div>
              {!isUpToDate && latest.reason && (
                <div
                  className={`text-[11px] mt-1 ${meta.tone.text}`}
                  data-testid="import-status-reason"
                >
                  {latest.reason}
                </div>
              )}
            </div>
          </div>

          {showReview && (
            <Link href={SMART_IMPORT_PATH} className="shrink-0">
              <Button size="sm" variant="outline" className="h-8" data-testid="btn-import-review">
                Review
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
