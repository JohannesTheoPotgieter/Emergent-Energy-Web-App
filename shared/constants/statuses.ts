export const ProjectStatus = {
  active: "active",
  on_hold: "on_hold",
  completed: "completed",
  cancelled: "cancelled",
} as const;

export const TaskStatus = {
  todo: "todo",
  in_progress: "in_progress",
  blocked: "blocked",
  done: "done",
  cancelled: "cancelled",
} as const;

export const RagStatus = {
  red: "red",
  amber: "amber",
  green: "green",
  unknown: "unknown",
} as const;

export const ProjectStatusLabels: Record<string, string> = {
  [ProjectStatus.active]: "Active",
  [ProjectStatus.on_hold]: "On Hold",
  [ProjectStatus.completed]: "Completed",
  [ProjectStatus.cancelled]: "Cancelled",
};

export const TaskStatusLabels: Record<string, string> = {
  [TaskStatus.todo]: "To Do",
  [TaskStatus.in_progress]: "In Progress",
  [TaskStatus.blocked]: "Blocked",
  [TaskStatus.done]: "Done",
  [TaskStatus.cancelled]: "Cancelled",
};

export const RagStatusLabels: Record<string, string> = {
  [RagStatus.red]: "Red",
  [RagStatus.amber]: "Amber",
  [RagStatus.green]: "Green",
  [RagStatus.unknown]: "Unknown",
};
