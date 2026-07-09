import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { getRiskSeverityColor, formatRiskYesNo, parseRiskYesNo } from "@/lib/quality-ui-helpers";

export interface RiskAnswerSubmit {
  riskAnswerId?: number;
  templateRiskQuestionId?: number;
  updates: Record<string, unknown>;
}

/**
 * Risk-questions panel for the selected phase (Task 3.3 extraction from
 * QualityTab). Answers by id when a row exists, else upserts by template
 * question id (Task 1.4). Purely presentational — the parent owns the
 * mutation via `onSubmit`.
 */
export function RiskQuestionsPanel({
  riskQuestions,
  getRiskAnswer,
  canEdit,
  open,
  onOpenChange,
  onSubmit,
}: {
  riskQuestions: any[];
  getRiskAnswer: (riskQuestionId: number) => any;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: RiskAnswerSubmit) => void;
}) {
  if (riskQuestions.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-3 cursor-pointer hover:bg-muted/30 px-4 py-3 transition-colors" data-testid="risk-questions-toggle">
            {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold flex-1">Risk Questions</span>
            <Badge variant="outline" className="text-[10px]">{riskQuestions.length}</Badge>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t divide-y">
            {riskQuestions.map((rq: any) => {
              const answer = getRiskAnswer(rq.id);
              const submitRisk = (updates: Record<string, unknown>) =>
                onSubmit(
                  answer?.id != null
                    ? { riskAnswerId: answer.id, updates }
                    : { templateRiskQuestionId: rq.id, updates },
                );
              return (
                <div key={rq.id} className="px-4 py-3 space-y-2" data-testid={`risk-question-${rq.id}`}>
                  <div className="flex items-start gap-2">
                    <Badge className={getRiskSeverityColor(rq.severity)} variant="outline">{rq.severity}</Badge>
                    <p className="text-sm font-medium">{rq.questionText}</p>
                  </div>
                  {canEdit && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ml-6">
                      {rq.responseType === "yesno" ? (
                        <SearchableSelect
                          value={formatRiskYesNo(answer?.answerYesno)}
                          onValueChange={(val) =>
                            submitRisk({ answerYesno: parseRiskYesNo(val === "unanswered" ? null : val) })
                          }
                          placeholder="Select answer..."
                          triggerClassName="h-8 text-xs"
                          data-testid={`select-risk-answer-${rq.id}`}
                          options={[
                            { value: "unanswered", label: "Unanswered" },
                            { value: "yes", label: "Yes" },
                            { value: "no", label: "No" },
                          ]}
                        />
                      ) : rq.responseType === "number" ? (
                        <Input
                          type="number"
                          step="any"
                          className="h-8 text-xs"
                          placeholder="Enter number..."
                          // Uncontrolled + commit-on-blur: binding value to server
                          // data and mutating per keystroke fired a save on every
                          // key and the refetch overwrote the field mid-typing.
                          defaultValue={answer?.answerNumber ?? ""}
                          onBlur={(e) => {
                            const next = e.target.value === "" ? null : Number(e.target.value);
                            if (next !== (answer?.answerNumber ?? null)) {
                              submitRisk({ answerNumber: next });
                            }
                          }}
                          data-testid={`input-risk-number-${rq.id}`}
                        />
                      ) : (
                        <Textarea
                          className="text-xs"
                          placeholder="Enter response..."
                          rows={2}
                          defaultValue={answer?.answerText || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (answer?.answerText || "")) {
                              submitRisk({ answerText: e.target.value });
                            }
                          }}
                          data-testid={`input-risk-text-${rq.id}`}
                        />
                      )}
                    </div>
                  )}
                  {!canEdit && answer && (
                    <div className="text-xs space-y-1 ml-6">
                      <p>
                        <span className="font-medium">Answer:</span>{" "}
                        {rq.responseType === "yesno"
                          ? formatRiskYesNo(answer.answerYesno) === "unanswered"
                            ? "Unanswered"
                            : formatRiskYesNo(answer.answerYesno) === "yes"
                              ? "Yes"
                              : "No"
                          : rq.responseType === "number"
                            ? (answer.answerNumber ?? "Unanswered")
                            : (answer.answerText || "Unanswered")}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
