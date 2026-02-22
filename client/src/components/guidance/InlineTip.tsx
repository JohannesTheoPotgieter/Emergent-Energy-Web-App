import { useState } from "react";
import { HelpCircle, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTipDismissed } from "@/hooks/use-guidance";

interface InlineTipProps {
  tipId: string;
  summary: string;
  details?: string;
  learnMoreUrl?: string;
  className?: string;
  dismissable?: boolean;
}

export function InlineTip({ tipId, summary, details, learnMoreUrl, className = "", dismissable = true }: InlineTipProps) {
  const { dismissed, dismiss } = useTipDismissed(tipId);
  const [showWhy, setShowWhy] = useState(false);

  if (dismissed) return null;

  return (
    <div className={`flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2 ${className}`} data-testid={`tip-${tipId}`}>
      <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-400" />
      <div className="flex-1 min-w-0">
        <span>{summary}</span>
        {details && (
          <>
            <button
              className="ml-1 text-blue-500 hover:text-blue-600 underline underline-offset-2 text-[11px]"
              onClick={() => setShowWhy(!showWhy)}
              data-testid={`tip-why-${tipId}`}
            >
              {showWhy ? "Less" : "Why?"}
            </button>
            {showWhy && (
              <p className="mt-1 text-muted-foreground leading-relaxed">
                {details.length > 300 ? (
                  <>
                    {details.slice(0, 300)}...
                    {learnMoreUrl && (
                      <a href={learnMoreUrl} target="_blank" rel="noopener" className="ml-1 text-blue-500 underline" data-testid={`tip-readmore-${tipId}`}>Read more</a>
                    )}
                  </>
                ) : details}
              </p>
            )}
          </>
        )}
      </div>
      {dismissable && (
        <button onClick={dismiss} className="shrink-0 hover:text-foreground" data-testid={`tip-dismiss-${tipId}`}>
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
