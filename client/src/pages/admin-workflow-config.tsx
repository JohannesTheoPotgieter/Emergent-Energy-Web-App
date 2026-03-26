/**
 * Admin Workflow Configuration — view and understand task workflow state machines.
 * Shows allowed transitions for each task type (engineering, quality, PM, approval, deliverable).
 */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { Workflow, ArrowRight, ChevronRight } from "lucide-react";
import { TASK_WORKFLOW_CONFIG, type TaskWorkflowConfig } from "@shared/task-workflow-config";
import { useState } from "react";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    "TO DO": "bg-slate-100 text-slate-700",
    "IN PROGRESS": "bg-blue-100 text-blue-700",
    "HOLD": "bg-amber-100 text-amber-700",
    "PROJECTS ASSISTANCE": "bg-purple-100 text-purple-700",
    "NEEDS APPROVAL": "bg-orange-100 text-orange-700",
    "PROVIDE FEEDBACK": "bg-red-100 text-red-700",
    "QC APPROVED": "bg-green-100 text-green-700",
    "OPERATIONAL APPROVAL": "bg-teal-100 text-teal-700",
    "COMPLETE": "bg-emerald-100 text-emerald-700",
  };
  return <Badge className={`text-[10px] ${colors[status] || "bg-muted text-muted-foreground"}`}>{status}</Badge>;
}

function WorkflowCard({ config }: { config: TaskWorkflowConfig }) {
  const [expanded, setExpanded] = useState(false);
  const transitions = config.allowedTransitions;
  const statuses = Object.keys(transitions);

  return (
    <Card>
      <CardContent className="p-4">
        <button
          className="w-full flex items-center justify-between text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-semibold">{config.label}</Badge>
            <span className="text-xs text-muted-foreground">
              {statuses.length} states, {Object.values(transitions).flat().length} transitions
            </span>
          </div>
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>

        {expanded && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Default status:</span>
              <StatusBadge status={config.defaultStatus} />
              <span className="mx-2">|</span>
              <span>Bucket:</span>
              <Badge variant="secondary" className="text-[10px]">{config.reportingBucket}</Badge>
            </div>

            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2">Transition Map</div>
            <div className="space-y-2">
              {statuses.map(from => {
                const targets = (transitions as Record<string, readonly string[]>)[from] || [];
                return (
                  <div key={from} className="flex items-start gap-2">
                    <StatusBadge status={from} />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex flex-wrap gap-1">
                      {targets.map(to => (
                        <StatusBadge key={to} status={to} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {config.requiredFields.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-semibold text-muted-foreground">Required fields:</div>
                <div className="flex gap-1 mt-1">
                  {config.requiredFields.map(f => (
                    <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminWorkflowConfigPage() {
  const workflows = Object.values(TASK_WORKFLOW_CONFIG);

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-admin-workflow-config">
      <SectionHeader
        icon={<Workflow className="h-5 w-5" />}
        eyebrow="Admin"
        title="Workflow Configuration"
        description="View task workflow state machines and allowed transitions for each task type"
      />

      <div className="space-y-3">
        {workflows.map(wf => (
          <WorkflowCard key={wf.key} config={wf} />
        ))}
      </div>

      <Card className="border-dashed">
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          Workflow transitions are currently defined in code (<code className="text-xs bg-muted px-1 rounded">shared/task-workflow-config.ts</code>).
          UI-based editing will be available in a future release.
        </CardContent>
      </Card>
    </PageShell>
  );
}
