// Shared lifecycle-phase filter for the Execution surfaces (Board, Milestone
// Tracker, …). Single source of truth so every surface offers the same phase
// list, default scope and matching behaviour.

import { useState } from "react";
import { PHASE_LABELS, PHASES } from "@shared/phases";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, ListFilter } from "lucide-react";

// All canonical lifecycle phases (for inline phase EDITORS — any phase settable).
export const LIFECYCLE_PHASES: string[] = [...PHASE_LABELS];

// Full phase range the board can show / filter to — Financial Close
// (displayNumber 3) through Compliance Handover, plus terminal Hold/Done. MUST
// mirror isBoardUniversePhase in server/services/execution-board-service.ts.
export const BOARD_FILTER_PHASES: string[] = PHASES
  .filter((p) => (p.displayNumber != null && p.displayNumber >= 3) || p.isTerminal)
  .map((p) => p.label);

// Default scope when NO phase is explicitly selected — Financial Close (3) →
// Client Handover (8). Later phases / terminals are hidden until filtered to.
export const DEFAULT_BOARD_PHASES: string[] = PHASES
  .filter((p) => p.displayNumber != null && p.displayNumber >= 3 && p.displayNumber <= 8)
  .map((p) => p.label);

/** Map a stored phase (possibly legacy-cased, e.g. "PLANNING") to its canonical label. */
export function canonicalPhaseLabel(phase: string | null): string {
  if (!phase) return "";
  const lc = phase.trim().toLowerCase();
  return LIFECYCLE_PHASES.find((p) => p.toLowerCase() === lc) ?? phase;
}

/** Filter-dropdown options: the full board range plus any non-canonical phase
 *  actually present on a row, so nothing is unfilterable. */
export function buildPhaseOptions(rowPhases: Array<string | null>): string[] {
  const extras = rowPhases
    .map((p) => canonicalPhaseLabel(p))
    .filter((p) => p && !BOARD_FILTER_PHASES.includes(p));
  return [...BOARD_FILTER_PHASES, ...new Set(extras)];
}

/** The phases actually in view: the explicit selection, or the default scope
 *  (Financial Close → Client Handover) when nothing is selected. */
export function effectivePhases(selected: string[]): string[] {
  return selected.length > 0 ? selected : DEFAULT_BOARD_PHASES;
}

/** True if a row's (raw) phase is within the given selection (empty = default scope). */
export function phaseInScope(rowPhase: string | null, selected: string[]): boolean {
  return effectivePhases(selected).includes(canonicalPhaseLabel(rowPhase) || "—");
}

/** Multi-select phase filter — checkbox popover with search. Empty = the board's
 *  default scope (Financial Close → Client Handover); select phases to override. */
export function PhaseMultiSelect({ options, selected, onChange }: {
  options: string[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const matches = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const toggle = (p: string) => onChange(selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p]);
  const label = selected.length === 0 ? "Default phases" : selected.length === 1 ? selected[0] : `${selected.length} phases`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-44 h-9 justify-between font-normal" data-testid="execution-phase-filter">
          <span className="inline-flex items-center gap-1.5 truncate">
            <ListFilter className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="truncate">{label}</span>
          </span>
          <span className="inline-flex items-center gap-1 shrink-0">
            {selected.length > 0 && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{selected.length}</Badge>}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <div className="p-2 border-b">
          <Input className="h-8 text-xs" placeholder="Search phases…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="execution-phase-search" />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/60 text-muted-foreground"
            onClick={() => onChange([])}
            data-testid="execution-phase-all"
          >
            <span className={`flex items-center justify-center w-4 h-4 rounded border ${selected.length === 0 ? "bg-emerald-600 border-emerald-600 text-white" : "border-input"}`}>
              {selected.length === 0 && <Check className="h-3 w-3" />}
            </span>
            Default (Financial Close → Client Handover)
          </button>
          {matches.map((p) => {
            const on = selected.includes(p);
            return (
              <button
                key={p}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/60 text-left"
                onClick={() => toggle(p)}
                data-testid={`execution-phase-opt-${p}`}
              >
                <span className={`flex items-center justify-center w-4 h-4 shrink-0 rounded border ${on ? "bg-emerald-600 border-emerald-600 text-white" : "border-input"}`}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{p}</span>
              </button>
            );
          })}
          {matches.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground text-center">No phases found</p>}
        </div>
        {selected.length > 0 && (
          <div className="p-1 border-t">
            <button className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 rounded hover:bg-muted/60" onClick={() => onChange([])} data-testid="execution-phase-clear">
              Clear selection
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
