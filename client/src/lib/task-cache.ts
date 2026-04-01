/**
 * Unified task cache invalidation.
 *
 * All task mutations across any page should call invalidateAllTaskCaches()
 * so that changes (assignee, status, etc.) propagate to every view.
 */
import type { QueryClient } from "@tanstack/react-query";

/** Query keys used by different task pages/components */
const TASK_QUERY_KEY_PREFIXES = [
  // My Work pages
  "/api/my-work/all-tasks",
  "/api/mytool/tasks",
  // Engineering Tasks page
  "eng-tasks",
  "project-eng-tasks",
  // Task Management page
  "tasks",
  "tasks-board",
  "tasks-metrics",
  "tasks-calendar",
  // Operational tasks
  "operational-tasks",
  // Planning tasks
  "planning-tasks",
  // Entity-specific assignment caches
  "commissioning",
  "procurement",
  "raid",
  "change-control",
] as const;

/**
 * Invalidate all task-related React Query caches.
 * Call this after any task mutation (create, update, delete, reassign, status change)
 * to ensure changes propagate across all pages.
 */
export function invalidateAllTaskCaches(queryClient: QueryClient): void {
  for (const key of TASK_QUERY_KEY_PREFIXES) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}
