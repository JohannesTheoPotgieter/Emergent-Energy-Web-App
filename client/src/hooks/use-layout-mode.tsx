import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * LayoutMode — user-selectable override for responsive layout behavior.
 *
 *   "auto"    → behave naturally based on window.innerWidth (default).
 *   "mobile"  → render mobile layouts at every viewport width
 *               (sidebars become sheets, tables stack, dialogs become bottom
 *               sheets, etc.).
 *   "desktop" → render desktop layouts at every viewport width
 *               (multi-column grids, centered modals, full sidebars, etc.).
 *
 * Mechanics:
 *  • Persisted to localStorage under EE_LAYOUT_MODE_KEY.
 *  • Applied to <html data-layout-mode="…"> so plain CSS can react to it.
 *  • On forced modes, also overrides the viewport meta tag — this is what
 *    actually makes Tailwind's sm:/md:/lg: media queries fire on a real
 *    mobile device when the user picks "desktop". (Desktop browsers ignore
 *    the meta `width=` directive, so for force-mobile on a wide screen we
 *    rely on the data attribute + targeted CSS overrides to flip the
 *    components that consume `useIsMobile()` / `useBreakpoint()`.)
 *  • Dispatches a `layoutmodechange` window event so non-React-context
 *    consumers (e.g. our `useIsMobile` hook used outside this provider)
 *    can react without a hard provider dependency.
 */

export type LayoutMode = "auto" | "mobile" | "desktop";

const STORAGE_KEY = "ee_layout_mode";
const FORCED_DESKTOP_VIEWPORT = "width=1280, initial-scale=1.0";
const FORCED_MOBILE_VIEWPORT = "width=390, initial-scale=1.0";

// Captured once on first apply so we can restore the index.html viewport
// content verbatim when the user returns to "auto" — avoids drift between
// the hard-coded fallback and whatever index.html actually ships.
let originalViewportContent: string | null = null;
const FALLBACK_NATURAL_VIEWPORT = "width=device-width, initial-scale=1.0, viewport-fit=cover";

function getViewportMeta(): HTMLMetaElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
}

export const LAYOUT_MODE_CHANGE_EVENT = "layoutmodechange";
// Hard-coded breakpoint widths used when a mode is forced — matches Tailwind's
// `sm` (640) / `md` (768) / `lg` (1024) breakpoints; see use-breakpoint.ts.
export const FORCED_DESKTOP_WIDTH = 1280;
export const FORCED_MOBILE_WIDTH = 390;

function readStoredMode(): LayoutMode {
  if (typeof window === "undefined") return "auto";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "mobile" || v === "desktop" || v === "auto") return v;
  return "auto";
}

function applyMode(mode: LayoutMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "auto") {
    delete root.dataset.layoutMode;
  } else {
    root.dataset.layoutMode = mode;
  }

  // Update the viewport meta tag. This is the only way (on a real mobile
  // device) to make Tailwind's `sm:` / `md:` / `lg:` utilities fire — they
  // are media-query based, not class based.
  const meta = getViewportMeta();
  if (meta) {
    if (originalViewportContent === null) {
      originalViewportContent = meta.getAttribute("content") || FALLBACK_NATURAL_VIEWPORT;
    }
    if (mode === "desktop") meta.setAttribute("content", FORCED_DESKTOP_VIEWPORT);
    else if (mode === "mobile") meta.setAttribute("content", FORCED_MOBILE_VIEWPORT);
    else meta.setAttribute("content", originalViewportContent);
  }

  window.dispatchEvent(new CustomEvent(LAYOUT_MODE_CHANGE_EVENT, { detail: { mode } }));
}

/**
 * Read the currently-effective override directly from the DOM. Returns null
 * when no override is active (i.e. natural responsive behavior). Safe to
 * call from non-React code paths.
 */
export function getLayoutModeOverride(): "mobile" | "desktop" | null {
  if (typeof document === "undefined") return null;
  const v = document.documentElement.dataset.layoutMode;
  return v === "mobile" || v === "desktop" ? v : null;
}

interface LayoutModeContextValue {
  mode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
  /** What the layout actually resolves to right now ("mobile" | "desktop"). */
  effective: "mobile" | "desktop";
}

const LayoutModeContext = createContext<LayoutModeContextValue | null>(null);

export function LayoutModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<LayoutMode>(() => readStoredMode());
  const [naturalIsMobile, setNaturalIsMobile] = useState<boolean>(() =>
    typeof window === "undefined" ? false : window.innerWidth < 768
  );

  // Apply on mount and whenever mode changes.
  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  // Track natural viewport so we can compute "effective" when mode === auto.
  useEffect(() => {
    const onResize = () => setNaturalIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setMode = useCallback((next: LayoutMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  }, []);

  const value = useMemo<LayoutModeContextValue>(
    () => ({
      mode,
      setMode,
      effective: mode === "auto" ? (naturalIsMobile ? "mobile" : "desktop") : mode,
    }),
    [mode, setMode, naturalIsMobile]
  );

  return <LayoutModeContext.Provider value={value}>{children}</LayoutModeContext.Provider>;
}

export function useLayoutMode(): LayoutModeContextValue {
  const ctx = useContext(LayoutModeContext);
  if (!ctx) {
    // Safe fallback if used outside the provider — natural behavior, no-op setter.
    return {
      mode: "auto",
      setMode: () => {},
      effective:
        typeof window !== "undefined" && window.innerWidth < 768 ? "mobile" : "desktop",
    };
  }
  return ctx;
}
