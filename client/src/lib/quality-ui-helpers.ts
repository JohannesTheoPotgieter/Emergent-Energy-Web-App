/**
 * Shared Quality UI helpers (Task 3.3 consolidation).
 *
 * Previously each Quality surface carried its own copy of `qFetch` and a
 * divergent `getRiskSeverityColor` (QualityTab collapsed medium+low to amber;
 * QualityWarningsPanel used orange/yellow). Both now live here so severity
 * badges read consistently and the fetch wrapper has one implementation.
 */

/** Authenticated fetch that returns the parsed JSON body (throws on !ok). */
export async function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch (${res.status})${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  return res.json();
}

/**
 * Format a date-only value (YYYY-MM-DD or an ISO string) parsed as LOCAL
 * midnight, so it matches the overdue comparison (which uses local midnight)
 * and never renders the previous day in a negative-offset timezone.
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "";
  const datePart = String(value).split("T")[0];
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return new Date(value).toLocaleDateString();
  return new Date(y, m - 1, d).toLocaleDateString();
}

/** Treat an evidence URL as a photo when it points at an image file, so
 *  site-inspection captures render as inline thumbnails (Task 3.1). */
export function isImageEvidenceUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp)(\?.*)?$/i.test(url);
}

export function parseRiskYesNo(value: string | null | undefined): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

export function formatRiskYesNo(value: boolean | null | undefined): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unanswered";
}

/** Canonical severity → badge classes. Distinct per level (high/medium/low). */
export function getRiskSeverityColor(severity: string): string {
  switch (severity?.toLowerCase()) {
    case "high":
    case "critical":
      return "text-red-500 bg-red-50 border-red-500/20";
    case "medium":
    case "major":
      return "text-amber-500 bg-amber-50 border-amber-500/20";
    case "low":
    case "minor":
      return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
    default:
      return "text-muted-foreground bg-muted/50 border-border";
  }
}
