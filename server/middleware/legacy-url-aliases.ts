import type { Express, Request, Response, NextFunction } from "express";

/**
 * URL aliases for the engineering-ticket vocabulary rename (task #61).
 *
 * Two redirect-free aliases are exposed by URL rewriting so that POST/PATCH
 * payloads do not trip Express's 308 redirect on trailing-slash mismatch and
 * so cookies/CSRF state is preserved across the rename:
 *
 *   /api/engineering-tickets/*       ->  /api/pd/tickets/*
 *   /api/engineering-pm-handover/*   ->  /api/pd-pm-handover/*
 *
 * The legacy `/api/pd/tickets/*` and `/api/pd-pm-handover/*` paths continue
 * to work; whenever a client hits them we emit a one-shot deprecation log
 * (de-duplicated per method+path per process) so we can track residual
 * traffic before retiring the legacy URLs in a follow-up release.
 */

const NEW_TO_LEGACY: Array<{ from: string; to: string }> = [
  { from: "/api/engineering-tickets", to: "/api/pd/tickets" },
  { from: "/api/engineering-pm-handover", to: "/api/pd-pm-handover" },
];

const LEGACY_PREFIXES: Array<{ prefix: string; replacement: string }> = [
  { prefix: "/api/pd/tickets", replacement: "/api/engineering-tickets" },
  { prefix: "/api/pd-pm-handover", replacement: "/api/engineering-pm-handover" },
];

const seenDeprecated = new Set<string>();

function startsWithSegment(url: string, prefix: string): boolean {
  if (!url.startsWith(prefix)) return false;
  const tail = url.charAt(prefix.length);
  return tail === "" || tail === "/" || tail === "?";
}

export function applyLegacyUrlAliases(app: Express) {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const url = req.url;

    // Rewrite new -> legacy so existing handlers serve both.
    for (const { from, to } of NEW_TO_LEGACY) {
      if (startsWithSegment(url, from)) {
        req.url = to + url.slice(from.length);
        return next();
      }
    }

    // Log deprecation when the legacy URL is used. De-duplicate per
    // method+path so high-traffic endpoints do not spam the logs.
    for (const { prefix, replacement } of LEGACY_PREFIXES) {
      if (startsWithSegment(url, prefix)) {
        const key = `${req.method} ${prefix}`;
        if (!seenDeprecated.has(key)) {
          seenDeprecated.add(key);
          // eslint-disable-next-line no-console
          console.warn(
            `[deprecated-url] ${req.method} ${prefix}/* is deprecated; ` +
              `migrate clients to ${replacement}/* (task #61).`,
          );
        }
        break;
      }
    }
    return next();
  });
}
