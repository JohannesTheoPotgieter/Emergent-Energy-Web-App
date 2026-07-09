import { Button } from "@/components/ui/button";
import { SquareCheck, Send, PackagePlus, CheckCircle, X } from "lucide-react";

/**
 * Bulk-action bar for selected checklist items (Task 3.3 extraction from
 * QualityTab). Presentational — the parent owns selection state, the
 * mutations and the approver/pack dialogs; this renders the bar + the
 * blocked-approval reasons banner and calls back on each action.
 */
export function BulkBar({
  selectedCount,
  blockedApprovalSelections,
  showHandoverPackAction,
  isPending,
  onSendForApproval,
  onCreatePack,
  onBulkStatus,
  onClear,
}: {
  selectedCount: number;
  blockedApprovalSelections: Array<{ id: number; reason: string }>;
  showHandoverPackAction: boolean;
  isPending: boolean;
  onSendForApproval: () => void;
  onCreatePack: () => void;
  onBulkStatus: (status: string) => void;
  onClear: () => void;
}) {
  if (selectedCount === 0) return null;
  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-3 flex-wrap" data-testid="bulk-actions-bar">
        <SquareCheck className="w-4 h-4 text-slate-600" />
        <span className="text-sm font-medium text-slate-700">{selectedCount} item{selectedCount !== 1 ? "s" : ""} selected</span>
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-500 hover:bg-amber-600 gap-1"
            disabled={selectedCount === blockedApprovalSelections.length}
            onClick={onSendForApproval}
            data-testid="bulk-send-for-approval"
          >
            <Send className="w-3 h-3" /> Send for approval
          </Button>
          {showHandoverPackAction && (
            <Button
              size="sm"
              className="h-7 text-xs bg-red-600 hover:bg-red-700 gap-1"
              onClick={onCreatePack}
              data-testid="bulk-create-handover-pack"
            >
              <PackagePlus className="w-3 h-3" /> Create handover pack
            </Button>
          )}
          <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => onBulkStatus("pass")} disabled={isPending} data-testid="bulk-pass">
            <CheckCircle className="w-3 h-3 mr-1" /> Pass
          </Button>
          <Button size="sm" className="h-7 text-xs bg-amber-500 hover:bg-amber-600" onClick={() => onBulkStatus("review")} disabled={isPending} data-testid="bulk-review">Review</Button>
          <Button size="sm" className="h-7 text-xs" variant="destructive" onClick={() => onBulkStatus("fail")} disabled={isPending} data-testid="bulk-fail">Fail</Button>
          <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => onBulkStatus("na")} disabled={isPending} data-testid="bulk-na">N/A</Button>
          <Button size="sm" className="h-7 text-xs" variant="ghost" onClick={onClear} data-testid="bulk-clear">
            <X className="w-3 h-3 mr-1" /> Clear
          </Button>
        </div>
      </div>
      {blockedApprovalSelections.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 space-y-1" data-testid="bulk-blocked-reasons">
          <p className="font-medium">Some selected items cannot be submitted for review:</p>
          {blockedApprovalSelections.slice(0, 4).map((item) => (
            <p key={item.id}>• Item #{item.id}: {item.reason}</p>
          ))}
          {blockedApprovalSelections.length > 4 && <p>• +{blockedApprovalSelections.length - 4} more blocked item(s)</p>}
        </div>
      )}
    </>
  );
}
