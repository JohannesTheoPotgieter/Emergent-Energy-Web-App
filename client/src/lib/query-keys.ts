/**
 * Canonical TanStack Query key factories.
 *
 * Import these in both page components AND tests so string literals are never
 * duplicated. Changing a key here updates every call site automatically.
 */
export const QUERY_KEYS = {
  financialEditRequests: (projectName: string, status: string) =>
    ["financial-edit-requests", projectName, status] as const,
} as const;
