// ============================================================
// ProjectWorkspaceBetaBanner — opt-in nudge to the new 4-tab
// workspace at /project/v2/:projectId.
//
// PR-E of the truth/clear/simple redesign. The legacy
// /project/id/:projectId remains the default; this small banner
// shows once per user, can be dismissed for good, and quietly
// disappears for anyone who's tried v2.
// ============================================================

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { statusClasses } from "@/lib/design-tokens";
import { Sparkles, X } from "lucide-react";

const DISMISS_KEY = "project-workspace-beta-banner-dismissed";

export function ProjectWorkspaceBetaBanner({ projectId }: { projectId: number }) {
  const [, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState(true); // start true so we don't flash before localStorage read

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* localStorage unavailable — show the banner */
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b ${statusClasses("neutral", "soft")}`}>
      <Sparkles className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 min-w-0">
        New: a 4-tab project workspace (beta) — same data, less clicking. Try it without losing your place.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-[11px]"
        onClick={() => setLocation(`/project/v2/${projectId}`)}
      >
        Try workspace (beta)
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0"
        onClick={dismiss}
        aria-label="Dismiss"
        title="Don't show this again"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
