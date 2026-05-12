/**
 * jsdom polyfills for Vitest unit tests that render real React components
 * (e.g. recharts-backed dashboards). jsdom doesn't ship ResizeObserver or
 * matchMedia by default, but Radix UI and Recharts both reach for them on
 * mount — without these stubs, the component tests crash before any
 * assertion runs.
 *
 * Loaded for every test file via `setupFiles` in qa/vitest.config.ts. Safe in
 * Node-environment tests because the global declarations only land when
 * jsdom has populated globalThis with a window.
 */

if (typeof globalThis !== "undefined" && typeof (globalThis as { window?: unknown }).window !== "undefined") {
  const g = globalThis as unknown as {
    ResizeObserver?: unknown;
    IntersectionObserver?: unknown;
    matchMedia?: unknown;
  };

  if (!g.ResizeObserver) {
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (!g.IntersectionObserver) {
    g.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    };
  }

  if (!g.matchMedia) {
    g.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    });
  }
}
