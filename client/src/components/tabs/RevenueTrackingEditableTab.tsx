import { useState, useMemo, useCallback, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateDashboardQueries } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import {
  Save, RotateCcw, Loader2, Plus, X, DollarSign,
  FileText, Landmark, AlertTriangle, CircleDot
} from "lucide-react";

interface RevenueTrackingEditableTabProps {
  projectName: string;
}

interface MilestoneRow {
  id: number;
  rowNumber: number;
  milestoneNo: string;
  milestoneName: string;
  milestonePercent: string;
  milestoneAmount: string;
  date: string | null;
  milestoneInvoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  inBank: boolean;
  status: string;
  flags: string[];
  hasOverride: boolean;
  milestoneNotes: string | null;
  isRed: boolean;
  dependentTask: any;
  dateOverride: string | null;
  dateOverrideReason: string | null;
}

interface RevenueSummary {
  totalContract: number;
  invoiced: number;
  inBank: number;
  pending: number;
  overdue: number;
  milestoneCount: number;
  issueCount: number;
}

interface RevenueTabData {
  milestones: MilestoneRow[];
  summary: RevenueSummary;
  highlevel: any;
}

type OverrideCategory = 'DATA_CORRECTION' | 'BUSINESS_DECISION' | 'TIMING_ADJUSTMENT' | 'SCOPE_CHANGE' | 'RECONCILIATION' | 'SYSTEM_ERROR_FIX' | 'OTHER';

const OVERRIDE_CATEGORIES: OverrideCategory[] = [
  'DATA_CORRECTION', 'BUSINESS_DECISION', 'TIMING_ADJUSTMENT',
  'SCOPE_CHANGE', 'RECONCILIATION', 'SYSTEM_ERROR_FIX', 'OTHER'
];

const CATEGORY_LABELS: Record<string, string> = {
  DATA_CORRECTION: "Data Correction",
  BUSINESS_DECISION: "Business Decision",
  TIMING_ADJUSTMENT: "Timing Adjustment",
  SCOPE_CHANGE: "Scope Change",
  RECONCILIATION: "Reconciliation",
  SYSTEM_ERROR_FIX: "System Error Fix",
  OTHER: "Other",
};

