import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { apiRequest } from "@/lib/queryClient";
import { DEPARTMENT_OPTIONS } from "@shared/config/priorities";
import { useUserOptions } from "./usePriorityPickers";

interface BreakDownRow {
  title: string;
  department_key: string;
  assigned_user_id: string;
}

const emptyRow = (): BreakDownRow => ({ title: "", department_key: "", assigned_user_id: "" });

export function BreakDownDialog({
  priorityId,
  open,
  onOpenChange,
}: {
  priorityId: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<BreakDownRow[]>([emptyRow()]);
  const userOptions = useUserOptions(open);

  const breakDownMutation = useMutation({
    mutationFn: async () => {
      const children = rows
        .filter((r) => r.title.trim())
        .map((r) => ({
          title: r.title.trim(),
          department_key: r.department_key || undefined,
          assigned_user_id: r.assigned_user_id ? parseInt(r.assigned_user_id, 10) : undefined,
        }));
      await apiRequest("POST", `/api/priorities/${priorityId}/break-down`, { children });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}/children`] });
      queryClient.invalidateQueries({ queryKey: [`/api/priorities/${priorityId}/activity`] });
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      onOpenChange(false);
      setRows([emptyRow()]);
    },
  });

  const updateRow = (idx: number, field: keyof BreakDownRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Break Down Priority</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Create child priorities below this one.</p>
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end border rounded p-2">
              <div className="col-span-4">
                <Label className="text-xs">Title *</Label>
                <Input
                  value={row.title}
                  onChange={(e) => updateRow(idx, "title", e.target.value)}
                  placeholder="Child priority title"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Department</Label>
                <Select value={row.department_key} onValueChange={(v) => updateRow(idx, "department_key", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select dept" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENT_OPTIONS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-4">
                <Label className="text-xs">Assign to</Label>
                <SearchableSelect
                  options={userOptions}
                  value={row.assigned_user_id}
                  onValueChange={(v) => updateRow(idx, "assigned_user_id", v)}
                  placeholder="Optional — pick a person"
                  searchPlaceholder="Search people..."
                />
              </div>
              <div className="col-span-1 flex justify-end">
                {rows.length > 1 && (
                  <button
                    onClick={() => removeRow(idx)}
                    className="text-muted-foreground hover:text-red-600 mt-1"
                    aria-label="Remove sub-priority row"
                    title="Remove sub-priority row"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="w-3 h-3 mr-1" /> Add another
          </Button>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => breakDownMutation.mutate()}
            disabled={breakDownMutation.isPending || !rows.some((r) => r.title.trim())}
          >
            {breakDownMutation.isPending ? "Creating..." : "Create sub-priorities"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
