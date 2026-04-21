/**
 * Emergent Energy design tokens.
 *
 * This module is the TypeScript-accessible mirror of the CSS custom
 * properties defined in client/src/index.css. The CSS variables remain
 * the runtime authority — these tokens reference them via hsl(var(--x))
 * so light/dark mode, theme overrides, and prefers-reduced-motion all
 * work automatically.
 *
 * Do not duplicate raw colour values here. If a new token is needed:
 * 1. Add the CSS custom property to index.css (both :root and .dark).
 * 2. Add the token here that references it.
 *
 * Exception: brand primitives (logo colour, exact hex) are fixed values
 * per Phase 0 brand extraction (docs/overhaul/00-inventory.md §1.3) —
 * they must never drift.
 */

// -----------------------------------------------------------------------------
// Brand — fixed values. Extracted verbatim from index.css:249-254.
// -----------------------------------------------------------------------------

export const brand = {
  /** Primary brand colour. Tailwind emerald-600. Cited: index.css:249. */
  primary: "#16A34A",
  /** Brand accent / lighter emerald. Tailwind emerald-500. Cited: index.css:250. */
  accent: "#22C55E",
  /** Logo asset path relative to client/public. */
  logo: "/emergent-logo.png",
  /** Logo intrinsic dimensions (px). */
  logoWidth: 800,
  logoHeight: 202,
} as const;

// -----------------------------------------------------------------------------
// Colours — wrap CSS variables so dark mode and runtime overrides work.
// -----------------------------------------------------------------------------

export const colors = {
  background: "hsl(var(--background))",
  foreground: "hsl(var(--foreground))",
  card: "hsl(var(--card))",
  cardForeground: "hsl(var(--card-foreground))",
  popover: "hsl(var(--popover))",
  popoverForeground: "hsl(var(--popover-foreground))",
  primary: "hsl(var(--primary))",
  primaryForeground: "hsl(var(--primary-foreground))",
  secondary: "hsl(var(--secondary))",
  secondaryForeground: "hsl(var(--secondary-foreground))",
  muted: "hsl(var(--muted))",
  mutedForeground: "hsl(var(--muted-foreground))",
  accent: "hsl(var(--accent))",
  accentForeground: "hsl(var(--accent-foreground))",
  destructive: "hsl(var(--destructive))",
  destructiveForeground: "hsl(var(--destructive-foreground))",
  border: "hsl(var(--border))",
  input: "hsl(var(--input))",
  ring: "hsl(var(--ring))",
  /** Surface ladder — use for layered backgrounds. */
  surface: "hsl(var(--surface))",
  surfaceStrong: "hsl(var(--surface-strong))",
  surfaceTint: "hsl(var(--surface-tint))",
  /** Semantic state colours. Always pair with an icon — colour-blind safety. */
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  danger: "hsl(var(--danger))",
  info: "hsl(var(--info))",
} as const;

// -----------------------------------------------------------------------------
// Spacing — 4px base scale, matches Tailwind's default. Exposed in TS for
// components that need programmatic access (e.g. virtualised list row heights).
// -----------------------------------------------------------------------------

export const spacing = {
  0: "0",
  0.5: "0.125rem", //  2px
  1: "0.25rem", //  4px
  1.5: "0.375rem", //  6px
  2: "0.5rem", //  8px
  2.5: "0.625rem", // 10px
  3: "0.75rem", // 12px
  4: "1rem", // 16px
  5: "1.25rem", // 20px
  6: "1.5rem", // 24px
  7: "1.75rem", // 28px
  8: "2rem", // 32px
  10: "2.5rem", // 40px
  12: "3rem", // 48px
  14: "3.5rem", // 56px
  16: "4rem", // 64px
  20: "5rem", // 80px
  24: "6rem", // 96px
} as const;

// -----------------------------------------------------------------------------
// Layout — canonical dimensions for AppShell primitives.
// -----------------------------------------------------------------------------

