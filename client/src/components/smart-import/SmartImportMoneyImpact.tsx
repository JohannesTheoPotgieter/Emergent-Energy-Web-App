/**
 * Smart Import v2 — Money impact summary (A1)
 *
 * A pre-commit financial dry-run shown on the Confirm step. Tells the user,
 * in plain rands and cents, exactly what this import will move on:
 *   - Revenue (active milestone book)
 *   - Cost (active expenditure book)
 *
 * For each side we show:
 *   - "New money in"          sum of amount-ex-vat for NEW rows
 *   - "Net change to existing" sum of (file − db) for CHANGED rows
 *   - "Held by QuickBooks"    portion of the net change that QB will lock
 *                              back (only visible when the gate is on AND
 *                              there are blocked moves)
 *   - "Untouched (preserved)"  total amount of rows missing from the upload
 *                              that this import will leave alone
 *
 * Endpoint: GET /api/smart-import/:runId/money-impact
 */

import { useEffect, useState } from "react";
import { Loader2, TrendingUp, TrendingDown, Minus, ShieldCheck, Info } from "lucide-react";
import { getAuthHeaders } from "@/pages/smart-import";
import { MONEY_IMPACT_LABELS } from "./labels";

interface ImpactSection {
  newTotal: number;
  changedDelta: number;
  qbBlockedDelta: number;
  missingPreservedTotal: number;
  missingRemovedTotal: number;
  newCount: number;
  changedCount: number;
  missingPreservedCount: number;
  missingRemovedCount: number;
  qbBlockedCount: number;
  keptByDecisionCount: number;
}

interface MoneyImpactResponse {
  currency: "ZAR";
  qbPrecedenceEnabled: boolean;
  projectId: number | null;
  revenue: ImpactSection;
  cost: ImpactSection;
  revenueNetChange: number;
  costNetChange: number;
}

interface Props {
  runId: number | null;
  /** User-resolved conflict decisions, keyed `${rowUid}::${fieldName}`. The
   *  endpoint honours `keep_app` on `amountExVat` so this card stays in
   *  sync with what commit-executor will actually write. */
  decisions?: Record<string, "keep_app" | "accept_file">;
}

