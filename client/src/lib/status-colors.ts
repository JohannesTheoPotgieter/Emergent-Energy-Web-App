/**
 * Shared status/color utilities for consistent visual treatment
 * across all pages. These functions return Tailwind CSS class strings.
 *
 * Centralised to eliminate copy-pasted color logic.
 */
import { normalizeToUniversalStatus, UNIVERSAL_STATUS_META, type UniversalDisplayStatus } from "@shared/task-status";

// ─── RAG (Red / Amber / Green) ───────────────────────────────────────────────

export type RagLevel = "green" | "amber" | "red";

/** Canonical RAG color palette — use these instead of hardcoded hex/tailwind */
export const RAG_COLORS: Record<RagLevel, { hex: string; bg: string; text: string; border: string; dot: string; ring: string }> = {
  green:  { hex: "#16A34A", bg: "bg-emerald-50",  text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500", ring: "ring-emerald-500/20" },
  amber:  { hex: "#D97706", bg: "bg-amber-50",    text: "text-amber-700",   border: "border-amber-200",   dot: "bg-amber-500",   ring: "ring-amber-500/20"   },
  red:    { hex: "#DC2626", bg: "bg-red-50",       text: "text-red-700",     border: "border-red-200",     dot: "bg-red-500",     ring: "ring-red-500/20"     },
};

/** RAG badge classes (Red / Amber / Green status indicator) */
export function ragBadgeClasses(rag: string | null | undefined): string {
  const r = (rag || "").toLowerCase() as RagLevel;
  const c = RAG_COLORS[r];
  if (c) return `${c.bg} ${c.text} ${c.border}`;
  return "bg-slate-100 text-slate-500 border-slate-200";
}

/** RAG dot colour class (for small status indicators) */
export function ragDotClass(rag: string | null | undefined): string {
  const r = (rag || "").toLowerCase() as RagLevel;
  return RAG_COLORS[r]?.dot || "bg-gray-300";
}

/** RAG text color for inline text */
export function ragTextClass(rag: string | null | undefined): string {
  const r = (rag || "").toLowerCase() as RagLevel;
  return RAG_COLORS[r]?.text || "text-muted-foreground";
}

// ─── Chart Colors ────────────────────────────────────────────────────────────

export const CHART_COLORS = {
  revenue:  "#059669",  // emerald-600
  cos:      "#ea580c",  // orange-600
  gp:       "#0d9488",  // teal-600
  actual:   "#047857",  // emerald-700
  planned:  "#2563eb",  // blue-600
  forecast: "#8b5cf6",  // violet-500
  budget:   "#6366f1",  // indigo-500
} as const;

// ─── Severity ────────────────────────────────────────────────────────────────

/** Severity style object for action centre / exception items */
export function severityStyle(severity: string | null | undefined): { bg: string; text: string; dot: string } {
  const s = (severity || "").toLowerCase();
  if (s === "critical") return { bg: "bg-red-50 border-red-200", text: "text-red-700", dot: "bg-red-500" };
  if (s === "high") return { bg: "bg-orange-50 border-orange-200", text: "text-orange-700", dot: "bg-orange-500" };
  if (s === "medium") return { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", dot: "bg-amber-500" };
  return { bg: "bg-slate-50 border-slate-200", text: "text-slate-600", dot: "bg-slate-400" };
}

// ─── Task / Ticket Status ────────────────────────────────────────────────────

/** Universal status badge classes — uses the shared normalizer from task-status.ts */
export function statusBadgeClasses(status: string | null | undefined): string {
  return UNIVERSAL_STATUS_META[normalizeToUniversalStatus(status)].badgeClass;
}

/** Universal status dot color */
export function statusDotClass(status: string | null | undefined): string {
  return UNIVERSAL_STATUS_META[normalizeToUniversalStatus(status)].dotColor;
}

/** Universal status display label */
export function statusLabel(status: string | null | undefined): string {
  return UNIVERSAL_STATUS_META[normalizeToUniversalStatus(status)].label;
}

/** Legacy — kept for backward compatibility */
export function statusColorClasses(status: string | null | undefined): string {
  return statusBadgeClasses(status);
}

// ─── Priority ────────────────────────────────────────────────────────────────

/** Priority badge classes */
export function priorityColorClasses(priority: string | null | undefined): string {
  const p = (priority || "").toLowerCase();
  if (p === "critical" || p === "urgent" || p === "p1") return "bg-red-100 text-red-700";
  if (p === "high" || p === "p2") return "bg-orange-100 text-orange-700";
  if (p === "low" || p === "p4") return "bg-green-100 text-green-700";
  return "bg-blue-100 text-blue-700";
}
