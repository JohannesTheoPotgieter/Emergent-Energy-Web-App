import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [, setLocation] = useLocation();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      // Mock login - just redirect
      setLocation("/");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="space-y-1 text-center">
           <div className="w-12 h-12 bg-primary rounded-lg mx-auto flex items-center justify-center mb-4">
              <img src="/src/assets/logo.png" className="w-8 h-8 brightness-0 invert" alt="Logo" />
           </div>
          <CardTitle className="text-2xl font-bold font-heading">Emergent Energy</CardTitle>
          <CardDescription>Program Dashboard Access</CardDescription>
        </CardHeader>
        <CardContent>
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required />
            </div>
            <Button type="submit" className="w-full">
              <Lock className="w-4 h-4 mr-2" />
              Secure Login
            </Button>
            <div className="text-center text-xs text-muted-foreground mt-4">
              Restricted Access. Authorized Personnel Only.
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
