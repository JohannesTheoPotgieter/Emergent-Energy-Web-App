import { useEffect, useState } from "react";
import {
  FORCED_DESKTOP_WIDTH,
  FORCED_MOBILE_WIDTH,
  LAYOUT_MODE_CHANGE_EVENT,
  getLayoutModeOverride,
} from "@/hooks/use-layout-mode";

type Breakpoint = "sm" | "md" | "lg" | "xl";

function resolveBreakpoint(width: number): Breakpoint {
  if (width < 640) return "sm";
  if (width < 768) return "md";
  if (width < 1024) return "lg";
  return "xl";
}

/**
 * Returns the effective width to drive responsive logic from. When the user
 * has forced a layout mode via the app-header toggle, we return the canonical
 * width for that mode so all `useBreakpoint()` consumers behave as if the
 * viewport were that wide.
 */
function effectiveWidth(): number {
  if (typeof window === "undefined") return 1280;
  const override = getLayoutModeOverride();
  if (override === "desktop") return FORCED_DESKTOP_WIDTH;
  if (override === "mobile") return FORCED_MOBILE_WIDTH;
  return window.innerWidth;
}

export function useBreakpoint() {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => resolveBreakpoint(effectiveWidth()));

  useEffect(() => {
    const update = () => setBreakpoint(resolveBreakpoint(effectiveWidth()));
    window.addEventListener("resize", update);
    window.addEventListener(LAYOUT_MODE_CHANGE_EVENT, update);
    update();
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener(LAYOUT_MODE_CHANGE_EVENT, update);
    };
  }, []);

  return {
    breakpoint,
    isMobile: breakpoint === "sm",
    isTablet: breakpoint === "md",
    isDesktop: breakpoint === "lg" || breakpoint === "xl",
  };
}
