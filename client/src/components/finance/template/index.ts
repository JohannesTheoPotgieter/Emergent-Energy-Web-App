/**
 * The compact finance template — ONE set of shared components for every
 * finance screen (header → KPI row → drill table → states), all built on the
 * existing canonical primitives (formatZar / Money / KpiTile / TrustBadge) so
 * there is a single import path and no figure ever changes.
 *
 *   import {
 *     FinancePageHeader, KpiRow, DrillTable, MoneyValue, StatusBadge,
 *     FinanceLoading, FinanceEmpty, FinanceError,
 *   } from "@/components/finance/template";
 */
export { FinancePageHeader, type FinancePageHeaderProps } from "./FinancePageHeader";
export { KpiRow, type KpiRowProps } from "./KpiRow";
export { MoneyValue, type MoneyValueProps } from "./MoneyValue";
export { StatusBadge, type StatusBadgeProps, type StatusTone } from "./StatusBadge";
export {
  DrillTable,
  type DrillTableProps,
  type DrillColumn,
  type DrillBreadcrumbItem,
} from "./DrillTable";
export { FinanceLoading, FinanceEmpty, FinanceError } from "./states";

// Re-export the canonical primitives the template sits on, so screens can
// import everything finance-presentation from one place.
export { KpiTile } from "../KpiTile";
export { TrustBadge } from "../TrustBadge";
