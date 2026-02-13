import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Lock, Shield, Eye } from "lucide-react";

const accounts = [
  { label: "Admin", description: "Full access — edit, upload, manage", email: "admin@emergent.energy", password: "admin123", icon: Shield, color: "bg-amber-500/10 border-amber-500/30 text-amber-700 hover:bg-amber-500/20" },
  { label: "Viewer", description: "View-only — dashboards and reports", email: "viewer@emergent.energy", password: "viewer123", icon: Eye, color: "bg-blue-500/10 border-blue-500/30 text-blue-700 hover:bg-blue-500/20" },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    const success = await login(email, password);
    setIsLoading(false);
    
    if (success) {
      setLocation("/");
    }
  };

  const quickLogin = (account: typeof accounts[0]) => {
    setEmail(account.email);
    setPassword(account.password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
      <Card className="w-full max-w-md shadow-2xl" data-testid="card-login">
        <CardHeader className="space-y-1 text-center">
           <div className="w-12 h-12 bg-primary rounded-lg mx-auto flex items-center justify-center mb-4">
              <img src="/logo.png" className="w-8 h-8 brightness-0 invert" alt="Logo" />
           </div>
          <CardTitle className="text-2xl font-bold font-heading">Emergent Energy</CardTitle>
          <CardDescription>Program Dashboard Access</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Quick Login</p>
            <div className="grid grid-cols-2 gap-2">
              {accounts.map((acc) => (
                <button
                  key={acc.label}
                  type="button"
                  onClick={() => quickLogin(acc)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-center transition-all ${acc.color} ${email === acc.email ? "ring-2 ring-offset-1 ring-primary" : ""}`}
                  data-testid={`button-quick-login-${acc.label.toLowerCase()}`}
                >
                  <acc.icon className="w-5 h-5" />
                  <span className="text-sm font-semibold">{acc.label}</span>
                  <span className="text-[10px] opacity-70 leading-tight">{acc.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or enter credentials</span></div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="user@emergent.energy" 
                required 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input 
                id="password" 
                type="password" 
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                data-testid="input-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading || !email || !password} data-testid="button-login">
              <Lock className="w-4 h-4 mr-2" />
              {isLoading ? "Logging in..." : "Secure Login"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
