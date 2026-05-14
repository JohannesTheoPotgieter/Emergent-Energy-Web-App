import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const PRIORITY_QUERY_KEYS = {
  all: ["/api/priorities"] as QueryKey,
  myWork: ["/api/priorities/my-work"] as QueryKey,
  legacyCompany: ["/api/mytool/company-priorities"] as QueryKey,
};

export function buildPriorityInvalidationKeys(priorityId?: number | null): QueryKey[] {
  const keys: QueryKey[] = [
    PRIORITY_QUERY_KEYS.all,
    PRIORITY_QUERY_KEYS.myWork,
    PRIORITY_QUERY_KEYS.legacyCompany,
  ];

  if (priorityId != null) {
    keys.push(
      [`/api/priorities/${priorityId}`],
      [`/api/priorities/${priorityId}/activity`],
      [`/api/priorities/${priorityId}/children`],
      [`/api/priorities/${priorityId}/tasks`],
      [`/api/priorities/${priorityId}/approvals`],
      [`/api/priorities/${priorityId}/updates`],
      [`/api/priorities/${priorityId}/comments`],
      [`/api/priorities/${priorityId}/watched`],
    );
  }

  return keys;
}

export async function invalidatePriorityQueries(
  queryClient: QueryClient,
  priorityId?: number | null,
): Promise<void> {
  await Promise.all(
    buildPriorityInvalidationKeys(priorityId).map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}
