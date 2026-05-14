import { CalendarDays } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
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
        <SelectTrigger className="h-8 w-[112px] rounded-md border-border bg-background text-xs">
          <SelectValue placeholder="Financial year" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All data</SelectItem>
          {scope.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1.5">
        <Switch
          id="finance-year-all-data"
          checked={scope.allData}
          onCheckedChange={scope.setAllData}
          aria-label="Show all finance data"
        />
        <Label
          htmlFor="finance-year-all-data"
          className="text-[11px] font-medium text-muted-foreground"
        >
          All data
        </Label>
      </div>
    </div>
  );
}
