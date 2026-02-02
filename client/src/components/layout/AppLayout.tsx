import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  FileSpreadsheet, 
  Wallet, 
  TrendingUp, 
  ShoppingCart, 
  ShieldCheck, 
  HardHat, 
  ClipboardList, 
  Settings,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Upload,
  Database
} from "lucide-react";
import { useProgramData } from "@/hooks/use-program-data";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { DatabaseStatusBanner } from "@/components/DatabaseStatusBanner";
import { UploadValidationReport } from "@/components/UploadValidationReport";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showValidationReport, setShowValidationReport] = useState(false);
  const { data, overview, refreshData, isLoading, importFiles, lastUploadResult } = useProgramData();
  const { user, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Fetch health status to show DB mode
  const { data: healthStatus } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await fetch("/api/health");
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const navItems = [
    { label: "Overview", icon: LayoutDashboard, path: "/" },
    { label: "Projects Summary", icon: FileSpreadsheet, path: "/projects" },
    { label: "Cashflow", icon: Wallet, path: "/cashflow" },
    { label: "Revenue", icon: TrendingUp, path: "/revenue" },
    { label: "COS", icon: TrendingUp, path: "/cos", className: "rotate-180" },
    { label: "Upload", icon: Upload, path: "/upload" },
  ];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      await importFiles(filesArray);
      setShowValidationReport(true);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* Sidebar */}
      <aside 
        className={cn(
          "bg-sidebar text-sidebar-foreground flex flex-col transition-all duration-300 border-r border-sidebar-border shadow-xl z-20",
          sidebarOpen ? "w-64 translate-x-0" : "w-20 -translate-x-full md:translate-x-0 md:w-20"
        )}
      >
        <div className="h-16 flex items-center px-4 border-b border-sidebar-border bg-sidebar/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded bg-sidebar-primary flex items-center justify-center shrink-0">
                <img src="/logo.png" className="w-6 h-6 object-contain brightness-0 invert" alt="Logo" />
             </div>
             {sidebarOpen && <span className="font-heading font-bold text-lg tracking-wide whitespace-nowrap">EMERGENT</span>}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {navItems.map((item) => {
            if (item.adminOnly && user?.role !== 'admin') return null;
            return (
              <Link key={item.path} href={item.path}>
                <a className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 group",
                  location === item.path 
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-md" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}>
                  <item.icon className={cn("w-5 h-5 shrink-0", item.className)} />
                  {sidebarOpen && <span>{item.label}</span>}
                </a>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3">
            <Avatar className="w-9 h-9 border border-sidebar-border/50">
              <AvatarFallback>{user?.name.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <p className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</p>
              </div>
            )}
             {sidebarOpen && (
               <Button 
                 variant="ghost" 
                 size="icon" 
                 className="h-8 w-8 text-sidebar-foreground/50 hover:text-white"
                 onClick={logout}
               >
                 <LogOut className="w-4 h-4" />
               </Button>
             )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-background/50">
        {/* Header */}
        <header className="h-16 border-b bg-background flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="flex items-center gap-4">
             <Button 
               variant="ghost" 
               size="icon" 
               onClick={() => setSidebarOpen(!sidebarOpen)}
               className="md:hidden"
             >
               <Menu className="w-5 h-5" />
             </Button>
             <h1 className="text-xl font-heading font-semibold text-foreground hidden sm:block">
               {navItems.find(i => i.path === location)?.label || "Dashboard"}
             </h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative hidden md:block w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search projects..." className="pl-9 h-9 bg-muted/30 border-none focus-visible:ring-1" />
            </div>
            
            <div className="h-8 w-px bg-border mx-2" />

            <div className="flex flex-col items-end mr-2">
               <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">DB Mode</span>
               <div className="flex items-center gap-1">
                 <Database className="w-3 h-3 text-muted-foreground" />
                 <span className="text-xs font-mono font-medium text-foreground">
                   {healthStatus?.dbMode === 'postgres' ? 'Postgres' : healthStatus?.dbMode === 'sqlite' ? 'SQLite' : 'Unknown'}
                 </span>
               </div>
            </div>

            <div className="h-8 w-px bg-border mx-2 hidden lg:block" />

            <div className="flex-col items-end mr-2 hidden lg:flex">
               <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Data As Of</span>
               <span className="text-xs font-mono font-medium text-foreground">
                 {overview?.data_as_of ? format(new Date(overview.data_as_of), "dd MMM HH:mm") : "No data"}
               </span>
            </div>
            
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".xlsx,.xls,.xlsm"
              multiple
              onChange={handleFileUpload}
            />
            
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className={cn("gap-2 border-primary/20 text-primary hover:bg-primary/5")}
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">Upload Tracker</span>
            </Button>

            <Button 
              size="sm" 
              onClick={refreshData} 
              disabled={isLoading}
              className={cn("gap-2 transition-all", isLoading && "opacity-80")}
            >
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
              <span className="hidden sm:inline">{isLoading ? "Refreshing..." : "Refresh"}</span>
            </Button>
          </div>
        </header>

        {/* Scrollable Page Content */}
        <div className="flex-1 overflow-auto p-6 scroll-smooth">
          <div className="max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
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
