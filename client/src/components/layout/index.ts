/**
 * Layout primitives — Phase 1 overhaul design system.
 *
 * Additive barrel re-export. See:
 *   - docs/overhaul/01-design-system.md §3 for each primitive's contract
 *   - docs/overhaul/01-wireframes.md for the archetype each primitive serves
 *   - client/src/components/layout/README.md for usage examples
 *
 * Adoption is opt-in per screen. Existing AppLayout.tsx remains the live
 * shell until whole-app migration is explicitly signed off.
 */

export { AppShell } from "./AppShell";
export type { AppShellProps } from "./AppShell";

export { LensNav, LENS_NAV_GROUP_ORDER } from "./LensNav";
export type { LensNavProps } from "./LensNav";

export { PageLayout } from "./PageLayout";
export type { PageLayoutProps } from "./PageLayout";

export { TableLayout } from "./TableLayout";
export type { TableLayoutProps } from "./TableLayout";

export { DetailLayout } from "./DetailLayout";
export type { DetailLayoutProps, DetailLayoutTab } from "./DetailLayout";

export { FormLayout } from "./FormLayout";
export type { FormLayoutProps } from "./FormLayout";

export { WizardLayout } from "./WizardLayout";
export type { WizardLayoutProps, WizardStep } from "./WizardLayout";
