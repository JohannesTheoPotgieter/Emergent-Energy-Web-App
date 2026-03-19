import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PauseCircle } from "lucide-react";

interface HoldReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string, blockedType: string) => void;
  testIdPrefix?: string;
}

export function HoldReasonDialog({ open, onOpenChange, onConfirm, testIdPrefix = "hold" }: HoldReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [blockedType, setBlockedType] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setBlockedType("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PauseCircle className="h-5 w-5 text-amber-500" />
            Hold Reason Required
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <p className="text-sm text-muted-foreground">Please provide a reason for putting this task on hold.</p>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Blocked Type *</label>
            <SearchableSelect
              value={blockedType}
              onValueChange={setBlockedType}
              placeholder="Internal or External..."
              triggerClassName="h-9"
              options={[
                { value: "Internal", label: "Internal" },
                { value: "External", label: "External" },
              ]}
              data-testid={`select-${testIdPrefix}-blocked-type`}
            />
          </div>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Waiting for client approval, materials delayed..."
            className="min-h-[80px]"
            data-testid={`input-${testIdPrefix}-reason`}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid={`btn-${testIdPrefix}-cancel`}>Cancel</Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700"
              disabled={!reason.trim() || !blockedType}
              onClick={() => {
                if (reason.trim() && blockedType) {
                  onConfirm(reason.trim(), blockedType);
                  onOpenChange(false);
                }
              }}
              data-testid={`btn-${testIdPrefix}-confirm`}
            >
              Put on Hold
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
