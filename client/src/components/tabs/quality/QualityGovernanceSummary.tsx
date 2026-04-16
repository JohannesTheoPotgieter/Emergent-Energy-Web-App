import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

function getRiskLevelClass(level: string) {
  switch ((level || "").toLowerCase()) {
    case "critical": return "bg-red-50 text-red-700 border-red-200";
    case "high": return "bg-amber-50 text-amber-700 border-amber-200";
    case "medium": return "bg-sky-50 text-sky-700 border-sky-200";
    default: return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
}

interface GovernanceCounts {
  overdue: number;
  resubmissionNeeded: number;
  evidenceRequired: number;
  pendingReview: number;
  unansweredRisk: number;
  triggeredRisk: number;
  linkedMicrosoftItems: number;
}

interface HandoverInfo {
  blocked: boolean;
  blockers: string[];
  rejectionReason: string | null;
}

interface RiskInfo {
  level: string;
  summary: string;
}

interface QualityGovernanceSummaryProps {
  counts: GovernanceCounts;
  risk: RiskInfo;
  handover: HandoverInfo | null;
}

export function QualityGovernanceSummary({ counts, risk, handover }: QualityGovernanceSummaryProps) {
  return (
    <Card className="border-border/70" data-testid="quality-governance-summary">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold">Quality status</p>
            <p className="text-xs text-muted-foreground mt-1">
              {risk.summary || "Overview of outstanding quality actions, evidence, and handover readiness."}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={getRiskLevelClass(risk.level)}>
              {risk.level.toUpperCase()} risk
            </Badge>
            {handover?.blocked && (
              <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">
                Handover blocked
              </Badge>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Overdue</p>
            <p className="text-lg font-bold text-red-600 mt-1">{counts.overdue}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Past due and unresolved</p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Failed QC</p>
            <p className="text-lg font-bold text-amber-600 mt-1">{counts.resubmissionNeeded}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Items that failed inspection — fix and resubmit</p>
          </div>
          <div className="rounded-lg border border-sky-100 bg-sky-50/50 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Evidence gaps</p>
            <p className="text-lg font-bold text-sky-600 mt-1">{counts.evidenceRequired}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Required proof still missing</p>
          </div>
          <div className="rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">In Review</p>
            <p className="text-lg font-bold text-violet-600 mt-1">{counts.pendingReview}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Items submitted and awaiting QC decision</p>
          </div>
          <div className="rounded-lg border border-orange-100 bg-orange-50/50 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Risk answers</p>
            <p className="text-lg font-bold text-orange-600 mt-1">{counts.unansweredRisk} open / {counts.triggeredRisk} triggered</p>
            <p className="text-[11px] text-muted-foreground mt-1">Unanswered or triggered risk questions</p>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Linked Microsoft</p>
            <p className="text-lg font-bold text-emerald-600 mt-1">{counts.linkedMicrosoftItems}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Quality-linked comms and follow-ups</p>
          </div>
        </div>

        {handover?.blocked && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3" data-testid="quality-handover-blocked">
            <div className="flex items-center gap-2 text-violet-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="text-sm font-semibold">Handover to execution is blocked — resolve these quality issues first</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(handover.blockers || []).map((blocker) => (
                <Badge key={blocker} variant="outline" className="bg-white/80 text-violet-700 border-violet-200">
                  {blocker}
                </Badge>
              ))}
            </div>
            {handover.rejectionReason && (
              <p className="text-xs text-violet-700/90 mt-2">{handover.rejectionReason}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
