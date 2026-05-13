/**
 * Smart Import — Bulk-flow conflict resolution dialog.
 *
 * When a per-file commit in the bulk panel returns
 * `v2_conflicts_detected` (3-way merge: both the app and the source
 * workbook changed the same cell, differently), this dialog lets the
 * operator resolve those conflicts for that one project — without
 * having to abandon the bulk run and open the project in the
 * single-file wizard.
 *
 * The dialog reuses the same UX language as the inline conflict drawer
 * in the single-file wizard (`smart-import.tsx:3184-3380`): three-up
 * Baseline / Your edit / Source workbook columns, per-row Keep my edit
 * / Accept source value buttons, and Apply-to-All shortcuts.
 *
 * On confirm, the parent re-submits the failed run via
 * `POST /api/smart-import/:runId/commit` with the same
 * `v2ConflictResolutions` envelope the single-file flow uses.
 */

import { useMemo, useState, useEffect } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface V2ConflictField {
  fieldName: string;
  baselineValue: string | null;
  currentAppValue: string | null;
  uploadedValue: string | null;
  mergeCase: string;
}

export interface V2ConflictRow {
  rowKey: string;
  displayLabel: string;
  section: "PLAN" | "REVENUE" | "EXPENDITURE" | string;
  canonicalSource?: string;
  fields: V2ConflictField[];
}

interface BulkConflictDialogProps {
  open: boolean;
  projectName: string;
  runId: number;
  conflicts: V2ConflictRow[];
  busy: boolean;
  onClose: () => void;
  /**
   * Called when the operator clicks "Resolve & Commit". Receives the
   * { rowKey::fieldName -> "keep_app" | "accept_file" } map. The parent
   * is responsible for re-submitting the run and showing toasts.
   */
  onResolve: (decisions: Record<string, "keep_app" | "accept_file">) => void;
}

function sectionBadgeColor(section: string): string {
  if (section === "PLAN") return "bg-blue-50 text-blue-700 border-blue-200";
  if (section === "REVENUE") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-purple-50 text-purple-700 border-purple-200";
}

