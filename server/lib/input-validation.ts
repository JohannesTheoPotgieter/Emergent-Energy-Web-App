/**
 * Input validation helpers for API endpoints.
 * 
 * Provides Zod schemas and middleware for validating request bodies
 * against Drizzle insert schemas, preventing arbitrary field injection.
 */

import { Request, Response, NextFunction } from "express";
import { ZodError, ZodSchema } from "zod";

/**
 * Express middleware that validates req.body against a Zod schema.
 * Returns 400 with validation errors if invalid.
 * Replaces req.body with the parsed (and stripped) result on success.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: "Validation failed",
          details: err.errors.map(e => ({
            path: e.path.join("."),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}

/**
 * Validate and strip a request body against a Zod schema inline.
 * Returns [parsed, null] on success, [null, errorResponse] on failure.
 */
export function parseBody<T>(
  body: unknown,
  schema: ZodSchema<T>,
): [T, null] | [null, { error: string; details: Array<{ path: string; message: string }> }] {
  try {
    const parsed = schema.parse(body);
    return [parsed, null];
  } catch (err) {
    if (err instanceof ZodError) {
      return [
        null,
        {
          error: "Validation failed",
          details: err.errors.map(e => ({
            path: e.path.join("."),
            message: e.message,
          })),
        },
      ];
    }
    throw err;
  }
}

/**
 * Validate a table name against an allowed set (prevents SQL injection
 * in dynamic table references).
 */
export function validateTableName(
  table: string,
  allowedTables: ReadonlySet<string>,
): string | null {
  if (allowedTables.has(table)) return table;
  return null;
}
