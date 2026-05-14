import { CalendarDays } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { FinancialYearScope } from '@/hooks/use-financial-year-scope';

export function FinancialYearScopeControl({
  scope,
  className,
}: {
  scope: FinancialYearScope;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-xs shadow-sm',
        className,
      )}
      data-testid="finance-year-scope-control"
    >
      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
      <Select
        value={scope.allData ? 'all' : String(scope.fy)}
        onValueChange={(value) => {
          if (value === 'all') scope.setAllData(true);
          else scope.setFy(Number(value));
        }}
      >
        <SelectTrigger
          className="h-8 w-[120px] rounded-md border-border bg-background text-xs"
          data-testid="select-finance-year"
        >
          <SelectValue placeholder="Financial year" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" data-testid="select-finance-year-option-all">
            All data
          </SelectItem>
          {scope.options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              data-testid={`select-finance-year-option-${option.value}`}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
