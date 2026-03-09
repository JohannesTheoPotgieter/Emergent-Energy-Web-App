import { Response } from "express";

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

export function sendError(res: Response, error: unknown) {
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
    return res.status(error.statusCode).json(body);
  }

  if (error instanceof Error) {
    logApiError("Unhandled", error);
    return res.status(500).json({
      error: "SERVER_ERROR",
      code: "SERVER_ERROR",
      type: "SERVER_ERROR",
      message: "Something went wrong. Please try again.",
      nextAction: "Retry shortly or contact support if this continues.",
      detail: extractDebugDetail(error),
    });
  }

  logApiError("Unknown", error);
  return res.status(500).json({
    error: "SERVER_ERROR",
    code: "SERVER_ERROR",
    type: "SERVER_ERROR",
    message: "Something went wrong. Please try again.",
    nextAction: "Retry shortly or contact support if this continues.",
    detail: extractDebugDetail(error),
  });
}
