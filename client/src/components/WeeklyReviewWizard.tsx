import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Calendar, Clock, DollarSign, AlertTriangle, ShieldCheck,
  ListTodo, FileText, ChevronRight, ChevronLeft, Check,
  Loader2, Plus, Trash2, Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, addDays } from "date-fns";

const STEPS = [
  { key: "schedule", label: "Schedule", icon: Calendar, description: "Review schedule progress and timeline risks" },
  { key: "budget", label: "Costed", icon: DollarSign, description: "Check costed health and cost variances" },
  { key: "risks", label: "Risks", icon: AlertTriangle, description: "Identify and assess current risks" },
  { key: "quality", label: "Quality", icon: ShieldCheck, description: "Review quality gates and compliance" },
  { key: "actions", label: "Actions", icon: ListTodo, description: "Define action items for next week" },
  { key: "summary", label: "Summary", icon: FileText, description: "Review and submit your weekly summary" },
] as const;

type StepKey = typeof STEPS[number]["key"];

interface ActionItem {
  id: string;
  description: string;
  owner: string;
  priority: "high" | "medium" | "low";
  dueDate: string;
}

interface WeeklyReviewWizardProps {
  projectName: string;
  snapshotMetrics?: {
    phase?: string;
    completion?: number;
    totalRevenue?: number;
    totalExpenses?: number;
    margin?: number;
    overdueCount?: number;
  };
}

