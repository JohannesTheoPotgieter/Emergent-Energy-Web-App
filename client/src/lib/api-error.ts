export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT";

export class ApiError extends Error {
  public code: ErrorCode;
  public status: number;
  public details?: Record<string, string>;
  /**
   * Full parsed JSON body of the failed response, when available.
   * Routes that return structured non-`details` payloads (e.g. the
   * client-delete blocker counts under `body.blockers`) can still
   * surface that data to the caller without changing the canonical
   * `details` shape (which is typed as `Record<string, string>` for
   * field-level validation errors).
   */
  public body?: unknown;
  public retryable: boolean;

  constructor(opts: {
    code: ErrorCode;
    status: number;
    message: string;
    details?: Record<string, string>;
    body?: unknown;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
    this.body = opts.body;
    this.retryable = opts.status >= 500 || opts.code === "NETWORK_ERROR" || opts.code === "TIMEOUT";
  }

  get userMessage(): string {
    switch (this.code) {
      case "UNAUTHORIZED":
        return "Your session has expired. Please log in again.";
      case "FORBIDDEN":
        return this.message || "You don't have permission to do this.";
      case "NOT_FOUND":
        return this.message || "The item you're looking for doesn't exist or was removed.";
      case "VALIDATION_ERROR":
        return this.message || "Please check your input and try again.";
      case "CONFLICT":
        return this.message || "This conflicts with an existing item.";
      case "NETWORK_ERROR":
        return "Unable to connect to the server. Check your internet connection.";
      case "TIMEOUT":
        return "The request took too long. Please try again.";
      case "SERVER_ERROR":
        return "Something went wrong on our end. Please try again.";
      default:
        return this.message || "An unexpected error occurred.";
    }
  }

  get fieldErrors(): Record<string, string> | undefined {
    return this.code === "VALIDATION_ERROR" ? this.details : undefined;
  }
}

export function parseApiError(response: Response, body: unknown): ApiError {
  const record: Record<string, unknown> =
    body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = (typeof record.error === "string" ? record.error : undefined) as ErrorCode | undefined;
  const message =
    (typeof record.message === "string" ? record.message : undefined) ||
    response.statusText ||
    "Request failed";
  const details =
    record.details !== null && typeof record.details === "object"
      ? (record.details as Record<string, string>)
      : undefined;

  return new ApiError({
    code: code ?? "SERVER_ERROR",
    status: response.status,
    message,
    details,
    body,
  });
}

export function networkError(): ApiError {
  return new ApiError({
    code: "NETWORK_ERROR",
    status: 0,
    message: "Unable to connect to the server. Check your internet connection.",
  });
}

export function timeoutError(): ApiError {
  return new ApiError({
    code: "TIMEOUT",
    status: 0,
    message: "The request took too long. Please try again.",
  });
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
