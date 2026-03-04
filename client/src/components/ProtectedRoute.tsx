import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { EnergyLoader } from "@/components/ui/energy-loader";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <EnergyLoader size="lg" label="Loading Emergent Energy Dashboard..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/auth/login" />;
  }

  return <>{children}</>;
}
