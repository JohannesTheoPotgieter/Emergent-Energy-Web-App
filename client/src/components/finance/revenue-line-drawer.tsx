/**
 * RevenueMonthDetailDrawer — the line/invoice level of the Revenue drill
 * (FY → month → project → line → invoice).
 *
 * Now a thin wrapper over the shared <FinanceLineDetailDrawer> so Revenue, COS
 * and GP all drill into the same component (one look-and-feel, one fetch +
 * normalise path). Presentation only — it reads the SAME canonical
 * `/api/revenue-tracker/month-detail` endpoint and changes no figure.
 */
import {
  FinanceLineDetailDrawer,
  type FinanceDetailStateFilter,
} from '@/components/finance/finance-line-detail-drawer';

export type RevenueDetailFilter = FinanceDetailStateFilter;

export function RevenueMonthDetailDrawer({
  monthKey,
  monthLabel,
  onClose,
  defaultFilter = 'all',
  defaultProject = 'all',
}: {
  monthKey: string;
  monthLabel: string;
  onClose: () => void;
  defaultFilter?: RevenueDetailFilter;
  defaultProject?: string;
}) {
  return (
    <FinanceLineDetailDrawer
      variant="revenue"
      title={monthLabel}
      monthKey={monthKey}
      defaultFilter={defaultFilter}
      defaultProject={defaultProject}
      onClose={onClose}
    />
  );
}
