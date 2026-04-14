const registeredRouteGroups = new Set<string>();

export type RouteGroupOwner =
  | "legacy-shell"
  | "department-admin"
  | "department-exco"
  | "department-finance"
  | "department-project"
  | "department-priority-strategic"
  | "department-handover"
  | "other";

/**
 * Startup safety helper that prevents accidental duplicate registration of the
 * same route group during a single process lifetime.
 *
 * Why this exists:
 * - We are in a bridge-era architecture with both legacy and extracted shells.
 * - Duplicate app/router registration can silently shadow handlers.
 * - We prefer additive/idempotent startup behavior in production.
 */
export function registerRouteGroupOnce(options: {
  key: string;
  owner: RouteGroupOwner;
  register: () => void;
  onSkip?: (message: string) => void;
}) {
  const { key, owner, register, onSkip } = options;
  const canonicalKey = `${owner}:${key}`;

  if (registeredRouteGroups.has(canonicalKey)) {
    onSkip?.(`[Routes] Skipping duplicate registration for ${canonicalKey}`);
    return false;
  }

  register();
  registeredRouteGroups.add(canonicalKey);
  return true;
}

/** Test-only reset hook. */
export function __resetRouteRegistrationGuardForTests() {
  registeredRouteGroups.clear();
}
