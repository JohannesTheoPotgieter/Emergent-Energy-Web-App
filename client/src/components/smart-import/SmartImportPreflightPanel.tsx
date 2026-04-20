import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Hash, Layers, MapPin } from "lucide-react";

type PreflightCode = "DUPLICATE_PLANNED_REF" | "BLANK_OUTLINE_MILESTONE" | "MISSING_SOURCE_COORDINATES";

interface PreflightWarning {
  code: PreflightCode;
  section: "PLAN";
  message: string;
  sourceSheet: string | null;
  sourceRow: number | null;
  taskNo: string | null;
  taskName: string | null;
  plannedRef: string | null;
}

interface PreflightCounts {
  duplicatePlannedRefs: number;
  blankOutlineMilestones: number;
  missingSourceCoordinates: number;
  totalPlannedRows: number;
}

interface PreflightShape {
  warnings?: PreflightWarning[];
  counts?: PreflightCounts;
  plannedRefs?: Array<{ plannedRef: string; sourceSheet: string; sourceRow: number; taskName?: string | null }>;
}

interface RowWarning {
  section: string;
  code?: string;
  message?: string;
  externalRef?: string | null;
  rowUid?: string | null;
}

interface Props {
  preflight?: PreflightShape | null;
  rowWarnings?: RowWarning[] | null;
  variant?: "pre-commit" | "post-commit";
}

const CODE_META: Record<PreflightCode, { label: string; icon: React.ReactNode; tone: string }> = {
  DUPLICATE_PLANNED_REF: {
    label: "Duplicate planned identifiers",
    icon: <Hash className="w-3.5 h-3.5" />,
    tone: "bg-red-50 text-red-800 border-red-200",
  },
  BLANK_OUTLINE_MILESTONE: {
    label: "Milestones without outline numbers",
    icon: <Layers className="w-3.5 h-3.5" />,
    tone: "bg-amber-50 text-amber-800 border-amber-200",
  },
  MISSING_SOURCE_COORDINATES: {
    label: "Rows missing sheet/row metadata",
    icon: <MapPin className="w-3.5 h-3.5" />,
    tone: "bg-amber-50 text-amber-800 border-amber-200",
  },
};

function groupBy<T, K extends string>(items: T[], keyFn: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    (out[key] ||= []).push(item);
  }
  return out;
}

export function SmartImportPreflightPanel({ preflight, rowWarnings, variant = "pre-commit" }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const preflightWarnings = preflight?.warnings ?? [];
  const commitWarnings = rowWarnings ?? [];
  const total = preflightWarnings.length + commitWarnings.length;

  if (total === 0) return null;

  const grouped = groupBy(preflightWarnings, (w) => w.code);
  const counts = preflight?.counts;

  const toggle = (key: string) => setExpanded((s) => ({ ...s, [key]: !s[key] }));

  const headerLabel = variant === "post-commit"
    ? "Some rows finished with warnings"
    : "Pre-flight warnings";
  const headerSub = variant === "post-commit"
    ? "The import succeeded, but the rows below were skipped or flagged. Review them in the affected project."
    : "The file uploaded fine, but a few rows look unusual. You can still import — these are informational.";

  return (
    <div
      className="border border-amber-200 bg-amber-50/40 rounded-lg p-3 space-y-2"
      data-testid="preflight-panel"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-900">{headerLabel}</div>
          <div className="text-xs text-amber-800/80 mt-0.5">{headerSub}</div>
        </div>
      </div>

      {counts && variant === "pre-commit" && (
        <div className="flex flex-wrap gap-1.5 pl-6">
          {counts.duplicatePlannedRefs > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded border bg-red-50 text-red-800 border-red-200" data-testid="preflight-count-duplicates">
              {counts.duplicatePlannedRefs} duplicate refs
            </span>
          )}
          {counts.blankOutlineMilestones > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200" data-testid="preflight-count-blank-milestones">
              {counts.blankOutlineMilestones} unnamed milestones
            </span>
          )}
          {counts.missingSourceCoordinates > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200" data-testid="preflight-count-missing-coords">
              {counts.missingSourceCoordinates} missing source coords
            </span>
          )}
          {counts.totalPlannedRows > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200">
              of {counts.totalPlannedRows} schedule rows
            </span>
          )}
        </div>
      )}

      <div className="pl-6 space-y-1.5">
        {(Object.keys(grouped) as PreflightCode[]).map((code) => {
          const items = grouped[code];
          if (!items || items.length === 0) return null;
          const meta = CODE_META[code];
          const isOpen = !!expanded[code];
          return (
            <div key={code} className={`border rounded ${meta.tone}`}>
              <button
                type="button"
                onClick={() => toggle(code)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium hover:bg-black/5 rounded"
                data-testid={`preflight-group-${code.toLowerCase()}`}
              >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {meta.icon}
                <span className="flex-1 text-left">{meta.label}</span>
                <span className="opacity-70">{items.length} shown</span>
              </button>
              {isOpen && (
                <ul className="px-2 pb-2 pt-0 space-y-1 text-[11px] font-mono">
                  {items.slice(0, 25).map((w, idx) => (
                    <li key={idx} className="border-t border-current/10 pt-1 first:border-t-0 first:pt-0">
                      <div className="opacity-90">{w.message}</div>
                      {w.plannedRef && (
                        <div className="opacity-60 truncate" title={w.plannedRef}>
                          → {w.plannedRef}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {commitWarnings.length > 0 && (
          <div className="border rounded bg-amber-50 text-amber-800 border-amber-200">
            <button
              type="button"
              onClick={() => toggle("__commit__")}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium hover:bg-black/5 rounded"
              data-testid="preflight-group-commit-warnings"
            >
              {expanded["__commit__"] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">Rows skipped during commit</span>
              <span className="opacity-70">{commitWarnings.length}</span>
            </button>
            {expanded["__commit__"] && (
              <ul className="px-2 pb-2 pt-0 space-y-1 text-[11px] font-mono">
                {commitWarnings.slice(0, 50).map((w, idx) => (
                  <li key={idx} className="border-t border-current/10 pt-1 first:border-t-0 first:pt-0">
                    <div className="opacity-90">
                      <span className="opacity-60">[{w.section}{w.code ? `:${w.code}` : ""}]</span> {w.message || "(no message)"}
                    </div>
                    {w.externalRef && (
                      <div className="opacity-60 truncate" title={w.externalRef}>
                        → {w.externalRef}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
