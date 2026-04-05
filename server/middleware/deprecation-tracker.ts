/**
 * Deprecation Tracker Middleware — Post-Migration
 *
 * Adds X-Deprecated headers to legacy routes and tracks usage counts.
 * Usage data feeds into the admin migration control page for bridge
 * retirement decisions.
 *
 * Guardrail 4: Every bridge must have an exit trigger — this provides
 * the monitoring data needed to confirm zero usage before retirement.
 */

import type { Request, Response, NextFunction } from "express";

// In-memory usage counters (reset on restart — for monitoring, not persistence)
const usageCounters = new Map<string, { count: number; lastUsed: Date }>();

/**
 * Tracks usage of a deprecated route.
 * Call at the top of legacy route handlers.
 */
export function trackDeprecatedRoute(routeKey: string) {
  const entry = usageCounters.get(routeKey) || { count: 0, lastUsed: new Date() };
  entry.count++;
  entry.lastUsed = new Date();
  usageCounters.set(routeKey, entry);
}

/**
 * Express middleware that adds deprecation headers and tracks usage.
 * Apply to legacy routes that have been superseded by v2 endpoints.
 */
export function deprecatedRoute(routeKey: string, replacedBy: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Deprecated", `Use ${replacedBy} instead`);
    res.setHeader("X-Deprecated-Route", routeKey);
    trackDeprecatedRoute(routeKey);
    next();
  };
}

/**
 * Returns current usage statistics for all tracked deprecated routes.
 */
export function getDeprecationStats(): Array<{
  route: string;
  count: number;
  lastUsed: string;
}> {
  return Array.from(usageCounters.entries())
    .map(([route, data]) => ({
      route,
      count: data.count,
      lastUsed: data.lastUsed.toISOString(),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Resets usage counters (e.g., after a monitoring period).
 */
export function resetDeprecationStats(): void {
  usageCounters.clear();
}

// ─── Legacy Route → V2 Replacement Map ────────────────────────

export const DEPRECATED_ROUTES: Array<{
  legacyRoute: string;
  v2Replacement: string;
  domain: string;
  canRetire: boolean;
}> = [
  // Parties
  { legacyRoute: "GET /api/pd/clients", v2Replacement: "GET /api/parties?kind=organisation", domain: "Parties", canRetire: false },
  { legacyRoute: "POST /api/pd/clients", v2Replacement: "POST /api/parties", domain: "Parties", canRetire: false },
  { legacyRoute: "GET /api/counterparties", v2Replacement: "GET /api/parties", domain: "Parties", canRetire: false },

  // Work Items
  { legacyRoute: "GET /api/tasks", v2Replacement: "GET /api/projects/:id/work-items", domain: "Work Items", canRetire: false },
  { legacyRoute: "POST /api/tasks", v2Replacement: "POST /api/work-items", domain: "Work Items", canRetire: false },

  // Approvals
  { legacyRoute: "GET /api/approvals/pending", v2Replacement: "GET /api/approvals-v2?status=pending", domain: "Approvals", canRetire: false },
  { legacyRoute: "PATCH /api/approvals/:id", v2Replacement: "PATCH /api/approvals-v2/:id", domain: "Approvals", canRetire: false },

  // Finance
  { legacyRoute: "GET /api/purchase-orders", v2Replacement: "GET /api/finance-records?type=purchase_order", domain: "Finance", canRetire: false },
  { legacyRoute: "GET /api/payment-requests", v2Replacement: "GET /api/finance-records?type=payment_request", domain: "Finance", canRetire: false },

  // Governed Processes
  { legacyRoute: "GET /api/financial-reviews", v2Replacement: "GET /api/governed-processes?type=financial_review", domain: "Governed Processes", canRetire: false },
  { legacyRoute: "GET /api/handovers", v2Replacement: "GET /api/governed-processes?type=pd_to_pm_handover", domain: "Governed Processes", canRetire: false },
];
