import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { 
  LayoutDashboard, 
  FileSpreadsheet, 
  Wallet, 
  TrendingUp,
  Target,
  BarChart3,
  Kanban,
  AlertTriangle,
  Settings,
  ArrowRight,
} from "lucide-react";

interface QuickLink {
  label: string;
  description: string;
  icon: any;
  path: string;
  color: string;
  bg: string;
}

const currentLinks: QuickLink[] = [
  { 
    label: "Dashboard", 
    description: "High-priority actions, milestones, and PM summary", 
    icon: LayoutDashboard, 
    path: "/dashboard",
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 hover:border-blue-400",
  },
  { 
    label: "Project Summary", 
    description: "All projects with progress, financials, and status", 
    icon: FileSpreadsheet, 
    path: "/projects",
    color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 hover:border-emerald-400",
  },
  { 
    label: "Cashflow", 
    description: "Weekly cashflow with inflow/outflow detail and forecast", 
    icon: Wallet, 
    path: "/cashflow",
    color: "text-violet-600",
    bg: "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 hover:border-violet-400",
  },
  { 
    label: "COS Tracker", 
    description: "Monthly cost of sales: planned vs realised vs budget", 
    icon: TrendingUp, 
    path: "/cos",
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 hover:border-amber-400",
  },
];

const wipLinks: QuickLink[] = [
  { 
    label: "COS Control", 
    description: "What-if scenario analysis for invoice date shifting", 
    icon: Target, 
    path: "/cos-control",
    color: "text-rose-600",
    bg: "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 hover:border-rose-400",
  },
  { 
    label: "Forecast", 
    description: "Line-item driven weekly cashflow forecast", 
    icon: BarChart3, 
    path: "/cashflow-forecast",
    color: "text-cyan-600",
    bg: "bg-cyan-50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-800 hover:border-cyan-400",
  },
  { 
    label: "Planning", 
    description: "Resource capacity, scheduling, and clash detection", 
    icon: Kanban, 
    path: "/planning",
    color: "text-indigo-600",
    bg: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 hover:border-indigo-400",
  },
  { 
    label: "Risks & Flags", 
    description: "Data quality issues and actionable risk flags", 
    icon: AlertTriangle, 
    path: "/risks-flags",
    color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800 hover:border-orange-400",
  },
];

function NavTile({ link }: { link: QuickLink }) {
  return (
    <Link href={link.path} data-testid={`tile-${link.label.toLowerCase().replace(/\s+/g, '-')}`}>
      <Card className={`${link.bg} border transition-all duration-200 cursor-pointer hover:shadow-md group h-full`}>
        <CardContent className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className={`p-2.5 rounded-lg bg-white/60 dark:bg-white/10 ${link.color}`}>
              <link.icon className="h-6 w-6" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div>
            <h3 className="font-semibold text-base">{link.label}</h3>
            <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{link.description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function Home() {
  return (
    <div className="space-y-8" data-testid="home-page">
      <div>
        <h1 className="text-3xl font-bold">Emergent Energy Dashboard</h1>
        <p className="text-muted-foreground mt-1">Navigate to the section you need below.</p>
      </div>

      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Current</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {currentLinks.map((link) => (
            <NavTile key={link.path} link={link} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Work in Progress</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {wipLinks.map((link) => (
            <NavTile key={link.path} link={link} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Admin</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NavTile link={{
            label: "Admin",
            description: "Upload trackers, manage users, and system settings",
            icon: Settings,
            path: "/admin",
            color: "text-slate-600",
            bg: "bg-slate-50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800 hover:border-slate-400",
          }} />
        </div>
      </div>
    </div>
  );
}
