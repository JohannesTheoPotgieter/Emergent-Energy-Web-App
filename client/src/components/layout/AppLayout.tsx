import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Menu, Search, Plus, Bell, Calendar, Mail, MessageSquare, CalendarClock, ChevronRight, Building2, UserCircle2, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildVisibleTopSections, getBreadcrumbs, linkIsActive } from "@/config/app-navigation";
import { getAvailableQuickCreateActions } from "@/lib/action-access";
import { useAccessMatrix } from "@/hooks/use-access-matrix";

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
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="px-4 lg:px-6 py-2.5 flex items-center gap-2.5">
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

          <Link href="/" className="flex items-center gap-3 min-w-fit">
            <img src="/emergent-logo.png" alt="Emergent Energy" className="h-7 w-auto object-contain" />
            <div className="hidden lg:block">
              <p className="text-xs text-muted-foreground">{activeSection.label}</p>
            </div>
          </Link>

          <div className="relative flex-1 max-w-2xl">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search projects, work items, finance, documents, people" className="pl-9 border-input focus-visible:ring-ring/30" />
            {searchTerm.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-[105%] rounded-lg border border-border bg-background shadow-[var(--shadow-md)] p-2 max-h-96 overflow-auto">
                {loadingSearch ? (
                  <p className="text-xs text-muted-foreground p-2">Searching across projects, work items, and finance…</p>
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

          {quickCreateActions.length > 0 ? (
            <DropdownMenu open={quickCreateOpen} onOpenChange={setQuickCreateOpen}>
              <DropdownMenuTrigger asChild>
                <Button onClick={() => setQuickCreateOpen((prev) => !prev)} onMouseEnter={() => setQuickCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />Quick Create</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Create</DropdownMenuLabel>
                {quickCreateActions.map((action) => (
                  <DropdownMenuItem key={action.id} asChild>
                    <Link href={action.path}>{action.label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {microsoftShortcuts.length > 0 ? (
            <DropdownMenu open={microsoftMenuOpen} onOpenChange={setMicrosoftMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setMicrosoftMenuOpen((prev) => !prev)}><CalendarClock className="h-4 w-4" /></Button>
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
                <Avatar className="h-7 w-7"><AvatarFallback>{user?.username?.slice(0, 2)?.toUpperCase() || "EE"}</AvatarFallback></Avatar>
                <span className="hidden md:inline text-sm text-foreground">{user?.username || "User"}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="space-y-1">
                <div className="font-medium flex items-center gap-2"><UserCircle2 className="h-4 w-4" />{user?.username || "User"}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" />{user?.role || "role"}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logout()}><LogOut className="h-4 w-4 mr-2" />Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className="hidden lg:flex px-6 border-t border-border overflow-x-auto">
          {visibleSections.map((section) => {
            const active = section.label === activeSection.label;
            return (
              <Link
                key={section.label}
                href={section.path}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                  active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 lg:px-6 border-t border-border bg-muted/40">
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, idx) => (
              <span key={crumb + idx} className="flex items-center gap-2">{idx > 0 ? <ChevronRight className="h-3 w-3" /> : null}<span>{crumb}</span></span>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-2.5">
            {activeSection.secondary.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={cn(
                  "px-3.5 py-1.5 rounded-md border text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  linkIsActive(location, item.path)
                    ? "border-primary/30 bg-primary/15 text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-background",
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <main className="p-4 lg:p-6">{children}</main>

      <div className="fixed bottom-4 right-4 lg:hidden">
        <Badge className="bg-primary"><Bell className="h-3 w-3 mr-1" />Actions Active</Badge>
      </div>
    </div>
  );
}
