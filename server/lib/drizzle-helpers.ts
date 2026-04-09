/**
 * Drizzle ORM typing helpers.
 *
 * Drizzle's `inArray(column, values)` requires the values array type to
 * exactly match the column type.  When the array comes from a `.map()` or
 * `.filter()` chain, TypeScript often infers `unknown[]` or a union that
 * doesn't satisfy the overload.  These helpers provide a safe narrowing
 * pattern so call sites don't need individual casts.
 */

/**
 * Narrow an array to `number[]`, filtering out non-finite values.
 * Use when building an array for `inArray(column, ids)` where column is integer.
 */
export function toNumberArray(values: unknown[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/**
 * Narrow an array to `string[]`, filtering out non-string values.
 * Use when building an array for `inArray(column, values)` where column is text.
 */
export function toStringArray(values: unknown[]): string[] {
  return values.filter((v): v is string => typeof v === "string");
}
