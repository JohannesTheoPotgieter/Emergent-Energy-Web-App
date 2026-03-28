/**
 * Engineering task view components: Kanban board, list, timeline, projects, and my-tasks views.
 * Re-exports from the main EngineeringTasksPage module for gradual migration.
 */
export {
  // View components
  TaskCard,
  KanbanColumn,
  InlineListView,
  TimelineView,
  ProjectKanbanView,
  MyTasksView,
  PersonalKpiStrip,

  // Shared types
  type ProjectGroup,
} from "../EngineeringTasksPage";
