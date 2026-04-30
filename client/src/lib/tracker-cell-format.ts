/**
 * Tracker per-cell font/fill helper.
 *
 * The Smart Import v2 pipeline persists each row's source-workbook cell
 * formatting to the `cell_format` JSONB column on:
 *   - normalized_revenue_lines
 *   - normalized_cost_lines
 *   - normalized_cost_line_actuals
 *   - tracker_revenue_summary
 *   - tracker_project_metadata
 *   - work_items
 *
 * Shape (per the task brief and PR2C):
 *   Record<string, { font?: string; fill?: string; bold?: boolean }>
 *
 * The key is the canonical field name (camelCase or snake_case — we accept
 * either and normalise). Values are CSS-ready hex strings (e.g. "#FF0000").
 *
 * Example:
 *   { milestone_notes: { font: "#FF0000" }, paid_date: { fill: "#FFFF00" } }
 *
 * Tracker conventions surfaced verbatim:
 *   - Red font: unconfirmed value or negative number.
 *   - Yellow fill: concern / risk.
 *   - Black font / no fill: confirmed (default).
 *
 * If `cell_format` is null (legacy row imported before PR2C), every lookup
 * returns an empty style — no error.
 */
export type CellFormat = {
  font?: string | null;
  fill?: string | null;
  bold?: boolean | null;
};

export type CellFormatMap = Record<string, CellFormat | undefined>;

/** Convert "milestone_notes" / "milestoneNotes" → both lookups so callers
 *  can pass either form without worrying which the importer wrote. */
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Read raw `cell_format` (which may be null / unknown JSON shape) and look
 * up the entry for `field`, accepting either snake_case or camelCase keys.
 * Returns null when no entry is present so the caller can fall back to
 * default styling without conditional spread.
 */
export function getCellFormat(
  rawMap: unknown,
  field: string,
): CellFormat | null {
  if (rawMap == null || typeof rawMap !== "object") return null;
  const map = rawMap as Record<string, unknown>;
  const candidates = [field, snakeToCamel(field), camelToSnake(field)];
  for (const key of candidates) {
    const entry = map[key];
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const out: CellFormat = {};
      if (typeof e.font === "string") out.font = e.font;
      if (typeof e.fill === "string") out.fill = e.fill;
      if (typeof e.bold === "boolean") out.bold = e.bold;
      return out;
    }
  }
  return null;
}

/**
 * Convert a CellFormat to a React.CSSProperties object suitable for a
 * `style={...}` prop on the rendered cell. Inline styles are necessary
 * because the fill/font values are dynamic per import — they can't live
 * in a Tailwind class.
 *
 * - `fill` maps to backgroundColor.
 * - `font` maps to color.
 * - `bold` maps to fontWeight: 600 (matching shadcn body weight scale).
 *
 * Returns an empty object when no formatting is set, so the caller can
 * always spread the result safely.
 */
export function cellFormatToStyle(fmt: CellFormat | null | undefined): React.CSSProperties {
  if (!fmt) return {};
  const style: React.CSSProperties = {};
  if (fmt.fill) style.backgroundColor = fmt.fill;
  if (fmt.font) style.color = fmt.font;
  if (fmt.bold) style.fontWeight = 600;
  return style;
}

/**
 * One-shot helper: given a raw `cell_format` JSONB and a field name,
 * return an inline-style object. Equivalent to
 *   cellFormatToStyle(getCellFormat(raw, field))
 * but saves a line at every cell.
 */
export function styleForCell(
  rawMap: unknown,
  field: string,
): React.CSSProperties {
  return cellFormatToStyle(getCellFormat(rawMap, field));
}
