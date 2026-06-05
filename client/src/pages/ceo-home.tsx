import { useMemo } from "react";
import { useLocation } from "wouter";
import { useGatesPipeline, type GateProjectCard } from "@/hooks/use-gates";
import { ManagedDocumentApprovalQueue } from "@/components/documents/ManagedDocumentApprovalQueue";
import { PageHeader } from "@/components/ui/page-header";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sun, ArrowRight, Clock, DollarSign, TrendingUp, Users,
} from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";

/**
 * CEO pre-execution home.
 *
 * Landing for CEO_ADMIN lens. Three concerns, priority-ordered:
 *   1) Waiting on me (approval queue — uses D3 document-control queue)
 *   2) Pre-execution pipeline (deals by stage: First Assessment / Cost
 *      Proposal / Design) with headline cost + revenue, latest activity,
 *      and proposed sign date.
 *   3) Upcoming handovers — projects approaching PD -> PM handover.
 *   4) Overarching lifecycle summary — counts per execution stage so the
 *      CEO has full visibility without leaving this page.
 *
 * Actionable rule: every row + tile deep-links to the specific project /
 * handover / approval — no dead landings.
 */

import { SEQUENTIAL_PHASES } from "@shared/phases";

// Pre-execution = displayNumber 1..3 (First Assessment, Cost Proposal &
// Design, Financial Close). The CEO home tints these distinctively, so
// we keep the colour map local but pull labels & order from the
// canonical lifecycle to avoid drift with shared/phases.ts.
const PRE_EXEC_TINTS: Record<string, string> = {
  S01_FIRST_ASSESSMENT: "bg-sky-50 border-sky-200",
  S02_DESIGN_COST_PROPOSAL: "bg-violet-50 border-violet-200",
  S03_SIGNATURE_FINANCIAL_CLOSE: "bg-emerald-50 border-emerald-200",
};
const PRE_EXEC_STAGES = SEQUENTIAL_PHASES
  .filter((p) => p.displayNumber !== null && p.displayNumber <= 3)
  .map((p) => ({ code: p.code, label: p.label, tint: PRE_EXEC_TINTS[p.code] ?? "" }));

// Execution = displayNumber 4..10. Order is driven entirely by the
// canonical SEQUENTIAL_PHASES list, which guarantees the post-Task #81
// ordering (3 Months Post HO Review at #9, Compliance Handover at #10).
const EXECUTION_STAGES = SEQUENTIAL_PHASES
  .filter((p) => p.displayNumber !== null && p.displayNumber >= 4)
  .map((p) => ({ code: p.code, label: p.label }));

