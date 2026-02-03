import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { Save, RotateCcw, Loader2 } from "lucide-react";

interface RevenueTrackingEditableTabProps {
  projectName: string;
}

export function RevenueTrackingEditableTab({ projectName }: RevenueTrackingEditableTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Map<number, any>>(new Map());
  const [editingCell, setEditingCell] = useState<string | null>(null);

  const queryKey = [`/api/program-inflows/${projectName}?applyOverrides=true`];

  const { data: revenues = [], isLoading, error } = useQuery({
    queryKey,
  });

  const saveMutation = useMutation({
    mutationFn: async (overrides: any[]) => {
      const response = await fetch("/api/revenue-tracking-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      if (!response.ok) throw new Error("Failed to save overrides");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEdits(new Map());
      toast({
        title: "Changes Saved",
        description: "Revenue tracking edits have been saved successfully.",
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
      const response = await fetch(`/api/revenue-tracking-overrides/${projectName}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to reset overrides");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEdits(new Map());
      toast({
        title: "Overrides Reset",
        description: "All edits have been cleared and tracker data restored.",
      });
    },
    onError: (error) => {
      toast({
        title: "Reset Failed",
        description: getErrorMessage(error, "Failed to reset overrides"),
        variant: "destructive",
      });
    },
  });

  // Apply edits to display data
  const displayData = useMemo(() => {
    return revenues.map((row: any) => {
      const rowEdits = edits.get(row.id);
      if (!rowEdits) return row;
      return { ...row, ...rowEdits };
    });
  }, [revenues, edits]);

  const handleCellEdit = (rowId: number, field: string, value: string) => {
    const newEdits = new Map(edits);
    const rowEdits = newEdits.get(rowId) || {};
    rowEdits[field] = field === "amount" ? parseFloat(value) || 0 : value;
    newEdits.set(rowId, rowEdits);
    setEdits(newEdits);
  };

  const handleSave = async () => {
    const overrides = Array.from(edits.entries()).flatMap(([rowId, rowEdits]) => {
      const originalRow = revenues.find((r: any) => r.id === rowId);
      if (!originalRow) return [];
      
      return Object.entries(rowEdits).map(([field, value]) => ({
        projectName,
        rowNumber: originalRow.rowLocator || rowId,
        fieldName: field,
        overrideValue: String(value),
      }));
    });
    await saveMutation.mutateAsync(overrides);
  };

  const handleReset = async () => {
    await resetMutation.mutateAsync();
  };

  const hasEdits = edits.size > 0;
  const editableFields = ["category", "description", "amount", "source"];

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
          <p className="text-center text-destructive">Failed to load revenue tracking data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Revenue Tracking</CardTitle>
            <CardDescription>
              Revenue entries from Revenue Tracking sheet • Click cells to edit
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={!hasEdits || saveMutation.isPending}
              variant="default"
              size="sm"
            >
              <Save className="h-4 w-4 mr-2" />
              {saveMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              onClick={handleReset}
              disabled={resetMutation.isPending}
              variant="outline"
              size="sm"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to Tracker
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {displayData.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No revenue tracking data available for this project
          </p>
        ) : (
          <div className="rounded-md border overflow-auto max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayData.map((rev: any, idx: number) => {
                  const rowId = rev.id;
                  return (
                    <TableRow key={rowId}>
                      <TableCell>
                        {rev.date ? new Date(rev.date).toLocaleDateString() : "-"}
                      </TableCell>
                      {editableFields.map((field) => {
                        const cellKey = `${rowId}-${field}`;
                        const value = rev[field];
                        const isEditing = editingCell === cellKey;

                        if (field === "amount") {
                          return (
                            <TableCell key={field} className="text-right">
                              {isEditing ? (
                                <Input
                                  type="number"
                                  value={value || 0}
                                  onChange={(e) => handleCellEdit(rowId, field, e.target.value)}
                                  onBlur={() => setEditingCell(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === "Escape") setEditingCell(null);
                                  }}
                                  autoFocus
                                  className="h-8 text-right"
                                />
                              ) : (
                                <span
                                  onClick={() => setEditingCell(cellKey)}
                                  className="cursor-pointer hover:bg-muted/50 px-2 py-1 rounded font-mono"
                                >
                                  R{Number(value || 0).toLocaleString()}
                                </span>
                              )}
                            </TableCell>
                          );
                        }

                        return (
                          <TableCell key={field} className={field === "category" ? "font-medium" : "text-muted-foreground"}>
                            {isEditing ? (
                              <Input
                                type="text"
                                value={value || ""}
                                onChange={(e) => handleCellEdit(rowId, field, e.target.value)}
                                onBlur={() => setEditingCell(null)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === "Escape") setEditingCell(null);
                                }}
                                autoFocus
                                className="h-8"
                              />
                            ) : (
                              <span
                                onClick={() => setEditingCell(cellKey)}
                                className="cursor-pointer hover:bg-muted/50 px-2 py-1 rounded block"
                              >
                                {value || "-"}
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {hasEdits && (
          <div className="mt-4 text-sm text-muted-foreground">
            {edits.size} {edits.size === 1 ? "row" : "rows"} modified. Click "Save Changes" to persist edits.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
