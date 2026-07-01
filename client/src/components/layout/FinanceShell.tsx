import { DollarSign } from "lucide-react";

interface FinanceShellProps {
  children: React.ReactNode;
}

export function FinanceShell({ children }: FinanceShellProps) {
  return (
    <div className="ee-page page-enter pb-6 lg:pb-8">
      {/*
        Finance area eyebrow. Intentionally NOT an <h1> — each finance page
        renders its own single <h1> via FinancePageHeader/SectionHeader, so
        this stays a small area label to avoid two stacked page headings.
        (The global role-aware finance sub-nav is rendered by AppLayout.)
      */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center dark:bg-emerald-500/15">
          <DollarSign className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Finance</span>
      </div>

      {children}
    </div>
  );
}
