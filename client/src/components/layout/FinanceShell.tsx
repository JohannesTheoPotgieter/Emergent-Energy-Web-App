import { Link, useLocation } from "wouter";
import { DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

export type FinancePageId =
  | "cashflow"
  | "cos"
  | "revenue-tracker"
  | "gp-tracker"
  | "fye-revenue-tracking"
  | "counterparties"
  | "invoice-patterns"
  | "procurement"
  | "subcontractor-dashboard";

interface FinanceNavItem {
  id: FinancePageId;
  label: string;
  path: string;
}

const PRIMARY_PAGES: FinanceNavItem[] = [
  { id: "cashflow", label: "Cashflow", path: "/cashflow" },
  { id: "cos", label: "COS", path: "/cos" },
  { id: "revenue-tracker", label: "Revenue", path: "/revenue-tracker" },
  { id: "gp-tracker", label: "GP Tracker", path: "/gp-tracker" },
  { id: "fye-revenue-tracking", label: "FYE Revenue", path: "/fye-revenue-tracking" },
];

const SECONDARY_PAGES: FinanceNavItem[] = [
  { id: "counterparties", label: "Counterparties", path: "/counterparties" },
  { id: "invoice-patterns", label: "Invoice Patterns", path: "/invoice-patterns" },
  { id: "procurement", label: "Procurement Hub", path: "/procurement" },
  { id: "subcontractor-dashboard", label: "Subcontractors", path: "/subcontractor-dashboard" },
];

interface FinanceShellProps {
  currentPage: FinancePageId;
  children: React.ReactNode;
}

export function FinanceShell({ currentPage, children }: FinanceShellProps) {
  const [location] = useLocation();

  return (
    <div className="ee-page page-enter pb-8">
      {/* Finance area header */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
          <DollarSign className="w-4.5 h-4.5 text-emerald-600" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Finance</h1>
      </div>

      {/* Sub-navigation pills */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-3 mb-4 border-b border-border/40">
        {PRIMARY_PAGES.map((page) => (
          <Link key={page.id} href={page.path}>
            <span
              className={cn(
                "inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer",
                currentPage === page.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {page.label}
            </span>
          </Link>
        ))}

        {/* Visual separator between primary and secondary */}
        <div className="h-4 border-l border-border/50 mx-1 shrink-0" />

        {SECONDARY_PAGES.map((page) => (
          <Link key={page.id} href={page.path}>
            <span
              className={cn(
                "inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer",
                currentPage === page.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {page.label}
            </span>
          </Link>
        ))}
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
