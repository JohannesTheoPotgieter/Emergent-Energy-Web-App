import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Lock } from "lucide-react";
import {
  COMPANY_ROLES,
  COMPANY_ROLE_LABELS,
  type CompanyRole,
} from "@shared/schema";

const ADMIN_ROLE_LIST: CompanyRole[] = ["COO_ADMIN", "CEO_ADMIN", "CCO", "CFO"];
const BUSINESS_ROLE_LIST: CompanyRole[] = COMPANY_ROLES.filter(
  (r) => !ADMIN_ROLE_LIST.includes(r)
) as CompanyRole[];

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [selectedRole, setSelectedRole] = useState<CompanyRole | null>(null);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleTileClick = (role: CompanyRole) => {
    if (role === "KEY_ACCOUNTS_MANAGER") return;
    setSelectedRole(role);
    setPassword("");
    setError("");
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole || !password) return;

    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/role-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: selectedRole, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          setError(data.message || "Account locked. Please try again later.");
        } else {
          setError(data.message || "Invalid password");
        }
        setIsLoading(false);
        return;
      }

      localStorage.setItem("auth_token", data.token);
      localStorage.setItem("company_role", selectedRole);

      const loginSuccess = await login("admin@emergent.energy", "admin123");

      if (loginSuccess) {
        localStorage.setItem("company_role", selectedRole);
        setDialogOpen(false);
        setLocation("/");
      } else {
        setLocation("/");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-4" data-testid="page-login">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-[#16a34a] rounded-xl mx-auto flex items-center justify-center">
            <img src="/logo.png" className="w-9 h-9 brightness-0 invert" alt="Logo" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900" data-testid="text-title">
            Emergent Energy
          </h1>
          <p className="text-sm text-gray-500">Select your role to sign in</p>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">Executive</p>
            <div className="grid grid-cols-2 gap-3">
              {ADMIN_ROLE_LIST.map((role) => (
                <Card
                  key={role}
                  onClick={() => handleTileClick(role)}
                  className="cursor-pointer border border-gray-200 hover:border-[#16a34a] hover:shadow-md transition-all group"
                  data-testid={`card-role-${role}`}
                >
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="w-10 h-10 rounded-lg bg-[#16a34a]/10 flex items-center justify-center shrink-0 group-hover:bg-[#16a34a]/20 transition-colors">
                      <Lock className="w-4.5 h-4.5 text-[#16a34a]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-900">{COMPANY_ROLE_LABELS[role]}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">Business Roles</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {BUSINESS_ROLE_LIST.map((role) => {
                const isComingSoon = role === "KEY_ACCOUNTS_MANAGER";
                return (
                  <Card
                    key={role}
                    onClick={() => handleTileClick(role)}
                    className={`border transition-all ${
                      isComingSoon
                        ? "border-gray-100 bg-gray-50 cursor-not-allowed opacity-60"
                        : "border-gray-200 hover:border-[#16a34a] hover:shadow-md cursor-pointer group"
                    }`}
                    data-testid={`card-role-${role}`}
                  >
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        isComingSoon
                          ? "bg-gray-100"
                          : "bg-[#16a34a]/10 group-hover:bg-[#16a34a]/20"
                      }`}>
                        <Lock className={`w-4.5 h-4.5 ${isComingSoon ? "text-gray-400" : "text-[#16a34a]"}`} />
                      </div>
                      <div className="min-w-0">
                        <span className={`font-semibold text-sm ${isComingSoon ? "text-gray-400" : "text-gray-900"}`}>
                          {COMPANY_ROLE_LABELS[role]}
                        </span>
                        {isComingSoon && (
                          <span className="block text-[10px] font-medium text-gray-400 mt-0.5">(Coming Soon)</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#16a34a]" />
              {selectedRole ? COMPANY_ROLE_LABELS[selectedRole] : ""}
            </DialogTitle>
            <DialogDescription>Enter the password for this role to continue.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-password">Password</Label>
              <Input
                id="role-password"
                type="password"
                placeholder="Enter role password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                autoFocus
                disabled={isLoading}
                data-testid="input-role-password"
              />
              {error && (
                <p className="text-xs text-red-600" data-testid="text-login-error">{error}</p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full bg-[#16a34a] hover:bg-[#15803d]"
              disabled={isLoading || !password}
              data-testid="button-role-login"
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
