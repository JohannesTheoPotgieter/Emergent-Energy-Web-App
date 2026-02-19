import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, AlertTriangle, TrendingUp, Calendar, Shield } from "lucide-react";
import { format, addDays, isAfter, isBefore, parseISO } from "date-fns";

interface LensSection {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
}

const SECTIONS: LensSection[] = [
  { key: "risks", label: "Top Risks", icon: <AlertTriangle className="h-3 w-3" />, color: "text-red-600" },
  { key: "finance", label: "Finance Alerts", icon: <TrendingUp className="h-3 w-3" />, color: "text-amber-600" },
  { key: "milestones", label: "Milestones (7d)", icon: <Calendar className="h-3 w-3" />, color: "text-blue-600" },
];

interface HighPriorityData {
  overdueExpenses?: any[];
  revenueOutstanding?: any[];
  dataSeverity?: any[];
  riskFlags?: any[];
}

export default function CooLens() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const today = new Date();
  const nextWeek = addDays(today, 7);

  const { data: highPriority } = useQuery<HighPriorityData>({
    queryKey: ["/api/dashboard/high-priority"],
    staleTime: 60000,
  });

  const { data: projectPlans = [] } = useQuery<any[]>({
    queryKey: ["/api/project-plans"],
    staleTime: 60000,
    select: (data: any) => {
      if (!Array.isArray(data)) return [];
      return data.filter((p: any) => {
        if (!p.endDate && !p.startDate) return false;
        const date = p.endDate || p.startDate;
        try {
          const d = parseISO(date);
          return isAfter(d, today) && isBefore(d, nextWeek);
        } catch {
          return false;
        }
      }).slice(0, 5);
    },
  });

  const riskAlerts = [
    ...(highPriority?.riskFlags || []).slice(0, 2),
    ...(highPriority?.dataSeverity || []).filter((d: any) => d.severity === "critical").slice(0, 2),
  ].slice(0, 4).map((item: any, idx: number) => ({
    id: item.id || idx,
    title: item.message || item.flag || item.title || "Risk flag",
    severity: item.severity || "high",
    projectName: item.projectName || null,
  }));

  const financeAlerts = [
    ...(highPriority?.overdueExpenses || []).slice(0, 2).map((e: any) => ({
      id: e.id,
      title: `Overdue: ${e.lineItem || e.invoiceNumber || "payment"} — R${Math.round(e.amount / 1000)}K`,
      projectName: e.projectName,
    })),
    ...(highPriority?.revenueOutstanding || []).slice(0, 2).map((r: any) => ({
      id: r.id,
      title: `Revenue: ${r.milestoneName || r.invoiceNumber || "outstanding"} — R${Math.round(r.amount / 1000)}K`,
      projectName: r.projectName,
    })),
  ].slice(0, 4);

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
          : projectPlans;

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
              <span className="text-[10px] text-muted-foreground">{items.length}</span>
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
                          ? item.severity === "critical" ? "bg-red-500" : "bg-amber-500"
                          : section.key === "finance"
                          ? "bg-amber-500"
                          : "bg-blue-500"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-foreground/90">
                          {item.title || item.taskName || item.message || "Untitled"}
                        </p>
                        {section.key === "milestones" && item.endDate && (
                          <p className="text-[10px] text-muted-foreground">
                            {format(parseISO(item.endDate), "d MMM")}
                          </p>
                        )}
                        {(section.key === "risks" || section.key === "finance") && item.projectName && (
                          <p className="text-[10px] text-muted-foreground truncate">{item.projectName}</p>
                        )}
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
