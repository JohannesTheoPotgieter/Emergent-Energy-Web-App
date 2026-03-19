import { useState } from "react";
import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface MetricMethodology {
  label: string;
  formula?: string;
  sources: string[];
  timeRange?: string;
  notes?: string;
}

interface MetricTooltipProps {
  methodology: MetricMethodology;
  className?: string;
}

export function MetricTooltip({ methodology, className }: MetricTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60 transition-colors ${className || ""}`}
          data-testid={`metric-info-${methodology.label.toLowerCase().replace(/\s+/g, "-")}`}
          aria-label={`How ${methodology.label} is calculated`}
        >
          <Info className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 text-xs"
        side="bottom"
        align="start"
      >
        <div className="px-3 py-2 border-b bg-muted/30">
          <p className="font-semibold text-foreground text-xs">
            {methodology.label}
          </p>
        </div>
        <div className="px-3 py-2 space-y-2">
          {methodology.formula && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                Formula
              </p>
              <code className="text-[11px] bg-muted/50 px-1.5 py-0.5 rounded block font-mono">
                {methodology.formula}
              </code>
            </div>
          )}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
              Data Sources
            </p>
            <ul className="space-y-0.5">
              {methodology.sources.map((source) => (
                <li
                  key={source}
                  className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                >
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
                  {source}
                </li>
              ))}
            </ul>
          </div>
          {methodology.timeRange && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                Time Range
              </p>
              <p className="text-[11px] text-muted-foreground">
                {methodology.timeRange}
              </p>
            </div>
          )}
          {methodology.notes && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                Notes
              </p>
              <p className="text-[11px] text-muted-foreground">
                {methodology.notes}
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const EXECUTION_METHODOLOGIES = {
  portfolio: {
    label: "Portfolio Metrics",
    formula:
      "Active Projects = ACTIVE projects with FY plan or financial data",
    sources: [
      "project_info (archived_status = ACTIVE)",
      "normalized_plan_tasks (FY date membership)",
      "normalized_revenue_lines + normalized_cost_lines (FY date membership)",
    ],
    timeRange: "Current financial year (Mar-Feb)",
    notes:
      'Behind Plan = actual % complete < expected % complete - 5%. Progress is duration-weighted across plan tasks.',
  } as MetricMethodology,

  revenue: {
    label: "Revenue & Inflow",
    formula:
      "Planned Revenue = SUM(amount_ex_vat) for revenue lines in FY. Received = lines with invoice number AND (paid_date_confirmed OR in_bank_date).",
    sources: [
      "normalized_revenue_lines.amount_ex_vat",
      "Matched by invoice_date, expected_payment_date, paid_date, or in_bank_date falling within FY",
    ],
    timeRange: "Current financial year (Mar-Feb)",
    notes:
      "Open Inflow = Planned Revenue - Received Inflow. Inflow at Risk triggers when open > 35% of planned.",
  } as MetricMethodology,

  expenditure: {
    label: "Expenditure & GP",
    formula:
      "Planned = SUM(cost lines in FY). Paid = lines with invoice number AND paid_date_confirmed. GP Margin = (Revenue - Expenditure) / Revenue × 100.",
    sources: [
      "normalized_cost_lines.amount_ex_vat",
      "Matched by invoice_date, approved_date, or paid_date falling within FY",
    ],
    timeRange: "Current financial year (Mar-Feb)",
    notes:
      "GP uses planned revenue vs planned expenditure (not actuals). Expenditure at Risk triggers when open > 35% of planned.",
  } as MetricMethodology,

  risks: {
    label: "Risks & Actions",
    formula:
      "Eng. Blockers = tasks with blocker_reason OR priority in [high, urgent, critical] OR status contains 'block'. Quality = open qc_warnings (status ≠ closed). Approvals = approvals with status = pending.",
    sources: [
      "operational_tasks (engineering blockers)",
      "qc_warning (quality issues)",
      "approvals (pending approvals)",
      "smart_import_runs (import freshness)",
    ],
    timeRange: "Current snapshot (not FY-scoped)",
    notes:
      "Stale Imports = projects where last import > 7 days (Warning) or > 14 days (Critical).",
  } as MetricMethodology,

  behindPlan: {
    label: "Projects Behind Plan",
    formula: "actual_pct_complete < expected_pct_complete - 5%",
    sources: [
      "normalized_plan_tasks (duration-weighted % complete)",
      "Severity: Critical if gap > 15%, else High",
    ],
    notes:
      "Progress is calculated as a duration-weighted average across all plan tasks for the project.",
  } as MetricMethodology,

  inflowRisk: {
    label: "Inflow at Risk",
    formula: "open_inflow / planned_revenue > 35%",
    sources: [
      "normalized_revenue_lines (planned vs received)",
      "Severity: Critical if outstanding > 60%, else High",
    ],
  } as MetricMethodology,

  expenditureRisk: {
    label: "Expenditure / COS at Risk",
    formula: "open_expenditure / planned_expenditure > 35%",
    sources: [
      "normalized_cost_lines (planned vs paid)",
      "Severity: Critical if outstanding > 60%, else High",
    ],
  } as MetricMethodology,

  engineeringBottlenecks: {
    label: "Engineering Bottlenecks",
    formula:
      'Tasks with blocker_reason set, OR priority in [high, urgent, critical], OR status contains "block"',
    sources: [
      "operational_tasks (non-deleted, non-complete)",
      "Up to 5 items shown per project",
    ],
  } as MetricMethodology,

  qualityIssues: {
    label: "Quality Issues",
    formula: "QC warnings with status ≠ closed",
    sources: [
      "qc_warning table",
      "Matched to projects by normalized project name",
    ],
  } as MetricMethodology,

  pendingApprovals: {
    label: "Pending Approvals / Decisions",
    formula: "Approvals with status = pending",
    sources: [
      "approvals table (matched by project_id)",
      "Up to 5 items shown per project",
    ],
  } as MetricMethodology,
} as const;

export const QUEUE_METHODOLOGY: Record<string, MetricMethodology> = {
  "Projects Behind Plan": EXECUTION_METHODOLOGIES.behindPlan,
  "Inflow at Risk": EXECUTION_METHODOLOGIES.inflowRisk,
  "Expenditure / COS at Risk": EXECUTION_METHODOLOGIES.expenditureRisk,
  "Engineering Bottlenecks": EXECUTION_METHODOLOGIES.engineeringBottlenecks,
  "Quality Issues": EXECUTION_METHODOLOGIES.qualityIssues,
  "Pending Approvals / Decisions": EXECUTION_METHODOLOGIES.pendingApprovals,
};
