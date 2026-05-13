import * as React from "react"
import { LAYOUT_MODE_CHANGE_EVENT, getLayoutModeOverride } from "@/hooks/use-layout-mode"

const MOBILE_BREAKPOINT = 768

/**
 * `useIsMobile` reflects whether the app should render its mobile layout.
 *
 * Resolves to:
 *   • `true`  when the user has forced "mobile" via the app-header layout toggle,
 *   • `false` when the user has forced "desktop",
 *   • otherwise window.innerWidth < 768 (the natural Tailwind `md` breakpoint).
 *
 * This means every existing `useIsMobile()` consumer automatically respects
 * the global layout-mode override without changes.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const compute = () => {
      const override = getLayoutModeOverride()
      if (override === "mobile") return true
      if (override === "desktop") return false
      return window.innerWidth < MOBILE_BREAKPOINT
    }

    const update = () => setIsMobile(compute())

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", update)
    window.addEventListener(LAYOUT_MODE_CHANGE_EVENT, update)
    update()
    return () => {
      mql.removeEventListener("change", update)
      window.removeEventListener(LAYOUT_MODE_CHANGE_EVENT, update)
    }
  }, [])

  return !!isMobile
}
