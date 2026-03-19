/**
 * Shared status/color utilities for consistent visual treatment
 * across all pages. These functions return Tailwind CSS class strings.
 *
 * Centralised to eliminate copy-pasted color logic.
 */

/** RAG badge classes (Red / Amber / Green status indicator) */
export function ragBadgeClasses(rag: string | null | undefined): string {
  if (rag === "Red") return "bg-red-100 text-red-700 border-red-200";
  if (rag === "Amber") return "bg-amber-100 text-amber-700 border-amber-200";
  if (rag === "Green") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  return "bg-slate-100 text-slate-500 border-slate-200";
}

/** RAG dot colour class (for small status indicators) */
export function ragDotClass(rag: string | null | undefined): string {
  const s = (rag || "").toLowerCase();
  if (s === "green") return "bg-green-500";
  if (s === "amber") return "bg-amber-500";
  if (s === "red") return "bg-red-500";
  return "bg-gray-300";
}

/** Severity style object for action centre / exception items */
export function severityStyle(severity: string | null | undefined): { bg: string; text: string; dot: string } {
  const s = (severity || "").toLowerCase();
  if (s === "critical") return { bg: "bg-red-50 border-red-200", text: "text-red-700", dot: "bg-red-500" };
  if (s === "high") return { bg: "bg-orange-50 border-orange-200", text: "text-orange-700", dot: "bg-orange-500" };
  if (s === "medium") return { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", dot: "bg-amber-500" };
  return { bg: "bg-slate-50 border-slate-200", text: "text-slate-600", dot: "bg-slate-400" };
}

/** Task / ticket status badge classes */
export function statusColorClasses(status: string | null | undefined): string {
  const s = status || "";
  if (s === "Completed") return "bg-green-100 text-green-700";
  if (s === "In Progress") return "bg-blue-100 text-blue-700";
  if (s === "On Hold") return "bg-orange-100 text-orange-700";
  if (s === "Cancelled") return "bg-muted text-muted-foreground";
  return "bg-muted text-foreground";
}

/** Priority badge classes */
export function priorityColorClasses(priority: string | null | undefined): string {
  const p = priority || "";
  if (p === "Critical") return "bg-red-100 text-red-700";
  if (p === "High") return "bg-orange-100 text-orange-700";
  if (p === "Low") return "bg-green-100 text-green-700";
  return "bg-blue-100 text-blue-700";
}
