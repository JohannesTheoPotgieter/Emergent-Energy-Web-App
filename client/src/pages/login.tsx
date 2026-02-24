import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, User } from "lucide-react";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

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
      </div>
    </div>
  );
}