function fmt(n: number): string {
  // South African rand. No fractional cents shown — these are project-level
  // sums, not individual line items, and the precision is misleading.
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}R ${abs.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function deltaIcon(n: number) {
  if (n > 0) return <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />;
  if (n < 0) return <TrendingDown className="w-3.5 h-3.5 text-rose-600" />;
  return <Minus className="w-3.5 h-3.5 text-slate-400" />;
}

function deltaColor(n: number): string {
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-rose-700";
  return "text-slate-500";
}

function ImpactSideCard({
  title,
  data,
  netChange,
  qbOn,
  testIdPrefix,
}: {
  title: string;
  data: ImpactSection;
  netChange: number;
  qbOn: boolean;
  testIdPrefix: string;
}) {
  const showQbBlocked = qbOn && data.qbBlockedCount > 0;
  const showRemoved = data.missingRemovedCount > 0;
  const showPreserved = data.missingPreservedCount > 0;
  const showKept = data.keptByDecisionCount > 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3" data-testid={`${testIdPrefix}-card`}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">{title}</span>
        <span
          className={`text-base font-semibold ${deltaColor(netChange)}`}
          data-testid={`${testIdPrefix}-net`}
        >
          {fmt(netChange)}
        </span>
      </div>

      <div className="grid gap-1 text-xs">
        {data.newCount > 0 && (
          <div className="flex items-center justify-between" data-testid={`${testIdPrefix}-new`}>
            <span className="text-slate-600 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              {MONEY_IMPACT_LABELS.newIn} <span className="text-muted-foreground">({data.newCount})</span>
            </span>
            <span className="font-medium text-emerald-700">{fmt(data.newTotal)}</span>
          </div>
        )}

        {data.changedCount > 0 && (
          <div className="flex items-center justify-between" data-testid={`${testIdPrefix}-changed`}>
            <span className="text-slate-600 flex items-center gap-1.5">
              {deltaIcon(data.changedDelta)}
              {MONEY_IMPACT_LABELS.netChange} <span className="text-muted-foreground">({data.changedCount})</span>
            </span>
            <span className={`font-medium ${deltaColor(data.changedDelta)}`}>
              {data.changedDelta >= 0 ? "+" : ""}{fmt(data.changedDelta)}
            </span>
          </div>
        )}

        {showQbBlocked && (
          <div className="flex items-center justify-between" data-testid={`${testIdPrefix}-qb-blocked`}>
            <span className="text-slate-600 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              {MONEY_IMPACT_LABELS.qbHeld} <span className="text-muted-foreground">({data.qbBlockedCount})</span>
            </span>
            <span className="font-medium text-slate-500">
              {data.qbBlockedDelta >= 0 ? "−" : "+"}{fmt(Math.abs(data.qbBlockedDelta))}
            </span>
          </div>
        )}

        {showRemoved && (
          <div className="flex items-center justify-between text-rose-700" data-testid={`${testIdPrefix}-removed`}>
            <span className="flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5" />
              {MONEY_IMPACT_LABELS.removed} <span className="text-rose-600/70">({data.missingRemovedCount})</span>
            </span>
            <span className="font-medium">−{fmt(data.missingRemovedTotal)}</span>
          </div>
        )}

        {showPreserved && (
          <div className="flex items-center justify-between text-slate-600" data-testid={`${testIdPrefix}-preserved`}>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              {MONEY_IMPACT_LABELS.preserved} <span className="text-muted-foreground">({data.missingPreservedCount})</span>
            </span>
            <span className="font-medium">{fmt(data.missingPreservedTotal)}</span>
          </div>
        )}

        {showKept && (
          <div className="flex items-center justify-between text-purple-700" data-testid={`${testIdPrefix}-kept-by-decision`}>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              {MONEY_IMPACT_LABELS.keptByDecision} <span className="text-purple-600/70">({data.keptByDecisionCount})</span>
            </span>
            <span className="font-medium text-slate-500">—</span>
          </div>
        )}

        {data.newCount === 0 && data.changedCount === 0 && data.missingRemovedCount === 0 && data.missingPreservedCount === 0 && (
          <div className="text-muted-foreground italic" data-testid={`${testIdPrefix}-empty`}>
            {MONEY_IMPACT_LABELS.nothing}
          </div>
        )}
      </div>
    </div>
  );
}

export function SmartImportMoneyImpact({ runId, decisions }: Props) {
  const [data, setData] = useState<MoneyImpactResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stringify decisions for a stable effect-dep so we re-fetch when the
  // user resolves an amount conflict on the previous step.
  const decisionsKey = JSON.stringify(decisions ?? {});

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/smart-import/${runId}/money-impact`, {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ decisions: decisions ?? {} }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load money impact"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, decisionsKey]);

  if (!runId) return null;

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground"
        data-testid="money-impact-loading"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {MONEY_IMPACT_LABELS.loading}
      </div>
    );
  }

  // Soft-fail: never block the import flow if this dry-run can't be computed.
  if (error || !data) return null;

  const noActivity =
    data.revenue.newCount + data.revenue.changedCount + data.revenue.missingRemovedCount + data.revenue.missingPreservedCount === 0 &&
    data.cost.newCount + data.cost.changedCount + data.cost.missingRemovedCount + data.cost.missingPreservedCount === 0;

  if (noActivity) {
    return (
      <div
        className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
        data-testid="money-impact-quiet"
      >
        <Info className="w-3.5 h-3.5 mt-0.5 text-slate-400 flex-shrink-0" />
        {MONEY_IMPACT_LABELS.noActivity}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="money-impact">
      <p className="text-sm font-medium text-slate-700">
        {MONEY_IMPACT_LABELS.title}
      </p>
      <p className="text-xs text-muted-foreground">
        {MONEY_IMPACT_LABELS.subtitle}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <ImpactSideCard
          title={MONEY_IMPACT_LABELS.revenueTitle}
          data={data.revenue}
          netChange={data.revenueNetChange}
          qbOn={data.qbPrecedenceEnabled}
          testIdPrefix="money-impact-revenue"
        />
        <ImpactSideCard
          title={MONEY_IMPACT_LABELS.costTitle}
          data={data.cost}
          netChange={data.costNetChange}
          qbOn={data.qbPrecedenceEnabled}
          testIdPrefix="money-impact-cost"
        />
      </div>
    </div>
  );
}
