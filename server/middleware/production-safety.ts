import type { NextFunction, Request, Response } from "express";

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function blockInProduction(reason: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (isProductionRuntime()) {
      return res.status(403).json({
        error: "blocked_in_production",
        message: reason,
      });
    }
    return next();
  };
}

/**
 * Second-line dual gate for the most destructive routes (full data wipe,
 * audit-log-adjacent operations, etc.). Requires the operator to explicitly
 * set ALLOW_DESTRUCTIVE_OPS="true" in the environment. Safer than
 * blockInProduction alone because a single NODE_ENV misconfiguration can't
 * silently expose the route — the env flag must also be flipped on purpose.
 * Uses strict string comparison so values like "1" / "yes" / boolean true
 * fail closed.
 */
export function requireDestructiveOpsFlag(reason: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (process.env.ALLOW_DESTRUCTIVE_OPS !== "true") {
      return res.status(403).json({
        error: "destructive_ops_disabled",
        message: reason,
      });
    }
    return next();
  };
}

export function requireDangerousActionConfirmation(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const provided = typeof req.body?.confirm === "string" ? req.body.confirm : "";
    if (provided !== expected) {
      return res.status(400).json({
        error: "confirmation_required",
        message: `Must send confirm: "${expected}"`,
      });
    }
    return next();
  };
}

/**
 * Catalogue of HTTP routes that wipe data, bypass auth, or otherwise must
 * never be callable in production. Each entry is gated at the route level
 * (via blockInProduction, an inline NODE_ENV check, or a registration-time
 * guard). This list is used by the startup orchestrator to log a loud
 * warning when the server boots in any non-development mode so operators
 * can see exactly which high-risk routes are wired into the app.
 */
export const DANGEROUS_ROUTES: ReadonlyArray<{ method: string; path: string; note: string }> = [
  { method: "POST", path: "/api/admin/clear-all-data", note: "Wipes all projects, cost lines, revenue lines, tasks. Gated by NODE_ENV + ALLOW_DESTRUCTIVE_OPS." },
  { method: "POST", path: "/api/admin/wipe-all-data", note: "Full database wipe. Gated by NODE_ENV + ALLOW_DESTRUCTIVE_OPS." },
  { method: "POST", path: "/api/admin/control-center/dangerous/clear-sessions", note: "Wipes the postgres session store — equivalent to mass logout. Gated by NODE_ENV + ALLOW_DESTRUCTIVE_OPS + CLEAR_ALL_SESSIONS confirmation." },
  { method: "POST", path: "/api/admin/migration/drop-archived", note: "Permanently drops legacy migration-archived tables with no restore path. Gated by NODE_ENV + ALLOW_DESTRUCTIVE_OPS + DROP_LEGACY_TABLES confirmation." },
  { method: "POST", path: "/api/procurement-analysis/reset-tags", note: "Destructive tag reset. blockInProduction." },
  { method: "GET",  path: "/api/auth/dev-login", note: "Dev-only auth bypass. Not registered in production + runtime 403 guard." },
  { method: "POST", path: "/api/role-auth/seed", note: "Seeds role credentials. blockInProduction." },
  { method: "POST", path: "/api/ee-info/post-seed-align", note: "Post-seed alignment. blockInProduction." },
  { method: "POST", path: "/api/ee-info/os/seed", note: "Operating-system seed. blockInProduction." },
  { method: "POST", path: "/api/ee-info/story/seed-demo", note: "Demo story seed. blockInProduction." },
  { method: "POST", path: "/api/ee-info/story/auto-seed", note: "Story lifecycle auto-seed. blockInProduction." },
  { method: "POST", path: "/api/tasks/seed-identified-items", note: "Task seed. blockInProduction." },
  { method: "POST", path: "/api/standups/seed-default", note: "Standup seed. blockInProduction." },
];

/**
 * Emit a warning to the given logger for every dangerous route that is
 * registered in a non-development runtime. Intended to be called from the
 * startup orchestrator immediately after routes are registered.
 */
export function warnOnDangerousRoutesInNonDev(
  log: (message: string, source?: string) => void,
): void {
  const env = process.env.NODE_ENV ?? "undefined";
  if (env === "development") return;

  log(
    `[SECURITY] Server is starting in NODE_ENV="${env}" with the following dangerous routes registered. ` +
      `Each route is gated at request time and must return 403 in production. ` +
      `If any of these routes respond with 2xx in production, treat it as a critical incident.`,
    "Startup:Security",
  );
  for (const route of DANGEROUS_ROUTES) {
    log(`  ${route.method.padEnd(5)} ${route.path} — ${route.note}`, "Startup:Security");
  }
}
