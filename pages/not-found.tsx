import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 energy-card">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="mb-6">
            <svg width="80" height="80" viewBox="0 0 80 80" className="mx-auto">
              <rect x="20" y="30" width="40" height="24" rx="3" fill="#1e3a5f" opacity="0.3" transform="rotate(-10 40 42)" />
              <line x1="28" y1="36" x2="52" y2="36" stroke="#3b82f6" strokeWidth="0.5" opacity="0.2" transform="rotate(-10 40 42)" />
              <line x1="40" y1="28" x2="40" y2="52" stroke="#3b82f6" strokeWidth="0.5" opacity="0.2" transform="rotate(-10 40 42)" />
              <rect x="38" y="50" width="4" height="10" rx="1" fill="#94a3b8" opacity="0.3" />
              <circle cx="56" cy="20" r="8" fill="#fbbf24" opacity="0.15" />
              <line x1="56" y1="12" x2="56" y2="8" stroke="#fbbf24" strokeWidth="1.5" opacity="0.2" />
              <line x1="56" y1="28" x2="56" y2="32" stroke="#fbbf24" strokeWidth="1.5" opacity="0.2" />
              <line x1="48" y1="20" x2="44" y2="20" stroke="#fbbf24" strokeWidth="1.5" opacity="0.2" />
              <line x1="64" y1="20" x2="68" y2="20" stroke="#fbbf24" strokeWidth="1.5" opacity="0.2" />
              <text x="40" y="74" textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="Inter, sans-serif">404</text>
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-foreground mb-2">Off the grid</h1>
          <p className="text-sm text-muted-foreground mb-6">
            This page hasn't been connected yet. Let's get you back to base.
          </p>
          <Button
            onClick={() => navigate("/")}
            className="energy-button"
            data-testid="button-go-home"
          >
            Back to Dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
