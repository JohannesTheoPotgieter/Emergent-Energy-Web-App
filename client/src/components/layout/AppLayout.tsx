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
  Briefcase,
  ShieldCheck,
  Wrench,
  ListTodo,
  Flag,
  ChevronDown,
  ChevronRight,
  Layers,
  FolderPlus,
  InboxIcon,
  RefreshCw,
  Users,
  Activity,
  FolderKanban,
  Scale,
  ClipboardCheck,
  Cog,
  CalendarCheck,
  Truck,
  Gauge,
  HardHat,
  ShieldAlert,
  ClipboardList,
  MessageSquareText,
  BookOpen,
  ListChecks,
  Trophy,
  Bell,
  FolderOpen,
  FileEdit,
  Network,
  Plug,
  MessageSquare,
  Handshake,
  Compass,
} from "lucide-react";
import { UX_REDESIGN_ENABLED } from "@shared/schema";
import { useProgramData } from "@/hooks/use-program-data";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { DatabaseStatusBanner } from "@/components/DatabaseStatusBanner";
import { UploadValidationReport } from "@/components/UploadValidationReport";
import { NotificationBell } from "@/components/NotificationBell";
import { InteractiveTutorial } from "@/components/InteractiveTutorial";
import { getScreenTour } from "@/data/screen-tours";
import type { ScreenTourStep } from "@/data/screen-tours";

interface NavItem {
  label: string;
  icon: any;
  path: string;
  className?: string;
  requiredPermission?: { entity: string; action: string };
  children?: { label: string; icon: any; path: string }[];
}

interface NavGroup {
  heading: string;
  section: string;
  items: NavItem[];
}

function getLegacyNavGroups(): NavGroup[] {
  return [
    {
      heading: "EXCO",
      section: "EXCO",
      items: [
        { label: "Exco", icon: Layers, path: "/lifecycle-board" },
        { label: "Company Priorities", icon: Flag, path: "/company-priorities" },
        { label: "My Tool", icon: Briefcase, path: "/my-tool" },
      ],
    },
    {
      heading: "PROJECT MANAGEMENT",
      section: "PROJECT_MANAGEMENT",
      items: [
        { label: "Execution Dashboard", icon: LayoutDashboard, path: "/dashboard" },
        { label: "Project Summary", icon: FileSpreadsheet, path: "/projects" },
        { label: "Cashflow", icon: Wallet, path: "/cashflow" },
        { label: "COS Tracker", icon: TrendingUp, path: "/cos", className: "rotate-180" },
        { label: "Procurement", icon: Users, path: "/subcontractor-dashboard" },
      ],
    },
    {
      heading: "ENGINEERING",
      section: "ENGINEERING",
      items: [
        { label: "Eng Standup", icon: Wrench, path: "/engineering" },
        { label: "Task Board", icon: ListTodo, path: "/engineering/tasks" },
        { label: "Pipeline Inbox", icon: InboxIcon, path: "/engineering/inbox" },
        { label: "SP Sync", icon: RefreshCw, path: "/engineering/sync" },
      ],
    },
    {
      heading: "QUALITY",
      section: "QUALITY",
      items: [
        { label: "Quality Dashboard", icon: ShieldCheck, path: "/quality" },
      ],
    },
    {
      heading: "FEEDBACK",
      section: "FEEDBACK",
      items: [
        { label: "Feedback & Support", icon: MessageSquareText, path: "/feedback" },
        { label: "Leaderboard", icon: Trophy, path: "/leaderboard" },
        { label: "Notifications", icon: Bell, path: "/notifications" },
        { label: "Teams Chat", icon: MessageSquare, path: "/teams/chats" },
      ],
    },
    {
      heading: "ADMIN",
      section: "ADMIN",
      items: [
        { label: "Settings", icon: Settings, path: "/admin/settings" },
        { label: "Roles & Permissions", icon: ShieldAlert, path: "/admin/roles" },
        { label: "Phase Templates", icon: Layers, path: "/admin/phase-templates" },
        { label: "New Project", icon: FolderPlus, path: "/project-create" },
        { label: "Smart Import", icon: FileSpreadsheet, path: "/smart-import" },
        { label: "Weekly Reviews", icon: CalendarCheck, path: "/weekly-reviews" },
        { label: "Change Audit", icon: Activity, path: "/admin/activity-log" },
        { label: "Approvals", icon: ShieldCheck, path: "/admin/approvals" },
      ],
    },
  ];
}

