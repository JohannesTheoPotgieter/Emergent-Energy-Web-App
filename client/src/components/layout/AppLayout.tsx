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
  CheckCheck,
  Upload,
  Sun,
  Wind,
  Battery,
  Leaf,
  CircuitBoard,
} from "lucide-react";
import { UX_REDESIGN_ENABLED, checkPermission, ENTITY_PERMISSION_DEFAULTS } from "@shared/schema";
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
import { findPageByPath, getPermissionEntityForPath, PAGE_REGISTRY, type SidebarVariant } from "@/config/page-registry";
import { fetchRolloutFeatureFlags } from "@/lib/feature-flags";
import { getRoleSectionPriority, sortRoleAwareNavItems } from "@/config/role-aware-ux";

interface NavItem {
  id?: string;
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

const LEADERSHIP_ROLES = new Set(["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "CCO", "CFO"]);
const LEADERSHIP_PRIMARY_NAV_IDS = [
  "commandCenter",
  "dashboard",
  "portfolios",
  "projects",
  "weeklyReviews",
  "myWorkApprovals",
  "myWorkTasks",
  "cashflow",
  "engineering",
  "quality",
];

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

const ICON_MAP: Record<string, any> = {
  LayoutDashboard,
  FileSpreadsheet,
  Wallet,
  TrendingUp,
  Settings,
  Home,
  Briefcase,
  ShieldCheck,
  Wrench,
  ListTodo,
  Flag,
  Layers,
  Users,
  Activity,
  FolderKanban,
  ClipboardCheck,
  CalendarCheck,
  Gauge,
  HardHat,
  ShieldAlert,
  ClipboardList,
  MessageSquareText,
  ListChecks,
  Trophy,
  FolderOpen,
  MessageSquare,
  MessagesSquare,
  Smartphone,
  Mail,
  UserCog,
  Zap,
  Sun,
  Wind,
  Battery,
  Leaf,
  CircuitBoard,
};

const PAGE_BY_ID = new Map(PAGE_REGISTRY.map((page) => [page.id, page]));

function hasEntityViewPermission(
  path: string,
  role: string | null,
  entityPermissions: Record<string, Record<string, boolean>> | null | undefined,
): boolean {
  const entity = getPermissionEntityForPath(path);
  if (!entity) return true;

  if (entityPermissions && entityPermissions[entity]) {
    if (entityPermissions[entity].view === true) return true;
    if (entityPermissions[entity].view === false) return false;
  }

  if (!role) return true;
  return checkPermission(role, entity, "view");
}

function makeNavItem(id: string, variant: SidebarVariant, overrides?: Partial<NavItem>): NavItem {
  const page = PAGE_BY_ID.get(id);
  if (!page) throw new Error(`Missing page registry entry: ${id}`);
  const icon = page.iconKey ? ICON_MAP[page.iconKey] : undefined;

  return {
    id: page.id,
    label: page.labels?.[variant] ?? page.label,
    icon: icon ?? FileSpreadsheet,
    path: page.path,
    ...overrides,
  };
}

function getLegacyNavGroups(contextualMsSurfacesEnabled: boolean, cleanedAdminVisibilityEnabled: boolean): NavGroup[] {
  return [
    {
      heading: "EXCO",
      section: "EXCO",
      items: [
        makeNavItem("lifecycle", "legacy"),
        makeNavItem("companyPriorities", "legacy"),
        makeNavItem("myTool", "legacy"),
      ],
    },
    {
      heading: "PROJECT MANAGEMENT",
      section: "PROJECT_MANAGEMENT",
      items: [
        makeNavItem("dashboard", "legacy"),
        makeNavItem("projects", "legacy"),
      ],
    },
    {
      heading: "COMMERCIAL",
      section: "FINANCE",
      items: [
        makeNavItem("cashflow", "legacy"),
        makeNavItem("revenueTracker", "legacy"),
        makeNavItem("cos", "legacy", { className: "rotate-180" }),
        makeNavItem("gpTracker", "legacy"),
        makeNavItem("invoicePatterns", "legacy"),
        makeNavItem("subcontractor", "legacy"),
      ],
    },
    {
      heading: "ENGINEERING",
      section: "ENGINEERING",
      items: [makeNavItem("engineering", "legacy"), makeNavItem("engineeringTasks", "legacy")],
    },
    {
      heading: "QUALITY",
      section: "QUALITY",
      items: [makeNavItem("quality", "legacy")],
    },
    {
      heading: "FEEDBACK",
      section: "FEEDBACK",
      items: [
        makeNavItem("feedback", "legacy"),
        makeNavItem("leaderboard", "legacy"),
        ...(!contextualMsSurfacesEnabled ? [makeNavItem("teamsChats", "legacy")] : []),
      ],
    },
    {
      heading: "SETTINGS",
      section: "SETTINGS",
      items: [
        makeNavItem("adminSettings", "legacy"),
        makeNavItem("adminRoles", "legacy"),
        makeNavItem("adminImportControlTower", "legacy"),
        makeNavItem("adminActivity", "legacy"),
        makeNavItem("adminRecovery", "legacy"),
        makeNavItem("adminKpiTraceability", "legacy"),
        ...(!cleanedAdminVisibilityEnabled ? [makeNavItem("smartImport", "legacy")] : []),
      ],
    },
  ];
}

function getRedesignedNavGroups(contextualMsSurfacesEnabled: boolean, cleanedAdminVisibilityEnabled: boolean): NavGroup[] {
  return [
    {
      heading: "MY WORK",
      section: "MY_WORK",
      icon: Zap,
      items: [
        makeNavItem("commandCenter", "redesigned"),
        makeNavItem("myWorkTasks", "redesigned"),
        makeNavItem("myWorkApprovals", "redesigned"),
        makeNavItem("myWorkCalendar", "redesigned"),
        makeNavItem("myWorkMeetings", "redesigned"),
        makeNavItem("myWorkEmail", "redesigned", contextualMsSurfacesEnabled ? { label: "Personal Email" } : {}),
        makeNavItem("myWorkTeams", "redesigned", contextualMsSurfacesEnabled ? { label: "Personal Teams Chat" } : {}),
      ],
    },
    { heading: "PROJECT DEVELOPMENT", section: "PROJECT_DEVELOPMENT", icon: Sun, items: [makeNavItem("pdDashboard", "redesigned"), makeNavItem("pdTickets", "redesigned"), makeNavItem("clients", "redesigned"), makeNavItem("lifecycle", "redesigned")] },
    { heading: "ENGINEERING", section: "ENGINEERING", icon: HardHat, items: [makeNavItem("engineering", "redesigned"), makeNavItem("engineeringTasks", "redesigned")] },
    { heading: "QUALITY", section: "QUALITY", icon: ShieldCheck, items: [makeNavItem("quality", "redesigned")] },
    {
      heading: "PROJECT MANAGEMENT",
      section: "PROJECT_MANAGEMENT",
      icon: Wind,
      items: [
        makeNavItem("projects", "redesigned"),
        makeNavItem("portfolios", "redesigned"),
        makeNavItem("dashboard", "redesigned"),
        makeNavItem("pmDashboard", "redesigned"),
        makeNavItem("weeklyReviews", "redesigned"),
      ],
    },
    {
      heading: "COMMERCIAL",
      section: "FINANCE",
      icon: Battery,
      items: [
        makeNavItem("cashflow", "redesigned"),
        makeNavItem("revenueTracker", "redesigned"),
        makeNavItem("cos", "redesigned"),
        makeNavItem("gpTracker", "redesigned"),
        makeNavItem("invoicePatterns", "redesigned"),
        makeNavItem("subcontractor", "redesigned"),
      ],
    },
    {
      heading: "SYSTEM",
      section: "SYSTEM",
      icon: CircuitBoard,
      items: cleanedAdminVisibilityEnabled
        ? [
            makeNavItem("adminControlCenter", "redesigned"),
            makeNavItem("adminRoles", "redesigned"),
            makeNavItem("adminSettings", "redesigned"),
            makeNavItem("adminImportControlTower", "redesigned"),
            makeNavItem("adminKpiTraceability", "redesigned"),
            makeNavItem("adminRecovery", "redesigned"),
            makeNavItem("adminActivity", "redesigned"),
          ]
        : [makeNavItem("adminControlCenter", "redesigned"), makeNavItem("adminRoles", "redesigned"), makeNavItem("adminSettings", "redesigned"), makeNavItem("adminActivity", "redesigned"), makeNavItem("smartImport", "redesigned"), makeNavItem("adminImportControlTower", "redesigned"), makeNavItem("adminRecovery", "redesigned"), makeNavItem("adminKpiTraceability", "redesigned"), makeNavItem("excelUpdates", "redesigned"), makeNavItem("eeInfo", "redesigned"), makeNavItem("companyPriorities", "redesigned"), makeNavItem("feedback", "redesigned"), makeNavItem("leaderboard", "redesigned")],
    },
  ];
}

function getUnifiedWorkNavGroups(contextualMsSurfacesEnabled: boolean, cleanedAdminVisibilityEnabled: boolean): NavGroup[] {
  const base = getRedesignedNavGroups(contextualMsSurfacesEnabled, cleanedAdminVisibilityEnabled);
  const result: NavGroup[] = [];

  for (const group of base) {
    if (group.section === "MY_WORK") {
      result.push({ ...group, items: [makeNavItem("myWork", "unified", { label: "Home" }), ...group.items] });
    } else {
      result.push(group);
    }
  }

  return result;
}

function getNavGroups(unifiedWorkEnabled: boolean, contextualMsSurfacesEnabled: boolean, cleanedAdminVisibilityEnabled: boolean): NavGroup[] {
  if (unifiedWorkEnabled && UX_REDESIGN_ENABLED) return getUnifiedWorkNavGroups(contextualMsSurfacesEnabled, cleanedAdminVisibilityEnabled);
  return UX_REDESIGN_ENABLED
    ? getRedesignedNavGroups(contextualMsSurfacesEnabled, cleanedAdminVisibilityEnabled)
    : getLegacyNavGroups(contextualMsSurfacesEnabled, cleanedAdminVisibilityEnabled);
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar_desktop_collapsed") === "true";
  });
  const [hasExplicitSidebarPreference, setHasExplicitSidebarPreference] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar_desktop_collapsed") !== null;
  });
  const [showValidationReport, setShowValidationReport] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  const [viewportWidth, setViewportWidth] = useState<number>(typeof window !== "undefined" ? window.innerWidth : 1440);
  
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

  const { data: rolloutFlags } = useQuery({
    queryKey: ["rollout-feature-flags"],
    queryFn: fetchRolloutFeatureFlags,
    staleTime: 60_000,
  });
  const roleAwareUxEnabled = rolloutFlags?.find((flag) => flag.key === "role_aware_ux")?.value === true;
  const contextualMsSurfacesEnabled = rolloutFlags?.find((flag) => flag.key === "contextual_ms_surfaces")?.value === true;
  const cleanedAdminVisibilityEnabled = rolloutFlags?.find((flag) => flag.key === "cleaned_admin_visibility")?.value === true;

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

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggleSection = (heading: string) => {
    setCollapsedSections(prev => {
      const next = { ...prev };
      if (next[heading] !== undefined) {
        next[heading] = !next[heading];
      } else {
        const groups = getNavGroups(!!unifiedWorkFlag, !!contextualMsSurfacesEnabled, !!cleanedAdminVisibilityEnabled);
        const group = groups.find(g => g.heading === heading);
        const currentSearch = window.location.search;
        const groupHasActive = group?.items.some(item => {
          const ip = item.path.split("?")[0];
          const iq = item.path.includes("?") ? item.path.split("?")[1] : null;
          if (iq) return location === ip && currentSearch === `?${iq}`;
          return location === item.path || (item.path === "/my-work" && (location.startsWith("/my-work") || location.startsWith("/my-tool"))) || (item.path !== "/" && item.path !== "/engineering" && location.startsWith(item.path));
        });
        next[heading] = !!groupHasActive;
      }
      return next;
    });
  };

  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const activeRole = companyRole || user?.role || null;

  const isLeadershipRole = LEADERSHIP_ROLES.has(activeRole ?? "");

  const setSidebarCollapsedPreference = (collapsed: boolean) => {
    setDesktopCollapsed(collapsed);
    setHasExplicitSidebarPreference(true);
    if (typeof window !== "undefined") localStorage.setItem("sidebar_desktop_collapsed", String(collapsed));
  };

  useEffect(() => {
    if (isLeadershipRole && !hasExplicitSidebarPreference) {
      setDesktopCollapsed(false);
    }
  }, [isLeadershipRole, hasExplicitSidebarPreference]);

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
  const isMobileViewport = viewportWidth < 768;
  const isTabletViewport = viewportWidth >= 768 && viewportWidth < 1280;
  const isDesktopViewport = viewportWidth >= 1280;
  const navGroups = (() => {
    const groups = getNavGroups(!!unifiedWorkFlag, !!contextualMsSurfacesEnabled, !!cleanedAdminVisibilityEnabled).map((group) => ({ ...group, items: [...group.items] }));
    if (!roleAwareUxEnabled) return groups;

    const sectionOrder = getRoleSectionPriority(activeRole);
    const sectionRank = new Map(sectionOrder.map((section, index) => [section, index]));

    const reordered = groups
      .map((group) => {
        const sortedItems = sortRoleAwareNavItems(group.items, activeRole) as NavItem[];
        return { ...group, items: sortedItems };
      })
      .sort((a, b) => (sectionRank.get(a.section as any) ?? 999) - (sectionRank.get(b.section as any) ?? 999));

    if (!isLeadershipRole) return reordered;

    const allNavItems = reordered.flatMap((group) => group.items);
    const byId = new Map(allNavItems.filter((item) => !!item.id).map((item) => [item.id as string, item]));
    const usedPaths = new Set<string>();

    const steeringItems = LEADERSHIP_PRIMARY_NAV_IDS
      .map((id) => byId.get(id))
      .filter((item): item is NavItem => !!item && !usedPaths.has(item.path))
      .map((item) => {
        usedPaths.add(item.path);
        return item;
      });

    const secondaryItems = reordered
      .filter((group) => group.section !== "SYSTEM")
      .flatMap((group) => group.items)
      .filter((item) => !usedPaths.has(item.path))
      .map((item) => {
        usedPaths.add(item.path);
        return item;
      });

    const systemItems = reordered
      .filter((group) => group.section === "SYSTEM")
      .flatMap((group) => group.items)
      .filter((item) => !usedPaths.has(item.path));

    return [
      { heading: "STEERING", section: "MY_WORK", icon: Zap, items: steeringItems },
      ...(secondaryItems.length > 0
        ? [{ heading: "SECONDARY", section: "PROJECT_MANAGEMENT", icon: Layers, items: secondaryItems }]
        : []),
      ...(systemItems.length > 0
        ? [{ heading: "SYSTEM", section: "SYSTEM", icon: CircuitBoard, items: systemItems }]
        : []),
    ];
  })();
  const allItems = navGroups.flatMap(g => g.items);
  const currentPageLabel = location === "/" ? "Home" : findPageByPath(location)?.label || allItems.find(i => i.path === location)?.label || "Dashboard";

  const sidebarShowLabels = mobileOpen || !desktopCollapsed;

  const isAdmin = ['COO_ADMIN', 'CEO_ADMIN'].includes(companyRole || '') || ['COO_ADMIN', 'CEO_ADMIN', 'admin'].includes(user?.role || '');

  const quickActions = [
    { label: "Approvals", path: "/my-work/approvals", icon: CheckCheck, permissionEntity: "my_work" },
    { label: "Updates", path: "/my-work/tasks", icon: RefreshCw, permissionEntity: "my_tool" },
    { label: "Upload", path: "/smart-import", icon: Upload, permissionEntity: "smart_import" },
    { label: "Escalate", path: "/feedback", icon: AlertTriangle, permissionEntity: "feedback" },
    { label: "From Microsoft", path: "/pd/tickets/create", icon: FileUp, permissionEntity: "project_development" },
  ].filter((action) => hasEntityViewPermission(action.path, activeRole, permissions?.entityPermissions));

  const navGroupsForViewport = navGroups.filter((group) => {
    if (!isMobileViewport) return true;
    return ["MY_WORK", "PROJECT_DEVELOPMENT", "PROJECT_MANAGEMENT", "SYSTEM"].includes(group.section);
  });

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
          {sidebarShowLabels && !isLeadershipRole && (
            <button
              onClick={() => {
                if (mobileOpen) setMobileOpen(false);
                else setSidebarCollapsedPreference(true);
              }}
              className="ml-auto p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5 overscroll-contain scrollbar-thin">
          {navGroupsForViewport.filter(group => {
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
                (item.path === "/my-work" && (location.startsWith("/my-work") || location.startsWith("/my-tool"))) || 
                (item.path !== "/" && item.path !== "/engineering" && location.startsWith(item.path)) ||
                (item.children && item.children.some(c => location === c.path || location.startsWith(c.path)));
            });

            const isCollapsed = sidebarShowLabels && (
              collapsedSections[group.heading] !== undefined
                ? collapsedSections[group.heading]
                : isMobileViewport
                  ? group.section !== "MY_WORK"
                  : isTabletViewport
                    ? !hasActiveItem && group.section !== "PROJECT_MANAGEMENT"
                    : !hasActiveItem
            );
            const sectionColor = SECTION_COLORS[group.section] || "text-muted-foreground";
            const isPrimarySection = !roleAwareUxEnabled || getRoleSectionPriority(activeRole).slice(0, 3).includes(group.section as any);

            return (
              <div key={group.heading} className={cn("pt-2 first:pt-1 transition-opacity", isPrimarySection ? "opacity-100" : "opacity-70") }>
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
                        : location === item.path || (item.path === "/my-work" && (location.startsWith("/my-work") || location.startsWith("/my-tool"))) || (item.path !== "/" && item.path !== "/engineering" && location.startsWith(item.path));
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
          "fixed inset-y-0 left-0 z-50 bg-white text-foreground flex flex-col border-r border-border shadow-lg transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] w-[280px] max-w-[85vw] md:hidden will-change-transform",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {sidebarContent}
      </aside>

      <aside 
        className={cn(
          "hidden md:flex bg-white text-foreground flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] border-r border-border z-20 will-change-[width]",
          desktopCollapsed ? "w-[68px]" : isLeadershipRole ? "w-[280px]" : "w-[240px]"
        )}
      >
        {sidebarContent}
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-background">
        <header className="h-14 md:h-14 border-b border-border bg-white flex items-center justify-between px-2 sm:px-3 md:px-6 sticky top-0 z-10">
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
              onClick={() => setSidebarCollapsedPreference(!desktopCollapsed)}
              className={cn("hidden md:inline-flex shrink-0", isLeadershipRole && !hasExplicitSidebarPreference ? "opacity-60" : "")}
              data-testid="btn-desktop-sidebar-toggle"
            >
              {desktopCollapsed ? <PanelLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <h1 className="text-base md:text-lg font-heading font-semibold text-foreground truncate">
              {currentPageLabel}
            </h1>
          </div>

          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            {isTabletViewport && (
              <Link href="/projects" className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1.5 rounded-md hover:bg-green-100 transition-colors">
                <FolderOpen className="w-3.5 h-3.5" />
                Switch Project
              </Link>
            )}
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

        {isMobileViewport && quickActions.length > 0 && (
          <div className="border-b border-border bg-white px-2 py-2 overflow-x-auto">
            <div className="flex gap-2 min-w-max">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.path}
                    href={action.path}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md px-2.5 py-1.5 hover:bg-green-100 transition-colors"
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {action.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 flex flex-col min-h-0">
          <div className={cn(
            "w-full mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300 flex-1 flex flex-col min-h-0 min-w-0 gap-4",
            isDesktopViewport ? "max-w-[1920px]" : isTabletViewport ? "max-w-[1280px]" : "max-w-full"
          )} data-page-content>
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