export const layout = {
  /** Main content max width. Matches .ee-page (index.css:327). */
  pageMaxWidth: "1440px",
  /** AppShell top bar height (desktop). */
  topBarHeight: "56px",
  /** AppShell top bar height (mobile). */
  topBarHeightMobile: "48px",
  /** Sidebar width expanded. */
  sidebarWidth: "240px",
  /** Sidebar width collapsed (icons only). */
  sidebarWidthCollapsed: "64px",
  /** Mobile bottom tab bar height. */
  bottomTabBarHeight: "56px",
  /** Breadcrumb strip height. */
  breadcrumbHeight: "32px",
  /** PageHeader heights by configuration. */
  pageHeaderHeight: {
    compact: "64px",
    default: "96px",
    withKpi: "160px",
  },
  /** Minimum touch target (WCAG AA). Matches index.css:305-318. */
  minTouchTarget: "44px",
} as const;

// -----------------------------------------------------------------------------
// Typography.
// -----------------------------------------------------------------------------

export const typography = {
  fontFamily: {
    sans: "var(--font-sans)", // Inter
    heading: "var(--font-heading)", // Barlow
    mono: "var(--font-mono)", // JetBrains Mono
  },
  /** Font size scale. Matches base HTML at index.css:276-278, 290-291. */
  fontSize: {
    xs: "0.75rem", // 12px
    sm: "0.8125rem", // 13px
    base: "0.875rem", // 14px
    md: "1rem", // 16px
    lg: "1.125rem", // 18px
    xl: "1.25rem", // 20px
    "2xl": "1.5rem", // 24px
  },
  /** Line heights tuned for dense tables + forms. */
  lineHeight: {
    tight: 1.2,
    snug: 1.25,
    normal: 1.4,
    relaxed: 1.5,
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

// -----------------------------------------------------------------------------
// Radius. Matches index.css:48-50, 83.
// -----------------------------------------------------------------------------

export const radius = {
  none: "0",
  sm: "calc(var(--radius) - 4px)",
  md: "calc(var(--radius) - 2px)",
  lg: "var(--radius)", // 0.5rem base
  xl: "0.75rem",
  "2xl": "1rem",
  full: "9999px",
} as const;

// -----------------------------------------------------------------------------
// Shadow. Matches index.css:93-95, 144-146.
// -----------------------------------------------------------------------------

export const shadow = {
  none: "none",
  xs: "var(--shadow-xs)",
  sm: "var(--shadow-sm)",
  md: "var(--shadow-md)",
} as const;

// -----------------------------------------------------------------------------
// Z-index. Predetermined stacking contexts — never hand-picked.
// -----------------------------------------------------------------------------

export const zIndex = {
  /** Base page content. */
  base: 0,
  /** Sticky in-page elements (table header, summary header). */
  sticky: 10,
  /** Sidebar (desktop), AppShell chrome. */
  shell: 40,
  /** Sticky bulk-action bar. */
  stickyBottom: 50,
  /** Version-update banner (App.tsx:201). */
  versionBanner: 90,
  /** Popover, dropdown, tooltip. */
  overlay: 60,
  /** Dialog backdrop. */
  dialogBackdrop: 80,
  /** Dialog surface. */
  dialog: 81,
  /** Drawer surface. */
  drawer: 85,
  /** Toast. */
  toast: 100,
  /** NetworkStatus offline banner (must sit above version banner). */
  networkStatus: 100,
} as const;

// -----------------------------------------------------------------------------
// Motion. Durations tuned for prefers-reduced-motion honour.
// Reduced motion handled at index.css:667-681, 898-910.
// -----------------------------------------------------------------------------

export const motion = {
  duration: {
    instant: "0ms",
    fast: "100ms",
    base: "150ms",
    moderate: "200ms",
    slow: "300ms",
    slower: "400ms",
  },
  easing: {
    /** Default easing — matches existing animations in index.css. */
    standard: "cubic-bezier(0.16, 1, 0.3, 1)",
    /** For transient state (hover, focus). */
    smooth: "ease-out",
    /** For fade-out / exit. */
    exit: "ease-in",
  },
} as const;

// -----------------------------------------------------------------------------
// Type exports — for components that want strongly typed access.
// -----------------------------------------------------------------------------

export type BrandToken = typeof brand;
export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
export type LayoutToken = typeof layout;
export type RadiusToken = keyof typeof radius;
export type ShadowToken = keyof typeof shadow;
export type ZIndexToken = keyof typeof zIndex;
