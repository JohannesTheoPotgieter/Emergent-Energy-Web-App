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

type SecondaryItem = { label: string; path: string; disabled?: boolean };
type TopSection = {
  label: string;
  path: string;
  match: (pathname: string) => boolean;
  secondary: SecondaryItem[];
};

type SearchResult = { id: string; title: string; subtitle?: string; type: string; url?: string | null };

function matchesPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function startsWithAny(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => matchesPathPrefix(pathname, prefix));
}

const TOP_SECTIONS: TopSection[] = [
  {
    label: "Home",
    path: "/",
    match: (p) => p === "/" || startsWithAny(p, ["/my-work", "/command-center", "/my-tool"]),
    secondary: [
      { label: "Command Center", path: "/command-center" },
      { label: "My Work", path: "/my-work" },
      { label: "Tasks", path: "/my-work/tasks" },
      { label: "Approvals", path: "/my-work/approvals" },
    ],
  },
  {
    label: "Projects",
    path: "/projects",
    match: (p) => matchesPathPrefix(p, "/projects") || matchesPathPrefix(p, "/project") || matchesPathPrefix(p, "/portfolios"),
    secondary: [
      { label: "All Projects", path: "/projects" },
      { label: "Portfolios", path: "/portfolios" },
    ],
  },
  {
    label: "Project Development",
    path: "/pd",
    match: (p) => startsWithAny(p, ["/pd", "/clients", "/lifecycle-board"]),
    secondary: [
      { label: "PD Dashboard", path: "/pd" },
      { label: "PD Tickets", path: "/pd/tickets" },
      { label: "Clients", path: "/clients" },
      { label: "Lifecycle", path: "/lifecycle-board" },
    ],
  },
  {
    label: "Project Management",
    path: "/pm-dashboard",
    match: (p) => p === "/pm-dashboard" || startsWithAny(p, ["/pm/on-the-go", "/execution-board", "/weekly-reviews"]),
    secondary: [
      { label: "PM Dashboard", path: "/pm-dashboard" },
      { label: "Execution", path: "/execution-board" },
      { label: "On-The-Go", path: "/pm/on-the-go" },
      { label: "Weekly Reviews", path: "/weekly-reviews" },
    ],
  },
  {
    label: "Engineering",
    path: "/engineering",
    match: (p) => startsWithAny(p, ["/engineering"]),
    secondary: [
      { label: "Overview", path: "/engineering" },
      { label: "Requests & Tasks", path: "/engineering/tasks" },
    ],
  },
  {
    label: "Quality",
    path: "/quality",
    match: (p) => startsWithAny(p, ["/quality"]),
    secondary: [{ label: "Quality Workspace", path: "/quality" }],
  },
  {
    label: "Finance",
    path: "/cashflow",
    match: (p) => startsWithAny(p, ["/cashflow", "/cos", "/revenue-tracker", "/gp-tracker", "/invoice-patterns", "/subcontractor-dashboard"]),
    secondary: [
      { label: "Cashflow", path: "/cashflow" },
      { label: "Cost of Sales", path: "/cos" },
      { label: "Revenue", path: "/revenue-tracker" },
      { label: "Gross Profit", path: "/gp-tracker" },
      { label: "Procurement", path: "/subcontractor-dashboard" },
    ],
  },
  {
    label: "Knowledge",
    path: "/ee-info",
    match: (p) => startsWithAny(p, ["/ee-info", "/leaderboard", "/feedback", "/training", "/knowledge-game", "/department-scores"]),
    secondary: [
      { label: "Lifecycle & SOP", path: "/ee-info" },
      { label: "Leaderboard", path: "/leaderboard" },
      { label: "Training", path: "/training" },
      { label: "Knowledge Game", path: "/knowledge-game" },
      { label: "Department Scores", path: "/department-scores" },
      { label: "Feedback", path: "/feedback" },
    ],
  },
  {
    label: "Admin",
    path: "/admin/control-center",
    match: (p) => startsWithAny(p, ["/admin", "/settings"]),
    secondary: [
      { label: "Control Center", path: "/admin/control-center" },
      { label: "Roles & Permissions", path: "/admin/roles" },
      { label: "System Settings", path: "/admin/settings" },
      { label: "Audit Log", path: "/admin/activity-log" },
    ],
  },
];

const QUICK_CREATE_ACTIONS: Array<{ label: string; path: string }> = [
  { label: "New PD Ticket", path: "/pd/tickets/create" },
  { label: "Create Engineering Request", path: "/actions/launchpad?action=engineering-request" },
  { label: "Create Task", path: "/actions/launchpad?action=task" },
  { label: "Start Handover", path: "/actions/launchpad?action=handover" },
  { label: "Create PO", path: "/actions/launchpad?action=create-po" },
  { label: "Link Invoice", path: "/actions/launchpad?action=link-invoice" },
];

function linkIsActive(current: string, target: string) {
  if (target === "/") return current === "/";
  return current === target || current.startsWith(`${target}/`);
}

