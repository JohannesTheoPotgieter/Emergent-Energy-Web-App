import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Menu, Search, Plus, Calendar, Mail, MessageSquare, CalendarClock, ChevronRight, ChevronDown, Building2, UserCircle2, LogOut, X, Sun, Moon, Monitor, Home, MoreHorizontal } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buildVisibleTopSections, getAllowedSectionKeysForLens, getBreadcrumbs, linkIsActive } from "@/config/app-navigation";
import { getAvailableQuickCreateActions } from "@/lib/action-access";
import { useAccessMatrix } from "@/hooks/use-access-matrix";
import { useNavPreferences } from "@/hooks/use-nav-preferences";
import { NotificationBell } from "@/components/NotificationBell";
import { LensSwitcher } from "@/components/layout/LensSwitcher";
import { useLensContext } from "@/hooks/use-lens-context";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import { NavOnboardingTour } from "@/components/layout/NavOnboardingTour";
import { NavOrderCustomizer } from "@/components/layout/NavOrderCustomizer";
import { useTheme } from "@/hooks/use-theme";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { trackNavClick, trackPageView } from "@/lib/nav-analytics";

type SearchResult = { id: string; title: string; subtitle?: string; type: string; url?: string | null };

const MICROSOFT_SHORTCUTS = [
  { label: "Calendar", path: "/my-work/calendar", icon: Calendar },
  { label: "Email", path: "/my-work/email", icon: Mail },
  { label: "Meetings", path: "/my-work/meetings", icon: CalendarClock },
  { label: "Teams", path: "/my-work/teams", icon: MessageSquare },
] as const;

