import type { QueryClient } from "@tanstack/react-query";

export const engineeringTicketKeys = {
  all: ["engineering-tickets"] as const,
  scope: (scope: string) => ["engineering-tickets", scope] as const,
  scoped: (scope: string, params?: Record<string, unknown>) =>
    params ? (["engineering-tickets", scope, params] as const) : (["engineering-tickets", scope] as const),
} as const;

const ENGINEERING_TICKET_KEYS = [
  "/api/my-work/all-tasks",
  "eng-tasks",
  "eng-overview",
  "project-eng-tasks",
  "eng-tasks-standup",
  "eng-tasks-all-standup",
  "standup-meeting",
  "standups-today",
  "planning-tasks",
  "/api/opportunities",
  "/api/lifecycle-board/execution-dashboard",
  "execution-dashboard",
  "milestone-tracker",
  "action-launchpad",
  "engineering-tickets",
] as const;

const TASK_QUERY_KEY_PREFIXES = [
  ...ENGINEERING_TICKET_KEYS,
  "/api/mytool/tasks",
  "tasks",
  "tasks-board",
  "tasks-metrics",
  "tasks-calendar",
  "operational-tasks",
  "commissioning",
  "procurement",
  "raid",
  "change-control",
] as const;

export function invalidateAllTaskCaches(queryClient: QueryClient): void {
  for (const key of TASK_QUERY_KEY_PREFIXES) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function invalidateEngineeringTicketCaches(queryClient: QueryClient): void {
  for (const key of ENGINEERING_TICKET_KEYS) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}
