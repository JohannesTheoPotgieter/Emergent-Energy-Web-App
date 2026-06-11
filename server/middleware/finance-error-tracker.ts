/**
 * Finance error-tracking middleware.
 *
 * Feeds the finance error-rate monitor (R2). On every response to a finance
 * route, if the status is 5xx, records the error to the rolling-window monitor
 * and the structured log. The monitor's threshold alert is checked by the
 * finance watchdog; this middleware only OBSERVES — it never alters the
 * response, so it cannot break a finance request.
 */

import type { Request, Response, NextFunction } from "express";
import { recordFinanceServerError, isFinancePath } from "../services/finance-observability/error-monitor";

export function financeErrorTracker(req: Request, res: Response, next: NextFunction): void {
  // Resolve the path once; req.path is stable for the lifetime of the request.
  const path = req.path || req.url || "";
  if (isFinancePath(path)) {
    res.on("finish", () => {
      if (res.statusCode >= 500) {
        recordFinanceServerError({
          route: `${req.method} ${path}`,
          status: res.statusCode,
          kind: "http_5xx",
        });
      }
    });
  }
  next();
}
