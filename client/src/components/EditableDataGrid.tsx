import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {Table,TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Save, RotateCcw, Pencil } from "lucide-react";

interface Column {
  key: string;
  header: string;
  editable?: boolean;
  render?: (value: any, row: any) => React.ReactNode;
}

interface EditableDataGridProps {
  title: string;
  description?: string;
  data: any[];
  columns: Column[];
  rowKey: string;
  onSave: (edits: Map<string, any>) => Promise<void>;
  onReset: () => Promise<void>;
  isSaving?: boolean;
}

export function EditableDataGrid({
  title,
  description,
  data,
  columns,
  rowKey,
  onSave,
  onReset,
  isSaving = false,
}: EditableDataGridProps) {
  const [edits, setEdits] = useState<Map<string, any>>(new Map());
  const [editingCell, setEditingCell] = useState<string | null>(null);

  // Apply edits to data
  const displayData = useMemo(() => {
    return data.map(row => {
      const rowId = row[rowKey];
      const rowEdits = edits.get(rowId);
      if (!rowEdits) return row;
      return { ...row, ...rowEdits };
    });
  }, [data, edits, rowKey]);

  const handleCellEdit = (rowId: string | number, columnKey: string, value: any) => {
    const newEdits = new Map(edits);
    const rowEdits = newEdits.get(rowId) || {};
    rowEdits[columnKey] = value;
    newEdits.set(rowId, rowEdits);
    setEdits(newEdits);
  };

  const handleSave = async () => {
    await onSave(edits);
    setEdits(new Map());
  };

  const handleReset = async () => {
    await onReset();
    setEdits(new Map());
  };

  const hasEdits = edits.size > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={!hasEdits || isSaving}
              variant="default"
              size="sm"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              onClick={handleReset}
              disabled={isSaving}
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
        <div className="rounded-md border overflow-auto max-h-[600px]">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col.key}>{col.header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                    No data available
                  </TableCell>
                </TableRow>
              ) : (
                displayData.map((row) => {
                  const rowId = row[rowKey];
                  return (
                    <TableRow key={rowId}>
                      {columns.map((col) => {
                        const cellKey = `${rowId}-${col.key}`;
                        const value = row[col.key];
                        const isEditing = editingCell === cellKey;

                        if (col.editable && isEditing) {
                          return (
                            <TableCell key={col.key}>
                              <Input
                                type="text"
                                value={value || ""}
                                onChange={(e) =>
                                  handleCellEdit(rowId, col.key, e.target.value)
                                }
                                onBlur={() => setEditingCell(null)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") setEditingCell(null);
                                  if (e.key === "Escape") {
                                    setEditingCell(null);
                                  }
                                }}
                                autoFocus
                                className="h-8"
                              />
                            </TableCell>
                          );
                        }

                        return (
                          <TableCell
                            key={col.key}
                            className={col.editable ? "cursor-pointer hover:bg-muted/50" : ""}
                            onClick={() => col.editable && setEditingCell(cellKey)}
                          >
                            <div className="flex items-center gap-2">
                              {col.render ? col.render(value, row) : value || "-"}
                              {col.editable && !isEditing && (
                                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                              )}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {hasEdits && (
          <div className="mt-4 text-sm text-muted-foreground">
            {edits.size} {edits.size === 1 ? "row" : "rows"} modified. Click "Save Changes" to persist edits or "Reset" to discard.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
