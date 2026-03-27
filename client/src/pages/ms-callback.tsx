import { useEffect } from "react";
import { useLocation } from "wouter";
import { setAuthToken } from "@/lib/api";
import { Loader2 } from "lucide-react";

export default function MsCallbackPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (!code) {
      setLocation("/auth/login?error=ms_auth_failed");
      return;
    }

    fetch("/api/auth/exchange-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("exchange failed");
        const data = await res.json();
        setAuthToken(data.token);
        localStorage.setItem("company_role", data.user.role);
        window.location.href = "/";
      })
      .catch(() => {
        setLocation("/auth/login?error=ms_auth_failed");
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-card" data-testid="page-ms-callback">
      <div className="text-center space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" />
        <p className="text-sm text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}
