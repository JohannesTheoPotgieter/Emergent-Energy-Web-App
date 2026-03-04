import { useEffect } from "react";
import { useLocation } from "wouter";
import { setAuthToken } from "@/lib/api";
import { Loader2 } from "lucide-react";

export default function MsCallbackPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const userStr = params.get("user");

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        setAuthToken(token);
        localStorage.setItem("company_role", user.role);
        window.location.href = "/";
      } catch {
        setLocation("/auth/login?error=ms_parse_failed");
      }
    } else {
      setLocation("/auth/login?error=ms_auth_failed");
    }
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
