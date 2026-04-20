// ── Standup facilitator types & constants ────────────────────────────────

export interface Participant {
  userId: number;
  userName: string;
  userEmail: string;
  userRole?: string | null;
  isRequired: boolean;
}

// Roles that should attend the engineering standup. Mirror of
// STANDUP_ATTENDEE_ROLES in server/standup-routes.ts.
export const STANDUP_ATTENDEE_ROLES = [
  "COO_ADMIN",
  "CEO_ADMIN",
  "ENGINEERING_MANAGER",
  "ENGINEER",
  "QUALITY_MANAGER",
] as const;

export const STANDUP_ATTENDEE_ROLE_LABELS: { role: string; label: string }[] = [
  { role: "COO_ADMIN", label: "COO" },
  { role: "CEO_ADMIN", label: "CEO" },
  { role: "ENGINEERING_MANAGER", label: "Engineering Manager" },
  { role: "ENGINEER", label: "Engineers" },
  { role: "QUALITY_MANAGER", label: "Quality Manager" },
];

export interface EngTask {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  priority: string | null;
  workstream: string;
  projectId: number | null;
  projectName?: string;
  ownerUserId: number | null;
  ownerName?: string | null;
  holdReason?: string | null;
  blockedType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  percentComplete?: number | null;
  phase?: string | null;
  taskTypeTag?: string | null;
}

export interface TaskMovement {
  taskId: number;
  taskTitle: string;
  userId: number;
  userName: string;
  fromStatus: string;
  toStatus: string;
  holdReason?: string;
}

export type StandupPhase = "waiting" | "running" | "ended";

export interface SpeakerState {
  participantIndex: number;
  elapsedSeconds: number;
}

export interface StandupSession {
  phase: StandupPhase;
  queue: Participant[];
  completedIndices: Set<number>;
  skippedIndices: Set<number>;
  speakerTimings: Map<number, number>; // userId → seconds
  taskMovements: TaskMovement[];
  moods: Map<number, string>; // userId → mood
  totalElapsed: number;
  facilitatorNotes: Map<number, string>; // userId → note
}

// The 4 lanes we show during standup
export const STANDUP_LANES = [
  { key: "TO DO", label: "To Do", color: "bg-slate-50", border: "border-slate-200" },
  { key: "IN PROGRESS", label: "In Progress", color: "bg-blue-50", border: "border-blue-200" },
  { key: "HOLD", label: "Hold", color: "bg-red-50", border: "border-red-200" },
  { key: "COMPLETE", label: "Done", color: "bg-green-50", border: "border-green-200" },
] as const;

export const MOODS = [
  { value: "great", label: "Great", emoji: "😊", color: "text-green-600 border-green-300 bg-green-50" },
  { value: "good", label: "Good", emoji: "🙂", color: "text-blue-600 border-blue-300 bg-blue-50" },
  { value: "okay", label: "Okay", emoji: "😐", color: "text-amber-600 border-amber-300 bg-amber-50" },
  { value: "struggling", label: "Struggling", emoji: "😟", color: "text-orange-600 border-orange-300 bg-orange-50" },
  { value: "blocked", label: "Blocked", emoji: "🚫", color: "text-red-600 border-red-300 bg-red-50" },
] as const;

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function timerColor(seconds: number): string {
  if (seconds >= 180) return "text-red-600";
  if (seconds >= 120) return "text-amber-600";
  return "text-muted-foreground";
}

export function initials(name?: string): string {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
