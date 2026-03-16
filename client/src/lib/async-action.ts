import { ApiError, isApiError, timeoutError } from "@/lib/api-error";

type AsyncActionStatus = "start" | "success" | "timeout" | "failure";
export type AsyncFailureType = "retryable_failure" | "terminal_failure";

export interface AsyncActionTelemetryEvent {
  action: string;
  correlationId: string;
  status: AsyncActionStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  failureType?: AsyncFailureType;
  errorMessage?: string;
}

export interface RunAsyncActionOptions {
  action: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  telemetry?: (event: AsyncActionTelemetryEvent) => void;
}

interface AsyncActionContext {
  signal: AbortSignal;
  correlationId: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function generateCorrelationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function classifyAsyncFailure(error: unknown): AsyncFailureType {
  if (isApiError(error)) {
    return error.retryable ? "retryable_failure" : "terminal_failure";
  }
  return "terminal_failure";
}

function defaultTelemetry(event: AsyncActionTelemetryEvent) {
  if (event.status === "start") {
    console.info("[async-action] start", event);
    return;
  }
  if (event.status === "success") {
    console.info("[async-action] complete", event);
    return;
  }
  console.error("[async-action] failure", event);
}

function withCorrelation(error: ApiError, correlationId: string): ApiError {
  if (import.meta.env.DEV) {
    error.message = `${error.message} (correlation: ${correlationId})`;
  }
  return error;
}

export async function runAsyncAction<T>(
  task: (context: AsyncActionContext) => Promise<T>,
  options: RunAsyncActionOptions,
): Promise<T> {
  const correlationId = generateCorrelationId();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const telemetry = options.telemetry ?? defaultTelemetry;
  const controller = new AbortController();
  const startedAtDate = new Date();
  const startedAt = startedAtDate.toISOString();

  if (options.signal) {
    options.signal.addEventListener("abort", () => {
      controller.abort(options.signal?.reason);
    }, { once: true });
  }

  const timeoutHandle = setTimeout(() => {
    controller.abort("timeout");
  }, timeoutMs);

  telemetry({
    action: options.action,
    correlationId,
    status: "start",
    startedAt,
  });

  try {
    const value = await task({ signal: controller.signal, correlationId });
    const completedAtDate = new Date();
    telemetry({
      action: options.action,
      correlationId,
      status: "success",
      startedAt,
      completedAt: completedAtDate.toISOString(),
      durationMs: completedAtDate.getTime() - startedAtDate.getTime(),
    });
    return value;
  } catch (error) {
    const completedAtDate = new Date();
    const timeoutTriggered = controller.signal.aborted && controller.signal.reason === "timeout";
    const normalizedError = timeoutTriggered
      ? withCorrelation(timeoutError(), correlationId)
      : (isApiError(error) ? withCorrelation(error, correlationId) : error);

    telemetry({
      action: options.action,
      correlationId,
      status: timeoutTriggered ? "timeout" : "failure",
      startedAt,
      completedAt: completedAtDate.toISOString(),
      durationMs: completedAtDate.getTime() - startedAtDate.getTime(),
      failureType: classifyAsyncFailure(normalizedError),
      errorMessage: normalizedError instanceof Error ? normalizedError.message : "Unknown async action failure",
    });

    throw normalizedError;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

