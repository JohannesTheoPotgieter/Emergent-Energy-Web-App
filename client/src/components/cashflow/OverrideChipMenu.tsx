import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { History, X, AlertTriangle } from "lucide-react";

interface OverrideChipMenuProps {
  chip: React.ReactNode;
  onViewHistory?: () => void;
  onClear: () => void;
  canEdit: boolean;
  testId: string;
  clearLabel?: string;
  /** Optional explicit summary of what clearing does — shown in the confirm dialog. */
  clearImpact?: string;
}

export function OverrideChipMenu({
  chip,
  onViewHistory,
  onClear,
  canEdit,
  testId,
  clearLabel = "Clear override",
  clearImpact = "Clearing this override re-cascades the computed value forward and recalculates every closing balance after this week. The previous value stays in the override history.",
}: OverrideChipMenuProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!canEdit && !onViewHistory) {
    return <>{chip}</>;
  }

  return (
    <>
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
              onSelect={(e) => {
                // Prevent the menu's auto-close from racing the dialog open.
                e.preventDefault();
                setConfirmOpen(true);
              }}
              className="text-red-700 focus:text-red-700 focus:bg-red-50"
              data-testid={`${testId}-clear`}
            >
              <X className="h-3.5 w-3.5 mr-2" />
              {clearLabel}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid={`${testId}-confirm`}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              {clearLabel}?
            </AlertDialogTitle>
            <AlertDialogDescription>{clearImpact}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`${testId}-confirm-cancel`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600/40"
              onClick={() => {
                setConfirmOpen(false);
                onClear();
              }}
              data-testid={`${testId}-confirm-clear`}
            >
              {clearLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