function formatCurrency(value: number): string {
  return `R${Math.abs(value).toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "inBank":
      return <Badge data-testid="badge-status-inBank" className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">In Bank</Badge>;
    case "invoiced":
      return <Badge data-testid="badge-status-invoiced" className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">Invoiced</Badge>;
    case "received":
      return <Badge data-testid="badge-status-received" className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">Received</Badge>;
    case "overdue":
      return <Badge data-testid="badge-status-overdue" className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">Overdue</Badge>;
    case "planned":
    default:
      return <Badge data-testid="badge-status-planned" className="bg-muted text-muted-foreground border-border hover:bg-muted" variant="secondary">Planned</Badge>;
  }
}

export function RevenueTrackingEditableTab({ projectName }: RevenueTrackingEditableTabProps) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Map<number, Record<string, any>>>(new Map());
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [newRows, setNewRows] = useState<any[]>([]);
  const [overrideCategory, setOverrideCategory] = useState<OverrideCategory>("DATA_CORRECTION");
  const [overrideComment, setOverrideComment] = useState("");

  const queryKey = [`/api/revenue-tab/${projectName}`];

  const { data, isLoading, error } = useQuery<RevenueTabData>({
    queryKey,
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/revenue-tab/${projectName}`, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to load revenue data");
      return res.json();
    },
  });

  const overridesQuery = useQuery<any[]>({
    queryKey: [`/api/revenue-tracking/overrides?projectName=${projectName}`],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/revenue-tracking/overrides?projectName=${projectName}`, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to load overrides");
      return res.json();
    },
  });

  const overridesByRow = useMemo(() => {
    const map = new Map<number, Map<string, string>>();
    if (!overridesQuery.data) return map;
    for (const o of overridesQuery.data) {
      if (!map.has(o.rowNumber)) map.set(o.rowNumber, new Map());
      map.get(o.rowNumber)!.set(o.fieldName, o.overrideValue);
    }
    return map;
  }, [overridesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (overrides: any[]) => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch("/api/revenue-tracking/overrides", {
        credentials: "include",
        method: "POST",
        headers,
        body: JSON.stringify({ overrides, overrideCategory, overrideComment: overrideComment || "Revenue tracking edit" }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || err.message || "Failed to save overrides");
      }
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: [`/api/revenue-tracking/overrides?projectName=${projectName}`] });
      invalidateDashboardQueries(queryClient);
      setEdits(new Map());
      setNewRows([]);
      setOverrideComment("");
      toast({
        title: result.status === "pending_approval" ? "Edit Submitted for Approval" : "Changes Saved",
        description: result.status === "pending_approval"
          ? "Your revenue edit has been submitted for approval."
          : "Revenue tracking edits have been saved successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Save Failed",
        description: getErrorMessage(error, "Failed to save edits"),
        variant: "destructive",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(`/api/revenue-tracking/overrides/${projectName}`, {
        credentials: "include",
        method: "DELETE",
        headers,
      });
      if (!response.ok) throw new Error("Failed to reset overrides");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: [`/api/revenue-tracking/overrides?projectName=${projectName}`] });
      invalidateDashboardQueries(queryClient);
      setEdits(new Map());
      setNewRows([]);
      toast({ title: "Overrides Reset", description: "All edits have been cleared and tracker data restored." });
    },
    onError: (error) => {
      toast({ title: "Reset Failed", description: getErrorMessage(error, "Failed to reset overrides"), variant: "destructive" });
    },
  });

  const milestones = data?.milestones || [];
  const summary = data?.summary || { totalContract: 0, invoiced: 0, inBank: 0, pending: 0, overdue: 0, milestoneCount: 0, issueCount: 0 };

  const displayData = useMemo(() => {
    return milestones.map((row) => {
      const rowEdits = edits.get(row.rowNumber);
      if (!rowEdits) return row;
      return { ...row, ...rowEdits };
    });
  }, [milestones, edits]);

  const handleCellEdit = useCallback((rowNumber: number, field: string, value: any) => {
    setEdits(prev => {
      const next = new Map(prev);
      const rowEdits = next.get(rowNumber) || {};
      rowEdits[field] = value;
      next.set(rowNumber, rowEdits);
      return next;
    });
  }, []);

  const startEditing = useCallback((cellKey: string) => {
    if (isAdmin) setEditingCell(cellKey);
  }, [isAdmin]);

  const stopEditing = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleSave = async () => {
    const overrides = Array.from(edits.entries()).flatMap(([rowNumber, rowEdits]) => {
      return Object.entries(rowEdits).map(([field, value]) => ({
        projectName,
        rowNumber,
        fieldName: field,
        overrideValue: String(value),
      }));
    });

    for (const nr of newRows) {
      Object.entries(nr).forEach(([field, value]) => {
        if (field === "rowNumber") return;
        overrides.push({
          projectName,
          rowNumber: nr.rowNumber,
          fieldName: field,
          overrideValue: String(value),
        });
      });
    }

    if (overrides.length === 0) return;
    await saveMutation.mutateAsync(overrides);
  };

  const handleDiscard = () => {
    setEdits(new Map());
    setNewRows([]);
    setOverrideComment("");
  };

  const addNewRow = () => {
    const maxRow = Math.max(0, ...milestones.map(m => m.rowNumber), ...newRows.map(r => r.rowNumber));
    setNewRows(prev => [...prev, {
      rowNumber: maxRow + 1,
      milestoneName: "",
      milestoneAmount: "0",
      milestoneInvoiceNumber: "",
      invoiceRaisedDate: "",
      date: "",
      inBank: false,
    }]);
  };

  const removeNewRow = (rowNumber: number) => {
    setNewRows(prev => prev.filter(r => r.rowNumber !== rowNumber));
  };

  const handleNewRowEdit = (rowNumber: number, field: string, value: any) => {
    setNewRows(prev => prev.map(r =>
      r.rowNumber === rowNumber ? { ...r, [field]: value } : r
    ));
  };

  const hasEdits = edits.size > 0 || newRows.length > 0;
  const outstanding = summary.totalContract - summary.inBank - summary.invoiced;

  const hasFieldOverride = (rowNumber: number, fieldName: string): boolean => {
    return overridesByRow.has(rowNumber) && overridesByRow.get(rowNumber)!.has(fieldName);
  };

  const getOriginalValue = (rowNumber: number, fieldName: string): string | undefined => {
    if (!overridesByRow.has(rowNumber)) return undefined;
    return overridesByRow.get(rowNumber)!.get(fieldName);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <p data-testid="text-error-revenue" className="text-center text-destructive">Failed to load revenue tracking data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="kpi-strip-revenue">
          <Card className="bg-muted border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <DollarSign className="h-4 w-4" />
                <span>Total Contract Revenue</span>
              </div>
              <p data-testid="kpi-total-contract" className="text-xl font-bold text-foreground">{formatCurrency(summary.totalContract)}</p>
              <p className="text-xs text-muted-foreground mt-1">{summary.milestoneCount} milestones</p>
            </CardContent>
          </Card>
          <Card className="bg-amber-50 border-amber-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-amber-700 mb-1">
                <FileText className="h-4 w-4" />
                <span>Invoiced Total</span>
              </div>
              <p data-testid="kpi-invoiced" className="text-xl font-bold text-amber-800">{formatCurrency(summary.invoiced)}</p>
              <p className="text-xs text-amber-600 mt-1">Awaiting payment</p>
            </CardContent>
          </Card>
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-green-700 mb-1">
                <Landmark className="h-4 w-4" />
                <span>In Bank Total</span>
              </div>
              <p data-testid="kpi-in-bank" className="text-xl font-bold text-green-800">{formatCurrency(summary.inBank)}</p>
              <p className="text-xs text-green-600 mt-1">Confirmed received</p>
            </CardContent>
          </Card>
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-red-700 mb-1">
                <AlertTriangle className="h-4 w-4" />
                <span>Outstanding</span>
              </div>
              <p data-testid="kpi-outstanding" className="text-xl font-bold text-red-800">{formatCurrency(outstanding > 0 ? outstanding : summary.pending)}</p>
              {summary.overdue > 0 && (
                <p className="text-xs text-red-600 mt-1">{formatCurrency(summary.overdue)} overdue</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
              <div>
                <h3 className="text-sm font-semibold">Revenue Milestones</h3>
                <p className="text-xs text-muted-foreground">Click cells to edit • Blue dots indicate manual overrides</p>
              </div>
              <div className="flex gap-2">
                {isAdmin && (
                  <Button data-testid="button-add-milestone" onClick={addNewRow} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-1" /> Add Milestone
                  </Button>
                )}
                {isAdmin && (
                  <Button data-testid="button-reset-overrides" onClick={() => resetMutation.mutateAsync()} disabled={resetMutation.isPending} variant="ghost" size="sm">
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Reset All
                  </Button>
                )}
              </div>
            </div>
            {displayData.length === 0 && newRows.length === 0 ? (
              <p data-testid="text-empty-revenue" className="text-center text-muted-foreground py-8">
                No revenue tracking data available for this project
              </p>
            ) : (
              <div className="overflow-auto max-h-[600px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-[50px]">#</TableHead>
                      <TableHead className="min-w-[180px]">Milestone Name</TableHead>
                      <TableHead className="text-right min-w-[120px]">Amount</TableHead>
                      <TableHead className="min-w-[130px]">Invoice No.</TableHead>
                      <TableHead className="min-w-[120px]">Invoice Date</TableHead>
                      <TableHead className="min-w-[120px]">Payment Date</TableHead>
                      <TableHead className="w-[80px] text-center">In Bank</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayData.map((row: any, idx: number) => {
                      const rowNum = row.rowNumber;
                      const isEven = idx % 2 === 0;
                      return (
                        <TableRow
                          key={`existing-${rowNum}`}
                          data-testid={`row-milestone-${rowNum}`}
                          className={`${isEven ? "bg-background" : "bg-muted/20"} hover:bg-muted/40 transition-colors`}
                        >
                          <TableCell className="text-muted-foreground font-mono text-xs">{row.milestoneNo || idx + 1}</TableCell>

                          {renderEditableCell(rowNum, "milestoneName", row.milestoneName || "-", "text", "font-medium")}

                          {renderEditableCell(rowNum, "milestoneAmount", row.milestoneAmount, "currency", "text-right font-mono")}

                          {renderEditableCell(rowNum, "milestoneInvoiceNumber", row.milestoneInvoiceNumber || "", "text", "")}

                          {renderEditableCell(rowNum, "invoiceRaisedDate", row.invoiceRaisedDate || "", "date", "")}

                          {renderEditableCell(rowNum, "date", row.date || "", "date", "")}

                          <TableCell className="text-center">
                            <OverrideDotWrapper rowNumber={rowNum} fieldName="inBank" hasOverride={hasFieldOverride(rowNum, "inBank")} originalValue={getOriginalValue(rowNum, "inBank")}>
                              <Switch
                                data-testid={`switch-inbank-${rowNum}`}
                                checked={!!row.inBank}
                                disabled={!isAdmin}
                                onCheckedChange={(checked) => handleCellEdit(rowNum, "inBank", checked ? "1" : "0")}
                              />
                            </OverrideDotWrapper>
                          </TableCell>

                          <TableCell>{getStatusBadge(row.status)}</TableCell>
                        </TableRow>
                      );
                    })}

                    {newRows.map((nr, nIdx) => (
                      <TableRow
                        key={`new-${nr.rowNumber}`}
                        data-testid={`row-new-milestone-${nr.rowNumber}`}
                        className="bg-blue-50/50 hover:bg-blue-50 transition-colors border-l-2 border-l-blue-400"
                      >
                        <TableCell className="text-muted-foreground">
                          <Button data-testid={`button-remove-row-${nr.rowNumber}`} variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeNewRow(nr.rowNumber)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Input
                            data-testid={`input-new-name-${nr.rowNumber}`}
                            value={nr.milestoneName}
                            onChange={(e) => handleNewRowEdit(nr.rowNumber, "milestoneName", e.target.value)}
                            placeholder="Milestone name"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            data-testid={`input-new-amount-${nr.rowNumber}`}
                            type="number"
                            value={nr.milestoneAmount}
                            onChange={(e) => handleNewRowEdit(nr.rowNumber, "milestoneAmount", e.target.value)}
                            className="h-8 text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            data-testid={`input-new-invoice-${nr.rowNumber}`}
                            value={nr.milestoneInvoiceNumber}
                            onChange={(e) => handleNewRowEdit(nr.rowNumber, "milestoneInvoiceNumber", e.target.value)}
                            placeholder="INV-XXX"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            data-testid={`input-new-invoicedate-${nr.rowNumber}`}
                            type="date"
                            value={nr.invoiceRaisedDate}
                            onChange={(e) => handleNewRowEdit(nr.rowNumber, "invoiceRaisedDate", e.target.value)}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            data-testid={`input-new-paydate-${nr.rowNumber}`}
                            type="date"
                            value={nr.date}
                            onChange={(e) => handleNewRowEdit(nr.rowNumber, "date", e.target.value)}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            data-testid={`switch-new-inbank-${nr.rowNumber}`}
                            checked={!!nr.inBank}
                            onCheckedChange={(checked) => handleNewRowEdit(nr.rowNumber, "inBank", checked)}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-blue-50 text-blue-600 border-blue-200">New</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {hasEdits && (
          <div className="sticky bottom-0 z-20 bg-background border-t shadow-lg p-4 -mx-2 rounded-t-lg" data-testid="save-bar-revenue">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-muted-foreground">
                  {edits.size + newRows.length} {edits.size + newRows.length === 1 ? "change" : "changes"} pending
                </span>
                <SearchableSelect
                  value={overrideCategory}
                  onValueChange={(v) => setOverrideCategory(v as OverrideCategory)}
                  triggerClassName="w-[180px] h-8"
                  data-testid="select-override-category"
                  options={OVERRIDE_CATEGORIES.map(cat => ({ value: cat, label: CATEGORY_LABELS[cat] }))}
                />
                <Input
                  data-testid="input-override-comment"
                  value={overrideComment}
                  onChange={(e) => setOverrideComment(e.target.value)}
                  placeholder="Reason for change (min 3 chars)"
                  className="h-8 w-[250px]"
                />
              </div>
              <div className="flex gap-2">
                <Button data-testid="button-discard-changes" onClick={handleDiscard} variant="outline" size="sm">
                  <X className="h-4 w-4 mr-1" /> Discard
                </Button>
                <Button
                  data-testid="button-save-changes"
                  onClick={handleSave}
                  disabled={saveMutation.isPending || (overrideComment.trim().length < 3)}
                  size="sm"
                >
                  <Save className="h-4 w-4 mr-1" />
                  {saveMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );

  function renderEditableCell(
    rowNumber: number,
    field: string,
    value: any,
    inputType: "text" | "currency" | "date",
    className: string
  ) {
    const cellKey = `${rowNumber}-${field}`;
    const isEditing = editingCell === cellKey;
    const hasOverride = hasFieldOverride(rowNumber, field);

    const displayValue = inputType === "currency"
      ? formatCurrency(parseFloat(value) || 0)
      : inputType === "date" && value
        ? formatDate(value)
        : value || "-";

    return (
      <TableCell className={className}>
        <OverrideDotWrapper rowNumber={rowNumber} fieldName={field} hasOverride={hasOverride} originalValue={getOriginalValue(rowNumber, field)}>
          {isAdmin && isEditing ? (
            <Input
              data-testid={`input-edit-${field}-${rowNumber}`}
              type={inputType === "currency" ? "number" : inputType === "date" ? "date" : "text"}
              defaultValue={inputType === "currency" ? (parseFloat(value) || 0) : (value || "")}
              onBlur={(e) => {
                const newVal = e.target.value;
                if (inputType === "currency") {
                  handleCellEdit(rowNumber, field, newVal);
                } else {
                  handleCellEdit(rowNumber, field, newVal);
                }
                stopEditing();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === "Escape") {
                  stopEditing();
                }
              }}
              autoFocus
              className={`h-8 ${inputType === "currency" ? "text-right" : ""}`}
            />
          ) : (
            <span
              data-testid={`cell-${field}-${rowNumber}`}
              onClick={() => startEditing(cellKey)}
              className={`${isAdmin ? "cursor-pointer hover:bg-muted/50" : ""} px-2 py-1 rounded block truncate`}
            >
              {displayValue}
            </span>
          )}
        </OverrideDotWrapper>
      </TableCell>
    );
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function OverrideDotWrapper({
  children,
  rowNumber,
  fieldName,
  hasOverride,
  originalValue,
}: {
  children: ReactNode;
  rowNumber: number;
  fieldName: string;
  hasOverride: boolean;
  originalValue?: string;
}) {
  if (!hasOverride) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative inline-flex items-center w-full">
          <CircleDot className="absolute -left-1 -top-1 h-3 w-3 text-blue-500 z-10" data-testid={`override-dot-${fieldName}-${rowNumber}`} />
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">Manual override applied</p>
        {originalValue && <p className="text-xs text-muted-foreground">Override value: {originalValue}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
