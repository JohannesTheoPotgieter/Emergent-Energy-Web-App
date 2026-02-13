import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  FileSpreadsheet, 
  Wallet, 
  TrendingUp, 
  Settings,
  LogOut,
  Menu,
  Search,
  Database,
  Home,
  Target,
  BarChart3,
  Kanban,
  AlertTriangle,
  X,
} from "lucide-react";
import { useProgramData } from "@/hooks/use-program-data";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { DatabaseStatusBanner } from "@/components/DatabaseStatusBanner";
import { UploadValidationReport } from "@/components/UploadValidationReport";

interface NavGroup {
  heading: string;
  items: { label: string; icon: any; path: string; className?: string }[];
}

const navGroups: NavGroup[] = [
  {
    heading: "CURRENT",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
      { label: "Project Summary", icon: FileSpreadsheet, path: "/projects" },
      { label: "Cashflow", icon: Wallet, path: "/cashflow" },
      { label: "COS Tracker", icon: TrendingUp, path: "/cos", className: "rotate-180" },
    ],
  },
  {
    heading: "WIP",
    items: [
      { label: "COS Control", icon: Target, path: "/cos-control" },
      { label: "Forecast", icon: BarChart3, path: "/cashflow-forecast" },
      { label: "Planning", icon: Kanban, path: "/planning" },
      { label: "Risks & Flags", icon: AlertTriangle, path: "/risks-flags" },
    ],
  },
  {
    heading: "ADMIN",
    items: [
      { label: "Admin", icon: Settings, path: "/admin" },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [showValidationReport, setShowValidationReport] = useState(false);
  const { data, overview, refreshData, isLoading, importFiles, lastUploadResult } = useProgramData();
  const { user, logout } = useAuth();
  const { data: healthStatus } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await fetch("/api/health");
      return response.json();
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const allItems = navGroups.flatMap(g => g.items);
  const currentPageLabel = location === "/" 
    ? "Home" 
    : allItems.find(i => i.path === location)?.label || "Dashboard";

  const sidebarShowLabels = mobileOpen || !desktopCollapsed;

  const sidebarContent = (
    <>
      <div className="h-14 md:h-16 flex items-center px-4 border-b border-sidebar-border bg-sidebar/50 backdrop-blur-sm">
        <Link href="/" className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded bg-sidebar-primary flex items-center justify-center shrink-0">
            <img src="/logo.png" className="w-6 h-6 object-contain brightness-0 invert" alt="Logo" />
          </div>
          {sidebarShowLabels && <span className="font-heading font-bold text-lg tracking-wide whitespace-nowrap">EMERGENT</span>}
        </Link>
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto md:hidden p-1.5 rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        <Link href="/" className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 group",
          location === "/" 
            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-md" 
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}>
          <Home className="w-5 h-5 shrink-0" />
          {sidebarShowLabels && <span>Home</span>}
        </Link>

        {navGroups.filter(group => (group.heading !== "ADMIN" && group.heading !== "WIP") || user?.role === "admin").map((group) => (
          <div key={group.heading} className="pt-4">
            {sidebarShowLabels && (
              <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40">
                {group.heading}
              </p>
            )}
            {!sidebarShowLabels && <div className="h-px bg-sidebar-border mx-2 mb-1" />}
            {group.items.map((item) => (
              <Link key={item.path} href={item.path} className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 group",
                location === item.path 
                  ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-md" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}>
                <item.icon className={cn("w-5 h-5 shrink-0", item.className)} />
                {sidebarShowLabels && <span>{item.label}</span>}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="p-3 md:p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9 border border-sidebar-border/50 shrink-0">
            <AvatarFallback>{user?.name.substring(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          {sidebarShowLabels && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <span className={cn(
                  "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0",
                  user?.role === "admin" 
                    ? "bg-amber-500/20 text-amber-300" 
                    : "bg-blue-500/20 text-blue-300"
                )}>
                  {user?.role === "admin" ? "Admin" : "Viewer"}
                </span>
              </div>
              <p className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</p>
            </div>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-sidebar-foreground/50 hover:text-white shrink-0"
            onClick={logout}
            title="Log out"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border shadow-xl transition-transform duration-300 ease-in-out w-64 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>

      <aside 
        className={cn(
          "hidden md:flex bg-sidebar text-sidebar-foreground flex-col transition-all duration-300 border-r border-sidebar-border shadow-xl z-20",
          desktopCollapsed ? "w-20" : "w-64"
        )}
      >
        {sidebarContent}
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-background/50">
        <header className="h-14 md:h-16 border-b bg-background flex items-center justify-between px-3 md:px-6 sticky top-0 z-10">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setMobileOpen(true)}
              className="md:hidden shrink-0"
              data-testid="btn-mobile-menu"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setDesktopCollapsed(!desktopCollapsed)}
              className="hidden md:inline-flex shrink-0"
              data-testid="btn-desktop-sidebar-toggle"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <h1 className="text-base md:text-xl font-heading font-semibold text-foreground truncate">
              {currentPageLabel}
            </h1>
          </div>

          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <div className="relative hidden lg:block w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search projects..." className="pl-9 h-9 bg-muted/30 border-none focus-visible:ring-1" />
            </div>
            
            <div className="h-8 w-px bg-border mx-1 hidden sm:block" />

            <div className="hidden sm:flex flex-col items-end mr-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">DB</span>
              <div className="flex items-center gap-1">
                <Database className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-mono font-medium text-foreground">
                  {healthStatus?.dbMode === 'postgres' ? 'PG' : healthStatus?.dbMode === 'sqlite' ? 'SQLite' : '?'}
                </span>
              </div>
            </div>

            <div className="h-8 w-px bg-border mx-1 hidden lg:block" />

            <div className="flex-col items-end mr-1 hidden lg:flex">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Data As Of</span>
              <span className="text-xs font-mono font-medium text-foreground">
                {overview?.data_as_of ? format(new Date(overview.data_as_of), "dd MMM HH:mm") : "No data"}
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 scroll-smooth">
          <div className="max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
            <DatabaseStatusBanner />
            {showValidationReport && lastUploadResult && (
              <UploadValidationReport 
                result={lastUploadResult} 
                onDismiss={() => setShowValidationReport(false)}
              />
            )}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
