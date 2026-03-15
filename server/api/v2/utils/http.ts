import type { NextFunction, Request, Response } from "express";
import { z, type ZodSchema } from "zod";

export class ApiV2Error extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function ok(res: Response, data: unknown, meta?: Record<string, unknown>) {
  return res.status(200).json({ success: true, data, meta: meta ?? null, error: null });
}

export function created(res: Response, data: unknown, meta?: Record<string, unknown>) {
  return res.status(201).json({ success: true, data, meta: meta ?? null, error: null });
}

export function fail(res: Response, err: unknown) {
  if (err instanceof ApiV2Error) {
    return res.status(err.status).json({ success: false, data: null, meta: null, error: { code: err.code, message: err.message, details: err.details ?? null } });
  }
  return res.status(500).json({ success: false, data: null, meta: null, error: { code: "INTERNAL_ERROR", message: "Unexpected error", details: null } });
}

export function validate<T>(schema: ZodSchema<T>, value: unknown, message: string) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiV2Error("VALIDATION_ERROR", 400, message, parsed.error.flatten());
  }
  return parsed.data;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() && req.user) return next();
  throw new ApiV2Error("AUTH_REQUIRED", 401, "Authentication required");
}

export function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => fn(req, res).catch((err) => fail(res, err));
}

export const paginationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  sortBy: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().optional(),
});

export function paginationMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
