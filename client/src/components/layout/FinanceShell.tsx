import { DollarSign } from "lucide-react";

interface FinanceShellProps {
  children: React.ReactNode;
}

export function FinanceShell({ children }: FinanceShellProps) {
  return (
    <div className="ee-page page-enter pb-6 lg:pb-8">
      {/* Finance area header (global role-aware finance sub-nav is rendered by AppLayout) */}
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
          <DollarSign className="w-4.5 h-4.5 text-emerald-600" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Finance</h1>
      </div>

      {children}
    </div>
  );
}