function isDirectResultUrl(url?: string | null) {
  return !!url && (url.startsWith("/") || url.startsWith("http://") || url.startsWith("https://"));
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [microsoftMenuOpen, setMicrosoftMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { canAccessEntityAction, canViewPath, disabledSubPages } = useAccessMatrix();
  const { theme, setTheme } = useTheme();
  const { isMobile, isTablet } = useBreakpoint();
  const { sectionOrder } = useNavPreferences();
  const lens = useLensContext();
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const subNavRef = useRef<HTMLDivElement>(null);

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchTerm("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-scroll sub-nav to active pill
  useEffect(() => {
    if (!subNavRef.current) return;
    const active = subNavRef.current.querySelector(".ee-subnav-pill-active");
    if (active) {
      active.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [location]);

  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const effectiveCompanyRole = companyRole || user?.role || null;

  // Derive allowed section keys from lens profile when simulating
  const lensAllowedSectionKeys = useMemo(() => {
    if (!lens.simulation) return null;
    const profile = lens.getActiveLensProfile();
    return getAllowedSectionKeysForLens(profile.allowedModules);
  }, [lens.simulation, lens.activeLens, lens.getActiveLensProfile]);

  const visibleSections = useMemo(() => {
    const sections = buildVisibleTopSections({
      canViewPath,
      companyRole: lens.simulation ? null : effectiveCompanyRole,
      allowedSectionKeys: lensAllowedSectionKeys,
      disabledSubPages: disabledSubPages,
    });
    // Apply user's custom section order if set
    if (sectionOrder.length > 0) {
      return [...sections].sort((a, b) => {
        const aIdx = sectionOrder.indexOf(a.label);
        const bIdx = sectionOrder.indexOf(b.label);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      });
    }
    return sections;
  }, [canViewPath, sectionOrder, effectiveCompanyRole, lensAllowedSectionKeys, lens.simulation, disabledSubPages]);

  // Redirect to the active lens's landing page on lens switch
  const prevLensRef = useRef(lens.activeLens);
  useEffect(() => {
    if (prevLensRef.current !== lens.activeLens) {
      prevLensRef.current = lens.activeLens;
      const profile = lens.getActiveLensProfile();
      navigate(profile.landingPage);
    }
  }, [lens.activeLens, lens.getActiveLensProfile, navigate]);

  const activeSection = useMemo(() => visibleSections.find((section) => section.match(location)) ?? visibleSections[0], [location, visibleSections]);
  const quickCreateActions = useMemo(() => {
    return getAvailableQuickCreateActions({ canAccessEntityAction, canViewPath });
  }, [canAccessEntityAction, canViewPath]);
  const microsoftShortcuts = useMemo(() => {
    return MICROSOFT_SHORTCUTS.filter((shortcut) => canViewPath(shortcut.path));
  }, [canViewPath]);

  // Track page views for analytics
  useEffect(() => {
    if (activeSection) {
      trackPageView(location, activeSection.label);
    }
  }, [location, activeSection]);

  useEffect(() => {
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingSearch(true);
      setSearchError(null);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=12`, { credentials: "include" });
        if (!res.ok) {
          throw new Error("Could not load search results. Try typing again or refresh this page. If this keeps happening, contact your admin.");
        }
        const data = await res.json();
        setResults(Array.isArray(data?.results) ? data.results : []);
      } catch {
        setResults([]);
        setSearchError("Search could not load. Try typing again or refresh this page. If this keeps happening, contact your admin.");
      } finally {
        setLoadingSearch(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const breadcrumbs = useMemo(() => getBreadcrumbs(location, activeSection), [activeSection, location]);

  const retrySearch = async () => {
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) return;
    setLoadingSearch(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=12`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setResults(Array.isArray(data?.results) ? data.results : []);
    } catch {
      setResults([]);
      setSearchError("Search could not load. Try again or refresh this page. If this keeps happening, contact your admin.");
    } finally {
      setLoadingSearch(false);
    }
  };

  const groupedResults = useMemo(() => {
    const map: Record<string, SearchResult[]> = {
      Projects: [],
      "Work Items": [],
      Finance: [],
      Documents: [],
      People: [],
    };

    for (const r of results) {
      if (r.type === "project") map.Projects.push(r);
      else if (["task", "engineering", "quality"].includes(r.type)) map["Work Items"].push(r);
      else if (["cost", "revenue", "po", "invoice"].includes(r.type)) map.Finance.push(r);
      else if (["document", "file"].includes(r.type)) map.Documents.push(r);
      else map.People.push(r);
    }

    return map;
  }, [results]);

  return (
    <div className="min-h-screen ee-shell">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium">Skip to content</a>
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur-lg">
        <div className="px-4 lg:px-6 py-2.5 flex items-center gap-3 mx-auto w-full max-w-[1440px]">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px] border-r border-border">
              <SheetHeader><SheetTitle>Emergent Energy</SheetTitle></SheetHeader>
              <div className="mt-6 space-y-2">
                {visibleSections.map((section) => {
                  const isActive = section.label === activeSection.label;
                  const hasMany = section.secondary.length >= 4;
                  return (
                    <div key={section.label} className="space-y-1">
                      <Link
                        href={section.path}
                        className={cn("block rounded-md px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
                        onClick={() => trackNavClick(section.label)}
                      >
                        {section.label}
                      </Link>
                      {isActive ? (
                        hasMany ? (
                          <MobileCollapsibleSubNav
                            items={section.secondary}
                            location={location}
                          />
                        ) : (
                          <div className="ml-3 border-l border-primary/30 pl-3 space-y-1">
                            {section.secondary.map((item) => (
                              item.disabled ? (
                                <span key={item.path} className="block rounded px-2 py-1.5 text-xs text-muted-foreground/60 cursor-not-allowed">{item.label}</span>
                              ) : (
                                <Link key={item.path} href={item.path} className={cn("block rounded px-2 py-1.5 text-xs", linkIsActive(location, item.path) ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60")}>{item.label}</Link>
                              )
                            ))}
                          </div>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>

          <Link href="/" className="flex items-center gap-2.5 min-w-fit">
            <img src="/emergent-logo.png" alt="Emergent Energy" className="h-7 w-auto object-contain" />
          </Link>

          <div className={cn("relative flex-1", isMobile ? "max-w-[42vw]" : "max-w-xl")} ref={searchContainerRef}>
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setSearchTerm(""); }}
              placeholder="Search projects, tasks, people..."
              className={cn("pl-9 pr-14 h-9 bg-muted/40 border-transparent hover:border-border focus-visible:border-border focus-visible:bg-background focus-visible:ring-ring/20 transition-colors", searchTerm && "pr-8 bg-background border-border")}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground border rounded px-1.5 py-0.5 bg-background/80">
              ⌘K / Ctrl+K
            </span>
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {searchTerm.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] rounded-lg border border-border/80 bg-background shadow-[var(--shadow-md)] p-1.5 max-h-96 overflow-auto" role="listbox" aria-live="polite">
                {loadingSearch ? (
                  <p className="text-xs text-muted-foreground p-2">Searching…</p>
                ) : searchError ? (
                  <div className="p-2 space-y-2">
                    <p className="text-xs text-red-700">{searchError}</p>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={retrySearch} data-testid="btn-retry-global-search">Retry</Button>
                  </div>
                ) : (
                  <>
                    {Object.entries(groupedResults).map(([group, items]) => items.length > 0 ? (
                      <div key={group} className="mb-2">
                        <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">{group}</p>
                        {items.map((item) => {
                          const hasLink = isDirectResultUrl(item.url);
                          if (!hasLink) {
                            return (
                              <div key={item.id} className="rounded px-2 py-2 text-muted-foreground/60 cursor-not-allowed">
                                <p className="text-sm">{item.title}</p>
                                {item.subtitle ? <p className="text-xs truncate">{item.subtitle}</p> : null}
                                <p className="text-[11px] mt-1">No direct link available yet</p>
                              </div>
                            );
                          }

                          return (
                            <Link key={item.id} href={item.url!} onClick={() => setSearchTerm("")} className="block rounded px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              <p className="text-sm">{item.title}</p>
                              {item.subtitle ? <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p> : null}
                            </Link>
                          );
                        })}
                      </div>
                    ) : null)}
                    {results.length === 0 ? <p className="text-xs text-muted-foreground p-2">No matches found. Try a project name, invoice number, or task keyword.</p> : null}
                  </>
                )}
              </div>
            )}
          </div>


          {microsoftShortcuts.length > 0 ? (
            <DropdownMenu open={microsoftMenuOpen} onOpenChange={setMicrosoftMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setMicrosoftMenuOpen((prev) => !prev)}>
                  <CalendarClock className="h-4 w-4" />
                  <span className="hidden xl:inline">Microsoft</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Microsoft Shortcuts</DropdownMenuLabel>
                {microsoftShortcuts.map((shortcut) => {
                  const Icon = shortcut.icon;
                  return (
                    <DropdownMenuItem key={shortcut.path} asChild>
                      <Link href={shortcut.path}><Icon className="h-4 w-4 mr-2" />{shortcut.label}</Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <LensSwitcher />
          <NotificationBell />

          <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2" onClick={() => setUserMenuOpen((prev) => !prev)} data-testid="button-user-menu">
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
                {lens.isCooSuperAdmin && !lens.simulation && (
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Super Admin</div>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Theme</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setTheme("light")}><Sun className="h-4 w-4 mr-2" />Light{theme === "light" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="h-4 w-4 mr-2" />Dark{theme === "dark" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}><Monitor className="h-4 w-4 mr-2" />System{theme === "system" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <NavOrderCustomizer visibleSections={visibleSections} />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logout()}><LogOut className="h-4 w-4 mr-2" />Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="hidden lg:block border-t border-border/50">
          <nav className="flex px-6 py-1 gap-0.5 overflow-x-auto mx-auto w-full max-w-[1440px]">
            {visibleSections.map((section) => {
              const active = section.label === activeSection.label;
              return (
                <Link
                  key={section.label}
                  href={section.path}
                  className={cn(
                    "relative px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors rounded-md",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                  onClick={() => trackNavClick(section.label)}
                >
                  {section.label}
                  {active && <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-primary rounded-full" />}
                </Link>
              );
            })}
          </nav>
        </div>

        {(breadcrumbs.length > 0 || activeSection.secondary.length > 0) && (
          <div className="border-t border-border/40 bg-muted/20">
            <div className="px-4 lg:px-6 mx-auto w-full max-w-[1440px]">
              {breadcrumbs.length > 0 && (
                <nav aria-label="breadcrumb" className="py-1.5">
                  <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <li className="inline-flex items-center">
                      <Link href="/" className="hover:text-foreground transition-colors inline-flex items-center" aria-label="Home">
                        <Home className="h-3.5 w-3.5" />
                      </Link>
                    </li>
                    {breadcrumbs.length <= 3 ? (
                      breadcrumbs.map((crumb, idx) => {
                        const isLast = idx === breadcrumbs.length - 1;
                        return (
                          <li key={crumb.label + idx} className="inline-flex items-center gap-1.5">
                            <ChevronRight className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
                            {isLast ? (
                              <span className="text-foreground font-medium max-w-[200px] truncate" title={crumb.label} aria-current="page">{crumb.label}</span>
                            ) : crumb.path ? (
                              <Link href={crumb.path} className="hover:text-foreground transition-colors">{crumb.label}</Link>
                            ) : (
                              <span>{crumb.label}</span>
                            )}
                          </li>
                        );
                      })
                    ) : (
                      <>
                        {/* First crumb */}
                        <li className="inline-flex items-center gap-1.5">
                          <ChevronRight className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
                          {breadcrumbs[0].path ? (
                            <Link href={breadcrumbs[0].path} className="hover:text-foreground transition-colors">{breadcrumbs[0].label}</Link>
                          ) : (
                            <span>{breadcrumbs[0].label}</span>
                          )}
                        </li>
                        {/* Collapsed middle items */}
                        <li className="inline-flex items-center gap-1.5">
                          <ChevronRight className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors" aria-label="Show collapsed breadcrumbs">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-1.5" align="start">
                              <div className="flex flex-col gap-0.5">
                                {breadcrumbs.slice(1, -1).map((crumb, idx) => (
                                  crumb.path ? (
                                    <Link key={idx} href={crumb.path} className="text-xs px-2 py-1 rounded hover:bg-muted transition-colors">{crumb.label}</Link>
                                  ) : (
                                    <span key={idx} className="text-xs px-2 py-1 text-muted-foreground">{crumb.label}</span>
                                  )
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        </li>
                        {/* Last crumb */}
                        <li className="inline-flex items-center gap-1.5">
                          <ChevronRight className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
                          <span className="text-foreground font-medium max-w-[200px] truncate" title={breadcrumbs[breadcrumbs.length - 1].label} aria-current="page">
                            {breadcrumbs[breadcrumbs.length - 1].label}
                          </span>
                        </li>
                      </>
                    )}
                  </ol>
                </nav>
              )}
              {activeSection.secondary.length > 0 && (
                <div
                  ref={subNavRef}
                  className={cn("flex gap-1.5 overflow-x-auto no-scrollbar pb-2", breadcrumbs.length > 0 ? "pt-0" : "pt-0.5")}
                  role="tablist"
                  aria-label={`${activeSection.label} navigation`}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                    const container = e.currentTarget;
                    const links = Array.from(container.querySelectorAll<HTMLElement>("a:not([aria-disabled])"));
                    const currentIdx = links.findIndex((el) => el === document.activeElement);
                    if (currentIdx === -1) return;
                    e.preventDefault();
                    const nextIdx = e.key === "ArrowRight"
                      ? (currentIdx + 1) % links.length
                      : (currentIdx - 1 + links.length) % links.length;
                    links[nextIdx]?.focus();
                  }}
                >
                  {activeSection.secondary.map((item) => (
                    item.disabled ? (
                      <span
                        key={item.path}
                        className="ee-subnav-pill cursor-not-allowed whitespace-nowrap opacity-55"
                        aria-disabled="true"
                        role="tab"
                      >
                        {item.label}
                      </span>
                    ) : (
                      <Link
                        key={item.path}
                        href={item.path}
                        className={cn(
                          "ee-subnav-pill whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          linkIsActive(location, item.path) ? "ee-subnav-pill-active" : "",
                        )}
                        role="tab"
                        aria-selected={linkIsActive(location, item.path)}
                        tabIndex={linkIsActive(location, item.path) ? 0 : -1}
                        onClick={() => trackNavClick(activeSection.label, item.label)}
                      >
                        {item.label}
                      </Link>
                    )
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Role-aware quick actions bar */}
      {lens.getActiveLensProfile().quickActions.length > 0 && location === "/" && (
        <div className="border-b border-border/40 bg-muted/10">
          <div className="px-4 lg:px-6 py-2 mx-auto w-full max-w-[1440px] flex items-center gap-3 overflow-x-auto">
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{lens.activeLensLabel}:</span>
            {lens.getActiveLensProfile().quickActions.map((action) => (
              <Link
                key={action.path}
                href={action.path}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-background border border-border/60 text-foreground hover:bg-muted/60 hover:border-border transition-colors whitespace-nowrap"
              >
                {action.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* COO simulation banner */}
      {lens.simulation && (
        <div className="border-b border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
          <div className="px-4 lg:px-6 py-1.5 mx-auto w-full max-w-[1440px] flex items-center justify-between">
            <span className="text-xs text-amber-800 dark:text-amber-200">
              Simulating <strong>{lens.activeLensLabel}</strong> view ({lens.simulation.mode === "read_only" ? "read-only" : "full power"})
            </span>
            <button
              onClick={() => lens.stopSimulation()}
              className="text-xs text-amber-700 dark:text-amber-300 underline hover:no-underline"
            >
              Exit simulation
            </button>
          </div>
        </div>
      )}

      <main id="main-content" className={cn("px-4 lg:px-6 py-5", isTablet && "pb-24")}>{children}</main>
      <GlobalCommandPalette />
      <NavOnboardingTour />
    </div>
  );
}

/** Collapsible sub-nav for mobile drawer — shows first 2 items, collapses the rest */
function MobileCollapsibleSubNav({ items, location }: { items: { label: string; path: string; disabled?: boolean }[]; location: string }) {
  const [open, setOpen] = useState(false);
  const visible = items.slice(0, 2);
  const hidden = items.slice(2);

  return (
    <div className="ml-3 border-l border-primary/30 pl-3 space-y-1">
      {visible.map((item) => (
        item.disabled ? (
          <span key={item.path} className="block rounded px-2 py-1.5 text-xs text-muted-foreground/60 cursor-not-allowed">{item.label}</span>
        ) : (
          <Link key={item.path} href={item.path} className={cn("block rounded px-2 py-1.5 text-xs", linkIsActive(location, item.path) ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60")}>{item.label}</Link>
        )
      ))}
      {hidden.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleContent>
            <div className="space-y-1">
              {hidden.map((item) => (
                item.disabled ? (
                  <span key={item.path} className="block rounded px-2 py-1.5 text-xs text-muted-foreground/60 cursor-not-allowed">{item.label}</span>
                ) : (
                  <Link key={item.path} href={item.path} className={cn("block rounded px-2 py-1.5 text-xs", linkIsActive(location, item.path) ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60")}>{item.label}</Link>
                )
              ))}
            </div>
          </CollapsibleContent>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 px-2 py-1 text-[11px] text-primary hover:underline">
              <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
              {open ? "Show less" : `+${hidden.length} more`}
            </button>
          </CollapsibleTrigger>
        </Collapsible>
      )}
    </div>
  );
}
