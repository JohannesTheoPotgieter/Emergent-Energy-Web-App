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
  MessagesSquare,
  Handshake,
  Compass,
  Smartphone,
  Mail,
  UserCog,
  PanelLeft,
  ChevronLeft,
  FileUp,
  Zap,
  Sun,
  Wind,
  Battery,
  Leaf,
  CircuitBoard,
} from "lucide-react";
import { UX_REDESIGN_ENABLED, checkPermission, ENTITY_PERMISSION_DEFAULTS, type PermissionEntity } from "@shared/schema";
import { useProgramData } from "@/hooks/use-program-data";
import { useAuth } from "@/hooks/use-auth";
import { authApi } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { DatabaseStatusBanner } from "@/components/DatabaseStatusBanner";
import { UploadValidationReport } from "@/components/UploadValidationReport";
import { NotificationBell } from "@/components/NotificationBell";
import { InteractiveTutorial } from "@/components/InteractiveTutorial";
import { PmModeToggle } from "@/components/PmModeToggle";
import { getScreenTour } from "@/data/screen-tours";
import type { ScreenTourStep } from "@/data/screen-tours";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  label: string;
  icon: any;
  path: string;
  className?: string;
  requiredPermission?: { entity: string; action: string };
  badge?: string;
  children?: { label: string; icon: any; path: string; badge?: string }[];
}

interface NavGroup {
  heading: string;
  section: string;
  icon?: any;
  items: NavItem[];
}

const SECTION_COLORS: Record<string, string> = {
  MY_WORK: "text-green-600",
  PROJECT_DEVELOPMENT: "text-amber-600",
  ENGINEERING: "text-orange-600",
  QUALITY: "text-violet-600",
  PROJECT_MANAGEMENT: "text-sky-600",
  FINANCE: "text-emerald-600",
  SYSTEM: "text-slate-500",
  COCKPIT: "text-amber-600",
  COLLABORATION: "text-green-600",
  MONEY: "text-emerald-600",
  DELIVERY: "text-orange-600",
  GOVERNANCE: "text-violet-600",
  INFORMATION: "text-cyan-600",
  FEEDBACK: "text-cyan-600",
  ADMIN: "text-slate-500",
  SETTINGS: "text-slate-500",
  EXCO: "text-amber-600",
  PROJECTS: "text-blue-600",
  PROJECT_DELIVERY: "text-orange-600",
  OPERATIONS: "text-amber-600",
};

const PATH_TO_ENTITY: Record<string, PermissionEntity> = {
  "/cashflow": "cashflow",
  "/cos": "cos",
  "/revenue-tracker": "revenue_tracker",
  "/subcontractor-dashboard": "subcontractors",
  "/engineering": "engineering",
  "/engineering/tasks": "eng_tasks",
  "/quality": "quality",
  "/pd": "pd_dashboard",
  "/pd/tickets": "pd_tickets",
  "/pd/clients": "pd_clients",
  "/lifecycle-board": "lifecycle",
  "/projects": "projects",
  "/portfolios": "portfolios",
  "/dashboard": "execution_board",
  "/pm-dashboard": "pm_dashboard",
  "/pm/on-the-go": "pm_on_the_go",
  "/weekly-reviews": "weekly_review_wizard",
  "/admin/roles": "admin_roles",
  "/admin/settings": "admin",
  "/admin/activity-log": "activity_log",
  "/admin/database-migration": "database_migration",
  "/smart-import": "smart_import",
  "/excel-updates": "excel_updates",
  "/ee-info": "ee_info",
  "/feedback": "feedback",
  "/leaderboard": "leaderboard",
  "/invoice-patterns": "invoice_patterns",
  "/company-priorities": "company_priorities",
  "/my-work": "home",
  "/my-work/tasks": "my_tool",
  "/my-work/approvals": "my_work",
  "/my-work/calendar": "my_work",
  "/my-work/meetings": "meetings",
  "/my-work/email": "collaboration_hub",
  "/my-work/teams": "teams_chat",
};

