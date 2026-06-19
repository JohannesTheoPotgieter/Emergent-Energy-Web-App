import { LogOut, Lock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

/**
 * Branded "no access" landing shown to any role outside the finance-module
 * allowlist (see shared/config/enabled-modules.ts → LIVE_READY_ROLE_ALLOWLIST).
 *
 * Rendered standalone — NOT inside AppLayout / LensProvider — so it shows no
 * navigation and fires no data calls for users who aren't permitted in.
 */
export function FinanceModuleNoAccess() {
  const { logout } = useAuth();

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/40 p-4"
      data-testid="live-ready-no-access"
    >
      <div className="w-full max-w-[420px] space-y-6 text-center">
        <div className="flex justify-center">
          <img src="/emergent-logo.png" alt="Emergent Energy" className="h-10 object-contain" />
        </div>

        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
          <Lock className="h-8 w-8 text-emerald-600" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            This area is being updated
          </h1>
          <p className="text-sm text-muted-foreground">
            You don't currently have access. The workspace is running in finance mode
            while we update other modules. If you believe you need access, contact your
            administrator.
          </p>
        </div>

        <Button
          variant="outline"
          className="gap-2"
          onClick={() => logout()}
          data-testid="button-no-access-logout"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default FinanceModuleNoAccess;
