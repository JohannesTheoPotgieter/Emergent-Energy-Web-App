import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { isImportStale } from "@shared/lib/cashflow-trust";

export interface TrustMetricLink {
  label: string;
  value: string | number;
  href?: string;
  tone?: "default" | "warning" | "critical";
  testId?: string;
}

export interface FinanceTrustStripProps {
  source: string;
  lastImportDate: string;
  quickBooksLinkStatus: "linked" | "partial" | "unmatched" | "unknown";
  readOnly?: boolean;
  metrics: TrustMetricLink[];
}

const toneClass: Record<NonNullable<TrustMetricLink["tone"]>, string> = {
  default: "bg-slate-100 text-slate-700 border-slate-200",
  warning: "bg-amber-100 text-amber-800 border-amber-300",
  critical: "bg-rose-100 text-rose-800 border-rose-300",
};

export function isStaleImport(lastImportDate: string): boolean {
  return isImportStale(lastImportDate);
}

export function buildTrustStripState(params: {
  lastImportDate: string;
  quickBooksLinkStatus: FinanceTrustStripProps["quickBooksLinkStatus"];
  readOnly?: boolean;
  metrics: TrustMetricLink[];
}) {
  const staleImport = isStaleImport(params.lastImportDate);
  const driftMetric = params.metrics.find((m) => m.label.toLowerCase().includes("drift"));
  const missingPoMetric = params.metrics.find((m) => m.label.toLowerCase().includes("missing po"));
  const asCount = (v: string | number | undefined): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
    return null;
  };
  return {
    staleImport,
    qbLinked: params.quickBooksLinkStatus === "linked",
    qbUnmatched: params.quickBooksLinkStatus === "unmatched",
    driftCount: asCount(driftMetric?.value),
    missingPoCount: asCount(missingPoMetric?.value),
    readOnly: !!params.readOnly,
  };
}

export function FinanceTrustStrip({
  source,
  lastImportDate,
  quickBooksLinkStatus,
  readOnly = false,
  metrics,
}: FinanceTrustStripProps) {
  const stale = isStaleImport(lastImportDate);

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-[11px] mb-2"
      data-testid="finance-trust-strip"
    >
      <Badge variant="outline" className="px-2 py-0.5 font-normal">
        Source: {source || "Unknown"}
      </Badge>
      <Badge
        className={`px-2 py-0.5 font-normal ${stale ? toneClass.warning : toneClass.default}`}
        data-testid="trust-stale-import-badge"
      >
        Last import: {lastImportDate || "Unknown"}
      </Badge>
      <Badge
        className={`px-2 py-0.5 font-normal ${
          quickBooksLinkStatus === "linked"
            ? toneClass.default
            : quickBooksLinkStatus === "partial"
              ? toneClass.warning
              : toneClass.critical
        }`}
        data-testid="trust-qb-link-status"
      >
        QB: {quickBooksLinkStatus}
      </Badge>
      {readOnly && (
        <Badge variant="outline" className="px-2 py-0.5 font-normal" data-testid="trust-read-only">
          Read-only
        </Badge>
      )}
      {metrics.map((metric) => {
        const badge = (
          <Badge
            key={metric.label}
            className={`px-2 py-0.5 font-normal ${toneClass[metric.tone ?? "default"]}`}
            data-testid={metric.testId}
          >
            {metric.label}: {metric.value}
          </Badge>
        );
        if (metric.href) {
          return (
            <Link key={metric.label} href={metric.href}>
              <a className="inline-flex">{badge}</a>
            </Link>
          );
        }
        return badge;
      })}
    </div>
  );
}
