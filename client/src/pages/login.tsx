import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, User, Info, X, Sparkles, Shield, BookOpen, Bug } from "lucide-react";

const VERSION = "0.001";
const VERSION_DATE = "26 Feb 2026";

const CHANGELOG = [
  {
    icon: Shield,
    title: "We Now Remember What You Did",
    description: "Every single edit you make — plan changes, revenue tweaks, expense overrides, font colour toggles — is now permanently recorded in the audit trail. Yes, we're watching. No, you can't hide. Your future self will thank us when someone asks 'who changed that number?'",
  },
  {
    icon: Sparkles,
    title: "Smart Import Got Smarter (Finally)",
    description: "Manually added expense rows now survive re-imports. We taught Smart Import not to eat your hand-crafted data like a hungry Pac-Man. Your custom lines are safe. You're welcome.",
  },
  {
    icon: BookOpen,
    title: "37 Walkthroughs. Thirty. Seven.",
    description: "We wrote step-by-step guides for literally everything in this app. COS tracking, cashflow, engineering stages, weekly reviews, admin tools — the whole lot. If you still can't find something, that's a you problem now.",
  },
  {
    icon: Bug,
    title: "The Knowledge Base Actually Has Knowledge",
    description: "EE Info now has real content about COS rules, cashflow logic, revenue recognition, Smart Import, and permission controls. The stubs are gone. The excuses are gone. Read it before you Slack someone.",
  },
  {
    icon: Sparkles,
    title: "Role-Based Home Greetings",
    description: "The home page now greets you based on your role. 50% chance it's a compliment, 50% chance it roasts you. On Fridays you get dad jokes instead because apparently that's what peak productivity looks like.",
  },
  {
    icon: Shield,
    title: "Font Colour Toggles Are Tracked",
    description: "Toggling invoice/payment date colours between black and red now logs who did it, when, and what it was before. COS status changes, realisation toggles — all tracked. Accountability has entered the chat.",
  },
];

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showVersion, setShowVersion] = useState(false);

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

        <Card className="border border-gray-200">
          <CardContent className="p-6">
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
              {error && (
                <p className="text-xs text-red-600" data-testid="text-login-error">{error}</p>
              )}
              <Button
                type="submit"
                className="w-full bg-[#16a34a] hover:bg-[#15803d]"
                disabled={isLoading || !username || !password}
                data-testid="button-login"
              >
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center">
          <button
            onClick={() => setShowVersion(true)}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#16a34a] transition-colors cursor-pointer"
            data-testid="button-version-info"
          >
            <Info className="w-3.5 h-3.5" />
            v{VERSION} — What broke this time?
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
                  Version {VERSION} Release Notes
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {VERSION_DATE} — Another round of "improvements" nobody asked for
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

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              {CHANGELOG.map((item, i) => (
                <div key={i} className="flex gap-3" data-testid={`version-item-${i}`}>
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center mt-0.5">
                    <item.icon className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
              <p className="text-[10px] text-gray-400 text-center italic">
                Crafted with caffeine, questionable life choices, and an alarming amount of TypeScript.
                If something looks wrong, clear your cache. If it still looks wrong, it's a feature.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