export function BulkConflictDialog({
  open,
  projectName,
  runId,
  conflicts,
  busy,
  onClose,
  onResolve,
}: BulkConflictDialogProps) {
  const flatConflicts = useMemo(
    () =>
      conflicts.flatMap((row) =>
        row.fields.map((field) => ({
          rowKey: row.rowKey,
          displayLabel: row.displayLabel,
          section: row.section,
          field,
          key: `${row.rowKey}::${field.fieldName}`,
        })),
      ),
    [conflicts],
  );

  // Default every conflict to "keep_app" — the safest default, matching
  // the single-file wizard. Operator can change per-row or apply-to-all.
  const [decisions, setDecisions] = useState<Record<string, "keep_app" | "accept_file">>({});
  useEffect(() => {
    if (!open) return;
    const defaults: Record<string, "keep_app" | "accept_file"> = {};
    for (const c of flatConflicts) defaults[c.key] = "keep_app";
    setDecisions(defaults);
  }, [open, flatConflicts]);

  const totalCount = flatConflicts.length;
  const keepCount = flatConflicts.filter((c) => decisions[c.key] === "keep_app").length;
  const acceptCount = flatConflicts.filter((c) => decisions[c.key] === "accept_file").length;
  const unresolvedCount = totalCount - keepCount - acceptCount;
  const allResolved = unresolvedCount === 0 && totalCount > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        // Force centered-modal positioning at ALL breakpoints. The shared
        // shadcn DialogContent base is mobile-first (full-width bottom
        // sheet under sm:, centered modal at sm+). For this dense 3-column
        // conflict-resolution UI a bottom sheet is wrong on every screen
        // size, and the base `inset-x-0` + sm: `translate-x-[-50%]` were
        // interacting badly inside the Replit Canvas iframe and shifting
        // the whole dialog off the left edge of the viewport.
        className="left-[50%] top-[50%] inset-x-auto bottom-auto translate-x-[-50%] translate-y-[-50%] w-[calc(100%-2rem)] max-w-3xl max-h-[90vh] rounded-lg overflow-hidden flex flex-col"
        data-testid={`bulk-conflict-dialog-${runId}`}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            Resolve conflicts — {projectName}
          </DialogTitle>
          <DialogDescription>
            Both your in-app edits and the source workbook changed since the last import.
            Choose which value to keep for each field.
          </DialogDescription>
        </DialogHeader>

        <div className="border border-amber-200 rounded-lg overflow-hidden bg-white flex-1 min-h-0 flex flex-col">
          <div className="px-3 py-2 bg-amber-100/50 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
            <p className="text-xs font-semibold text-amber-800">
              {totalCount} conflict{totalCount !== 1 ? "s" : ""} detected — choose how to resolve each
            </p>
            <div className="flex gap-2 text-[10px]">
              <span className="text-emerald-700 font-medium" data-testid="bulk-v2-counter-keep">
                {keepCount} keeping edits
              </span>
              <span className="text-slate-400">|</span>
              <span className="text-red-600 font-medium" data-testid="bulk-v2-counter-accept">
                {acceptCount} accepting source
              </span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-500 font-medium" data-testid="bulk-v2-counter-unresolved">
                {unresolvedCount} unresolved
              </span>
            </div>
          </div>

          <div className="overflow-y-auto divide-y divide-slate-100 flex-1 min-h-0">
            {flatConflicts.map((c) => {
              const resolution = decisions[c.key];
              const isKeep = resolution === "keep_app";
              const isAccept = resolution === "accept_file";
              return (
                <div
                  key={c.key}
                  className={`p-3 ${isKeep ? "bg-emerald-50/30" : isAccept ? "bg-red-50/20" : "bg-white"}`}
                  data-testid={`bulk-v2-conflict-row-${c.key}`}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <Badge variant="outline" className={`text-[10px] ${sectionBadgeColor(c.section)}`}>
                      {c.section}
                    </Badge>
                    <span className="text-xs font-medium text-slate-700 truncate" title={c.displayLabel}>
                      {c.displayLabel}
                    </span>
                    <span className="font-mono font-bold text-xs text-slate-800">{c.field.fieldName}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs mb-2">
                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Baseline</div>
                      <div className="font-mono text-slate-600 break-words">
                        {c.field.baselineValue ?? <span className="text-slate-300 italic">empty</span>}
                      </div>
                    </div>
                    <div className={`rounded border px-2 py-1.5 ${isKeep ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                      <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold mb-0.5">
                        Your edit
                      </div>
                      <div className="font-mono text-slate-800 break-words">
                        {c.field.currentAppValue ?? <span className="text-slate-300 italic">empty</span>}
                      </div>
                    </div>
                    <div className={`rounded border px-2 py-1.5 ${isAccept ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
                      <div className="text-[10px] uppercase tracking-wide text-red-600 font-semibold mb-0.5">
                        Source workbook
                      </div>
                      <div className="font-mono text-slate-800 break-words">
                        {c.field.uploadedValue ?? <span className="text-slate-300 italic">empty</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors border ${
                        isKeep
                          ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
                          : "bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                      }`}
                      onClick={() => setDecisions((prev) => ({ ...prev, [c.key]: "keep_app" }))}
                      data-testid={`btn-bulk-v2-keep-${c.key}`}
                    >
                      Keep my edit
                    </button>
                    <button
                      type="button"
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors border ${
                        isAccept
                          ? "bg-red-600 text-white border-red-600 hover:bg-red-700"
                          : "bg-white text-red-700 border-red-300 hover:bg-red-50"
                      }`}
                      onClick={() => setDecisions((prev) => ({ ...prev, [c.key]: "accept_file" }))}
                      data-testid={`btn-bulk-v2-accept-${c.key}`}
                    >
                      Accept source value
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center gap-3 flex-shrink-0">
            <span className="text-[10px] text-slate-500 font-medium">Apply to All:</span>
            <button
              type="button"
              className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded transition-colors"
              onClick={() => {
                const all: Record<string, "keep_app" | "accept_file"> = {};
                for (const c of flatConflicts) all[c.key] = "keep_app";
                setDecisions(all);
              }}
              data-testid="btn-bulk-v2-keep-all"
            >
              Keep all my edits
            </button>
            <button
              type="button"
              className="text-[10px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded transition-colors"
              onClick={() => {
                const all: Record<string, "keep_app" | "accept_file"> = {};
                for (const c of flatConflicts) all[c.key] = "accept_file";
                setDecisions(all);
              }}
              data-testid="btn-bulk-v2-accept-all"
            >
              Accept all source values
            </button>
            <span className="text-[10px] text-slate-400 ml-auto">
              Recommended: Keep your edits unless the source workbook has the corrected values.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy} data-testid="btn-bulk-v2-cancel">
            Cancel
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => {
              if (!allResolved) return;
              onResolve(decisions);
            }}
            disabled={busy || !allResolved}
            data-testid="btn-bulk-v2-resolve-commit"
          >
            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
            Resolve & Commit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
