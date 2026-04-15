import { AlertTriangle } from 'lucide-react';

type FinanceLimitedBetaBannerProps = {
  /**
   * Short title shown in the banner header. Keep to ~6 words so it fits
   * on a single line in the sidebar-constrained layouts.
   */
  title: string;
  /**
   * Body text describing what is or is not trustworthy about the feature.
   * Kept deliberately plain so PMs / finance managers can self-serve the
   * risk assessment without opening the release notes.
   */
  body: string;
  /**
   * When true, the banner uses a hotter red treatment to signal that the
   * feature should not be relied on for reporting decisions yet.
   */
  critical?: boolean;
  className?: string;
};

/**
 * Containment banner for half-cooked Finance / QuickBooks surfaces.
 *
 * Pair this with a `ReportTrustNotice` when the feature is trustworthy
 * but needs operational caveats. Use this when the feature is only fit
 * for guided / limited-beta use.
 */
export function FinanceLimitedBetaBanner({
  title,
  body,
  critical = false,
  className = '',
}: FinanceLimitedBetaBannerProps) {
  const tone = critical
    ? 'border-rose-300 bg-rose-50 text-rose-900'
    : 'border-amber-300 bg-amber-50 text-amber-900';
  const iconTone = critical ? 'text-rose-600' : 'text-amber-600';
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-lg border ${tone} px-4 py-3 text-sm ${className}`}
      data-testid="finance-limited-beta-banner"
    >
      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone}`} />
      <div className="space-y-1">
        <p className="font-semibold leading-tight">{title}</p>
        <p className="text-[13px] leading-snug opacity-90">{body}</p>
      </div>
    </div>
  );
}