export function WeeklyReviewWizard({ projectName, snapshotMetrics }: WeeklyReviewWizardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");

  const [schedule, setSchedule] = useState({ onTrack: "yes" as string, notes: "", delayDays: 0, mitigationPlan: "" });
  const [budget, setBudget] = useState({ withinBudget: "yes" as string, notes: "", variancePercent: 0, costConcerns: "" });
  const [risks, setRisks] = useState<Array<{ id: string; description: string; impact: string; likelihood: string; mitigation: string }>>([]);
  const [quality, setQuality] = useState({ gatesOnTrack: "yes" as string, notes: "", inspectionsDue: "", nonConformances: "" });
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [summary, setSummary] = useState({ overallStatus: "green" as string, keyMessage: "", escalations: "" });

  const { data: pastReviews = [] } = useQuery({
    queryKey: ["weekly-reviews", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/weekly-reviews/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/weekly-reviews/${encodeURIComponent(projectName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStarting: weekStart, snapshotMetrics }),
      });
      if (!res.ok) throw new Error("Failed to create review");
      return res.json();
    },
    onSuccess: (data) => {
      setReviewId(data.id);
      setShowWizard(true);
      toast({ title: "Review started", description: `Week of ${weekStart}` });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (stepData: Record<string, any>) => {
      if (!reviewId) return;
      const res = await fetch(`/api/weekly-reviews/${encodeURIComponent(projectName)}/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stepData),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!reviewId) return;
      const res = await fetch(`/api/weekly-reviews/${encodeURIComponent(projectName)}/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          stepSchedule: schedule,
          stepBudget: budget,
          stepRisks: risks,
          stepQuality: quality,
          stepActions: actions,
          stepSummary: summary,
        }),
      });
      if (!res.ok) throw new Error("Failed to complete review");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-reviews", projectName] });
      setShowWizard(false);
      setReviewId(null);
      setCurrentStep(0);
      toast({ title: "Review completed", description: "Weekly review has been saved." });
    },
  });

  const saveCurrentStep = () => {
    const stepKey = STEPS[currentStep].key;
    const dataMap: Record<StepKey, any> = {
      schedule: { stepSchedule: schedule },
      budget: { stepBudget: budget },
      risks: { stepRisks: risks },
      quality: { stepQuality: quality },
      actions: { stepActions: actions },
      summary: { stepSummary: summary },
    };
    saveMutation.mutate(dataMap[stepKey]);
  };

  const goNext = () => {
    saveCurrentStep();
    if (currentStep < STEPS.length - 1) setCurrentStep(currentStep + 1);
  };

  const goPrev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const addRisk = () => {
    setRisks([...risks, { id: Date.now().toString(), description: "", impact: "medium", likelihood: "medium", mitigation: "" }]);
  };

  const removeRisk = (id: string) => setRisks(risks.filter(r => r.id !== id));

  const addAction = () => {
    setActions([...actions, { id: Date.now().toString(), description: "", owner: "", priority: "medium", dueDate: format(addDays(new Date(), 7), "yyyy-MM-dd") }]);
  };

  const removeAction = (id: string) => setActions(actions.filter(a => a.id !== id));

  const currentWeekReview = pastReviews.find((r: any) => r.weekStarting === weekStart);

  if (!showWizard) {
    return (
      <div className="space-y-4" data-testid="weekly-review-panel">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Weekly Reviews</h3>
            <p className="text-xs text-muted-foreground">Structured project check-in every week</p>
          </div>
          {currentWeekReview ? (
            <Badge variant="outline" className="text-xs" data-testid="badge-review-status">
              <Check className="h-3 w-3 mr-1 text-emerald-600" />
              This week reviewed
            </Badge>
          ) : (
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="gap-1.5"
              data-testid="button-start-review"
            >
              {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Start Weekly Review
            </Button>
          )}
        </div>

        {pastReviews.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Past Reviews</p>
            <div className="grid gap-2">
              {(pastReviews as any[]).slice(0, 4).map((review: any) => (
                <Card key={review.id} className="p-3" data-testid={`review-card-${review.id}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">Week of {review.weekStarting}</span>
                    </div>
                    <Badge
                      variant={review.status === "completed" ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {review.status === "completed" ? "Completed" : "Draft"}
                    </Badge>
                  </div>
                  {review.stepSummary?.keyMessage && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{review.stepSummary.keyMessage}</p>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const StepIcon = STEPS[currentStep].icon;

  return (
    <div className="space-y-4" data-testid="weekly-review-wizard">
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = idx === currentStep;
          const isDone = idx < currentStep;
          return (
            <button
              key={step.key}
              onClick={() => { saveCurrentStep(); setCurrentStep(idx); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                isActive ? "bg-primary text-primary-foreground" :
                isDone ? "bg-emerald-100 text-emerald-700" :
                "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              data-testid={`step-${step.key}`}
            >
              {isDone ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              {step.label}
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <StepIcon className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">{STEPS[currentStep].label}</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground">{STEPS[currentStep].description}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {currentStep === 0 && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Is the project on schedule?</label>
                <Select value={schedule.onTrack} onValueChange={(v) => setSchedule({ ...schedule, onTrack: v })}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-schedule-track">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">On Track</SelectItem>
                    <SelectItem value="at_risk">At Risk</SelectItem>
                    <SelectItem value="delayed">Delayed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {schedule.onTrack !== "yes" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Estimated delay (days)</label>
                  <input
                    type="number"
                    className="w-full h-8 px-3 text-xs border rounded-md"
                    value={schedule.delayDays}
                    onChange={(e) => setSchedule({ ...schedule, delayDays: Number(e.target.value) })}
                    data-testid="input-delay-days"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Schedule notes</label>
                <Textarea
                  className="text-xs min-h-[60px]"
                  value={schedule.notes}
                  onChange={(e) => setSchedule({ ...schedule, notes: e.target.value })}
                  placeholder="Key milestones, blockers, dependencies..."
                  data-testid="textarea-schedule-notes"
                />
              </div>
              {schedule.onTrack !== "yes" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Mitigation plan</label>
                  <Textarea
                    className="text-xs min-h-[60px]"
                    value={schedule.mitigationPlan}
                    onChange={(e) => setSchedule({ ...schedule, mitigationPlan: e.target.value })}
                    placeholder="Steps to recover schedule..."
                    data-testid="textarea-schedule-mitigation"
                  />
                </div>
              )}
            </>
          )}

          {currentStep === 1 && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Is the project within costed amounts?</label>
                <Select value={budget.withinBudget} onValueChange={(v) => setBudget({ ...budget, withinBudget: v })}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-budget-track">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Within Costed</SelectItem>
                    <SelectItem value="at_risk">At Risk</SelectItem>
                    <SelectItem value="over_budget">Over Costed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {snapshotMetrics && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-muted/50 rounded p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">Revenue</p>
                    <p className="text-xs font-bold">R{((snapshotMetrics.totalRevenue || 0) / 1e6).toFixed(1)}M</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">Expenses</p>
                    <p className="text-xs font-bold">R{((snapshotMetrics.totalExpenses || 0) / 1e6).toFixed(1)}M</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">Margin</p>
                    <p className="text-xs font-bold">{((snapshotMetrics.margin || 0) * 100).toFixed(1)}%</p>
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Costed notes</label>
                <Textarea
                  className="text-xs min-h-[60px]"
                  value={budget.notes}
                  onChange={(e) => setBudget({ ...budget, notes: e.target.value })}
                  placeholder="Cost variances, procurement issues..."
                  data-testid="textarea-budget-notes"
                />
              </div>
            </>
          )}

          {currentStep === 2 && (
            <>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Active Risks ({risks.length})</label>
                <Button size="sm" variant="outline" onClick={addRisk} className="h-7 text-xs gap-1" data-testid="button-add-risk">
                  <Plus className="h-3 w-3" /> Add Risk
                </Button>
              </div>
              {risks.map((risk, idx) => (
                <Card key={risk.id} className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Risk {idx + 1}</span>
                    <Button size="sm" variant="ghost" onClick={() => removeRisk(risk.id)} className="h-6 w-6 p-0" data-testid={`button-remove-risk-${idx}`}>
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                  <Textarea
                    className="text-xs min-h-[40px]"
                    value={risk.description}
                    onChange={(e) => { const n = [...risks]; n[idx] = { ...n[idx], description: e.target.value }; setRisks(n); }}
                    placeholder="Describe the risk..."
                    data-testid={`textarea-risk-${idx}`}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={risk.impact} onValueChange={(v) => { const n = [...risks]; n[idx] = { ...n[idx], impact: v }; setRisks(n); }}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Impact" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low Impact</SelectItem>
                        <SelectItem value="medium">Medium Impact</SelectItem>
                        <SelectItem value="high">High Impact</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={risk.likelihood} onValueChange={(v) => { const n = [...risks]; n[idx] = { ...n[idx], likelihood: v }; setRisks(n); }}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Likelihood" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low Likelihood</SelectItem>
                        <SelectItem value="medium">Medium Likelihood</SelectItem>
                        <SelectItem value="high">High Likelihood</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    className="text-xs min-h-[40px]"
                    value={risk.mitigation}
                    onChange={(e) => { const n = [...risks]; n[idx] = { ...n[idx], mitigation: e.target.value }; setRisks(n); }}
                    placeholder="Mitigation plan..."
                  />
                </Card>
              ))}
              {risks.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No risks identified. Click "Add Risk" to add one.</p>
              )}
            </>
          )}

          {currentStep === 3 && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Are quality gates on track?</label>
                <Select value={quality.gatesOnTrack} onValueChange={(v) => setQuality({ ...quality, gatesOnTrack: v })}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-quality-track">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">All Gates On Track</SelectItem>
                    <SelectItem value="at_risk">Some Gates At Risk</SelectItem>
                    <SelectItem value="blocked">Gates Blocked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Inspections due</label>
                <Textarea
                  className="text-xs min-h-[40px]"
                  value={quality.inspectionsDue}
                  onChange={(e) => setQuality({ ...quality, inspectionsDue: e.target.value })}
                  placeholder="Upcoming inspections..."
                  data-testid="textarea-quality-inspections"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Quality notes</label>
                <Textarea
                  className="text-xs min-h-[60px]"
                  value={quality.notes}
                  onChange={(e) => setQuality({ ...quality, notes: e.target.value })}
                  placeholder="Non-conformances, rework, lessons learned..."
                  data-testid="textarea-quality-notes"
                />
              </div>
            </>
          )}

          {currentStep === 4 && (
            <>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Action Items ({actions.length})</label>
                <Button size="sm" variant="outline" onClick={addAction} className="h-7 text-xs gap-1" data-testid="button-add-action">
                  <Plus className="h-3 w-3" /> Add Action
                </Button>
              </div>
              {actions.map((action, idx) => (
                <Card key={action.id} className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Action {idx + 1}</span>
                    <Button size="sm" variant="ghost" onClick={() => removeAction(action.id)} className="h-6 w-6 p-0" data-testid={`button-remove-action-${idx}`}>
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                  <Textarea
                    className="text-xs min-h-[40px]"
                    value={action.description}
                    onChange={(e) => { const n = [...actions]; n[idx] = { ...n[idx], description: e.target.value }; setActions(n); }}
                    placeholder="What needs to be done..."
                    data-testid={`textarea-action-${idx}`}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      className="h-7 px-2 text-xs border rounded-md"
                      value={action.owner}
                      onChange={(e) => { const n = [...actions]; n[idx] = { ...n[idx], owner: e.target.value }; setActions(n); }}
                      placeholder="Owner"
                    />
                    <Select value={action.priority} onValueChange={(v: any) => { const n = [...actions]; n[idx] = { ...n[idx], priority: v }; setActions(n); }}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                    <input
                      type="date"
                      className="h-7 px-2 text-xs border rounded-md"
                      value={action.dueDate}
                      onChange={(e) => { const n = [...actions]; n[idx] = { ...n[idx], dueDate: e.target.value }; setActions(n); }}
                    />
                  </div>
                </Card>
              ))}
              {actions.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No actions defined. Click "Add Action" to create one.</p>
              )}
            </>
          )}

          {currentStep === 5 && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Overall project status</label>
                <Select value={summary.overallStatus} onValueChange={(v) => setSummary({ ...summary, overallStatus: v })}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-overall-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="green">Green - On Track</SelectItem>
                    <SelectItem value="amber">Amber - At Risk</SelectItem>
                    <SelectItem value="red">Red - Off Track</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Key message for stakeholders</label>
                <Textarea
                  className="text-xs min-h-[80px]"
                  value={summary.keyMessage}
                  onChange={(e) => setSummary({ ...summary, keyMessage: e.target.value })}
                  placeholder="One-paragraph summary of this week's status..."
                  data-testid="textarea-key-message"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Escalations needed</label>
                <Textarea
                  className="text-xs min-h-[40px]"
                  value={summary.escalations}
                  onChange={(e) => setSummary({ ...summary, escalations: e.target.value })}
                  placeholder="Items that need management attention..."
                  data-testid="textarea-escalations"
                />
              </div>

              {snapshotMetrics && (
                <Card className="bg-muted/30 p-3">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Snapshot at time of review</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Phase</p>
                      <p className="font-medium">{snapshotMetrics.phase || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Completion</p>
                      <p className="font-medium">{snapshotMetrics.completion != null ? `${(snapshotMetrics.completion * 100).toFixed(0)}%` : "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Revenue</p>
                      <p className="font-medium">R{((snapshotMetrics.totalRevenue || 0) / 1e6).toFixed(1)}M</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Margin</p>
                      <p className="font-medium">{((snapshotMetrics.margin || 0) * 100).toFixed(1)}%</p>
                    </div>
                  </div>
                </Card>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setShowWizard(false); setReviewId(null); setCurrentStep(0); }}
          className="text-xs"
          data-testid="button-cancel-review"
        >
          Cancel
        </Button>
        <div className="flex items-center gap-2">
          {currentStep > 0 && (
            <Button variant="outline" size="sm" onClick={goPrev} className="gap-1 text-xs" data-testid="button-prev-step">
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </Button>
          )}
          {currentStep < STEPS.length - 1 ? (
            <Button size="sm" onClick={goNext} className="gap-1 text-xs" data-testid="button-next-step">
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
              className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-complete-review"
            >
              {completeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Complete Review
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
