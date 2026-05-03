import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  Flag,
  GitBranch,
  Link as LinkIcon,
  LogIn,
  LogOut,
  UserMinus,
  UserPlus,
} from "lucide-react";
import type { PriorityActivityRow } from "./priority-types";

/**
 * Visual + copy for a priority activity event. Extracted from
 * priority-detail.tsx so other surfaces (home widget, exco roll-up, email
 * digest) can render the same timeline without duplicating the branching.
 */

const ICON_CLASS = "w-2.5 h-2.5";

export function ActivityIcon({ action }: { action: string }) {
  switch (action) {
    case "created": return <Flag className={`${ICON_CLASS} text-emerald-600`} />;
    case "closed": return <CheckCircle2 className={`${ICON_CLASS} text-gray-500`} />;
    case "reopened": return <LogIn className={`${ICON_CLASS} text-emerald-600`} />;
    case "marked_complete": return <CheckCircle2 className={`${ICON_CLASS} text-emerald-600`} />;
    case "escalated": return <ArrowUp className={`${ICON_CLASS} text-orange-600`} />;
    case "assigned": return <UserPlus className={`${ICON_CLASS} text-blue-600`} />;
    case "reassigned": return <UserPlus className={`${ICON_CLASS} text-blue-600`} />;
    case "unassigned": return <UserMinus className={`${ICON_CLASS} text-gray-500`} />;
    case "broken_down": return <GitBranch className={`${ICON_CLASS} text-blue-600`} />;
    case "project_linked": return <LinkIcon className={`${ICON_CLASS} text-emerald-600`} />;
    case "project_unlinked": return <LogOut className={`${ICON_CLASS} text-gray-500`} />;
    case "status_changed": return <AlertTriangle className={`${ICON_CLASS} text-amber-600`} />;
    case "severity_changed": return <AlertTriangle className={`${ICON_CLASS} text-orange-600`} />;
    case "manual_health_changed": return <AlertTriangle className={`${ICON_CLASS} text-amber-600`} />;
    case "manual_progress_changed": return <AlertTriangle className={`${ICON_CLASS} text-amber-600`} />;
    case "due_date_changed": return <AlertTriangle className={`${ICON_CLASS} text-amber-600`} />;
    case "owner_changed": return <UserPlus className={`${ICON_CLASS} text-blue-600`} />;
    case "accountable_exec_changed": return <UserPlus className={`${ICON_CLASS} text-blue-600`} />;
    case "project_rag_update": return <AlertTriangle className={`${ICON_CLASS} text-amber-600`} />;
    case "project_phase_change": return <GitBranch className={`${ICON_CLASS} text-blue-600`} />;
    default: return <AlertTriangle className={`${ICON_CLASS} text-gray-500`} />;
  }
}

export function formatActivitySentence(a: PriorityActivityRow): string {
  const fromToUser = (from: string | null, to: string | null) =>
    (a.fromName || from || "none") + " → " + (a.toName || to || "none");
  const fromTo = (from: string | null, to: string | null) =>
    (from ?? "none") + " → " + (to ?? "none");
  const details = (a.details || {}) as Record<string, unknown>;
  const projectName = typeof details.projectName === "string" ? details.projectName : "a linked project";
  const reason = typeof details.reason === "string" ? details.reason : null;
  const comment = typeof details.comment === "string" ? details.comment : null;
  const notes = typeof details.notes === "string" ? details.notes : null;
  const childCount = typeof details.childCount === "number" ? details.childCount : null;

  switch (a.action) {
    case "created": return "created this priority";
    case "closed": return "closed it";
    case "reopened": return "reopened it";
    case "marked_complete": return "marked it complete";
    case "escalated": return `escalated it${reason ? ` (${reason})` : ""} → ${a.toValue ?? "next scope"}`;
    case "assigned": return `assigned it to ${a.toName || `user #${a.toValue}`}`;
    case "reassigned": return `reassigned ${fromToUser(a.fromValue, a.toValue)}`;
    case "unassigned": return "unassigned it";
    case "broken_down":
      return `broke it down into ${childCount ?? "sub-"}priorit${childCount === 1 ? "y" : "ies"}`;
    case "project_linked": return `linked project #${a.toValue}`;
    case "project_unlinked": return `unlinked project #${a.toValue}`;
    case "status_changed": return `changed status ${fromTo(a.fromValue, a.toValue)}`;
    case "severity_changed": return `changed severity ${fromTo(a.fromValue, a.toValue)}`;
    case "manual_health_changed": return `set manual health ${fromTo(a.fromValue, a.toValue)}`;
    case "manual_progress_changed": return `set manual progress ${fromTo(a.fromValue, a.toValue)}%`;
    case "due_date_changed": return `changed due date ${fromTo(a.fromValue, a.toValue)}`;
    case "owner_changed": return `changed owner ${fromToUser(a.fromValue, a.toValue)}`;
    case "accountable_exec_changed": return `changed accountable exec ${fromToUser(a.fromValue, a.toValue)}`;
    case "project_rag_update":
      return `RAG on ${projectName} → ${a.toValue ?? "?"}${comment ? ` — ${comment}` : ""}`;
    case "project_phase_change":
      return `${projectName} entered phase ${a.toValue ?? "?"}${notes ? ` — ${notes}` : ""}`;
    default: return `${a.action} ${fromTo(a.fromValue, a.toValue)}`;
  }
}
