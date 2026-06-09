import { randomUUID } from "node:crypto";
import { Response } from "express";

/**
 * Safe extractor for an error's message. Use this in catch blocks that need to
 * log or surface `err.message` — TypeScript narrows `catch` params to
 * `unknown`, and reaching into `.message` on `unknown` would be a type error.
 */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return String(err); } catch { return "Unknown error"; }
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, string>,
    public nextAction?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function badRequest(message: string, details?: Record<string, string>) {
  return new ApiError(400, "BAD_REQUEST", message, details);
}

export function unauthorized(message = "Authentication required") {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "You don't have permission to do this") {
  return new ApiError(403, "FORBIDDEN", message);
}

export function notFound(resource = "Resource") {
  return new ApiError(404, "NOT_FOUND", `${resource} not found`);
}

export function conflict(message: string, nextAction = "Refresh and retry your request.") {
  return new ApiError(409, "CONFLICT", message, undefined, nextAction);
}

export function validationError(fields: Record<string, string>, nextAction = "Correct the highlighted fields and submit again.") {
  return new ApiError(422, "VALIDATION_ERROR", "Please fix the following fields", fields, nextAction);
}

export function serverError(message = "Something went wrong. Please try again.") {
  return new ApiError(500, "SERVER_ERROR", message);
}

function shouldExposeDetail() {
  return process.env.NODE_ENV !== "production" || process.env.EXPOSE_ERROR_DETAIL === "true";
}

function extractDebugDetail(error: unknown) {
  if (!shouldExposeDetail()) return undefined;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return undefined;
}

export function logApiError(context: string, error: unknown) {
  if (error instanceof Error) {
    console.error(`[API Error] ${context}:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
    return;
  }
  console.error(`[API Error] ${context}:`, error);
}

export function sendError(res: Response, error: unknown, traceId?: string) {
  if (error instanceof ApiError) {
    const body: Record<string, unknown> = {
      error: error.code,
      code: error.code,
      type: error.code,
      message: error.message,
    };
    if (error.details) {
      body.details = error.details;
    }
    if (error.nextAction) {
      body.nextAction = error.nextAction;
    }
    if (traceId) {
      body.traceId = traceId;
    }
    return res.status(error.statusCode).json(body);
  }

  logApiError(error instanceof Error ? "Unhandled" : "Unknown", error);
  return res.status(500).json({
    error: "SERVER_ERROR",
    code: "SERVER_ERROR",
    type: "SERVER_ERROR",
    message: "Something went wrong. Please try again.",
    nextAction: "Retry shortly or contact support if this continues.",
    detail: extractDebugDetail(error),
    ...(traceId ? { traceId } : {}),
  });
}

/** A transient dependency (QuickBooks, schema not yet migrated, cache warming)
 *  is unavailable — render as a "try again shortly" 503, never a hard failure. */
export function serviceUnavailable(
  message = "This data source is temporarily unavailable. Please retry shortly.",
) {
  return new ApiError(503, "SERVICE_UNAVAILABLE", message, undefined, "Retry in a few moments.");
}

/**
 * Typed error response for a finance READ endpoint whose handler caught an
 * unexpected failure. Mints a correlation id (traceId), logs the root cause
 * server-side against that id, and returns a typed JSON body the finance cards
 * render as a friendly "couldn't load — retry". The stable machine `code` is
 * preserved (the cards key on it); the raw error/stack is NEVER sent to the
 * client in production (detail is dev-only, mirroring `sendError`).
 *
 *   } catch (err) { return sendFinanceError(res, "reconciliation_portfolio_failed", err); }
 *   } catch (err) { return sendFinanceError(res, "qb_recon_failed", err, { status: 503 }); }
 */
export function sendFinanceError(
  res: Response,
  code: string,
  cause: unknown,
  opts: { status?: number; message?: string; nextAction?: string } = {},
): Response {
  const traceId = randomUUID();
  logApiError(`finance:${code} [traceId=${traceId}]`, cause);
  return res.status(opts.status ?? 500).json({
    error: code,
    code,
    type: code,
    message: opts.message ?? "We couldn't load this finance view. Please retry.",
    nextAction:
      opts.nextAction ?? "Retry shortly. If it keeps happening, share this trace id with support.",
    traceId,
    detail: extractDebugDetail(cause),
  });
}
