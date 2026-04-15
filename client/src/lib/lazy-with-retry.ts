import { lazy, type ComponentType } from "react";

/**
 * Retry wrapper for dynamic imports — handles ChunkLoadError that happens
 * when a user's session straddles a new deployment and the old chunk
 * manifest references filenames that no longer exist on the server.
 *
 * Prompt 0.12: the previous version of this helper silently called
 * window.location.reload() once per path after retries exhausted. That
 * hides real bugs (a chunk that genuinely fails because of an
 * application error becomes a mysterious refresh loop). The long-term
 * fix pushes the retry-then-surface contract instead:
 *
 *   1. Retry the dynamic import up to `retries` times with a 1 s gap.
 *      This absorbs transient CDN misses and deployment races without
 *      user interaction.
 *   2. On final failure, re-throw the error so it propagates to the
 *      surrounding React ErrorBoundary. The ErrorBoundary detects
 *      ChunkLoadError and renders a dedicated "New version available"
 *      message with an explicit Reload button — bugs stay visible and
 *      reloads are user-initiated.
 *
 * The proactive version-check hook (useVersionCheck) surfaces a banner
 * *before* users hit a chunk error so the error path is the rare
 * fallback, not the main mitigation.
 */
export function isChunkLoadError(error: Error | undefined | null): boolean {
  if (!error) return false;
  return (
    error.name === "ChunkLoadError" ||
    (error.message?.includes("Failed to fetch dynamically imported module") ?? false) ||
    (error.message?.includes("Loading chunk") ?? false) ||
    (error.message?.includes("Loading CSS chunk") ?? false)
  );
}

export function retryingImport<T>(importFn: () => Promise<T>, retries: number): Promise<T> {
  return importFn().catch((error: Error) => {
    if (isChunkLoadError(error) && retries > 0) {
      return new Promise<T>((resolve) => setTimeout(resolve, 1000)).then(() =>
        retryingImport(importFn, retries - 1),
      );
    }
    throw error;
  });
}

// Prompt 0.12 follow-up: one retry attempt only, not three. A stale chunk
// reference either recovers on the first retry or the app should surface
// the "New version available" ErrorBoundary screen — infinite retries
// just delay the banner.
export function lazyWithRetry(
  importFn: () => Promise<{ default: ComponentType<any> }>,
  retries = 1,
): ReturnType<typeof lazy> {
  return lazy(() => retryingImport(importFn, retries));
}