export default function CeoHome() {
  const { data: gatesData, isLoading, error } = useGatesPipeline();

  const preExecByStage = useMemo(() => {
    const all = gatesData?.projects ?? [];
    const map = new Map<string, GateProjectCard[]>();
    for (const stage of PRE_EXEC_STAGES) map.set(stage.code, []);
    for (const p of all) {
      if (p.currentStageCode && map.has(p.currentStageCode)) {
        map.get(p.currentStageCode)!.push(p);
      }
    }
    return map;
  }, [gatesData]);

  const executionStageCounts = useMemo(() => {
    const all = gatesData?.projects ?? [];
    const counts = new Map<string, number>();
    for (const stage of EXECUTION_STAGES) counts.set(stage.code, 0);
    for (const p of all) {
      if (p.currentStageCode && counts.has(p.currentStageCode)) {
        counts.set(p.currentStageCode, (counts.get(p.currentStageCode) ?? 0) + 1);
      }
    }
    return counts;
  }, [gatesData]);

  // CEO's "Upcoming handovers" card is specifically for PD -> PM handover
  // (the charter-signing moment the CEO attends). O&M / Client handovers
  // live elsewhere. Source from the gates pipeline filtered to the
  // PD->PM stage codes (S03 post-merge, S04 legacy pre-merge).
  const upcomingHandovers = useMemo(() => {
    const all = gatesData?.projects ?? [];
    return all
      .filter((p) => p.currentStageCode === "S03_SIGNATURE_FINANCIAL_CLOSE" || p.currentStageCode === "S04_PD_PM_HANDOVER")
      .sort((a, b) => (b.gateReadinessPct ?? 0) - (a.gateReadinessPct ?? 0))
      .slice(0, 8);
  }, [gatesData]);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load CEO home" />;

  return (
    <PageLayout
      data-testid="ceo-home-page"
      header={
        <PageHeader
          title="CEO Dashboard"
          subtitle="Pre-execution pipeline, approvals waiting on you, and what's coming up."
        />
      }
    >
      {/* Row 1: Waiting on me */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <ManagedDocumentApprovalQueue title="Approvals waiting on you" />
        </div>
        <div className="lg:col-span-2">
          <UpcomingHandoversCard rows={upcomingHandovers} />
        </div>
      </div>

      {/* Row 2: Pre-execution pipeline by stage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PRE_EXEC_STAGES.map((stage) => (
          <StageColumn
            key={stage.code}
            stage={stage}
            projects={preExecByStage.get(stage.code) ?? []}
          />
        ))}
      </div>

      {/* Row 3: Overarching lifecycle summary */}
      <LifecycleSummaryStrip counts={executionStageCounts} />
    </PageLayout>
  );
}

function StageColumn({
  stage,
  projects,
}: {
  stage: typeof PRE_EXEC_STAGES[number];
  projects: GateProjectCard[];
}) {
  return (
    <Card data-testid={`stage-col-${stage.code}`}>
      <CardHeader className={`${stage.tint} border-b pb-3`}>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-primary" />
            {stage.label}
          </span>
          <Badge variant="outline" className="text-[10px] bg-white">
            {projects.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">No deals at this stage.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {projects.map((p) => (
              <DealCard key={p.projectId} project={p} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DealCard({ project }: { project: GateProjectCard }) {
  const contractValue = project.contractValue ? Number(project.contractValue) : null;
  return (
    <li data-testid={`deal-card-${project.projectId}`}>
      <Link
        href={`/project/${encodeURIComponent(project.projectName)}`}
        className="block p-3 hover:bg-[hsl(var(--surface-tint))] transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium truncate" title={project.projectName}>
              {project.projectName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {project.clientName || "—"}
            </p>
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
              {project.pd && (
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {project.pd}
                </span>
              )}
              {project.gateReadinessPct != null && (
                <span className="flex items-center gap-1 tabular-nums">
                  {project.gateReadinessPct}% ready
                </span>
              )}
              {project.daysInStage != null && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {project.daysInStage}d
                </span>
              )}
            </div>
            {contractValue != null && contractValue > 0 && (
              <p className="text-xs text-emerald-700 font-medium flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                R{contractValue.toLocaleString("en-ZA")}
              </p>
            )}
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
        </div>
      </Link>
    </li>
  );
}

function UpcomingHandoversCard({ rows }: { rows: GateProjectCard[] }) {
  const [, navigate] = useLocation();
  return (
    <Card data-testid="upcoming-handovers-card" className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Upcoming PD → PM handovers
          <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">No PD → PM handovers pending.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {rows.map((r) => {
              const engineeringOwner = r.constructionManagerName || r.constructionManager || null;
              const outstandingCount = r.openExceptionCount ?? 0;
              const readiness = r.gateReadinessPct ?? 0;
              const readinessTone =
                readiness >= 95 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : readiness >= 70 ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-red-50 text-red-700 border-red-200";
              return (
                <li key={r.projectId} className="py-2.5" data-testid={`upcoming-handover-${r.projectId}`}>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => navigate(`/project/${encodeURIComponent(r.projectName)}`)}
                      className="flex-1 min-w-0 text-left hover:bg-[hsl(var(--surface-tint))] rounded px-2 -mx-2 py-1 transition-colors"
                    >
                      <p className="text-sm font-medium truncate">{r.projectName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.clientName || "—"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                        {r.pd && <span>PD: <span className="text-foreground font-medium">{r.pd}</span></span>}
                        {r.pm && <span>· PM: <span className="text-foreground font-medium">{r.pm}</span></span>}
                        {engineeringOwner && <span>· Eng: <span className="text-foreground font-medium">{engineeringOwner}</span></span>}
                      </div>
                    </button>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="outline" className={`text-[10px] tabular-nums ${readinessTone}`}>
                        {readiness}% ready
                      </Badge>
                      {outstandingCount > 0 && (
                        <Badge variant="outline" className="text-[10px] bg-muted">
                          {outstandingCount} open item{outstandingCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 ml-1">
                    <Link
                      href={`/handover/${r.projectId}/live`}
                      className="text-[11px] text-primary hover:underline"
                      data-testid={`open-live-room-${r.projectId}`}
                    >
                      Open live meeting room →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LifecycleSummaryStrip({ counts }: { counts: Map<string, number> }) {
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  return (
    <Card data-testid="lifecycle-summary-strip">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Portfolio across execution
          <Badge variant="outline" className="text-[10px]">{total} projects</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
          {EXECUTION_STAGES.map((stage) => {
            const n = counts.get(stage.code) ?? 0;
            return (
              <Link
                key={stage.code}
                href={`/gates/pipeline?stage=${stage.code}`}
                className="block rounded-md border bg-card p-2.5 hover:bg-[hsl(var(--surface-tint))] hover:border-primary/30 transition-colors"
                data-testid={`stage-count-${stage.code}`}
              >
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate" title={stage.label}>
                  {stage.label}
                </p>
                <p className="text-lg font-semibold tabular-nums mt-0.5">{n}</p>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
