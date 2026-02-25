import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Loader2, CheckCircle2, Clock, AlertTriangle, FileText, Search,
  ChevronDown, ChevronRight, DollarSign, TrendingDown, Activity, Target,
} from "lucide-react";

interface MonthlyRealisationTabProps {
  projectName: string;
}

interface ExpenseItem {
  id: number;
  expenseCategory: string | null;
  expenseLineItem: string | null;
  supplierName: string | null;
  expensePoNumber: string | null;
  expenseInvoiceNumber: string | null;
  expenseInvoicedDate: string | null;
  expensePaymentDate: string | null;
  actualCosTotal: string | number | null;
  cosStatus: string;
  computedCosStatus: string;
  paymentStatus: string;
  cosOverride: { reason: string; overrideStatus: string; originalStatus: string } | null;
}

function formatRand(val: number | null | undefined): string {
  if (val == null || val === 0) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

function formatRandFull(val: number): string {
  if (val === 0) return "-";
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  iconBg: string;
  iconColor: string;
  valueColor: string;
  borderColor: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  icon: typeof CheckCircle2;
}> = {
  "COS Realised": {
    label: "COS Realised",
    color: "text-slate-900",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-800",
    valueColor: "text-slate-900 font-black",
    borderColor: "border-slate-300",
    badgeBg: "bg-green-50",
    badgeBorder: "border-green-200",
    badgeText: "text-green-700",
    icon: CheckCircle2,
  },
  "Deferred": {
    label: "Deferred",
    color: "text-amber-700",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    valueColor: "text-amber-700",
    borderColor: "border-amber-200",
    badgeBg: "bg-amber-50",
    badgeBorder: "border-amber-200",
    badgeText: "text-amber-700",
    icon: Clock,
  },
  "Flagged": {
    label: "Flagged",
    color: "text-red-600",
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    valueColor: "text-red-600",
    borderColor: "border-red-200",
    badgeBg: "bg-red-50",
    badgeBorder: "border-red-200",
    badgeText: "text-red-700",
    icon: AlertTriangle,
  },
  "Planned": {
    label: "Planned",
    color: "text-blue-700",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    valueColor: "text-blue-700",
    borderColor: "",
    badgeBg: "bg-blue-50",
    badgeBorder: "border-blue-200",
    badgeText: "text-blue-700",
    icon: FileText,
  },
};

export function MonthlyRealisationTab({ projectName }: MonthlyRealisationTabProps) {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["expenditure-breakdown", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/expenditure-breakdown/${encodeURIComponent(projectName)}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!projectName,
  });

  const items: ExpenseItem[] = data?.items || [];

  const { summary, filtered, categoryGroups } = useMemo(() => {
    const summary = {
      "COS Realised": { count: 0, value: 0 },
      "Deferred": { count: 0, value: 0 },
      "Flagged": { count: 0, value: 0 },
      "Planned": { count: 0, value: 0 },
    };

    for (const item of items) {
      const status = item.cosStatus || "Planned";
      const val = parseFloat(String(item.actualCosTotal || "0")) || 0;
      if (summary[status as keyof typeof summary]) {
        summary[status as keyof typeof summary].count += 1;
        summary[status as keyof typeof summary].value += val;
      }
    }

    let filtered = items;
    if (activeFilter) {
      filtered = filtered.filter(i => i.cosStatus === activeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(i =>
        (i.expenseLineItem || "").toLowerCase().includes(q) ||
        (i.supplierName || "").toLowerCase().includes(q) ||
        (i.expenseCategory || "").toLowerCase().includes(q) ||
        (i.expensePoNumber || "").toLowerCase().includes(q) ||
        (i.expenseInvoiceNumber || "").toLowerCase().includes(q)
      );
    }

    const categoryGroups = new Map<string, ExpenseItem[]>();
    for (const item of filtered) {
      const cat = item.expenseCategory || "Uncategorized";
      if (!categoryGroups.has(cat)) categoryGroups.set(cat, []);
      categoryGroups.get(cat)!.push(item);
    }

    return { summary, filtered, categoryGroups };
  }, [items, activeFilter, search]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const totalCOS = Object.values(summary).reduce((s, v) => s + v.value, 0);
  const totalItems = Object.values(summary).reduce((s, v) => s + v.count, 0);
  const realisedPct = totalCOS > 0 ? ((summary["COS Realised"].value / totalCOS) * 100).toFixed(1) : "0.0";

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3" data-testid="loading-cos-tracker">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        <span className="text-sm font-medium">Loading COS data...</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-12">
          <p className="text-center text-muted-foreground" data-testid="no-cos-data">
            No expenditure data available. Import a tracker file to populate the COS tracker.
          </p>
        </CardContent>
      </Card>
    );
  }

  const kpiCards = [
    {
      id: "cos-realised",
      status: "COS Realised",
      label: "COS Realised (Paid)",
      value: formatRand(summary["COS Realised"].value),
      count: summary["COS Realised"].count,
      icon: TrendingDown,
      iconBg: "bg-slate-100",
      iconColor: "text-slate-800",
      valueColor: "text-slate-900 font-black",
      borderColor: "border-slate-300",
    },
    {
      id: "cos-deferred",
      status: "Deferred",
      label: "Deferred",
      value: formatRand(summary["Deferred"].value),
      count: summary["Deferred"].count,
      icon: Clock,
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      valueColor: "text-amber-700",
      borderColor: "border-amber-200",
    },
    {
      id: "cos-flagged",
      status: "Flagged",
      label: "Flagged",
      value: formatRand(summary["Flagged"].value),
      count: summary["Flagged"].count,
      icon: AlertTriangle,
      iconBg: "bg-red-100",
      iconColor: "text-red-600",
      valueColor: "text-red-600",
      borderColor: "border-red-200",
    },
    {
      id: "cos-planned",
      status: "Planned",
      label: "Planned",
      value: formatRand(summary["Planned"].value),
      count: summary["Planned"].count,
      icon: FileText,
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      valueColor: "text-blue-700",
      borderColor: "",
    },
    {
      id: "cos-total",
      status: null,
      label: "Total COS",
      value: formatRand(totalCOS),
      count: totalItems,
      icon: DollarSign,
      iconBg: "bg-slate-100",
      iconColor: "text-slate-600",
      valueColor: "text-slate-900",
      borderColor: "",
    },
    {
      id: "cos-realised-pct",
      status: null,
      label: "Realised %",
      value: `${realisedPct}%`,
      count: null,
      icon: Target,
      iconBg: parseFloat(realisedPct) >= 50 ? "bg-green-100" : "bg-amber-100",
      iconColor: parseFloat(realisedPct) >= 50 ? "text-green-600" : "text-amber-600",
      valueColor: parseFloat(realisedPct) >= 50 ? "text-green-600" : "text-amber-700",
      borderColor: parseFloat(realisedPct) >= 50 ? "border-green-200" : "border-amber-200",
    },
  ];

  return (
    <div className="space-y-6" data-testid="cos-tracker-tab">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((kpi) => {
          const isActive = kpi.status && activeFilter === kpi.status;
          return (
            <Card
              key={kpi.id}
              className={`shadow-sm transition-all ${kpi.status ? "cursor-pointer hover:shadow-md" : ""} ${isActive ? `ring-2 ring-offset-1 ring-slate-400` : ""} ${kpi.borderColor}`}
              onClick={kpi.status ? () => setActiveFilter(isActive ? null : kpi.status) : undefined}
              data-testid={`card-${kpi.id}`}
            >
              <CardContent className="pt-5 pb-4 px-4">
                <div className="flex items-start gap-3">
                  <div className={`rounded-xl ${kpi.iconBg} p-2.5 shrink-0`}>
                    <kpi.icon className={`h-5 w-5 ${kpi.iconColor}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500 truncate">{kpi.label}</p>
                    <p className={`text-xl font-bold font-mono mt-0.5 ${kpi.valueColor}`} data-testid={`text-${kpi.id}-value`}>
                      {kpi.value}
                    </p>
                    {kpi.count !== null && (
                      <p className="text-[11px] text-slate-400 mt-0.5">{kpi.count} items</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search by description, supplier, PO, or invoice..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm border-slate-200"
            data-testid="cos-search"
          />
        </div>
        {activeFilter && (
          <Button size="sm" variant="ghost" className="h-9 text-sm text-slate-500" onClick={() => setActiveFilter(null)} data-testid="cos-clear-filter">
            Clear filter
          </Button>
        )}
        <span className="text-xs text-slate-400 ml-auto">
          Showing {filtered.length} of {totalItems} items
        </span>
      </div>

      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-white border-b px-6 py-4">
          <CardTitle className="text-lg font-semibold tracking-tight">COS Tracker — {projectName}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-cos-tracker">
              <thead>
                <tr className="border-b bg-slate-50/80">
                  <th className="px-5 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider text-[11px] min-w-[220px]">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                    Supplier
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                    PO #
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                    Invoice #
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                    Invoice Date
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                    COS Status
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                    Payment
                  </th>
                </tr>
              </thead>
              <tbody>
                {Array.from(categoryGroups.entries()).map(([category, catItems]) => {
                  const isExpanded = expandedCategories.has(category);
                  const catTotal = catItems.reduce((s, i) => s + (parseFloat(String(i.actualCosTotal || "0")) || 0), 0);
                  const catRealised = catItems.filter(i => i.cosStatus === "COS Realised").length;
                  const catRealisedPct = catItems.length > 0 ? Math.round((catRealised / catItems.length) * 100) : 0;
                  return (
                    <React.Fragment key={category}>
                      <tr
                        className="border-b border-slate-100 bg-slate-50/60 cursor-pointer hover:bg-slate-100/60 transition-colors"
                        onClick={() => toggleCategory(category)}
                        data-testid={`cos-category-${category.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        <td colSpan={5} className="px-5 py-2.5 font-medium text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400">
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </span>
                            <span className="font-semibold text-slate-800">{category}</span>
                            <span className="text-xs text-slate-400">
                              {catItems.length} items
                            </span>
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${catRealisedPct >= 80 ? "text-green-600 border-green-200" : catRealisedPct >= 40 ? "text-amber-600 border-amber-200" : "text-slate-500 border-slate-200"}`}>
                              {catRealised}/{catItems.length} realised
                            </Badge>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-sm text-slate-900">
                          {formatRandFull(catTotal)}
                        </td>
                        <td colSpan={2} className="py-2.5" />
                      </tr>
                      {isExpanded && catItems.map((item) => {
                        const val = parseFloat(String(item.actualCosTotal || "0")) || 0;
                        const sc = STATUS_CONFIG[item.cosStatus] || STATUS_CONFIG["Planned"];
                        return (
                          <tr
                            key={item.id}
                            className="border-b border-slate-50 bg-white hover:bg-slate-50/40 transition-colors"
                            data-testid={`cos-item-${item.id}`}
                          >
                            <td className="px-5 pl-11 py-2.5 text-sm text-slate-700 max-w-[220px] truncate" title={item.expenseLineItem || ""}>
                              {item.expenseLineItem || "-"}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-slate-600">{item.supplierName || "-"}</td>
                            <td className="px-4 py-2.5">
                              {item.expensePoNumber ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200">
                                  {item.expensePoNumber}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              {item.expenseInvoiceNumber ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  {item.expenseInvoiceNumber}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 whitespace-nowrap">
                              {item.expenseInvoicedDate ? new Date(item.expenseInvoicedDate).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold text-slate-900">
                              {formatRandFull(val)}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${sc.badgeBg} ${sc.badgeText} border ${sc.badgeBorder}`}>
                                {item.cosOverride && <span className="text-amber-500 font-bold">*</span>}
                                {item.cosStatus}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                item.paymentStatus === "Out of Bank"
                                  ? "bg-green-50 text-green-700 border border-green-200"
                                  : item.paymentStatus === "Payment Planned"
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : "bg-slate-50 text-slate-500 border border-slate-200"
                              }`}>
                                {item.paymentStatus}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
                <tr className="border-t-2 border-slate-200 bg-slate-50/80">
                  <td className="px-5 py-3 font-bold text-sm text-slate-900" colSpan={5}>Grand Total</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-sm text-slate-900">{formatRandFull(totalCOS)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
