import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, ArrowRight } from "lucide-react";

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
  openWarnings?: number;
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
  onSelectFilter?: (filter: string) => void;
  highSeverityWarningCount?: number;
}

export function QualityGovernanceSummary({ counts, risk, handover, onSelectFilter, highSeverityWarningCount = 0 }: QualityGovernanceSummaryProps) {
  const actionCards = [
    { key: "handover", label: "Handover blocked", value: handover?.blocked ? 1 : 0, filter: "handover_blocking", why: "Shown when quality gate blockers stop PD → PM handover." },
    { key: "evidence", label: "Evidence gaps", value: counts.evidenceRequired, filter: "evidence_gap", why: "Shown for applicable items requiring evidence with no uploaded proof." },
    { key: "review", label: "Pending review", value: counts.pendingReview, filter: "review", why: "Shown for items sent for approval that are awaiting QC decision." },
    { key: "failed", label: "Failed / resubmission", value: counts.resubmissionNeeded, filter: "fail", why: "Shown for items failed in review and requiring rework + resubmission." },
    { key: "overdue", label: "Overdue items", value: counts.overdue, filter: "overdue", why: "Shown when an unresolved item due date is before today." },
    { key: "warnings", label: "High warnings", value: highSeverityWarningCount, filter: "high_warnings", why: "Shown for open warnings with High severity." },
  ];

  return (
    <Card className="border-border/70" data-testid="quality-governance-summary">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold">Quality Action Centre</p>
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

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {actionCards.map((card) => {
            const hasItems = card.value > 0;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => onSelectFilter?.(card.filter)}
                className="rounded-lg border px-3 py-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-70"
                disabled={!onSelectFilter}
                data-testid={`quality-action-card-${card.key}`}
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{card.label}</p>
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-lg font-bold">{card.value}</p>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Why shown: {card.why}</p>
                {!hasItems && <p className="text-[11px] text-emerald-700 mt-1">No action needed right now.</p>}
              </button>
            );
          })}
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
