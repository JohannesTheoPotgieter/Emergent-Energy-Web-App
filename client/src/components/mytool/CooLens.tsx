import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, AlertTriangle, TrendingUp, Calendar, Shield, Clock } from "lucide-react";
import { format, parseISO } from "date-fns";

interface LensSection {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
}

const SECTIONS: LensSection[] = [
  { key: "risks", label: "Top Risks", icon: <AlertTriangle className="h-3 w-3" />, color: "text-red-600" },
  { key: "finance", label: "Finance Alerts", icon: <TrendingUp className="h-3 w-3" />, color: "text-amber-600" },
  { key: "overdue", label: "Overdue Tasks", icon: <Clock className="h-3 w-3" />, color: "text-orange-600" },
  { key: "milestones", label: "Milestones (7d)", icon: <Calendar className="h-3 w-3" />, color: "text-blue-600" },
];

interface HighPriorityData {
  overdueExpenses?: any[];
  revenueOutstanding?: any[];
  projectsBehindPlan?: any[];
  upcomingMilestones?: any[];
  overdueTasks?: any[];
}

export default function CooLens() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: highPriority } = useQuery<HighPriorityData>({
    queryKey: ["/api/dashboard/high-priority"],
    staleTime: 60000,
  });

  const riskAlerts = (highPriority?.projectsBehindPlan || []).slice(0, 6).map((item: any, idx: number) => ({
    id: idx,
    title: `${cleanProjectName(item.projectName)}: ${Math.round(Math.abs(item.delta) * 100)}% behind plan`,
    severity: item.severity?.toLowerCase() || "high",
    projectName: cleanProjectName(item.projectName),
    pm: item.pm,
    avgActual: item.avgActual != null ? Math.round(item.avgActual * 100) : null,
    avgExpected: item.avgExpected != null ? Math.round(item.avgExpected * 100) : null,
  }));

  const financeAlerts = [
    ...(highPriority?.overdueExpenses || []).slice(0, 3).map((e: any) => ({
      id: e.id,
      title: `Overdue: ${e.lineItem || e.invoiceNumber || "payment"} — R${Math.round(e.amount / 1000)}K`,
      projectName: cleanProjectName(e.projectName),
    })),
    ...(highPriority?.revenueOutstanding || []).slice(0, 3).map((r: any) => ({
      id: `rev-${r.id}`,
      title: `Revenue: ${r.milestoneName || r.invoiceNumber || "outstanding"} — R${Math.round(r.amount / 1000)}K`,
      projectName: cleanProjectName(r.projectName),
    })),
  ].slice(0, 6);

  const overdueTasks = (highPriority?.overdueTasks || []).slice(0, 8).map((t: any) => ({
    id: t.id,
    title: `${t.taskName} (${t.percentComplete}% done)`,
    projectName: cleanProjectName(t.projectName),
    endDate: t.endDate,
  }));

  const milestones = (highPriority?.upcomingMilestones || []).slice(0, 6).map((m: any, idx: number) => ({
    id: idx,
    title: `${m.milestoneType}`,
    projectName: cleanProjectName(m.projectName),
    date: m.date,
    pm: m.pm,
  }));

  const toggle = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-1" data-testid="coo-lens-widget">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <Shield className="h-3 w-3 text-indigo-600" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">COO Lens</span>
      </div>

      {SECTIONS.map(section => {
        const isOpen = !collapsed[section.key];
        const items = section.key === "risks" ? riskAlerts
          : section.key === "finance" ? financeAlerts
          : section.key === "overdue" ? overdueTasks
          : milestones;

        return (
          <div key={section.key} data-testid={`lens-section-${section.key}`}>
            <button
              onClick={() => toggle(section.key)}
              className="flex items-center gap-1.5 w-full px-2 py-1 hover:bg-muted/50 rounded text-left transition-colors"
              data-testid={`lens-toggle-${section.key}`}
            >
              {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <span className={`${section.color}`}>{section.icon}</span>
              <span className="text-[11px] font-medium flex-1">{section.label}</span>
              <span className={`text-[10px] font-medium ${items.length > 0 ? section.color : 'text-muted-foreground'}`}>{items.length}</span>
            </button>

            {isOpen && (
              <div className="pl-6 pr-2 space-y-0.5 pb-1">
                {items.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground py-1">None</p>
                ) : (
                  items.map((item: any, idx: number) => (
                    <div
                      key={item.id || idx}
                      className="flex items-start gap-1.5 py-0.5 text-[11px] group"
                      data-testid={`lens-item-${section.key}-${idx}`}
                    >
                      <span className={`inline-block w-1 h-1 rounded-full mt-1.5 shrink-0 ${
                        section.key === "risks"
                          ? item.severity === "critical" ? "bg-red-500" : item.severity === "high" ? "bg-orange-500" : "bg-amber-500"
                          : section.key === "finance"
                          ? "bg-amber-500"
                          : section.key === "overdue"
                          ? "bg-orange-500"
                          : "bg-blue-500"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-foreground/90">{item.title}</p>
                        <div className="flex items-center gap-2">
                          {item.projectName && (
                            <p className="text-[10px] text-muted-foreground truncate">{item.projectName}</p>
                          )}
                          {section.key === "milestones" && item.date && (
                            <p className="text-[10px] text-muted-foreground shrink-0">
                              {formatDate(item.date)}
                            </p>
                          )}
                          {section.key === "overdue" && item.endDate && (
                            <p className="text-[10px] text-red-500 shrink-0">
                              due {formatDate(item.endDate)}
                            </p>
                          )}
                          {section.key === "risks" && item.pm && (
                            <p className="text-[10px] text-muted-foreground shrink-0">PM: {item.pm}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function cleanProjectName(name: string): string {
  if (!name) return "";
  return name.replace(/_Tracker$/, "").replace(/_/g, " ");
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "d MMM");
  } catch {
    return dateStr;
  }
}
