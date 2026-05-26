import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
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

interface PriorityTemplate {
  id: number;
  name: string;
  description: string | null;
  titleTemplate: string;
  bodyTemplate: string | null;
  scopeDefault: string;
  severityDefault: string;
  horizonDefault: string;
  departmentKey: string | null;
  targetOutcome: string | null;
  definitionOfDone: string | null;
  nextAction: string | null;
  ownerRole: string | null;
}

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
  // Selected template id (empty string = "start blank"). Templates are
  // loaded only while the dialog is open to keep the list fresh.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const templatesQuery = useQuery<PriorityTemplate[]>({
    queryKey: ["/api/priority-templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/priority-templates");
      return res.json();
    },
    enabled: open,
  });

  // Re-prime defaults whenever the dialog opens — the user might have moved
  // tab between two opens (e.g. created a dept priority, then a company one).
  useEffect(() => {
    if (open) {
      setForm({
        ...emptyPriorityForm,
        scope: normalizedDefaultScope,
        department_key: defaultDepartment || "",
      });
      setSelectedTemplateId("");
    }
  }, [open, normalizedDefaultScope, defaultDepartment]);

  // When a template is picked, pre-fill the form. Selecting "blank"
  // resets to the empty defaults so users can clear a template choice.
  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) {
      setForm({
        ...emptyPriorityForm,
        scope: normalizedDefaultScope,
        department_key: defaultDepartment || "",
      });
      return;
    }
    const tpl = (templatesQuery.data ?? []).find((t) => String(t.id) === templateId);
    if (!tpl) return;
    setForm((prev) => ({
      ...prev,
      title: tpl.titleTemplate,
      description: tpl.bodyTemplate ?? "",
      severity: tpl.severityDefault,
      horizon: tpl.horizonDefault,
      scope: allowedScopes.includes(tpl.scopeDefault as PriorityScope)
        ? (tpl.scopeDefault as PriorityScope)
        : prev.scope,
      department_key: tpl.departmentKey ?? prev.department_key,
      target_outcome: tpl.targetOutcome ?? "",
      definition_of_done: tpl.definitionOfDone ?? "",
      next_action: tpl.nextAction ?? "",
      owner_role: tpl.ownerRole ?? "",
    }));
  };

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
        {(templatesQuery.data?.length ?? 0) > 0 && (
          <div className="mb-3 border border-emerald-200 bg-emerald-50/40 rounded-md p-3">
            <Label className="text-xs flex items-center gap-1 mb-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              Start from a template (optional)
            </Label>
            <Select value={selectedTemplateId} onValueChange={applyTemplate}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-priority-template">
                <SelectValue placeholder="Blank — fill in below" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Blank — fill in below</SelectItem>
                {(templatesQuery.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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