function getBreadcrumbs(pathname: string, activeSection: TopSection) {
  if (pathname === "/") return ["Home"];

  const projectMatch = pathname.match(/^\/project\/([^/]+)/);
  if (projectMatch) return ["Projects", decodeURIComponent(projectMatch[1])];

  const portfolioMatch = pathname.match(/^\/portfolios\/([^/]+)/);
  if (portfolioMatch) return ["Projects", "Portfolios", decodeURIComponent(portfolioMatch[1])];

  if (pathname === "/pd/tickets/create") return ["Project Development", "PD Tickets", "Create"];

  const ticketMatch = pathname.match(/^\/pd\/tickets\/([^/]+)/);
  if (ticketMatch) return ["Project Development", "PD Tickets", `Ticket ${decodeURIComponent(ticketMatch[1])}`];

  const leaf = activeSection.secondary.find((s) => linkIsActive(pathname, s.path));
  return [activeSection.label, leaf?.label].filter(Boolean) as string[];
}

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

  const activeSection = useMemo(() => TOP_SECTIONS.find((section) => section.match(location)) ?? TOP_SECTIONS[0], [location]);

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
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200/90 bg-white/95 shadow-sm backdrop-blur">
        <div className="px-4 lg:px-6 py-3 flex items-center gap-3">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px]">
              <SheetHeader><SheetTitle>Emergent Energy</SheetTitle></SheetHeader>
              <div className="mt-6 space-y-2">
                {TOP_SECTIONS.map((section) => {
                  const isActive = section.label === activeSection.label;
                  return (
                    <div key={section.label} className="space-y-1">
                      <Link href={section.path} className={cn("block rounded-md px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-emerald-50 text-emerald-700" : "text-slate-700 hover:bg-slate-50")}>{section.label}</Link>
                      {isActive ? (
                        <div className="ml-3 border-l border-emerald-200 pl-3 space-y-1">
                          {section.secondary.map((item) => (
                            item.disabled ? (
                              <span key={item.path} className="block rounded px-2 py-1.5 text-xs text-slate-400 cursor-not-allowed">{item.label}</span>
                            ) : (
                              <Link key={item.path} href={item.path} className={cn("block rounded px-2 py-1.5 text-xs", linkIsActive(location, item.path) ? "bg-emerald-100 text-emerald-800" : "text-slate-600 hover:bg-slate-100")}>{item.label}</Link>
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

          <Link href="/" className="flex items-center gap-2 min-w-fit">
            <div className="h-8 w-8 rounded bg-emerald-600 text-white grid place-items-center text-xs font-bold">EE</div>
            <div className="hidden md:block">
              <p className="text-sm font-semibold leading-none">Emergent Energy OS</p>
              <p className="text-xs text-slate-500">{activeSection.label}</p>
            </div>
          </Link>

          <div className="relative flex-1 max-w-xl">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search projects, work items, finance, documents, people" className="pl-9 border-slate-200 focus-visible:ring-emerald-600" />
            {searchTerm.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-[105%] rounded-xl border border-slate-200 bg-white shadow-xl p-2 max-h-96 overflow-auto">
                {loadingSearch ? <p className="text-xs text-slate-500 p-2">Searching…</p> : searchError ? <p className="text-xs text-red-600 p-2">{searchError}</p> : Object.entries(groupedResults).map(([group, items]) => items.length > 0 ? (
                  <div key={group} className="mb-2">
                    <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-slate-500">{group}</p>
                    {items.map((item) => {
                      const hasLink = isDirectResultUrl(item.url);
                      if (!hasLink) {
                        return (
                          <div key={item.id} className="rounded px-2 py-2 text-slate-400 cursor-not-allowed">
                            <p className="text-sm">{item.title}</p>
                            {item.subtitle ? <p className="text-xs truncate">{item.subtitle}</p> : null}
                            <p className="text-[11px] mt-1">No direct link available yet</p>
                          </div>
                        );
                      }

                      return (
                        <Link key={item.id} href={item.url!} onClick={() => setSearchTerm("")} className="block rounded px-2 py-2 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                          <p className="text-sm">{item.title}</p>
                          {item.subtitle ? <p className="text-xs text-slate-500 truncate">{item.subtitle}</p> : null}
                        </Link>
                      );
                    })}
                  </div>
                ) : null)}
                {!loadingSearch && results.length === 0 ? <p className="text-xs text-slate-500 p-2">No matches found.</p> : null}
              </div>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4 mr-1" />Quick Create</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Create</DropdownMenuLabel>
              {QUICK_CREATE_ACTIONS.map((action) => (
                <DropdownMenuItem key={action.label} asChild>
                  <Link href={action.path}>{action.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon"><CalendarClock className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Microsoft Shortcuts</DropdownMenuLabel>
              <DropdownMenuItem asChild><Link href="/my-work/calendar"><Calendar className="h-4 w-4 mr-2" />Calendar</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/my-work/email"><Mail className="h-4 w-4 mr-2" />Email</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/my-work/meetings"><CalendarClock className="h-4 w-4 mr-2" />Meetings</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/my-work/teams"><MessageSquare className="h-4 w-4 mr-2" />Teams</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <NotificationBell />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                <Avatar className="h-7 w-7"><AvatarFallback>{user?.username?.slice(0, 2)?.toUpperCase() || "EE"}</AvatarFallback></Avatar>
                <span className="hidden md:inline text-sm">{user?.username || "User"}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="space-y-1">
                <div className="font-medium flex items-center gap-2"><UserCircle2 className="h-4 w-4" />{user?.username || "User"}</div>
                <div className="text-xs text-slate-500 flex items-center gap-1"><Building2 className="h-3 w-3" />{user?.role || "role"}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logout()}><LogOut className="h-4 w-4 mr-2" />Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className="hidden lg:flex px-6 border-t border-slate-200 overflow-x-auto scrollbar-thin">
          {TOP_SECTIONS.map((section) => {
            const active = section.label === activeSection.label;
            return (
              <Link
                key={section.label}
                href={section.path}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                  active ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-600 hover:text-slate-900",
                )}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 lg:px-6 border-t border-slate-200 bg-slate-50/70">
          <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
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
                  "px-3.5 py-1.5 rounded-md border text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                  linkIsActive(location, item.path)
                    ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                    : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white",
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
        <Badge className="bg-emerald-600"><Bell className="h-3 w-3 mr-1" />Actions Active</Badge>
      </div>
    </div>
  );
}
