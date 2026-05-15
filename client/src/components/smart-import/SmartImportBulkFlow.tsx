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
  /** Smart-import run id — uniquely identifies the row even when two
   *  imports share the same project name. Required for per-row actions
   *  like "Create new" so the correct run is re-committed. */
  runId: number;
  projectName: string;
  status: "committed" | "skipped" | "failed" | "conflicts_pending";
  error?: string;
  /** Number of unresolved 3-way conflicts (only set when status === "conflicts_pending"). */
  conflictCount?: number;
}

interface SmartImportBulkResultNextProps {
  projects: BulkResultProject[];
  onViewProject?: (projectName: string) => void;
  onRetry?: (projectName: string) => void;
  /**
   * Called when the operator clicks "Resolve conflicts (N)" on a row that
   * came back with `status === "conflicts_pending"`. The parent opens a
   * dialog with the per-field decision UI and re-commits the run.
   */
  onResolveConflicts?: (projectName: string) => void;
  /**
   * Called when the operator clicks "Create New" on a failed row whose
   * error is `duplicate_project_candidate`. The parent re-commits the run
   * with `confirmNewProject: true`, bypassing the duplicate guard.
   * Keyed by `runId` (not name) so duplicate project names across rows
   * still resolve to the correct run.
   */
  onCreateNewProject?: (runId: number, projectName: string) => void;
  /**
   * Called when the operator clicks the top-level "Create New for all
   * duplicates" button. The parent re-commits every row whose error is
   * `duplicate_project_candidate` with `confirmNewProject: true`.
   */
  onCreateNewProjectAll?: () => void;
  /** True while a create-new request is in flight. */
  busyCreatingNew?: boolean;
}

export function SmartImportBulkResultNext({
  projects,
  onViewProject,
  onRetry,
  onResolveConflicts,
  onCreateNewProject,
  onCreateNewProjectAll,
  busyCreatingNew,
}: SmartImportBulkResultNextProps) {
  const committed = projects.filter((p) => p.status === "committed");
  const duplicateFailures = projects.filter(
    (p) => p.status === "failed" && p.error === "duplicate_project_candidate"
  );

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

      {duplicateFailures.length > 0 && onCreateNewProjectAll && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
          data-testid="bulk-duplicate-banner"
        >
          <div className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900 min-w-0">
              <div className="font-semibold">
                {duplicateFailures.length} file{duplicateFailures.length === 1 ? "" : "s"} look like duplicate projects
              </div>
              <div className="text-xs text-amber-800/90">
                If you're sure these are new projects, create them all in one click.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCreateNewProjectAll}
            disabled={busyCreatingNew}
            data-testid="btn-create-new-all-duplicates"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1.5 rounded flex-shrink-0"
          >
            {busyCreatingNew ? "Creating…" : `Create new for all (${duplicateFailures.length})`}
          </button>
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
              ) : p.status === "conflicts_pending" ? (
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              )}
              <span className="flex-1 min-w-0 truncate text-sm font-medium">{p.projectName}</span>
              {p.status === "conflicts_pending" && (
                <span className="text-xs text-amber-700 max-w-[260px] truncate" title="App and source workbook both changed the same fields">
                  {p.conflictCount
                    ? `${p.conflictCount} conflict${p.conflictCount === 1 ? "" : "s"} need a decision`
                    : "Conflicts need a decision"}
                </span>
              )}
              {p.status !== "conflicts_pending" && p.error && (
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
                {p.status === "conflicts_pending" && onResolveConflicts && (
                  <button
                    type="button"
                    onClick={() => onResolveConflicts(p.projectName)}
                    data-testid={`btn-resolve-conflicts-${idx}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded border border-amber-200"
                  >
                    Resolve conflicts{p.conflictCount ? ` (${p.conflictCount})` : ""}
                  </button>
                )}
                {p.status === "failed" && p.error === "duplicate_project_candidate" && onCreateNewProject && (
                  <button
                    type="button"
                    onClick={() => onCreateNewProject(p.runId, p.projectName)}
                    disabled={busyCreatingNew}
                    data-testid={`btn-create-new-project-${idx}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 disabled:opacity-60 disabled:cursor-not-allowed px-2 py-1 rounded border border-amber-300"
                  >
                    Create new
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
