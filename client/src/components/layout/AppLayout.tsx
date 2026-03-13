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

type TopSection = {
  label: string;
  path: string;
  match: (pathname: string) => boolean;
  secondary: { label: string; path: string }[];
};

const TOP_SECTIONS: TopSection[] = [
  { label: "Home", path: "/", match: (p) => p === "/" || p.startsWith("/my-work") || p.startsWith("/command-center") || p.startsWith("/my-tool"), secondary: [
    { label: "Command Center", path: "/command-center" },
    { label: "My Work", path: "/my-work" },
    { label: "Tasks", path: "/my-work/tasks" },
    { label: "Approvals", path: "/my-work/approvals" },
  ] },
  { label: "Projects", path: "/projects", match: (p) => p.startsWith("/projects") || p.startsWith("/project/"), secondary: [
    { label: "All Projects", path: "/projects" },
    { label: "Portfolios", path: "/portfolios" },
  ] },
  { label: "Project Development", path: "/pd/dashboard", match: (p) => p.startsWith("/pd/") || p.startsWith("/clients") || p.startsWith("/lifecycle-board"), secondary: [
    { label: "PD Dashboard", path: "/pd/dashboard" },
    { label: "PD Tickets", path: "/pd/tickets" },
    { label: "Clients", path: "/clients" },
    { label: "Lifecycle", path: "/lifecycle-board" },
  ] },
  { label: "Project Management", path: "/pm-dashboard", match: (p) => p.startsWith("/pm") || p.startsWith("/dashboard") || p.startsWith("/execution-board") || p.startsWith("/weekly-reviews"), secondary: [
    { label: "PM Dashboard", path: "/pm-dashboard" },
    { label: "Execution", path: "/dashboard" },
    { label: "On-The-Go", path: "/pm/on-the-go" },
    { label: "Weekly Reviews", path: "/weekly-reviews" },
  ] },
  { label: "Engineering", path: "/engineering", match: (p) => p.startsWith("/engineering"), secondary: [
    { label: "Overview", path: "/engineering" },
    { label: "Requests & Tasks", path: "/engineering/tasks" },
  ] },
  { label: "Quality", path: "/quality", match: (p) => p.startsWith("/quality"), secondary: [
    { label: "Quality Workspace", path: "/quality" },
  ] },
  { label: "Finance", path: "/cashflow", match: (p) => p.startsWith("/cashflow") || p.startsWith("/cos") || p.startsWith("/revenue") || p.startsWith("/gp-tracker") || p.startsWith("/invoice-patterns") || p.startsWith("/subcontractor-dashboard"), secondary: [
    { label: "Cashflow", path: "/cashflow" },
    { label: "Cost of Sales", path: "/cos" },
    { label: "Revenue", path: "/revenue-tracker" },
    { label: "Gross Profit", path: "/gp-tracker" },
    { label: "Procurement", path: "/subcontractor-dashboard" },
  ] },
  { label: "Knowledge", path: "/ee-info", match: (p) => p.startsWith("/ee-info") || p.startsWith("/leaderboard") || p.startsWith("/feedback"), secondary: [
    { label: "Lifecycle & SOP", path: "/ee-info" },
    { label: "Training Feedback", path: "/feedback" },
    { label: "Leaderboard", path: "/leaderboard" },
  ] },
  { label: "Admin", path: "/admin/control-center", match: (p) => p.startsWith("/admin") || p.startsWith("/settings"), secondary: [
    { label: "Control Center", path: "/admin/control-center" },
    { label: "Roles & Permissions", path: "/admin/roles" },
    { label: "System Settings", path: "/admin/settings" },
    { label: "Audit Log", path: "/admin/activity-log" },
  ] },
];

type SearchResult = { id: string; title: string; subtitle?: string; type: string; url?: string | null };

function linkIsActive(current: string, target: string) {
  if (target === "/") return current === "/";
  return current === target || current.startsWith(`${target}/`);
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  const activeSection = useMemo(() => TOP_SECTIONS.find((section) => section.match(location)) ?? TOP_SECTIONS[0], [location]);

  useEffect(() => {
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=12`, { credentials: "include" });
        const data = await res.json();
        setResults(Array.isArray(data?.results) ? data.results : []);
      } catch {
        setResults([]);
      } finally {
        setLoadingSearch(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const breadcrumbs = useMemo(() => {
    const leaf = activeSection.secondary.find((s) => linkIsActive(location, s.path));
    return [activeSection.label, leaf?.label].filter(Boolean) as string[];
  }, [activeSection, location]);

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
      <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur">
        <div className="px-4 lg:px-6 py-3 flex items-center gap-3">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px]">
              <SheetHeader><SheetTitle>Emergent Energy</SheetTitle></SheetHeader>
              <div className="mt-6 space-y-2">
                {TOP_SECTIONS.map((section) => (
                  <Link key={section.label} href={section.path} className={cn("block rounded-md px-3 py-2 text-sm", section.label === activeSection.label ? "bg-emerald-50 text-emerald-700" : "hover:bg-slate-50")}>{section.label}</Link>
                ))}
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
            <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search projects, work items, finance, documents, people" className="pl-9" />
            {(searchTerm.trim().length >= 2) && (
              <div className="absolute left-0 right-0 top-[105%] rounded-md border bg-white shadow-xl p-2 max-h-80 overflow-auto">
                {loadingSearch ? <p className="text-xs text-slate-500 p-2">Searching…</p> : Object.entries(groupedResults).map(([group, items]) => items.length > 0 ? (
                  <div key={group} className="mb-2">
                    <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-slate-500">{group}</p>
                    {items.map((item) => (
                      <Link key={item.id} href={item.url || activeSection.path} onClick={() => setSearchTerm("")} className="block rounded px-2 py-1.5 hover:bg-slate-50">
                        <p className="text-sm">{item.title}</p>
                        {item.subtitle ? <p className="text-xs text-slate-500 truncate">{item.subtitle}</p> : null}
                      </Link>
                    ))}
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
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Create</DropdownMenuLabel>
              <DropdownMenuItem asChild><Link href="/pd/tickets/create">New PD Ticket</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/engineering/tasks">Create Engineering Request</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/my-work/tasks">Create Task</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/projects">Start Handover</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/subcontractor-dashboard">Create PO</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/invoice-patterns">Link Invoice</Link></DropdownMenuItem>
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

        <nav className="hidden lg:flex px-6 border-t overflow-x-auto">
          {TOP_SECTIONS.map((section) => {
            const active = section.label === activeSection.label;
            return (
              <Link key={section.label} href={section.path} className={cn("px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap", active ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-600 hover:text-slate-900")}>{section.label}</Link>
            );
          })}
        </nav>

        <div className="px-4 lg:px-6 border-t bg-slate-50/70">
          <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
            {breadcrumbs.map((crumb, idx) => (
              <span key={crumb + idx} className="flex items-center gap-2">{idx > 0 ? <ChevronRight className="h-3 w-3" /> : null}<span>{crumb}</span></span>
            ))}
          </div>
          <div className="flex gap-1 overflow-x-auto pb-2">
            {activeSection.secondary.map((item) => (
              <Link key={item.path} href={item.path} className={cn("px-3 py-1.5 rounded-md text-sm whitespace-nowrap", linkIsActive(location, item.path) ? "bg-emerald-100 text-emerald-800" : "text-slate-600 hover:bg-slate-100")}>{item.label}</Link>
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
