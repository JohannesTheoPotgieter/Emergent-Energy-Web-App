/**
 * Smart Import v2 — Invoice / PO integrity check (B4a)
 *
 * Lightweight pre-commit data-hygiene report. Surfaces invoice and PO
 * problems the operator should know about before pressing "Confirm
 * import" — duplicate invoice numbers, paid-without-invoice, PO used
 * for multiple counterparties, etc.
 *
 * Endpoint: GET /api/smart-import/:runId/integrity-check
 *
 * Soft-fail: if the endpoint errors or returns nothing useful, the card
 * hides itself rather than blocking the import flow.
 */

import { useEffect, useState } from "react";
import {
  Loader2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, FileWarning,
} from "lucide-react";
import { getAuthHeaders } from "@/pages/smart-import";
import { INTEGRITY_LABELS } from "./labels";

type Severity = "INFO" | "WARNING" | "BLOCKER";
interface Finding {
  kind: string;
  severity: Severity;
  section: "REVENUE" | "EXPENDITURE" | "CROSS";
  message: string;
  rows: number[];
  detail?: Record<string, unknown>;
}
interface IntegrityResponse {
  runId: number;
  totalCount: number;
  severityCounts: Record<Severity, number>;
  findings: Finding[];
}

interface Props {
  runId: number | null;
}

const SECTION_LABEL: Record<Finding["section"], string> = {
  REVENUE: "Revenue",
  EXPENDITURE: "Costs",
  CROSS: "Cross-section",
};

function rowsPreview(rows: number[]): string {
  if (rows.length === 0) return "";
  if (rows.length <= 6) return `Rows: ${rows.join(", ")}`;
  return `Rows: ${rows.slice(0, 6).join(", ")} +${rows.length - 6} more`;
}

export function SmartImportIntegrityCheck({ runId }: Props) {
  const [data, setData] = useState<IntegrityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/smart-import/${runId}/integrity-check`, { headers: getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load integrity check"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [runId]);

  if (!runId) return null;

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground"
        data-testid="integrity-check-loading"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {INTEGRITY_LABELS.loading}
      </div>
    );
  }

  // Soft-fail: stay silent if the endpoint errored.
  if (error || !data) return null;

  // Clean run — small green confirmation, no expand.
  if (data.totalCount === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
        data-testid="integrity-check-clean"
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        <span className="font-medium">{INTEGRITY_LABELS.clean}</span>
      </div>
    );
  }

  const warningCount = data.severityCounts.WARNING ?? 0;
  const blockerCount = data.severityCounts.BLOCKER ?? 0;
  const headerColor = blockerCount > 0
    ? "border-rose-200 bg-rose-50 text-rose-900"
    : "border-amber-200 bg-amber-50 text-amber-900";
  const panelId = `integrity-check-panel-${runId}`;

  return (
    <div
      className={`rounded-lg border ${headerColor}`}
      data-testid="integrity-check"
      data-issue-count={data.totalCount}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
        aria-controls={panelId}
        data-testid="integrity-check-toggle"
      >
        <div className="flex items-center gap-2 text-sm">
          {blockerCount > 0
            ? <FileWarning className="w-4 h-4 text-rose-600" />
            : <AlertTriangle className="w-4 h-4 text-amber-600" />}
          <span className="font-medium">{INTEGRITY_LABELS.title}</span>
          <span className="text-xs opacity-80">
            {blockerCount > 0 && <>{blockerCount} blocker{blockerCount === 1 ? "" : "s"}{warningCount > 0 ? " · " : ""}</>}
            {warningCount > 0 && <>{warningCount} warning{warningCount === 1 ? "" : "s"}</>}
          </span>
        </div>
        {expanded
          ? <ChevronDown className="w-4 h-4 opacity-70" />
          : <ChevronRight className="w-4 h-4 opacity-70" />}
      </button>

      {expanded && (
        <div id={panelId} role="region" aria-label="Integrity check findings" className="border-t border-current/10 px-3 py-2 space-y-2 bg-white/60" data-testid="integrity-check-list">
          {data.findings.map((f, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs rounded border border-slate-200 bg-white px-2.5 py-2"
              data-testid={`integrity-finding-${f.kind}-${i}`}
            >
              <span
                className={`mt-0.5 inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  f.severity === "BLOCKER"
                    ? "bg-rose-100 text-rose-800"
                    : f.severity === "WARNING"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {SECTION_LABEL[f.section]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-slate-800">{f.message}</p>
                {f.rows.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{rowsPreview(f.rows)}</p>
                )}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground italic pt-1">
            {INTEGRITY_LABELS.advisoryNote}
          </p>
        </div>
      )}
    </div>
  );
}
