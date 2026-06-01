/**
 * Engineering task dialog/drawer components and supporting utilities.
 * Re-exports from the main EngineeringTasksPage module for gradual migration.
 */
export {
  QuickStatusSelect,
  QuickEditPopover,
  getTaskContextBadges,
  DependenciesTab,
} from "../EngineeringTasksPage";
// Sourced directly from the drawer module: EngineeringTasksPage now lazy-loads
// the drawer and no longer statically re-exports it (keeping the heavy chunk
// out of the page bundle). This barrel shim keeps the names available.
export { PostUpdateForm, TaskDetailDrawer } from "./EngineeringTaskDrawer";
export { TaskDependenciesPanel } from "./panels/TaskDependenciesPanel";
