import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, User, Info, X, Zap, AlertCircle } from "lucide-react";

const MS_ERROR_MESSAGES: Record<string, string> = {
  ms_auth_failed: "Microsoft sign-in failed. Please try again.",
  ms_auth_denied: "Microsoft sign-in was cancelled or denied.",
  ms_profile_failed: "Could not retrieve your Microsoft profile.",
  ms_no_email: "No email address found on your Microsoft account.",
  ms_no_account: "No matching account found. Contact your administrator.",
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
  const [showManualLogin, setShowManualLogin] = useState(false);
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
        setError("Invalid username or password");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMicrosoftLogin = () => {
    window.location.href = "/api/auth/microsoft";
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-4" data-testid="page-login">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-[#16a34a] rounded-xl mx-auto flex items-center justify-center">
            <img src="/logo.png" className="w-9 h-9 brightness-0 invert" alt="Logo" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900" data-testid="text-title">
            Emergent Energy
          </h1>
          <p className="text-sm text-gray-500">Sign in to your account</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200" data-testid="text-login-error">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <Card className="border border-gray-200">
          <CardContent className="p-6 space-y-4">
            {msEnabled && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 gap-3 text-sm font-medium border-gray-300 hover:bg-gray-50"
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

                {!showManualLogin && (
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setShowManualLogin(true)}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      data-testid="button-show-manual-login"
                    >
                      Use username & password instead
                    </button>
                  </div>
                )}

                {showManualLogin && (
                  <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-gray-200" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-white px-2 text-gray-400">or</span>
                    </div>
                  </div>
                )}
              </>
            )}

            {(!msEnabled || showManualLogin) && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
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
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
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
                  className="w-full bg-[#16a34a] hover:bg-[#15803d]"
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
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#16a34a] transition-colors cursor-pointer"
            data-testid="button-version-info"
          >
            <Info className="w-3.5 h-3.5" />
            v{versionInfo.version}{versionInfo.buildNumber ? ` (${versionInfo.buildNumber})` : ""} — The one that actually works
          </button>
        </div>
      </div>

      {showVersion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowVersion(false)}>
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Version {versionInfo.version} Release Notes
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {versionInfo.buildTime || "Latest"}{versionInfo.buildNumber ? ` · Build ${versionInfo.buildNumber}` : ""} — The official release. For real this time.
                </p>
              </div>
              <button
                onClick={() => setShowVersion(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
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
                        <Zap className={`w-3.5 h-3.5 ${isEasterEgg ? "text-amber-500" : "text-emerald-600"}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
                        {item.description && (
                          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{item.description}</p>
                        )}
                        {isEasterEgg && easterEggClicks > 0 && easterEggClicks < 7 && (
                          <p className="text-[10px] text-amber-400 mt-1">{7 - easterEggClicks} more click{7 - easterEggClicks !== 1 ? "s" : ""}...</p>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">No release notes available yet.</p>
              )}
              {showEasterEgg && (
                <div className="mt-4 p-4 bg-gradient-to-r from-amber-50 via-emerald-50 to-amber-50 rounded-xl border border-amber-200 text-center animate-pulse" data-testid="easter-egg-reveal">
                  <p className="text-2xl mb-2">⚡🎉⚡</p>
                  <p className="text-sm font-bold text-emerald-700">You found The First Electron!</p>
                  <p className="text-xs text-gray-600 mt-1">You are now officially part of the Emergent Energy story.</p>
                  <p className="text-xs text-gray-500 mt-1">V1.0 — Built by humans, powered by electrons, deployed with courage.</p>
                  <p className="text-[10px] text-amber-500 mt-2 italic">Achievement Unlocked: Curious Clicker 🏆</p>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
              <p className="text-[10px] text-gray-400 text-center italic">
                V1.0 — Crafted with caffeine, questionable life choices, and an alarming amount of TypeScript.
                Built to power the future of renewable energy. Here's to the electrons that got us here. ⚡
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
