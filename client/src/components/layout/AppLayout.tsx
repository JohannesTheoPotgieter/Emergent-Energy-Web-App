import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Menu, Search, Plus, Bell, Calendar, Mail, MessageSquare, CalendarClock, ChevronRight, Building2, UserCircle2, LogOut, X, Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildVisibleTopSections, getBreadcrumbs, linkIsActive } from "@/config/app-navigation";
import { getAvailableQuickCreateActions } from "@/lib/action-access";
import { useAccessMatrix } from "@/hooks/use-access-matrix";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import { useTheme } from "@/hooks/use-theme";

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
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [microsoftMenuOpen, setMicrosoftMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { canAccessEntityAction, canViewPath } = useAccessMatrix();
  const { theme, setTheme } = useTheme();
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

  const visibleSections = useMemo(() => {
    return buildVisibleTopSections({ canViewPath });
  }, [canViewPath]);

  const activeSection = useMemo(() => visibleSections.find((section) => section.match(location)) ?? visibleSections[0], [location, visibleSections]);
  const quickCreateActions = useMemo(() => {
    return getAvailableQuickCreateActions({ canAccessEntityAction, canViewPath });
  }, [canAccessEntityAction, canViewPath]);
  const microsoftShortcuts = useMemo(() => {
    return MICROSOFT_SHORTCUTS.filter((shortcut) => canViewPath(shortcut.path));
  }, [canViewPath]);

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
        <div className="px-4 lg:px-6 py-2.5 flex items-center gap-3">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px] border-r border-border">
              <SheetHeader><SheetTitle>Emergent Energy</SheetTitle></SheetHeader>
              <div className="mt-6 space-y-2">
                {visibleSections.map((section) => {
                  const isActive = section.label === activeSection.label;
                  return (
                    <div key={section.label} className="space-y-1">
                      <Link href={section.path} className={cn("block rounded-md px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>{section.label}</Link>
                      {isActive ? (
                        <div className="ml-3 border-l border-primary/30 pl-3 space-y-1">
                          {section.secondary.map((item) => (
                            item.disabled ? (
                              <span key={item.path} className="block rounded px-2 py-1.5 text-xs text-muted-foreground/60 cursor-not-allowed">{item.label}</span>
                            ) : (
                              <Link key={item.path} href={item.path} className={cn("block rounded px-2 py-1.5 text-xs", linkIsActive(location, item.path) ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60")}>{item.label}</Link>
                            )
                          ))}
                        </div>
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

          <div className="relative flex-1 max-w-xl" ref={searchContainerRef}>
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setSearchTerm(""); }}
              placeholder="Search..."
              className={cn("pl-9 h-9 bg-muted/40 border-transparent hover:border-border focus-visible:border-border focus-visible:bg-background focus-visible:ring-ring/20 transition-colors", searchTerm && "pr-8 bg-background border-border")}
            />
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
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" />{user?.role || "role"}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Theme</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setTheme("light")}><Sun className="h-4 w-4 mr-2" />Light{theme === "light" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="h-4 w-4 mr-2" />Dark{theme === "dark" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}><Monitor className="h-4 w-4 mr-2" />System{theme === "system" && <span className="ml-auto text-primary text-xs">Active</span>}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logout()}><LogOut className="h-4 w-4 mr-2" />Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className="hidden lg:flex px-6 py-1 gap-0.5 border-t border-border/50 overflow-x-auto">
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
              >
                {section.label}
                {active && <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-primary rounded-full" />}
              </Link>
            );
          })}
        </nav>

        {(breadcrumbs.length > 0 || activeSection.secondary.length > 0) && (
          <div className="px-4 lg:px-6 border-t border-border/40 bg-muted/20">
            {breadcrumbs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 py-1.5 text-xs text-muted-foreground">
                <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
                {breadcrumbs.map((crumb, idx) => (
                  <span key={crumb.label + idx} className="flex items-center gap-1.5">
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    {crumb.path ? (
                      <Link href={crumb.path} className="hover:text-foreground transition-colors">{crumb.label}</Link>
                    ) : (
                      <span className="text-foreground font-medium">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
            {activeSection.secondary.length > 0 && (
              <div ref={subNavRef} className="flex gap-1.5 overflow-x-auto pb-2 pt-0.5">
                {activeSection.secondary.map((item) => (
                  item.disabled ? (
                    <span
                      key={item.path}
                      className="ee-subnav-pill cursor-not-allowed whitespace-nowrap opacity-55"
                      aria-disabled="true"
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
                    >
                      {item.label}
                    </Link>
                  )
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      <main id="main-content" className="p-4 lg:p-6">{children}</main>
      <GlobalCommandPalette />
    </div>
  );
}
