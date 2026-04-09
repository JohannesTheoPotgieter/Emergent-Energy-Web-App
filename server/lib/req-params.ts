/**
 * Express 5 types `req.params` values as `string | string[]` because
 * route patterns like `/:id+` can produce arrays. In this app all route
 * params are single-segment, so they are always strings at runtime.
 *
 * This helper narrows the type safely, taking the first element if an
 * array is ever passed (defensive).
 */
export function paramStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
