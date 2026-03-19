import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Smartphone, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PM_MODE_KEY = "pm-otg-mode";
const PM_DONT_ASK_KEY = "pm-otg-dont-ask";

type PmMode = "on_the_go" | "full_detail";

export function usePmMode(): { mode: PmMode; setMode: (m: PmMode) => void; isPm: boolean } {
  const { user } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const isPm = companyRole === "PROJECT_MANAGER_SITE" || (user?.role as string) === "PROJECT_MANAGER_SITE";

  const [mode, setModeState] = useState<PmMode>(() => {
    if (typeof window === "undefined") return "full_detail";
    return (localStorage.getItem(PM_MODE_KEY) as PmMode) || "full_detail";
  });

  const setMode = useCallback((newMode: PmMode) => {
    setModeState(newMode);
    localStorage.setItem(PM_MODE_KEY, newMode);
    fetch("/api/pm-otg/mode", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("auth_token") || ""}`,
      },
      body: JSON.stringify({ mode: newMode }),
    }).catch(() => {});
  }, []);

  return { mode, setMode, isPm };
}

export function PmModeToggle() {
  const { mode, setMode, isPm } = usePmMode();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!isPm || !isMobile) return;
    const dontAsk = localStorage.getItem(PM_DONT_ASK_KEY);
    if (dontAsk) return;
    const currentMode = localStorage.getItem(PM_MODE_KEY);
    if (currentMode === "on_the_go") return;
    setShowPrompt(true);
  }, [isPm, isMobile]);

  if (!isPm) return null;

  const handleToggle = () => {
    const newMode = mode === "on_the_go" ? "full_detail" : "on_the_go";
    setMode(newMode);
    if (newMode === "on_the_go") {
      navigate("/pm/on-the-go");
    } else {
      navigate("/execution-board");
    }
  };

  const handlePromptAccept = () => {
    setShowPrompt(false);
    setMode("on_the_go");
    navigate("/pm/on-the-go");
  };

  const handlePromptDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem(PM_DONT_ASK_KEY, "true");
  };

  return (
    <>
      <button
        onClick={handleToggle}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 border",
          mode === "on_the_go"
            ? "bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-500/25"
            : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
        )}
        data-testid="btn-pm-mode-toggle"
        title={mode === "on_the_go" ? "Switch to Full Detail" : "Switch to On-The-Go"}
      >
        {mode === "on_the_go" ? (
          <>
            <Smartphone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">On-The-Go</span>
          </>
        ) : (
          <>
            <Monitor className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Full Detail</span>
          </>
        )}
      </button>

      <Dialog open={showPrompt} onOpenChange={setShowPrompt}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Switch to On-The-Go?</DialogTitle>
            <DialogDescription>
              You're on a mobile device. On-The-Go mode gives you quick access to site actions, progress updates, and project health — optimized for the field.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={handlePromptDismiss}
              data-testid="btn-pm-prompt-dismiss"
            >
              No, don't ask again
            </Button>
            <Button
              onClick={handlePromptAccept}
              data-testid="btn-pm-prompt-accept"
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Yes, switch now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