function getRedesignedNavGroups(): NavGroup[] {
  return [
    {
      heading: "EXCO",
      section: "COCKPIT",
      items: [
        { label: "My Tool", icon: Briefcase, path: "/my-tool" },
        { label: "Company Priorities", icon: Flag, path: "/company-priorities" },
        { label: "Company Lifecycle Dashboard", icon: Layers, path: "/lifecycle-board" },
      ],
    },
    {
      heading: "COLLABORATION",
      section: "COLLABORATION",
      items: [
        { label: "Collaboration Hub", icon: Handshake, path: "/collaboration" },
        { label: "Teams Chat", icon: MessageSquare, path: "/teams/chats" },
        { label: "Notifications", icon: Bell, path: "/notifications" },
      ],
    },
    {
      heading: "PROJECT MANAGEMENT",
      section: "PROJECTS",
      items: [
        { label: "Execution Board", icon: Gauge, path: "/dashboard" },
        { label: "Project Summary", icon: FolderKanban, path: "/projects" },
        { label: "PM Dashboard", icon: Briefcase, path: "/pm-dashboard" },
        { label: "TR Register", icon: ClipboardList, path: "/tr-register" },
        { label: "Smart Import", icon: FileSpreadsheet, path: "/smart-import" },
        { label: "Portfolios", icon: FolderOpen, path: "/portfolios" },
      ],
    },
    {
      heading: "PROJECT FINANCE",
      section: "MONEY",
      items: [
        { label: "Cashflow", icon: Wallet, path: "/cashflow" },
        { label: "COS Tracker", icon: TrendingUp, path: "/cos" },
        { label: "Procurement", icon: Truck, path: "/subcontractor-dashboard" },
        { label: "Invoice Patterns", icon: FileSpreadsheet, path: "/invoice-patterns" },
      ],
    },
    {
      heading: "PROJECT DEVELOPMENT",
      section: "PROJECT_DEVELOPMENT",
      items: [
        { label: "PD Dashboard", icon: FileEdit, path: "/pd" },
        { label: "PD Tickets", icon: ClipboardList, path: "/pd/tickets" },
      ],
    },
    {
      heading: "ENGINEERING",
      section: "DELIVERY",
      items: [
        { label: "Engineering", icon: HardHat, path: "/engineering" },
        { label: "Task Board", icon: ListTodo, path: "/engineering/tasks" },
      ],
    },
    {
      heading: "GOVERNANCE",
      section: "GOVERNANCE",
      items: [
        { label: "Quality Dashboard", icon: ShieldCheck, path: "/quality" },
      ],
    },
    {
      heading: "INFORMATION",
      section: "INFORMATION",
      items: [
        { label: "Feedback & Support", icon: MessageSquareText, path: "/feedback" },
        { label: "Emergent Energy Info", icon: BookOpen, path: "/ee-info" },
        { label: "Leaderboard", icon: Trophy, path: "/leaderboard" },
        { label: "Integration Status", icon: Plug, path: "/settings/integrations" },
      ],
    },
    {
      heading: "ADMIN",
      section: "ADMIN",
      items: [
        {
          label: "Settings", icon: Cog, path: "/admin/settings",
          children: [
            { label: "Roles & Permissions", icon: ShieldAlert, path: "/admin/roles" },
            { label: "Phase Templates", icon: ClipboardCheck, path: "/admin/phase-templates" },
            { label: "Weekly Reviews", icon: CalendarCheck, path: "/weekly-reviews" },
            { label: "Change Audit", icon: Activity, path: "/admin/activity-log" },
            { label: "Approvals", icon: ShieldCheck, path: "/admin/approvals" },
            { label: "Microsoft Integration", icon: Cog, path: "/admin/ms-integration" },
            { label: "MS Account Mapping", icon: Users, path: "/admin/ms-mapping" },
          ],
        },
      ],
    },
  ];
}

