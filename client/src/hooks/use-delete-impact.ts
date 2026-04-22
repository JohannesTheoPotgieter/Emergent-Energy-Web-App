// ============================================================
// DELETE-IMPACT hook — consumed by ConfirmDestructive wrappers.
//
// Calls GET /api/<entity>/:id/delete-impact and returns the rows
// in the shape ConfirmDestructive's `impact` prop expects.
// ============================================================

import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { ImpactRow } from "@/components/ui/confirm-destructive";

export interface DeleteImpactResponse {
  subject: string;
  rows: ImpactRow[];
}

/**
 * Generic delete-impact loader. Caller picks the entity path to hit.
 * Only runs when enabled — normally wired to the dialog's open state.
 *
 * Example:
 *   const [open, setOpen] = useState(false);
 *   const { data, isLoading } = useDeleteImpact("projects", projectId, open);
 */
export function useDeleteImpact(
  entityPath: "projects" | "clients" | "invoices" | "documents" | "purchase-orders",
  entityId: number | null | undefined,
  enabled: boolean,
) {
  return useQuery<DeleteImpactResponse>({
    queryKey: [`/api/${entityPath}/${entityId}/delete-impact`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: enabled && entityId != null && entityId > 0,
    staleTime: 0, // always fresh — stale counts are worse than the round-trip
  });
}
