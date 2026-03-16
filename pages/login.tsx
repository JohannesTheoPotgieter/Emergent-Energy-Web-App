import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Lock, User, Info, X, Zap, AlertCircle, KeyRound, ShieldCheck } from "lucide-react";

const MS_ERROR_MESSAGES: Record<string, string> = {
  ms_auth_failed: "Microsoft sign-in failed. Please try again.",
  ms_auth_denied: "Microsoft sign-in was cancelled or denied.",
  ms_profile_failed: "Could not retrieve your Microsoft profile.",
  ms_no_email: "No email address found on your Microsoft account.",
  ms_no_account: "No matching account found. Your Microsoft email must match an existing account. Contact your administrator.",
  ms_session_failed: "Session could not be established. Please try again.",
  ms_parse_failed: "Sign-in completed but data was invalid. Please try again.",
};

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showVersion, setShowVersion] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [accessCodeDialogOpen, setAccessCodeDialogOpen] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [accessCodeError, setAccessCodeError] = useState("");
  const accessCodeInputRef = useRef<HTMLInputElement>(null);
  const [msEnabled, setMsEnabled] = useState(false);
  const [versionInfo, setVersionInfo] = useState({ version: "0.0.005", buildTime: "", buildNumber: "" });
  const [releaseNotes, setReleaseNotes] = useState<{ title: string; description: string }[]>([]);
  const [easterEggClicks, setEasterEggClicks] = useState(0);
  const [showEasterEgg, setShowEasterEgg] = useState(false);

  useEffect(() => {
    fetch("/api/version")
      .then((r) => r.json())
      .then((data) => {
        if (data.version) {
          const date = data.buildTime ? new Date(data.buildTime).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
          setVersionInfo({ version: data.version, buildTime: date, buildNumber: data.buildNumber || "" });
        }
        if (data.releaseNotes && Array.isArray(data.releaseNotes) && data.releaseNotes.length > 0) {
          setReleaseNotes(data.releaseNotes);
        }
      })
      .catch(() => {});

    fetch("/api/auth/microsoft/config")
      .then((r) => r.json())
      .then((data) => setMsEnabled(data.enabled))
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const msError = params.get("error");
    const msEmail = params.get("email");
    if (msError) {
      let msg = MS_ERROR_MESSAGES[msError] || "An error occurred during sign-in.";
      if (msError === "ms_no_account" && msEmail) {
        msg = `No account found for ${msEmail}. Contact your administrator to get access.`;
      }
      setError(msg);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setIsLoading(true);
    setError("");

    try {
      const success = await login(username.toLowerCase(), password);
      if (success) {
        setLocation("/");
      } else {
        setError("Invalid username or password. Only administrators can use password login.");
      }
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("restricted to administrators") || msg.includes("ADMIN_ONLY")) {
        setError("Password login is only available for administrators. Please use Microsoft 365 sign-in.");
      } else {
        setError("Connection error. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleMicrosoftLogin = () => {
    window.location.href = "/api/auth/microsoft";
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4" data-testid="page-login">
      <div className="w-full max-w-sm space-y-8 animate-float-in">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <img
              src="/emergent-logo.png"
              alt="Emergent Energy"
              className="h-12 object-contain"
              data-testid="img-logo"
            />
          </div>
          <p className="text-sm text-muted-foreground">Sign in to your account</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200" data-testid="text-login-error">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        <Card className="border border-border energy-glow-border">
          <CardContent className="p-6 space-y-4">
            {msEnabled ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 gap-3 text-sm font-medium border-border hover:bg-muted transition-all duration-300 hover:border-emerald-500/50 hover:shadow-sm"
                  onClick={handleMicrosoftLogin}
                  data-testid="button-ms-login"
                >
                  <svg className="h-5 w-5" viewBox="0 0 21 21" fill="none">
                    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                  </svg>
                  Sign in with Microsoft 365
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  Sign in using your company Microsoft account. Your email must match an existing account in the system.
                </p>

                {!showAdminLogin && (
                  <div className="pt-1">
                    <div className="relative my-2">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs">
                        <span className="bg-card px-2 text-muted-foreground">or</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAccessCode("");
                        setAccessCodeError("");
                        setAccessCodeDialogOpen(true);
                        setTimeout(() => accessCodeInputRef.current?.focus(), 100);
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground hover:text-emerald-600 transition-colors"
                      data-testid="button-toggle-admin"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Sign in with username & password
                    </button>
                  </div>
                )}

                {showAdminLogin && (
                  <>
                    <div className="relative my-2">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs">
                        <span className="bg-card px-2 text-muted-foreground">Admin Login</span>
                      </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            id="username"
                            type="text"
                            placeholder="Admin username"
                            value={username}
                            onChange={(e) => { setUsername(e.target.value); setError(""); }}
                            autoFocus
                            autoComplete="username"
                            disabled={isLoading}
                            className="pl-10"
                            data-testid="input-username"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            id="password"
                            type="password"
                            placeholder="Admin password"
                            value={password}
                            onChange={(e) => { setPassword(e.target.value); setError(""); }}
                            autoComplete="current-password"
                            disabled={isLoading}
                            className="pl-10"
                            data-testid="input-password"
                          />
                        </div>
                      </div>
                      <Button
                        type="submit"
                        className="w-full bg-[#16a34a] hover:bg-[#15803d] energy-button transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/20"
                        disabled={isLoading || !username || !password}
                        data-testid="button-login"
                      >
                        {isLoading ? "Signing in..." : "Admin Sign In"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setShowAdminLogin(false)}
                        className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                        data-testid="button-hide-admin"
                      >
                        Back to Microsoft sign-in
                      </button>
                    </form>
                  </>
                )}
              </>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="username"
                      type="text"
                      placeholder="Enter your username"
                      value={username}
                      onChange={(e) => { setUsername(e.target.value); setError(""); }}
                      autoFocus
                      autoComplete="username"
                      disabled={isLoading}
                      className="pl-10"
                      data-testid="input-username"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      autoComplete="current-password"
                      disabled={isLoading}
                      className="pl-10"
                      data-testid="input-password"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full bg-[#16a34a] hover:bg-[#15803d] energy-button transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/20"
                  disabled={isLoading || !username || !password}
                  data-testid="button-login"
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <div className="text-center">
          <button
            onClick={() => setShowVersion(true)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-[#16a34a] transition-colors cursor-pointer"
            data-testid="button-version-info"
          >
            <Info className="w-3.5 h-3.5" />
            v{versionInfo.version}{versionInfo.buildNumber ? ` (${versionInfo.buildNumber})` : ""} — The one where permissions stop taking up half your screen
          </button>
        </div>
      </div>

      <Dialog open={accessCodeDialogOpen} onOpenChange={(open) => { setAccessCodeDialogOpen(open); if (!open) { setAccessCode(""); setAccessCodeError(""); } }}>
        <DialogContent className="max-w-xs" aria-describedby="access-code-description">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Access Code Required
            </DialogTitle>
          </DialogHeader>
          <p id="access-code-description" className="text-sm text-muted-foreground">
            Enter the access code to use username and password login.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (accessCode === "2024") {
                setAccessCodeDialogOpen(false);
                setShowAdminLogin(true);
                setAccessCode("");
                setAccessCodeError("");
              } else {
                setAccessCodeError("Incorrect access code");
              }
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="access-code" className="text-xs">Access Code</Label>
              <Input
                ref={accessCodeInputRef}
                id="access-code"
                type="password"
                placeholder="Enter code"
                value={accessCode}
                onChange={(e) => { setAccessCode(e.target.value); setAccessCodeError(""); }}
                autoComplete="off"
                data-testid="input-access-code"
              />
              {accessCodeError && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {accessCodeError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setAccessCodeDialogOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                size="sm"
                className="bg-[#16a34a] hover:bg-[#15803d]"
                disabled={!accessCode}
                data-testid="button-submit-access-code"
              >
                Continue
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {showVersion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowVersion(false)}>
          <div
            className="bg-card rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="text-lg font-bold text-foreground">
                  Version {versionInfo.version} Release Notes
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {versionInfo.buildTime || "Latest"}{versionInfo.buildNumber ? ` · Build ${versionInfo.buildNumber}` : ""} — The official release. For real this time.
                </p>
              </div>
              <button
                onClick={() => setShowVersion(false)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                data-testid="button-close-version"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              {releaseNotes.length > 0 ? (
                releaseNotes.map((item, i) => {
                  const isEasterEgg = item.title.includes("Easter Egg");
                  return (
                    <div
                      key={i}
                      className={`flex gap-3 ${isEasterEgg ? "cursor-pointer hover:bg-amber-50 rounded-lg p-2 -m-2 transition-all" : ""}`}
                      data-testid={`version-item-${i}`}
                      onClick={isEasterEgg ? () => {
                        const next = easterEggClicks + 1;
                        setEasterEggClicks(next);
                        if (next >= 7) setShowEasterEgg(true);
                      } : undefined}
                    >
                      <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5 ${isEasterEgg ? "bg-amber-50" : "bg-emerald-50"}`}>
                        <Zap className={`w-3.5 h-3.5 ${isEasterEgg ? "text-amber-600" : "text-emerald-600"}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                        {item.description && (
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.description}</p>
                        )}
                        {isEasterEgg && easterEggClicks > 0 && easterEggClicks < 7 && (
                          <p className="text-[10px] text-amber-600 mt-1">{7 - easterEggClicks} more click{7 - easterEggClicks !== 1 ? "s" : ""}...</p>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No release notes available yet.</p>
              )}
              {showEasterEgg && (
                <div className="mt-4 p-4 bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-amber-500/10 rounded-xl border border-amber-200 text-center animate-pulse" data-testid="easter-egg-reveal">
                  <p className="text-2xl mb-2">⚡🎉⚡</p>
                  <p className="text-sm font-bold text-emerald-600">You found The First Electron!</p>
                  <p className="text-xs text-muted-foreground mt-1">You are now officially part of the Emergent Energy story.</p>
                  <p className="text-xs text-muted-foreground mt-1">V1.2 — Eight new features. Zero new databases. One increasingly philosophical easter egg.</p>
                  <p className="text-[10px] text-amber-600 mt-2 italic">Achievement Unlocked: Curious Clicker 🏆</p>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-border bg-muted/30">
              <p className="text-[10px] text-muted-foreground text-center italic">
                V1.2 — Dependencies, RAID logs, Change Control, Procurement, Commissioning. Eight features, zero excuses.
                Still powered by electrons. Now managing entire project lifecycles with unreasonable thoroughness. ⚡
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
