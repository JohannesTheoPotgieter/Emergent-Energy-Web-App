import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RotateCcw } from "lucide-react";

interface EditCellPopoverProps {
  trigger: React.ReactNode;
  weekLabel: string;
  fieldLabel: string;
  currentValue: number;
  computedValue: number;
  hasOverride: boolean;
  requireReason: boolean;
  defaultReason?: string | null;
  onSave: (args: { value: number; reason: string }) => void;
  onResetToComputed?: () => void;
  isSaving: boolean;
  isResetting?: boolean;
  testIdPrefix: string;
  helperText?: string;
}

export function EditCellPopover({
  trigger,
  weekLabel,
  fieldLabel,
  currentValue,
  computedValue,
  hasOverride,
  requireReason,
  defaultReason,
  onSave,
  onResetToComputed,
  isSaving,
  isResetting = false,
  testIdPrefix,
  helperText,
}: EditCellPopoverProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentValue?.toString() ?? "0");
  const [reason, setReason] = useState(defaultReason ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(currentValue?.toString() ?? "0");
      setReason(defaultReason ?? "");
      setError(null);
    }
  }, [open, currentValue, defaultReason]);

  const handleSave = () => {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) {
      setError("Please enter a valid number");
      return;
    }
    if (requireReason && !reason.trim()) {
      setError("A reason is required for this override");
      return;
    }
    onSave({ value: num, reason: reason.trim() });
    setOpen(false);
  };

  const handleReset = () => {
    if (onResetToComputed) {
      onResetToComputed();
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        onClick={(e) => e.stopPropagation()}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-3 space-y-3"
        align="end"
        onClick={(e) => e.stopPropagation()}
        data-testid={`${testIdPrefix}-popover`}
      >
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-foreground">
            Edit {fieldLabel}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {weekLabel} · Computed {formatNumber(computedValue)}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            Override value (R)
          </label>
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 font-mono text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setOpen(false);
            }}
            data-testid={`${testIdPrefix}-input-value`}
          />
        </div>

        {requireReason && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Reason <span className="text-red-600">*</span>
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Adjusting for delayed payment"
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setOpen(false);
              }}
              data-testid={`${testIdPrefix}-input-reason`}
            />
          </div>
        )}

        {helperText && (
          <p className="text-[11px] text-muted-foreground">{helperText}</p>
        )}

        {error && (
          <p className="text-[11px] text-red-600" data-testid={`${testIdPrefix}-error`}>
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          {hasOverride && onResetToComputed ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-[11px] text-muted-foreground"
              onClick={handleReset}
              disabled={isResetting}
              data-testid={`${testIdPrefix}-reset`}
            >
              {isResetting ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <RotateCcw className="h-3 w-3 mr-1" />
              )}
              Reset to computed
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-[11px]"
              onClick={() => setOpen(false)}
              data-testid={`${testIdPrefix}-cancel`}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 px-3 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleSave}
              disabled={isSaving}
              data-testid={`${testIdPrefix}-save`}
            >
              {isSaving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatNumber(n: number) {
  const v = Math.round(n || 0);
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(v);
}
