import { Badge } from '@/components/ui/badge';
import { Database, RefreshCw } from 'lucide-react';

type ReportTrustNoticeProps = {
  lastUpdatedAt?: string | null;
  sourceLabel: string;
  note?: string;
  className?: string;
};

export function ReportTrustNotice({
  lastUpdatedAt,
  sourceLabel,
  note,
  className = '',
}: ReportTrustNoticeProps) {
  const freshness = lastUpdatedAt
    ? `Freshness: ${new Date(lastUpdatedAt).toLocaleString()}`
    : 'Freshness: live query';

  return (
    <div
      className={`rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-700 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1 text-[10px]">
          <RefreshCw className="h-3 w-3" />
          {freshness}
        </Badge>
        <Badge variant="outline" className="gap-1 text-[10px]">
          <Database className="h-3 w-3" />
          Source of truth: {sourceLabel}
        </Badge>
      </div>
      {note ? <p className="mt-1 text-[11px] text-slate-600">{note}</p> : null}
    </div>
  );
}