function getNavGroups(): NavGroup[] {
  return UX_REDESIGN_ENABLED ? getRedesignedNavGroups() : getLegacyNavGroups();
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [showValidationReport, setShowValidationReport] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
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

  const { data: appVersion } = useQuery<{ version: string; buildTime: string | null; buildId: string | null; buildNumber: string | null }>({
    queryKey: ["/api/version"],
    queryFn: async () => {
      const res = await fetch("/api/version", { credentials: "include" });
      return res.json();
    },
    staleTime: Infinity,
  });

  const [screenTourActive, setScreenTourActive] = useState(false);
  const screenTour = getScreenTour(location);
  const screenTourSteps = screenTour ? screenTour.steps.map((s: ScreenTourStep) => ({
    targetSelector: s.targetSelector,
    title: s.title,
    description: s.description,
    position: s.position,
  })) : null;

  useEffect(() => {
    setMobileOpen(false);
    setScreenTourActive(false);
  }, [location]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const toggleSection = (heading: string) => {
    setCollapsedSections(prev => ({ ...prev, [heading]: !prev[heading] }));
  };

  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const activeRole = companyRole || user?.role || null;

  const { data: permissions } = useQuery({
    queryKey: ["auth-permissions", activeRole],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (activeRole) headers["x-company-role"] = activeRole;
      const res = await fetch("/api/auth/permissions", { headers, credentials: "include" });
      return res.json();
    },
    enabled: !!activeRole,
  });

  const allowedSections: string[] = permissions?.sections || [];
  const navGroups = getNavGroups();
  const allItems = navGroups.flatMap(g => g.items);
  const currentPageLabel = location === "/" 
    ? "Home" 
    : location.startsWith("/my-tool") 
      ? "My Tool" 
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

      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5 overscroll-contain">
        <Link href="/" className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group select-none",
          location === "/" 
            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-md" 
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-[0.98]"
        )}>
          <Home className="w-4.5 h-4.5 shrink-0" />
          {sidebarShowLabels && <span className="text-sm">Home</span>}
        </Link>


        {navGroups.filter(group => {
          if (group.section === "FEEDBACK" || group.section === "INFORMATION") return true;
          if (allowedSections.length === 0 && !activeRole) return group.section === "PROJECTS";
          return allowedSections.includes(group.section);
        }).map((group) => {
          let visibleItems = group.items.filter(item => {
            if (item.path === "/engineering/sync" && companyRole !== "COO_ADMIN") return false;
            if (companyRole === "PROJECT_MANAGER_SITE") {
              const pmVisiblePaths = ["/projects", "/pm-dashboard", "/engineering", "/engineering/tasks", "/engineering/inbox", "/quality", "/cashflow", "/cos", "/portfolios"];
              return pmVisiblePaths.some(p => item.path === p);
            }
            return true;
          });
          if (visibleItems.length === 0) return null;

          const isCollapsed = collapsedSections[group.heading] && sidebarShowLabels;
          const hasActiveItem = visibleItems.some(item => 
            location === item.path || 
            (item.path === "/my-tool" && location.startsWith("/my-tool")) || 
            (item.path !== "/" && item.path !== "/engineering" && location.startsWith(item.path)) ||
            (item.children && item.children.some(c => location === c.path || location.startsWith(c.path)))
          );

          return (
          <div key={group.heading} className="pt-3">
            {sidebarShowLabels ? (
              <button
                onClick={() => toggleSection(group.heading)}
                className={cn(
                  "w-full flex items-center justify-between px-3 pb-1 text-[10px] font-bold uppercase tracking-widest transition-colors",
                  hasActiveItem ? "text-sidebar-foreground/60" : "text-sidebar-foreground/35 hover:text-sidebar-foreground/50"
                )}
              >
                <span>{group.heading}</span>
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            ) : (
              <div className="h-px bg-sidebar-border mx-2 mb-1" />
            )}
            {!isCollapsed && visibleItems.map((item) => {
              const isActive = location === item.path || (item.path === "/my-tool" && location.startsWith("/my-tool")) || (item.path !== "/" && item.path !== "/engineering" && location.startsWith(item.path));
              const hasChildren = item.children && item.children.length > 0;
              const childActive = hasChildren && item.children!.some(c => location === c.path || location.startsWith(c.path));
              const isParentExpanded = expandedParents[item.path] ?? childActive ?? false;

              return (
              <div key={item.path}>
                {hasChildren ? (
                  <button
                    onClick={() => setExpandedParents(prev => ({ ...prev, [item.path]: !isParentExpanded }))}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group text-[13px] select-none",
                      isActive || childActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-md"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-[0.98]"
                    )}
                  >
                    <item.icon className={cn("w-4 h-4 shrink-0", item.className)} />
                    {sidebarShowLabels && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        {isParentExpanded ? <ChevronDown className="w-3 h-3 shrink-0 transition-transform duration-200" /> : <ChevronRight className="w-3 h-3 shrink-0 transition-transform duration-200" />}
                      </>
                    )}
                  </button>
                ) : (
                  <Link href={item.path} className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group text-[13px] select-none",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-md"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-[0.98] nav-item-glow"
                  )}>
                    <item.icon className={cn("w-4 h-4 shrink-0", item.className)} />
                    {sidebarShowLabels && <span>{item.label}</span>}
                  </Link>
                )}
                {hasChildren && isParentExpanded && sidebarShowLabels && item.children!.map(child => {
                  const isChildActive = location === child.path || location.startsWith(child.path);
                  return (
                    <Link key={child.path} href={child.path} className={cn(
                      "flex items-center gap-3 pl-7 pr-3 py-2 rounded-lg transition-all duration-150 text-[12px] select-none",
                      isChildActive
                        ? "bg-sidebar-primary/80 text-sidebar-primary-foreground font-medium"
                        : "text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-[0.98]"
                    )}>
                      <child.icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{child.label}</span>
                    </Link>
                  );
                })}
              </div>
              );
            })}
          </div>
          );
        })}
      </nav>

      <div className="p-3 md:p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9 border border-sidebar-border/50 shrink-0">
            <AvatarFallback>{(user?.name || "U").substring(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          {sidebarShowLabels && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <span className={cn(
                  "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0",
                  ['admin', 'COO_ADMIN', 'CEO_ADMIN'].includes(user?.role || '')
                    ? "bg-amber-500/20 text-amber-300" 
                    : ['quality_manager', 'QUALITY_MANAGER'].includes(user?.role || '')
                    ? "bg-emerald-500/20 text-emerald-300"
                    : ['eng_program_manager', 'ENGINEERING_MANAGER'].includes(user?.role || '')
                    ? "bg-orange-500/20 text-orange-300"
                    : "bg-blue-500/20 text-blue-300"
                )}>
                  {companyRole
                    ? (companyRole === "COO_ADMIN" ? "COO" : companyRole === "CEO_ADMIN" ? "CEO" : companyRole.replace(/_/g, " ").split(" ").map(w => w[0]).join(""))
                    : user?.role === 'admin' ? "COO" : user?.role === 'quality_manager' ? "QM" : user?.role === 'eng_program_manager' ? "EPM" : user?.role?.replace(/_/g, " ").split(" ").map((w: string) => w[0]).join("") || ""}
                </span>
              </div>
              <p className="text-xs text-sidebar-foreground/50 truncate">{companyRole ? companyRole.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : user?.email}</p>
            </div>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-sidebar-foreground/50 hover:text-white shrink-0"
            onClick={() => { localStorage.removeItem("company_role"); localStorage.removeItem("auth_token"); logout(); }}
            title="Log out"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
        {sidebarShowLabels && appVersion && (
          <p className="text-[10px] text-sidebar-foreground/30 mt-2 text-center" data-testid="text-app-version">
            v{appVersion.version}{appVersion.buildNumber ? ` (${appVersion.buildNumber})` : ""}
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      <div
        className={cn(
          "fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] w-[280px] md:hidden will-change-transform",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>

      <aside 
        className={cn(
          "hidden md:flex bg-sidebar text-sidebar-foreground flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] border-r border-sidebar-border shadow-xl z-20 will-change-[width]",
          desktopCollapsed ? "w-20" : "w-64"
        )}
      >
        {sidebarContent}
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-background/50">
        <header className="h-14 md:h-16 border-b bg-background/95 backdrop-blur-sm flex items-center justify-between px-3 md:px-6 sticky top-0 z-10">
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
            
            <NotificationBell />

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

        <div className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 scroll-smooth overscroll-contain -webkit-overflow-scrolling-touch">
          <div className="max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-4">
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

        {screenTourSteps && location !== "/" && (
          <button
            onClick={() => setScreenTourActive(true)}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-4 py-2.5 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 text-sm font-medium"
            data-testid="button-screen-tour"
          >
            <Compass className="h-4 w-4" />
            <span className="hidden sm:inline">Take a Tour</span>
          </button>
        )}

        {screenTourActive && screenTourSteps && (
          <InteractiveTutorial
            active={screenTourActive}
            onComplete={() => setScreenTourActive(false)}
            externalSteps={screenTourSteps}
          />
        )}
      </main>
    </div>
  );
}
