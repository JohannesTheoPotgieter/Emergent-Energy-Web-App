/**
 * Smart Import bulk-flow intro + result cards (UX-5).
 *
 * Two small self-contained components the folder/bulk commit panel
 * mounts around the existing pending-runs list:
 *
 *  - SmartImportBulkIntro: plain-English narrative summary at the top
 *    of the panel, answering "how many files are ready, how many need
 *    me, and how do I act on them?".
 *
 *  - SmartImportBulkResultNext: the "what happens next" block on the
 *    post-commit result screen, including per-project "View project"
 *    links that go to /projects/<urlencoded name>.
 *
 * Copy comes from BULK_LABELS so a non-engineer can tune the language
 * in labels.ts without touching JSX.
 */

import { Files, CheckCircle2, AlertTriangle, AlertCircle, Bell, ExternalLink, ShieldCheck } from "lucide-react";
import { BULK_LABELS } from "./labels";

interface SmartImportBulkIntroProps {
  totalCount: number;
  readyCount: number;
  needsAttentionCount: number;
  blockedCount: number;
}

function interpolate(template: string, value: number): string {
  return template.replace("%n", String(value));
}

export function SmartImportBulkIntro({
  totalCount,
  readyCount,
  needsAttentionCount,
  blockedCount,
}: SmartImportBulkIntroProps) {
  if (totalCount <= 0) return null;
  const title =
    totalCount === 1
      ? BULK_LABELS.intro.titleSingular
      : interpolate(BULK_LABELS.intro.titlePlural, totalCount);

  return (
    <div
      className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 space-y-2"
      data-testid="bulk-intro"
    >
      <div className="flex items-center gap-2">
        <Files className="w-5 h-5 text-emerald-700 flex-shrink-0" />
        <h3 className="text-base font-semibold text-emerald-900">{title}</h3>
      </div>
      <ul className="space-y-1 text-sm text-foreground/80 pl-7">
        <li className="flex items-center gap-2" data-testid="bulk-intro-ready">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{interpolate(BULK_LABELS.intro.readyPrefix, readyCount)}</span>
        </li>
        {needsAttentionCount > 0 && (
          <li className="flex items-center gap-2" data-testid="bulk-intro-attention">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>{interpolate(BULK_LABELS.intro.blockedPrefix, needsAttentionCount)}</span>
          </li>
        )}
        {blockedCount > 0 && (
          <li className="flex items-center gap-2" data-testid="bulk-intro-blocked">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
            <span>{interpolate(BULK_LABELS.intro.stuckPrefix, blockedCount)}</span>
          </li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground pl-7" data-testid="bulk-intro-grouping">
        {BULK_LABELS.intro.grouping}
      </p>
    </div>
  );
}

export interface BulkResultProject {
  projectName: string;
  status: "committed" | "skipped" | "failed";
  error?: string;
}

interface SmartImportBulkResultNextProps {
  projects: BulkResultProject[];
  onViewProject?: (projectName: string) => void;
  onRetry?: (projectName: string) => void;
}

export function SmartImportBulkResultNext({
  projects,
  onViewProject,
  onRetry,
}: SmartImportBulkResultNextProps) {
  const committed = projects.filter((p) => p.status === "committed");

  return (
    <div className="space-y-4" data-testid="bulk-result-next">
      {committed.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-emerald-700" />
            <h4 className="text-sm font-semibold">{BULK_LABELS.result.whatNextHeading}</h4>
          </div>
          <ul className="space-y-1 text-sm text-foreground/80 pl-6" data-testid="bulk-whats-next">
            {BULK_LABELS.result.whatNextItems.map((line, idx) => (
              <li key={idx} className="list-disc">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-border">
        <div className="px-4 py-2 border-b bg-muted/40 text-sm font-semibold" data-testid="bulk-per-file-heading">
          {BULK_LABELS.result.perFileHeading}
        </div>
        <ul className="divide-y" data-testid="bulk-per-project-list">
          {projects.map((p, idx) => (
            <li key={`${p.projectName}-${idx}`} className="flex items-center gap-3 px-4 py-2.5" data-testid={`bulk-per-project-${idx}`}>
              {p.status === "committed" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              ) : p.status === "skipped" ? (
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              )}
              <span className="flex-1 min-w-0 truncate text-sm font-medium">{p.projectName}</span>
              {p.error && (
                <span className="text-xs text-red-600 max-w-[240px] truncate" title={p.error}>
                  {p.error}
                </span>
              )}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {p.status === "committed" && onViewProject && (
                  <button
                    type="button"
                    onClick={() => onViewProject(p.projectName)}
                    data-testid={`btn-view-project-${idx}`}
                    className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-800 hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {BULK_LABELS.result.viewProjectAction}
                  </button>
                )}
                {p.status === "failed" && onRetry && (
                  <button
                    type="button"
                    onClick={() => onRetry(p.projectName)}
                    data-testid={`btn-retry-project-${idx}`}
                    className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-800 hover:underline"
                  >
                    {BULK_LABELS.result.retryAction}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800"
        data-testid="bulk-undo-hint"
      >
        <ShieldCheck className="w-4 h-4 flex-shrink-0" />
        <span>{BULK_LABELS.result.undoHint}</span>
      </div>
    </div>
  );
}
