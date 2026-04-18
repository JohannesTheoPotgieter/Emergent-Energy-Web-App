import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { History, X } from "lucide-react";

interface OverrideChipMenuProps {
  chip: React.ReactNode;
  onViewHistory?: () => void;
  onClear: () => void;
  canEdit: boolean;
  testId: string;
  clearLabel?: string;
}

export function OverrideChipMenu({
  chip,
  onViewHistory,
  onClear,
  canEdit,
  testId,
  clearLabel = "Clear override",
}: OverrideChipMenuProps) {
  if (!canEdit && !onViewHistory) {
    return <>{chip}</>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        onClick={(e) => e.stopPropagation()}
        data-testid={`${testId}-trigger`}
      >
        <button
          type="button"
          className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/40 rounded"
          aria-label="Override actions"
        >
          {chip}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48"
        onClick={(e) => e.stopPropagation()}
      >
        {onViewHistory && (
          <DropdownMenuItem
            onClick={onViewHistory}
            data-testid={`${testId}-view-history`}
          >
            <History className="h-3.5 w-3.5 mr-2" />
            View history
          </DropdownMenuItem>
        )}
        {canEdit && onViewHistory && <DropdownMenuSeparator />}
        {canEdit && (
          <DropdownMenuItem
            onClick={onClear}
            className="text-red-700 focus:text-red-700 focus:bg-red-50"
            data-testid={`${testId}-clear`}
          >
            <X className="h-3.5 w-3.5 mr-2" />
            {clearLabel}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
