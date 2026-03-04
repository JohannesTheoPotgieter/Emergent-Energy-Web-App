import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import {
  Target,
  CalendarDays,
  ListTodo,
  Settings,
  HelpCircle,
} from "lucide-react";

const navTabs = [
  { label: "Today", path: "/my-tool", icon: Target },
  { label: "Week", path: "/my-tool/week", icon: CalendarDays },
  { label: "Backlog", path: "/my-tool/backlog", icon: ListTodo },
  { label: "Settings", path: "/my-tool/settings", icon: Settings },
];

export default function MyToolNav({ subtitle }: { subtitle?: string }) {
  const { user } = useAuth();
  const [location] = useLocation();

  return (
    <header className="space-y-3" data-testid="mytool-header">
      <div className="flex items-end justify-between">
        <div className="flex items-center gap-2">
          <h1
            className="text-2xl font-bold tracking-tight text-foreground"
            data-testid="text-page-title"
          >
            My Tool
          </h1>
          <Link
            href="/my-tool/help"
            className="text-gray-400 hover:text-blue-600 transition-colors mt-1"
            title="Help & Guide"
            data-testid="nav-help-icon"
          >
            <HelpCircle className="h-5 w-5" />
          </Link>
          {subtitle && (
            <p
              className="text-sm text-muted-foreground mt-0.5"
              data-testid="text-subtitle"
            >
              {subtitle}
            </p>
          )}
        </div>
        {user && (
          <p className="text-sm text-gray-400" data-testid="text-user-greeting">
            {format(new Date(), "EEEE d MMM")}
          </p>
        )}
      </div>
      <nav
        className="flex gap-0.5 border-b border-border"
        data-testid="nav-tabs"
      >
        {navTabs.map((tab) => {
          const isActive =
            location === tab.path ||
            (tab.path === "/my-tool" && location === "/my-tool");
          return (
            <Link
              key={tab.path}
              href={tab.path}
              data-testid={`nav-tab-${tab.label.toLowerCase()}`}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
