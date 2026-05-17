/**
 * Engineering task filter constants, workload strip, and localStorage helpers.
 *
 * Filter constants + localStorage helpers now live in the real
 * ./task-filter-config module (UI/UX audit X5 module split). The workload
 * strip component still lives in the orchestrator; re-exported here.
 */
export {
  // Filter option constants
  PRIORITIES,
  DUE_DATE_FILTER_OPTIONS,
  WORKLOAD_STATE_OPTIONS,
  LINKED_SOURCE_OPTIONS,
  priorityColors,
  priorityBorderColors,
  SAVED_FILTERS,

  // localStorage helpers
  getSavedMyName,
  setSavedMyName,
  getEngViewKey,
  getSavedEngDefaultView,
  saveEngDefaultView,
  clearEngDefaultView,
} from "./task-filter-config";

// Workload strip component still lives in the orchestrator module.
export { EngineeringWorkloadStrip } from "../EngineeringTasksPage";
