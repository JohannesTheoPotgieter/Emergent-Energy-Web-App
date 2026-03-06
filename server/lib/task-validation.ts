import { CANONICAL_STATUSES, CANONICAL_PRIORITIES, CANONICAL_WORKSTREAMS } from "./canonical-task-engine";

export interface ValidationError {
  field: string;
  message: string;
}

export function validateTaskCreate(data: any): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
    errors.push({ field: "title", message: "Title is required and cannot be empty" });
  }

  if (data.status) {
    const s = data.status.toLowerCase().trim();
    const validStatuses = [...CANONICAL_STATUSES, "inbox", "done", "planned", "waiting", "not started", "in progress", "active", "pending"];
    if (!validStatuses.includes(s)) {
      errors.push({ field: "status", message: `Invalid status "${data.status}". Valid statuses: ${CANONICAL_STATUSES.join(", ")}` });
    }
  }

  if (data.priority) {
    const p = data.priority.toLowerCase().trim();
    const validPriorities = [...CANONICAL_PRIORITIES.map(x => x.toLowerCase()), "urgent", "p1", "p2", "p3", "p4", "med"];
    if (!validPriorities.includes(p)) {
      errors.push({ field: "priority", message: `Invalid priority "${data.priority}". Valid priorities: ${CANONICAL_PRIORITIES.join(", ")}` });
    }
  }

  if (data.workstream) {
    const w = data.workstream.toUpperCase().trim();
    if (!CANONICAL_WORKSTREAMS.includes(w as any)) {
      errors.push({ field: "workstream", message: `Invalid workstream "${data.workstream}". Valid: ${CANONICAL_WORKSTREAMS.join(", ")}` });
    }
  }

  return errors;
}

export function validateTaskUpdate(data: any): ValidationError[] {
  const errors: ValidationError[] = [];

  if (data.title !== undefined && (typeof data.title !== "string" || !data.title.trim())) {
    errors.push({ field: "title", message: "Title cannot be empty" });
  }

  if (data.status !== undefined) {
    const s = data.status.toLowerCase().trim();
    const validStatuses = [...CANONICAL_STATUSES, "inbox", "done", "planned", "waiting", "not started", "in progress", "active", "pending", "to do", "blocked", "on hold"];
    if (!validStatuses.includes(s)) {
      errors.push({ field: "status", message: `Invalid status "${data.status}". Valid statuses: ${CANONICAL_STATUSES.join(", ")}` });
    }
  }

  if (data.priority !== undefined) {
    const p = data.priority.toLowerCase().trim();
    const validPriorities = [...CANONICAL_PRIORITIES.map(x => x.toLowerCase()), "urgent", "p1", "p2", "p3", "p4", "med"];
    if (!validPriorities.includes(p)) {
      errors.push({ field: "priority", message: `Invalid priority "${data.priority}"` });
    }
  }

  if (data.workstream !== undefined) {
    const w = data.workstream.toUpperCase().trim();
    if (!CANONICAL_WORKSTREAMS.includes(w as any)) {
      errors.push({ field: "workstream", message: `Invalid workstream "${data.workstream}"` });
    }
  }

  return errors;
}
