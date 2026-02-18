import { useState, useEffect } from "react";
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
  Home,
  Target,
  BarChart3,
  Kanban,
  AlertTriangle,
  X,
  Briefcase,
  ShieldCheck,
  Wrench,
  Users,
  FileBarChart,
  History,
  ListTodo,
  Package,
  ChevronDown,
  Cloud,
  BookOpen,
  Camera,
  Database,
  Upload,
} from "lucide-react";
import { useProgramData } from "@/hooks/use-program-data";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { UploadValidationReport } from "@/components/UploadValidationReport";
import { NotificationBell } from "@/components/NotificationBell";

interface NavItem {
  label: string;
  icon: any;
  path: string;
  className?: string;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
  collapsible?: boolean;
}

const navGroups: NavGroup[] = [
  {
    heading: "",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
      { label: "Projects", icon: FileSpreadsheet, path: "/projects" },
    ],
  },
  {
    heading: "FINANCE",
    items: [
      { label: "Cashflow", icon: Wallet, path: "/cashflow" },
      { label: "COS Tracker", icon: TrendingUp, path: "/cos", className: "rotate-180" },
      { label: "COS Control", icon: Target, path: "/cos-control" },
      { label: "Forecast", icon: BarChart3, path: "/cashflow-forecast" },
    ],
  },
  {
    heading: "ENGINEERING",
    items: [
      { label: "Eng Dashboard", icon: Wrench, path: "/engineering" },
      { label: "Task Board", icon: ListTodo, path: "/engineering/tasks" },
      { label: "Deliverables", icon: Package, path: "/engineering/deliverables" },
    ],
  },
  {
    heading: "PLANNING",
    items: [
      { label: "Planning Board", icon: Kanban, path: "/planning" },
      { label: "Risks & Flags", icon: AlertTriangle, path: "/risks-flags" },
      { label: "Quality", icon: ShieldCheck, path: "/quality" },
    ],
  },
  {
    heading: "TOOLS",
    items: [
      { label: "My Tool", icon: Briefcase, path: "/my-tool" },
    ],
  },
  {
    heading: "ADMIN",
    collapsible: true,
    items: [
      { label: "Data Import", icon: Upload, path: "/admin" },
      { label: "Reports", icon: FileBarChart, path: "/admin/reports" },
      { label: "Audit Log", icon: History, path: "/admin/audit-log" },
      { label: "Teams & Roles", icon: Users, path: "/admin/teams" },
      { label: "SP Settings", icon: Cloud, path: "/admin/sp-settings" },
      { label: "File Refresh", icon: FileSpreadsheet, path: "/admin/sp-file-refresh" },
      { label: "Import Runs", icon: Database, path: "/admin/sp-import-runs" },
      { label: "Change Ledger", icon: BookOpen, path: "/admin/sp-ledger" },
      { label: "Snapshots", icon: Camera, path: "/admin/sp-snapshots" },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [showValidationReport, setShowValidationReport] = useState(false);
  const { data, overview, refreshData, isLoading, importFiles, lastUploadResult } = useProgramData();
  const { user, logout } = useAuth();

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

  useEffect(() => {
    if (location.startsWith("/admin")) setAdminExpanded(true);
  }, [location]);

  const allItems = navGroups.flatMap(g => g.items);
  const currentPageLabel = location === "/" 
    ? "Home" 
    : location.startsWith("/my-tool") 
      ? "My Tool" 
      : allItems.find(i => i.path === location)?.label || "Dashboard";

  const sidebarShowLabels = mobileOpen || !desktopCollapsed;

  const filteredGroups = navGroups.filter(group => {
    const role = user?.role;
    if (role === "quality_manager") {
      return ["", "PLANNING"].includes(group.heading);
    }
    if (role === "eng_program_manager") {
      return ["", "ENGINEERING", "PLANNING"].includes(group.heading);
    }
    if (role === "admin") return true;
    return ["", "FINANCE"].includes(group.heading);
  }).map(group => {
    let visibleItems = group.items;
    if (user?.role === "quality_manager") {
      if (group.heading === "") visibleItems = group.items.filter(i => i.path === "/projects");
      if (group.heading === "PLANNING") visibleItems = group.items.filter(i => i.path === "/quality");
    }
    if (user?.role === "eng_program_manager" && group.heading === "") {
      visibleItems = group.items.filter(i => i.path === "/projects");
    }
    return { ...group, items: visibleItems };
  }).filter(g => g.items.length > 0);

  const sidebarContent = (
    <>
      <div className="h-14 flex items-center px-4 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-sidebar-primary flex items-center justify-center shrink-0">
            <img src="/logo.png" className="w-5 h-5 object-contain brightness-0 invert" alt="Logo" />
          </div>
          {sidebarShowLabels && <span className="font-heading font-bold text-base tracking-wide whitespace-nowrap">EMERGENT</span>}
        </Link>
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto md:hidden p-1.5 rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        <Link href="/" className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
          location === "/" 
            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" 
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}>
          <Home className="w-4 h-4 shrink-0" />
          {sidebarShowLabels && <span>Home</span>}
        </Link>

        {filteredGroups.map((group) => (
          <div key={group.heading || "_top"} className={group.heading ? "pt-4" : "pt-1"}>
            {group.heading && sidebarShowLabels && (
              group.collapsible ? (
                <button
                  onClick={() => setAdminExpanded(!adminExpanded)}
                  className="w-full flex items-center justify-between px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40 hover:text-sidebar-foreground/60 transition-colors"
                >
                  <span>{group.heading}</span>
                  <ChevronDown className={cn("w-3 h-3 transition-transform", adminExpanded && "rotate-180")} />
                </button>
              ) : (
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40">
                  {group.heading}
                </p>
              )
            )}
            {!sidebarShowLabels && group.heading && <div className="h-px bg-sidebar-border mx-2 mb-1" />}
            {(group.collapsible ? adminExpanded : true) && group.items.map((item) => {
              const isActive = location === item.path || (item.path === "/my-tool" && location.startsWith("/my-tool")) || (item.path !== "/" && item.path !== "/engineering" && location.startsWith(item.path));
              return (
                <Link key={item.path} href={item.path} className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive 
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}>
                  <item.icon className={cn("w-4 h-4 shrink-0", item.className)} />
                  {sidebarShowLabels && <span>{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <Avatar className="w-8 h-8 shrink-0">
            <AvatarFallback className="text-xs">{user?.name.substring(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          {sidebarShowLabels && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <span className={cn(
                  "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0",
                  user?.role === "admin" 
                    ? "bg-amber-500/20 text-amber-300" 
                    : user?.role === "quality_manager"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : user?.role === "eng_program_manager"
                    ? "bg-orange-500/20 text-orange-300"
                    : "bg-blue-500/20 text-blue-300"
                )}>
                  {user?.role === "admin" ? "Admin" : user?.role === "quality_manager" ? "QM" : user?.role === "eng_program_manager" ? "EPM" : "Viewer"}
                </span>
              </div>
              <p className="text-[11px] text-sidebar-foreground/50 truncate">{user?.email}</p>
            </div>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7 text-sidebar-foreground/50 hover:text-white shrink-0"
            onClick={logout}
            title="Log out"
          >
            <LogOut className="w-3.5 h-3.5" />
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
          "fixed inset-y-0 left-0 z-50 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border transition-transform duration-300 ease-in-out w-56 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>

      <aside 
        className={cn(
          "hidden md:flex bg-sidebar text-sidebar-foreground flex-col transition-all duration-300 border-r border-sidebar-border z-20",
          desktopCollapsed ? "w-16" : "w-56"
        )}
      >
        {sidebarContent}
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-background/50">
        <header className="h-12 border-b bg-background flex items-center justify-between px-3 md:px-5 sticky top-0 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setMobileOpen(true)}
              className="md:hidden shrink-0 h-8 w-8"
              data-testid="btn-mobile-menu"
            >
              <Menu className="w-4 h-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setDesktopCollapsed(!desktopCollapsed)}
              className="hidden md:inline-flex shrink-0 h-8 w-8"
              data-testid="btn-desktop-sidebar-toggle"
            >
              <Menu className="w-4 h-4" />
            </Button>
            <h1 className="text-sm md:text-base font-heading font-semibold text-foreground truncate">
              {currentPageLabel}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="relative hidden lg:block w-56">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search projects..." className="pl-8 h-8 text-sm bg-muted/30 border-none focus-visible:ring-1" />
            </div>
            <NotificationBell />
          </div>
        </header>

        <div className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 scroll-smooth">
          <div className="max-w-[1600px] mx-auto animate-in fade-in duration-300 space-y-4">
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
