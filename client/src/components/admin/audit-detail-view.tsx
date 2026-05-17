/**
 * UI/UX audit X5 — readable key/value renderer for audit "change detail"
 * payloads. Replaces the raw JSON.stringify dumps that were shown to a
 * non-technical COO in the two parallel audit UIs.
 *
 * Scalars render as a definition list; nested objects/arrays render compactly.
 * Used by the consolidated audit surface and the system activity log.
 */

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    return value
      .map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)))
      .join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

interface AuditDetailViewProps {
  detail: Record<string, unknown> | null | undefined;
  /** Heading for the section; omit to render rows only. */
  title?: string;
}

export function AuditDetailView({ detail, title }: AuditDetailViewProps) {
  if (!detail || typeof detail !== "object" || Object.keys(detail).length === 0) {
    return <p className="text-xs text-muted-foreground">No additional detail recorded.</p>;
  }

  const entries = Object.entries(detail);

  return (
    <div className="space-y-1.5" data-testid="audit-detail-view">
      {title && <p className="text-xs font-semibold text-gray-700">{title}</p>}
      <dl className="rounded border border-gray-200 bg-white divide-y divide-gray-100">
        {entries.map(([key, value]) => (
          <div key={key} className="flex gap-3 px-3 py-1.5 text-xs">
            <dt className="w-40 shrink-0 font-medium text-gray-500">{humanizeKey(key)}</dt>
            <dd className="flex-1 break-words text-gray-800">{renderValue(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
