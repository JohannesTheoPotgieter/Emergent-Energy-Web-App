/**
 * Shared timestamp formatting for admin/audit/integration surfaces.
 *
 * Emergent Energy operates in South Africa — all audit and sync timestamps
 * shown to the COO/CEO must be unambiguous, so we pin the locale to en-ZA and
 * the zone to Africa/Johannesburg and always render an explicit "SAST" label.
 */

const TIME_ZONE = "Africa/Johannesburg";
const LOCALE = "en-ZA";
const TZ_LABEL = "SAST";

/** Full date + time with explicit timezone, e.g. "2026/05/17, 14:32 SAST". */
export function formatDateTimeZA(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const formatted = d.toLocaleString(LOCALE, {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatted} ${TZ_LABEL}`;
}

/** Relative ("3 min ago") followed by the absolute, timezone-qualified value. */
export function formatRelativeWithAbsoluteZA(
  value: string | number | Date | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const ms = Date.now() - d.getTime();
  const mins = Math.round(ms / 60_000);
  let relative: string;
  if (mins < 1) relative = "just now";
  else if (mins < 60) relative = `${mins} min ago`;
  else if (mins < 1440) relative = `${Math.round(mins / 60)} hr ago`;
  else relative = `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? "" : "s"} ago`;
  return `${relative} (${formatDateTimeZA(d)})`;
}

export const TIMEZONE_LABEL = TZ_LABEL;

/**
 * TF-31 (audit V3) — date-only en-ZA formatter for finance pages.
 *
 * Returns e.g. "17 May 2026". Accepts a raw `YYYY-MM-DD` string (no
 * timezone shift — treated as a calendar date) or a full ISO timestamp
 * (formatted in SAST). Returns the canonical "—" placeholder for
 * absent / non-parseable input.
 */
export function formatDateZA(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  // Bare YYYY-MM-DD strings shouldn't be parsed by `new Date()` (which
  // applies a UTC offset and can shift the day on display). Render them
  // by parts so the display is timezone-stable.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return date.toLocaleDateString(LOCALE, {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(LOCALE, {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
