import { useEffect, useMemo, useState } from "react";
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
import { invalidatePriorityQueries } from "@/lib/priority-query-invalidation";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  PRIORITY_SCOPES,
  canPriorityRoleCreateScope,
  isDepartmentHeadRole,
  isPriorityAdminRole,
  type PriorityScope,
} from "@/config/priorities";
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
  const { user } = useAuth();
  const allowedScopes = useMemo<PriorityScope[]>(() => {
    const scopes = PRIORITY_SCOPES.filter((scope) => canPriorityRoleCreateScope(user?.role, scope));
    return scopes.length > 0 ? [...scopes] : ["role"];
  }, [user?.role]);
  const normalizedDefaultScope = allowedScopes.includes(defaultScope as PriorityScope)
    ? (defaultScope as PriorityScope)
    : allowedScopes[0];
  const canUseAdvancedPriorityFields = isPriorityAdminRole(user?.role) || isDepartmentHeadRole(user?.role);
  const [form, setForm] = useState<PriorityFormState>({
    ...emptyPriorityForm,
    scope: normalizedDefaultScope,
    department_key: defaultDepartment || "",
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Re-prime defaults whenever the dialog opens — the user might have moved
  // tab between two opens (e.g. created a dept priority, then a company one).
  useEffect(() => {
    if (open) {
      setForm({
        ...emptyPriorityForm,
        scope: normalizedDefaultScope,
        department_key: defaultDepartment || "",
      });
    }
  }, [open, normalizedDefaultScope, defaultDepartment]);

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
      void invalidatePriorityQueries(queryClient);
      toast({ title: "Priority created" });
      onOpenChange(false);
    },
    onError: (err) =>
      toast({
        title: "Could not create priority",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Priority</DialogTitle>
        </DialogHeader>
        <PriorityFormFields
          form={form}
          patch={patch}
          mode="create"
          scopeOptions={allowedScopes}
          departmentLocked={!canUseAdvancedPriorityFields}
          showParentPicker={canUseAdvancedPriorityFields}
          showOwnerFields={canUseAdvancedPriorityFields}
          showAccountableExecField={canUseAdvancedPriorityFields}
          showAssigneeField={canUseAdvancedPriorityFields}
          showProjectPicker={canUseAdvancedPriorityFields}
        />
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
