import type React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, FileText, Landmark, ShieldCheck, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FinanceStrictRow, SourceAuthorityBadge, WorkflowException } from "@/lib/project-detail-command-centre";
import type { ProjectDetailDeptKey, ProjectDetailSubTabKey } from "@/lib/project-detail-navigation";

interface CommandMetric {
  label: string;
  value: string;
  detail: string;
  tone?: "success" | "warning" | "danger" | "neutral" | "restricted";
}

interface ProjectCommandCentreProps {
  lifecycleStage: string;
  lifecycleStatus: string;
  ragStatus: string;
  plan: CommandMetric;
  quality: CommandMetric;
  engineering: CommandMetric;
  sourceHealth: CommandMetric;
  financeRows: FinanceStrictRow[];
  sourceBadges: SourceAuthorityBadge[];
  exceptions: WorkflowException[];
  onNavigate: (dept: ProjectDetailDeptKey, sub?: ProjectDetailSubTabKey) => void;
}

const toneClass: Record<string, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-800",
  neutral: "border-border bg-card text-foreground",
  restricted: "border-slate-200 bg-slate-50 text-slate-600",
};

function ToneBadge({ tone, children }: { tone?: string; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${toneClass[tone || "neutral"] || toneClass.neutral}`}>
      {children}
    </Badge>
  );
}

function MetricPanel({ metric }: { metric: CommandMetric }) {
  return (
    <div className="rounded-md border bg-card p-3 min-h-[86px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{metric.label}</p>
        <ToneBadge tone={metric.tone}>{metric.tone || "live"}</ToneBadge>
      </div>
      <p className="mt-2 text-2xl font-semibold leading-none">{metric.value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{metric.detail}</p>
    </div>
  );
}

export function ProjectCommandCentre({
  lifecycleStage,
  lifecycleStatus,
  ragStatus,
  plan,
  quality,
  engineering,
  sourceHealth,
  financeRows,
  sourceBadges,
  exceptions,
  onNavigate,
}: ProjectCommandCentreProps) {
  return (
    <div className="space-y-3" data-testid="project-command-centre">
      <section className="rounded-lg border bg-card p-3 md:p-4" data-testid="command-centre-operating-state">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Operating state</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ToneBadge tone="neutral">Stage: {lifecycleStage}</ToneBadge>
              <ToneBadge tone={lifecycleStatus.toLowerCase().includes("blocked") || lifecycleStatus.toLowerCase().includes("hold") ? "warning" : "neutral"}>
                Status: {lifecycleStatus}
              </ToneBadge>
              <ToneBadge tone={ragStatus.toLowerCase().includes("red") ? "danger" : ragStatus.toLowerCase().includes("amber") ? "warning" : "success"}>
                RAG: {ragStatus}
              </ToneBadge>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onNavigate("pm", "plan")}>
              <Target className="h-3.5 w-3.5 mr-1" /> PM plan
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onNavigate("finance", "revenue")}>
              <Landmark className="h-3.5 w-3.5 mr-1" /> Finance
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onNavigate("documents", "controlled-docs")}>
              <FileText className="h-3.5 w-3.5 mr-1" /> Documents
            </Button>
          </div>
        </div>

        {exceptions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid="command-centre-exceptions">
            {exceptions.map((item) => (
              <Badge
                key={item.key}
                variant="outline"
                className={`gap-1 text-xs ${item.tone === "danger" ? toneClass.danger : toneClass.warning}`}
              >
                <AlertTriangle className="h-3 w-3" />
                {item.count} {item.label}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            No command-centre exceptions currently loaded
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="command-centre-metrics">
        <MetricPanel metric={plan} />
        <MetricPanel metric={quality} />
        <MetricPanel metric={engineering} />
        <MetricPanel metric={sourceHealth} />
      </section>

      <section className="rounded-lg border bg-card p-3 md:p-4" data-testid="command-centre-source-authority">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Source authority</p>
            <p className="text-xs text-muted-foreground">Every value should stay anchored to its master system.</p>
          </div>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onNavigate("excel", "drift")}>
            Reconciliation <ExternalLink className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          {sourceBadges.map((badge) => (
            <div key={badge.key} className={`rounded-md border p-2 ${toneClass[badge.tone]}`} data-testid={`source-authority-${badge.key}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{badge.label}</span>
                {badge.readOnly ? <Badge variant="outline" className="text-[9px] bg-white/60">Read-only</Badge> : null}
              </div>
              <p className="mt-1 text-[11px] opacity-85">{badge.sourceAuthority}</p>
              <p className="mt-1 text-[11px] font-medium">{badge.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-3 md:p-4" data-testid="command-centre-finance-strict">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Finance control states</p>
            <p className="text-xs text-muted-foreground">Planned, committed, invoiced, paid, realised, outstanding, and at-risk are shown as distinct states.</p>
          </div>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onNavigate("finance", "revenue")}>
            Open tracker <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">State</th>
                <th className="py-2 pr-3 font-semibold">Value</th>
                <th className="py-2 pr-3 font-semibold">Authority</th>
                <th className="py-2 pr-3 font-semibold">Editability</th>
                <th className="py-2 font-semibold">Formula/source note</th>
              </tr>
            </thead>
            <tbody>
              {financeRows.map((row) => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-semibold">{row.label}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${toneClass[row.tone]}`}>{row.value}</span>
                  </td>
                  <td className="py-2 pr-3">{row.sourceAuthority}</td>
                  <td className="py-2 pr-3">{row.editable ? "Editable" : "Read-only here"}</td>
                  <td className="py-2 text-muted-foreground">{row.formula}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-3 md:p-4" data-testid="command-centre-document-governance">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
          <div className="space-y-1">
            <p className="text-sm font-semibold">Document and lifecycle controls</p>
            <p className="text-xs text-muted-foreground">
              SharePoint remains the document source of truth. Stage movement should be treated as a gated workflow requiring accepted artefacts, while Hold/Blocked remains status rather than lifecycle stage.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
