/**
 * Smart Import folder inventory (UX-4)
 *
 * Renders the file-level inventory a user sees after picking a folder.
 * For each file it shows:
 *   - Filename + row count (if known)
 *   - Detected section (Plan / Revenue / Costs / unknown)
 *   - Auto-matched project name, or a "no match — pick or create" prompt
 *   - A ticked/unticked checkbox for inclusion in the bulk commit
 *
 * Blocker reasons (parse failure, permission denied, closed stage,
 * duplicate filename) are surfaced as inline errors so the user can
 * skip or adjust without leaving the screen. The four blocker codes
 * are defined here so server payloads can reference a stable enum.
 */

import { FileSpreadsheet, CheckCircle2, AlertTriangle, ShieldOff, XOctagon } from "lucide-react";
import { SECTION_LABELS } from "./labels";

export type FolderFileBlocker =
  | "PARSE_FAILED"
  | "PERMISSION_DENIED"
  | "STAGE_CLOSED"
  | "DUPLICATE_FILENAME";

export interface FolderFileEntry {
  id: string;
  fileName: string;
  rowCount?: number | null;
  detectedSection?: "PLAN" | "REVENUE" | "EXPENDITURE" | null;
  /** Project match. null + autoMatchConfidence = 0 means the user must pick or create. */
  matchedProjectName?: string | null;
  matchedProjectId?: number | null;
  autoMatchConfidence?: "high" | "medium" | "low" | null;
  /** When populated, the file is blocked and cannot be committed. */
  blocker?: { code: FolderFileBlocker; detail?: string } | null;
  /** Controlled tick state. */
  selected: boolean;
}

interface SmartImportFolderInventoryProps {
  files: FolderFileEntry[];
  onToggleFile: (id: string, selected: boolean) => void;
  onPickProject?: (id: string) => void;
  onCreateProject?: (id: string) => void;
  onSkipFile?: (id: string) => void;
}

const BLOCKER_COPY: Record<FolderFileBlocker, { title: string; advice: string }> = {
  PARSE_FAILED: {
    title: "We couldn't read this file",
    advice: "It doesn't look like a recognised Excel workbook. Check the file and try again, or skip it.",
  },
  PERMISSION_DENIED: {
    title: "You don't have access to this project",
    advice: "Ask the project lead to grant edit permission, then rerun. We'll skip it for now.",
  },
  STAGE_CLOSED: {
    title: "This project's stage is closed",
    advice: "Closed stages are locked. Ask a COO to reopen if this file should still go in.",
  },
  DUPLICATE_FILENAME: {
    title: "Duplicate filename in this folder",
    advice: "Two files in the folder share this name. Rename one and re-pick the folder, or skip this one.",
  },
};

export function SmartImportFolderInventory({
  files,
  onToggleFile,
  onPickProject,
  onCreateProject,
  onSkipFile,
}: SmartImportFolderInventoryProps) {
  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No files to show yet — pick a folder to begin.
      </div>
    );
  }

  const selectedCount = files.filter((f) => f.selected && !f.blocker).length;
  const blockedCount = files.filter((f) => !!f.blocker).length;

  return (
    <div className="space-y-3" data-testid="folder-inventory">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">
            We read {files.length} file{files.length === 1 ? "" : "s"} from your folder
          </h3>
          <p className="text-xs text-muted-foreground">
            {selectedCount} ready to import
            {blockedCount > 0 && ` · ${blockedCount} blocked (see reasons below)`}
          </p>
        </div>
      </div>

      <div className="divide-y rounded-lg border border-border">
        {files.map((f) => {
          const hasMatch = !!f.matchedProjectId && !!f.matchedProjectName;
          const blocker = f.blocker ? BLOCKER_COPY[f.blocker.code] : null;
          const sectionLabel = f.detectedSection ? SECTION_LABELS[f.detectedSection] : null;

          return (
            <div
              key={f.id}
              data-testid={`folder-inventory-row-${f.id}`}
              className={`p-3 ${blocker ? "bg-red-50/40" : ""}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={f.selected && !blocker}
                  disabled={!!blocker}
                  onChange={(e) => onToggleFile(f.id, e.target.checked)}
                  data-testid={`folder-inventory-check-${f.id}`}
                  aria-label={`Include ${f.fileName} in this import`}
                />
                <FileSpreadsheet className="w-4 h-4 mt-1 text-slate-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">
                      {f.fileName}
                    </span>
                    {f.rowCount != null && (
                      <span className="text-xs text-muted-foreground">
                        {f.rowCount} row{f.rowCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {sectionLabel && (
                      <span className="text-xs bg-slate-100 text-slate-700 border border-slate-200 rounded px-1.5 py-0.5">
                        {sectionLabel}
                      </span>
                    )}
                  </div>

                  {!blocker && hasMatch && (
                    <div
                      className="mt-1 text-xs flex items-center gap-1.5"
                      data-testid={`folder-inventory-match-${f.id}`}
                    >
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>
                        Matched to <strong className="text-foreground">{f.matchedProjectName}</strong>
                        {f.autoMatchConfidence && (
                          <span className="text-muted-foreground"> · {f.autoMatchConfidence} confidence</span>
                        )}
                      </span>
                    </div>
                  )}

                  {!blocker && !hasMatch && (
                    <div
                      className="mt-1 text-xs flex items-center gap-2 flex-wrap"
                      data-testid={`folder-inventory-nomatch-${f.id}`}
                    >
                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                      <span className="text-amber-800">
                        No match — pick or create a project.
                      </span>
                      {onPickProject && (
                        <button
                          type="button"
                          onClick={() => onPickProject(f.id)}
                          className="text-xs underline text-blue-700 hover:text-blue-800"
                          data-testid={`folder-inventory-pick-${f.id}`}
                        >
                          Pick project
                        </button>
                      )}
                      {onCreateProject && (
                        <button
                          type="button"
                          onClick={() => onCreateProject(f.id)}
                          className="text-xs underline text-emerald-700 hover:text-emerald-800"
                          data-testid={`folder-inventory-create-${f.id}`}
                        >
                          Create new project
                        </button>
                      )}
                    </div>
                  )}

                  {blocker && (
                    <div
                      className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
                      data-testid={`folder-inventory-blocker-${f.id}`}
                    >
                      <div className="flex items-center gap-1.5 font-medium">
                        {f.blocker!.code === "PERMISSION_DENIED" ? (
                          <ShieldOff className="w-3 h-3 flex-shrink-0" />
                        ) : (
                          <XOctagon className="w-3 h-3 flex-shrink-0" />
                        )}
                        {blocker.title}
                      </div>
                      <div className="mt-0.5">{blocker.advice}</div>
                      {f.blocker!.detail && (
                        <div className="mt-1 font-mono text-[10px] text-red-800/80">
                          {f.blocker!.detail}
                        </div>
                      )}
                      {onSkipFile && (
                        <button
                          type="button"
                          onClick={() => onSkipFile(f.id)}
                          className="mt-1.5 text-[11px] underline text-red-800 hover:text-red-900"
                          data-testid={`folder-inventory-skip-${f.id}`}
                        >
                          Skip this file
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
