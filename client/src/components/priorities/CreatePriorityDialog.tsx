import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import {
  PriorityFormFields,
  emptyPriorityForm,
  buildPriorityPayload,
  type PriorityFormState,
} from "./PriorityFormFields";

export function CreatePriorityDialog({
  open,
  onOpenChange,
  defaultScope,
  defaultDepartment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultScope?: string;
  defaultDepartment?: string;
}) {
  const [form, setForm] = useState<PriorityFormState>({
    ...emptyPriorityForm,
    scope: defaultScope || "company",
    department_key: defaultDepartment || "",
  });
  const queryClient = useQueryClient();

  // Re-prime defaults whenever the dialog opens — the user might have moved
  // tab between two opens (e.g. created a dept priority, then a company one).
  useEffect(() => {
    if (open) {
      setForm({
        ...emptyPriorityForm,
        scope: defaultScope || "company",
        department_key: defaultDepartment || "",
      });
    }
  }, [open, defaultScope, defaultDepartment]);

  const patch = (delta: Partial<PriorityFormState>) =>
    setForm((prev) => ({ ...prev, ...delta }));

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(
        "POST",
        "/api/priorities",
        buildPriorityPayload(form, { includeProjectIds: true }),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mytool/company-priorities"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Priority</DialogTitle>
        </DialogHeader>
        <PriorityFormFields form={form} patch={patch} mode="create" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!form.title.trim() || createMutation.isPending}
            data-testid="button-create-priority"
          >
            {createMutation.isPending ? "Creating..." : "Create Priority"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