function hasEntityViewPermission(
  path: string,
  role: string | null,
  entityPermissions: Record<string, Record<string, boolean>> | null | undefined,
): boolean {
  const entity = PATH_TO_ENTITY[path];
  if (!entity) return true;

  if (entityPermissions && entityPermissions[entity]) {
    if (entityPermissions[entity].view === true) return true;
    if (entityPermissions[entity].view === false) return false;
  }

  if (!role) return true;
  return checkPermission(role, entity, "view");
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
        { label: "Revenue Tracker", icon: TrendingUp, path: "/revenue-tracker" },
        { label: "Procurement", icon: Users, path: "/subcontractor-dashboard" },
      ],
    },
    {
      heading: "ENGINEERING",
      section: "ENGINEERING",
      items: [
        { label: "Eng Standup", icon: Wrench, path: "/engineering" },
        { label: "Task Board", icon: ListTodo, path: "/engineering/tasks" },
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
        { label: "Teams Chat", icon: MessageSquare, path: "/teams/chats" },
      ],
    },
    {
      heading: "SETTINGS",
      section: "SETTINGS",
      items: [
        { label: "Settings", icon: Settings, path: "/admin/settings" },
        { label: "Roles & Permissions", icon: ShieldAlert, path: "/admin/roles" },
        { label: "Smart Import", icon: FileSpreadsheet, path: "/smart-import" },
        { label: "Change Audit", icon: Activity, path: "/admin/activity-log" },
      ],
    },
  ];
}

function getRedesignedNavGroups(): NavGroup[] {
  return [
    {
      heading: "MY WORK",
      section: "MY_WORK",
      icon: Zap,
      items: [
        { label: "Tasks", icon: ListChecks, path: "/my-work/tasks" },
        { label: "Approvals", icon: ClipboardCheck, path: "/my-work/approvals" },
        { label: "Calendar", icon: CalendarCheck, path: "/my-work/calendar" },
        { label: "Meetings", icon: MessageSquareText, path: "/my-work/meetings" },
        { label: "Email", icon: Mail, path: "/my-work/email" },
        { label: "Teams Chat", icon: MessagesSquare, path: "/my-work/teams" },
      ],
    },
    {
      heading: "PROJECT DEVELOPMENT",
      section: "PROJECT_DEVELOPMENT",
      icon: Sun,
      items: [
        { label: "PD Dashboard", icon: Sun, path: "/pd" },
        { label: "PD Tickets", icon: ClipboardList, path: "/pd/tickets" },
        { label: "Clients", icon: Users, path: "/pd/clients" },
        { label: "Lifecycle Board", icon: Layers, path: "/lifecycle-board" },
      ],
    },
    {
      heading: "ENGINEERING",
      section: "ENGINEERING",
      icon: HardHat,
      items: [
        { label: "Eng Dashboard", icon: HardHat, path: "/engineering" },
        { label: "Task Board", icon: ListTodo, path: "/engineering/tasks" },
      ],
    },
    {
      heading: "QUALITY",
      section: "QUALITY",
      icon: ShieldCheck,
      items: [
        { label: "Quality Dashboard", icon: ShieldCheck, path: "/quality" },
      ],
    },
    {
      heading: "PROJECT MANAGEMENT",
      section: "PROJECT_MANAGEMENT",
      icon: Wind,
      items: [
        { label: "Project List", icon: FolderKanban, path: "/projects" },
        { label: "Portfolios", icon: FolderOpen, path: "/portfolios" },
        { label: "Execution Board", icon: Gauge, path: "/dashboard" },
        { label: "PM Dashboard", icon: Briefcase, path: "/pm-dashboard" },
        { label: "On-The-Go", icon: Smartphone, path: "/pm/on-the-go" },
        { label: "Weekly Reviews", icon: CalendarCheck, path: "/weekly-reviews" },
      ],
    },
    {
      heading: "FINANCE",
      section: "FINANCE",
      icon: Battery,
      items: [
        { label: "Cashflow", icon: Wallet, path: "/cashflow" },
        { label: "COS Tracker", icon: TrendingUp, path: "/cos" },
        { label: "Revenue Tracker", icon: TrendingUp, path: "/revenue-tracker" },
        { label: "Procurement", icon: Truck, path: "/subcontractor-dashboard" },
        { label: "Invoice Patterns", icon: FileSpreadsheet, path: "/invoice-patterns" },
      ],
    },
    {
      heading: "SYSTEM",
      section: "SYSTEM",
      icon: CircuitBoard,
      items: [
        { label: "Users & Roles", icon: UserCog, path: "/admin/roles" },
        { label: "App Settings", icon: Settings, path: "/admin/settings" },
        { label: "Activity Log", icon: Activity, path: "/admin/activity-log" },
        { label: "Smart Import", icon: FileSpreadsheet, path: "/smart-import" },
        { label: "Excel Updates", icon: ClipboardCheck, path: "/excel-updates" },
        { label: "Emergent Energy Info", icon: Leaf, path: "/ee-info" },
        { label: "Company Priorities", icon: Flag, path: "/company-priorities" },
        { label: "Feedback & Support", icon: MessageSquareText, path: "/feedback" },
        { label: "Leaderboard", icon: Trophy, path: "/leaderboard" },
      ],
    },
  ];
}

