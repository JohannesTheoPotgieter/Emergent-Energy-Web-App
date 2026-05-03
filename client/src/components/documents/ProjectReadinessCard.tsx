/**
 * D6 Phase 6 — ProjectReadinessCard.
 *
 * Soft-enforcement summary mounted on /projects/:id/documents (above the
 * approval queue). Shows:
 *   - overall readiness percentage with a coloured progress bar
 *   - per-discipline breakdown
 *   - a collapsed checklist of every required document with status
 *
 * No hard gating — the goal is visibility, not friction.
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  useProjectReadiness,
  type RequirementReadiness,
} from "@/hooks/use-document-readiness";
import { CheckCircle2, AlertTriangle, FolderX, Clock, ChevronDown, ChevronUp, Gauge } from "lucide-react";

export interface ProjectReadinessCardProps {
  projectId: number;
}

export function ProjectReadinessCard({ projectId }: ProjectReadinessCardProps) {
  const readiness = useProjectReadiness(projectId);
  const [expanded, setExpanded] = useState(false);

  const data = readiness.data;
  const percent = data?.percentReady ?? 0;
  const tone = useMemo(() => percentTone(percent), [percent]);

  if (readiness.isLoading) {
    return (
      <Card data-testid="project-readiness-card">
        <CardContent className="pt-6 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (readiness.error || !data) {
    return (
      <Card data-testid="project-readiness-card">
        <CardContent className="py-6 text-sm text-destructive">
          Failed to load readiness summary.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="project-readiness-card">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Documents readiness</h3>
          <Badge
            variant="outline"
            className={`ml-auto text-[11px] ${tone.badge}`}
            data-testid="project-readiness-percent"
          >
            {percent}% ready
          </Badge>
        </div>

        <div>
          <Progress value={percent} className="h-2" />
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span data-testid="project-readiness-folder-count">
              <CheckCircle2 className="inline-block h-3 w-3 mr-0.5 text-emerald-600" />
              {data.foldersProvisioned}/{data.foldersTotal} folders provisioned
            </span>
            <span data-testid="project-readiness-requirement-count">
              <CheckCircle2 className="inline-block h-3 w-3 mr-0.5 text-emerald-600" />
              {data.requirementsApproved}/{data.requirementsTotal} required docs approved
            </span>
          </div>
        </div>

        {data.perDiscipline.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">By discipline</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {data.perDiscipline.map((d) => (
                <div
                  key={d.discipline}
                  className="rounded-md border px-2 py-1 text-xs"
                  data-testid={`readiness-discipline-${d.discipline}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{d.discipline}</span>
                    <span className={`text-[11px] ${percentTone(d.percentReady).text}`}>
                      {d.percentReady}%
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {d.foldersProvisioned}/{d.foldersTotal} folders ·{" "}
                    {d.requirementsApproved}/{d.requirementsTotal} docs
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((s) => !s)}
          data-testid="btn-readiness-toggle"
          className="text-xs"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3 mr-1" /> Hide checklist
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3 mr-1" />
              Show {data.requirements.length} required-document
              {data.requirements.length === 1 ? "" : "s"}
            </>
          )}
        </Button>

        {expanded && data.requirements.length > 0 && (
          <Table data-testid="readiness-checklist-table">
            <TableHeader>
              <TableRow>
                <TableHead>Folder</TableHead>
                <TableHead>Required document</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.requirements.map((r) => (
                <TableRow
                  key={r.requirementId}
                  data-testid={`readiness-checklist-row-${r.requirementId}`}
                >
                  <TableCell className="font-mono text-xs">{r.taxonomyKey}</TableCell>
                  <TableCell className="text-sm">{r.displayName}</TableCell>
                  <TableCell className="text-right">
                    <ReadinessStatus status={r.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ReadinessStatus({ status }: { status: RequirementReadiness["status"] }) {
  if (status === "approved") {
    return (
      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Approved
      </Badge>
    );
  }
  if (status === "in_review") {
    return (
      <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700">
        <Clock className="h-3 w-3 mr-1" />
        In review
      </Badge>
    );
  }
  if (status === "folder_missing") {
    return (
      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800">
        <FolderX className="h-3 w-3 mr-1" />
        Folder missing
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700">
      <AlertTriangle className="h-3 w-3 mr-1" />
      Missing
    </Badge>
  );
}

function percentTone(percent: number): { badge: string; text: string } {
  if (percent >= 90) return { badge: "bg-emerald-50 text-emerald-700", text: "text-emerald-700" };
  if (percent >= 70) return { badge: "bg-sky-50 text-sky-700", text: "text-sky-700" };
  if (percent >= 40) return { badge: "bg-amber-50 text-amber-800", text: "text-amber-800" };
  return { badge: "bg-rose-50 text-rose-700", text: "text-rose-700" };
}
