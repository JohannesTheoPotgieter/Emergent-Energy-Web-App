/**
 * Response transformation helpers for API consistency.
 * 
 * Addresses:
 * - snake_case → camelCase conversion for raw SQL results
 * - Decimal string → number coercion for Postgres decimal columns
 * - Safe JSONB parsing with fallback defaults
 */

/**
 * Convert a snake_case string to camelCase.
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

/**
 * Recursively convert all snake_case keys in an object (or array of objects)
 * to camelCase.  Leaves non-plain-object values (Date, null, primitives) alone.
 */
export function camelCaseKeys<T = any>(data: T): T {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return data.map(camelCaseKeys) as unknown as T;
  if (typeof data === "object" && data.constructor === Object) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[snakeToCamel(key)] = camelCaseKeys(value);
    }
    return result as T;
  }
  return data;
}

/**
 * Parse a value that may be a string-encoded decimal to a number.
 * Returns null for null/undefined/empty, NaN-safe.
 */
export function toNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "string") {
    if (val.trim() === "") return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Coerce all decimal-looking string values in an object to numbers.
 * Useful for converting Postgres decimal columns that arrive as strings.
 * Only converts values that look like valid numbers.
 */
export function coerceDecimals<T extends Record<string, unknown>>(
  row: T,
  decimalFields: string[],
): T {
  const result = { ...row };
  for (const field of decimalFields) {
    if (field in result) {
      (result as any)[field] = toNumber(result[field]) ?? result[field];
    }
  }
  return result;
}

/**
 * Safely parse a JSONB column value with a fallback default.
 * Handles: already-parsed objects, JSON strings, null/undefined.
 */
export function safeJsonb<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Extract rows from a raw db.execute() result, handling both
 * Postgres (result.rows) and the direct-array pattern.
 */
export function extractRows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    return (result as any).rows ?? [];
  }
  return [];
}
