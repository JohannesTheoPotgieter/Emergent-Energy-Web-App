import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Lock, AlertCircle } from "lucide-react";

interface QmChallengeModalProps {
  open: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export function QmChallengeModal({ open, onSuccess, onClose }: QmChallengeModalProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!code.trim()) {
      setError("Please enter the access code");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch("/api/quality/access/verify", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess(true);
        setError("");
        setTimeout(() => {
          onSuccess();
          setCode("");
          setSuccess(false);
        }, 1000);
        return;
      }

      if (res.status === 429 || data.locked) {
        setIsLocked(true);
        setError(data.error || "Too many failed attempts. Locked for 15 minutes.");
        return;
      }

      if (data.attemptsRemaining !== undefined) {
        setAttemptsRemaining(data.attemptsRemaining);
      }

      setError(data.error || "Invalid access code");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading && !isLocked) {
      handleSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              {success ? (
                <ShieldCheck className="w-5 h-5 text-green-500" />
              ) : isLocked ? (
                <Lock className="w-5 h-5 text-red-500" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-primary" />
              )}
            </div>
            <div>
              <DialogTitle>Quality Manager Access</DialogTitle>
              <DialogDescription>
                Enter the 4-digit access code to continue
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center py-6 gap-3">
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-sm font-medium text-green-500">Access Granted</p>
          </div>
        ) : isLocked ? (
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-500/20">
              <Lock className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-500">Account Locked</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {error}
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={onClose} className="w-full" data-testid="button-close-challenge">
              Close
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-destructive">{error}</p>
                  {attemptsRemaining !== null && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {attemptsRemaining} attempt{attemptsRemaining !== 1 ? "s" : ""} remaining
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="Enter 4-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={handleKeyDown}
                className="text-center text-2xl tracking-[0.5em] font-mono h-14"
                autoFocus
                data-testid="input-access-code"
              />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} className="flex-1" data-testid="button-cancel-challenge">
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isLoading || code.length < 4}
                className="flex-1"
                data-testid="button-verify-code"
              >
                {isLoading ? "Verifying..." : "Verify"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
