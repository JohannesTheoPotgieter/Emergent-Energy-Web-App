import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Clock, AlertTriangle, FileText, Search, ChevronDown, ChevronRight } from "lucide-react";

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

const formatCurrency = (amount: number) => {
  if (amount === 0) return "R 0";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
};

const formatCurrencyFull = (amount: number) => {
  if (amount === 0) return "-";
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const statusConfig: Record<string, { color: string; bg: string; border: string; icon: typeof CheckCircle2 }> = {
  "COS Realised": { color: "text-green-700", bg: "bg-green-50", border: "border-green-200", icon: CheckCircle2 },
  "Deferred": { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", icon: Clock },
  "Flagged": { color: "text-red-700", bg: "bg-red-50", border: "border-red-200", icon: AlertTriangle },
  "Planned": { color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200", icon: FileText },
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
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loading-cos-tracker" />
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <p className="text-center text-muted-foreground" data-testid="no-cos-data">
            No expenditure data available. Import a tracker file to populate the COS tracker.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="cos-tracker-tab">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(Object.entries(statusConfig) as [string, typeof statusConfig[string]][]).map(([status, config]) => {
          const s = summary[status as keyof typeof summary];
          const Icon = config.icon;
          const isActive = activeFilter === status;
          return (
            <Card
              key={status}
              className={`cursor-pointer transition-all ${isActive ? `ring-2 ring-offset-1 ${config.border}` : "hover:shadow-md"} ${config.bg}`}
              onClick={() => setActiveFilter(isActive ? null : status)}
              data-testid={`cos-card-${status.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <CardContent className="pt-3 pb-2 px-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                  <span className={`text-xs font-medium ${config.color}`}>{status}</span>
                </div>
                <p className={`text-lg font-bold ${config.color}`}>{formatCurrency(s.value)}</p>
                <p className="text-xs text-muted-foreground">{s.count} items</p>
              </CardContent>
            </Card>
          );
        })}
        <Card className="bg-slate-50">
          <CardContent className="pt-3 pb-2 px-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-xs font-medium text-slate-700">Realised %</span>
            </div>
            <p className="text-lg font-bold text-slate-900">{realisedPct}%</p>
            <p className="text-xs text-muted-foreground">{totalItems} total items</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
            data-testid="cos-search"
          />
        </div>
        {activeFilter && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setActiveFilter(null)} data-testid="cos-clear-filter">
            Clear filter
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          Showing {filtered.length} of {totalItems} items
        </span>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">COS Tracker — {projectName}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-[200px]">Description</TableHead>
                  <TableHead className="text-xs">Supplier</TableHead>
                  <TableHead className="text-xs">PO #</TableHead>
                  <TableHead className="text-xs">Invoice #</TableHead>
                  <TableHead className="text-xs">Invoice Date</TableHead>
                  <TableHead className="text-xs text-right">Amount</TableHead>
                  <TableHead className="text-xs text-center">COS Status</TableHead>
                  <TableHead className="text-xs text-center">Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(categoryGroups.entries()).map(([category, catItems]) => {
                  const isExpanded = expandedCategories.has(category);
                  const catTotal = catItems.reduce((s, i) => s + (parseFloat(String(i.actualCosTotal || "0")) || 0), 0);
                  const catRealised = catItems.filter(i => i.cosStatus === "COS Realised").length;
                  return (
                    <React.Fragment key={category}>
                      <TableRow
                        className="bg-muted/40 cursor-pointer hover:bg-muted/60"
                        onClick={() => toggleCategory(category)}
                        data-testid={`cos-category-${category.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        <TableCell colSpan={5} className="text-xs font-semibold py-1.5">
                          <div className="flex items-center gap-1.5">
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {category}
                            <span className="text-muted-foreground font-normal">({catItems.length} items, {catRealised} realised)</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right font-semibold font-mono py-1.5">
                          {formatCurrencyFull(catTotal)}
                        </TableCell>
                        <TableCell colSpan={2} className="py-1.5" />
                      </TableRow>
                      {isExpanded && catItems.map((item, idx) => {
                        const val = parseFloat(String(item.actualCosTotal || "0")) || 0;
                        const sc = statusConfig[item.cosStatus] || statusConfig["Planned"];
                        return (
                          <TableRow key={item.id} data-testid={`cos-item-${item.id}`}>
                            <TableCell className="text-xs py-1.5 pl-8 max-w-[200px] truncate" title={item.expenseLineItem || ""}>
                              {item.expenseLineItem || "-"}
                            </TableCell>
                            <TableCell className="text-xs py-1.5">{item.supplierName || "-"}</TableCell>
                            <TableCell className="text-xs py-1.5 font-mono">
                              {item.expensePoNumber ? (
                                <Badge variant="outline" className="text-green-600 border-green-200 text-[10px] px-1 py-0">
                                  {item.expensePoNumber}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs py-1.5 font-mono">
                              {item.expenseInvoiceNumber ? (
                                <Badge variant="outline" className="text-blue-600 border-blue-200 text-[10px] px-1 py-0">
                                  {item.expenseInvoiceNumber}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs py-1.5">
                              {item.expenseInvoicedDate ? new Date(item.expenseInvoicedDate).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right py-1.5 font-mono">
                              {formatCurrencyFull(val)}
                            </TableCell>
                            <TableCell className="text-xs text-center py-1.5">
                              <Badge variant="outline" className={`${sc.color} ${sc.border} text-[10px] px-1.5 py-0 gap-0.5`}>
                                {item.cosOverride && <span className="text-amber-500 font-bold">*</span>}
                                {item.cosStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-center py-1.5">
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 ${
                                  item.paymentStatus === "Out of Bank"
                                    ? "text-green-600 border-green-200"
                                    : item.paymentStatus === "Payment Planned"
                                    ? "text-amber-600 border-amber-200"
                                    : "text-slate-500 border-slate-200"
                                }`}
                              >
                                {item.paymentStatus}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
                <TableRow className="font-bold border-t-2">
                  <TableCell className="text-xs" colSpan={5}>Total</TableCell>
                  <TableCell className="text-xs text-right font-mono">{formatCurrencyFull(totalCOS)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