function getUnifiedWorkNavGroups(): NavGroup[] {
  const base = getRedesignedNavGroups();
  const result: NavGroup[] = [];

  for (const group of base) {
    if (group.section === "MY_WORK") {
      result.push({
        ...group,
        items: [
          { label: "Home", icon: Home, path: "/my-work" },
          ...group.items,
        ],
      });
    } else {
      result.push(group);
    }
  }

  return result;
}

function getNavGroups(unifiedWorkEnabled: boolean): NavGroup[] {
  if (unifiedWorkEnabled && UX_REDESIGN_ENABLED) return getUnifiedWorkNavGroups();
  return UX_REDESIGN_ENABLED ? getRedesignedNavGroups() : getLegacyNavGroups();
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [showValidationReport, setShowValidationReport] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  
  useEffect(() => {
    setCollapsedSections({});
  }, [location]);
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
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!appVersion?.version) return;
    const storedVersion = localStorage.getItem("app_version");
    if (!storedVersion) {
      localStorage.setItem("app_version", appVersion.version);
      return;
    }
    if (storedVersion !== appVersion.version) {
      localStorage.setItem("app_version", appVersion.version);
      localStorage.removeItem("auth_token");
      localStorage.removeItem("company_role");
      try { authApi.logout().catch(() => {}); } catch {}
      window.location.href = "/auth/login";
    }
  }, [appVersion?.version]);

  const { data: unifiedWorkFlag } = useQuery<boolean>({
    queryKey: ["feature-flag-unified-work"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/settings?key=unified_work_v1", { credentials: "include" });
        if (!res.ok) return false;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data[0].value === true || data[0].value === "true" || data[0].value === "1";
        if (data && typeof data === "object" && "value" in data) return data.value === true || data.value === "true" || data.value === "1";
        return false;
      } catch { return false; }
    },
    staleTime: 60_000,
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
    setCollapsedSections(prev => {
      const next = { ...prev };
      if (next[heading] !== undefined) {
        next[heading] = !next[heading];
      } else {
        const groups = getNavGroups(!!unifiedWorkFlag);
        const group = groups.find(g => g.heading === heading);
        const currentSearch = window.location.search;
        const groupHasActive = group?.items.some(item => {
          const ip = item.path.split("?")[0];
          const iq = item.path.includes("?") ? item.path.split("?")[1] : null;
          if (iq) return location === ip && currentSearch === `?${iq}`;
          return location === item.path || (item.path === "/my-tool" && location.startsWith("/my-tool")) || (item.path !== "/" && item.path !== "/engineering" && location.startsWith(item.path));
        });
        next[heading] = !!groupHasActive;
      }
      return next;
    });
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
  const navGroups = getNavGroups(!!unifiedWorkFlag);
  const allItems = navGroups.flatMap(g => g.items);
  const currentPageLabel = location === "/" 
    ? "Home" 
    : location.startsWith("/my-work")
      ? "My Work"
      : location.startsWith("/my-tool") 
        ? "My Tool" 
        : allItems.find(i => i.path === location)?.label || "Dashboard";

  const sidebarShowLabels = mobileOpen || !desktopCollapsed;

  const isAdmin = ['COO_ADMIN', 'CEO_ADMIN'].includes(companyRole || '') || ['COO_ADMIN', 'CEO_ADMIN', 'admin'].includes(user?.role || '');

  const getRoleDisplayName = (role: string | undefined | null): string => {
    if (!role) return "";
    const map: Record<string, string> = {
      COO_ADMIN: "COO Admin",
      CEO_ADMIN: "CEO Admin",
      CCO: "CCO",
      CFO: "CFO",
      PROGRAM_MANAGER: "Program Manager",
      PROGRAM_FINANCE_MANAGER: "Finance Manager",
      CONSTRUCTION_MANAGER: "Construction Mgr",
      QUALITY_MANAGER: "Quality Manager",
      ENGINEERING_MANAGER: "Engineering Mgr",
      ENGINEER: "Engineer",
      ACCOUNTANT: "Accountant",
      KEY_ACCOUNTS_MANAGER: "Key Accounts",
      PROJECT_MANAGER_SITE: "Site PM",
      PROJECT_DEVELOPER: "Project Developer",
    };
    return map[role] || role.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  const getRoleBadgeColor = (role: string | undefined | null): string => {
    if (!role) return "bg-slate-100 text-slate-600 border-slate-200";
    if (['COO_ADMIN', 'CEO_ADMIN'].includes(role)) return "bg-amber-50 text-amber-700 border-amber-200";
    if (['CCO'].includes(role)) return "bg-orange-50 text-orange-700 border-orange-200";
    if (['CFO', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'].includes(role)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (['QUALITY_MANAGER'].includes(role)) return "bg-purple-50 text-purple-700 border-purple-200";
    if (['ENGINEER', 'ENGINEERING_MANAGER'].includes(role)) return "bg-orange-50 text-orange-700 border-orange-200";
    if (['PROJECT_MANAGER_SITE', 'CONSTRUCTION_MANAGER'].includes(role)) return "bg-cyan-50 text-cyan-700 border-cyan-200";
    if (['PROJECT_DEVELOPER'].includes(role)) return "bg-violet-50 text-violet-700 border-violet-200";
    return "bg-blue-50 text-blue-700 border-blue-200";
  };

  const sidebarContent = (
    <TooltipProvider delayDuration={200}>
      <>
        <div className="h-14 md:h-16 flex items-center px-3 border-b border-border bg-white">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shrink-0 shadow-md">
              <img src="/emergent-leaf.png" className="h-5 w-5 object-contain" alt="Emergent Energy" />
            </div>
            {sidebarShowLabels && (
              <div className="flex flex-col leading-tight min-w-0">
                <span className="text-sm font-bold text-foreground tracking-tight">Emergent</span>
                <span className="text-[10px] font-medium text-green-600 uppercase tracking-widest">Energy</span>
              </div>
            )}
          </Link>
          {sidebarShowLabels && (
            <button
              onClick={() => {
                if (mobileOpen) setMobileOpen(false);
                else setDesktopCollapsed(true);
              }}
              className="ml-auto p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5 overscroll-contain scrollbar-thin">
          {navGroups.filter(group => {
            if (["FEEDBACK", "INFORMATION", "MY_WORK", "SYSTEM"].includes(group.section)) return true;
            if (allowedSections.length === 0 && !activeRole) return group.section === "PROJECT_MANAGEMENT";
            const sectionAliases: Record<string, string[]> = {
              PROJECT_DEVELOPMENT: ["PROJECT_DEVELOPMENT", "COCKPIT"],
              ENGINEERING: ["DELIVERY"],
              QUALITY: ["GOVERNANCE"],
              PROJECT_MANAGEMENT: ["PROJECTS"],
              FINANCE: ["MONEY"],
            };
            const aliases = sectionAliases[group.section] || [group.section];
            return aliases.some(a => allowedSections.includes(a)) || allowedSections.includes(group.section);
          }).map((group) => {
            let visibleItems = group.items.filter(item => {
              if (item.path === "/engineering/sync" && companyRole !== "COO_ADMIN") return false;
              if (item.path === "/pm/on-the-go" && companyRole !== "PROJECT_MANAGER_SITE") return false;
              if (companyRole === "PROJECT_MANAGER_SITE") {
                const pmVisiblePaths = ["/projects", "/pm-dashboard", "/pm/on-the-go", "/engineering", "/engineering/tasks", "/engineering/inbox", "/quality", "/cashflow", "/cos", "/portfolios"];
                return pmVisiblePaths.some(p => item.path === p);
              }
              return true;
            });

            const entityPerms = permissions?.entityPermissions as Record<string, Record<string, boolean>> | null | undefined;
            visibleItems = visibleItems.filter(item =>
              hasEntityViewPermission(item.path, activeRole, entityPerms)
            );
            if (visibleItems.length === 0) return null;

            const currentSearchStr = typeof window !== "undefined" ? window.location.search : "";
            const hasActiveItem = visibleItems.some(item => {
              const ip = item.path.split("?")[0];
              const iq = item.path.includes("?") ? item.path.split("?")[1] : null;
              if (iq) return location === ip && currentSearchStr === `?${iq}`;
              return location === item.path || 
                (item.path === "/my-tool" && location.startsWith("/my-tool")) || 
                (item.path !== "/" && item.path !== "/engineering" && location.startsWith(item.path)) ||
                (item.children && item.children.some(c => location === c.path || location.startsWith(c.path)));
            });

            const isCollapsed = sidebarShowLabels && (
              collapsedSections[group.heading] !== undefined
                ? collapsedSections[group.heading]
                : !hasActiveItem
            );
            const sectionColor = SECTION_COLORS[group.section] || "text-muted-foreground";

            return (
              <div key={group.heading} className="pt-2 first:pt-1">
                {sidebarShowLabels ? (
                  <button
                    onClick={() => toggleSection(group.heading)}
                    className="w-full flex items-center justify-between px-3 pb-1 transition-colors group/section"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className={cn("w-1 h-3 rounded-full transition-colors", hasActiveItem ? sectionColor.replace("text-", "bg-") : "bg-border")} />
                      <span className={cn(
                        "text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors",
                        hasActiveItem ? sectionColor : "text-muted-foreground/70 group-hover/section:text-muted-foreground"
                      )}>{group.heading}</span>
                    </div>
                    <span className={cn("transition-transform duration-200", isCollapsed ? "" : "rotate-0")}>
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
                      )}
                    </span>
                  </button>
                ) : (
                  <div className="h-px bg-border mx-3 my-1" />
                )}
                {!isCollapsed && (
                  <div className="space-y-px">
                    {visibleItems.map((item) => {
                      const itemPathname = item.path.split("?")[0];
                      const itemQuery = item.path.includes("?") ? item.path.split("?")[1] : null;
                      const currentSearch = typeof window !== "undefined" ? window.location.search : "";
                      const isActive = itemQuery
                        ? location === itemPathname && currentSearch === `?${itemQuery}`
                        : location === item.path || (item.path === "/my-tool" && location.startsWith("/my-tool")) || (item.path !== "/" && item.path !== "/engineering" && location.startsWith(item.path));
                      const hasChildren = item.children && item.children.length > 0;
                      const childActive = hasChildren && item.children!.some(c => location === c.path || location.startsWith(c.path));
                      const isParentExpanded = expandedParents[item.path] ?? childActive ?? false;

                      const navLink = (
                        <div key={item.path}>
                          {hasChildren ? (
                            <button
                              onClick={() => setExpandedParents(prev => ({ ...prev, [item.path]: !isParentExpanded }))}
                              className={cn(
                                "w-full flex items-center gap-3 px-3 py-[7px] rounded-lg transition-all duration-150 group text-[13px] select-none",
                                isActive || childActive
                                  ? "bg-green-50 text-green-700 font-medium border border-green-200"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
                              )}
                            >
                              <item.icon className={cn("w-[18px] h-[18px] shrink-0", item.className)} />
                              {sidebarShowLabels && (
                                <>
                                  <span className="flex-1 text-left">{item.label}</span>
                                  {item.badge && (
                                    <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md">{item.badge}</span>
                                  )}
                                  {isParentExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                                </>
                              )}
                            </button>
                          ) : itemQuery ? (
                            <a href={item.path} className={cn(
                              "flex items-center gap-3 px-3 py-[7px] rounded-lg transition-all duration-150 group text-[13px] select-none cursor-pointer",
                              isActive
                                ? "bg-green-50 text-green-700 font-medium border border-green-200"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground"
                            )}>
                              <item.icon className={cn("w-[18px] h-[18px] shrink-0", item.className)} />
                              {sidebarShowLabels && (
                                <>
                                  <span className="flex-1">{item.label}</span>
                                  {item.badge && (
                                    <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md">{item.badge}</span>
                                  )}
                                </>
                              )}
                            </a>
                          ) : (
                            <Link href={item.path} className={cn(
                              "flex items-center gap-3 px-3 py-[7px] rounded-lg transition-all duration-150 group text-[13px] select-none",
                              isActive
                                ? "bg-green-50 text-green-700 font-medium border border-green-200"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground"
                            )}>
                              <item.icon className={cn("w-[18px] h-[18px] shrink-0", item.className)} />
                              {sidebarShowLabels && (
                                <>
                                  <span className="flex-1">{item.label}</span>
                                  {item.badge && (
                                    <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md">{item.badge}</span>
                                  )}
                                </>
                              )}
                            </Link>
                          )}
                          {hasChildren && isParentExpanded && sidebarShowLabels && (
                            <div className="ml-4 pl-3 border-l border-border space-y-px mt-0.5">
                              {item.children!.map(child => {
                                const isChildActive = location === child.path || location.startsWith(child.path);
                                return (
                                  <Link key={child.path} href={child.path} className={cn(
                                    "flex items-center gap-2.5 px-2.5 py-[5px] rounded-md transition-all duration-150 text-[12px] select-none",
                                    isChildActive
                                      ? "bg-green-50 text-green-700 font-medium"
                                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                  )}>
                                    <child.icon className="w-3.5 h-3.5 shrink-0" />
                                    <span>{child.label}</span>
                                    {child.badge && (
                                      <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md ml-auto">{child.badge}</span>
                                    )}
                                  </Link>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );

                      if (!sidebarShowLabels) {
                        return (
                          <Tooltip key={item.path}>
                            <TooltipTrigger asChild>
                              {navLink}
                            </TooltipTrigger>
                            <TooltipContent side="right" className="font-medium">{item.label}</TooltipContent>
                          </Tooltip>
                        );
                      }

                      return navLink;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-border bg-card/50">
          <div className="p-2.5">
            <div className={cn(
              "flex items-center gap-2.5 p-2 rounded-lg transition-colors",
              sidebarShowLabels ? "hover:bg-accent" : ""
            )}>
              <Avatar className="w-9 h-9 border-2 border-border shrink-0">
                <AvatarFallback className="bg-green-50 text-green-700 text-xs font-bold">
                  {(user?.name || "U").substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {sidebarShowLabels && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{user?.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={cn(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded-md border inline-flex items-center",
                      getRoleBadgeColor(companyRole || user?.role)
                    )}>
                      {getRoleDisplayName(companyRole || user?.role)}
                    </span>
                  </div>
                </div>
              )}
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground hover:text-red-600 hover:bg-red-50 shrink-0"
                onClick={() => { localStorage.removeItem("company_role"); localStorage.removeItem("auth_token"); logout(); }}
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
            {sidebarShowLabels && appVersion && (
              <p className="text-[10px] text-muted-foreground/50 mt-1 text-center" data-testid="text-app-version">
                v{appVersion.version}{appVersion.buildNumber ? ` (${appVersion.buildNumber})` : ""}
              </p>
            )}
          </div>
        </div>
      </>
    </TooltipProvider>
  );

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      <div
        className={cn(
          "fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 bg-white text-foreground flex flex-col border-r border-border shadow-lg transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] w-[280px] md:hidden will-change-transform",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>

      <aside 
        className={cn(
          "hidden md:flex bg-white text-foreground flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] border-r border-border z-20 will-change-[width]",
          desktopCollapsed ? "w-[68px]" : "w-[240px]"
        )}
      >
        {sidebarContent}
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-background">
        <header className="h-14 md:h-14 border-b border-border bg-white flex items-center justify-between px-3 md:px-6 sticky top-0 z-10">
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
              {desktopCollapsed ? <PanelLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <h1 className="text-base md:text-lg font-heading font-semibold text-foreground truncate">
              {currentPageLabel}
            </h1>
          </div>

          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <PmModeToggle />

            <NotificationBell />

            <div className="h-6 w-px bg-border mx-1 hidden sm:block" />

            <div className="hidden sm:flex flex-col items-end">
              <div className="flex items-center gap-1">
                <Database className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-mono font-medium text-muted-foreground">
                  {healthStatus?.dbMode === 'postgres' ? 'PG' : healthStatus?.dbMode === 'sqlite' ? 'SQLite' : '?'}
                </span>
              </div>
            </div>

            <div className="h-6 w-px bg-border mx-1 hidden lg:block" />

            <div className="flex-col items-end hidden lg:flex">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Updated</span>
              <span className="text-xs font-mono text-muted-foreground">
                {overview?.data_as_of ? format(new Date(overview.data_as_of), "dd MMM HH:mm") : "No data"}
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 flex flex-col min-h-0">
          <div className="w-full max-w-[1920px] mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col min-h-0 min-w-0 gap-4" data-page-content>
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
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-green-600 text-white px-4 py-2.5 shadow-lg hover:shadow-xl hover:bg-green-700 transition-all duration-200 text-sm font-medium"
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
