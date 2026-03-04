import { useState } from "react";
import { AlertTriangle, ArrowRight, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface SmartValidationProps {
  issue: string;
  fix: string;
  onFix?: () => void;
  onOverride?: (reason: string) => void;
  allowOverride?: boolean;
  className?: string;
}

export function SmartValidation({ issue, fix, onFix, onOverride, allowOverride = false, className = "" }: SmartValidationProps) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  return (
    <div className={`rounded-md border border-amber-300 bg-amber-50 p-3 text-sm ${className}`} data-testid="smart-validation">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="flex-1 space-y-1.5">
          <p className="font-medium text-amber-800" data-testid="validation-issue">{issue}</p>
          <p className="text-amber-700 text-xs" data-testid="validation-fix">{fix}</p>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {onFix && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-amber-300 hover:bg-amber-100"
                onClick={onFix}
                data-testid="validation-fix-btn"
              >
                Fix it <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            )}
            {allowOverride && onOverride && !showOverride && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setShowOverride(true)}
                data-testid="validation-override-toggle"
              >
                <ShieldOff className="w-3 h-3 mr-1" /> Override
              </Button>
            )}
          </div>
          {showOverride && (
            <div className="pt-2 space-y-2">
              <Textarea
                placeholder="Explain why you're overriding this warning (required)..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="text-xs min-h-[60px]"
                data-testid="validation-override-reason"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  disabled={overrideReason.trim().length < 5}
                  onClick={() => {
                    onOverride?.(overrideReason.trim());
                    setShowOverride(false);
                    setOverrideReason("");
                  }}
                  data-testid="validation-override-confirm"
                >
                  Confirm Override
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => { setShowOverride(false); setOverrideReason(""); }}
                  data-testid="validation-override-cancel"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
