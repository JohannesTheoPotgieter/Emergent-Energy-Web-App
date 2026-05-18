/**
 * Smart Import v2 — QuickBooks protections callout (A2)
 *
 * Renders an at-a-glance banner during the import flow showing which rows are
 * protected by QuickBooks precedence and what that means for the upload.
 *
 * Visibility rules:
 *  - If the QB precedence gate is OFF → render a subtle muted note (so the
 *    user knows the protection isn't active and that overrides from the file
 *    will still land).
 *  - If the gate is ON and there are 0 linked rows → render a brief positive
 *    confirmation (gate is armed, nothing currently linked).
 *  - If the gate is ON and there are linked rows → render the full callout
 *    with counts + locked field list + behaviour bullets.
 *
 * Endpoint: GET /api/smart-import/:runId/qb-protections
 */

import { useEffect, useState } from "react";
import { ShieldCheck,  ShieldOff, Loader2 } from "lucide-react";
import { getAuthHeaders } from "@/pages/smart-import";
import { fieldLabel, QB_PROTECTIONS_LABELS } from "./labels";

interface QbProtectionsResponse {
  enabled: boolean;
  projectId: number | null;
  costLinkedCount: number;
  revenueLinkedCount: number;
  lockedFields: string[];
  protections: {
    autoRealiseOnQbPaid: boolean;
    preserveLinkedRowsMissingFromUpload: boolean;
    logsVariancesToAudit: boolean;
  };
}

interface Props {
  runId: number | null;
  /** Compact mode shows a one-line summary (used on the changes step). */
  compact?: boolean;
}

export function SmartImportQbProtectionsCallout({ runId, compact = false }: Props) {
  const [data, setData] = useState<QbProtectionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/smart-import/${runId}/qb-protections`, { headers: getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load QuickBooks protections"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [runId]);

  if (!runId) return null;

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        data-testid="qb-protections-loading"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking QuickBooks protections…
      </div>
    );
  }

  if (error) {
    // Soft-fail: show nothing intrusive. Audit log will still capture failures.
    return null;
  }

  if (!data) return null;

  const totalLinked = data.costLinkedCount + data.revenueLinkedCount;

  // Gate OFF — neutral note so the user understands the file *will* override.
  if (!data.enabled) {
    return (
      <div
        className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
        data-testid="qb-protections-off"
      >
        <ShieldOff className="w-3.5 h-3.5 mt-0.5 text-slate-400 flex-shrink-0" />
        <span>{QB_PROTECTIONS_LABELS.off}</span>
      </div>
    );
  }

  // Gate ON, no linked rows — armed, nothing protected on this project yet.
  if (totalLinked === 0) {
    return (
      <div
        className={
          compact
            ? "flex items-center gap-2 text-xs text-emerald-700"
            : "flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
        }
        data-testid="qb-protections-armed-empty"
      >
        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>{QB_PROTECTIONS_LABELS.armedEmpty}</span>
      </div>
    );
  }

  // Compact form — single sentence with counts.
  if (compact) {
    return (
      <div
        className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
        data-testid="qb-protections-compact"
      >
        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>
          {QB_PROTECTIONS_LABELS.compactPrefix} <strong>{data.costLinkedCount}</strong>{" "}
          {data.costLinkedCount === 1 ? "cost line" : "cost lines"} and{" "}
          <strong>{data.revenueLinkedCount}</strong>{" "}
          {data.revenueLinkedCount === 1 ? "revenue line" : "revenue lines"}{" "}
          {QB_PROTECTIONS_LABELS.compactSuffix}
        </span>
      </div>
    );
  }

  // Full form.
  return (
    <div
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
      data-testid="qb-protections-full"
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-700 flex-shrink-0" />
        <div className="space-y-2 text-sm text-emerald-900">
          <p className="font-medium">
            {QB_PROTECTIONS_LABELS.title}
          </p>
          <p className="text-xs">
            <strong>{data.costLinkedCount}</strong>{" "}
            {data.costLinkedCount === 1 ? "cost line" : "cost lines"} and{" "}
            <strong>{data.revenueLinkedCount}</strong>{" "}
            {data.revenueLinkedCount === 1 ? "revenue line" : "revenue lines"}{" "}
            {QB_PROTECTIONS_LABELS.linkedSuffix}
          </p>

          <div className="text-xs">
            <p className="font-medium mb-1">{QB_PROTECTIONS_LABELS.lockedHeading}</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 list-disc list-inside marker:text-emerald-600">
              {data.lockedFields.map((f) => (
                <li key={f} data-testid={`qb-locked-field-${f}`}>{fieldLabel(f)}</li>
              ))}
            </ul>
          </div>

          <ul className="text-xs space-y-0.5 list-disc list-inside marker:text-emerald-600">
            {data.protections.preserveLinkedRowsMissingFromUpload && (
              <li>{QB_PROTECTIONS_LABELS.preserveMissing}</li>
            )}
            {data.protections.autoRealiseOnQbPaid && (
              <li>{QB_PROTECTIONS_LABELS.autoRealise}</li>
            )}
            {data.protections.logsVariancesToAudit && (
              <li>{QB_PROTECTIONS_LABELS.auditTrail}</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Variant of the callout that hides itself when there's nothing useful to
 *  show (used inline on the Found step where space is tight). */
export function SmartImportQbProtectionsCalloutWhenRelevant(props: Props) {
  // We always render the underlying component — its own visibility logic
  // already collapses to a single line when nothing is linked or the gate
  // is off. Kept as a named export so callers can document intent at the
  // call site.
  return <SmartImportQbProtectionsCallout {...props} />;
}
