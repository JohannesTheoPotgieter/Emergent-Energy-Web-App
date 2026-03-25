/**
 * Engineering bulk action utilities.
 *
 * Note: The bulk mutation logic (bulkStatusMutation, bulkPriorityMutation) lives
 * inside the EngineeringTasksPage orchestrator as it depends on page-level state
 * (selectedTaskIds, queryClient). The UI for the bulk action bar is inline in the
 * board view section of the orchestrator. The shared constants used by the bulk bar
 * (PRIORITIES, priorityColors, etc.) are exported from EngineeringTaskFilters.
 *
 * This module is a placeholder for future extraction of bulk action logic.
 */

// Re-export bulk-relevant constants from filters for convenience
export { PRIORITIES, priorityColors } from "./EngineeringTaskFilters";
