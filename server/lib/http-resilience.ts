/**
 * Outbound HTTP resilience — retry-with-backoff + a per-target circuit breaker.
 *
 * Wraps third-party API calls (QuickBooks, Microsoft Graph) so that:
 *  - transient failures (network blips, 429, 5xx) are retried with exponential
 *    backoff + jitter instead of failing on the first attempt;
 *  - a persistently failing upstream "trips" a circuit breaker, after which
 *    calls fail fast (CircuitOpenError) for a cooldown window instead of
 *    hammering the upstream and blocking the page that triggered the call.
 *
 * Intentionally dependency-free and side-effect-free (no DB, no logger, no
 * env) so it is trivially unit-testable with injected clocks / sleep.
 *
 * Auth / 4xx "terminal" errors are deliberately NOT treated as transient:
 * retrying them wastes time and they should surface immediately so the caller
 * can flip the integration to "needs reconnect" rather than flap.
 */

// ===================== ERROR CLASSIFICATION =====================

/**
 * Best-effort HTTP status extraction. Reads `.status` / `.statusCode` when the
 * error object carries one, otherwise pulls a 4xx/5xx code out of the message
 * (our fetch wrappers throw `... returned 503: ...`-shaped messages).
 */
export function getErrorStatus(err: unknown): number | null {
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.status === "number") return anyErr.status;
    if (typeof anyErr.statusCode === "number") return anyErr.statusCode;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/\b([45]\d{2})\b/);
  if (m) return Number(m[1]);
  return null;
}

/**
 * A transient error is one worth retrying: 429 (rate limit), 5xx (upstream
 * server error), or a network-layer failure. Everything else (401/403/4xx,
 * validation, auth-revoked) is terminal and must surface immediately.
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof CircuitOpenError) return false;
  const status = getErrorStatus(err);
  if (status !== null) return status === 429 || (status >= 500 && status <= 599);
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang ?up|network|fetch failed|timed? ?out/i.test(
    msg,
  );
}

// ===================== RETRY =====================

export interface RetryOptions {
  /** Total attempts including the first try. Default 3. */
  attempts?: number;
  /** Base delay for the first backoff step (ms). Default 300. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff step (ms). Default 5000. */
  maxDelayMs?: number;
  /** Backoff growth factor. Default 2 (exponential). */
  factor?: number;
  /** Apply +/- 50% jitter to each delay to de-correlate retries. Default true. */
  jitter?: boolean;
  /** Decide whether a thrown error is worth retrying. Default isTransientError. */
  isRetryable?: (err: unknown) => boolean;
  /** Observe each scheduled retry (logging / metrics). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Injectable sleep so tests don't wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff + jitter.
 * Non-retryable errors (per `isRetryable`) and the final attempt throw
 * straight through.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = Math.max(0, opts.baseDelayMs ?? 300);
  const max = opts.maxDelayMs ?? 5000;
  const factor = opts.factor ?? 2;
  const useJitter = opts.jitter ?? true;
  const isRetryable = opts.isRetryable ?? isTransientError;
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isRetryable(err)) throw err;
      const raw = Math.min(max, base * Math.pow(factor, attempt - 1));
      const delayMs = useJitter ? Math.round(raw * (0.5 + Math.random() * 0.5)) : raw;
      opts.onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  // Unreachable in practice (the loop either returns or throws), but keeps TS happy.
  throw lastErr;
}

// ===================== CIRCUIT BREAKER =====================

export type CircuitState = "closed" | "open" | "half_open";

/** Thrown by CircuitBreaker.exec when the breaker is open and still cooling down. */
export class CircuitOpenError extends Error {
  readonly code = "circuit_open";
  constructor(
    public readonly key: string,
    public readonly retryAfterMs: number,
  ) {
    super(
      `Circuit breaker open for "${key}" — retry in ~${Math.ceil(retryAfterMs / 1000)}s`,
    );
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive countable failures that trip the breaker open. Default 5. */
  failureThreshold?: number;
  /** How long the breaker stays open before allowing a half-open trial (ms). Default 60s. */
  cooldownMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface CircuitSnapshot {
  key: string;
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  /** ms until the next half-open trial is allowed, when open. */
  retryAfterMs: number | null;
}

/**
 * A minimal closed → open → half-open breaker. One trial is allowed in
 * half-open; success closes it, failure re-opens it. Failures that the caller
 * marks non-countable (e.g. terminal auth errors) pass through without moving
 * breaker state — the breaker only guards against a flapping/overloaded
 * upstream, not against a revoked credential.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt: number | null = null;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    public readonly key: string,
    opts: CircuitBreakerOptions = {},
  ) {
    this.threshold = Math.max(1, opts.failureThreshold ?? 5);
    this.cooldownMs = Math.max(0, opts.cooldownMs ?? 60_000);
    this.now = opts.now ?? (() => Date.now());
  }

  private maybeHalfOpen(): void {
    if (
      this.state === "open" &&
      this.openedAt !== null &&
      this.now() - this.openedAt >= this.cooldownMs
    ) {
      this.state = "half_open";
    }
  }

  snapshot(): CircuitSnapshot {
    this.maybeHalfOpen();
    const retryAfterMs =
      this.state === "open" && this.openedAt !== null
        ? Math.max(0, this.cooldownMs - (this.now() - this.openedAt))
        : null;
    return {
      key: this.key,
      state: this.state,
      consecutiveFailures: this.failures,
      openedAt: this.openedAt,
      retryAfterMs,
    };
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === "half_open" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }

  /**
   * Execute `fn` under the breaker. Fails fast with CircuitOpenError while
   * open. `countsAsTrip` decides whether a thrown error moves the breaker
   * toward open (default: every error counts).
   */
  async exec<T>(
    fn: () => Promise<T>,
    countsAsTrip: (err: unknown) => boolean = () => true,
  ): Promise<T> {
    this.maybeHalfOpen();
    if (this.state === "open") {
      const retryAfterMs =
        this.openedAt !== null
          ? Math.max(0, this.cooldownMs - (this.now() - this.openedAt))
          : this.cooldownMs;
      throw new CircuitOpenError(this.key, retryAfterMs);
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      if (countsAsTrip(err)) this.recordFailure();
      throw err;
    }
  }
}

// ===================== REGISTRY =====================

const registry = new Map<string, CircuitBreaker>();

/** Get (or lazily create) the shared breaker for a target key, e.g. "quickbooks". */
export function getCircuitBreaker(
  key: string,
  opts?: CircuitBreakerOptions,
): CircuitBreaker {
  let breaker = registry.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker(key, opts);
    registry.set(key, breaker);
  }
  return breaker;
}

/** Read a breaker's state without creating one. Used by the health endpoint. */
export function getCircuitSnapshot(key: string): CircuitSnapshot | null {
  const breaker = registry.get(key);
  return breaker ? breaker.snapshot() : null;
}

/** Test hook — clear all registered breakers between cases. */
export function __resetCircuitBreakersForTests(): void {
  registry.clear();
}
