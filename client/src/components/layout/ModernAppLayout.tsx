import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Menu, Search, Home, ChevronRight, MoreHorizontal, UserCircle2, Building2, LogOut,
  Sun, Moon, Monitor, MonitorSmartphone, Laptop, Smartphone, PanelLeft,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAccessMatrix } from "@/hooks/use-access-matrix";
import { useScreenAvailability } from "@/hooks/use-screen-availability";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useTheme } from "@/hooks/use-theme";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useLensContext } from "@/hooks/use-lens-context";
import { useModernNav } from "@/hooks/use-modern-nav";
import { useNavFavorites } from "@/hooks/use-nav-favorites";
import { buildNavTree, findActiveNavItem, getNavBreadcrumbs, type NavItem } from "@/config/nav-tree";
import { NavIcon } from "@/lib/nav-icons";
import { SidebarNav } from "@/components/layout/SidebarNav";
import { LensSwitcher } from "@/components/layout/LensSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { ConnectorModeBanner } from "@/components/ConnectorModeBanner";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { trackNavClick, trackPageView } from "@/lib/nav-analytics";

const COLLAPSE_KEY = "ee_nav_collapsed";

function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("ee:open-command-palette"));
}

export default function ModernAppLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();
  const { canViewPath } = useAccessMatrix();
  const { isScreenEnabled } = useScreenAvailability();
  const { isMobile, isTablet } = useBreakpoint();
  const { theme, setTheme } = useTheme();
  const { mode: layoutMode, setMode: setLayoutMode } = useLayoutMode();
  const lens = useLensContext();
  const { setEnabled: setModernNav } = useModernNav();
  const { pinned, recents, isPinned, togglePin, recordVisit } = useNavFavorites();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(COLLAPSE_KEY) === "true";
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const groups = useMemo(
    () => buildNavTree({ canViewPath, isScreenEnabled }),
    [canViewPath, isScreenEnabled],
  );
  const active = useMemo(() => findActiveNavItem(location, groups), [location, groups]);
  const breadcrumbs = useMemo(() => getNavBreadcrumbs(location, groups), [location, groups]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Record the active top-level destination for the Recent list.
  useEffect(() => {
    if (active && active.item.path === location.split("?")[0]) {
      recordVisit({ path: active.item.path, label: active.item.label });
    }
  }, [active, location, recordVisit]);

  // Close the mobile drawer on navigation.
  useEffect(() => { setMobileNavOpen(false); }, [location]);

  // Analytics parity with the classic layout.
  useEffect(() => {
    if (active) trackPageView(location, active.group.heading);
  }, [location, active]);

  // Redirect to the active lens's landing page on lens switch (ported from AppLayout).
  const prevLensRef = useRef(lens.activeLens);
  useEffect(() => {
    if (prevLensRef.current !== lens.activeLens) {
      prevLensRef.current = lens.activeLens;
      navigate(lens.getActiveLensProfile().landingPage);
    }
  }, [lens.activeLens, lens.getActiveLensProfile, navigate]);

  const onNavigate = (item: { path: string; label: string }) => {
    trackNavClick(item.label);
    recordVisit({ path: item.path, label: item.label });
  };

  // Bottom-bar destinations: Home + the first item of each subsequent domain.
  const bottomEntries = useMemo(() => {
    const out: Array<{ item: NavItem; groupKey: string }> = [];
    const home = groups.find((g) => g.key === "MY_WORK")?.items[0];
    if (home) out.push({ item: home, groupKey: "MY_WORK" });
    for (const g of groups) {
      if (g.key === "MY_WORK" || !g.items[0]) continue;
      out.push({ item: g.items[0], groupKey: g.key });
      if (out.length >= 4) break;
    }
    return out.slice(0, 4);
  }, [groups]);

  const sidebar = (
    <SidebarNav
      groups={groups}
      location={location}
      collapsed={collapsed && !isMobile}
      onToggleCollapsed={toggleCollapsed}
      pinned={pinned}
      recents={recents}
      isPinned={isPinned}
      onTogglePin={togglePin}
      onOpenSearch={openCommandPalette}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="min-h-[100dvh] ee-shell flex">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium">Skip to content</a>

      {/* Desktop sidebar */}
      {!isMobile && (
        <aside
          className={cn(
            "sticky top-0 h-[100dvh] shrink-0 border-r border-sidebar-border transition-[width] duration-200",
            collapsed ? "w-[60px]" : "w-60",
          )}
          data-testid="app-sidebar"
        >
          {sidebar}
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectorModeBanner />
        <header className="sticky top-0 z-40 border-b border-border/50 bg-background/[0.92] ee-header-glass">
          <div className="flex min-w-0 items-center gap-2.5 px-3 sm:px-4 lg:px-6 py-2">
            {isMobile && (
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="button-mobile-menu" aria-label="Open navigation menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[290px] border-r border-sidebar-border p-0" data-testid="nav-mobile-sheet">
                  <SheetHeader className="px-4 pt-4 pb-2 border-b border-sidebar-border">
                    <SheetTitle className="flex items-center gap-2">
                      <img src="/emergent-leaf.png" alt="" className="h-6 w-6 object-contain" />
                      <span>Emergent Energy</span>
                    </SheetTitle>
                  </SheetHeader>
                  <div className="h-[calc(100dvh-57px)]">{sidebar}</div>
                </SheetContent>
              </Sheet>
            )}

            <Link href="/" className="flex items-center min-w-fit group" aria-label="Emergent Energy home">
              <img src="/emergent-leaf.png" alt="Emergent Energy" className="sm:hidden h-7 w-7 object-contain" />
              <img src="/emergent-logo.png" alt="Emergent Energy" className="hidden sm:block h-7 w-auto object-contain" />
            </Link>

            {/* Search — opens the command palette (single "go anywhere" surface) */}
            <button
              type="button"
              onClick={openCommandPalette}
              data-testid="header-search-trigger"
              className="group flex h-9 min-w-0 flex-1 max-w-[42rem] items-center gap-2 rounded-md border border-transparent bg-muted/35 px-3 text-sm text-muted-foreground transition-colors hover:border-border"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate text-left">{isMobile ? "Search…" : "Search projects, pages, people…"}</span>
              <kbd className="hidden rounded border bg-background/80 px-1.5 py-0.5 text-[10px] xl:block">⌘K</kbd>
            </button>

            <LensSwitcher />
            <NotificationBell />

            <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2" data-testid="button-user-menu">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">{user?.username?.slice(0, 2)?.toUpperCase() || "EE"}</AvatarFallback>
                  </Avatar>
                  <span className="hidden md:inline text-sm text-foreground">{user?.username || "User"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="space-y-1">
                  <div className="font-medium flex items-center gap-2"><UserCircle2 className="h-4 w-4" />{user?.username || "User"}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" />{lens.activeLensLabel}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Theme</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setTheme("light")}><Sun className="h-4 w-4 mr-2" />Light{theme === "light" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="h-4 w-4 mr-2" />Dark{theme === "dark" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("system")}><Monitor className="h-4 w-4 mr-2" />System{theme === "system" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Layout</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setLayoutMode("auto")}><MonitorSmartphone className="h-4 w-4 mr-2" />Auto{layoutMode === "auto" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLayoutMode("desktop")}><Laptop className="h-4 w-4 mr-2" />Force desktop{layoutMode === "desktop" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLayoutMode("mobile")}><Smartphone className="h-4 w-4 mr-2" />Force mobile{layoutMode === "mobile" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setModernNav(false)} data-testid="switch-classic-nav"><PanelLeft className="h-4 w-4 mr-2" />Classic navigation</DropdownMenuItem>
                <DropdownMenuItem onClick={() => logout()}><LogOut className="h-4 w-4 mr-2" />Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Breadcrumbs */}
          {breadcrumbs.length > 0 && (
            <div className="border-t border-border/30 bg-[hsl(var(--surface-tint))]/30">
              <nav aria-label="breadcrumb" className="px-4 lg:px-6 py-1.5">
                <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <li className="inline-flex items-center">
                    <Link href="/" className="hover:text-foreground transition-colors inline-flex items-center" aria-label="Home"><Home className="h-3.5 w-3.5" /></Link>
                  </li>
                  {breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === breadcrumbs.length - 1;
                    return (
                      <li key={crumb.label + idx} className="inline-flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
                        {isLast ? (
                          <span className="text-foreground font-medium max-w-[220px] truncate" title={crumb.label} aria-current="page">{crumb.label}</span>
                        ) : crumb.path ? (
                          <Link href={crumb.path} className="hover:text-foreground transition-colors">{crumb.label}</Link>
                        ) : (
                          <span>{crumb.label}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            </div>
          )}
        </header>

        {/* COO simulation banner */}
        {lens.simulation && (
          <div className="border-b border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
            <div className="px-4 lg:px-6 py-1.5 flex items-center justify-between">
              <span className="text-xs text-amber-800 dark:text-amber-200">
                Simulating <strong>{lens.activeLensLabel}</strong> view ({lens.simulation.mode === "read_only" ? "read-only" : "full power"})
              </span>
              <button onClick={() => lens.stopSimulation()} className="text-xs text-amber-700 dark:text-amber-300 underline hover:no-underline">Exit simulation</button>
            </div>
          </div>
        )}

        <main id="main-content" className={cn("flex-1 px-3 sm:px-4 lg:px-6 py-4 lg:py-5", (isMobile || isTablet) && "pb-24")}>
          {children}
        </main>

        {/* Mobile bottom bar */}
        {isMobile && (
          <nav className="ee-bottom-nav" aria-label="Primary navigation" data-testid="nav-bottom-mobile">
            {bottomEntries.map(({ item, groupKey }) => {
              const isActive = active?.group.key === groupKey;
              return (
                <Link
                  key={item.id}
                  href={item.path}
                  className={cn("ee-bottom-nav-item", isActive && "ee-bottom-nav-item-active")}
                  onClick={() => onNavigate(item)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="ee-bottom-nav-icon-wrap"><NavIcon iconKey={item.iconKey} className="h-[22px] w-[22px]" /></span>
                  <span className="ee-bottom-nav-label">{item.label}</span>
                </Link>
              );
            })}
            <button type="button" className="ee-bottom-nav-item" onClick={() => setMobileNavOpen(true)} aria-label="More navigation options">
              <span className="ee-bottom-nav-icon-wrap"><MoreHorizontal className="h-[22px] w-[22px]" aria-hidden="true" /></span>
              <span className="ee-bottom-nav-label">More</span>
            </button>
          </nav>
        )}
      </div>

      <GlobalCommandPalette />
      <KeyboardShortcutsDialog />
      <KeyboardNavActivator />
    </div>
  );
}

function KeyboardNavActivator() {
  useKeyboardNav();
  return null;
}
